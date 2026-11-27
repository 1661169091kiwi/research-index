// Searching all of arXiv, plainly or with the AI's help ("smart search").
//   plain: the words you type become an arXiv search over every field (all:), so search reaches all of arXiv
//          (about 2.6 million papers), not only the papers this app has collected
//   smart: the AI turns a request in your own words into 2–4 arXiv searches, the results (and matching papers
//          already in your library) are put in front of it, and it keeps the ones that really match, saying why

const CJK = /[⺀-鿿豈-﫿＀-￯]/;
export const ARXIV_ID = /^(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i;

// A search typed into the box, as an arXiv search_query; '' when arXiv cannot answer it (Chinese text).
export function plainQuery(text) {
  const s = String(text || '').trim();
  if (!s || CJK.test(s)) return '';
  if (/\b(ti|abs|au|cat|all|co|jr):/.test(s)) return s; // already arXiv syntax
  const terms = [];
  s.replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => {
    const w = (phrase || word).replace(/[()"]/g, '').trim();
    if (w && !/^(and|or|not|the|a|an|of|for|in|on|with|to)$/i.test(w)) terms.push(phrase ? `"${w}"` : w);
    return '';
  });
  return terms.slice(0, 8).map((t) => `all:${t}`).join(' AND ');
}

export const PLAN_SYSTEM = `You help a machine-learning researcher find papers on arXiv. Turn their request (in any language) into arXiv API searches.

Reply with only a JSON object:
{"intent": "...", "queries": ["...", "..."], "keywords": "...", "from": "YYYY-MM-DD or null", "to": "YYYY-MM-DD or null"}

- intent: the request restated in at most 24 characters, in the reader's language.
- queries: 2 to 4 arXiv search_query strings. Syntax: ti: (title), abs: (abstract), au: (author surname), cat: (category: cs.CL, cs.LG, cs.AI, cs.CV, cs.RO, cs.MA, cs.SE, cs.IR, stat.ML, ...), combined with AND, OR, ANDNOT and parentheses; quote phrases, e.g. abs:"world model". Use English technical terms. One query precise, the others covering synonyms and common acronyms. abs: for concepts, ti: for specific method or benchmark names, au: only when an author is named. No dates inside queries.
- keywords: 5 to 10 English keywords for a full-text search of the reader's own library.
- from / to: only when the request limits the time ("recent" = the last 6 months; "this year"; "since 2024"); otherwise null. Today is {today}.
- A wish for well-known venues or quality is not part of the queries (it is used when the results are screened).`;

export const PICK_SYSTEM = `You screen arXiv search results for a machine-learning researcher. You get their request and candidate papers (id, date, venue if accepted, title, the start of the abstract). Keep the papers that truly match the request.

Reply with only a JSON object:
{"picks": [{"id": "...", "why": "..."}], "note": "..."}

- picks: at most 20, best match first. Leave out papers that only share words with the request. Respect what the request asks for (time, task, method, setting, venue). When it asks for important or high-quality work, prefer accepted papers and clear contributions.
- why: what makes this paper a match, at most 30 characters, in the reader's language.
- note: one sentence in the reader's language on what was found, or what is missing and how the request could be put differently.`;

const langName = (lang) => (lang === 'zh' ? 'Simplified Chinese' : 'English');
export const planPrompt = (request, lang) => `Reader's language: ${langName(lang)}\n\nRequest:\n${request}`;

export function pickPrompt(request, lang, candidates) {
  const lines = candidates.map((p) => {
    const venue = p.venue ? ` · ${p.venue.label}${p.venue.note ? ` ${p.venue.note}` : ''}` : '';
    const abs = String(p.abstract || '').replace(/\s+/g, ' ').slice(0, 480);
    return `[${p.id}] ${p.published || ''}${venue}\n${String(p.title).replace(/\s+/g, ' ')}\n${abs}`;
  });
  return `Reader's language: ${langName(lang)}\n\nRequest:\n${request}\n\nCandidates (${candidates.length}):\n\n${lines.join('\n\n')}`;
}

const jsonIn = (text) => {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
};
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parsePlan(text, request) {
  const j = jsonIn(text) || {};
  let queries = (Array.isArray(j.queries) ? j.queries : []).filter((q) => typeof q === 'string' && q.trim() && q.length < 500).map((q) => q.trim()).slice(0, 4);
  const keywords = typeof j.keywords === 'string' ? j.keywords.slice(0, 200) : '';
  if (!queries.length) { const q = plainQuery(keywords || request); if (q) queries = [q]; }
  return { intent: typeof j.intent === 'string' ? j.intent.slice(0, 60) : '', queries, keywords, from: day(j.from), to: day(j.to) };
}

export function parsePicks(text, ids) {
  const j = jsonIn(text) || {};
  const known = new Set(ids), seen = new Set();
  const picks = [];
  for (const x of Array.isArray(j.picks) ? j.picks : []) {
    const id = String(x?.id || '').replace(/^\[|\]$/g, '').replace(/v\d+$/, '');
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    picks.push({ id, why: typeof x.why === 'string' ? x.why.slice(0, 80) : '' });
    if (picks.length >= 20) break;
  }
  return { picks, note: typeof j.note === 'string' ? j.note.slice(0, 240) : '' };
}

// a time limit from the plan, as arXiv's submittedDate range
export function withDates(query, { from, to }) {
  if (!from && !to) return query;
  const a = (from || '1991-01-01').replace(/-/g, ''), b = (to || '2999-12-31').replace(/-/g, '');
  return `(${query}) AND submittedDate:[${a}0000 TO ${b}2359]`;
}
