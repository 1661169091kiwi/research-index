// Recommender: TF-IDF vectors over title + abstract, a profile built from your interests and
// what you like / save / open / hide (recent actions count more), then diversity re-ranking.
import { venueOf } from './venues.mjs';

const STOP = new Set(`a about above across after again against all also although among an and any are as at be because been before being
between both but by can could did do does doing done due during each either et etc even ever every few for from further had has have having
here how however if in into is it its itself just less many may might more most much must near no nor not of off on once only or other our
out over own per rather same several should since so some such than that the their them then there these they this those through thus to too
toward towards under until up upon us use used uses using very via was we were what when where whether which while who whom why will with
within without would yet you your paper propose proposed proposes present presents introduce introduces introduced show shows shown demonstrate
demonstrates achieve achieves achieved approach approaches method methods result results work works study novel new existing first two three
one significant significantly extensive experiments experimental empirical across including furthermore moreover however additionally
outperform outperforms outperforming state art based framework leverage leverages leveraging enable enables effective effectively
efficient improve improves improved improving performance large language model models llm llms task tasks often key various different
well high higher better best within code available github https com`.split(/\s+/));

// Too broad to explain a recommendation on their own.
const GENERIC = new Set(('learning scaling world training data generation system language reasoning model agent agents task evaluation benchmark multi-turn general '
  + 'really rethinking revisiting beyond understanding simple unified scalable toward large small fast robust adaptive dynamic level aware').split(' '));

const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is') ? w.slice(0, -1) : w);
export function tokens(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/[\s]+/).map((w) => w.replace(/^-+|-+$/g, ''));
  const out = [];
  let prev = '';
  for (const raw of words) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) { prev = ''; continue; }
    const w = stem(raw);
    out.push(w);
    if (prev) out.push(`${prev}_${w}`);
    prev = w;
  }
  return out;
}

const DAY = 864e5;
const ageDays = (p, now) => Math.max(0, (now - Date.parse(p.published || p.updated || 0)) / DAY) || 0;

// Seeded random numbers, so one "deck" of recommendations is reproducible while it is being scrolled.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const newDeckId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// How strongly a paper is held back after it was last shown: just shown → 0.2, two days later → 0.6, a week → ~0.95.
const seenFactor = (t, now) => (t ? 1 - 0.8 * Math.pow(0.5, (now - t) / (2 * DAY)) : 1);
const NOISE = 0.035; // spread of the random shake-up between refreshes (scores are roughly 0–0.5)
const HOUR = 36e5;
const BOUNCE_MS = 3000; // a paper closed within this long was not what you wanted
const SKIP_MS = 900;    // a swipe card left within this long was not what you wanted
const LIVE_MODES = new Set(['recommended']);

function cos(a, b) {
  if (!a || !b) return 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of s) { const w = l.get(k); if (w) dot += v * w; }
  return dot;
}
function normalize(m) {
  let n = 0;
  for (const v of m.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  for (const [k, v] of m) m.set(k, v / n);
  return m;
}
function addInto(target, vec, w) { for (const [k, v] of vec) target.set(k, (target.get(k) || 0) + v * w); }

// qualityOf(id): the paper's quality score, 0–100 (quality.mjs, worked out by the service), or null
export function createRecommender(store, { qualityOf = null } = {}) {
  const qOf = (id) => qualityOf?.(id) ?? null;
  // The TF-IDF index. It is built in full once; after that, papers that arrive are added (and removed ones taken
  // out) without redoing the rest. A full build over a few thousand abstracts takes about a second on a PC and
  // several on a phone, and during a refresh new papers arrive every few seconds: rebuilding each time froze the
  // page whenever you changed tabs. Papers already indexed keep the document frequencies of when they were
  // added, which hardly move; the whole index is rebuilt once the collection has grown by a third.
  //   index: { version, gen (bumped by a full build), removals (count of removal passes), vecs, tfs, df, N, builtN }
  let index = null;
  // One deck per view (mode + direction + search): a list that infinite scroll pages through. A refresh
  // deals a new deck. Papers that arrive while you scroll join the part of the deck you have not reached
  // yet (mergeNew), so nothing already on the page moves.
  const decks = new Map();

  function termFreq(p) {
    const tf = new Map();
    for (const t of tokens(p.title)) tf.set(t, (tf.get(t) || 0) + 3);
    for (const t of tokens(p.abstract)) tf.set(t, (tf.get(t) || 0) + 1);
    return tf;
  }
  const idfOf = (df, N, t) => { const d = df.get(t); return d ? Math.log((N + 1) / (d + 1)) + 1 : 1; };
  function vecOf(tf, df, N) {
    const v = new Map();
    for (const [t, c] of tf) {
      const bigram = t.includes('_');
      if (bigram && !(df.get(t) > 1)) continue; // a word pair no other paper has says nothing
      v.set(t, (1 + Math.log(c)) * idfOf(df, N, t) * (bigram ? 1.4 : 1));
    }
    return normalize(v);
  }
  function ensureIndex() {
    if (index && index.version === store.version) return index;
    const papers = store.papers;
    if (index) {
      const added = [], removed = [];
      for (const id in papers) if (!index.tfs.has(id)) added.push(id);
      for (const id of index.tfs.keys()) if (!papers[id]) removed.push(id);
      const N = index.tfs.size - removed.length + added.length;
      if (N <= index.builtN * 1.33 && added.length + removed.length < 0.25 * Math.max(1, N)) {
        for (const id of removed) {
          for (const t of index.tfs.get(id).keys()) { const d = index.df.get(t) - 1; if (d > 0) index.df.set(t, d); else index.df.delete(t); }
          index.tfs.delete(id);
          index.vecs.delete(id);
        }
        const fresh = added.map((id) => [id, termFreq(papers[id])]);
        for (const [id, tf] of fresh) { index.tfs.set(id, tf); for (const t of tf.keys()) index.df.set(t, (index.df.get(t) || 0) + 1); }
        for (const [id, tf] of fresh) index.vecs.set(id, vecOf(tf, index.df, N));
        if (removed.length) index.removals++;
        index.N = N;
        index.version = store.version;
        return index;
      }
    }
    const df = new Map(), tfs = new Map();
    for (const p of Object.values(papers)) {
      const tf = termFreq(p);
      tfs.set(p.id, tf);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    const N = tfs.size || 1;
    const vecs = new Map();
    for (const [id, tf] of tfs) vecs.set(id, vecOf(tf, df, N));
    index = { version: store.version, gen: (index?.gen || 0) + 1, removals: 0, vecs, tfs, df, N, builtN: N };
    return index;
  }

  function textVec(text, weight = 1) {
    const { df, N } = ensureIndex();
    const v = new Map();
    for (const t of tokens(text)) v.set(t, (v.get(t) || 0) + weight * idfOf(df, N, t));
    return normalize(v);
  }

  function profiles() {
    const { vecs } = ensureIndex();
    const s = store.state, now = Date.now();
    const pos = new Map(), neg = new Map();
    const decay = (t) => Math.pow(0.5, (now - t) / (30 * DAY));
    const seed = textVec(s.interests.split(/[,，;；\n]+/).join(' '));
    let actions = 0;
    for (const [id, t] of Object.entries(s.likes)) if (vecs.has(id)) { addInto(pos, vecs.get(id), 3 * decay(t)); actions++; }
    for (const [id, x] of Object.entries(s.saves)) if (vecs.has(id)) { addInto(pos, vecs.get(id), 4 * decay(x.t)); actions++; }
    for (const [id, x] of Object.entries(s.notes)) if (vecs.has(id)) { addInto(pos, vecs.get(id), 2 * decay(x.t)); actions++; }
    for (const [id, x] of Object.entries(s.opened)) if (vecs.has(id)) { addInto(pos, vecs.get(id), Math.min(2, 0.8 * x.n) * (x.ms != null && x.ms < BOUNCE_MS ? 0.3 : 1) * decay(x.t)); actions++; }
    // cards from the swipe feed: ones you stayed on pull, ones you skipped at once push away a little
    const views = s.views || {};
    const pc = pace(views);
    for (const [id, v] of Object.entries(views)) {
      const p = store.papers[id];
      if (!p || !vecs.has(id)) continue;
      const r = viewReward(v, p, pc);
      if (r > 0.15) { addInto(pos, vecs.get(id), 1.2 * r * decay(v.t)); actions += r > 0.5 ? 1 : 0; }
      else if (r < -0.5) addInto(neg, vecs.get(id), 0.3 * -r * decay(v.t));
    }
    for (const [id, t] of Object.entries(s.hidden)) if (vecs.has(id)) addInto(neg, vecs.get(id), decay(t));
    normalize(pos);
    // your stated interests dominate at first and fade to a steady share as you use the feed
    const seedW = actions < 5 ? 1.6 : actions < 30 ? 0.9 : 0.6;
    const profile = new Map(pos);
    addInto(profile, seed, seedW);
    return { profile: normalize(profile), neg: normalize(neg), seed };
  }

  function score(p, prof, now, maxUp) {
    const v = index.vecs.get(p.id);
    const sim = cos(prof.profile, v);
    const negSim = prof.neg.size ? cos(prof.neg, v) : 0;
    const rec = Math.pow(0.5, ageDays(p, now) / 14);
    const pop = p.hf?.upvotes ? Math.log1p(p.hf.upvotes) / Math.log1p(maxUp) : 0;
    let s = 0.62 * sim + 0.18 * rec + 0.12 * pop + (p.survey ? 0.03 : 0) - 0.3 * negSim;
    const st = store.state;
    if (st.opened[p.id]) s *= 0.55;
    if (st.saves[p.id]) s *= 0.4;
    return { s, sim, rec, pop };
  }

  function reasonFor(p, prof) {
    const { vecs } = index;
    const v = vecs.get(p.id);
    const st = store.state;
    let best = null, bestSim = 0.33;
    for (const id of [...Object.keys(st.saves), ...Object.keys(st.likes)]) {
      if (id === p.id || !vecs.has(id)) continue;
      const c = cos(vecs.get(id), v);
      if (c > bestSim) { bestSim = c; best = id; }
    }
    if (best) return { type: 'because', title: store.papers[best]?.title || '' };
    const terms = [];
    for (const [k, w] of v) {
      const pw = prof.profile.get(k);
      if (!pw || (!k.includes('_') && GENERIC.has(k))) continue;
      terms.push([k, w * pw * (k.includes('_') ? 1.6 : 1)]);
    }
    terms.sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const [k] of terms) {
      const label = k.replace(/_/g, ' ');
      const words = label.split(' ');
      if (picked.some((x) => x.split(' ').some((w) => words.includes(w)))) continue;
      picked.push(label);
      if (picked.length === 2) break;
    }
    if (picked.length && terms[0][1] > 0.004) return { type: 'terms', terms: picked };
    if ((p.hf?.upvotes || 0) >= 20) return { type: 'trending' };
    return null;
  }

  function filterBase(f) {
    const st = store.state;
    return Object.values(store.papers).filter((p) =>
      !st.hidden[p.id] &&
      (!f.topic || p.topics?.includes(f.topic)) &&
      (!f.surveysOnly || p.survey) &&
      (!f.venuesOnly || venueOf(p)) &&
      (!f.minQ || (qOf(p.id) ?? 0) >= f.minQ));
  }

  // In the swipe feed every card is read full screen: one you have swiped past goes behind the ones you have not
  // seen (a list sorted by date or upvotes would otherwise start over at the same cards every time it opens).
  const viewedLast = (list) => {
    const views = store.state.views || {};
    const fresh = [], old = [];
    for (const p of list) (views[p.id] ? old : fresh).push(p);
    return old.length ? [...fresh, ...old] : list;
  };
  function rank({ mode = 'foryou', topic = '', query = '', collection = '', deck = '', slot = '', minQ = 0 }) {
    const ix = ensureIndex();
    const now = Date.now();
    const st = store.state;
    let list;
    const reasons = new Map();

    if (mode === 'saved' && collection === '__liked') {
      list = Object.entries(st.likes).sort((a, b) => b[1] - a[1]).map(([id]) => store.papers[id]).filter(Boolean);
      return { list, reasons };
    }
    if (mode === 'saved') {
      list = Object.entries(st.saves)
        .filter(([, s]) => !collection || s.cols.includes(collection))
        .sort((a, b) => b[1].t - a[1].t)
        .map(([id]) => store.papers[id]).filter(Boolean);
      return { list, reasons };
    }
    if (mode === 'liked') {
      list = Object.entries(st.likes).sort((a, b) => b[1] - a[1]).map(([id]) => store.papers[id]).filter(Boolean);
      return { list, reasons };
    }

    const base = filterBase({ topic, surveysOnly: mode === 'surveys', venuesOnly: mode === 'venues', minQ });
    const maxUp = Math.max(10, ...base.map((p) => p.hf?.upvotes || 0));

    if (query) {
      const q = textVec(query, 1);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      list = base.map((p) => {
        const hay = `${p.title} ${p.abstract} ${(p.authors || []).join(' ')}`.toLowerCase();
        const lexical = words.every((w) => hay.includes(w)) ? 0.35 : 0;
        return { p, s: cos(q, ix.vecs.get(p.id)) + lexical + 0.05 * Math.pow(0.5, ageDays(p, now) / 30) };
      }).filter((x) => x.s > 0.08).sort((a, b) => b.s - a.s).map((x) => x.p);
      return { list, reasons };
    }
    // Latest, Surveys and Top venues (accepted at a top conference or journal): newest first
    if (mode === 'latest' || mode === 'surveys' || mode === 'venues') {
      list = base.sort((a, b) => (b.published || '').localeCompare(a.published || '') || (b.firstSeen || 0) - (a.firstSeen || 0));
      return { list: slot === 'swipe' ? viewedLast(list) : list, reasons };
    }
    if (mode === 'trending') {
      list = base.filter((p) => (p.hf?.upvotes || 0) > 0 && ageDays(p, now) <= 21)
        .sort((a, b) => (b.hf.upvotes - a.hf.upvotes) || (b.published || '').localeCompare(a.published || ''));
      return { list: slot === 'swipe' ? viewedLast(list) : list, reasons };
    }

    // "For you" (optionally within one direction): score, hold back what was shown recently, shake up
    // with a little seeded noise (so every refresh deals a different deck), then diversify with MMR and
    // mix in some exploration.
    const prof = profiles();
    const rand = rng(deck || 'default');
    const gumbel = () => -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, rand()))));
    const seen = st.seen || {}, views = st.views || {};
    const scored = base.map((p) => {
      const x = score(p, prof, now, maxUp);
      // shown lately → held back; swiped past in the swipe feed → only once nothing unseen is left
      const held = seenFactor(seen[p.id], now) * (views[p.id] ? 0.05 : 1);
      return { p, ...x, held, s: x.s * held + NOISE * gumbel() };
    }).sort((a, b) => b.s - a.s);
    const pool = scored.slice(0, 450);
    const poolVecs = pool.map((x) => ix.vecs.get(x.p.id));
    const maxSim = new Float64Array(pool.length); // similarity to anything already picked, updated incrementally
    const taken = new Uint8Array(pool.length);
    const picked = [];
    const used = new Set();
    const medianSim = pool.length ? pool[Math.floor(pool.length / 2)].sim : 0;
    const explore = scored.filter((x) => x.sim < medianSim)
      .map((x) => ({ x, k: (0.6 * x.rec + 0.4 * x.pop) * x.held + 0.08 * gumbel() }))
      .sort((a, b) => b.k - a.k).map((e) => e.x);
    let ei = 0;
    while (picked.length < Math.min(220, pool.length)) {
      if (!topic && picked.length && picked.length % 9 === 8 && ei < explore.length) {
        const x = explore[ei++];
        if (!used.has(x.p.id)) { picked.push(x); used.add(x.p.id); reasons.set(x.p.id, { type: 'explore' }); continue; }
      }
      let bi = -1, bestVal = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (taken[i] || used.has(pool[i].p.id)) continue;
        const val = 0.78 * pool[i].s - 0.22 * maxSim[i];
        if (val > bestVal) { bestVal = val; bi = i; }
      }
      if (bi < 0) break;
      taken[bi] = 1;
      picked.push(pool[bi]);
      used.add(pool[bi].p.id);
      const v = poolVecs[bi];
      for (let i = 0; i < pool.length; i++) {
        if (taken[i]) continue;
        const c = cos(v, poolVecs[i]);
        if (c > maxSim[i]) maxSim[i] = c;
      }
    }
    list = viewedLast([...picked.map((x) => x.p), ...scored.filter((x) => !used.has(x.p.id)).map((x) => x.p)]);
    for (const x of picked.slice(0, 220)) if (!reasons.has(x.p.id)) { const r = reasonFor(x.p, prof); if (r) reasons.set(x.p.id, r); }
    return { list, reasons };
  }

  // ---------- what you did with each paper ----------
  // Grid and detail sheet: opening a paper, time on it, links followed, likes, saves, notes, AI takes,
  // questions. Swipe feed: every card is seen full-screen, so the time it stayed says a lot. Swiping on
  // within a second means "not this"; staying longer than you usually do on a card of that length means
  // interest; coming back to a card means more. Time is measured against your own pace (people skim at
  // very different speeds) and against the card's length (a long abstract takes longer).

  function engagement(id) {
    const st = store.state;
    const o = st.opened[id];
    let e = 0, extra = 0, t = 0;
    if (o) {
      e = o.ms == null ? 1 : Math.min(2.2, Math.max(0.25, Math.log2(1 + o.ms / 10000)));
      if (o.link) extra += 1;
      t = o.t || 0;
    }
    if (st.likes[id]) { extra += 2; t = Math.max(t, st.likes[id]); }
    if (st.saves[id]) { extra += 3; t = Math.max(t, st.saves[id].t || 0); }
    if (st.notes[id]) { extra += 1.5; t = Math.max(t, st.notes[id].t || 0); }
    const tk = store.takes[id];
    if (tk) { extra += 1.2; for (const x of Object.values(tk)) t = Math.max(t, x?.t || 0); }
    const ch = store.chats[id];
    if (ch?.length) { extra += 2; t = Math.max(t, ch[ch.length - 1].t || 0); }
    const bounce = !!o && o.ms != null && o.ms < BOUNCE_MS && !extra;
    return { e: e + extra, t, bounce };
  }

  // About how long a swipe card takes to skim: its title plus the part of the abstract that shows.
  const words = new Map();
  function expectedMs(p) {
    let w = words.get(p.id);
    if (!w) { w = [(p.title.match(/\S+/g) || []).length, ((p.abstract || '').match(/\S+/g) || []).length]; words.set(p.id, w); }
    return 1500 + 260 * Math.min(30, w[0]) + 40 * Math.min(110, w[1]);
  }
  // Your pace: the typical log(time on card / expected time) and its spread, over the cards you did not
  // skip at once. Until there are enough cards, a prior (a bit under half the expected time) fills in.
  function pace(views) {
    const qs = [];
    for (const [id, v] of Object.entries(views)) {
      const p = store.papers[id];
      if (p && v.ms >= SKIP_MS * (v.n || 1)) qs.push(Math.log(v.ms / (v.n || 1) / expectedMs(p)));
    }
    const k = 15, m0 = Math.log(0.45), s0 = 0.65;
    if (!qs.length) return { m: m0, s: s0, n: 0 };
    qs.sort((a, b) => a - b);
    const med = qs[qs.length >> 1];
    const dev = qs.map((q) => Math.abs(q - med)).sort((a, b) => a - b);
    const mad = 1.4826 * dev[dev.length >> 1];
    const n = qs.length;
    return { m: (n * med + k * m0) / (n + k), s: Math.max(0.35, (n * mad + k * s0) / (n + k)), n };
  }
  // -1 (swiped on at once) … 0 (as long as you usually stay) … +1.5 (stayed long and came back)
  function viewReward(v, p, pc) {
    if (v.ms < SKIP_MS * (v.n || 1) && !v.back) return -1;
    const z = (Math.log(Math.max(v.ms, 300) / expectedMs(p)) - pc.m) / pc.s;
    let r = Math.max(-0.8, Math.min(1, 0.55 * z));
    if (v.back) r += 0.5 * Math.min(2, v.back);
    return Math.max(-1, Math.min(1.5, r));
  }

  // Everything the live decks learn from, in one pass:
  //   anc     papers that drew you in (weight = √engagement × recency; the last few count most)
  //   neg     papers you skipped, bounced off or hid (weight = how clearly, × recency)
  //   topics  per research direction: [interest, disinterest] evidence, for the direction sampler
  // Recency is measured both in time and in cards: after twenty quick swipes, a paper from two
  // minutes ago is already old news.
  function signals(now) {
    const st = store.state, { vecs } = ensureIndex();
    const views = st.views || {};
    const pc = pace(views);
    const times = Object.values(views).map((v) => v.t).sort((a, b) => a - b);
    const since = (t) => {
      let lo = 0, hi = times.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; }
      return times.length - lo;
    };
    const ids = new Set([...Object.keys(st.opened), ...Object.keys(st.likes), ...Object.keys(st.saves), ...Object.keys(st.notes),
      ...Object.keys(store.takes), ...Object.keys(store.chats), ...Object.keys(views), ...Object.keys(st.hidden)]);
    const pos = [], neg = [], topics = new Map();
    const bump = (p, a, b, d) => {
      for (const tp of (p.topics?.length ? p.topics : ['_'])) { const x = topics.get(tp) || [0, 0]; x[0] += a * d; x[1] += b * d; topics.set(tp, x); }
    };
    for (const id of ids) {
      const p = store.papers[id];
      if (!p || !vecs.has(id)) continue;
      if (st.hidden[id]) {
        const t = st.hidden[id], age = Math.max(0, now - t);
        neg.push({ id, t, w: 1.5 * (0.5 + 0.5 * Math.pow(0.5, age / (30 * DAY))) });
        bump(p, 0, 2, Math.pow(0.5, age / (14 * DAY)));
        continue;
      }
      const { e, t, bounce } = engagement(id);
      const v = views[id];
      const r = v ? viewReward(v, p, pc) : 0;
      const tt = Math.max(t, v?.t || 0);
      const n = since(tt), age = Math.max(0, now - tt);
      const d = Math.pow(0.5, n / 30) * Math.pow(0.5, age / (7 * DAY));
      const total = e + (r > 0 ? 1.4 * r : 0);
      if (total > 0 && !(bounce && r <= 0)) {
        pos.push({ id, e: total, t: tt, since: n, r });
        bump(p, Math.min(2, total), 0, d);
      } else if (bounce || r < -0.15) {
        const strength = bounce ? 0.5 : -r;
        neg.push({ id, t: tt, w: strength * (0.7 * Math.pow(0.5, age / (0.5 * HOUR)) * Math.pow(0.5, n / 40) + 0.3 * Math.pow(0.5, age / (3 * DAY))) });
        bump(p, 0, strength, d);
      }
    }
    pos.sort((a, b) => b.t - a.t);
    pos.forEach((a, rank) => {
      const age = Math.max(0, now - a.t);
      const short = Math.pow(0.5, age / (0.2 * HOUR)) * Math.pow(0.5, a.since / 15);
      a.w = Math.sqrt(a.e) * (0.6 * short + 0.15 * Math.pow(0.7, rank) + 0.25 * Math.pow(0.5, age / (14 * DAY)));
    });
    const latest = pos.slice(0, 3);
    pos.sort((a, b) => b.w - a.w);
    const anc = pos.slice(0, 30);
    const max = anc[0]?.w || 1;
    for (const a of anc) a.wn = a.w / max;
    neg.sort((a, b) => b.w - a.w);
    return { anc, neg: neg.slice(0, 40), topics, pace: pc, nViews: times.length, latest };
  }

  // Thompson sampling over research directions: each deal draws a plausible interest level for every
  // direction from what you did with it so far. Directions you keep skipping sink, ones you stay on
  // rise, and ones with little evidence sometimes draw high, so they still get a try.
  function normal(rand) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand()); }
  function gamma(k, rand) { // Marsaglia–Tsang, k ≥ 1
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = normal(rand); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function topicSampler(topics, rand) {
    const drawn = new Map();
    const theta = (tp) => {
      if (!drawn.has(tp)) {
        const [a, b] = topics.get(tp) || [0, 0];
        const x = gamma(1 + a, rand), y = gamma(1 + b, rand);
        drawn.set(tp, x / (x + y));
      }
      return drawn.get(tp);
    };
    return (p) => {
      const tps = p.topics?.length ? p.topics : ['_'];
      let s = 0;
      for (const tp of tps) s += theta(tp);
      return s / tps.length;
    };
  }

  // Similarity of one paper to every paper, cached until the paper set changes. Raw TF-IDF cosines
  // are small and vary from paper to paper, so each row is rescaled: 1 = as close as the paper's
  // 15th nearest neighbour (capped at 1.5).
  const refOf = (a) => Math.max(0.05, Float32Array.from(a).sort().reverse()[Math.min(15, a.length - 1)] || 0);
  const rescale = (a, ref = refOf(a)) => {
    for (let i = 0; i < a.length; i++) a[i] = Math.min(1.5, a[i] / ref);
    return a;
  };
  // Papers that arrive are appended to the rows already worked out (with each row's own scale), instead of
  // every row being worked out again; a full rebuild of the index, or a paper removed, starts over.
  // A row is worked out through an inverted index (term -> papers that have it, with their weights): only the
  // papers sharing a term with the anchor are visited, instead of a sparse dot product with every paper.
  let sims = { gen: -1, removals: -1, ids: [], pos: new Map(), byAnchor: new Map(), post: new Map() };
  function post(id, i, ix) {
    for (const [t, w] of ix.vecs.get(id)) {
      let pl = sims.post.get(t);
      if (!pl) sims.post.set(t, (pl = { i: [], w: [] }));
      pl.i.push(i);
      pl.w.push(w);
    }
  }
  function rowFor(v) {
    const a = new Float32Array(sims.ids.length);
    for (const [t, wa] of v) {
      const pl = sims.post.get(t);
      if (!pl) continue;
      const I = pl.i, W = pl.w;
      for (let k = 0; k < I.length; k++) a[I[k]] += wa * W[k];
    }
    return a;
  }
  function syncSims() {
    const ix = ensureIndex();
    if (sims.gen !== ix.gen || sims.removals !== ix.removals) {
      const ids = [...ix.vecs.keys()];
      sims = { gen: ix.gen, removals: ix.removals, ids, pos: new Map(ids.map((id, i) => [id, i])), byAnchor: new Map(), post: new Map() };
      ids.forEach((id, i) => post(id, i, ix));
    } else if (ix.vecs.size !== sims.ids.length) {
      const from = sims.ids.length;
      for (const id of ix.vecs.keys()) if (!sims.pos.has(id)) { const i = sims.ids.length; sims.pos.set(id, i); sims.ids.push(id); post(id, i, ix); }
      for (const [aid, row] of sims.byAnchor) {
        const v = ix.vecs.get(aid);
        if (!v) { sims.byAnchor.delete(aid); continue; }
        const a = new Float32Array(sims.ids.length);
        a.set(row.a);
        for (let i = from; i < sims.ids.length; i++) a[i] = Math.min(1.5, cos(v, ix.vecs.get(sims.ids[i])) / row.ref);
        row.a = a;
      }
    }
    return ix;
  }
  function simsFor(id) {
    const ix = syncSims();
    let row = sims.byAnchor.get(id);
    if (!row) {
      const a = rowFor(ix.vecs.get(id));
      const ref = refOf(a);
      rescale(a, ref);
      if (sims.byAnchor.size > 400) sims.byAnchor.clear();
      row = { a, ref };
      sims.byAnchor.set(id, row);
    }
    return row.a;
  }

  // A candidate scores by its closest anchor (so separate interests stay separate instead of blurring
  // into one average), plus a smaller pull from all anchors together, minus its closeness to what you
  // skipped, plus the sampled interest in its direction. New, popular and survey papers get a nudge.
  function liveScores(params, served, rand, now) {
    const { topic = '' } = params;
    const ix = syncSims(), st = store.state;
    const sig = signals(now);
    const { anc, neg } = sig;
    const rows = anc.map((a) => simsFor(a.id));
    const negRows = neg.map((x) => simsFor(x.id));
    const ids = sims.ids;
    const sumW = anc.reduce((s, a) => s + a.wn, 0) || 1;
    // your written interests only fill in until there is enough reading to go on
    const nEff = anc.reduce((s, a) => s + Math.min(1, a.e), 0);
    const seedW = nEff >= 5 ? 0.08 : anc.length ? 0.4 - 0.064 * nEff : 1;
    const seedVec = textVec(st.interests.split(/[,，;；\n]+/).join(' '));
    const seed = seedW > 0.1 ? rescale(rowFor(seedVec)) : null;
    const topicOf = topicSampler(sig.topics, rand);
    const seen = st.seen || {}, views = st.views || {};
    const gumbel = () => -Math.log(-Math.log(Math.min(1 - 1e-12, Math.max(1e-12, rand()))));
    let maxUp = 10;
    for (const p of Object.values(store.papers)) if ((p.hf?.upvotes || 0) > maxUp) maxUp = p.hf.upvotes;
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], p = store.papers[id];
      if (!p || served.has(id) || st.hidden[id] || st.opened[id] || st.likes[id] || st.saves[id] || views[id]) continue;
      if (topic && !p.topics?.includes(topic)) continue;
      const q = qOf(id);
      if (params.minQ && (q ?? 0) < params.minQ) continue;
      const v = ix.vecs.get(id);
      let top = 0, best = -1, avg = 0;
      for (let k = 0; k < anc.length; k++) {
        const x = anc[k].wn * rows[k][i];
        avg += x;
        if (x > top) { top = x; best = k; }
      }
      avg /= sumW;
      let away = 0;
      for (let k = 0; k < neg.length; k++) { const x = neg[k].w * negRows[k][i]; if (x > away) away = x; }
      const rel = 0.7 * top + 0.3 * avg + (seed ? seedW * 0.6 * seed[i] : 0); // roughly 0–1.3
      const rec = Math.pow(0.5, ageDays(p, now) / 21);
      const pop = p.hf?.upvotes ? Math.log1p(p.hf.upvotes) / Math.log1p(maxUp) : 0;
      const tp = topicOf(p);
      // shown lately: in the grid as firmly as For you (its cards were on screen); in the swipe feed more softly (dealt
      // there is not necessarily read, and what was read is left out above)
      const held = params.slot === 'swipe' ? 0.5 + 0.5 * seenFactor(seen[id], now) : seenFactor(seen[id], now);
      // a better paper (by the quality score) gets a gentle lift; it never outweighs what you are reading
      const s = (rel + 0.12 * rec + 0.08 * pop + (p.survey ? 0.03 : 0) + 0.6 * (tp - 0.5) - 0.6 * away + 0.12 * ((q ?? 50) / 100 - 0.5)) * held + 0.05 * gumbel();
      out.push({ i, p, v, s, rel, rec, pop, tp, held, away, anchor: best >= 0 ? anc[best].id : '', anchorSim: best >= 0 ? rows[best][i] : 0 });
    }
    return { out, anc, sig };
  }

  // Deal `n` more papers onto a live deck: best first, but varied against what was dealt just before,
  // at most 4 per batch from the same anchor, and one in eight from outside your usual reading.
  // params.focus: papers just read (from the page) — the first few cards follow them directly.
  // params.focusAuto (swipe feed): the card you just stayed on gets a follow-up right after the next card.
  function dealLive(r, params, n) {
    const now = Date.now();
    const served = new Set(r.served);
    const { out, anc, sig } = liveScores(params, served, r.rand, now);
    r.basis = anc;
    out.sort((a, b) => b.s - a.s);
    const pool = out.slice(0, 160);
    const { vecs } = ensureIndex();
    const div = params.div ?? 0.5;
    const recent = r.served.slice(-24).map((id) => vecs.get(id)).filter(Boolean);
    const maxSim = pool.map((x) => recent.reduce((m, v) => Math.max(m, cos(v, x.v)), 0));
    const taken = new Uint8Array(pool.length), used = new Set(), perAnchor = new Map();
    // the last few cards dealt count too, so one paper you liked does not take over the swipe feed
    const cap = params.anchorCap || 4;
    for (const id of r.served.slice(-(params.capWindow || 0) || r.served.length)) {
      const why = r.reasons.get(id);
      if (why?.type === 'read' && params.capWindow) perAnchor.set(why.id, (perAnchor.get(why.id) || 0) + 1);
    }
    const g = () => -Math.log(-Math.log(Math.max(1e-12, Math.min(1 - 1e-12, r.rand()))));
    const explore = out.slice(Math.floor(out.length / 3))
      .map((x) => ({ x, k: (0.45 * x.tp + 0.35 * x.rec + 0.2 * x.pop) * x.held + 0.08 * g() }))
      .sort((a, b) => b.k - a.k).map((e) => e.x);
    let ei = 0;
    const batch = [];
    const take = (x, reason) => {
      used.add(x.p.id);
      batch.push(x);
      if (x.anchor) perAnchor.set(x.anchor, (perAnchor.get(x.anchor) || 0) + 1);
      for (let i = 0; i < pool.length; i++) if (!taken[i]) { const c = cos(x.v, pool[i].v); if (c > maxSim[i]) maxSim[i] = c; }
      if (reason) r.reasons.set(x.p.id, reason);
    };
    const readReason = (id) => ({ type: 'read', id, title: store.papers[id]?.title || '' });
    let focus = [...new Set(params.focus || [])].filter((id) => anc.some((a) => a.id === id)).slice(-3).reverse();
    let per = focus.length ? Math.max(2, Math.floor(4 / focus.length)) : 0;
    if (!focus.length && params.focusAuto) {
      // the newest strong signal, if it is one of the last two cards
      const a = sig.latest[0];
      if (a && a.since <= 1 && a.e >= 0.9 && anc.some((x) => x.id === a.id)) { focus = [a.id]; per = 1; }
    }
    for (const fid of focus) {
      if ((perAnchor.get(fid) || 0) >= cap) continue;
      const row = simsFor(fid);
      const picks = out.filter((x) => !used.has(x.p.id) && row[x.i] >= 0.8)
        .map((x) => ({ x, k: row[x.i] + 0.15 * x.rec + 0.3 * (x.held - 1) - 0.4 * x.away + 0.04 * g() }))
        .sort((a, b) => b.k - a.k);
      let got = 0;
      for (const { x } of picks) {
        if (got >= per || batch.length >= n) break;
        if (batch.some((y) => cos(y.v, x.v) > 0.55)) continue; // not two near-copies
        const j = pool.indexOf(x);
        if (j >= 0) taken[j] = 1;
        take(x, readReason(fid));
        got++;
      }
    }
    const every = params.exploreEvery || 8;
    while (batch.length < n) {
      const at = r.served.length + batch.length;
      if ((anc.length || sig.nViews) && !params.topic && at % every === every - 1 && ei < explore.length) {
        const x = explore[ei++];
        if (!used.has(x.p.id)) { take(x, { type: 'explore' }); continue; }
      }
      let bi = -1, bestVal = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (taken[i] || used.has(pool[i].p.id)) continue;
        if (pool[i].anchor && (perAnchor.get(pool[i].anchor) || 0) >= cap && pool.some((y, j) => !taken[j] && y.anchor !== pool[i].anchor)) continue;
        const val = pool[i].s - div * maxSim[i];
        if (val > bestVal) { bestVal = val; bi = i; }
      }
      if (bi < 0) break;
      const x = pool[bi];
      taken[bi] = 1;
      take(x, x.anchor && x.anchorSim >= 0.8 ? readReason(x.anchor) : (x.p.hf?.upvotes || 0) >= 20 ? { type: 'trending' } : null);
    }
    for (const x of batch) r.served.push(x.p.id);
    r.left = out.length - batch.length;
  }

  function pageLive(key, params, offset, limit) {
    let r = decks.get(key);
    if (params.fresh || !r || (params.deck ? r.deck !== params.deck : offset === 0)) {
      const deck = !params.fresh && params.deck ? params.deck : newDeckId();
      r = { deck, live: true, served: [], reasons: new Map(), rand: rng(deck), left: 0, basis: [] };
      decks.set(key, r);
    }
    // After you read something, the page sends back the cards you have already seen; the rest of
    // the deck is dealt again around what you just read.
    // The page's list is the truth: when you swipe faster than cards are dealt, it may hold cards from an
    // earlier deal that the deck has already replaced.
    let dropped = [];
    if (Array.isArray(params.keep)) {
      const keep = params.keep.filter((id, i, a) => store.papers[id] && a.indexOf(id) === i);
      const kept = new Set(keep);
      dropped = r.served.filter((id) => !kept.has(id));
      r.served = keep;
      offset = r.served.length;
    }
    if (offset + limit > r.served.length) dealLive(r, params, offset + limit - r.served.length);
    else r.basis = signals(Date.now()).anc;
    const items = r.served.slice(offset, offset + limit).map((id) => store.papers[id]).filter(Boolean);
    const basis = r.basis.slice().sort((a, b) => b.t - a.t).slice(0, 3).map((a) => ({ id: a.id, title: store.papers[a.id]?.title || '' }));
    return { items, reasons: r.reasons, total: r.served.length + r.left, deck: r.deck, dropped, basis, offset, unseenLeft: r.left };
  }

  // Papers fetched while you page through a deck go into the part you have not been sent yet: in date
  // order at the front of it (Latest, Surveys), by upvotes (Trending), by match (a search), or for
  // "For you" the best of them spread one in every three cards over the next pages.
  function mergeNew(r, params, at) {
    r.version = store.version;
    if (params.mode === 'saved' || params.mode === 'liked') return;
    const have = new Set(r.list.map((p) => p.id));
    const fresh = filterBase({ topic: params.topic, surveysOnly: params.mode === 'surveys', venuesOnly: params.mode === 'venues', minQ: params.minQ }).filter((p) => !have.has(p.id));
    if (!fresh.length) return;
    const now = Date.now();
    let add;
    if (params.query) {
      const ix = ensureIndex();
      const q = textVec(params.query, 1);
      const words = params.query.toLowerCase().split(/\s+/).filter(Boolean);
      add = fresh.map((p) => {
        const hay = `${p.title} ${p.abstract} ${(p.authors || []).join(' ')}`.toLowerCase();
        return { p, s: cos(q, ix.vecs.get(p.id)) + (words.every((w) => hay.includes(w)) ? 0.35 : 0) };
      }).filter((x) => x.s > 0.08).sort((a, b) => b.s - a.s).map((x) => x.p);
    } else if (params.mode === 'latest' || params.mode === 'surveys' || params.mode === 'venues') {
      add = fresh.sort((a, b) => (b.published || '').localeCompare(a.published || '') || (b.firstSeen || 0) - (a.firstSeen || 0));
    } else if (params.mode === 'trending') {
      add = fresh.filter((p) => (p.hf?.upvotes || 0) > 0 && ageDays(p, now) <= 21).sort((a, b) => b.hf.upvotes - a.hf.upvotes);
    } else {
      const prof = profiles();
      let maxUp = 10;
      for (const p of Object.values(store.papers)) if ((p.hf?.upvotes || 0) > maxUp) maxUp = p.hf.upvotes;
      add = fresh.map((p) => ({ p, s: score(p, prof, now, maxUp).s })).sort((a, b) => b.s - a.s).map((x) => x.p);
    }
    if (!add.length) return;
    at = Math.min(at, r.list.length);
    if (params.mode === 'foryou' && !params.query) {
      const best = add.slice(0, 40), rest = add.slice(40);
      const out = [];
      let k = 0;
      for (const p of r.list.slice(at)) {
        if (k < best.length && out.length % 3 === 1) out.push(best[k++]);
        out.push(p);
      }
      r.list = [...r.list.slice(0, at), ...out, ...best.slice(k), ...rest];
    } else r.list.splice(at, 0, ...add);
    for (const p of add) if (!r.reasons.has(p.id)) r.reasons.set(p.id, { type: 'new' });
  }

  // params.fresh → deal a new deck. params.deck → keep paging (or return to) that deck.
  // Neither, at offset 0 → a new deck too (opening the page). params.slot keeps the swipe feed's
  // decks apart from the grid's.
  function page(params) {
    const key = JSON.stringify([params.mode, params.topic, params.query, params.collection, params.slot || '', params.minQ || 0]);
    const offset = params.offset || 0, limit = params.limit || 30;
    if (LIVE_MODES.has(params.mode) && !params.query) return pageLive(key, params, offset, limit);
    let r = decks.get(key);
    if (params.fresh || !r || (params.deck ? r.deck !== params.deck : offset === 0)) {
      const deck = !params.fresh && params.deck ? params.deck : newDeckId();
      r = { ...rank({ ...params, deck }), deck, version: store.version, sent: 0 };
      decks.set(key, r);
    } else if (r.version !== store.version) mergeNew(r, params, Math.max(r.sent || 0, offset));
    r.sent = Math.max(r.sent || 0, Math.min(r.list.length, offset + limit));
    return { items: r.list.slice(offset, offset + limit), reasons: r.reasons, total: r.list.length, deck: r.deck, unseenLeft: unseenAfter(r, offset + limit, params) };
  }

  // How many papers further down a deck this reader has not seen (For you and the swipe feed's lists): when it runs
  // low, the app reads further back (service.mjs).
  function unseenAfter(r, from, params) {
    if (params.mode === 'saved' || params.mode === 'liked' || params.query) return null;
    if (params.slot !== 'swipe' && params.mode !== 'foryou') return null;
    const st = store.state, views = st.views || {}, seen = st.seen || {}, now = Date.now();
    let n = 0;
    for (let i = from; i < r.list.length && n < 400; i++) {
      const id = r.list[i].id;
      if (!views[id] && !(seen[id] && now - seen[id] < 2 * DAY)) n++;
    }
    return n;
  }

  function similar(id, n = 8) {
    const ix = ensureIndex();
    const v = ix.vecs.get(id);
    if (!v) return [];
    const st = store.state;
    return Object.values(store.papers)
      .filter((p) => p.id !== id && !st.hidden[p.id])
      .map((p) => [p, cos(v, ix.vecs.get(p.id))])
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);
  }

  // The first n papers of the current deck for a view, without dealing a new one (for prefetching figures).
  function peek(params, n) {
    const r = decks.get(JSON.stringify([params.mode, params.topic, params.query, params.collection, params.slot || '']));
    return (r || rank({ ...params, deck: 'peek' })).list.slice(0, n);
  }

  return { page, peek, similar, invalidate: () => decks.clear() };
}
