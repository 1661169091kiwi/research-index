// OpenAlex (openalex.org: free, no key): for each paper, how often it has been cited, its authors' institutions
// (tidy names) and the authors' records (h-index). OpenAlex has an arXiv paper about a week after it appears, so
// only papers older than that are asked for; citations are read again every ten days while a paper is young.
// Requests go out 40 papers at a time (and 50 authors at a time), one every 400 ms. Shared by both apps.
import { httpGet } from './sources.mjs';
import { fromOpenAlex } from './affil.mjs';

const BASE = 'https://api.openalex.org';
const DAY = 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0, chain = Promise.resolve();
// one request at a time, at least 400 ms apart
function queued(url) {
  const run = chain.then(async () => {
    const wait = last + 400 - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await httpGet(url, { as: 'json', tries: 2, timeout: 30000 }); } finally { last = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

// Which papers to ask about now: old enough to be in OpenAlex, and not asked lately.
export function due(papers, now = Date.now(), max = 400) {
  const out = [];
  for (const p of papers) {
    const age = now - Date.parse(p.published || 0);
    if (!(age > 6 * DAY) || age > 400 * DAY) continue;
    const oa = p.oa;
    if (!oa) out.push([0, p]);
    else if (oa.miss) { if (now - oa.t > 4 * DAY && age < 60 * DAY) out.push([1, p]); }
    else if (now - oa.t > 10 * DAY && age < 180 * DAY) out.push([2, p]);
  }
  // first the ones never asked about, newest first
  out.sort((a, b) => a[0] - b[0] || Date.parse(b[1].published) - Date.parse(a[1].published));
  return out.slice(0, max).map((x) => x[1]);
}

const arxivId = (doi) => (/arxiv\.(.+)$/i.exec(String(doi || '')) || [])[1] || '';

// Looks the papers up and calls onPaper(id, oa) for each; oa = { t, cites, inst: [{n, zh, k}], h: [h-indices,
// highest first], n (authors) } or { t, miss: true } when OpenAlex does not have the paper yet.
export async function enrich(papers, onPaper) {
  const now = Date.now();
  for (let i = 0; i < papers.length; i += 40) {
    const batch = papers.slice(i, i + 40);
    const filter = batch.map((p) => `10.48550/arxiv.${p.id}`).join('|');
    let works;
    try {
      const j = await queued(`${BASE}/works?filter=doi:${encodeURIComponent(filter)}&per-page=50&select=doi,cited_by_count,authorships`);
      works = j?.results || [];
    } catch { continue; }
    const found = new Map(works.map((w) => [arxivId(w.doi).toLowerCase(), w]));
    // the authors' records, for the papers found
    const authorIds = new Set();
    for (const w of works) for (const a of (w.authorships || []).slice(0, 12)) { const id = a.author?.id?.split('/').pop(); if (id) authorIds.add(id); }
    const hOf = new Map();
    const ids = [...authorIds];
    for (let k = 0; k < ids.length; k += 50) {
      try {
        const j = await queued(`${BASE}/authors?filter=openalex:${ids.slice(k, k + 50).join('|')}&per-page=50&select=id,summary_stats`);
        for (const a of j?.results || []) hOf.set(a.id.split('/').pop(), a.summary_stats?.h_index || 0);
      } catch { /* the h-indices are left out */ }
    }
    for (const p of batch) {
      const w = found.get(p.id.toLowerCase());
      if (!w) { onPaper(p.id, { t: now, miss: true }); continue; }
      const inst = [], seen = new Set();
      const hs = [];
      for (const a of w.authorships || []) {
        for (const x of a.institutions || []) {
          const name = x.display_name;
          if (name && !seen.has(name)) { seen.add(name); inst.push(fromOpenAlex(name)); }
        }
        const id = a.author?.id?.split('/').pop();
        if (id && hOf.has(id)) hs.push(hOf.get(id));
      }
      hs.sort((a, b) => b - a);
      onPaper(p.id, { t: now, cites: w.cited_by_count || 0, inst: inst.slice(0, 8), h: hs.slice(0, 5), n: (w.authorships || []).length });
    }
  }
}
