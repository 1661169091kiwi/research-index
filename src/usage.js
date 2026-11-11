// Research index — the AI usage meter: the DeepSeek balance (DeepSeek's own figure), what this app spent with it
// (per day and per kind of use, tokens, cache hits), and an estimate of what the same key spent elsewhere.
// Uses the page's feed script through window.RIFeed; the numbers come from the feed service (usage.mjs).
(function () {
  'use strict';
  const F = window.RIFeed;
  if (!F || !F.api?.usage) return;
  const { api, t, esc, lang } = F;
  const KINDS = ['take', 'chat', 'translate', 'rate']; // stacked bottom to top, legend in this order
  const RANGES = [7, 30, 90];
  const state = { range: 30, view: 'chart', data: null, bal: null, balErr: null, checking: false };
  let modal = null;

  // ---------- formats ----------
  const sym = (cur) => (cur === 'USD' ? '$' : '¥');
  function money(v, cur) {
    const s = sym(cur);
    if (!v) return `${s}0`;
    if (v < 0.001) return `<${s}0.001`;
    return `${s}${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
  }
  const num = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
  function rel(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return t('justNow');
    if (min < 60) return t('minAgo', { n: min });
    if (min < 1440) return t('hAgo', { n: Math.round(min / 60) });
    return t('dAgo', { n: Math.round(min / 1440) });
  }
  const dayLabel = (iso, long = false) => {
    const [y, m, d] = iso.split('-').map(Number);
    if (lang === 'zh') return long ? `${m}月${d}日` : `${m}/${d}`;
    return new Date(y, m - 1, d).toLocaleDateString('en-US', long ? { month: 'short', day: 'numeric', weekday: 'short' } : { month: 'numeric', day: 'numeric' });
  };
  const dayTotal = (d) => d.take + d.chat + d.translate + (d.rate || 0);

  // ---------- the panel ----------
  function open() {
    if (modal) return;
    document.querySelectorAll('[data-pop]').forEach((el) => { if (el.dataset.pop === 'remove') el.remove(); else el.hidden = true; });
    modal = document.createElement('div');
    modal.className = 'usage-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('usageTitle'));
    modal.innerHTML = `<div class="usage-scrim" data-usage-close></div>
      <section class="usage-panel">
        <header class="usage-head"><h2>${esc(t('usageTitle'))}</h2><button type="button" class="usage-x" data-glass="round" data-usage-close data-back-close aria-label="${esc(t('close'))}">×</button></header>
        <div class="usage-body"><div class="u-balance" id="u-balance"></div><div id="u-rest"></div></div>
      </section>`;
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKey, true);
    modal.addEventListener('click', onClick);
    modal.querySelector('.usage-body').addEventListener('scroll', () => modal?.querySelector('#u-chart')?._hideTip?.(), { passive: true });
    renderBalance();
    load().then(() => refreshBalance());
  }
  function close() {
    if (!modal) return;
    const m = modal;
    modal = null;
    m.classList.add('is-leaving');
    setTimeout(() => m.remove(), 240);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
  function onClick(e) {
    // a tap anywhere outside the chart puts its tip away
    if (!e.target.closest('.u-svg')) modal.querySelector('#u-chart')?._hideTip?.();
    if (e.target.closest('[data-usage-close]')) return close();
    const r = e.target.closest('[data-range]');
    if (r) { state.range = +r.dataset.range; return load(); }
    const v = e.target.closest('[data-view]');
    if (v) { state.view = v.dataset.view; return renderRest(); }
    if (e.target.closest('[data-u="refresh"]')) return refreshBalance();
    if (e.target.closest('[data-u="settings"]')) { close(); setTimeout(() => document.getElementById('ai-btn')?.click(), 60); }
  }
  async function load() {
    state.data = await api.usage({ days: state.range });
    if (!modal) return;
    renderBalance();
    renderRest();
  }
  async function refreshBalance() {
    if (!state.data?.hasKey) { renderBalance(); return; }
    state.checking = true;
    renderBalance();
    const r = await api.balance();
    state.checking = false;
    if (r?.error) state.balErr = r.error; else { state.bal = r; state.balErr = null; }
    if (!modal) return;
    // a fresh reading feeds the "used elsewhere" estimate
    state.data = await api.usage({ days: state.range });
    renderBalance();
    renderRest();
  }

  // ---------- balance ----------
  function renderBalance() {
    const el = modal?.querySelector('#u-balance');
    if (!el) return;
    const d = state.data;
    if (d && !d.hasKey) {
      el.className = 'u-balance is-empty';
      el.innerHTML = `<p class="ub-label">${esc(t('usageBalance'))}</p><p class="ub-empty">${esc(t('usageNoKey'))}</p><button type="button" class="btn-primary" data-u="settings">${esc(t('usageAddKey'))}</button>`;
      return;
    }
    const b = state.bal || d?.balance;
    el.className = `u-balance${state.checking ? ' is-checking' : ''}`;
    const whole = b ? b.total.toFixed(2).split('.') : null;
    const err = state.balErr ? `<p class="ub-error">${esc(t('usageBalanceFailed', { why: state.balErr.message || state.balErr.code }))}</p>` : '';
    el.innerHTML = `<div class="ub-top"><p class="ub-label">${esc(t('usageBalance'))}</p>${b ? `<span class="ub-status${b.available ? '' : ' is-low'}"><i></i>${esc(t(b.available ? 'usageAvailable' : 'usageUnavailable'))}</span>` : ''}</div>
      <p class="ub-amount">${b ? `<span class="ub-cur">${sym(b.currency)}</span>${esc(whole[0])}<span class="ub-dec">.${esc(whole[1])}</span>` : '<span class="ub-dash">—</span>'}</p>
      ${b && (b.toppedUp || b.granted) ? `<p class="ub-parts">${esc(t('usageToppedUp', { v: money(b.toppedUp, b.currency) }))}<span class="dot"> · </span>${esc(t('usageGranted', { v: money(b.granted, b.currency) }))}</p>` : ''}
      ${err}
      <div class="ub-foot"><span>${esc(state.checking ? t('usageChecking') : b ? t('usageUpdated', { rel: rel(b.t) }) : '')}</span><button type="button" class="ub-refresh" data-u="refresh" aria-label="${esc(t('usageRefresh'))}" title="${esc(t('usageRefresh'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
  }

  // ---------- this app's spending ----------
  // One idea per block, each with its own heading: the totals (with the period to show), the days, what it went on,
  // the tokens, the key's use elsewhere, and how costs are worked out.
  function renderRest() {
    const el = modal?.querySelector('#u-rest');
    const d = state.data;
    if (!el || !d) return;
    const cur = d.currency;
    const tot = d.totals;
    const head = (title, extra = '') => `<div class="u-head"><h3>${esc(title)}</h3>${extra}</div>`;
    const seg = `<div class="u-range seg" role="tablist">${RANGES.map((n) => `<button type="button" role="tab" data-range="${n}" class="${n === state.range ? 'is-on' : ''}" aria-selected="${n === state.range}">${esc(t('usageRange', { n }))}</button>`).join('')}</div>`;
    const totals = `<section class="u-block">
      ${head(t('usageAppTitle'), seg)}
      <div class="u-tiles">
        <div class="u-tile u-tile-main"><p class="ut-label">${esc(t('usageSpent', { range: t('usageRange', { n: state.range }) }))}</p><p class="ut-value">${money(tot.cost, cur)}</p><p class="ut-sub">${esc(t('usageCalls', { n: tot.calls }))}</p></div>
        <div class="u-tile"><p class="ut-label">${esc(t('usageToday'))}</p><p class="ut-value">${money(d.today, cur)}</p></div>
        <div class="u-tile"><p class="ut-label">${esc(t('usageCache'))}</p><p class="ut-value">${d.cacheRate == null ? '—' : `${Math.round(d.cacheRate * 100)}<span class="ut-unit">%</span>`}</p><p class="ut-sub">${esc(t('usageCacheShort'))}</p></div>
      </div>
    </section>`;
    if (!tot.calls) {
      el.innerHTML = totals + `<section class="u-card u-empty-card"><p class="u-empty">${esc(t('usageEmpty'))}</p></section>` + outsideCard(d) + note(d);
      return;
    }
    const kinds = KINDS.filter((k) => tot.byKind[k] > 0 || k !== 'rate');
    const legend = `<ul class="u-legend">${kinds.map((k) => `<li><i class="sw${KINDS.indexOf(k) + 1}"></i>${esc(t(`usageKind_${k}`))}</li>`).join('')}</ul>`;
    const daily = `<section class="u-card">
      ${head(t('usageDaily'), `<div class="u-view seg"><button type="button" data-view="chart" class="${state.view === 'chart' ? 'is-on' : ''}">${esc(t('usageChart'))}</button><button type="button" data-view="table" class="${state.view === 'table' ? 'is-on' : ''}">${esc(t('usageTable'))}</button></div>`)}
      ${state.view === 'chart' ? `${legend}<div class="u-chart" id="u-chart"></div><p class="u-hint">${esc(t('usageTapHint'))}</p>` : table(d)}
    </section>`;
    // what share each kind of use took
    const share = KINDS.map((k) => (tot.cost ? tot.byKind[k] / tot.cost : 0));
    const byKind = `<section class="u-card">
      ${head(t('usageByKind'))}
      <div class="u-share" aria-hidden="true">${KINDS.map((k, i) => (share[i] > 0 ? `<i class="sw${i + 1}" style="flex-grow:${share[i].toFixed(4)}"></i>` : '')).join('')}</div>
      <ul class="u-rows">${kinds.map((k) => { const i = KINDS.indexOf(k); return `<li><i class="sw${i + 1}"></i><span class="ur-label">${esc(t(`usageKind_${k}`))}</span><span class="ur-pct">${Math.round(share[i] * 100)}%</span><b>${money(tot.byKind[k], cur)}</b></li>`; }).join('')}</ul>
    </section>`;
    const tokens = `<section class="u-card">
      ${head(t('usageTokens'))}
      <div class="u-tokens">
        <div><p class="ut-label">${esc(t('usageIn'))}</p><p class="utk-value">${num(tot.hit + tot.miss)}</p><p class="ut-sub">${esc(t('usageInCached', { n: num(tot.hit) }))}</p></div>
        <div><p class="ut-label">${esc(t('usageOut'))}</p><p class="utk-value">${num(tot.out)}</p></div>
      </div>
    </section>`;
    el.innerHTML = totals + daily + byKind + tokens + outsideCard(d) + note(d);
    if (state.view === 'chart') chart(el.querySelector('#u-chart'), d);
  }
  function outsideCard(d) {
    if (!d.hasKey) return '';
    const o = d.outside;
    return `<section class="u-card u-outside">
      <div class="u-head"><h3>${esc(t('usageOutside'))}</h3></div>
      ${o ? `<p class="uo-value">${money(o.amount, d.currency)}<span class="uo-since">${esc(lang === 'zh' ? `自 ${dayLabel(isoDay(o.since), true)}` : `since ${dayLabel(isoDay(o.since), true)}`)}</span></p><p class="u-fine">${esc(t('usageOutsideNote'))}</p>` : `<p class="u-fine">${esc(t('usageOutsideWait'))}</p>`}
    </section>`;
  }
  function note(d) {
    const prices = d.currency === 'USD'
      ? { model: 'deepseek-flash', hit: '$0.006', miss: '$0.30', out: '$1.20' }
      : { model: 'deepseek-flash', hit: '¥0.04', miss: '¥2', out: '¥8' };
    return `<footer class="u-note"><span class="u-peak${d.peakNow ? ' is-peak' : ''}">${esc(t(d.peakNow ? 'usagePeakNow' : 'usageOffPeakNow'))}</span><p>${esc(t('usagePriceNote', prices))}</p></footer>`;
  }
  const isoDay = (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

  function table(d) {
    const rows = d.days.filter((x) => dayTotal(x) > 0).reverse();
    return `<div class="u-table-wrap"><table class="u-table"><thead><tr><th>${esc(t('usageDate'))}</th>${KINDS.map((k) => `<th>${esc(t(`usageKind_${k}`))}</th>`).join('')}<th>${esc(t('usageTotal'))}</th></tr></thead>
      <tbody>${rows.map((x) => `<tr><td>${esc(dayLabel(x.date, true))}</td>${KINDS.map((k) => `<td>${money(x[k], d.currency)}</td>`).join('')}<td><b>${money(dayTotal(x), d.currency)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------- the chart: spending per day, stacked by kind of use ----------
  // Thin bars (at most 24px), 2px gaps in the surface colour between stacked parts, 4px rounded tops, square at
  // the baseline; a few recessive gridlines; a tooltip per day (hover, or tap on a phone).
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }
  function chart(host, d) {
    if (!host) return;
    const W = Math.max(260, host.clientWidth || 320), H = 168, padL = 44, padB = 22, padT = 8;
    const days = d.days, n = days.length;
    const max = niceMax(Math.max(...days.map(dayTotal)));
    const band = (W - padL) / n, bw = Math.max(2, Math.min(24, band * (n > 40 ? 0.7 : 0.62)));
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, max / 2, max];
    let svg = `<svg class="u-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('usageDaily'))}">`;
    for (const v of ticks) svg += `<line class="u-grid" x1="${padL}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="u-axis" x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${money(v, d.currency)}</text>`;
    days.forEach((day, i) => {
      const x = padL + band * i + (band - bw) / 2;
      let top = H - padB;
      const parts = KINDS.map((k, ki) => ({ ki, v: day[k] })).filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        let h = Math.max(2, (H - padT - padB) * (p.v / max));
        const gap = j < parts.length - 1 ? 0 : 0;
        const y1 = top - h;
        const last = j === parts.length - 1, r = last ? Math.min(4, bw / 2, h) : 0;
        svg += r
          ? `<path class="u-bar sw${p.ki + 1}" d="M${x.toFixed(1)},${top.toFixed(1)}V${(y1 + r).toFixed(1)}Q${x.toFixed(1)},${y1.toFixed(1)} ${(x + r).toFixed(1)},${y1.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${y1.toFixed(1)} ${(x + bw).toFixed(1)},${(y1 + r).toFixed(1)}V${top.toFixed(1)}Z"/>`
          : `<rect class="u-bar sw${p.ki + 1}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`;
        top = y1 - 2 - gap; // the 2px surface gap between stacked parts
      });
    });
    // the base line, and a few dates under it
    svg += `<line class="u-base" x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>`;
    const marks = n <= 7 ? days.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of marks) {
      const cx = padL + band * (i + 0.5);
      svg += `<text class="u-axis" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 && n > 7 ? 'start' : i === n - 1 && n > 7 ? 'end' : 'middle'}">${esc(i === n - 1 ? t('usageToday') : dayLabel(days[i].date))}</text>`;
    }
    svg += `<rect class="u-hl" x="0" y="${padT}" width="${band.toFixed(1)}" height="${H - padT - padB}" rx="6" visibility="hidden"/>`;
    svg += '</svg>';
    host.innerHTML = `${svg}<div class="u-tip" hidden></div>`;
    const el = host.querySelector('svg'), tip = host.querySelector('.u-tip'), hl = host.querySelector('.u-hl');
    // the highlight sits behind the bars
    el.insertBefore(hl, el.firstChild);
    const show = (clientX) => {
      const r = el.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) * (W / r.width) - padL) / band)));
      const day = days[i];
      hl.setAttribute('x', (padL + band * i).toFixed(1));
      hl.setAttribute('visibility', 'visible');
      tip.innerHTML = `<p class="utp-date">${esc(dayLabel(day.date, true))}</p><p class="utp-total">${money(dayTotal(day), d.currency)}</p>`
        + KINDS.map((k, ki) => `<p class="utp-row"><i class="sw${ki + 1}"></i>${esc(t(`usageKind_${k}`))}<b>${money(day[k], d.currency)}</b></p>`).join('');
      tip.hidden = false;
      const cx = (padL + band * (i + 0.5)) * (r.width / W);
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(r.width - tw, cx - tw / 2))}px`;
    };
    const hide = () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden'); };
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(e.clientX); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    let shownAt = -1;
    el.addEventListener('click', (e) => {
      const r = el.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) * (W / r.width) - padL) / band)));
      if (!tip.hidden && shownAt === i && e.pointerType !== 'mouse') { hide(); shownAt = -1; return; }
      show(e.clientX);
      shownAt = i;
    });
    host._hideTip = () => { hide(); shownAt = -1; };
  }
  // the chart redraws to the panel's width
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (modal && state.view === 'chart') renderRest(); }, 150); });
  // a call made while the panel is open shows up in it
  api.on?.('feed:usage', () => { if (modal) load(); paintRow(); });

  // ---------- the row at the top of AI settings ----------
  async function paintRow() {
    const v = document.getElementById('ai-usage-value');
    if (!v) return;
    const d = await api.usage({ days: 30 });
    const b = d.balance;
    v.textContent = [b ? `${sym(b.currency)}${b.total.toFixed(2)}` : '', d.totals.cost ? t('usageApp', { range: t('usageRange', { n: 30 }) }).split('·')[0].trim() + ' ' + money(d.totals.cost, d.currency) : ''].filter(Boolean).join(' · ');
  }
  document.getElementById('ai-usage-open')?.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  const pop = document.getElementById('ai-pop');
  if (pop) new MutationObserver(() => { if (!pop.hidden) paintRow(); }).observe(pop, { attributes: true, attributeFilter: ['hidden'] });

  window.RIUsage = { open, close };
})();
