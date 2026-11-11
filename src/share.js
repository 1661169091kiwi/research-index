// Research index — share a paper as an image: a card with its direction, title, authors and abstract, a QR code
// to the paper, and where to get the app (a second QR code). The card is drawn on a canvas in the page.
// Desktop: save it (a file dialog) or copy it; phone: the Android share sheet, or the gallery.
// Uses the page's feed script through window.RIFeed, and qrcode-generator (MIT, Kazuhiko Arase).
(function () {
  'use strict';
  const F = window.RIFeed;
  if (!F || typeof window.qrcode !== 'function') return;
  const { api, t, lang, esc, tex, topicLabel, shortDate } = F;
  const html = document.documentElement;
  const REPO = html.dataset.repo || '';
  const APP_URL = `https://github.com/${REPO}/releases/latest`;
  const W = 1080, PAD = 76;
  const FAMILY = '"Inter Variable", "Inter", "Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif';
  const font = (weight, px) => `${weight} ${px}px ${FAMILY}`;
  const portal = window.portal || {};
  const C = { ink: '#1b1c20', ink2: '#44474e', muted: '#6f727a', hair: '#e5e6ea', block: '#f2f3f6', page: '#eeeff2', blue: '#007aff' };

  // ---------- text ----------
  const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
  const TOKENS = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, 'g');
  const plain = (s) => tex(String(s || '')).replace(/\s+/g, ' ').trim();
  // Chinese breaks between any two characters, English between words; a word wider than the line is split
  function lines(ctx, text, width, max) {
    const all = [];
    let line = '';
    for (let tok of plain(text).match(TOKENS) || []) {
      if (!line && /^\s+$/.test(tok)) continue;
      if (ctx.measureText((line + tok).trimEnd()).width <= width) { line += tok; continue; }
      if (line) { all.push(line.trimEnd()); line = ''; }
      while (ctx.measureText(tok.trimEnd()).width > width) {
        let i = tok.length - 1;
        while (i > 1 && ctx.measureText(tok.slice(0, i)).width > width) i--;
        all.push(tok.slice(0, i));
        tok = tok.slice(i);
      }
      line = /^\s+$/.test(tok) ? '' : tok;
    }
    if (line.trim()) all.push(line.trimEnd());
    if (all.length <= max) return all;
    const out = all.slice(0, max);
    let last = out[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[max - 1] = `${last.replace(/[\s,.;:，。；：、]+$/, '')}…`;
    return out;
  }

  // ---------- the card ----------
  function qrDraw(ctx, text, x, y, size) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), cell = size / n;
    ctx.fillStyle = C.ink;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(Math.floor(x + c * cell), Math.floor(y + r * cell), Math.ceil(cell), Math.ceil(cell));
  }
  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  // the paper's figure, when it has one: fetched by the app (desktop: main process; phone: natively), so the
  // canvas stays exportable
  async function figure(p) {
    const url = p.cover?.url;
    if (!url || !portal.fetchImage) return null;
    try {
      const r = await portal.fetchImage(url);
      if (!r?.bytes?.length) return null;
      const src = URL.createObjectURL(new Blob([r.bytes], { type: r.type || 'image/png' }));
      const im = await loadImage(src);
      setTimeout(() => URL.revokeObjectURL(src), 1000);
      return im && im.naturalWidth > 40 && im.naturalHeight > 40 ? im : null;
    } catch { return null; }
  }
  const loadImage = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

  async function card(p) {
    const zhTitle = F.trOn && p.title_zh;
    const absZh = F.trOn && p.abstract_zh;
    const title = zhTitle ? p.title_zh : p.title;
    const abstract = absZh ? p.abstract_zh : p.abstract || '';
    const tp = p.topics?.[0];
    const topic = tp ? topicLabel(tp) : 'arXiv';
    const color = F.META?.palette?.[F.META?.topics?.find((x) => x.id === tp)?.color || 'blue']?.[0] || C.blue;
    const names = p.authors || [];
    const insts = (p.inst || []).slice(0, 3).map((x) => F.instName(x)).join(' · ') || p.org || '';
    const who = [names.slice(0, 6).join(', ') + (names.length > 6 ? (lang === 'zh' ? ' 等' : ' et al.') : ''), insts].filter(Boolean).join(' · ');
    const link = `https://arxiv.org/abs/${p.id}`;
    const all = [title, p.title, abstract, who, topic, t('shareScan'), t('shareApp'), t('shareGet'), t('abstract'), link].join(' ');
    await Promise.all([font(700, 60), font(600, 30), font(500, 30), font(400, 34)].map((f) => document.fonts?.load(f, all).catch(() => {})));
    const icon = await loadImage('../assets/icon.svg');
    const fig = await figure(p);

    // measure, then draw on a canvas of the height that came out
    const m = document.createElement('canvas').getContext('2d');
    const inner = W - 2 * PAD;
    m.font = font(700, 60); const T = lines(m, title, inner, 8);
    m.font = font(500, 31); const O = zhTitle ? lines(m, p.title, inner, 3) : [];
    m.font = font(400, 28); const A = who ? lines(m, who, inner, 2) : [];
    // the whole abstract: the image grows as long as it needs (a long image, not a cut-off one)
    m.font = font(400, 34); const B = lines(m, abstract, inner, Infinity);
    const FIG = fig ? Math.round(Math.min(620, Math.max(260, (inner - 40) * (fig.naturalHeight / fig.naturalWidth)) + 40)) : 0;
    const QR = 196, FOOT = 250;
    let h = PAD + 34 + 44 + T.length * 74 + (O.length ? 18 + O.length * 44 : 0) + (A.length ? 26 + A.length * 40 : 0)
      + (FIG ? 40 + FIG : 0) + 48 + 2 + 46 + 30 + 20 + B.length * 57 + 52 + (QR + 64) + 56 + FOOT;
    h = Math.ceil(h);

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, h);
    ctx.textBaseline = 'alphabetic';
    let y = PAD;
    // direction · date
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(PAD + 9, y + 15, 9, 0, Math.PI * 2); ctx.fill();
    ctx.font = font(600, 28); ctx.fillStyle = C.ink2; ctx.fillText(topic, PAD + 30, y + 25);
    if (p.venue) {
      // accepted at a top venue: a gold pill after the direction
      const label = `★ ${p.venue.label}${p.venue.note ? ` · ${p.venue.note}` : ''}`;
      ctx.font = font(700, 25);
      const vx = PAD + 30 + (ctx.font = font(600, 28), ctx.measureText(topic).width) + 22;
      ctx.font = font(700, 25);
      const vw = ctx.measureText(label).width + 32;
      roundRect(ctx, vx, y - 4, vw, 42, 21, '#fff4d6');
      ctx.fillStyle = '#8a5a00'; ctx.fillText(label, vx + 16, y + 25);
    }
    ctx.font = font(500, 28); ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(shortDate(p.published || ''), W - PAD, y + 25); ctx.textAlign = 'left';
    y += 34 + 44;
    // title (and the original when it is shown in Chinese)
    ctx.font = font(700, 60); ctx.fillStyle = C.ink;
    T.forEach((l, i) => ctx.fillText(l, PAD, y + 56 + i * 74));
    y += T.length * 74;
    if (O.length) { y += 18; ctx.font = font(500, 31); ctx.fillStyle = C.muted; O.forEach((l, i) => ctx.fillText(l, PAD, y + 32 + i * 44)); y += O.length * 44; }
    if (A.length) { y += 26; ctx.font = font(400, 28); ctx.fillStyle = C.ink2; A.forEach((l, i) => ctx.fillText(l, PAD, y + 30 + i * 40)); y += A.length * 40; }
    // the figure, on white, as large as fits
    if (FIG) {
      y += 40;
      roundRect(ctx, PAD, y, inner, FIG, 28, '#ffffff');
      ctx.strokeStyle = C.hair; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(PAD + 1, y + 1, inner - 2, FIG - 2, 27); ctx.stroke();
      const bw = inner - 40, bh = FIG - 40, k = Math.min(bw / fig.naturalWidth, bh / fig.naturalHeight);
      const dw = fig.naturalWidth * k, dh = fig.naturalHeight * k;
      ctx.drawImage(fig, PAD + 20 + (bw - dw) / 2, y + 20 + (bh - dh) / 2, dw, dh);
      y += FIG;
    }
    // abstract
    y += 48;
    ctx.fillStyle = C.hair; ctx.fillRect(PAD, y, inner, 2);
    y += 2 + 46;
    ctx.font = font(600, 26); ctx.fillStyle = C.muted; ctx.fillText(t('abstract'), PAD, y + 24);
    y += 30 + 20;
    ctx.font = font(400, 34); ctx.fillStyle = '#2b2d31';
    B.forEach((l, i) => ctx.fillText(l, PAD, y + 40 + i * 57));
    y += B.length * 57 + 52;
    // the paper: a QR code and its address
    roundRect(ctx, PAD, y, inner, QR + 64, 36, C.block);
    roundRect(ctx, PAD + 32, y + 32, QR, QR, 18, '#ffffff');
    qrDraw(ctx, link, PAD + 32 + 12, y + 32 + 12, QR - 24);
    const tx = PAD + 32 + QR + 40;
    ctx.font = font(600, 32); ctx.fillStyle = C.ink; ctx.fillText(t('shareScan'), tx, y + 32 + QR / 2 - 10);
    ctx.font = font(500, 28); ctx.fillStyle = C.blue; ctx.fillText(link.replace(/^https:\/\//, ''), tx, y + 32 + QR / 2 + 34);
    y += QR + 64 + 56;
    // where to get the app
    ctx.fillStyle = C.page; ctx.fillRect(0, y, W, h - y);
    const fy = y + (FOOT - 150) / 2;
    if (icon) ctx.drawImage(icon, PAD, fy + 27, 96, 96);
    const fx = PAD + (icon ? 96 + 28 : 0), fw = W - PAD - 150 - 28 - fx;
    const fit = (text, px, weight) => { let s = text; ctx.font = font(weight, px); while (s.length > 4 && ctx.measureText(s).width > fw) s = `${s.slice(0, -2)}…`; return s; };
    ctx.fillStyle = C.ink; ctx.fillText(fit(t('shareApp'), 31, 700), fx, fy + 44);
    ctx.fillStyle = C.ink2; ctx.fillText(fit(t('shareGet'), 26, 500), fx, fy + 88);
    ctx.fillStyle = C.blue; ctx.fillText(fit(`github.com/${REPO}`, 24, 500), fx, fy + 126);
    roundRect(ctx, W - PAD - 150, fy, 150, 150, 16, '#ffffff');
    qrDraw(ctx, APP_URL, W - PAD - 150 + 11, fy + 11, 128);
    return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  }

  // ---------- the preview, and what to do with it ----------
  let modal = null;
  function close() {
    if (!modal) return;
    const m = modal;
    modal = null;
    URL.revokeObjectURL(m.dataset.url || '');
    m.classList.add('is-leaving');
    setTimeout(() => m.remove(), 220);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  async function open(paper) {
    if (!paper?.id) return;
    close();
    let p = paper;
    if (!p.abstract) p = { ...p, ...((await api.get(p.id))?.paper || {}) };
    const phone = !!portal.shareImage;
    modal = document.createElement('div');
    modal.className = 'share-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('shareTitle'));
    // the card is the whole view (it scrolls); the buttons float over it on glass
    modal.innerHTML = `<div class="share-scroll" data-share-bg><div class="share-img" data-share-bg><div class="share-wait"></div></div></div>
      <button type="button" class="share-x" data-glass="round" data-share-close data-back-close aria-label="${esc(t('close'))}">×</button>
      <div class="share-bar" data-glass="dock">${phone
        ? `<button type="button" class="primary" data-share="send" disabled>${esc(t('shareSend'))}</button><button type="button" data-share="save" disabled>${esc(t('shareSave'))}</button>`
        : `${portal.copyImage ? `<button type="button" data-share="copy" disabled>${esc(t('shareCopy'))}</button>` : ''}<button type="button" class="primary" data-share="save" disabled>${esc(t('shareSave'))}</button>`}</div>
      <p class="share-note" data-glass="banner" role="status" hidden></p>`;
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKey, true);
    const m = modal;
    let noteTimer = 0;
    const note = (s) => {
      const n = m.querySelector('.share-note');
      n.textContent = s;
      n.hidden = !s;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { n.hidden = true; }, 2600);
    };
    let blob;
    try { blob = await card(p); } catch (e) { note(t('shareFailed')); console.error(e); return; }
    if (modal !== m) return;
    const url = URL.createObjectURL(blob);
    m.dataset.url = url;
    m.querySelector('.share-img').innerHTML = `<img src="${url}" alt="${esc(plain(p.title))}">`;
    m.querySelectorAll('[data-share]').forEach((b) => { b.disabled = false; });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = `paper-${p.id}.png`;
    m.addEventListener('click', async (e) => {
      if (e.target.closest('[data-share-close]') || e.target.matches('[data-share-bg]')) return close();
      const kind = e.target.closest('[data-share]')?.dataset.share;
      if (!kind) return;
      try {
        if (kind === 'send') { await portal.shareImage(name, bytes, t('shareTitle'), `${plain(p.title)}\nhttps://arxiv.org/abs/${p.id}`); return; }
        if (kind === 'copy') { const r = await portal.copyImage(bytes); note(r?.ok ? t('shareCopied') : t('shareFailed')); return; }
        if (portal.saveImage) {
          const r = await portal.saveImage(name, bytes);
          if (r?.ok) note(t('shareSaved', { where: r.path || '' }));
          else if (r && !r.canceled) {
            if (phone) await portal.shareImage(name, bytes, t('shareTitle'), ''); // old Android: no gallery without a permission
            else note(t('shareFailed'));
          }
          return;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
      } catch (err) { note(t('shareFailed')); console.error(err); }
    });
  }
  // the drawing kit, for the exported list's long image (export.js)
  window.RIShare = { open, close, kit: { lines, roundRect, qrDraw, font, loadImage, C, W, REPO, APP_URL } };
})();
