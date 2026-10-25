// The One System page: the Student t interval on the mean, formed from one
// estimate per replication, drawn first as a dot plot of the estimates with
// the interval under them, and then set out as one table beside the
// prediction interval for the next outcome; the t test against a stated
// mean, whose value can be dragged on the plot; the chi-square interval on
// the variance; a quantile with its distribution-free interval; and a card
// that plans the number of replications by a target half-width or by a
// target power. A tally dataset can be analyzed as pooled observations only
// through an explicit, warned override. Under a transform, every replication
// outcome is put through it first, and each interval is carried back to the
// response's units in the last columns of its table; the pooled observations
// are never transformed.

import * as state from '../state.js';
import { repEstimates, repIds, observations, canInfer } from '../data/model.js';
import { summary, sortedCopy } from '../stats/descriptive.js';
import { normInv } from '../stats/special.js';
import { tInterval, varianceInterval, oneSampleT, predictionInterval, quantileInterval, planReplications, powerOneSample, planPowerOneSample } from '../stats/intervals.js';
import { signedRank } from '../stats/nonparam.js';
import { card, cardRow, table, para, datasetSelect, levelSelect, unitLine, details, notice, spinner, DF_LABEL,
         transformSelect, transformNote, transformRefusal, TRANSFORM_LABEL } from '../ui/widgets.js';
import { transformSets, transformOf, isTransform, backTransform, backInterval, LOG_DEFAULT_SHIFT } from '../stats/transform.js';
import { makeFigure, exportButtons, legend, dotPlot, dragLine, extent, svgEl, tok } from '../ui/plots.js';
import { installExportRow } from '../ui/exportrow.js';
import { oneRecipe, oneTooBig } from '../io/recipes.js';
import { assumptionChecks } from '../ui/checks.js';
import { registerTips } from '../ui/tooltip.js';
import { num, stat, intl, pct, esc, dash, lvl, ordinal } from '../ui/format.js';
import { outcomeAxis } from '../ui/rules.js';

/** The page's hash id. */
export const id = 'one';
/** The page's title. */
export const title = 'One System';

const POOLED = 'pooled observations';

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
// The stated mean of the t test, kept per dataset and transform like the
// planning target (`mu0For` is that key; `mu0Step` is its field's step, which
// the dragged line on the plot moves by), whether the plot draws it, and the
// quantile's p, both settings for the page.
const extra = { mu0: null, mu0For: null, mu0Spin: null, mu0Step: 1, showMu0: false, qp: 0.9 };
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
function planMarkup(p, hwControls, powerControlsHtml, heading = 'How many replications', note = '') {
  return '<div class="sec-hd">' + heading + '</div>' + note +
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
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="rp-tf">' + TRANSFORM_LABEL + '</label><select id="rp-tf"></select></span>' +
    '</div>' +
    '<div class="ctrl-row">' +
      '<span class="ctrl-lbl" id="rp-proc-lbl"><span class="tip" tabindex="0" data-tip="t interval: on the mean, assuming the replication outcomes are normal, which averages nearly always are. Nonparametric: the Wilcoxon signed-rank interval on the pseudo-median, the Hodges–Lehmann estimate; it needs no normality and keeps its level under heavy tails, which is where to turn when the Normality section rejects.">Procedure</span></span>' +
      '<span class="seg" role="group" aria-labelledby="rp-proc-lbl">' +
        '<button type="button" class="seg-btn" data-proc="t" aria-pressed="true">t interval</button>' +
        '<button type="button" class="seg-btn" data-proc="np" aria-pressed="false">Nonparametric (Wilcoxon)</button>' +
      '</span>' +
    '</div>';
  const tfBox = el('div');
  ctrl.appendChild(tfBox);
  root.appendChild(ctrl);

  // Results: the replication outcomes drawn first, the interval on the mean
  // and the prediction interval as one table beneath them, and the test
  // against a stated mean as a control row and a one-row table.
  const res = el('div', 'sec');
  const resHd = el('div', 'sec-hd', 'Interval estimates');
  res.appendChild(resHd);
  const unitBox = el('div'), warnBox = el('div'), ovrBox = el('div');
  const figBox = el('div'), leg = el('div'), cap = el('p', 'rv-cap');
  const mainTab = el('div');
  const npNote = el('p', 'exp-note');
  npNote.hidden = true;
  const checks = el('div');
  // The stated mean: the interval read as a test of one value. Its field
  // sits above the plot, which draws the value when its box is ticked, and
  // the test's statistic, p-value, and verdict are a note under the
  // interval's own row of the table.
  const testCtrl = el('div', 'ctrl-row');
  testCtrl.hidden = true;
  testCtrl.innerHTML = '<span class="ctrl-pair"><span class="ctrl-lbl"><span class="tip rv-tip" tabindex="0" data-tip="A value to test the mean against: a measurement from the real system, a requirement, or a benchmark. The test, written under the interval’s row of the table, rejects it when it lies outside the interval.">Stated mean&nbsp;<span class="sym">μ₀</span></span></span>' +
    '<span id="rp-mu0-box"></span><span class="ctrl-note" id="rp-mu0-unit"></span></span>' +
    '<label class="ctrl-chk"><input type="checkbox" id="rp-mu0-show"> <span class="tip" tabindex="0" data-tip="Draws μ₀ on the plot as a dashed line that can be dragged (the arrow keys move it when it has focus); the field and the test follow it.">Show μ₀ on the plot</span></label>';
  res.append(unitBox, warnBox, ovrBox, testCtrl, figBox, leg, cap, mainTab, npNote, checks);
  fig = makeFigure(figBox, { height: 160, narrowHeight: 180, margin: { t: 10, b: 42 }, xLabel: 'Replication outcome', ariaLabel: 'Replication outcomes with the interval on their mean' });
  exportButtons(figBox, fig, 'replication-outcomes');
  res.appendChild(details('What the half-width means',
    '<p>The half-width is the distance from the mean to either end of the interval: t · s / √R, where s is the standard deviation of the R outcomes and t is the Student t quantile on R − 1 degrees of freedom. The interval is the mean plus or minus the half-width.</p>' +
    '<p>An interval is a test turned around: the ' + lvl(state.settings.level) + ' interval holds exactly the values a two-sided t test at α = ' + num(1 - state.settings.level, 3) + ' would not reject, and so reading whether it contains a value is that test. This holds for every interval in this tool unless its page says otherwise.</p>' +
    '<p>The confidence level describes the procedure, not this one interval: across many repetitions of the whole experiment, each with fresh replications, about that fraction of the intervals formed this way would contain the true mean. A given interval either contains it or does not.</p>' +
    '<p>The half-width shrinks with √R, and so halving it takes about four times as many replications. Dividing it by the absolute value of the mean gives the relative half-width, the precision as a fraction of the quantity estimated.</p>'));
  res.appendChild(details('Confidence interval or prediction interval?',
    '<p>The confidence interval is about the mean: it is the range of values for the true mean that the replications do not rule out, and it narrows without limit as replications are added, because the mean is estimated ever more precisely.</p>' +
    '<p>The prediction interval is about the next outcome: the range a further replication, run the same way, would fall in with the stated probability. Its half-width is t · s · √(1 + 1/R). The 1 is the spread of a single outcome and the 1/R the uncertainty in the mean, and so as R grows the interval settles at about ±2s around the mean rather than shrinking to a point. The confidence interval measures error in an estimate; the prediction interval measures the risk in one more draw.</p>' +
    '<p>Both assume the replication outcomes are normal. The confidence interval forgives a departure as R grows, because an average becomes normal; the prediction interval does not, because it describes a single outcome.</p>'));
  res.appendChild(details('How the test and the interval agree',
    '<p>The one-sample t statistic is t₀ = (ȳ − μ₀) / (s / √R), the distance from the sample mean to μ₀ in standard errors, on R − 1 degrees of freedom. The two-sided p-value is the probability of a sample mean at least that far from μ₀, in either direction, when μ₀ is the true mean. The test rejects μ₀ at level α when p < α, which is exactly when μ₀ falls outside the 100(1 − α)% interval.</p>' +
    '<p>Not rejecting μ₀ is not evidence that the mean equals μ₀: with few replications the interval is wide and many values survive. The planning card below says how many replications a given difference from μ₀ needs to be detected with a given power.</p>' +
    '<p>Under the Wilcoxon procedure the test is the signed-rank test of the pseudo-median against μ₀, which needs no normality.</p>'));
  res.appendChild(details('Why replications are the unit of inference',
    '<p>Each replication runs the model from its own independent random numbers, and so the replication outcomes are independent and identically distributed: exactly the sample the t interval assumes.</p>' +
    '<p>Observations inside one replication are not independent. A customer who waits a long time is usually followed by another who waits a long time because both meet the same queue. Correlated observations carry less information than the same number of independent ones, and the formula s / √n, applied to them, understates the standard error, usually by a wide margin.</p>' +
    '<p>A replication outcome is an average over a whole run, and averages are close to normally distributed even when the observations are skewed, which is why the t interval on replication outcomes holds up well at moderate R.</p>'));
  root.appendChild(res);

  // The variance: a chi-square interval on the system's variability as a
  // performance measure, shown for replication outcomes only. It and the
  // quantile are sub-sections of the same card as the mean's interval.
  const varSec = el('div');
  varSec.hidden = true;
  varSec.appendChild(el('div', 'sub-hd', 'Confidence interval on the variance'));
  varSec.appendChild(el('p', 'exp-note', 'The variability of a system is a performance measure in its own right: this interval is on the variance of the replication outcomes, σ², and its square root. The checks line above applies here too and matters more.'));
  const vTab = el('div');
  varSec.append(vTab, notice('warn', 'These intervals assume the replication outcomes are normally distributed; unlike the t interval for the mean, they do not become safe as R grows.'));
  varSec.appendChild(details('Why the variance interval is fragile',
    '<p>The interval treats (R − 1) s² / σ² as a chi-square variable on R − 1 degrees of freedom. That is exact for normal outcomes and for no other distribution.</p>' +
    '<p>How much s² varies from sample to sample depends on the tails of the distribution, measured by its kurtosis: the variance of s² is about σ⁴ (2 / (R − 1) + κ / R), where κ is the excess kurtosis, zero for the normal. The chi-square interval assumes κ = 0. With heavier tails than the normal, s² varies more than the interval allows for, and the interval misses σ² more often than its level says.</p>' +
    '<p>The t interval for a mean improves as R grows because the sample mean becomes nearly normal whatever the data. No such effect rescues s²: the mismatch between κ / R and zero shrinks at the same rate as the 2 / (R − 1) the interval does allow for, and so for outcomes with heavier tails than the normal the actual coverage settles below the nominal level rather than approaching it. Replication outcomes are averages, and averages are closer to normal than raw observations, which helps but guarantees nothing.</p>'));
  res.appendChild(varSec);

  // A quantile: the order-statistic estimate and its distribution-free
  // interval, for a performance measure that is a percentile rather than a mean.
  const qSec = el('div');
  qSec.hidden = true;
  const qHd = el('div', 'sub-hd', 'Confidence interval on a quantile of the replication outcomes');
  qSec.appendChild(qHd);
  qSec.appendChild(el('p', 'exp-note', 'A performance measure is sometimes a percentile rather than a mean: the value that nine runs in ten stay below. The p quantile is estimated by an order statistic of the sorted outcomes, and its interval is built from two more order statistics with no assumption about the distribution.'));
  const qCtrl = el('div', 'ctrl-row');
  qCtrl.innerHTML = '<span class="ctrl-pair"><label class="ctrl-lbl" for="rp-qp"><span class="tip rv-tip" tabindex="0" data-tip="The quantile to estimate, as a fraction: 0.5 is the median, 0.9 the 90th percentile, the value below which 90% of outcomes fall.">Quantile&nbsp;<span class="sym">p</span></label>' +
    '<input type="text" id="rp-qp" aria-label="Quantile p"></span>';
  const qTab = el('div'), qNote = el('div');
  qSec.append(qCtrl, qTab, qNote);
  const qHow = details('How the quantile and its interval are found', '<div id="rp-q-how"></div>');
  qSec.appendChild(qHow);
  res.appendChild(qSec);


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
      'The difference between the true mean and a reference value, such as a target or a known baseline, that a two-sided one-sample t test should detect, in the response’s units. The default is 10% of the sample mean; under the log transform, it is ln 1.1 ≈ 0.095, a ratio of 1.1.'),
    'How many replications for the confidence interval on the mean',
    '<p class="exp-note">Sized for the confidence interval on the mean, by the half-width you want, or for the t test against a stated mean, by the power you want. The note under the quantile’s table says how many replications both ends of its interval need.</p>');
  planSec.appendChild(details('Half-width or power?', PLAN_WHY));
  root.appendChild(planSec);

  els = { varSec, vTab, testCtrl, qSec, qHd, qTab, qNote, ctrl, tfBox, resHd, unitBox, warnBox, ovrBox, mainTab, npNote, checks, leg, cap, planSec,
          qHow: qHow.querySelector('#rp-q-how'), mu0Box: testCtrl.querySelector('#rp-mu0-box'), mu0Unit: testCtrl.querySelector('#rp-mu0-unit'), mu0Show: testCtrl.querySelector('#rp-mu0-show'), qp: qSec.querySelector('#rp-qp'),
          sel: ctrl.querySelector('#rp-ds'), lvl: ctrl.querySelector('#rp-lvl'), tf: ctrl.querySelector('#rp-tf'),
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
  transformSelect(els.tf);
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
  const qp = state.getPick(id, 'quantileP');
  if (typeof qp === 'number' && qp > 0 && qp < 1) extra.qp = qp;
  els.qp.value = String(extra.qp);
  spinner(els.qp, { min: 0.01, max: 0.99, step: 0.05, decimals: 2, onChange: v => { extra.qp = v; state.setPick(id, 'quantileP', v); draw(); } });
  extra.showMu0 = state.getPick(id, 'showMu0') === true;
  els.mu0Show.checked = extra.showMu0;
  els.mu0Show.addEventListener('change', () => { extra.showMu0 = els.mu0Show.checked; state.setPick(id, 'showMu0', extra.showMu0); draw(); });
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

// The transform in force on the chosen dataset: the shared one, except under
// the pooled override, whose observations are never transformed.
function activeTransform(ds) {
  const tf = state.settings.transform;
  return ds && isTransform(tf) && !(ds.kind === 'tally' && override.has(ds.id)) ? tf : 'none';
}

// The key a target typed in the response's units is kept under: the
// dataset, and the transform too when one is on, so that a value typed on one
// scale is never read on another.
function unitKey(ds) {
  if (!ds) return null;
  const tf = activeTransform(ds);
  return tf === 'none' ? ds.id : ds.id + '|' + tf;
}

// The words for the response's units, or for the transformed scale.
function unitWords(ds) {
  const tf = activeTransform(ds);
  if (tf !== 'none') return 'on the ' + transformOf(tf).scale + ' scale';
  return ds && ds.unit ? ds.unit : 'in the response’s units';
}

// The half-width target in force: a relative target means nothing on a
// transformed scale (a percent of a mean of logs), and so a transform makes it absolute.
function targetKind() {
  return activeTransform(currentDataset()) !== 'none' ? 'absolute' : plan.target;
}

// The finite replication outcomes planning works from, transformed when a
// transform is on; none when an outcome lies outside its domain.
function planOutcomes(ds) {
  const est = Array.from(repEstimates(ds)).filter(Number.isFinite);
  const tf = activeTransform(ds);
  if (tf === 'none') return est;
  const r = transformSets([{ name: ds.name, values: est, ids: est.map((_, i) => i) }], tf);
  return r.ok ? Array.from(r.values[0]) : [];
}

// The target field is rebuilt when the target kind or the dataset changes,
// because a spinner's step is fixed when it is made.
function buildTargetInput() {
  const kind = targetKind();
  plan.builtKind = kind;
  // On a transformed scale the target is absolute, and the relative choice is unavailable.
  const tfOn = activeTransform(currentDataset()) !== 'none';
  for (const b of els.segs) {
    b.setAttribute('aria-pressed', String(b.dataset.target === kind));
    b.disabled = tfOn && b.dataset.target === 'relative';
  }
  els.tgtBox.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'rp-tgt';
  inp.setAttribute('aria-label', 'Target half-width');
  els.tgtBox.appendChild(inp);
  if (kind === 'relative') {
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
    els.tgtUnit.textContent = unitWords(ds);
  }
}

// A stored stated mean for a dataset key, any finite number (zero and
// negative values are fair statements), or null.
function storedMu0(key) {
  const v = key ? state.getPick(id, 'mu0:' + key) : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// The stated mean's field: seeded, for a dataset the reader has not set it
// on, at the sample mean rounded to two significant digits, and rebuilt when
// the dataset or the transform changes, because a spinner's step is fixed
// when it is made.
function syncMu0Input(ds, s) {
  const key = unitKey(ds);
  if (extra.mu0For === key && extra.mu0Spin) return;
  extra.mu0For = key;
  const kept = storedMu0(key);
  const def = Math.abs(s.mean) > 0 ? round2(s.mean) : 0;
  extra.mu0 = kept !== null ? kept : def;
  els.mu0Box.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'rp-mu0';
  inp.setAttribute('aria-label', 'Stated mean');
  els.mu0Box.appendChild(inp);
  inp.value = String(extra.mu0);
  extra.mu0Step = stepFor(Math.abs(s.mean) > 0 ? Math.abs(s.mean) : s.sd || 1);
  extra.mu0Spin = spinner(inp, { step: extra.mu0Step, onChange: v => {
    extra.mu0 = v;
    state.setPick(id, 'mu0:' + key, v);
    draw();
  } });
  extra.mu0 = extra.mu0Spin.get();
  els.mu0Unit.textContent = unitWords(ds);
}

// The default for a target in the response's units: 10% of the mean of the
// chosen dataset's estimates to two significant digits, or a quarter of
// their standard deviation when the mean is zero. Under a transform, the
// estimates are the transformed ones, except under the log, whose default is
// a ratio of 1.1 whatever the units.
function defaultShift(ds) {
  if (!ds) return 1;
  if (activeTransform(ds) === 'log') return LOG_DEFAULT_SHIFT;
  const est = planOutcomes(ds);
  if (!est.length) return 1;
  const s = summary(est);
  return Math.abs(s.mean) > 0 ? round2(0.1 * Math.abs(s.mean)) : round2(0.25 * s.sd);
}

// Seeds the absolute target at the default for the chosen dataset.
function ensureAbsDefault(ds) {
  const key = unitKey(ds);
  if (plan.absFor === key && plan.abs != null) return;
  plan.absFor = key;
  const kept = storedFor('target', key);
  plan.abs = kept !== null ? kept : defaultShift(ds);
}

// Seeds δ at the default for the chosen dataset and shows it in its field,
// which is empty and disabled while there is nothing to plan from.
function syncDeltaInput(ds, ready) {
  const key = unitKey(ds);
  if (ready && plan.deltaFor !== key) {
    plan.deltaFor = key;
    const def = defaultShift(ds);
    const kept = storedFor('delta', key);
    plan.delta = kept !== null ? kept : def;
    plan.deltaStep = stepFor(def);
  }
  syncSpin(plan.deltaSlot, els.deltaHost, 'one-plan-delta', 'Shift to detect δ', plan.deltaStep || 1,
    ready ? plan.delta : null, v => { plan.delta = v; if (plan.deltaFor) state.setPick(id, 'delta:' + plan.deltaFor, v); drawPlan(); });
  els.deltaUnit.textContent = unitWords(ds);
}

function placeholderRows(label) {
  if (els.checks) els.checks.replaceChildren();
  const note = label ? ' (' + label + ')' : '';
  els.mainTab.replaceChildren(tbl(['', lvl(state.settings.level) + ' interval', 'Half-width', 'R', 'Mean', 'SD', 'SE', DF_LABEL, S('t')],
    [['Confidence interval on the mean' + esc(note), '[' + dash + ', ' + dash + ']', dash, dash, dash, dash, dash, dash, dash]]));
}

// Card labels are set in capitals; a symbol keeps its own case, and so σ
// does not turn into Σ.
function S(html) { return '<span class="sym">' + html + '</span>'; }


// An interval, or the one bound a sample can give, as text: "[lo, hi]", "≥ lo", "≤ hi", or a dash.
function boundsText(lo, hi, fmt = num) {
  const hasLo = Number.isFinite(lo) || lo === -Infinity, hasHi = Number.isFinite(hi) || hi === Infinity;
  return hasLo && hasHi ? '[' + fmt(lo) + ', ' + fmt(hi) + ']' : hasLo ? '≥ ' + fmt(lo) : hasHi ? '≤ ' + fmt(hi) : dash;
}

// A note under a table: the formulas behind its columns, which keep the cells to their numbers.
function foot(html) { return para('tab-foot', html); }

// A column header with a tooltip, as the df header has.
function tipHd(label, text) { return '<span class="tip" tabindex="0" data-tip="' + esc(text) + '">' + label + '</span>'; }

// A results table whose first column may wrap, because its labels are sentences.
function tbl(headers, rows, rowClass) { const t = table(headers, rows, rowClass); t.classList.add('one-tab'); return t; }

// A line under row `i` of the table in `box`, spanning every column: that
// row's own note, such as the test the interval's row is read as. On a
// narrow screen the table scrolls sideways, and the note's text sticks to
// the visible width rather than running off with the columns.
let rowNoteRO = null;
function rowNote(box, i, html) {
  const tbody = box.querySelector('tbody'), wrap = box.querySelector('.tab-wrap');
  if (!tbody || !tbody.rows[i]) return;
  const row = tbody.rows[i];
  row.classList.add('has-note');
  const tr = document.createElement('tr');
  tr.className = 'row-note';
  tr.innerHTML = '<td colspan="' + row.cells.length + '"><div>' + html + '</div></td>';
  row.after(tr);
  const text = tr.querySelector('div');
  if (rowNoteRO) rowNoteRO.disconnect();
  const fit = () => { text.style.maxWidth = Math.max(120, wrap.clientWidth - 44) + 'px'; };
  if (wrap && typeof ResizeObserver !== 'undefined') { rowNoteRO = new ResizeObserver(fit); rowNoteRO.observe(wrap); }
  fit();
}

// The quantile interval as text, in brackets even when the sample supports
// one end only, the missing end shown as a dash.
function quantileBounds(lo, hi, bounds) {
  if (bounds === 'both') return boundsText(lo, hi);
  if (bounds === 'lower') return '[' + num(lo) + ', ' + dash + ']';
  if (bounds === 'upper') return '[' + dash + ', ' + num(hi) + ']';
  return dash;
}

// The ranks the interval's ends are read from, in the same form.
function quantileRanks(q) {
  if (q.bounds === 'both') return '[' + intl(q.r) + ', ' + intl(q.s) + ']';
  if (q.bounds === 'lower') return '[' + intl(q.r) + ', ' + dash + ']';
  if (q.bounds === 'upper') return '[' + dash + ', ' + intl(q.s) + ']';
  return dash;
}

// The explainer under the quantile table: the one assumption, the textbook's
// normal-approximation rule for the ranks worked at this R and p, and the
// exact binomial rule the table uses, which it approximates.
function quantileHow(x, q, p, level, nWord, pooled) {
  const what = pooled ? 'observations' : 'outcomes', one = pooled ? 'observation' : 'outcome';
  const R = q.n, z = normInv(1 - (1 - level) / 2), a2 = num((1 - level) / 2, 4);
  const Y = r => 'Y<sub>(' + intl(r) + ')</sub>';
  const sub = h => '<sub>' + h + '</sub>';
  const hw = z * Math.sqrt(p * (1 - p) / (R - 1));
  const pl = p - hw, pu = p + hw;
  const lo = Math.floor(R * pl), hi = Math.ceil(R * pu);
  const s = sortedCopy(x);
  const loOk = lo >= 1, hiOk = hi <= R;
  let worked;
  if (R < 2) worked = 'With ' + nWord + ' = ' + intl(R) + ' there is nothing to work.';
  else {
    worked = 'Here, with ' + nWord + ' = ' + intl(R) + ' and p = ' + num(p, 2) + ': p' + sub('ℓ') + ' = ' + num(p, 2) + ' − ' + num(z, 3) + ' √(' + num(p, 2) + ' × ' + num(1 - p, 2) + ' / ' + intl(R - 1) + ') = ' + num(pl, 3) +
      ' and p' + sub('u') + ' = ' + num(pu, 3) + ', so the ranks are ⌊' + intl(R) + ' × ' + num(pl, 3) + '⌋ = ' + intl(lo) + ' and ⌈' + intl(R) + ' × ' + num(pu, 3) + '⌉ = ' + intl(hi) + '. ';
    if (loOk && hiOk) worked += 'The interval is [' + Y(lo) + ', ' + Y(hi) + '] = [' + num(s[lo - 1]) + ', ' + num(s[hi - 1]) + ']' +
      (q.bounds === 'both' && lo === q.r && hi === q.s ? ', the same ranks the table shows.' : (q.bounds === 'both' ? ', beside the table’s [' + Y(q.r) + ', ' + Y(q.s) + ']; the two rules differ by a rank or so at small ' + nWord + ' and agree as it grows.' : '.'));
    else worked += 'Rank ' + (loOk ? intl(hi) + ' is past the largest ' + one : intl(lo) + ' is below the smallest ' + one) + ', and so this rule, like the exact one, gives ' + (loOk ? 'no upper end' : 'no lower end') + ' at this ' + nWord + '.';
  }
  return '<p>Sort the ' + nWord + ' ' + what + ', Y<sub>(1)</sub> ≤ Y<sub>(2)</sub> ≤ … ≤ Y<sub>(' + nWord + ')</sub>. The point estimate of the p quantile is Y<sub>(k)</sub> with k = ⌈p' + nWord + '⌉, the smallest ' + one + ' with at least a fraction p of the sample at or below it. (The interpolated estimate, R’s and NumPy’s default, averages the two order statistics around the position (' + nWord + ' − 1)p + 1; the two agree as ' + nWord + ' grows.)</p>' +
    '<p><b>The one assumption.</b> The ' + what + ' are independent draws from one distribution, whatever its shape. Each then falls below the true p quantile with probability p, and so the number that fall below it, B, is binomial(' + nWord + ', p). The interval [Y<sub>(r)</sub>, Y<sub>(s)</sub>] contains the quantile exactly when r ≤ B &lt; s, and so its confidence is the binomial probability of that, which depends only on r, s, ' + nWord + ', and p.</p>' +
    '<p><b>The simple rule.</b> For large ' + nWord + ', B/' + nWord + ' is nearly normal with mean p and standard deviation √(p(1 − p)/' + nWord + '), and so the fraction of ' + what + ' below the quantile lies in p ± z' + sub('α/2') + ' √(p(1 − p)/(' + nWord + ' − 1)) with probability about 1 − α. Call the ends p' + sub('ℓ') + ' and p' + sub('u') + '; the interval is from the ⌊' + nWord + ' p' + sub('ℓ') + '⌋th smallest ' + one + ' to the ⌈' + nWord + ' p' + sub('u') + '⌉th. ' + worked + '</p>' +
    '<p><b>What the table uses.</b> The same idea with the binomial counted exactly rather than approximated: r is the largest rank with P(B ≤ r − 1) ≤ α/2, s the smallest with P(B ≥ s) ≤ α/2, each found by summing binomial(' + nWord + ', p) probabilities, with α/2 = ' + a2 + ' here. That is the interval inverting the sign test gives and the one SciPy’s quantile test returns; its achieved confidence is the binomial probability between the two ranks, a little above the level asked for because ranks are whole numbers. At small ' + nWord + ' it differs from the simple rule by a rank or so, and at large ' + nWord + ' the two agree.</p>' +
    '<p>An extreme quantile needs many ' + what + '. The upper end exists only when the chance that every ' + one + ' falls below the true quantile, p<sup>' + nWord + '</sup>, is at most α/2, and the lower end only when (1 − p)<sup>' + nWord + '</sup> is; for the 90th percentile at 95% both first hold at ' + nWord + ' = 36. With fewer, the table gives the one bound the sample can support, at confidence 1 − α/2 or better, and says how many both ends would take.</p>';
}

// The note under the quantile table: how the point estimate and the ranks
// were chosen, and what a missing end would take.
function quantileFoot(q, p, level, nWord, pooled) {
  const what = pooled ? 'observations' : 'outcomes';
  const Y = r => 'Y<sub>(' + intl(r) + ')</sub>';
  let t = 'The point estimate is the ' + ordinal(q.k) + ' smallest of the ' + intl(q.n) + ' sorted ' + what + ' (⌈p' + nWord + '⌉ = ' + intl(q.k) + '); R’s quantile() with its default interpolation gives ' + num(q.interp) + '. ';
  if (q.bounds === 'both') {
    t += 'The interval’s ends are ' + Y(q.r) + ' and ' + Y(q.s) + ', the ranks with at most α/2 of the binomial(' + nWord + ', p) probability below r and above s, and it holds with confidence ' + pct(q.achieved, 1) + ', the nearest a sample of ' + intl(q.n) + ' comes to ' + lvl(level) + ' from above.';
  } else if (q.bounds === 'none') {
    t += 'With ' + nWord + ' = ' + intl(q.n) + ' no order statistic bounds either end of the ' + lvl(level) + ' interval; both ends need ' + nWord + ' ≥ ' + intl(q.minN) + ' at p = ' + num(p, 2) + '.';
  } else {
    const have = q.bounds === 'lower' ? 'lower end is ' + Y(q.r) : 'upper end is ' + Y(q.s);
    t += 'The interval’s ' + have + ', but with ' + nWord + ' = ' + intl(q.n) + ' no ' + (pooled ? 'observation' : 'outcome') + ' can bound the ' + (q.bounds === 'lower' ? 'upper end, since p' : 'lower end, since (1 − p)') + '<sup>' + nWord + '</sup> exceeds α/2; the one bound holds with confidence ' + pct(q.achieved, 1) + ', and both ends need ' + nWord + ' ≥ ' + intl(q.minN) + ' at p = ' + num(p, 2) + '.';
  }
  return t;
}

/** Redraws the page from the current state. */
function draw() {
  if (!els) return;
  const ds = currentDataset();
  const level = state.settings.level;
  els.varSec.hidden = true;
  els.testCtrl.hidden = true;
  els.qSec.hidden = true;

  els.unitBox.replaceChildren(unitLine(ds));
  els.warnBox.replaceChildren();
  els.ovrBox.replaceChildren();
  const tf = activeTransform(ds), T = transformOf(tf);
  const tfNote = tf === 'none' ? null : transformNote(tf, 'Beneath the interval, the same interval is carried back to the response’s units, where its center is the ' + esc(proc === 'np' ? 'back-transformed pseudo-median' : T.center) + '.');
  els.tfBox.replaceChildren(...(tfNote ? [tfNote] : []));
  if (plan.builtKind && plan.builtKind !== targetKind()) buildTargetInput();

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
  const labels = [], estIds = [];
  let est = [];
  for (let i = 0; i < estAll.length; i++) {
    if (Number.isFinite(estAll[i])) { est.push(estAll[i]); estIds.push(ids[i]); labels.push('replication ' + ids[i]); }
  }
  // The outcomes as the data give them, before any transform.
  const rawEst = est;
  if (pooled && isTransform(state.settings.transform)) {
    els.warnBox.appendChild(notice('info', 'The transform applies to replication outcomes, and so it is off while the pooled observations are in use.'));
  }
  if (tf !== 'none') {
    const tr = transformSets([{ name: ds.name, values: est, ids: estIds }], tf);
    if (!tr.ok) {
      els.warnBox.appendChild(transformRefusal(tf, tr));
      placeholderRows();
      drawFigure({ values: [], labels: null, ti: null, ds, pooled: false, tf });
      finish(null, 'Planning needs replication outcomes the transform can take.');
      return;
    }
    est = Array.from(tr.values[0]);
  }

  let x;
  if (pooled) x = Array.from(observations(ds)).filter(Number.isFinite);
  else x = est;
  if (!pooled && !inf.ok) {
    placeholderRows();
    drawFigure({ values: est, labels, ti: null, ds, pooled: false, tf });
    finish(null, 'Planning needs at least two replication outcomes.');
    return;
  }
  if (x.length < 2) {
    placeholderRows(pooled ? POOLED : '');
    drawFigure({ values: x, labels: null, ti: null, ds, pooled, tf });
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
  els.resHd.textContent = 'Interval estimates' + (np ? ' (Wilcoxon signed-rank)' : '');
  els.npNote.textContent = np ? NP_PLAN : '';
  els.npNote.hidden = !np;
  // The pooled override's own warning says what is wrong with it; the
  // checks run on replication outcomes only.
  els.checks.replaceChildren(...(pooled || np ? [] : [assumptionChecks({ sets: [{ name: tf !== 'none' ? 'the ' + T.label.toLowerCase() + ' of the replication outcomes' : 'the replication outcomes', values: x, dsId: ds.id }], alpha: 1 - state.settings.base,
    procedure: 'the t interval', declared: 'between replications cannot be checked from the data, and the t interval assumes it; it holds when each replication ran on its own random streams.' })]));
  const scale = pooled ? ', ' + POOLED : tf !== 'none' ? ', ' + T.scale + ' scale' : '';
  const nWord = pooled ? 'n' : 'R';
  const unitH = ds.unit ? ' (' + esc(ds.unit) + ')' : '';

  // The test against the stated mean, on the scale the interval is on. Its
  // value comes first because the figure draws it.
  syncMu0Input(ds, s);
  const mu0 = extra.mu0;
  const alpha = 1 - level;
  const tt = np ? null : oneSampleT(x, mu0);
  const srT = np ? signedRank(x, { mu: mu0, level }) : null;
  const testP = np ? srT.p : tt.p;
  const rejects = Number.isFinite(testP) ? testP < alpha : null;
  const inside = np ? (mu0 >= sr.lo && mu0 <= sr.hi) : (mu0 >= ti.lo && mu0 <= ti.hi);

  drawFigure({ values: pooled ? x : est, labels: pooled ? null : labels, ti: np ? { lo: sr.lo, hi: sr.hi, mean: sr.estimate, hw: NaN } : ti, ds, pooled, np, tf,
    mu0: extra.showMu0 ? { value: mu0, step: extra.mu0Step } : null });

  // The prediction interval for the next outcome, under the t procedure,
  // and under a transform every interval carried back to the response's units.
  const pi = np ? null : predictionInterval(x, level);
  let back = null, backPi = null;
  if (tf !== 'none') {
    const ctrName = np ? 'back-transformed pseudo-median' : T.center;
    const bi = np ? backInterval(sr.lo, sr.hi, tf) : backInterval(ti.lo, ti.hi, tf);
    back = { name: ctrName, center: backTransform(np ? sr.estimate : s.mean, tf), lo: bi.lo, hi: bi.hi };
    if (pi) backPi = backInterval(pi.lo, pi.hi, tf);
  }
  const nextWord = pooled ? 'the next observation' : 'the next outcome';
  const piTip = 'Where the outcome of one more ' + (pooled ? 'observation' : 'replication') + ' would fall, with this confidence. It is wider than the confidence interval on the mean because a single ' + (pooled ? 'observation' : 'outcome') + ' carries the spread of the ' + (pooled ? 'observations' : 'outcomes') + ', s, as well as the uncertainty in the mean, s/√' + (pooled ? 'n' : 'R') + '.';
  const piLabel = '<span class="tip" tabindex="0" data-tip="' + esc(piTip) + '">Prediction interval for ' + nextWord + '</span>';
  if (np) {
    const basis = sr.exact ? 'exact signed-rank distribution' : 'normal approximation' + (sr.ties ? ', ties present' : '');
    const rows = [['Confidence interval on the pseudo-median' + esc(scale), boundsText(sr.lo, sr.hi, stat), num(sr.estimate),
      sr.exact && Number.isFinite(sr.achieved) ? pct(sr.achieved, 1) : dash, intl(s.n), basis]];
    // Under a transform, the same interval carried back to the response's units.
    if (back) rows.push(['Carried back to the response’s units' + unitH + ', ' + esc(back.name), boundsText(back.lo, back.hi, stat), num(back.center), dash, dash, dash]);
    const hl = 'The Hodges–Lehmann estimate: the median of the averages of every pair of outcomes.';
    els.mainTab.replaceChildren(tbl(['', lvl(level) + ' interval', tipHd('Pseudo-median', hl), 'Achieved level', S(nWord), 'Basis'], rows),
      foot('The pseudo-median is the Hodges–Lehmann estimate, the median of the averages of every pair of outcomes.'));
  } else {
    const rows = [['Confidence interval on the mean' + esc(scale), boundsText(ti.lo, ti.hi), num(ti.hw), intl(s.n), num(s.mean), num(s.sd), num(s.se), intl(ti.df), num(ti.t)]];
    // Under a transform, each interval carried back to the response's units follows its row.
    if (back) rows.push(['Carried back to the response’s units' + unitH + ', ' + esc(back.name), boundsText(back.lo, back.hi, stat), dash, dash, num(back.center), dash, dash, dash, dash]);
    if (pi) rows.push([piLabel, boundsText(pi.lo, pi.hi), num(pi.hw), intl(s.n), num(s.mean), num(s.sd), num(s.sd * Math.sqrt(1 + 1 / s.n)), intl(pi.df), num(ti.t)]);
    if (backPi) rows.push(['Prediction interval for ' + nextWord + ', carried back' + unitH, boundsText(backPi.lo, backPi.hi, stat), dash, dash, dash, dash, dash, dash, dash]);
    const seF = 's/√' + nWord, piF = 's · √(1 + 1/' + nWord + ')';
    const seTip = 'What t multiplies to give the half-width: ' + seF + ' for the mean' + (pi ? ', and ' + piF + ', the standard deviation of its error, for ' + nextWord : '') + '.';
    els.mainTab.replaceChildren(tbl(['', lvl(level) + ' interval', 'Half-width', S(nWord), 'Mean', 'SD', tipHd('SE', seTip), DF_LABEL, tipHd(S('t'), 'The t quantile at 1 − α/2 on df degrees of freedom')], rows),
      foot('SE is ' + seF + ' on the confidence interval' + (pi ? ' and ' + piF + ' on the prediction interval' : '') + '; ' + S('t') + ' is ' + tSub(level, ti.df) + '.'));
  }

  els.testCtrl.hidden = false;
  els.mu0Show.checked = extra.showMu0;
  const whatMean = np ? 'pseudo-median' : 'mean';
  const verdict = rejects === null ? 'nothing to decide, since every ' + (pooled ? 'observation' : 'outcome') + ' equals μ₀.'
    : rejects ? '<span class="cmp-flag">rejected</span> at α = ' + num(alpha, 3) + ', the ' + whatMean + ' differing from ' + num(mu0) + '; μ₀ lies ' + (inside ? 'inside' : 'outside') + ' the interval.'
      : 'not rejected at α = ' + num(alpha, 3) + ': μ₀ is among the values the interval does not rule out, which is not evidence that the ' + whatMean + ' equals it.';
  const testLine = np
    ? 'Signed-rank test against μ₀ = ' + num(mu0) + ': ' + S('V') + ' = ' + num(srT.V) + ', the sum of the ranks of |outcome − μ₀| over the outcomes above μ₀; two-sided p = ' + stat(srT.p) + ' (' + (srT.exact ? 'exact signed-rank distribution' : 'normal approximation') + '); ' + verdict
    : 'Test against μ₀ = ' + num(mu0) + ': ' + S('t₀') + ' = (' + num(s.mean) + ' − ' + num(mu0) + ')/' + num(s.se) + ' = ' + stat(tt.t) + ' on ' + intl(tt.df) + ' df, against the critical ' + tSub(level, ti.df) + ' = ' + num(ti.t) + '; two-sided p = ' + stat(tt.p) + '; ' + verdict;
  rowNote(els.mainTab, 0, testLine);

  // The variance interval, on replication outcomes only.
  const vi = pooled ? null : varianceInterval(x, level);
  els.varSec.hidden = !vi;
  if (vi) {
    const pLo = (1 - level) / 2, pHi = 1 - pLo;
    els.vTab.replaceChildren(tbl(['', lvl(level) + ' interval for ' + S('σ'), lvl(level) + ' interval for ' + S('σ²'), S('s'), S('s²'), 'R (' + DF_LABEL + ')', S('χ²') + ' quantiles'],
      [['Variance of the replication outcomes' + esc(scale), boundsText(vi.loS, vi.hiS), boundsText(vi.lo2, vi.hi2), num(vi.s), num(vi.s2),
        intl(vi.n) + ' (' + intl(vi.df) + ')', num(vi.chiLo) + ', ' + num(vi.chiHi)]]),
      foot('The interval for ' + S('σ²') + ' is (R − 1) s² / χ² at the two quantiles, χ²<sub>' + num(pLo, 4) + ', ' + intl(vi.df) + '</sub> = ' + num(vi.chiLo) + ' and χ²<sub>' + num(pHi, 4) + ', ' + intl(vi.df) + '</sub> = ' + num(vi.chiHi) +
        ', the larger giving the lower end; the interval for ' + S('σ') + ' is its square roots.'));
  }

  // The quantile, on the same scale.
  const q = quantileInterval(x, extra.qp, level);
  els.qSec.hidden = false;
  els.qHd.textContent = 'Confidence interval on a quantile of the ' + (pooled ? 'pooled observations' : 'replication outcomes');
  const pctile = ordinal(Math.round(extra.qp * 100)) + ' percentile';
  const qRows = [['Quantile p = ' + num(extra.qp, 2) + ', the ' + pctile + esc(scale), num(q.order), quantileBounds(q.lo, q.hi, q.bounds), quantileRanks(q), q.bounds === 'none' ? dash : pct(q.achieved, 1)]];
  if (tf !== 'none') {
    const bq = backInterval(q.lo, q.hi, tf);
    qRows.push(['Carried back to the response’s units' + unitH + (T.decreasing ? ', the ' + num(1 - extra.qp, 2) + ' quantile' : ''), num(backTransform(q.order, tf)), quantileBounds(bq.lo, bq.hi, q.bounds), dash, dash]);
  }
  const Yk = S('Y<sub>(⌈p' + nWord + '⌉)</sub>');
  els.qTab.replaceChildren(tbl(['',
      tipHd('Point estimate ' + Yk, 'The ⌈p' + nWord + '⌉th smallest ' + (pooled ? 'observation' : 'outcome') + ', the sample quantile: the smallest value with at least a fraction p of the sample at or below it.'),
      tipHd(lvl(level) + ' confidence interval', 'Two of the sorted ' + (pooled ? 'observations' : 'outcomes') + ', Y(r) and Y(s), chosen so that the true quantile lies between them with at least this confidence whatever the distribution.'),
      tipHd('Ranks ' + S('[r, s]'), 'The positions in the sorted ' + (pooled ? 'observations' : 'outcomes') + ' the interval’s ends are read from: at most α/2 of the binomial(' + nWord + ', p) probability lies below r, and at most α/2 above s.'),
      tipHd('Achieved confidence', 'The exact probability, from the binomial, that the quantile lies between the two ranks; whole-number ranks cannot give the level asked for exactly, and so it is a little above it.')],
    qRows),
    foot(quantileFoot(q, extra.qp, level, nWord, pooled)));
  els.qNote.replaceChildren();
  els.qHow.innerHTML = quantileHow(x, q, extra.qp, level, nWord, pooled);
  if (T.decreasing && tf !== 'none') els.qNote.appendChild(para('exp-note', 'The ' + T.label.toLowerCase() + ' reverses the order of the outcomes, and so the quantile carried back is the ' + num(1 - extra.qp, 2) + ' quantile of the response.'));
  if (pooled) els.qNote.appendChild(notice('warn', 'The interval counts each pooled observation as independent; within a run they are not, and so it is narrower than the data justify.'));

  // The page's result, for its export row and the Report page.
  const estRows = pooled ? [] : tf !== 'none' ? est.map((v, i) => [estIds[i], rawEst[i], v]) : est.map((v, i) => [estIds[i], v]);
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
  if (!pooled) tables.push({ name: 'Replication outcomes', headers: tf !== 'none' ? ['replication', 'estimate', T.label.toLowerCase() + ' of estimate'] : ['replication', 'estimate'], rows: estRows });
  tables.push({ name: np ? 'Confidence interval on the pseudo-median (Wilcoxon)' : 'Confidence interval on the mean', headers: ['statistic', 'value'], rows: intervalRows });
  if (pi) tables.push({ name: 'Prediction interval for the next outcome', headers: ['statistic', 'value'], rows: [
    ['level', level], ['half-width', pi.hw], ['lower', pi.lo], ['upper', pi.hi]].concat(backPi ? [['lower, carried back', backPi.lo], ['upper, carried back', backPi.hi]] : []) });
  if (back) tables.push({ name: 'Back-transformed interval', headers: ['statistic', 'value'], rows: [
    ['center (' + back.name + ')', back.center], ['lower', back.lo], ['upper', back.hi]] });
  tables.push({ name: np ? 'Signed-rank test against a stated value' : 'Test against a stated mean', headers: ['statistic', 'value'], rows: np
    ? [['mu0', mu0], ['V', srT.V], ['two-sided p', srT.p], ['basis', srT.exact ? 'exact signed-rank distribution' : 'normal approximation'], ['rejected at alpha = ' + num(alpha, 3), rejects === null ? '' : rejects ? 'yes' : 'no']]
    : [['mu0', mu0], ['t', tt.t], ['df', tt.df], ['two-sided p', tt.p], ['rejected at alpha = ' + num(alpha, 3), rejects === null ? '' : rejects ? 'yes' : 'no']] });
  tables.push({ name: 'Confidence interval on a quantile', headers: ['statistic', 'value'], rows: [
    ['p', extra.qp], ['k = ceil(p n)', q.k], ['order statistic', q.order], ['interpolated', q.interp],
    ['lower rank r', q.r === null ? '' : q.r], ['upper rank s', q.s === null ? '' : q.s], ['lower', q.lo], ['upper', q.hi],
    ['bounds', q.bounds === 'both' ? 'two-sided' : q.bounds === 'none' ? 'none' : q.bounds + ' bound only'],
    ['achieved level', q.achieved], ['smallest n with both ends', q.minN]] });
  if (vi) tables.push({ name: 'Confidence interval on the variance', headers: ['statistic', 'value'], rows: [
    ['R', vi.n], ['df', vi.df], ['s^2', vi.s2], ['s', vi.s], ['lower for sigma^2', vi.lo2], ['upper for sigma^2', vi.hi2],
    ['lower for sigma', vi.loS], ['upper for sigma', vi.hiS], ['chi-square ' + num((1 - level) / 2, 4), vi.chiLo], ['chi-square ' + num(1 - (1 - level) / 2, 4), vi.chiHi]
  ] });
  // Planning works on replication outcomes only.
  finish({
    title: (np ? 'Confidence interval on the pseudo-median: ' : 'Confidence interval on the mean: ') + ds.name,
    provenance: {
      dataset: ds.name,
      'confidence level': lvl(level),
      procedure: np ? 'Wilcoxon signed-rank (nonparametric)' : 't interval',
      'unit of inference': pooled ? 'pooled observations (override)' : 'replication means',
      ...(tf !== 'none' ? { transform: T.label.toLowerCase() + ' of each replication outcome' } : {}),
      'stated mean': num(mu0),
      'stated mean on the plot': extra.showMu0 ? 'yes' : 'no',
      quantile: num(extra.qp, 2)
    },
    tables,
    summaryHtml: np
      ? '<p>' + esc(ds.name) + ': pseudo-median ' + num(sr.estimate) + ' (' + lvl(level) + ' Wilcoxon interval [' + num(sr.lo) + ', ' + num(sr.hi) + '], n = ' + intl(s.n) + ' replications)' +
        (back ? ' on the ' + esc(T.scale) + ' scale; ' + esc(back.name) + ' ' + num(back.center) + ' [' + stat(back.lo) + ', ' + stat(back.hi) + ']' : '') + '.</p>'
      : '<p>' + esc(ds.name) + ': mean ' + num(ti.mean) + ' ± ' + num(ti.hw) + ' (' + lvl(level) +
        ' interval [' + num(ti.lo) + ', ' + num(ti.hi) + '], n = ' + intl(s.n) + (pooled ? ' pooled observations' : ' replications') + ')' +
        (back ? ' on the ' + esc(T.scale) + ' scale; ' + esc(back.name) + ' ' + num(back.center) + ' [' + stat(back.lo) + ', ' + stat(back.hi) + ']' : '') + '.</p>',
    // What the regenerate scripts are built from; drawPlan() keeps it out of the registered result.
    recipeIn: { ds, x: pooled ? x : rawEst, ids: pooled ? null : estIds, pooled, proc, transform: tf, mu0, qp: extra.qp }
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
  const unit = ds && activeTransform(ds) !== 'none' ? ' (' + unitWords(ds) + ')' : ds && ds.unit ? ' ' + ds.unit : '';
  const sd = ctx ? ctx.s.sd : NaN, R = ctx ? ctx.s.n : NaN, mean = ctx ? ctx.s.mean : NaN;
  const level = state.settings.level, alpha = 1 - level;
  const closing = 'An estimate conditional on the current sample standard deviation s = ' + num(sd) +
    ', not a guarantee; a larger pilot can move it either way.';
  const rText = 'the current R\u00a0=\u00a0' + intl(R);
  const rows = [];

  // By half-width.
  if (targetKind() !== plan.builtKind || (targetKind() === 'absolute' && ds && plan.absFor !== unitKey(ds))) buildTargetInput();
  const relative = targetKind() === 'relative';
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
  const planIn = ctx ? { relative, rel: plan.rel, abs: relative ? null : plan.abs, delta, power: plan.power } : null;
  // Past the cap (pooled observations only) the scripts read the CSV file `files` names.
  const regen = { tooBig: oneTooBig(recipeIn), build: () => oneRecipe(Object.assign({}, recipeIn, { level, title: result.title, provenance: prov, plan: planIn, view: { mu0: extra.showMu0 } })),
    files: [{ ds: recipeIn.ds, form: recipeIn.pooled ? 'observations' : 'replications' }] };
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

function drawFigure(d) {
  const level = state.settings.level;
  const cEst = '--est', cTruth = '--truth';
  if (!d || !d.values.length) {
    fig.render(f => {
      f.x([0, 1]);
      f.axes({ y: false, xLabel: outcomeAxis(d && d.ds, false, d ? d.tf : 'none'), xFormat: () => '' });
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
  const { values, labels, ti, ds, pooled, np, tf } = d;
  const intName = np ? ' Wilcoxon interval on the pseudo-median' : ' interval on the mean';
  const hasInt = ti && Number.isFinite(ti.lo);
  const band = hasInt ? 28 : 0;
  fig.render(f => {
    // Many pooled observations stack into a dot histogram, which needs room.
    f.setHeight(values.length > 300 ? 260 : (f.narrow ? 180 : 160));
    f.x(extent(values, hasInt ? [ti.lo, ti.hi] : null, d.mu0 ? [d.mu0.value] : null), { pad: 0.06, nice: true });
    f.axes({ y: false, xLabel: outcomeAxis(ds, pooled, tf) });
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
    // The stated mean of the test below, dragged here; its field follows the
    // line as it moves, and the test is recomputed when the drag ends.
    if (d.mu0) {
      dragLine(f, { value: d.mu0.value, step: d.mu0.step, ariaLabel: 'Stated mean μ₀', label: null,
        onMove: v => { if (extra.mu0Spin) extra.mu0Spin.set(v, false); },
        onEnd: v => {
          extra.mu0 = v;
          if (extra.mu0For) state.setPick(id, 'mu0:' + extra.mu0For, v);
          if (extra.mu0Spin) extra.mu0Spin.set(v, false);
          draw();
        } });
    }
  });
  const items = [{ swatch: 'dot', color: cEst, label: pooled ? 'one observation' : 'one replication outcome' }];
  if (values.length > 1) items.push({ swatch: 'line', color: cTruth, label: pooled ? 'mean of the pooled observations' : 'mean of the replication outcomes' });
  if (hasInt) items.push({ swatch: 'interval', color: cTruth, label: lvl(level) + intName });
  if (d.mu0) items.push({ swatch: 'dash', color: '--text', label: 'stated mean μ₀ (drag it)' });
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
  if (d.mu0) els.cap.textContent += ' The dashed line is the stated mean μ₀ of the test below; drag it, or type a value in its field, to move it.';
}

/** Called each time the page is shown. */
export function onShow() {
  if (dsPicker) dsPicker.refresh();
  draw();
}

export default { id, title, render, onShow };
