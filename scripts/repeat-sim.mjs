// Offline check: does a long reading session show the same paper twice? (developer tool; nothing is written)
//   node scripts/repeat-sim.mjs [papers.json] [--cards 600] [--restart 120] [--modes recommended,foryou]
// Swipes through the swipe feed the way swipe.js asks for cards (Recommended: deal again after every card,
// keeping what is on screen; the other tabs page through a deck), recording a view for every card. Every
// --restart cards the app is opened again (a new deck). Reports how many cards were repeats, and how many
// papers the deck still had unseen when the session ended.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createStoreCore } = await import(pathToFileURL(path.join(ROOT, 'app/feed/store-core.mjs')).href);
const { createRecommender } = await import(pathToFileURL(path.join(ROOT, 'app/feed/recommend.mjs')).href);
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'D:/Research Index Data/feed/papers.json';
const PAPERS = JSON.parse(fs.readFileSync(file, 'utf8'));
const CARDS = +arg('--cards', 600), RESTART = +arg('--restart', 120);
const MODES = arg('--modes', 'recommended,foryou,latest').split(',');
const TOPIC = arg('--topic', '');

function run(mode) {
  let clock = Date.parse('2026-11-10T09:00:00Z');
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    const store = createStoreCore({ papers: structuredClone(PAPERS), state: { interests: 'LLM agents, agentic reinforcement learning, world models' } }, () => {}, { delay: 6e4 });
    const rec = createRecommender(store);
    const live = mode === 'recommended';
    const base = { mode, topic: TOPIC, query: '', collection: '', slot: 'swipe', withAbstract: true, ...(live ? { focusAuto: true, div: 0.6, exploreEvery: 8, anchorCap: 3, capWindow: 3 } : {}) };
    const shown = new Map();
    let repeats = 0, firstRepeat = -1, ends = 0, pool = 0;
    let n = 0;
    const markSeen = (items) => { if (mode === 'foryou' || mode === 'recommended') store.markSeen(items.map((p) => p.id)); };
    while (n < CARDS) {
      // open the app: a new deck
      let res = rec.page({ ...base, offset: 0, limit: 6, fresh: true });
      markSeen(res.items);
      let items = res.items.map((p) => p.id), deck = res.deck, off = items.length, total = res.total;
      pool = Math.max(pool, live ? 0 : total);
      let idx = 0;
      for (; idx < items.length && n < CARDS && idx < RESTART; idx++, n++) {
        const id = items[idx];
        if (shown.has(id)) { repeats++; if (firstRepeat < 0) firstRepeat = n; }
        shown.set(id, (shown.get(id) || 0) + 1);
        clock += 3500;
        store.act(id, 'view', { ms: 3000 });
        if (live) {
          const keep = items.slice(0, Math.min(items.length, idx + 2));
          const r = rec.page({ ...base, offset: keep.length, limit: 4, deck, keep });
          markSeen(r.items);
          if (r.dropped?.length) store.unmarkSeen(r.dropped);
          items = [...keep, ...r.items.map((p) => p.id)];
        } else if (idx >= items.length - 3 && off < total) {
          const r = rec.page({ ...base, offset: off, limit: 6, deck });
          markSeen(r.items);
          off += r.items.length;
          total = r.total;
          const have = new Set(items);
          items.push(...r.items.map((p) => p.id).filter((x) => !have.has(x)));
        }
      }
      if (idx < RESTART && n < CARDS) { ends++; if (ends > 3) break; }
      clock += 20 * 60e3; // twenty minutes later, the app is opened again
    }
    // a repeat before every paper of the tab was shown is a real one
    return { mode, cards: n, repeats, firstRepeat, ends, distinct: shown.size, pool: pool || undefined, repeatBeforeExhausted: firstRepeat >= 0 && (!pool || firstRepeat < pool) };
  } finally { Date.now = realNow; }
}
for (const m of MODES) console.log(JSON.stringify(run(m)));
