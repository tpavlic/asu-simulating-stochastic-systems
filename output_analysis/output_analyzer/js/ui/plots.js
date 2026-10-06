// A small SVG figure builder shared by every page, and the plot types drawn
// with it. Plain SVG rather than canvas: these plots change only when the
// reader does something, and a viewBox keeps them sharp at any zoom.
//
// Sizing: the viewBox width is the figure's own container width, capped at
// the designed width, and so one viewBox unit is one CSS pixel and labels
// render at their nominal size on a phone as well as on a laptop. Below
// 600px the height switches to the figure's narrowHeight, a taller aspect.
// A figure redraws itself when its container's width changes (a resize, a
// tab switch that reveals it), never on a height-only change.
//
// Colors come from the page's CSS tokens at draw time (tok('--est')), never
// from literals here, and so a re-themed page re-themes its plots.
//
// The module touches the DOM only inside functions, and so the pure helpers
// (niceStep, niceTicks, niceDomain, fmtTick, linearScale, padDomain, extent,
// decimateMinMax) import cleanly under Node for the tests.

import { num, esc } from './format.js';
import { SCRIPT_WRITERS } from '../io/scripts.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DESIGN_W = 940;
const NARROW_W = 600;
// The opacity of the band that marks a stretch truncation excludes.
const SHADE_OPACITY = 0.12;
const FONT = "Outfit, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, monospace";

// ── Pure helpers ──────────────────────────────────────────────────────────

/**
 * A tick step of 1, 2, or 5 times a power of ten giving close to `want`
 * intervals over `span`.
 * @param {number} span the width of the axis window (hi − lo)
 * @param {number} [want=5]
 * @returns {number}
 */
export function niceStep(span, want = 5) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, want);
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / e;
  // Thresholds at the geometric midpoints of 1, 2, 5, 10, and so the step
  // chosen is the one whose interval count is closest to `want` on a log scale.
  const m = r >= Math.sqrt(50) ? 10 : r >= Math.sqrt(10) ? 5 : r >= Math.sqrt(2) ? 2 : 1;
  return m * e;
}

/** Rounds away binary noise: 0.30000000000000004 becomes 0.3. */
function clean(v) {
  const c = Number(v.toPrecision(12));
  return c === 0 ? 0 : c;
}

/**
 * Tick values at a nice step inside [lo, hi] (endpoints included when they
 * fall on the step). Equal ends give the single value.
 * @param {number} lo
 * @param {number} hi
 * @param {number} [want=5] the approximate number of intervals wanted
 * @returns {number[]}
 */
export function niceTicks(lo, hi, want = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  if (lo === hi) return [clean(lo)];
  const step = niceStep(hi - lo, want);
  const k0 = Math.ceil(lo / step - 1e-9), k1 = Math.floor(hi / step + 1e-9);
  const out = [];
  for (let k = k0; k <= k1; k++) out.push(clean(k * step));
  return out;
}

/**
 * [lo, hi] widened outward to the nearest multiples of the nice step.
 * @param {number} lo
 * @param {number} hi
 * @param {number} [want=5]
 * @returns {[number, number]}
 */
export function niceDomain(lo, hi, want = 5) {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  if (lo === hi) return padDomain(lo, hi, 0);
  const step = niceStep(hi - lo, want);
  return [clean(Math.floor(lo / step + 1e-9) * step), clean(Math.ceil(hi / step - 1e-9) * step)];
}

/**
 * [lo, hi] widened by `frac` of its span on each side; equal ends are opened
 * to ±10% of their magnitude (±1 at zero) so a scale never divides by zero.
 * @param {number} lo
 * @param {number} hi
 * @param {number} [frac=0.05]
 * @returns {[number, number]}
 */
export function padDomain(lo, hi, frac = 0.05) {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  if (lo === hi) {
    const d = Math.abs(lo) * 0.1 || 1;
    return [lo - d, hi + d];
  }
  const d = (hi - lo) * frac;
  // Padding never carries a domain across zero: a count or a waiting time that
  // is never negative should not get an axis that starts below zero.
  return [lo >= 0 && lo - d < 0 ? 0 : lo - d, hi <= 0 && hi + d > 0 ? 0 : hi + d];
}

/**
 * The minimum and maximum of the finite values of one or more arrays.
 * @param {...ArrayLike<number>} arrays
 * @returns {[number, number]} [NaN, NaN] when no value is finite
 */
export function extent(...arrays) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) {
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  return lo <= hi ? [lo, hi] : [NaN, NaN];
}

function stepDecimals(step) {
  for (let d = 0; d <= 10; d++) if (Math.abs(step - Number(step.toFixed(d))) < 1e-9 * Math.max(1, step)) return d;
  return 10;
}

/**
 * A tick label in exactly the decimals its step needs (a 0.25 step shows two,
 * a step of 5 none), with comma thousands separators from 10,000 up, and in
 * exponential notation when the step is below 1e-4 or a value reaches 1e7.
 * Zero never prints as "-0".
 * @param {number} v
 * @param {number} [step] the axis's tick step; inferred from `v` when omitted
 * @returns {string}
 */
export function fmtTick(v, step) {
  if (!Number.isFinite(v)) return '';
  v = clean(v);
  if (step === undefined || !(step > 0)) return num(v, 6);
  if (v === 0 && step < 1e-4) return '0';
  if (v !== 0 && (step < 1e-4 || Math.abs(v) >= 1e7)) {
    const digits = Math.max(0, Math.min(6, Math.round(Math.log10(Math.abs(v) / step))));
    return v.toExponential(Math.min(digits, 3)).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  let s = v.toFixed(stepDecimals(step));
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  if (Math.abs(v) >= 1e4) {
    const neg = s[0] === '-', body = neg ? s.slice(1) : s, dot = body.indexOf('.');
    const ip = dot < 0 ? body : body.slice(0, dot), fp = dot < 0 ? '' : body.slice(dot);
    s = (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
  }
  return s;
}

/**
 * A linear map from the domain [d0, d1] to the range [r0, r1], with
 * `.invert`, `.domain`, `.range`, `.ticks(want)`, and `.step(want)`.
 * @param {number} d0
 * @param {number} d1
 * @param {number} r0
 * @param {number} r1
 * @returns {((v: number) => number) & { invert: (p: number) => number, domain: number[], range: number[], ticks: (want?: number) => number[], step: (want?: number) => number }}
 */
export function linearScale(d0, d1, r0, r1) {
  const span = (d1 - d0) || 1;
  const f = v => r0 + (v - d0) / span * (r1 - r0);
  f.invert = p => d0 + (p - r0) / ((r1 - r0) || 1) * span;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  f.ticks = (want = 5) => niceTicks(d0, d1, want);
  f.step = (want = 5) => niceStep(Math.abs(d1 - d0), want);
  return f;
}

/**
 * Thins a long series for drawing: within each of `buckets` equal slices of
 * the index range, keeps the first, minimum, maximum, and last points, in
 * index order, and so a 100 000-point run draws as about four points per
 * pixel column without losing its peaks. Non-finite values are skipped.
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {number} buckets
 * @returns {{ x: number[], y: number[] }}
 */
export function decimateMinMax(xs, ys, buckets) {
  const n = ys.length;
  const x = [], y = [];
  if (n <= buckets * 4) {
    for (let i = 0; i < n; i++) { x.push(xs[i]); y.push(ys[i]); }
    return { x, y };
  }
  const per = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor(b * per), i1 = Math.min(n, Math.floor((b + 1) * per));
    let iMin = -1, iMax = -1, iFirst = -1, iLast = -1;
    for (let i = i0; i < i1; i++) {
      const v = ys[i];
      if (!Number.isFinite(v) || !Number.isFinite(xs[i])) continue;
      if (iFirst < 0) iFirst = i;
      iLast = i;
      if (iMin < 0 || v < ys[iMin]) iMin = i;
      if (iMax < 0 || v > ys[iMax]) iMax = i;
    }
    if (iFirst < 0) { x.push(NaN); y.push(NaN); continue; }
    const keep = Array.from(new Set([iFirst, iMin, iMax, iLast])).sort((a, b2) => a - b2);
    for (const i of keep) { x.push(xs[i]); y.push(ys[i]); }
  }
  return { x, y };
}

// ── DOM helpers ───────────────────────────────────────────────────────────

/**
 * Reads a CSS custom property from the document root at call time.
 * @param {string} name e.g. '--est'
 * @returns {string}
 */
export function tok(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function col(c, fallbackToken) {
  if (!c) return tok(fallbackToken);
  return c.startsWith('--') ? tok(c) : c;
}

/**
 * Creates an SVG element with attributes and appends it to `parent`.
 * @param {string} tag
 * @param {Object<string, *>} [attrs]
 * @param {Element} [parent]
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, str, attrs) {
  const t = svgEl('text', Object.assign({ x: r1(x), y: r1(y) }, attrs || {}), parent);
  t.textContent = str;
  return t;
}
function r1(v) { return Math.round(v * 10) / 10; }
function linePathD(px, py) {
  let d = '', pen = false;
  for (let i = 0; i < px.length; i++) {
    const x = px[i], y = py[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
    d += (pen ? 'L' : 'M') + r1(x) + ',' + r1(y);
    pen = true;
  }
  return d;
}
function estTextWidth(s, size) { return String(s).length * size * 0.56; }

// ── Figure registry and width watching ────────────────────────────────────

const FIGS = new Set();
const widthFns = new Set();
let watching = false;
let lastViewportW = 0;
let widthTimer = null;
let readoutDocHook = false;

function ensureWatch() {
  if (watching) return;
  watching = true;
  lastViewportW = document.documentElement.clientWidth;
  window.addEventListener('resize', () => {
    const w = document.documentElement.clientWidth;
    // iOS fires a height-only resize when its address bar slides away; only
    // a width change re-lays the plots.
    if (w === lastViewportW) return;
    lastViewportW = w;
    clearTimeout(widthTimer);
    widthTimer = setTimeout(() => {
      for (const fn of Array.from(widthFns)) { try { fn(w); } catch (err) { console.error(err); } }
      redrawVisible();
    }, 120);
  });
}

/**
 * Registers a callback for viewport width changes (debounced, height-only
 * changes ignored). Figures redraw themselves; this is for anything else a
 * page lays out from a measured width.
 * @param {(width: number) => void} fn
 * @returns {() => void} a function that unregisters it
 */
export function onWidthChange(fn) {
  if (typeof document !== 'undefined') ensureWatch();
  widthFns.add(fn);
  return () => widthFns.delete(fn);
}

/**
 * Redraws every figure inside `root` (default: the whole page) that is
 * visible and whose container width no longer matches its viewBox. Figures
 * drawn while their page was hidden had no width to measure, and this is
 * what corrects them when the page is shown.
 * @param {Element} [root]
 */
export function redrawVisible(root) {
  for (const fig of Array.from(FIGS)) {
    if (!fig.wrap.isConnected) { FIGS.delete(fig); if (fig.ro) fig.ro.disconnect(); continue; }
    if (root && !root.contains(fig.wrap)) continue;
    const cw = fig.wrap.clientWidth;
    if (cw > 0 && targetWidth(fig, cw) !== fig.w) fig.redraw();
  }
}

function finiteDomain(d) {
  const lo = d[0], hi = d[1];
  if (Number.isFinite(lo) && Number.isFinite(hi)) return [lo, hi];
  if (Number.isFinite(lo)) return [lo, lo];
  if (Number.isFinite(hi)) return [hi, hi];
  return [0, 1];
}
function targetWidth(fig, cw) { return Math.max(200, Math.min(fig.opts.width, Math.floor(cw))); }

// ── The figure ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Figure
 * @property {HTMLElement} container the element passed to makeFigure
 * @property {HTMLDivElement} wrap the figure's own wrapper inside it (measured for width)
 * @property {SVGSVGElement} svg
 * @property {number} w viewBox width
 * @property {number} h viewBox height
 * @property {{l:number,r:number,t:number,b:number}} m current margins
 * @property {number} iw plotting-area width
 * @property {number} ih plotting-area height
 * @property {boolean} narrow whether the narrow layout (w < 600) is in force
 * @property {SVGGElement} inner the marks layer, translated to the plotting area
 * @property {{bg: SVGGElement, grid: SVGGElement, axes: SVGGElement, marks: SVGGElement, over: SVGGElement}} layers
 * @property {Function|null} sx current x scale, or null before one is set
 * @property {Function|null} sy current y scale, or null before one is set
 */

/**
 * Creates a figure inside `container`. Draw into it with `fig.render(fn)`,
 * where `fn(fig)` sets scales and calls mark helpers; the figure keeps `fn`
 * and re-runs it whenever its width changes.
 *
 * Methods on the returned figure:
 * - `x(domain, {nice, pad})` / `y(domain, {nice, pad})` set and return a scale
 *   (with `.ticks()`, `.domain`, `.invert`); `nice` widens to tick multiples,
 *   `pad` widens by that fraction of the span first.
 * - `axes({x, y, xTicks, yTicks, xFormat, yFormat, xInteger, yInteger, grid})`
 *   draws both axes (either can be turned off) with nice ticks and the labels.
 * - `clear()` empties every layer and forgets the scales and the readout.
 * - `render(fn)` stores `fn` and draws; `redraw()` re-measures and re-runs it.
 * - `readout(fn)` installs the hover/tap readout; `fn(dataX, dataY, px, py)`
 *   returns a string, an array of lines, or null for nothing.
 * - `setMargin({l, r, t, b})` and `setHeight(h)` re-lay the plotting area.
 * @param {HTMLElement} container
 * @param {{ width?: number, height?: number|'auto', narrowHeight?: number|'auto',
 *   margin?: {l?:number,r?:number,t?:number,b?:number},
 *   narrowMargin?: {l?:number,r?:number,t?:number,b?:number},
 *   xLabel?: string, yLabel?: string, title?: string, ariaLabel?: string,
 *   draw?: (fig: Figure) => void }} [opts]
 * @returns {Figure}
 */
export function makeFigure(container, opts = {}) {
  ensureWatch();
  hookReadoutDismiss();
  const o = Object.assign({ width: DESIGN_W, height: 300, xLabel: '', yLabel: '', title: '' }, opts);
  o.margin = Object.assign({ l: 58, r: 16, t: o.title ? 30 : 14, b: 44 }, opts.margin || {});
  const fig = { container, opts: o, sx: null, sy: null, drawFn: o.draw || null, readoutFn: null, axesDrawn: false,
    // What the marks drew, as data, for the script exports (see figureSpec):
    // the series records, a categorical axis, and axis ranges for a figure
    // that draws rows rather than setting a y scale.
    series: [], cats: null, xRange: null, yRange: null, axisLabels: null };

  const wrap = document.createElement('div');
  wrap.className = 'fig-wrap';
  container.appendChild(wrap);
  fig.wrap = wrap;
  const svg = svgEl('svg', { class: 'fig', role: 'img', 'aria-label': o.ariaLabel || o.title || [o.yLabel, o.xLabel].filter(Boolean).join(' against ') || 'Figure' });
  wrap.appendChild(svg);
  fig.svg = svg;
  const root = svgEl('g', null, svg);
  fig.layers = {
    bg: svgEl('g', { class: 'l-bg' }, root),
    grid: svgEl('g', { class: 'l-grid' }, root),
    axes: svgEl('g', { class: 'l-axes' }, root),
    marks: svgEl('g', { class: 'l-marks' }, root),
    over: svgEl('g', { class: 'l-over' }, root)
  };
  fig.inner = fig.layers.marks;

  fig.measure = () => {
    const cw = wrap.clientWidth;
    fig.w = cw > 0 ? targetWidth(fig, cw) : o.width;
    fig.narrow = fig.w < NARROW_W;
    const hOpt = fig.narrow && o.narrowHeight !== undefined ? o.narrowHeight : o.height;
    fig.autoHeight = hOpt === 'auto';
    fig.h = fig.autoHeight ? 200 : hOpt;
    fig.m = Object.assign({}, o.margin, fig.narrow && o.narrowMargin ? o.narrowMargin : {});
    layout();
  };
  function layout() {
    fig.iw = Math.max(20, fig.w - fig.m.l - fig.m.r);
    fig.ih = Math.max(20, fig.h - fig.m.t - fig.m.b);
    svg.setAttribute('viewBox', '0 0 ' + fig.w + ' ' + fig.h);
    svg.style.maxWidth = fig.w + 'px';
    const tr = 'translate(' + fig.m.l + ',' + fig.m.t + ')';
    for (const k in fig.layers) fig.layers[k].setAttribute('transform', tr);
    // A scale set before the plotting area changed keeps its domain and
    // takes the new range.
    if (fig.sx) fig.sx = linearScale(fig.sx.domain[0], fig.sx.domain[1], 0, fig.iw);
    if (fig.sy) fig.sy = linearScale(fig.sy.domain[0], fig.sy.domain[1], fig.ih, 0);
  }
  fig.setMargin = (mm) => { Object.assign(fig.m, mm); layout(); };
  fig.setHeight = (h) => { fig.h = Math.max(fig.m.t + fig.m.b + 20, Math.round(h)); layout(); };

  fig.x = (domain, so = {}) => {
    let [lo, hi] = finiteDomain(domain);
    if (so.pad || lo === hi) [lo, hi] = padDomain(lo, hi, so.pad || 0);
    // The domain is rounded at a finer step than the ticks use, and so a
    // narrow plot with only two or three ticks is not padded out to them.
    if (so.nice) [lo, hi] = niceDomain(lo, hi, Math.max(5, xWant()));
    fig.sx = linearScale(lo, hi, 0, fig.iw);
    return fig.sx;
  };
  fig.y = (domain, so = {}) => {
    let [lo, hi] = finiteDomain(domain);
    if (so.pad || lo === hi) [lo, hi] = padDomain(lo, hi, so.pad || 0);
    if (so.nice) [lo, hi] = niceDomain(lo, hi, Math.max(5, yWant()));
    fig.sy = linearScale(lo, hi, fig.ih, 0);
    return fig.sy;
  };
  const xWant = () => Math.max(2, Math.round(fig.iw / 95));
  const yWant = () => Math.max(2, Math.round(fig.ih / 55));

  fig.axes = (ao = {}) => {
    const { grid, axes, bg } = fig.layers;
    grid.textContent = ''; axes.textContent = ''; bg.textContent = '';
    fig.axesDrawn = true;
    fig.axisLabels = { x: ao.xLabel !== undefined ? ao.xLabel : o.xLabel, y: ao.yLabel !== undefined ? ao.yLabel : o.yLabel };
    const cMuted = tok('--muted'), cBorder = tok('--border'), cText = tok('--text');
    svgEl('rect', { x: 0, y: 0, width: fig.iw, height: fig.ih, fill: tok('--chart-bg') }, bg);
    const fs = 11;
    if (ao.x !== false && fig.sx) {
      const sx = fig.sx;
      let want = ao.xTicks || xWant();
      let step = niceStep(Math.abs(sx.domain[1] - sx.domain[0]), want);
      let ticks = sx.ticks(want);
      if (ao.xInteger && step < 1) { step = 1; ticks = niceTicks(Math.ceil(sx.domain[0]), Math.floor(sx.domain[1]), want).filter(Number.isInteger); }
      const fmt = ao.xFormat || (v => fmtTick(v, step));
      for (const v of ticks) {
        const px = sx(v);
        if (px < -0.5 || px > fig.iw + 0.5) continue;
        if (ao.grid !== false) svgEl('line', { x1: r1(px), x2: r1(px), y1: 0, y2: fig.ih, stroke: cBorder, 'stroke-width': 1, opacity: 0.7 }, grid);
        svgEl('line', { x1: r1(px), x2: r1(px), y1: fig.ih, y2: fig.ih + 4, stroke: cMuted, 'stroke-width': 1 }, axes);
        // A label at either end is pulled inward just enough to stay inside
        // the viewBox, rather than being clipped by its edge.
        const lab = fmt(v), half = estTextWidth(lab, fs) / 2;
        const lx = Math.min(fig.iw + fig.m.r - half - 1, Math.max(-fig.m.l + half + 1, px));
        text(axes, lx, fig.ih + 16, lab, { 'text-anchor': 'middle', 'font-size': fs, fill: cMuted, class: 'tick' });
      }
      svgEl('line', { x1: 0, x2: fig.iw, y1: fig.ih, y2: fig.ih, stroke: cMuted, 'stroke-width': 1 }, axes);
      const lbl = ao.xLabel !== undefined ? ao.xLabel : o.xLabel;
      if (lbl) text(axes, fig.iw / 2, fig.ih + Math.max(32, fig.m.b - 8), lbl, { 'text-anchor': 'middle', 'font-size': 12, fill: cText, 'font-weight': 500 });
    }
    if (ao.y !== false && fig.sy) {
      const sy = fig.sy;
      let want = ao.yTicks || yWant();
      let step = niceStep(Math.abs(sy.domain[1] - sy.domain[0]), want);
      let ticks = sy.ticks(want);
      if (ao.yInteger && step < 1) { step = 1; ticks = niceTicks(Math.ceil(sy.domain[0]), Math.floor(sy.domain[1]), want).filter(Number.isInteger); }
      const fmt = ao.yFormat || (v => fmtTick(v, step));
      for (const v of ticks) {
        const py = sy(v);
        if (py < -0.5 || py > fig.ih + 0.5) continue;
        if (ao.grid !== false) svgEl('line', { x1: 0, x2: fig.iw, y1: r1(py), y2: r1(py), stroke: cBorder, 'stroke-width': 1, opacity: 0.7 }, grid);
        svgEl('line', { x1: -4, x2: 0, y1: r1(py), y2: r1(py), stroke: cMuted, 'stroke-width': 1 }, axes);
        text(axes, -7, py + 3.8, fmt(v), { 'text-anchor': 'end', 'font-size': fs, fill: cMuted, class: 'tick' });
      }
      svgEl('line', { x1: 0, x2: 0, y1: 0, y2: fig.ih, stroke: cMuted, 'stroke-width': 1 }, axes);
      const lbl = ao.yLabel !== undefined ? ao.yLabel : o.yLabel;
      if (lbl) text(axes, 0, 0, lbl, { 'text-anchor': 'middle', 'font-size': 12, fill: cText, 'font-weight': 500, transform: 'translate(' + (14 - fig.m.l) + ',' + r1(fig.ih / 2) + ') rotate(-90)' });
    }
    if (o.title) text(axes, 0, -fig.m.t + 17, o.title, { 'font-size': 13, 'font-weight': 600, fill: cText });
  };

  fig.clear = () => {
    for (const k in fig.layers) fig.layers[k].textContent = '';
    fig.sx = null; fig.sy = null; fig.readoutFn = null; fig.onPlotClick = null; fig.axesDrawn = false;
    fig.series = []; fig.cats = null; fig.xRange = null; fig.yRange = null; fig.axisLabels = null;
  };
  fig.render = (fn) => { fig.drawFn = fn; fig.redraw(); return fig; };
  fig.redraw = () => {
    fig.measure();
    fig.clear();
    if (fig.drawFn) fig.drawFn(fig);
  };
  fig.readout = (fn) => { fig.readoutFn = fn; };
  installReadout(fig);
  // One click listener per figure; a mark helper that wants plot clicks sets
  // fig.onPlotClick, which clear() resets, and so redraws never stack handlers.
  svg.addEventListener('click', e => { if (fig.onPlotClick) fig.onPlotClick(e); });

  // A figure redraws when its own container width changes: a window resize,
  // a column reflow, or the tab that holds it being shown. Deferred to a
  // timer so the redraw never runs inside the observer's own callback.
  if (typeof ResizeObserver !== 'undefined') {
    let t = null;
    fig.ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const cw = wrap.clientWidth;
        if (cw > 0 && targetWidth(fig, cw) !== fig.w) fig.redraw();
      }, 60);
    });
    fig.ro.observe(wrap);
  }

  FIGS.add(fig);
  fig.measure();
  if (fig.drawFn) fig.redraw();
  return fig;
}

// ── Readout ───────────────────────────────────────────────────────────────

function clientToInner(fig, e) {
  const ctm = fig.svg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { px: pt.x - fig.m.l, py: pt.y - fig.m.t };
}

function installReadout(fig) {
  const svg = fig.svg;
  let box = null;
  function hide() { if (box) { box.remove(); box = null; } }
  fig.hideReadout = hide;
  function show(e) {
    if (!fig.readoutFn) { hide(); return; }
    const p = clientToInner(fig, e);
    if (!p || p.px < 0 || p.px > fig.iw || p.py < 0 || p.py > fig.ih) { hide(); return; }
    const dx = fig.sx ? fig.sx.invert(p.px) : NaN, dy = fig.sy ? fig.sy.invert(p.py) : NaN;
    let lines = fig.readoutFn(dx, dy, p.px, p.py);
    if (lines === null || lines === undefined || lines === '') { hide(); return; }
    if (!Array.isArray(lines)) lines = [String(lines)];
    hide();
    box = svgEl('g', { class: 'fig-readout', 'data-noexport': '', 'pointer-events': 'none' }, fig.layers.over);
    svgEl('line', { x1: r1(p.px), x2: r1(p.px), y1: 0, y2: fig.ih, stroke: tok('--muted'), 'stroke-width': 1, 'stroke-dasharray': '2,3' }, box);
    const fs = 11.5, lh = 15;
    const wBox = Math.max(...lines.map(s => estTextWidth(s, fs))) + 14;
    const hBox = lines.length * lh + 8;
    let bx = p.px + 12, by = p.py - hBox - 8;
    if (bx + wBox > fig.iw) bx = p.px - 12 - wBox;
    if (bx < 0) bx = Math.max(0, Math.min(fig.iw - wBox, p.px - wBox / 2));
    if (by < 0) by = Math.min(fig.ih - hBox, p.py + 14);
    svgEl('rect', { x: r1(bx), y: r1(by), width: r1(wBox), height: hBox, rx: 5, fill: tok('--card'), stroke: tok('--border'), 'stroke-width': 1.2, opacity: 0.96 }, box);
    lines.forEach((s, i) => text(box, bx + 7, by + 4 + lh * (i + 0.5) + 4, s, { 'font-size': fs, fill: tok('--text'), class: 'tabular' }));
  }
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons === 0) show(e); });
  svg.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') show(e); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
}

// A tap elsewhere on the page dismisses a readout a finger left open.
function hookReadoutDismiss() {
  if (readoutDocHook) return;
  readoutDocHook = true;
  document.addEventListener('pointerdown', e => {
    for (const fig of FIGS) if (fig.hideReadout && !fig.svg.contains(e.target)) fig.hideReadout();
  });
}

// ── Shared pieces of the mark helpers ─────────────────────────────────────

function ensureAxes(fig, o, ao) {
  if (o && o.axes === false) return;
  if (!fig.axesDrawn) fig.axes(ao || {});
}
function labelColumn(fig, labels, size) {
  const longest = Math.max(0, ...labels.map(s => estTextWidth(s, size)));
  const maxW = Math.max(60, Math.floor(fig.w * (fig.narrow ? 0.34 : 0.28)));
  const w = Math.min(maxW, Math.ceil(longest) + 14);
  fig.setMargin({ l: w + 8 });
  return w;
}
function clipLabel(s, maxW, size) {
  s = String(s);
  if (estTextWidth(s, size) <= maxW) return s;
  const n = Math.max(1, Math.floor(maxW / (size * 0.56)) - 1);
  return s.slice(0, n) + '…';
}
function rowsHeight(fig, n, rowPx) {
  if (fig.autoHeight) fig.setHeight(fig.m.t + fig.m.b + n * rowPx);
}

// ── Mark helpers ──────────────────────────────────────────────────────────

/**
 * Histogram bars over the given bin edges, as counts or as fractions of the
 * total. Sets the scales from the bins unless the caller already set them.
 * @param {Figure} fig
 * @param {{ edges: ArrayLike<number>, counts: ArrayLike<number> }} h
 * @param {{ color?: string, fraction?: boolean, axes?: boolean }} [o]
 */
export function histogram(fig, h, o = {}) {
  const k = h.counts.length;
  let total = 0;
  for (let i = 0; i < k; i++) total += h.counts[i];
  const ys = Array.from(h.counts, c => o.fraction ? (total > 0 ? c / total : 0) : c);
  const sx = fig.sx || fig.x([h.edges[0], h.edges[k]]);
  const sy = fig.sy || fig.y([0, Math.max(...ys, o.fraction ? 0.01 : 1) * 1.06], { nice: true });
  ensureAxes(fig, o, { yLabel: o.fraction ? (fig.opts.yLabel || 'Fraction') : (fig.opts.yLabel || 'Frequency'), yInteger: !o.fraction });
  const c = col(o.color, '--est');
  fig.series.push({ kind: 'bars', edges: Array.from(h.edges), heights: ys, color: c });
  const g = svgEl('g', { class: 'm-hist' }, fig.inner);
  for (let i = 0; i < k; i++) {
    const x0 = sx(h.edges[i]), x1 = sx(h.edges[i + 1]), y = sy(ys[i]);
    if (!(ys[i] > 0)) continue;
    svgEl('rect', { x: r1(x0 + 0.5), y: r1(y), width: r1(Math.max(0.5, x1 - x0 - 1)), height: r1(sy(0) - y), fill: c, 'fill-opacity': 0.32, stroke: c, 'stroke-width': 1 }, g);
  }
  if (!fig.readoutFn) fig.readout(dx => {
    for (let i = 0; i < k; i++) if (dx >= h.edges[i] && dx <= h.edges[i + 1]) {
      return ['[' + num(h.edges[i]) + ', ' + num(h.edges[i + 1]) + ')', (o.fraction ? 'fraction ' + num(ys[i], 3) : 'count ' + h.counts[i])];
    }
    return null;
  });
}

/**
 * The empirical cdf as a step line.
 * @param {Figure} fig
 * @param {{ x: ArrayLike<number>, p: ArrayLike<number> }} e sorted values and their cumulative fractions
 * @param {{ color?: string, axes?: boolean }} [o]
 */
export function ecdf(fig, e, o = {}) {
  const n = e.x.length;
  if (!n) return;
  const [lo, hi] = extent(e.x);
  const sx = fig.sx || fig.x([lo, hi], { nice: true });
  const sy = fig.sy || fig.y([0, 1]);
  ensureAxes(fig, o, { yLabel: fig.opts.yLabel || 'Cumulative fraction' });
  let d = 'M' + r1(sx(sx.domain[0])) + ',' + r1(sy(0)) + 'H' + r1(sx(e.x[0]));
  for (let i = 0; i < n; i++) {
    d += 'V' + r1(sy(e.p[i]));
    d += 'H' + r1(i + 1 < n ? sx(e.x[i + 1]) : sx(sx.domain[1]));
  }
  svgEl('path', { d, fill: 'none', stroke: col(o.color, '--est'), 'stroke-width': 1.8, 'stroke-linejoin': 'miter', class: 'm-ecdf' }, fig.inner);
  fig.series.push({ kind: 'step', x: [sx.domain[0], ...Array.from(e.x), sx.domain[1]], y: [0, ...Array.from(e.p), e.p[n - 1]], label: 'empirical cdf', color: col(o.color, '--est') });
  if (!fig.readoutFn) fig.readout(dx => {
    let lo2 = 0, hi2 = n;
    while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (e.x[mid] <= dx) lo2 = mid + 1; else hi2 = mid; }
    return ['x = ' + num(dx), 'F(x) = ' + num(lo2 ? e.p[lo2 - 1] : 0, 3)];
  });
}

/**
 * A horizontal box plot (one box, or one per row when given an array of
 * `{label, stats}`): box from q1 to q3, a heavier median line, whiskers with
 * caps, outliers as hollow circles, and the mean, when given, as a hollow
 * diamond.
 * @param {Figure} fig
 * @param {{q1:number, median:number, q3:number, whiskerLo:number, whiskerHi:number, outliers?: number[], mean?: number}
 *   | {label: string, stats: Object}[]} stats
 * @param {{ color?: string, axes?: boolean }} [o]
 */
export function boxPlot(fig, stats, o = {}) {
  const rows = Array.isArray(stats) ? stats : [{ label: '', stats }];
  const labels = rows.map(r => r.label || '');
  const hasLabels = labels.some(Boolean);
  let lw = 0;
  if (hasLabels) lw = labelColumn(fig, labels, 11.5);
  rowsHeight(fig, rows.length, 64);
  const vals = [];
  for (const r of rows) {
    const s = r.stats;
    vals.push(s.whiskerLo, s.whiskerHi, s.q1, s.q3, ...(s.outliers || []));
  }
  const [lo, hi] = extent(vals);
  const sx = fig.sx || fig.x([lo, hi], { pad: 0.05, nice: true });
  ensureAxes(fig, o, { y: false });
  const c = col(o.color, '--est'), pale = tok('--est-pale'), cT = tok('--truth'), card = tok('--card');
  const rowH = fig.ih / rows.length;
  const ry = recordRows(fig, hasLabels ? labels : rows.map(() => ''));
  const rec = { whisk: { kind: 'segments', x0: [], y0: [], x1: [], y1: [], color: c, label: 'whiskers to 1.5 IQR' },
    box: { kind: 'rects', x0: [], y0: [], x1: [], y1: [], color: c, label: 'box from q1 to q3' },
    med: { kind: 'segments', x0: [], y0: [], x1: [], y1: [], color: c, width: 3, label: 'median' },
    out: { kind: 'points', x: [], y: [], color: c, hollow: true, label: 'outlier' },
    mean: { kind: 'points', x: [], y: [], color: cT, marker: 'd', hollow: true, label: 'mean' } };
  rows.forEach((r, i) => {
    const s = r.stats, cy = (i + 0.5) * rowH, bh = Math.min(34, rowH * 0.5);
    const yy = ry(i);
    rec.whisk.x0.push(s.whiskerLo, s.q3, s.whiskerLo, s.whiskerHi); rec.whisk.x1.push(s.q1, s.whiskerHi, s.whiskerLo, s.whiskerHi);
    rec.whisk.y0.push(yy, yy, yy - 0.12, yy - 0.12); rec.whisk.y1.push(yy, yy, yy + 0.12, yy + 0.12);
    rec.box.x0.push(s.q1); rec.box.x1.push(s.q3); rec.box.y0.push(yy - 0.25); rec.box.y1.push(yy + 0.25);
    rec.med.x0.push(s.median); rec.med.x1.push(s.median); rec.med.y0.push(yy - 0.25); rec.med.y1.push(yy + 0.25);
    for (const v of (s.outliers || [])) { rec.out.x.push(v); rec.out.y.push(yy); }
    if (Number.isFinite(s.mean)) { rec.mean.x.push(s.mean); rec.mean.y.push(yy); }
    const g = svgEl('g', { class: 'm-box' }, fig.inner);
    svgEl('line', { x1: r1(sx(s.whiskerLo)), x2: r1(sx(s.q1)), y1: r1(cy), y2: r1(cy), stroke: c, 'stroke-width': 1.5 }, g);
    svgEl('line', { x1: r1(sx(s.q3)), x2: r1(sx(s.whiskerHi)), y1: r1(cy), y2: r1(cy), stroke: c, 'stroke-width': 1.5 }, g);
    for (const w of [s.whiskerLo, s.whiskerHi]) svgEl('line', { x1: r1(sx(w)), x2: r1(sx(w)), y1: r1(cy - bh / 4), y2: r1(cy + bh / 4), stroke: c, 'stroke-width': 1.5 }, g);
    svgEl('rect', { x: r1(sx(s.q1)), y: r1(cy - bh / 2), width: r1(Math.max(1, sx(s.q3) - sx(s.q1))), height: r1(bh), fill: pale, stroke: c, 'stroke-width': 1.5, rx: 2 }, g);
    svgEl('line', { x1: r1(sx(s.median)), x2: r1(sx(s.median)), y1: r1(cy - bh / 2), y2: r1(cy + bh / 2), stroke: c, 'stroke-width': 3 }, g);
    for (const v of (s.outliers || [])) svgEl('circle', { cx: r1(sx(v)), cy: r1(cy), r: 3.2, fill: card, stroke: c, 'stroke-width': 1.4 }, g);
    if (Number.isFinite(s.mean)) {
      const mx = sx(s.mean);
      svgEl('path', { d: 'M' + r1(mx) + ',' + r1(cy - 6) + 'l6,6l-6,6l-6,-6z', fill: card, stroke: cT, 'stroke-width': 2 }, g);
    }
    if (hasLabels) text(fig.layers.axes, -10, cy + 4, clipLabel(r.label, lw - 6, 11.5), { 'text-anchor': 'end', 'font-size': 11.5, fill: tok('--text') });
  });
  fig.series.push(rec.whisk, rec.box, rec.med);
  if (rec.out.x.length) fig.series.push(rec.out);
  if (rec.mean.x.length) fig.series.push(rec.mean);
  if (!fig.readoutFn) fig.readout((dx, dy, px, py) => {
    const i = Math.min(rows.length - 1, Math.max(0, Math.floor(py / rowH)));
    const s = rows[i].stats;
    const out = [(rows[i].label ? rows[i].label + ': ' : '') + 'median ' + num(s.median), 'quartiles ' + num(s.q1) + ', ' + num(s.q3)];
    if (Number.isFinite(s.mean)) out.push('mean ' + num(s.mean));
    return out;
  });
}

/** Alias of boxPlot. */
export const box = boxPlot;

// The most observations drawn as individual dots; longer series are drawn as a thinned line.
const POINT_CAP = 20000;

function xMin0(sx) { return sx.domain[0]; }
function seriesXs(n, xs) {
  if (xs) return xs;
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = i + 1;
  return a;
}
function drawSeries(fig, xs, ys, attrs, cls) {
  const sx = fig.sx, sy = fig.sy;
  const d = decimateMinMax(xs, ys, Math.max(50, Math.round(fig.iw)));
  const px = d.x.map(v => sx(v)), py = d.y.map(v => sy(v));
  return svgEl('path', Object.assign({ d: linePathD(px, py), fill: 'none', 'stroke-linejoin': 'round', class: cls }, attrs), fig.inner);
}

/**
 * An observation sequence as a thin line, observation number (or `xs`) on
 * the horizontal axis. Long series are thinned per pixel column, keeping
 * each column's extremes.
 * @param {Figure} fig
 * @param {ArrayLike<number>} ys
 * @param {{ xs?: ArrayLike<number>, color?: string, axes?: boolean, width?: number }} [o]
 */
export function sequence(fig, ys, o = {}) {
  const xs = seriesXs(ys.length, o.xs);
  if (!fig.sx) fig.x(extent(xs));
  if (!fig.sy) fig.y(extent(ys), { pad: 0.04, nice: true });
  ensureAxes(fig, o, { xLabel: fig.opts.xLabel || (o.xs ? 'Time' : 'Observation') });
  const c = col(o.color, '--est');
  // Observations that happened one at a time are drawn as dots, since a
  // line between them would show values that never occurred; past the
  // point cap the series falls back to the thinned line.
  if (o.marks === 'points' && ys.length <= POINT_CAP) {
    const n = ys.length, r = n > 2000 ? 1.4 : n > 300 ? 2 : 2.8;
    const g = svgEl('g', { class: 'm-seq-dots' }, fig.inner);
    for (let i = 0; i < n; i++) svgEl('circle', { cx: r1(fig.sx(xs[i])), cy: r1(fig.sy(ys[i])), r, fill: c, 'fill-opacity': n > 300 ? 0.7 : 0.85 }, g);
    fig.series.push({ kind: 'points', x: Array.from(xs), y: Array.from(ys), color: c, label: o.label || 'one observation' });
  } else {
    drawSeries(fig, xs, ys, { stroke: c, 'stroke-width': o.width || 1.1 }, 'm-seq');
    fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(ys), color: c, width: 1, label: o.label });
  }
  if (!fig.readoutFn) fig.readout(dx => {
    const i = nearestIndex(xs, dx);
    return i < 0 ? null : [(o.xs ? 't = ' : 'i = ') + num(xs[i]), 'value ' + num(ys[i])];
  });
}

// The index of the x value nearest dx in an ascending array, or −1 when empty.
function nearestIndex(xs, dx) {
  const n = xs.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < dx) lo = mid; else hi = mid; }
  return Math.abs(xs[lo] - dx) <= Math.abs(xs[hi] - dx) ? lo : hi;
}

/**
 * The running (cumulative) mean of a sequence, with a dashed reference line
 * at its final value.
 * @param {Figure} fig
 * @param {ArrayLike<number>} ys the raw observations
 * @param {{ xs?: ArrayLike<number>, color?: string, refColor?: string, axes?: boolean }} [o]
 * @returns {{ final: number }}
 */
export function runningMean(fig, ys, o = {}) {
  const n = ys.length;
  const rm = new Float64Array(n);
  let s = 0, k = 0;
  for (let i = 0; i < n; i++) { if (Number.isFinite(ys[i])) { s += ys[i]; k++; } rm[i] = k ? s / k : NaN; }
  const xs = seriesXs(n, o.xs);
  const final = n ? rm[n - 1] : NaN;
  if (!fig.sx) fig.x(extent(xs));
  if (!fig.sy) fig.y(extent(rm), { pad: 0.08, nice: true });
  ensureAxes(fig, o, { xLabel: fig.opts.xLabel || (o.xs ? 'Time' : 'Observation'), yLabel: fig.opts.yLabel || 'Running mean' });
  if (Number.isFinite(final)) {
    const y = r1(fig.sy(final));
    svgEl('line', { x1: 0, x2: fig.iw, y1: y, y2: y, stroke: col(o.refColor, '--truth'), 'stroke-width': 1.5, 'stroke-dasharray': '6,4', class: 'm-ref' }, fig.inner);
    fig.series.push({ kind: 'hline', y: final, dash: true, color: col(o.refColor, '--truth'), label: 'final value' });
  }
  drawSeries(fig, xs, rm, { stroke: col(o.color, '--est'), 'stroke-width': 1.8 }, 'm-runmean');
  fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(rm), color: col(o.color, '--est'), label: 'running mean' });
  if (!fig.readoutFn) fig.readout(dx => {
    const i = nearestIndex(xs, dx);
    return i < 0 ? null : [(o.xs ? 't = ' : 'i = ') + num(xs[i]), 'running mean ' + num(rm[i])];
  });
  return { final };
}

/**
 * A strip of dots along the value axis, stacked to avoid overlap, with an
 * optional vertical mean line. With `labels`, the readout names the dot
 * nearest the pointer.
 * @param {Figure} fig
 * @param {ArrayLike<number>} values
 * @param {{ labels?: string[], mean?: boolean, color?: string, axes?: boolean, r?: number }} [o]
 */
export function dotPlot(fig, values, o = {}) {
  const n = values.length;
  const [lo, hi] = extent(values);
  const sx = fig.sx || fig.x([lo, hi], { pad: 0.06, nice: true });
  ensureAxes(fig, o, { y: false });
  const r = o.r || (fig.narrow ? 4 : 4.5);
  const idx = Array.from({ length: n }, (_, i) => i).filter(i => Number.isFinite(values[i])).sort((a, b) => values[a] - values[b]);
  // Each dot takes the level nearest the center line (0, +1, −1, +2, ...)
  // whose last dot sits at least one diameter to its left. Past a few
  // hundred values the dots stack upward from a baseline instead, which
  // reads as a dot histogram rather than a mirrored smear.
  const sym = n <= 300;
  const lastX = new Map(), level = new Array(n).fill(0);
  let maxLevel = 0;
  for (const i of idx) {
    const px = sx(values[i]);
    for (let j = 0; ; j++) {
      const L = sym ? (j === 0 ? 0 : (j % 2 ? (j + 1) / 2 : -j / 2)) : j;
      const prev = lastX.get(L);
      if (prev === undefined || px - prev >= 2 * r + 0.5) { lastX.set(L, px); level[i] = L; maxLevel = Math.max(maxLevel, Math.abs(L)); break; }
    }
  }
  const cy = sym ? fig.ih / 2 : fig.ih - r - 2;
  const gap = maxLevel ? Math.min(2 * r + 1, (sym ? fig.ih / 2 - r - 2 : fig.ih - 2 * r - 8) / maxLevel) : 0;
  const c = col(o.color, '--est'), card = tok('--card');
  fig.cats = { axis: 'y', at: [], labels: [] };
  fig.yRange = sym ? [-(maxLevel + 1), maxLevel + 1] : [-1, maxLevel + 1];
  if (o.mean) {
    let s = 0; for (const i of idx) s += values[i];
    const m = s / Math.max(1, idx.length);
    const mx = r1(sx(m));
    svgEl('line', { x1: mx, x2: mx, y1: 6, y2: fig.ih - 6, stroke: tok('--truth'), 'stroke-width': 2, class: 'm-mean' }, fig.inner);
    text(fig.inner, mx + 5, 16, 'mean ' + num(m), { 'font-size': 11, fill: tok('--truth') });
    fig.series.push({ kind: 'vline', x: m, color: tok('--truth'), label: 'mean ' + num(m) });
  }
  const g = svgEl('g', { class: 'm-dots' }, fig.inner);
  for (const i of idx) svgEl('circle', { cx: r1(sx(values[i])), cy: r1(cy - level[i] * gap), r, fill: c, 'fill-opacity': 0.85, stroke: card, 'stroke-width': 1 }, g);
  fig.series.push({ kind: 'points', x: idx.map(i => values[i]), y: idx.map(i => level[i]), color: c, label: o.label || 'one value' });
  if (!fig.readoutFn) fig.readout((dx, dy, px, py) => {
    let best = -1, bd = Infinity;
    for (const i of idx) { const d = Math.hypot(sx(values[i]) - px, cy - level[i] * gap - py); if (d < bd) { bd = d; best = i; } }
    if (best < 0 || bd > 18) return null;
    return [(o.labels ? o.labels[best] + ': ' : '') + num(values[best])];
  });
}

/**
 * A forest plot: one row per item with its label in a left column, a line
 * from lo to hi with end caps, and a dot at the center. A flagged item is
 * drawn in the flag color, dashed, with a hollow dot, and so it reads
 * without color. A vertical reference line marks `ref` (zero for a
 * difference) when given.
 * @param {Figure} fig
 * @param {{label: string, lo: number, hi: number, center?: number, flagged?: boolean, color?: string}[]} items
 * @param {{ ref?: number|null, axes?: boolean, rowPx?: number }} [o]
 */
export function intervals(fig, items, o = {}) {
  const n = items.length;
  const lw = labelColumn(fig, items.map(it => it.label), 11.5);
  rowsHeight(fig, n, o.rowPx || 28);
  const vals = [];
  for (const it of items) vals.push(it.lo, it.hi);
  if (o.ref !== undefined && o.ref !== null) vals.push(o.ref);
  const [lo, hi] = extent(vals);
  const sx = fig.sx || fig.x([lo, hi], { pad: 0.05, nice: true });
  ensureAxes(fig, o, { y: false });
  const rowH = fig.ih / Math.max(1, n);
  const ry = recordRows(fig, items.map(it => it.label));
  if (o.ref !== undefined && o.ref !== null && Number.isFinite(o.ref)) {
    const x = r1(sx(o.ref));
    svgEl('line', { x1: x, x2: x, y1: 0, y2: fig.ih, stroke: tok('--truth'), 'stroke-width': 1.5, 'stroke-dasharray': '5,4', class: 'm-ref' }, fig.inner);
    fig.series.push({ kind: 'vline', x: o.ref, dash: true, color: tok('--truth'), label: 'reference' });
  }
  const cMiss = tok('--miss'), card = tok('--card'), cText = tok('--text');
  const recOf = new Map();
  items.forEach((it, i) => {
    const cy = r1((i + 0.5) * rowH);
    const c = it.flagged ? cMiss : col(it.color, '--est');
    const key = (it.flagged ? 'f' : 'p') + c;
    if (!recOf.has(key)) recOf.set(key, {
      seg: { kind: 'segments', x0: [], y0: [], x1: [], y1: [], color: c, dash: !!it.flagged, label: it.flagged ? 'interval (flagged)' : 'interval' },
      dot: { kind: 'points', x: [], y: [], color: c, hollow: !!it.flagged, label: it.flagged ? 'center (flagged)' : 'center' } });
    const rr = recOf.get(key), yy = ry(i), cc = Number.isFinite(it.center) ? it.center : (it.lo + it.hi) / 2;
    rr.seg.x0.push(it.lo, it.lo, it.hi); rr.seg.x1.push(it.hi, it.lo, it.hi); rr.seg.y0.push(yy, yy - 0.18, yy - 0.18); rr.seg.y1.push(yy, yy + 0.18, yy + 0.18);
    rr.dot.x.push(cc); rr.dot.y.push(yy);
    text(fig.layers.axes, -10, cy + 4, clipLabel(it.label, lw - 6, 11.5), { 'text-anchor': 'end', 'font-size': 11.5, fill: cText });
    // An interval without finite ends keeps its row and label and draws nothing.
    if (!Number.isFinite(it.lo) || !Number.isFinite(it.hi)) return;
    const g = svgEl('g', { class: it.flagged ? 'm-int flagged' : 'm-int' }, fig.inner);
    const x0 = r1(sx(it.lo)), x1 = r1(sx(it.hi));
    const center = Number.isFinite(it.center) ? it.center : (it.lo + it.hi) / 2;
    svgEl('line', { x1: x0, x2: x1, y1: cy, y2: cy, stroke: c, 'stroke-width': 2, 'stroke-dasharray': it.flagged ? '5,3' : null }, g);
    for (const x of [x0, x1]) svgEl('line', { x1: x, x2: x, y1: cy - 5, y2: cy + 5, stroke: c, 'stroke-width': 2 }, g);
    if (it.flagged) svgEl('circle', { cx: r1(sx(center)), cy, r: 4, fill: card, stroke: c, 'stroke-width': 2 }, g);
    else svgEl('circle', { cx: r1(sx(center)), cy, r: 4.2, fill: c }, g);
  });
  for (const rr of recOf.values()) fig.series.push(rr.seg, rr.dot);
  if (!fig.readoutFn) fig.readout((dx, dy, px, py) => {
    const i = Math.floor(py / rowH);
    if (i < 0 || i >= n) return null;
    const it = items[i];
    const center = Number.isFinite(it.center) ? it.center : (it.lo + it.hi) / 2;
    return [it.label, num(center) + '  [' + num(it.lo) + ', ' + num(it.hi) + ']'];
  });
}

/**
 * A scatter plot of paired values.
 * @param {Figure} fig
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {{ color?: string, r?: number, axes?: boolean, xName?: string, yName?: string }} [o]
 */
export function scatter(fig, xs, ys, o = {}) {
  const n = Math.min(xs.length, ys.length);
  if (!fig.sx) fig.x(extent(xs), { pad: 0.05, nice: true });
  if (!fig.sy) fig.y(extent(ys), { pad: 0.05, nice: true });
  ensureAxes(fig, o);
  const sx = fig.sx, sy = fig.sy, c = col(o.color, '--est'), r = o.r || 3.2;
  const g = svgEl('g', { class: 'm-scatter', fill: c, 'fill-opacity': 0.6 }, fig.inner);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    svgEl('circle', { cx: r1(sx(xs[i])), cy: r1(sy(ys[i])), r }, g);
  }
  fig.series.push({ kind: 'points', x: Array.from(xs).slice(0, n), y: Array.from(ys).slice(0, n), color: c, label: o.label });
  if (!fig.readoutFn) fig.readout((dx, dy, px, py) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.hypot(sx(xs[i]) - px, sy(ys[i]) - py); if (d < bd) { bd = d; best = i; } }
    if (best < 0 || bd > 16) return null;
    return ['(' + num(xs[best]) + ', ' + num(ys[best]) + ')'];
  });
}

/**
 * A lag plot: the scatter of (x, y) pairs on one shared scale with the
 * identity line dashed, and so serial dependence shows as points hugging
 * the diagonal.
 * @param {Figure} fig
 * @param {ArrayLike<number>} xs the series at time i
 * @param {ArrayLike<number>} ys the series at time i + lag
 * @param {{ color?: string, axes?: boolean }} [o]
 */
export function lagPlot(fig, xs, ys, o = {}) {
  const [lo, hi] = extent(xs, ys);
  if (!fig.sx) fig.x([lo, hi], { pad: 0.05, nice: true });
  if (!fig.sy) fig.y(fig.sx.domain);
  ensureAxes(fig, o);
  const [d0, d1] = fig.sx.domain;
  svgEl('line', { x1: r1(fig.sx(d0)), y1: r1(fig.sy(d0)), x2: r1(fig.sx(d1)), y2: r1(fig.sy(d1)), stroke: tok('--truth'), 'stroke-width': 1.5, 'stroke-dasharray': '6,4', class: 'm-ref' }, fig.inner);
  fig.series.push({ kind: 'line', x: [d0, d1], y: [d0, d1], dash: true, color: tok('--truth'), label: 'identity line' });
  scatter(fig, xs, ys, Object.assign({}, o, { axes: false, label: o.label || 'one pair' }));
}

/**
 * A normal quantile–quantile plot: the sorted sample against the standard
 * normal quantiles at its plotting positions, with the line through the
 * quartiles drawn across the plot. Points along the line say the sample's
 * shape is normal; a curve away from it at either end says which tail is
 * heavier or lighter than a normal's.
 * @param {Figure} fig
 * @param {{ theoretical: ArrayLike<number>, sample: ArrayLike<number>, slope: number, intercept: number }} q
 * @param {{ color?: string, axes?: boolean }} [o]
 */
export function qqPlot(fig, q, o = {}) {
  const n = Math.min(q.theoretical.length, q.sample.length);
  if (!fig.sx) fig.x(extent(q.theoretical), { pad: 0.08, nice: true });
  if (!fig.sy) fig.y(extent(q.sample), { pad: 0.08, nice: true });
  ensureAxes(fig, o);
  // The line runs across the plotting area and stops at its edges: where it
  // would leave the y range it is cut at the x where it crosses the edge.
  const [d0, d1] = fig.sx.domain, [e0, e1] = fig.sy.domain;
  let xa = d0, xb = d1;
  if (q.slope !== 0) {
    const xs = [(Math.min(e0, e1) - q.intercept) / q.slope, (Math.max(e0, e1) - q.intercept) / q.slope].sort((a, b) => a - b);
    xa = Math.max(d0, xs[0]); xb = Math.min(d1, xs[1]);
  }
  if (xb > xa) {
    const ya = q.intercept + q.slope * xa, yb = q.intercept + q.slope * xb;
    svgEl('line', { x1: r1(fig.sx(xa)), y1: r1(fig.sy(ya)), x2: r1(fig.sx(xb)), y2: r1(fig.sy(yb)), stroke: tok('--truth'), 'stroke-width': 1.5, 'stroke-dasharray': '6,4', class: 'm-ref' }, fig.inner);
    fig.series.push({ kind: 'line', x: [xa, xb], y: [ya, yb], dash: true, color: tok('--truth'), label: 'line through the quartiles' });
  }
  scatter(fig, q.theoretical, q.sample, Object.assign({}, o, { axes: false, r: n > 400 ? 2 : 3.2, label: o.label || 'sorted values' }));
  fig.readout((dx, dy, px, py) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.hypot(fig.sx(q.theoretical[i]) - px, fig.sy(q.sample[i]) - py); if (d < bd) { bd = d; best = i; } }
    if (best < 0 || bd > 16) return null;
    return ['order statistic ' + (best + 1) + ' of ' + n, 'z ' + num(q.theoretical[best], 3) + ', value ' + num(q.sample[best])];
  });
}

/**
 * A correlogram: one stem per lag from zero to r_k with a dot at its end,
 * and the ±band reference lines dashed (2/√n by default for the caller to
 * pass, the approximate 95% band for an independent series). The stems are
 * one path and the dots another, and so several hundred lags draw as fast
 * as a few. Past 120 lags the dots are left off, as they would merge.
 *
 * `lagStep` places lag k at k · lagStep on the x axis (a time step, for a
 * series resampled onto equal time intervals); the axis then takes ordinary
 * rather than integer ticks. `marker` draws a dashed vertical line at a
 * value on that axis, with a short label; a value past the axis is drawn at
 * the right edge with its label saying so. `highlight` draws one lag's stem
 * thicker and its dot larger in the highlight color, and `onPick(k)` is
 * called with the nearest lag when the plot is clicked or tapped.
 * @param {Figure} fig
 * @param {ArrayLike<number>} r autocorrelations r_0 .. r_L
 * @param {{ band?: number, color?: string, axes?: boolean, from?: number, lagStep?: number,
 *   marker?: { at: number, label?: string, color?: string },
 *   highlight?: { at: number, label?: string, color?: string },
 *   onPick?: (k: number) => void }} [o]
 */
export function correlogram(fig, r, o = {}) {
  const L = r.length - 1;
  const from = o.from === undefined ? 0 : o.from;
  const step = o.lagStep > 0 ? o.lagStep : 1;
  const band = Number.isFinite(o.band) ? o.band : NaN;
  const [rlo] = extent(Array.prototype.slice.call(r, from));
  if (!fig.sx) fig.x([(from - 0.6) * step, (L + 0.6) * step]);
  if (!fig.sy) fig.y([Math.min(-0.2, rlo, Number.isFinite(band) ? -band * 1.4 : 0), 1], { nice: true });
  ensureAxes(fig, o, { xInteger: step === 1, xLabel: fig.opts.xLabel || 'Lag', yLabel: fig.opts.yLabel || 'Autocorrelation' });
  const sx = fig.sx, sy = fig.sy, c = col(o.color, '--est');
  const y0 = r1(sy(0));
  svgEl('line', { x1: 0, x2: fig.iw, y1: y0, y2: y0, stroke: tok('--muted'), 'stroke-width': 1 }, fig.inner);
  fig.series.push({ kind: 'hline', y: 0, color: tok('--muted') });
  const stems = { kind: 'segments', x0: [], y0: [], x1: [], y1: [], color: c, label: 'autocorrelation at each lag' };
  for (let k = from; k <= L; k++) if (Number.isFinite(r[k])) { stems.x0.push(k * step); stems.x1.push(k * step); stems.y0.push(0); stems.y1.push(r[k]); }
  fig.series.push(stems);
  const g = svgEl('g', { class: 'm-acf' }, fig.inner);
  const dots = L - from <= 120;
  const rad = L > 60 ? 2 : 3;
  // Stems thin out as they crowd together, and so neighbors stay apart.
  const gap = (fig.iw / Math.max(1, L - from + 1));
  const sw = gap >= 6 ? 1.8 : gap >= 3 ? 1.3 : 1;
  let dStem = '', dDot = '';
  for (let k = from; k <= L; k++) {
    if (!Number.isFinite(r[k])) continue;
    const x = r1(sx(k * step)), y = r1(sy(r[k]));
    dStem += 'M' + x + ',' + y0 + 'V' + y;
    if (dots) dDot += 'M' + r1(x - rad) + ',' + y + 'a' + rad + ',' + rad + ' 0 1,0 ' + 2 * rad + ',0a' + rad + ',' + rad + ' 0 1,0 ' + (-2 * rad) + ',0';
  }
  svgEl('path', { d: dStem, stroke: c, 'stroke-width': sw, fill: 'none' }, g);
  if (dots && dDot) svgEl('path', { d: dDot, fill: c }, g);
  // The band is drawn over the stems: a reference line the stems could
  // cover would vanish exactly where the reader compares against it.
  if (Number.isFinite(band)) {
    for (const b of [band, -band]) {
      const y = r1(sy(b));
      svgEl('line', { x1: 0, x2: fig.iw, y1: y, y2: y, stroke: tok('--truth'), 'stroke-width': 1.4, 'stroke-dasharray': '5,4', class: 'm-band' }, fig.inner);
      fig.series.push({ kind: 'hline', y: b, dash: true, color: tok('--truth'), label: b > 0 ? 'band for an independent series' : undefined });
    }
  }
  if (o.marker && Number.isFinite(o.marker.at)) {
    const mc = col(o.marker.color, '--ok');
    const [d0, d1] = sx.domain;
    const past = o.marker.at > d1;
    const x = r1(sx(Math.min(d1, Math.max(d0, o.marker.at))));
    const gm = svgEl('g', { class: 'm-marker' }, fig.inner);
    svgEl('line', { x1: x, x2: x, y1: 0, y2: fig.ih, stroke: mc, 'stroke-width': 1.8, 'stroke-dasharray': '6,4' }, gm);
    fig.series.push({ kind: 'vline', x: o.marker.at, dash: true, color: mc, label: o.marker.label || 'marker' });
    const s = (o.marker.label || '') + (past ? ' (past the axis) →' : '');
    if (s) {
      const fs = 11.5, w = estTextWidth(s, fs) + 8;
      const lx = past || x + 6 + w > fig.iw ? x - 6 - w : x + 6;
      svgEl('rect', { x: r1(lx), y: 2, width: r1(w), height: 17, rx: 3, fill: tok('--card'), opacity: 0.9 }, gm);
      text(gm, lx + 4, 14, s, { 'font-size': fs, fill: mc, 'font-weight': 600 });
    }
  }
  // The highlighted lag: its stem thicker and its dot larger, in the
  // highlight color, over the others.
  if (o.highlight && Number.isFinite(o.highlight.at) && o.highlight.at >= from && o.highlight.at <= L && Number.isFinite(r[o.highlight.at])) {
    const hk = o.highlight.at, hc = col(o.highlight.color, '--ok');
    const x = r1(sx(hk * step)), y = r1(sy(r[hk]));
    const gh = svgEl('g', { class: 'm-acf-hl' }, fig.inner);
    svgEl('line', { x1: x, x2: x, y1: y0, y2: y, stroke: hc, 'stroke-width': 3 }, gh);
    svgEl('circle', { cx: x, cy: y, r: 4.5, fill: hc, stroke: tok('--card'), 'stroke-width': 1.2 }, gh);
    fig.series.push({ kind: 'points', x: [hk * step], y: [r[hk]], color: hc, label: o.highlight.label || 'highlighted lag' });
  }
  if (!fig.readoutFn) fig.readout(dx => {
    const k = Math.round(dx / step);
    if (k < from || k > L) return null;
    const lines = ['lag ' + (step === 1 ? k : num(k * step)), 'r = ' + num(r[k], 3)];
    if (Number.isFinite(band)) lines.push(Math.abs(r[k]) <= band ? 'inside the ±2/√n band' : 'outside the ±2/√n band');
    return lines;
  });
  // A tap or click on the plot hands the nearest lag to the caller.
  if (typeof o.onPick === 'function') fig.onPlotClick = e => {
    const p = clientToInner(fig, e);
    if (!p || p.px < 0 || p.px > fig.iw || p.py < 0 || p.py > fig.ih) return;
    const k = Math.round(sx.invert(p.px) / step);
    if (k >= from && k <= L) o.onPick(k);
  };
}

/**
 * A draggable vertical line over a drawn figure, for a value the reader sets
 * by hand: a benchmark, a cut, a threshold. The whole line is the grab
 * target through an invisible 24px-wide stroke, it follows a pointer or
 * finger, the arrow keys move it by `step` (ten steps with shift), and its
 * label shows the value as it moves. `onMove` fires on every change and
 * `onEnd` when a drag or key press finishes. The exported figure carries the
 * line where it stands. A `label` of null draws no text beside the line, for
 * a value a control beside the plot shows as it moves.
 * @param {Figure} fig a figure whose x scale is set
 * @param {{ value: number, label?: ((v: number) => string)|null, color?: string, ariaLabel?: string,
 *   step?: number, onMove?: (v: number) => void, onEnd?: (v: number) => void }} d
 * @returns {{ set: (v: number) => void, get: () => number }}
 */
export function dragLine(fig, d) {
  const sx = fig.sx;
  const [xMin, xMax] = sx.domain;
  const step = d.step || (xMax - xMin) / 100 || 1;
  const clamp = v => Math.min(xMax, Math.max(xMin, v));
  let v = clamp(d.value);
  const fmt = d.label === null ? null : (d.label || (x => num(x)));
  const c = col(d.color, '--text');
  const rec = { kind: 'vline', x: v, dash: true, color: c, label: d.ariaLabel || 'marker' };
  fig.series.push(rec);
  fig.svg.setAttribute('role', 'group');
  const g = svgEl('g', { class: 'm-drag' }, fig.layers.over);
  const vis = svgEl('line', { y1: 0, y2: fig.ih, stroke: c, 'stroke-width': 1.8, 'stroke-dasharray': '6,4' }, g);
  const lblBg = fmt ? svgEl('rect', { y: 2, height: 17, rx: 3, fill: tok('--card'), opacity: 0.9 }, g) : null;
  const lbl = fmt ? svgEl('text', { y: 14, 'font-size': 11.5, fill: c, 'font-weight': 600 }, g) : null;
  const hit = svgEl('line', {
    y1: 0, y2: fig.ih, stroke: 'transparent', 'stroke-width': 24, 'pointer-events': 'stroke',
    class: 'cut-hit', 'data-noexport': '', tabindex: 0, role: 'slider', 'aria-label': d.ariaLabel || 'marker',
    'aria-valuemin': xMin, 'aria-valuemax': xMax
  }, g);
  hit.style.cursor = 'ew-resize';
  hit.style.touchAction = 'none';
  hit.style.outline = 'none';
  function place() {
    const x = r1(sx(v));
    for (const ln of [vis, hit]) { ln.setAttribute('x1', x); ln.setAttribute('x2', x); }
    rec.x = v;
    const s = fmt ? fmt(v) : num(v);
    if (fmt) {
      lbl.textContent = s;
      const w = estTextWidth(s, 11.5) + 8;
      const lx = x + 6 + w > fig.iw ? x - 6 - w : x + 6;
      lbl.setAttribute('x', r1(lx + 4));
      lblBg.setAttribute('x', r1(lx));
      lblBg.setAttribute('width', r1(w));
    }
    hit.setAttribute('aria-valuenow', v);
    hit.setAttribute('aria-valuetext', s);
  }
  function set(x, end) {
    v = clamp(x);
    place();
    if (d.onMove) d.onMove(v);
    if (end && d.onEnd) d.onEnd(v);
  }
  function hot(on) { vis.setAttribute('stroke-width', on ? 3.2 : 1.8); }
  place();
  let dragging = false;
  hit.addEventListener('pointerenter', () => hot(true));
  hit.addEventListener('pointerleave', () => { if (!dragging) hot(false); });
  hit.addEventListener('focus', () => hot(true));
  hit.addEventListener('blur', () => hot(false));
  hit.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    hot(true);
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    hit.focus({ preventScroll: true });
  });
  hit.addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = clientToInner(fig, e);
    if (p) set(sx.invert(p.px), false);
  });
  const end = () => { if (!dragging) return; dragging = false; hot(false); if (d.onEnd) d.onEnd(v); };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
  // Only a gesture that starts on the handle is kept from scrolling the page.
  hit.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  hit.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    set(v + (e.key === 'ArrowRight' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
  });
  return { set: x => { v = clamp(x); place(); }, get: () => v };
}

/**
 * The warm-up plot: the across-replication average (thin, neutral), its
 * moving average (the sampled color), the cumulative average (the reference
 * color, dashed), and a draggable vertical truncation line. The whole line
 * is the grab target through an invisible 24px-wide stroke; it follows a
 * mouse or a finger through pointer events, takes ArrowLeft/ArrowRight when
 * focused (Shift for ten steps), and a tap or click elsewhere on the plot
 * moves it there. `onCut(x)` is called during the drag and `onCutEnd(x)`
 * when it ends. With `shade`, the stretch from the left edge to the cut lies
 * under a translucent band in the muted color that follows the line live,
 * marking what the cut would delete.
 * @param {Figure} fig
 * @param {{ x: ArrayLike<number>, raw?: ArrayLike<number>, smooth?: ArrayLike<number>,
 *   cumulative?: ArrayLike<number>, cut?: number|null, onCut?: (x: number) => void,
 *   onCutEnd?: (x: number) => void, step?: number, cutLabel?: (x: number) => string,
 *   shade?: boolean, axes?: boolean }} d
 * @returns {{ setCut: (x: number) => void, getCut: () => number }}
 */
export function welchPlot(fig, d) {
  const xs = d.x;
  const n = xs.length;
  if (!fig.sx) fig.x(extent(xs));
  if (!fig.sy) fig.y(extent(d.raw, d.smooth, d.cumulative), { pad: 0.05, nice: true });
  ensureAxes(fig, d);
  const sx = fig.sx, sy = fig.sy;
  // The cut rests at `cutMin` when none is given and cannot go below it: the
  // start of the series, or the earlier cut of a series already truncated.
  const lo = Number.isFinite(d.cutMin) ? Math.max(sx.domain[0], d.cutMin) : sx.domain[0];
  const xLo = r1(sx(lo));
  // The band sits under every series, and place() sets its width.
  const shade = d.shade ? svgEl('rect', { x: xLo, y: 0, height: fig.ih, width: 0, fill: tok('--muted'), 'fill-opacity': SHADE_OPACITY, class: 'm-shade' }, fig.inner) : null;
  const shadeRec = d.shade ? { kind: 'span', x0: lo, x1: lo, color: tok('--muted'), label: 'excluded by the cut' } : null;
  if (shadeRec) fig.series.push(shadeRec);
  if (d.raw) { drawSeries(fig, xs, d.raw, { stroke: tok('--pair'), 'stroke-width': 1 }, 'm-raw'); fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(d.raw), color: tok('--pair'), width: 1, label: 'ensemble average' }); }
  if (d.cumulative) { drawSeries(fig, xs, d.cumulative, { stroke: tok('--truth'), 'stroke-width': 1.8, 'stroke-dasharray': '6,4' }, 'm-cum'); fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(d.cumulative), color: tok('--truth'), dash: true, label: 'cumulative average' }); }
  if (d.smooth) {
    // A white halo under the smoothed line keeps it legible where it crosses
    // the dense raw series.
    drawSeries(fig, xs, d.smooth, { stroke: tok('--card'), 'stroke-width': 4.5, opacity: 0.85 }, 'm-halo');
    drawSeries(fig, xs, d.smooth, { stroke: tok('--est'), 'stroke-width': 2.2 }, 'm-smooth');
    fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(d.smooth), color: tok('--est'), width: 2, label: 'moving average' });
  }
  const cutRec = { kind: 'vline', x: xMin0(sx), dash: true, color: tok('--text'), label: 'cut' };
  fig.series.push(cutRec);
  const [xMin, xMax] = sx.domain;
  const step = d.step || (n > 1 ? Math.abs(xs[1] - xs[0]) : (xMax - xMin) / 100) || 1;
  const clamp = v => Math.min(xMax, Math.max(lo, v));
  // With no cut given, the line starts where the series does: no truncation.
  let cut = Number.isFinite(d.cut) ? clamp(d.cut) : lo;
  const fmtCut = d.cutLabel || (v => 'cut at ' + num(v));
  const cText = tok('--text');

  // An img role would hide the slider inside it from assistive technology.
  fig.svg.setAttribute('role', 'group');
  const g = svgEl('g', { class: 'm-cut' }, fig.layers.over);
  const vis = svgEl('line', { y1: 0, y2: fig.ih, stroke: cText, 'stroke-width': 1.8, 'stroke-dasharray': '6,4' }, g);
  const lblBg = svgEl('rect', { y: 2, height: 17, rx: 3, fill: tok('--card'), opacity: 0.9 }, g);
  const lbl = svgEl('text', { y: 14, 'font-size': 11.5, fill: cText, 'font-weight': 600 }, g);
  const hit = svgEl('line', {
    y1: 0, y2: fig.ih, stroke: 'transparent', 'stroke-width': 24, 'pointer-events': 'stroke',
    class: 'cut-hit', 'data-noexport': '', tabindex: 0, role: 'slider', 'aria-label': 'Truncation point',
    'aria-valuemin': lo, 'aria-valuemax': xMax
  }, g);
  hit.style.cursor = 'ew-resize';
  hit.style.touchAction = 'none';
  hit.style.outline = 'none';

  function place() {
    const x = r1(sx(cut));
    for (const ln of [vis, hit]) { ln.setAttribute('x1', x); ln.setAttribute('x2', x); }
    if (shade) shade.setAttribute('width', Math.max(0, x - xLo));
    // The exported figure carries the cut where it stands now.
    cutRec.x = cut;
    if (shadeRec) shadeRec.x1 = cut;
    const s = fmtCut(cut);
    lbl.textContent = s;
    const w = estTextWidth(s, 11.5) + 8;
    const lx = x + 6 + w > fig.iw ? x - 6 - w : x + 6;
    lbl.setAttribute('x', r1(lx + 4));
    lblBg.setAttribute('x', r1(lx));
    lblBg.setAttribute('width', r1(w));
    hit.setAttribute('aria-valuenow', cut);
    hit.setAttribute('aria-valuetext', s);
  }
  function set(v, end) {
    cut = clamp(v);
    place();
    if (d.onCut) d.onCut(cut);
    if (end && d.onCutEnd) d.onCutEnd(cut);
  }
  function hot(on) { vis.setAttribute('stroke-width', on ? 3.2 : 1.8); }
  place();

  let dragging = false;
  hit.addEventListener('pointerenter', () => hot(true));
  hit.addEventListener('pointerleave', () => { if (!dragging) hot(false); });
  hit.addEventListener('focus', () => hot(true));
  hit.addEventListener('blur', () => hot(false));
  hit.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    hot(true);
    try { hit.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    hit.focus({ preventScroll: true });
  });
  hit.addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = clientToInner(fig, e);
    if (p) set(sx.invert(p.px), false);
  });
  const end = () => { if (!dragging) return; dragging = false; hot(false); if (d.onCutEnd) d.onCutEnd(cut); };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
  // Only a gesture that starts on the handle is kept from scrolling the page.
  hit.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  hit.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    set(cut + (e.key === 'ArrowRight' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
  });
  fig.onPlotClick = e => {
    if (e.target === hit) return;
    const p = clientToInner(fig, e);
    if (!p || p.px < 0 || p.px > fig.iw || p.py < 0 || p.py > fig.ih) return;
    set(sx.invert(p.px), true);
  };
  return { setCut: v => { cut = clamp(v); place(); }, getCut: () => cut };
}

/**
 * The batch-means plot: the series as a thin line, a dashed vertical line at
 * each batch boundary, and each batch's mean as a horizontal segment across
 * its batch.
 *
 * With `excludeTo`, the series before that x value is what truncation
 * excludes: it lies under a translucent band in the muted color and is drawn
 * in the muted color itself, and the series after it in the usual color.
 * With `joins`, a thin dotted vertical line in the accent color marks each
 * place where one replication's series ends and the next begins.
 * @param {Figure} fig
 * @param {{ xs?: ArrayLike<number>, ys: ArrayLike<number>, boundaries: ArrayLike<number>,
 *   means: ArrayLike<number>, excludeTo?: number|null, joins?: ArrayLike<number>,
 *   axes?: boolean }} d `boundaries` holds the b + 1 batch edges on the x scale;
 *   `means` the b batch means
 */
export function batchPlot(fig, d) {
  const xs = seriesXs(d.ys.length, d.xs);
  if (!fig.sx) fig.x(extent(xs, d.boundaries));
  if (!fig.sy) fig.y(extent(d.ys, d.means), { pad: 0.04, nice: true });
  ensureAxes(fig, d, { xLabel: fig.opts.xLabel || (d.xs ? 'Time' : 'Observation') });
  const sx = fig.sx, sy = fig.sy;
  const cut = d.excludeTo;
  const cM = tok('--muted');
  fig.series.push({ kind: 'line', x: Array.from(xs), y: Array.from(d.ys), color: tok('--est'), width: 1, label: 'series' });
  if (Number.isFinite(cut) && xs.length && cut > xs[0]) {
    const xc = Math.min(fig.iw, Math.max(0, sx(cut)));
    svgEl('rect', { x: 0, y: 0, width: r1(xc), height: fig.ih, fill: cM, 'fill-opacity': SHADE_OPACITY, class: 'm-shade' }, fig.inner);
    fig.series.push({ kind: 'span', x0: sx.domain[0], x1: cut, color: cM, label: 'excluded by truncation' });
    // The two pieces meet at the cut, where the line is interpolated, and so
    // the series reads as one line changing color.
    const n = xs.length;
    let k = 0;
    while (k < n && xs[k] < cut) k++;
    const xa = [], ya = [], xb = [], yb = [];
    for (let i = 0; i < k; i++) { xa.push(xs[i]); ya.push(d.ys[i]); }
    if (k > 0 && k < n) {
      const x0 = xs[k - 1], x1 = xs[k], y0 = d.ys[k - 1], y1 = d.ys[k];
      const yc = x1 > x0 ? y0 + (y1 - y0) * (cut - x0) / (x1 - x0) : y1;
      xa.push(cut); ya.push(yc); xb.push(cut); yb.push(yc);
    }
    for (let i = k; i < n; i++) { xb.push(xs[i]); yb.push(d.ys[i]); }
    drawSeries(fig, xa, ya, { stroke: cM, 'stroke-width': 1, 'stroke-opacity': 0.8 }, 'm-seq-excluded');
    const s = drawSeries(fig, xb, yb, { stroke: tok('--est'), 'stroke-width': 1, opacity: 0.55 }, 'm-seq');
    s.setAttribute('stroke-opacity', 0.9);
  } else {
    const s = drawSeries(fig, xs, d.ys, { stroke: tok('--est'), 'stroke-width': 1, opacity: 0.55 }, 'm-seq');
    s.setAttribute('stroke-opacity', 0.9);
  }
  const gB = svgEl('g', { class: 'm-bounds' }, fig.inner);
  const [yb0, yb1] = sy.domain;
  const bounds = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cM, dash: 'dotted', width: 1, label: 'batch boundary' };
  for (let i = 0; i < d.boundaries.length; i++) {
    const x = r1(sx(d.boundaries[i]));
    svgEl('line', { x1: x, x2: x, y1: 0, y2: fig.ih, stroke: cM, 'stroke-width': 1, 'stroke-dasharray': '2,3' }, gB);
    bounds.x0.push(d.boundaries[i]); bounds.x1.push(d.boundaries[i]); bounds.y0.push(yb0); bounds.y1.push(yb1);
  }
  fig.series.push(bounds);
  if (d.joins && d.joins.length) {
    const cJ = tok('--accent');
    let dj = '';
    for (let i = 0; i < d.joins.length; i++) {
      const x = r1(sx(d.joins[i]));
      if (x >= 0 && x <= fig.iw) dj += 'M' + x + ',0V' + r1(fig.ih);
    }
    svgEl('path', { d: dj, stroke: cJ, 'stroke-width': 1.4, 'stroke-dasharray': '1.5,3', fill: 'none', class: 'm-joins' }, fig.inner);
    fig.series.push({ kind: 'segments', x0: Array.from(d.joins), x1: Array.from(d.joins), y0: Array.from(d.joins, () => yb0), y1: Array.from(d.joins, () => yb1), color: cJ, dash: 'dotted', width: 1, label: 'join between replications' });
  }
  const gM = svgEl('g', { class: 'm-bmeans' }, fig.inner);
  const cOk = tok('--ok'), card = tok('--card');
  const meansRec = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cOk, width: 3, label: 'batch mean' };
  for (let i = 0; i < d.means.length; i++) {
    const x0 = r1(sx(d.boundaries[i])), x1 = r1(sx(d.boundaries[i + 1])), y = r1(sy(d.means[i]));
    svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: card, 'stroke-width': 6 }, gM);
    svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: cOk, 'stroke-width': 3 }, gM);
    meansRec.x0.push(d.boundaries[i]); meansRec.x1.push(d.boundaries[i + 1]); meansRec.y0.push(d.means[i]); meansRec.y1.push(d.means[i]);
  }
  fig.series.push(meansRec);
  if (!fig.readoutFn) fig.readout(dx => {
    for (let i = 0; i < d.means.length; i++) {
      if (dx >= d.boundaries[i] && dx <= d.boundaries[i + 1]) return ['batch ' + (i + 1), 'mean ' + num(d.means[i])];
    }
    if (Number.isFinite(cut) && dx < cut) return ['excluded by truncation'];
    return null;
  });
}

// ── Legends ───────────────────────────────────────────────────────────────

/**
 * A legend in the symbol-first grid (.leg): each item a swatch drawn the
 * way the plot draws that mark, followed by its label.
 * @param {HTMLElement} container the element to fill; it gains the .leg class
 * @param {{ swatch: 'line'|'dash'|'dot'|'hollow'|'bar'|'interval'|'flagged'|'thin'|'diamond'|'shade'|'dotted', color: string, label: string }[]} items
 *   `color` is a token name ('--est') or a CSS color; `label` is HTML. `shade` is
 *   the translucent band that marks an excluded stretch, with the muted line
 *   drawn inside it; `dotted` is a thin dotted line.
 * @returns {HTMLElement} the container
 */
export function legend(container, items) {
  container.classList.add('leg');
  container.innerHTML = items.map(it => '<span>' + swatchSvg(it.swatch, col(it.color, '--est')) + '<span>' + it.label + '</span></span>').join('');
  return container;
}

function swatchSvg(kind, c) {
  const card = tok('--card') || '#fff';
  let inner;
  switch (kind) {
    case 'dash': inner = '<line x1="1" y1="6" x2="23" y2="6" stroke="' + c + '" stroke-width="2" stroke-dasharray="5,3"/>'; break;
    case 'shade': inner = '<rect x="1" y="0" width="22" height="12" fill="' + c + '" fill-opacity="' + SHADE_OPACITY + '"/><line x1="1" y1="6" x2="23" y2="6" stroke="' + c + '" stroke-width="1.2" stroke-opacity=".8"/>'; break;
    case 'dotted': inner = '<line x1="1" y1="6" x2="23" y2="6" stroke="' + c + '" stroke-width="1.6" stroke-dasharray="1.5,3"/>'; break;
    case 'thin': inner = '<line x1="1" y1="6" x2="23" y2="6" stroke="' + c + '" stroke-width="1.2"/>'; break;
    case 'diamond': inner = '<path d="M12 1l5 5-5 5-5-5z" fill="' + card + '" stroke="' + c + '" stroke-width="1.8"/>'; break;
    case 'dot': inner = '<circle cx="12" cy="6" r="4" fill="' + c + '"/>'; break;
    case 'hollow': inner = '<circle cx="12" cy="6" r="4" fill="' + card + '" stroke="' + c + '" stroke-width="2"/>'; break;
    case 'bar': inner = '<rect x="5" y="1" width="14" height="10" fill="' + c + '" fill-opacity=".32" stroke="' + c + '" stroke-width="1"/>'; break;
    case 'interval': inner = '<line x1="2" y1="6" x2="22" y2="6" stroke="' + c + '" stroke-width="2"/><line x1="2" y1="2" x2="2" y2="10" stroke="' + c + '" stroke-width="2"/><line x1="22" y1="2" x2="22" y2="10" stroke="' + c + '" stroke-width="2"/><circle cx="12" cy="6" r="3.6" fill="' + c + '"/>'; break;
    case 'flagged': inner = '<line x1="2" y1="6" x2="22" y2="6" stroke="' + c + '" stroke-width="2" stroke-dasharray="4,2.5"/><line x1="2" y1="2" x2="2" y2="10" stroke="' + c + '" stroke-width="2"/><line x1="22" y1="2" x2="22" y2="10" stroke="' + c + '" stroke-width="2"/><circle cx="12" cy="6" r="3.4" fill="' + card + '" stroke="' + c + '" stroke-width="2"/>'; break;
    default: inner = '<line x1="1" y1="6" x2="23" y2="6" stroke="' + c + '" stroke-width="2.2"/>';
  }
  return '<svg class="lg-sv" viewBox="0 0 24 12" aria-hidden="true">' + inner + '</svg>';
}

// ── Export ────────────────────────────────────────────────────────────────

const EXPORT_TOKENS = ['--accent', '--text', '--muted', '--border', '--card', '--chart-bg', '--truth', '--est', '--est-pale', '--miss', '--ok', '--band', '--pair', '--warn'];

/**
 * Serializes a figure as a standalone SVG document: the readout and the
 * drag handle's hit stroke are left out, a white background is added, and
 * an inline <style> carries the font families and the page's tokens
 * resolved to literal colors.
 * @param {Figure} fig
 * @returns {string}
 */
export function figureToSvgString(fig) {
  const clone = fig.svg.cloneNode(true);
  clone.querySelectorAll('[data-noexport]').forEach(n => n.remove());
  clone.setAttribute('xmlns', SVGNS);
  clone.setAttribute('width', fig.w);
  clone.setAttribute('height', fig.h);
  clone.removeAttribute('style');
  clone.removeAttribute('class');
  const css = getComputedStyle(document.documentElement);
  const vars = EXPORT_TOKENS.map(n => n + ':' + css.getPropertyValue(n).trim()).join(';');
  const style = document.createElementNS(SVGNS, 'style');
  style.textContent = 'svg{' + vars + '} text{font-family:' + FONT + '} .tick,.tabular{font-variant-numeric:tabular-nums} .mono{font-family:' + MONO + '}';
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', css.getPropertyValue('--card').trim() || '#fff');
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/**
 * Rasterizes a figure to a PNG blob at `scale` (default devicePixelRatio,
 * so a phone gets a file as sharp as its own screen).
 * @param {Figure} fig
 * @param {number} [scale]
 * @returns {Promise<Blob>}
 */
export function figureToPngBlob(fig, scale) {
  const s = scale || window.devicePixelRatio || 1;
  const str = figureToSvgString(fig);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(fig.w * s); cv.height = Math.round(fig.h * s);
      const ctx = cv.getContext('2d');
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.drawImage(img, 0, 0, fig.w, fig.h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG could not be rasterized')); };
    img.src = url;
  });
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(s) {
  return String(s || 'figure').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'figure';
}

/**
 * Two small outlined buttons, "SVG" and "PNG", placed above the figure's
 * top-right corner, that download the figure. Accepts either
 * `(container, fig, baseName)` or `(fig, baseName)`, the latter placing the
 * buttons in the figure's own container.
 * @param {HTMLElement|Figure} container
 * @param {Figure|string} fig
 * @param {string} [baseName]
 * @returns {HTMLDivElement} the button row
 */
export function exportButtons(container, fig, baseName) {
  if (container && container.svg && container.wrap) { baseName = fig; fig = container; container = fig.container; }
  const row = document.createElement('div');
  row.className = 'fig-tools';
  const name = safeName(baseName);
  const mk = (label, desc, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-mini'; b.textContent = label;
    b.setAttribute('aria-label', desc);
    b.addEventListener('click', fn);
    row.appendChild(b);
  };
  mk('SVG', 'Download this figure as SVG', () => download(name + '.svg', new Blob([figureToSvgString(fig)], { type: 'image/svg+xml;charset=utf-8' })));
  mk('PNG', 'Download this figure as PNG', () => figureToPngBlob(fig).then(b => download(name + '.png', b)).catch(err => console.error(err)));
  for (const [ext, w] of Object.entries(SCRIPT_WRITERS)) {
    mk(w.label, 'Download a ' + w.name + ' script that redraws this figure from its data', () => {
      // Each language names the file its own way: MATLAB runs a script by
      // its file name, which must be an identifier.
      const spec = figureSpec(fig, name);
      download(w.file(spec.name) + '.' + ext, new Blob([w.write(spec)], { type: w.mime + ';charset=utf-8' }));
    });
  }
  if (fig.wrap && fig.wrap.parentNode === container) container.insertBefore(row, fig.wrap);
  else container.insertBefore(row, container.firstChild);
  return row;
}

/**
 * Records that a figure draws `labels.length` rows from the top down, for the
 * script exports: row i sits at y = n − i, the y axis is categorical with the
 * labels, and the y range runs from 0.5 to n + 0.5.
 * @param {Figure} fig
 * @param {string[]} labels
 * @returns {(i: number) => number} the y value of row i
 */
export function recordRows(fig, labels) {
  const n = labels.length;
  fig.cats = { axis: 'y', at: labels.map((_, i) => n - i), labels: labels.map(l => String(l == null ? '' : l)) };
  fig.yRange = [0.5, n + 0.5];
  return i => n - i;
}

/**
 * The figure as data for the script writers (see io/scripts.js): its title
 * and axis labels, its axis ranges, a categorical axis when the marks set
 * one, and every series the marks recorded while drawing.
 * @param {Figure} fig
 * @param {string} [name] the file base name
 * @returns {object}
 */
export function figureSpec(fig, name) {
  const o = fig.opts, lab = fig.axisLabels || {};
  const xlim = fig.xRange || (fig.sx ? fig.sx.domain.slice() : null);
  const ylim = fig.yRange || (fig.sy ? fig.sy.domain.slice() : null);
  const cats = fig.cats;
  return {
    name: name || o.title || o.ariaLabel || 'figure',
    title: o.title || o.ariaLabel || '',
    xLabel: lab.x !== undefined ? lab.x : o.xLabel,
    yLabel: lab.y !== undefined ? lab.y : o.yLabel,
    xlim, ylim,
    xTicks: cats && cats.axis === 'x' ? { at: cats.at.slice(), labels: cats.labels.slice() } : null,
    yTicks: cats && cats.axis === 'y' ? { at: cats.at.slice(), labels: cats.labels.slice() } : null,
    series: fig.series.slice()
  };
}

/** Escapes text for HTML labels passed to legend(). */
export { esc };
