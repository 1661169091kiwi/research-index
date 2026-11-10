// Fetching papers: arXiv API (search), Hugging Face daily papers (popularity), arXiv HTML (figure covers).
// Every host has its own polite queue — arXiv asks for at most one API request every 3 seconds.

import { CATS, SURVEY_RE, TOPICS, tagTopics } from './topics.mjs';
import { affiliationsFromHtml } from './affil.mjs';

const UA = 'ResearchIndex/1.2 (personal paper reader; desktop app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The desktop app swaps in Electron's net.fetch, which follows the Windows proxy settings
// (Node's own fetch ignores them, so arxiv.org can time out behind a local proxy).
let doFetch = (url, init) => fetch(url, init);
export function useFetch(fn) { doFetch = fn; }

function makeQueue(minGapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (task) => {
    const run = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try { return await task(); } finally { last = Date.now(); }
    });
    chain = run.catch(() => {});
    return run;
  };
}
const apiQueue = makeQueue(3100);
const hfQueue = makeQueue(500);

async function get(url, { tries = 3, timeout = 30000, as = 'text' } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, retryAfter: +res.headers.get('retry-after') || 0 });
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      err = e;
      // "too many requests" / "busy": wait properly before asking again (arXiv allows one request every 3 s
      // per address, and another app on the same network counts too)
      const busy = e.status === 429 || e.status === 503;
      await sleep(busy ? Math.min(60000, Math.max(e.retryAfter * 1000, 12000 * (i + 1))) : 2000 * (i + 1));
    }
  }
  throw err;
}

// ---------- arXiv Atom ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});
const clean = (s) => decode(s || '').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1] : ''; };

export function parseAtom(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const idUrl = clean(tag(e, 'id'));
    const idm = /abs\/([^v\s]+)(v\d+)?$/.exec(idUrl);
    if (!idm) continue;
    const title = clean(tag(e, 'title'));
    const abstract = clean(tag(e, 'summary'));
    const authors = [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((a) => clean(a[1]));
    const cats = [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((c) => c[1]);
    const primary = (/<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e) || [])[1] || cats[0] || '';
    const comment = clean(tag(e, 'arxiv:comment'));
    out.push({
      id: idm[1],
      version: idm[2] || 'v1',
      title, abstract, authors,
      published: clean(tag(e, 'published')).slice(0, 10),
      updated: clean(tag(e, 'updated')).slice(0, 10),
      categories: cats, primary, comment,
    });
  }
  return out;
}

export function arxivSearch(query, max = 60, start = 0) {
  const params = new URLSearchParams({ search_query: query, sortBy: 'submittedDate', sortOrder: 'descending', start: String(start), max_results: String(max) });
  return apiQueue(() => get(`https://export.arxiv.org/api/query?${params}`)).then((xml) => (xml ? parseAtom(xml) : []));
}

// ---------- Hugging Face daily papers ----------
export async function hfDaily(limit = 100) {
  const data = await hfQueue(() => get(`https://huggingface.co/api/daily_papers?limit=${limit}`, { as: 'json' }));
  return (data || []).map((d) => {
    const p = d.paper || {};
    return {
      id: p.id,
      title: clean(p.title || d.title || ''),
      abstract: clean(p.summary || d.summary || ''),
      authors: (p.authors || []).map((a) => a.name).filter(Boolean),
      published: (p.publishedAt || d.publishedAt || '').slice(0, 10),
      hf: {
        upvotes: p.upvotes || 0,
        comments: d.numComments || 0,
        github: p.githubRepo || '',
        stars: p.githubStars || 0,
        org: (p.organization && (p.organization.fullname || p.organization.name)) || (d.organization && (d.organization.fullname || d.organization.name)) || '',
        day: (p.submittedOnDailyAt || '').slice(0, 10),
      },
    };
  }).filter((p) => /^\d{4}\.\d{4,5}$/.test(p.id || ''));
}

// ---------- figure cover from the arXiv HTML version ----------
// At most three figure lookups in flight, starting at least 300 ms apart.
function makePool(max, gapMs) {
  let active = 0, last = 0;
  const waiting = [];
  const next = () => {
    // an urgent task may use one slot beyond the limit, so slow background lookups cannot hold it up
    if (!waiting.length || active >= max + (waiting[0].urgent ? 1 : 0)) return;
    const wait = last + gapMs - Date.now();
    if (wait > 0) { setTimeout(next, wait); return; }
    const { task, resolve, reject } = waiting.shift();
    active++; last = Date.now();
    task().then(resolve, reject).finally(() => { active--; next(); });
    next();
  };
  // urgent tasks (the paper the reader just opened) go ahead of the queue
  return (task, { urgent = false } = {}) => new Promise((resolve, reject) => { waiting[urgent ? 'unshift' : 'push']({ task, resolve, reject, urgent }); next(); });
}
const figurePool = makePool(3, 300);

// Reads an arXiv HTML page only until its first real figure appears (pages can be several MB).
async function readUntilFigure(url) {
  // Stopping early must abort the request itself: only cancelling the body reader leaves Chromium's
  // connection busy, and after six of those every later arXiv request stalls.
  const stop = new AbortController();
  const res = await doFetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.any([AbortSignal.timeout(30000), stop.signal]), redirect: 'follow', until: 'figure' }); // until: the phone's native request stops reading there
  if (res.status === 404) { stop.abort(); return null; }
  if (!res.ok) { stop.abort(); throw new Error(`HTTP ${res.status}`); }
  if (!res.body?.getReader) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = '', ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { ended = true; break; }
      html += decoder.decode(value, { stream: true });
      if (/<figure[^>]*>[\s\S]*?<img[^>]*src="(?!data:)[^"]+"[\s\S]*?<\/figure>/.test(html) || html.length > 3e6) break;
    }
  } finally {
    if (!ended) { stop.abort(); reader.cancel().catch(() => {}); }
  }
  return html;
}

// Shortens a caption without leaving a formula half open.
function cutCaption(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const dollars = (cut.match(/(?<!\\)\$/g) || []).length;
  if (dollars % 2) cut = cut.slice(0, cut.lastIndexOf('$'));
  return `${cut.replace(/\s+\S*$/, '')} …`;
}

// Image paths look like "2611.06500v1/overview.png", relative to https://arxiv.org/html/.
// Returns the figure (or { none: true }) and, from the same page, the institutions in its author block (affil);
// null when arXiv has no HTML version of the paper.
export async function findFigure(id, { urgent = false } = {}) {
  const page = `https://arxiv.org/html/${id}`;
  const html = await figurePool(() => readUntilFigure(page), { urgent });
  if (!html) return null;
  const affil = affiliationsFromHtml(html);
  const fig = figureIn(html, page);
  return { ...(fig || { none: true }), affil };
}
function figureIn(html, page) {
  const base = (/<base[^>]*href="([^"]+)"/.exec(html) || [])[1] || page;
  for (const m of html.matchAll(/<figure[^>]*>([\s\S]*?)<\/figure>/g)) {
    const img = /<img[^>]*src="([^"]+)"[^>]*>/.exec(m[1]);
    if (!img || img[1].startsWith('data:')) continue;
    const w = +(/width="(\d+)/.exec(img[0]) || [])[1] || 0;
    const h = +(/height="(\d+)/.exec(img[0]) || [])[1] || 0;
    if (w && w < 120) continue; // icons, logos
    // formulas keep their LaTeX source (the alttext) as $…$, so the page can typeset them
    const capHtml = (/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(m[1]) || [])[1] || '';
    const cap = clean(capHtml
      .replace(/<math\b[^>]*alttext="([^"]*)"[\s\S]*?<\/math>/gi, (_, a) => ` $${a}$ `)
      .replace(/<[^>]+>/g, ' '))
      .replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(');
    return { url: new URL(img[1], new URL(base, page)).href, w, h, caption: cutCaption(cap, 400) };
  }
  return null;
}
// get() for other modules (OpenAlex): the same fetch, retries and back-off as the arXiv lookups
export { get as httpGet };

// ---------- full text for "Deep read" ----------
// Plain text of the arXiv HTML version: headings kept as Markdown, math as its LaTeX source,
// figure captions and tables kept, the reference list left out. Returns null when there is no HTML version.
export async function fetchFullText(id, { tries = 2, timeout = 60000 } = {}) {
  const html = await figurePool(() => get(`https://arxiv.org/html/${id}`, { tries, timeout }), { urgent: true });
  if (!html) return null;
  let h = (/<article[\s\S]*<\/article>/.exec(html) || [html])[0];
  h = h.replace(/<section[^>]*class="[^"]*ltx_bibliography[\s\S]*?<\/section>/gi, '')
    .replace(/<(script|style|svg|nav|button|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<math\b[^>]*alttext="([^"]*)"[\s\S]*?<\/math>/gi, (_, a) => ` $${decode(a)}$ `)
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n\n${'#'.repeat(Math.min(+n + 1, 4))} `)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(p|div|figcaption|li|tr|br|table|figure|section|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const text = decode(h).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 2000 ? text : null;
}

// ---------- top venues ----------
// Papers whose arXiv comment says they were accepted at a top venue (venues.mjs then reads each comment
// strictly: no workshops, Findings or submissions).
const VENUE_CO = '(' + ['NeurIPS', 'ICML', 'ICLR', 'ACL', 'EMNLP', 'NAACL', 'COLM', 'CVPR', 'ICCV', 'ECCV', 'AAAI', 'IJCAI', 'KDD', 'SIGIR', 'CoRL', 'ICRA', 'TMLR', 'TACL', 'JMLR', 'TPAMI']
  .map((v) => `co:${v}`).join(' OR ') + ')';
const TAKEN_CO = '(co:accepted OR co:"to appear" OR co:"camera ready" OR co:"camera-ready" OR co:published OR co:proceedings)';

// ---------- one full refresh ----------
// Calls onBatch(papers, label) as each source arrives so the feed fills progressively.
//   firstRun        a bigger first look at every direction
//   deepSurveys     also the surveys of every direction (weekly)
//   venues          'recent': the newest accepted papers; 'deep': also per direction (weekly)
//   backfill        { topicId: start }: one older page per direction, so the pool reaches further back
//                   than the newest papers (onCursor(topicId, papers) reports what that page held)
//   only            'backfill': nothing but the older pages (the reader is running out of unseen papers)
export async function fetchAll({ onBatch, onProgress, onCursor, deepSurveys = false, firstRun = false, venues = '', backfill = null, only = '' }) {
  const jobs = [];
  const per = firstRun ? 100 : 60;
  if (only !== 'backfill') {
    for (const t of TOPICS) jobs.push({ label: t.en, run: () => arxivSearch(`(${t.q}) AND ${CATS}`, per) });
    jobs.push({ label: 'Surveys', run: () => arxivSearch(`(ti:survey OR ti:review OR ti:overview OR ti:tutorial) AND ${CATS}`, 200) });
    if (deepSurveys) {
      for (const t of TOPICS) jobs.push({ label: `${t.en} surveys`, run: () => arxivSearch(`(ti:survey OR ti:review OR ti:overview) AND (${t.q}) AND ${CATS}`, 30) });
    }
    if (venues) jobs.push({ label: 'Top venues', run: () => arxivSearch(`${VENUE_CO} AND ${TAKEN_CO} AND ${CATS}`, 200) });
    if (venues === 'deep') {
      for (const t of TOPICS) jobs.push({ label: `${t.en} venues`, run: () => arxivSearch(`(${t.q}) AND ${VENUE_CO} AND ${TAKEN_CO} AND ${CATS}`, 100) });
    }
  }
  for (const t of TOPICS) {
    const start = backfill?.[t.id];
    if (start == null) continue;
    jobs.push({ label: t.en, run: () => arxivSearch(`(${t.q}) AND ${CATS}`, 100, start), after: (papers) => onCursor?.(t.id, papers) });
  }
  let done = 0, failed = 0;
  // Hugging Face runs alongside the arXiv searches: where it is slow or blocked, arXiv does not wait for it
  const hf = only === 'backfill' ? Promise.resolve() : hfDaily(100)
    .then((papers) => onBatch(papers.map(finish), 'Hugging Face'))
    .catch((e) => { failed++; console.error('[feed] source failed: Hugging Face', e.message); });
  for (const job of jobs) {
    onProgress?.({ done, total: jobs.length, label: job.label });
    try {
      const papers = await job.run();
      onBatch(papers.map(finish), job.label);
      job.after?.(papers);
    } catch (e) {
      failed++;
      console.error('[feed] source failed:', job.label, e.message);
    }
    done++;
  }
  await hf;
  onProgress?.({ done, total: jobs.length, label: '', finished: true, failed });
}

function finish(p) {
  return {
    ...p,
    survey: SURVEY_RE.test(p.title),
    topics: tagTopics(p.title, p.abstract),
  };
}
