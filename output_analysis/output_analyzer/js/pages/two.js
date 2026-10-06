// The Two Systems page: compares two designs on their replication outcomes,
// by Welch's or the pooled-variance t procedure when the replications are
// independent and by the paired t when they were run under common random
// numbers. Pairing is a
// switch the reader sets; the page never infers it from equal sample sizes.
// A card under the comparison plans the replications per design by a target
// half-width on the difference or by a target power.

import * as state from '../state.js';
import { repEstimates, repIds, canInfer } from '../data/model.js';
import { welch, pooledT, matchPairs, pairedT, planHalfWidthWelch, powerWelch, planPowerWelch,
         planHalfWidthPooled, powerPooled, planPowerPooled } from '../stats/compare.js';
import { tInterval, fRatio, planReplications, powerOneSample, planPowerOneSample } from '../stats/intervals.js';
import { rankSum, signedRank } from '../stats/nonparam.js';
import { summary } from '../stats/descriptive.js';
import { card, cardRow, datasetSelect, levelSelect, details, notice, spinner, DF_LABEL } from '../ui/widgets.js';
import { makeFigure, exportButtons, legend, intervals, recordRows, svgEl, tok, extent } from '../ui/plots.js';
import { installExportRow, pairedPilotFile } from '../ui/exportrow.js';
import { assumptionChecks } from '../ui/checks.js';
import { num, pValue, pct, esc, plural, intl, dash, lvl, pEq } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'two';
/** The page's title. */
export const title = 'Two Systems';

let rootEl = null;
let selA = null, selB = null;
let mode = 'independent';
// 't' for Welch's and the paired t procedures, 'pooled' for the pooled-variance
// t (offered only for independent replications; under pairing it reads as
// 't'), 'np' for the Wilcoxon ones.
let proc = 't';
// The procedure in force: pooling has no meaning for pairs.
function effProc() { return mode === 'paired' && proc === 'pooled' ? 't' : proc; }
// The match rule the reader chose for the current pair of datasets, or null
// to follow the default. It is kept per pair, and so choosing another pair
// starts from that pair's own choice or the default.
let matchChoice = null;
let pending = false;
// The replication plan. A null target follows its default, which is
// recomputed from the data; a number is the reader's own value, kept until
// another pair of datasets is chosen.
const plan = { mode: 'hw', key: null, hwUser: null, deltaUser: null, power: 0.8, hwSlot: {}, deltaSlot: {} };
// What the plan is computed from, or { msg } when it cannot be, and the
// page's result without its planning table; both are set by update(), and
// so a planning control redraws only the planning card.
let planCtx = null;
let resultBase = null;

// ── Small helpers ─────────────────────────────────────────────────────────

const interval = (lo, hi) => '[' + num(lo) + ', ' + num(hi) + ']';
const levelPct = level => num(level * 100, 4) + '%';

// The finite replication outcomes of a dataset with their ids, and the ids
// of the replications that gave no estimate.
function estimatesOf(ds) {
  const est = repEstimates(ds), ids = repIds(ds);
  const v = [], keep = [], dropped = [];
  for (let i = 0; i < est.length; i++) {
    if (Number.isFinite(est[i])) { v.push(est[i]); keep.push(ids[i]); } else dropped.push(ids[i]);
  }
  return { v: Float64Array.from(v), ids: keep, dropped };
}

// Whether the ids are anything more than the positions 1, 2, 3, ….
function idsArePositions(ids) {
  return ids.every((v, i) => String(v) === String(i + 1));
}
function idsDistinct(ids) {
  return new Set(ids.map(String)).size === ids.length;
}

// The default match rule for two id lists, with the sentence that says why.
function defaultMatch(idsA, idsB) {
  if (!idsDistinct(idsA) || !idsDistinct(idsB)) {
    return { by: 'position', why: 'Matched by position by default: at least one dataset repeats a replication id, and so the ids cannot identify a replication.' };
  }
  const setB = new Set(idsB.map(String));
  const shared = idsA.filter(v => setB.has(String(v))).length;
  if (shared * 2 < Math.min(idsA.length, idsB.length)) {
    return { by: 'position', why: 'Matched by position by default: fewer than half of the replication ids appear in both datasets.' };
  }
  if (idsArePositions(idsA) && idsArePositions(idsB)) {
    return { by: 'id', why: 'Matched by replication id by default. Both datasets number their replications 1, 2, 3, …, and so matching by position gives the same pairs.' };
  }
  return { by: 'id', why: 'Matched by replication id by default: both datasets carry distinct ids, and ' + plural(shared, 'id appears', 'ids appear') + ' in both.' };
}

// The row label for a design in a figure: its role letter, followed by the
// dataset's name with any prefix the two names share ("file · A" and
// "file · B" become "A" and "B") unless that is the role letter itself.
function roleLabels(dsA, dsB) {
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const pa = cut(dsA.name), pb = cut(dsB.name);
  const shared = pa && pb && pa[0] === pb[0] && pa[1] !== pb[1];
  const na = shared ? pa[1] : dsA.name, nb = shared ? pb[1] : dsB.name;
  return [na === 'A' ? 'A' : 'A · ' + na, nb === 'B' ? 'B' : 'B · ' + nb];
}

// Two significant digits, for a default target that reads as a round number.
function round2(v) {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Number((Math.round(v / p) * p).toPrecision(2));
}

function listIds(ids) {
  const shown = ids.slice(0, 20).map(v => esc(v)).join(', ');
  return shown + (ids.length > 20 ? ', …' : '');
}

function kindWord(ds) {
  if (ds.kind === 'reps') return 'replication values';
  if (ds.kind === 'time') return 'replication time averages';
  return 'replication means';
}

// The experimental-unit line for the pair, in the shared banner's markup.
function unitLineTwo(dsA, dsB, nA, nB) {
  const el = document.createElement('p');
  el.className = 'unit-line';
  if (!dsA || !dsB) {
    // The placeholder has the shape of the filled line, and so the banner
    // keeps its height when the datasets arrive.
    el.innerHTML = '<span class="unit-lbl">Experimental unit:</span> R<sub>A</sub> = ' + dash + ' and R<sub>B</sub> = ' + dash + ' replication outcomes';
    return el;
  }
  const same = kindWord(dsA) === kindWord(dsB);
  el.innerHTML = '<span class="unit-lbl">Experimental unit:</span> ' +
    'R<sub>A</sub> = ' + intl(nA) + (same ? '' : ' ' + kindWord(dsA)) +
    ' and R<sub>B</sub> = ' + intl(nB) + ' ' + kindWord(dsB);
  return el;
}

function sec(heading) {
  const s = document.createElement('div');
  s.className = 'sec';
  s.innerHTML = '<div class="sec-hd">' + heading + '</div>';
  return s;
}

function caption(html) {
  const p = document.createElement('p');
  p.className = 'cmp-cap';
  p.innerHTML = html;
  return p;
}

// An interval card takes a full row on a phone whether or not it holds a
// value yet, and so the cards do not reflow when a result appears.
function wide(el) {
  el.classList.add('sc-wide', 'cmp-span2');
  return el;
}

// A card whose note is cut to one line, and so a long dataset name never
// makes its row taller than the placeholder row was.
function oneLine(el) {
  el.classList.add('cmp-oneline');
  return el;
}

function figBox(parent) {
  const box = document.createElement('div');
  box.className = 'cmp-fig';
  parent.appendChild(box);
  return box;
}

function clip(s, maxW, size) {
  s = String(s);
  if (s.length * size * 0.56 <= maxW) return s;
  return s.slice(0, Math.max(1, Math.floor(maxW / (size * 0.56)) - 1)) + '…';
}

/**
 * Rows of replication outcomes, one row per design: the dots of the row's
 * values stacked to avoid overlap, and under them the row's mean with its
 * interval. An optional dashed reference line marks `ref`.
 * @param {Object} fig a plots.js figure
 * @param {{label: string, values: ArrayLike<number>, names: string[], mean: number, lo: number, hi: number}[]} rows
 * @param {{ref?: number|null}} o
 */
function strips(fig, rows, o = {}) {
  const fs = 11.5, n = rows.length;
  const longest = Math.max(...rows.map(r => r.label.length)) * fs * 0.56;
  const lw = Math.min(Math.floor(fig.w * (fig.narrow ? 0.3 : 0.24)), Math.ceil(longest) + 14);
  fig.setMargin({ l: lw + 8 });
  const all = [];
  for (const r of rows) { all.push(...r.values, r.lo, r.hi); }
  if (o.ref !== undefined && o.ref !== null) all.push(o.ref);
  const sx = fig.x(extent(all), { pad: 0.06, nice: true });
  fig.axes({ y: false });
  const rowH = fig.ih / n;
  const cEst = tok('--est'), cTruth = tok('--truth'), cCard = tok('--card'), cText = tok('--text'), cMuted = tok('--muted'), cBorder = tok('--border');
  const ry = recordRows(fig, rows.map(r => r.label));
  if (o.ref !== undefined && o.ref !== null) {
    const x = sx(o.ref);
    svgEl('line', { x1: x, x2: x, y1: 0, y2: fig.ih, stroke: cMuted, 'stroke-width': 1.5, 'stroke-dasharray': '5,4' }, fig.inner);
    fig.series.push({ kind: 'vline', x: o.ref, dash: true, color: cMuted, label: 'reference' });
  }
  const rad = fig.narrow ? 4 : 4.5;
  const placed = [];
  const dotsRec = { kind: 'points', x: [], y: [], color: cEst, label: 'one replication outcome' };
  const intRec = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cTruth, label: 'interval' };
  const meanRec = { kind: 'points', x: [], y: [], color: cTruth, label: 'mean' };
  rows.forEach((row, ri) => {
    const top = ri * rowH;
    if (ri > 0) svgEl('line', { x1: 0, x2: fig.iw, y1: top, y2: top, stroke: cBorder, 'stroke-width': 1 }, fig.inner);
    const cyDots = top + rowH * 0.4, cyInt = top + rowH * 0.8;
    // Each dot takes the level nearest the row's center line (0, +1, −1, …)
    // whose last dot sits at least one diameter to its left.
    const idx = Array.from(row.values, (_, i) => i).sort((a, b) => row.values[a] - row.values[b]);
    const lastX = new Map(), level = new Array(row.values.length).fill(0);
    let maxLevel = 0;
    for (const i of idx) {
      const px = sx(row.values[i]);
      for (let j = 0; ; j++) {
        const L = j === 0 ? 0 : (j % 2 ? (j + 1) / 2 : -j / 2);
        const prev = lastX.get(L);
        if (prev === undefined || px - prev >= 2 * rad + 0.5) { lastX.set(L, px); level[i] = L; maxLevel = Math.max(maxLevel, Math.abs(L)); break; }
      }
    }
    const gap = maxLevel ? Math.min(2 * rad + 1, (rowH * 0.32 - rad) / maxLevel) : 0;
    const g = svgEl('g', { class: 'm-dots' }, fig.inner);
    const yRow = ry(ri), yGap = maxLevel ? Math.min(0.08, 0.3 / maxLevel) : 0;
    for (const i of idx) {
      const cx = sx(row.values[i]), cy = cyDots - level[i] * gap;
      svgEl('circle', { cx, cy, r: rad, fill: cEst, 'fill-opacity': 0.75, stroke: cCard, 'stroke-width': 1 }, g);
      placed.push({ cx, cy, text: row.label + ', replication ' + row.names[i] + ': ' + num(row.values[i]) });
      dotsRec.x.push(row.values[i]); dotsRec.y.push(yRow + 0.1 + level[i] * yGap);
    }
    if (Number.isFinite(row.lo) && Number.isFinite(row.hi)) {
      const x0 = sx(row.lo), x1 = sx(row.hi);
      const yi = yRow - 0.3;
      intRec.x0.push(row.lo, row.lo, row.hi); intRec.x1.push(row.hi, row.lo, row.hi); intRec.y0.push(yi, yi - 0.08, yi - 0.08); intRec.y1.push(yi, yi + 0.08, yi + 0.08);
      meanRec.x.push(row.mean); meanRec.y.push(yi);
      const gi = svgEl('g', { class: 'm-int' }, fig.inner);
      svgEl('line', { x1: x0, x2: x1, y1: cyInt, y2: cyInt, stroke: cTruth, 'stroke-width': 2 }, gi);
      for (const x of [x0, x1]) svgEl('line', { x1: x, x2: x, y1: cyInt - 5, y2: cyInt + 5, stroke: cTruth, 'stroke-width': 2 }, gi);
      svgEl('circle', { cx: sx(row.mean), cy: cyInt, r: 4.2, fill: cTruth }, gi);
    }
    const t = svgEl('text', { x: -10, y: top + rowH / 2 + 4, 'text-anchor': 'end', 'font-size': fs, fill: cText }, fig.layers.axes);
    t.textContent = clip(row.label, lw - 6, fs);
  });
  fig.series.push(dotsRec);
  if (intRec.x0.length) fig.series.push(intRec, meanRec);
  fig.readout((dx, dy, px, py) => {
    let best = null, bd = Infinity;
    for (const p of placed) { const d = Math.hypot(p.cx - px, p.cy - py); if (d < bd) { bd = d; best = p; } }
    if (best && bd <= 14) return [best.text];
    const ri = Math.floor(py / rowH);
    if (ri < 0 || ri >= n) return null;
    const row = rows[ri], cyInt = ri * rowH + rowH * 0.8;
    if (Math.abs(py - cyInt) <= 10 && Number.isFinite(row.lo)) {
      return [row.label, 'mean ' + num(row.mean), row.intervalName + ' ' + interval(row.lo, row.hi)];
    }
    return null;
  });
}

// An empty figure frame for the placeholder layout, the same height as the
// filled one so that nothing moves when a result appears.
function emptyFrame(fig, xLabel) {
  fig.x([0, 1]);
  fig.axes({ y: false, x: false });
  const t = svgEl('text', { x: fig.iw / 2, y: fig.ih / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: tok('--muted') }, fig.inner);
  t.textContent = xLabel;
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
  '<p>Both scale with s²/n: the half-width is proportional to s/√n, and the power depends on the shift δ only through δ√n/s. That is why four times the replications halve the half-width and why a shift half as large needs about four times the replications to be detected with the same power.</p>';
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

// ── Rendering ─────────────────────────────────────────────────────────────

function chosen() {
  const a = state.get(selA.value), b = state.get(selB.value);
  return { a: a && canInfer(a).ok ? a : null, b: b && canInfer(b).ok ? b : null };
}

function syncControls() {
  rootEl.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const ep = effProc();
  rootEl.querySelectorAll('[data-proc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.proc === ep)));
  rootEl.querySelector('[data-proc="t"]').textContent = mode === 'paired' ? 'Paired t' : 'Welch’s t';
  rootEl.querySelector('[data-proc="pooled"]').classList.toggle('seg-hidden', mode === 'paired');
  rootEl.querySelector('#two-match-row').style.display = mode === 'paired' ? '' : 'none';
}

function showExcluded() {
  const box = rootEl.querySelector('#two-excluded');
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

function update() {
  if (!rootEl) return;
  syncControls();
  showExcluded();
  const res = rootEl.querySelector('#two-results');
  res.innerHTML = '';
  const level = state.settings.level;
  const { a: dsA, b: dsB } = chosen();
  const eA = dsA ? estimatesOf(dsA) : null, eB = dsB ? estimatesOf(dsB) : null;
  res.appendChild(unitLineTwo(dsA, dsB, eA ? eA.v.length : 0, eB ? eB.v.length : 0));

  const notes = [];
  const eligible = state.datasets.filter(d => canInfer(d).ok).length;
  if (eligible < 2) notes.push(notice('warn', eligible === 1
    ? 'Only one dataset has replication outcomes to compare. Load a second dataset on the Import page.'
    : 'No loaded dataset has at least two replication outcomes to compare.'));
  else if (dsA && dsB && dsA.id === dsB.id) notes.push(notice('warn', 'Design A and design B are the same dataset. Choose two different datasets to compare.'));
  for (const [e, tag] of [[eA, 'A'], [eB, 'B']]) {
    if (e && e.dropped.length) notes.push(notice('warn', plural(e.dropped.length, 'replication') + ' of ' + tag + ' gave no outcome and ' + (e.dropped.length === 1 ? 'was' : 'were') + ' left out: ' + (e.dropped.length === 1 ? 'id ' : 'ids ') + listIds(e.dropped) + '.'));
  }
  const ready = dsA && dsB && dsA.id !== dsB.id;

  // The match rule and its note, shown under the Paired switch.
  let match = null;
  const kept = ready ? state.getPick(id, 'match:' + pairKey()) : null;
  matchChoice = kept === 'id' || kept === 'position' ? kept : null;
  if (ready) {
    const def = defaultMatch(eA.ids, eB.ids);
    match = { by: matchChoice || def.by, why: matchChoice && matchChoice !== def.by
      ? 'Matched by ' + (matchChoice === 'id' ? 'replication id' : 'position') + ', as chosen. ' + def.why.replace('by default', 'would be the default')
      : def.why };
  }
  rootEl.querySelectorAll('[data-match]').forEach(b => b.setAttribute('aria-pressed', String(match ? b.dataset.match === match.by : b.dataset.match === 'id')));
  rootEl.querySelector('#two-match-note').textContent = match ? match.why : '';

  if (mode === 'paired') renderPaired(res, notes, ready ? { dsA, dsB, eA, eB, match } : null, level);
  else renderIndependent(res, notes, ready ? { dsA, dsB, eA, eB } : null, level);
  registerTips(res);
  drawPlan();
}

// Redraws the planning card from the context update() left, and registers
// the page's result with its planning table.
function drawPlan() {
  // A rank procedure is sized from the t plan: n times pi/3, rounded up.
  const npOn = proc === 'np';
  const inflate = n => (n == null ? null : npOn ? Math.ceil(n * Math.PI / 3) : n);
  const ranked = n => (npOn && n != null ? n : null);
  if (!rootEl) return;
  const sec = rootEl.querySelector('#two-plan');
  syncPlanMode(sec, plan.mode);
  const c = planCtx && !planCtx.msg ? planCtx : null;
  const msg = planCtx && planCtx.msg ? planCtx.msg : 'Choose two different datasets above to plan replications.';
  if (c && c.key !== plan.key) { plan.key = c.key; plan.hwUser = storedTarget('target', c.key); plan.deltaUser = storedTarget('delta', c.key); }
  const level = state.settings.level, alpha = 1 - level;
  const unit = c && c.dsA.unit ? ' ' + c.dsA.unit : '';
  const unitNote = c && c.dsA.unit ? c.dsA.unit : 'in the response’s units';
  const paired = c ? c.paired : mode === 'paired';
  const pooled = !!(c && c.pooled);
  // Additional replications are counted beyond the larger of the two current
  // counts, and the power at the current count uses the smaller.
  const R = c ? (paired ? c.nPairs : Math.max(c.nA, c.nB)) : NaN;
  const Rlo = c ? (paired ? c.nPairs : Math.min(c.nA, c.nB)) : NaN;
  const same = !c || paired || c.nA === c.nB;
  const rText = paired ? 'the current R\u00a0=\u00a0' + (c ? plural(R, 'pair') : dash + ' pairs')
    : same ? 'the current R\u00a0=\u00a0' + intl(R) : 'the larger current R\u00a0=\u00a0' + intl(R);
  const closing = (paired
    ? 'An estimate conditional on the current sample standard deviation of the differences, s<sub>D</sub> = ' + num(c ? c.sdD : NaN)
    : 'An estimate conditional on the current sample standard deviations s<sub>A</sub> = ' + num(c ? c.sd1 : NaN) + ' and s<sub>B</sub> = ' + num(c ? c.sd2 : NaN)) +
    ', not a guarantee; a larger pilot can move it either way.';
  const equalNote = paired ? '' : ', with equal replications in each design';
  const rows = [];

  // By half-width, on the difference A − B.
  const hwDef = c ? round2(c.hw / 2) : NaN;
  const hwVal = c ? (plan.hwUser != null ? plan.hwUser : hwDef) : null;
  syncSpin(plan.hwSlot, sec.querySelector('.plan-hw-host'), 'two-plan-hw', 'Target half-width', stepFor(hwDef), hwVal,
    v => { plan.hwUser = v; if (plan.key) state.setPick(id, 'target:' + plan.key, v); drawPlan(); });
  sec.querySelector('.plan-hw-unit').textContent = unitNote;
  sec.querySelector('.plan-hw-def').textContent = 'The default' + (c ? ', ' + num(hwDef) + ',' : '') +
    ' is half the current half-width; halving a half-width takes about four times the replications.';
  let hp = { n: null, hwAtN: NaN }, hwNote = esc(msg);
  if (c) {
    hp = paired ? planReplications({ sd: c.sdD, level, target: hwVal })
      : (pooled ? planHalfWidthPooled : planHalfWidthWelch)({ sd1: c.sd1, sd2: c.sd2, level, target: hwVal });
    hwNote = hp.n != null ? closing : esc(hp.reason || 'No replication count meets this target; choose a larger half-width.');
  }
  const hText = 'h = ' + num(c ? hwVal : NaN) + unit;
  fillPane(sec.querySelector('[data-pane="hw"]'),
    'Replications per design needed for a half-width of ' + esc(hText) + ' on the ' + (paired ? 'paired' : pooled ? 'pooled t' : 'Welch') + ' interval for A − B' + equalNote,
    planCards('hw', { n: inflate(hp.n), tN: ranked(hp.n), at: hp.hwAtN, nNote: 'per design', perDesign: true, R, rText,
      atNote: paired ? 'if s<sub>D</sub> stays at ' + num(c ? c.sdD : NaN) : 'if s<sub>A</sub> and s<sub>B</sub> hold' }), hwNote);
  if (c) rows.push(planRow('by half-width', hText, inflate(hp.n), hp.hwAtN, R));

  // By power.
  const m = c ? Math.abs(c.meanA) : NaN;
  const dDef = c ? (m > 0 ? round2(0.1 * m) : round2(0.25 * c.sdA)) : NaN;
  const delta = c ? (plan.deltaUser != null ? plan.deltaUser : dDef) : null;
  syncSpin(plan.deltaSlot, sec.querySelector('.plan-delta-host'), 'two-plan-delta', 'Difference to detect δ', stepFor(dDef), delta,
    v => { plan.deltaUser = v; if (plan.key) state.setPick(id, 'delta:' + plan.key, v); drawPlan(); });
  sec.querySelector('.plan-delta-unit').textContent = unitNote;
  let pp = { n: null, powerAtN: NaN }, cur = NaN, pwNote = esc(msg);
  if (c) {
    pp = paired ? planPowerOneSample({ sd: c.sdD, delta, alpha, power: plan.power })
      : (pooled ? planPowerPooled : planPowerWelch)({ sd1: c.sd1, sd2: c.sd2, delta, alpha, power: plan.power });
    cur = paired ? (c.sdD > 0 ? powerOneSample({ n: Rlo, sd: c.sdD, delta, alpha }) : NaN)
      : (c.sd1 > 0 && c.sd2 > 0 ? (pooled ? powerPooled : powerWelch)({ n: Rlo, sd1: c.sd1, sd2: c.sd2, delta, alpha }) : NaN);
    pwNote = pp.n != null
      ? (paired || pooled ? '' : 'Welch’s power here is the noncentral-t approximation at the Welch degrees of freedom. ') + closing
      : esc(pp.reason);
  }
  const dText = 'δ = ' + num(c ? delta : NaN) + unit;
  fillPane(sec.querySelector('[data-pane="power"]'),
    'Replications per design needed to detect a difference of ' + esc(dText) + ' with ' + powerPct(plan.power) +
      ' power, by a two-sided ' + (paired ? 'paired t test' : pooled ? 'pooled t test' : 'Welch test') + ' at α = ' + num(alpha) + equalNote,
    planCards('power', { n: inflate(pp.n), tN: ranked(pp.n), at: pp.powerAtN, nNote: 'per design', perDesign: true, R, rText, atNote: 'at ' + esc(dText), cur,
      curNote: paired ? 'at ' + rText : same ? 'at R\u00a0=\u00a0' + intl(Rlo) + ' per design' : 'at the smaller current R\u00a0=\u00a0' + intl(Rlo) }), pwNote);
  if (c) rows.push(planRow('by power', dText + ', ' + powerPct(plan.power) + ' power, α = ' + num(alpha), inflate(pp.n), pp.powerAtN, R));

  if (!resultBase) { state.setResult('two', null); return; }
  const prov = Object.assign({}, resultBase.provenance, {
    'planning mode shown': plan.mode === 'hw' ? 'by half-width' : 'by power',
    'planning replications': 'equal per design',
    'planning half-width target': hText,
    'planning difference to detect': dText,
    'planning target power': powerPct(plan.power),
    'planning significance level': num(alpha)
  });
  state.setResult('two', Object.assign({}, resultBase, { provenance: prov, tables: resultBase.tables.concat([{ name: 'Replications needed', headers: PLAN_HEADERS, rows }]) }));
}

// The note under a Wilcoxon result on how the planning card relates to it.
const NP_PLAN = 'Under the Wilcoxon procedures, the planning counts are the t plan inflated by π/3 ≈ 1.047, the reciprocal of their efficiency relative to the t under normal data (about 5% more replications); under heavy tails, they need fewer.';

// What a Wilcoxon result's p-value and interval rest on, for its card notes.
function npBasis(r) {
  return r.exact ? 'exact distribution' : 'normal approximation' + (r.ties ? ', ties present' : '');
}
function npLevelNote(r, L) {
  return r.exact && Number.isFinite(r.achieved) ? 'achieved level ' + levelPct(r.achieved) : L + ' by the ' + npBasis(r);
}

function renderIndependent(res, notes, d, level) {
  for (const n of notes) res.appendChild(n);
  const np = proc === 'np', pooled = proc === 'pooled';
  const w = d ? (pooled ? pooledT(d.eA.v, d.eB.v, level) : welch(d.eA.v, d.eB.v, level)) : null;
  const rs = d && np ? rankSum(d.eA.v, d.eB.v, { level }) : null;
  const L = levelPct(level);
  const tName = pooled ? 'Pooled-variance t' : 'Welch';
  const s = sec(np ? 'Wilcoxon rank-sum comparison of A and B' : tName + ' comparison of A and B');
  res.appendChild(s);
  const v = (x, f = num) => (w ? f(x) : dash);
  if (np) {
    const mA = d ? summary(d.eA.v) : null, mB = d ? summary(d.eB.v) : null;
    s.appendChild(cardRow([
      oneLine(card('Median A', v(mA && mA.median), d ? esc(d.dsA.name) : 'design A')),
      oneLine(card('Median B', v(mB && mB.median), d ? esc(d.dsB.name) : 'design B')),
      card('<span class="tip" tabindex="0" data-tip="The Hodges–Lehmann estimate of how far A sits above B: the median of every difference between one A outcome and one B outcome.">Shift A − B</span>', v(rs && rs.estimate), 'Hodges–Lehmann'),
      card('<span class="tip" tabindex="0" data-tip="The Mann–Whitney count: the number of (A, B) pairs in which the A outcome is the larger, R_A·R_B/2 when the two designs are alike.">W</span>', v(rs && rs.W), 'Mann–Whitney count'),
      card('Two-sided p', rs ? pValue(rs.p) : dash, rs ? npBasis(rs) : 'Wilcoxon rank-sum test'),
      wide(card(L + ' interval for the shift', rs ? interval(rs.lo, rs.hi) : dash, rs ? npLevelNote(rs, L) : 'Hodges–Lehmann')),
      card('R<sub>A</sub>, R<sub>B</sub>', w ? intl(w.n1) + ', ' + intl(w.n2) : dash, 'replication outcomes')
    ]));
  } else {
    s.appendChild(cardRow([
      oneLine(card('Mean A', v(w && w.mean1), d ? esc(d.dsA.name) : 'design A')),
      oneLine(card('Mean B', v(w && w.mean2), d ? esc(d.dsB.name) : 'design B')),
      card('Difference A − B', v(w && w.diff), 'mean A − mean B'),
      pooled ? card('<span class="tip" tabindex="0" data-tip="The pooled standard deviation: the two sample variances averaged with weights R_A − 1 and R_B − 1, the one spread the two designs are taken to share.">Pooled SD s<sub>p</sub></span>', v(w && w.sp), 'from s<sub>A</sub> and s<sub>B</sub>') : null,
      card('Standard error', v(w && w.se), pooled ? 's<sub>p</sub>√(1/R<sub>A</sub> + 1/R<sub>B</sub>)' : '√(s<sub>A</sub>²/R<sub>A</sub> + s<sub>B</sub>²/R<sub>B</sub>)'),
      pooled ? card(DF_LABEL, v(w && w.df), 'R<sub>A</sub> + R<sub>B</sub> − 2')
        : card('<span class="tip" tabindex="0" data-tip="The Welch–Satterthwaite degrees of freedom, which allow the two designs to have different variances.">Welch df</span>', v(w && w.df), 'Welch–Satterthwaite'),
      card('t', v(w && w.t), 'difference/SE'),
      card('Two-sided p', w ? pValue(w.p) : dash, pooled ? 'pooled t test' : 'Welch t test'),
      wide(card(L + ' interval', w ? interval(w.lo, w.hi) : dash, 'difference ± half-width')),
      card('Half-width', v(w && w.hw), 't quantile × SE')
    ].filter(Boolean)));
  }
  const shown = np ? rs : w;
  const center = np ? (rs ? rs.estimate : NaN) : (w ? w.diff : NaN);
  const verdict = document.createElement('p');
  verdict.className = 'cmp-verdict cmp-res';
  const excludes = shown && (shown.lo > 0 || shown.hi < 0);
  verdict.textContent = !shown ? 'No comparison yet: choose two different datasets above.'
    : excludes ? (np ? 'The interval excludes 0: the designs differ in location at this level.' : 'The interval excludes 0: the means differ at this level.')
      : (np ? 'The interval contains 0: insufficient evidence of a difference in location at this level.' : 'The interval contains 0: insufficient evidence of a difference at this level.');
  s.appendChild(verdict);
  if (np) s.appendChild(caption(NP_PLAN));
  // The checks follow a parametric result only: the Wilcoxon procedures assume no normality.
  if (d && !np) s.appendChild(assumptionChecks({ sets: [{ name: 'A', values: d.eA.v, dsId: d.dsA.id }, { name: 'B', values: d.eB.v, dsId: d.dsB.id }], alpha: 1 - state.settings.base, pooled,
    procedure: pooled ? 'the pooled t test' : 'Welch’s test',
    declared: 'between the two designs cannot be checked from the data, and ' + (pooled ? 'the pooled t test' : 'Welch’s test') + ' assumes it; it is what the Independent setting declares.' }));

  const f = sec('Replication outcomes and the difference');
  res.appendChild(f);
  const box1 = figBox(f);
  const fig1 = makeFigure(box1, { height: 190, narrowHeight: 210, margin: { t: 8, b: 40 }, xLabel: d ? 'Replication outcome of ' + d.dsA.response : 'Replication outcome' });
  const leg1 = document.createElement('div');
  f.appendChild(leg1);
  const box2 = figBox(f);
  const fig2 = makeFigure(box2, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: np ? 'Shift in location, A − B' : 'Difference in means, A − B' });
  const leg2 = document.createElement('div');
  f.appendChild(leg2);
  const ownName = np ? L + ' Wilcoxon interval' : L + ' t interval';
  if (d) {
    const [labA, labB] = roleLabels(d.dsA, d.dsB);
    const own = e => {
      if (!np) { const t = tInterval(e, level); return { mean: t.mean, lo: t.lo, hi: t.hi }; }
      const r = signedRank(e, { level }); return { mean: r.estimate, lo: r.lo, hi: r.hi };
    };
    const iA = own(d.eA.v), iB = own(d.eB.v);
    fig1.render(fg => strips(fg, [
      { label: labA, values: d.eA.v, names: d.eA.ids.map(String), mean: iA.mean, lo: iA.lo, hi: iA.hi, intervalName: ownName },
      { label: labB, values: d.eB.v, names: d.eB.ids.map(String), mean: iB.mean, lo: iB.lo, hi: iB.hi, intervalName: ownName }
    ]));
    fig2.render(fg => intervals(fg, [{ label: 'A − B', lo: shown.lo, hi: shown.hi, center, flagged: excludes }], { ref: 0, rowPx: 36 }));
  } else {
    fig1.render(fg => emptyFrame(fg, 'Choose two datasets'));
    fig2.render(fg => { fg.setHeight(8 + 40 + 36); emptyFrame(fg, ''); });
  }
  exportButtons(box1, fig1, 'two-systems-outcomes');
  exportButtons(box2, fig2, 'two-systems-difference');
  legend(leg1, [
    { swatch: 'dot', color: '--est', label: 'one replication’s outcome' },
    { swatch: 'interval', color: '--truth', label: np ? 'design pseudo-median with its own ' + ownName : 'design mean with its own ' + ownName }
  ]);
  const diffName = np ? L + ' Wilcoxon interval for the shift A − B' : L + ' ' + (pooled ? 'pooled t' : 'Welch') + ' interval for A − B';
  legend(leg2, [
    excludes
      ? { swatch: 'flagged', color: '--miss', label: diffName + ', which excludes 0' }
      : { swatch: 'interval', color: '--est', label: diffName },
    { swatch: 'dash', color: '--truth', label: 'zero difference' }
  ]);
  f.appendChild(caption(np
    ? 'The top plot shows every replication outcome of each design, with each design’s pseudo-median (the Hodges–Lehmann estimate) and its own ' + L +
      ' Wilcoxon signed-rank interval under its dots. The bottom plot is the Hodges–Lehmann shift between the designs with its ' + L + ' rank-sum interval, drawn against zero; an interval that excludes zero is drawn red and dashed.'
    : 'The top plot shows every replication outcome of each design, with each design’s mean and its own ' + L +
      ' t interval under its dots. The bottom plot is the ' + (pooled ? 'pooled-variance t' : 'Welch') + ' interval for the difference of the means, drawn against zero; an interval that excludes zero is drawn red and dashed.'));

  // The variances: the F ratio, an inference on which design is more
  // variable, with variability as a performance measure of its own.
  const fr = d ? fRatio(d.eA.v, d.eB.v, level) : null;
  const vs = sec('Variances of A and B');
  res.appendChild(vs);
  vs.appendChild(caption('Which design is more variable: the ratio of the two sample variances with its F interval. The equal-variances assumption of the pooled t is a different question, answered by Levene’s test on the checks line above.'));
  const vv = (x, f = num) => (fr ? f(x) : dash);
  vs.appendChild(cardRow([
    card(S('F = s²<sub>A</sub> / s²<sub>B</sub>'), vv(fr && fr.F), 'ratio of sample variances'),
    card(S('df<sub>1</sub>'), vv(fr && fr.df1, intl), 'R<sub>A</sub> − 1'),
    card(S('df<sub>2</sub>'), vv(fr && fr.df2, intl), 'R<sub>B</sub> − 1'),
    card('Two-sided p', fr ? pValue(fr.p) : dash, 'against σ²<sub>A</sub> = σ²<sub>B</sub>'),
    wide(card(L + ' interval for ' + S('σ²<sub>A</sub> / σ²<sub>B</sub>'), fr ? interval(fr.lo, fr.hi) : dash, 'F divided by the F quantiles'))
  ]));
  const fContains = !!fr && fr.lo <= 1 && 1 <= fr.hi;
  const vVerdict = document.createElement('p');
  vVerdict.className = 'cmp-verdict cmp-res';
  vVerdict.textContent = !fr ? 'No comparison yet: choose two different datasets above.'
    : fContains ? 'The interval contains 1: insufficient evidence that the variances differ at this level.' : 'The interval excludes 1: the variances differ at this level.';
  vs.appendChild(vVerdict);
  if (d) vs.appendChild(assumptionChecks({ sets: [{ name: 'A', values: d.eA.v, dsId: d.dsA.id }, { name: 'B', values: d.eB.v, dsId: d.dsB.id }], alpha: 1 - state.settings.base,
    procedure: 'the F ratio', declared: 'between the two designs cannot be checked from the data, and the F ratio assumes it; it is what the Independent setting declares.' }));
  vs.appendChild(notice('warn', 'The F ratio and its interval assume both sets of replication outcomes are normally distributed; unlike the Welch interval for a difference of means, they do not become safe as R grows, and heavy tails alone make the F test reject. Levene’s test, on the checks line above and in the Equal variances section of Summary and Plots, asks the same question without assuming normality.'));

  if (!w) {
    resultBase = null;
    planCtx = { msg: 'Choose two different datasets above to plan replications.' };
    return;
  }
  planCtx = { paired: false, pooled, key: d.dsA.id + '|' + d.dsB.id, dsA: d.dsA, sd1: w.sd1, sd2: w.sd2, nA: w.n1, nB: w.n2,
              hw: w.hw, meanA: w.mean1, sdA: w.sd1 };
  const prov = provenance(d, level, false, null, null);
  resultBase = np ? {
    title: 'Two Systems: Wilcoxon rank-sum comparison',
    provenance: prov,
    tables: [{
      name: 'Rank-sum comparison (Wilcoxon)',
      headers: ['design A', 'design B', 'R_A', 'R_B', 'median A', 'median B', 'shift A − B (Hodges–Lehmann)', 'W', 'p (two-sided)', 'lower', 'upper', 'level', 'basis'],
      rows: [[d.dsA.name, d.dsB.name, w.n1, w.n2, summary(d.eA.v).median, summary(d.eB.v).median, rs.estimate, rs.W, rs.p, rs.lo, rs.hi, rs.exact ? rs.achieved : level, npBasis(rs)]]
    }],
    summaryHtml: '<p>Wilcoxon rank-sum comparison of ' + esc(d.dsA.name) + ' (A) and ' + esc(d.dsB.name) + ' (B): shift A − B = ' + num(rs.estimate) +
      ', ' + L + ' interval ' + interval(rs.lo, rs.hi) + ', ' + pEq(rs.p) + '. ' + esc(verdict.textContent) + '</p>'
  } : {
    title: 'Two Systems: ' + tName + ' comparison',
    provenance: prov,
    tables: [{
      name: tName + ' comparison',
      headers: ['design A', 'design B', 'R_A', 'R_B', 'mean A', 'mean B', 'difference A - B'].concat(pooled ? ['pooled sd'] : [], ['se', pooled ? 'df' : 'Welch df', 't', 'p (two-sided)', 'lower', 'upper', 'half-width']),
      rows: [[d.dsA.name, d.dsB.name, w.n1, w.n2, w.mean1, w.mean2, w.diff].concat(pooled ? [w.sp] : [], [w.se, w.df, w.t, w.p, w.lo, w.hi, w.hw])]
    }],
    summaryHtml: '<p>' + tName + ' comparison of ' + esc(d.dsA.name) + ' (A) and ' + esc(d.dsB.name) + ' (B): A − B = ' + num(w.diff) +
      ', ' + L + ' interval ' + interval(w.lo, w.hi) + ', ' + pEq(w.p) + '. ' + esc(verdict.textContent) + '</p>'
  };
  if (fr) resultBase.tables.push({ name: 'F ratio of variances (A over B)', headers: ['statistic', 'value'], rows: [
    ['F', fr.F], ['df1', fr.df1], ['df2', fr.df2], ['p (two-sided)', fr.p], ['lower', fr.lo], ['upper', fr.hi], ['interval contains 1', fContains ? 'yes' : 'no']
  ] });
}

// Card labels are set in capitals; a symbol keeps its own case, and so σ
// does not turn into Σ.
function S(html) { return '<span class="sym">' + html + '</span>'; }

// ── Two more views of the matched pairs ───────────────────────────────────
// Under the paired differences, one figure shows the pairs either column by
// column along the replications or as lines from A to B. The reader switches
// between them; the choice is remembered, and both views share the figure's
// height and stack their legends and captions in one grid cell, and so
// switching never moves the page.

const PAIR_VIEWS = [['rep', 'Pairs by replication'], ['slope', 'Pairs as slopes']];

function sampleSd(v) {
  const n = v.length;
  if (n < 2) return NaN;
  let m = 0;
  for (const x of v) m += x;
  m /= n;
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}

// The axis line along the bottom and its label, for the two views that draw
// their own x ticks.
function bottomAxis(fig, label) {
  const cMuted = tok('--muted');
  svgEl('line', { x1: 0, x2: fig.iw, y1: fig.ih, y2: fig.ih, stroke: cMuted, 'stroke-width': 1 }, fig.layers.axes);
  const t = svgEl('text', { x: fig.iw / 2, y: fig.ih + Math.max(32, fig.m.b - 8), 'text-anchor': 'middle', 'font-size': 12, fill: tok('--text'), 'font-weight': 500 }, fig.layers.axes);
  t.textContent = label;
}

/**
 * The pairs by replication: one column per matched pair, design A's estimate
 * as a filled dot and design B's as a hollow one, joined by a dashed segment
 * whose length is the pair's difference. Tick labels are thinned to every
 * k-th replication when they would collide.
 * @param {Object} fig a plots.js figure
 * @param {{a: Float64Array, b: Float64Array, names: string[], byId: boolean}} P
 */
function pairsByRep(fig, P) {
  const n = P.a.length;
  const sx = fig.x([0.5, n + 0.5]);
  const sy = fig.y(extent(P.a, P.b), { pad: 0.06, nice: true });
  fig.axes({ x: false });
  const cEst = tok('--est'), cPair = tok('--pair'), cCard = tok('--card'), cMuted = tok('--muted');
  const spacing = fig.iw / n;
  const fs = 11;
  const widest = Math.max(...P.names.map(s => String(s).length)) * fs * 0.56;
  let step = 1;
  while (step < n && step * spacing < widest + 6) step++;
  for (let k = 0; k < n; k++) {
    const px = sx(k + 1);
    svgEl('line', { x1: px, x2: px, y1: fig.ih, y2: fig.ih + (k % step ? 2.5 : 4), stroke: cMuted, 'stroke-width': 1 }, fig.layers.axes);
    if (k % step) continue;
    const t = svgEl('text', { x: px, y: fig.ih + 16, 'text-anchor': 'middle', 'font-size': fs, fill: cMuted, class: 'tick' }, fig.layers.axes);
    t.textContent = P.names[k];
  }
  bottomAxis(fig, P.byId ? 'Replication id' : 'Replication ids, A/B');
  const r = Math.max(2.2, Math.min(fig.narrow ? 4 : 4.5, spacing * 0.36));
  const gLink = svgEl('g', { class: 'm-pair-link' }, fig.inner);
  const gB = svgEl('g', { class: 'm-pair-b' }, fig.inner);
  const gA = svgEl('g', { class: 'm-pair-a' }, fig.inner);
  const ks = Array.from({ length: n }, (_, k) => k + 1);
  fig.cats = { axis: 'x', at: ks, labels: P.names.map(String) };
  fig.series.push(
    { kind: 'segments', x0: ks, x1: ks, y0: Array.from(P.a), y1: Array.from(P.b), color: cPair, dash: true, label: 'difference A - B' },
    { kind: 'points', x: ks, y: Array.from(P.a), color: cEst, label: 'design A' },
    { kind: 'points', x: ks, y: Array.from(P.b), color: cEst, hollow: true, label: 'design B' });
  for (let k = 0; k < n; k++) {
    const px = sx(k + 1), ya = sy(P.a[k]), yb = sy(P.b[k]);
    // The segment runs between the two dots' rims, and so it never shows
    // through the hollow dot.
    if (Math.abs(ya - yb) > 2 * r + 2) {
      const dir = yb > ya ? 1 : -1;
      svgEl('line', { x1: px, x2: px, y1: ya + dir * (r + 1), y2: yb - dir * (r + 1), stroke: cPair, 'stroke-width': 2, 'stroke-dasharray': '3,3' }, gLink);
    }
    svgEl('circle', { cx: px, cy: yb, r, fill: 'none', stroke: cEst, 'stroke-width': 2 }, gB);
    svgEl('circle', { cx: px, cy: ya, r, fill: cEst, stroke: cCard, 'stroke-width': 1 }, gA);
  }
  fig.readout((dx, dy, px) => {
    const k = Math.round(sx.invert(px)) - 1;
    if (k < 0 || k >= n || Math.abs(sx(k + 1) - px) > Math.max(12, spacing / 2)) return null;
    return [(P.byId ? 'replication ' : 'pair ') + P.names[k], 'A ' + num(P.a[k]) + ', B ' + num(P.b[k]), 'difference A − B ' + num(P.a[k] - P.b[k])];
  });
}

/**
 * The pairs as slopes: design A's estimates in a left column and design B's
 * in a right one, each pair joined by a line. A line whose difference has
 * the sign of the mean difference is solid and any other is dashed; each
 * column's mean is a short labeled bar.
 * @param {Object} fig a plots.js figure
 * @param {{a: Float64Array, b: Float64Array, names: string[], byId: boolean, labA: string, labB: string, meanD: number}} P
 */
function pairsAsSlopes(fig, P) {
  const n = P.a.length;
  let mA = 0, mB = 0;
  for (let k = 0; k < n; k++) { mA += P.a[k]; mB += P.b[k]; }
  mA /= n; mB /= n;
  const sx = fig.x([0, 1]);
  const sy = fig.y(extent(P.a, P.b), { pad: 0.06, nice: true });
  fig.axes({ x: false });
  const cEst = tok('--est'), cTruth = tok('--truth'), cBorder = tok('--border'), cText = tok('--text');
  const xa = sx(0.25), xb = sx(0.75);
  for (const x of [xa, xb]) svgEl('line', { x1: x, x2: x, y1: 0, y2: fig.ih, stroke: cBorder, 'stroke-width': 1 }, fig.inner);
  const half = fig.iw * 0.25 - 4;
  [[xa, P.labA], [xb, P.labB]].forEach(([x, lab]) => {
    const t = svgEl('text', { x, y: fig.ih + 16, 'text-anchor': 'middle', 'font-size': 11.5, fill: cText }, fig.layers.axes);
    t.textContent = clip(lab, 2 * half, 11.5);
  });
  bottomAxis(fig, 'Design');
  const s0 = Math.sign(P.meanD);
  const along = k => s0 !== 0 && Math.sign(P.a[k] - P.b[k]) === s0;
  const gAgainst = svgEl('g', { class: 'm-slope-against' }, fig.inner);
  const gAlong = svgEl('g', { class: 'm-slope-along' }, fig.inner);
  fig.cats = { axis: 'x', at: [0.25, 0.75], labels: [P.labA, P.labB] };
  const recAlong = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cEst, label: 'pair, difference with the sign of the mean difference' };
  const recAgainst = { kind: 'segments', x0: [], x1: [], y0: [], y1: [], color: cEst, dash: true, label: 'pair, difference of the other sign' };
  for (let k = 0; k < n; k++) {
    const ok = along(k);
    svgEl('line', { x1: xa, y1: sy(P.a[k]), x2: xb, y2: sy(P.b[k]), stroke: cEst, 'stroke-width': 1.6, 'stroke-opacity': 0.8,
      'stroke-dasharray': ok ? null : '5,4' }, ok ? gAlong : gAgainst);
    const rec = ok ? recAlong : recAgainst;
    rec.x0.push(0.25); rec.x1.push(0.75); rec.y0.push(P.a[k]); rec.y1.push(P.b[k]);
  }
  if (recAlong.x0.length) fig.series.push(recAlong);
  if (recAgainst.x0.length) fig.series.push(recAgainst);
  fig.series.push({ kind: 'segments', x0: [0.21, 0.71], x1: [0.29, 0.79], y0: [mA, mB], y1: [mA, mB], color: cTruth, width: 4, label: 'mean of each column' });
  const gm = svgEl('g', { class: 'm-slope-mean' }, fig.inner);
  const bar = fig.narrow ? 16 : 22;
  [[xa, mA, -1], [xb, mB, 1]].forEach(([x, m, side]) => {
    const y = sy(m);
    svgEl('line', { x1: x - bar, x2: x + bar, y1: y, y2: y, stroke: cTruth, 'stroke-width': 4, 'stroke-linecap': 'round' }, gm);
    const t = svgEl('text', { x: x + side * (bar + 6), y: y + 4, 'text-anchor': side < 0 ? 'end' : 'start', 'font-size': 11, fill: cTruth }, gm);
    t.textContent = 'mean';
  });
  fig.readout((dx, dy, px, py) => {
    for (const [x, m, lab] of [[xa, mA, 'A'], [xb, mB, 'B']]) {
      if (Math.abs(px - x) <= bar + 4 && Math.abs(py - sy(m)) <= 6) return ['mean of ' + lab + ' ' + num(m)];
    }
    // The line nearest the pointer, by distance to the segment.
    let best = -1, bd = Infinity;
    const vx = xb - xa;
    const u = Math.max(0, Math.min(1, (px - xa) / vx));
    for (let k = 0; k < n; k++) {
      const ya = sy(P.a[k]), yb = sy(P.b[k]);
      const d = Math.hypot(xa + u * vx - px, ya + u * (yb - ya) - py);
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0 || bd > 10) return null;
    return [(P.byId ? 'replication ' : 'pair ') + P.names[best], 'A ' + num(P.a[best]) + ', B ' + num(P.b[best])];
  });
}

// The sentence after the first in the by-replication caption, chosen by how
// much variation the two designs share across the pairs.
function sharedSentence(r, sdD, sdA, sdB) {
  if (!Number.isFinite(r)) return '';
  const rr = ' (r = ' + num(r, 3) + ')';
  if (r > 0.5 && sdD < Math.min(sdA, sdB)) {
    return ' Under common random numbers the two move up and down together across replications' + rr +
      ', and the differences are small against that shared variation, which is why the paired interval is narrow.';
  }
  if (r > 0.5) {
    return ' The two move up and down together across replications' + rr +
      ', and pairing removes that shared variation from the differences, although here the differences still vary as much as the less variable design’s outcomes do.';
  }
  if (r >= 0) {
    return ' Here the two share little variation across replications' + rr + ', and so pairing removes little of it from the differences.';
  }
  return ' Here the two tend to move in opposite directions across replications' + rr +
    ', which makes the differences vary more than they would for independent replications.';
}

// Builds the switch, the figure, and the stacked legends and captions under
// the paired differences. P is null before there are enough pairs, and the
// figure then shows an empty frame of the same height.
function pairViews(parent, P) {
  const block = document.createElement('div');
  block.className = 'two-pairviews';
  block.style.marginTop = '14px';
  parent.appendChild(block);
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.style.marginBottom = '6px';
  row.innerHTML = '<span class="ctrl-lbl" id="two-pv-lbl">Show the pairs</span>' +
    '<span class="seg" role="group" aria-labelledby="two-pv-lbl">' +
    PAIR_VIEWS.map(([v, lab]) => '<button type="button" class="seg-btn" data-pv="' + v + '" aria-pressed="false">' + lab + '</button>').join('') +
    '</span>';
  block.appendChild(row);
  const box = figBox(block);
  const fig = makeFigure(box, { height: 260, narrowHeight: 290, margin: { t: 10, b: 44 }, yLabel: 'Replication outcome' });
  const stack = (cls) => {
    const s = document.createElement('div');
    s.style.display = 'grid';
    s.className = cls;
    block.appendChild(s);
    return s;
  };
  const legStack = stack('two-pv-legs'), capStack = stack('two-pv-caps');
  const legs = {}, caps = {};
  for (const [v] of PAIR_VIEWS) {
    const lg = document.createElement('div');
    lg.style.gridArea = '1 / 1';
    lg.dataset.pv = v;
    legStack.appendChild(lg);
    legs[v] = lg;
  }
  legend(legs.rep, [
    { swatch: 'dot', color: '--est', label: 'A (filled)' },
    { swatch: 'hollow', color: '--est', label: 'B (hollow)' },
    { swatch: 'dash', color: '--pair', label: 'difference within the pair' }
  ]);
  // The number of pairs whose difference has the sign of the mean difference.
  let k = 0;
  if (P) {
    const s0 = Math.sign(P.meanD);
    for (let i = 0; i < P.a.length; i++) if (s0 !== 0 && Math.sign(P.a[i] - P.b[i]) === s0) k++;
  }
  // A line style no pair takes is left out of the legend. The by-replication
  // legend's three rows keep the shared cell's height either way.
  legend(legs.slope, [
    !P || k > 0 ? { swatch: 'line', color: '--est', label: 'a pair (A to B)' } : null,
    !P || k < P.a.length ? { swatch: 'dash', color: '--est', label: 'pair against the overall direction' } : null,
    { swatch: 'line', color: '--truth', label: 'mean of each design' }
  ].filter(Boolean));
  let capRep = 'Each replication shows both designs’ outcomes and the difference between them.';
  let capSlope = 'Each line is one replication; when most lines slope the same way, the pairs agree on the direction of the difference, and the paired test is picking up that agreement.';
  if (P) {
    capRep += sharedSentence(P.r, P.sdD, sampleSd(P.a), sampleSd(P.b));
    capSlope += ' ' + intl(k) + ' of ' + plural(P.a.length, 'pair') + ' ' + (k === 1 ? 'slopes' : 'slope') + ' the same way as the mean difference.';
  }
  for (const [v, html] of [['rep', capRep], ['slope', capSlope]]) {
    const c = caption(html);
    c.style.gridArea = '1 / 1';
    c.dataset.pv = v;
    capStack.appendChild(c);
    caps[v] = c;
  }
  let tools = null;
  const show = (view) => {
    row.querySelectorAll('[data-pv]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pv === view)));
    for (const [v] of PAIR_VIEWS) {
      for (const el of [legs[v], caps[v]]) {
        el.style.visibility = v === view ? '' : 'hidden';
        el.setAttribute('aria-hidden', String(v !== view));
      }
    }
    if (!P) fig.render(fg => emptyFrame(fg, ''));
    else fig.render(fg => (view === 'slope' ? pairsAsSlopes : pairsByRep)(fg, P));
    if (tools) tools.remove();
    tools = exportButtons(box, fig, view === 'slope' ? 'two-systems-pairs-as-slopes' : 'two-systems-pairs-by-replication');
  };
  row.querySelectorAll('[data-pv]').forEach(b => b.addEventListener('click', () => {
    state.setPick(id, 'pairView', b.dataset.pv);
    show(b.dataset.pv);
  }));
  show(state.getPick(id, 'pairView') === 'slope' ? 'slope' : 'rep');
}

function renderPaired(res, notes, d, level) {
  const L = levelPct(level);
  let pr = null, m = null, x = null, y = null, pairIds = null;
  if (d) {
    m = matchPairs(d.eA.ids, d.eB.ids, d.match.by);
    x = Float64Array.from(m.pairs, ([i]) => d.eA.v[i]);
    y = Float64Array.from(m.pairs, ([, j]) => d.eB.v[j]);
    pairIds = m.pairs.map(([i, j]) => d.match.by === 'id' ? String(d.eA.ids[i]) : String(d.eA.ids[i]) + '/' + String(d.eB.ids[j]));
    if (m.unmatchedA.length) notes.push(notice('warn', plural(m.unmatchedA.length, 'replication') + ' of A had no partner in B and ' + (m.unmatchedA.length === 1 ? 'was' : 'were') + ' left out: ' + (m.unmatchedA.length === 1 ? 'id ' : 'ids ') + listIds(m.unmatchedA.map(i => d.eA.ids[i])) + '.'));
    if (m.unmatchedB.length) notes.push(notice('warn', plural(m.unmatchedB.length, 'replication') + ' of B had no partner in A and ' + (m.unmatchedB.length === 1 ? 'was' : 'were') + ' left out: ' + (m.unmatchedB.length === 1 ? 'id ' : 'ids ') + listIds(m.unmatchedB.map(j => d.eB.ids[j])) + '.'));
    if (m.pairs.length < 2) notes.push(notice('warn', 'A paired comparison needs at least two matched pairs, and ' + (m.pairs.length === 1 ? 'only one replication was' : 'no replications were') + ' matched. Try matching by position, or check the replication ids.'));
    else pr = pairedT(x, y, level);
  }
  const np = proc === 'np';
  const sr = pr && np ? signedRank(pr.diffs, { level }) : null;
  // What the strip and the verdict show: the mean difference with its paired
  // t interval, or the pseudo-median of the differences with its Wilcoxon one.
  const shown = !pr ? null : np ? { center: sr.estimate, lo: sr.lo, hi: sr.hi, name: L + ' Wilcoxon signed-rank interval' } : { center: pr.meanD, lo: pr.lo, hi: pr.hi, name: L + ' paired t interval' };
  for (const n of notes) res.appendChild(n);
  const s = sec(np ? 'Wilcoxon signed-rank comparison of the matched pairs' : 'Paired comparison of A and B');
  res.appendChild(s);
  const v = (val, f = num) => (pr ? f(val) : dash);
  const rNote = !pr ? 'across the pairs' : pr.r > 0 ? 'pairing is reducing the variance of the comparison' : pr.r < 0 ? 'pairing is increasing the variance of the comparison' : 'pairing is neither reducing nor increasing the variance';
  const rCard = card('<span class="tip" tabindex="0" data-tip="The correlation between the A and B outcomes across the matched pairs. Common random numbers are run to make it positive, which narrows the paired interval; a negative value says the pairing is working against the comparison.">Correlation r</span>', v(pr && pr.r), rNote);
  // The card's outline says which way the pairing is working, in the colors the checks lines use.
  if (pr && pr.r !== 0 && Number.isFinite(pr.r)) rCard.classList.add(pr.r > 0 ? 'card-good' : 'card-bad');
  s.appendChild(cardRow(np ? [
    card('Pairs n', pr ? intl(pr.n) : dash),
    card('<span class="tip" tabindex="0" data-tip="The Hodges–Lehmann estimate for paired data: the median of the pairwise averages of the differences A − B.">Pseudo-median of A − B</span>', v(sr && sr.estimate), 'Hodges–Lehmann'),
    card('<span class="tip" tabindex="0" data-tip="The signed-rank statistic: the sum of the ranks of the positive differences among the absolute differences, n(n + 1)/4 when the two designs are alike.">V</span>', v(sr && sr.V), sr && sr.zeros ? plural(sr.zeros, 'zero difference') + ' dropped' : 'signed-rank sum'),
    card('Two-sided p', sr ? pValue(sr.p) : dash, sr ? npBasis(sr) : 'Wilcoxon signed-rank test'),
    wide(card(L + ' interval for the pseudo-median', sr ? interval(sr.lo, sr.hi) : dash, sr ? npLevelNote(sr, L) : 'Hodges–Lehmann')),
    rCard
  ] : [
    card('Pairs n', pr ? intl(pr.n) : dash),
    card('Mean difference', v(pr && pr.meanD), 'mean of A − B'),
    card('SD of differences', v(pr && pr.sdD)),
    card('Standard error', v(pr && pr.se), 's<sub>D</sub>/√n'),
    card(DF_LABEL, pr ? intl(pr.df) : dash, 'n − 1'),
    card('t', v(pr && pr.t)),
    card('Two-sided p', pr ? pValue(pr.p) : dash),
    wide(card(L + ' interval', pr ? interval(pr.lo, pr.hi) : dash)),
    card('Half-width', v(pr && pr.hw)),
    rCard
  ]));
  const verdict = document.createElement('p');
  verdict.className = 'cmp-verdict cmp-res';
  const excludes = shown && (shown.lo > 0 || shown.hi < 0);
  verdict.textContent = !pr ? (d ? 'Too few matched pairs to compare.' : 'No comparison yet: choose two different datasets above.')
    : excludes ? (np ? 'The interval excludes 0: the designs differ in location at this level.' : 'The interval excludes 0: the means differ at this level.')
      : (np ? 'The interval contains 0: insufficient evidence of a difference in location at this level.' : 'The interval contains 0: insufficient evidence of a difference at this level.');
  s.appendChild(verdict);
  if (np) s.appendChild(caption(NP_PLAN));
  if (pr && pr.r < 0) s.appendChild(notice('warn', 'The correlation across the pairs is negative, and so the pairing is increasing the variance of the comparison rather than reducing it. Common random numbers should induce a positive correlation; before running more replications, check that replication i of both designs shared its random streams.'));
  if (pr && !np) s.appendChild(assumptionChecks({ sets: [{ name: 'the differences A − B', values: pr.diffs }], alpha: 1 - state.settings.base,
    procedure: 'the paired t test',
    declared: 'between pairs cannot be checked from the data, and the paired t test assumes it; the pairing within each replication is what the Paired setting declares.' }));

  const f = sec('Paired differences');
  res.appendChild(f);
  const box1 = figBox(f);
  const fig1 = makeFigure(box1, { height: 150, narrowHeight: 170, margin: { t: 8, b: 40 }, xLabel: 'Difference A − B in each matched pair' });
  const leg1 = document.createElement('div');
  f.appendChild(leg1);
  f.appendChild(caption('Each dot is one matched pair’s difference A − B; under the dots is ' + (np ? 'the pseudo-median of the differences (the Hodges–Lehmann estimate) with its ' + L + ' Wilcoxon signed-rank interval' : 'the mean difference with its ' + L + ' paired t interval') +
    '. The dashed line marks zero difference.'));
  const [labA, labB] = d ? roleLabels(d.dsA, d.dsB) : ['A', 'B'];
  pairViews(f, pr ? { a: x, b: y, names: pairIds, byId: d.match.by === 'id', labA, labB, meanD: pr.meanD, r: pr.r, sdD: pr.sdD } : null);
  if (pr) {
    fig1.render(fg => strips(fg, [{ label: 'A − B', values: pr.diffs, names: pairIds, mean: shown.center, lo: shown.lo, hi: shown.hi, intervalName: shown.name }], { ref: 0 }));
  } else {
    fig1.render(fg => emptyFrame(fg, d ? 'Too few matched pairs' : 'Choose two datasets'));
  }
  exportButtons(box1, fig1, 'two-systems-paired-differences');
  legend(leg1, [
    { swatch: 'dot', color: '--est', label: 'one matched pair’s difference' },
    { swatch: 'interval', color: '--truth', label: (np ? 'pseudo-median of the differences with its ' : 'mean difference with its ') + (shown ? shown.name : L + (np ? ' Wilcoxon signed-rank interval' : ' paired t interval')) },
    { swatch: 'dash', color: '--muted', label: 'zero difference' }
  ]);

  if (!pr) {
    resultBase = null;
    planCtx = { msg: d ? 'Planning needs at least two matched pairs.' : 'Choose two different datasets above to plan replications.' };
    return;
  }
  let sumA = 0;
  for (const v of d.eA.v) sumA += v;
  const iA = tInterval(d.eA.v, level);
  planCtx = { paired: true, key: d.dsA.id + '|' + d.dsB.id, dsA: d.dsA, sdD: pr.sdD, nPairs: pr.n, hw: pr.hw,
              meanA: sumA / d.eA.v.length, sdA: iA.sd };
  const unmatched = m.unmatchedA.length + m.unmatchedB.length;
  resultBase = {
    title: np ? 'Two Systems: Wilcoxon signed-rank paired comparison' : 'Two Systems: paired comparison',
    provenance: provenance(d, level, true, d.match.by, unmatched),
    tables: [np ? {
      name: 'Signed-rank comparison (Wilcoxon)',
      headers: ['design A', 'design B', 'pairs', 'pseudo-median of A − B (Hodges–Lehmann)', 'V', 'zeros dropped', 'p (two-sided)', 'lower', 'upper', 'level', 'basis', 'r'],
      rows: [[d.dsA.name, d.dsB.name, pr.n, sr.estimate, sr.V, sr.zeros, sr.p, sr.lo, sr.hi, sr.exact ? sr.achieved : level, npBasis(sr), pr.r]]
    } : {
      name: 'Paired comparison',
      headers: ['design A', 'design B', 'pairs', 'mean difference A - B', 'sd of differences', 'se', 'df', 't', 'p (two-sided)', 'lower', 'upper', 'half-width', 'r'],
      rows: [[d.dsA.name, d.dsB.name, pr.n, pr.meanD, pr.sdD, pr.se, pr.df, pr.t, pr.p, pr.lo, pr.hi, pr.hw, pr.r]]
    }, {
      name: 'Matched pairs',
      headers: ['replication A', 'replication B', 'A', 'B', 'difference A - B'],
      rows: m.pairs.map(([i, j], k) => [String(d.eA.ids[i]), String(d.eB.ids[j]), x[k], y[k], pr.diffs[k]])
    }],
    summaryHtml: '<p>' + (np ? 'Wilcoxon signed-rank comparison' : 'Paired comparison') + ' of ' + esc(d.dsA.name) + ' (A) and ' + esc(d.dsB.name) + ' (B) over ' + plural(pr.n, 'pair') +
      (np ? ': pseudo-median of the differences ' + num(sr.estimate) + ', ' + L + ' interval ' + interval(sr.lo, sr.hi) + ', ' + pEq(sr.p)
        : ': mean difference ' + num(pr.meanD) + ', ' + L + ' interval ' + interval(pr.lo, pr.hi) + ', ' + pEq(pr.p)) +
      ', r = ' + num(pr.r, 3) + '. ' + esc(verdict.textContent) + '</p>'
  };
}

function provenance(d, level, paired, by, unmatched) {
  return {
    datasets: 'A: ' + d.dsA.name + '; B: ' + d.dsB.name,
    'confidence level': lvl(level),
    procedure: proc === 'np' ? (paired ? 'Wilcoxon signed-rank (nonparametric)' : 'Wilcoxon rank-sum (nonparametric)') : (paired ? 'paired t' : proc === 'pooled' ? 'pooled-variance t' : 'Welch t'),
    paired: paired ? 'yes' : 'no',
    'matched by': paired ? (by === 'id' ? 'replication id' : 'position') : 'not applicable',
    'unmatched replications': paired ? unmatched : 'not applicable'
  };
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Compare two designs on their replication outcomes. Replications run on independent random streams are compared with a two-sample t procedure, Welch’s by default or the pooled-variance t when the two designs are taken to share one variance. ' +
    'Replications run under common random numbers are compared as pairs, and pairing is something you declare with the switch below: the page never infers it from equal numbers of replications.</p>' +
    '<div class="sec ctrl-card">' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="two-a">Design A</label><select id="two-a"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="two-b">Design B</label><select id="two-b"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="two-lvl">Confidence level</label><select id="two-lvl"></select></span>' +
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-lbl" id="two-mode-lbl"><span class="tip" tabindex="0" data-tip="Independent: the two designs were run on separate random streams. Paired: replication i of A and replication i of B used the same random inputs (common random numbers).">Replications are</span></span>' +
        '<span class="seg" role="group" aria-labelledby="two-mode-lbl">' +
          '<button type="button" class="seg-btn" data-mode="independent" aria-pressed="true">Independent</button>' +
          '<button type="button" class="seg-btn" data-mode="paired" aria-pressed="false">Paired</button>' +
        '</span>' +
      '</div>' +
      '<div class="ctrl-row" id="two-match-row" style="display:none">' +
        '<span class="ctrl-lbl" id="two-match-lbl">Match by</span>' +
        '<span class="seg" role="group" aria-labelledby="two-match-lbl">' +
          '<button type="button" class="seg-btn" data-match="id" aria-pressed="true">replication id</button>' +
          '<button type="button" class="seg-btn" data-match="position" aria-pressed="false">position</button>' +
        '</span>' +
        '<span class="ctrl-note" id="two-match-note"></span>' +
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-lbl" id="two-proc-lbl"><span class="tip" tabindex="0" data-tip="Pooled t: the two-sample t test that pools the two sample variances into one, on R_A + R_B − 2 degrees of freedom; it assumes the two designs share a variance, which the checks line tests with Levene’s test. Welch’s t: the two-sample t test that keeps the variances apart, on the Welch–Satterthwaite degrees of freedom, safe whether or not they are equal. Paired t: for pairs. All three assume the replication outcomes are normal, which averages nearly always are. Nonparametric: the Wilcoxon rank-sum test (independent) or signed-rank test (paired), with the Hodges–Lehmann estimate and its interval; they need no normality and keep their level under heavy tails, which is where to turn when the Normality section rejects.">Procedure</span></span>' +
        '<span class="seg" role="group" aria-labelledby="two-proc-lbl">' +
          '<button type="button" class="seg-btn" data-proc="pooled" aria-pressed="false">Pooled t</button>' +
          '<button type="button" class="seg-btn" data-proc="t" aria-pressed="true">Welch’s t</button>' +
          '<button type="button" class="seg-btn" data-proc="np" aria-pressed="false">Nonparametric (Wilcoxon)</button>' +
        '</span>' +
      '</div>' +
      '<div id="two-excluded"></div>' +
    '</div>' +
    '<div id="two-results"></div>' +
    '<div class="sec plan-card" id="two-plan"></div>';
  const planSec = root.querySelector('#two-plan');
  planSec.innerHTML = planMarkup('two',
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="The half-width you would like the interval for the difference A − B to have, in the response’s units. Under common random numbers, the paired plan uses the standard deviation of the differences, which is why pairing needs fewer replications when r is large.">Target half-width</span></span>' +
        '<span class="plan-hw-host"></span><span class="ctrl-note plan-hw-unit"></span></span>' +
      '<span class="ctrl-note plan-hw-def"></span>' +
    '</div>',
    powerControls('two', 'Difference to detect δ',
      'The difference between the two designs’ true means that a two-sided test should detect, in the response’s units. The default is 10% of design A’s mean. Under common random numbers, the paired plan uses the standard deviation of the differences.'));
  planSec.appendChild(details('Half-width or power?', PLAN_WHY));
  planSec.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => {
    if (plan.mode === b.dataset.plan) return;
    plan.mode = b.dataset.plan;
    state.setPick(id, 'planMode', plan.mode);
    drawPlan();
  }));
  const powSel = planSec.querySelector('#two-plan-pow');
  powSel.addEventListener('change', () => { plan.power = Number(powSel.value); state.setPick(id, 'power', plan.power); drawPlan(); });
  const why = details('Independent or paired?',
    '<p>Pairing reduces the variance of the difference when corresponding replications are positively correlated. With correlation ρ between paired outcomes, ' +
    'Var(D̄) = (σ<sub>A</sub>² + σ<sub>B</sub>² − 2ρσ<sub>A</sub>σ<sub>B</sub>)/n, and so the larger ρ is, the narrower the paired interval.</p>' +
    '<p>Which analysis applies is fixed by how the replications were run, not by the data. Replications run under common random numbers are pairs, and they are compared as pairs whatever r turns out to be: the two-sample t procedures, Welch’s and the pooled, assume two independent samples, and these are not. ' +
    'The correlation card then reports how much the pairing gained, not whether to pair; a negative r says the common random numbers did not do their job, which is a reason to look at how the runs were made, not to unpair them. Replications run on independent streams are two independent samples; matching them by position pairs nothing, gives r near 0, and gives up degrees of freedom.</p>' +
    '<p>The paired t uses n − 1 degrees of freedom instead of about 2n − 2, and so, when the pairs share no variation, its interval is a little wider than an independent analysis of the same numbers would give. ' +
    'That is the reason not to pair independent runs, not a reason to unpair correlated ones.</p>' +
    '<p>Common random numbers drive replication i of both designs with the same random inputs, which makes the two outcomes positively correlated by design. That is why such runs are analyzed as pairs.</p>');
  // The note on pairing sits in the configuration card, under the switch it explains.
  root.querySelector('.ctrl-card').appendChild(why);
  root.appendChild(planSec);

  selA = root.querySelector('#two-a');
  selB = root.querySelector('#two-b');
  const filter = ds => canInfer(ds).ok;
  datasetSelect(selA, { filter, remember: { page: id, key: 'a' } });
  datasetSelect(selB, { filter, remember: { page: id, key: 'b' } });
  levelSelect(root.querySelector('#two-lvl'));
  applyStored();
  separateB();

  selA.addEventListener('change', () => schedule());
  selB.addEventListener('change', () => schedule());
  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; state.setPick(id, 'mode', mode); schedule(); }));
  root.querySelectorAll('[data-proc]').forEach(b => b.addEventListener('click', () => { proc = b.dataset.proc; state.setPick(id, 'proc', proc); schedule(); }));
  root.querySelectorAll('[data-match]').forEach(b => b.addEventListener('click', () => {
    matchChoice = b.dataset.match;
    if (selA.value && selB.value) state.setPick(id, 'match:' + pairKey(), matchChoice);
    schedule();
  }));

  const visible = () => root.classList.contains('active');
  state.on('datasets', () => { applyStored(); separateB(); if (visible()) schedule(); });
  state.on('selection', () => { if (visible()) schedule(); });
  state.on('settings', () => { if (visible()) schedule(); });
  update();
  installExportRow(root, id, { extra: () => pairedPilotFile(state.get(selA.value), state.get(selB.value)) });
}

// The chosen pair of datasets as one key, "A id|B id", for the settings kept
// per pair: the match rule and the planning targets.
function pairKey() { return selA.value + '|' + selB.value; }

// A planning target typed for one pair of datasets, or null.
function storedTarget(name, key) {
  const v = state.getPick(id, name + ':' + key);
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// Brings back the settings the reader made on this page (kept with the
// session) wherever they are valid. Every one is recorded when the reader
// changes it, and so applying them again changes nothing except after a
// reload.
function applyStored() {
  const get = k => state.getPick(id, k);
  if (get('mode') === 'paired' || get('mode') === 'independent') mode = get('mode');
  if (get('proc') === 't' || get('proc') === 'pooled' || get('proc') === 'np') proc = get('proc');
  if (get('planMode') === 'hw' || get('planMode') === 'power') plan.mode = get('planMode');
  if (PLAN_POWERS.includes(get('power'))) {
    plan.power = get('power');
    const sel = rootEl && rootEl.querySelector('#two-plan-pow');
    if (sel) sel.value = String(plan.power);
  }
}

// When both pickers land on the same dataset after the list changes (both
// default to the first), move B to the next one, and so a freshly loaded
// pair of designs is compared without any clicks.
function separateB() {
  if (!selA || !selB || !selA.value || selA.value !== selB.value) return;
  const other = Array.from(selB.options).find(o => o.value && o.value !== selA.value);
  // The change event keeps the picker's own record of the choice in step.
  if (other) { selB.value = other.value; selB.dispatchEvent(new Event('change', { bubbles: true })); }
}

/** Called each time the page is shown. */
export function onShow() { update(); }

export default { id, title, render, onShow };
