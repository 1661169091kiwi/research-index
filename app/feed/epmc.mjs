// Europe PMC (europepmc.org, free, no key): the source of the life-sciences and medicine packs. One search API over
// PubMed, PubMed Central and the preprint servers (bioRxiv, medRxiv, ChemRxiv, Research Square; usually a day after
// they appear). It allows a web page to call it, so the web version needs no relay for these packs.
// Papers get ids by DOI ("doi:10.1101/…"), else PubMed ("pmid:…"); ids.mjs makes their links. Shared by both apps.
import { httpGet, makeQueue } from './sources.mjs';
import { TOPICS } from './topics.mjs';
import { pack } from './packs.mjs';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
// journal articles and preprints, with an abstract
export const EPMC_BASE = '(SRC:MED OR SRC:PPR) AND HAS_ABSTRACT:y';
const queue = makeQueue(350); // Europe PMC asks for no more than a few requests a second
const day = (t) => new Date(t).toISOString().slice(0, 10);

// ---------- one record → the app's paper ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});
const text = (html) => decode(String(html || '')
  .replace(/<h4>([\s\S]*?)<\/h4>/gi, ' $1: ') // structured abstracts: "Background: …"
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
// publication types worth showing (and telling the AI judge): the level of evidence in medicine
const TYPE = /randomi[sz]ed controlled trial|clinical trial|meta-analysis|systematic review|review|observational study|cohort|case reports?|guideline|preprint/i;

export function toPaper(r) {
  const doi = String(r.doi || '').toLowerCase();
  const id = doi ? `doi:${doi}` : r.pmid ? `pmid:${r.pmid}` : `epmc:${r.source}:${r.id}`;
  const server = r.source === 'PPR' ? (r.bookOrReportDetails?.publisher || 'Preprint') : '';
  const authors = (r.authorList?.author || []).map((a) => (a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : a.fullName || a.collectiveName || '')).filter(Boolean);
  const types = [...new Set((r.pubTypeList?.pubType || []).filter((x) => TYPE.test(x) && !/-article$/i.test(x)))];
  const keywords = (r.keywordList?.keyword || []).slice(0, 6);
  const mesh = (r.meshHeadingList?.meshHeading || []).filter((m) => m.majorTopic_YN === 'Y').map((m) => m.descriptorName).slice(0, 6);
  return {
    id, doi, pmid: r.pmid || '', pmcid: r.pmcid || '', esrc: r.source, eid: r.id, src: 'epmc',
    version: '', title: text(r.title).replace(/\.$/, ''), abstract: text(r.abstractText), authors,
    published: (r.firstPublicationDate || r.firstIndexDate || `${r.pubYear || '1900'}-01-01`).slice(0, 10),
    updated: (r.firstIndexDate || '').slice(0, 10),
    categories: keywords.length ? keywords : mesh, primary: server || 'PubMed',
    comment: types.join(' · '),
    ...(r.journalInfo?.journal?.title ? { journal: text(r.journalInfo.journal.title) } : {}),
    open: r.isOpenAccess === 'Y',
    // no figure is fetched for these (the image hosts refuse apps): the cover is the generated art
    cover: { none: true },
  };
}

// ---------- searching ----------
// query: Europe PMC syntax (TITLE_ABS:, MESH:, PUB_TYPE:, JOURNAL:, FIRST_PDATE:[a TO b], AND/OR/NOT)
// sort: 'FIRST_PDATE_D desc' (newest first) or '' (relevance); cursor: '*' for the first page, then the reply's next
export async function epmcSearch(query, { pageSize = 50, cursor = '*', sort = 'FIRST_PDATE_D desc', urgent = false } = {}) {
  const params = new URLSearchParams({ query, resultType: 'core', format: 'json', pageSize: String(pageSize), cursorMark: cursor });
  if (sort) params.set('sort', sort);
  const j = await queue(() => httpGet(`${BASE}/search?${params}`, { as: 'json', tries: urgent ? 2 : 3, timeout: 40000 }), { urgent });
  const list = j?.resultList?.result || [];
  return { papers: list.map(toPaper).filter((p) => p.title && p.abstract), next: j?.nextCursorMark && j.nextCursorMark !== cursor && list.length >= pageSize ? j.nextCursorMark : '', hits: j?.hitCount || 0 };
}
// up to today: some journals date their issues ahead
export const upToToday = (from = '1900-01-01') => `FIRST_PDATE:[${from} TO ${day(Date.now())}]`;

// The full text of an open-access paper in PubMed Central (for AI takes and questions), as plain text.
export async function epmcFullText(pmcid) {
  if (!pmcid) return null;
  const xml = await queue(() => httpGet(`${BASE}/${pmcid}/fullTextXML`, { tries: 1, timeout: 40000 }), { urgent: true });
  if (!xml) return null;
  const body = (/<body>([\s\S]*)<\/body>/.exec(xml) || [, ''])[1];
  const t = decode(body
    .replace(/<(table-wrap|fig|ref-list|supplementary-material)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<title>([\s\S]*?)<\/title>/gi, '\n\n## $1\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > 2000 ? t : null;
}

// ---------- one full refresh (the pack's directions) ----------
// The same shape as sources.mjs fetchAll: each direction's newest papers, its leading journals (venues), its
// reviews (deepSurveys) and, going further back, the papers before the oldest one there is (backfillBefore).
export async function fetchAllEpmc({ onBatch, onProgress, onCursor, deepSurveys = false, firstRun = false, venues = '', backfill = null, backfillBefore = {}, only = '' }) {
  const P = pack();
  const jobs = [];
  const per = firstRun ? 100 : 60;
  const from = day(Date.now() - (firstRun ? 60 : 21) * 864e5);
  if (only !== 'backfill') {
    for (const t of TOPICS) jobs.push({ label: t.en, run: () => epmcSearch(`(${t.q}) AND ${EPMC_BASE} AND ${upToToday(from)}`, { pageSize: per }) });
    if (venues) for (const t of TOPICS) jobs.push({ label: `${t.en} venues`, run: () => epmcSearch(`(${t.q}) AND (${P.venueQuery}) AND ${EPMC_BASE} AND ${upToToday(day(Date.now() - 120 * 864e5))}`, { pageSize: venues === 'deep' ? 50 : 25 }) });
    jobs.push({ label: 'Surveys', run: () => epmcSearch(`(${TOPICS.map((t) => `(${t.q})`).join(' OR ')}) AND PUB_TYPE:"Review" AND ${EPMC_BASE} AND ${upToToday(day(Date.now() - 90 * 864e5))}`, { pageSize: 100 }) });
    if (deepSurveys) for (const t of TOPICS) jobs.push({ label: `${t.en} surveys`, run: () => epmcSearch(`(${t.q}) AND (PUB_TYPE:"Review" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis") AND ${EPMC_BASE} AND ${upToToday(day(Date.now() - 365 * 864e5))}`, { pageSize: 30 }) });
  }
  for (const t of TOPICS) {
    if (backfill?.[t.id] == null) continue;
    const before = backfillBefore[t.id];
    const to = before ? day(Date.parse(before) - 864e5) : day(Date.now() - 30 * 864e5);
    jobs.push({ label: t.en, run: () => epmcSearch(`(${t.q}) AND ${EPMC_BASE} AND FIRST_PDATE:[1990-01-01 TO ${to}]`, { pageSize: 100 }), after: (papers) => onCursor?.(t.id, papers) });
  }
  let done = 0, failed = 0;
  for (const job of jobs) {
    onProgress?.({ done, total: jobs.length, label: job.label });
    try {
      const { papers } = await job.run();
      onBatch(papers, job.label);
      job.after?.(papers);
    } catch (e) {
      failed++;
      console.error('[feed] source failed:', job.label, e.message);
    }
    done++;
  }
  onProgress?.({ done, total: jobs.length, label: '', finished: true, failed });
}
