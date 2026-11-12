// Try the web version on this computer: serves web/www on http://localhost:5180 and runs the arXiv relay
// (relay/worker.js, the same code Cloudflare runs) on http://127.0.0.1:5181.
//   node build.mjs --web --relay=http://127.0.0.1:5181 && node web/dev.mjs
// Node's fetch ignores the Windows proxy: set HTTPS_PROXY (and NODE_USE_ENV_PROXY=1) if arXiv needs it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './relay/worker.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(5180, () => console.log('web version: http://localhost:5180/'));

// the relay, with a stand-in for Cloudflare's cache
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, v) => { store.set(r.url, v); } } };
http.createServer(async (req, res) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const out = await worker.fetch(new Request(`http://127.0.0.1:5181${req.url}`, { method: req.method, headers }), {}, { waitUntil() {} });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(5181, () => console.log('arXiv relay: http://127.0.0.1:5181/'));
