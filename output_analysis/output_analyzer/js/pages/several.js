// The Several Systems page: k designs compared at once on their replication
// estimates. Five results, each its own card and its own section, shown one
// at a time under the controls: every mean with a Bonferroni simultaneous
// interval; a Bonferroni family of Welch differences (all pairs or against a
// control); the replications per design a target half-width on those
// differences or a target ANOVA power needs; one-way ANOVA with a post-hoc
// rule and the compact letter display; and a subset-selection screen for the
// best design with the second-stage replication counts a Rinott procedure
// would ask for. Every result is computed whichever section is open.

import * as state from '../state.js';
import { repEstimates, canInfer } from '../data/model.js';
import { simultaneousMeans, bonferroniFamily, anova, posthoc, planHalfWidthBonferroni, powerAnova, planPowerAnova } from '../stats/compare.js';
import { subsetSelection } from '../stats/select.js';
import { card, cardRow, datasetChecklist, levelSelect, spinner, details, notice } from '../ui/widgets.js';
import { makeFigure, exportButtons, legend, intervals, recordRows, svgEl, tok, extent } from '../ui/plots.js';
import { installExportRow } from '../ui/exportrow.js';
import { num, pValue, pct, esc, plural, intl, dash } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'several';
/** The page's title. */
export const title = 'Several Systems';
/** The page's sections, shown one at a time under the controls. */
export const sections = [
  { id: 'means', label: 'Means' },
  { id: 'diffs', label: 'Differences' },
  { id: 'plan', label: 'Replications' },
  { id: 'anova', label: 'ANOVA and post hoc' },
  { id: 'subset', label: 'Best subset' }
];

const RULES = {
  tukey: 'Tukey’s HSD',
  lsd: 'Fisher’s LSD (protected)',
  bonferroni: 'Bonferroni',
  dunnett: 'Dunnett vs control'
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

let rootEl = null;
let checklist = null;
let ctrlSel = null;
let dir = 'max';
let diffMode = 'pairs';
let rule = 'tukey';
let controlId = null;
// The indifference zone: null follows the default (10% of the pooled sd),
// a number is the reader's own value.
let epsUser = null;
let epsSpin = null;
let epsStep = null;
let pending = false;
// The replication plan. A null target follows its default, which is
// recomputed from the data; a number is the reader's own value, kept until
// another set of designs is checked.
const plan = { mode: 'hw', key: null, hwUser: null, deltaUser: null, power: 0.8, hwSlot: {}, deltaSlot: {} };
// What the plan is computed from, or { msg } when it cannot be, and the
// page's result without its planning table; both are set by update(), and
// so a planning control redraws only the planning card.
let planCtx = null;
let resultBase = null;

// ── Small helpers ─────────────────────────────────────────────────────────

const interval = (lo, hi) => '[' + num(lo) + ', ' + num(hi) + ']';
const levelPct = level => num(level * 100, 4) + '%';
const word = k => (k < WORDS.length ? WORDS[k] : intl(k));
const allOf = k => (k === 2 ? 'both' : 'all ' + word(k));

// Display names: when every name shares one "prefix · " part (the datasets a
// scenario column split one file into), only the part after it is shown.
function shortNames(list) {
  const names = list.map(d => d.name);
  if (names.length < 2) return names;
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const parts = names.map(cut);
  if (parts.some(p => !p) || parts.some(p => p[0] !== parts[0][0])) return names;
  const tails = parts.map(p => p[1]);
  return new Set(tails).size === tails.length ? tails : names;
}

// Two significant digits, for a default target that reads as a round number.
function round2(v) {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Number((Math.round(v / p) * p).toPrecision(2));
}

function finiteOf(ds) {
  return Float64Array.from(Array.from(repEstimates(ds)).filter(Number.isFinite));
}

function sec(heading) {
  const s = document.createElement('div');
  s.className = 'sec';
  s.innerHTML = '<div class="sec-hd">' + heading + '</div>';
  return s;
}

function para(cls, html) {
  const p = document.createElement('p');
  p.className = cls;
  p.innerHTML = html;
  return p;
}

// A results table in a horizontally scrolling wrapper. Cells are HTML.
function table(headers, rows, rowClass) {
  const w = document.createElement('div');
  w.className = 'tab-wrap cmp-tab';
  w.innerHTML = '<table class="ptab"><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r, i) => '<tr' + (rowClass && rowClass(i) ? ' class="' + rowClass(i) + '"' : '') + '>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
  return w;
}

// A figure with its export buttons, legend, and caption. A legend item with
// an `svg` string in place of a swatch name is drawn with that symbol.
function figure(parent, opts, name, draw, legendItems, captionHtml) {
  const box = document.createElement('div');
  box.className = 'cmp-fig';
  parent.appendChild(box);
  const fig = makeFigure(box, opts);
  fig.render(draw);
  exportButtons(box, fig, name);
  const leg = document.createElement('div');
  parent.appendChild(leg);
  legend(leg, legendItems.filter(it => !it.svg));
  for (const it of legendItems.filter(x => x.svg)) {
    const sp = document.createElement('span');
    sp.innerHTML = it.svg + '<span>' + it.label + '</span>';
    leg.appendChild(sp);
  }
  if (captionHtml) parent.appendChild(para('cmp-cap', captionHtml));
  return fig;
}

// Each checked design's number, 1 to k in checklist order, as a small badge.
const badge = i => '<span class="sev-num">' + (i + 1) + '</span>';
// A design's row label: its number, then its short name when there is room
// (a long label is cut from the end, and so the number always shows).
const numLabel = (i, short) => (i + 1) + ' ' + short[i];
// A difference's row label, by number: "1 − 2".
const pairLabel = (i, j) => (i + 1) + ' − ' + (j + 1);

// A row-by-row readout that names each row in full. Installed before a mark
// helper draws, which then keeps it rather than adding its own.
function rowReadout(fig, n, linesOf) {
  fig.readout((dx, dy, px, py) => {
    const i = Math.floor(py / (fig.ih / n));
    return i >= 0 && i < n ? linesOf(i) : null;
  });
}

function clip(s, maxW, size) {
  s = String(s);
  if (s.length * size * 0.56 <= maxW) return s;
  return s.slice(0, Math.max(1, Math.floor(maxW / (size * 0.56)) - 1)) + '…';
}

/**
 * One row per design with a dot at its sample mean: filled for a survivor of
 * the screen, hollow for an eliminated design.
 * @param {Object} fig a plots.js figure
 * @param {{label: string, full?: string, value: number, keep: boolean}[]} rows
 */
function meanRows(fig, rows) {
  const fs = 11.5, n = rows.length;
  const longest = Math.max(...rows.map(r => r.label.length)) * fs * 0.56;
  const lw = Math.min(Math.floor(fig.w * (fig.narrow ? 0.34 : 0.28)), Math.ceil(longest) + 14);
  fig.setMargin({ l: lw + 8 });
  const sx = fig.x(extent(rows.map(r => r.value)), { pad: 0.08, nice: true });
  fig.axes({ y: false });
  const rowH = fig.ih / n;
  const cOk = tok('--ok'), cMuted = tok('--muted'), cCard = tok('--card'), cText = tok('--text'), cBorder = tok('--border');
  const ry = recordRows(fig, rows.map(r => r.label));
  const keep = { kind: 'points', x: [], y: [], color: cOk, label: 'survives the screen' };
  const gone = { kind: 'points', x: [], y: [], color: cMuted, hollow: true, label: 'eliminated by the screen' };
  rows.forEach((r, i) => {
    const cy = (i + 0.5) * rowH;
    svgEl('line', { x1: 0, x2: fig.iw, y1: cy, y2: cy, stroke: cBorder, 'stroke-width': 1 }, fig.inner);
    if (r.keep) svgEl('circle', { cx: sx(r.value), cy, r: 5.5, fill: cOk }, fig.inner);
    else svgEl('circle', { cx: sx(r.value), cy, r: 5, fill: cCard, stroke: cMuted, 'stroke-width': 2 }, fig.inner);
    const rec = r.keep ? keep : gone;
    rec.x.push(r.value); rec.y.push(ry(i));
    const t = svgEl('text', { x: -10, y: cy + 4, 'text-anchor': 'end', 'font-size': fs, fill: r.keep ? cText : cMuted }, fig.layers.axes);
    t.textContent = clip(r.label, lw - 6, fs);
  });
  if (keep.x.length) fig.series.push(keep);
  if (gone.x.length) fig.series.push(gone);
  fig.readout((dx, dy, px, py) => {
    const i = Math.floor(py / rowH);
    if (i < 0 || i >= n) return null;
    return [rows[i].full || rows[i].label, 'mean ' + num(rows[i].value), rows[i].keep ? 'survives the screen' : 'eliminated by the screen'];
  });
}

/**
 * Places brackets in columns so that none overlaps another: shortest span
 * first, each in the first column where it meets no bracket already there.
 * Two brackets that share an end row count as meeting, since their ticks
 * would join into one line. Longer spans therefore sit outside the shorter
 * ones they contain.
 * @param {number[][]} pairs [top row, bottom row] with top < bottom
 * @returns {{ placed: {a: number, b: number, col: number}[], cols: number }}
 */
function bracketColumns(pairs) {
  const sorted = pairs.slice().sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]) || p[0] - q[0]);
  const cols = [];
  const placed = [];
  for (const [a, b] of sorted) {
    let c = 0;
    while (cols[c] && cols[c].some(([x, y]) => a <= y && x <= b)) c++;
    (cols[c] || (cols[c] = [])).push([a, b]);
    placed.push({ a, b, col: c });
  }
  return { placed, cols: cols.length };
}

// A small bracket for the legend, drawn like the plot's own.
const bracketSwatch = c => '<svg class="lg-sv" viewBox="0 0 24 12" aria-hidden="true"><path d="M10 1.5H15V10.5H10" fill="none" stroke="' +
  c + '" stroke-width="1.6"/></svg>';

/**
 * The design-level view of the analysis of variance: one row per design in
 * the given order, each with its mean and interval, its letter group printed
 * past the right end of the plotting area, and to the right of the letters
 * one bracket per pair the rule declares different, spanning the two rows.
 * @param {Object} fig a plots.js figure
 * @param {{label: string, full: string, mean: number, lo: number, hi: number, letter: string}[]} rows
 * @param {number[][]} pairs row positions [top, bottom] of each declared pair
 */
function designRows(fig, rows, pairs) {
  const fs = 11.5, lfs = 12, n = rows.length;
  const longest = Math.max(...rows.map(r => r.label.length)) * fs * 0.56;
  const lw = Math.min(Math.floor(fig.w * (fig.narrow ? 0.3 : 0.24)), Math.ceil(longest) + 14);
  const letW = Math.max(1, ...rows.map(r => r.letter.length)) * lfs * 0.62 + 12;
  const { placed, cols } = bracketColumns(pairs);
  // The brackets share a strip of at most a fifth of the width; with many
  // columns they move closer together rather than squeezing the plot.
  const room = Math.floor(fig.w * (fig.narrow ? 0.22 : 0.18));
  const colW = cols ? Math.max(3, Math.min(9, (room - 8) / cols)) : 0;
  fig.setMargin({ l: lw + 8, r: 10 + letW + (cols ? 8 + cols * colW : 0) });
  const lo = Math.min(...rows.map(r => r.lo)), hi = Math.max(...rows.map(r => r.hi));
  const sx = fig.x([lo, hi], { pad: 0.05, nice: true });
  fig.axes({ y: false });
  const rowH = fig.ih / n;
  const cy = i => Math.round((i + 0.5) * rowH * 10) / 10;
  const cEst = tok('--est'), cBorder = tok('--border'), cText = tok('--text'), cAcc = tok('--accent'), cMiss = tok('--miss');
  // For the script exports, the letters and brackets sit inside a widened x
  // range rather than in the margin.
  const ry = recordRows(fig, rows.map(r => r.label));
  const [dx0, dx1] = sx.domain, span = dx1 - dx0;
  fig.xRange = [dx0, dx1 + span * (0.12 + 0.03 * cols)];
  const segs = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cEst, label: 'interval' };
  const means = { kind: 'points', x: [], y: [], color: cEst, label: 'mean' };
  const letters = { kind: 'text', x: [], y: [], text: [], color: cAcc, anchor: 'start' };
  rows.forEach((r, i) => {
    const y = cy(i);
    svgEl('line', { x1: 0, x2: fig.iw, y1: y, y2: y, stroke: cBorder, 'stroke-width': 1 }, fig.inner);
    const g = svgEl('g', { class: 'm-int' }, fig.inner);
    const x0 = sx(r.lo), x1 = sx(r.hi);
    svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: cEst, 'stroke-width': 2 }, g);
    for (const x of [x0, x1]) svgEl('line', { x1: x, x2: x, y1: y - 5, y2: y + 5, stroke: cEst, 'stroke-width': 2 }, g);
    svgEl('circle', { cx: sx(r.mean), cy: y, r: 4.2, fill: cEst }, g);
    const yy = ry(i);
    segs.x0.push(r.lo, r.lo, r.hi); segs.x1.push(r.hi, r.lo, r.hi); segs.y0.push(yy, yy - 0.18, yy - 0.18); segs.y1.push(yy, yy + 0.18, yy + 0.18);
    means.x.push(r.mean); means.y.push(yy);
    const t = svgEl('text', { x: -10, y: y + 4, 'text-anchor': 'end', 'font-size': fs, fill: cText }, fig.layers.axes);
    t.textContent = clip(r.label, lw - 6, fs);
    if (r.letter) {
      const lt = svgEl('text', { x: fig.iw + 10, y: y + 4, 'font-size': lfs, 'font-weight': 700, fill: cAcc, class: 'm-letter',
        'font-family': "'IBM Plex Mono', Menlo, monospace", 'letter-spacing': '0.06em' }, fig.inner);
      lt.textContent = r.letter;
      letters.x.push(dx1 + span * 0.02); letters.y.push(yy); letters.text.push(r.letter);
    }
  });
  fig.series.push(segs, means);
  if (letters.text.length) fig.series.push(letters);
  const x0 = fig.iw + 10 + letW + 6;
  const tick = Math.max(2, Math.min(5, colW - 1.5));
  const brackets = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cMiss, label: 'declared different' };
  for (const p of placed) {
    const x = x0 + p.col * colW + tick;
    const ya = cy(p.a), yb = cy(p.b);
    svgEl('path', { d: 'M' + (x - tick) + ' ' + ya + 'H' + x + 'V' + yb + 'H' + (x - tick), fill: 'none', stroke: cMiss, 'stroke-width': 1.6, class: 'm-bracket' }, fig.inner);
    const bx = dx1 + span * (0.11 + 0.03 * p.col), bt = span * 0.012, ra = ry(p.a), rb = ry(p.b);
    brackets.x0.push(bx - bt, bx, bx); brackets.x1.push(bx, bx, bx - bt); brackets.y0.push(ra, ra, rb); brackets.y1.push(ra, rb, rb);
  }
  if (placed.length) fig.series.push(brackets);
  fig.readout((dx, dy, px, py) => {
    const i = Math.floor(py / rowH);
    if (i < 0 || i >= n) return null;
    const r = rows[i];
    return [r.full, 'mean ' + num(r.mean), 'interval ' + interval(r.lo, r.hi)];
  });
}

// ── How many replications ─────────────────────────────────────────────────
// The planning card has one pane per mode, by half-width and by power. Both
// are filled on every redraw and stacked in one grid cell, the inactive one
// hidden but still laid out, and so switching the mode never moves the page.

const PLAN_POWERS = [0.8, 0.9, 0.95];
const PLAN_N = '<span class="sym">n</span> needed';
const PLAN_HW = 'Half-width at that <span class="sym">n</span>';
const PLAN_PW = 'Power at that <span class="sym">n</span>';
const PLAN_ADD = 'Additional replications';
const PLAN_CUR = 'Power at the current R';
const PLAN_HEADERS = ['mode', 'target', 'n needed', 'half-width or power at n', 'additional replications'];
const PLAN_WHY =
  '<p>A half-width target sets how precisely a mean, or a difference of means, is estimated. A power target sets how reliably a shift of a given size would be detected by a two-sided test at α = 1 − the confidence level.</p>' +
  '<p>Both scale with s²/n: the half-width is proportional to s/√n, and the power depends on the shift δ only through δ√n/s. That is why four times the replications halve the half-width, and why a shift half as large needs about four times the replications to be detected with the same power.</p>';
const PLAN_OUT = '<p class="plan-head"></p><div class="plan-cards"></div><p class="plan-note"></p>';

// The card's markup: its heading, the mode switch, and the two panes, each
// with its own controls above the shared outputs.
function planMarkup(p, hwControls, powerControlsHtml) {
  return '<div class="sec-hd">How many replications</div>' +
    '<div class="ctrl-row plan-mode-row"><span class="ctrl-lbl" id="' + p + '-plan-lbl">Set the number</span>' +
      '<span class="seg" role="group" aria-labelledby="' + p + '-plan-lbl">' +
        '<button type="button" class="seg-btn" data-plan="hw" aria-pressed="true">by half-width</button>' +
        '<button type="button" class="seg-btn" data-plan="power" aria-pressed="false">by power</button>' +
      '</span></div>' +
    '<div class="plan-stack">' +
      '<div class="plan-pane" data-pane="hw">' + hwControls + PLAN_OUT + '</div>' +
      '<div class="plan-pane" data-pane="power">' + powerControlsHtml + PLAN_OUT + '</div>' +
    '</div>';
}

// The power pane's controls: the shift δ (its field is made by syncSpin)
// and the target power.
function powerControls(p, label, tip) {
  return '<div class="ctrl-row">' +
    '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="' + tip + '">' + label + '</span></span>' +
      '<span class="plan-delta-host"></span><span class="ctrl-note plan-delta-unit"></span></span>' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="' + p + '-plan-pow">Target power</label><select id="' + p + '-plan-pow">' +
      PLAN_POWERS.map(v => '<option value="' + v + '"' + (v === 0.8 ? ' selected' : '') + '>' + powerPct(v) + '</option>').join('') +
    '</select></span>' +
  '</div>';
}

function powerPct(v) {
  if (!Number.isFinite(v)) return dash;
  return v > 0.999 ? '> 99.9%' : num(100 * v, 3) + '%';
}

// A spinner step of one tenth of the leading digit of v.
function stepFor(v) {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  return Number(Math.pow(10, Math.floor(Math.log10(v)) - 1).toPrecision(1));
}

// A positive spinner in `host`, kept in `slot` and rebuilt only when its step
// changes, because a spinner's step is fixed when it is made. A null value
// leaves the field empty and disabled.
function syncSpin(slot, host, inputId, label, step, value, onChange) {
  if (!slot.spin || slot.step !== step) {
    host.innerHTML = '';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = inputId;
    inp.className = 'par-inp';
    inp.setAttribute('aria-label', label);
    inp.value = String(value != null ? value : step);
    host.appendChild(inp);
    slot.spin = spinner(inp, { min: step, max: 1e12, step, onChange });
    slot.step = step;
  }
  const inp = slot.spin.wrap.querySelector('input');
  if (value == null) { inp.disabled = true; inp.value = ''; }
  else { inp.disabled = false; slot.spin.set(value, false); }
}

// The pane's cards: n needed, the half-width or the power at that n, the
// additional replications beyond the current count, and, by power, the power
// the current count already gives. A null n draws en dashes.
function planCards(kind, o) {
  const has = o.n != null;
  const cards = [
    card(PLAN_N, has ? intl(o.n) : dash, o.nNote),
    kind === 'hw' ? card(PLAN_HW, has ? num(o.at) : dash, o.atNote) : card(PLAN_PW, has ? powerPct(o.at) : dash, o.atNote)
  ];
  const add = has && Number.isFinite(o.R) ? o.n - o.R : NaN;
  cards.push(Number.isFinite(add) && add <= 0
    ? card(PLAN_ADD, 'none', o.rText + ' already suffices')
    : card(PLAN_ADD, Number.isFinite(add) ? intl(add) : dash, (o.perDesign ? 'per design beyond ' : 'beyond ') + o.rText));
  if (kind === 'power') cards.push(card(PLAN_CUR, powerPct(o.cur), o.curNote));
  return cards;
}

function fillPane(pane, headHtml, cards, noteHtml) {
  pane.querySelector('.plan-head').innerHTML = headHtml;
  pane.querySelector('.plan-cards').replaceChildren(cardRow(cards));
  pane.querySelector('.plan-note').innerHTML = noteHtml;
}

function syncPlanMode(sec, mode) {
  sec.querySelectorAll('[data-plan]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.plan === mode)));
  sec.querySelectorAll('.plan-pane').forEach(p => {
    const off = p.dataset.pane !== mode;
    p.classList.toggle('is-off', off);
    p.inert = off;
  });
}

// One row of the Planning table, offered by the export row and the Report page.
function planRow(mode, target, n, at, R) {
  const has = n != null;
  return [mode, target, has ? n : '', has ? at : '', has ? Math.max(0, n - R) : ''];
}

// ── State of the controls ─────────────────────────────────────────────────

function checkedList() {
  const ids = checklist ? checklist.selected() : [];
  return ids.map(i => state.get(i)).filter(d => d && canInfer(d).ok);
}

function pooledSd(groups) {
  const a = anova(groups);
  return Math.sqrt(a.msw);
}

function defaultEps(groups) {
  const sp = pooledSd(groups);
  return Number.isFinite(sp) && sp > 0 ? Number((0.1 * sp).toPrecision(2)) : NaN;
}

// Rebuilds the ε field with a step suited to the data's scale: one tenth of
// the leading digit of the default value.
function ensureEpsSpinner(step) {
  if (epsSpin && step === epsStep) return;
  epsStep = step;
  const host = rootEl.querySelector('#sev-eps-host');
  host.innerHTML = '<input id="sev-eps" type="text" class="par-inp" aria-label="Indifference zone ε">';
  const inp = host.querySelector('#sev-eps');
  inp.value = '0';
  epsSpin = spinner(inp, { min: step, step, onChange: v => { epsUser = v; state.setPick(id, 'eps', v); schedule(); } });
}

function syncControls(list, groups) {
  rootEl.querySelectorAll('[data-dir]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dir === dir)));
  rootEl.querySelectorAll('[data-diff]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diff === diffMode)));
  const rs = rootEl.querySelector('#sev-rule');
  if (rs.value !== rule) rs.value = rule;

  // The control picker offers the checked designs.
  if (!list.some(d => d.id === controlId)) controlId = list.length ? list[0].id : null;
  const short = shortNames(list);
  ctrlSel.innerHTML = list.length
    ? list.map((d, i) => '<option value="' + esc(d.id) + '">' + esc(short[i]) + '</option>').join('')
    : '<option value="">Check two or more designs</option>';
  ctrlSel.value = controlId || '';
  ctrlSel.disabled = !list.length;

  // The indifference zone, its units, and where its default comes from.
  const note = rootEl.querySelector('#sev-eps-note');
  const reset = rootEl.querySelector('#sev-eps-reset');
  const def = list.length >= 2 ? defaultEps(groups) : NaN;
  if (Number.isFinite(def)) {
    ensureEpsSpinner(Math.pow(10, Math.floor(Math.log10(def)) - 1));
    epsSpin.set(epsUser === null ? def : epsUser, false);
    const responses = Array.from(new Set(list.map(d => d.response)));
    const unitTxt = responses.length === 1 ? 'in the units of ' + esc(responses[0]) : 'in the units of the response';
    note.innerHTML = unitTxt + '; ' + (epsUser === null
      ? 'the default is 10% of the pooled standard deviation, ' + num(pooledSd(groups), 3)
      : 'the default would be ' + num(def) + ', 10% of the pooled standard deviation');
    reset.style.display = epsUser === null ? 'none' : '';
    epsSpin.wrap.querySelector('input').disabled = false;
  } else {
    ensureEpsSpinner(epsStep || 0.01);
    note.textContent = 'set once two or more designs are checked';
    reset.style.display = 'none';
    const inp = epsSpin.wrap.querySelector('input');
    inp.disabled = true;
    inp.value = '';
  }
}

// Puts each checked design's number before its name in the checklist; an
// unchecked design shows none.
function numberChecklist(list) {
  const pos = new Map(list.map((d, i) => [d.id, i]));
  rootEl.querySelectorAll('#sev-list .ds-chk').forEach(lab => {
    const old = lab.querySelector('.sev-num');
    if (old) old.remove();
    const cb = lab.querySelector('input');
    const nameEl = lab.querySelector('.ds-chk-name');
    if (cb && nameEl && pos.has(cb.value)) nameEl.insertAdjacentHTML('beforebegin', badge(pos.get(cb.value)));
  });
}

function showExcluded() {
  const box = rootEl.querySelector('#sev-excluded');
  box.innerHTML = '';
  const out = state.datasets.filter(d => !canInfer(d).ok);
  if (!out.length) return;
  const items = out.map(d => '<b>' + esc(d.name) + '</b>: ' + esc(canInfer(d).reason)).join('<br>');
  box.appendChild(notice('warn', (out.length === 1 ? 'One dataset is' : out.length + ' datasets are') +
    ' not offered here, because a comparison needs at least two replication estimates per design.<br>' + items));
}

function schedule() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => { pending = false; update(); });
}

// ── Rendering ─────────────────────────────────────────────────────────────

function update() {
  if (!rootEl) return;
  const list = checkedList();
  const groups = list.map(finiteOf);
  syncControls(list, groups);
  showExcluded();
  const level = state.settings.level, alpha = 1 - level;
  const k = list.length;
  const short = shortNames(list);
  const unit = rootEl.querySelector('#sev-unit');
  const bodies = ['means', 'diffs', 'anova', 'subset', 'posthoc'].map(n => rootEl.querySelector('#sev-' + n + '-body'));
  bodies.forEach(b => { b.innerHTML = ''; });

  numberChecklist(list);
  const key = rootEl.querySelector('#sev-key');
  key.innerHTML = list.map((d, i) => '<span class="sev-key-it">' + badge(i) + ' ' + esc(d.name) + '</span>').join(' ');
  if (k < 2) {
    unit.innerHTML = '<span class="unit-lbl">Experimental unit:</span> check two or more designs above.';
    const msg = k === 1 ? 'One design is checked. Check at least one more to compare.' : 'Check two or more designs above to compare them.';
    bodies.slice(0, 4).forEach(b => b.appendChild(para('muted-line cmp-empty', msg)));
    resultBase = null;
    planCtx = { msg: 'Check two or more designs above to plan replications.' };
    drawPlan();
    return;
  }
  const ns = groups.map(g => g.length);
  const kw = list.every(d => d.kind === 'reps') ? 'replication values' : list.every(d => d.kind === 'time') ? 'time-weighted replication means' : 'replication estimates';
  unit.innerHTML = '<span class="unit-lbl">Experimental unit:</span> ' + (ns.every(n => n === ns[0])
    ? 'R = ' + intl(ns[0]) + ' ' + kw + ' for each of the ' + k + ' designs'
    : 'R = ' + ns.map(intl).join(', ') + ' ' + kw + ' for ' + esc(short.join(', ')) + ', in that order');

  const responses = Array.from(new Set(list.map(d => d.response)));
  const mixed = rootEl.querySelector('#sev-mixed');
  mixed.innerHTML = '';
  if (responses.length > 1) {
    mixed.appendChild(notice('warn', 'The checked datasets report different responses (' + esc(responses.join(', ')) +
      '). Every comparison below treats them as one response on one axis, which only makes sense when they measure the same quantity in the same units.'));
  }

  const ctrlIdx = Math.max(0, list.findIndex(d => d.id === controlId));
  const L = levelPct(level), aTxt = num(alpha, 2);
  const tables = [];
  const summary = [];

  // Means with simultaneous intervals.
  const sm = simultaneousMeans(groups, level);
  {
    const b = bodies[0];
    b.appendChild(para('cmp-lead', 'k = ' + k + ' intervals, each at 1 − ' + aTxt + '/' + k + ' = ' + levelPct(sm.perLevel) +
      ', and so ' + allOf(k) + ' hold at once with probability at least ' + L + ' (Bonferroni).'));
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Mean of ' + list[0].response }, 'several-means',
      fg => {
        rowReadout(fg, k, i => [list[i].name, num(sm.items[i].mean) + '  ' + interval(sm.items[i].lo, sm.items[i].hi)]);
        intervals(fg, sm.items.map((it, i) => ({ label: numLabel(i, short), lo: it.lo, hi: it.hi, center: it.mean })), { rowPx: 30 });
      },
      [{ swatch: 'interval', color: '--est', label: 'design mean with its ' + levelPct(sm.perLevel) + ' t interval' }],
      'Each design’s mean with its own t interval at ' + levelPct(sm.perLevel) + '. Together the ' + k +
      ' intervals cover ' + allOf(k) + ' true means with probability at least ' + L + '; one interval alone is wider than an ordinary ' + L + ' interval would be.');
    const rows = sm.items.map((it, i) => [badge(i) + ' ' + esc(short[i]), intl(it.n), num(it.mean), num(it.sd), num(it.se), intl(it.df), interval(it.lo, it.hi)]);
    b.appendChild(table(['Design', 'R', 'Mean', 'SD', 'SE', 'df', levelPct(sm.perLevel) + ' interval'], rows));
    tables.push({ name: 'Means with simultaneous intervals', headers: ['design', 'R', 'mean', 'sd', 'se', 'df', 'per-interval level', 'lower', 'upper'],
      rows: sm.items.map((it, i) => [list[i].name, it.n, it.mean, it.sd, it.se, it.df, sm.perLevel, it.lo, it.hi]) });
  }

  // Bonferroni family of differences.
  const fam = bonferroniFamily(groups, { mode: diffMode, control: ctrlIdx, level });
  {
    const b = bodies[1];
    b.appendChild(para('cmp-banner', 'C = ' + fam.C + ' comparison' + (fam.C === 1 ? '' : 's') + ', each at 1 − α/C = ' + levelPct(fam.perLevel)));
    if (diffMode === 'control') b.appendChild(para('cmp-lead', 'Each design against the control, ' + esc(short[ctrlIdx]) + '.'));
    const lab = c => pairLabel(c.i, c.j);
    const full = c => list[c.i].name + ' − ' + list[c.j].name;
    const anyFlag = fam.comparisons.some(c => c.flagged), anyPlain = fam.comparisons.some(c => !c.flagged);
    const legItems = [];
    if (anyPlain) legItems.push({ swatch: 'interval', color: '--est', label: 'Welch interval at ' + levelPct(fam.perLevel) + ', contains 0' });
    if (anyFlag) legItems.push({ swatch: 'flagged', color: '--miss', label: 'Welch interval at ' + levelPct(fam.perLevel) + ', excludes 0' });
    legItems.push({ swatch: 'dash', color: '--truth', label: 'zero difference' });
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Difference in means of ' + list[0].response }, 'several-differences',
      fg => {
        const cs = fam.comparisons;
        rowReadout(fg, cs.length, i => [full(cs[i]), num(cs[i].diff) + '  ' + interval(cs[i].lo, cs[i].hi), cs[i].flagged ? 'excludes 0' : 'contains 0']);
        intervals(fg, cs.map(c => ({ label: lab(c), lo: c.lo, hi: c.hi, center: c.diff, flagged: c.flagged })), { ref: 0, rowPx: 28 });
      },
      legItems,
      'Each row is one difference of means with its Welch interval at ' + levelPct(fam.perLevel) + '. A red dashed row excludes 0, and so that pair is declared different with the family-wise error rate held at ' + aTxt + ' or below.');
    const rows = fam.comparisons.map(c => ['<span class="sev-pair">' + esc(lab(c)) + '</span>', '<span class="sev-full">' + esc(full(c)) + '</span>', num(c.diff), num(c.se), num(c.df), interval(c.lo, c.hi), num(c.t), pValue(c.p), pValue(c.pAdj),
      c.flagged ? '<span class="cmp-flag">excludes 0</span>' : 'contains 0']);
    b.appendChild(table(['Pair', 'Designs', 'Difference', 'SE', 'df', 'Interval', 't', 'p', 'Adjusted p', 'Flag'], rows));
    b.appendChild(para('exp-note', 'Bonferroni holds the family-wise error rate at or below α = ' + aTxt + ' and is conservative: its true error rate is usually lower, and its intervals are wider than they need to be. ' +
      'The adjusted p is C·p capped at 1. Tukey’s procedure (all pairs) and Dunnett’s (versus a control) are less conservative and are offered in the analysis of variance below.'));
    tables.push({ name: 'Bonferroni differences', headers: ['pair', 'difference', 'se', 'df', 'lower', 'upper', 't', 'p', 'adjusted p', 'flag'],
      rows: fam.comparisons.map(c => [list[c.i].name + ' - ' + list[c.j].name, c.diff, c.se, c.df, c.lo, c.hi, c.t, c.p, c.pAdj, c.flagged ? 'excludes 0' : 'contains 0']) });
    const nf = fam.comparisons.filter(c => c.flagged).length;
    summary.push('Bonferroni (' + (diffMode === 'pairs' ? 'all pairs' : 'versus ' + esc(short[ctrlIdx])) + ', C = ' + fam.C + '): ' + plural(nf, 'difference excludes', 'differences exclude') + ' 0.');
  }

  // ANOVA and post-hoc.
  const ph = posthoc(groups, { rule, alpha, control: ctrlIdx });
  const av = ph.anova;
  {
    let b = bodies[2];
    const atab = table(['Source', 'SS', 'df', 'MS', 'F', 'p'], [
      ['Between designs', num(av.ssb), intl(av.dfb), num(av.msb), num(av.F), pValue(av.p)],
      ['Within designs', num(av.ssw), intl(av.dfw), num(av.msw), '', ''],
      ['Total', num(av.sst), intl(av.dfb + av.dfw), '', '', '']
    ]);
    b.appendChild(atab);
    const rejects = av.p < alpha;
    b.appendChild(para('cmp-verdict', 'F = ' + num(av.F) + ' on ' + av.dfb + ' and ' + av.dfw + ' degrees of freedom, p = ' + pValue(av.p) + ': ' +
      (rejects ? 'the means are not all equal at this level.' : 'insufficient evidence of a difference among the means at this level.')));
    b = bodies[4];
    let critTxt;
    if (rule === 'tukey') critTxt = 'Tukey–Kramer: the studentized range quantile is q = ' + num(ph.crit) + ' (k = ' + k + ', ' + av.dfw + ' df), and each pair’s critical difference is q·SE/√2.';
    else if (rule === 'lsd') critTxt = 'Fisher’s LSD: t = ' + num(ph.crit) + ' at 1 − α/2 on ' + av.dfw + ' df, and each pair’s critical difference is t·SE.';
    else if (rule === 'bonferroni') critTxt = 'Bonferroni: t = ' + num(ph.crit) + ' at 1 − α/(2C) with C = ' + ph.pairs.length + ' on ' + av.dfw + ' df, and each pair’s critical difference is t·SE.';
    else critTxt = 'Dunnett: each design against the control, ' + esc(short[ctrlIdx]) + ', with the two-sided critical value d = ' + num(ph.crit) + ' on ' + av.dfw + ' df; each pair’s critical difference is d·SE.';
    b.appendChild(para('cmp-lead', critTxt + ' SE = √(MSW (1/R<sub>i</sub> + 1/R<sub>j</sub>)) uses the pooled mean square within.'));
    if (rule === 'lsd' && ph.protected === false) b.appendChild(notice('warn', esc(ph.note)));
    else b.appendChild(para('exp-note', esc(ph.note)));
    const lab = p => pairLabel(p.i, p.j);
    const full = p => list[p.i].name + ' − ' + list[p.j].name;
    const anyFlag = ph.pairs.some(p => p.flagged), anyPlain = ph.pairs.some(p => !p.flagged);
    // Tukey, Bonferroni, and Dunnett do not wait for the F test, and near the
    // boundary they can flag a pair the F test did not detect.
    if (!rejects && anyFlag) b.appendChild(para('exp-note', 'The F test and this rule ask different questions: F asks whether any of the means differ, and ' + RULES[rule] + ' asks about each pair on its own, without waiting for F. Near the boundary the two can disagree, as they do here.'));

    // The designs themselves, best first, with their letter groups and a
    // bracket for every pair the rule declares different.
    {
      const order = list.map((_, i) => i).sort((x, y) => dir === 'min' ? sm.items[x].mean - sm.items[y].mean : sm.items[y].mean - sm.items[x].mean);
      const pos = [];
      order.forEach((i, r) => { pos[i] = r; });
      const letterOf = i => (ph.letters ? ph.letters[i] : i === ctrlIdx ? 'control' : '');
      const rowsD = order.map(i => ({ label: numLabel(i, short), full: list[i].name, mean: sm.items[i].mean, lo: sm.items[i].lo, hi: sm.items[i].hi, letter: letterOf(i) }));
      const pairsD = ph.pairs.filter(p => p.flagged).map(p => [Math.min(pos[p.i], pos[p.j]), Math.max(pos[p.i], pos[p.j])]);
      b.appendChild(para('sev-fig-title', 'Designs, best first, with letter groups and the pairs declared different'));
      const legD = [{ swatch: 'interval', color: '--est', label: 'design mean with its simultaneous interval' }];
      if (pairsD.length) legD.push({ svg: bracketSwatch(tok('--miss')), label: 'pairs declared different by the rule (bracket)' });
      figure(b, { height: 8 + 40 + k * 30, narrowHeight: 8 + 40 + k * 32, margin: { t: 8, b: 40 }, xLabel: 'Mean of ' + list[0].response }, 'several-design-groups',
        fg => designRows(fg, rowsD, pairsD), legD,
        (ph.letters
          ? 'Designs that share a letter are not declared different; a bracket joins a pair that is.'
          : 'Dunnett’s procedure compares each design with the control only, and so it gives no letters; a bracket joins a design to the control when the pair is declared different.') +
        ' Each interval is the ' + levelPct(sm.perLevel) + ' simultaneous interval from the Means section, and the rows run from the ' + (dir === 'min' ? 'smallest' : 'largest') + ' mean down.');
    }

    const legItems = [];
    if (anyPlain) legItems.push({ swatch: 'interval', color: '--est', label: 'not declared different' });
    if (anyFlag) legItems.push({ swatch: 'flagged', color: '--miss', label: 'declared different' });
    legItems.push({ swatch: 'dash', color: '--truth', label: 'zero difference' });
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Difference in means of ' + list[0].response }, 'several-posthoc',
      fg => {
        const ps = ph.pairs;
        rowReadout(fg, ps.length, i => [full(ps[i]), num(ps[i].diff) + '  ' + interval(ps[i].lo, ps[i].hi), ps[i].flagged ? 'declared different' : 'not declared different']);
        intervals(fg, ps.map(p => ({ label: lab(p), lo: p.lo, hi: p.hi, center: p.diff, flagged: p.flagged })), { ref: 0, rowPx: 28 });
      },
      legItems,
      'Each row is a difference of means ± its critical difference under ' + RULES[rule] + '. ' +
      (rule === 'lsd' && ph.protected === false ? 'Because the F test did not reject, no pair is declared different, even where an interval excludes 0. ' : 'A red dashed row is a pair the rule declares different. ') +
      'These procedures assume normal replication estimates with equal variances across designs; when the variances clearly differ, the Welch intervals above are the safer choice.');
    const rows = ph.pairs.map(p => ['<span class="sev-pair">' + esc(lab(p)) + '</span>', '<span class="sev-full">' + esc(full(p)) + '</span>', num(p.diff), num(p.se), num(p.hw), interval(p.lo, p.hi), p.flagged ? '<span class="cmp-flag">yes</span>' : 'no']);
    b.appendChild(table(['Pair', 'Designs', 'Difference', 'SE', 'Critical difference', 'Interval', 'Different?'], rows));
    tables.push({ name: 'ANOVA', headers: ['source', 'SS', 'df', 'MS', 'F', 'p'], rows: [
      ['between designs', av.ssb, av.dfb, av.msb, av.F, av.p], ['within designs', av.ssw, av.dfw, av.msw, '', ''], ['total', av.sst, av.dfb + av.dfw, '', '', '']] });
    tables.push({ name: 'Post-hoc: ' + RULES[rule], headers: ['pair', 'difference', 'se', 'critical value', 'critical difference', 'lower', 'upper', 'different'],
      rows: ph.pairs.map(p => [list[p.i].name + ' - ' + list[p.j].name, p.diff, p.se, ph.crit, p.hw, p.lo, p.hi, p.flagged ? 'yes' : 'no']) });
    if (ph.letters) {
      const order = list.map((_, i) => i).sort((x, y) => dir === 'min' ? av.means[x] - av.means[y] : av.means[y] - av.means[x]);
      b.appendChild(para('cmp-lead', 'Compact letter display, best mean first (' + (dir === 'min' ? 'smaller' : 'bigger') + ' is better). Designs that share a letter are not declared different under this rule.'));
      const lt = table(['Design', 'Mean', 'Letters'], order.map(i => [badge(i) + ' ' + esc(short[i]), num(av.means[i]), '<span class="cmp-letters">' + esc(ph.letters[i]) + '</span>']));
      lt.classList.add('cmp-letter-tab');
      b.appendChild(lt);
      tables.push({ name: 'Compact letter display: ' + RULES[rule], headers: ['design', 'mean', 'letters'], rows: order.map(i => [list[i].name, av.means[i], ph.letters[i]]) });
    } else {
      b.appendChild(para('cmp-lead', 'Dunnett’s procedure compares each design with the control, ' + esc(short[ctrlIdx]) + ', and not with each other, and so it has no letter display.'));
    }
    summary.push('ANOVA: F = ' + num(av.F) + ', p = ' + pValue(av.p) + '. ' + RULES[rule] + ': ' +
      plural(ph.pairs.filter(p => p.flagged).length, 'pair', 'pairs') + ' declared different.');
  }

  // Best subset.
  const eps = epsSpin ? epsSpin.get() : NaN;
  const ss = subsetSelection(groups, { alpha, delta: eps, dir });
  {
    const b = bodies[3];
    b.appendChild(para('cmp-lead', 'Confidence 1 − α is split evenly between the screen and the second-stage sizing: the screen runs at 1 − α/2 = ' + levelPct(1 - alpha / 2) +
      ' and the sizing at ' + levelPct(1 - alpha / 2) + ', and so the whole procedure holds at ' + L + ' or more. The indifference zone is ε = ' + num(eps) + '.'));
    if (!ss.ok) {
      b.appendChild(notice('warn', esc(ss.reason)));
    } else {
      const best = short[ss.best];
      const nSurv = ss.survivors.filter(Boolean).length;
      const verdict = nSurv === 1
        ? 'Design ' + short[ss.survivors.indexOf(true)] + ' is selected as the best within ε at this confidence.'
        : 'These designs cannot be distinguished from the best within ε on this data: ' + short.filter((_, i) => ss.survivors[i]).join(', ') +
          '. Running the additional replications listed would let a second stage choose among them.';
      b.appendChild(para('cmp-verdict', esc(verdict)));
      figure(b, { height: 8 + 40 + k * 30, narrowHeight: 8 + 40 + k * 32, margin: { t: 8, b: 40 }, xLabel: 'Mean of ' + list[0].response }, 'several-best-subset',
        fg => meanRows(fg, list.map((d, i) => ({ label: numLabel(i, short), full: d.name, value: ss.means[i], keep: ss.survivors[i] }))),
        [nSurv ? { swatch: 'dot', color: '--ok', label: 'survives the screen' } : null,
          nSurv < k ? { swatch: 'hollow', color: '--muted', label: 'eliminated by the screen' } : null].filter(Boolean),
        'Each design’s sample mean; the best sample mean is ' + esc(best) + ' (' + (dir === 'min' ? 'smallest' : 'largest') + '). A design is eliminated when another design’s mean beats it by more than the screen’s allowance.');
      const rows = list.map((_, i) => [badge(i) + ' ' + esc(short[i]), intl(ss.n[i]), num(ss.means[i]), num(Math.sqrt(ss.s2[i])),
        ss.survivors[i] ? '<span class="cmp-ok">yes</span>' : 'no', ss.N[i] === null ? dash : intl(ss.N[i]), ss.additional[i] === null ? dash : intl(ss.additional[i])]);
      b.appendChild(table(['Design', 'R', 'Mean', 's', 'Survives?', 'N needed', 'Additional replications'], rows, i => (ss.survivors[i] ? '' : 'cmp-mute')));
      b.appendChild(para('exp-note', 'N is the total number of replications Rinott’s second stage needs for each survivor, max(R, ⌈(h·s/ε)²⌉) with h = ' + num(ss.h) +
        '; the screen’s t = ' + num(ss.t) + '. A smaller ε asks for more replications, in proportion to 1/ε².'));
      tables.push({ name: 'Best subset', headers: ['design', 'R', 'mean', 's', 'survives', 'N needed', 'additional replications'],
        rows: list.map((d, i) => [d.name, ss.n[i], ss.means[i], Math.sqrt(ss.s2[i]), ss.survivors[i] ? 'yes' : 'no', ss.N[i] === null ? '' : ss.N[i], ss.additional[i] === null ? '' : ss.additional[i]]) });
      summary.push(verdict);
    }
  }

  const units = Array.from(new Set(list.map(d => d.unit || '')));
  planCtx = { key: list.map(d => d.id).join('|'), k, ns, short, ctrlIdx, unit: units.length === 1 ? units[0] : '',
              sds: sm.items.map(it => it.sd), widest: Math.max(...fam.comparisons.map(c => c.hw)),
              sigma: Math.sqrt(av.msw), grandMean: av.grandMean };
  registerTips(rootEl);
  resultBase = {
    title: 'Several Systems',
    provenance: {
      datasets: list.map(d => d.name).join('; '),
      'confidence level': pct(level, 0),
      direction: dir === 'min' ? 'smaller is better' : 'bigger is better',
      'comparisons adjusted for': fam.C,
      'difference family': diffMode === 'pairs' ? 'all pairs' : 'versus control',
      'post-hoc rule': RULES[rule],
      control: list[ctrlIdx].name,
      'indifference zone': Number.isFinite(eps) ? eps : ''
    },
    tables,
    summaryHtml: summary.map(s => '<p>' + s + '</p>').join('')
  };
  drawPlan();
}

// Redraws the planning card from the context update() left, and registers
// the page's result with its planning table.
function drawPlan() {
  if (!rootEl) return;
  const sec = rootEl.querySelector('#sev-plan');
  syncPlanMode(sec, plan.mode);
  const c = planCtx && !planCtx.msg ? planCtx : null;
  const msg = planCtx && planCtx.msg ? planCtx.msg : 'Check two or more designs above to plan replications.';
  if (c && c.key !== plan.key) { plan.key = c.key; plan.hwUser = storedTarget('target', c.key); plan.deltaUser = storedTarget('delta', c.key); }
  const level = state.settings.level, alpha = 1 - level;
  const unit = c && c.unit ? ' ' + c.unit : '';
  const unitNote = c && c.unit ? c.unit : 'in the response’s units';
  // Additional replications are counted beyond the largest current count,
  // and the power at the current count uses the smallest.
  const R = c ? Math.max(...c.ns) : NaN, Rlo = c ? Math.min(...c.ns) : NaN;
  const same = !c || R === Rlo;
  const rText = same ? 'the current R\u00a0=\u00a0' + intl(R) : 'the largest current R\u00a0=\u00a0' + intl(R);
  const equalNote = ', with equal replications in each design';
  const rows = [];

  // By half-width, on the Bonferroni differences of the current mode.
  const C = c ? (diffMode === 'control' ? c.k - 1 : c.k * (c.k - 1) / 2) : NaN;
  const family = diffMode === 'control'
    ? 'each design against the control' + (c ? ', ' + c.short[c.ctrlIdx] : '')
    : 'all pairs';
  const hwDef = c ? round2(c.widest / 2) : NaN;
  const hwVal = c ? (plan.hwUser != null ? plan.hwUser : hwDef) : null;
  syncSpin(plan.hwSlot, sec.querySelector('.plan-hw-host'), 'sev-plan-hw', 'Target half-width', stepFor(hwDef), hwVal,
    v => { plan.hwUser = v; if (plan.key) state.setPick(id, 'target:' + plan.key, v); drawPlan(); });
  sec.querySelector('.plan-hw-unit').textContent = unitNote;
  sec.querySelector('.plan-hw-def').textContent = 'The default' + (c ? ', ' + num(hwDef) + ',' : '') +
    ' is half the widest current half-width; halving a half-width takes about four times the replications.';
  let hp = { n: null, hwAtN: NaN, pair: [] }, hwNote = esc(msg);
  if (c) {
    hp = planHalfWidthBonferroni({ sds: c.sds, level, mode: diffMode, control: c.ctrlIdx, target: hwVal });
    const sMin = Math.min(...c.sds), sMax = Math.max(...c.sds);
    hwNote = hp.n != null
      ? 'An estimate conditional on the current sample standard deviations of the ' + word(c.k) + ' designs, from ' + num(sMin) + ' to ' + num(sMax) +
        ', not a guarantee; a larger pilot can move it either way.'
      : esc(hp.reason);
  }
  const hText = 'h = ' + num(c ? hwVal : NaN) + unit;
  const widestPair = hp.n != null ? esc(c.short[hp.pair[0]] + ' − ' + c.short[hp.pair[1]]) : dash;
  fillPane(sec.querySelector('[data-pane="hw"]'),
    'Replications per design needed for a half-width of ' + esc(hText) + ' on every one of the C = ' + (c ? intl(C) : dash) +
      ' Bonferroni differences (' + esc(family) + ')' + equalNote,
    planCards('hw', { n: hp.n, at: hp.hwAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'widest: ' + widestPair }), hwNote);
  if (c) rows.push(planRow('by half-width', hText + ' on ' + family + ' (C = ' + C + ')', hp.n, hp.hwAtN, R));

  // By power: the one-way ANOVA F test with one design shifted by δ.
  const g = c ? Math.abs(c.grandMean) : NaN;
  const dDef = c ? (g > 0 ? round2(0.1 * g) : round2(0.25 * c.sigma)) : NaN;
  const delta = c ? (plan.deltaUser != null ? plan.deltaUser : dDef) : null;
  syncSpin(plan.deltaSlot, sec.querySelector('.plan-delta-host'), 'sev-plan-delta', 'Shift to detect δ', stepFor(dDef), delta,
    v => { plan.deltaUser = v; if (plan.key) state.setPick(id, 'delta:' + plan.key, v); drawPlan(); });
  sec.querySelector('.plan-delta-unit').textContent = unitNote;
  let pp = { n: null, powerAtN: NaN }, cur = NaN, pwNote = esc(msg);
  if (c) {
    pp = planPowerAnova({ k: c.k, sigma: c.sigma, delta, alpha, power: plan.power });
    cur = c.sigma > 0 ? powerAnova({ n: Rlo, k: c.k, sigma: c.sigma, delta, alpha }) : NaN;
    pwNote = pp.n != null
      ? 'This is the F test’s power when one design is shifted by δ and the others share a mean; the second-stage counts in the Best subset card are a third way to set replications, by selection. ' +
        'An estimate conditional on the current pooled sample standard deviation, √MSW = ' + num(c.sigma) + ', not a guarantee; a larger pilot can move it either way.'
      : esc(pp.reason);
  }
  const dText = 'δ = ' + num(c ? delta : NaN) + unit;
  fillPane(sec.querySelector('[data-pane="power"]'),
    'Replications per design needed to detect one design shifted by ' + esc(dText) + ' from the others with ' + powerPct(plan.power) +
      ' power, by the one-way ANOVA F test at α = ' + num(alpha) + equalNote,
    planCards('power', { n: pp.n, at: pp.powerAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'at ' + esc(dText), cur,
      curNote: same ? 'at R\u00a0=\u00a0' + intl(Rlo) + ' per design' : 'at the smallest current R\u00a0=\u00a0' + intl(Rlo) }), pwNote);
  if (c) rows.push(planRow('by power', dText + ', ' + powerPct(plan.power) + ' power, α = ' + num(alpha), pp.n, pp.powerAtN, R));

  if (!resultBase) { state.setResult('several', null); return; }
  const prov = Object.assign({}, resultBase.provenance, {
    'planning mode shown': plan.mode === 'hw' ? 'by half-width' : 'by power',
    'planning replications': 'equal per design',
    'planning half-width target': hText,
    'planning comparisons': family + ', C = ' + C,
    'planning shift to detect': dText,
    'planning target power': powerPct(plan.power),
    'planning significance level': num(alpha)
  });
  state.setResult('several', Object.assign({}, resultBase, { provenance: prov, tables: resultBase.tables.concat([{ name: 'Planning', headers: PLAN_HEADERS, rows }]) }));
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Compare two or more designs at once on their replication estimates: each mean with an interval that holds jointly with the others, every difference with a Bonferroni-adjusted interval, ' +
    'one-way analysis of variance with a post-hoc rule, and a screen for the designs that could be the best.</p>' +
    '<div class="sec ctrl-card">' +
      '<div class="ctrl-grp-lbl">Designs to compare</div>' +
      '<div id="sev-list"></div>' +
      '<div class="ctrl-row cmp-gap">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="sev-lvl">Confidence level</label><select id="sev-lvl"></select></span>' +
        '<span class="ctrl-grp"><span class="ctrl-lbl" id="sev-dir-lbl">Direction</span>' +
        '<span class="seg" role="group" aria-labelledby="sev-dir-lbl">' +
          '<button type="button" class="seg-btn" data-dir="max" aria-pressed="true">bigger is better</button>' +
          '<button type="button" class="seg-btn" data-dir="min" aria-pressed="false">smaller is better</button>' +
        '</span></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="sev-ctrl"><span class="tip" tabindex="0" data-tip="The design every other design is compared with in the versus-control differences and in Dunnett’s procedure, usually the current system.">Control</span></label><select id="sev-ctrl"></select></span>' +
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip" tabindex="0" data-tip="The smallest difference in means worth detecting. Designs whose means are within ε of the best count as good enough, and the screen and the second stage are sized to it.">Indifference zone ε</span></span><span id="sev-eps-host"></span></span>' +
        '<span class="ctrl-note" id="sev-eps-note"></span>' +
        '<button type="button" class="btn-mini" id="sev-eps-reset" style="display:none">Use default</button>' +
      '</div>' +
      '<div id="sev-excluded"></div>' +
      '<div id="sev-mixed"></div>' +
    '</div>' +
    '<p class="unit-line" id="sev-unit"></p>' +
    '<p class="sev-key" id="sev-key"></p>' +
    '<div class="subnav" data-subnav></div>' +
    '<div class="sec" data-section="means"><div class="sec-hd">Means with simultaneous intervals</div><div id="sev-means-body"></div></div>' +
    '<div class="sec" data-section="diffs"><div class="sec-hd">Differences (Bonferroni)</div>' +
      '<div class="ctrl-row"><span class="ctrl-lbl" id="sev-diff-lbl">Compare</span><span class="seg" role="group" aria-labelledby="sev-diff-lbl">' +
        '<button type="button" class="seg-btn" data-diff="pairs" aria-pressed="true">all pairs</button>' +
        '<button type="button" class="seg-btn" data-diff="control" aria-pressed="false">versus control</button>' +
      '</span></div>' +
      '<div id="sev-diffs-body"></div></div>' +
    '<div class="sec plan-card" id="sev-plan" data-section="plan"></div>' +
    '<div class="sec" data-section="anova"><div class="sec-hd">Analysis of variance and post-hoc tests</div>' +
      '<div id="sev-anova-body"></div>' +
      '<div id="sev-rule-host"></div>' +
      '<div id="sev-posthoc-body"></div></div>' +
    '<div class="sec" data-section="subset"><div class="sec-hd">Best subset</div><div id="sev-subset-body"></div></div>';

  const planSec = root.querySelector('#sev-plan');
  planSec.innerHTML = planMarkup('sev',
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="The half-width you would like every difference interval in the Differences card to have, in the response’s units. Bonferroni’s per-comparison level, 1 − α/C, is what makes this plan grow with the number of comparisons C.">Target half-width</span></span>' +
        '<span class="plan-hw-host"></span><span class="ctrl-note plan-hw-unit"></span></span>' +
      '<span class="ctrl-note plan-hw-def"></span>' +
    '</div>',
    powerControls('sev', 'Shift to detect δ',
      'How far one design’s true mean sits from the common mean of the others, in the response’s units, for the F test to detect. The default is 10% of the grand mean.'));
  planSec.appendChild(details('Half-width or power?', PLAN_WHY));
  planSec.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => {
    if (plan.mode === b.dataset.plan) return;
    plan.mode = b.dataset.plan;
    state.setPick(id, 'planMode', plan.mode);
    drawPlan();
  }));
  const powSel = planSec.querySelector('#sev-plan-pow');
  powSel.addEventListener('change', () => { plan.power = Number(powSel.value); state.setPick(id, 'power', plan.power); drawPlan(); });

  // The rule picker sits between the ANOVA table and the post-hoc results,
  // outside both redrawn bodies, and so it keeps focus across a redraw.
  const ruleRow = document.createElement('div');
  ruleRow.className = 'ctrl-row cmp-rule-row';
  ruleRow.innerHTML = '<span class="ctrl-pair"><label class="ctrl-lbl" for="sev-rule">Post-hoc rule</label><select id="sev-rule">' +
    Object.keys(RULES).map(r => '<option value="' + r + '">' + RULES[r] + '</option>').join('') + '</select></span>';
  root.querySelector('#sev-rule-host').appendChild(ruleRow);

  const subsetSec = root.querySelector('#sev-subset-body').parentNode;
  subsetSec.appendChild(details('How the screen works',
    '<p>The screen compares every design with every other. For designs i and j it forms an allowance W<sub>ij</sub> = t·√(s<sub>i</sub>²/R<sub>i</sub> + s<sub>j</sub>²/R<sub>j</sub>), ' +
    'where t is the t quantile at (1 − α/2)<sup>1/(k−1)</sup> on R<sub>0</sub> − 1 degrees of freedom and R<sub>0</sub> is the smallest number of replications among the designs.</p>' +
    '<p>When bigger is better, design i survives when Ȳ<sub>i</sub> ≥ Ȳ<sub>j</sub> − max(0, W<sub>ij</sub> − ε) for every other design j: no design beats it by more than the noise allowance less the indifference zone. ' +
    'When smaller is better the inequality is mirrored. The survivors contain the best design, or one within ε of it, with probability at least 1 − α/2.</p>' +
    '<p>For each survivor, Rinott’s second stage needs N<sub>i</sub> = max(R<sub>i</sub>, ⌈(h·s<sub>i</sub>/ε)²⌉) replications in all, with h from Rinott’s integral at 1 − α/2. ' +
    'Running them and picking the best second-stage mean selects a design within ε of the best with the stated confidence.</p>'));

  // The checked set is recorded only when the reader checks or unchecks a
  // design; the checklist's own updates as datasets come and go are not.
  checklist = datasetChecklist(root.querySelector('#sev-list'), {
    filter: ds => canInfer(ds).ok,
    onChange: () => schedule()
  });
  root.querySelector('#sev-list').addEventListener('change', () => { state.setPick(id, 'checked', checklist.selected()); });
  levelSelect(root.querySelector('#sev-lvl'));
  ctrlSel = root.querySelector('#sev-ctrl');
  ctrlSel.addEventListener('change', () => { controlId = ctrlSel.value || null; state.setPick(id, 'control', controlId); schedule(); });
  root.querySelector('#sev-rule').addEventListener('change', e => { rule = e.target.value; state.setPick(id, 'rule', rule); schedule(); });
  root.querySelector('#sev-eps-reset').addEventListener('click', () => { epsUser = null; state.setPick(id, 'eps', null); schedule(); });
  root.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { dir = b.dataset.dir; state.setPick(id, 'dir', dir); schedule(); }));
  root.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { diffMode = b.dataset.diff; state.setPick(id, 'diff', diffMode); schedule(); }));
  applyStored();

  const visible = () => root.classList.contains('active');
  state.on('datasets', () => { applyStored(); autoCheck(); if (visible()) schedule(); });
  state.on('selection', () => { if (visible()) schedule(); });
  state.on('settings', () => { if (visible()) schedule(); });
  autoCheck();
  update();
  installExportRow(root, id);
}

// Brings back the settings the reader made on this page (kept with the
// session) wherever they are valid. Every one is recorded when the reader
// changes it, and so applying them again on each change of the datasets
// changes nothing except after a reload.
function applyStored() {
  const get = k => state.getPick(id, k);
  if (Object.prototype.hasOwnProperty.call(RULES, get('rule'))) rule = get('rule');
  if (get('dir') === 'max' || get('dir') === 'min') dir = get('dir');
  if (get('diff') === 'pairs' || get('diff') === 'control') diffMode = get('diff');
  if (typeof get('control') === 'string') controlId = get('control');
  const e = get('eps');
  if (typeof e === 'number' && Number.isFinite(e) && e > 0) epsUser = e;
  if (get('planMode') === 'hw' || get('planMode') === 'power') plan.mode = get('planMode');
  if (PLAN_POWERS.includes(get('power'))) {
    plan.power = get('power');
    const sel = rootEl && rootEl.querySelector('#sev-plan-pow');
    if (sel) sel.value = String(plan.power);
  }
}

// A planning target typed for one set of designs, or null.
function storedTarget(name, key) {
  const v = state.getPick(id, name + ':' + key);
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// Until the reader checks or unchecks a design, the datasets that came from
// the same file as the most recently loaded one are checked, and so a file
// of several designs is compared without any clicks while designs from
// other files, which may measure a different response, stay unchecked. When
// that family has fewer than two members, every eligible dataset is checked.
function autoCheck() {
  if (!checklist) return;
  const want = state.getPick(id, 'checked');
  const have = Array.isArray(want) ? want.filter(i => state.datasets.some(d => d.id === i)) : [];
  if (Array.isArray(want) && (have.length || !want.length)) {
    // The reader's own set, kept with the session, is applied as its
    // datasets arrive, because the checklist drops ids that are not loaded.
    // A set none of whose designs is loaded gives way to the rule below.
    if (have.join('\n') !== checklist.selected().join('\n')) checklist.setChecked(have);
    return;
  }
  const ok = state.datasets.filter(d => canInfer(d).ok);
  const fileOf = d => (d.source && d.source.file) || '';
  let ids = [];
  for (let i = ok.length - 1; i >= 0 && ids.length < 2; i--) {
    ids = ok.filter(d => fileOf(d) === fileOf(ok[i])).map(d => d.id);
  }
  if (ids.length < 2) ids = ok.map(d => d.id);
  if (ids.join('\n') !== checklist.selected().join('\n')) checklist.setChecked(ids);
}

/** Called each time the page is shown. */
export function onShow() { update(); }

export default { id, title, sections, render, onShow };
