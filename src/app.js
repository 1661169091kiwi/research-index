// Research index — client behaviour: line snapping, search, find-in-page,
// contents tracking, reading position, language memory, and desktop-app hooks.
(function () {
  'use strict';

  const root = document.documentElement;
  const S = JSON.parse(document.getElementById('ri-strings')?.textContent || '{}');
  const lang = root.dataset.lang || 'en';
  const portal = window.portal && window.portal.isApp ? window.portal : null;
  const scroller = document.getElementById('scroller');
  const article = document.getElementById('article');
  const isDoc = !!article;
  const t = (key, vars = {}) => (S[key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  if (portal) root.classList.add('is-app');

  // ---------- pop-ups close the way they opened ----------
  // Menus and panels (data-pop) unfold when shown. Setting hidden = true on one plays its folding-away animation
  // first (about 170 ms) and only then hides it; reading .hidden already says true. Showing it again meanwhile
  // cancels the fold. data-pop="remove" ones (built on demand) go through window.riPopRemove(el).
  {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FOLD_MS = 170;
    Object.defineProperty(HTMLElement.prototype, 'hidden', {
      configurable: true, enumerable: desc.enumerable,
      get() { return this._riFold ? true : desc.get.call(this); },
      set(v) {
        if (!this.hasAttribute?.('data-pop')) return desc.set.call(this, v);
        if (!v) {
          if (this._riFold) { clearTimeout(this._riFold); this._riFold = 0; this.classList.remove('is-closing'); }
          return desc.set.call(this, false);
        }
        if (this._riFold) return;
        if (desc.get.call(this) || still() || !this.getClientRects().length) return desc.set.call(this, true);
        this.classList.add('is-closing');
        this._riFold = setTimeout(() => { this._riFold = 0; this.classList.remove('is-closing'); desc.set.call(this, true); }, FOLD_MS);
      },
    });
    window.riPopRemove = (el) => {
      if (!el || el._riFold) return;
      if (still() || !el.getClientRects().length) return el.remove();
      el.classList.add('is-closing');
      el._riFold = setTimeout(() => el.remove(), FOLD_MS);
    };
  }

  // ---------- pop-ups: a tap outside one only closes it ----------
  // Menus and panels carry data-pop, the buttons that open them data-pop-opener. A press anywhere else while one
  // is open closes them all, and the click that press makes is swallowed: tapping a paper next to an open menu
  // closes the menu without also opening the paper.
  {
    const shown = () => [...document.querySelectorAll('[data-pop]')].filter((el) => !el.hidden && !el._riFold && el.getClientRects().length);
    let swallowUntil = 0;
    window.addEventListener('pointerdown', (e) => {
      swallowUntil = 0;
      if (e.button > 0) return;
      const open = shown();
      if (!open.length || e.target.closest?.('[data-pop], [data-pop-opener], .ri-confirm, .share-modal, .update-modal')) return;
      for (const el of open) {
        if (el.dataset.pop === 'remove') window.riPopRemove(el); else el.hidden = true;
        el.dispatchEvent(new CustomEvent('ri:pop-closed', { bubbles: true }));
      }
      document.querySelectorAll('[data-pop-opener][aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      swallowUntil = performance.now() + 1500;
    }, true);
    const swallow = (e) => {
      if (!swallowUntil) return;
      if (performance.now() > swallowUntil) { swallowUntil = 0; return; }
      e.stopPropagation();
      e.preventDefault();
      if (e.type === 'click') swallowUntil = 0;
    };
    for (const type of ['click', 'dblclick', 'contextmenu']) window.addEventListener(type, swallow, true);
  }

  // ---------- crisp lines at any display scaling (also re-runs when zoom changes) ----------
  let dprQuery;
  const snapLines = () => {
    const d = window.devicePixelRatio || 1;
    root.style.setProperty('--line-w', Math.max(1, Math.round(d * 0.8)) / d + 'px');
    root.style.setProperty('--rule-w', Math.max(2, Math.round(d * 1.6)) / d + 'px');
    dprQuery?.removeEventListener('change', snapLines);
    dprQuery = matchMedia(`(resolution: ${d}dppx)`);
    dprQuery.addEventListener('change', snapLines);
  };
  snapLines();

  // ---------- remember the language ----------
  try { localStorage.setItem('ri-lang', lang); } catch { /* ignore */ }

  // ---------- reading position (per page, survives restarts) ----------
  const params = new URLSearchParams(location.search);
  const pageKey = (pathname) => decodeURIComponent(pathname).replace(/\\/g, '/').split('/').slice(-2).join('/');
  const positions = store.get('ri-pos', {});
  const reloaded = sessionStorage.getItem('ri-updated') === '1';
  if (scroller) {
    const saved = positions[pageKey(location.pathname)];
    if (saved && !location.hash && !params.get('q') && (isDoc || reloaded)) scroller.scrollTop = saved.top;
    let pending = 0;
    scroller.addEventListener('scroll', () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const all = store.get('ri-pos', {});
        all[pageKey(location.pathname)] = { top: Math.round(scroller.scrollTop), frac: max > 0 ? +(scroller.scrollTop / max).toFixed(3) : 0 };
        store.set('ri-pos', all);
      }, 250);
    }, { passive: true });
    requestAnimationFrame(() => requestAnimationFrame(() => scroller.classList.add('smooth')));
  }

  // "42% read" next to each survey on the home page
  document.querySelectorAll('.doc-list .row').forEach((row) => {
    const p = positions[pageKey(new URL(row.getAttribute('href'), location.href).pathname)];
    const el = row.querySelector('[data-pct]');
    if (el && p && p.frac > 0.03 && p.frac < 0.97) el.textContent = t('readPct', { p: Math.round(p.frac * 100) });
  });

  // ---------- toast after a live update ----------
  if (reloaded) {
    sessionStorage.removeItem('ri-updated');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = t('updated');
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-on'));
    setTimeout(() => toast.classList.remove('is-on'), 2200);
    setTimeout(() => toast.remove(), 2700);
  }

  // ---------- home: search ----------
  const searchInput = document.getElementById('q');
  const dataEl = document.getElementById('search-data');
  if (searchInput && dataEl) {
    const data = JSON.parse(dataEl.textContent);
    const list = document.getElementById('doc-list');
    const results = document.getElementById('results');
    const label = document.getElementById('results-label');
    const items = data.sections.map((s) => ({ ...s, hl: s.h.toLowerCase(), tl: s.t.toLowerCase() }));

    const snippet = (text, terms) => {
      const lower = text.toLowerCase();
      let at = -1;
      for (const term of terms) { const i = lower.indexOf(term); if (i !== -1 && (at === -1 || i < at)) at = i; }
      if (at === -1) return escapeHtml(text.slice(0, 180)) + (text.length > 180 ? '…' : '');
      const start = Math.max(0, at - 70), end = Math.min(text.length, at + 170);
      return (start ? '…' : '') + escapeHtml(text.slice(start, end)) + (end < text.length ? '…' : '');
    };
    const highlight = (html, terms) => {
      if (!terms.length) return html;
      const re = new RegExp(`(${terms.map((x) => escapeRe(escapeHtml(x))).join('|')})`, 'gi');
      return html.replace(re, '<mark>$1</mark>');
    };

    const run = () => {
      const q = searchInput.value.trim();
      if (!q) { results.hidden = true; label.hidden = true; list.hidden = false; return; }
      const terms = [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))];
      const scored = [];
      for (const it of items) {
        let score = 0, ok = true;
        for (const term of terms) {
          const inH = it.hl.split(term).length - 1, inT = it.tl.split(term).length - 1;
          if (!inH && !inT) { ok = false; break; }
          score += inH * 6 + Math.min(inT, 8);
        }
        if (ok) scored.push({ it, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 14);
      list.hidden = true; results.hidden = false; label.hidden = false;
      label.innerHTML = t(scored.length === 1 ? 'match' : 'matches', { n: scored.length, q: escapeHtml(q) })
        + (scored.length > top.length ? t('topN', { n: top.length }) : '');
      if (!top.length) { results.innerHTML = `<li class="empty">${escapeHtml(t('noMatches'))}</li>`; return; }
      const qs = encodeURIComponent(q);
      results.innerHTML = top.map(({ it }) => {
        const doc = data.docs[it.d];
        const href = `${doc.f}?q=${qs}${it.a ? '#' + encodeURIComponent(it.a) : ''}`;
        return `<li><a class="row" href="${href}">
          <span class="row-num">${doc.n}</span>
          <span class="row-main">
            <span class="result-path">${escapeHtml(doc.s)}</span>
            <span class="row-title">${highlight(escapeHtml(it.h), terms)}</span>
            <span class="row-deck">${highlight(snippet(it.t, terms), terms)}</span>
          </span>
          <span class="row-arrow" aria-hidden="true">→</span>
        </a></li>`;
      }).join('');
    };

    searchInput.addEventListener('input', run);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { searchInput.value = ''; run(); searchInput.blur(); }
      if (e.key === 'Enter') { const first = results.querySelector('a'); if (first && !results.hidden) first.click(); }
    });
    if (location.hash === '#search') { searchInput.focus(); history.replaceState(null, '', location.pathname); }
  }

  // ---------- reader ----------
  if (isDoc) {
    const bar = document.querySelector('.progress span');
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scroller.scrollTop / max) : 0})`;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // contents: highlight the section being read, keep it visible in the sidebar
    const links = new Map([...document.querySelectorAll('[data-toc]')].map((a) => [a.dataset.toc, a]));
    const heads = [...article.querySelectorAll('h2[id], h3[id]')].filter((h) => links.has(h.id));
    const toc = document.querySelector('.toc');
    let active = null;
    const setActive = () => {
      const top0 = scroller.getBoundingClientRect().top + 120;
      let current = heads[0];
      for (const h of heads) { if (h.getBoundingClientRect().top < top0) current = h; else break; }
      const link = current && links.get(current.id);
      if (!link || link === active) return;
      active?.classList.remove('is-active');
      link.classList.add('is-active');
      active = link;
      const r = link.getBoundingClientRect(), tr = toc.getBoundingClientRect();
      if (r.top < tr.top + 60) toc.scrollTop -= tr.top + 60 - r.top;
      else if (r.bottom > tr.bottom - 12) toc.scrollTop += r.bottom - tr.bottom + 12;
    };
    scroller.addEventListener('scroll', setActive, { passive: true });
    setActive();

    // wrap matches of `re` in <mark class=cls>; returns the marks in document order
    const markAll = (re, has, cls) => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest('.h-anchor, mark') || !has.test(n.nodeValue) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const marks = [];
      nodes.forEach((node) => {
        const frag = document.createDocumentFragment();
        node.nodeValue.split(re).forEach((part, i) => {
          if (i % 2) { const m = document.createElement('mark'); m.className = cls; m.textContent = part; frag.appendChild(m); marks.push(m); }
          else if (part) frag.appendChild(document.createTextNode(part));
        });
        node.replaceWith(frag);
      });
      return marks;
    };
    const unmark = (cls) => {
      const parents = new Set();
      article.querySelectorAll(`mark.${cls}`).forEach((m) => { parents.add(m.parentNode); m.replaceWith(document.createTextNode(m.textContent)); });
      parents.forEach((p) => p.normalize());
    };
    const termsRegex = (terms) => {
      const source = `(${terms.map(escapeRe).join('|')})`;
      return [new RegExp(source, 'gi'), new RegExp(source, 'i')];
    };

    // words searched on the home page
    const q = params.get('q');
    if (q) {
      const terms = [...new Set(q.toLowerCase().split(/\s+/).filter((x) => x.length > 1 || /[㐀-鿿]/.test(x)))];
      if (terms.length) {
        const [re, has] = termsRegex(terms);
        const marks = markAll(re, has, 'hit');
        if (!location.hash && marks[0]) {
          const r = marks[0].getBoundingClientRect(), s = scroller.getBoundingClientRect();
          scroller.scrollTop += r.top - s.top - scroller.clientHeight / 3;
        }
      }
    }

    // find in this survey
    const find = document.getElementById('find');
    const findBox = find?.closest('.find');
    const count = document.getElementById('find-count');
    let hits = [], idx = -1, timer = 0;
    const show = (i) => {
      if (!hits.length) return;
      hits[idx]?.classList.remove('is-current');
      idx = (i + hits.length) % hits.length;
      const m = hits[idx];
      m.classList.add('is-current');
      count.textContent = `${idx + 1} / ${hits.length}`;
      const r = m.getBoundingClientRect(), s = scroller.getBoundingClientRect();
      if (r.top < s.top + 40 || r.bottom > s.bottom - 40) {
        scroller.classList.remove('smooth');
        scroller.scrollTop += r.top - s.top - scroller.clientHeight / 3;
        requestAnimationFrame(() => scroller.classList.add('smooth'));
      }
    };
    const runFind = () => {
      unmark('find-hit');
      unmark('hit');
      hits = []; idx = -1;
      const value = find.value.trim();
      findBox.classList.remove('has-hits');
      if (!value || (value.length < 2 && !/[㐀-鿿]/.test(value))) { count.textContent = ''; return; }
      const [re, has] = termsRegex([value]);
      hits = markAll(re, has, 'find-hit');
      if (!hits.length) { count.textContent = t('findNone'); return; }
      findBox.classList.add('has-hits');
      show(0);
    };
    if (find) {
      find.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runFind, 140); });
      find.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); show(idx + (e.shiftKey ? -1 : 1)); }
        if (e.key === 'Escape') { find.value = ''; runFind(); find.blur(); }
      });
      document.querySelectorAll('[data-find]').forEach((b) => b.addEventListener('click', () => show(idx + (b.dataset.find === 'prev' ? -1 : 1))));
    }
  }

  // ---------- keyboard ----------
  const findInput = document.getElementById('find');
  const findUsable = () => findInput && findInput.offsetParent !== null;
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const focus = (el) => { e.preventDefault(); el.focus(); el.select(); };
    if (e.key === '/' && !typing) {
      if (searchInput) return focus(searchInput);
      if (findUsable()) return focus(findInput);
    }
    if (mod && key === 'f' && !e.shiftKey) {
      if (findUsable()) return focus(findInput);
      if (searchInput && portal) return focus(searchInput);
    }
    if (mod && key === 'k') {
      e.preventDefault();
      if (searchInput) searchInput.focus(); else location.href = 'index.html#search';
    }
    if (!typing && !mod && !e.altKey && scroller) {
      if (key === 'home') { e.preventDefault(); scroller.scrollTop = 0; }
      if (key === 'end') { e.preventDefault(); scroller.scrollTop = scroller.scrollHeight; }
    }
  });

  // ---------- desktop-app buttons ----------
  if (portal) {
    document.querySelectorAll('[data-open-file]').forEach((b) => b.addEventListener('click', () => portal.openFile(b.dataset.openFile)));
    document.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => portal.reveal(b.dataset.reveal)));
    document.querySelectorAll('[data-open-folder]').forEach((b) => b.addEventListener('click', () => portal.openFolder()));
    document.querySelectorAll('[data-choose-folder]').forEach((b) => b.addEventListener('click', () => portal.chooseFolder()));
  }
})();
