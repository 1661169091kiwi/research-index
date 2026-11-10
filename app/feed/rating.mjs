// The AI judge for the quality score: the model reads a paper's title and abstract (nothing more) and scores four
// things from 1 to 10. Ten papers go in one request, with the reasoning switched off and only the numbers coming
// back, so a paper costs about ¥0.001 (deepseek-flash at peak price; half off-peak). Each paper is scored once.
// Shared by both apps; service.mjs decides which papers, when, and within what daily budget.

export const RATING_V = 1;
export const RATING_SYSTEM = `You review machine-learning research papers from their title and abstract alone, the way an experienced area chair skims a submission.

For each paper give four integer scores from 1 to 10:
- n: novelty (is the idea new, or a small variation of known work?)
- r: rigour and evidence (concrete experiments, baselines, numbers, ablations, or theory; vague claims score low)
- s: significance (would people in the area care, build on it, cite it?)
- c: clarity (is it clear what was done and what was found?)

Calibrate: 5 is a typical arXiv paper in its area; 8 or more would be a strong main-track paper at NeurIPS, ICML or ICLR; 3 or less is weak, vague or mostly claims. Use the whole range. Do not reward buzzwords, scale of claims or famous names.

Reply with one JSON object and nothing else: {"<id>": [n, r, s, c], ...} with every id you were given.`;

// the request's user message: the papers as compact JSON lines
export function ratingPrompt(papers) {
  return papers.map((p) => JSON.stringify({ id: p.id, title: p.title, abstract: String(p.abstract || '').slice(0, 2600) })).join('\n');
}

// { id: [n, r, s, c] } from the model's reply (tolerant of code fences and stray text); bad entries are dropped
export function parseRatings(text, ids) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return {};
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { return {}; }
  const out = {};
  for (const id of ids) {
    const v = j[id];
    if (Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every((x) => Number.isFinite(+x) && +x >= 1 && +x <= 10)) out[id] = v.slice(0, 4).map((x) => Math.round(+x));
  }
  return out;
}
