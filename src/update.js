// Research index — the bar's ⋯ panel (language, style, updates, About) and updates from the GitHub releases.
// The app asks once each time it opens (unless turned off in the panel); "Check for updates" asks any time.
// A version you skip is not offered again when the app opens, only when you check yourself.
// Desktop: the installer downloads and starts (it installs over this copy); phone: the APK downloads in the
// browser and installs over this one.
(function () {
  'use strict';
  const html = document.documentElement;
  const U = window.portal?.update;
  const S = JSON.parse(document.getElementById('ri-strings')?.textContent || '{}');
  const t = (k, v = {}) => String(S[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = html.dataset.version || '';
  const android = html.dataset.platform === 'android';
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const parts = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  function newer(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  let latest = null;
  const pick = (info) => (info?.assets || []).find((a) => (android ? /\.apk$/i : /\.exe$/i).test(a.name));
  const hasNew = () => !!latest && newer(latest.version, VERSION);
  const skipped = () => hasNew() && get('ri-update-skip', '') === latest.version;

  // ---------- the panel ----------
  const pop = document.getElementById('about-pop');
  // it is built into the bar, which the phone hides under the swipe feed: it lives on <body>
  if (pop && pop.parentElement !== document.body) document.body.appendChild(pop);
  const status = (text, tone = '') => {
    const n = pop?.querySelector('.ab-status');
    if (!n) return;
    n.textContent = text;
    n.dataset.tone = tone;
  };
  function paintState() {
    document.querySelectorAll('.about-dot').forEach((d) => { d.hidden = !(hasNew() && !skipped()); });
    if (!pop) return;
    if (hasNew()) status(skipped() ? t('skipped', { v: latest.version }) : t('available', { v: latest.version }), skipped() ? '' : 'new');
    const auto = pop.querySelector('[data-ab="auto"]');
    if (auto) auto.checked = !!get('ri-update-auto', true);
    if (!U) pop.querySelectorAll('[data-ab="check"], [data-ab="auto"]').forEach((n) => { n.closest('.ab-row').hidden = true; });
  }
  function openPanel() {
    if (!pop) return;
    paintState();
    pop.hidden = false;
    document.querySelectorAll('[data-about]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  }
  function closePanel() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    document.querySelectorAll('[data-about]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-about]')) { e.stopPropagation(); if (pop?.hidden) openPanel(); else closePanel(); return; }
    if (pop && !pop.hidden && !e.target.closest('#about-pop')) closePanel();
  });
  pop?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-ab="check"]')) return;
    if (hasNew() && !skipped() && latest) { closePanel(); offer(latest); return; }
    check(true);
  });
  pop?.addEventListener('change', (e) => { if (e.target.dataset.ab === 'auto') set('ri-update-auto', e.target.checked); });

  // ---------- the check ----------
  let checking = false;
  async function check(manual) {
    if (!U || checking) return;
    checking = true;
    if (manual) status(t('checking'), 'busy');
    const res = await U.check().catch((e) => ({ error: String(e) }));
    checking = false;
    if (!res || res.error || !res.version) { if (manual) status(t('checkFailed'), 'error'); return; }
    latest = res;
    keep();
    paintState();
    if (!hasNew()) { if (manual) status(t('upToDate'), 'ok'); return; }
    if (manual || !skipped()) { closePanel(); offer(res); }
  }

  // ---------- a new version: download it, skip it, or later ----------
  let dialog = null;
  function closeDialog() { if (!dialog) return; const d = dialog; dialog = null; d.classList.add('is-leaving'); setTimeout(() => d.remove(), 220); }
  // the release notes, in the page's language (they hold English, then "---", then Chinese), as a short list
  function notesHtml(body) {
    let text = String(body || '');
    const halves = text.split(/\n-{3,}\n/);
    if (halves.length > 1) text = html.dataset.lang === 'zh' ? halves[halves.length - 1] : halves[0];
    const items = text.split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l))
      .map((l) => l.replace(/^[-*] /, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'));
    return items.length ? `<ul class="up-notes">${items.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
  }
  function offer(res) {
    closeDialog();
    const asset = pick(res);
    dialog = document.createElement('div');
    dialog.className = 'update-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `<div class="share-backdrop" data-up="later"></div>
      <div class="update-panel">
        <div class="up-head"><img class="ab-icon" src="../assets/icon.svg" alt=""><div><h3>${esc(t('updateTitle', { v: res.version }))}</h3><p class="up-from">${esc(VERSION)} → ${esc(res.version)}</p></div></div>
        ${notesHtml(res.notes)}
        <button type="button" class="btn-primary up-main" data-up="get">${esc(t(asset && !android ? 'updateInstall' : 'updateDownload'))}</button>
        <p class="up-status" role="status"></p>
        <div class="up-more"><button type="button" class="link-btn" data-up="skip">${esc(t('updateSkip'))}</button><button type="button" class="link-btn" data-up="later" data-back-close>${esc(t('updateLater'))}</button></div>
      </div>`;
    document.body.appendChild(dialog);
    const d = dialog;
    const say = (s) => { d.querySelector('.up-status').textContent = s; };
    d.addEventListener('click', async (e) => {
      const kind = e.target.closest('[data-up]')?.dataset.up;
      if (kind === 'later') return closeDialog();
      if (kind === 'skip') { set('ri-update-skip', res.version); paintState(); return closeDialog(); }
      if (kind !== 'get') return;
      if (!asset) { openPage(res.url); return closeDialog(); }
      const btn = d.querySelector('[data-up="get"]');
      btn.disabled = true;
      const off = U.onProgress?.((p) => say(t('downloading', { p })));
      say(android ? '' : t('downloading', { p: 0 }));
      const r = await U.install(asset.url).catch((err) => ({ ok: false, error: String(err) }));
      off?.();
      if (r?.ok) { say(android ? '' : t('updateOpening')); if (android) closeDialog(); return; }
      btn.disabled = false;
      say(t('checkFailed'));
      openPage(res.url);
    });
  }
  function openPage(url) {
    if (!url) return;
    if (window.portal?.openUrl) window.portal.openUrl(url); else window.open(url, '_blank', 'noopener');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dialog) { e.stopPropagation(); closeDialog(); } else if (pop && !pop.hidden) { e.stopPropagation(); closePanel(); }
  }, true);
  window.RIUpdate = { about: openPanel, check: () => check(true) };

  // ---------- when the app opens: once per session (the pages share it), a few seconds in ----------
  function keep() { try { if (latest) sessionStorage.setItem('ri-update-latest', JSON.stringify(latest)); } catch { /* ignore */ } }
  let asked = false;
  try { asked = sessionStorage.getItem('ri-update-asked') === '1'; latest = JSON.parse(sessionStorage.getItem('ri-update-latest') || 'null'); } catch { /* ignore */ }
  paintState();
  if (U && get('ri-update-auto', true) && !asked) {
    try { sessionStorage.setItem('ri-update-asked', '1'); } catch { /* ignore */ }
    setTimeout(() => check(false), 4000);
  }
})();
