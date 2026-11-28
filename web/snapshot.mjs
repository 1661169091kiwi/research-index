// The web version's head start: when the site is built (GitHub Actions, daily and after each release), the app's own
// fetching code runs here once per discipline pack and saves the newest papers into the site. A first visit then
// shows papers at once (the page reads the snapshot from the site itself) instead of waiting a minute or more for
// its first downloads; the page brings itself up to date in the background later.
//   node web/snapshot.mjs [siteDir] [--packs=ai,materials,lifesci,medicine] [--minutes=8]
// siteDir is the built site (default web/www). Nothing personal goes in: only public papers and when they were fetched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStoreCore } from '../app/feed/store-core.mjs';
import { createFeedService } from '../app/feed/service.mjs';
import { useFetch } from '../app/feed/sources.mjs';
import { usePack, PACKS } from '../app/feed/packs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || d;
const site = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'web', 'www'));
const packs = opt('packs', Object.keys(PACKS).join(',')).split(',').filter((id) => PACKS[id]);
const limitMs = +opt('minutes', 8) * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => fs.writeSync(1, `${line}\n`); // written at once: the script ends with process.exit
// a polite identity for arXiv and Europe PMC
useFetch((url, init = {}) => {
  const { until, ...rest } = init;
  return fetch(url, { ...rest, headers: { ...(rest.headers || {}), 'User-Agent': 'research-index-web-snapshot (+https://github.com/1661169091kiwi/research-index)' } });
});

for (const id of packs) {
  const t0 = Date.now();
  usePack(id);
  const store = createStoreCore({ papers: {}, state: { meta: {} } }, () => {}, { delay: 6e5 });
  const service = createFeedService({ store, keys: { get: () => '' }, send: () => {}, providers: { fetch, deepseek: { defaults: {} } } });
  service.refresh();
  // the fetch, then a little longer for figures (covers) of the top picks and OpenAlex (citations, institutions)
  while (service.handlers['feed:status']().fetching && Date.now() - t0 < limitMs) await sleep(1000);
  await sleep(Math.min(60e3, Math.max(0, limitMs - (Date.now() - t0))));
  const papers = store.papers;
  const n = Object.keys(papers).length;
  if (!n) { say(`snapshot ${id}: no papers (left out)`); continue; }
  const dir = path.join(site, 'assets', 'mobile', 'seed', ...(id === 'ai' ? [] : [id]));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'papers.json'), JSON.stringify(papers));
  // when it was fetched (so the page does not fetch everything again at once), and where reading further back stopped
  const meta = store.state.meta || {};
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ meta: { lastFetch: meta.lastFetch || Date.now(), lastDeep: meta.lastDeep || 0, venuesV: meta.venuesV || 0, backfill: meta.backfill || {} } }));
  const covers = Object.values(papers).filter((p) => p.cover?.url).length;
  say(`snapshot ${id}: ${n} papers, ${covers} with figures, ${Math.round(fs.statSync(path.join(dir, 'papers.json')).size / 1024)} KB, ${Math.round((Date.now() - t0) / 1000)} s`);
}
process.exit(0);
