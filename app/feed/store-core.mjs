// The feed's data: cached papers + what you liked, saved, opened, swiped past, hid and noted.
// Platform-neutral: the desktop app reads and writes JSON files (store.mjs), the phone app uses its
// own file storage. `write(name, data)` is called with only the files that changed.

import { SURVEY_RE, tagTopics } from './topics.mjs';

export const FILES = ['papers', 'state', 'takes', 'translations', 'chats'];

export const freshState = () => ({
  version: 1,
  likes: {},          // id -> time
  saves: {},          // id -> { t, cols: [collectionId] }
  opened: {},         // id -> { t, n, ms?, link? }  (ms: time spent reading, summed)
  views: {},          // id -> { t, ms, n, back? }  cards seen full-screen in the swipe feed (ms: time on screen, summed)
  hidden: {},         // id -> time
  notes: {},          // id -> { text, t }
  collections: [{ id: 'saved', name: '', t: Date.now() }], // name '' = the default board, labelled by the UI
  interests: '',      // what you type under Interests (nothing about you is built into the app)
  aiContext: '',      // "About you and your project" in the AI settings
  meta: { lastFetch: 0, lastDeep: 0 },
});

// data: { papers, state, takes, translations, chats } as loaded (missing ones are fine)
export function createStoreCore(data, write, { delay = 400 } = {}) {
  const papers = data.papers || {};
  const state = { ...freshState(), ...(data.state || {}) };
  if (!state.views) state.views = {};
  const takes = data.takes || {};               // id -> { "en:quick": { text, model, tokens, cost, t }, ... }
  const translations = data.translations || {}; // id -> { title, abstract } in Chinese
  const chats = data.chats || {};               // id -> [{ role: 'user' | 'assistant', text, t, ... }]
  const all = { papers, state, takes, translations, chats };
  let version = 0;    // bumps whenever papers change (lets the recommender cache its index)
  let stateRev = 0;   // bumps whenever what you did changes (lets the recommender cache its model)

  const dirty = new Set();
  let timer = 0;
  const persist = (...names) => {
    for (const n of names.length ? names : ['state']) dirty.add(n);
    if (names.includes('state') || !names.length) stateRev++;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  function flush() {
    clearTimeout(timer);
    if (!dirty.size) return;
    const names = [...dirty];
    dirty.clear();
    try { write(Object.fromEntries(names.map((n) => [n, all[n]]))); }
    catch (e) { console.error('[feed] save failed:', e.message); for (const n of names) dirty.add(n); }
  }

  function upsert(list) {
    let added = 0;
    const now = Date.now();
    for (const p of list) {
      if (!p || !p.id || !p.title) continue;
      const old = papers[p.id];
      if (!old) added++;
      const merged = { ...(old || {}), ...p, firstSeen: old?.firstSeen || now };
      // keep richer fields from earlier sources
      if (old?.hf && !p.hf) merged.hf = old.hf;
      if (old?.hf && p.hf) merged.hf = { ...old.hf, ...p.hf, upvotes: Math.max(old.hf.upvotes || 0, p.hf.upvotes || 0) };
      if (old?.categories?.length && !p.categories?.length) merged.categories = old.categories;
      if (old?.abstract && (!p.abstract || p.abstract.length < old.abstract.length * 0.6)) merged.abstract = old.abstract;
      if (old?.cover) merged.cover = old.cover;
      merged.survey = SURVEY_RE.test(merged.title);
      merged.topics = tagTopics(merged.title, merged.abstract || '');
      papers[p.id] = merged;
    }
    if (list.length) { version++; persist('papers'); }
    return added;
  }

  // papers older than `days` go, unless you did something with them; `longer(p)` ones stay twice as long
  function prune(days = 200, longer = null) {
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const cutoff2 = new Date(Date.now() - 2 * days * 864e5).toISOString().slice(0, 10);
    let removed = 0;
    for (const [id, p] of Object.entries(papers)) {
      const keep = state.likes[id] || state.saves[id] || state.notes[id] || takes[id] || chats[id];
      const pub = p.published || '9999';
      if (!keep && pub < cutoff && (pub < cutoff2 || !longer?.(p))) { delete papers[id]; removed++; }
    }
    if (removed) { version++; persist('papers'); }
    return removed;
  }

  function act(id, action, payload) {
    const now = Date.now();
    switch (action) {
      case 'like': state.likes[id] = now; break;
      case 'unlike': delete state.likes[id]; break;
      case 'save': {
        const col = payload?.collection || 'saved';
        const cur = state.saves[id] || { t: now, cols: [] };
        if (!cur.cols.includes(col)) cur.cols.push(col);
        state.saves[id] = cur;
        break;
      }
      case 'unsave': {
        const col = payload?.collection;
        const cur = state.saves[id];
        if (cur && col) { cur.cols = cur.cols.filter((c) => c !== col); if (!cur.cols.length) delete state.saves[id]; }
        else delete state.saves[id];
        break;
      }
      case 'open': { const o = state.opened[id] || { n: 0 }; state.opened[id] = { ...o, t: now, n: o.n + 1 }; break; }
      // time spent on a paper (sent when you leave it), and whether you followed its links
      case 'dwell': {
        const o = state.opened[id] || { t: now, n: 1 };
        o.ms = Math.min(36e5, (o.ms || 0) + Math.max(0, Math.min(6e5, Number(payload?.ms) || 0)));
        if (payload?.link) o.link = 1;
        state.opened[id] = o;
        break;
      }
      // a card that was on screen in the swipe feed: how long, and whether you came back to it
      case 'view': {
        const ms = Math.max(0, Math.min(6e5, Number(payload?.ms) || 0));
        const o = state.views[id] || { n: 0, ms: 0 };
        state.views[id] = { ...o, t: now, n: o.n + 1, ms: Math.min(36e5, o.ms + ms), ...(payload?.back ? { back: (o.back || 0) + 1 } : {}) };
        trimViews();
        break;
      }
      case 'hide': state.hidden[id] = now; break;
      case 'unhide': delete state.hidden[id]; break;
      case 'note': {
        const text = String(payload?.text || '').slice(0, 20000);
        if (text.trim()) state.notes[id] = { text, t: now }; else delete state.notes[id];
        break;
      }
      default: return false;
    }
    persist('state');
    return true;
  }
  // keeps the swipe history to its newest 4000 cards
  function trimViews() {
    const ids = Object.keys(state.views);
    if (ids.length <= 4400) return;
    ids.sort((a, b) => state.views[a].t - state.views[b].t);
    for (const id of ids.slice(0, ids.length - 4000)) delete state.views[id];
  }

  function addCollection(name) {
    const id = `c${Date.now().toString(36)}`;
    state.collections.push({ id, name: String(name || '').slice(0, 60) || 'Board', t: Date.now() });
    persist('state');
    return id;
  }
  function renameCollection(id, name) {
    const c = state.collections.find((x) => x.id === id);
    if (c && id !== 'saved') { c.name = String(name || '').slice(0, 60) || c.name; persist('state'); }
  }
  function deleteCollection(id) {
    if (id === 'saved') return;
    state.collections = state.collections.filter((c) => c.id !== id);
    for (const [pid, s] of Object.entries(state.saves)) {
      s.cols = s.cols.filter((c) => c !== id);
      if (!s.cols.length) delete state.saves[pid];
    }
    persist('state');
  }

  return {
    papers, state, takes, translations, chats, flush, upsert, prune, act, addCollection, renameCollection, deleteCollection,
    addChat(id, ...msgs) { chats[id] = [...(chats[id] || []), ...msgs]; persist('chats', 'state'); },
    // papers "For you" has put on screen: id -> last time (entries older than 30 days are dropped)
    markSeen(ids) {
      if (!ids.length) return;
      const now = Date.now();
      const seen = state.seen || (state.seen = {});
      for (const id of ids) seen[id] = now;
      if (Object.keys(seen).length > 4000) for (const [id, t] of Object.entries(seen)) if (now - t > 30 * 864e5) delete seen[id];
      dirty.add('state'); clearTimeout(timer); timer = setTimeout(flush, delay); // not a signal: no stateRev bump
    },
    // cards that were dealt but replaced before you scrolled to them
    unmarkSeen(ids) { const seen = state.seen || {}; for (const id of ids) delete seen[id]; if (ids.length) { dirty.add('state'); clearTimeout(timer); timer = setTimeout(flush, delay); } },
    clearChat(id) { delete chats[id]; persist('chats', 'state'); },
    // the AI usage meter: one entry per call (kept for 120 days), and readings of the provider's balance
    addUsage(entry) {
      const u = state.usage || (state.usage = { log: [], balances: [] });
      u.log.push(entry);
      const cut = Date.now() - 120 * 864e5;
      if (u.log[0]?.t < cut) u.log = u.log.filter((e) => e.t >= cut);
      dirty.add('state'); clearTimeout(timer); timer = setTimeout(flush, delay); // not a signal for the recommender
    },
    addBalance(reading) {
      const u = state.usage || (state.usage = { log: [], balances: [] });
      const last = u.balances.at(-1);
      // a reading that says the same as the last one within ten minutes is not kept
      if (last && last.currency === reading.currency && last.total === reading.total && reading.t - last.t < 10 * 60e3) return;
      u.balances.push(reading);
      if (u.balances.length > 400) u.balances = u.balances.slice(-400);
      dirty.add('state'); clearTimeout(timer); timer = setTimeout(flush, delay);
    },
    setTranslation(id, patch) { translations[id] = { ...(translations[id] || {}), ...patch }; persist('translations'); },
    get version() { return version; },
    get stateRev() { return stateRev; },
    setTake(id, key, take) { takes[id] = { ...(takes[id] || {}), [key]: take }; persist('takes', 'state'); },
    setAiContext(text) { state.aiContext = String(text || '').slice(0, 4000); persist('state'); },
    setAi(patch) { state.ai = { ...(state.ai || {}), ...patch }; persist('state'); },
    setInterests(text) { state.interests = String(text || '').slice(0, 2000); version++; persist('state'); },
    setMeta(patch) { Object.assign(state.meta, patch); persist('state'); },
    setCover(id, cover) { if (papers[id]) { papers[id].cover = cover; persist('papers'); } },
  };
}
