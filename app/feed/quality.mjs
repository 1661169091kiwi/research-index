// The quality score (0–100): how a paper compares with the rest of your collection, from public evidence.
//   earned:   accepted at a top venue (venues.mjs), Hugging Face upvotes, GitHub stars, citations (OpenAlex)
//   priors:   the authors' record (highest h-index, OpenAlex), a well-known institution, code released
//   AI judge: novelty, rigour, significance and clarity read from the abstract (rating.mjs), where there is one
// The weights of the non-AI signals are fitted on the collection itself: a small logistic regression that predicts
// "accepted at a top venue" from everything except the venue (so the score can rank papers no venue has taken
// yet). The AI judge's weight is set from a backtest (scripts/quality-backtest.mjs). The score is the paper's
// percentile in the collection; a paper accepted at a top venue scores at least 85 (an oral or spotlight 92).
import { venueOf } from './venues.mjs';

const DAY = 864e5;
export const KEYS = ['up', 'stars', 'cites', 'h', 'inst', 'code'];
// fitted alongside, never scored: how old the paper is (older papers have had time to be accepted; that is not quality)
const CONTROLS = ['age'];
// the AI judge: its mean of novelty, rigour and significance, centred on what it gives a typical paper (5.6) and
// scaled by its spread (about 1); a 7 lifts a paper to about 79, a 4 lowers it to about 34
export const AI_WEIGHT = 0.55;
const DEFAULT_W = { b: -2.2, up: 0.2, stars: 0.15, cites: 0.5, h: 1.5, inst: 0.4, code: 0.35, age: 0 };
const CODE = /github\.com|\bcode (?:is |will be )?(?:publicly |openly )?(?:available|released)|open[- ]sourc/i;

export function evidence(p, rating, now = Date.now()) {
  const v = venueOf(p);
  const ageD = Math.max(1, (now - Date.parse(p.published || 0)) / DAY);
  const oa = p.oa && !p.oa.miss ? p.oa : null;
  const inst = oa?.inst?.length ? oa.inst : p.affil?.list || [];
  const knownInst = inst.filter((x) => x.k);
  return {
    venue: v, up: p.hf?.upvotes || 0, stars: p.hf?.stars || 0, cites: oa ? oa.cites : null, ageD,
    h: oa?.h?.length ? oa.h[0] : null, inst: knownInst.slice(0, 3),
    code: !!p.hf?.github || CODE.test(`${p.abstract || ''} ${p.comment || ''}`),
    ai: rating?.s || null,
  };
}
export function features(e) {
  return {
    up: Math.log1p(e.up), stars: Math.log1p(e.stars),
    cites: e.cites == null ? 0 : Math.log1p(e.cites / Math.max(1, e.ageD / 30)),
    h: e.h == null ? 0 : Math.log1p(e.h) / Math.log1p(100),
    inst: e.inst.length ? 1 : 0, code: e.code ? 1 : 0,
    age: Math.log1p(e.ageD) / Math.log1p(400),
  };
}
export const aiTerm = (e) => (e.ai ? ((e.ai[0] + e.ai[1] + e.ai[2]) / 3 - 5.6) / 1.0 : 0);

// Logistic regression with an L2 penalty, by plain gradient descent (a handful of features, a few thousand papers).
// The evidence weights are kept at zero or above: more upvotes, citations or a stronger record never lower a
// paper's score (in this collection the newest papers have the upvotes and not yet the acceptances, which would
// otherwise read as "upvotes predict rejection").
const ALL = [...KEYS, ...CONTROLS];
export function fit(rows, labels, { iters = 500, lr = 0.5, l2 = 0.02 } = {}) {
  const w = Object.fromEntries(ALL.map((k) => [k, 0]));
  let b = 0;
  const n = rows.length;
  if (!n) return null;
  const pos = labels.reduce((s, y) => s + y, 0);
  if (pos < 20 || pos > n - 20) return null;
  const pw = (n - pos) / pos; // the few positives weigh as much as the many negatives
  for (let it = 0; it < iters; it++) {
    const g = Object.fromEntries(ALL.map((k) => [k, 0]));
    let gb = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const x = rows[i];
      let z = b;
      for (const k of ALL) z += w[k] * x[k];
      const p = 1 / (1 + Math.exp(-z));
      const wt = labels[i] ? pw : 1;
      const d = (p - labels[i]) * wt;
      for (const k of ALL) g[k] += d * x[k];
      gb += d;
      wsum += wt;
    }
    for (const k of ALL) w[k] -= lr * (g[k] / wsum + l2 * w[k]);
    for (const k of KEYS) if (w[k] < 0) w[k] = 0;
    b -= lr * (gb / wsum);
  }
  return { ...w, b };
}
// the score's logit: the evidence only (age is held out)
export const logit = (w, x) => KEYS.reduce((z, k) => z + w[k] * x[k], w.b);

// Area under the ROC curve: the chance a random positive scores above a random negative.
export function auc(scores, labels) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rank = 0, sumPos = 0, pos = 0;
  for (let k = 0; k < idx.length;) {
    let j = k;
    while (j < idx.length && scores[idx[j]] === scores[idx[k]]) j++;
    const avg = (k + j + 1) / 2;
    for (let m = k; m < j; m++) if (labels[idx[m]]) { sumPos += avg; pos++; }
    rank = j;
    k = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (sumPos - pos * (pos + 1) / 2) / (pos * neg) : null;
}

// The weights the score uses. Set by hand and checked with the backtest (scripts/quality-backtest.mjs), because a
// model fitted on the collection learned how papers entered it (accepted papers came in through the venue searches,
// the newest through the daily feeds) rather than what makes them good. Backtest 2026-11-10, AUC within each month
// for "accepted at a top venue": the AI judge 0.60 alone; citations and released code 0.56; together 0.62. Adding
// the authors' record, the institution or popularity (upvotes, stars) only lowered it (to 0.47–0.55), so they are
// shown with the paper but not counted.
export const WEIGHTS = { b: 0, up: 0, stars: 0, cites: 0.5, h: 0, inst: 0, code: 0.4 };

// The whole collection scored at once (cached by the caller): id -> { score, e }.
// The scale is absolute, not a ranking: a paper with no evidence either way scores 50; evidence moves it up (or, from
// the AI judge, down) with diminishing returns; an accepted paper scores at least 85 (an oral or spotlight 92).
export function scoreAll(papers, ratings, { now = Date.now(), weights = WEIGHTS } = {}) {
  const out = new Map();
  for (const p of Object.values(papers)) {
    const e = evidence(p, ratings[p.id], now);
    // nothing to go on (no acceptance, citations, code or AI review yet): no score, rather than a made-up middle one
    if (!e.venue && !e.cites && !e.code && !e.ai) { out.set(p.id, { score: null, e }); continue; }
    const z = logit(weights, features(e)) + AI_WEIGHT * aiTerm(e);
    let s = Math.round(50 + 49 * Math.tanh(z / 1.1));
    if (e.venue) s = Math.max(s, e.venue.note ? 92 : 85);
    out.set(p.id, { score: Math.max(1, Math.min(99, s)), e });
  }
  return { scores: out, weights };
}
