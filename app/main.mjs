// Research Index — desktop app (Electron).
// One window whose top bar is the title bar, live updates when the survey folder changes,
// remembered size / position / zoom, and links that open in your normal browser.
//
// Survey folder:  development → the folder above portal/;
//                 installed   → a "Surveys" folder in the data folder (D:\Research Index Data\Surveys when
//                 that exists), else Documents\Research Index. Nothing of yours ships with the app;
//                 "Change folder…" on the home page points it at the folder that holds your surveys.

import { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen, nativeTheme, net, clipboard, ClipboardItem } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, ROOT, DOCS_DIR, DIST, REPO } from '../build.mjs';
import { setupFeed } from './feed/index.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PAPER = '#f6f5f1';
const INK = '#0f0f0f';
const BAR_H = 56; // must match --bar-h in style.css
const SELFTEST = process.env.RI_SELFTEST;

app.setName('Research Index');

// Where the app keeps its data (settings, paper cache, summaries, API keys, browser storage):
//   RI_USERDATA (self-tests) → --data-dir=<folder> → a "Research Index Data" folder next to the
//   install folder (e.g. D:\Research Index Data beside D:\Research Index) → the Windows default (%APPDATA%).
// The data folder is deliberately not inside the install folder, which every update replaces.
function dataDirOverride() {
  if (process.env.RI_USERDATA) return process.env.RI_USERDATA;
  const arg = process.argv.find((a) => a.startsWith('--data-dir='));
  if (arg) return arg.slice('--data-dir='.length).replace(/^"|"$/g, '');
  if (app.isPackaged) {
    const sibling = path.join(path.dirname(path.dirname(process.execPath)), 'Research Index Data');
    if (fs.existsSync(sibling)) return sibling;
  }
  return '';
}
const DATA_DIR = dataDirOverride();
if (DATA_DIR) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  app.setPath('userData', DATA_DIR);
}
// The self-test window sits off-screen; keep Chromium rendering it as if it were visible.
if (SELFTEST) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// arXiv over HTTP/2 shares one connection, and figure lookups that stop reading a page early stall it
// for every later request (covers, captions, full texts time out). Separate HTTP/1.1 connections do not.
app.commandLine.appendSwitch('disable-http2');
if (process.platform === 'win32') app.setAppUserModelId('ResearchIndex.Portal');
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let docsDir = '';
let outDir = '';
let feed = null;

// ---------- small JSON files in the user-data folder ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
const readJSON = (name) => { try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch { return {}; } };
const writeJSON = (name, data) => {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(userFile(name), JSON.stringify(data, null, 2)); } catch { /* ignore */ }
};

// ---------- survey folder ----------
function resolveFolders() {
  const saved = readJSON('settings.json').docsDir;
  const fallback = !app.isPackaged ? DOCS_DIR
    : DATA_DIR ? path.join(DATA_DIR, 'Surveys') : path.join(app.getPath('documents'), 'Research Index');
  docsDir = process.env.RI_DOCS_DIR || (saved && fs.existsSync(saved) ? saved : fallback);
  fs.mkdirSync(docsDir, { recursive: true });
  outDir = app.isPackaged ? path.join(app.getPath('userData'), 'site') : DIST;
}

// ---------- build ----------
function rebuild() {
  try { build({ quiet: true, docsDir, outDir }); return true; }
  catch (e) { console.error('[research-index] build failed:', e.message); return false; }
}
const indexFile = () => path.join(outDir, 'index.html');
// index.html immediately redirects to en/ or zh/, which cancels (ERR_ABORTED, -3) the original load: that is expected.
const open = (file) => win.loadFile(file).catch((e) => { if (!/\(-3\)|ERR_ABORTED/.test(String(e.message))) throw e; });

// ---------- remembered window state ----------
function loadState() {
  const s = readJSON('window-state.json');
  const fallback = { width: 1440, height: 940, zoom: 0 };
  if (!s.width || !s.height) return fallback;
  if (s.x != null && s.y != null) {
    const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea;
    const visible = s.x < area.x + area.width - 80 && s.x + s.width > area.x + 80 && s.y >= area.y - 20 && s.y < area.y + area.height - 80;
    if (!visible) { delete s.x; delete s.y; }
  }
  return { ...fallback, ...s };
}
let saveTimer = 0;
function saveState(now = false) {
  clearTimeout(saveTimer);
  const save = () => {
    if (!win || win.isDestroyed() || SELFTEST) return;
    writeJSON('window-state.json', { ...win.getNormalBounds(), maximized: win.isMaximized(), zoom: win.webContents.getZoomLevel(), chrome: colors });
  };
  if (now) save(); else saveTimer = setTimeout(save, 300);
}

// ---------- window ----------
// The page says which colors its bar has (Glass follows the system's light or dark mode); the window
// buttons Windows draws over the bar, and the window behind the page, take them. Remembered for the next start.
const HEX = /^#[0-9a-f]{6}$/i;
let colors = (() => { const c = readJSON('window-state.json').chrome; return c && HEX.test(c.bg) && HEX.test(c.fg) ? c : { bg: PAPER, fg: INK }; })();
function syncTitleBar() {
  if (!win || win.isDestroyed() || process.platform === 'darwin') return;
  win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: Math.round(BAR_H * win.webContents.getZoomFactor()) });
}
ipcMain.on('ri:chrome', (e, bg, fg) => {
  if (!win || e.sender !== win.webContents || !HEX.test(bg) || !HEX.test(fg)) return;
  if (bg === colors.bg && fg === colors.fg) return;
  colors = { bg, fg };
  win.setBackgroundColor(bg);
  syncTitleBar();
  saveState();
});

function createWindow() {
  const s = SELFTEST ? { x: -3200, y: 40, width: 1440, height: 940, zoom: 0 } : loadState();
  win = new BrowserWindow({
    x: s.x, y: s.y, width: s.width, height: s.height,
    minWidth: 760, minHeight: 520,
    show: false,
    backgroundColor: colors.bg,
    title: 'Research Index',
    icon: path.join(APP_DIR, 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: BAR_H },
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !SELFTEST,
    },
  });
  if (s.maximized) win.maximize();

  const wc = win.webContents;
  wc.on('did-finish-load', () => { wc.setZoomLevel(s.zoom || 0); syncTitleBar(); });
  win.once('ready-to-show', () => (SELFTEST ? win.showInactive() : win.show()));
  open(indexFile()).catch((e) => console.error('[research-index]', e.message));

  // A page that disappeared (renamed survey) falls back to the index.
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && url.startsWith('file:')) open(indexFile()).catch(() => {});
  });

  // Web links open in the normal browser; local pages stay in the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (/^https?:|^mailto:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });

  // Keyboard shortcuts that a normal app has (there is no menu bar).
  const zoomTo = (level) => { wc.setZoomLevel(Math.max(-3, Math.min(4, level))); syncTitleBar(); saveState(); };
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key.toLowerCase();
    const nav = wc.navigationHistory;
    let handled = true;
    if ((mod && key === 'r') || key === 'f5') { rebuild(); wc.reload(); }
    else if (key === 'f12' || (mod && input.shift && key === 'i')) wc.toggleDevTools();
    else if (input.alt && key === 'arrowleft') { if (nav.canGoBack()) nav.goBack(); }
    else if (input.alt && key === 'arrowright') { if (nav.canGoForward()) nav.goForward(); }
    else if (mod && (key === '=' || key === '+')) zoomTo(wc.getZoomLevel() + 0.5);
    else if (mod && key === '-') zoomTo(wc.getZoomLevel() - 0.5);
    else if (mod && key === '0') zoomTo(0);
    else if (key === 'f11') win.setFullScreen(!win.isFullScreen());
    else if (mod && key === 'w') win.close();
    else handled = false;
    if (handled) e.preventDefault();
  });
  wc.on('zoom-changed', (_e, dir) => zoomTo(wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)));

  // Mouse back / forward buttons.
  win.on('app-command', (_e, cmd) => {
    const nav = wc.navigationHistory;
    if (cmd === 'browser-backward' && nav.canGoBack()) nav.goBack();
    if (cmd === 'browser-forward' && nav.canGoForward()) nav.goForward();
  });

  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, () => saveState());
  win.on('close', () => saveState(true));
  win.on('closed', () => { win = null; });
}

// ---------- live updates: rebuild and refresh when surveys or settings change ----------
let watchers = [];
let refreshTimer = 0;
function refresh({ toIndex = false } = {}) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!rebuild() || !win || win.isDestroyed()) return;
    try { await win.webContents.executeJavaScript("sessionStorage.setItem('ri-updated','1')"); } catch { /* ignore */ }
    if (toIndex) open(indexFile()).catch(() => {}); else win.webContents.reload();
  }, 350);
}
function watch() {
  watchers.forEach((w) => w.close());
  watchers = [];
  const add = (dir, filter) => {
    try { watchers.push(fs.watch(dir, (_ev, name) => { if (!name || filter(String(name))) refresh(); })); }
    catch (e) { console.error('[research-index] cannot watch', dir, e.message); }
  };
  add(docsDir, (n) => /\.md$/i.test(n) || n === 'portal.config.json');
  if (!app.isPackaged) {
    add(ROOT, (n) => n === 'portal.config.json');
    add(path.join(ROOT, 'src'), () => true);
  }
}

// ---------- requests from the page ----------
function surveyFile(p) {
  if (typeof p !== 'string') return null;
  const full = path.resolve(p);
  return path.dirname(full).toLowerCase() === docsDir.toLowerCase() && /\.md$/i.test(full) && fs.existsSync(full) ? full : null;
}
// ---------- sharing a paper as an image ----------
const pngBytes = (bytes) => {
  const b = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  return b.length > 8 && b.length < 30e6 && b.readUInt32BE(0) === 0x89504e47 ? b : null;
};
ipcMain.handle('ri:save-image', async (e, name, bytes) => {
  const png = pngBytes(bytes);
  if (!png || e.sender !== win?.webContents) return { ok: false };
  const base = String(name || 'paper.png').replace(/[^\w.\-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'paper.png';
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), base.endsWith('.png') ? base : `${base}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, png);
  return { ok: true, path: res.filePath };
});
ipcMain.handle('ri:fetch-image', async (e, url) => {
  if (e.sender !== win?.webContents || typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'research-index-app' } });
    if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length <= 15e6 ? { bytes: new Uint8Array(buf), type: r.headers.get('content-type') } : null;
  } catch { return null; }
});
ipcMain.handle('ri:copy-image', async (e, bytes) => {
  const png = pngBytes(bytes);
  if (!png || e.sender !== win?.webContents) return { ok: false };
  // Electron 45's clipboard follows the web one: a list of items, each a set of MIME types
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  return { ok: true };
});

// ---------- updates: the latest release on GitHub ----------
// The page asks when the app opens (unless you turned that off) and from About; you can skip a version.
// Installing downloads the Windows installer from the release and starts it; it installs over this copy.
ipcMain.handle('ri:update-check', async () => {
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'research-index-app' } });
    if (!r.ok) return { error: `HTTP ${r.status}`, current: app.getVersion() };
    const j = await r.json();
    return {
      current: app.getVersion(), version: String(j.tag_name || '').replace(/^v/i, ''), name: j.name || '', notes: String(j.body || '').slice(0, 4000),
      url: j.html_url, published: j.published_at,
      assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    };
  } catch (err) { return { error: String(err.message || err), current: app.getVersion() }; }
});
let installing = false;
ipcMain.handle('ri:update-install', async (e, url) => {
  const ok = typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/releases/download/`) && /\.exe$/i.test(url);
  if (!ok || installing || e.sender !== win?.webContents) return { ok: false };
  installing = true;
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'research-index-app' } });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const total = +r.headers.get('content-length') || 0;
    const file = path.join(app.getPath('temp'), path.basename(new URL(url).pathname));
    const out = fs.createWriteStream(file);
    let got = 0, last = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      if (total && got - last > total / 100) { last = got; e.sender.send('ri:update-progress', Math.round((got / total) * 100)); }
    }
    await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
    if (total && got < total) throw new Error('incomplete download');
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  } catch (err) {
    installing = false;
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('ri:open-file', (_e, p) => { const f = surveyFile(p); return f ? shell.openPath(f) : 'not allowed'; });
ipcMain.handle('ri:reveal', (_e, p) => { const f = surveyFile(p); if (f) shell.showItemInFolder(f); });
ipcMain.handle('ri:open-folder', () => shell.openPath(docsDir));
ipcMain.handle('ri:choose-folder', async () => {
  const zh = app.getLocale().toLowerCase().startsWith('zh');
  const res = await dialog.showOpenDialog(win, {
    title: zh ? '选择调研文件夹' : 'Choose the survey folder',
    buttonLabel: zh ? '使用此文件夹' : 'Use this folder',
    defaultPath: docsDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return false;
  docsDir = res.filePaths[0];
  writeJSON('settings.json', { ...readJSON('settings.json'), docsDir });
  watch();
  refresh({ toIndex: true });
  return true;
});

// ---------- lifecycle ----------
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  resolveFolders();
  rebuild();
  feed = setupFeed({ userDataDir: app.getPath('userData'), getWindow: () => win });
  createWindow();
  watch();
  feed.start();
  if (SELFTEST) selfTest(SELFTEST);
});
app.on('before-quit', () => feed?.flush());
app.on('window-all-closed', () => app.quit());

// Developer check: RI_SELFTEST=<folder> saves screenshots of a few pages plus a report, then quits.
// The window opens off-screen and without focus so it does not get in the way.
async function selfTest(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const wc = win.webContents;
  const shot = async (name, rel) => {
    await open(path.join(outDir, rel));
    await wait(1600);
    const info = await wc.executeJavaScript(`({ url: location.href, isApp: document.documentElement.classList.contains('is-app'),
      surveys: document.querySelectorAll('#doc-list .row').length, title: document.title,
      lineW: getComputedStyle(document.documentElement).getPropertyValue('--line-w'), ruleW: getComputedStyle(document.documentElement).getPropertyValue('--rule-w'),
      fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).filter((v, i, a) => a.indexOf(v) === i) })`);
    fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
    return { name, ...info };
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    await wait(1200);
    const report = [];
    if (process.env.RI_SELFTEST_TR) {
      // translation: no key → invalid key (real request, rejected) → sample translations rendered
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const statusText = () => wc.executeJavaScript(`document.getElementById('feed-status').innerText`);
      await wc.executeJavaScript(`localStorage.setItem('ri-tr', 'true')`);
      await open(path.join(outDir, 'zh/papers.html'));
      await wait(4000);
      report.push({ name: 'tr-no-key', status: await statusText() });
      await wc.executeJavaScript(`window.portal.feed.ai({ provider: 'deepseek', key: 'sk-selftest-invalid-0000' })`);
      await wc.executeJavaScript(`location.reload()`);
      await wait(9000);
      report.push({ name: 'tr-invalid-key', status: await statusText() });
      await wc.executeJavaScript(`window.portal.feed.ai({ key: '' })`);
      const ids = await wc.executeJavaScript(`[...document.querySelectorAll('#grid .card')].slice(0, 8).map((e) => e.dataset.id)`);
      const sample = JSON.parse(fs.readFileSync(process.env.RI_SELFTEST_TR, 'utf8'));
      ids.forEach((id, i) => feed.store.setTranslation(id, sample.titles[id] ? { title: sample.titles[id] } : { title: `（示例译文 ${i + 1}）${feed.store.papers[id].title.slice(0, 18)}…` }));
      if (sample.abstracts[ids[0]]) feed.store.setTranslation(ids[0], { abstract: sample.abstracts[ids[0]] });
      await wc.executeJavaScript(`location.reload()`);
      await wait(3500);
      fs.writeFileSync(path.join(dir, 'tr-feed.png'), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(`document.querySelector('.card').click()`);
      await wait(2500);
      report.push({ name: 'tr-sheet', title: await wc.executeJavaScript(`document.getElementById('sheet-title-box').innerText`), absTools: await wc.executeJavaScript(`document.getElementById('abs-tools').innerText`) });
      fs.writeFileSync(path.join(dir, 'tr-sheet.png'), (await wc.capturePage()).toPNG());
    } else if (process.env.RI_SELFTEST_TAKE) {
      // Claude panel: no key → invalid key (real request, rejected) → a stored take rendered
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      await open(path.join(outDir, 'en/papers.html'));
      await wait(2500);
      const id = await wc.executeJavaScript(`document.querySelector('.card').dataset.id`);
      const openCard = async () => {
        await wc.executeJavaScript(`document.querySelector('#sheet [data-close]')?.click(); document.querySelector('.card[data-id="${id}"]').click()`);
        await wait(1800);
        await wc.executeJavaScript(`document.querySelector('#take')?.scrollIntoView({ block: 'center' })`);
        await wait(400);
      };
      const panel = () => wc.executeJavaScript(`document.querySelector('#take')?.innerText || ''`);
      await openCard();
      report.push({ name: 'no-key', panel: await panel() });
      fs.writeFileSync(path.join(dir, 'take-setup.png'), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(`window.portal.feed.ai({ key: 'sk-ant-api03-selftest-invalid-key-0000' })`);
      await wc.executeJavaScript(`location.reload()`);
      await wait(3000);
      await openCard();
      await wc.executeJavaScript(`document.querySelector('#take [data-take="quick"]').click()`);
      const t0 = Date.now();
      let text = '';
      while (Date.now() - t0 < 40000) { await wait(1000); text = await panel(); if (/rejected|Could not reach|went wrong|API error|declined/.test(text)) break; }
      report.push({ name: 'invalid-key', ms: Date.now() - t0, panel: text });
      fs.writeFileSync(path.join(dir, 'take-error.png'), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(`window.portal.feed.ai({ key: '' })`);
      if (process.env.RI_SELFTEST_TAKE_SAMPLE) {
        feed.store.setTake(id, 'en:quick', JSON.parse(fs.readFileSync(process.env.RI_SELFTEST_TAKE_SAMPLE, 'utf8')));
        await wc.executeJavaScript(`location.reload()`);
        await wait(3000);
        await openCard();
        report.push({ name: 'sample', panel: (await panel()).slice(0, 300) });
        fs.writeFileSync(path.join(dir, 'take-rendered.png'), (await wc.capturePage()).toPNG());
      }
    } else if (process.env.RI_SELFTEST_FEED) {
      // wait for the first fetch to bring in papers, then look at the feed and open one paper
      const t0 = Date.now();
      while (Date.now() - t0 < 240000 && Object.keys(feed.store.papers).length < 400) await wait(2000);
      await wait(2000);
      report.push(await shot('papers-en', 'en/papers.html'));
      await wait(30000); // figure covers for the cards in view
      fs.writeFileSync(path.join(dir, 'papers-en-covers.png'), (await wc.capturePage()).toPNG());
      await wc.executeJavaScript(`document.querySelector('.card') && document.querySelector('.card').click()`);
      await wait(6000);
      fs.writeFileSync(path.join(dir, 'papers-en-sheet.png'), (await wc.capturePage()).toPNG());
      report.push({ name: 'figures', imgs: await wc.executeJavaScript(`[...document.querySelectorAll('.cv-fig')].slice(0, 8).map((i) => [i.src.slice(-28), i.complete, i.naturalWidth, i.classList.contains('is-loaded')])`) });
      report.push(await shot('papers-zh', 'zh/papers.html'));
      report.push({ name: 'feed', papers: Object.keys(feed.store.papers).length, covers: Object.values(feed.store.papers).filter((p) => p.cover?.url).length });
    } else if (process.env.RI_SELFTEST_MATH) {
      // formulas: RI_SELFTEST_MATH=<query>|<id>,<id>,…  a search whose cards have formulas, then each paper's sheet
      const [query, ids] = process.env.RI_SELFTEST_MATH.split('|');
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(2500);
      await wc.executeJavaScript(`(() => { const q = document.getElementById('fq'); q.value = ${JSON.stringify(query)}; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await wait(2500);
      const count = `({ katex: document.querySelectorAll('#grid .katex').length, errors: document.querySelectorAll('.katex-error').length,
        raw: [...document.querySelectorAll('#grid .card-title')].map((e) => e.textContent).filter((s) => /\\$|\\\\[a-z]/i.test(s)).slice(0, 3) })`;
      report.push({ name: 'math-feed', ...(await wc.executeJavaScript(count)) });
      fs.writeFileSync(path.join(dir, `math-feed-${lang}.png`), (await wc.capturePage()).toPNG());
      for (const [i, id] of ids.split(',').entries()) {
        await wc.executeJavaScript(`(() => { const s = document.getElementById('sheet'); const a = document.createElement('span'); a.dataset.open = ${JSON.stringify(id)}; s.append(a); a.click(); a.remove(); })()`);
        await wait(i === ids.split(',').length - 1 ? 30000 : 2500); // the last one waits for its caption to be read again
        report.push({ name: `sheet ${id}`, ...(await wc.executeJavaScript(`({ katex: document.querySelectorAll('#sheet .katex').length, errors: document.querySelectorAll('#sheet .katex-error').length,
          title: document.querySelector('#sheet .sheet-title')?.textContent.slice(0, 120), caption: document.querySelector('#sheet .sheet-caption')?.innerText.slice(0, 200),
          captionKatex: document.querySelectorAll('#sheet .sheet-caption .katex').length,
          abstract: document.getElementById('abstract')?.innerText.slice(0, 300) })`)) });
        fs.writeFileSync(path.join(dir, `math-sheet-${lang}-${i + 1}.png`), (await wc.capturePage()).toPNG());
        await wc.executeJavaScript(`document.querySelector('#sheet [data-close]')?.click()`);
        await wait(600);
      }
    } else if (process.env.RI_SELFTEST_REFRESH) {
      // refresh: a new batch replaces the page; paging inside one batch never repeats; coming back keeps the batch
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const ids = () => wc.executeJavaScript(`[...document.querySelectorAll('#grid .card')].map((e) => e.dataset.id)`);
      const firstScreen = () => wc.executeJavaScript(`[...document.querySelectorAll('#grid .card')].filter((e) => e.getBoundingClientRect().top < innerHeight).map((e) => e.dataset.id)`);
      const overlap = (a, b) => a.filter((x) => b.includes(x)).length;
      await open(path.join(outDir, 'en/papers.html'));
      await wait(2500);
      const a = await firstScreen();
      fs.writeFileSync(path.join(dir, 'refresh-1.png'), (await wc.capturePage()).toPNG());
      // scroll through three more pages of the same batch
      for (let i = 0; i < 4; i++) { await wc.executeJavaScript(`document.getElementById('scroller').scrollBy(0, 2600)`); await wait(900); }
      const scrolled = await ids();
      report.push({ name: 'one batch', cards: scrolled.length, unique: new Set(scrolled).size });
      await wc.executeJavaScript(`document.getElementById('refresh').click()`);
      await wait(2500);
      const b = await firstScreen(), afterRefresh = await ids();
      fs.writeFileSync(path.join(dir, 'refresh-2.png'), (await wc.capturePage()).toPNG());
      report.push({ name: 'refresh', firstScreen: [a.length, b.length], sameOnFirstScreen: overlap(a, b), cardsAfter: afterRefresh.length,
        keptFromBefore: overlap(scrolled, afterRefresh), scrollTop: await wc.executeJavaScript(`document.getElementById('scroller').scrollTop`) });
      await wc.executeJavaScript(`document.querySelector('#modes [data-mode="recommended"]').click()`);
      await wait(2500);
      const c = await firstScreen();
      report.push({ name: 'tab again', sameAsBefore: overlap(b, c), of: c.length });
      await open(path.join(outDir, 'en/index.html'));
      await wait(1200);
      await open(path.join(outDir, 'en/papers.html'));
      await wait(2500);
      const d = await firstScreen();
      report.push({ name: 'back to papers', sameBatch: overlap(c, d), of: d.length });
      report.push({ name: 'seen', count: Object.keys(feed.store.state.seen || {}).length });
    } else if (process.env.RI_SELFTEST_ASK) {
      // questions: RI_SELFTEST_ASK=<id>|<first question>|<follow-up>…  (uses the AI key in the test data folder)
      const [id, ...qs] = process.env.RI_SELFTEST_ASK.split('|');
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(2500);
      await wc.executeJavaScript(`(() => { const s = document.getElementById('sheet'); const a = document.createElement('span'); a.dataset.open = ${JSON.stringify(id)}; s.append(a); a.click(); a.remove(); })()`);
      await wait(2500);
      await wc.executeJavaScript(`document.getElementById('take')?.scrollIntoView({ block: 'start' })`);
      await wait(400);
      report.push({ name: 'ask-empty', hidden: await wc.executeJavaScript(`document.getElementById('ask').hidden`), sugg: await wc.executeJavaScript(`[...document.querySelectorAll('#ask-sugg button')].map((b) => b.textContent)`) });
      fs.writeFileSync(path.join(dir, `ask-${lang}-0.png`), (await wc.capturePage()).toPNG());
      for (const [i, q] of qs.entries()) {
        await wc.executeJavaScript(`(() => { const t = document.getElementById('ask-input'); t.value = ${JSON.stringify(q)}; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('ask-form').requestSubmit(); })()`);
        const t0 = Date.now();
        let state = {}, midShot = false;
        while (Date.now() - t0 < 150000) {
          await wait(1000);
          state = await wc.executeJavaScript(`({ live: !!document.getElementById('ask-live'), error: document.querySelector('#ask-live .is-error')?.textContent || '',
            pairs: document.querySelectorAll('#ask-thread .qa').length, chars: document.querySelector('#ask-live .qa-a')?.textContent.length || 0,
            button: document.getElementById('ask-send').textContent })`);
          if (!midShot && state.chars > 300) {
            midShot = true;
            await wc.executeJavaScript(`document.getElementById('ask-live')?.scrollIntoView({ block: 'start' })`);
            fs.writeFileSync(path.join(dir, `ask-${lang}-${i + 1}-streaming.png`), (await wc.capturePage()).toPNG());
            report.push({ name: `ask ${i + 1} streaming`, ...state });
          }
          if (!state.live || state.error) break;
        }
        await wait(600);
        await wc.executeJavaScript(`document.querySelector('#ask-thread .qa:last-child')?.scrollIntoView({ block: 'start' })`);
        await wait(400);
        report.push({
          name: `ask ${i + 1}`, ms: Date.now() - t0, ...state,
          katex: await wc.executeJavaScript(`document.querySelectorAll('#ask-thread .katex').length`),
          answer: await wc.executeJavaScript(`(document.querySelector('#ask-thread .qa:last-child')?.innerText || '').slice(0, 900)`),
        });
        fs.writeFileSync(path.join(dir, `ask-${lang}-${i + 1}.png`), (await wc.capturePage()).toPNG());
      }
      if (!qs.length) { // no new questions: look at the last stored answer
        await wc.executeJavaScript(`document.querySelector('#ask-thread .qa:last-child')?.scrollIntoView({ block: 'start' })`);
        await wait(500);
        fs.writeFileSync(path.join(dir, `ask-${lang}-last.png`), (await wc.capturePage()).toPNG());
      }
      report.push({ name: 'stored', chat: (feed.store.chats[id] || []).map((m) => ({ role: m.role, chars: m.text.length, tokens: m.tokens, model: m.model, abstractOnly: m.abstractOnly })) });
    } else if (process.env.RI_SELFTEST_RECO) {
      // "Recommended": read one card for a few seconds, close it; the cards below the screen should be
      // dealt again around it while the cards on screen stay. A one-second look should change nothing.
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      const P = feed.store.papers;
      const snap = async (name) => fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
      const cards = () => wc.executeJavaScript(`(() => { const b = document.getElementById('scroller').getBoundingClientRect().bottom;
        return [...document.querySelectorAll('#grid .card')].map((e) => ({ id: e.dataset.id, below: e.getBoundingClientRect().top >= b, reason: e.querySelector('.card-reason')?.textContent || '' })); })()`);
      const basis = () => wc.executeJavaScript(`document.getElementById('feed-basis').hidden ? '(hidden)' : document.getElementById('feed-basis').textContent`);
      const readFor = async (id, ms) => {
        await wc.executeJavaScript(`document.querySelector('#grid .card[data-id="${id}"]').click()`);
        await wait(ms);
        if (ms > 3000) await snap(`reco-sheet-${lang}`);
        await wc.executeJavaScript(`document.querySelector('.sheet-close').click()`);
        await wait(2500);
      };
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(2000);
      await wc.executeJavaScript(`document.querySelector('#modes [data-mode="recommended"]').click()`);
      await wait(3000);
      const before = await cards(), basis1 = await basis();
      await snap(`reco-1-${lang}`);
      const onScreen = before.filter((c) => !c.below);
      const n = {};
      for (const c of onScreen) { const tp = P[c.id]?.topics?.[0]; n[tp] = (n[tp] || 0) + 1; }
      const pick = onScreen.slice().sort((a, b) => n[P[a.id]?.topics?.[0]] - n[P[b.id]?.topics?.[0]])[0];
      await readFor(pick.id, 6500);
      const after = await cards(), basis2 = await basis();
      await snap(`reco-2-${lang}`);
      const belowBefore = before.filter((c) => c.below).map((c) => c.id), belowAfter = after.filter((c) => c.below);
      const head = P[pick.id].title.replace(/\$[^$]*\$/g, '').trim().slice(0, 14);
      report.push({ name: 'read one paper', read: P[pick.id].title, dwellMs: feed.store.state.opened[pick.id]?.ms,
        onScreenKept: `${onScreen.filter((c) => after.some((a) => a.id === c.id && !a.below)).length}/${onScreen.length}`,
        below: { before: belowBefore.length, after: belowAfter.length, unchanged: belowAfter.filter((c) => belowBefore.includes(c.id)).length },
        followRead: belowAfter.filter((c) => c.reason.includes(head)).length, basis1, basis2,
        firstBelow: belowAfter.slice(0, 8).map((c) => `${P[c.id]?.title.slice(0, 60)}  ‹${c.reason}›`) });
      await wc.executeJavaScript(`document.getElementById('scroller').scrollBy(0, innerHeight * 0.8)`);
      await wait(1500);
      await snap(`reco-3-${lang}`);
      // a quick look (1 s) is not a read: nothing is dealt again
      const now = await cards();
      const glance = now.find((c) => !c.below && c.id !== pick.id);
      await readFor(glance.id, 1000);
      const later = await cards();
      report.push({ name: 'one-second look', id: glance.id, dwellMs: feed.store.state.opened[glance.id]?.ms,
        belowUnchanged: `${later.filter((c) => c.below && now.some((x) => x.id === c.id && x.below)).length}/${now.filter((c) => c.below).length}` });
      // switching tab and back returns the same cards; paging never repeats inside one deck
      await wc.executeJavaScript(`document.querySelector('#modes [data-mode="latest"]').click()`);
      await wait(2000);
      await wc.executeJavaScript(`document.querySelector('#modes [data-mode="recommended"]').click()`);
      await wait(3000);
      const back = await cards();
      for (let i = 0; i < 4; i++) { await wc.executeJavaScript(`document.getElementById('scroller').scrollBy(0, 2600)`); await wait(1200); }
      const all = (await cards()).map((c) => c.id);
      report.push({ name: 'tab and back', firstSame: back.filter((c) => !c.below).filter((c) => later.some((x) => x.id === c.id)).length,
        of: back.filter((c) => !c.below).length, cardsAfterScrolling: all.length, unique: new Set(all).size,
        alreadyOpenedShown: all.filter((id) => id === pick.id || id === glance.id).length });
    } else if (process.env.RI_SELFTEST_SWIPE) {
      // the swipe feed: stay on one card, skip a few, come back; the cards after the next should follow
      // what held you, every card's time should be stored, a double tap should like, "not interested" hide
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      // RI_SELFTEST_SIZE=820x900: a narrow window, where the action bar runs along the bottom
      if (process.env.RI_SELFTEST_SIZE) { const [w, h] = process.env.RI_SELFTEST_SIZE.split('x').map(Number); win.setContentSize(w, h); await wait(500); }
      const P = feed.store.papers;
      const snap = async (name) => fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
      const js = (code) => wc.executeJavaScript(code);
      const state = () => js(`(() => { const t = document.getElementById('sw-track');
        return { idx: Math.round(t.scrollTop / t.clientHeight), ids: [...t.querySelectorAll('.sw-card[data-id]')].map((e) => e.dataset.id),
          reasons: [...t.querySelectorAll('.sw-card[data-id]')].map((e) => e.querySelector('.sw-eyebrow.is-reason')?.textContent || ''),
          active: t.querySelector('.sw-card.is-active')?.dataset.id || '' }; })()`);
      const next = async (ms) => { await wait(ms); await js(`document.getElementById('sw-track').scrollBy({ top: document.getElementById('sw-track').clientHeight })`); await wait(900); };
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(2000);
      await js(`localStorage.removeItem('ri-sw-hinted'); document.getElementById('view-btn').click()`);
      await wait(2500);
      await snap(`swipe-1-${lang}`);
      const s0 = await state();
      const viewsBefore = Object.keys(feed.store.state.views || {}).length;
      // card 0: read for 7 s; cards 1-2: skipped at once
      await next(7000);
      const s1 = await state();
      await next(400);
      await next(500);
      const s3 = await state();
      await snap(`swipe-2-${lang}`);
      const read = s0.ids[0];
      const head = P[read].title.replace(/\$[^$]*\$/g, '').trim().slice(0, 14);
      const v = feed.store.state.views || {};
      report.push({ name: 'swipe deal', first: s0.ids.length, active0: s0.active === read, read: P[read].title,
        viewMs: [s0.ids[0], s0.ids[1], s0.ids[2]].map((id) => v[id]?.ms ?? null), newViews: Object.keys(v).length - viewsBefore,
        keptNextAfterRead: s1.ids[1] === s0.ids[1], replacedAfterRead: s1.ids.slice(2).filter((id) => !s0.ids.includes(id)).length + '/' + s1.ids.slice(2).length,
        followRead: s3.reasons.filter((r) => r.includes(head)).length, idxNow: s3.idx, reasonsNow: s3.reasons,
        titlesNow: s3.ids.map((id) => P[id]?.title.slice(0, 50)) });
      // the heart likes (with a mouse a click on the card opens it); "not interested" folds the card and moves on
      const likeId = s3.ids[s3.idx];
      await js(`document.querySelector('#sw-actions [data-sw="like"]').click()`);
      await wait(1200);
      await snap(`swipe-like-${lang}`);
      const barLiked = await js(`document.querySelector('#sw-actions [data-sw="like"]').classList.contains('on')`);
      await js(`document.querySelector('#sw-actions [data-sw="hide"]').click()`);
      await wait(1600);
      const s4 = await state();
      const bar = await js(`(() => { const b = document.getElementById('sw-actions'), r = b.getBoundingClientRect(), c = document.querySelector('.sw-card.is-active').getBoundingClientRect();
        return { off: b.classList.contains('is-off'), liked: b.querySelector('[data-sw="like"]').classList.contains('on'), left: Math.round(r.left), cardRight: Math.round(c.right), bottom: Math.round(r.bottom), winH: innerHeight }; })()`);
      report.push({ name: 'like + hide', liked: !!feed.store.state.likes[likeId], barLiked, hidden: !!feed.store.state.hidden[likeId], movedOn: s4.idx === s3.idx + 1, barAfter: bar, sheetOpen: await js(`!document.getElementById('sheet').hidden`) });
      // tap opens the paper; closing it returns to the same card
      await js(`document.querySelector('.sw-card.is-active .sw-abs').click()`);
      await wait(1800);
      await snap(`swipe-sheet-${lang}`);
      const opened = await js(`!document.getElementById('sheet').hidden`);
      await js(`document.querySelector('.sheet-close').click()`);
      await wait(1200);
      const s5 = await state();
      // other tabs and back to the grid
      await js(`document.querySelector('#sw-modes [data-sw-mode="latest"]').click()`);
      await wait(1500);
      const latest = await state();
      await js(`document.getElementById('sw-grid').click()`);
      await wait(1500);
      await snap(`swipe-grid-${lang}`);
      report.push({ name: 'sheet + tabs', opened, sameCardAfterClose: s5.idx === s4.idx, latestCards: latest.ids.length,
        latestSorted: latest.ids.every((id, i, a) => !i || (P[a[i - 1]].published || '') >= (P[id].published || '')),
        gridBack: await js(`document.getElementById('swipe').hidden && document.querySelectorAll('#grid .card').length`) });
    } else if (process.env.RI_SELFTEST_UI) {
      // the grid: the tab bar tucks away on the way down and comes back on the way up; back to top; the tab
      // line glides; a closed paper fades out and its card is marked; papers that arrive mid-scroll join the
      // pages below (and nothing on screen moves)
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      const js = (code) => wc.executeJavaScript(code);
      const snap = async (name) => fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
      // hold back the 20 newest papers: they "arrive" while the feed is being scrolled
      const P = feed.store.papers;
      const heldBack = Object.values(P).sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)).slice(0, 20).map((p) => ({ ...p }));
      for (const p of heldBack) delete P[p.id];
      await js(`localStorage.setItem('ri-feed-view', JSON.stringify({ mode: 'latest', topic: '', collection: '' })); localStorage.setItem('ri-view', '"grid"')`);
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(3000);
      const ink = () => js(`(() => { const on = document.querySelector('#modes .is-on'), ink = document.querySelector('#modes .tab-ink'); return { on: on?.dataset.mode, x: on?.offsetLeft, w: on?.offsetWidth, t: ink?.style.transform }; })()`);
      const ink0 = await ink();
      await snap(`ui-top-${lang}`);
      const scrollBy = async (dy) => { await js(`document.getElementById('scroller').scrollBy(0, ${dy})`); await wait(450); };
      for (let i = 0; i < 6; i++) await scrollBy(300);
      const navDown = await js(`({ tucked: document.querySelector('.feed-nav').classList.contains('is-tucked'), toTop: document.getElementById('to-top').classList.contains('is-on') })`);
      await snap(`ui-scrolled-${lang}`);
      await scrollBy(-120);
      const navUp = await js(`document.querySelector('.feed-nav').classList.contains('is-tucked')`);
      await snap(`ui-scrolled-up-${lang}`);
      const beforeIds = await js(`[...document.querySelectorAll('#grid .card')].map((e) => e.dataset.id)`);
      // the batch arrives
      const added = feed.store.upsert(heldBack);
      wc.send('feed:batch', { count: Object.keys(P).length, added });
      await wait(800);
      const statusNew = await js(`document.querySelector('#feed-status .st-new')?.textContent || ''`);
      const sameOnScreen = await js(`(() => { const ids = ${JSON.stringify(beforeIds)}; const now = [...document.querySelectorAll('#grid .card')].map((e) => e.dataset.id); return ids.every((id, i) => now[i] === id); })()`);
      for (let i = 0; i < 8; i++) { await js(`document.getElementById('scroller').scrollBy(0, 2400)`); await wait(900); }
      const allIds = await js(`[...document.querySelectorAll('#grid .card')].map((e) => e.dataset.id)`);
      const held = new Set(heldBack.map((p) => p.id));
      const firstNewAt = allIds.findIndex((id) => held.has(id));
      // back to top, then a tab change (the line glides) and a paper opened, stepped and closed
      await js(`document.getElementById('to-top').click()`);
      await wait(1200);
      const atTop = await js(`document.getElementById('scroller').scrollTop`);
      await js(`document.querySelector('#modes [data-mode="trending"]').click()`);
      await wait(120);
      const inkMid = await ink();
      await wait(1800);
      const ink1 = await ink();
      await js(`document.querySelector('#grid .card .card-title').click()`);
      await wait(1200);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      await wait(1000);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      await wait(1000);
      const lastId = await js(`document.querySelector('#sheet .sheet-panel') && [...document.querySelectorAll('#grid .card')][2]?.dataset.id`);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      const closing = await js(`({ sheetHidden: document.getElementById('sheet').hidden, ghost: !!document.querySelector('.sheet-ghost') })`);
      await wait(120);
      await snap(`ui-closing-${lang}`);
      await wait(400);
      const after = await js(`({ ghostGone: !document.querySelector('.sheet-ghost'), flashed: document.querySelector('#grid .card.is-flash')?.dataset.id || '' })`);
      report.push({ name: 'grid ui', pill: await js(`!!document.getElementById('new-pill')`), ink0, inkMid, ink1, navDown, navUpTucked: navUp,
        added, statusNew, sameOnScreen, cardsBefore: beforeIds.length, cards: allIds.length, newShown: allIds.filter((id) => held.has(id)).length, firstNewAt,
        atTop, closing, after, lastId, cold: await js(`!document.getElementById('feed-cold').hidden`) });
    } else if (process.env.RI_SELFTEST_THEME) {
      // the Glass style: grid, a paper zooming out of its card and back, the swipe feed with its directions and
      // language switch (back on the same paper), light and dark, then Classic again
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const P = feed.store.papers;
      const js = (code) => wc.executeJavaScript(code);
      const snap = async (name) => fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
      const glassInfo = () => js(`(() => { const n = document.querySelector('.feed-nav'), d = document.getElementById('sw-actions');
        return { fl: document.documentElement.classList.contains('fl'), navFilter: n?.style.backdropFilter || '', dockFilter: d?.style.backdropFilter || '',
          filters: document.querySelectorAll('svg filter[id^="lg"]').length, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
          page: getComputedStyle(document.body).backgroundColor }; })()`);
      const swState = () => js(`(() => { const t = document.getElementById('sw-track');
        return { ids: [...t.querySelectorAll('.sw-card[data-id]')].map((e) => e.dataset.id), active: t.querySelector('.sw-card.is-active')?.dataset.id || '',
          dirBtn: !!document.getElementById('sw-dir'), topic: JSON.parse(localStorage.getItem('ri-sw-topic') || 'null'),
          lang: document.documentElement.dataset.lang, swipe: !document.getElementById('swipe').hidden }; })()`);
      nativeTheme.themeSource = 'light';
      await js(`localStorage.removeItem('ri-style'); localStorage.setItem('ri-feed-view', JSON.stringify({ mode: 'latest', topic: '', collection: '' })); localStorage.setItem('ri-view', '"grid"'); localStorage.setItem('ri-sw-topic', '""'); localStorage.setItem('ri-sw-mode', '"latest"'); localStorage.setItem('ri-sw-hinted', 'true')`);
      await open(path.join(outDir, 'en/papers.html'));
      await wait(3500);
      await snap('g-grid-light');
      const g0 = await glassInfo();
      const chromeLight = { ...colors };
      await js(`document.getElementById('scroller').scrollBy(0, 700)`);
      await wait(900);
      await snap('g-grid-scrolled');
      await js(`document.getElementById('scroller').scrollTo(0, 0)`);
      await wait(700);
      // a paper zooms out of its card, and back into it
      await js(`document.querySelectorAll('#grid .card')[1].querySelector('.card-title').click()`);
      await wait(130);
      await snap('g-zoom-mid');
      await wait(900);
      await snap('g-sheet');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await wait(110);
      await snap('g-unzoom-mid');
      await wait(700);
      const afterClose = await js(`({ ghost: !!document.querySelector('.sheet-ghost'), sheetHidden: document.getElementById('sheet').hidden })`);
      // the swipe feed: directions and language
      await js(`document.getElementById('view-btn').click()`);
      await wait(2600);
      await snap('g-swipe');
      const sw0 = await swState();
      await js(`document.getElementById('sw-dir').click()`);
      await wait(400);
      const topic = await js(`document.querySelectorAll('.dir-pop [data-dir]')[2]?.dataset.dir || ''`);
      await js(`document.querySelectorAll('.dir-pop [data-dir]')[2]?.click()`);
      await wait(2600);
      const sw1 = await swState();
      await snap('g-swipe-topic');
      const topicOk = sw1.ids.length > 0 && sw1.ids.every((id) => (P[id]?.topics || []).includes(topic));
      await js(`document.getElementById('sw-track').scrollBy({ top: document.getElementById('sw-track').clientHeight })`);
      await wait(1400);
      const before = await swState();
      await js(`document.querySelector('[data-sw-lang="zh"]').click()`);
      await wait(4500);
      const after = await swState();
      await snap('g-swipe-zh');
      await js(`document.getElementById('sw-menu-btn').click()`);
      await wait(700);
      await snap('g-menu');
      await js(`document.getElementById('sw-menu-btn').click()`);
      // dark
      nativeTheme.themeSource = 'dark';
      await wait(1200);
      await snap('g-swipe-dark');
      const gDark = await glassInfo();
      const chromeDark = { ...colors };
      await js(`document.getElementById('sw-grid').click()`);
      await wait(1500);
      await snap('g-grid-dark');
      await js(`document.querySelectorAll('#grid .card')[0].querySelector('.card-title').click()`);
      await wait(1300);
      await snap('g-sheet-dark');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await wait(600);
      // Classic again, in place
      nativeTheme.themeSource = 'light';
      await js(`window.RITheme.set('classic')`);
      await wait(1000);
      await snap('c-grid');
      const c0 = await glassInfo();
      const chromeClassic = { ...colors };
      await js(`document.getElementById('view-btn').click()`);
      await wait(2200);
      await snap('c-swipe');
      const stored = await js(`localStorage.getItem('ri-style')`);
      await js(`window.RITheme.set('glass'); document.getElementById('sw-grid').click()`);
      nativeTheme.themeSource = 'system';
      report.push({ name: 'theme', g0, chromeLight, afterClose, sw0: { chips: sw0.chips, cards: sw0.ids.length, topic: sw0.topic }, topic, topicOk, topicCards: sw1.ids.length,
        langBefore: { lang: before.lang, active: before.active }, langAfter: { lang: after.lang, active: after.active, swipe: after.swipe, topic: after.topic },
        resumed: !!before.active && before.active === after.active, gDark, chromeDark, c0, chromeClassic, stored });
    } else if (process.env.RI_SELFTEST_SHARE) {
      // the search up in the bar, a paper shared as an image (saved here to look at), copied; Interests and the
      // Saved tab in the swipe feed; About
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const lang = process.env.RI_SELFTEST_LANG || 'en';
      const js = (code) => wc.executeJavaScript(code);
      const snap = async (name) => fs.writeFileSync(path.join(dir, `${name}.png`), (await wc.capturePage()).toPNG());
      const saveCard = async (name) => {
        const b64 = await js(`(async () => { const img = document.querySelector('.share-img img'); if (!img) return ''; const buf = await (await fetch(img.src)).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); })()`);
        if (b64) fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
        return b64.length;
      };
      await js(`localStorage.setItem('ri-feed-view', JSON.stringify({ mode: 'latest', topic: '', collection: '' })); localStorage.setItem('ri-view', '"grid"'); localStorage.setItem('ri-sw-hinted', 'true'); localStorage.setItem('ri-sw-mode', '"latest"'); localStorage.setItem('ri-sw-topic', '""')`);
      await open(path.join(outDir, `${lang}/papers.html`));
      await wait(3000);
      await snap(`s-bar-${lang}`);
      const bar = await js(`(() => { const q = document.getElementById('fq'); return { inBar: !!q.closest('.bar'), brand: !!document.querySelector('.brand'), w: Math.round(q.getBoundingClientRect().width) }; })()`);
      // a paper → Share
      await js(`document.querySelectorAll('#grid .card')[0].querySelector('.card-title').click()`);
      await wait(1400);
      await js(`document.querySelector('[data-sheet="share"]').click()`);
      await wait(3500);
      await snap(`s-modal-${lang}`);
      const cardBytes = await saveCard(`s-card-${lang}`);
      clipboard.clear();
      await js(`document.querySelector('[data-share="copy"]')?.click()`);
      await wait(800);
      const copied = await clipboard.has('image/png');
      const note = await js(`document.querySelector('.share-note')?.textContent || ''`);
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await wait(500);
      const afterEsc = await js(`({ modal: !!document.querySelector('.share-modal'), sheet: !document.getElementById('sheet').hidden })`);
      await js(`document.querySelector('.sheet-close').click()`);
      await wait(600);
      // About
      await js(`document.querySelector('[data-about]').click()`);
      await wait(700);
      await snap(`s-about-${lang}`);
      const about = await js(`({ shown: !!document.querySelector('.about-pop'), text: document.querySelector('.about-pop')?.innerText || '' })`);
      await js(`document.body.click()`);
      // swipe: Interests shows, the Saved tab, share from the menu
      await js(`document.getElementById('view-btn').click()`);
      await wait(2500);
      await js(`document.getElementById('sw-menu-btn').click()`);
      await wait(300);
      await js(`document.querySelector('[data-sw-menu="tune"]').click()`);
      await wait(700);
      await snap(`s-tune-${lang}`);
      const tune = await js(`(() => { const p = document.getElementById('tune-pop'), r = p.getBoundingClientRect(); return { hidden: p.hidden, visibility: getComputedStyle(p).visibility, w: Math.round(r.width), h: Math.round(r.height), text: (document.getElementById('tune-text').value || '').length }; })()`);
      await js(`document.body.click()`);
      await wait(300);
      await js(`document.getElementById('sw-menu-btn').click()`);
      await wait(300);
      await js(`document.querySelector('[data-sw-menu="share"]').click()`);
      await wait(3500);
      await snap(`s-modal-swipe-${lang}`);
      const swipeCard = await saveCard(`s-card-swipe-${lang}`);
      await js(`document.querySelector('.share-x')?.click()`);
      await js(`document.querySelector('#sw-modes [data-sw-mode="saved"]').click()`);
      await wait(2200);
      await snap(`s-saved-${lang}`);
      const saved = await js(`[...document.querySelectorAll('#sw-track .sw-card[data-id]')].map((e) => e.dataset.id)`);
      const savedOk = saved.every((id) => !!feed.store.state.saves[id]);
      await js(`document.querySelector('#sw-modes [data-sw-mode="latest"]').click(); document.getElementById('sw-grid').click()`);
      // Top venues: only papers accepted at a top venue, each with its badge
      await js(`document.querySelector('#modes [data-mode="venues"]').click()`);
      await wait(2000);
      await snap(`s-venues-${lang}`);
      const venues = await js(`[...document.querySelectorAll('#grid .card')].map((e) => ({ id: e.dataset.id, badge: e.querySelector('.card-venue')?.textContent.trim() || '' }))`);
      await js(`document.querySelectorAll('#grid .card')[0]?.querySelector('.card-title').click()`);
      await wait(1400);
      await js(`document.querySelector('[data-sheet="share"]')?.click()`);
      await wait(5000);
      await saveCard(`s-card-venue-${lang}`);
      await js(`document.querySelector('.share-x')?.click(); document.querySelector('.sheet-close')?.click()`);
      await js(`document.querySelector('#modes [data-mode="latest"]').click()`);
      report.push({ name: 'share', venuesShown: venues.length, venuesAllBadged: venues.every((v) => v.badge), venueSample: venues.slice(0, 4), bar, cardBytes, copied, note, afterEsc, about, tune, savedCards: saved.length, savedTotal: Object.keys(feed.store.state.saves).length, savedOk, swipeCard });
    } else if (process.env.RI_SELFTEST_ZOOM) {
      // a paper zooming out of its card (grid and swipe): its opacity, every frame for 1.2 s, must rise and
      // stay up (a dip after it reached 1 is the flash of a replayed entrance)
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      const js = (code) => wc.executeJavaScript(code);
      await js(`localStorage.setItem('ri-feed-view', JSON.stringify({ mode: 'latest', topic: '', collection: '' })); localStorage.setItem('ri-view', '"grid"'); localStorage.removeItem('ri-style')`);
      await open(path.join(outDir, 'en/papers.html'));
      await wait(3000);
      const trace = (click) => js(`new Promise((done) => { const out = []; ${click}; const t0 = performance.now();
        const tick = () => { const p = document.querySelector('#sheet .sheet-panel'); out.push(p ? +getComputedStyle(p).opacity : -1);
          const cv = p?.querySelector('.sheet-media .cover'); if (cv?.classList.contains('has-fig') && !cv.classList.contains('fig-on')) out.art = (out.art || 0) + 1;
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick); else done({ o: out, art: out.art || 0, clip: getComputedStyle(p).clipPath, anims: p.getAnimations().length }); }; requestAnimationFrame(tick); })`);
      const dips = (o) => { let top = 0, worst = 0; for (const v of o) { top = Math.max(top, v); if (top >= 0.99) worst = Math.max(worst, top - v); } return +worst.toFixed(3); };
      const grid = await trace(`document.querySelectorAll('#grid .card')[1].querySelector('.card-title').click()`);
      await wait(300);
      // the scrollbar: not under a resting pointer, shown while the wheel turns, gone a moment later
      const body = await js(`(() => { const r = document.querySelector('#sheet .sheet-body').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      wc.sendInputEvent({ type: 'mouseMove', x: body.x, y: body.y });
      await wait(400);
      fs.writeFileSync(path.join(dir, 'z-sheet-hover.png'), (await wc.capturePage()).toPNG());
      wc.sendInputEvent({ type: 'mouseWheel', x: body.x, y: body.y, deltaX: 0, deltaY: -240 });
      await wait(200);
      fs.writeFileSync(path.join(dir, 'z-sheet-scrolling.png'), (await wc.capturePage()).toPNG());
      const scrolling = await js(`document.querySelector('#sheet .sheet-body').classList.contains('is-scrolling')`);
      await wait(1700);
      fs.writeFileSync(path.join(dir, 'z-sheet-after.png'), (await wc.capturePage()).toPNG());
      const after = await js(`document.querySelector('#sheet .sheet-body').classList.contains('is-scrolling')`);
      // back in the grid: the card's blue ring plays and the card itself never fades (no replayed entrance)
      const cardTrace = await js(`new Promise((done) => { document.querySelector('.sheet-close').click(); const card = document.querySelectorAll('#grid .card')[1]; const o = [], ring = []; const t0 = performance.now();
        const tick = () => { const cs = getComputedStyle(card); o.push(+cs.opacity); ring.push(cs.boxShadow !== 'none'); if (performance.now() - t0 < 2200) requestAnimationFrame(tick); else done({ minOpacity: Math.min(...o), ringFrames: ring.filter(Boolean).length, frames: o.length, ringAfter: ring[ring.length - 1] }); }; requestAnimationFrame(tick); })`);
      await wait(400);
      await js(`document.getElementById('view-btn').click()`);
      await wait(2500);
      const swipe = await trace(`document.querySelector('.sw-card.is-active .sw-abs').click()`);
      await js(`document.querySelector('.sheet-close').click(); document.getElementById('sw-grid').click()`);
      report.push({ name: 'zoom', scrollbar: { scrolling, after }, cardAfterClose: cardTrace, gridFrames: grid.o.length, gridDipAfterFull: dips(grid.o), gridArtFrames: grid.art, gridClipAfter: grid.clip, gridAnimsAfter: grid.anims,
        swipeFrames: swipe.o.length, swipeDipAfterFull: dips(swipe.o), swipeArtFrames: swipe.art, swipeClipAfter: swipe.clip, swipeAnimsAfter: swipe.anims });
    } else if (process.env.RI_SELFTEST_PAGE) {
      // one page, e.g. RI_SELFTEST_PAGE=zh/papers.html
      while (Object.keys(feed.store.papers).length < 50) await wait(2000);
      report.push(await shot('page', process.env.RI_SELFTEST_PAGE));
    } else {
      const firstDoc = fs.readdirSync(path.join(outDir, 'zh')).find((f) => f.endsWith('.html') && f !== 'index.html' && f !== 'papers.html');
      report.push(await shot('home-en', 'en/index.html'), await shot('home-zh', 'zh/index.html'));
      if (firstDoc) report.push(await shot('doc-zh', `zh/${firstDoc}`));
    }
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ packaged: app.isPackaged, docsDir, outDir, report }, null, 2));
  } catch (e) {
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ error: String(e.stack || e), docsDir, outDir }));
  }
  app.quit();
}
