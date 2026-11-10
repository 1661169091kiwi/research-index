// Developer check of the phone app's pages without a phone: serves mobile/www on localhost and opens it
// in a phone-sized Electron window (the page's network falls back to plain fetch, files to localStorage).
//   npx electron scripts/mobile-preview.mjs              open it to look around
//   RI_MOBILE_TEST=<folder> npx electron scripts/mobile-preview.mjs   run the checks, save screenshots, quit
import { app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'mobile', 'www');
const OUT = process.env.RI_MOBILE_TEST;
app.setPath('userData', path.join(ROOT, '.cache', 'mobile-preview'));
// checks run in a window shown off-screen: keep Windows from treating it as covered (it would stop painting)
if (OUT) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(WWW, rel);
      if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  // RI_MOBILE_DARK=1: the phone in dark mode; RI_MOBILE_STYLE=classic: the Classic look
  if (process.env.RI_MOBILE_DARK) nativeTheme.themeSource = 'dark';
  const port = await serve();
  const W = +process.env.RI_MOBILE_W || 412, H = +process.env.RI_MOBILE_H || 892; // RI_MOBILE_W=360 for a small phone
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: !OUT, x: OUT ? -3000 : undefined, y: OUT ? 0 : undefined,
    backgroundColor: '#f6f5f1',
    webPreferences: { webSecurity: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // checks: shown off-screen without focus (a hidden window can hand back a stale frame)
  if (OUT) win.showInactive();
  const wc = win.webContents;
  wc.on('console-message', (e) => { const m = e.message ?? e; if (OUT) fs.appendFileSync(path.join(OUT, 'console.txt'), `${e.level ?? ''} ${m}\n`); });
  const go = (rel) => wc.loadURL(`http://127.0.0.1:${port}/${rel}`).catch(() => {});
  if (!OUT) { await go('index.html'); return; }

  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(path.join(OUT, 'console.txt'), { force: true });
  const report = [];
  const js = (code) => wc.executeJavaScript(code);
  const snap = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), (await wc.capturePage()).toPNG());
  const state = () => js(`(() => { const t = document.getElementById('sw-track'); if (!t) return null;
    const bar = document.getElementById('sw-actions').getBoundingClientRect();
    return { idx: Math.round(t.scrollTop / t.clientHeight), n: t.querySelectorAll('.sw-card[data-id]').length, active: t.querySelector('.sw-card.is-active')?.dataset.id || '',
      reasons: [...t.querySelectorAll('.sw-card[data-id]')].map((e) => e.querySelector('.sw-eyebrow.is-reason')?.textContent || ''),
      cardH: t.querySelector('.sw-card')?.getBoundingClientRect().height, trackH: t.clientHeight, swipeShown: !document.getElementById('swipe').hidden,
      bar: { top: Math.round(bar.top), bottom: Math.round(bar.bottom), h: Math.round(bar.height), off: document.getElementById('sw-actions').classList.contains('is-off') }, winH: innerHeight }; })()`);
  const next = async (ms) => { await wait(ms); await js(`document.getElementById('sw-track').scrollBy({ top: document.getElementById('sw-track').clientHeight })`); await wait(900); };
  const until = async (code, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(code)) return Date.now() - t0; await wait(100); } return -1; };
  try {
    for (const lang of (process.env.RI_MOBILE_LANGS || 'en,zh').split(',')) {
      await go('index.html');
      await wait(300);
      await js(`localStorage.setItem('ri-lang', '${lang}'); localStorage.removeItem('ri-sw-hinted'); localStorage.removeItem('ri-view'); localStorage.setItem('ri-style', '${process.env.RI_MOBILE_STYLE || 'glass'}');`);
      await go('index.html');
      await until(`document.querySelectorAll('#sw-track .sw-card[data-id]').length > 0`, 15000);
      await wait(1500);
      const url = await js('location.pathname');
      const boot = await js(`({ view: localStorage.getItem('ri-view'), mobile: document.documentElement.className, swipeHidden: document.getElementById('swipe')?.hidden })`);
      const s0 = await state();
      const native = await js('window.portal && window.portal.native');
      const look = await js(`({ fl: document.documentElement.classList.contains('fl'), dock: document.getElementById('sw-actions').style.backdropFilter, tabs: document.querySelector('.sw-modes-wrap').style.backdropFilter,
        chips: document.querySelectorAll('#sw-chips button').length, lang: [...document.querySelectorAll('.sw-lang button')].map((b) => b.textContent + (b.classList.contains('is-on') ? '*' : '')).join(' '),
        topBottom: Math.round(document.querySelector('.sw-sub').getBoundingClientRect().bottom), dockTop: Math.round(document.getElementById('sw-actions').getBoundingClientRect().top) })`);
      await snap(`m-swipe-1-${lang}`);
      await next(6500);
      await next(500);
      await next(500);
      const s1 = await state();
      await snap(`m-swipe-2-${lang}`);
      // halfway between two cards: the bar must not move with them
      await js(`document.getElementById('sw-track').style.scrollSnapType = 'none'; document.getElementById('sw-track').scrollBy({ top: document.getElementById('sw-track').clientHeight * 0.45 })`);
      await wait(400);
      const mid = await state();
      await snap(`m-swipe-mid-${lang}`);
      await js(`(() => { const t = document.getElementById('sw-track'); t.scrollBy({ top: -t.clientHeight * 0.45 }); t.style.scrollSnapType = ''; })()`);
      await wait(700);
      await wait(800);
      const views = await js(`(() => { try { return Object.keys(JSON.parse(localStorage.getItem('ri-file:state.json') || '{}').views || {}).length; } catch (e) { return 'err ' + e.message; } })()`);
      // like from the bar
      await js(`document.querySelector('#sw-actions [data-sw="like"]').click()`);
      await wait(700);
      const barLiked = await js(`document.querySelector('#sw-actions [data-sw="like"]').classList.contains('on')`);
      await snap(`m-swipe-liked-${lang}`);
      // tap the abstract → the paper opens full screen; Android's back closes it
      await js(`document.querySelector('.sw-card.is-active .sw-abs').click()`);
      const sheetMs = await until(`!document.getElementById('sheet').hidden && !!document.querySelector('#sheet .sheet-body')`);
      await wait(700);
      await snap(`m-sheet-${lang}`);
      await js(`document.querySelector('#sheet .sheet-scroll').scrollBy(0, 700)`);
      await wait(400);
      const sheetScroll = await js(`(() => { const s = document.querySelector('#sheet .sheet-scroll'), c = document.querySelector('#sheet .sheet-close').getBoundingClientRect();
        return { scrolled: Math.round(s.scrollTop), closeTop: Math.round(c.top), closeVisible: c.top >= 0 && c.bottom <= innerHeight, overflowX: s.scrollWidth > s.clientWidth }; })()`);
      await snap(`m-sheet-scrolled-${lang}`);
      const backClosed = await js(`window.__riBack()`) && await js(`document.getElementById('sheet').hidden`);
      await wait(600);
      const barAfterSheet = await state();
      // menu → grid view; back returns to the swipe feed
      await js(`document.getElementById('sw-menu-btn').click()`);
      await wait(400);
      await snap(`m-menu-${lang}`);
      await js(`document.querySelector('[data-sw-menu="grid"]').click()`);
      await wait(2500);
      await snap(`m-grid-${lang}`);
      const grid = await js(`({ cols: document.querySelectorAll('#grid .col').length, cards: document.querySelectorAll('#grid .card').length, firstCardTop: Math.round(document.querySelector('#grid .card')?.getBoundingClientRect().top || 0), overflowX: document.documentElement.scrollWidth > innerWidth || document.getElementById('scroller').scrollWidth > innerWidth })`);
      // reading down the grid tucks the tab bar away and offers "back to top"; a little scroll up brings the bar back
      const navState = () => js(`({ tucked: document.querySelector('.feed-nav').classList.contains('is-tucked'), toTop: document.getElementById('to-top').classList.contains('is-on') })`);
      for (let i = 0; i < 4; i++) { await js(`document.getElementById('scroller').scrollBy(0, 400)`); await wait(250); }
      await wait(500);
      const navDown = await navState();
      await snap(`m-grid-scrolled-${lang}`);
      await js(`document.getElementById('scroller').scrollBy(0, -120)`);
      await wait(600);
      const navUp = await navState();
      await snap(`m-grid-scrolled-up-${lang}`);
      const backToSwipe = await js(`window.__riBack()`) && await js(`!document.getElementById('swipe').hidden`);
      report.push({ lang, url, boot, native, look, first: s0, after: { idx: s1?.idx, n: s1?.n, reasons: s1?.reasons, bar: s1?.bar }, midSwipeBar: mid?.bar, viewsStored: views, barLiked, sheetMs, sheetScroll, backClosed, barAfterSheet: barAfterSheet?.bar, grid, navDown, navUp, backToSwipe });
    }
    // a direction filters the cards; the language switch keeps the paper on screen
    await js(`document.querySelectorAll('#sw-chips button')[1].click()`);
    await wait(2500);
    const topic = await js(`document.querySelector('#sw-chips .is-on')?.dataset.swTopic`);
    await snap('m-topic');
    const before = await state();
    await js(`document.querySelector('.sw-lang button:not(.is-on)').click()`);
    await until(`document.querySelectorAll('#sw-track .sw-card[data-id]').length > 0 && !!document.querySelector('#sw-track .sw-card.is-active')`, 15000);
    await wait(1500);
    const after = await state();
    await snap('m-lang-switched');
    report.push({ topic, langSwitch: { before: before?.active, after: after?.active, same: !!before?.active && before.active === after?.active, path: await js('location.pathname'), topicAfter: await js(`document.querySelector('#sw-chips .is-on')?.dataset.swTopic`) } });
    // the phone app is the paper feed only: no surveys in it, and no Surveys tab
    report.push({ surveysInApp: fs.existsSync(path.join(WWW, 'en', 'index.html')) || fs.existsSync(path.join(WWW, 'zh', 'index.html')),
      tabs: await js(`document.querySelectorAll('.tabs a').length`), seedState: fs.existsSync(path.join(WWW, 'assets', 'mobile', 'seed', 'state.json')) ? Object.keys(JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'mobile', 'seed', 'state.json'), 'utf8'))) : null });
  } catch (e) {
    report.push({ error: String(e.stack || e) });
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
});
