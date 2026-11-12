# Research Index on the web

The web version is the phone app's pages (`node build.mjs --web` → `web/www`), published on GitHub Pages at
**https://1661169091kiwi.github.io/research-index/**. It runs the same paper feed in the browser:

- papers, translations, likes and saves are kept in this browser (IndexedDB); nothing is sent to the site;
- the DeepSeek key, if you add one, stays in this browser and is sent only to DeepSeek; the 7-day AI limit
  (AI usage) starts on, at ¥5;
- sharing and exporting use the phone's share sheet where the browser has one, else a download;
- on a phone it opens in the one-at-a-time view; it can be added to the home screen.

## The arXiv relay (one-time, free)

arXiv's search API does not let a web page call it, so the page asks a small relay
([`relay/worker.js`](relay/worker.js)) that forwards **only** arXiv search requests, only for this site, and caches
answers for 10 minutes. Everything else (Hugging Face, OpenAlex, arXiv pages, DeepSeek) is called directly.

1. Sign in at **dash.cloudflare.com** (a free account).
2. **Workers & Pages → Create → Create Worker**, name it e.g. `ri-arxiv`, **Deploy**.
3. **Edit code**, replace everything with the contents of `relay/worker.js`, **Deploy**.
4. Its address (`https://ri-arxiv.<your-subdomain>.workers.dev`) goes to:
   - GitHub: **Settings → Secrets and variables → Actions → Variables → New variable** `RI_RELAY`;
   - and, for local builds, `web/relay.txt`.

Without a relay the web version still works, with papers from Hugging Face only.

## Publishing

`.github/workflows/web.yml` builds and publishes the site on every published release, or by hand
(**Actions → Web version → Run workflow**). GitHub Pages must be set to **Source: GitHub Actions** once
(Settings → Pages).

## Trying it locally

```bash
node build.mjs --web --relay=http://127.0.0.1:5181
node web/dev.mjs
```

`dev.mjs` serves the site on http://localhost:5180 and runs the relay on http://127.0.0.1:5181 (set `HTTPS_PROXY`
and `NODE_USE_ENV_PROXY=1` if arXiv needs a proxy).
