// Research index — paper feed: waterfall cards, recommendations, detail sheet, boards.
// Talks to the desktop app through window.portal.feed (see app/preload.cjs).
(function () {
  'use strict';

  const api = window.portal && window.portal.feed;
  const root = document.documentElement;
  const lang = root.dataset.lang || 'en';
  const S = JSON.parse(document.getElementById('feed-strings')?.textContent || '{}');
  const t = (k, v = {}) => String(S[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Formulas: $…$, $$…$$, \(…\) and \[…\] are rendered with KaTeX (bundled locally); the rest is escaped.
  // A single-$ formula must not start or end with a space and must not be followed by a digit,
  // so prices like "$5 to $10" are left alone.
  const MATH_RE = /(?<!\\)\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/g;
  // LaTeX text commands outside formulas (common in arXiv abstracts): \emph{x}, \textbf{x}, \%, ``quotes''
  const textHtml = (s) => esc(s)
    .replace(/\\(?:emph|textit)\{([^{}]*)\}/g, '<em>$1</em>')
    .replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>')
    .replace(/\\texttt\{([^{}]*)\}/g, '<code>$1</code>')
    .replace(/\\(?:textsc|textrm|textsf|text|mbox|url)\{([^{}]*)\}/g, '$1')
    .replace(/\\(&amp;|[%_#$])/g, '$1')
    .replace(/``|&#39;&#39;/g, '"')
    .replace(/(\S)~(\S)/g, '$1 $2');
  function renderMath(src, display) {
    if (!window.katex) return esc(display ? `$$${src}$$` : `$${src}$`);
    try { return window.katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', errorColor: 'currentColor' }); }
    catch { return esc(src); }
  }
  function mathHtml(text, fmt = textHtml, { display = true } = {}) {
    const s = String(text ?? '').replace(/\u0000/g, '');
    const re = new RegExp(MATH_RE.source, 'g');
    const parts = [];
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      const src = m[1] ?? m[2] ?? m[3] ?? m[4];
      // formulas become placeholders, so formatting that wraps a formula (**bold $x$**) still applies
      out += `${s.slice(last, m.index)}\u0000${parts.length}\u0000`;
      parts.push(renderMath(src.trim(), display && (m[1] != null || m[2] != null)));
      last = re.lastIndex;
    }
    if (!parts.length) return fmt(s);
    return fmt(out + s.slice(last)).replace(/\u0000(\d+)\u0000/g, (_, i) => parts[+i]);
  }
  const titleMath = (text) => mathHtml(text, textHtml, { display: false });

  // Plain-text version of LaTeX, for the big typographic covers and labels (no KaTeX there):
  // R$^2$ → R², $\nabla$Mimic → ∇Mimic, $L_\infty$ → L∞, \emph{x} → x, \% → %
  const TEX_SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    nabla: '∇', infty: '∞', partial: '∂', times: '×', cdot: '·', approx: '≈', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', pm: '±',
    to: '→', rightarrow: '→', leftarrow: '←', sim: '∼', in: '∈', star: '⋆', ell: 'ℓ', ldots: '…', dots: '…', cdots: '⋯', circ: '∘',
  };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', '*': '*' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', t: 'ₜ' };
  const script = (map, s) => ([...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join('') : s);
  const tex = (s) => String(s ?? '')
    .replace(/\\(?:emph|textbf|textit|textsc|textrm|texttt|text|mathrm|mathbf|mathcal|mathbb|mathit|mathsf|boldsymbol|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)\s?/g, (_, name) => TEX_SYM[name] ?? '')
    .replace(/(?<!\\)\^\{([^{}]*)\}|(?<!\\)\^(\S)/g, (_, a, b) => script(SUP, a ?? b))
    .replace(/(?<!\\)_\{([^{}]*)\}|(?<!\\)_(\S)/g, (_, a, b) => script(SUB, a ?? b))
    .replace(/(?<!\\)\$/g, '')
    .replace(/\\([%&_#$])/g, '$1')
    .replace(/[{}]/g, '');
  const scroller = document.getElementById('scroller');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  if (!api) {
    $('#feed').hidden = true;
    $('#feed-web').hidden = false;
    return;
  }

  // ---------- icons ----------
  const ICON = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.7 1.1 5 2.9 1.3-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M5 4h14v12l-4 4H5z M15 20v-4h4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };

  // ---------- state ----------
  let META = null;
  const topicsById = {};
  const view = Object.assign({ mode: 'recommended', topic: '', collection: '' }, store.get('ri-feed-view', {}));
  // "For you" and "Recommended" are one tab now (the one that also learns from what you read right now)
  if (view.mode === 'foryou') view.mode = 'recommended';
  view.query = '';
  // "Liked" was a board inside Saved; it is a tab of its own now
  if (view.mode === 'saved' && view.collection === '__liked') Object.assign(view, { mode: 'liked', collection: '' });
  // your own papers (saved, liked): no directions, no "new papers" news
  const personal = () => view.mode === 'saved' || view.mode === 'liked';
  const feed = { offset: 0, total: 0, loading: false, done: false, order: [], cards: new Map(), token: 0 };
  let newBelow = 0; // papers fetched since this deck was dealt: they join the pages below, nothing moves
  let learned = []; // papers read since "Recommended" last dealt (time on them, or something done with them)
  // set by swipe.js (the one-paper-at-a-time view): it takes over the sheet's stepping and closing while it is open
  const hooks = {};
  const swipeOn = () => !!hooks.active?.();
  // Chinese translation of what is on screen (on by default in the Chinese interface)
  let trOn = !!store.get('ri-tr', lang === 'zh');
  let trNeedKey = false;

  // ---------- helpers ----------
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const shortDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return lang === 'zh' ? `${m}月${d}日` : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const longDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return lang === 'zh' ? `${y}年${m}月${d}日` : new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const relTime = (ms) => {
    if (!ms) return t('never');
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return t('justNow');
    if (min < 60) return t('minAgo', { n: min });
    if (min < 60 * 24) return t('hAgo', { n: Math.round(min / 60) });
    return t('dAgo', { n: Math.round(min / 1440) });
  };
  const topicLabel = (id) => (topicsById[id] ? topicsById[id][lang] || topicsById[id].en : id);
  const ACCENT = { blue: 'yellow', ink: 'blue', red: 'ink', yellow: 'blue', green: 'sand', sand: 'red', sky: 'blue', rose: 'red', slate: 'yellow' };
  // Each direction keeps its colour, but appears in three arrangements so neighbouring cards differ.
  const colorsFor = (c) => {
    const P = META.palette;
    if (c.survey) return { bg: P.sand[0], ink: P.ink[0], accent: P.ink[0] };
    const key = topicsById[c.topics[0]]?.color || 'sand';
    const [bg, ink] = P[key] || P.sand;
    const accent = (P[ACCENT[key]] || P.blue)[0];
    const v = (hash(c.id) >>> 9) % 3;
    if (v === 1 && key !== 'sand') return { bg: P.sand[0], ink: P.ink[0], accent: bg };
    if (v === 2 && key !== 'ink' && key !== 'slate') return { bg: P.ink[0], ink: P.ink[1], accent: bg };
    return { bg, ink, accent };
  };
  const RATIOS = ['3 / 4', '4 / 5', '1 / 1', '3 / 4', '5 / 6', '4 / 5'];
  function coverWord(title) {
    const head = title.split(/:\s/)[0].trim();
    if (head !== title && head.length <= 26 && head.split(/\s+/).length <= 3) return head;
    const STOPW = /^(a|an|the|of|for|in|on|to|and|with|via|from|by|is|are|do|does|what|when|how|why|can|towards?|beyond|into|your|we|our|at|as|be|llms?)$/i;
    const words = title.replace(/[?:.,!]/g, ' ').split(/\s+/).filter((w) => w && !STOPW.test(w));
    return words.slice(0, 3).join(' ');
  }
  function wordSize(word, big) {
    const n = word.length;
    const s = n <= 5 ? 64 : n <= 8 ? 52 : n <= 12 ? 40 : n <= 18 ? 32 : n <= 26 ? 27 : 23;
    return big ? s * 1.6 : s;
  }

  // ---------- cover ----------
  // Figures that have loaded once are in the browser's cache: a cover that shows one again (the open paper, the
  // swipe card) starts with it in place, instead of the generated art for a frame or two and then a swap.
  const figReady = new Set();
  function coverHtml(c, { big = false, ratio = true } = {}) {
    const h = hash(c.id);
    const col = colorsFor(c);
    const word = coverWord(tex(c.title));
    const shape = `s${(h >>> 4) % 6}`;
    const fig = c.cover && c.cover.url;
    const ready = fig && figReady.has(c.cover.url);
    const style = `--cv-bg:${col.bg};--cv-ink:${col.ink};--cv-accent:${col.accent};${ratio ? `aspect-ratio:${RATIOS[h % RATIOS.length]};` : ''}`;
    return `<div class="cover${c.survey ? ' is-survey' : ''}${fig ? ' has-fig' : ''}${ready ? ' fig-on' : ''}" style="${style}">
      <div class="cv-top"><span class="tp">${esc(c.topics.length ? topicLabel(c.topics[0]) : (c.survey ? t('survey') : 'arXiv'))}</span><span>${esc(shortDate(c.published))}</span></div>
      <div class="cv-shape ${shape}"></div>
      <div class="cv-word" style="font-size:${wordSize(word, big)}px">${esc(word)}</div>
      ${c.survey ? `<span class="cv-badge">${esc(t('survey'))}</span>` : ''}
      ${fig ? `<img class="cv-fig${ready ? ' is-loaded' : ''}" alt="" ${ready ? 'decoding="sync"' : 'loading="lazy"'} src="${esc(c.cover.url)}">` : ''}
    </div>`;
  }
  // On cards, the cover takes the figure's own shape (clamped), so wide diagrams are not lost in white space.
  const fitRatio = (w, h) => Math.max(0.8, Math.min(1.9, w / (h * 1.12)));
  function wireFigure(scope) {
    scope.querySelectorAll('.cv-fig:not([data-wired])').forEach((img) => {
      img.dataset.wired = '1';
      const done = () => {
        figReady.add(img.getAttribute('src'));
        img.classList.add('is-loaded');
        const cover = img.closest('.cover');
        cover?.classList.add('fig-on');
        if (cover?.closest('.card') && img.naturalWidth && img.naturalHeight) cover.style.aspectRatio = `${fitRatio(img.naturalWidth, img.naturalHeight).toFixed(3)} / 1`;
      };
      const fail = () => { img.closest('.cover')?.classList.remove('has-fig'); img.remove(); };
      if (img.complete && img.naturalWidth) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', fail, { once: true }); }
    });
  }

  function reasonText(r) {
    if (!r) return '';
    if (r.type === 'because') return t('because', { title: r.title.length > 46 ? r.title.slice(0, 44) + '…' : r.title });
    if (r.type === 'read') { const s = tex(trOn && r.title_zh ? r.title_zh : r.title); return t('becauseRead', { title: s.length > 46 ? s.slice(0, 44) + '…' : s }); }
    if (r.type === 'terms') return r.terms.join(' · ');
    if (r.type === 'trending') return t('trending');
    if (r.type === 'explore') return t('explore');
    if (r.type === 'new') return t('justIn');
    return '';
  }
  // Institutions (from the paper's arXiv page or OpenAlex): the Chinese name in the Chinese interface when there is
  // one; well-known ones are set a little stronger.
  const instName = (x) => (lang === 'zh' && x.zh ? x.zh : x.n);
  const BUILDING = '<svg class="inst-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5h17M5.5 20.5v-11L12 5l6.5 4.5v11M9.5 20.5v-4.5h5v4.5M9 12.5h.01M15 12.5h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function instHtml(c, max = 2, cls = 'inst') {
    const list = c?.inst || [];
    if (!list.length) return '';
    const shown = list.slice(0, max).map((x) => `<span class="inst-name${x.k ? ' is-known' : ''}">${esc(instName(x))}</span>`).join('<span class="dot"> · </span>');
    const more = list.length > max ? `<span class="inst-more">+${list.length - max}</span>` : '';
    return `<p class="${cls}" title="${esc(list.map(instName).join(' · '))}">${BUILDING}<span class="inst-list">${shown}${more}</span></p>`;
  }
  function whoText(c) {
    const first = c.authors[0] ? c.authors[0].split(' ').slice(-1)[0] : '';
    const people = first ? (c.nAuthors > 1 ? t('etal', { name: first }) : first) : '';
    return [c.inst?.[0] ? instName(c.inst[0]) : c.org, people].filter(Boolean).join(' · ');
  }

  // ---------- cards ----------
  const venueHtml = (c, cls = 'venue') => (c?.venue ? `<span class="${cls}" title="${esc(t('modeTip_venues'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" fill="currentColor"/></svg>${esc(c.venue.label)}${c.venue.note ? ` · ${esc(c.venue.note)}` : ''}</span>` : '');
  // The quality score as a small badge: five bars (one hue, filled by the score) and the number
  const qTier = (s) => (s >= 85 ? 3 : s >= 70 ? 2 : s >= 50 ? 1 : 0);
  function qualityBadge(c, cls = 'q-badge') {
    if (c?.q == null) return c?.qp ? `<span class="${cls} is-pending" title="${esc(t('qScoringHint'))}"><span class="q-meter q-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>${esc(t('qScoring'))}</b></span>` : '';
    const s = c.q, on = Math.max(1, Math.round(s / 20));
    const tier = t(`qTier${qTier(s)}`);
    return `<span class="${cls} q-t${qTier(s)}" title="${esc(t('qTip', { s, tier }))}"><span class="q-meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i${k <= on ? ' class="on"' : ''}></i>`).join('')}</span><b>${s}</b><span class="sr-only">${esc(t('q'))} ${s}</span></span>`;
  }
  // The open paper: the score, and what it rests on
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function qualityPanel(q) {
    if (!q) return '';
    const noScore = q.score == null;
    const tier = noScore ? '' : t(`qTier${qTier(q.score)}`);
    // what the score counts, and what is shown alongside for reference
    const items = [], ref = [];
    const ok = (list, text, strong) => list.push(`<li${strong ? ' class="is-strong"' : ''}>${CHECK}<span>${esc(text)}</span></li>`);
    if (q.venue) ok(items, t('qVenue', { v: `${q.venue.label}${q.venue.note ? ` · ${q.venue.note}` : ''}` }), true);
    if (q.cites) ok(items, t('qCites', { n: q.cites }));
    if (q.code) ok(items, t('qCode'));
    if (q.inst?.length) ok(ref, t('qInst', { names: q.inst.map(instName).join(lang === 'zh' ? '、' : ', ') }));
    if (q.h != null && q.h > 0) ok(ref, t('qH', { h: q.h }));
    if (q.up) ok(ref, t('qUp', { n: q.up }));
    if (q.stars) ok(ref, t('qStars', { n: q.stars }));
    const ai = q.ai ? `<div class="q-ai"><p class="q-sub">${esc(t('qAi'))}</p><div class="q-ai-grid">${['qN', 'qR', 'qS', 'qC'].map((k, i) => `<div class="q-ai-row"><span>${esc(t(k))}</span><i><b style="width:${q.ai[i] * 10}%"></b></i><em>${q.ai[i]}</em></div>`).join('')}</div></div>` : '';
    const on = noScore ? 0 : Math.max(1, Math.round(q.score / 20));
    const head = noScore && q.pending
      ? `<div class="q-head is-pending"><p class="q-num is-pending"><span class="q-meter q-meter-lg q-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></p><div class="q-what"><p class="q-label">${esc(t('qTitle'))} · <strong class="q-sheen">${esc(t('qScoring'))}</strong></p><p class="q-none">${esc(t('qScoringHint'))}</p></div></div>`
      : noScore
      ? `<div class="q-head"><p class="q-num is-none"><b>—</b></p><div class="q-what"><p class="q-label">${esc(t('qTitle'))} · <strong>${esc(t('qNoScore'))}</strong></p><p class="q-none">${esc(t('qNone'))}</p></div></div>`
      : `<div class="q-head"><p class="q-num"><b>${q.score}</b><span>/100</span></p><div class="q-what"><p class="q-label">${esc(t('qTitle'))} · <strong>${esc(tier)}</strong></p><span class="q-meter q-meter-lg" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i${k <= on ? ' class="on"' : ''}></i>`).join('')}</span></div></div>`;
    return `<section class="q-panel${noScore ? ` is-none${q.pending ? ' is-pending' : ''}` : ` q-t${qTier(q.score)}`}" aria-label="${esc(t('qTitle'))}" aria-live="polite">
      ${head}
      ${items.length ? `<p class="q-sub q-sub-first">${esc(t('qCounted'))}</p><ul class="q-list">${items.join('')}</ul>` : ''}
      ${ai}
      ${ref.length ? `<div class="q-ref"><p class="q-sub">${esc(t('qRef'))}</p><ul class="q-list is-ref">${ref.join('')}</ul></div>` : ''}
      ${noScore ? '' : `<p class="q-note">${esc(t('qNote'))}</p>`}
    </section>`;
  }
  function cardHtml(c) {
    return `<article class="card${c.opened ? ' is-opened' : ''}" data-id="${esc(c.id)}">
      ${coverHtml(c)}
      <button class="cv-save${c.saved ? ' on' : ''}" type="button" data-act="save" aria-label="${esc(t('save'))}" title="${esc(t('save'))}">${ICON.mark}</button>
      <div class="card-body">
        ${(view.mode === 'foryou' || view.mode === 'recommended') && c.reason ? `<p class="card-reason">${esc(reasonText(c.reason))}</p>` : ''}
        ${c.venue || c.q != null || c.qp ? `<p class="card-venue">${qualityBadge(c)}${venueHtml(c)}</p>` : ''}
        ${titleBlock(c)}
        <div class="card-meta">
          <span class="card-who">${c.hasTake ? `<span class="card-take" title="${esc(t('takeTitle'))}">✦</span>` : ''}${esc(whoText(c))}</span>
          <button class="card-like${c.liked ? ' on' : ''}" type="button" data-act="like" aria-label="${esc(t('like'))}">${ICON.heart}<span>${c.up + (c.liked ? 1 : 0) || ''}</span></button>
        </div>
      </div>
    </article>`;
  }
  function updateCardEl(c) {
    document.querySelectorAll(`.card[data-id="${CSS.escape(c.id)}"]`).forEach((el) => {
      el.classList.toggle('is-opened', !!c.opened);
      const who = el.querySelector('.card-who');
      if (who) who.innerHTML = `${c.hasTake ? `<span class="card-take" title="${esc(t('takeTitle'))}">✦</span>` : ''}${esc(whoText(c))}`;
      el.querySelector('.cv-save')?.classList.toggle('on', !!c.saved);
      const like = el.querySelector('.card-like');
      if (like) { like.classList.toggle('on', !!c.liked); like.querySelector('span').textContent = (c.up + (c.liked ? 1 : 0)) || ''; }
      const cover = el.querySelector('.cover');
      if (c.cover?.url && cover && !cover.querySelector('.cv-fig')) {
        cover.classList.add('has-fig');
        cover.insertAdjacentHTML('beforeend', `<img class="cv-fig" alt="" src="${esc(c.cover.url)}">`);
        wireFigure(cover);
      }
    });
  }

  // ---------- waterfall layout ----------
  const grid = $('#grid');
  let cols = [];
  const colCount = () => Math.max(2, Math.min(7, Math.floor((grid.clientWidth + 22) / 238)));
  function makeColumns(n) {
    grid.innerHTML = '';
    cols = Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = 'col'; grid.appendChild(d); return d; });
  }
  function place(el) {
    let best = cols[0];
    for (const c of cols) if (c.offsetHeight < best.offsetHeight) best = c;
    best.appendChild(el);
  }
  let lastCols = 0;
  function relayout() {
    const n = colCount();
    if (n === lastCols) return;
    lastCols = n;
    const els = feed.order.map((id) => grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
    makeColumns(n);
    els.forEach((el) => { el.style.animation = 'none'; place(el); });
  }
  new ResizeObserver(() => relayout()).observe(grid);

  // ---------- figure requests for cards near the viewport ----------
  const wanted = new Set();
  let wantTimer = 0;
  const coverObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.id;
      const c = feed.cards.get(id);
      coverObserver.unobserve(e.target);
      if (c && (!c.cover || !c.inst?.length)) wanted.add(id); // its figure, and the institutions from the same page
    }
    clearTimeout(wantTimer);
    wantTimer = setTimeout(() => { if (wanted.size) { api.covers([...wanted]); wanted.clear(); } }, 250);
  }, { root: scroller, rootMargin: '700px 0px' });

  function addCards(items) {
    const frag = [];
    for (const c of items) {
      if (feed.cards.has(c.id) && feed.order.includes(c.id)) continue;
      feed.cards.set(c.id, c);
      feed.order.push(c.id);
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(c);
      const el = tmp.firstElementChild;
      el.style.animationDelay = `${Math.min(frag.length, 12) * 25}ms`;
      frag.push(el);
    }
    for (const el of frag) { place(el); wireFigure(el); coverObserver.observe(el); trObserver.observe(el); }
  }

  // ---------- loading ----------
  const status = $('#feed-status');
  const more = $('#feed-more');
  const end = $('#feed-end');
  const msg = $('#feed-msg');

  function skeleton(n = 12) {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'skeleton';
      el.innerHTML = `<div class="cover" style="aspect-ratio:${RATIOS[i % RATIOS.length]}"></div><div class="sk-line"></div><div class="sk-line short"></div>`;
      place(el);
    }
  }

  // The feed pages through a "deck" dealt by the app. Coming back to Papers returns to the same deck
  // (kept for this window); Refresh deals a new one that replaces everything on the page.
  const deckKey = () => `ri-deck:${view.mode}|${view.topic}|${view.query}|${view.collection}`;
  const sessionGet = (k) => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
  const sessionSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } };
  const liveView = () => view.mode === 'recommended' && !view.query;
  async function load(reset, { fresh = false, keep = null, focus = null } = {}) {
    if (feed.loading && !reset) { if (keep) feed.redealAfter = true; return; }
    const token = ++feed.token;
    feed.loading = true;
    if (reset) {
      feed.redealAfter = false;
      if (!liveView()) basisEl.hidden = true;
      feed.deck = fresh ? '' : sessionGet(deckKey());
      feed.offset = 0; feed.done = false; feed.order = []; feed.cards.clear();
      lastCols = colCount(); makeColumns(lastCols);
      skeleton();
      end.hidden = true; msg.hidden = true;
      newBelow = 0;
      if (META) renderStatus();
      const headH = $('.feed-head').offsetHeight;
      if (scroller.scrollTop > headH) scroller.scrollTop = headH;
    }
    const res = await api.list({
      mode: view.mode === 'liked' ? 'saved' : view.mode, topic: personal() ? '' : view.topic, query: view.query, minQ: personal() ? 0 : minQ,
      collection: view.mode === 'liked' ? '__liked' : view.collection,
      offset: feed.offset, limit: liveView() ? 12 : 30, deck: feed.deck || '', fresh: reset && fresh,
      ...(keep ? { keep } : {}),
      // a new "Recommended" batch starts with what you have just read
      ...(focus ? { focus } : reset && fresh && liveView() && learned.length ? { focus: learned.splice(0).slice(-3) } : {}),
    });
    if (token !== feed.token) return;
    renderBasis(res.basis);
    feed.deck = res.deck || '';
    sessionSet(deckKey(), feed.deck);
    if (reset) makeColumns(lastCols);
    feed.total = res.total;
    feed.offset += res.items.length;
    feed.done = feed.offset >= res.total;
    addCards(res.items);
    feed.loading = false;
    end.hidden = !(feed.done && feed.total > 0);
    if (!feed.total) showEmpty();
    renderModes();
    renderCold();
    // you read something on another tab since this deck was dealt → deal the part below the screen again
    if (reset && liveView() && learned.length) feed.redealAfter = true;
    if (feed.redealAfter) { feed.redealAfter = false; requestAnimationFrame(() => redealTail()); return; }
    // keep filling while the bottom of the feed is still in view
    requestAnimationFrame(() => {
      if (!feed.done && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 1400) load(false);
    });
  }

  // "Recommended" names the papers it is learning from right now (your latest reading).
  const basisEl = $('#feed-basis');
  function renderBasis(basis) {
    if (!basis || !liveView()) { basisEl.hidden = true; return; }
    basisEl.hidden = false;
    basisEl.classList.toggle('is-cold', !basis.length);
    if (!basis.length) { basisEl.textContent = t('basisCold'); return; }
    basisEl.innerHTML = `<span class="lbl">${esc(t('basis'))}</span>`
      + basis.map((b) => `<button type="button" data-open="${esc(b.id)}" title="${esc(tex(b.title))}">${titleMath(trOn && b.title_zh ? b.title_zh : b.title)}</button>`).join('<span class="sep">·</span>');
  }
  basisEl.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openSheet(b.dataset.open); });

  // After you read a paper, "Recommended" deals the cards you have not scrolled to yet again, around
  // what you just read. Cards you have already seen stay where they are.
  function redealTail() {
    if (!liveView() || !feed.order.length) return;
    if (feed.loading) { feed.redealAfter = true; return; }
    const bottom = scroller.getBoundingClientRect().bottom;
    const keep = [];
    for (const id of feed.order) {
      const el = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (el && el.getBoundingClientRect().top >= bottom) {
        coverObserver.unobserve(el); trObserver.unobserve(el); el.remove();
        feed.cards.delete(id);
      } else keep.push(id);
    }
    feed.order = keep;
    feed.offset = keep.length;
    feed.done = false;
    load(false, { keep, focus: learned.splice(0).slice(-3) });
  }

  function showEmpty() {
    msg.hidden = false;
    const st = META.status;
    if (!st.count) msg.innerHTML = `<b>${esc(t('firstRunTitle'))}</b><br>${esc(t('firstRun'))}`;
    else if (personal()) msg.textContent = view.mode === 'liked' ? t('emptyLiked') : t('emptySaved');
    else msg.textContent = t('emptyFeed');
  }

  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !feed.loading && !feed.done && feed.order.length) load(false);
  }, { root: scroller, rootMargin: '1400px 0px' }).observe(more);

  // ---------- status line ----------
  // Progress labels arrive as English direction names ("World models", "World models surveys").
  function sourceLabel(label = '') {
    const base = label.replace(/ (surveys|venues)$/, '');
    const topic = META.topics.find((x) => x.en === base);
    if (topic) return topicLabel(topic.id) + (/ surveys$/.test(label) ? ` · ${t('survey')}` : / venues$/.test(label) ? ` · ${t('mode_venues')}` : '');
    if (label === 'Surveys') return t('mode_surveys');
    if (label === 'Top venues') return t('mode_venues');
    return label || '…';
  }
  function renderStatus(st = META.status) {
    const p = st.progress || {};
    if (st.fetching && !p.finished) {
      status.innerHTML = `${esc(t('count', { n: st.count.toLocaleString() }))} · <b>${esc(t('fetching', { label: sourceLabel(p.label), done: (p.done || 0) + 1, total: p.total || '…' }))}</b>`;
    } else {
      status.textContent = `${t('count', { n: st.count.toLocaleString() })} · ${t('updated', { rel: relTime(st.lastFetch) })}`;
    }
    if (newBelow > 0 && !personal()) status.insertAdjacentHTML('beforeend', ` · <span class="st-new">${esc(t('newBelow', { n: newBelow }))}</span>`);
    if (trOn && trNeedKey) status.insertAdjacentHTML('beforeend', ` · <b>${esc(trNeedKey === true ? t('trNeedsKey') : trNeedKey)}</b>`);
    $('#refresh').classList.toggle('is-busy', !!st.fetching && !p.finished);
  }
  // A new batch replaces the whole page. New papers from arXiv / Hugging Face are looked for in the
  // background (at most hourly); the ones that arrive while you scroll are mixed into the pages you
  // have not reached yet (the app does that when it sends the next page), never on top of these.
  async function refreshFeed() {
    newBelow = 0;
    await load(true, { fresh: true });
    const st = await api.refresh();
    META.status = { ...META.status, ...st };
    renderStatus();
  }

  let emptyReload = 0;
  api.on('feed:batch', (b) => {
    if (!META) return; // the phone starts fetching before the page has loaded
    META.status.count = b.count;
    if (!feed.total && !view.query && !personal()) { renderStatus(); clearTimeout(emptyReload); emptyReload = setTimeout(() => load(true), 700); return; }
    if (b.added > 0 && !personal()) {
      newBelow += b.added;
      // you had reached the end: the new ones are there to scroll to now
      if (feed.done && !feed.loading && feed.order.length) { feed.done = false; end.hidden = true; load(false); }
    }
    renderStatus();
  });
  api.on('feed:progress', (p) => {
    if (!META) return;
    META.status.progress = p;
    META.status.fetching = !p.finished;
    if (p.finished) META.status.lastFetch = Date.now();
    renderStatus();
  });
  api.on('feed:cover', ({ id, cover, caption, inst }) => {
    const c = feed.cards.get(id);
    if (c) { c.cover = cover; if (inst) c.inst = inst; updateCardEl(c); }
    if (sheetState.id === id && inst?.length) {
      const slot = document.querySelector('#sheet .sheet-inst-slot');
      if (slot) slot.innerHTML = instHtml({ inst }, 6, 'sheet-inst');
    }
    if (sheetState.id === id && cover?.url) refreshSheetMedia(cover, caption);
  });
  setInterval(() => { if (META) renderStatus(); }, 60000);
  // the AI judge has rated papers: their badges show the new score
  api.on('feed:quality', ({ scores, unrated } = {}) => {
    const paint = (c, arrived) => document.querySelectorAll(`.card[data-id="${CSS.escape(c.id)}"]`).forEach((card) => {
      let line = card.querySelector('.card-venue');
      const html = qualityBadge(c) + venueHtml(c);
      if (!html) return line?.remove();
      if (!line) { line = document.createElement('p'); line.className = 'card-venue'; card.querySelector('.card-title')?.before(line); }
      line.innerHTML = html;
      if (arrived) line.querySelector('.q-badge')?.classList.add('q-arrive');
    });
    for (const [id, q] of Object.entries(scores || {})) {
      const c = feed.cards.get(id);
      if (!c || (c.q === q && !c.qp)) continue;
      c.q = q; c.qp = false;
      paint(c, q != null);
    }
    for (const id of unrated || []) { const c = feed.cards.get(id); if (c?.qp) { c.qp = false; paint(c, false); } }
    // the open paper
    const id = sheetState.id, d = sheetState.data;
    if (!id || !d?.quality) return;
    if (scores && id in scores && scores[id] != null) {
      api.get(id).then((fresh) => {
        if (sheetState.id !== id || !fresh?.quality) return;
        d.quality = fresh.quality;
        paintQuality(true);
      });
    } else if ((unrated || []).includes(id) && d.quality.pending) { d.quality.pending = false; paintQuality(false); }
  });
  // the open paper's quality panel, again; a score that has just come in counts up and its bars fill
  function paintQuality(arrived) {
    const slot = $('.sheet-q-slot', sheet), q = sheetState.data?.quality;
    if (!slot || !q) return;
    slot.innerHTML = qualityPanel(q);
    if (!arrived || q.score == null) return;
    const panel = slot.firstElementChild, num = slot.querySelector('.q-num b');
    panel?.classList.add('q-arrive');
    if (!num || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = q.score, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 750);
      num.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    num.textContent = '0';
    requestAnimationFrame(step);
  }

  // ---------- modes, directions, boards ----------
  const MODES = ['recommended', 'latest', 'trending', 'venues', 'surveys', 'saved', 'liked'];
  const modeCount = (m) => (m === 'saved' ? META.savedTotal : m === 'liked' ? META.likedTotal : 0);
  // the tabs shown here (the phone app has no surveys)
  const shownModes = () => [...$('#modes').querySelectorAll('[data-mode]')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.mode);
  function renderModes() {
    $('#modes').innerHTML = MODES.map((m) => `<button type="button" data-mode="${m}" class="${view.mode === m && !view.query ? 'is-on' : ''}"${S[`modeTip_${m}`] ? ` title="${esc(t(`modeTip_${m}`))}"` : ''}>${esc(t(`mode_${m}`))}${modeCount(m) ? `<span class="count">${modeCount(m)}</span>` : ''}</button>`).join('');
    inkTo($('#modes'));
    fitTabs($('#modes'));
  }
  // a tab row wider than the screen keeps the open tab in view
  function fitTabs(row) {
    const on = row?.querySelector('.is-on');
    if (!on || row.scrollWidth <= row.clientWidth + 1) return;
    const r = row.getBoundingClientRect(), b = on.getBoundingClientRect();
    row.scrollTo({ left: row.scrollLeft + (b.left + b.width / 2) - (r.left + r.width / 2), behavior: row.dataset.fitted ? 'smooth' : 'instant' });
    row.dataset.fitted = '1';
  }
  // The marker under the open tab glides over from the tab you were on (also used by the swipe view): a blue
  // line in Classic, a pill that springs across (and stretches on the way) in Glass.
  function inkTo(row) {
    if (!row) return;
    const on = row.querySelector('.is-on');
    let ink = row.querySelector(':scope > .tab-ink');
    if (!ink) { ink = document.createElement('span'); ink.className = 'tab-ink'; ink.setAttribute('aria-hidden', 'true'); row.prepend(ink); }
    if (!on || !on.offsetWidth) { ink.style.opacity = '0'; row._ink = null; return; }
    const x = on.offsetLeft, w = on.offsetWidth, y = on.offsetTop, h = on.offsetHeight, prev = row._ink;
    row._ink = { x, w };
    ink.style.opacity = '1';
    const place = (px, pw) => { ink.style.setProperty('--x', `${px}px`); ink.style.setProperty('--w', `${pw}px`); ink.style.setProperty('--wn', String(pw)); };
    ink.style.setProperty('--y', `${y}px`);
    ink.style.setProperty('--h', `${h}px`);
    if (prev && (prev.x !== x || prev.w !== w)) {
      ink.style.transition = 'none';
      place(prev.x, prev.w);
      void ink.offsetWidth;
      ink.style.transition = '';
      ink.classList.remove('is-moving');
      void ink.offsetWidth;
      ink.classList.add('is-moving');
      clearTimeout(ink._t);
      ink._t = setTimeout(() => ink.classList.remove('is-moving'), 600);
    }
    place(x, w);
  }
  new ResizeObserver(() => { const row = $('#modes'); if (row._ink) { row._ink = null; inkTo(row); } }).observe($('#modes'));
  // ---------- directions: one button beside the tabs opens all of them (shared with the swipe view) ----------
  const dirPop = document.createElement('div');
  dirPop.className = 'dir-pop';
  dirPop.dataset.glass = 'menu';
  dirPop.dataset.pop = '';
  dirPop.setAttribute('role', 'dialog');
  dirPop.hidden = true;
  document.body.appendChild(dirPop);
  let dirState = { btn: null, pick: null, onMinQ: null };
  let minQ = store.get('ri-minq', false) ? 70 : 0;
  function closeDirs() {
    if (dirPop.hidden) return;
    dirPop.hidden = true;
    dirState.btn?.setAttribute('aria-expanded', 'false');
  }
  function openDirs(btn, topic, pick, onMinQ = null) {
    if (!META) return;
    if (!dirPop.hidden && dirState.btn === btn) return closeDirs();
    dirState = { btn, pick, onMinQ };
    const item = (id, label, color) => `<button type="button" data-dir="${id}" class="${topic === id ? 'is-on' : ''}" aria-pressed="${topic === id}">${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</button>`;
    dirPop.setAttribute('aria-label', t('directions'));
    dirPop.innerHTML = `<p class="dir-head">${esc(t('directions'))}</p><div class="dir-list">${item('', t('dirAll'))}${META.topics.map((x) => item(x.id, x[lang] || x.en, META.palette[x.color][0])).join('')}</div>
      <label class="dir-q"><span class="dir-q-text"><b>${esc(t('qOnly'))}</b><small>${esc(t('qOnlyHint'))}</small></span><input type="checkbox" class="ab-switch" data-minq${minQ ? ' checked' : ''}></label>`;
    dirPop.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = Math.min(380, innerWidth - 24);
    dirPop.style.width = `${w}px`;
    dirPop.style.top = `${Math.round(r.bottom + 10)}px`;
    dirPop.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.right - w)))}px`;
    btn.setAttribute('aria-expanded', 'true');
  }
  dirPop.addEventListener('change', (e) => {
    if (!e.target.matches('[data-minq]')) return;
    minQ = e.target.checked ? 70 : 0;
    store.set('ri-minq', !!minQ);
    paintDirBtn(dirState.btn, dirState.btn === dirBtn ? view.topic : null);
    dirState.onMinQ?.();
  });
  dirPop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    const pick = dirState.pick;
    closeDirs();
    pick?.(b.dataset.dir);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dirPop.hidden) { e.stopPropagation(); closeDirs(); } }, true);
  addEventListener('resize', closeDirs);
  // the button shows the open direction: its colour on the icon, and its name where there is room
  function paintDirBtn(btn, topic) {
    if (!btn || !META) return;
    if (topic == null) topic = btn.dataset.topic || '';
    btn.dataset.topic = topic;
    const tp = topicsById[topic];
    btn.classList.toggle('is-on', !!tp || !!minQ);
    const color = tp ? META.palette[tp.color][0] : '';
    const name = btn.querySelector('.dir-name'), dot = btn.querySelector('.dir-dot');
    if (name) name.innerHTML = tp ? `<i style="background:${color}"></i>${esc(tp[lang] || tp.en)}${minQ ? ' · 70+' : ''}` : esc(minQ ? t('qOnly') : t('directions'));
    if (dot) { dot.hidden = !tp; dot.style.background = color; }
    btn.title = tp ? `${t('directions')} · ${tp[lang] || tp.en}` : t('directions');
  }
  const dirBtn = $('#dir-btn');
  dirBtn?.addEventListener('click', (e) => { e.stopPropagation(); openDirs(dirBtn, view.topic, (id) => { if (id !== view.topic) setView({ topic: id }); }, () => load(true)); });

  function renderChips() {
    const chips = $('#chips');
    // the boards of Saved are the only row under the tabs; the directions sit behind their button
    chips.hidden = view.mode !== 'saved';
    if (dirBtn) dirBtn.hidden = personal();
    paintDirBtn(dirBtn, view.topic);
    if (view.mode === 'saved') {
      const b = META.collections;
      const item = (id, label, n, extra = '') => `<button type="button" class="chip-btn${view.collection === id ? ' is-on' : ''}${extra}" data-board="${esc(id)}">${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
      const custom = b.find((c) => c.id === view.collection && c.id !== 'saved');
      chips.innerHTML = item('', t('boardsAll'), META.savedTotal)
        + b.map((c) => item(c.id, c.id === 'saved' ? t('boardDefault') : c.name, c.n)).join('')
        + `<button type="button" class="chip-btn dashed" data-board-new>${esc(t('newBoard'))}</button>`
        + (custom ? `<span class="spacer"></span><button type="button" class="chip-btn" data-board-rename>${esc(t('rename'))}</button><button type="button" class="chip-btn" data-board-delete>${esc(t('deleteBoard'))}</button>` : '');
      return;
    }
    chips.innerHTML = '';
  }
  function setView(patch, { keepQuery = false } = {}) {
    Object.assign(view, patch);
    if (!keepQuery && !('query' in patch)) { view.query = ''; $('#fq').value = ''; }
    store.set('ri-feed-view', { mode: view.mode, topic: view.topic, collection: view.collection });
    renderModes();
    renderChips();
    return load(true);
  }
  $('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    if (b.dataset.mode === view.mode && !view.query) return refreshFeed(); // clicking the open tab again = new batch
    setView({ mode: b.dataset.mode, collection: b.dataset.mode === 'saved' ? view.collection : '' });
  });
  $('#chips').addEventListener('click', async (e) => {
    const topic = e.target.closest('[data-topic]');
    if (topic) return setView({ topic: topic.dataset.topic });
    const board = e.target.closest('[data-board]');
    if (board) return setView({ collection: board.dataset.board });
    if (e.target.closest('[data-board-new]')) return boardInput(e.target.closest('[data-board-new]'));
    const rename = e.target.closest('[data-board-rename]');
    if (rename) {
      const c = META.collections.find((x) => x.id === view.collection);
      return inlineInput(rename, c?.name || '', async (name) => { Object.assign(META, await api.collections('rename', view.collection, name)); });
    }
    if (e.target.closest('[data-board-delete]')) {
      const c = META.collections.find((x) => x.id === view.collection);
      if (c && confirm(t('deleteConfirm', { name: c.name }))) {
        Object.assign(META, await api.collections('delete', view.collection));
        setView({ collection: '' });
      }
    }
  });
  // Small inline text box in place of a chip (Electron has no window.prompt).
  function inlineInput(btn, value, onDone) {
    const input = document.createElement('input');
    input.className = 'chip-input';
    input.placeholder = t('boardName');
    input.value = value;
    btn.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (ok) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (ok && name) await onDone(name);
      renderChips();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }
  function boardInput(btn) {
    inlineInput(btn, '', async (name) => {
      const res = await api.collections('add', name);
      Object.assign(META, res);
      view.collection = res.created;
      setView({ collection: res.created });
    });
  }
  async function refreshBoards() { Object.assign(META, await api.boards()); if (view.mode === 'saved') renderChips(); renderModes(); }

  // ---------- search, refresh, interests ----------
  let qTimer = 0;
  $('#fq').addEventListener('input', (e) => {
    if (swipeOn()) hooks.exit?.();
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setView({ query: e.target.value.trim() }, { keepQuery: true }), 320);
  });
  $('#fq').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; setView({ query: '' }, { keepQuery: true }); e.target.blur(); } });
  $('#refresh').addEventListener('click', () => refreshFeed());

  const tune = $('#tune-pop');
  $('#tune').addEventListener('click', (e) => {
    e.stopPropagation();
    tune.hidden = !tune.hidden;
    if (!tune.hidden) { $('#tune-text').value = META.interests; $('#tune-text').focus(); }
  });
  document.addEventListener('click', (e) => { if (!tune.hidden && !e.target.closest('#tune-pop')) tune.hidden = true; });
  $('#tune-save').addEventListener('click', async () => {
    META.interests = await api.interests($('#tune-text').value);
    tune.hidden = true;
    renderCold();
    if (view.mode !== 'recommended') setView({ mode: 'recommended', topic: '' }); else load(true, { fresh: true });
  });

  // ---------- card clicks ----------
  grid.addEventListener('click', async (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    const c = feed.cards.get(id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save') { e.stopPropagation(); return toggleSave(c); }
    if (act === 'like') { e.stopPropagation(); return toggleLike(c); }
    openSheet(id);
  });
  async function toggleSave(c, collection = 'saved') {
    const res = await api.act(c.id, c.saved ? 'unsave' : 'save', c.saved ? {} : { collection });
    Object.assign(c, res);
    updateCardEl(c);
    refreshBoards();
    return res;
  }
  async function toggleLike(c) {
    const res = await api.act(c.id, c.liked ? 'unlike' : 'like');
    Object.assign(c, res);
    updateCardEl(c);
    if (res.liked) document.querySelectorAll(`.card[data-id="${CSS.escape(c.id)}"] .card-like`).forEach(pop);
    refreshBoards();
    return res;
  }
  // restart a one-off animation on an element (like / save bounce)
  function pop(el) { if (!el) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  // ---------- detail sheet ----------
  const sheet = $('#sheet');
  const sheetState = { id: '', data: null, noteTimer: 0 };
  const KEY_CUE = /\b(we (propose|introduce|present|show|find|demonstrate|develop|design)|our (method|approach|results)|outperform|achiev|improv|state-of-the-art|surpass|reduc)/i;
  function abstractHtml(text) {
    // split only where a sentence really ends (punctuation, then a space), so URLs and decimals stay intact
    const sentences = String(text).split(/(?<=[.!?])\s+(?=[A-Z0-9(“"'\[$\\])/);
    return sentences.map((s) => (KEY_CUE.test(s) ? `<span class="key">${mathHtml(s.trim())}</span>` : mathHtml(s.trim()))).join(' ');
  }
  function refreshSheetMedia(cover, caption) {
    if (!sheetState.data) return;
    sheetState.data.paper.cover = cover;
    if (caption != null) sheetState.data.paper.caption = caption;
    $('.sheet-media', sheet).innerHTML = mediaHtml(sheetState.data.paper);
    wireFigure(sheet);
  }
  function mediaHtml(p) {
    return `${coverHtml(p, { big: true, ratio: false })}${p.caption || p.cover?.url ? `<p class="sheet-caption">${titleMath(p.caption || '')}</p>` : ''}`;
  }

  // ---------- reading time ----------
  // How long a paper stays open (while the window is visible), and whether you did anything with it,
  // tells "Recommended" how much it interested you.
  const reading = { id: '', since: 0, ms: 0, engaged: false };
  function readPause() { if (reading.since) { reading.ms += performance.now() - reading.since; reading.since = 0; } }
  function readStop() {
    if (!reading.id) return;
    readPause();
    const ms = Math.min(6e5, Math.round(reading.ms));
    if (ms >= 400) api.act(reading.id, 'dwell', { ms });
    if (ms >= 5000 || reading.engaged) learned.push(reading.id);
    reading.id = '';
  }
  function readStart(id) {
    readStop();
    Object.assign(reading, { id, ms: 0, engaged: false, since: document.hidden ? 0 : performance.now() });
  }
  const engaged = () => { if (reading.id) reading.engaged = true; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) readPause(); else if (reading.id && !reading.since) reading.since = performance.now(); });
  window.addEventListener('pagehide', readStop);

  async function openSheet(id) {
    const wasOpen = !sheet.hidden;
    const data = await api.get(id);
    if (!data) return;
    sheetState.id = id;
    sheetState.data = data;
    sheetState.hasTake = false;
    const p = data.paper;
    const c = feed.cards.get(id);
    if (c && !c.opened) { c.opened = true; updateCardEl(c); }
    api.act(id, 'open');
    readStart(id);
    if (!p.cover || !p.inst?.length) api.covers([id]);

    const authors = p.authors.length > 12 ? `${p.authors.slice(0, 12).join(', ')} ${t('moreAuthors', { n: p.authors.length - 12 })}` : p.authors.join(', ');
    const links = [
      ['abs', 'arXiv'], ['pdf', 'PDF'], ['html', 'HTML'], ['hf', 'Hugging Face'],
    ].map(([k, label]) => `<a href="${esc(p.links[k])}" target="_blank" rel="noopener">${label} ↗</a>`).join('')
      + (p.github ? `<a href="${esc(p.github)}" target="_blank" rel="noopener">${esc(t('code'))}${p.stars ? ` ★ ${p.stars}` : ''} ↗</a>` : '');

    sheet.innerHTML = `
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(tex(p.title))}">
        <button class="sheet-close" type="button" data-close aria-label="${esc(t('close'))}">×</button>
        <div class="sheet-scroll">
        <div class="sheet-media">${mediaHtml(p)}</div>
        <div class="sheet-body">
          <div class="sheet-tags">
            ${p.survey ? `<span class="chip-btn is-on">${esc(t('survey'))}</span>` : ''}
            ${p.topics.map((x) => `<button type="button" class="chip-btn" data-topic-go="${x}"><span class="sw" style="background:${META.palette[topicsById[x]?.color || 'sand'][0]}"></span>${esc(topicLabel(x))}</button>`).join('')}
          </div>
          <div id="sheet-title-box">${sheetTitleHtml(p)}</div>
          <p class="sheet-authors">${esc(authors)}</p>
          <div class="sheet-inst-slot">${instHtml(p, 6, 'sheet-inst')}</div>
          <div class="sheet-meta">${venueHtml(p)}<span>${esc(longDate(p.published))}</span>${p.primary ? `<span>${esc(p.primary)}</span>` : ''}${p.up ? `<span>${esc(t('upvotes', { n: p.up }))}</span>` : ''}${p.comment ? `<span>${esc(p.comment.slice(0, 80))}</span>` : ''}</div>
          <div class="sheet-q-slot">${qualityPanel(data.quality)}</div>
          <div class="sheet-links">${links}</div>
          <div class="sheet-actions">
            <button type="button" class="act like${p.liked ? ' on' : ''}" data-sheet="like">${ICON.heart}<span>${esc(p.liked ? t('liked') : t('like'))}</span></button>
            <button type="button" class="act save${p.saved ? ' on' : ''}" data-sheet="save">${ICON.mark}<span>${esc(p.saved ? t('savedTo') : t('save'))} ▾</span></button>
            <button type="button" class="act share" data-sheet="share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(t('share'))}</span></button>
            <button type="button" class="act ghost" data-sheet="hide">${esc(t('hide'))}</button>
          </div>
          <h4>${esc(t('abstract'))}<span class="abs-tools" id="abs-tools"></span></h4>
          <p class="abstract" id="abstract"></p>
          <div class="take" id="take"></div>
          <section class="ask" id="ask" hidden aria-label="${esc(t('askTitle'))}">
            <div class="ask-thread" id="ask-thread"></div>
            <div class="ask-sugg" id="ask-sugg"></div>
            <form class="ask-form" id="ask-form">
              <textarea class="ask-input" id="ask-input" rows="1" placeholder="${esc(t('askPh'))}" spellcheck="false"></textarea>
              <button type="submit" class="btn-primary ask-send" id="ask-send">${esc(t('askSend'))}</button>
            </form>
            <div class="ask-foot"><span>${esc(t('askNote'))}</span><button type="button" class="tool" id="ask-clear" hidden>${esc(t('askClear'))}</button></div>
          </section>
          <h4>${esc(t('notes'))}<span class="saved-note" id="note-state"></span></h4>
          <textarea class="note-box" id="note" placeholder="${esc(t('notesPh'))}">${esc(data.note)}</textarea>
          ${data.similar.length ? `<h4>${esc(t('similar'))}</h4><div>${data.similar.map((s) => `
            <div class="mini" data-open="${esc(s.id)}">${coverHtml(s, { ratio: false })}<div><div class="mini-title">${titleMath(trOn && s.title_zh ? s.title_zh : s.title)}</div><div class="mini-meta">${esc(shortDate(s.published))}${s.topics[0] ? ' · ' + esc(topicLabel(s.topics[0])) : ''}</div></div></div>`).join('')}</div>` : ''}
          <p class="sheet-keys">${esc(t('keys'))} · ${esc(t('keys2'))}</p>
        </div>
        </div>
      </div>`;
    sheet.hidden = false;
    if (!wasOpen) zoomOpen(id);
    wireFigure(sheet);
    $('.sheet-body', sheet).scrollTop = 0;
    renderTakePanel(id);
    renderAsk(id);
    absShowOriginal = false;
    sheetState.absError = null;
    renderAbstract();
    if (trOn) translateSheet();
    $('#note', sheet).addEventListener('input', (e) => {
      clearTimeout(sheetState.noteTimer);
      const mark = $('#note-state', sheet);
      if (mark) mark.textContent = '';
      engaged();
      sheetState.noteTimer = setTimeout(async () => {
        await api.act(id, 'note', { text: e.target.value });
        if (sheetState.id === id && mark.isConnected) mark.textContent = t('noteSaved');
      }, 600);
    });
  }
  function closeSheet() {
    readStop();
    const id = sheetState.id;
    const paper = sheetState.data?.paper;
    fadeOut(sheet, zoomTarget(id));
    sheet.hidden = true;
    sheet.innerHTML = '';
    sheetState.id = '';
    sheetState.data = null;
    if (swipeOn()) return hooks.sheetClosed?.(id, paper);
    if (id) revealCard(id);
    if (learned.length && liveView()) redealTail();
  }
  // The closed paper fades away on its own copy of the contents, so the real sheet is closed at once
  // (keys, Back and the next click already go to the feed).
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fadeOut(el, to = null) {
    if (el.hidden || !el.firstChild || calm()) return;
    const ghost = document.createElement('div');
    ghost.className = `${el.className} sheet-ghost${to ? ' is-zoom' : ''}`;
    ghost.setAttribute('aria-hidden', 'true');
    // moving the contents resets their scroll position: keep it, so the copy fades where you were reading
    const scrolled = [...el.querySelectorAll('.sheet-scroll, .sheet-body, .sheet-media')].map((n) => [n, n.scrollTop]);
    while (el.firstChild) ghost.appendChild(el.firstChild);
    document.body.appendChild(ghost);
    for (const [n, top] of scrolled) n.scrollTop = top;
    const panel = to && $('.sheet-panel', ghost);
    if (panel) { zoom(panel, to, false); setTimeout(() => ghost.remove(), 420); }
    else setTimeout(() => ghost.remove(), 280);
  }
  // Glass: the paper grows out of its card and goes back into it (a spring like iOS 27's zoom, measured in
  // FlClash: the page fades in over the first 65% of the way and out over the last 65%).
  const SPRING = {
    zoom: 'linear(0, 0.0335 1.3%, 0.1097 3.8%, 0.3167 10%, 0.3958 12.5%, 0.5043 16.3%, 0.5688 18.8%, 0.6534 22.5%, 0.7239 26.3%, 0.7817 30%, 0.8141 32.5%, 0.8420 35%, 0.8867 40%, 0.9194 45%, 0.9478 51.2%, 0.9665 57.5%, 0.9805 65%, 0.9897 73.8%, 1)',
    unzoom: 'linear(0, 0.0031 1.3%, 0.0118 2.5%, 0.0254 3.8%, 0.0429 5%, 0.0876 7.5%, 0.1706 11.3%, 0.3874 20%, 0.4759 23.8%, 0.5573 27.5%, 0.6304 31.3%, 0.6945 35%, 0.7501 38.8%, 0.7974 42.5%, 0.8372 46.3%, 0.8802 51.2%, 0.9132 56.3%, 0.9382 61.3%, 0.9606 67.5%, 0.9758 73.8%, 0.9873 81.3%, 1)',
  };
  const glassOn = () => document.documentElement.classList.contains('fl');
  // A question before something that is easy to tap by accident: a sheet at the foot of a phone, a small
  // dialog elsewhere. Resolves true for yes.
  function confirmAsk({ title, text = '', ok, danger = false }) {
    return new Promise((done) => {
      const box = document.createElement('div');
      box.className = 'ri-confirm';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<div class="share-backdrop" data-cf="no"></div>
        <div class="cf-panel" data-glass="menu">
          <p class="cf-title">${esc(title)}</p>${text ? `<p class="cf-text">${esc(text)}</p>` : ''}
          <div class="cf-actions"><button type="button" class="cf-btn${danger ? ' danger' : ' primary'}" data-cf="yes">${esc(ok)}</button>
          <button type="button" class="cf-btn" data-cf="no" data-back-close>${esc(t('cancel'))}</button></div>
        </div>`;
      const finish = (yes) => { document.removeEventListener('keydown', key, true); box.classList.add('is-leaving'); setTimeout(() => box.remove(), 200); done(yes); };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); finish(true); } };
      box.addEventListener('click', (e) => { const v = e.target.closest('[data-cf]')?.dataset.cf; if (v) finish(v === 'yes'); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(box);
      box.querySelector('[data-cf="yes"]').focus({ preventScroll: true });
    });
  }
  const confirmHide = () => confirmAsk({ title: t('hideAsk'), text: t('hideAskText'), ok: t('hide'), danger: true });
  const SHADOW_ROOM = 140; // how far the panel's shadow reaches past it
  const isPhone = () => document.documentElement.classList.contains('is-mobile') || innerWidth <= 640;
  function zoomSource(id) {
    if (swipeOn()) { const el = document.querySelector('#sw-track .sw-card.is-active'); return el?.dataset.id === id ? el : null; }
    return grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  }
  function inView(r) { return r.width > 40 && r.bottom > 40 && r.top < innerHeight - 40 && r.right > 0 && r.left < innerWidth; }
  function zoomTarget(id) {
    if (!id || !glassOn() || isPhone() || calm()) return null;
    const el = zoomSource(id);
    const r = el?.getBoundingClientRect();
    return r && inView(r) ? { rect: r, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 } : null;
  }
  function zoomOpen(id) {
    const from = zoomTarget(id);
    const panel = from && $('.sheet-panel', sheet);
    if (!panel) return;
    // this panel opens by the zoom, never by the stylesheet's own entrance: turning that back on afterwards
    // replayed it from transparent, a flash just as the zoom ended
    panel.style.animation = 'none';
    const a = zoom(panel, from, true);
    // its last frame is the panel's own look; drop the animation so nothing holds the clip or transform
    a.finished.then(() => a.cancel(), () => {});
  }
  function zoom(panel, { rect, radius }, opening) {
    const P = panel.getBoundingClientRect();
    const s = rect.width / P.width;
    const cut = Math.max(0, P.height - rect.height / s);
    const R = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
    const small = { transform: `translate(${rect.left - P.left}px, ${rect.top - P.top}px) scale(${s})`, clipPath: `inset(0 0 ${cut}px 0 round ${radius / s}px)` };
    const full = { transform: 'none', clipPath: `inset(-${SHADOW_ROOM}px round ${R}px)` };
    const frames = opening
      ? [{ ...small, opacity: 0 }, { opacity: 1, offset: 0.65 }, { ...full, opacity: 1 }]
      : [{ ...full, opacity: 1 }, { opacity: 1, offset: 0.35 }, { ...small, opacity: 0 }];
    panel.style.transformOrigin = '0 0';
    panel.style.willChange = 'transform, opacity, clip-path';
    const a = panel.animate(frames, { duration: opening ? 460 : 350, easing: opening ? SPRING.zoom : SPRING.unzoom, fill: 'both' });
    a.finished.then(() => { panel.style.willChange = ''; }, () => {});
    return a;
  }
  // Back in the grid, the paper you were last on is brought into view and briefly marked (you may have
  // stepped through several papers with ← →).
  function revealCard(id) {
    const el = grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect(), v = scroller.getBoundingClientRect();
    if (r.top < v.top + 60 || r.bottom > v.bottom - 20) el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
    // Glass: a blue ring that fades, run as its own animation. As a CSS animation on the card it took the place
    // of the card's fade-in, which then replayed from transparent when the ring was taken off (a flicker).
    if (glassOn()) {
      if (calm()) return;
      const c = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      const m = /^#([0-9a-f]{6})$/i.exec(c), n = m ? parseInt(m[1], 16) : 0x007aff;
      const rgb = `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
      el.animate([
        { boxShadow: `0 0 0 3px rgba(${rgb}, 1)` }, { boxShadow: `0 0 0 3px rgba(${rgb}, 1)`, offset: 0.3 }, { boxShadow: `0 0 0 3px rgba(${rgb}, 0)` },
      ], { duration: 1400, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      return;
    }
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1500);
  }
  function stepSheet(dir) {
    if (swipeOn()) return hooks.step?.(dir);
    const i = feed.order.indexOf(sheetState.id);
    const next = feed.order[i + dir];
    if (next) openSheet(next);
    if (dir > 0 && i + dir >= feed.order.length - 4 && !feed.done) load(false);
  }
  async function sheetAction(kind) {
    const p = sheetState.data?.paper;
    if (!p) return;
    engaged();
    const c = feed.cards.get(p.id) || p;
    if (kind === 'like') {
      const res = await toggleLike(c);
      Object.assign(p, res);
      const b = $('[data-sheet="like"]', sheet);
      b.classList.toggle('on', res.liked);
      b.querySelector('span').textContent = res.liked ? t('liked') : t('like');
      if (res.liked) pop(b);
    }
    if (kind === 'save') return boardMenu();
    if (kind === 'share') return window.RIShare?.open(p);
    if (kind === 'quicksave') {
      if (!p.saved) { const res = await toggleSave(c); Object.assign(p, res); }
      markSaveButton(p);
    }
    if (kind === 'hide') {
      if (isPhone() && !(await confirmHide())) return;
      if (swipeOn()) { closeSheet(); return hooks.hide?.(p.id); }
      await api.act(p.id, 'hide');
      document.querySelectorAll(`.card[data-id="${CSS.escape(p.id)}"]`).forEach((el) => el.remove());
      const i = feed.order.indexOf(p.id);
      feed.order.splice(i, 1);
      const next = feed.order[i];
      if (next) openSheet(next); else closeSheet();
    }
  }
  function markSaveButton(p) {
    const b = $('[data-sheet="save"]', sheet);
    if (!b) return;
    b.classList.toggle('on', !!p.saved);
    b.querySelector('span').textContent = `${p.saved ? t('savedTo') : t('save')} ▾`;
  }
  function boardMenu() {
    const old = $('.board-menu', sheet);
    if (old) { window.riPopRemove ? window.riPopRemove(old) : old.remove(); return; }
    const p = sheetState.data.paper;
    const cols = new Set(sheetState.data.cols);
    const menu = document.createElement('div');
    menu.className = 'board-menu';
    menu.dataset.pop = 'remove';
    const render = () => {
      menu.innerHTML = META.collections.map((c) => `<button type="button" data-board-toggle="${esc(c.id)}" class="${cols.has(c.id) ? 'on' : ''}"><span class="box">${cols.has(c.id) ? '✓' : ''}</span>${esc(c.id === 'saved' ? t('boardDefault') : c.name)}</button>`).join('')
        + `<input type="text" placeholder="${esc(t('newBoard'))}" data-board-new-input>`;
    };
    render();
    $('.sheet-actions', sheet).appendChild(menu);
    menu.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-board-toggle]');
      if (!b) return;
      const col = b.dataset.boardToggle;
      const on = cols.has(col);
      const res = await api.act(p.id, on ? 'unsave' : 'save', { collection: col });
      on ? cols.delete(col) : cols.add(col);
      sheetState.data.cols = [...cols];
      Object.assign(p, res);
      const c = feed.cards.get(p.id);
      if (c) { Object.assign(c, res); updateCardEl(c); }
      markSaveButton(p);
      refreshBoards().then(render);
    });
    menu.addEventListener('keydown', async (e) => {
      const input = e.target.closest('[data-board-new-input]');
      if (!input || e.key !== 'Enter' || !input.value.trim()) return;
      const res = await api.collections('add', input.value.trim());
      Object.assign(META, res);
      const saved = await api.act(p.id, 'save', { collection: res.created });
      cols.add(res.created);
      sheetState.data.cols = [...cols];
      Object.assign(p, saved);
      const c = feed.cards.get(p.id);
      if (c) { Object.assign(c, saved); updateCardEl(c); }
      markSaveButton(p);
      render();
      refreshBoards();
    });
  }
  // ---------- AI take (summary + ideas; DeepSeek or Claude) ----------
  let AI = null; // { provider, hasKey, deepseek: {...}, claude: {...}, context }
  const live = new Map(); // `${id}|${lang}:${mode}` -> { buf, stage, mode } while a take is being written
  const takeKey = (mode) => `${lang}:${mode}`;
  // on the phone the key note says where it is kept there
  const keyHint = (provider) => t(root.classList.contains('is-mobile') && S[`aiKeyHint_${provider}_mobile`] ? `aiKeyHint_${provider}_mobile` : `aiKeyHint_${provider}`);
  const modelName = (m) => String(m || '').replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ').replace(/\b(opus|sonnet|haiku|fable|mythos)\b/g, (w) => w[0].toUpperCase() + w.slice(1));
  const labelFor = (provider, model) => (provider === 'claude' || /^claude/.test(model || '') ? modelName(model) : `DeepSeek · ${model}`);
  const currentLabel = () => (!AI ? '' : AI.provider === 'claude' ? modelName(AI.claude.model) : `DeepSeek · ${AI.deepseek.model}`);

  function md(text) {
    const plain = (s) => textHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const inline = (s) => mathHtml(s, plain);
    // display formulas written over several lines become one line, so the line-by-line pass keeps them whole
    const joined = String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => `$$${x.replace(/\s*\n\s*/g, ' ')}$$`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, x) => `\\[${x.replace(/\s*\n\s*/g, ' ')}\\]`);
    let html = '', list = false;
    for (const raw of joined.split('\n')) {
      const l = raw.trim();
      if (/^#{1,4}\s/.test(l)) { if (list) { html += '</ul>'; list = false; } html += `<h5>${inline(l.replace(/^#+\s*/, ''))}</h5>`; }
      else if (/^[-*•]\s/.test(l)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(l.replace(/^[-*•]\s+/, ''))}</li>`; }
      else if (/^>\s?/.test(l)) { if (list) { html += '</ul>'; list = false; } const q = l.replace(/^>\s?/, ''); if (q) html += `<blockquote>${inline(q)}</blockquote>`; }
      else if (l) { if (list) { html += '</ul>'; list = false; } html += `<p>${inline(l)}</p>`; }
    }
    return list ? html + '</ul>' : html;
  }
  const takeHead = (label, model = currentLabel()) => `<div class="take-head"><span class="take-title"><span class="spark" aria-hidden="true">✦</span>${esc(label)}</span><span class="take-model">${esc(model)}</span></div>`;

  function showIdle(box) {
    box.innerHTML = `${takeHead(t('takeTitle'))}
      <div class="take-actions">
        <button type="button" class="take-btn primary" data-take="quick"><b>${esc(t('quickTake'))}</b><small>${esc(t('takeHintQuick'))}</small></button>
        <button type="button" class="take-btn" data-take="deep"><b>${esc(t('deepRead'))}</b><small>${esc(t('takeHintDeep'))}</small></button>
      </div>`;
  }
  function showSetup(box) {
    box.innerHTML = `${takeHead(t('takeTitle'))}
      <p class="take-note">${esc(t('err_nokey'))}</p>
      <div class="ai-key-row"><input type="password" data-take-key placeholder="${esc(t('aiKeyPh'))}" autocomplete="off" spellcheck="false"><button type="button" class="btn-primary" data-take-key-save>${esc(t('aiKeySave'))}</button></div>
      <p class="take-hint">${esc(keyHint(AI.provider))}</p>`;
  }
  function showStreaming(box, slot) {
    const L = live.get(slot);
    if (!L) return;
    const label = L.stage === 'fetching' ? t('takeFetching') : L.buf ? (L.mode === 'deep' ? t('deepRead') : t('quickTake')) : t('takeReading');
    box.innerHTML = `${takeHead(label)}
      <div class="take-body is-streaming">${md(L.buf)}<span class="caret"></span></div>
      <div class="take-foot"><button type="button" class="tool" data-take-stop="${esc(slot.split('|')[1])}">${esc(t('takeStop'))}</button></div>`;
  }
  function showTake(box, take) {
    const meta = t('takeMeta', {
      mode: take.mode === 'deep' ? t('deepRead') : t('quickTake'),
      tokens: ((take.tokens?.input || 0) + (take.tokens?.output || 0)).toLocaleString(),
      cost: take.cost == null ? '' : ` · ≈ $${take.cost.toFixed(take.cost < 0.1 ? 3 : 2)}`,
    });
    const label = labelFor(take.provider, take.model);
    box.dataset.model = label;
    box.innerHTML = `${takeHead(take.mode === 'deep' ? t('deepRead') : t('quickTake'), label)}
      <div class="take-body">${md(take.text)}</div>
      ${take.abstractOnly ? `<p class="take-note">${esc(t('takeAbstractOnly'))}</p>` : ''}
      ${take.truncated ? `<p class="take-note">${esc(t('takeTruncated'))}</p>` : ''}
      <div class="take-foot">
        <button type="button" class="tool" data-take-notes>${esc(t('takeToNotes'))}</button>
        ${take.mode === 'quick' ? `<button type="button" class="tool" data-take="deep">${esc(t('deepRead'))}</button>` : ''}
        <button type="button" class="tool" data-take="${take.mode}">${esc(t('takeRegenerate'))}</button>
        <span class="take-meta">${esc(meta)}</span>
      </div>`;
  }
  function showError(box, err, mode) {
    const msg = t(`err_${err.code}`, { message: err.message || '' });
    box.innerHTML = `${takeHead(t('takeTitle'))}
      <p class="take-note is-error">${esc(msg === `err_${err.code}` ? t('err_unknown', { message: err.message || err.code }) : msg)}</p>
      <div class="take-foot">${err.code === 'nokey' || err.code === 'auth' ? `<button type="button" class="tool" data-take-setup>${esc(t('setupKey'))}</button>` : ''}<button type="button" class="tool" data-take="${mode || 'quick'}">${esc(t('retry'))}</button></div>`;
  }

  async function renderTakePanel(id) {
    const box = $('#take', sheet);
    if (!box) return;
    paintAskChrome(id);
    for (const mode of ['deep', 'quick']) {
      const slot = `${id}|${takeKey(mode)}`;
      if (live.has(slot)) return showStreaming(box, slot);
    }
    const takes = await api.takeGet(id);
    if (sheetState.id !== id) return;
    const done = takes[takeKey('deep')] || takes[takeKey('quick')];
    sheetState.hasTake = !!Object.values(takes).some((x) => x?.text);
    paintAskChrome(id);
    if (done) return showTake(box, done);
    if (!AI.hasKey) return showSetup(box);
    showIdle(box);
  }
  async function runTake(mode) {
    engaged();
    const id = sheetState.id;
    const box = $('#take', sheet);
    if (!id || !box) return;
    if (!AI.hasKey) return showSetup(box);
    const slot = `${id}|${takeKey(mode)}`;
    if (!live.has(slot)) live.set(slot, { buf: '', stage: mode === 'deep' ? 'fetching' : 'thinking', mode });
    showStreaming(box, slot);
    const res = await api.takeRun(id, mode, lang);
    if (res?.error) { live.delete(slot); if (sheetState.id === id) showError(box, res.error, mode); }
  }
  let streamFrame = 0;
  api.on('feed:take', (ev) => {
    const slot = `${ev.id}|${ev.key}`;
    const mode = ev.key.split(':')[1];
    const L = live.get(slot) || { buf: '', stage: 'thinking', mode };
    if (ev.stage) L.stage = ev.stage;
    if (ev.delta) { L.buf += ev.delta; L.stage = 'writing'; }
    live.set(slot, L);
    if (ev.done || ev.error) live.delete(slot);
    if (ev.done) { const c = feed.cards.get(ev.id); if (c) { c.hasTake = true; updateCardEl(c); } }
    if (ev.done && sheetState.id === ev.id) { sheetState.hasTake = true; paintAskChrome(ev.id); }
    if (sheetState.id !== ev.id || !ev.key.startsWith(`${lang}:`)) return;
    const box = $('#take', sheet);
    if (!box) return;
    if (ev.done) return showTake(box, ev.take);
    if (ev.error) return ev.error.code === 'stopped' ? renderTakePanel(ev.id) : showError(box, ev.error, mode);
    if (!streamFrame) streamFrame = requestAnimationFrame(() => { streamFrame = 0; if (live.has(slot)) showStreaming(box, slot); });
  });
  function ideasToNotes() {
    const box = $('#take', sheet);
    const note = $('#note', sheet);
    if (!box || !note) return;
    const sections = ($('.take-body', box)?.innerText || '').split(/\n(?=\S)/);
    const body = box.querySelector('.take-body');
    const heads = [...body.querySelectorAll('h5')];
    const last = heads[heads.length - 1];
    const items = [];
    for (let el = last?.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.tagName === 'UL') el.querySelectorAll('li').forEach((li) => items.push(`- ${li.innerText.trim()}`));
      else if (el.tagName === 'P') items.push(el.innerText.trim());
    }
    if (!items.length && sections.length) items.push(sections.join('\n'));
    const stamp = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US');
    note.value = `${note.value.trim() ? note.value.trim() + '\n\n' : ''}✦ ${t('ideasFrom', { model: box.dataset.model || currentLabel() })} · ${stamp}\n${items.join('\n')}`;
    note.dispatchEvent(new Event('input'));
    const btn = $('[data-take-notes]', box);
    if (btn) btn.textContent = t('takeAdded');
  }
  // ---------- questions about the open paper: asked directly, or as follow-ups on its take ----------
  const chatLive = new Map(); // id -> { q, buf, stage, error } while an answer is on its way (or has just failed)
  const chatHist = new Map(); // id -> stored messages [user, assistant, user, assistant, …]
  const errText = (err) => {
    const msg = t(`err_${err.code}`, { message: err.message || '' });
    return msg === `err_${err.code}` ? t('err_unknown', { message: err.message || err.code }) : msg;
  };
  const answerMeta = (m) => [
    labelFor(m.provider, m.model),
    `${((m.tokens?.input || 0) + (m.tokens?.output || 0)).toLocaleString()} tokens`,
    m.cost == null ? '' : `≈ $${m.cost.toFixed(m.cost < 0.1 ? 3 : 2)}`,
    m.abstractOnly ? t('askAbstractOnly') : '',
  ].filter(Boolean).join(' · ');
  const qaBlock = (q, body, foot = '', attrs = '') => `<div class="qa"${attrs}>
      <div class="qa-q"><span class="qa-mark" aria-hidden="true"></span><p>${esc(q)}</p></div>
      <div class="qa-a take-body">${body}</div>${foot}</div>`;
  function liveBody(L) {
    if (L.error) return `<p class="take-note is-error">${esc(errText(L.error))}</p>`;
    const wait = L.buf ? '' : `<p class="take-note">${esc(L.stage === 'fetching' ? t('askFetching') : t('askThinking'))}</p>`;
    return `${md(L.buf)}${wait}<span class="caret"></span>`;
  }
  function threadHtml(id) {
    const msgs = chatHist.get(id) || [];
    let html = '';
    for (let i = 0; i + 1 < msgs.length; i += 2) {
      const a = msgs[i + 1];
      html += qaBlock(msgs[i].text, md(a.text), `<div class="qa-foot">
        <button type="button" class="tool" data-ask-copy="${i + 1}">${esc(t('askCopy'))}</button>
        <button type="button" class="tool" data-ask-note="${i + 1}">${esc(t('askToNotes'))}</button>
        <span class="take-meta">${a.truncated ? `${esc(t('takeTruncated'))} · ` : ''}${esc(answerMeta(a))}</span></div>`);
    }
    const L = chatLive.get(id);
    if (L) {
      const foot = L.error ? `<div class="qa-foot">${L.error.code === 'nokey' || L.error.code === 'auth' ? `<button type="button" class="tool" data-take-setup>${esc(t('setupKey'))}</button>` : ''}<button type="button" class="tool" data-ask-retry>${esc(t('retry'))}</button></div>` : '';
      html += qaBlock(L.q, liveBody(L), foot, ' id="ask-live"');
    }
    return html;
  }
  // the parts around the thread: suggestions, placeholder, Ask / Stop, Clear
  function paintAskChrome(id) {
    const box = $('#ask', sheet);
    if (!box || sheetState.id !== id) return;
    box.hidden = !AI?.hasKey;
    const busy = chatLive.has(id) && !chatLive.get(id).error;
    const empty = !(chatHist.get(id) || []).length && !chatLive.has(id);
    const follow = sheetState.hasTake || !empty;
    const list = (follow && sheetState.hasTake ? S.askSuggestFollow : S.askSuggest) || [];
    $('#ask-sugg', box).innerHTML = empty ? list.map((s) => `<button type="button" data-ask-suggest>${esc(s)}</button>`).join('') : '';
    $('#ask-input', box).placeholder = follow ? t('askPhFollow') : t('askPh');
    requestAnimationFrame(() => { const el = $('#ask-input', box); if (el) autosize(el); });
    const send = $('#ask-send', box);
    send.textContent = busy ? t('askStop') : t('askSend');
    send.classList.toggle('is-stop', busy);
    $('#ask-clear', box).hidden = empty || busy;
  }
  function paintThread(id) {
    const el = $('#ask-thread', sheet);
    if (!el || sheetState.id !== id) return;
    el.innerHTML = threadHtml(id);
    paintAskChrome(id);
  }
  function paintLive(id) {
    const L = chatLive.get(id);
    const el = $('#ask-live .qa-a', sheet);
    if (L && el && sheetState.id === id) el.innerHTML = liveBody(L);
  }
  async function renderAsk(id) {
    paintAskChrome(id);
    const msgs = await api.chatGet(id);
    if (sheetState.id !== id) return;
    chatHist.set(id, msgs);
    paintThread(id);
  }
  const autosize = (el) => {
    if (!el.offsetParent) return; // hidden (no API key yet): nothing to measure
    el.style.height = 'auto';
    let h = el.scrollHeight;
    if (!el.value && el.placeholder) { el.value = el.placeholder; h = el.scrollHeight; el.value = ''; }
    el.style.height = `${Math.min(h + 2, 180)}px`;
  };
  async function ask(text) {
    engaged();
    const id = sheetState.id;
    const q = String(text || '').trim();
    if (!id || !q) return;
    if (!AI.hasKey) return showSetup($('#take', sheet));
    if (chatLive.has(id) && !chatLive.get(id).error) return;
    chatLive.set(id, { q, buf: '', stage: 'thinking' });
    const input = $('#ask-input', sheet);
    if (input) { input.value = ''; autosize(input); }
    paintThread(id);
    $('#ask-live', sheet)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const res = await api.chatAsk(id, q, lang);
    if (res?.error) { chatLive.set(id, { q, buf: '', error: res.error }); paintThread(id); }
  }
  let chatFrame = 0;
  api.on('feed:chat', (ev) => {
    const L = chatLive.get(ev.id);
    if (!L) return;
    if (ev.stage) L.stage = ev.stage;
    if (ev.delta) { L.buf += ev.delta; L.stage = 'writing'; }
    if (ev.done) { chatLive.delete(ev.id); chatHist.set(ev.id, [...(chatHist.get(ev.id) || []), ...ev.msgs]); }
    if (ev.error?.code === 'stopped') {
      // a stopped answer is dropped; the question goes back into the box to edit or resend
      chatLive.delete(ev.id);
      const input = sheetState.id === ev.id && $('#ask-input', sheet);
      if (input && !input.value) { input.value = L.q; autosize(input); }
    } else if (ev.error) L.error = ev.error;
    if (sheetState.id !== ev.id) return;
    if (ev.done || ev.error || ev.stage) return paintThread(ev.id);
    if (!chatFrame) chatFrame = requestAnimationFrame(() => { chatFrame = 0; paintLive(ev.id); });
  });
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    btn.textContent = t('askCopied');
  }
  function answerToNotes(i, btn) {
    const msgs = chatHist.get(sheetState.id) || [];
    const q = msgs[i - 1], a = msgs[i];
    const note = $('#note', sheet);
    if (!q || !a || !note) return;
    note.value = `${note.value.trim() ? note.value.trim() + '\n\n' : ''}Q: ${q.text}\n${a.text.trim()}`;
    note.dispatchEvent(new Event('input'));
    btn.textContent = t('askAdded');
  }
  let clearArmed = 0;
  sheet.addEventListener('submit', (e) => {
    if (!e.target.closest('#ask-form')) return;
    e.preventDefault();
    const id = sheetState.id;
    if (chatLive.has(id) && !chatLive.get(id).error) return api.chatStop(id);
    ask($('#ask-input', sheet).value);
  });
  sheet.addEventListener('input', (e) => { if (e.target.id === 'ask-input') autosize(e.target); });
  sheet.addEventListener('keydown', (e) => {
    if (e.target.id !== 'ask-input' || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    $('#ask-form', sheet).requestSubmit();
  });
  sheet.addEventListener('click', (e) => {
    const sugg = e.target.closest('[data-ask-suggest]');
    if (sugg) return ask(sugg.textContent);
    if (e.target.closest('[data-ask-retry]')) { const L = chatLive.get(sheetState.id); if (L) { chatLive.delete(sheetState.id); ask(L.q); } return; }
    const copy = e.target.closest('[data-ask-copy]');
    if (copy) return copyText((chatHist.get(sheetState.id) || [])[+copy.dataset.askCopy]?.text || '', copy);
    const toNote = e.target.closest('[data-ask-note]');
    if (toNote) return answerToNotes(+toNote.dataset.askNote, toNote);
    const clear = e.target.closest('#ask-clear');
    if (clear) {
      if (Date.now() - clearArmed > 3000) { clearArmed = Date.now(); clear.textContent = t('askClearConfirm'); setTimeout(() => { clear.textContent = t('askClear'); }, 3000); return; }
      clearArmed = 0;
      const id = sheetState.id;
      api.chatClear(id).then(() => { chatHist.set(id, []); chatLive.delete(id); paintThread(id); });
    }
  });

  async function saveKeyFrom(input) {
    const value = input?.value.trim();
    if (!value) { input?.focus(); return; }
    AI = await api.ai({ key: value, keyProvider: AI.provider });
    input.value = '';
    renderAiPop();
    if (sheetState.id) renderTakePanel(sheetState.id);
    trNeedKey = false;
    renderStatus();
    if (trOn) { queueVisible(); if (sheetState.id) translateSheet(); }
  }

  // AI settings popover: provider, its key, DeepSeek URL / model, and the reader description
  const aiPop = $('#ai-pop');
  const providerName = (p) => (p === 'claude' ? 'Anthropic' : 'DeepSeek');
  function renderAiPop() {
    paintRate();
    if (!AI) return;
    const cur = AI[AI.provider];
    document.querySelectorAll('#ai-provider [data-provider]').forEach((b) => b.classList.toggle('is-on', b.dataset.provider === AI.provider));
    $('#ai-status').textContent = cur.hasKey ? (cur.fromEnv ? t('aiKeyEnv') : t('aiKeySaved', { hint: cur.hint })) : t('aiNoKey');
    $('#ai-status').classList.toggle('ok', cur.hasKey);
    $('#ai-key-label').textContent = t('aiKeyFor', { provider: providerName(AI.provider) });
    $('#ai-key-hint').textContent = keyHint(AI.provider);
    // the phone app talks to DeepSeek only (the key never enters the page there)
    document.querySelectorAll('#ai-provider [data-provider]').forEach((b) => { b.hidden = !!AI.providers && !AI.providers.includes(b.dataset.provider); });
    $('#ai-key-remove').hidden = !cur.hasKey || cur.fromEnv;
    $('#ai-ds').hidden = AI.provider !== 'deepseek';
    if (document.activeElement !== $('#ai-base')) $('#ai-base').value = AI.deepseek.baseUrl;
    if (document.activeElement !== $('#ai-model')) $('#ai-model').value = AI.deepseek.model;
    if (document.activeElement !== $('#ai-context')) $('#ai-context').value = AI.context;
  }
  $('#ai-provider').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-provider]');
    if (!b) return;
    AI = await api.ai({ provider: b.dataset.provider });
    renderAiPop();
    if (sheetState.id) renderTakePanel(sheetState.id);
  });
  $('#ai-btn').addEventListener('click', (e) => { e.stopPropagation(); tune.hidden = true; aiPop.hidden = !aiPop.hidden; renderAiPop(); });
  document.addEventListener('click', (e) => { if (!aiPop.hidden && !e.target.closest('#ai-pop')) aiPop.hidden = true; });
  $('#ai-key-save').addEventListener('click', () => saveKeyFrom($('#ai-key')));
  $('#ai-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKeyFrom($('#ai-key')); });
  $('#ai-key-remove').addEventListener('click', async () => { AI = await api.ai({ key: '', keyProvider: AI.provider }); renderAiPop(); if (sheetState.id) renderTakePanel(sheetState.id); });
  function paintRate() {
    const r = AI?.rate;
    if (!r) return;
    $('#ai-rate-on').checked = !!r.on;
    $('#ai-rate-cap').querySelectorAll('[data-cap]').forEach((b) => b.classList.toggle('is-on', +b.dataset.cap === r.cap));
    $('#ai-rate-spent').textContent = t('rateSpent', { v: `¥${(r.spentToday || 0).toFixed(3)}` });
  }
  $('#ai-rate-on').addEventListener('change', async (e) => { AI = await api.ai({ rate: { on: e.target.checked } }); paintRate(); });
  $('#ai-rate-cap').addEventListener('click', async (e) => { const b = e.target.closest('[data-cap]'); if (!b) return; AI = await api.ai({ rate: { cap: +b.dataset.cap } }); paintRate(); });
  $('#ai-save').addEventListener('click', async () => {
    AI = await api.ai({ context: $('#ai-context').value, baseUrl: $('#ai-base').value, model: $('#ai-model').value });
    aiPop.hidden = true;
  });

  sheet.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-take-key]');
    if (input && e.key === 'Enter') saveKeyFrom(input);
  });

  sheet.addEventListener('click', (e) => {
    const take = e.target.closest('[data-take]');
    if (take) return runTake(take.dataset.take);
    const stop = e.target.closest('[data-take-stop]');
    if (stop) return api.takeStop(sheetState.id, stop.dataset.takeStop);
    if (e.target.closest('[data-take-notes]')) return ideasToNotes();
    if (e.target.closest('[data-take-key-save]')) return saveKeyFrom($('[data-take-key]', sheet));
    if (e.target.closest('[data-take-setup]')) return showSetup($('#take', sheet));
  });

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    // following a link to arXiv / the PDF / the code counts as real interest
    if (e.target.closest('.sheet-links a') && reading.id) { engaged(); api.act(reading.id, 'dwell', { ms: 0, link: true }); }
    const a = e.target.closest('[data-sheet]');
    if (a) return sheetAction(a.dataset.sheet);
    const open = e.target.closest('[data-open]');
    if (open) return openSheet(open.dataset.open);
    if (e.target.closest('[data-abs-toggle]')) { absShowOriginal = !absShowOriginal; return renderAbstract(); }
    const topic = e.target.closest('[data-topic-go]');
    if (topic) { closeSheet(); return setView({ mode: personal() ? 'recommended' : view.mode, topic: topic.dataset.topicGo }); }
    if (!e.target.closest('.board-menu') && !e.target.closest('[data-sheet="save"]')) { const m = $('.board-menu', sheet); if (m) (window.riPopRemove || ((x) => x.remove()))(m); }
  });

  // ---------- Chinese translation: visible card titles, and the opened paper's title + abstract ----------
  const trWanted = new Set();
  let trTimer = 0;
  let absShowOriginal = false;
  const trBtn = $('#tr-btn');
  const showZh = (c) => trOn && !!c.title_zh;
  // On a card the Chinese title stands alone (the original takes room); the open paper shows both.
  function titleBlock(c) {
    return `<h3 class="card-title"${showZh(c) ? ` title="${esc(tex(c.title))}"` : ''}>${titleMath(showZh(c) ? c.title_zh : c.title)}</h3>`;
  }
  function sheetTitleHtml(p) {
    return showZh(p)
      ? `<h2 class="sheet-title">${titleMath(p.title_zh)}</h2><p class="sheet-orig">${titleMath(p.title)}</p>`
      : `<h2 class="sheet-title">${titleMath(p.title)}</h2>`;
  }
  function applyTitle(c) {
    document.querySelectorAll(`.card[data-id="${CSS.escape(c.id)}"] .card-body`).forEach((body) => {
      body.querySelector('.card-title').outerHTML = titleBlock(c);
    });
  }
  // ---------- translation as it streams in: the Chinese so far writes over the English, with a few flickering
  // bytes where it is writing. It moves exactly as fast as the API sends text (nothing is held back for the effect);
  // the English still to go is faded, so the eye stays on what has been translated.
  const TR_HEX = '0123456789ABCDEF';
  const trBytes = (n) => Array.from({ length: n }, () => TR_HEX[(Math.random() * 16) | 0]).join('');
  function trStreamHtml(en, zh, ratio = 0.42) {
    const src = String(en || '').replace(/\s+/g, ' ').trim();
    // how far into the English the translation has got (Chinese runs about 0.4 characters per English one)
    let cut = Math.min(src.length, Math.round(zh.length / ratio));
    const sp = src.indexOf(' ', cut);
    cut = sp < 0 ? src.length : sp;
    const rest = src.slice(cut);
    return `<span class="tr-zh">${esc(zh)}</span><span class="tr-edge" aria-hidden="true">${trBytes(4)}</span>${rest ? `<span class="tr-en" aria-hidden="true">${esc(rest)}</span>` : ''}`;
  }
  let trTick = 0;
  function trFlicker() {
    if (trTick || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const step = () => {
      const edges = document.querySelectorAll('.tr-edge');
      if (!edges.length) { trTick = 0; return; }
      edges.forEach((e) => { e.textContent = trBytes(4); });
      trTick = setTimeout(step, 65);
    };
    trTick = setTimeout(step, 65);
  }
  function trStream(el, en, zh, ratio) {
    if (!el || !zh) return;
    el.innerHTML = trStreamHtml(en, zh, ratio);
    el.classList.add('is-streaming');
    trFlicker();
  }
  const KEY_CUE_ZH = /我们(提出|引入|展示|发现|设计|开发|证明)|本文(提出|引入)|优于|超过|超越|显著|提升了|达到了|实现了/;
  const abstractZhHtml = (text) => text.split(/(?<=[。！？])/).map((s) => (KEY_CUE_ZH.test(s) ? `<span class="key">${mathHtml(s)}</span>` : mathHtml(s))).join('');
  function renderAbstract() {
    const p = sheetState.data?.paper;
    const el = $('#abstract', sheet), tools = $('#abs-tools', sheet);
    if (!p || !el) return;
    const zh = trOn && p.abstract_zh && !absShowOriginal;
    el.classList.remove('is-streaming');
    el.innerHTML = zh ? abstractZhHtml(p.abstract_zh) : abstractHtml(p.abstract);
    if (!trOn) { tools.innerHTML = ''; return; }
    if (p.abstract_zh) tools.innerHTML = `<button type="button" class="link-btn" data-abs-toggle>${esc(absShowOriginal ? t('showTranslation') : t('showOriginal'))}</button>`;
    else if (sheetState.absError) tools.innerHTML = `<span class="tr-status is-error">${esc(sheetState.absError.code === 'nokey' ? t('trNeedsKey') : t('trFailed', { message: t(`err_${sheetState.absError.code}`, { message: sheetState.absError.message || '' }) }))}</span>`;
    else tools.innerHTML = `<span class="tr-status">${esc(t('trAbstracting'))}</span>`;
  }
  function trProblem(err) {
    if (!err) return;
    trNeedKey = err.code === 'nokey' ? true : t('trFailed', { message: t(`err_${err.code}`, { message: err.message || '' }) });
    renderStatus();
  }
  async function flushTr() {
    if (!trOn || !trWanted.size) return;
    const ids = [...trWanted].slice(0, 40);
    ids.forEach((id) => trWanted.delete(id));
    const res = await api.trTitles(ids);
    if (res?.error) return trProblem(res.error);
    for (const [id, zh] of Object.entries(res.titles || {})) setTitleZh(id, zh);
    if (trWanted.size) scheduleTr();
  }
  function scheduleTr() { clearTimeout(trTimer); trTimer = setTimeout(flushTr, 350); }
  // Only cards that are actually on screen ask for a translation.
  const trObserver = new IntersectionObserver((entries) => {
    if (!trOn) return;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const c = feed.cards.get(e.target.dataset.id);
      if (c && !c.title_zh) trWanted.add(c.id);
    }
    scheduleTr();
  }, { root: scroller, threshold: 0.15 });
  function queueVisible() {
    const r = scroller.getBoundingClientRect();
    document.querySelectorAll('#grid .card').forEach((el) => {
      const b = el.getBoundingClientRect();
      const c = feed.cards.get(el.dataset.id);
      if (b.bottom > r.top && b.top < r.bottom && c && !c.title_zh) trWanted.add(c.id);
    });
    scheduleTr();
  }
  function setTitleZh(id, zh) {
    const c = feed.cards.get(id);
    if (c) { c.title_zh = zh; if (trOn) applyTitle(c); }
    const p = sheetState.data?.paper;
    if (p && p.id === id) { p.title_zh = zh; if (trOn) $('#sheet-title-box', sheet).innerHTML = sheetTitleHtml(p); }
    for (const s of sheetState.data?.similar || []) if (s.id === id) s.title_zh = zh;
    if (trOn) sheet.querySelectorAll(`.mini[data-open="${CSS.escape(id)}"] .mini-title`).forEach((el) => { el.innerHTML = titleMath(zh); });
  }
  // The opened paper: its title, the "more like this" titles, and its abstract.
  function translateSheet() {
    const d = sheetState.data;
    if (!d) return;
    for (const x of [d.paper, ...d.similar]) if (!x.title_zh) trWanted.add(x.id);
    flushTr();
    if (!d.paper.abstract_zh) {
      const id = d.paper.id;
      api.trAbstract(id).then((r) => {
        if (sheetState.id !== id) return;
        if (r?.abstract) { d.paper.abstract_zh = r.abstract; renderAbstract(); }
        else if (r?.error) { sheetState.absError = r.error; trProblem(r.error); renderAbstract(); }
      });
    }
  }
  api.on('feed:tr', (ev) => {
    if (ev.error) return trProblem(ev.error);
    if (ev.title) setTitleZh(ev.id, ev.title);
    // a title or the abstract, part way: it writes itself over the English
    if (ev.titlePart && trOn) {
      const c = feed.cards.get(ev.id);
      if (c && !c.title_zh) document.querySelectorAll(`.card[data-id="${CSS.escape(ev.id)}"] .card-title`).forEach((el) => trStream(el, c.title, ev.titlePart, 0.5));
      const p = sheetState.data?.paper;
      if (p && p.id === ev.id && !p.title_zh) trStream($('#sheet-title-box .sheet-title', sheet), p.title, ev.titlePart, 0.5);
    }
    if (sheetState.id !== ev.id) return;
    if (ev.abstractPart) {
      const p = sheetState.data.paper;
      if (trOn && !absShowOriginal && !p.abstract_zh) trStream($('#abstract', sheet), p.abstract, ev.abstractPart);
      return;
    }
    if (ev.abstract) { sheetState.data.paper.abstract_zh = ev.abstract; renderAbstract(); }
    if (ev.abstractError) { sheetState.absError = ev.abstractError; renderAbstract(); }
  });
  function renderTrBtn() { trBtn.classList.toggle('is-on', trOn); trBtn.setAttribute('aria-pressed', String(trOn)); }
  trBtn.addEventListener('click', () => {
    trOn = !trOn;
    store.set('ri-tr', trOn);
    trNeedKey = false;
    renderTrBtn();
    for (const c of feed.cards.values()) applyTitle(c);
    if (sheetState.data) {
      $('#sheet-title-box', sheet).innerHTML = sheetTitleHtml(sheetState.data.paper);
      sheet.querySelectorAll('.mini[data-open]').forEach((el) => {
        const s = sheetState.data.similar.find((x) => x.id === el.dataset.open);
        if (s) el.querySelector('.mini-title').innerHTML = titleMath(trOn && s.title_zh ? s.title_zh : s.title);
      });
      renderAbstract();
    }
    renderStatus();
    if (trOn) { queueVisible(); if (sheetState.id) translateSheet(); }
  });
  renderTrBtn();

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (!sheet.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); if (typing) document.activeElement.blur(); else closeSheet(); return; }
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepSheet(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepSheet(-1); }
      const k = e.key.toLowerCase();
      if (k === 'l') sheetAction('like');
      if (k === 's') sheetAction('quicksave');
      if (k === 'x') sheetAction('hide');
      if (k === 'n') { e.preventDefault(); $('#note', sheet)?.focus(); }
      if (k === 'q') runTake('quick');
      if (k === 'd') runTake('deep');
      if (k === 'a' && !$('#ask', sheet)?.hidden) { e.preventDefault(); const input = $('#ask-input', sheet); input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); input?.focus({ preventScroll: true }); }
      return;
    }
    if (typing || swipeOn()) return;
    if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); return hooks.enter?.(); }
    if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) { e.preventDefault(); $('#fq').focus(); }    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); refreshFeed(); }
  });

  // ---------- the bar with tabs and directions tucks away while you read down the feed ----------
  // Scrolling down hides it, scrolling up (or moving the pointer to the top edge) brings it back.
  const navEl = $('.feed-nav'), headEl = $('.feed-head'), toTop = $('#to-top');
  let navLastY = 0, navAcc = 0;
  const setTucked = (on) => { if (navEl.classList.contains('is-tucked') !== on) navEl.classList.toggle('is-tucked', on); };
  scroller.addEventListener('scroll', () => {
    const y = scroller.scrollTop, dy = y - navLastY;
    navLastY = y;
    const stuck = y > headEl.offsetHeight + 1;
    navEl.classList.toggle('is-stuck', stuck);
    toTop.classList.toggle('is-on', y > scroller.clientHeight * 1.5);
    if (!stuck) { navAcc = 0; setTucked(false); return; }
    if ((dy > 0) !== (navAcc > 0)) navAcc = 0;
    navAcc += dy;
    if (navAcc > 64) setTucked(true);
    else if (navAcc < -36) setTucked(false);
  }, { passive: true });
  scroller.addEventListener('mousemove', (e) => {
    if (navEl.classList.contains('is-tucked') && e.clientY - scroller.getBoundingClientRect().top < 56) setTucked(false);
  }, { passive: true });
  toTop.addEventListener('click', () => {
    // from far down: jump most of the way at once, then glide the last stretch
    if (!calm() && scroller.scrollTop > scroller.clientHeight * 2) scroller.scrollTo({ top: scroller.clientHeight * 1.2, behavior: 'instant' });
    scroller.scrollTo({ top: 0, behavior: calm() ? 'instant' : 'smooth' });
  });

  // "For you" with nothing to go on yet (no interests, likes or saves): say how to teach it
  const coldEl = $('#feed-cold');
  function renderCold() {
    coldEl.hidden = !(META && view.mode === 'recommended' && !view.query && !String(META.interests || '').trim() && !META.savedTotal && !META.likedTotal);
  }
  $('#cold-tune').addEventListener('click', (e) => { e.stopPropagation(); scroller.scrollTo({ top: 0, behavior: 'auto' }); $('#tune').click(); });

  // ---------- a deliberate sideways swipe moves to the next tab (phone) ----------
  // Only a clearly sideways stroke counts: it has to move at least 2.5× as far across as up or down, start away
  // from the screen edges (Android's back gesture lives there), and travel far (30% of the width) or flick fast
  // past 80px. Anything less springs back; a stroke that turns into a scroll is the scroll's.
  function sideSwipe(area, { tabs, current, go, moveEl, skip = '' }) {
    if (!document.documentElement.classList.contains('is-mobile') || !area) return;
    area.style.touchAction = 'pan-y';
    let g = null;
    const el = () => moveEl() || area;
    const reset = (animate) => {
      const m = el();
      m.style.transition = animate ? 'transform 0.42s var(--sp-press, cubic-bezier(0.2, 0.9, 0.3, 1.2)), opacity 0.3s' : '';
      m.style.transform = '';
      m.style.opacity = '';
      if (animate) setTimeout(() => { m.style.transition = ''; }, 450);
    };
    area.addEventListener('pointerdown', (e) => {
      g = null;
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      if (e.clientX < 28 || e.clientX > innerWidth - 28) return;
      if (e.target.closest(`input, textarea, [data-pop], .modes-row, .chips, .feed-head, .sw-top, .katex-display, pre${skip ? `, ${skip}` : ''}`)) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, pts: [[e.clientX, performance.now()]] };
    });
    area.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      g.pts.push([e.clientX, performance.now()]);
      if (g.pts.length > 6) g.pts.shift();
      if (!g.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) * 1.2 > Math.abs(dx)) { g = null; return; }
        if (Math.abs(dx) < 16 || Math.abs(dx) < 2.5 * Math.abs(dy)) return;
        g.on = true;
      }
      const list = tabs(), i = list.indexOf(current());
      const edge = (dx > 0 && i <= 0) || (dx < 0 && i >= list.length - 1);
      const m = el();
      m.style.transition = 'none';
      m.style.transform = `translateX(${(dx * (edge ? 0.12 : 0.35)).toFixed(1)}px)`;
      m.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / innerWidth * (edge ? 0.1 : 0.6)));
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g;
      g = null;
      if (!s.on) return;
      // the stroke was a swipe, not a tap: no click after it
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', eat, { capture: true }), 400);
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      const [x0, t0] = s.pts[0];
      const v = Math.abs(e.clientX - x0) / Math.max(1, performance.now() - t0);
      const list = tabs(), i = list.indexOf(current()), to = list[i + (dx < 0 ? 1 : -1)];
      const far = Math.abs(dx) >= Math.max(110, innerWidth * 0.3) || (Math.abs(dx) >= 80 && v >= 0.6);
      if (e.type === 'pointercancel' || !to || i < 0 || !far || Math.abs(dx) < 2.5 * Math.abs(dy)) return reset(true);
      const m = el(), dir = dx < 0 ? -1 : 1;
      m.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
      m.style.transform = `translateX(${dir * 60}px)`;
      m.style.opacity = '0';
      setTimeout(async () => {
        // the new tab's cards are dealt and drawn while nothing moves; then they slide in
        m.style.transition = 'none';
        m.style.transform = `translateX(${-dir * 50}px)`;
        await Promise.race([Promise.resolve(go(to)), new Promise((r) => setTimeout(r, 700))]).catch(() => {});
        await new Promise((r) => requestAnimationFrame(r));
        void m.offsetWidth;
        m.style.transition = 'transform 0.38s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s';
        m.style.transform = '';
        m.style.opacity = '';
        setTimeout(() => { m.style.transition = ''; }, 420);
      }, 160);
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  }
  // the grid: every tab shown, in order
  sideSwipe(scroller, {
    tabs: () => shownModes(), current: () => (view.query ? '' : view.mode),
    go: (m) => setView({ mode: m, collection: m === 'saved' ? view.collection : '' }),
    moveEl: () => grid,
  });

  // ---------- shared with swipe.js ----------
  let readyResolve;
  window.RIFeed = {
    api, t, S, lang, esc, tex, titleMath, mathHtml, abstractHtml, abstractZhHtml, coverHtml, wireFigure, reasonText, whoText,
    topicLabel, shortDate, ICON, hooks, store, inkTo, pop, venueHtml, confirmHide, instHtml, instName, qualityBadge, qualityPanel,
    get minQ() { return minQ; },
    openSheet, closeSheet, runTake, refreshBoards, renderStatus, setView, openDirs, closeDirs, paintDirBtn, fitTabs,
    // the swipe view's Saved / Liked tabs open here, in the grid
    showMode(mode) { hooks.exit?.(); if (view.mode !== mode || view.query) setView({ mode, collection: '' }); else relayout(); },
    sideSwipe, trStream,
    act: async (c, kind) => (kind === 'like' ? toggleLike(c) : toggleSave(c)),
    get META() { return META; }, get AI() { return AI; }, get trOn() { return trOn; }, get sheetId() { return sheetState.id; }, get sheetPaper() { return sheetState.data?.paper || null; },
    gridShown() { if (!feed.order.length && !feed.loading) load(true); else relayout(); },
    ready: new Promise((r) => { readyResolve = r; }),
  };
  $('#view-btn')?.addEventListener('click', () => hooks.enter?.());
  // the settings panel (top bar): AI settings, AI usage, interests
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#about-pop [data-ab="ai"], #about-pop [data-ab="usage"], #about-pop [data-ab="tune"], #about-pop [data-ab="export"]');
    if (!b) return;
    e.stopPropagation();
    $('#about-pop').hidden = true;
    document.querySelectorAll('[data-about]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
    const kind = b.dataset.ab;
    setTimeout(() => {
      if (kind === 'usage') window.RIUsage?.open();
      else if (kind === 'export') window.RIExport?.open(view.mode === 'liked' ? 'liked' : 'saved');
      else $(kind === 'ai' ? '#ai-btn' : '#tune')?.click();
    }, 0);
  });
  document.addEventListener('click', (e) => { const x = e.target.closest('[data-pop-close]'); if (x) { e.stopPropagation(); x.closest('.tune-pop').hidden = true; } });

  // ---------- start ----------
  // this script runs before the page's later scripts (all deferred); they have all run by DOMContentLoaded
  const scriptsRun = new Promise((r) => { document.addEventListener('DOMContentLoaded', r, { once: true }); setTimeout(r, 3000); });
  (async function init() {
    META = await api.meta();
    AI = await api.ai();
    for (const x of META.topics) topicsById[x.id] = x;
    if (view.topic && !topicsById[view.topic]) view.topic = '';
    renderModes();
    renderChips();
    renderStatus();
    readyResolve();
    // swipe.js (a later script) decides whether the page opens in the swipe feed: when the data is already at
    // hand (the phone, on a second load) this can get here before it has run
    await scriptsRun;
    if (!hooks.startsOpen?.()) load(true);
  })();
})();
