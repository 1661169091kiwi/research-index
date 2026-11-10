// Research index — swipe feed: one paper at a time, full screen, like a short-video app.
// Swipe up (or scroll, or press ↓) for the next paper. How long each card stays on screen is sent to
// the app as a "view": the recommender reads it against your own pace and the card's length, and the
// cards after the next one are dealt again after every swipe in "Recommended" (see recommend.mjs).
// Uses the page's feed script through window.RIFeed (see feed.js).
(function () {
  'use strict';
  const F = window.RIFeed;
  if (!F) return;
  const { api, t, lang, esc, tex, titleMath, abstractHtml, abstractZhHtml, coverHtml, wireFigure, reasonText, topicLabel, shortDate, ICON, hooks, store, inkTo, venueHtml } = F;
  const $ = (s, r = document) => r.querySelector(s);
  const root = $('#swipe'), track = $('#sw-track'), hint = $('#sw-hint'), toast = $('#sw-toast'), menu = $('#sw-menu');
  const bar = $('#sw-actions'), nav = $('#sw-nav');
  if (!root) return;
  const isMobile = document.documentElement.classList.contains('is-mobile');
  const MODES = ['recommended', 'foryou', 'latest', 'trending', 'venues', 'saved'];
  const LIVE = new Set(['recommended']);
  const AHEAD = 4;        // cards dealt after the next one
  const KEEP_FULL = 6;    // cards further back than this lose their contents (they are re-drawn on the way back)

  const sw = {
    on: false, mode: store.get('ri-sw-mode', 'recommended'), topic: store.get('ri-sw-topic', ''), deck: '', items: [], cards: new Map(),
    idx: -1, maxSeen: -1, loading: false, done: false, token: 0, redealAfter: false, atEnd: false, off: 0,
  };
  if (!MODES.includes(sw.mode)) sw.mode = 'recommended';
  const live = () => LIVE.has(sw.mode);

  // ---------- time on each card ----------
  // Counted only while the card is the one on screen, the app is visible and no paper is open on top.
  const dwell = { id: '', since: 0, ms: 0, back: false, trTimer: 0 };
  function viewPause() { if (dwell.since) { dwell.ms += performance.now() - dwell.since; dwell.since = 0; } }
  function viewResume() { if (dwell.id && !dwell.since && sw.on && !document.hidden && !F.sheetId) dwell.since = performance.now(); }
  function viewEnd() {
    if (!dwell.id) return;
    viewPause();
    clearTimeout(dwell.trTimer);
    const ms = Math.round(Math.min(6e5, dwell.ms));
    if (ms >= 150) api.act(dwell.id, 'view', { ms, back: dwell.back });
    dwell.id = '';
  }
  function viewStart(id, back) {
    viewEnd();
    Object.assign(dwell, { id, ms: 0, since: 0, back });
    viewResume();
    // the abstract is translated once a card holds your attention for a moment (not on a quick swipe)
    if (F.trOn) dwell.trTimer = setTimeout(() => translateAbstracts(sw.idx), 1200);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) viewPause(); else viewResume(); });
  window.addEventListener('pagehide', viewEnd);

  // ---------- cards ----------
  const topicColor = (id) => { const tp = F.META.topics.find((x) => x.id === id); return F.META.palette[tp?.color || 'sand'][0]; };
  const authorLine = (c) => {
    const names = c.authors.slice(0, 4).join(', ');
    return c.nAuthors > 4 ? `${names} ${t('moreAuthors', { n: c.nAuthors - 4 })}` : names;
  };
  const likeCount = (c) => (c.up + (c.liked ? 1 : 0)) || '';
  // one line above the title: why it was picked (Recommended, For you), else its other directions
  function eyebrow(c) {
    if (c.reason && (sw.mode === 'recommended' || sw.mode === 'foryou')) return `<p class="sw-eyebrow is-reason">${esc(reasonText(c.reason))}</p>`;
    const tags = c.topics.slice(1, 3);
    return tags.length ? `<p class="sw-eyebrow">${tags.map((x) => `<span class="sw-tag"><i style="background:${topicColor(x)}"></i>${esc(topicLabel(x))}</span>`).join('')}</p>` : '';
  }
  function cardInner(c) {
    const zh = F.trOn && c.title_zh;
    const absZh = F.trOn && c.abstract_zh;
    const by = [c.org ? `<b>${esc(c.org)}</b>` : '', esc(authorLine(c))].filter(Boolean).join('<span class="dot"> · </span>');
    return `<div class="sw-media" data-open>${coverHtml(c, { big: true, ratio: false })}</div>
      <div class="sw-body" data-open>
        ${eyebrow(c)}
        ${c.venue ? `<p class="sw-venue">${venueHtml(c)}</p>` : ''}
        <h2 class="sw-title">${titleMath(zh ? c.title_zh : c.title)}</h2>
        ${zh ? `<p class="sw-orig">${titleMath(c.title)}</p>` : ''}
        ${by ? `<p class="sw-byline">${by}</p>` : ''}
        <div class="sw-abs">${absZh ? abstractZhHtml(c.abstract_zh) : abstractHtml(c.abstract || '')}</div>
      </div>`;
  }
  function cardEl(i) { return track.querySelector(`.sw-card[data-i="${i}"]`); }
  function draw(i) {
    const el = cardEl(i);
    const c = sw.cards.get(sw.items[i]);
    if (!el || !c || el.dataset.drawn === '1') return;
    el.dataset.drawn = '1';
    el.classList.toggle('is-hidden', !!c.hiddenNow);
    el.innerHTML = cardInner(c) + (c.hiddenNow ? hiddenNote() : '');
    wireFigure(el);
  }
  function redraw(id) {
    const i = sw.items.indexOf(id);
    const el = i >= 0 && cardEl(i);
    if (!el || el.dataset.drawn !== '1') return;
    el.dataset.drawn = '';
    draw(i);
  }
  function append(list, from) {
    const frag = document.createDocumentFragment();
    list.forEach((c, k) => {
      const i = from + k;
      sw.cards.set(c.id, { ...(sw.cards.get(c.id) || {}), ...c });
      sw.items[i] = c.id;
      const el = document.createElement('section');
      el.className = 'sw-card';
      el.dataset.i = String(i);
      el.dataset.id = c.id;
      frag.appendChild(el);
    });
    track.querySelector('.sw-end')?.remove();
    track.appendChild(frag);
    for (let i = from; i < from + list.length; i++) { const el = cardEl(i); if (el) io.observe(el); }
    drawAround();
  }
  // cards near the current one carry their full contents; far ones are emptied (they are all the same height)
  function drawAround() {
    const lo = Math.max(0, sw.idx - 2), hi = sw.idx + AHEAD + 2;
    track.querySelectorAll('.sw-card').forEach((el) => {
      const i = +el.dataset.i;
      if (i >= lo && i <= hi) draw(i);
      else if (i < sw.idx - KEEP_FULL && el.dataset.drawn === '1') { el.innerHTML = ''; el.dataset.drawn = ''; }
    });
  }
  function endCard() {
    if (track.querySelector('.sw-end') || !sw.items.length) return;
    track.insertAdjacentHTML('beforeend', `<section class="sw-card sw-end"><div class="sw-end-box"><p>${esc(t('swEnd'))}</p><button type="button" class="btn-primary" data-sw-menu="refresh">${esc(t('swNewBatch'))}</button></div></section>`);
    io.observe(track.lastElementChild);
  }
  function emptyCard() {
    const st = F.META.status;
    const msg = !st.count ? `<b>${esc(t('firstRunTitle'))}</b><br>${esc(t('firstRun'))}` : esc(t(sw.mode === 'saved' ? 'emptySaved' : 'emptyFeed'));
    track.innerHTML = `<section class="sw-card sw-end"><div class="sw-end-box"><p>${msg}</p></div></section>`;
    paintBar();
  }

  // ---------- which card is on screen ----------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
      if (e.target.classList.contains('sw-end')) atEnd();
      else activate(+e.target.dataset.i);
    }
  }, { root: track, threshold: [0.6] });

  function activate(i) {
    if (!sw.on || !sw.items[i] || (i === sw.idx && !sw.atEnd)) return;
    const prev = sw.atEnd ? sw.items.length : sw.idx;
    sw.atEnd = false;
    sw.idx = i;
    const back = i <= sw.maxSeen;
    sw.maxSeen = Math.max(sw.maxSeen, i);
    viewStart(sw.items[i], back);
    track.querySelectorAll('.sw-card.is-active').forEach((el) => el.classList.remove('is-active'));
    cardEl(i)?.classList.add('is-active');
    paintBar();
    drawAround();
    prefetch(i);
    if (i > 0) hideHint();
    if (live() && i > prev) scheduleRedeal();
    else if (!live() && !sw.done && i >= sw.items.length - 3) more();
    if (sw.done && i >= sw.items.length - 1) endCard();
  }
  // the "that is everything" card: nothing to like or save there
  function atEnd() {
    if (!sw.on || sw.atEnd) return;
    viewEnd();
    sw.atEnd = true;
    track.querySelectorAll('.sw-card.is-active').forEach((el) => el.classList.remove('is-active'));
    paintBar();
  }

  // ---------- the action bar (and the ↑ ↓ buttons on a wide screen) follow the card on screen ----------
  function paintBar() {
    const c = sw.atEnd ? null : current();
    bar.classList.toggle('is-off', !c);
    bar.querySelectorAll('.sw-act').forEach((b) => { b.disabled = !c; });
    const n = track.querySelectorAll('.sw-card').length;
    nav.querySelector('[data-sw-go="-1"]').disabled = sw.idx <= 0 && !sw.atEnd;
    nav.querySelector('[data-sw-go="1"]').disabled = sw.atEnd || !c || (sw.done && sw.idx >= n - 1);
    if (!c) return;
    const set = (kind, on, label) => {
      const b = bar.querySelector(`[data-sw="${kind}"]`);
      b.classList.toggle('on', !!on);
      if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(!!on));
      if (label != null) b.querySelector('.sw-lbl').textContent = label;
    };
    set('like', c.liked, String(likeCount(c) || t('like')));
    set('save', c.saved, c.saved ? t('swSaved') : t('save'));
    set('ai', c.hasTake);
    set('hide', c.hiddenNow, c.hiddenNow ? t('swUndo') : t('hide'));
  }
  // a little bounce on the button that just changed
  function pop(kind) {
    const b = bar.querySelector(`[data-sw="${kind}"]`);
    if (!b) return;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }
  // after a mouse click the keys go back to the feed (↑ ↓, L, S…), not to the clicked button
  const refocus = (e) => { if (e.detail > 0) track.focus({ preventScroll: true }); };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]');
    const c = sw.atEnd ? null : current();
    if (!b || !c) return;
    refocus(e);
    const kind = b.dataset.sw;
    if (kind === 'like') like(c);
    else if (kind === 'save') save(c);
    else if (kind === 'ai') ai(c);
    else if (kind === 'open') open(c);
    else if (kind === 'hide') (c.hiddenNow ? unhide(c.id) : hide(c.id));
  });
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw-go]');
    if (!b || b.disabled) return;
    refocus(e);
    go(+b.dataset.swGo);
  });

  // ---------- dealing ----------
  const baseParams = () => ({
    mode: sw.mode, topic: sw.topic, query: '', collection: '', slot: 'swipe', withAbstract: true,
    ...(live() ? { focusAuto: true, div: 0.6, exploreEvery: 8, anchorCap: 3, capWindow: 3 } : {}),
  });
  async function reset({ fresh = false } = {}) {
    viewEnd();
    const token = ++sw.token;
    Object.assign(sw, { items: [], idx: -1, maxSeen: -1, done: false, loading: true, redealAfter: false, atEnd: false, off: 0, deck: fresh ? '' : sw.deck });
    io.disconnect();
    track.innerHTML = `<section class="sw-card sw-end"><div class="sw-end-box"><p class="sw-loading">${esc(t('swLoading'))}</p></div></section>`;
    track.scrollTop = 0;
    paintBar();
    // back from switching language: the paper you were reading comes first
    const back = !fresh && takeResume();
    const first = back ? (await api.get(back).catch(() => null))?.paper : null;
    if (token !== sw.token) return;
    const params = { ...baseParams(), offset: 0, limit: 2 + AHEAD, deck: fresh ? '' : sw.deck, fresh };
    if (first && live()) params.keep = [first.id];
    const res = await api.list(params);
    if (token !== sw.token) return;
    sw.loading = false;
    sw.deck = res.deck || '';
    track.innerHTML = '';
    const items = first ? [first, ...res.items.filter((c) => c.id !== first.id)] : res.items;
    if (!items.length) { emptyCard(); return; }
    sw.off = res.items.length;
    sw.done = (first && live() ? 1 : 0) + res.items.length >= res.total;
    append(items, 0);
    track.scrollTop = 0;
    activate(0);
    showHint();
  }
  // more cards at the end (Latest / Trending / For you page through a fixed deck)
  async function more() {
    if (sw.loading || sw.done) return;
    sw.loading = true;
    const token = sw.token;
    const res = await api.list({ ...baseParams(), offset: sw.off, limit: 6, deck: sw.deck });
    if (token !== sw.token) return;
    sw.loading = false;
    sw.off += res.items.length;
    sw.done = sw.off >= res.total || !res.items.length;
    const have = new Set(sw.items);
    append(res.items.filter((c) => !have.has(c.id)), sw.items.length);
  }
  // "Recommended": everything after the next card is dealt again with what the last card told
  let redealTimer = 0;
  function scheduleRedeal() { clearTimeout(redealTimer); redealTimer = setTimeout(redeal, 140); }
  async function redeal() {
    if (!sw.on || !live() || !sw.items.length) return;
    if (sw.loading) { sw.redealAfter = true; return; }
    sw.loading = true;
    sw.redealAfter = false;
    const token = sw.token;
    const keepN = Math.min(sw.items.length, sw.idx + 2);
    const keep = sw.items.slice(0, keepN);
    const res = await api.list({ ...baseParams(), offset: keepN, limit: AHEAD, deck: sw.deck, keep });
    if (token !== sw.token) return;
    sw.loading = false;
    sw.deck = res.deck || sw.deck;
    // you swiped onto a card that was about to be replaced: keep everything and deal again from there
    if (sw.idx >= keepN) sw.redealAfter = true;
    else {
      track.querySelectorAll('.sw-card').forEach((el) => { if (+el.dataset.i >= keepN || el.classList.contains('sw-end')) { io.unobserve(el); el.remove(); } });
      sw.items.length = keepN;
      sw.done = !res.items.length;
      append(res.items, keepN);
      prefetch(sw.idx);
    }
    if (sw.redealAfter) { sw.redealAfter = false; redeal(); }
  }

  // ---------- figures and translations for the next few cards ----------
  function prefetch(i) {
    const ids = sw.items.slice(i, i + AHEAD + 1);
    const noCover = ids.filter((id) => !sw.cards.get(id)?.cover);
    if (noCover.length) api.covers(noCover);
    if (F.trOn) translateTitles(ids);
  }
  async function translateTitles(ids) {
    const want = ids.filter((id) => !sw.cards.get(id)?.title_zh);
    if (!want.length) return;
    const res = await api.trTitles(want);
    if (res?.error) return;
    for (const [id, zh] of Object.entries(res.titles || {})) { const c = sw.cards.get(id); if (c) { c.title_zh = zh; redraw(id); } }
  }
  function translateAbstracts(i) {
    for (const id of sw.items.slice(i, i + 2)) {
      const c = sw.cards.get(id);
      if (!c || c.abstract_zh || c.trPending) continue;
      c.trPending = true;
      api.trAbstract(id).then((r) => { c.trPending = false; if (r?.abstract) { c.abstract_zh = r.abstract; redraw(id); } });
    }
  }
  api.on('feed:cover', ({ id, cover }) => {
    const c = sw.cards.get(id);
    if (!c || !cover) return;
    c.cover = cover;
    redraw(id);
  });
  api.on('feed:tr', (ev) => {
    const c = ev.id && sw.cards.get(ev.id);
    if (!c) return;
    if (ev.title) c.title_zh = ev.title;
    if (ev.abstract) { c.abstract_zh = ev.abstract; c.trPending = false; }
    if (ev.abstractError) c.trPending = false;
    if (F.trOn && (ev.title || ev.abstract)) redraw(ev.id);
  });
  api.on('feed:batch', (b) => {
    if (!sw.on) return;
    if (!sw.items.length && !sw.loading) return reset();
    // papers that arrived meanwhile are mixed into the cards still to come; at the end, they are the next ones
    if (b?.added > 0 && sw.done && !live() && !sw.loading) { sw.done = false; more(); }
  });
  // an AI take written in the open paper lights up the AI button
  api.on('feed:take', (ev) => {
    const c = ev.done && sw.cards.get(ev.id);
    if (!c) return;
    c.hasTake = true;
    if (c === current()) paintBar();
  });

  // ---------- actions ----------
  const current = () => sw.cards.get(sw.items[sw.idx]);
  async function like(c, { burstAt = null } = {}) {
    if (!c) return;
    if (burstAt) heart(burstAt);
    if (burstAt && c.liked) return; // double tap only ever likes
    const res = await F.act(c, 'like');
    Object.assign(c, res);
    if (c === current()) { paintBar(); if (c.liked) pop('like'); }
  }
  async function save(c) {
    if (!c) return;
    const res = await F.act(c, 'save');
    Object.assign(c, res);
    if (c === current()) { paintBar(); if (c.saved) pop('save'); }
  }
  function open(c) {
    if (!c) return;
    viewPause();
    F.openSheet(c.id);
  }
  async function ai(c) {
    if (!c) return;
    viewPause();
    await F.openSheet(c.id);
    if (!c.hasTake) F.runTake('quick');
    else $('#take')?.scrollIntoView({ block: 'start' });
  }
  const hiddenNote = () => `<div class="sw-hidden-note"><p>${esc(t('swHidden'))}</p><button type="button" class="tool" data-sw="unhide">${esc(t('swUndo'))}</button></div>`;
  async function hide(id) {
    const c = sw.cards.get(id);
    if (!c) return;
    c.hiddenNow = true;
    await api.act(id, 'hide');
    redraw(id);
    if (c === current()) paintBar();
    flash(t('swHidden'));
    const i = sw.items.indexOf(id);
    if (i === sw.idx) setTimeout(() => { if (sw.idx === i && c.hiddenNow) go(1); }, 450);
  }
  async function unhide(id) {
    const c = sw.cards.get(id);
    if (!c) return;
    c.hiddenNow = false;
    await api.act(id, 'unhide');
    redraw(id);
    if (c === current()) paintBar();
  }
  function go(dir) {
    const n = track.querySelectorAll('.sw-card').length;
    const from = sw.atEnd ? n - 1 : sw.idx;
    const i = Math.max(0, Math.min(n - 1, from + dir));
    track.scrollTo({ top: i * track.clientHeight, behavior: 'smooth' });
  }
  function heart({ x, y }) {
    const h = document.createElement('div');
    h.className = 'sw-heart';
    h.innerHTML = ICON.heart;
    h.style.left = `${x}px`;
    h.style.top = `${y}px`;
    root.appendChild(h);
    setTimeout(() => h.remove(), 900);
  }
  let toastTimer = 0;
  function flash(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }

  // On a phone one tap opens the paper and two taps like it. With a mouse a click opens it at once
  // (L or the heart likes it), so opening does not wait to see whether a second click follows.
  let tap = { t: 0, id: '', timer: 0 };
  track.addEventListener('click', (e) => {
    const card = e.target.closest('.sw-card');
    const menuBtn = e.target.closest('[data-sw-menu]');
    if (menuBtn) return menuAction(menuBtn.dataset.swMenu, e);
    if (!card || card.classList.contains('sw-end')) return;
    const c = sw.cards.get(card.dataset.id);
    if (!c) return;
    if (e.target.closest('[data-sw="unhide"]')) { e.stopPropagation(); return unhide(c.id); }
    if (card.classList.contains('is-hidden') || e.target.closest('a')) return;
    if (!isMobile) { if (e.target.closest('[data-open]')) open(c); return; }
    const now = performance.now();
    if (tap.id === c.id && now - tap.t < 300) {
      clearTimeout(tap.timer);
      tap = { t: 0, id: '', timer: 0 };
      return like(c, { burstAt: { x: e.clientX, y: e.clientY } });
    }
    clearTimeout(tap.timer);
    tap = { t: now, id: c.id, timer: setTimeout(() => { tap = { t: 0, id: '', timer: 0 }; if (e.target.closest('[data-open]')) open(c); }, 300) };
  });

  // ---------- top bar: tabs and menu ----------
  function renderModes() {
    const row = $('#sw-modes');
    row.innerHTML = MODES.map((m) => `<button type="button" data-sw-mode="${m}" class="${sw.mode === m ? 'is-on' : ''}">${esc(t(`mode_${m}`))}</button>`).join('');
    fitModes();
    inkTo?.(row);
  }
  // tabs wider than the bar scroll sideways: keep the open tab in view, fade the sides that have more
  function fitModes() {
    const row = $('#sw-modes'), on = row.querySelector('.is-on');
    if (on && row.scrollWidth > row.clientWidth + 1) {
      const r = row.getBoundingClientRect(), b = on.getBoundingClientRect();
      row.scrollLeft += (b.left + b.width / 2) - (r.left + r.width / 2);
    }
    fadeModes();
  }
  function fadeModes() {
    const row = $('#sw-modes'), max = row.scrollWidth - row.clientWidth;
    row.classList.toggle('fade-l', max > 1 && row.scrollLeft > 2);
    row.classList.toggle('fade-r', max > 1 && row.scrollLeft < max - 2);
  }
  $('#sw-modes').addEventListener('scroll', fadeModes, { passive: true });
  new ResizeObserver(() => { if (!sw.on) return; fitModes(); const row = $('#sw-modes'); row._ink = null; inkTo?.(row); }).observe($('#sw-modes'));
  $('#sw-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw-mode]');
    if (!b) return;
    if (b.dataset.swMode === sw.mode) return reset({ fresh: true }); // the open tab again = a new batch
    sw.mode = b.dataset.swMode;
    sw.deck = '';
    store.set('ri-sw-mode', sw.mode);
    renderModes();
    reset();
  });
  // ---------- directions (the categories of the grid view) ----------
  const chipsRow = $('#sw-chips');
  function renderChips() {
    const tp = F.META?.topics || [];
    if (sw.topic && !tp.some((x) => x.id === sw.topic)) sw.topic = '';
    chipsRow.innerHTML = `<button type="button" data-sw-topic="" class="${!sw.topic ? 'is-on' : ''}" aria-pressed="${!sw.topic}">${esc(t('all'))}</button>`
      + tp.map((x) => `<button type="button" data-sw-topic="${x.id}" class="${sw.topic === x.id ? 'is-on' : ''}" aria-pressed="${sw.topic === x.id}"><i style="background:${F.META.palette[x.color][0]}"></i>${esc(x[lang] || x.en)}</button>`).join('');
    requestAnimationFrame(fitChips);
  }
  function fitChips() {
    const on = chipsRow.querySelector('.is-on');
    if (on && chipsRow.scrollWidth > chipsRow.clientWidth + 1) {
      const r = chipsRow.getBoundingClientRect(), b = on.getBoundingClientRect();
      const to = chipsRow.scrollLeft + (b.left + b.width / 2) - (r.left + r.width / 2);
      chipsRow.scrollTo({ left: to, behavior: chipsRow.dataset.ready ? 'smooth' : 'instant' });
    }
    chipsRow.dataset.ready = '1';
    fadeChips();
  }
  function fadeChips() {
    const max = chipsRow.scrollWidth - chipsRow.clientWidth;
    chipsRow.classList.toggle('fade-l', max > 1 && chipsRow.scrollLeft > 2);
    chipsRow.classList.toggle('fade-r', max > 1 && chipsRow.scrollLeft < max - 2);
  }
  chipsRow.addEventListener('scroll', fadeChips, { passive: true });
  chipsRow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw-topic]');
    if (!b) return;
    refocus(e);
    if (b.dataset.swTopic === sw.topic) return;
    sw.topic = b.dataset.swTopic;
    sw.deck = '';
    store.set('ri-sw-topic', sw.topic);
    renderChips();
    reset();
  });

  // ---------- language: the same page in the other language, on the paper you were reading ----------
  const RESUME = 'ri-sw-resume';
  function takeResume() {
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem(RESUME) || 'null'); sessionStorage.removeItem(RESUME); } catch { /* ignore */ }
    return r && r.mode === sw.mode && r.topic === sw.topic && Date.now() - r.t < 120000 ? r.id : '';
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw-lang]');
    if (!b || b.dataset.swLang === lang) return;
    const c = sw.atEnd ? null : current();
    try { if (c) sessionStorage.setItem(RESUME, JSON.stringify({ id: c.id, mode: sw.mode, topic: sw.topic, t: Date.now() })); } catch { /* ignore */ }
    viewEnd();
    location.href = `../${b.dataset.swLang}/papers.html`;
  });

  function renderMenu() {
    $('[data-sw-menu="tr"]', menu)?.classList.toggle('is-on', F.trOn);
  }
  const closeMenu = () => { menu.hidden = true; $('#sw-menu-btn').setAttribute('aria-expanded', 'false'); };
  $('#sw-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#sw-menu-btn').setAttribute('aria-expanded', String(!menu.hidden));
    renderMenu();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw-menu]');
    if (b && b.tagName !== 'A') menuAction(b.dataset.swMenu, e);
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#sw-menu') && !e.target.closest('#sw-menu-btn')) closeMenu(); });
  function menuAction(kind, e) {
    e?.stopPropagation();
    closeMenu();
    if (kind === 'refresh') { reset({ fresh: true }); api.refresh(); return; }
    if (kind === 'tr') {
      $('#tr-btn').click();
      renderMenu();
      sw.cards.forEach((c) => redraw(c.id));
      if (F.trOn) { prefetch(sw.idx); translateAbstracts(sw.idx); }
      return;
    }
    if (kind === 'tune') { $('#tune').click(); return; }
    if (kind === 'ai') { $('#ai-btn').click(); return; }
    if (kind === 'share') { const c = sw.atEnd ? null : current(); if (c) window.RIShare?.open(c); return; }
    if (kind === 'about') { window.RIUpdate?.about(); return; }
    if (kind === 'grid') exit();
  }
  $('#sw-grid').addEventListener('click', () => exit());
  // new interests: deal again
  $('#tune-save')?.addEventListener('click', () => { if (sw.on) setTimeout(() => reset({ fresh: true }), 50); });

  // ---------- first-time hint ----------
  function showHint() {
    if (store.get('ri-sw-hinted', false)) return;
    hint.textContent = isMobile ? t('swHint') : t('swHintDesk');
    hint.hidden = false;
  }
  function hideHint() { if (!hint.hidden) { hint.hidden = true; store.set('ri-sw-hinted', true); } }

  // ---------- enter / leave ----------
  function enter() {
    if (sw.on) return;
    sw.on = true;
    root.hidden = false;
    document.body.classList.add('swipe-on');
    store.set('ri-view', 'swipe');
    renderModes();
    renderChips();
    renderMenu();
    if (!sw.items.length) reset();
    else {
      track.scrollTop = restIndex() * track.clientHeight;
      if (sw.idx >= 0 && !sw.atEnd) viewStart(sw.items[sw.idx], false);
      paintBar();
    }
    track.focus({ preventScroll: true });
  }
  const restIndex = () => (sw.atEnd ? track.querySelectorAll('.sw-card').length - 1 : Math.max(0, sw.idx));
  function exit() {
    if (!sw.on) return;
    viewEnd();
    sw.on = false;
    root.hidden = true;
    document.body.classList.remove('swipe-on');
    store.set('ri-view', 'grid');
    closeMenu();
    F.gridShown();
  }
  new ResizeObserver(() => { if (sw.on && sw.idx >= 0) track.scrollTop = restIndex() * track.clientHeight; }).observe(track);
  if (!isMobile) {
    let acc = 0, locked = false, quiet = 0;
    track.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return; // zoom
      e.preventDefault();
      clearTimeout(quiet);
      quiet = setTimeout(() => { locked = false; acc = 0; }, 180); // the flick (and its momentum) is over
      if (locked) return;
      acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(acc) < 28) return;
      locked = true;
      go(Math.sign(acc));
      acc = 0;
    }, { passive: false });
  }

  // ---------- keyboard (desktop) ----------
  document.addEventListener('keydown', (e) => {
    if (!sw.on || !$('#sheet').hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (!$('#tune-pop').hidden || !$('#ai-pop').hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Enter / Space on a focused button press that button, not the shortcut as well
    if ((k === 'Enter' || k === ' ') && e.target.closest?.('button, a')) return;
    const c = sw.atEnd ? null : current();
    const keys = {
      ArrowDown: () => go(1), PageDown: () => go(1), ' ': () => go(1), j: () => go(1),
      ArrowUp: () => go(-1), PageUp: () => go(-1), k: () => go(-1),
      Enter: () => open(c), o: () => open(c), l: () => like(c), s: () => save(c), a: () => ai(c),
      x: () => c && (c.hiddenNow ? unhide(c.id) : hide(c.id)),
      r: () => reset({ fresh: true }), v: () => exit(), Escape: () => (menu.hidden ? exit() : closeMenu()),
    };
    if (keys[k]) { e.preventDefault(); keys[k](); }
  });

  // ---------- hooks for feed.js (the detail sheet, the toolbar button, start-up) ----------
  hooks.active = () => sw.on;
  hooks.enter = enter;
  hooks.exit = exit;
  hooks.hide = (id) => hide(id);
  // what you did inside the open paper (like, save) shows on the bar once you are back
  function syncFrom(p) {
    const c = p && sw.cards.get(p.id);
    if (!c) return;
    c.liked = !!p.liked;
    c.saved = !!p.saved;
    if (c === current()) paintBar();
  }
  hooks.sheetClosed = (id, paper) => {
    viewResume();
    const c = sw.cards.get(id);
    if (c) { c.opened = true; redraw(id); }
    syncFrom(paper);
    // what you just read counts: deal again after the next card
    if (live()) scheduleRedeal();
  };
  hooks.step = (dir) => {
    const next = sw.items[sw.idx + dir];
    if (!next) return;
    syncFrom(F.sheetPaper);
    go(dir);
    F.openSheet(next);
  };
  // the phone opens in the swipe feed; the desktop where you left it
  hooks.startsOpen = () => {
    const v = store.get('ri-view', isMobile ? 'swipe' : 'grid');
    if (v !== 'swipe') return false;
    enter();
    return true;
  };
  if (lang) root.dataset.lang = lang;
})();
