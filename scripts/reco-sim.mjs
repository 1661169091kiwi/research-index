// Offline check of the swipe feed's recommender with simulated readers (developer tool; nothing is written).
//   node scripts/reco-sim.mjs [papers.json] [--users 8] [--swipes 200] [--old path/to/old/recommend.mjs]
//
// Each simulated reader has hidden tastes: two favourite research directions and three they dislike.
// On a favourite they stay 8–20 s (sometimes like it), on a neutral paper a few seconds, and most
// disliked ones are swiped past within a second. Halfway through, their favourites change.
// Metric: share of cards from a favourite (and not a disliked) direction, per window of 20 cards.
// --old <recommend.mjs>: also run a previous version of the recommender on the same readers (1.5.0 learned
// from opened papers and likes only, so in a swipe feed it hardly learns).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createStoreCore } = await import(pathToFileURL(path.join(ROOT, 'app/feed/store-core.mjs')).href);
const NEW = (await import(pathToFileURL(path.join(ROOT, 'app/feed/recommend.mjs')).href)).createRecommender;

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:/Research Index Data/feed/papers.json';
const PAPERS = JSON.parse(fs.readFileSync(file, 'utf8'));
const OLD = arg('--old') ? (await import(pathToFileURL(path.resolve(arg('--old'))).href)).createRecommender : null;
const USERS = +arg('--users', 8), SWIPES = +arg('--swipes', 200), SWITCH = Math.floor(SWIPES / 2);

// deterministic randomness
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
const logn = (r, median, sd) => Math.exp(Math.log(median) + sd * gauss(r));

const TOPIC_IDS = [...new Set(Object.values(PAPERS).flatMap((p) => p.topics || []))];
const count = (tp) => Object.values(PAPERS).filter((p) => p.topics?.includes(tp)).length;
// favourites are chosen among directions that are neither tiny nor everywhere ("agents" tags half the corpus)
const N = Object.keys(PAPERS).length;
const CANDIDATES = TOPIC_IDS.filter((tp) => count(tp) > 40 && count(tp) < N * 0.25);

function makeTaste(r) {
  const pick = (k, from) => { const a = from.slice(); const out = []; while (out.length < k && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]); return out; };
  const like = pick(2, CANDIDATES);
  const dislike = pick(3, CANDIDATES.filter((x) => !like.includes(x)));
  return { like, dislike };
}
const affinity = (p, taste, noise) => {
  const tps = p.topics || [];
  const liked = tps.some((x) => taste.like.includes(x)), disliked = tps.some((x) => taste.dislike.includes(x));
  return (liked ? 1 : 0) - (disliked ? 0.6 : 0) + noise;
};
const good = (p, taste) => (p.topics || []).some((x) => taste.like.includes(x)) && !(p.topics || []).some((x) => taste.dislike.includes(x));

function simulate(seed, { createRecommender = NEW, interests = '' } = {}) {
  const r = mulberry(seed);
  let clock = Date.parse('2026-11-09T09:00:00Z');
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const store = createStoreCore({ papers: structuredClone(PAPERS), state: { interests } }, () => {}, { delay: 6e4 });
    const rec = createRecommender(store);
    let taste = makeTaste(r);
    const tastes = [taste];
    const noise = new Map();
    const base = { mode: 'recommended', topic: '', query: '', collection: '', slot: 'swipe', div: 0.6, exploreEvery: 8, focusAuto: true, anchorCap: 3, capWindow: 3 };
    let res = rec.page({ ...base, offset: 0, limit: 6, fresh: true });
    const deck = res.deck;
    let cards = res.items.map((p) => p.id);
    const hits = [];
    for (let k = 0; k < SWIPES; k++) {
      if (k === SWITCH) { taste = makeTaste(r); tastes.push(taste); }
      const id = cards[k];
      if (!id) break;
      const p = store.papers[id];
      if (!noise.has(id)) noise.set(id, 0.25 * gauss(r));
      const a = affinity(p, taste, noise.get(id));
      hits.push(good(p, taste) ? 1 : 0);
      let ms;
      if (a > 0.6) ms = logn(r, 12000, 0.45);
      else if (a > 0.1) ms = logn(r, 3500, 0.45);
      else ms = r() < 0.75 ? logn(r, 600, 0.3) : logn(r, 2200, 0.4);
      clock += ms + 350;
      store.act(id, 'view', { ms });
      if (a > 0.6 && r() < 0.2) store.act(id, 'like');
      if (a > 0.6 && r() < 0.12) { store.act(id, 'open'); store.act(id, 'dwell', { ms: logn(r, 30000, 0.5) }); }
      // the client keeps what was seen plus the next card, and asks for a few more
      const keep = cards.slice(0, k + 2);
      res = rec.page({ ...base, deck, offset: keep.length, limit: 4, keep });
      cards = [...keep, ...res.items.map((x) => x.id)];
    }
    return { hits, tastes, unique: new Set(cards.slice(0, SWIPES)).size };
  } finally { Date.now = realNow; }
}

function windows(hits, w = 20) { const out = []; for (let i = 0; i < hits.length; i += w) out.push(hits.slice(i, i + w).reduce((a, b) => a + b, 0) / Math.min(w, hits.length - i)); return out; }
function run(label, opts) {
  const all = [];
  let unique = 0, t0 = Date.now();
  const baseRates = [];
  for (let u = 0; u < USERS; u++) {
    const s = simulate(1000 + u * 7919, opts);
    all.push(windows(s.hits));
    unique += s.unique;
    const [t1, t2] = s.tastes;
    const rate = (t) => Object.values(PAPERS).filter((p) => good(p, t)).length / N;
    baseRates.push((rate(t1) + rate(t2)) / 2);
  }
  const avg = all[0].map((_, i) => all.reduce((a, x) => a + (x[i] ?? 0), 0) / all.length);
  console.log(`${label.padEnd(26)} ${avg.map((x) => (100 * x).toFixed(0).padStart(4)).join('')}   | no repeats: ${unique === USERS * SWIPES ? 'yes' : `${unique}/${USERS * SWIPES}`} | ${((Date.now() - t0) / USERS / SWIPES).toFixed(1)} ms/swipe`);
  return { avg, base: baseRates.reduce((a, b) => a + b, 0) / baseRates.length };
}

console.log(`${N} papers, ${USERS} simulated readers × ${SWIPES} swipes; favourites change at card ${SWITCH}.`);
console.log(`% of cards from a favourite direction, per 20 cards:`);
console.log(`${''.padEnd(26)} ${Array.from({ length: Math.ceil(SWIPES / 20) }, (_, i) => `${i * 20 + 1}`.padStart(4)).join('')}`);
const a = run('new (learns from swipes)', {});
const b = OLD ? run('previous version', { createRecommender: OLD }) : null;
console.log(`random pick would give about ${(100 * a.base).toFixed(0)}%.`);
const after = (x) => x.avg.slice(SWITCH / 20 + 1).reduce((s, v) => s + v, 0) / (x.avg.length - SWITCH / 20 - 1);
const before = (x) => x.avg.slice(1, SWITCH / 20).reduce((s, v) => s + v, 0) / (SWITCH / 20 - 1);
console.log(`settled share before / after the switch: new ${(100 * before(a)).toFixed(0)}% / ${(100 * after(a)).toFixed(0)}%${b ? `, previous ${(100 * before(b)).toFixed(0)}% / ${(100 * after(b)).toFixed(0)}%` : ''}`);
process.exit(0);
