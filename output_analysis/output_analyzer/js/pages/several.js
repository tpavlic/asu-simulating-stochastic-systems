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
import { repEstimates, repIds, canInfer } from '../data/model.js';
import { simultaneousMeans, bonferroniFamily, matchBlocks, anova, posthoc, posthocWelch, levene, planHalfWidthBonferroni, powerAnova, planPowerAnova } from '../stats/compare.js';
import { planReplications } from '../stats/intervals.js';
import { subsetSelection } from '../stats/select.js';
import { kruskalWallis, dunn, friedman, friedmanPairs, signedRank, bonferroniFamilyRank } from '../stats/nonparam.js';
import { card, cardRow, datasetChecklist, levelSelect, spinner, details, notice, DF_LABEL } from '../ui/widgets.js';
import { makeFigure, exportButtons, legend, intervals, recordRows, svgEl, tok, extent, qqPlot, dragLine } from '../ui/plots.js';
import { normalQQ, shapiroWilk } from '../stats/normality.js';
import { installExportRow } from '../ui/exportrow.js';
import { assumptionChecks } from '../ui/checks.js';
import { num, stat, pValue, pct, esc, plural, intl, dash, lvl, pEq } from '../ui/format.js';
import { currentSection } from '../ui/tabs.js';
import { severalRecipe } from '../io/recipes.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'several';
/** The page's title. */
export const title = 'Several Systems';
/** The page's sections, shown one at a time under the controls. */
export const sections = [
  { id: 'means', label: 'Benchmark comparison', tip: 'Every design against a benchmark at once: each design’s mean with its own interval, all k holding together by the Bonferroni correction (each at level 1 − α/k), which holds the chance of any false rejection at α. Draw the benchmark on the plot, or read the intervals against one you have in mind.' },
  { id: 'diffs', label: 'Pairwise comparisons', tip: 'Every pair’s difference, or each design against a control, each with its own interval, all holding together by the Bonferroni correction (each at level 1 − α/C): nothing pooled and no analysis of variance first.' },
  { id: 'anova', label: 'ANOVA and post hoc', tip: 'One F test of whether any means differ and then a post-hoc rule that judges each pair on the pooled (or Welch) variance.' },
  { id: 'subset', label: 'Screen for the best', tip: 'Which designs cannot be ruled out as the best within an indifference zone ε and how many more replications a second stage would need to choose among them.' }
];

const RULES = {
  tukey: 'Tukey’s HSD',
  lsd: 'Fisher’s LSD (protected)',
  bonferroni: 'Bonferroni (pooled variance)',
  dunnett: 'Dunnett vs control'
};
// The post-hoc rules under Welch's analysis of variance, where every design keeps its own variance.
const WELCH_RULES = {
  gameshowell: 'Games–Howell',
  bonferroniWelch: 'Bonferroni (Welch pairs)'
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

let rootEl = null;
let exportRow = null;
let checklist = null;
let ctrlSels = [];
let dir = 'max';
let diffMode = 'pairs';
let rule = 'tukey';
// 'pooled' or 'welch': whether the analysis of variance pools one variance across
// designs or lets each keep its own (Welch's F with Games–Howell pairs). Welch's
// form exists only for independent replications, and so pairing ignores it.
let varMode = 'pooled';
let ruleW = 'gameshowell';
// How Dunn's pairwise p-values are adjusted: 'bonferroni' or 'holm'.
let adjust = 'bonferroni';
// 't' for the t-based procedures on every sub-item, 'np' for their rank versions.
let proc = 't';
const NP_PLAN = 'Under the rank procedures, the counts here are the t plan inflated by π/3 ≈ 1.047, the reciprocal of the Wilcoxon procedures’ efficiency relative to the t under normal data (about 5% more replications); under heavy tails, they need fewer, and the inflation is then conservative.';
// 'independent' or 'paired': whether replication i of every design shared its
// random inputs (common random numbers across designs), making it a block.
let pairMode = 'independent';
// The reader's own choice of how blocks are matched, or null for the default.
let matchChoice = null;
let controlId = null;
// The indifference zone: null follows the default (10% of the pooled sd),
// a number is the reader's own value.
let epsUser = null;
// The benchmark the designs' means are tested against: off by default, and
// its value kept per set of designs (the units differ between sets).
let benchOn = false;
let benchVal = null;
let benchSpin = null;
let benchStep = null;
let epsSpin = null;
let epsStep = null;
let pending = false;
// The replication plan. A null target follows its default, which is
// recomputed from the data; a number is the reader's own value, kept until
// another set of designs is checked.
const plan = { key: null, hwUser: null, mhwUser: null, deltaUser: null, power: 0.8, hwSlot: {}, mhwSlot: {}, deltaSlot: {} };
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
// A list in running text: "A and B", "A, B, and C".
const andList = xs => (xs.length < 3 ? xs.join(' and ') : xs.slice(0, -1).join(', ') + ', and ' + xs[xs.length - 1]);
// Each post-hoc rule as a sentence names it.
const RULE_PROSE = { tukey: 'Tukey’s HSD', lsd: 'Fisher’s protected LSD', bonferroni: 'the Bonferroni rule', dunnett: 'Dunnett’s procedure' };
const WELCH_RULE_PROSE = { gameshowell: 'the Games–Howell rule', bonferroniWelch: 'Bonferroni on Welch pairs' };

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

// The ids of the replications whose estimates are finite, in step with finiteOf.
function finiteIds(ds) {
  const est = repEstimates(ds), ids = repIds(ds);
  return Array.from(ids).filter((_, i) => Number.isFinite(est[i]));
}

function idsDistinct(ids) { return new Set(ids.map(String)).size === ids.length; }
function idsArePositions(ids) { return ids.every((v, i) => String(v) === String(i + 1)); }

// How the blocks are matched by default: by replication id when every
// design carries distinct ids and most of them appear in every design, and
// by position otherwise, with the reason.
function defaultMatchK(idsList) {
  if (!idsList.every(idsDistinct)) {
    return { by: 'position', why: 'Matched by position by default: at least one design repeats a replication id, and so the ids cannot identify a replication.' };
  }
  const sets = idsList.map(ids => new Set(ids.map(String)));
  const shared = idsList[0].filter(v => sets.every(st => st.has(String(v)))).length;
  const minLen = Math.min(...idsList.map(ids => ids.length));
  if (shared * 2 < minLen) {
    return { by: 'position', why: 'Matched by position by default: fewer than half of the replication ids appear in every design.' };
  }
  if (idsList.every(idsArePositions)) {
    return { by: 'id', why: 'Matched by replication id by default. Every design numbers its replications 1, 2, 3, …, and so matching by position gives the same blocks.' };
  }
  return { by: 'id', why: 'Matched by replication id by default: every design carries distinct ids, and ' + plural(shared, 'id appears', 'ids appear') + ' in all of them.' };
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
// A design's row label: its number and then its short name when there is room
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
/**
 * Places brackets in columns so that none overlaps another: shortest span
 * first, each in the first column where it meets no bracket already there.
 * Two brackets that share an end row count as meeting because their ticks
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
  const cOk = tok('--ok'), cMuted = tok('--muted'), cCard = tok('--card');
  // For the script exports, the letters and brackets sit inside a widened x
  // range rather than in the margin.
  const ry = recordRows(fig, rows.map(r => r.label));
  const [dx0, dx1] = sx.domain, span = dx1 - dx0;
  fig.xRange = [dx0, dx1 + span * (0.12 + 0.03 * cols)];
  // A row with `keep` set is colored by whether it survives a screen; the
  // records are kept per color so that each group exports as one series.
  const recs = new Map();
  const recFor = (c, what) => {
    if (!recs.has(c)) {
      const gone = what === 'eliminated';
      recs.set(c, { segs: { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: c, dash: gone, label: what + ' interval' },
                    means: { kind: 'points', x: [], y: [], color: c, hollow: gone, label: what + ' mean' } });
    }
    return recs.get(c);
  };
  const letters = { kind: 'text', x: [], y: [], text: [], color: cAcc, anchor: 'start' };
  rows.forEach((r, i) => {
    const y = cy(i);
    const c = r.keep === undefined ? cEst : r.keep ? cOk : cMuted;
    const { segs, means } = recFor(c, r.keep === undefined ? '' : r.keep ? 'surviving' : 'eliminated');
    svgEl('line', { x1: 0, x2: fig.iw, y1: y, y2: y, stroke: cBorder, 'stroke-width': 1 }, fig.inner);
    const g = svgEl('g', { class: 'm-int' }, fig.inner);
    const x0 = sx(r.lo), x1 = sx(r.hi);
    const gone = r.keep === false;
    svgEl('line', Object.assign({ x1: x0, x2: x1, y1: y, y2: y, stroke: c, 'stroke-width': 2 }, gone ? { 'stroke-dasharray': '5,4' } : {}), g);
    for (const x of [x0, x1]) svgEl('line', { x1: x, x2: x, y1: y - 5, y2: y + 5, stroke: c, 'stroke-width': 2 }, g);
    if (gone) svgEl('circle', { cx: sx(r.mean), cy: y, r: 4, fill: cCard, stroke: c, 'stroke-width': 2 }, g);
    else svgEl('circle', { cx: sx(r.mean), cy: y, r: 4.2, fill: c }, g);
    const yy = ry(i);
    segs.x0.push(r.lo, r.lo, r.hi); segs.x1.push(r.hi, r.lo, r.hi); segs.y0.push(yy, yy - 0.18, yy - 0.18); segs.y1.push(yy, yy + 0.18, yy + 0.18);
    means.x.push(r.mean); means.y.push(yy);
    const t = svgEl('text', { x: -10, y: y + 4, 'text-anchor': 'end', 'font-size': fs, fill: r.keep === false ? cMuted : cText }, fig.layers.axes);
    t.textContent = clip(r.label, lw - 6, fs);
    if (r.letter) {
      const lt = svgEl('text', { x: fig.iw + 10, y: y + 4, 'font-size': lfs, 'font-weight': 700, fill: r.letterColor || cAcc, class: 'm-letter',
        'font-family': "'IBM Plex Mono', Menlo, monospace", 'letter-spacing': '0.06em' }, fig.inner);
      lt.textContent = r.letter;
      letters.x.push(dx1 + span * 0.02); letters.y.push(yy); letters.text.push(r.letter);
    }
  });
  for (const r of recs.values()) { r.segs.label = r.segs.label.trim(); r.means.label = r.means.label.trim(); fig.series.push(r.segs, r.means); }
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
    const out = [r.full, 'mean ' + num(r.mean), 'interval ' + interval(r.lo, r.hi)];
    if (r.note) out.push(r.note);
    return out;
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

// A section's planning card: its heading, its controls, the outputs, and a
// line for the rank procedures' note.
function subPlanMarkup(controlsHtml) {
  return '<div class="sec-hd">How many replications</div>' +
    '<div class="plan-pane">' + controlsHtml + PLAN_OUT + '</div>' +
    '<p class="exp-note plan-np"></p>';
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
  // Under a rank procedure the second card holds the t procedure's own n,
  // the count the shown n was inflated from, in place of the value at n.
  const cards = [
    card(PLAN_N, has ? intl(o.n) : dash, o.nNote),
    o.tN != null ? card('t procedure’s <span class="sym">n</span>', intl(o.tN), 'inflated by π/3 for the rank procedure')
      : kind === 'hw' ? card(PLAN_HW, has ? num(o.at) : dash, o.atNote) : card(PLAN_PW, has ? powerPct(o.at) : dash, o.atNote)
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

// The benchmark the means (or pseudo-medians) are tested against: the
// control's state, the flag for each interval, and the pieces of the plot,
// the table, and the caption that depend on it. Off, every piece is empty.
function benchmark(items, ds) {
  const pair = rootEl.querySelector('#sev-bench-pair');
  const on = benchOn && items.length > 0;
  rootEl.querySelector('#sev-bench-on').checked = benchOn;
  pair.hidden = !on;
  const key = 'bench:' + state.datasets.filter(d => canInfer(d).ok).map(d => d.id).sort().join('|');
  let value = null;
  if (on) {
    const centers = items.map(it => it.center);
    const stored = state.getPick(id, key);
    if (Number.isFinite(benchVal) && benchSpin && benchSpin.key === key) value = benchVal;
    else if (typeof stored === 'number' && Number.isFinite(stored)) value = stored;
    else value = centers.reduce((a, b) => a + b, 0) / centers.length;
    const span = Math.max(...items.map(it => it.hi)) - Math.min(...items.map(it => it.lo));
    const step = stepFor(span || Math.abs(value) || 1);
    // The value is kept at the spinner's own precision, and so the field,
    // the line, and the verdict all show the same number.
    value = Number((Math.round(value / step) * step).toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
    benchVal = value;
    if (!benchSpin || benchSpin.step !== step || benchSpin.key !== key) {
      const host = rootEl.querySelector('#sev-bench-host');
      host.innerHTML = '<input id="sev-bench" type="text" class="par-inp">';
      const inp = host.querySelector('#sev-bench');
      inp.value = String(value);
      benchSpin = { key, step, spin: spinner(inp, { step, min: -1e12, max: 1e12, onChange: v => { benchVal = v; state.setPick(id, key, v); schedule(); } }) };
    } else benchSpin.spin.set(value, false);
    rootEl.querySelector('#sev-bench-unit').textContent = ds && ds.unit ? ds.unit : 'in the response’s units';
  }
  const flag = i => on && (items[i].lo > value || items[i].hi < value);
  const word = i => (!on ? '' : items[i].lo > value ? 'above the benchmark' : items[i].hi < value ? 'below the benchmark' : 'contains the benchmark');
  return {
    on, value: on ? value : null, flag, word,
    cell: i => (flag(i) ? '<span class="cmp-flag">' + word(i).replace(' the benchmark', '') + '</span>' : 'contains'),
    // The spinner shows the value as the line moves, and so the line carries no label of its own.
    line: fg => { if (on) dragLine(fg, { value, step: benchSpin.step, ariaLabel: 'Benchmark', label: null, onMove: v => benchSpin.spin.set(v, false), onEnd: v => { benchVal = v; state.setPick(id, key, v); benchSpin.spin.set(v, false); schedule(); } }); },
    legend: base => [{ swatch: 'interval', color: '--est', label: base + (on ? ', contains the benchmark' : '') }]
      .concat(on ? [{ swatch: 'flagged', color: '--miss', label: 'excludes the benchmark: declared above or below it' }, { swatch: 'dash', color: '--text', label: 'benchmark (drag it)' }] : []),
    caption: () => (on ? ' A red dashed interval excludes the benchmark, and that design is declared above or below it; with every interval at 1 − α/k, the chance of any false declaration across the k designs is at most α. Drag the dashed line, or type a value, to move the benchmark.' : ''),
    verdict: short => {
      const above = items.map((it, i) => i).filter(i => items[i].lo > value), below = items.map((it, i) => i).filter(i => items[i].hi < value);
      const name = ids => ids.map(i => short[i]).join(', ');
      if (!above.length && !below.length) return 'No design’s interval excludes the benchmark ' + num(value) + ': none is declared above or below it at this family-wise level.';
      return 'Against the benchmark ' + num(value) + ': ' + (above.length ? plural(above.length, 'design') + ' above it (' + name(above) + ')' : '') +
        (above.length && below.length ? ', ' : '') + (below.length ? plural(below.length, 'design') + ' below it (' + name(below) + ')' : '') +
        ', each declared with the family-wise error held at α.';
    }
  };
}

function syncControls(list, groups) {
  rootEl.querySelectorAll('[data-dir]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dir === dir)));
  rootEl.querySelectorAll('[data-diff]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diff === diffMode)));
  rootEl.querySelectorAll('[data-adj]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.adj === adjust)));
  rootEl.querySelectorAll('[data-pair]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pair === pairMode)));
  rootEl.querySelectorAll('[data-proc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.proc === proc)));
  // The post-hoc rule serves the t procedures, the adjustment the rank ones.
  rootEl.querySelector('#sev-rule-host').style.display = proc === 'np' ? 'none' : '';
  rootEl.querySelector('#sev-var-row').style.display = proc === 'np' || pairMode === 'paired' ? 'none' : '';
  rootEl.querySelectorAll('[data-var]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.var === varMode)));
  fillRuleSelect();
  rootEl.querySelector('#sev-adj-row').style.display = proc === 'np' ? '' : 'none';
  rootEl.querySelector('#sev-match-row').style.display = pairMode === 'paired' ? '' : 'none';

  // The control picker offers the checked designs.
  if (!list.some(d => d.id === controlId)) controlId = list.length ? list[0].id : null;
  const short = shortNames(list);
  for (const sel of ctrlSels) {
    sel.innerHTML = list.length
      ? list.map((d, i) => '<option value="' + esc(d.id) + '">' + esc(short[i]) + '</option>').join('')
      : '<option value="">Check two or more designs</option>';
    sel.value = controlId || '';
    sel.disabled = !list.length;
  }
  // The picker shows only beside the control that uses it.
  rootEl.querySelector('#sev-ctrl-diff').style.display = diffMode === 'control' ? '' : 'none';
  rootEl.querySelector('#sev-ctrl-rule').style.display = rule === 'dunnett' && !welchOn() ? '' : 'none';

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
    ' not offered here because a comparison needs at least two replication outcomes per design.<br>' + items));
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
  let groups = list.map(finiteOf);
  // Under common random numbers across designs the replications are matched
  // into complete blocks, and every procedure runs on the aligned groups.
  const paired = pairMode === 'paired';
  let match = null;
  const pairNote = rootEl.querySelector('#sev-pairnote');
  pairNote.innerHTML = '';
  if (paired && list.length >= 2) {
    const ids = list.map(finiteIds);
    const def = defaultMatchK(ids);
    const by = matchChoice || def.by;
    match = Object.assign(matchBlocks(ids, by), { by, why: matchChoice && matchChoice !== def.by
      ? 'Matched by ' + (by === 'id' ? 'replication id' : 'position') + ', as chosen. ' + def.why.replace('by default', 'would be the default')
      : def.why });
    groups = list.map((d, i) => Float64Array.from(match.blocks, blk => groups[i][blk[i]]));
    const names = shortNames(list);
    const dropped = match.unmatched.map((u, i) => (u.length ? esc(names[i]) + ' (' + u.map(x => String(ids[i][x])).join(', ') + ')' : null)).filter(Boolean);
    if (dropped.length) pairNote.appendChild(notice('warn', 'Replications with no partner in every design are left out: ' + dropped.join('; ') + '.'));
    if (match.blocks.length < 2) pairNote.appendChild(notice('warn', 'A paired comparison needs at least two replications matched across every design, and ' + (match.blocks.length === 1 ? 'only one was' : 'none were') + '. Try matching by position, or check the replication ids.'));
  }
  rootEl.querySelectorAll('[data-match]').forEach(b => b.setAttribute('aria-pressed', String(match ? b.dataset.match === match.by : b.dataset.match === 'id')));
  rootEl.querySelector('#sev-match-note').textContent = match ? match.why : '';
  syncControls(list, groups);
  showExcluded();
  const level = state.settings.base, alpha = 1 - level;
  const k = list.length;
  const short = shortNames(list);
  const unit = rootEl.querySelector('#sev-unit');
  const bodies = ['means', 'diffs', 'anova', 'subset', 'posthoc'].map(n => rootEl.querySelector('#sev-' + n + '-body'));
  // Each body keeps its height while it is rebuilt, and so the document never
  // shrinks under the reader and the scroll position stays where it was.
  bodies.forEach(b => { const h = b.offsetHeight; if (h) b.style.minHeight = h + 'px'; b.innerHTML = ''; });
  const release = () => bodies.forEach(b => { b.style.minHeight = ''; });

  numberChecklist(list);
  const key = rootEl.querySelector('#sev-key');
  key.innerHTML = list.map((d, i) => '<span class="sev-key-it">' + badge(i) + ' ' + esc(d.name) + '</span>').join(' ');
  if (k < 2 || (paired && match.blocks.length < 2)) {
    unit.innerHTML = '<span class="unit-lbl">Experimental unit:</span> ' + (k < 2 ? 'check two or more designs above.' : 'too few replications matched across the designs.');
    const msg = k === 1 ? 'One design is checked. Check at least one more to compare.' : k < 2 ? 'Check two or more designs above to compare them.' : 'Pairing needs at least two replications matched across every design.';
    [0, 1, 2, 3].forEach(i => bodies[i].appendChild(para('muted-line cmp-empty', msg)));
    resultBase = null;
    planCtx = { msg: 'Check two or more designs above to plan replications.' };
    drawPlan();
    release();
    return;
  }
  const ns = groups.map(g => g.length);
  const kw = list.every(d => d.kind === 'reps') ? 'replication values' : list.every(d => d.kind === 'time') ? 'replication time averages' : 'replication outcomes';
  unit.innerHTML = '<span class="unit-lbl">Experimental unit:</span> ' + (paired
    ? 'R = ' + intl(ns[0]) + ' ' + kw + ' paired across the ' + k + ' designs (common random numbers)'
    : ns.every(n => n === ns[0])
      ? 'R = ' + intl(ns[0]) + ' ' + kw + ' for each of the ' + k + ' designs'
      : 'R = ' + ns.map(intl).join(', ') + ' ' + kw + ' for ' + esc(short.join(', ')) + ', in that order');

  const responses = Array.from(new Set(list.map(d => d.response)));
  const mixed = rootEl.querySelector('#sev-mixed');
  mixed.innerHTML = '';
  if (state.settings.bonfC > 1) {
    mixed.appendChild(notice('info', 'The custom Bonferroni count C = ' + intl(state.settings.bonfC) + ' set with the confidence level is not applied on this page, which divides α by its own family sizes; the stated ' + levelPct(level) + ' level is used.'));
  }
  if (responses.length > 1) {
    mixed.appendChild(notice('warn', 'The checked datasets report different responses (' + esc(responses.join(', ')) +
      '). Every comparison below treats them as one response on one axis, which only makes sense when they measure the same quantity in the same units.'));
  }

  const ctrlIdx = Math.max(0, list.findIndex(d => d.id === controlId));
  const L = levelPct(level), aTxt = num(alpha, 2);
  const np = proc === 'np';
  const tables = [];
  const summary = [];

  // Means with simultaneous intervals.
  const sm = simultaneousMeans(groups, level);
  // One set per design for the checks lines of the t procedures that take
  // each design's outcomes as normal, each a dataset the Normality link opens.
  const designSets = groups.map((g, i) => ({ name: short[i], values: g, dsId: list[i].id }));
  const INDEP_REPS = 'between replications cannot be checked from the data; it holds when each replication ran on its own random streams.';
  {
    const b = bodies[0];
    if (np) {
    const hl = groups.map(g => signedRank(g, { level: sm.perLevel }));
    b.appendChild(para('cmp-lead', 'The Bonferroni procedure for several pseudo-medians, done by hand: each design’s own Wilcoxon signed-rank interval at level 1 − α/k, and so ' + allOf(k) + ' hold at once with confidence at least ' + L + '. Each interval is on the Hodges–Lehmann pseudo-median, the median of the pairwise averages of the design’s outcomes.'));
    b.appendChild(para('cmp-banner', 'C = k = ' + k + ' comparisons with the benchmark, each at 1 − α/k = ' + levelPct(sm.perLevel)));
    b.appendChild(para('cmp-lead', 'Each at 1 − ' + aTxt + '/' + k + ', and so ' + allOf(k) + ' hold at once with probability at least ' + L + ' (Bonferroni).'));
    const bm = benchmark(hl.map(r => ({ lo: r.lo, hi: r.hi, center: r.estimate })), list[0]);
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Pseudo-median of ' + list[0].response }, 'several-pseudo-medians',
      fg => {
        rowReadout(fg, k, i => [list[i].name, num(hl[i].estimate) + '  ' + interval(hl[i].lo, hl[i].hi), bm.word(i)]);
        intervals(fg, hl.map((r, i) => ({ label: numLabel(i, short), lo: r.lo, hi: r.hi, center: r.estimate, flagged: bm.flag(i) })), { rowPx: 30 });
        bm.line(fg);
      },
      bm.legend('design pseudo-median with its ' + levelPct(sm.perLevel) + ' Wilcoxon interval'),
      'Each design’s pseudo-median with its own Wilcoxon signed-rank interval at ' + levelPct(sm.perLevel) + '. Together the ' + word(k) +
      ' intervals cover ' + allOf(k) + ' true pseudo-medians with probability at least ' + L + '.' + bm.caption());
    if (bm.on) b.appendChild(para('cmp-verdict', bm.verdict(short)));
    const basis = r => (r.exact ? 'exact' : 'normal approx.');
    const rows = hl.map((r, i) => [badge(i) + ' ' + esc(short[i]), intl(r.n), num(r.estimate), interval(r.lo, r.hi), basis(r)].concat(bm.on ? [bm.cell(i)] : []));
    b.appendChild(table(['Design', 'R', 'Pseudo-median', levelPct(sm.perLevel) + ' interval', 'Basis'].concat(bm.on ? ['vs benchmark'] : []), rows));
    tables.push({ section: 'means', name: 'Pseudo-medians with simultaneous intervals', headers: ['design', 'R', 'pseudo-median', 'per-interval level', 'lower', 'upper', 'basis'].concat(bm.on ? ['benchmark', 'vs benchmark'] : []),
      rows: hl.map((r, i) => [list[i].name, r.n, r.estimate, sm.perLevel, r.lo, r.hi, basis(r)].concat(bm.on ? [bm.value, bm.word(i)] : [])) });
    if (bm.on) summary.push(bm.verdict(short));
    } else {
    b.appendChild(para('cmp-lead', 'The Bonferroni procedure for several means, done by hand: each design’s own t interval at level 1 − α/k, and so ' + allOf(k) + ' hold at once with confidence at least ' + L + '. No variance is pooled, and no analysis of variance comes first.'));
    b.appendChild(para('cmp-banner', 'C = k = ' + k + ' comparisons with the benchmark, each at 1 − α/k = ' + levelPct(sm.perLevel)));
    b.appendChild(para('cmp-lead', 'Each at 1 − ' + aTxt + '/' + k + ', and so ' + allOf(k) + ' hold at once with probability at least ' + L + ' (Bonferroni).'));
    const bm = benchmark(sm.items.map(it => ({ lo: it.lo, hi: it.hi, center: it.mean })), list[0]);
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Mean of ' + list[0].response }, 'several-means',
      fg => {
        rowReadout(fg, k, i => [list[i].name, num(sm.items[i].mean) + '  ' + interval(sm.items[i].lo, sm.items[i].hi), bm.word(i)]);
        intervals(fg, sm.items.map((it, i) => ({ label: numLabel(i, short), lo: it.lo, hi: it.hi, center: it.mean, flagged: bm.flag(i) })), { rowPx: 30 });
        bm.line(fg);
      },
      bm.legend('design mean with its ' + levelPct(sm.perLevel) + ' t interval'),
      'Each design’s mean with its own t interval at ' + levelPct(sm.perLevel) + '. Together the ' + word(k) +
      ' intervals cover ' + allOf(k) + ' true means with probability at least ' + L + '; one interval alone is wider than an ordinary ' + L + ' interval would be.' + bm.caption());
    if (bm.on) b.appendChild(para('cmp-verdict', bm.verdict(short)));
    const rows = sm.items.map((it, i) => [badge(i) + ' ' + esc(short[i]), intl(it.n), num(it.mean), num(it.sd), num(it.se), intl(it.df), interval(it.lo, it.hi)].concat(bm.on ? [bm.cell(i)] : []));
    b.appendChild(table(['Design', 'R', 'Mean', 'SD', 'SE', 'df', levelPct(sm.perLevel) + ' interval'].concat(bm.on ? ['vs benchmark'] : []), rows));
    b.appendChild(assumptionChecks({ sets: designSets, alpha, procedure: 'the benchmark comparison', declared: INDEP_REPS }));
    tables.push({ section: 'means', name: 'Means with simultaneous intervals', headers: ['design', 'R', 'mean', 'sd', 'se', 'df', 'per-interval level', 'lower', 'upper'].concat(bm.on ? ['benchmark', 'vs benchmark'] : []),
      rows: sm.items.map((it, i) => [list[i].name, it.n, it.mean, it.sd, it.se, it.df, sm.perLevel, it.lo, it.hi].concat(bm.on ? [bm.value, bm.word(i)] : [])) });
    if (bm.on) summary.push(bm.verdict(short));
      }
  }

  // Bonferroni family of differences.
  const fam = bonferroniFamily(groups, { mode: diffMode, control: ctrlIdx, level, paired });
  const famName = paired ? 'paired t interval' : 'Welch interval';
  {
    const b = bodies[1];
    if (np) {
    const famR = bonferroniFamilyRank(groups, { mode: diffMode, control: ctrlIdx, level, paired });
    const rName = paired ? 'Wilcoxon signed-rank interval' : 'Wilcoxon rank-sum interval';
    b.appendChild(para('cmp-banner', 'C = ' + famR.C + ' comparison' + (famR.C === 1 ? '' : 's') + ', each at 1 − α/C = ' + levelPct(famR.perLevel)));
    b.appendChild(para('cmp-lead', 'The Bonferroni procedure for differences, done by hand with ranks: every pair’s own ' + rName + ' for the shift in location at level 1 − α/C, ' +
      (paired ? 'on the paired differences within each replication' : 'on the two designs’ outcomes') + '; each interval contains 0 exactly when that pair’s Wilcoxon test at α/C does not reject.'));
    if (diffMode === 'control') b.appendChild(para('cmp-lead', 'Each design against the control, ' + esc(short[ctrlIdx]) + '.'));
    const lab = c => pairLabel(c.i, c.j);
    const full = c => list[c.i].name + ' − ' + list[c.j].name;
    const anyFlag = famR.comparisons.some(c => c.flagged), anyPlain = famR.comparisons.some(c => !c.flagged);
    const legItems = [];
    if (anyPlain) legItems.push({ swatch: 'interval', color: '--est', label: rName + ' at ' + levelPct(famR.perLevel) + ', contains 0' });
    if (anyFlag) legItems.push({ swatch: 'flagged', color: '--miss', label: rName + ' at ' + levelPct(famR.perLevel) + ', excludes 0' });
    legItems.push({ swatch: 'dash', color: '--truth', label: 'zero shift' });
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Shift in location of ' + list[0].response }, 'several-rank-differences',
      fg => {
        const cs = famR.comparisons;
        rowReadout(fg, cs.length, i => [full(cs[i]), num(cs[i].diff) + '  ' + interval(cs[i].lo, cs[i].hi), cs[i].flagged ? 'excludes 0' : 'contains 0']);
        intervals(fg, cs.map(c => ({ label: lab(c), lo: c.lo, hi: c.hi, center: c.diff, flagged: c.flagged })), { ref: 0, rowPx: 28 });
      },
      legItems,
      'Each row is one pair’s Hodges–Lehmann shift with its ' + rName + ' at ' + levelPct(famR.perLevel) + '. A red dashed row excludes 0, and so that pair is declared different with the family-wise error rate held at ' + aTxt + ' or below.');
    const statName = paired ? 'V' : 'W';
    const rows = famR.comparisons.map(c => ['<span class="sev-pair">' + esc(lab(c)) + '</span>', '<span class="sev-full">' + esc(full(c)) + '</span>', num(c.diff), num(c.stat), interval(c.lo, c.hi), pValue(c.p), pValue(c.pAdj),
      c.exact ? 'exact' : 'normal approx.', c.flagged ? '<span class="cmp-flag">excludes 0</span>' : 'contains 0']);
    b.appendChild(table(['Pair', 'Designs', 'Shift', statName, 'Interval', 'p', 'Adjusted p', 'Basis', 'Flag'], rows));
    b.appendChild(para('exp-note', 'Bonferroni holds the family-wise error rate at or below α = ' + aTxt + ' and is conservative. The adjusted p is C·p capped at 1. ' +
      (paired ? 'Friedman’s' : 'Dunn’s') + ' pairwise comparisons in the analysis section are the rank post hoc, on the ranks of all the outcomes together.'));
    tables.push({ section: 'diffs', name: 'Pairwise rank comparisons (Bonferroni)', headers: ['pair', 'shift', statName, 'lower', 'upper', 'p', 'adjusted p', 'basis', 'flag'],
      rows: famR.comparisons.map(c => [list[c.i].name + ' - ' + list[c.j].name, c.diff, c.stat, c.lo, c.hi, c.p, c.pAdj, c.exact ? 'exact' : 'normal approximation', c.flagged ? 'excludes 0' : 'contains 0']) });
    const nf = famR.comparisons.filter(c => c.flagged).length;
    summary.push('Bonferroni rank (' + (diffMode === 'pairs' ? 'all pairs' : 'versus ' + esc(short[ctrlIdx])) + ', C = ' + famR.C + '): ' + plural(nf, 'shift excludes', 'shifts exclude') + ' 0.');
    } else {
    b.appendChild(para('cmp-banner', 'C = ' + fam.C + ' comparison' + (fam.C === 1 ? '' : 's') + ', each at 1 − α/C = ' + levelPct(fam.perLevel)));
    b.appendChild(para('cmp-lead', 'The Bonferroni procedure for differences, done by hand: every pair’s own ' + famName + ' at level 1 − α/C, with no pooled variance and no analysis of variance in front; each interval contains 0 exactly when that pair’s t test at α/C does not reject. The Bonferroni rule in the ANOVA section is the other kind: the same α/C, on the pooled variance.'));
    if (diffMode === 'control') b.appendChild(para('cmp-lead', 'Each design against the control, ' + esc(short[ctrlIdx]) + '.'));
    const lab = c => pairLabel(c.i, c.j);
    const full = c => list[c.i].name + ' − ' + list[c.j].name;
    const anyFlag = fam.comparisons.some(c => c.flagged), anyPlain = fam.comparisons.some(c => !c.flagged);
    const legItems = [];
    if (anyPlain) legItems.push({ swatch: 'interval', color: '--est', label: famName + ' at ' + levelPct(fam.perLevel) + ', contains 0' });
    if (anyFlag) legItems.push({ swatch: 'flagged', color: '--miss', label: famName + ' at ' + levelPct(fam.perLevel) + ', excludes 0' });
    legItems.push({ swatch: 'dash', color: '--truth', label: 'zero difference' });
    figure(b, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Difference in means of ' + list[0].response }, 'several-differences',
      fg => {
        const cs = fam.comparisons;
        rowReadout(fg, cs.length, i => [full(cs[i]), num(cs[i].diff) + '  ' + interval(cs[i].lo, cs[i].hi), cs[i].flagged ? 'excludes 0' : 'contains 0']);
        intervals(fg, cs.map(c => ({ label: lab(c), lo: c.lo, hi: c.hi, center: c.diff, flagged: c.flagged })), { ref: 0, rowPx: 28 });
      },
      legItems,
      'Each row is one difference of means with its ' + famName + ' at ' + levelPct(fam.perLevel) + '. A red dashed row excludes 0, and so that pair is declared different with the family-wise error rate held at ' + aTxt + ' or below.');
    const rows = fam.comparisons.map(c => ['<span class="sev-pair">' + esc(lab(c)) + '</span>', '<span class="sev-full">' + esc(full(c)) + '</span>', num(c.diff), num(c.se), num(c.df), interval(c.lo, c.hi), num(c.t), pValue(c.p), pValue(c.pAdj),
      c.flagged ? '<span class="cmp-flag">excludes 0</span>' : 'contains 0']);
    b.appendChild(table(['Pair', 'Designs', 'Difference', 'SE', 'df', 'Interval', 't', 'p', 'Adjusted p', 'Flag'], rows));
    b.appendChild(para('exp-note', 'Bonferroni holds the family-wise error rate at or below α = ' + aTxt + ' and is conservative: its true error rate is usually lower, and its intervals are wider than they need to be. ' +
      'The adjusted p is C·p capped at 1. Tukey’s procedure (all pairs) and Dunnett’s (versus a control) are less conservative and are offered in the analysis of variance below.'));
    // Welch intervals take each design's outcomes as normal; paired t intervals take each pair's differences as normal.
    b.appendChild(assumptionChecks({
      sets: paired
        ? fam.comparisons.map(c => ({ name: 'the differences ' + pairLabel(c.i, c.j), values: Array.from(groups[c.i], (v, r) => v - groups[c.j][r]) }))
        : designSets,
      alpha, procedure: 'the pairwise comparisons', linkDs: list[0].id,
      declared: paired ? 'between blocks cannot be checked from the data; the pairing within each replication is what the Replications switch declares.'
        : 'between designs cannot be checked from the data; it is what the Replications switch declares.' }));
    tables.push({ section: 'diffs', name: 'Pairwise comparisons (Bonferroni)', headers: ['pair', 'difference', 'se', 'df', 'lower', 'upper', 't', 'p', 'adjusted p', 'flag'],
      rows: fam.comparisons.map(c => [list[c.i].name + ' - ' + list[c.j].name, c.diff, c.se, c.df, c.lo, c.hi, c.t, c.p, c.pAdj, c.flagged ? 'excludes 0' : 'contains 0']) });
    const nf = fam.comparisons.filter(c => c.flagged).length;
    summary.push('Bonferroni (' + (diffMode === 'pairs' ? 'all pairs' : 'versus ' + esc(short[ctrlIdx])) + ', C = ' + fam.C + '): ' + plural(nf, 'difference excludes', 'differences exclude') + ' 0.');
      }
  }

  // ANOVA and post-hoc. Welch's analysis weights each design by R/s², and so
  // a design with fewer than two outcomes or with no spread leaves it
  // undefined; the section then says which designs, and the planning card
  // below still takes the pooled analysis's variance.
  const welch = welchOn();
  const flat = groups.map(g => g.length < 2 || Math.min(...g) === Math.max(...g));
  const welchBad = welch ? list.filter((d, i) => flat[i]).map(d => d.name) : [];
  const ph = welch && !welchBad.length ? posthocWelch(groups, { rule: ruleW, alpha }) : posthoc(groups, { rule, alpha, control: ctrlIdx, blocked: paired });
  const av = ph.anova;
  const ruleName = welch ? WELCH_RULES[ruleW] : RULES[rule];
  const totalDf = welch ? NaN : paired ? av.dfb + av.dfblk + av.dfw : av.dfb + av.dfw;
  rootEl.querySelector('#sev-anova-hd').textContent = np ? (paired ? 'Friedman’s test and its pairwise comparisons' : 'Kruskal–Wallis test and Dunn’s pairwise comparisons') : welch ? 'Welch’s analysis of variance and post-hoc tests' : 'Analysis of variance and post-hoc tests';
  if (!np && welchBad.length) {
    bodies[2].appendChild(notice('warn', 'Welch’s analysis of variance weights each design by R<sub>i</sub>/s<sub>i</sub>², and so it needs at least two outcomes with some spread in every design; ' +
      esc(andList(welchBad)) + (welchBad.length === 1 ? ' has' : ' have') + ' none. Choose equal variances above, or leave ' + (welchBad.length === 1 ? 'that design' : 'those designs') + ' out of the checklist.'));
    summary.push('Welch ANOVA: not defined, because ' + andList(welchBad) + (welchBad.length === 1 ? ' has' : ' have') + ' no spread.');
  } else if (!np) {
    let b = bodies[2];
    if (paired) b.appendChild(para('cmp-lead', 'With the replications paired across designs, the analysis of variance treats each replication as a block: the variation the replications share under common random numbers is removed as its own row, and the designs are judged against what remains.'));
    const rejects = av.p < alpha;
    if (welch) {
      b.appendChild(para('cmp-lead', 'Welch’s analysis of variance lets every design keep its own variance: each design’s mean is weighted by R<sub>i</sub>/s<sub>i</sub>², nothing is pooled, and the F statistic is referred to an F distribution whose second degrees of freedom come from the spreads.'));
      b.appendChild(table(['Test', 'F', 'df<sub>1</sub>', 'df<sub>2</sub>', 'p'], [
        ['Welch’s F for equal means', stat(av.F), intl(av.df1), num(av.df2), pValue(av.p)]
      ]));
      b.appendChild(para('cmp-verdict', 'F = ' + stat(av.F) + ' on ' + av.df1 + ' and ' + num(av.df2) + ' degrees of freedom, ' + pEq(av.p) + ': ' +
        (rejects ? 'the means are not all equal at this level.' : 'insufficient evidence of a difference among the means at this level.')));
    } else {
      const atab = table(['Source', 'SS', 'df', 'MS', 'F', 'p'], [
        ['Between designs', num(av.ssb), intl(av.dfb), num(av.msb), stat(av.F), pValue(av.p)],
        paired ? ['Between replications (blocks)', num(av.ssblk), intl(av.dfblk), num(av.msblk), stat(av.Fblock), pValue(av.pBlock)] : null,
        [paired ? 'Residual' : 'Within designs', num(av.ssw), intl(av.dfw), num(av.msw), '', ''],
        ['Total', num(av.sst), intl(totalDf), '', '', '']
      ].filter(Boolean));
      b.appendChild(atab);
      // With no variation left within the designs (once the blocks are
      // removed, under pairing), F is infinite when the means differ and
      // undefined when they do not.
      const left = paired ? 'No variation is left once the designs and the replications are removed' : 'No design varies within itself';
      b.appendChild(para('cmp-verdict', Number.isNaN(av.F)
        ? 'F cannot be computed: ' + left.charAt(0).toLowerCase() + left.slice(1) + ', and the design means are all equal, which leaves no difference to test.'
        : 'F = ' + stat(av.F) + ' on ' + av.dfb + ' and ' + av.dfw + ' degrees of freedom, ' + pEq(av.p) + ': ' +
          (rejects ? 'the means are not all equal at this level.' : 'insufficient evidence of a difference among the means at this level.') +
          (av.F === Infinity ? ' ' + left + ', and so F is infinite.' : '')));
    }
    // The pooled procedures assume one variance across designs; Levene's test
    // checks that without assuming normality, which the F ratio of two
    // variances would.
    const lv = levene(groups);
    tables.push({ section: 'anova', name: 'Equal-variance test (Levene)', headers: ['statistic', 'value'], rows: [['F', lv.F], ['df1', lv.df1], ['df2', lv.df2], ['p', lv.p], ['center', 'median']] });
    // The residuals, with the design means and, under pairing, the block
    // effects removed, are what the F test and the post-hoc rules take as normal.
    // With no spread left within the designs (ssw taken as 0) every residual is
    // 0; computed, they would be rounding error.
    const resid = [];
    groups.forEach((g, i) => { for (let r = 0; r < g.length; r++) resid.push(av.ssw === 0 ? 0 : g[r] - av.means[i] - (paired ? av.blockMeans[r] - av.grandMean : 0)); });
    b.appendChild(assumptionChecks({ sets: [{ name: 'the residuals', values: resid }], alpha, pooled: !welch, varianceSets: groups, linkDs: list[0].id,
      alternative: 'Welch’s analysis of variance, which pools nothing (the Variances switch above)',
      procedure: welch ? 'Welch’s analysis of variance' : 'the analysis of variance', declared: 'between designs cannot be checked from the data; it is what the Replications switch declares.' }));
    const levTxt = Number.isNaN(lv.p) ? 'cannot be computed (no spread within any design to compare)' : pEq(lv.p);
    if (welch) b.appendChild(para('exp-note', 'Levene’s test ' + (Number.isNaN(lv.p) ? levTxt : 'gives ' + levTxt) + ' here; Welch’s procedure does not assume equal variances, and so that test is not among its checks.'));
    // The residuals' own quantile–quantile plot: the Normality section shows
    // one design's outcomes at a time, and the F test's assumption is about
    // all the residuals together.
    // Kept folded away unless the check rejects, when it opens itself.
    const swResid = resid.length >= 3 && resid.length <= 5000 && Math.min(...resid) < Math.max(...resid) ? shapiroWilk(resid) : null;
    const residBad = !!swResid && swResid.p < alpha;
    const fold = document.createElement('details');
    fold.className = 'why' + (residBad ? ' issues' : '');
    fold.open = residBad;
    fold.innerHTML = '<summary>Residuals from every checked design, normal quantile–quantile plot' + (residBad ? ' (opened because the check rejected)' : '') + '</summary><div class="why-body"></div>';
    b.appendChild(fold);
    figure(fold.querySelector('.why-body'), { height: 280, narrowHeight: 280, xLabel: 'Standard normal quantile', yLabel: 'Residual' }, 'several-residual-qq',
      fg => qqPlot(fg, normalQQ(resid)),
      [{ swatch: 'dot', color: '--est', label: 'one residual (an outcome less its design’s mean' + (paired ? ' and its replication’s effect' : '') + ')' }, { swatch: 'dash', color: '--truth', label: 'line through the quartiles' }],
      'The residuals are what ' + (welch ? 'Welch’s F' : 'the F test') + ' and the post-hoc rules take as normal, and the Shapiro–Wilk check above tests them together. Points that follow the line are consistent with normality; a bend at either end is a heavier or lighter tail. The Normality section of Summary and Plots shows each design’s outcomes on its own.');
    b = bodies[4];
    let critTxt;
    if (welch && ruleW === 'gameshowell') critTxt = 'Games–Howell: each pair’s critical difference is q·SE<sub>ij</sub>/√2, with q the studentized range quantile (k = ' + k + ') on that pair’s own Welch degrees of freedom.';
    else if (welch) critTxt = 'Bonferroni on Welch pairs: t at 1 − α/(2C) with C = ' + ph.pairs.length + ' on each pair’s own Welch degrees of freedom, and each pair’s critical difference is t·SE<sub>ij</sub>.';
    else if (rule === 'tukey') critTxt = 'Tukey–Kramer: the studentized range quantile is q = ' + num(ph.crit) + ' (k = ' + k + ', ' + av.dfw + ' df), and each pair’s critical difference is q·SE/√2.';
    else if (rule === 'lsd') critTxt = 'Fisher’s LSD: t = ' + num(ph.crit) + ' at 1 − α/2 on ' + av.dfw + ' df, and each pair’s critical difference is t·SE.';
    else if (rule === 'bonferroni') critTxt = 'Bonferroni: t = ' + num(ph.crit) + ' at 1 − α/(2C) with C = ' + ph.pairs.length + ' on ' + av.dfw + ' df, and each pair’s critical difference is t·SE.';
    else critTxt = 'Dunnett: each design against the control, ' + esc(short[ctrlIdx]) + ', with the two-sided critical value d = ' + num(ph.crit) + ' on ' + av.dfw + ' df; each pair’s critical difference is d·SE.';
    b.appendChild(para('cmp-lead', critTxt + (welch ? ' SE<sub>ij</sub> = √(s<sub>i</sub>²/R<sub>i</sub> + s<sub>j</sub>²/R<sub>j</sub>) uses each design’s own variance.' : paired ? ' SE = √(MSE · 2/R) uses the residual mean square, with the replication effect removed.' : ' SE = √(MSW (1/R<sub>i</sub> + 1/R<sub>j</sub>)) uses the pooled mean square within.')));
    if (rule === 'lsd' && ph.protected === false) b.appendChild(notice('warn', esc(ph.note)));
    else b.appendChild(para('exp-note', esc(ph.note)));
    const lab = p => pairLabel(p.i, p.j);
    const full = p => list[p.i].name + ' − ' + list[p.j].name;
    const anyFlag = ph.pairs.some(p => p.flagged), anyPlain = ph.pairs.some(p => !p.flagged);
    // Tukey, Bonferroni, and Dunnett do not wait for the F test, and near the
    // boundary they can flag a pair the F test did not detect.
    if (!rejects && anyFlag) b.appendChild(para('exp-note', 'The F test and this rule ask different questions: F asks whether any of the means differ, and ' + (welch ? WELCH_RULE_PROSE[ruleW] : RULE_PROSE[rule]) + (!welch && rule === 'dunnett' ? ' asks about each design against the control' : ' asks about each pair') + ' on its own, without waiting for F. Near the boundary, the two can disagree, as they do here.'));

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
        ' Each interval is the ' + levelPct(sm.perLevel) + ' simultaneous interval from the Means section, and the rows run from the ' + (dir === 'min' ? 'smallest' : 'largest') + ' mean down.' +
        ' Whether two designs differ is read from the intervals on their difference below, never from whether their own intervals overlap: two overlapping intervals can belong to a pair declared different, and two that do not overlap are not a test of anything.');
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
      'Each row is a difference of means ± its critical difference under ' + (welch ? WELCH_RULE_PROSE[ruleW] : RULE_PROSE[rule]) + '. ' +
      (rule === 'lsd' && !welch && ph.protected === false ? 'Because the F test did not reject, no pair is declared different, even where an interval excludes 0. ' : 'A red dashed row is a pair the rule declares different. ') +
      (welch ? 'These procedures assume normal replication outcomes and let each design keep its own variance.'
        : 'These procedures assume normal replication outcomes with equal variances across designs; when the variances clearly differ, switch Variances to unequal above or use the Welch intervals of the Pairwise comparisons section.'));
    const rows = ph.pairs.map(p => ['<span class="sev-pair">' + esc(lab(p)) + '</span>', '<span class="sev-full">' + esc(full(p)) + '</span>', num(p.diff), num(p.se)].concat(welch ? [num(p.df)] : [], [num(p.hw), interval(p.lo, p.hi), p.flagged ? '<span class="cmp-flag">yes</span>' : 'no']));
    b.appendChild(table(['Pair', 'Designs', 'Difference', 'SE'].concat(welch ? [DF_LABEL] : [], ['Critical difference', 'Interval', 'Different?']), rows));
    if (welch) tables.push({ section: 'anova', name: 'Welch ANOVA', headers: ['test', 'F', 'df1', 'df2', 'p'], rows: [['Welch F for equal means', av.F, av.df1, av.df2, av.p]] });
    else tables.push({ section: 'anova', name: paired ? 'ANOVA (replication as block)' : 'ANOVA', headers: ['source', 'SS', 'df', 'MS', 'F', 'p'], rows: [
      ['between designs', av.ssb, av.dfb, av.msb, av.F, av.p],
      paired ? ['between replications (blocks)', av.ssblk, av.dfblk, av.msblk, av.Fblock, av.pBlock] : null,
      [paired ? 'residual' : 'within designs', av.ssw, av.dfw, av.msw, '', ''], ['total', av.sst, totalDf, '', '', '']].filter(Boolean) });
    tables.push({ section: 'anova', name: 'Post-hoc: ' + ruleName, headers: ['pair', 'difference', 'se', 'df', 'critical value', 'critical difference', 'lower', 'upper', 'p', 'different'],
      rows: ph.pairs.map(p => [list[p.i].name + ' - ' + list[p.j].name, p.diff, p.se, welch ? p.df : av.dfw, welch ? p.crit : ph.crit, p.hw, p.lo, p.hi, welch ? p.p : '', p.flagged ? 'yes' : 'no']) });
    // The letters are read off the design plot; the table exists only as an
    // export, where nothing can be hovered.
    if (ph.letters) {
      const order = list.map((_, i) => i).sort((x, y) => dir === 'min' ? av.means[x] - av.means[y] : av.means[y] - av.means[x]);
      tables.push({ section: 'anova', name: 'Compact letter display: ' + ruleName, headers: ['design', 'mean', 'letters'], rows: order.map(i => [list[i].name, av.means[i], ph.letters[i]]) });
    }
    summary.push('Levene: ' + levTxt + '. ' + (welch ? 'Welch ANOVA' : 'ANOVA') + ': ' + (Number.isNaN(av.F) ? 'F cannot be computed' : 'F = ' + stat(av.F) + ', ' + pEq(av.p)) + '. ' + ruleName + ': ' +
      plural(ph.pairs.filter(p => p.flagged).length, 'pair', 'pairs') + ' declared different.');
  } else {
    const b = bodies[2];
    const kwr = paired ? null : kruskalWallis(groups);
    const fr = paired ? friedman(groups) : null;
    const dn = paired ? friedmanPairs(groups, { alpha, adjust }) : dunn(groups, { alpha, adjust });
    const omni = paired ? { stat: fr.chi2, df: fr.df, p: fr.p, ties: fr.ties } : { stat: kwr.H, df: kwr.df, p: kwr.p, ties: kwr.ties };
    b.appendChild(para('cmp-lead', 'The analysis of variance and its post-hoc rules compare means on the assumption that the replication outcomes are normal with one variance across designs. ' +
      (paired
        ? 'These rank procedures assume neither: Friedman’s test ranks the k designs within each replication, where common random numbers make the comparison fair, and asks whether some designs tend to rank higher than others.'
        : 'These rank procedures assume neither: they pool every outcome, rank the lot, and ask whether some designs tend to sit higher than others.') +
      ' They keep their level under heavy tails and give up little power under normal data, and so they are the place to turn when the Normality section rejects.'));
    b.appendChild(cardRow([
      card(paired ? 'χ²' : 'H', num(omni.stat), (paired ? 'Friedman statistic' : 'Kruskal–Wallis statistic') + (omni.ties ? ', tie-corrected' : '')),
      card(DF_LABEL, intl(omni.df), 'k − 1'),
      card('p', pValue(omni.p), 'chi-square approximation')
    ]));
    b.appendChild(para('cmp-verdict', (paired ? 'χ² = ' : 'H = ') + num(omni.stat) + ' on ' + plural(omni.df, 'degree') + ' of freedom, ' + pEq(omni.p) + ': ' +
      (omni.p < alpha ? (paired ? 'the designs do not all rank alike across the replications at this level.' : 'the designs do not all share one distribution at this level.') : 'insufficient evidence at this level that the designs differ.')));
    const adjName = adjust === 'holm' ? 'Holm’s step-down' : 'Bonferroni';
    const pairTest = paired ? 'Friedman’s pairwise comparison' : 'Dunn’s test';
    b.appendChild(para('cmp-lead', (paired
      ? 'Each pair’s difference of rank sums is standardized by √(R·k·(k + 1)/6), Siegel and Castellan’s procedure'
      : 'Dunn’s test compares each pair’s mean rank with a z statistic on the pooled rank variance' + (omni.ties ? ', tie-corrected' : '')) +
      (dn.C === 1 ? '; the one p-value is adjusted by ' : '; the ' + dn.C + ' p-values are adjusted by ') + adjName +
      ', and a pair is declared different when its adjusted p is below α = ' + aTxt + '. Like Tukey’s procedure, it does not wait for the omnibus test to reject.'));
    // Each design's pseudo-median with its Wilcoxon interval, best first,
    // carrying Dunn's letters and brackets.
    const hl = groups.map(g => signedRank(g, { level }));
    const orderN = list.map((_, i) => i).sort((x, y) => dir === 'min' ? hl[x].estimate - hl[y].estimate : hl[y].estimate - hl[x].estimate);
    const posN = [];
    orderN.forEach((i, r) => { posN[i] = r; });
    const rowsN = orderN.map(i => ({ label: numLabel(i, short), full: list[i].name, mean: hl[i].estimate, lo: hl[i].lo, hi: hl[i].hi, letter: dn.letters[i] }));
    const pairsN = dn.pairs.filter(p => p.flagged).map(p => [Math.min(posN[p.i], posN[p.j]), Math.max(posN[p.i], posN[p.j])]);
    b.appendChild(para('sev-fig-title', 'Designs, best first, with the letter groups and the pairs declared different'));
    const legN = [{ swatch: 'interval', color: '--est', label: 'design pseudo-median with its own ' + L + ' Wilcoxon signed-rank interval' }];
    if (pairsN.length) legN.push({ svg: bracketSwatch(tok('--miss')), label: 'pairs declared different by ' + pairTest + ' (bracket)' });
    figure(b, { height: 8 + 40 + k * 30, narrowHeight: 8 + 40 + k * 32, margin: { t: 8, b: 40 }, xLabel: 'Pseudo-median of ' + list[0].response }, paired ? 'several-friedman-groups' : 'several-dunn-groups',
      fg => designRows(fg, rowsN, pairsN), legN,
      'Each row is one design’s pseudo-median, the Hodges–Lehmann estimate (the median of the pairwise averages of its outcomes), with its own ' + L + ' Wilcoxon signed-rank interval, from the ' + (dir === 'min' ? 'smallest' : 'largest') + ' down. ' +
      'The letters and brackets come from ' + pairTest + ' on the ranks, not from the intervals: designs that share a letter are not declared different, and a bracket joins a pair that is.');
    const labN = p => pairLabel(p.i, p.j);
    const fullN = p => list[p.i].name + ' − ' + list[p.j].name;
    const rowsD = dn.pairs.map(p => ['<span class="sev-pair">' + esc(labN(p)) + '</span>', '<span class="sev-full">' + esc(fullN(p)) + '</span>', num(p.diff), num(p.se), num(p.z), pValue(p.p), pValue(p.pAdj),
      p.flagged ? '<span class="cmp-flag">yes</span>' : 'no']);
    b.appendChild(table(['Pair', 'Designs', paired ? 'Rank-sum difference' : 'Mean-rank difference', 'SE', 'z', 'p', 'Adjusted p', 'Different?'], rowsD));
    tables.push(paired ? { name: 'Rank test (Friedman)', headers: ['chi-square', 'df', 'p'], rows: [[fr.chi2, fr.df, fr.p]] }
      : { name: 'Rank test (Kruskal-Wallis)', headers: ['H', 'df', 'p'], rows: [[kwr.H, kwr.df, kwr.p]] });
    tables.push({ section: 'anova', name: 'Pairwise rank comparisons (' + (paired ? 'Friedman' : 'Dunn') + ', ' + adjName + ')', headers: ['pair', paired ? 'rank sum difference' : 'mean rank difference', 'se', 'z', 'p', 'adjusted p', 'different'],
      rows: dn.pairs.map(p => [list[p.i].name + ' - ' + list[p.j].name, p.diff, p.se, p.z, p.p, p.pAdj, p.flagged ? 'yes' : 'no']) });
    tables.push({ section: 'anova', name: 'Pseudo-medians with Wilcoxon intervals', headers: ['design', 'pseudo-median', 'lower', 'upper', 'letters'],
      rows: orderN.map(i => [list[i].name, hl[i].estimate, hl[i].lo, hl[i].hi, dn.letters[i]]) });
    summary.push((paired ? 'Friedman: χ² = ' : 'Kruskal–Wallis: H = ') + num(omni.stat) + ', ' + pEq(omni.p) + '. ' + (paired ? 'Pairwise' : 'Dunn') + ' (' + adjName + '): ' + plural(dn.pairs.filter(p => p.flagged).length, 'pair', 'pairs') + ' declared different.');
  
  }

  // The screen for the best.
  if (np) bodies[3].appendChild(para('cmp-lead', 'The screen is a procedure on sample means and standard deviations, and it has no rank version here; it is shown unchanged.'));
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
        : 'These designs cannot be distinguished from the best within ε on these data: ' + andList(short.filter((_, i) => ss.survivors[i])) +
          '. Running the additional replications listed would let a second stage choose among them.';
      b.appendChild(para('cmp-verdict', esc(verdict)));
      const orderS = list.map((_, i) => i).sort((x, y) => dir === 'min' ? ss.means[x] - ss.means[y] : ss.means[y] - ss.means[x]);
      const rowsS = orderS.map(i => ({ label: numLabel(i, short), full: list[i].name, mean: sm.items[i].mean, lo: sm.items[i].lo, hi: sm.items[i].hi, letter: ss.survivors[i] ? 'survives' : 'eliminated', letterColor: ss.survivors[i] ? tok('--ok') : tok('--muted'), keep: ss.survivors[i],
        note: (ss.survivors[i] ? 'survives the screen' : 'eliminated by the screen') + '; its mean had to reach ' + num(ss.cutoff[i]) }));
      figure(b, { height: 8 + 40 + k * 30, narrowHeight: 8 + 40 + k * 32, margin: { t: 8, b: 40 }, xLabel: 'Mean of ' + list[0].response }, 'several-best-subset',
        fg => designRows(fg, rowsS, []),
        [nSurv ? { swatch: 'interval', color: '--ok', label: 'survives the screen: cannot be ruled out as the best' } : null,
          nSurv < k ? { swatch: 'flagged', color: '--muted', label: 'eliminated by the screen (dashed, hollow)' } : null].filter(Boolean),
        'Each row is one design, best sample mean first, with its mean and the same ' + levelPct(sm.perLevel) + ' simultaneous interval as the Means section. ' +
        'The screen compares the means: a design is eliminated when another design’s mean beats it by more than the screen allows for the two designs’ spread, and the designs still in color cannot be ruled out as the best within ε at this confidence. ' +
        'Whether a design survives is written at the right of its row, drawn solid in color when it does and dashed and hollow in gray when it does not, and never read from whether intervals overlap.');
      const rows = list.map((_, i) => [badge(i) + ' ' + esc(short[i]), intl(ss.n[i]), num(ss.means[i]), num(Math.sqrt(ss.s2[i])),
        ss.survivors[i] ? '<span class="cmp-ok">yes</span>' : 'no', ss.N[i] === null ? dash : intl(ss.N[i]), ss.additional[i] === null ? dash : intl(ss.additional[i])]);
      b.appendChild(table(['Design', 'R', 'Mean', 's', 'Survives?', 'N needed', 'Additional replications'], rows, i => (ss.survivors[i] ? '' : 'cmp-mute')));
      b.appendChild(para('exp-note', 'N is the total number of replications Rinott’s second stage needs for each survivor, max(R, ⌈(h·s/ε)²⌉) with h = ' + num(ss.h) +
        '; the screen’s t = ' + num(ss.t) + '. A smaller ε asks for more replications, in proportion to 1/ε².'));
      // The screen's allowances and Rinott's sizes are t procedures on each design's own mean and variance.
      b.appendChild(assumptionChecks({ sets: designSets, alpha, procedure: 'the screen', declared: 'between designs cannot be checked from the data; it is what the Replications switch declares.' }));
      tables.push({ section: 'subset', name: 'Screen for the best', headers: ['design', 'R', 'mean', 's', 'survives', 'N needed', 'additional replications'],
        rows: list.map((d, i) => [d.name, ss.n[i], ss.means[i], Math.sqrt(ss.s2[i]), ss.survivors[i] ? 'yes' : 'no', ss.N[i] === null ? '' : ss.N[i], ss.additional[i] === null ? '' : ss.additional[i]]) });
      summary.push(verdict);
    }
  }

  const units = Array.from(new Set(list.map(d => d.unit || '')));
  // Under pairing the half-width plan works on the standard deviations of
  // the paired differences, and the power plan on the blocked F test.
  const sdDs = paired ? fam.comparisons.map(c => ({ i: c.i, j: c.j, sd: c.se * Math.sqrt(c.df + 1) })) : null;
  planCtx = { key: list.map(d => d.id).join('|') + (paired ? '|paired' : ''), k, ns, short, ctrlIdx, unit: units.length === 1 ? units[0] : '',
              sds: sm.items.map(it => it.sd), widest: Math.max(...fam.comparisons.map(c => c.hw)), meanHw: Math.max(...sm.items.map(it => it.hi - it.mean)),
              sigma: Math.sqrt(av.msw), grandMean: av.grandMean, paired, sdDs };
  registerTips(rootEl);
  resultBase = {
    title: 'Several Systems',
    provenance: {
      datasets: list.map(d => d.name).join('; '),
      'confidence level': lvl(level),
      direction: dir === 'min' ? 'smaller is better' : 'bigger is better',
      'comparisons adjusted for': fam.C,
      'difference family': diffMode === 'pairs' ? 'all pairs' : 'versus control',
      procedure: np ? 'nonparametric (Wilcoxon, ' + (paired ? 'Friedman' : 'Kruskal–Wallis and Dunn') + ')' : 't procedures',
      'post-hoc rule': np ? 'not applicable' : welch ? WELCH_RULES[ruleW] : RULES[rule],
      variances: np ? 'not applicable' : welch ? 'unequal (Welch)' : 'pooled',
      replications: paired ? 'paired across designs, matched by ' + (match.by === 'id' ? 'replication id' : 'position') + ' (' + plural(match.blocks.length, 'block') + ')' : 'independent',
      'Dunn adjustment': adjust === 'holm' ? 'Holm' : 'Bonferroni',
      control: list[ctrlIdx].name,
      benchmark: benchOn && Number.isFinite(benchVal) ? benchVal : 'none',
      'indifference zone': Number.isFinite(eps) ? eps : ''
    },
    tables,
    summaryHtml: summary.map(s => '<p>' + s + '</p>').join(''),
    // What the regenerate scripts are built from; drawPlan() keeps it out of the registered result.
    recipeIn: { list, groups, paired, match, proc, varMode, rule, ruleW, adjust, diffMode, ctrlIdx, dir,
                bench: benchOn && Number.isFinite(benchVal) ? benchVal : null, eps }
  };
  drawPlan();
  release();
}

// Redraws the planning card from the context update() left, and registers
// the page's result with its planning table.
function drawPlan() {
  if (!rootEl) return;
  const c = planCtx && !planCtx.msg ? planCtx : null;
  const msg = planCtx && planCtx.msg ? planCtx.msg : 'Check two or more designs above to plan replications.';
  if (c && c.key !== plan.key) {
    plan.key = c.key;
    plan.hwUser = storedTarget('target', c.key); plan.mhwUser = storedTarget('mtarget', c.key); plan.deltaUser = storedTarget('delta', c.key);
  }
  const level = state.settings.base, alpha = 1 - level;
  const unit = c && c.unit ? ' ' + c.unit : '';
  const unitNote = c && c.unit ? c.unit : 'in the response’s units';
  // Additional replications are counted beyond the largest current count,
  // and the power at the current count uses the smallest.
  const R = c ? Math.max(...c.ns) : NaN, Rlo = c ? Math.min(...c.ns) : NaN;
  const same = !c || R === Rlo;
  const rText = same ? 'the current R = ' + intl(R) : 'the largest current R = ' + intl(R);
  const equalNote = c && c.paired ? '' : ', with equal replications in each design';
  // A rank procedure is sized from the t plan: n times pi/3, rounded up.
  const npOn = proc === 'np';
  const inflate = n => (n == null ? null : npOn ? Math.ceil(n * Math.PI / 3) : n);
  const ranked = n => (npOn && n != null ? n : null);
  const cards = { means: rootEl.querySelector('#sev-plan-means'), diffs: rootEl.querySelector('#sev-plan-diffs'), anova: rootEl.querySelector('#sev-plan-anova') };
  for (const k in cards) cards[k].querySelector('.plan-np').textContent = npOn ? NP_PLAN : '';
  const tables = [];
  let mText, hText, dText, family, C;
  // The planning targets in force, which the regenerate scripts carry as settings.
  let meansH = null, diffsH = null, planDelta = null;

  // The means: every design's own interval at 1 − α/k; the design with the
  // largest standard deviation has the widest, and so sets the count.
  {
    const sec = cards.means;
    const k = c ? c.k : NaN;
    const hwDef = c ? round2(c.meanHw / 2) : NaN;
    const hwVal = c ? (plan.mhwUser != null ? plan.mhwUser : hwDef) : null;
    meansH = hwVal;
    syncSpin(plan.mhwSlot, sec.querySelector('.plan-hw-host'), 'sev-plan-mhw', 'Target half-width', stepFor(hwDef), hwVal,
      v => { plan.mhwUser = v; if (plan.key) state.setPick(id, 'mtarget:' + plan.key, v); drawPlan(); });
    sec.querySelector('.plan-hw-unit').textContent = unitNote;
    sec.querySelector('.plan-hw-def').textContent = 'The default' + (c ? ', ' + num(hwDef) + ',' : '') +
      ' is half the widest current half-width; halving a half-width takes about four times the replications.';
    let hp = { n: null, hwAtN: NaN }, note = esc(msg);
    const sMax = c ? Math.max(...c.sds) : NaN;
    if (c) {
      hp = planReplications({ sd: sMax, level: 1 - (1 - level) / k, target: hwVal });
      note = hp.n != null
        ? 'An estimate conditional on the largest current sample standard deviation, ' + num(sMax) + ', which sets the widest interval; not a guarantee, and a larger pilot can move it either way.'
        : esc(hp.reason || 'No replication count meets this target; choose a larger half-width.');
    }
    mText = 'h = ' + num(c ? hwVal : NaN) + unit;
    fillPane(sec,
      'Replications per design needed for a half-width of ' + esc(mText) + ' on every one of the k = ' + (c ? intl(k) : dash) + ' mean intervals above (each at 1 − α/k by Bonferroni), with equal replications in each design',
      planCards('hw', { n: inflate(hp.n), tN: ranked(hp.n), at: hp.hwAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'for the design with s = ' + num(sMax) }), note);
    if (c) tables.push({ section: 'means', name: 'Replications for the means', headers: PLAN_HEADERS, rows: [planRow('by half-width', mText + ' on each of k = ' + k + ' means', inflate(hp.n), hp.hwAtN, R)] });
  }

  // The differences: every Bonferroni interval of the current family.
  {
    const sec = cards.diffs;
    C = c ? (diffMode === 'control' ? c.k - 1 : c.k * (c.k - 1) / 2) : NaN;
    family = diffMode === 'control'
      ? 'each design against the control' + (c ? ', ' + c.short[c.ctrlIdx] : '')
      : 'all pairs';
    const hwDef = c ? round2(c.widest / 2) : NaN;
    const hwVal = c ? (plan.hwUser != null ? plan.hwUser : hwDef) : null;
    diffsH = hwVal;
    syncSpin(plan.hwSlot, sec.querySelector('.plan-hw-host'), 'sev-plan-hw', 'Target half-width', stepFor(hwDef), hwVal,
      v => { plan.hwUser = v; if (plan.key) state.setPick(id, 'target:' + plan.key, v); drawPlan(); });
    sec.querySelector('.plan-hw-unit').textContent = unitNote;
    sec.querySelector('.plan-hw-def').textContent = 'The default' + (c ? ', ' + num(hwDef) + ',' : '') +
      ' is half the widest current half-width; halving a half-width takes about four times the replications.';
    let hp = { n: null, hwAtN: NaN, pair: [] }, hwNote = esc(msg);
    if (c && c.paired) {
      // The widest paired interval belongs to the pair whose differences vary most.
      const worst = c.sdDs.reduce((a, b) => (b.sd > a.sd ? b : a));
      const pr = planReplications({ sd: worst.sd, level: 1 - (1 - level) / C, target: hwVal });
      hp = { n: pr.n, hwAtN: pr.hwAtN, pair: [worst.i, worst.j], reason: 'No replication count meets this target; choose a larger half-width.' };
      hwNote = hp.n != null
        ? 'An estimate conditional on the current sample standard deviations of the paired differences, up to ' + num(worst.sd) + ', not a guarantee; a larger pilot can move it either way.'
        : esc(hp.reason);
    } else if (c) {
      hp = planHalfWidthBonferroni({ sds: c.sds, level, mode: diffMode, control: c.ctrlIdx, target: hwVal });
      const sMin = Math.min(...c.sds), sMax = Math.max(...c.sds);
      hwNote = hp.n != null
        ? 'An estimate conditional on the current sample standard deviations of the ' + word(c.k) + ' designs, from ' + num(sMin) + ' to ' + num(sMax) +
          ', not a guarantee; a larger pilot can move it either way.'
        : esc(hp.reason);
    }
    hText = 'h = ' + num(c ? hwVal : NaN) + unit;
    const widestPair = hp.n != null ? esc(c.short[hp.pair[0]] + ' − ' + c.short[hp.pair[1]]) : dash;
    fillPane(sec,
      'Replications per design needed for a half-width of ' + esc(hText) + ' on every one of the C = ' + (c ? intl(C) : dash) +
        (c && c.paired ? ' paired ' : ' ') + 'pairwise differences above (each at 1 − α/C by Bonferroni; ' + esc(family) + ')' + equalNote,
      planCards('hw', { n: inflate(hp.n), tN: ranked(hp.n), at: hp.hwAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'widest: ' + widestPair }), hwNote);
    if (c) tables.push({ section: 'diffs', name: 'Replications for the differences', headers: PLAN_HEADERS, rows: [planRow('by half-width', hText + ' on ' + family + ' (C = ' + C + ')', inflate(hp.n), hp.hwAtN, R)] });
  }

  // The analysis of variance: the F test's power with one design shifted by δ.
  {
    const sec = cards.anova;
    const g = c ? Math.abs(c.grandMean) : NaN;
    const dDef = c ? (g > 0 ? round2(0.1 * g) : round2(0.25 * c.sigma)) : NaN;
    const delta = c ? (plan.deltaUser != null ? plan.deltaUser : dDef) : null;
    planDelta = delta;
    syncSpin(plan.deltaSlot, sec.querySelector('.plan-delta-host'), 'sev-plan-delta', 'Shift to detect δ', stepFor(dDef), delta,
      v => { plan.deltaUser = v; if (plan.key) state.setPick(id, 'delta:' + plan.key, v); drawPlan(); });
    sec.querySelector('.plan-delta-unit').textContent = unitNote;
    let pp = { n: null, powerAtN: NaN }, cur = NaN, pwNote = esc(msg);
    if (c) {
      pp = planPowerAnova({ k: c.k, sigma: c.sigma, delta, alpha, power: plan.power, blocked: c.paired });
      cur = c.sigma > 0 ? powerAnova({ n: Rlo, k: c.k, sigma: c.sigma, delta, alpha, blocked: c.paired }) : NaN;
      pwNote = pp.n != null
        ? 'This is the ' + (c.paired ? 'blocked ' : '') + 'F test’s power when one design is shifted by δ and the others share a mean; the second-stage counts in the Screen for the best section are a third way to set replications, by selection. ' +
          'An estimate conditional on the current ' + (c.paired ? 'residual standard deviation, √MSE = ' : 'pooled sample standard deviation, √MSW = ') + num(c.sigma) + ', not a guarantee; a larger pilot can move it either way.'
        : esc(pp.reason);
    }
    dText = 'δ = ' + num(c ? delta : NaN) + unit;
    fillPane(sec,
      'Replications per design needed to detect one design shifted by ' + esc(dText) + ' from the others with ' + powerPct(plan.power) +
        ' power, by the ' + (c && c.paired ? 'blocked' : 'one-way') + ' ANOVA F test at α = ' + num(alpha) + equalNote,
      planCards('power', { n: inflate(pp.n), tN: ranked(pp.n), at: pp.powerAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'at ' + esc(dText), cur,
        curNote: same ? 'at R = ' + intl(Rlo) + ' per design' : 'at the smallest current R = ' + intl(Rlo) }), pwNote);
    if (c) tables.push({ section: 'anova', name: 'Replications for the F test', headers: PLAN_HEADERS, rows: [planRow('by power', dText + ', ' + powerPct(plan.power) + ' power, α = ' + num(alpha), inflate(pp.n), pp.powerAtN, R)] });
  }

  if (!resultBase) { state.setResult('several', null); return; }
  const prov = Object.assign({}, resultBase.provenance, {
    'planning replications': 'equal per design' + (npOn ? ', the t plan inflated by pi/3 for the rank procedures' : ''),
    'planning half-width target (means)': mText,
    'planning half-width target (differences)': hText,
    'planning comparisons': family + ', C = ' + C,
    'planning shift to detect': dText,
    'planning target power': powerPct(plan.power),
    'planning significance level': num(alpha)
  });
  // The scripts that regenerate these results are written only when asked
  // for, from the inputs and settings in force now.
  const { recipeIn, ...result } = resultBase;
  const planIn = { meansH, diffsH, delta: planDelta, power: plan.power };
  const regen = recipeIn && c
    ? { tooBig: false, build: () => severalRecipe(Object.assign({}, recipeIn, { level, title: result.title, provenance: prov, plan: planIn })),
      files: recipeIn.list.map(d => ({ ds: d, form: 'replications' })) }
    : undefined;
  state.setResult('several', Object.assign(result, { provenance: prov, tables: result.tables.concat(tables), regen }));
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Compare two or more designs at once on their replication outcomes: each mean with an interval that holds jointly with the others, every difference with a Bonferroni-adjusted interval, ' +
    'one-way analysis of variance with a post-hoc rule, and a screen for the designs that could be the best. Every procedure here takes the designs as run on independent random streams unless the switch below says the replications are paired across designs (common random numbers): then the differences are paired t intervals, the analysis of variance removes the replication effect as a block, and Friedman’s test replaces Kruskal–Wallis.</p>' +
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
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-lbl" id="sev-pair-lbl"><span class="tip" tabindex="0" data-tip="Independent: each design was run on its own random streams. Paired: replication i of every design used the same random inputs (common random numbers across designs), and so each replication is a block. The differences then become paired t intervals, the analysis of variance removes the replication effect before judging the designs, and Friedman’s test replaces Kruskal–Wallis. The screen for the best works either way.">Replications are</span></span>' +
        '<span class="seg" role="group" aria-labelledby="sev-pair-lbl">' +
          '<button type="button" class="seg-btn" data-pair="independent" aria-pressed="true">Independent</button>' +
          '<button type="button" class="seg-btn" data-pair="paired" aria-pressed="false">Paired across designs</button>' +
        '</span>' +
      '</div>' +
      '<div class="ctrl-row" id="sev-match-row" style="display:none">' +
        '<span class="ctrl-lbl" id="sev-match-lbl">Match by</span>' +
        '<span class="seg" role="group" aria-labelledby="sev-match-lbl">' +
          '<button type="button" class="seg-btn" data-match="id" aria-pressed="true">replication id</button>' +
          '<button type="button" class="seg-btn" data-match="position" aria-pressed="false">position</button>' +
        '</span>' +
        '<span class="ctrl-note" id="sev-match-note"></span>' +
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-lbl" id="sev-proc-lbl"><span class="tip" tabindex="0" data-tip="t procedures: intervals on means by the t distribution, the analysis of variance, and its post-hoc rules, all assuming normal replication outcomes. Nonparametric: the same sub-items by ranks, with Wilcoxon intervals on pseudo-medians and shifts, Kruskal–Wallis or Friedman in place of the analysis of variance, and Dunn’s or Friedman’s pairwise comparisons in place of the post-hoc rules; they need no normality and keep their level under heavy tails. The screen for the best has no rank version and is shown unchanged.">Procedure</span></span>' +
        '<span class="seg" role="group" aria-labelledby="sev-proc-lbl">' +
          '<button type="button" class="seg-btn" data-proc="t" aria-pressed="true">t procedures</button>' +
          '<button type="button" class="seg-btn" data-proc="np" aria-pressed="false">Nonparametric (Wilcoxon)</button>' +
        '</span>' +
      '</div>' +
      '<div id="sev-pairnote"></div>' +
      '<div id="sev-excluded"></div>' +
      '<div id="sev-mixed"></div>' +
    '</div>' +
    '<p class="unit-line" id="sev-unit"></p>' +
    '<p class="sev-key" id="sev-key"></p>' +
    '<div class="ctrl-grp-lbl subnav-lbl">Analysis</div>' +
    '<div class="subnav" data-subnav></div>' +
    '<div class="sec" data-section="means"><h3 class="sec-title">Benchmark comparison</h3><p class="sec-lede">Every design against a benchmark at once. Each design’s mean comes with its own interval, and the k intervals hold together by the Bonferroni correction, each at level 1 − α/k, which holds the chance of any false rejection across the k tests at α. The designs are not compared with each other here. The benchmark can be drawn on the plot, which marks every interval that excludes it, or kept in mind and read against the intervals.</p>' +
      '<div class="ctrl-row" id="sev-bench-row"><label class="ctrl-chk"><input type="checkbox" id="sev-bench-on"> <span class="tip" tabindex="0" data-tip="The benchmark is a target or requirement for the response, in its units, and the k intervals are built for it whether or not it is drawn. Drawn, it is a dashed line that can be dragged (the arrow keys move it when it has focus), and every design whose interval excludes it is marked above or below it.">Show benchmark on plot</span></label>' +
        '<span class="ctrl-pair" id="sev-bench-pair" hidden><label class="ctrl-lbl" for="sev-bench">Benchmark</label><span id="sev-bench-host"></span><span class="ctrl-note" id="sev-bench-unit"></span></span></div>' +
      '<div id="sev-means-body"></div><div class="plan-sub plan-card" id="sev-plan-means"></div></div>' +
    '<div class="sec" data-section="diffs"><h3 class="sec-title">Pairwise comparisons</h3><p class="sec-lede">Every pair’s difference, or each design against a control, each with its own interval. The C intervals hold together by the Bonferroni correction, each at level 1 − α/C: nothing is pooled and no analysis of variance comes first.</p>' +
      '<div class="ctrl-row"><span class="ctrl-lbl" id="sev-diff-lbl">Compare</span><span class="seg" role="group" aria-labelledby="sev-diff-lbl">' +
        '<button type="button" class="seg-btn" data-diff="pairs" aria-pressed="true">all pairs</button>' +
        '<button type="button" class="seg-btn" data-diff="control" aria-pressed="false">versus control</button>' +
      '</span>' +
      '<span class="ctrl-pair" id="sev-ctrl-diff"><label class="ctrl-lbl" for="sev-ctrl"><span class="tip" tabindex="0" data-tip="The design every other design is compared with, usually the current system.">Control</span></label><select id="sev-ctrl" data-control></select></span>' +
      '</div>' +
      '<div id="sev-diffs-body"></div><div class="plan-sub plan-card" id="sev-plan-diffs"></div></div>' +
    '<div class="sec" data-section="anova"><h3 class="sec-title" id="sev-anova-hd">Analysis of variance and post-hoc tests</h3><p class="sec-lede">One test of whether any of the means differ and then a post-hoc rule that judges each pair.</p>' +
      '<div class="ctrl-row" id="sev-adj-row" style="display:none"><span class="ctrl-lbl" id="sev-adj-lbl"><span class="tip" tabindex="0" data-tip="How the pairwise p-values are adjusted for the number of pairs. Bonferroni multiplies each by the number of pairs; Holm’s step-down holds the same family-wise error and is never less powerful.">Adjustment</span></span>' +
        '<span class="seg" role="group" aria-labelledby="sev-adj-lbl">' +
          '<button type="button" class="seg-btn" data-adj="bonferroni" aria-pressed="true">Bonferroni</button>' +
          '<button type="button" class="seg-btn" data-adj="holm" aria-pressed="false">Holm</button>' +
        '</span></div>' +
      '<div class="ctrl-row" id="sev-var-row"><span class="ctrl-lbl" id="sev-var-lbl"><span class="tip" tabindex="0" data-tip="Pooled: the classical analysis of variance, one variance across designs, with Tukey, LSD, Bonferroni, and Dunnett post-hoc rules on the pooled mean square. Unequal: Welch’s analysis of variance, each design keeping its own variance, with Games–Howell or Bonferroni on Welch pairs; the choice when the heteroscedasticity check rejects. Pairing has no Welch form, and so the switch is withheld under paired replications.">Variances</span></span>' +
        '<span class="seg" role="group" aria-labelledby="sev-var-lbl">' +
          '<button type="button" class="seg-btn" data-var="pooled" aria-pressed="true">Pooled (one variance)</button>' +
          '<button type="button" class="seg-btn" data-var="welch" aria-pressed="false">Unequal (Welch)</button>' +
        '</span></div>' +
      '<div id="sev-anova-body"></div>' +
      '<div id="sev-rule-host"></div>' +
      '<div id="sev-posthoc-body"></div><div class="plan-sub plan-card" id="sev-plan-anova"></div></div>' +
    '<div class="sec" data-section="subset"><h3 class="sec-title">Screen for the best</h3><p class="sec-lede">Which designs cannot be ruled out as the best within an indifference zone ε and how many more replications a second stage would need to choose among them.</p>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip" tabindex="0" data-tip="The smallest difference in means worth detecting, used by the screen and its second stage only. Designs whose means are within ε of the best count as good enough, and the screen and the second-stage sizes are set to it.">Indifference zone ε</span></span><span id="sev-eps-host"></span></span>' +
        '<span class="ctrl-note" id="sev-eps-note"></span>' +
        '<button type="button" class="btn-mini" id="sev-eps-reset" style="display:none">Use default</button>' +
      '</div>' +
      '<div id="sev-subset-body"></div></div>';

  // Each section's own planning card: the means and the differences are
  // sized by a target half-width, the analysis of variance by a target power.
  const meansControls = '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="The half-width you would like every design’s own interval above to have, in the response’s units. The widest interval belongs to the design with the largest standard deviation, and so that design sets the count.">Target half-width</span></span>' +
        '<span class="plan-hw-host"></span><span class="ctrl-note plan-hw-unit"></span></span>' +
      '<span class="ctrl-note plan-hw-def"></span>' +
    '</div>';
  root.querySelector('#sev-plan-means').innerHTML = subPlanMarkup(meansControls);
  root.querySelector('#sev-plan-diffs').innerHTML = subPlanMarkup('<div class="ctrl-row">' +
      '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="The half-width you would like every difference interval in the Pairwise comparisons section to have, in the response’s units. Bonferroni’s per-comparison level, 1 − α/C, is what makes this plan grow with the number of comparisons C.">Target half-width</span></span>' +
        '<span class="plan-hw-host"></span><span class="ctrl-note plan-hw-unit"></span></span>' +
      '<span class="ctrl-note plan-hw-def"></span>' +
    '</div>');
  root.querySelector('#sev-plan-anova').innerHTML = subPlanMarkup(powerControls('sev', 'Shift to detect δ',
      'How far one design’s true mean sits from the common mean of the others, in the response’s units, for the F test to detect. The default is 10% of the grand mean.'));
  for (const sid of ['diffs', 'anova']) root.querySelector('#sev-plan-' + sid).appendChild(details('Half-width or power?', PLAN_WHY));
  const powSel = root.querySelector('#sev-plan-pow');
  powSel.addEventListener('change', () => { plan.power = Number(powSel.value); state.setPick(id, 'power', plan.power); drawPlan(); });

  // The rule picker sits between the ANOVA table and the post-hoc results,
  // outside both redrawn bodies, and so it keeps focus across a redraw.
  const ruleRow = document.createElement('div');
  ruleRow.className = 'ctrl-row cmp-rule-row';
  ruleRow.innerHTML = '<span class="ctrl-pair"><label class="ctrl-lbl" for="sev-rule">Post-hoc rule</label><select id="sev-rule">' +
    Object.keys(RULES).map(r => '<option value="' + r + '">' + RULES[r] + '</option>').join('') + '</select></span>' +
    '<span class="ctrl-pair" id="sev-ctrl-rule"><label class="ctrl-lbl" for="sev-ctrl2"><span class="tip" tabindex="0" data-tip="The design Dunnett’s procedure compares every other design with, usually the current system.">Control</span></label><select id="sev-ctrl2" data-control></select></span>';
  root.querySelector('#sev-rule-host').appendChild(ruleRow);

  const subsetSec = root.querySelector('#sev-subset-body').parentNode;
  subsetSec.appendChild(details('How the screen works',
    '<p>The screen compares every design with every other. For designs i and j, it forms an allowance W<sub>ij</sub> = t·√(s<sub>i</sub>²/R<sub>i</sub> + s<sub>j</sub>²/R<sub>j</sub>), ' +
    'where t is the t quantile at (1 − α/2)<sup>1/(k−1)</sup> on R<sub>0</sub> − 1 degrees of freedom and R<sub>0</sub> is the smallest number of replications among the designs.</p>' +
    '<p>When bigger is better, design i survives when Ȳ<sub>i</sub> ≥ Ȳ<sub>j</sub> − max(0, W<sub>ij</sub> − ε) for every other design j: no design beats it by more than the noise allowance less the indifference zone. ' +
    'When smaller is better, the inequality is mirrored. The survivors contain the best design, or one within ε of it, with probability at least 1 − α/2.</p>' +
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
  ctrlSels = Array.from(root.querySelectorAll('select[data-control]'));
  for (const sel of ctrlSels) sel.addEventListener('change', () => { controlId = sel.value || null; state.setPick(id, 'control', controlId); schedule(); });
  root.querySelector('#sev-rule').addEventListener('change', e => {
    if (welchOn()) { ruleW = e.target.value; state.setPick(id, 'ruleW', ruleW); } else { rule = e.target.value; state.setPick(id, 'rule', rule); }
    schedule();
  });
  root.querySelectorAll('[data-var]').forEach(b => b.addEventListener('click', () => { varMode = b.dataset.var; state.setPick(id, 'variances', varMode); schedule(); }));
  root.querySelector('#sev-eps-reset').addEventListener('click', () => { epsUser = null; state.setPick(id, 'eps', null); schedule(); });
  root.querySelector('#sev-bench-on').addEventListener('change', e => { benchOn = e.target.checked; state.setPick(id, 'benchOn', benchOn); schedule(); });
  root.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { dir = b.dataset.dir; state.setPick(id, 'dir', dir); schedule(); }));
  root.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { diffMode = b.dataset.diff; state.setPick(id, 'diff', diffMode); schedule(); }));
  root.querySelectorAll('[data-adj]').forEach(b => b.addEventListener('click', () => { adjust = b.dataset.adj; state.setPick(id, 'adjust', adjust); schedule(); }));
  root.querySelectorAll('[data-pair]').forEach(b => b.addEventListener('click', () => { pairMode = b.dataset.pair; state.setPick(id, 'pairing', pairMode); schedule(); }));
  root.querySelectorAll('[data-proc]').forEach(b => b.addEventListener('click', () => { proc = b.dataset.proc; state.setPick(id, 'proc', proc); schedule(); }));
  root.querySelectorAll('[data-match]').forEach(b => b.addEventListener('click', () => { matchChoice = b.dataset.match; state.setPick(id, 'match', matchChoice); schedule(); }));
  applyStored();

  const visible = () => root.classList.contains('active');
  state.on('datasets', () => { applyStored(); autoCheck(); if (visible()) schedule(); });
  state.on('selection', () => { if (visible()) schedule(); });
  state.on('settings', () => { if (visible()) schedule(); });
  autoCheck();
  update();
  // The export row offers the tables of the section in view, and so it follows the strip.
  exportRow = installExportRow(root, id, { tables: t => !t.section || t.section === (currentSection() || 'means') });
}

// Whether the analysis of variance is Welch's: only for independent
// replications under the t procedures.
function welchOn() { return varMode === 'welch' && pairMode !== 'paired' && proc !== 'np'; }

// The post-hoc rule picker offers the pooled rules or the Welch ones, as the
// Variances switch says, and shows the choice in force for that set.
function fillRuleSelect() {
  const sel = rootEl.querySelector('#sev-rule');
  const set = welchOn() ? WELCH_RULES : RULES;
  const want = Object.keys(set).map(r => r + '=' + set[r]).join('|');
  if (sel.dataset.set !== want) {
    sel.innerHTML = Object.keys(set).map(r => '<option value="' + r + '">' + set[r] + '</option>').join('');
    sel.dataset.set = want;
  }
  sel.value = welchOn() ? ruleW : rule;
}

// Brings back the settings the reader made on this page (kept with the
// session) wherever they are valid. Every one is recorded when the reader
// changes it, and so applying them again on each change of the datasets
// changes nothing except after a reload.
function applyStored() {
  const get = k => state.getPick(id, k);
  if (Object.prototype.hasOwnProperty.call(RULES, get('rule'))) rule = get('rule');
  if (Object.prototype.hasOwnProperty.call(WELCH_RULES, get('ruleW'))) ruleW = get('ruleW');
  if (get('variances') === 'pooled' || get('variances') === 'welch') varMode = get('variances');
  if (get('dir') === 'max' || get('dir') === 'min') dir = get('dir');
  if (get('diff') === 'pairs' || get('diff') === 'control') diffMode = get('diff');
  if (get('adjust') === 'bonferroni' || get('adjust') === 'holm') adjust = get('adjust');
  if (get('pairing') === 'independent' || get('pairing') === 'paired') pairMode = get('pairing');
  if (get('proc') === 't' || get('proc') === 'np') proc = get('proc');
  if (get('match') === 'id' || get('match') === 'position') matchChoice = get('match');
  if (typeof get('control') === 'string') controlId = get('control');
  if (get('benchOn') === true) benchOn = true;
  const e = get('eps');
  if (typeof e === 'number' && Number.isFinite(e) && e > 0) epsUser = e;
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
export function onShow() { update(); if (exportRow) exportRow.refresh(); }
/** Called when the shown section changes; the export row offers that section's tables. */
export function onShowSection() { if (exportRow) exportRow.refresh(); }

export default { id, title, sections, render, onShow, onShowSection };
