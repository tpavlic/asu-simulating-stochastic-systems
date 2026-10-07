// The One System page: the Student t interval on the mean, formed from one
// estimate per replication, with its descriptive statistics, a dot plot of
// the estimates with the interval under it, and a card that plans the number
// of replications by a target half-width or by a target power. A tally
// dataset can be analyzed as pooled observations only through an explicit,
// warned override.

import * as state from '../state.js';
import { repEstimates, repIds, observations, canInfer } from '../data/model.js';
import { summary } from '../stats/descriptive.js';
import { tInterval, varianceInterval, planReplications, powerOneSample, planPowerOneSample } from '../stats/intervals.js';
import { signedRank } from '../stats/nonparam.js';
import { card, cardRow, datasetSelect, levelSelect, unitLine, details, notice, spinner, DF_LABEL } from '../ui/widgets.js';
import { makeFigure, exportButtons, legend, dotPlot, extent, svgEl, tok } from '../ui/plots.js';
import { installExportRow } from '../ui/exportrow.js';
import { oneRecipe, oneTooBig } from '../io/recipes.js';
import { assumptionChecks } from '../ui/checks.js';
import { registerTips } from '../ui/tooltip.js';
import { num, intl, pct, esc, dash, lvl } from '../ui/format.js';

/** The page's hash id. */
export const id = 'one';
/** The page's title. */
export const title = 'One System';

const POOLED = 'pooled observations';
// Card labels are set in capitals; a symbol keeps its own case.
const NR = '<span class="sym">n</span> (R)';

let root = null;
let els = null;
let fig = null;
let dsPicker = null;
// The replication plan, set by a target half-width or by a target power. The
// half-width target is 'relative' (a percent of the mean) or 'absolute' (in
// the response's units). The absolute target and the shift δ are reset to
// their defaults whenever the dataset changes, because a value in one
// dataset's units means nothing for another.
const plan = { mode: 'hw', target: 'relative', rel: 10, abs: null, absFor: null, absSpin: null,
               delta: null, deltaFor: null, deltaSlot: {}, deltaStep: null, power: 0.8 };
// What the plan is computed from ({ ds, s, level }, or { msg } when it cannot
// be), and the page's result without its planning table; both are set by
// draw(), and so a planning control redraws only the planning card.
let planCtx = null;
let resultBase = null;
// The override is remembered per dataset, and so ticking it on one dataset
// never silently applies to the next one chosen.
const override = new Set();
// 't' for the t interval on the mean, 'np' for the Wilcoxon signed-rank
// interval on the pseudo-median.
let proc = 't';
const NP_PLAN = 'Under the Wilcoxon procedure, the planning counts are the t plan inflated by π/3 ≈ 1.047, the reciprocal of its efficiency relative to the t under normal data (about 5% more replications); under heavy tails, it needs fewer.';

// An interval or a pair of numbers takes a full row on a phone rather than
// being cut short, before and after a result arrives alike.
function wide(c) { c.classList.add('sc-wide'); return c; }

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function visible() {
  return !!root && root.classList.contains('active');
}

// Two significant digits, for a default target that reads as a round number.
function round2(v) {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

function tSub(level, df) {
  return 't<sub>' + num(1 - (1 - level) / 2, 4) + ', ' + intl(df) + '</sub>';
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

/**
 * Renders the page into its section.
 * @param {HTMLElement} rootEl
 */
export function render(rootEl) {
  root = rootEl;
  root.innerHTML = '';
  root.appendChild(el('h2', null, title));
  root.appendChild(el('p', 'lede',
    'Estimate one system’s mean from its replications: the interval on the mean, the replication outcomes themselves, and how many replications a target half-width or a target power needs.'));

  // Controls.
  const ctrl = el('div', 'sec ctrl-card');
  ctrl.innerHTML =
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="rp-ds">Dataset</label><select id="rp-ds"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="rp-lvl">Confidence level</label><select id="rp-lvl"></select></span>' +
    '</div>' +
    '<div class="ctrl-row">' +
      '<span class="ctrl-lbl" id="rp-proc-lbl"><span class="tip" tabindex="0" data-tip="t interval: on the mean, assuming the replication outcomes are normal, which averages nearly always are. Nonparametric: the Wilcoxon signed-rank interval on the pseudo-median, the Hodges–Lehmann estimate; it needs no normality and keeps its level under heavy tails, which is where to turn when the Normality section rejects.">Procedure</span></span>' +
      '<span class="seg" role="group" aria-labelledby="rp-proc-lbl">' +
        '<button type="button" class="seg-btn" data-proc="t" aria-pressed="true">t interval</button>' +
        '<button type="button" class="seg-btn" data-proc="np" aria-pressed="false">Nonparametric (Wilcoxon)</button>' +
      '</span>' +
    '</div>';
  root.appendChild(ctrl);

  // Results.
  const res = el('div', 'sec');
  const resHd = el('div', 'sec-hd', 'Interval on the mean');
  res.appendChild(resHd);
  const unitBox = el('div');
  const warnBox = el('div');
  const ovrBox = el('div');
  const row1 = el('div'), row2 = el('div'), row3 = el('div');
  const npNote = el('p', 'exp-note');
  npNote.hidden = true;
  const checks = el('div');
  res.append(unitBox, warnBox, ovrBox, row1, row2, row3, npNote, checks);
  res.appendChild(details('What the half-width means',
    '<p>The half-width is the distance from the mean to either end of the interval: t · s / √R, where s is the standard deviation of the R outcomes and t is the Student t quantile on R − 1 degrees of freedom. The interval is the mean plus or minus the half-width.</p>' +
    '<p>An interval is a test turned around: the ' + lvl(state.settings.level) + ' interval holds exactly the values a two-sided t test at α = ' + num(1 - state.settings.level, 3) + ' would not reject, and so reading whether it contains a value is that test. This holds for every interval in this tool unless its page says otherwise.</p>' +
    '<p>The confidence level describes the procedure, not this one interval: across many repetitions of the whole experiment, each with fresh replications, about that fraction of the intervals formed this way would contain the true mean. A given interval either contains it or does not.</p>' +
    '<p>The half-width shrinks with √R, and so halving it takes about four times as many replications. Dividing it by the absolute value of the mean gives the relative half-width, the precision as a fraction of the quantity estimated.</p>'));
  res.appendChild(details('Why replications are the unit of inference',
    '<p>Each replication runs the model from its own independent random numbers, and so the replication outcomes are independent and identically distributed: exactly the sample the t interval assumes.</p>' +
    '<p>Observations inside one replication are not independent. A customer who waits a long time is usually followed by another who waits a long time because both meet the same queue. Correlated observations carry less information than the same number of independent ones, and the formula s / √n, applied to them, understates the standard error, usually by a wide margin.</p>' +
    '<p>A replication outcome is an average over a whole run, and averages are close to normally distributed even when the observations are skewed, which is why the t interval on replication outcomes holds up well at moderate R.</p>'));
  root.appendChild(res);

  // The variance: a chi-square interval on the system's variability as a
  // performance measure, shown for replication outcomes only.
  const varSec = el('div', 'sec');
  varSec.hidden = true;
  varSec.appendChild(el('div', 'sec-hd', 'Interval on the variance'));
  varSec.appendChild(el('p', 'exp-note', 'The variability of a system is a performance measure in its own right: this interval is on the variance of the replication outcomes, σ², and its square root. The checks line above applies here too and matters more.'));
  const vRow1 = el('div'), vRow2 = el('div');
  varSec.append(vRow1, vRow2, notice('warn', 'These intervals assume the replication outcomes are normally distributed; unlike the t interval for the mean, they do not become safe as R grows.'));
  varSec.appendChild(details('Why the variance interval is fragile',
    '<p>The interval treats (R − 1) s² / σ² as a chi-square variable on R − 1 degrees of freedom. That is exact for normal outcomes and for no other distribution.</p>' +
    '<p>How much s² varies from sample to sample depends on the tails of the distribution, measured by its kurtosis: the variance of s² is about σ⁴ (2 / (R − 1) + κ / R), where κ is the excess kurtosis, zero for the normal. The chi-square interval assumes κ = 0. With heavier tails than the normal, s² varies more than the interval allows for, and the interval misses σ² more often than its level says.</p>' +
    '<p>The t interval for a mean improves as R grows because the sample mean becomes nearly normal whatever the data. No such effect rescues s²: the mismatch between κ / R and zero shrinks at the same rate as the 2 / (R − 1) the interval does allow for, and so for outcomes with heavier tails than the normal the actual coverage settles below the nominal level rather than approaching it. Replication outcomes are averages, and averages are closer to normal than raw observations, which helps but guarantees nothing.</p>'));
  root.appendChild(varSec);

  // Figure.
  const figSec = el('div', 'sec');
  figSec.appendChild(el('div', 'sec-hd', 'Replication outcomes'));
  const figBox = el('div');
  const leg = el('div');
  const cap = el('p', 'rv-cap');
  figSec.append(figBox, leg, cap);
  root.appendChild(figSec);
  fig = makeFigure(figBox, { height: 160, narrowHeight: 180, margin: { t: 10, b: 42 }, xLabel: 'Replication outcome', ariaLabel: 'Replication outcomes with the interval on their mean' });
  exportButtons(figBox, fig, 'replication-outcomes');

  // Planning.
  const planSec = el('div', 'sec plan-card');
  planSec.innerHTML = planMarkup('one',
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="The half-width you would like the interval on the mean to have, either in the response’s own units or as a percent of the mean.">Target half-width</span></span>' +
        '<span class="seg" role="group" aria-label="Target half-width as">' +
          '<button type="button" class="seg-btn" data-target="absolute" aria-pressed="false">absolute</button>' +
          '<button type="button" class="seg-btn" data-target="relative" aria-pressed="true">relative</button>' +
        '</span></span>' +
      '<span class="ctrl-pair"><span id="rp-tgt-box"></span><span class="ctrl-note" id="rp-tgt-unit"></span></span>' +
    '</div>',
    powerControls('one', 'Shift to detect δ',
      'The difference between the true mean and a reference value, such as a target or a known baseline, that a two-sided one-sample t test should detect, in the response’s units. The default is 10% of the sample mean.'));
  planSec.appendChild(details('Half-width or power?', PLAN_WHY));
  root.appendChild(planSec);

  els = { varSec, vRow1, vRow2, ctrl, resHd, unitBox, warnBox, ovrBox, row1, row2, row3, npNote, checks, leg, cap, planSec,
          sel: ctrl.querySelector('#rp-ds'), lvl: ctrl.querySelector('#rp-lvl'),
          tgtBox: planSec.querySelector('#rp-tgt-box'), tgtUnit: planSec.querySelector('#rp-tgt-unit'),
          segs: Array.from(planSec.querySelectorAll('[data-target]')),
          paneHw: planSec.querySelector('[data-pane="hw"]'), panePw: planSec.querySelector('[data-pane="power"]'),
          deltaHost: planSec.querySelector('.plan-delta-host'), deltaUnit: planSec.querySelector('.plan-delta-unit'),
          pow: planSec.querySelector('#one-plan-pow') };

  dsPicker = datasetSelect(els.sel, { value: state.selected() || undefined, remember: { page: id, key: 'ds' } });
  // Only the reader's own choice moves the shared selection; a change the
  // picker fires itself, after a dataset is removed, only redraws.
  els.sel.addEventListener('change', ev => {
    const before = state.selected();
    if (ev.isTrusted && els.sel.value) state.select(els.sel.value);
    if (state.selected() === before && visible()) draw();
  });
  levelSelect(els.lvl);
  ctrl.querySelectorAll('[data-proc]').forEach(b => b.addEventListener('click', () => {
    if (proc === b.dataset.proc) return;
    proc = b.dataset.proc;
    state.setPick(id, 'proc', proc);
    syncProc();
    draw();
  }));
  for (const b of els.segs) {
    b.addEventListener('click', () => {
      if (plan.target === b.dataset.target) return;
      plan.target = b.dataset.target;
      state.setPick(id, 'targetType', plan.target);
      buildTargetInput();
      drawPlan();
    });
  }
  planSec.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => {
    if (plan.mode === b.dataset.plan) return;
    plan.mode = b.dataset.plan;
    state.setPick(id, 'planMode', plan.mode);
    drawPlan();
  }));
  els.pow.addEventListener('change', () => { plan.power = Number(els.pow.value); state.setPick(id, 'power', plan.power); drawPlan(); });
  applyStored();
  buildTargetInput();

  state.on('datasets', () => {
    if (applyStored()) buildTargetInput();
    if (visible()) draw();
  });
  state.on('settings', () => { if (visible()) draw(); });
  state.on('selection', sel => {
    if (sel && sel !== els.sel.value && state.get(sel)) els.sel.value = sel;
    if (visible()) draw();
  });

  draw();
  installExportRow(root, id);
  registerTips(root);
}

// Brings back the planning settings the reader made (kept with the session)
// wherever they are valid and says whether the target field needs
// rebuilding. Every one is recorded when the reader changes it, and so
// applying them again changes nothing except after a reload.
function syncProc() {
  if (els) els.ctrl.querySelectorAll('[data-proc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.proc === proc)));
}

function applyStored() {
  const get = k => state.getPick(id, k);
  let rebuild = false;
  if (get('proc') === 't' || get('proc') === 'np') { proc = get('proc'); syncProc(); }
  if (get('planMode') === 'hw' || get('planMode') === 'power') plan.mode = get('planMode');
  if ((get('targetType') === 'absolute' || get('targetType') === 'relative') && get('targetType') !== plan.target) {
    plan.target = get('targetType');
    rebuild = true;
  }
  const rel = get('targetRel');
  if (typeof rel === 'number' && rel >= 0.1 && rel <= 100 && rel !== plan.rel) { plan.rel = rel; rebuild = true; }
  if (PLAN_POWERS.includes(get('power'))) { plan.power = get('power'); els.pow.value = String(plan.power); }
  return rebuild;
}

// A target in one dataset's units, typed for that dataset, or null.
function storedFor(name, dsId) {
  const v = dsId ? state.getPick(id, name + ':' + dsId) : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function currentDataset() {
  return els && els.sel.value ? state.get(els.sel.value) : null;
}

// The target field is rebuilt when the target kind or the dataset changes,
// because a spinner's step is fixed when it is made.
function buildTargetInput() {
  for (const b of els.segs) b.setAttribute('aria-pressed', String(b.dataset.target === plan.target));
  els.tgtBox.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'rp-tgt';
  inp.setAttribute('aria-label', 'Target half-width');
  els.tgtBox.appendChild(inp);
  if (plan.target === 'relative') {
    inp.value = String(plan.rel);
    spinner(inp, { min: 0.1, max: 100, step: 1, decimals: 1, onChange: v => { plan.rel = v; state.setPick(id, 'targetRel', v); drawPlan(); } });
    els.tgtUnit.textContent = '% of the mean';
    plan.absSpin = null;
  } else {
    const ds = currentDataset();
    ensureAbsDefault(ds);
    const v = plan.abs != null ? plan.abs : 1;
    const step = stepFor(v);
    inp.value = String(v);
    plan.absSpin = spinner(inp, { min: step, max: 1e12, step, onChange: x => {
      plan.abs = x;
      if (plan.absFor) state.setPick(id, 'target:' + plan.absFor, x);
      drawPlan();
    } });
    plan.abs = plan.absSpin.get();
    els.tgtUnit.textContent = ds && ds.unit ? ds.unit : 'in the response’s units';
  }
}

// The default for a target in the response's units: 10% of the mean of the
// chosen dataset's estimates to two significant digits, or a quarter of
// their standard deviation when the mean is zero.
function defaultShift(ds) {
  if (!ds) return 1;
  const est = Array.from(repEstimates(ds)).filter(Number.isFinite);
  if (!est.length) return 1;
  const s = summary(est);
  return Math.abs(s.mean) > 0 ? round2(0.1 * Math.abs(s.mean)) : round2(0.25 * s.sd);
}

// Seeds the absolute target at the default for the chosen dataset.
function ensureAbsDefault(ds) {
  const key = ds ? ds.id : null;
  if (plan.absFor === key && plan.abs != null) return;
  plan.absFor = key;
  const kept = storedFor('target', key);
  plan.abs = kept !== null ? kept : defaultShift(ds);
}

// Seeds δ at the default for the chosen dataset and shows it in its field,
// which is empty and disabled while there is nothing to plan from.
function syncDeltaInput(ds, ready) {
  const key = ds ? ds.id : null;
  if (ready && plan.deltaFor !== key) {
    plan.deltaFor = key;
    const def = defaultShift(ds);
    const kept = storedFor('delta', key);
    plan.delta = kept !== null ? kept : def;
    plan.deltaStep = stepFor(def);
  }
  syncSpin(plan.deltaSlot, els.deltaHost, 'one-plan-delta', 'Shift to detect δ', plan.deltaStep || 1,
    ready ? plan.delta : null, v => { plan.delta = v; if (plan.deltaFor) state.setPick(id, 'delta:' + plan.deltaFor, v); drawPlan(); });
  els.deltaUnit.textContent = ds && ds.unit ? ds.unit : 'in the response’s units';
}

function placeholderRows(label) {
  const note = label || '';
  if (els.checks) els.checks.replaceChildren();
  els.row1.replaceChildren(cardRow([card(NR, dash, note || '&nbsp;'), card('Mean', dash, note), card('Sd', dash, note), card('Se', dash, note), card('Min', dash, note), card('Max', dash, note)]));
  els.row2.replaceChildren(cardRow([card('Q1', dash, note), card('Median', dash, note), card('Q3', dash, note)]));
  els.row3.replaceChildren(cardRow([wide(card(lvl(state.settings.level) + ' interval', '[' + dash + ', ' + dash + ']', note)), card('Half-width', dash, note || '&nbsp;'), wide(card('Mean ± half-width', dash + ' ± ' + dash, note))]));
}

/** Redraws the page from the current state. */
// Card labels are set in capitals; a symbol keeps its own case, and so σ
// does not turn into Σ.
function S(html) { return '<span class="sym">' + html + '</span>'; }

function draw() {
  if (!els) return;
  const ds = currentDataset();
  const level = state.settings.level;
  els.varSec.hidden = true;

  els.unitBox.replaceChildren(unitLine(ds));
  els.warnBox.replaceChildren();
  els.ovrBox.replaceChildren();

  if (!ds) {
    placeholderRows();
    drawFigure(null);
    finish(null, 'Load a dataset on the Import page to plan replications.');
    return;
  }

  const inf = canInfer(ds);
  const isTally = ds.kind === 'tally';
  const oneRep = ds.reps.length === 1;
  const pooled = isTally && override.has(ds.id);
  if (!inf.ok && !pooled) els.warnBox.appendChild(notice('warn', esc(inf.reason)));
  if (isTally) els.ovrBox.appendChild(overrideBlock(ds, pooled, oneRep));

  const ids = repIds(ds);
  const estAll = repEstimates(ds);
  const labels = [], est = [], estIds = [];
  for (let i = 0; i < estAll.length; i++) {
    if (Number.isFinite(estAll[i])) { est.push(estAll[i]); estIds.push(ids[i]); labels.push('replication ' + ids[i]); }
  }

  let x;
  if (pooled) x = Array.from(observations(ds)).filter(Number.isFinite);
  else x = est;
  if (!pooled && !inf.ok) {
    placeholderRows();
    drawFigure({ values: est, labels, ti: null, ds, pooled: false });
    finish(null, 'Planning needs at least two replication outcomes.');
    return;
  }
  if (x.length < 2) {
    placeholderRows(pooled ? POOLED : '');
    drawFigure({ values: x, labels: null, ti: null, ds, pooled });
    finish(null, 'Planning needs at least two replication outcomes.');
    return;
  }

  const s = summary(x);
  const ti = tInterval(x, level);
  // The Wilcoxon interval is offered on replication outcomes; the pooled
  // observations keep the t interval, whose false independence is the point.
  const np = proc === 'np' && !pooled;
  if (proc === 'np' && pooled) els.warnBox.appendChild(notice('info', 'The Wilcoxon interval is offered on replication outcomes; the pooled observations use the t interval.'));
  const sr = np ? signedRank(x, { level }) : null;
  els.resHd.textContent = np ? 'Interval on the pseudo-median (Wilcoxon signed-rank)' : 'Interval on the mean';
  els.npNote.textContent = np ? NP_PLAN : '';
  els.npNote.hidden = !np;
  // The pooled override's own warning says what is wrong with it; the
  // checks run on replication outcomes only.
  els.checks.replaceChildren(...(pooled || np ? [] : [assumptionChecks({ sets: [{ name: 'the replication outcomes', values: x, dsId: ds.id }], alpha: 1 - state.settings.base,
    procedure: 'the t interval', declared: 'between replications cannot be checked from the data, and the t interval assumes it; it holds when each replication ran on its own random streams.' })]));
  const note = pooled ? POOLED : '';
  const nLabel = pooled ? '<span class="sym">n</span>' : NR;
  els.row1.replaceChildren(cardRow([
    card(nLabel, intl(s.n), pooled ? POOLED : 'replication outcomes'),
    card('Mean', num(s.mean), note), card('Sd', num(s.sd), note), card('Se', num(s.se), note),
    card('Min', num(s.min), note), card('Max', num(s.max), note)
  ]));
  els.row2.replaceChildren(cardRow([card('Q1', num(s.q1), note), card('Median', num(s.median), note), card('Q3', num(s.q3), note)]));
  const tNote = tSub(level, ti.df) + ' = ' + num(ti.t);
  if (np) {
    const basis = sr.exact ? 'exact distribution' : 'normal approximation';
    els.row3.replaceChildren(cardRow([
      wide(card(lvl(level) + ' interval for the pseudo-median', '[' + num(sr.lo) + ', ' + num(sr.hi) + ']', sr.exact && Number.isFinite(sr.achieved) ? 'achieved level ' + pct(sr.achieved, 1) : basis)),
      card('<span class="tip" tabindex="0" data-tip="The Hodges–Lehmann estimate: the median of the averages of every pair of outcomes, each outcome paired with itself as well.">Pseudo-median</span>', num(sr.estimate), 'Hodges–Lehmann'),
      wide(card('Basis', basis, sr.exact ? 'signed-rank distribution of n = ' + intl(s.n) : 'with continuity correction' + (sr.ties ? ', ties present' : '')))
    ]));
  } else {
    els.row3.replaceChildren(cardRow([
      wide(card(lvl(level) + ' interval', '[' + num(ti.lo) + ', ' + num(ti.hi) + ']', note)),
      card('Half-width', num(ti.hw), pooled ? POOLED + '; ' + tNote : tNote),
      wide(card('Mean ± half-width', num(ti.mean) + ' ± ' + num(ti.hw), note))
    ]));
  }

  drawFigure({ values: pooled ? x : est, labels: pooled ? null : labels, ti: np ? { lo: sr.lo, hi: sr.hi, mean: sr.estimate, hw: NaN } : ti, ds, pooled, np });

  // The variance interval, on replication outcomes only.
  const vi = pooled ? null : varianceInterval(x, level);
  els.varSec.hidden = !vi;
  if (vi) {
    const pLo = (1 - level) / 2, pHi = 1 - pLo;
    els.vRow1.replaceChildren(cardRow([
      card('R (' + DF_LABEL + ')', intl(vi.n) + ' (' + intl(vi.df) + ')', 'replication outcomes'),
      card(S('s²'), num(vi.s2), 'sample variance'),
      card(S('s'), num(vi.s), 'sample standard deviation'),
      card(S('χ²') + ' quantiles', num(vi.chiLo) + ', ' + num(vi.chiHi), 'χ²<sub>' + num(pLo, 4) + ', ' + intl(vi.df) + '</sub> and χ²<sub>' + num(pHi, 4) + ', ' + intl(vi.df) + '</sub>')
    ]));
    els.vRow2.replaceChildren(cardRow([
      wide(card(lvl(level) + ' interval for ' + S('σ²'), '[' + num(vi.lo2) + ', ' + num(vi.hi2) + ']', '(R − 1) s² / χ²')),
      wide(card(lvl(level) + ' interval for ' + S('σ'), '[' + num(vi.loS) + ', ' + num(vi.hiS) + ']', 'square roots of the σ² interval'))
    ]));
  }

  // The page's result, for its export row and the Report page.
  const estRows = pooled ? [] : est.map((v, i) => [estIds[i], v]);
  const intervalRows = np ? [
    ['n', s.n], ['mean', s.mean], ['sd', s.sd], ['min', s.min], ['q1', s.q1], ['median', s.median], ['q3', s.q3], ['max', s.max],
    ['pseudo-median (Hodges-Lehmann)', sr.estimate], ['lower', sr.lo], ['upper', sr.hi],
    ['level', sr.exact ? sr.achieved : level], ['basis', sr.exact ? 'exact signed-rank distribution' : 'normal approximation']
  ] : [
    ['n', s.n], ['mean', s.mean], ['sd', s.sd], ['se', s.se], ['min', s.min], ['q1', s.q1],
    ['median', s.median], ['q3', s.q3], ['max', s.max], ['df', ti.df], ['t quantile', ti.t],
    ['half-width', ti.hw], ['lower', ti.lo], ['upper', ti.hi]
  ];
  const tables = [];
  if (!pooled) tables.push({ name: 'Replication outcomes', headers: ['replication', 'estimate'], rows: estRows });
  tables.push({ name: np ? 'Signed-rank interval (Wilcoxon)' : 'Interval', headers: ['statistic', 'value'], rows: intervalRows });
  if (vi) tables.push({ name: 'Variance', headers: ['statistic', 'value'], rows: [
    ['R', vi.n], ['df', vi.df], ['s^2', vi.s2], ['s', vi.s], ['lower for sigma^2', vi.lo2], ['upper for sigma^2', vi.hi2],
    ['lower for sigma', vi.loS], ['upper for sigma', vi.hiS], ['chi-square ' + num((1 - level) / 2, 4), vi.chiLo], ['chi-square ' + num(1 - (1 - level) / 2, 4), vi.chiHi]
  ] });
  // Planning works on replication outcomes only.
  finish({
    title: (np ? 'Interval on the pseudo-median: ' : 'Interval on the mean: ') + ds.name,
    provenance: {
      dataset: ds.name,
      'confidence level': lvl(level),
      procedure: np ? 'Wilcoxon signed-rank (nonparametric)' : 't interval',
      'unit of inference': pooled ? 'pooled observations (override)' : 'replication means'
    },
    tables,
    summaryHtml: np
      ? '<p>' + esc(ds.name) + ': pseudo-median ' + num(sr.estimate) + ' (' + lvl(level) + ' Wilcoxon interval [' + num(sr.lo) + ', ' + num(sr.hi) + '], n = ' + intl(s.n) + ' replications).</p>'
      : '<p>' + esc(ds.name) + ': mean ' + num(ti.mean) + ' ± ' + num(ti.hw) + ' (' + lvl(level) +
        ' interval [' + num(ti.lo) + ', ' + num(ti.hi) + '], n = ' + intl(s.n) + (pooled ? ' pooled observations' : ' replications') + ').</p>',
    // What the regenerate scripts are built from; drawPlan() keeps it out of the registered result.
    recipeIn: { ds, x, ids: pooled ? null : estIds, pooled, proc }
  }, pooled ? 'Planning counts replications, and so it uses the replication outcomes; it is off while the pooled observations are in use.' : { ds, s, level });
}

// Records the page's result without its planning table, and what the plan
// is computed from (a context, or the message saying why there is none),
// and then draws the planning card, which registers the full result.
function finish(base, ctx) {
  resultBase = base;
  planCtx = typeof ctx === 'string' ? { msg: ctx } : ctx;
  drawPlan();
}

/** Redraws the planning card from the context draw() left, and registers the result. */
function drawPlan() {
  // A rank procedure is sized from the t plan: n times pi/3, rounded up.
  const npOn = proc === 'np';
  const inflate = n => (n == null ? null : npOn ? Math.ceil(n * Math.PI / 3) : n);
  const ranked = n => (npOn && n != null ? n : null);
  if (!els) return;
  syncPlanMode(els.planSec, plan.mode);
  const ctx = planCtx && !planCtx.msg ? planCtx : null;
  const msg = planCtx && planCtx.msg ? planCtx.msg : 'Load a dataset on the Import page to plan replications.';
  const ds = ctx ? ctx.ds : currentDataset();
  const unit = ds && ds.unit ? ' ' + ds.unit : '';
  const sd = ctx ? ctx.s.sd : NaN, R = ctx ? ctx.s.n : NaN, mean = ctx ? ctx.s.mean : NaN;
  const level = state.settings.level, alpha = 1 - level;
  const closing = 'An estimate conditional on the current sample standard deviation s = ' + num(sd) +
    ', not a guarantee; a larger pilot can move it either way.';
  const rText = 'the current R\u00a0=\u00a0' + intl(R);
  const rows = [];

  // By half-width.
  if (plan.target === 'absolute' && ds && plan.absFor !== ds.id) buildTargetInput();
  const relative = plan.target === 'relative';
  let hp = { n: null, hwAtN: NaN, h: NaN }, hwNote = esc(msg);
  if (ctx) {
    hp = planReplications({ sd, level, target: relative ? plan.rel / 100 : plan.abs, relative, mean });
    hwNote = hp.n != null ? closing
      : relative && !(Math.abs(mean) > 0) ? 'A relative target needs a mean other than zero; set an absolute target instead.'
        : 'No replication count meets this target; choose a larger half-width.';
  }
  const hText = 'h = ' + num(hp.h) + unit + (relative ? ' (' + num(plan.rel) + '% of the mean)' : '');
  fillPane(els.paneHw, 'Replications needed for a half-width of ' + esc(hText),
    planCards('hw', { n: inflate(hp.n), tN: ranked(hp.n), at: hp.hwAtN, nNote: 'replications in all', atNote: 'if s stays at ' + num(sd), R, rText }), hwNote);
  if (ctx) rows.push(planRow('by half-width', hText, inflate(hp.n), hp.hwAtN, R));

  // By power.
  syncDeltaInput(ds, !!ctx);
  const delta = plan.delta;
  let pp = { n: null, powerAtN: NaN }, cur = NaN, pwNote = esc(msg);
  if (ctx) {
    pp = planPowerOneSample({ sd, delta, alpha, power: plan.power });
    cur = sd > 0 && delta > 0 ? powerOneSample({ n: R, sd, delta, alpha }) : NaN;
    pwNote = pp.n != null ? closing : esc(pp.reason);
  }
  const dText = 'δ = ' + num(ctx ? delta : NaN) + unit;
  fillPane(els.panePw, 'Replications needed to detect a shift of ' + esc(dText) + ' from a reference mean with ' + powerPct(plan.power) +
    ' power, by a two-sided one-sample t test at α = ' + num(alpha),
    planCards('power', { n: inflate(pp.n), tN: ranked(pp.n), at: pp.powerAtN, nNote: 'replications in all', atNote: 'at ' + esc(dText), R, rText, cur, curNote: 'at R\u00a0=\u00a0' + intl(R) }), pwNote);
  if (ctx) rows.push(planRow('by power', dText + ', ' + powerPct(plan.power) + ' power, α = ' + num(alpha), inflate(pp.n), pp.powerAtN, R));

  if (!resultBase) { state.setResult(id, null); return; }
  const prov = Object.assign({}, resultBase.provenance, ctx ? {
    'planning mode shown': plan.mode === 'hw' ? 'by half-width' : 'by power',
    'planning half-width target': hText,
    'planning shift to detect': dText,
    'planning target power': powerPct(plan.power),
    'planning significance level': num(alpha)
  } : { 'replication planning': 'off while the pooled observations are in use' });
  const tables = resultBase.tables.concat(rows.length ? [{ name: 'Replications needed', headers: PLAN_HEADERS, rows }] : []);
  // The scripts that regenerate these results are written only when asked
  // for, from the inputs and settings in force now.
  const { recipeIn, ...result } = resultBase;
  const base = state.settings.base;
  const planIn = ctx ? { relative, rel: plan.rel, abs: relative ? null : plan.abs, delta, power: plan.power } : null;
  const regen = { tooBig: oneTooBig(recipeIn), build: () => oneRecipe(Object.assign({}, recipeIn, { level, base, title: result.title, provenance: prov, plan: planIn })) };
  state.setResult(id, Object.assign(result, { provenance: prov, tables, regen }));
}

// The pooled-observations override. It is a full warning with its checkbox
// for a one-replication tally dataset, and whenever it is ticked; on a tally
// dataset with several replications it is one muted checkbox line, so that a
// reader can still see how narrow the pooled interval would be.
function overrideBlock(ds, on, oneRep) {
  const lab = el('label', 'ctrl-chk rv-ovr');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = on;
  cb.addEventListener('change', () => {
    if (cb.checked) override.add(ds.id); else override.delete(ds.id);
    draw();
  });
  lab.append(cb, document.createTextNode(' Treat the pooled observations as independent (not recommended)'));
  if (!on && !oneRep) {
    const p = el('p', 'rv-ovr-line');
    p.appendChild(lab);
    return p;
  }
  const box = notice('warn',
    'The observations within a replication are serially correlated: a long wait tends to follow a long wait. ' +
    'An interval that treats them as independent is usually far too narrow because it counts each observation as new information. ' +
    'For one long run, the right tool is batch means on the Steady State page: cut the warm-up, split the rest of the run into long batches, and form the interval from the batch means.');
  const body = box.querySelector('.notice-body');
  const p = el('p', 'rv-ovr-in');
  p.appendChild(lab);
  body.appendChild(p);
  return box;
}

function axisLabel(ds, pooled) {
  if (!ds) return 'Replication outcome';
  const r = ds.response || 'value';
  if (pooled) return 'Observation of ' + r;
  if (ds.kind === 'reps') return r + ' per replication';
  if (ds.kind === 'time') return 'Time-weighted replication mean of ' + r;
  return 'Replication mean of ' + r;
}

function drawFigure(d) {
  const level = state.settings.level;
  const cEst = '--est', cTruth = '--truth';
  if (!d || !d.values.length) {
    fig.render(f => {
      f.x([0, 1]);
      f.axes({ y: false, xLabel: axisLabel(d && d.ds, false), xFormat: () => '' });
      svgEl('text', { x: f.iw / 2, y: f.ih / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: tok('--muted') }, f.inner).textContent = 'No replication outcomes to show.';
    });
    legend(els.leg, [
      { swatch: 'dot', color: cEst, label: 'one replication outcome' },
      { swatch: 'line', color: cTruth, label: 'mean of the replication outcomes' },
      { swatch: 'interval', color: cTruth, label: lvl(level) + ' interval on the mean' }
    ]);
    els.cap.textContent = 'Choose a dataset to see its replication outcomes.';
    return;
  }
  const { values, labels, ti, ds, pooled, np } = d;
  const intName = np ? ' Wilcoxon interval on the pseudo-median' : ' interval on the mean';
  const hasInt = ti && Number.isFinite(ti.lo);
  const band = hasInt ? 28 : 0;
  fig.render(f => {
    // Many pooled observations stack into a dot histogram, which needs room.
    f.setHeight(values.length > 300 ? 260 : (f.narrow ? 180 : 160));
    f.x(hasInt ? extent(values, [ti.lo, ti.hi]) : extent(values), { pad: 0.06, nice: true });
    f.axes({ y: false, xLabel: axisLabel(ds, pooled) });
    // The dots use the plotting area above the interval's band.
    const fullH = f.ih;
    f.ih = fullH - band;
    // One replication gives one outcome, and a mean line through it would
    // pretend to an average across replications that does not exist.
    dotPlot(f, values, { labels: labels || undefined, mean: values.length > 1, r: values.length > 300 ? 2 : undefined, axes: false });
    f.ih = fullH;
    const dotFn = f.readoutFn;
    if (hasInt) {
      const y = fullH - band / 2 - 2;
      const x0 = f.sx(ti.lo), x1 = f.sx(ti.hi), xm = f.sx(ti.mean);
      const c = tok(cTruth);
      const g = svgEl('g', { class: 'm-int' }, f.inner);
      svgEl('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: c, 'stroke-width': 2.5 }, g);
      for (const x of [x0, x1]) svgEl('line', { x1: x, x2: x, y1: y - 6, y2: y + 6, stroke: c, 'stroke-width': 2 }, g);
      svgEl('circle', { cx: xm, cy: y, r: 4.2, fill: c }, g);
      // In the exported figure the interval sits one row under the dots.
      const yi = f.yRange[0] - 1;
      f.yRange = [yi - 1, f.yRange[1]];
      f.series.push({ kind: 'segments', x0: [ti.lo, ti.lo, ti.hi], x1: [ti.hi, ti.lo, ti.hi], y0: [yi, yi - 0.3, yi - 0.3], y1: [yi, yi + 0.3, yi + 0.3], color: c, width: 2.5, label: lvl(level) + intName },
        { kind: 'points', x: [ti.mean], y: [yi], color: c, label: np ? 'pseudo-median of the replication outcomes' : 'mean of the replication outcomes' });
      f.readout((dx, dy, px, py) => {
        if (py >= fullH - band) {
          return [lvl(level) + ' interval: [' + num(ti.lo) + ', ' + num(ti.hi) + ']', np ? 'pseudo-median ' + num(ti.mean) : 'mean ' + num(ti.mean) + ' ± ' + num(ti.hw)];
        }
        return dotFn ? dotFn(dx, dy, px, py) : null;
      });
    }
  });
  const items = [{ swatch: 'dot', color: cEst, label: pooled ? 'one observation' : 'one replication outcome' }];
  if (values.length > 1) items.push({ swatch: 'line', color: cTruth, label: pooled ? 'mean of the pooled observations' : 'mean of the replication outcomes' });
  if (hasInt) items.push({ swatch: 'interval', color: cTruth, label: lvl(level) + intName });
  legend(els.leg, items);
  if (pooled) {
    els.cap.textContent = 'Each dot is one observation from the pooled replications, stacked upward where they crowd, and the bar under them is the interval that treats them as independent; its narrowness reflects the false assumption, not real precision.';
  } else if (hasInt && np) {
    els.cap.textContent = 'Each dot is one replication’s outcome, and the bar under them is the ' + lvl(level) + ' Wilcoxon signed-rank interval on the pseudo-median, with the Hodges–Lehmann estimate as its dot; it needs no normality, and under heavy tails it is the interval to report.';
  } else if (hasInt) {
    els.cap.textContent = 'Each dot is one replication’s outcome, and the bar under them is the ' + lvl(level) + ' t interval on the mean, which is far narrower than the spread of the dots because it describes the mean, not a single replication.';
  } else {
    els.cap.textContent = values.length === 1
      ? 'This dataset holds one replication, and so one outcome: the mean of that run’s observations. One outcome is a number, not a sample; nothing can be inferred from it, and an interval needs at least two replications.'
      : 'Each dot is one replication’s outcome; an interval needs at least two of them.';
  }
}

/** Called each time the page is shown. */
export function onShow() {
  if (dsPicker) dsPicker.refresh();
  draw();
}

export default { id, title, render, onShow };
