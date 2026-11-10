// Does the quality score rank good papers first? (developer tool; nothing is written)
//   node scripts/quality-backtest.mjs [feed folder]      default: D:/Research Index Data/feed
// "Good" here: accepted at a top venue (the one label the collection has for every paper). Each model is scored by
// ROC-AUC on held-out papers (5 folds): 0.5 is chance, 1 is perfect. The venue itself is never a feature.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = await import(pathToFileURL(path.join(ROOT, 'app/feed/quality.mjs')).href);
const dir = process.argv[2] || 'D:/Research Index Data/feed';
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${f}.json`), 'utf8')); } catch { return {}; } };
const papers = Object.values(read('papers')), ratings = read('ratings');
const now = Date.now();
const ev = papers.map((p) => Q.evidence(p, ratings[p.id], now));
const xs = ev.map(Q.features);
const ys = ev.map((e) => (e.venue ? 1 : 0));
const n = papers.length;
console.log(`${n} papers, ${ys.reduce((s, y) => s + y, 0)} accepted at a top venue; OpenAlex for ${papers.filter((p) => p.oa && !p.oa.miss).length}, institutions for ${papers.filter((p) => (p.affil?.list || []).length).length}, AI judge for ${Object.keys(ratings).length}`);

// 5-fold cross-validation
const fold = papers.map((p, i) => (([...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)) % 5));
function cv(scoreFn) {
  const s = new Array(n);
  for (let f = 0; f < 5; f++) {
    const tr = [], ty = [];
    for (let i = 0; i < n; i++) if (fold[i] !== f) { tr.push(xs[i]); ty.push(ys[i]); }
    const w = Q.fit(tr, ty);
    for (let i = 0; i < n; i++) if (fold[i] === f) s[i] = scoreFn(i, w);
  }
  return s;
}
// AUC within each publication month, averaged (weighted by size): accepted papers came in partly through the
// venue searches and are older on the whole, so comparing across months would reward "older", not "better"
const month = papers.map((p) => (p.published || '').slice(0, 7));
const report = (name, s, mask = null) => {
  const groups = new Map();
  for (let i = 0; i < n; i++) if (!mask || mask(i)) { const g = groups.get(month[i]) || { S: [], Y: [] }; g.S.push(s[i]); g.Y.push(ys[i]); groups.set(month[i], g); }
  let sum = 0, wsum = 0, papersN = 0, posN = 0;
  for (const g of groups.values()) {
    const pos = g.Y.reduce((t, y) => t + y, 0);
    if (pos < 8 || g.Y.length - pos < 8) continue;
    const a = Q.auc(g.S, g.Y);
    const w = Math.min(pos, g.Y.length - pos);
    sum += a * w; wsum += w; papersN += g.Y.length; posN += pos;
  }
  console.log(`${name.padEnd(46)} AUC ${wsum ? (sum / wsum).toFixed(3) : '—'}  (within-month; ${papersN} papers, ${posN} accepted)`);
};
report('Hugging Face upvotes only', ev.map((e) => e.up));
report('authors\' highest h-index only (OpenAlex)', ev.map((e) => e.h ?? -1), (i) => ev[i].h != null);
report('fitted model, no AI judge', cv((i, w) => Q.logit(w, xs[i])));
const rated = (i) => !!ev[i].ai;
if (papers.some((p, i) => rated(i))) {
  const ai = (i) => (ev[i].ai ? (ev[i].ai[0] + ev[i].ai[1] + ev[i].ai[2]) / 3 : 5);
  report('AI judge only (papers it rated)', ev.map((e, i) => (e.ai ? ai(i) : 0)), rated);
  report('fitted model, no AI (same papers)', cv((i, w) => Q.logit(w, xs[i])), rated);
  for (const k of [0.5, 0.9, 1.4]) report(`fitted model + AI judge ×${k} (same papers)`, cv((i, w) => Q.logit(w, xs[i]) + k * (ai(i) - 5) / 2.5), rated);
}
