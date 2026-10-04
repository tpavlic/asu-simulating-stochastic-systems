// The Variance and Correlation page: the chi-square interval for one
// dataset's variance and standard deviation, the F test and interval for the
// ratio of two datasets' variances, and the Pearson correlation of two
// datasets' replication outcomes paired by position, with its scatter plot.
// All three work on replication outcomes and all three lean on normality.

import * as state from '../state.js';
import { repEstimates, canInfer } from '../data/model.js';
import { varianceInterval, fRatio, correlation, regressionLine } from '../stats/intervals.js';
import { levene } from '../stats/compare.js';
import { card, cardRow, datasetSelect, levelSelect, unitLine, details, notice } from '../ui/widgets.js';
import { makeFigure, exportButtons, legend, scatter, svgEl, tok } from '../ui/plots.js';
import { installExportRow } from '../ui/exportrow.js';
import { assumptionChecks } from '../ui/checks.js';
import { registerTips } from '../ui/tooltip.js';
import { num, intl, pct, pValue, esc, dash, lvl } from '../ui/format.js';

/** The page's hash id. */
export const id = 'variance';
/** The page's title. */
export const title = 'Variance and Correlation';

const NORMALITY = 'These intervals assume the replication outcomes are normally distributed; unlike the t interval for the mean, they do not become safe as R grows.';
const NORMALITY_F = 'The F ratio and its interval assume both sets of replication outcomes are normally distributed; unlike the Welch interval for a difference of means, they do not become safe as R grows, and heavy tails alone make the F test reject. Levene’s test does not assume normality: it is the one-way analysis of variance of each estimate’s absolute deviation from its dataset’s median (Brown and Forsythe’s form), and it is the usual check before a procedure that pools variances.';
const CORR_NOTE = 'Zero correlation is not independence, and simulation output is routinely correlated within a run; this r describes the pairing of replication outcomes across the two datasets, which is what a paired comparison relies on.';

let root = null;
let els = null;
let fig = null;
let pickA = null, pickB = null;

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

function finite(ds) {
  return Array.from(repEstimates(ds)).filter(Number.isFinite);
}

function q(p) { return num(p, 4); }

// Card labels are set in capitals; a symbol keeps its own case, and so σ
// does not turn into Σ.
function S(html) { return '<span class="sym">' + html + '</span>'; }

/**
 * Renders the page into its section.
 * @param {HTMLElement} rootEl
 */
export function render(rootEl) {
  root = rootEl;
  root.innerHTML = '';
  root.appendChild(el('h2', null, title));
  root.appendChild(el('p', 'lede',
    'Three procedures on replication outcomes: a chi-square interval for the variance of one dataset, an F test comparing the variances of two, and Pearson\u2019s r between two datasets paired replication by replication, which measures how the two designs move together across replications and is not the autocorrelation of a series over time (that correlogram is on the Steady State page). ' +
    'All three are more fragile than the t interval for a mean because they depend on the outcomes being normally distributed.'));

  const ctrl = el('div', 'sec ctrl-card');
  ctrl.innerHTML =
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="va-a">Dataset A</label><select id="va-a"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="va-b">Dataset B</label><select id="va-b"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="va-lvl">Confidence level</label><select id="va-lvl"></select></span>' +
    '</div>' +
    '<p class="ctrl-note">Dataset B is optional; choosing it adds the F ratio of the two variances and Pearson\u2019s r between the paired replication outcomes.</p>';
  root.appendChild(ctrl);

  // Variance of A.
  const vSec = el('div', 'sec');
  vSec.appendChild(el('div', 'sec-hd', 'Variance of A'));
  const vUnit = el('div'), vWarn = el('div'), vRow1 = el('div'), vRow2 = el('div');
  vSec.append(vUnit, vWarn, vRow1, vRow2, notice('warn', NORMALITY));
  vSec.appendChild(details('Why the variance interval is fragile',
    '<p>The interval treats (R − 1) s² / σ² as a chi-square variable on R − 1 degrees of freedom. That is exact for normal outcomes and for no other distribution.</p>' +
    '<p>How much s² varies from sample to sample depends on the tails of the distribution, measured by its kurtosis: the variance of s² is about σ⁴ (2 / (R − 1) + κ / R), where κ is the excess kurtosis, zero for the normal. The chi-square interval assumes κ = 0. With heavier tails than the normal, s² varies more than the interval allows for, and the interval misses σ² more often than its level says.</p>' +
    '<p>The t interval for a mean improves as R grows because the sample mean becomes nearly normal whatever the data. No such effect rescues s²: the mismatch between κ / R and zero shrinks at the same rate as the 2 / (R − 1) the interval does allow for, and so for estimates with heavier tails than the normal the actual coverage settles below the nominal level rather than approaching it. Replication outcomes are averages, and averages are closer to normal than raw observations, which helps but guarantees nothing.</p>'));
  root.appendChild(vSec);

  // F ratio.
  const fSec = el('div', 'sec');
  fSec.appendChild(el('div', 'sec-hd', 'Ratio of variances (A over B)'));
  const fMsg = el('p', 'rv-line'), fRow1 = el('div'), fRow2 = el('div'), fVerdict = el('p', 'rv-verdict');
  const bfHead = el('p', 'rv-line', 'Levene’s test of equal variances (Brown–Forsythe, centered on the medians), which does not assume normality:');
  const bfRow = el('div'), bfVerdict = el('p', 'rv-verdict'), fChecks = el('div');
  fSec.append(fMsg, fRow1, fRow2, fVerdict, bfHead, bfRow, bfVerdict, fChecks, notice('warn', NORMALITY_F));
  root.appendChild(fSec);

  // Correlation.
  const cSec = el('div', 'sec');
  cSec.appendChild(el('div', 'sec-hd', 'Correlation between the replication outcomes of A and B (Pearson\u2019s r)'));
  const cMsg = el('div', 'rv-msg'), cRow1 = el('div'), cRow2 = el('div');
  const figBox = el('div'), leg = el('div'), cap = el('p', 'rv-cap');
  cSec.append(cMsg, cRow1, cRow2, figBox, leg, cap, notice('info', CORR_NOTE));
  root.appendChild(cSec);
  fig = makeFigure(figBox, { height: 320, narrowHeight: 340, xLabel: 'Dataset A outcome', yLabel: 'Dataset B outcome', ariaLabel: 'Scatter plot of the paired replication outcomes' });
  exportButtons(figBox, fig, 'correlation-scatter');

  els = { vUnit, vWarn, vRow1, vRow2, fMsg, fRow1, fRow2, fVerdict, bfRow, bfVerdict, fChecks, cMsg, cRow1, cRow2, leg, cap,
          a: ctrl.querySelector('#va-a'), b: ctrl.querySelector('#va-b'), lvl: ctrl.querySelector('#va-lvl') };

  pickA = datasetSelect(els.a, { value: state.selected() || undefined, remember: { page: id, key: 'a' } });
  pickB = datasetSelect(els.b, { placeholder: 'none', remember: { page: id, key: 'b' } });
  els.a.addEventListener('change', ev => {
    const before = state.selected();
    if (ev.isTrusted && els.a.value) state.select(els.a.value);
    if (state.selected() === before && visible()) draw();
  });
  els.b.addEventListener('change', () => { if (visible()) draw(); });
  levelSelect(els.lvl);

  // An import that brings two or more designs from one file fills A and B
  // with its first two while B is still empty, so the pair is compared without
  // any clicks; a reader's own choice of B is never overridden.
  state.on('datasets', ev => {
    if (!ev || ev.type !== 'add' || els.b.value) return;
    const added = state.get(ev.id);
    if (!added || !added.source) return;
    const fam = state.datasets.filter(d => d.source && d.source.file === added.source.file && canInfer(d).ok);
    if (fam.length < 2) return;
    els.a.value = fam[0].id; els.a.dispatchEvent(new Event('change', { bubbles: true }));
    els.b.value = fam[1].id; els.b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  state.on('datasets', () => { if (visible()) draw(); });
  state.on('settings', () => { if (visible()) draw(); });
  state.on('selection', sel => {
    if (sel && sel !== els.a.value && state.get(sel)) els.a.value = sel;
    if (visible()) draw();
  });

  draw();
  installExportRow(root, id);
  registerTips(root);
}

function placeholderVariance(level) {
  const L = lvl(level);
  els.vRow1.replaceChildren(cardRow([card('R (<span class="sym">df</span>)', dash, '&nbsp;'), card(S('s²'), dash, '&nbsp;'), card(S('s'), dash, '&nbsp;')]));
  els.vRow2.replaceChildren(cardRow([
    wide(card(L + ' interval for ' + S('σ²'), '[' + dash + ', ' + dash + ']', '&nbsp;')),
    wide(card(L + ' interval for ' + S('σ'), '[' + dash + ', ' + dash + ']', '&nbsp;')),
    wide(card(S('χ²') + ' quantiles', dash, '&nbsp;'))
  ]));
}

function placeholderF(level) {
  els.fRow1.replaceChildren(cardRow([card(S('F = s²<sub>A</sub> / s²<sub>B</sub>'), dash, '&nbsp;'), card(S('df1'), dash, '&nbsp;'), card(S('df2'), dash, '&nbsp;'), card(S('p') + ' (two-sided)', dash, '&nbsp;')]));
  els.fRow2.replaceChildren(cardRow([card(lvl(level) + ' interval for ' + S('σ²<sub>A</sub> / σ²<sub>B</sub>'), '[' + dash + ', ' + dash + ']', '&nbsp;')]));
  els.fVerdict.innerHTML = '&nbsp;';
  els.bfRow.replaceChildren(cardRow([card(S('F'), dash, '&nbsp;'), card(S('df1'), dash, '&nbsp;'), card(S('df2'), dash, '&nbsp;'), card(S('p'), dash, '&nbsp;')]));
  els.bfVerdict.innerHTML = '&nbsp;';
  els.fChecks.replaceChildren();
}

function placeholderCorr(level) {
  els.cRow1.replaceChildren(cardRow([card(S('r'), dash, '&nbsp;'), card(S('n') + ' (pairs)', dash, '&nbsp;'), card(S('t'), dash, '&nbsp;')]));
  els.cRow2.replaceChildren(cardRow([card(S('df'), dash, '&nbsp;'), card(S('p') + ' (two-sided)', dash, '&nbsp;'), wide(card(lvl(level) + ' Fisher-z interval for ' + S('ρ'), '[' + dash + ', ' + dash + ']', '&nbsp;'))]));
}

function drawScatter(d, cr, level) {
  if (!d) {
    fig.render(f => {
      f.x([0, 1]); f.y([0, 1]);
      f.axes({ xLabel: 'Dataset A outcome', yLabel: 'Dataset B outcome', xFormat: () => '', yFormat: () => '' });
      svgEl('text', { x: f.iw / 2, y: f.ih / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: tok('--muted') }, f.inner).textContent = 'No pairs to show.';
    });
    legend(els.leg, [{ swatch: 'dot', color: '--est', label: 'one replication pair (A, B)' }]);
    els.cap.textContent = 'The scatter plot appears when A and B have the same number of replication outcomes.';
    return;
  }
  const xl = 'A: ' + d.a.name, yl = 'B: ' + d.b.name;
  // The line is drawn only once the test of zero correlation rejects at the
  // page's level: a fitted line through points that show no association
  // would invite reading a trend into noise.
  const alpha = 1 - level;
  const fitted = cr && Number.isFinite(cr.p) && cr.p < alpha && d.x.length >= 3 ? regressionLine(d.x, d.y, level) : null;
  fig.render(f => {
    // The axes are drawn here rather than by scatter, to carry the datasets' names.
    scatter(f, d.x, d.y, { axes: false, label: 'one replication pair (A, B)' });
    f.axes({ xLabel: xl, yLabel: yl });
    if (!fitted) return;
    const [x0, x1] = f.sx.domain, [y0, y1] = f.sy.domain;
    const clampY = v => Math.max(y0, Math.min(y1, v));
    const K = 60, up = [], down = [], mid = [];
    const gx = [], gLo = [], gHi = [], gFit = [];
    for (let i = 0; i <= K; i++) {
      const xv = x0 + (x1 - x0) * i / K, b = fitted.band(xv);
      up.push(f.sx(xv).toFixed(1) + ',' + f.sy(clampY(b.hi)).toFixed(1));
      down.push(f.sx(xv).toFixed(1) + ',' + f.sy(clampY(b.lo)).toFixed(1));
      mid.push((i ? 'L' : 'M') + f.sx(xv).toFixed(1) + ',' + f.sy(clampY(b.fit)).toFixed(1));
      gx.push(xv); gLo.push(b.lo); gHi.push(b.hi); gFit.push(b.fit);
    }
    // Band first and line second, so the points stay on top in the exports too.
    f.series.unshift({ kind: 'band', x: gx, lo: gLo, hi: gHi, color: tok('--truth'), label: lvl(level) + ' confidence band for the mean of B' },
      { kind: 'line', x: [x0, x1], y: [gFit[0], gFit[K]], color: tok('--truth'), width: 2, label: 'least-squares line of B on A' });
    // Band first, then the line, then the points stay on top: the scatter
    // group already exists, so the two are inserted before it.
    const pts = f.inner.querySelector('.m-scatter');
    const band = svgEl('path', { d: 'M' + up.join('L') + 'L' + down.reverse().join('L') + 'Z', fill: tok('--band'), stroke: 'none' }, f.inner);
    const line = svgEl('path', { d: mid.join(''), fill: 'none', stroke: tok('--truth'), 'stroke-width': 2 }, f.inner);
    if (pts) { f.inner.insertBefore(band, pts); f.inner.insertBefore(line, pts); }
  });
  const items = [{ swatch: 'dot', color: '--est', label: 'one replication pair (A, B)' }];
  if (fitted) {
    items.push({ swatch: 'line', color: '--truth', label: 'least-squares line of B on A' });
    items.push({ swatch: 'shade', color: '--truth', label: lvl(level) + ' confidence band for the mean of B at each A' });
  }
  legend(els.leg, items);
  els.cap.textContent = fitted
    ? 'Each point pairs replication i of A with replication i of B. The test of zero correlation rejects at α = ' + num(alpha, 2) +
      ', and so the least-squares line B = ' + num(fitted.intercept) + ' + ' + num(fitted.slope) + '·A is drawn with the ' + lvl(level) +
      ' confidence band for the mean of B at each A (residual standard deviation ' + num(fitted.s) + ' on ' + fitted.df + ' degrees of freedom); the line describes the association in this sample, not a prediction for a new run.'
    : 'Each point pairs replication i of A with replication i of B; points that rise together from left to right show positive correlation. No line is drawn because the test of zero correlation does not reject at α = ' + num(alpha, 2) + ', and so a fitted trend would describe noise.';
}

/** Redraws the page from the current state. */
function draw() {
  if (!els) return;
  const level = state.settings.level;
  const a = els.a.value ? state.get(els.a.value) : null;
  const b = els.b.value ? state.get(els.b.value) : null;
  const tables = [];

  // Variance of A.
  els.vUnit.replaceChildren(unitLine(a));
  els.vWarn.replaceChildren();
  let vi = null;
  if (a) {
    const inf = canInfer(a);
    if (!inf.ok) els.vWarn.appendChild(notice('warn', esc(inf.reason)));
    else vi = varianceInterval(finite(a), level);
  }
  if (vi) {
    const pLo = (1 - level) / 2, pHi = 1 - pLo;
    const L = lvl(level);
    els.vRow1.replaceChildren(cardRow([
      card('R (<span class="sym">df</span>)', intl(vi.n) + ' (' + intl(vi.df) + ')', 'replication outcomes'),
      card(S('s²'), num(vi.s2), 'sample variance'),
      card(S('s'), num(vi.s), 'sample standard deviation')
    ]));
    els.vRow2.replaceChildren(cardRow([
      wide(card(L + ' interval for ' + S('σ²'), '[' + num(vi.lo2) + ', ' + num(vi.hi2) + ']', '(R − 1) s² / χ²')),
      wide(card(L + ' interval for ' + S('σ'), '[' + num(vi.loS) + ', ' + num(vi.hiS) + ']', 'square roots of the σ² interval')),
      wide(card(S('χ²') + ' quantiles', num(vi.chiLo) + ', ' + num(vi.chiHi),
        'χ²<sub>' + q(pLo) + ', ' + intl(vi.df) + '</sub> and χ²<sub>' + q(pHi) + ', ' + intl(vi.df) + '</sub>'))
    ]));
    tables.push({ name: 'Variance of A', headers: ['statistic', 'value'], rows: [
      ['R', vi.n], ['df', vi.df], ['s^2', vi.s2], ['s', vi.s], ['lower for sigma^2', vi.lo2], ['upper for sigma^2', vi.hi2],
      ['lower for sigma', vi.loS], ['upper for sigma', vi.hiS], ['chi-square ' + q(pLo), vi.chiLo], ['chi-square ' + q(pHi), vi.chiHi]
    ] });
  } else {
    placeholderVariance(level);
  }

  // F ratio.
  let fr = null;
  if (!b) {
    els.fMsg.textContent = 'Choose dataset B to compare the two variances.';
  } else if (!a) {
    els.fMsg.textContent = 'Choose dataset A as well.';
  } else if (!canInfer(b).ok) {
    els.fMsg.textContent = 'Dataset B has fewer than two replication outcomes, and so its variance cannot be estimated.';
  } else if (!vi) {
    els.fMsg.textContent = 'Dataset A has fewer than two replication outcomes, and so its variance cannot be estimated.';
  } else {
    fr = fRatio(finite(a), finite(b), level);
    els.fMsg.textContent = a.id === b.id
      ? 'A and B are the same dataset, and so the ratio is exactly 1.'
      : 'A: ' + a.name + ' (s = ' + num(fr.s1) + '); B: ' + b.name + ' (s = ' + num(fr.s2) + ').';
  }
  if (fr) {
    const L = lvl(level);
    els.fRow1.replaceChildren(cardRow([
      card(S('F = s²<sub>A</sub> / s²<sub>B</sub>'), num(fr.F), 'ratio of sample variances'),
      card(S('df1'), intl(fr.df1), 'R<sub>A</sub> − 1'),
      card(S('df2'), intl(fr.df2), 'R<sub>B</sub> − 1'),
      card(S('p') + ' (two-sided)', pValue(fr.p), 'against σ²<sub>A</sub> = σ²<sub>B</sub>')
    ]));
    els.fRow2.replaceChildren(cardRow([card(L + ' interval for ' + S('σ²<sub>A</sub> / σ²<sub>B</sub>'), '[' + num(fr.lo) + ', ' + num(fr.hi) + ']', 'F divided by the F quantiles')]));
    const contains = fr.lo <= 1 && 1 <= fr.hi;
    els.fVerdict.innerHTML = contains
      ? 'The interval contains 1: insufficient evidence that the variances differ at this level (' + L + ').'
      : 'The interval excludes 1: the variances differ at this level (' + L + ').';
    tables.push({ name: 'F ratio of variances (A over B)', headers: ['statistic', 'value'], rows: [
      ['F', fr.F], ['df1', fr.df1], ['df2', fr.df2], ['p (two-sided)', fr.p], ['lower', fr.lo], ['upper', fr.hi],
      ['interval contains 1', contains ? 'yes' : 'no']
    ] });
    const lv = levene([finite(a), finite(b)]);
    els.bfRow.replaceChildren(cardRow([
      card(S('F'), num(lv.F), 'ANOVA of |outcome − median|'),
      card(S('df1'), intl(lv.df1), 'k − 1'),
      card(S('df2'), intl(lv.df2), 'R<sub>A</sub> + R<sub>B</sub> − 2'),
      card(S('p'), pValue(lv.p), 'against equal spreads')
    ]));
    const alpha = 1 - level;
    els.bfVerdict.innerHTML = lv.p < alpha
      ? 'Levene rejects at α = ' + num(alpha, 2) + ': the spreads differ, without assuming normality.'
      : 'Levene does not reject at α = ' + num(alpha, 2) + ': no evidence that the spreads differ.';
    tables.push({ name: 'Equal-variance test (Levene)', headers: ['statistic', 'value'], rows: [['F', lv.F], ['df1', lv.df1], ['df2', lv.df2], ['p', lv.p], ['center', 'median']] });
    els.fChecks.replaceChildren(assumptionChecks({ sets: [{ name: 'A', values: finite(a) }, { name: 'B', values: finite(b) }], alpha: 1 - state.settings.base,
      declared: 'between the two datasets cannot be checked from the data.' }));
  } else {
    placeholderF(level);
  }

  // Correlation.
  els.cMsg.replaceChildren();
  let cr = null, pair = null;
  if (a && b) {
    const ea = repEstimates(a), eb = repEstimates(b);
    if (ea.length !== eb.length) {
      els.cMsg.appendChild(notice('warn',
        'A has ' + esc(intl(ea.length)) + ' replications and B has ' + esc(intl(eb.length)) + '. ' +
        'Correlation pairs replication i of A with replication i of B, and so the two need the same number of replications, with replication i of each run on the same random numbers (common random numbers). ' +
        'Rerun the shorter one, or drop the extra replications from the longer one before importing it, to make them comparable.'));
    } else {
      const x = [], y = [];
      let dropped = 0;
      for (let i = 0; i < ea.length; i++) {
        if (Number.isFinite(ea[i]) && Number.isFinite(eb[i])) { x.push(ea[i]); y.push(eb[i]); } else dropped++;
      }
      if (dropped) els.cMsg.appendChild(notice('info', esc(intl(dropped)) + (dropped === 1 ? ' pair was' : ' pairs were') + ' left out because a replication has no outcome.'));
      if (x.length >= 3) {
        cr = correlation(x, y, level);
        pair = { a, b, x, y };
        if (cr.note) els.cMsg.appendChild(notice('info', esc(cr.note)));
      } else {
        els.cMsg.appendChild(notice('warn', 'The test of zero correlation needs at least 3 pairs of replication outcomes.'));
      }
    }
  } else {
    els.cMsg.appendChild(el('p', 'rv-line', 'Choose datasets A and B to see Pearson\u2019s r between their replication outcomes.'));
  }
  if (cr) {
    els.cRow1.replaceChildren(cardRow([
      card(S('r'), num(cr.r), 'Pearson correlation'),
      card(S('n') + ' (pairs)', intl(cr.n), 'replication pairs'),
      card(S('t'), num(cr.t), 'r √((n − 2) / (1 − r²))')
    ]));
    els.cRow2.replaceChildren(cardRow([
      card(S('df'), intl(cr.df), 'n − 2'),
      card(S('p') + ' (two-sided)', pValue(cr.p), 'against ρ = 0'),
      wide(card(lvl(level) + ' Fisher-z interval for ' + S('ρ'), '[' + num(cr.lo) + ', ' + num(cr.hi) + ']', 'tanh(atanh r ± z / √(n − 3))'))
    ]));
    tables.push({ name: 'Pearson correlation of A and B', headers: ['statistic', 'value'], rows: [
      ['r', cr.r], ['n', cr.n], ['t', cr.t], ['df', cr.df], ['p (two-sided)', cr.p], ['lower', cr.lo], ['upper', cr.hi]
    ] });
  } else {
    placeholderCorr(level);
  }
  drawScatter(pair, cr, level);

  if (!tables.length) { state.setResult(id, null); return; }
  state.setResult(id, {
    title: 'Variance and correlation: ' + a.name + (b ? ' and ' + b.name : ''),
    provenance: {
      'dataset A': a.name,
      'dataset B': b ? b.name : 'none',
      'confidence level': lvl(level)
    },
    tables,
    summaryHtml: (vi ? '<p>' + esc(a.name) + ': s² = ' + num(vi.s2) + ', ' + lvl(level) + ' interval for σ² [' + num(vi.lo2) + ', ' + num(vi.hi2) + '].</p>' : '') +
      (fr ? '<p>F = ' + num(fr.F) + ' on (' + fr.df1 + ', ' + fr.df2 + ') df, p = ' + pValue(fr.p) + ', interval for σ²<sub>A</sub>/σ²<sub>B</sub> [' + num(fr.lo) + ', ' + num(fr.hi) + '].</p>' : '') +
      (cr ? '<p>r = ' + num(cr.r) + ' over ' + cr.n + ' pairs, p = ' + pValue(cr.p) + ', interval [' + num(cr.lo) + ', ' + num(cr.hi) + '].</p>' : '')
  });
}

/** Called each time the page is shown. */
export function onShow() {
  if (pickA) pickA.refresh();
  if (pickB) pickB.refresh();
  draw();
}

export default { id, title, render, onShow };
