// Research Index — the web version's arXiv relay (a Cloudflare Worker).
// arXiv's search API (export.arxiv.org/api/query) does not let a web page call it, so the page asks this Worker,
// which asks arXiv and passes the answer back with permission for the page to read it. It relays nothing else:
// only GET requests to arXiv's search API, only for the site's own pages (and a local preview). Answers are
// cached for 10 minutes, so many readers fetching the same feed cost arXiv one request.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → "Hello World" Worker → Edit code → paste this file →
// Deploy. Its address (https://<name>.<you>.workers.dev) goes into web/relay.txt (or the RI_RELAY repository
// variable for the GitHub workflow).

const ALLOWED_ORIGINS = [
  'https://1661169091kiwi.github.io',
  'http://localhost:5180',
  'http://127.0.0.1:5180',
];
const TARGET = /^https:\/\/export\.arxiv\.org\/api\/query\?[^#]*$/;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });
    if (origin && !allowed) return new Response('Not allowed from this site', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('u') || '';
    if (!TARGET.test(target)) return new Response('Only arXiv search (export.arxiv.org/api/query) is relayed', { status: 400, headers: cors });

    // the same question within 10 minutes: answered from Cloudflare's cache
    const cache = caches.default;
    const key = new Request(target, { method: 'GET' });
    let res = await cache.match(key);
    if (!res) {
      const up = await fetch(target, { headers: { 'User-Agent': 'research-index-web-relay (+https://github.com/1661169091kiwi/research-index)' } });
      const headers = { 'Content-Type': up.headers.get('Content-Type') || 'application/atom+xml; charset=utf-8', 'Cache-Control': up.ok ? 'public, max-age=600' : 'no-store' };
      const retry = up.headers.get('Retry-After');
      if (retry) headers['Retry-After'] = retry;
      res = new Response(up.body, { status: up.status, headers });
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    out.headers.set('Access-Control-Expose-Headers', 'Retry-After');
    return out;
  },
};
