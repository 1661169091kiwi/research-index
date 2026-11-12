// Paper feed service: owns the recommender, fetching, covers, AI takes, questions and translation.
// Platform-neutral. The desktop app (index.mjs) wires it to Electron IPC; the phone app (mobile/boot.mjs)
// calls the same handlers directly. Every handler is named after its IPC channel.

import { createRecommender } from './recommend.mjs';
import { fetchAll, findFigure, fetchFullText } from './sources.mjs';
import { TOPICS, PALETTE } from './topics.mjs';
import { venueOf } from './venues.mjs';
import { costOf, summarize as usageSummary } from './usage.mjs';
import { canonical } from './affil.mjs';
import { enrich, due as oaDue } from './openalex.mjs';
import { scoreAll } from './quality.mjs';
import { RATING_SYSTEM, RATING_V, ratingPrompt, parseRatings } from './rating.mjs';
import { deepseekPeak } from './usage.mjs';
import { systemPrompt, userPrompt, chatSystem, chatPaper, TITLES_SYSTEM, ABSTRACT_SYSTEM, parseTitleMap } from './prompts.mjs';

// store: createStoreCore(); keys: { get(provider), set(provider, key), hint?(provider) };
// send(channel, data): events to the page; providers: { deepseek: {...}, claude?: {...} } (see index.mjs)
// maxPool: reading further back stops at this many papers (the phone keeps fewer: its files are slower to write)
export function createFeedService({ store, keys, send, providers, envKey = () => '', debug = false, maxPool = 7000 }) {
  // ---------- the quality score (quality.mjs): the collection scored at once, again when its evidence changes ----------
  let quality = { key: '', at: 0, scores: new Map() };
  function qualityMap() {
    const key = `${store.version}|${store.qualityRev}`;
    if (quality.key === key || (quality.at && Date.now() - quality.at < 15000)) return quality.scores;
    quality = { key, at: Date.now(), scores: scoreAll(store.papers, store.ratings).scores };
    return quality.scores;
  }
  const qualityOf = (id) => qualityMap().get(id)?.score ?? null;
  const rec = createRecommender(store, { qualityOf });
  // the translator sometimes repeats the title first ("标题：… 摘要：…"); only the abstract is kept
  // (partial: a reply still streaming in, where a title it repeats may not have reached the abstract yet)
  const zhAbs = (s, partial = false) => {
    const t = String(s || '');
    if (partial && /^\s*标/.test(t) && !/摘要\s*[:：]/.test(t)) return '';
    return t.replace(/^\s*标题\s*[:：][\s\S]*?摘要\s*[:：]\s*/, '').trim();
  };
  const handlers = {};
  const handle = (channel, fn) => { handlers[channel] = fn; };
  let fetching = null;
  let lastMore = 0;
  let progress = { done: 0, total: 0, label: '', finished: true };

  // ---------- serialisation ----------
  function coverOf(p) {
    if (p.cover?.url) return { url: p.cover.url, w: p.cover.w || 0, h: p.cover.h || 0 };
    if (p.cover?.none) return { none: true };
    return null;
  }
  // the institutions to show: OpenAlex's when it has the paper, else the arXiv page's, else Hugging Face's org
  function instOf(p) {
    const list = p.oa?.inst?.length ? p.oa.inst : p.affil?.list?.length ? p.affil.list : p.hf?.org ? [canonical(p.hf.org) || { n: p.hf.org, zh: '', k: 0 }] : [];
    return list.slice(0, 4);
  }
  function card(p, reason) {
    const st = store.state;
    return {
      id: p.id, title: p.title,
      authors: (p.authors || []).slice(0, 3), nAuthors: (p.authors || []).length,
      org: p.hf?.org || '', inst: instOf(p), q: qualityOf(p.id), qp: ratePending(p.id), published: p.published || '',
      topics: p.topics || [], survey: !!p.survey, venue: venueOf(p),
      up: p.hf?.upvotes || 0, stars: p.hf?.stars || 0,
      cover: coverOf(p),
      liked: !!st.likes[p.id], saved: !!st.saves[p.id], opened: !!st.opened[p.id], noted: !!st.notes[p.id],
      hasTake: !!store.takes[p.id],
      title_zh: store.translations[p.id]?.title || '',
      reason: reason?.id ? { ...reason, title_zh: store.translations[reason.id]?.title || '' } : reason || null,
    };
  }
  // the swipe feed shows the abstract on the card itself
  function fullCard(p, reason) {
    return { ...card(p, reason), authors: (p.authors || []).slice(0, 8), abstract: p.abstract || '', abstract_zh: zhAbs(store.translations[p.id]?.abstract), caption: p.cover?.caption || '' };
  }
  function status() {
    return { count: Object.keys(store.papers).length, lastFetch: store.state.meta.lastFetch, fetching: !!fetching, progress };
  }

  // ---------- fetching ----------
  // Every direction is also read further back, one older page (100 papers) per look, until its pages reach
  // papers older than BACK_DAYS. Without that, the pool is only the newest few weeks, and a reader who
  // swipes a lot runs out of papers they have not seen.
  const BACK_DAYS = 150;
  const VENUES_V = 1; // bump to look through every direction's accepted papers again
  function backfillPlan() {
    const b = store.state.meta.backfill || {};
    if (Object.keys(store.papers).length >= maxPool) return null;
    const plan = {};
    for (const t of TOPICS) if (!b[t.id]?.done) plan[t.id] = b[t.id]?.start ?? 60;
    return Object.keys(plan).length ? plan : null;
  }
  function onCursor(topicId, papers) {
    const b = { ...(store.state.meta.backfill || {}) };
    const cur = b[topicId] || { start: 60 };
    const oldest = papers.reduce((m, p) => (p.published && p.published < m ? p.published : m), '9999');
    const tooOld = oldest < new Date(Date.now() - BACK_DAYS * 864e5).toISOString().slice(0, 10);
    b[topicId] = { start: cur.start + papers.length, done: !papers.length || tooOld, oldest: oldest === '9999' ? cur.oldest : oldest };
    store.setMeta({ backfill: b });
  }
  // only: 'backfill' — just the older pages (asked for when a reader is running out of unseen papers)
  function refresh({ force = false, only = '' } = {}) {
    if (fetching) return;
    const meta = store.state.meta;
    const firstRun = !meta.lastFetch;
    if (only === 'backfill' && !backfillPlan()) return;
    const deep = !only && (force || firstRun || Date.now() - (meta.lastDeep || 0) > 7 * 864e5);
    const venuesDeep = !only && (deep || (meta.venuesV || 0) < VENUES_V);
    let batches = 0;
    fetching = fetchAll({
      firstRun,
      deepSurveys: deep,
      venues: only ? '' : venuesDeep ? 'deep' : 'recent',
      backfill: firstRun ? null : backfillPlan(),
      only,
      onCursor,
      onBatch: (papers, label) => {
        const added = store.upsert(papers);
        send('feed:batch', { added, label, count: Object.keys(store.papers).length });
        if (++batches === 4) prefetchCovers(); // start on figures for the top picks early
      },
      onProgress: (p) => { progress = { ...p, finished: false }; send('feed:progress', progress); },
    }).then(() => {
      store.prune(200, (p) => !!venueOf(p)); // accepted papers stay for longer
      if (!only) store.setMeta({ lastFetch: Date.now(), ...(deep ? { lastDeep: Date.now() } : {}), ...(venuesDeep ? { venuesV: VENUES_V } : {}) });
      store.flush();
      prefetchCovers();
      if (!only) setTimeout(runEnrich, 5000);
    }).catch((e) => console.error('[feed] refresh failed:', e.message))
      .finally(() => {
        fetching = null;
        progress = { ...progress, finished: true };
        send('feed:progress', progress);
      });
  }

  // ---------- figure covers: newest request first, three workers ----------
  const COVER_V = 2; // 2: captions keep their formulas
  const coverWanted = [];
  const coverSet = new Set();
  let coverWorkers = 0;
  function wantCovers(ids, { front = true } = {}) {
    // The end of coverWanted is served first. Cards on screen jump the queue, even if a background
    // prefetch already queued them; prefetches go to the back in rank order.
    for (const id of ids) {
      const p = store.papers[id];
      if (!p || (p.cover && p.affil)) continue;
      if (coverSet.has(id)) {
        if (!front) continue;
        coverWanted.splice(coverWanted.indexOf(id), 1);
      }
      coverSet.add(id);
      if (front) coverWanted.push(id); else coverWanted.unshift(id);
    }
    for (let i = 0; i < 3; i++) pumpCovers();
  }
  async function pumpCovers() {
    if (coverWorkers >= 3) return;
    coverWorkers++;
    while (coverWanted.length) {
      const id = coverWanted.pop();
      coverSet.delete(id);
      const p = store.papers[id];
      if (!p || (p.cover && p.affil)) continue;
      try {
        const fig = await findFigure(id);
        // the author block of the same page: the paper's institutions (OpenAlex's, when they come, take over)
        if (!p.affil || p.affil.src === 'html') store.setAffil(id, { list: fig?.affil || [], src: 'html', t: Date.now() });
        if (!p.cover) store.setCover(id, fig?.url ? { url: fig.url, w: fig.w, h: fig.h, caption: fig.caption, v: COVER_V, t: Date.now() } : { none: true, t: Date.now() });
      } catch (e) {
        // network trouble: leave it unknown so it is retried later
        if (debug) console.error('[feed] cover failed', id, e.message);
        continue;
      }
      send('feed:cover', { id, cover: coverOf(store.papers[id]), caption: store.papers[id].cover?.caption || '', inst: instOf(store.papers[id]) });
    }
    coverWorkers--;
  }
  // Covers found before 1.4.2 lost the formulas in their captions; the caption is read again
  // (once per run) when such a paper is opened.
  const recaptioned = new Set();
  function recaption(id) {
    const p = store.papers[id];
    if (!p?.cover?.url || p.cover.v >= COVER_V || recaptioned.has(id)) return;
    recaptioned.add(id);
    const t0 = Date.now();
    findFigure(id, { urgent: true }).then((fig) => {
      const q = store.papers[id];
      if (debug) console.error(`[feed] recaption ${id} ${Date.now() - t0}ms ${fig ? 'ok' : 'no figure'}`);
      if (!fig?.url || !q?.cover?.url) return;
      store.setCover(id, { ...q.cover, caption: fig.caption, v: COVER_V });
      send('feed:cover', { id, cover: coverOf(q), caption: fig.caption });
    }).catch((e) => { if (debug) console.error('[feed] recaption failed', id, e.message); });
  }
  function prefetchCovers() {
    const items = rec.peek({ mode: 'foryou', topic: '', query: '', collection: '' }, 40);
    wantCovers(items.map((p) => p.id), { front: false });
  }

  // ---------- IPC ----------
  function boards() {
    const st = store.state;
    const saves = Object.values(st.saves);
    return {
      collections: st.collections.map((c) => ({ ...c, n: saves.filter((s) => s.cols.includes(c.id)).length })),
      savedTotal: saves.length,
      likedTotal: Object.keys(st.likes).length,
    };
  }
  handle('feed:meta', () => ({
    topics: TOPICS.map(({ id, en, zh, color }) => ({ id, en, zh, color })),
    palette: PALETTE,
    ...boards(),
    interests: store.state.interests,
    status: status(),
  }));
  handle('feed:boards', () => boards());
  handle('feed:status', () => status());
  handle('feed:list', (params = {}) => {
    const t0 = Date.now();
    const { items, reasons, total, deck, dropped, basis, offset, unseenLeft } = rec.page({ mode: 'foryou', offset: 0, limit: 30, ...params });
    // what "For you" and "Recommended" have shown is held back from the next few refreshes
    const mode = params.mode || 'foryou';
    if ((mode === 'foryou' || mode === 'recommended') && !params.query) store.markSeen(items.map((p) => p.id));
    if (mode !== 'saved' && mode !== 'liked') wantRatings(items.map((p) => p.id));
    if (dropped?.length) store.unmarkSeen(dropped);
    // running out of papers this reader has not seen: read further back (at most every 10 minutes)
    if (unseenLeft != null && unseenLeft < 120 && !params.query && Date.now() - lastMore > 10 * 60e3) { lastMore = Date.now(); refresh({ only: 'backfill' }); }
    if (debug) console.error(`[feed] list ${mode} offset=${params.offset}${params.fresh ? ' fresh' : ''}${params.keep ? ` keep=${params.keep.length} dropped=${dropped.length}` : ''} deck=${deck} ${Date.now() - t0}ms`);
    return {
      items: items.map((p) => (params.withAbstract ? fullCard : card)(p, reasons.get(p.id))), total, deck, offset,
      basis: basis?.map((b) => ({ ...b, title_zh: store.translations[b.id]?.title || '' })),
    };
  });
  handle('feed:get', (id) => {
    const p = store.papers[id];
    if (!p) return null;
    recaption(id);
    wantRatings([id]);
    const st = store.state;
    return {
      paper: {
        ...card(p), authors: p.authors || [], abstract: p.abstract || '', updated: p.updated || '',
        categories: p.categories || [], primary: p.primary || '', comment: p.comment || '',
        github: p.hf?.github || '', comments: p.hf?.comments || 0,
        caption: p.cover?.caption || '',
        abstract_zh: zhAbs(store.translations[id]?.abstract),
        links: { abs: `https://arxiv.org/abs/${p.id}`, pdf: `https://arxiv.org/pdf/${p.id}`, html: `https://arxiv.org/html/${p.id}`, hf: `https://huggingface.co/papers/${p.id}` },
      },
      cols: st.saves[id]?.cols || [],
      note: st.notes[id]?.text || '',
      similar: rec.similar(id, 8).map((x) => card(x)),
      quality: qualityFor(id),
    };
  });
  handle('feed:act', (id, action, payload) => {
    if (!store.papers[id]) return null;
    store.act(id, action, payload); // a hidden card leaves the page; the next deck leaves it out
    return { ...card(store.papers[id]), cols: store.state.saves[id]?.cols || [] };
  });
  handle('feed:collections', (op, a, b) => {
    if (op === 'add') { const id = store.addCollection(a); return { ...boards(), created: id }; }
    if (op === 'rename') store.renameCollection(a, b);
    if (op === 'delete') store.deleteCollection(a);
    return boards();
  });
  handle('feed:interests', (text) => { store.setInterests(text); rec.invalidate(); return store.state.interests; });
  // The Refresh button deals a new deck (feed:list with fresh); here it also looks for new papers on
  // arXiv / Hugging Face when the last look is over an hour old. They join the next deck.
  handle('feed:refresh', () => {
    if (Date.now() - (store.state.meta.lastFetch || 0) > 3600e3) refresh();
    return status();
  });
  // ---------- AI takes (DeepSeek by default, Claude optional) ----------
  const running = new Map(); // `${id}|${lang}:${mode}` -> { abort }
  // full paper texts downloaded this run (null = arXiv has no HTML version), shared by Deep read and questions
  const fullTexts = new Map();
  const rememberFull = (id, text) => {
    if (fullTexts.size >= 24) fullTexts.delete(fullTexts.keys().next().value);
    fullTexts.set(id, text);
    return text;
  };
  const DS = providers.deepseek, CL = providers.claude || null;
  const DEEPSEEK_DEFAULTS = DS.defaults;
  const aiSettings = () => {
    const a = store.state.ai || {};
    return { provider: a.provider === 'claude' && CL ? 'claude' : 'deepseek', baseUrl: a.baseUrl || DEEPSEEK_DEFAULTS.baseUrl, model: a.model || DEEPSEEK_DEFAULTS.model };
  };
  const keyFor = (provider) => keys.get(provider) || envKey(provider) || '';
  const keyInfo = (provider) => {
    const own = keys.get(provider), key = keyFor(provider);
    return { hasKey: !!key, hint: key ? (keys.hint ? keys.hint(provider) : `…${key.slice(-4)}`) : '', fromEnv: !own && !!key };
  };
  const aiInfo = () => {
    const s = aiSettings();
    const current = keyInfo(s.provider);
    return {
      provider: s.provider,
      hasKey: current.hasKey,
      label: s.provider === 'claude' ? CL.model : `DeepSeek · ${s.model}`,
      providers: CL ? ['deepseek', 'claude'] : ['deepseek'],
      deepseek: { ...keyInfo('deepseek'), baseUrl: s.baseUrl, model: s.model },
      claude: CL ? { ...keyInfo('claude'), model: CL.model } : { hasKey: false, hint: '', fromEnv: false, model: '' },
      context: store.state.aiContext || '',
      rate: { ...rateSettings(), spentToday: rateSpentToday() },
    };
  };
  // the open paper's score, with what it rests on
  function qualityFor(id) {
    const q = qualityMap().get(id);
    if (!q) return null;
    const e = q.e;
    return {
      score: q.score, venue: e.venue ? { label: e.venue.label, note: e.venue.note } : null, inst: e.inst, h: e.h, up: e.up, stars: e.stars,
      cites: e.cites, code: e.code, ai: e.ai, aiModel: store.ratings[id]?.m || '', pending: ratePending(id),
    };
  }

  // ---------- OpenAlex: citations, institutions and the authors' record (free; in the background) ----------
  let enriching = false;
  async function runEnrich() {
    if (enriching) return;
    const list = oaDue(Object.values(store.papers), Date.now(), maxPool > 5000 ? 400 : 200);
    if (!list.length) return;
    enriching = true;
    try { await enrich(list, (id, oa) => store.setOpenAlex(id, oa)); } catch (e) { if (debug) console.error('[feed] OpenAlex', e.message); }
    finally { enriching = false; store.flush(); }
  }

  // ---------- the AI judge: papers on their way to the screen, ten per request, once each, within a daily budget ----------
  const rateSettings = () => { const r = store.state.ai?.rate || {}; return { on: r.on !== false, cap: Number.isFinite(+r.cap) && +r.cap >= 0 ? +r.cap : 0.2 }; };
  // what the judge spent today, in yuan (a Claude call, billed in dollars, at about 7.1 yuan)
  function rateSpentToday() {
    const day = new Date().toDateString();
    return (store.state.usage?.log || []).reduce((s, e) => (e.k === 'rate' && new Date(e.t).toDateString() === day ? s + (e.CNY ?? (e.USD || 0) * 7.1) : s), 0);
  }
  const rateQueue = new Set(), rateBusy = new Set();
  let rateTimer = 0, rating = false;
  // the judge has this paper in hand (queued or in a request), and it has no score yet: the page shows "scoring"
  const ratePending = (id) => !store.ratings[id] && (rateQueue.has(id) || rateBusy.has(id)) && qualityOf(id) == null;
  // papers the judge let go of without a rating (an error, the budget): the page stops showing "scoring"
  const letGo = (ids) => { if (ids.length) send('feed:quality', { scores: {}, unrated: ids }); };
  function wantRatings(ids) {
    const r = rateSettings();
    if (!r.on || !keyFor(aiSettings().provider) || rateSpentToday() >= r.cap || overLimit()) return;
    for (const id of ids) if (store.papers[id] && !store.ratings[id]) rateQueue.add(id);
    clearTimeout(rateTimer);
    if (rateQueue.size) rateTimer = setTimeout(flushRatings, rateQueue.size >= 10 ? 300 : 2500);
  }
  async function flushRatings() {
    if (rating) return;
    rating = true;
    try {
      while (rateQueue.size) {
        if (!rateSettings().on || rateSpentToday() >= rateSettings().cap) { const left = [...rateQueue]; rateQueue.clear(); letGo(left); break; }
        const batch = [...rateQueue].slice(0, 10);
        batch.forEach((id) => { rateQueue.delete(id); rateBusy.add(id); });
        const papers = batch.map((id) => store.papers[id]).filter((p) => p && !store.ratings[p.id]);
        if (!papers.length) { batch.forEach((id) => rateBusy.delete(id)); continue; }
        let got = {};
        try {
          const text = await complete({ system: RATING_SYSTEM, user: ratingPrompt(papers), maxTokens: 500 }, 'rate');
          got = parseRatings(text, papers.map((p) => p.id));
        } catch (e) {
          if (debug) console.error('[feed] rating', e.message);
          const left = [...batch, ...rateQueue];
          batch.forEach((id) => rateBusy.delete(id)); rateQueue.clear(); letGo(left);
          break;
        }
        batch.forEach((id) => rateBusy.delete(id));
        letGo(batch.filter((id) => !got[id]));
        const s = aiSettings(), t = Date.now();
        const model = s.provider === 'claude' ? CL.model : s.model;
        store.setRatings(Object.fromEntries(Object.entries(got).map(([id, sc]) => [id, { s: sc, m: model, v: RATING_V, t }])));
        if (Object.keys(got).length) {
          quality.at = 0; // score them again now
          send('feed:quality', { scores: Object.fromEntries(Object.keys(got).map((id) => [id, qualityOf(id)])) });
        }
      }
    } finally { rating = false; }
  }
  // off-peak (half price) and with budget to spare: the newest papers nobody has rated yet, thirty at a time
  setInterval(() => {
    const r = rateSettings();
    if (!r.on || deepseekPeak() || !keyFor(aiSettings().provider) || rateSpentToday() > r.cap * 0.6) return;
    const cut = Date.now() - 21 * 864e5;
    const fresh = Object.values(store.papers).filter((p) => !store.ratings[p.id] && Date.parse(p.published || 0) > cut)
      .sort((a, b) => (b.published || '').localeCompare(a.published || '')).slice(0, 30);
    wantRatings(fresh.map((p) => p.id));
  }, 30 * 60e3);

  // ---------- a ceiling on this app's AI spending over the last seven days (off unless the reader sets it) ----------
  // in yuan (a Claude call, billed in dollars, at about 7.1); once reached, the app makes no more AI calls until
  // older spending drops out of the seven days, or the reader raises or turns off the limit
  const limitSettings = () => { const l = store.state.ai?.limit || {}; return { on: !!l.on, cap: Number.isFinite(+l.cap) && +l.cap > 0 ? +l.cap : 5 }; };
  function spent7() {
    const from = Date.now() - 7 * 864e5;
    return (store.state.usage?.log || []).reduce((s, e) => (e.t > from ? s + (e.CNY ?? (e.USD || 0) * 7.1) : s), 0);
  }
  const overLimit = () => { const l = limitSettings(); return l.on && spent7() >= l.cap; };
  const limitError = () => ({ code: 'limit', message: `¥${limitSettings().cap}` });
  const limitInfo = () => ({ ...limitSettings(), spent7: Math.round(spent7() * 10000) / 10000 });

  // ---------- the usage meter: every call's tokens and cost, and the DeepSeek balance ----------
  function recordUsage(provider, model, kind, usage) {
    if (!usage) return;
    const t = Date.now();
    const c = costOf(provider, model, usage, t);
    store.addUsage({ t, p: provider, m: model || '', k: kind, hit: c.hit, miss: c.miss, out: c.out, CNY: c.CNY, USD: c.USD });
    send('feed:usage', { t });
  }
  const httpFetch = providers.fetch || ((url, init) => fetch(url, init));
  // DeepSeek's own figure for the key's balance (GET /user/balance); each reading is kept, so spending from the
  // same key outside the app can be estimated
  handle('feed:balance', async () => {
    const s = aiSettings();
    const apiKey = keyFor('deepseek');
    if (!apiKey) return { error: { code: 'nokey' } };
    try {
      const res = await httpFetch(`${String(s.baseUrl || DEEPSEEK_DEFAULTS.baseUrl).replace(/\/+$/, '')}/user/balance`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return { error: DS.classify(Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })) };
      const j = await res.json();
      const infos = (j.balance_infos || []).map((b) => ({ currency: b.currency, total: +b.total_balance || 0, granted: +b.granted_balance || 0, toppedUp: +b.topped_up_balance || 0 }));
      const main = infos.find((b) => b.currency === 'CNY') || infos[0];
      if (!main) return { error: { code: 'api', message: 'no balance in the reply' } };
      const reading = { t: Date.now(), ...main, available: !!j.is_available };
      store.addBalance(reading);
      return { ...reading, others: infos.filter((b) => b !== main) };
    } catch (e) { return { error: DS.classify(e) }; }
  });
  handle('feed:usage', (opts = {}) => ({
    ...usageSummary(store.state.usage || {}, { days: Math.min(90, Math.max(7, +opts.days || 30)) }),
    provider: aiSettings().provider, hasKey: !!keyFor('deepseek'), limit: limitInfo(),
  }));

  handle('feed:ai', (patch) => {
    if (patch?.provider) store.setAi({ provider: patch.provider === 'claude' && CL ? 'claude' : 'deepseek' });
    if (patch && 'key' in patch) keys.set(patch.keyProvider === 'claude' && CL ? 'claude' : 'deepseek', patch.key);
    if (patch && ('baseUrl' in patch || 'model' in patch)) {
      const next = {};
      if ('baseUrl' in patch) next.baseUrl = String(patch.baseUrl || '').trim() || DEEPSEEK_DEFAULTS.baseUrl;
      if ('model' in patch) next.model = String(patch.model || '').trim() || DEEPSEEK_DEFAULTS.model;
      store.setAi(next);
    }
    if (patch && 'context' in patch) store.setAiContext(String(patch.context || '').trim());
    if (patch?.rate) store.setAi({ rate: { ...rateSettings(), ...patch.rate } });
    if (patch?.limit) {
      const l = { ...limitSettings(), ...patch.limit };
      store.setAi({ limit: { on: !!l.on, cap: Math.min(10000, Math.max(0.1, Math.round((+l.cap || 5) * 100) / 100)) } });
      send('feed:usage', { t: Date.now() });
    }
    return aiInfo();
  });
  handle('feed:take:get', (id) => store.takes[id] || {});
  handle('feed:take:stop', (id, key) => { running.get(`${id}|${key}`)?.abort(); return true; });
  handle('feed:take:run', async (id, mode, lang) => {
    const p = store.papers[id];
    if (!p) return { error: { code: 'unknown', message: 'paper not found' } };
    const settings = aiSettings();
    const apiKey = keyFor(settings.provider);
    if (!apiKey) return { error: { code: 'nokey' } };
    if (overLimit()) return { error: limitError() };
    const classify = settings.provider === 'claude' ? CL.classify : DS.classify;
    mode = mode === 'deep' ? 'deep' : 'quick';
    lang = lang === 'zh' ? 'zh' : 'en';
    const key = `${lang}:${mode}`;
    const slot = `${id}|${key}`;
    if (running.has(slot)) return { started: true };
    let cancelled = false;
    running.set(slot, { abort: () => { cancelled = true; } });
    (async () => {
      let fullText = null;
      if (mode === 'deep') {
        send('feed:take', { id, key, stage: 'fetching' });
        try { fullText = fullTexts.has(id) ? fullTexts.get(id) : rememberFull(id, await fetchFullText(id)); } catch { fullText = null; }
        if (cancelled) throw Object.assign(new Error('stopped'), { code: 'stopped' });
      }
      send('feed:take', { id, key, stage: 'thinking' });
      const args = {
        apiKey, mode,
        system: systemPrompt(lang, store.state.aiContext, mode),
        user: userPrompt(p, fullText),
        onText: (delta) => send('feed:take', { id, key, delta }),
      };
      const job = settings.provider === 'claude'
        ? CL.summarize(args)
        : DS.summarize({ ...args, baseUrl: settings.baseUrl, model: settings.model });
      running.set(slot, job);
      const res = await job.done;
      recordUsage(res.provider, res.model, 'take', res.usage);
      const { usage: _u, ...kept } = res;
      const take = { ...kept, mode, abstractOnly: mode === 'deep' && !fullText, t: Date.now() };
      store.setTake(id, key, take);
      send('feed:take', { id, key, done: true, take });
    })()
      .catch((err) => send('feed:take', { id, key, error: err?.code === 'stopped' || err?.code === 'nokey' ? { code: err.code } : classify(err) }))
      .finally(() => running.delete(slot));
    return { started: true };
  });

  // ---------- questions about a paper: asked directly, or as follow-ups on its take ----------
  const chatRuns = new Map(); // id -> { abort } while an answer is being written
  const MAX_PAPER_CHARS = 200000; // about 50k tokens
  const MAX_TURNS = 12; // earlier questions drop out of the context, the paper stays
  // A question should not wait long for the paper: one try, 25 s. After a failure the paper is not
  // asked for again for 10 minutes, so follow-ups are answered from the abstract right away.
  const fullFailed = new Map(); // id -> time of the last failed download
  async function paperText(id) {
    if (fullTexts.has(id)) return fullTexts.get(id);
    if (Date.now() - (fullFailed.get(id) || 0) < 10 * 60e3) return null;
    try { return rememberFull(id, await fetchFullText(id, { tries: 1, timeout: 25000 })); } catch { fullFailed.set(id, Date.now()); return null; }
  }
  const latestTake = (id) => Object.values(store.takes[id] || {}).filter((x) => x?.text).sort((a, b) => (b.t || 0) - (a.t || 0))[0] || null;

  handle('feed:chat:get', (id) => store.chats[id] || []);
  handle('feed:chat:stop', (id) => { chatRuns.get(id)?.abort(); return true; });
  handle('feed:chat:clear', (id) => { chatRuns.get(id)?.abort(); store.clearChat(id); return []; });
  handle('feed:chat:ask', (id, question, lang) => {
    const p = store.papers[id];
    question = String(question || '').trim().slice(0, 4000);
    if (!p || !question) return { error: { code: 'unknown', message: 'empty question' } };
    const settings = aiSettings();
    const apiKey = keyFor(settings.provider);
    if (!apiKey) return { error: { code: 'nokey' } };
    if (overLimit()) return { error: limitError() };
    if (chatRuns.has(id)) return { started: true };
    const classify = settings.provider === 'claude' ? CL.classify : DS.classify;
    lang = lang === 'zh' ? 'zh' : 'en';
    let cancelled = false;
    chatRuns.set(id, { abort: () => { cancelled = true; } });
    (async () => {
      if (!fullTexts.has(id) && !(Date.now() - (fullFailed.get(id) || 0) < 10 * 60e3)) send('feed:chat', { id, stage: 'fetching' });
      const full = await paperText(id);
      if (cancelled) throw Object.assign(new Error('stopped'), { code: 'stopped' });
      send('feed:chat', { id, stage: 'thinking' });
      // the paper (plus the newest take, if any) opens the conversation; earlier questions and answers follow
      const paper = chatPaper(p, full ? full.slice(0, MAX_PAPER_CHARS) : null, latestTake(id)?.text || '');
      const turns = [...(store.chats[id] || []).slice(-2 * MAX_TURNS), { role: 'user', text: question }];
      const messages = turns.map((m, i) => {
        if (i > 0) return { role: m.role, content: m.text };
        return settings.provider === 'claude'
          ? { role: 'user', content: [{ type: 'text', text: paper, cache_control: { type: 'ephemeral' } }, { type: 'text', text: m.text }] }
          : { role: 'user', content: `${paper}\n\n---\n\n${m.text}` };
      });
      const args = { apiKey, system: chatSystem(lang, store.state.aiContext), messages, onText: (delta) => send('feed:chat', { id, delta }) };
      const job = settings.provider === 'claude'
        ? CL.stream({ ...args, effort: 'medium' })
        : DS.stream({ ...args, baseUrl: settings.baseUrl, model: settings.model, effort: 'low' });
      chatRuns.set(id, job);
      const res = await job.done;
      recordUsage(res.provider, res.model, 'chat', res.usage);
      if (!res.text.trim()) throw Object.assign(new Error('empty answer'), { code: 'empty' });
      const t = Date.now();
      const q = { role: 'user', text: question, t };
      const a = { role: 'assistant', text: res.text, t, provider: res.provider, model: res.model, tokens: res.tokens, cost: res.cost };
      if (res.truncated) a.truncated = true;
      if (!full) a.abstractOnly = true;
      store.addChat(id, q, a);
      send('feed:chat', { id, done: true, msgs: [q, a] });
    })()
      .catch((err) => send('feed:chat', {
        id, error: err?.code === 'stopped' ? { code: 'stopped' } : err?.code === 'empty' ? { code: 'unknown', message: err.message } : classify(err),
      }))
      .finally(() => chatRuns.delete(id));
    return { started: true };
  });

  // ---------- translation into Chinese: only what is on screen, cached for good ----------
  const trInFlight = new Set(); // `t:${id}` / `a:${id}`
  // args.onText(delta): the reply as it streams in (translation)
  const complete = (args, kind = 'translate') => {
    if (overLimit()) return Promise.reject(Object.assign(new Error('limit'), { code: 'limit' }));
    const s = aiSettings();
    const apiKey = keyFor(s.provider);
    const onUsage = (usage, model) => recordUsage(s.provider, model || s.model, kind, usage);
    return s.provider === 'claude'
      ? CL.complete({ ...args, apiKey, onUsage })
      : DS.complete({ ...args, apiKey, baseUrl: s.baseUrl, model: s.model, onUsage });
  };
  const trError = (err) => (err?.code === 'limit' ? limitError() : (aiSettings().provider === 'claude' ? CL.classify : DS.classify)(err));

  handle('feed:tr:titles', (ids) => {
    if (!keyFor(aiSettings().provider)) return { error: { code: 'nokey' } };
    if (overLimit()) {
      const cached = {};
      for (const id of (Array.isArray(ids) ? ids : []).slice(0, 40)) { const zh = store.translations[id]?.title; if (zh) cached[id] = zh; }
      return { titles: cached, error: limitError() };
    }
    const cached = {}, todo = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 40)) {
      if (!store.papers[id]) continue;
      const zh = store.translations[id]?.title;
      if (zh) cached[id] = zh;
      else if (!trInFlight.has(`t:${id}`)) todo.push(id);
    }
    // up to 20 titles per request; results arrive as feed:tr events
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      batch.forEach((id) => trInFlight.add(`t:${id}`));
      const input = Object.fromEntries(batch.map((id) => [id, store.papers[id].title.replace(/\s+/g, ' ')]));
      // as the JSON streams in, each title goes to the page the moment it is complete, and the one being written as far as it has got
      const sent = new Set(), lastPart = new Map();
      let acc = '', at = 0;
      const progress = (final) => {
        for (const id of batch) {
          if (sent.has(id)) continue;
          const k = acc.indexOf(`"${id}"`);
          if (k < 0) continue;
          const m = /^\s*:\s*"((?:[^"\\]|\\.)*)("?)/.exec(acc.slice(k + id.length + 2));
          if (!m) continue;
          let v;
          try { v = JSON.parse(`"${m[1].replace(/\\$/, '')}"`); } catch { continue; }
          if (m[2]) {
            sent.add(id);
            if (v.trim()) { store.setTranslation(id, { title: v.trim() }); send('feed:tr', { id, title: v.trim() }); }
          } else if (!final && v && v !== lastPart.get(id)) { lastPart.set(id, v); send('feed:tr', { id, titlePart: v }); }
        }
      };
      const onText = (d) => { acc += d; const now = Date.now(); if (now - at > 45) { at = now; progress(false); } };
      complete({ system: TITLES_SYSTEM, user: JSON.stringify(input, null, 1), maxTokens: 4000, onText })
        .then((text) => {
          acc = text; progress(true);
          const map = parseTitleMap(text);
          for (const id of batch) {
            if (!map[id] || sent.has(id)) continue;
            store.setTranslation(id, { title: map[id] });
            send('feed:tr', { id, title: map[id] });
          }
        })
        .catch((err) => send('feed:tr', { error: trError(err) }))
        .finally(() => batch.forEach((id) => trInFlight.delete(`t:${id}`)));
    }
    return { titles: cached };
  });

  handle('feed:tr:abstract', (id) => {
    const p = store.papers[id];
    if (!p) return { error: { code: 'unknown', message: 'paper not found' } };
    const zh = zhAbs(store.translations[id]?.abstract);
    if (zh) return { abstract: zh };
    if (!keyFor(aiSettings().provider)) return { error: { code: 'nokey' } };
    if (overLimit()) return { error: limitError() };
    if (!trInFlight.has(`a:${id}`)) {
      trInFlight.add(`a:${id}`);
      // the translation so far, at most every 40 ms: the page writes it over the English as it comes
      let acc = '', at = 0;
      const onText = (d) => { acc += d; const now = Date.now(); if (now - at > 40) { at = now; const part = zhAbs(acc, true); if (part) send('feed:tr', { id, abstractPart: part }); } };
      complete({ system: ABSTRACT_SYSTEM, user: `Title: ${p.title}\n\nAbstract:\n${p.abstract}`, maxTokens: 6000, onText })
        .then((text) => {
          const abstract = zhAbs(text);
          if (!abstract) throw new Error('empty translation');
          store.setTranslation(id, { abstract });
          send('feed:tr', { id, abstract });
        })
        .catch((err) => send('feed:tr', { id, abstractError: trError(err) }))
        .finally(() => trInFlight.delete(`a:${id}`));
    }
    return { pending: true };
  });

  handle('feed:covers', (ids) => {
    if (debug) console.error('[feed] covers requested', Array.isArray(ids) ? ids.length : typeof ids);
    if (Array.isArray(ids)) wantCovers(ids.slice(0, 40));
    return true;
  });


  return {
    handlers,
    start() {
      setTimeout(runEnrich, 30000);
      if (Date.now() - (store.state.meta.lastFetch || 0) > 6 * 3600e3) refresh();
      if (Object.keys(store.papers).length) setTimeout(prefetchCovers, 1500);
    },
    flush: () => store.flush(),
    refresh,
    store,
    rec,
  };
}
