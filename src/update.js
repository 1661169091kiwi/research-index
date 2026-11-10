// Research index — About, and updates from the GitHub releases. The app asks once each time it opens (unless
// that is turned off in About); "Check for updates" asks any time. A version you skip is not offered again when
// the app opens, only when you check yourself. Desktop: the installer downloads and starts (it installs over
// this copy); phone: the APK downloads in the browser and installs over this one.
(function () {
  'use strict';
  const html = document.documentElement;
  const U = window.portal?.update;
  const S = JSON.parse(document.getElementById('ri-strings')?.textContent || '{}');
  const t = (k, v = {}) => String(S[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = html.dataset.version || '';
  const REPO = html.dataset.repo || '';
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
  const dot = () => document.querySelectorAll('.about-dot').forEach((d) => { d.hidden = !(latest && newer(latest.version, VERSION) && get('ri-update-skip', '') !== latest.version); });

  // ---------- the check ----------
  async function check(manual, status) {
    if (!U) return;
    status?.(t('checking'));
    const res = await U.check().catch((e) => ({ error: String(e) }));
    if (!res || res.error || !res.version) { status?.(t('checkFailed')); return; }
    latest = res;
    dot();
    if (!newer(res.version, VERSION)) { status?.(t('upToDate')); return; }
    status?.('');
    if (manual || get('ri-update-skip', '') !== res.version) offer(res);
  }

  // ---------- a new version: download it, skip it, or later ----------
  let dialog = null;
  function closeDialog() { if (!dialog) return; const d = dialog; dialog = null; d.classList.add('is-leaving'); setTimeout(() => d.remove(), 220); }
  function offer(res) {
    closeDialog();
    const asset = pick(res);
    const notes = String(res.notes || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
    dialog = document.createElement('div');
    dialog.className = 'update-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `<div class="share-backdrop" data-up="later"></div>
      <div class="update-panel">
        <p class="up-eyebrow">${esc(t('version', { v: VERSION }))} → ${esc(res.version)}</p>
        <h3>${esc(t('updateTitle', { v: res.version }))}</h3>
        ${notes ? `<div class="up-notes"><b>${esc(t('updateNotes'))}</b><p>${esc(notes)}</p></div>` : ''}
        <div class="up-actions">
          <button type="button" class="btn-primary" data-up="get">${esc(t(asset && !android ? 'updateInstall' : 'updateDownload'))}</button>
          <button type="button" class="tool" data-up="skip">${esc(t('updateSkip'))}</button>
          <button type="button" class="tool ghost" data-up="later" data-back-close>${esc(t('updateLater'))}</button>
        </div>
        <p class="up-status" role="status"></p>
      </div>`;
    document.body.appendChild(dialog);
    const d = dialog;
    const status = (s) => { d.querySelector('.up-status').textContent = s; };
    d.addEventListener('click', async (e) => {
      const kind = e.target.closest('[data-up]')?.dataset.up;
      if (kind === 'later') return closeDialog();
      if (kind === 'skip') { set('ri-update-skip', res.version); dot(); return closeDialog(); }
      if (kind !== 'get') return;
      if (!asset) { openPage(res.url); return closeDialog(); }
      const btn = d.querySelector('[data-up="get"]');
      btn.disabled = true;
      const off = U.onProgress?.((p) => status(t('downloading', { p })));
      status(android ? '' : t('downloading', { p: 0 }));
      const r = await U.install(asset.url).catch((err) => ({ ok: false, error: String(err) }));
      off?.();
      if (r?.ok) { status(android ? '' : t('updateOpening')); if (android) closeDialog(); return; }
      btn.disabled = false;
      status(t('checkFailed'));
      openPage(res.url);
    });
  }
  function openPage(url) {
    if (!url) return;
    if (window.portal?.openUrl) window.portal.openUrl(url); else window.open(url, '_blank', 'noopener');
  }

  // ---------- About ----------
  // the language and style toggles, cloned from the top bar (which on the phone hides them)
  const langRow = () => { const n = document.querySelector('.bar .lang:not(.style-switch)'); return n ? `<div class="sw-set"><span>${esc(S.langName || 'Language')}</span>${n.outerHTML}</div>` : ''; };
  const styleRow = () => { const n = document.querySelector('.bar .style-switch'); return n ? `<div class="sw-set"><span>${esc(S.styleLabel || 'Style')}</span>${n.outerHTML}</div>` : ''; };
  let pop = null;
  function closeAbout() { pop?.remove(); pop = null; }
  function about() {
    if (pop) return closeAbout();
    pop = document.createElement('div');
    pop.className = 'about-pop';
    pop.dataset.glass = 'menu';
    pop.innerHTML = `<div class="ab-head"><b>${esc(document.title.split(/[—·]/).pop().trim() || 'Research Index')}</b><button type="button" class="share-x" data-ab="close" data-back-close aria-label="×">×</button></div>
      <p class="ab-ver">${esc(t('version', { v: VERSION }))}</p>
      <div class="ab-sets">${langRow()}${styleRow()}</div>
      ${U ? `<label class="ab-auto"><input type="checkbox" data-ab="auto"${get('ri-update-auto', true) ? ' checked' : ''}> ${esc(t('autoCheck'))}</label>
      <div class="ab-row"><button type="button" class="btn-primary" data-ab="check">${esc(t('checkUpdates'))}</button></div>
      <p class="ab-status" role="status"></p>` : ''}
      <a class="link-btn ab-link" href="https://github.com/${esc(REPO)}" target="_blank" rel="noopener">${esc(t('projectPage'))} ↗</a>`;
    document.body.appendChild(pop);
    const status = (s) => { const n = pop?.querySelector('.ab-status'); if (n) n.textContent = s; };
    if (latest && newer(latest.version, VERSION) && get('ri-update-skip', '') === latest.version) status(t('skipped', { v: latest.version }));
    pop.addEventListener('click', (e) => {
      const kind = e.target.closest('[data-ab]')?.dataset.ab;
      if (kind === 'close') closeAbout();
      if (kind === 'check') check(true, status);
    });
    pop.addEventListener('change', (e) => { if (e.target.dataset.ab === 'auto') set('ri-update-auto', e.target.checked); });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-about]')) { e.stopPropagation(); about(); return; }
    if (pop && !e.target.closest('.about-pop')) closeAbout();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dialog) { e.stopPropagation(); closeDialog(); } else if (pop) { e.stopPropagation(); closeAbout(); }
  }, true);
  window.RIUpdate = { about, check: () => check(true) };

  // ---------- when the app opens: once per session (the pages share it), a few seconds in ----------
  if (U && get('ri-update-auto', true)) {
    let asked = false;
    try { asked = sessionStorage.getItem('ri-update-asked') === '1'; sessionStorage.setItem('ri-update-asked', '1'); } catch { /* ignore */ }
    if (!asked) setTimeout(() => check(false), 4000);
    else { try { latest = JSON.parse(sessionStorage.getItem('ri-update-latest') || 'null'); } catch { /* ignore */ } dot(); }
  }
  const keep = () => { try { if (latest) sessionStorage.setItem('ri-update-latest', JSON.stringify(latest)); } catch { /* ignore */ } };
  window.addEventListener('pagehide', keep);
})();
