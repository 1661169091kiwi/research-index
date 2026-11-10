// Research index — the Glass style (after FlClash, the open-source Clash client) and its liquid glass.
// Glass is the default; Classic is the Swiss look the app had before. The choice is kept in localStorage
// ('ri-style') and applied by a script in <head> before anything is drawn; this file switches it in place.
//
// Liquid glass, as FlClash draws it for its floating chrome (prism_ui/lib/liquid_glass.dart): the backdrop
// is frosted a little, bent inward across a bevel at the rim (a circular profile, so the outermost band shows
// what lies further in, squeezed), and saturated. Here that is an SVG filter used as the element's
// backdrop-filter (Chromium: the Electron window and Android's WebView): a displacement map made for each
// size of pane, then feDisplacementMap. The tint, the lit rim and the shadow come from glass.css.
// Panes are marked in the markup with data-glass="dock|pill|round|panel|menu|banner".
(function () {
  'use strict';
  const root = document.documentElement;
  const KEY = 'ri-style';
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const plainMQ = matchMedia('(prefers-reduced-transparency: reduce)');
  const isGlass = () => root.classList.contains('fl');

  // ---------- Glass / Classic ----------
  function apply(glass) {
    root.classList.toggle('fl', glass);
    const m = document.querySelector('meta[name="color-scheme"]');
    if (m) m.content = glass ? 'light dark' : 'light';
    try { localStorage.setItem(KEY, glass ? 'glass' : 'classic'); } catch { /* ignore */ }
    chrome();
    refreshAll();
    document.dispatchEvent(new CustomEvent('ri:style', { detail: { glass } }));
  }
  window.RITheme = {
    get: () => (isGlass() ? 'glass' : 'classic'),
    set: (name) => apply(name !== 'classic'),
  };
  // the Glass | Classic toggles (the ⋯ panel, the swipe menu); which half is on follows the class on <html>
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-style-set]');
    if (b && (b.dataset.styleSet === 'glass') !== isGlass()) apply(b.dataset.styleSet === 'glass');
  });

  // The window around the page follows it: the desktop title bar (its buttons are drawn by Windows) and the
  // phone's status bar icons, dark on light pages and light on dark ones.
  function chrome() {
    const cs = getComputedStyle(root);
    const bg = cs.getPropertyValue('--chrome-bg').trim(), fg = cs.getPropertyValue('--chrome-fg').trim();
    try { if (bg && fg) window.portal?.chrome?.(bg, fg); } catch { /* ignore */ }
    try {
      const bars = window.Capacitor?.Plugins?.SystemBars;
      const r = bars?.setStyle?.({ style: isGlass() && darkMQ.matches ? 'DARK' : 'LIGHT' });
      r?.catch?.(() => {});
    } catch { /* ignore */ }
  }
  darkMQ.addEventListener?.('change', () => { chrome(); refreshAll(); });

  // ---------- liquid glass ----------
  // FlClash's two styles, light | dark: `regular` for bars and buttons, `menu` for what holds rows of text.
  const STYLE = {
    regular: [{ blur: 2.5, refraction: 60, bevel: 20, saturation: 2.08, brightness: 1 }, { blur: 2.5, refraction: 60, bevel: 20, saturation: 2.84, brightness: 1 }],
    menu: [{ blur: 12, refraction: 60, bevel: 20, saturation: 2, brightness: 1.05 }, { blur: 12, refraction: 60, bevel: 20, saturation: 1.75, brightness: 1.25 }],
  };
  const KIND = { dock: 'regular', pill: 'regular', round: 'regular', panel: 'regular', banner: 'regular', menu: 'menu' };
  const NS = 'http://www.w3.org/2000/svg';
  const filters = new Map(); // key -> filter id
  let defs = null, seq = 0;
  const canBend = () => CSS.supports('backdrop-filter', 'blur(1px)') && !plainMQ.matches && !lowEnd();
  function lowEnd() {
    try { if (localStorage.getItem('ri-glass') === 'plain') return true; } catch { /* ignore */ }
    return (navigator.deviceMemory && navigator.deviceMemory < 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);
  }
  function sprite() {
    if (defs) return defs;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);
    return defs;
  }

  // Where each point of a pane reads the backdrop from: inside a band `bevel` wide along the rim the glass
  // bends inward along the rim's normal by depth·(1 − √(1 − rise²)) (rise 0 at the band's inner edge, 1 at the
  // rim), as in FlClash's shader. R and G carry x and y, 0.5 being no shift.
  function displacementMap(w, h, r, bevel, depth, scale) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d = img.data;
    const hx = w / 2, hy = h / 2, rr = Math.min(r, hx, hy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hx, py = y + 0.5 - hy;
        const qx = Math.abs(px) - (hx - rr), qy = Math.abs(py) - (hy - rr);
        let inset, nx, ny;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1;
          inset = rr - len;
          nx = (qx / len) * Math.sign(px); ny = (qy / len) * Math.sign(py);
        } else if (qx > qy) { inset = rr - qx; nx = Math.sign(px); ny = 0; }
        else { inset = rr - qy; nx = 0; ny = Math.sign(py); }
        const rise = 1 - Math.min(Math.max(inset / bevel, 0), 1);
        const shift = rise > 0 ? depth * (1 - Math.sqrt(Math.max(0, 1 - rise * rise))) : 0;
        const i = (y * w + x) * 4;
        d[i] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (nx * shift) / scale)));
        d[i + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (ny * shift) / scale)));
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  function saturate(s, b) {
    const L = [0.2126, 0.7152, 0.0722];
    const row = (k) => [0, 1, 2].map((j) => (b * ((j === k ? 1 : 0) * s + L[j] * (1 - s))).toFixed(4)).join(' ');
    return `${row(0)} 0 0 ${row(1)} 0 0 ${row(2)} 0 0 0 0 0 1 0`;
  }
  function filterFor(w, h, r, kind) {
    const dark = isGlass() && darkMQ.matches ? 1 : 0;
    const key = `${kind}|${w}x${h}|${r}|${dark}`;
    if (filters.has(key)) return filters.get(key);
    const P = STYLE[kind][dark];
    const half = Math.min(w, h) / 2;
    const depth = Math.min(P.refraction, half);
    const bevel = Math.max(1, Math.min(P.bevel, half * 0.5));
    const scale = 2 * depth + 2;
    const id = `lg${++seq}`;
    const f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '0'); f.setAttribute('y', '0');
    f.setAttribute('width', String(w)); f.setAttribute('height', String(h));
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${P.blur}" edgeMode="duplicate" result="frost"/>`
      + `<feImage href="${displacementMap(w, h, r, bevel, depth, scale)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`
      + `<feDisplacementMap in="frost" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="bent"/>`
      + `<feColorMatrix in="bent" type="matrix" values="${saturate(P.saturation, P.brightness)}"/>`;
    sprite().appendChild(f);
    filters.set(key, id);
    // a long session that resizes a lot: forget the oldest
    if (filters.size > 80) { const [k, old] = filters.entries().next().value; filters.delete(k); document.getElementById(old)?.remove(); }
    return id;
  }

  const panes = new Set();
  function paint(el) {
    if (!isGlass() || !canBend()) { el.style.backdropFilter = ''; el.style.webkitBackdropFilter = ''; return; }
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return; // hidden: keep what it had
    const r = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, Math.min(w, h) / 2));
    const kind = KIND[el.dataset.glass] || 'regular';
    const v = `url(#${filterFor(w, h, r, kind)})`;
    el.style.backdropFilter = v;
    el.style.webkitBackdropFilter = v;
  }
  let queued = new Set(), frame = 0;
  function later(el) {
    queued.add(el);
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; const q = queued; queued = new Set(); q.forEach(paint); });
  }
  const ro = new ResizeObserver((entries) => entries.forEach((e) => later(e.target)));
  function watch(el) {
    if (panes.has(el)) return;
    panes.add(el);
    ro.observe(el, { box: 'border-box' });
    later(el);
  }
  function refreshAll() { panes.forEach(later); }
  function scan(node = document) { node.querySelectorAll?.('[data-glass]').forEach(watch); }
  // panes added later (menus built on demand)
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('[data-glass]')) watch(n); scan(n); }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- pressing glass: it swells under the finger and lights from where it was touched ----------
  // (FlClash's ElasticPress: a panel grows by up to 16 dp, a quarter at most, on a bouncy spring; the glow comes
  // in over 120 ms and leaves over 360 ms.)
  let pressed = null;
  function release() { if (pressed) { pressed.classList.remove('is-pressed'); pressed = null; } }
  document.addEventListener('pointerdown', (e) => {
    if (!isGlass() || e.button > 0) return;
    const el = e.target.closest?.('[data-glass]');
    if (!el || el.dataset.glass === 'menu' || el.dataset.glass === 'panel') return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${e.clientX - r.left}px`);
    el.style.setProperty('--gy', `${e.clientY - r.top}px`);
    el.style.setProperty('--swell', String(1 + Math.min(0.25, 16 / Math.max(r.width, r.height, 1))));
    release();
    pressed = el;
    el.classList.add('is-pressed');
  }, { passive: true });
  ['pointerup', 'pointercancel', 'blur'].forEach((t) => window.addEventListener(t, release, { passive: true }));
  document.addEventListener('scroll', release, { passive: true, capture: true });

  // scrollbars show while something scrolls, and for a moment after it stops (glass.css hides them otherwise)
  document.addEventListener('scroll', (e) => {
    if (!isGlass()) return;
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!(el instanceof Element)) return;
    el.classList.add('is-scrolling');
    clearTimeout(el._riScroll);
    el._riScroll = setTimeout(() => el.classList.remove('is-scrolling'), 1200);
  }, { passive: true, capture: true });

  function start() {
    scan();
    chrome();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('load', refreshAll);
  document.fonts?.ready?.then(refreshAll);
})();
