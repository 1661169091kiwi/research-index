// Research index — export papers you picked in Saved or Liked (long-press one to start picking): as Markdown
// (a list to keep in notes) or as one long image. A small panel picks the format and whether to include
// abstracts; the result is shown first,
// then saved or shared (desktop: a file dialog or the clipboard; phone: the share sheet, or Downloads / the gallery).
// Uses the page's feed script (window.RIFeed) and the share card's drawing kit (window.RIShare.kit).
(function () {
  'use strict';
  const F = window.RIFeed;
  if (!F) return;
  const { api, t, lang, esc, tex, shortDate } = F;
  const portal = window.portal || {};
  const phone = !!(portal.shareImage || portal.shareText);
  const plain = (s) => tex(String(s || '')).replace(/\s+/g, ' ').trim();
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- the papers of a list, all of them ----------
  async function gather(mode, ids) {
    const out = [];
    for (let offset = 0; offset < 3000;) {
      const r = await api.list({ mode, offset, limit: 100, withAbstract: true, minQ: 0 });
      const items = r?.items || [];
      out.push(...items);
      offset += items.length;
      if (!items.length || offset >= (r.total ?? 0)) break;
    }
    if (!ids) return out;
    const want = new Set(ids);
    return out.filter((p) => want.has(p.id));
  }
  async function counts() {
    const [s, l] = await Promise.all(['saved', 'liked'].map((mode) => api.list({ mode, offset: 0, limit: 1, minQ: 0 })));
    return { saved: s?.total || 0, liked: l?.total || 0 };
  }
  const titleOf = (p) => (F.trOn && p.title_zh ? p.title_zh : p.title);
  const absOf = (p) => (F.trOn && p.abstract_zh ? p.abstract_zh : p.abstract || '');
  const authorsOf = (p, n = 6) => {
    const a = p.authors || [];
    const more = Math.max(a.length, p.nAuthors || 0) > n;
    return a.slice(0, n).join(', ') + (more ? (lang === 'zh' ? ' 等' : ' et al.') : '');
  };
  const instsOf = (p) => (p.inst || []).slice(0, 3).map((x) => F.instName(x)).join(lang === 'zh' ? '、' : ', ') || p.org || '';
  const venueOf = (p) => (p.venue ? `${p.venue.label}${p.venue.note ? ` · ${p.venue.note}` : ''}` : '');
  const heading = (mode) => t(mode === 'liked' ? 'exHeadLiked' : 'exHeadSaved');

  // ---------- Markdown ----------
  function markdown(mode, papers, withAbs) {
    const mdEsc = (s) => String(s).replace(/([\\`*_[\]<>#|])/g, '\\$1');
    const out = [`# ${heading(mode)}`, '', `> ${t('exAt', { d: today(), n: papers.length })} · Research Index`, ''];
    papers.forEach((p, i) => {
      const zh = F.trOn && p.title_zh;
      out.push(`## ${i + 1}. ${mdEsc(plain(titleOf(p)))}`, '');
      if (zh) out.push(`*${mdEsc(plain(p.title))}*`, '');
      const meta = [];
      const who = authorsOf(p, 8);
      if (who) meta.push(`- **${t('exAuthors')}**: ${mdEsc(who)}`);
      const inst = instsOf(p);
      if (inst) meta.push(`- **${t('exInst')}**: ${mdEsc(inst)}`);
      meta.push(`- **${t('exDate')}**: ${shortDate(p.published || '')}${p.venue ? ` · ⭐ ${mdEsc(venueOf(p))}` : ''}${p.q != null ? ` · ${t('exScore')} ${p.q}/100` : ''}`);
      meta.push(`- **${t('exLinks')}**: [arXiv](https://arxiv.org/abs/${p.id}) · [PDF](https://arxiv.org/pdf/${p.id})`);
      out.push(...meta, '');
      const abs = withAbs && plain(absOf(p));
      if (abs) out.push(`> ${abs}`, '');
    });
    return out.join('\n');
  }

  // ---------- the long image ----------
  const MAX_H = 30000; // a canvas taller than about 32 000 px cannot be drawn
  async function image(mode, papers, withAbs) {
    const K = window.RIShare?.kit;
    if (!K) throw new Error('no drawing kit');
    const { lines, roundRect, qrDraw, font, C, W, REPO, APP_URL, loadImage } = K;
    const PAD = 64, NUM = 60, inner = W - 2 * PAD - NUM;
    const text = papers.map((p) => [titleOf(p), p.title, authorsOf(p), instsOf(p), withAbs ? absOf(p) : ''].join(' ')).join(' ');
    await Promise.all([font(700, 40), font(500, 26), font(400, 27), font(700, 52)].map((f) => document.fonts?.load(f, `${heading(mode)} ${text}`).catch(() => {})));
    const icon = await loadImage('../assets/icon.svg');
    const m = document.createElement('canvas').getContext('2d');
    // measure every paper, then keep as many as one image can hold
    const HEAD = 228, FOOT = 230;
    const blocks = [];
    let h = HEAD;
    for (const p of papers) {
      const zh = F.trOn && p.title_zh;
      m.font = font(700, 38); const T = lines(m, titleOf(p), inner, 4);
      m.font = font(500, 25); const O = zh ? lines(m, p.title, inner, 2) : [];
      m.font = font(400, 26); const A = lines(m, [authorsOf(p), instsOf(p)].filter(Boolean).join(' · '), inner, 2);
      m.font = font(400, 28); const B = withAbs ? lines(m, absOf(p), inner, 7) : [];
      const bh = 40 + T.length * 50 + (O.length ? 8 + O.length * 35 : 0) + (A.length ? 14 + A.length * 37 : 0) + 18 + 44 + (B.length ? 18 + B.length * 43 : 0) + 40;
      if (h + bh + FOOT > MAX_H) break;
      blocks.push({ p, T, O, A, B, bh });
      h += bh;
    }
    h = Math.ceil(h + FOOT);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, h);
    // head: the app, which list, when
    let y = PAD;
    if (icon) ctx.drawImage(icon, PAD, y, 84, 84);
    const hx = PAD + (icon ? 84 + 26 : 0);
    ctx.font = font(700, 52); ctx.fillStyle = C.ink; ctx.fillText(heading(mode), hx, y + 50);
    ctx.font = font(500, 27); ctx.fillStyle = C.muted; ctx.fillText(t('exAt', { d: today(), n: blocks.length }), hx, y + 88);
    y = HEAD - 2;
    ctx.fillStyle = C.hair; ctx.fillRect(PAD, y, W - 2 * PAD, 2);
    const pill = (label, x, yy, bg, fg) => {
      ctx.font = font(700, 23);
      const w = ctx.measureText(label).width + 28;
      roundRect(ctx, x, yy, w, 38, 19, bg);
      ctx.fillStyle = fg; ctx.fillText(label, x + 14, yy + 27);
      return x + w + 12;
    };
    blocks.forEach(({ p, T, O, A, B, bh }, i) => {
      let yy = y + 40;
      const x = PAD + NUM;
      // the number, then title, original title, authors · institutions
      ctx.font = font(700, 30); ctx.fillStyle = C.muted; ctx.textAlign = 'right';
      ctx.fillText(String(i + 1).padStart(2, '0'), PAD + NUM - 18, yy + 36); ctx.textAlign = 'left';
      ctx.font = font(700, 38); ctx.fillStyle = C.ink;
      T.forEach((l, k) => ctx.fillText(l, x, yy + 38 + k * 50));
      yy += T.length * 50;
      if (O.length) { yy += 8; ctx.font = font(500, 25); ctx.fillStyle = C.muted; O.forEach((l, k) => ctx.fillText(l, x, yy + 28 + k * 35)); yy += O.length * 35; }
      if (A.length) { yy += 14; ctx.font = font(400, 26); ctx.fillStyle = C.ink2; A.forEach((l, k) => ctx.fillText(l, x, yy + 29 + k * 37)); yy += A.length * 37; }
      // date, venue, score, arXiv id
      yy += 18;
      let px = x;
      ctx.font = font(500, 24); ctx.fillStyle = C.muted;
      const date = shortDate(p.published || '');
      ctx.fillText(date, px, yy + 27); px += ctx.measureText(date).width + 16;
      if (p.venue) px = pill(`★ ${venueOf(p)}`, px, yy, '#fff4d6', '#8a5a00');
      if (p.q != null) px = pill(`${t('exScore')} ${p.q}`, px, yy, '#e8f1ff', '#0a58c2');
      ctx.font = font(500, 24); ctx.fillStyle = C.blue; ctx.textAlign = 'right';
      ctx.fillText(`arXiv:${p.id}`, W - PAD, yy + 27); ctx.textAlign = 'left';
      yy += 44;
      if (B.length) { yy += 18; ctx.font = font(400, 28); ctx.fillStyle = '#2b2d31'; B.forEach((l, k) => ctx.fillText(l, x, yy + 32 + k * 43)); }
      y += bh;
      if (i < blocks.length - 1) { ctx.fillStyle = C.hair; ctx.fillRect(PAD + NUM, y - 1, W - 2 * PAD - NUM, 2); }
    });
    // foot: where to get the app
    ctx.fillStyle = C.page; ctx.fillRect(0, y, W, h - y);
    const fy = y + (FOOT - 150) / 2;
    ctx.font = font(700, 31); ctx.fillStyle = C.ink; ctx.fillText(t('shareApp'), PAD, fy + 52);
    ctx.font = font(500, 26); ctx.fillStyle = C.ink2; ctx.fillText(t('shareGet'), PAD, fy + 94);
    ctx.font = font(500, 24); ctx.fillStyle = C.blue; ctx.fillText(`github.com/${REPO}`, PAD, fy + 132);
    roundRect(ctx, W - PAD - 150, fy, 150, 150, 16, '#ffffff');
    qrDraw(ctx, APP_URL, W - PAD - 150 + 11, fy + 11, 128);
    const blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
    return { blob, shown: blocks.length };
  }

  // ---------- the panel: which list, which format ----------
  let panel = null;
  const pick = { mode: 'saved', fmt: 'md', abs: true, ids: null };
  function closePanel() {
    if (!panel) return;
    const p = panel;
    panel = null;
    p.classList.add('is-leaving');
    setTimeout(() => p.remove(), 260);
    if (!result) document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (result) closeResult(); else closePanel(); } }
  const ICON_MD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 15V9l2.5 3L11 9v6M15.5 9v6m0 0l-2-2.2m2 2.2l2-2.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_IMG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9.5" r="1.8" fill="currentColor"/><path d="M4 18l5-5 3.5 3.5L16 13l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  // open({ mode: 'saved' | 'liked', ids }): export those papers of that list (ids omitted: the whole list)
  async function open(arg) {
    if (panel) return;
    const { mode, ids } = typeof arg === 'string' ? { mode: arg, ids: null } : arg || {};
    pick.mode = mode === 'liked' ? 'liked' : 'saved';
    pick.ids = Array.isArray(ids) && ids.length ? [...ids] : null;
    document.querySelectorAll('[data-pop]').forEach((el) => { if (el.dataset.pop === 'remove') (window.riPopRemove || ((x) => x.remove()))(el); else el.hidden = true; });
    panel = document.createElement('div');
    panel.className = 'ex-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('exTitle'));
    panel.innerHTML = `<div class="ex-scrim" data-ex-close></div>
      <section class="ex-panel" data-glass="menu">
        <header class="ex-head"><h2>${esc(t('exTitle'))}</h2><button type="button" class="ex-x" data-ex-close data-back-close aria-label="${esc(t('close'))}">×</button></header>
        ${pick.ids ? `<p class="ex-sub">${esc(t('exPicked', { n: pick.ids.length, list: t(pick.mode === 'liked' ? 'exLiked' : 'exSaved') }))}</p>` : `<div class="ex-seg" role="radiogroup" aria-label="${esc(t('exWhich'))}">
          <button type="button" role="radio" data-ex-mode="saved">${esc(t('exSaved'))}<span class="ex-n" data-n="saved"></span></button>
          <button type="button" role="radio" data-ex-mode="liked">${esc(t('exLiked'))}<span class="ex-n" data-n="liked"></span></button>
          <i class="ex-seg-thumb" aria-hidden="true"></i>
        </div>`}
        <div class="ex-fmts" role="radiogroup" aria-label="${esc(t('exFormat'))}">
          <button type="button" role="radio" class="ex-fmt" data-ex-fmt="md">${ICON_MD}<b>Markdown</b><span>${esc(t('exMdHint'))}</span></button>
          <button type="button" role="radio" class="ex-fmt" data-ex-fmt="img">${ICON_IMG}<b>${esc(t('exImg'))}</b><span>${esc(t('exImgHint'))}</span></button>
        </div>
        <label class="ex-opt"><span>${esc(t('exAbs'))}</span><input type="checkbox" class="ab-switch" data-ex-abs${pick.abs ? ' checked' : ''}></label>
        <button type="button" class="ex-go" data-ex-go disabled><span>${esc(t('exGo', { n: '…' }))}</span></button>
      </section>`;
    document.body.appendChild(panel);
    document.addEventListener('keydown', onKey, true);
    const p = panel;
    const n = { saved: 0, liked: 0 };
    const paint = () => {
      p.querySelectorAll('[data-ex-mode]').forEach((b) => { const on = b.dataset.exMode === pick.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
      p.querySelector('.ex-seg')?.classList.toggle('is-second', pick.mode === 'liked');
      p.querySelectorAll('[data-ex-fmt]').forEach((b) => { const on = b.dataset.exFmt === pick.fmt; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
      const go = p.querySelector('[data-ex-go]');
      go.disabled = !n[pick.mode];
      go.querySelector('span').textContent = n[pick.mode] ? t('exGo', { n: n[pick.mode] }) : t('exEmpty');
    };
    if (pick.ids) { n[pick.mode] = pick.ids.length; paint(); }
    else paint();
    if (!pick.ids) counts().then((c) => {
      if (panel !== p) return;
      Object.assign(n, c);
      p.querySelector('[data-n="saved"]').textContent = c.saved;
      p.querySelector('[data-n="liked"]').textContent = c.liked;
      // the list asked for is empty and the other is not: start on the other one
      if (!n[pick.mode] && n[pick.mode === 'saved' ? 'liked' : 'saved']) pick.mode = pick.mode === 'saved' ? 'liked' : 'saved';
      paint();
    });
    p.addEventListener('change', (e) => { if (e.target.matches('[data-ex-abs]')) pick.abs = e.target.checked; });
    p.addEventListener('click', async (e) => {
      if (e.target.closest('[data-ex-close]')) return closePanel();
      const md = e.target.closest('[data-ex-mode]');
      if (md) { pick.mode = md.dataset.exMode; return paint(); }
      const fm = e.target.closest('[data-ex-fmt]');
      if (fm) { pick.fmt = fm.dataset.exFmt; return paint(); }
      const go = e.target.closest('[data-ex-go]');
      if (!go || go.disabled) return;
      go.disabled = true;
      go.classList.add('is-busy');
      go.querySelector('span').textContent = t('exWorking');
      try {
        const papers = await gather(pick.mode, pick.ids);
        if (panel !== p) return;
        if (pick.fmt === 'md') showResult({ kind: 'md', text: markdown(pick.mode, papers, pick.abs), mode: pick.mode, n: papers.length });
        else {
          const { blob, shown } = await image(pick.mode, papers, pick.abs);
          if (panel !== p) return;
          showResult({ kind: 'img', blob, mode: pick.mode, n: papers.length, shown });
        }
        closePanel();
      } catch (err) {
        console.error(err);
        go.classList.remove('is-busy');
        go.querySelector('span').textContent = t('shareFailed');
        setTimeout(() => { if (panel === p) paint(); }, 1800);
      }
    });
  }

  // ---------- the result: shown first, then saved, copied or shared ----------
  let result = null;
  function closeResult() {
    if (!result) return;
    const m = result;
    result = null;
    URL.revokeObjectURL(m.dataset.url || '');
    m.classList.add('is-leaving');
    setTimeout(() => m.remove(), 220);
    if (!panel) document.removeEventListener('keydown', onKey, true);
  }
  async function showResult(r) {
    closeResult();
    const name = `research-index-${r.mode}-${today()}.${r.kind === 'md' ? 'md' : 'png'}`;
    const buttons = r.kind === 'md'
      ? (phone
        ? `<button type="button" class="primary" data-ex="share">${esc(t('shareSend'))}</button><button type="button" data-ex="save">${esc(t('exSave'))}</button>`
        : `<button type="button" data-ex="copy">${esc(t('exCopy'))}</button><button type="button" class="primary" data-ex="save">${esc(t('exSaveAs'))}</button>`)
      : (phone
        ? `<button type="button" class="primary" data-ex="share">${esc(t('shareSend'))}</button><button type="button" data-ex="save">${esc(t('shareSave'))}</button>`
        : `${portal.copyImage ? `<button type="button" data-ex="copy">${esc(t('shareCopy'))}</button>` : ''}<button type="button" class="primary" data-ex="save">${esc(t('shareSave'))}</button>`);
    const m = document.createElement('div');
    m.className = 'share-modal ex-result';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', t('exTitle'));
    let url = '';
    if (r.kind === 'img') { url = URL.createObjectURL(r.blob); m.dataset.url = url; }
    m.innerHTML = `<div class="share-scroll" data-ex-bg><div class="share-img${r.kind === 'md' ? ' ex-md-wrap' : ''}" data-ex-bg>${r.kind === 'md'
      ? `<pre class="ex-md">${esc(r.text)}</pre>`
      : `<img src="${url}" alt="${esc(heading(r.mode))}">`}</div></div>
      <button type="button" class="share-x" data-glass="round" data-ex-done data-back-close aria-label="${esc(t('close'))}">×</button>
      <div class="share-bar" data-glass="dock">${buttons}</div>
      <p class="share-note" data-glass="banner" role="status" hidden></p>`;
    document.body.appendChild(m);
    result = m;
    document.addEventListener('keydown', onKey, true);
    let noteTimer = 0;
    const note = (s) => {
      const n = m.querySelector('.share-note');
      n.textContent = s; n.hidden = !s;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { n.hidden = true; }, 2800);
    };
    if (r.kind === 'img' && r.shown < r.n) note(t('exCut', { n: r.shown }));
    const bytes = r.kind === 'img' ? new Uint8Array(await r.blob.arrayBuffer()) : null;
    m.addEventListener('click', async (e) => {
      if (e.target.closest('[data-ex-done]') || e.target.matches('[data-ex-bg]')) return closeResult();
      const kind = e.target.closest('[data-ex]')?.dataset.ex;
      if (!kind) return;
      try {
        if (r.kind === 'md') {
          if (kind === 'copy') { await navigator.clipboard.writeText(r.text); note(t('exCopied')); return; }
          if (kind === 'share') { await portal.shareText(name, r.text, t('exTitle')); return; }
          if (portal.saveText) {
            const s = await portal.saveText(name, r.text);
            if (s?.ok) { if (!s.shared) note(t('shareSaved', { where: s.path || '' })); }
            else if (s && !s.canceled) { if (phone && portal.shareText) await portal.shareText(name, r.text, t('exTitle')); else note(t('shareFailed')); }
            return;
          }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([r.text], { type: 'text/markdown' }));
          a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          return;
        }
        if (kind === 'share') { await portal.shareImage(name, bytes, t('exTitle'), ''); return; }
        if (kind === 'copy') { const c = await portal.copyImage(bytes); note(c?.ok ? t('shareCopied') : t('shareFailed')); return; }
        if (portal.saveImage) {
          const s = await portal.saveImage(name, bytes);
          if (s?.ok) note(t('shareSaved', { where: s.path || '' }));
          else if (s && !s.canceled) { if (phone) await portal.shareImage(name, bytes, t('exTitle'), ''); else note(t('shareFailed')); }
          return;
        }
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
      } catch (err) { note(t('shareFailed')); console.error(err); }
    });
  }

  window.RIExport = { open, close() { closeResult(); closePanel(); } };
})();
