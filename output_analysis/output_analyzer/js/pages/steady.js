// The Steady State page. Two sections on one dataset, shown one at a time: a
// warm-up plot of the replications averaged by observation index or by
// simulation time, with a truncation line the reader places and can apply as a
// derived dataset, and batch means after that cut on one long replication, or
// on every replication joined end to end, with the series' autocorrelation
// drawn to guide the batch size. The page never chooses the cut itself; it
// starts at no truncation and moves only when the reader moves it.

import * as state from '../state.js';
import { alignByIndex, alignByTime, movingAverage, cumulativeAverage, batchMeans, concatenateReps, resampleTimeWeighted } from '../stats/steadystate.js';
import { acf } from '../stats/descriptive.js';
import { truncateDataset, truncationView } from '../data/model.js';
import { makeFigure, welchPlot, batchPlot, correlogram, lagPlot, dragLine, legend, exportButtons, niceStep, tok, svgEl } from '../ui/plots.js';
import { installExportRow } from '../ui/exportrow.js';
import { spinner, card, levelSelect, details, notice, KIND_LABEL, DF_LABEL } from '../ui/widgets.js';
import { num, fixed, pct, pValue, plural, intl, esc, dash, pEq } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'steady';
/** The page's title. */
export const title = 'Steady State';
/** The page's sections, shown one at a time under the dataset picker. */
export const sections = [
  { id: 'warmup', label: 'Warm-up and truncation' },
  { id: 'batch', label: 'Batch means' }
];

// ── Page state ────────────────────────────────────────────────────────────

let root = null;
const el = {};
let dsId = '';
let align = 'index';        // 'index' | 'time'
let nBins = 50;
let w = 5;
let cut = 0;                // observations deleted (index) or the cut time (time)
let repIdx = 0;
let lumped = false;         // batch every replication joined end to end
let mode = 'count';         // 'count' | 'size'
let count = 20;
let size = null;
let warmFig = null, batchFig = null, acfFig = null, lagFig = null, wp = null;
let warm = null;            // the aligned averages behind the warm-up plot
let lastBatch = null;       // the latest batchMeans result (ok or not)
let spins = {};
let keptCache = null;       // the series after truncation that batching and the autocorrelation use
let acfCache = null;        // its autocorrelation

// The autocorrelation runs to lag min(MAX_LAG, n/4); a time-persistent series
// is first averaged over RESAMPLE_STEPS equal steps of simulation time.
const MAX_LAG = 400;
const RESAMPLE_STEPS = 2000;

const eligible = ds => !!ds && (ds.kind === 'tally' || ds.kind === 'time');
const visible = () => !!root && root.classList.contains('active');

// Records a setting the reader made for the current dataset, under a key
// that names it ("cut:<id>"), and so a reload brings it back for that dataset
// and another dataset starts from the defaults.
function keep(name, value) {
  if (dsId) state.setPick(id, name + ':' + dsId, value);
}

/** The dataset chosen in the picker, or null when none is eligible. */
function shown() {
  const ds = state.get(dsId);
  return eligible(ds) ? ds : null;
}

/** The dataset the plots and batches read: the chosen one, or the run it was truncated from (see viewOf). */
function current() {
  const ds = shown();
  return ds ? viewOf(ds).base : null;
}

/**
 * How the chosen dataset is shown. A truncated dataset is the run it was cut
 * from with a fence at the saved cut: the page draws that run (`base`), puts
 * the cut at the fence, and lets the reader move the fence and save a new
 * dataset from the same run, so that the fence can go forward or back and
 * the axis never restarts at the cut. `by` is how it was cut, and the only
 * alignment it is shown in. A truncated dataset whose source is no longer
 * loaded, or whose chain of cuts mixes index and time, is shown as it is:
 * `base` is then the dataset itself and `fence` is 0.
 * @param {object} ds
 * @returns {{ base: object, fence: number, by: ('index'|'time')|null }}
 */
function viewOf(ds) {
  return truncationView(ds, state.get);
}

function hasTimes(ds) {
  return ds.reps.length > 0 && ds.reps.every(r => r.t && r.t.length === r.v.length);
}

/**
 * The alignments a dataset allows, the default first: time-persistent data
 * only by time, tally observations by time where they carry time stamps and
 * otherwise by index. Time is the default because a warm-up period is set
 * in simulation software as a length of simulation time.
 */
function alignsFor(ds) {
  // A truncated dataset shown with its fence is shown the way it was cut.
  const v = viewOf(ds);
  if (v.by) return [v.by];
  if (ds.kind === 'time') return ['time'];
  return hasTimes(ds) ? ['time', 'index'] : ['index'];
}

/** The time a dataset's series start at: the cut for one already truncated by time, else zero. */
function startTime(ds) {
  const tr = ds.derivedFrom && ds.derivedFrom.truncate;
  return tr && tr.by === 'time' && Number.isFinite(tr.at) ? tr.at : 0;
}

/** Decimals for a time cut: about four significant digits of the run length. */
function timeDecimals(T) {
  if (!(T > 0)) return 2;
  return Math.max(0, Math.min(6, 3 - Math.floor(Math.log10(T))));
}

function roundCut(v) {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (align === 'index') return Math.round(v);
  // On a series already truncated by time, a cut at or before its start deletes nothing and so is no cut.
  if (warm && warm.xMin > 0 && v <= warm.xMin) return 0;
  return Number(v.toFixed(warm ? warm.dec : 2));
}

function fmtCut(v) {
  return align === 'index' ? intl(v) : fixed(v, warm ? warm.dec : 2);
}

// ── Warm-up computation ───────────────────────────────────────────────────

/**
 * Welch's moving average over a series with empty entries: the same
 * symmetric window as movingAverage, averaging only the finite entries in
 * it. Used only when some time bin holds no observation from any
 * replication, where a running sum would carry the gap to every later point.
 */
function gapAwareAverage(y, half) {
  const L = y.length, out = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    if (i > L - 1 - half) { out[i] = NaN; continue; }
    const h = i < half ? i : half;
    let s = 0, c = 0;
    for (let k = i - h; k <= i + h; k++) if (Number.isFinite(y[k])) { s += y[k]; c++; }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

function computeWarm(ds) {
  // `xMin` is where the series start: zero, or the cut of a truncated dataset
  // shown on its own because the run it came from is no longer loaded.
  let x, ybar, counts, xMin = 0, xMax, step, dec, edges = null;
  if (align === 'index') {
    const a = alignByIndex(ds.reps);
    x = new Float64Array(a.L);
    for (let i = 0; i < a.L; i++) x[i] = i + 1;
    ybar = a.ybar; counts = a.counts; xMax = a.L; step = 1; dec = 0;
  } else {
    const a = alignByTime(ds.reps, ds.kind, nBins, ds.endTime, startTime(ds));
    edges = a.edges; x = a.centers; ybar = a.ybar; counts = a.counts;
    xMin = edges[0];
    xMax = edges[edges.length - 1];
    dec = timeDecimals(xMax);
    step = Math.max(Math.pow(10, -dec), niceStep((xMax - xMin) || 1, 100));
  }
  let gaps = 0;
  for (let i = 0; i < ybar.length; i++) if (!Number.isFinite(ybar[i])) gaps++;
  const smooth = gaps ? gapAwareAverage(ybar, w) : movingAverage(ybar, w);
  const cum = cumulativeAverage(ybar);
  // Where the runs end in time: equal when an end time is given, and
  // otherwise each run's last record. Unequal ends matter when aligned by
  // time, where the late bins average only the runs still going.
  let endLo = Infinity, endHi = -Infinity;
  for (const r of ds.reps) {
    const n = r.t ? r.t.length : 0;
    const e = ds.kind === 'time' && ds.endTime != null ? ds.endTime : n ? r.t[n - 1] : NaN;
    if (Number.isFinite(e)) { endLo = Math.min(endLo, e); endHi = Math.max(endHi, e); }
  }
  const unequalEnds = align === 'time' && ds.reps.length > 1 && Number.isFinite(endLo) && endHi - endLo > 0.02 * Math.abs(endHi);
  return { x, ybar, counts, smooth, cum, xMin, xMax, step, dec, edges, gaps, endLo, endHi, unequalEnds };
}

// ── Markup ────────────────────────────────────────────────────────────────

const TIP = {
  w: 'Each point of the moving average is the mean of the 2w + 1 averaged points centered on it, with a shorter symmetric window near the start. A larger w smooths more and blurs where the curve levels off.',
  bins: 'The replications’ observations do not fall at the same instants, and so there is no observation i to average across replications at a given time. The run is split instead into this many equal intervals of simulation time, and each replication is summarized within each one: a time-persistent value by its time average over the bin, tally observations by the mean of those falling in it. The ensemble average is then taken bin by bin, and the moving average runs across bins. More bins give finer time resolution and a noisier curve.',
  align: 'By simulation time, each replication is first summarized in equal intervals of simulation time (the bins), and the cut is a time, which is how a warm-up period is set in simulation software. By observation index, observation i of every replication is averaged with observation i of the others, and the cut is a count of observations.',
  r1: 'The sample autocorrelation at lag one: the correlation between each batch mean and the next, a signed correlation (approximately the signed square root of R²). Independent batch means give a value near zero. C is Fishman’s test statistic, r₁ with an end correction scaled by √((b² − 1)/(b − 2)), which is close to standard normal when the batch means are independent, and p is its one-sided p-value for the test of no positive correlation.',
  cut: 'The same cut as the warm-up plot: changing it here moves the dashed line there.'
};

function tipSpan(text, tip) {
  return '<span class="tip" tabindex="0" data-tip="' + esc(tip) + '">' + text + '</span>';
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} rootEl
 */
export function render(rootEl) {
  root = rootEl;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The early observations of a long run reflect the state it started in, often an empty and idle system, and its observations are correlated with one another. ' +
    'This page helps you choose where the warm-up ends and then forms an interval from batch means, which respects that correlation. ' +
    'Where to cut is a judgment the warm-up plot supports; the page never computes one.</p>' +

    '<div class="sec ctrl-card">' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair ss-ds-pair"><label class="ctrl-lbl" for="ss-ds">Dataset</label><select id="ss-ds"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ss-lvl">Confidence level</label><select id="ss-lvl"></select></span>' +
      '</div>' +
      '<p class="ctrl-note ss-ds-note" id="ss-ds-note"></p>' +
    '</div>' +

    '<div class="subnav" data-subnav></div>' +

    '<div class="sec" id="ss-warm" data-section="warmup">' +
      '<div class="sec-hd">Warm-up and truncation</div>' +
      '<p class="exp-note">The plot averages in two directions. The ensemble average takes, at each time bin or observation index, the mean across the replications, which removes the noise that differs from run to run; the moving average then smooths that curve over time. Read either one, or both.</p>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-grp"><span class="ctrl-lbl">' + tipSpan('Align replications', TIP.align) + '</span>' +
          '<span class="seg" role="group" aria-label="Align replications">' +
            '<button type="button" class="seg-btn" data-align="time" aria-pressed="true">by simulation time</button>' +
            '<button type="button" class="seg-btn" data-align="index" aria-pressed="false">by observation index</button>' +
          '</span></span>' +
        '<span class="ctrl-pair" id="ss-bins-pair" hidden><label class="ctrl-lbl" for="ss-bins">' + tipSpan('Time bins', TIP.bins) + '</label><span id="ss-bins-h"></span></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ss-w">' + tipSpan('Moving-average half-window <span class="sym">w</span>', TIP.w) + '</label><span id="ss-w-h"></span></span>' +
      '</div>' +
      '<p class="ctrl-note ss-align-note" id="ss-align-note"></p>' +
      '<p class="ss-contrib" id="ss-contrib">Replications contributing: ' + dash + '</p>' +
      '<div id="ss-wwarn"></div>' +
      '<div id="ss-one"></div>' +
      '<div id="ss-wfig"></div>' +
      '<div id="ss-wleg"></div>' +
      '<p class="ss-cap">Drag the dashed line to where the moving average has leveled off. The cut is a judgment this plot supports; the page does not compute one.</p>' +
      '<div class="ss-cut-row">' +
        '<p class="ss-cut-text" id="ss-cut-text" aria-live="polite">Truncation: ' + dash + '</p>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ss-cuta" id="ss-cuta-lbl">Delete the first</label><span id="ss-cuta-h"></span><span class="ctrl-note" id="ss-cuta-unit">observations</span></span>' +
        '<button type="button" class="btn-run" id="ss-apply" disabled>Save truncated set</button>' +
      '</div>' +
      '<p class="ss-applied" id="ss-applied" role="status"></p>' +
    '</div>' +

    '<div class="sec" id="ss-batch" data-section="batch">' +
      '<div class="sec-hd">Batch means on one long run</div>' +
      '<div id="ss-rep-note"></div>' +
      '<div class="ctrl-row" id="ss-lump-row">' +
        '<span class="seg" role="group" aria-label="Replications to batch">' +
          '<button type="button" class="seg-btn" data-lump="one" aria-pressed="true">replication&nbsp;<span class="sym">r</span></button>' +
          '<button type="button" class="seg-btn" data-lump="all" aria-pressed="false">all replications, concatenated</button>' +
        '</span>' +
        '<span class="ctrl-pair" id="ss-rep-pair"><label class="ctrl-lbl" for="ss-rep">Replication&nbsp;<span class="sym">r</span></label><span id="ss-rep-h"></span><span class="ctrl-note" id="ss-rep-of"></span></span>' +
      '</div>' +
      '<div id="ss-lump-note"></div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ss-cutb" id="ss-cutb-lbl">' + tipSpan('Truncation: delete the first', TIP.cut) + '</label><span id="ss-cutb-h"></span><span class="ctrl-note" id="ss-cutb-unit">observations</span></span>' +
      '</div>' +
      '<div class="ctrl-row">' +
        '<span class="seg" role="group" aria-label="Set the batches by">' +
          '<button type="button" class="seg-btn" data-mode="count" aria-pressed="true">number of batches</button>' +
          '<button type="button" class="seg-btn" data-mode="size" aria-pressed="false">batch size</button>' +
        '</span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ss-bn" id="ss-bn-lbl">Batches&nbsp;<span class="sym">b</span></label><span id="ss-bn-h"></span><span class="ctrl-note" id="ss-bn-unit"></span></span>' +
      '</div>' +
      '<div id="ss-unit"></div>' +
      '<div class="sg" id="ss-cards"></div>' +
      '<div id="ss-warns"></div>' +
      '<p class="exp-note">Batching reduces the dependence between batch means without guaranteeing independence; the lag-one check is a screen, not a proof.</p>' +
      '<div class="ss-btab-hd ctrl-grp-lbl">Autocorrelation of the series after truncation</div>' +
      '<div id="ss-afig"></div>' +
      '<div id="ss-aleg"></div>' +
      '<p class="ss-cap" id="ss-acap"></p>' +
      '<div class="ss-btab-hd ctrl-grp-lbl">Neighboring batch means</div>' +
      '<div class="ex-pair ss-lag-pair">' +
        '<div><div id="ss-lfig"></div><div id="ss-lleg"></div></div>' +
        '<div class="ss-lag-cap" id="ss-lcap"></div>' +
      '</div>' +
      '<div class="ss-btab-hd ctrl-grp-lbl">The series and its batches</div>' +
      '<div id="ss-bfig"></div>' +
      '<div id="ss-bleg"></div>' +
      '<p class="ss-cap" id="ss-bcap"></p>' +
      '<div class="ss-btab-hd ctrl-grp-lbl">Batch means</div>' +
      '<div class="tab-wrap scroll-box ss-btab" id="ss-btab"></div>' +
    '</div>';

  for (const k of ['ds', 'lvl', 'ds-note', 'align-note', 'contrib', 'one', 'wfig', 'wleg', 'cut-text', 'cuta-lbl', 'cuta-unit', 'apply', 'applied',
    'bins-pair', 'rep-note', 'lump-row', 'lump-note', 'rep-pair', 'rep-of', 'cutb-lbl', 'cutb-unit', 'bn-lbl', 'bn-unit', 'unit', 'cards', 'warns', 'lfig', 'lleg', 'lcap', 'wwarn',
    'afig', 'aleg', 'acap', 'bfig', 'bleg', 'bcap', 'btab']) {
    el[k] = root.querySelector('#ss-' + k);
  }
  el.alignBtns = Array.from(root.querySelectorAll('[data-align]'));
  el.modeBtns = Array.from(root.querySelectorAll('[data-mode]'));
  el.lumpBtns = Array.from(root.querySelectorAll('[data-lump]'));

  const warmSec = root.querySelector('#ss-warm');
  warmSec.appendChild(details('Why truncate, and why not compute the cut',
    '<p>A run that starts empty and idle climbs toward its long-run behavior over its first stretch. Averaging those early observations in with the rest pulls the estimate toward the starting state; this is initialization bias, and deleting the warm-up removes it.</p>' +
    '<p>The average across replications is noisy, and the moving average smooths that noise so the trend shows. Place the cut where the moving average has leveled off, and lean toward cutting late: deleting too little leaves the bias in, whereas deleting too much leaves fewer observations.</p>' +
    '<p>The cumulative average is drawn for contrast. With several replications it is the cumulative average of the ensemble average, which is the same curve as the average across replications of each replication’s own cumulative average when the replications are of equal length. It carries the early observations along forever and levels off much later than the moving average, which makes it a poor guide to the cut.</p>' +
    '<p>Automatic rules for the cut exist, but each is a rule of thumb that a slow drift or a noisy series can fool. The plot shows what such a rule only summarizes, and so the decision should rest on the plot.</p>'));
  root.querySelector('#ss-batch').appendChild(details('The limits of batching',
    '<p>Batch means treat each batch average as one observation. When the batches are long compared with how far the correlation in the series reaches, the batch means are nearly independent and nearly normal, and the t interval on them is close to right.</p>' +
    '<p>When the batches are too short, neighboring batch means stay positively correlated and the interval is too narrow: its actual coverage falls below the stated level. Fewer, larger batches reduce that correlation, but they leave fewer degrees of freedom and a wider interval. Somewhere between 10 and 30 batches is the usual compromise.</p>' +
    '<p>The lag-one test has little power with few batches. A test that does not flag correlation is insufficient evidence of correlation at that level, not evidence that the batch means are independent.</p>' +
    '<p>All the batches come from one run with one starting state. The interval describes the long-run mean only when the warm-up has been deleted first.</p>'));

  // Figures, legends, and export buttons.
  warmFig = makeFigure(el.wfig, { height: 300, narrowHeight: 330, xLabel: 'Observation index', yLabel: 'Average across replications' });
  exportButtons(el.wfig, warmFig, 'warm-up');
  acfFig = makeFigure(el.afig, { height: 240, narrowHeight: 270, xLabel: 'Lag (observations)', yLabel: 'Autocorrelation' });
  exportButtons(el.afig, acfFig, 'autocorrelation-after-truncation');
  lagFig = makeFigure(el.lfig, { height: 300, narrowHeight: 300, xLabel: 'Batch mean j', yLabel: 'Batch mean j + 1' });
  exportButtons(el.lfig, lagFig, 'neighboring-batch-means');
  batchFig = makeFigure(el.bfig, { height: 270, narrowHeight: 310, xLabel: 'Observation', yLabel: 'Value' });
  exportButtons(el.bfig, batchFig, 'batch-means');

  levelSelect(el.lvl);

  el.ds.addEventListener('change', () => {
    const next = el.ds.value;
    if (next === dsId) return;
    dsId = next;
    resetFor(shown());
    if (shown()) { state.select(dsId); state.setPick(id, 'ds', dsId); }
    update();
  });
  el.alignBtns.forEach(b => b.addEventListener('click', () => {
    const a = b.getAttribute('data-align');
    if (b.disabled || a === align) return;
    align = a;
    cut = 0;
    keep('align', align);
    keep('cut', null);
    clearApplied();
    update();
  }));
  el.modeBtns.forEach(b => b.addEventListener('click', () => {
    const m = b.getAttribute('data-mode');
    if (m === mode) return;
    // The new control starts at the value the current batches already have,
    // and so switching it changes nothing until the reader edits it.
    const ok = lastBatch && lastBatch.ok;
    if (m === 'size') size = ok ? lastBatch.size : null;
    else count = ok ? lastBatch.b : 20;
    mode = m;
    keep('batchMode', mode);
    if (m === 'size') keep('size', size); else keep('count', count);
    buildBatchSpinner(current());
    drawBatch();
  }));
  el.lumpBtns.forEach(b => b.addEventListener('click', () => {
    const next = b.getAttribute('data-lump') === 'all';
    if (next === lumped) return;
    lumped = next;
    // The batch size in force was sized to the other series, and so it is
    // set afresh from the new one's length.
    size = null;
    keep('lumped', lumped);
    keep('size', null);
    syncLump(current());
    buildBatchSpinner(current());
    drawBatch();
  }));
  el.apply.addEventListener('click', applyTruncation);

  // Spinners that do not depend on the dataset.
  spins.w = mountSpinner(root.querySelector('#ss-w-h'), 'ss-w', w, { min: 0, max: 200, step: 1, onChange: v => { w = v; state.setPick(id, 'w', v); drawWarm(); } });
  spins.bins = mountSpinner(root.querySelector('#ss-bins-h'), 'ss-bins', nBins, { min: 10, max: 400, step: 1, onChange: v => { nBins = v; state.setPick(id, 'bins', v); drawWarm(); syncCutControls(); } });
  applyStored();

  state.on('datasets', () => { applyStored(); refreshSelect(); if (visible()) update(); });
  state.on('selection', id2 => {
    if (!id2 || id2 === dsId || !eligible(state.get(id2))) return;
    dsId = id2;
    // The picker follows the selection made on another page and records it.
    state.setPick(id, 'ds', dsId);
    resetFor(shown());
    refreshSelect();
    if (visible()) update();
  });
  state.on('settings', () => { if (visible()) drawBatch(); });

  refreshSelect();
  resetFor(shown());
  update();
  installExportRow(root, id);
  registerTips(root);
}

/** Called each time the page is shown. */
export function onShow() {
  refreshSelect();
  update();
}

/**
 * Called each time a section opens. The batch section's truncation field
 * moves the same cut as the warm-up plot's dashed line, and so the plot is
 * brought up to that cut when it is shown again.
 * @param {string} section
 */
export function onShowSection(section) {
  if (section !== 'warmup') return;
  if (wp && wp.getCut() !== cut) wp.setCut(cut);
  if (spins.cutA && spins.cutA.get && spins.cutA.get() !== cut) spins.cutA.set(cut, false);
  if ((cut > 0) !== warmLegendCut) warmLegend(current());
  syncCutControls();
}

// ── Controls ──────────────────────────────────────────────────────────────

function mountSpinner(holder, idAttr, value, opts) {
  holder.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = idAttr;
  inp.value = String(value);
  holder.appendChild(inp);
  return spinner(inp, opts);
}

function optionLabel(ds) {
  return ds.name + ' (' + (KIND_LABEL[ds.kind] || ds.kind) + ', R = ' + intl(ds.reps.length) + ')';
}

// Brings back the settings that do not depend on the dataset, the moving
// average's half-window and the number of time bins, wherever they are valid.
function applyStored() {
  const sw = state.getPick(id, 'w'), sb = state.getPick(id, 'bins');
  if (Number.isInteger(sw) && sw >= 0 && sw <= 200 && sw !== w) { w = sw; if (spins.w) spins.w.set(w, false); }
  if (Number.isInteger(sb) && sb >= 10 && sb <= 400 && sb !== nBins) { nBins = sb; if (spins.bins) spins.bins.set(nBins, false); }
}

/**
 * Fills the dataset select: tally and time-persistent sets, with
 * replication-value sets listed but disabled. The recorded dataset is chosen
 * whenever it is loaded; it names the current one except while a session is
 * restored, when it may arrive after the select has fallen back to another.
 */
function refreshSelect() {
  const list = state.datasets;
  const ok = list.filter(eligible);
  const want = state.getPick(id, 'ds');
  if (typeof want === 'string' && want !== dsId && ok.some(d => d.id === want)) {
    dsId = want;
    resetFor(shown());
  } else if (!ok.some(d => d.id === dsId)) {
    const sel = state.selected();
    const next = ok.some(d => d.id === sel) ? sel : (ok.length ? ok[0].id : '');
    if (next !== dsId) { dsId = next; resetFor(shown()); }
  }
  el.ds.innerHTML = '';
  if (!list.length) {
    el.ds.innerHTML = '<option value="">No datasets loaded</option>';
  }
  for (const ds of list) {
    const o = document.createElement('option');
    o.value = ds.id;
    if (eligible(ds)) o.textContent = optionLabel(ds);
    else { o.textContent = ds.name + ' (one value per replication: nothing to truncate or batch)'; o.disabled = true; }
    el.ds.appendChild(o);
  }
  if (list.length && !ok.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'No tally or time-persistent dataset loaded';
    el.ds.insertBefore(o, el.ds.firstChild);
  }
  el.ds.value = dsId;
  el.ds.disabled = !ok.length;
}

// Sets every dataset-specific control to its default for a newly chosen
// dataset, and then brings back whatever the reader set for this dataset
// before (kept with the session) where it is still valid: a cut beyond the
// series is clamped when the warm-up is computed, and a replication beyond R
// becomes the last one.
function resetFor(ds) {
  const v = ds ? viewOf(ds) : null;
  cut = v ? v.fence : 0;
  repIdx = 0;
  lumped = false;
  mode = 'count';
  count = 20;
  size = null;
  align = ds ? alignsFor(ds)[0] : 'index';
  clearApplied();
  if (!ds) return;
  const get = k => state.getPick(id, k + ':' + ds.id);
  if (alignsFor(ds).includes(get('align'))) align = get('align');
  const c = get('cut');
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) cut = c;
  const base = v.base;
  const r = get('rep');
  if (Number.isInteger(r) && r >= 1) repIdx = Math.min(r, base.reps.length) - 1;
  if (get('lumped') === true && base.reps.length > 1) lumped = true;
  if (get('batchMode') === 'count' || get('batchMode') === 'size') mode = get('batchMode');
  const n = get('count');
  if (Number.isInteger(n) && n >= 2) count = n;
  const z = get('size');
  if (typeof z === 'number' && Number.isFinite(z) && z > 0) size = z;
}

function clearApplied() { if (el.applied) el.applied.textContent = ''; }

function syncControls(sh) {
  const allowed = sh ? alignsFor(sh) : [];
  const v = sh ? viewOf(sh) : null;
  const ds = v ? v.base : null;
  for (const b of el.alignBtns) {
    const a = b.getAttribute('data-align');
    b.disabled = !allowed.includes(a);
    b.setAttribute('aria-pressed', String(a === align && !!ds));
  }
  el['bins-pair'].hidden = !(ds && align === 'time');
  let note = '';
  if (v && v.by) note = 'A truncated dataset is shown the way it was cut, by ' + (v.by === 'index' ? 'observation index' : 'simulation time') + '.';
  else if (ds && ds.kind === 'time') note = 'Time-persistent data are aligned by time only: a record’s position says nothing about how long its value holds.';
  else if (ds && !allowed.includes('time')) note = 'These observations carry no time stamps, and so they are aligned by observation index.';
  el['align-note'].textContent = note;
  el['align-note'].hidden = !note;

  if (ds) {
    const R = ds.reps.length;
    let nObs = 0, lo = Infinity, hi = 0;
    for (const r of ds.reps) { nObs += r.v.length; lo = Math.min(lo, r.v.length); hi = Math.max(hi, r.v.length); }
    const per = lo === hi ? intl(hi) : intl(lo) + '–' + intl(hi);
    const what = ds.kind === 'time' ? 'records' : 'observations';
    el['ds-note'].textContent = (ds.kind === 'tally' ? 'Tally' : 'Time-persistent') + ' data: ' + plural(R, 'replication') + ' of ' + per + ' ' + what +
      (ds.kind === 'time' ? (ds.endTime != null ? ', each run ending at time ' + num(ds.endTime) : ', with no end time given (the last record of each run holds for no time)') :
        (hasTimes(ds) ? ', with time stamps' : '')) + '.' +
      (v.by
        ? ' This dataset is “' + ds.name + '” with ' + (v.by === 'index' ? 'the first ' + plural(v.fence, 'observation') + ' of each replication' : 'everything before time ' + fixed(v.fence, timeDecimals(ds.endTime || v.fence))) +
          ' deleted. The plots show that run with the fence at the saved cut; move the fence either way and save to make another dataset from the same run.'
        : '');
  } else {
    el['ds-note'].textContent = state.datasets.length
      ? 'Load a tally or time-persistent dataset on the Import page; a dataset of one value per replication has nothing within a run to truncate or batch.'
      : 'Load a tally or time-persistent dataset on the Import page to begin.';
  }

  el.one.innerHTML = '';
  if (ds && ds.reps.length === 1) {
    el.one.appendChild(notice('info', 'This dataset has one replication, and so the average across replications is the series itself. The moving average still smooths it, but nothing averages out one run’s noise; several replications show the end of the transient more clearly.'));
  }
  el['rep-note'].innerHTML = '';
  if (ds && ds.reps.length > 1) {
    el['rep-note'].appendChild(notice('info', 'Batch means apply to one long run. With several replications, the interval on the replication means on the One System page is the usual tool; here, batch one replication, or join them all end to end.'));
  }
  syncLump(ds);
}

/** Shows the replication choice only for several replications, and the lumping notice while it is chosen. */
function syncLump(ds) {
  const several = !!ds && ds.reps.length > 1;
  if (!several) lumped = false;
  el['lump-row'].style.display = several ? '' : 'none';
  for (const b of el.lumpBtns) b.setAttribute('aria-pressed', String((b.getAttribute('data-lump') === 'all') === lumped));
  if (spins.rep) {
    const inp = spins.rep.wrap.querySelector('input');
    inp.disabled = lumped || !ds;
  }
  el['rep-pair'].style.opacity = lumped ? '0.5' : '';
  el['lump-note'].innerHTML = '';
  if (several && lumped) {
    el['lump-note'].appendChild(notice('info', 'Concatenation treats the runs as one long run, and so a batch that straddles a join mixes two independent runs. Some output analyzers call this lumping. It is sensible only when every run is long past its warm-up; with several truncated runs, the usual alternative is the interval on the replication means on the One System page.'));
  }
}

function buildCutSpinners(ds) {
  const T = warm ? warm.xMax : 0;
  const index = align === 'index';
  const opts = index
    ? { min: 0, max: Math.max(0, T), step: 1, decimals: 0 }
    : { min: 0, max: Math.max(0, T), step: warm ? warm.step : 1, decimals: warm ? warm.dec : 2 };
  spins.cutA = mountSpinner(root.querySelector('#ss-cuta-h'), 'ss-cuta', cut, Object.assign({ onChange: v => setCut(v, 'a') }, opts));
  spins.cutB = mountSpinner(root.querySelector('#ss-cutb-h'), 'ss-cutb', cut, Object.assign({ onChange: v => setCut(v, 'b') }, opts));
  el['cuta-lbl'].textContent = index ? 'Delete the first' : 'Delete everything before time';
  el['cuta-unit'].textContent = index ? 'observations' : '';
  el['cutb-lbl'].querySelector('.tip').textContent = index ? 'Truncation: delete the first' : 'Truncation: delete everything before time';
  el['cutb-unit'].textContent = index ? 'observations' : '';
  for (const s of [spins.cutA, spins.cutB]) {
    const inp = s.wrap.querySelector('input');
    inp.disabled = !ds;
  }
}

function buildRepSpinner(ds) {
  const R = ds ? ds.reps.length : 1;
  if (repIdx > R - 1) repIdx = 0;
  spins.rep = mountSpinner(root.querySelector('#ss-rep-h'), 'ss-rep', repIdx + 1, {
    min: 1, max: Math.max(1, R), step: 1,
    onChange: v => { repIdx = v - 1; keep('rep', v); repOf(ds); drawBatch(); }
  });
  repOf(ds);
  spins.rep.wrap.querySelector('input').disabled = lumped || !ds;
}

function repOf(ds) {
  el['rep-of'].textContent = ds ? 'of ' + intl(ds.reps.length) + (ds.reps[repIdx] && String(ds.reps[repIdx].id) !== String(repIdx + 1) ? ' (id ' + ds.reps[repIdx].id + ')' : '') : '';
}

/**
 * The series batching works on, after truncation: one replication's kept
 * observations or trajectory, or, when lumped, every replication's joined end
 * to end. Cached on the choices that shape it.
 */
function keptSeries(ds) {
  const key = [ds.id, ds.reps.length, cut, align, lumped, lumped ? 0 : repIdx].join('|');
  if (keptCache && keptCache.key === key && keptCache.ds === ds) return keptCache.val;
  const kind = ds.kind === 'time' ? 'time' : 'tally';
  const truncate = cut > 0 ? { by: align, at: cut } : null;
  const reps = lumped && ds.reps.length > 1 ? ds.reps : [ds.reps[repIdx] || ds.reps[0]];
  let val;
  try { val = concatenateReps(reps, kind, truncate, ds.endTime); } catch (err) { val = null; }
  keptCache = { key, ds, val };
  return val;
}

function batchSpan(ds) {
  if (!ds) return 1;
  const k = keptSeries(ds);
  if (!k || !k.t || !k.t.length) return 1;
  return Math.max(0, k.end - k.t[0]) || 1;
}

function buildBatchSpinner(ds) {
  for (const b of el.modeBtns) b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
  const byTime = !!ds && ds.kind === 'time';
  const holder = root.querySelector('#ss-bn-h');
  if (mode === 'count') {
    el['bn-lbl'].innerHTML = 'Batches&nbsp;<span class="sym">b</span>';
    el['bn-unit'].textContent = '';
    spins.bn = mountSpinner(holder, 'ss-bn', count, { min: 2, max: 100000, step: 1, onChange: v => { count = v; keep('count', v); drawBatch(); } });
  } else if (byTime) {
    const span = batchSpan(ds);
    const dec = timeDecimals(span);
    if (!(size > 0)) size = Number((span / 20).toFixed(dec));
    el['bn-lbl'].textContent = 'Batch length';
    el['bn-unit'].textContent = 'time units';
    spins.bn = mountSpinner(holder, 'ss-bn', size, {
      min: Math.pow(10, -dec), max: Math.max(span, Math.pow(10, -dec)), step: Math.max(Math.pow(10, -dec), niceStep(span, 200)), decimals: dec,
      onChange: v => { size = v; keep('size', v); drawBatch(); }
    });
  } else {
    if (!(size >= 1)) {
      const k = ds ? keptSeries(ds) : null;
      size = Math.max(1, Math.floor((k ? k.v.length : 0) / 20));
    }
    size = Math.max(1, Math.round(size));
    el['bn-lbl'].textContent = 'Batch size';
    el['bn-unit'].textContent = 'observations';
    spins.bn = mountSpinner(holder, 'ss-bn', size, { min: 1, max: 10000000, step: 1, onChange: v => { size = v; keep('size', v); drawBatch(); } });
  }
  spins.bn.wrap.querySelector('input').disabled = !ds;
  for (const b of el.modeBtns) b.disabled = !ds;
}

/** Moves the cut from either spinner, the drag, the keyboard, or a click on the plot. */
function setCut(v, from) {
  const next = roundCut(v);
  // The spinner the value was typed into is left alone unless rounding changed it.
  if ((from !== 'a' || next !== v) && spins.cutA) spins.cutA.set(next, false);
  if ((from !== 'b' || next !== v) && spins.cutB) spins.cutB.set(next, false);
  if (from !== 'plot' && wp) wp.setCut(next);
  if (next === cut && from !== 'plot-end') return;
  cut = next;
  // A drag records its cut once, where it ends, rather than at every step.
  if (from !== 'plot') keep('cut', cut > 0 ? cut : null);
  clearApplied();
  syncCutControls();
  const ds = current();
  if ((cut > 0) !== warmLegendCut) warmLegend(ds);
  drawBatch();
}

function syncCutControls() {
  const ds = current();
  el['cut-text'].textContent = cutText(ds);
  // Nothing to save without a cut, or with the fence where this dataset's already is.
  el.apply.disabled = !ds || !(cut > 0) || cut === savedFence();
}

/** The fence the shown dataset was saved with, or 0. */
function savedFence() {
  const sh = shown();
  return sh ? viewOf(sh).fence : 0;
}

function cutText(ds) {
  if (!ds || !warm) return 'Truncation: ' + dash;
  const saved = savedFence();
  if (!(cut > 0)) {
    return (saved > 0 ? 'Truncation: none, which would keep the whole run. ' : 'Truncation: none yet. ') +
      'Drag the dashed line to where the warm-up ends, click the plot there, or type a value; the page does not choose a cut for you.';
  }
  const head = cut === saved ? 'Saved truncation (this dataset’s fence): ' : 'Truncation: ';
  let body;
  if (align === 'index') {
    let lo = Infinity, hi = 0;
    for (const r of ds.reps) { lo = Math.min(lo, r.v.length); hi = Math.max(hi, r.v.length); }
    const of = ds.reps.length === 1 ? 'of ' + intl(hi)
      : lo === hi ? 'of ' + intl(hi) + ' per replication' : 'of ' + intl(lo) + '–' + intl(hi) + ' per replication';
    body = 'the first ' + plural(cut, 'observation') + ' (' + of + ').';
  } else {
    body = 'the warm-up ends at time ' + fmtCut(cut) + ' of ' + num(warm.xMax) + '.';
  }
  if (saved > 0 && cut !== saved) body += ' The saved fence is at ' + fmtCut(saved) + '; saving makes a new dataset from the same run.';
  return head + body;
}

/**
 * Saves the run cut at the fence as a new dataset. The cut is always taken
 * from the run itself (`current()`), never from an earlier truncation of it,
 * and so moving the fence back recovers what an earlier cut deleted. The new
 * dataset is then shown, with its fence where the reader left it.
 */
function applyTruncation() {
  const ds = current();
  if (!ds || !(cut > 0) || cut === savedFence()) return;
  let derived;
  try {
    derived = truncateDataset(ds, { by: align, at: cut });
  } catch (err) {
    el.applied.textContent = String(err.message || err);
    return;
  }
  if (!derived.reps.length) {
    el.applied.textContent = 'Nothing remains in any replication after this cut, and so no dataset was saved.';
    return;
  }
  state.add(derived);
  const dropped = ds.reps.length - derived.reps.length;
  // The cut is now a saved dataset, and so the dataset it was made on goes
  // back to its own fence the next time it is shown.
  keep('cut', null);
  dsId = derived.id;
  resetFor(shown());
  state.setPick(id, 'ds', dsId);
  state.select(dsId);
  refreshSelect();
  update();
  el.applied.textContent = 'Saved “' + derived.name + '” with ' + plural(derived.reps.length, 'replication') + ' as a new dataset; it is the one shown now, with its fence at ' + fmtCut(cut) + '.' +
    (dropped ? ' ' + plural(dropped, 'replication') + (dropped === 1 ? ' ends' : ' end') + ' before the cut and ' + (dropped === 1 ? 'was' : 'were') + ' left out.' : '');
}

// ── Drawing ───────────────────────────────────────────────────────────────

function update() {
  const ds = current();
  syncControls(shown());
  warm = ds ? computeWarm(ds) : null;
  if (warm && cut > warm.xMax) cut = roundCut(warm.xMax);
  buildCutSpinners(ds);
  buildRepSpinner(ds);
  buildBatchSpinner(ds);
  drawWarm(true);
  syncCutControls();
  drawBatch();
  registerTips(root);
}

function emptyPlot(f, msg) {
  svgEl('rect', { x: 0, y: 0, width: f.iw, height: f.ih, fill: tok('--chart-bg'), stroke: tok('--border') }, f.layers.bg);
  const t = svgEl('text', { x: Math.round(f.iw / 2), y: Math.round(f.ih / 2), 'text-anchor': 'middle', 'font-size': 13, fill: tok('--muted') }, f.inner);
  t.textContent = msg;
}

function nearest(xs, dx) {
  const n = xs.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] < dx) lo = mid; else hi = mid; }
  return Math.abs(xs[lo] - dx) <= Math.abs(xs[hi] - dx) ? lo : hi;
}

/** The warm-up legend; the shaded entry is listed only while a cut makes the band visible. */
function warmLegend(ds) {
  const R = ds ? ds.reps.length : 0;
  const per = align === 'index' ? 'one point per observation index' : 'one point per time bin';
  const items = [
    { swatch: 'thin', color: '--pair', label: R === 1 ? 'the one replication’s series (' + per + ')' : 'ensemble average across ' + (R ? plural(R, 'replication') : 'the replications') + ' (' + per + ')' },
    { swatch: 'line', color: '--est', label: 'moving average over 2<span class="sym">w</span> + 1 = ' + intl(2 * w + 1) + ' points' },
    { swatch: 'dash', color: '--truth', label: R === 1 ? 'cumulative average from the start' : 'cumulative average of the ensemble average, from the start' },
    { swatch: 'dash', color: '--accent', label: 'your cut (drag it, click the plot, or use the arrow keys)' }
  ];
  if (ds && cut > 0) items.push({ swatch: 'shade', color: '--muted', label: 'excluded by the cut' });
  if (ds && warm && warm.unequalEnds) items.push({ swatch: 'dotted', color: '--muted', label: 'end of the shortest run; later bins average fewer runs' });
  legend(el.wleg, items);
  warmLegendCut = ds && cut > 0;
}
let warmLegendCut = null;

function drawWarm(computed) {
  const ds = current();
  if (!ds) {
    warm = null;
    wp = null;
    warmLegend(ds);
    el.contrib.textContent = 'Replications contributing: ' + dash;
    el.wwarn.innerHTML = '';
    warmFig.render(f => emptyPlot(f, 'No dataset to plot yet'));
    return;
  }
  if (!computed) warm = computeWarm(ds);
  const W = warm;
  warmLegend(ds);
  const resp = ds.response && ds.response !== 'value' ? ds.response : 'value';
  warmFig.opts.xLabel = align === 'index' ? 'Observation index' : 'Simulation time (bin centers)';
  warmFig.opts.yLabel = ds.reps.length === 1 ? resp : 'Average ' + resp + ' across replications';
  el.contrib.textContent = contribText(ds, W);
  el.wwarn.innerHTML = '';
  if (W.unequalEnds) {
    const lo = fixed(W.endLo, W.dec), hi = fixed(W.endHi, W.dec);
    el.wwarn.appendChild(notice('warn', 'The replications end at different times, from ' + lo + ' to ' + hi + ', and so past time ' + lo + ' the ensemble average uses only the runs still going.' +
      (ds.kind === 'tally'
        ? ' A run of a fixed number of observations ends late when its arrivals were sparse, and those are the runs with the least congestion, and so the curve falls there for that reason alone. Read it only to time ' + lo + ', or align by observation index.'
        : ' Read the curve only to time ' + lo + ', or give the dataset an end time on the Import page so that every run covers the same span.')));
  }
  warmFig.render(f => {
    f.x([W.xMin, W.xMax > W.xMin ? W.xMax : W.xMin + 1]);
    wp = welchPlot(f, {
      x: W.x, raw: W.ybar, smooth: W.smooth, cumulative: W.cum, cut, cutMin: W.xMin, step: W.step, shade: true,
      cutLabel: v => {
        const c = roundCut(v);
        if (!(c > 0)) return 'no cut yet';
        return align === 'index' ? 'first ' + intl(c) + ' deleted' : 'cut at ' + fmtCut(c);
      },
      onCut: v => {
        const c = roundCut(v);
        if (spins.cutA) spins.cutA.set(c, false);
        if (spins.cutB) spins.cutB.set(c, false);
        if (c !== cut) { cut = c; clearApplied(); syncCutControls(); }
        if ((cut > 0) !== warmLegendCut) warmLegend(ds);
      },
      onCutEnd: v => { if (wp) wp.setCut(roundCut(v)); setCut(v, 'plot-end'); }
    });
    // Where the shortest run ends, past which the average thins out.
    if (W.unequalEnds && W.endLo > W.xMin && W.endLo < W.xMax) {
      const x = Math.round(f.sx(W.endLo));
      const cM = tok('--muted');
      svgEl('line', { x1: x, x2: x, y1: 0, y2: f.ih, stroke: cM, 'stroke-width': 1.5, 'stroke-dasharray': '3,4' }, f.inner);
      const t = svgEl('text', { x: x - 5, y: f.ih - 6, 'text-anchor': 'end', 'font-size': 11, fill: cM }, f.inner);
      t.textContent = 'shortest run ends';
      f.series.push({ kind: 'vline', x: W.endLo, dash: true, color: cM, label: 'end of the shortest run' });
    }
    // The cut is drawn in the accent color, matching its legend entry.
    const g = f.layers.over.querySelector('.m-cut');
    if (g) {
      const accent = tok('--accent');
      const vis = g.querySelector('line');
      if (vis) vis.setAttribute('stroke', accent);
      const t = g.querySelector('text');
      if (t) t.setAttribute('fill', accent);
    }
    f.readout(dx => {
      const i = nearest(W.x, dx);
      if (i < 0) return null;
      const head = align === 'index'
        ? 'observation ' + intl(i + 1)
        : 'time ' + fixed(W.edges[i], W.dec) + '–' + fixed(W.edges[i + 1], W.dec);
      return [
        head,
        'average ' + num(W.ybar[i]) + ' (' + plural(W.counts[i], 'replication') + ')',
        'moving average ' + num(W.smooth[i]),
        'cumulative average ' + num(W.cum[i])
      ];
    });
  });
}

function contribText(ds, W) {
  const c = W.counts;
  if (!c.length) return 'Replications contributing: ' + dash;
  let lo = Infinity, hi = 0;
  for (let i = 0; i < c.length; i++) { lo = Math.min(lo, c[i]); hi = Math.max(hi, c[i]); }
  let s = 'Replications contributing: ' + intl(hi) + '.';
  if (align === 'index' && lo < c[0]) {
    let k = 0;
    while (k < c.length && c[k] === c[0]) k++;
    s = 'Replications contributing: ' + intl(c[0]) + ' through observation ' + intl(k) + ', falling to ' + intl(lo) + ' by observation ' + intl(c.length) +
      '. Unequal lengths: the average past observation ' + intl(k) + ' uses fewer replications.';
  } else if (align === 'time' && lo < hi) {
    s = 'Replications contributing: ' + intl(lo) + ' to ' + intl(hi) + ' per bin. ' +
      (ds.kind === 'time'
        ? 'Unequal lengths: a bin past the end of a shorter run averages fewer replications.'
        : 'A replication with no observation in a bin does not contribute to that bin’s average.');
  }
  if (W.gaps) s += ' ' + plural(W.gaps, 'bin holds', 'bins hold') + ' no observation from any replication; the moving average skips ' + (W.gaps === 1 ? 'it' : 'them') + ', and fewer bins would fill ' + (W.gaps === 1 ? 'it' : 'them') + '.';
  if (align === 'time' && W.edges && W.edges.length > 1) {
    const B = W.edges.length - 1;
    s += ' Each of the ' + intl(B) + ' bins spans ' + fixed((W.xMax - W.xMin) / B, W.dec) + ' units of simulation time.';
  }
  return s;
}

/** A time-persistent trajectory as the points of its step function, from its first record to `end`. */
function stepPoints(t, v, end) {
  const xs = [], ys = [];
  const n = t.length;
  for (let i = 0; i < n; i++) {
    const a = t[i], z = i + 1 < n ? t[i + 1] : end;
    xs.push(a); ys.push(v[i]);
    if (z > a) { xs.push(z); ys.push(v[i]); }
  }
  return { xs, ys };
}

/**
 * The series as the batch plot draws it. One replication is drawn whole,
 * with `excludeTo` marking where the kept part begins; a lumped series is the
 * joined one, whose replications were each cut before joining, with `joins`
 * where one replication gives way to the next.
 */
function batchSeries(ds, src, res) {
  const byTime = ds.kind === 'time';
  const B = res.batches;
  if (byTime) {
    const bounds = B.map(b => b.start);
    bounds.push(B[B.length - 1].end);
    if (src.lumped) {
      const p = stepPoints(src.rep.t, src.rep.v, src.endTime);
      return { xs: p.xs, ys: p.ys, bounds, excludeTo: null, joins: src.joins };
    }
    const rep = src.rep;
    const T = ds.endTime != null ? ds.endTime : rep.t[rep.t.length - 1];
    const p = stepPoints(rep.t, rep.v, T);
    return { xs: p.xs, ys: p.ys, bounds, excludeTo: cut > 0 && cut > rep.t[0] ? cut : null, joins: [] };
  }
  // Tally: observation i (1-based) sits at x = i, and so a batch over the
  // 0-based indices [start, end) spans start + 0.5 to end + 0.5.
  const n = src.rep.v.length;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i + 1;
  const bounds = B.map(b => b.start + 0.5);
  bounds.push(B[B.length - 1].end + 0.5);
  const excludeTo = !src.lumped && res.start > 0 ? res.start + 0.5 : null;
  return { xs, ys: src.rep.v, bounds, excludeTo, joins: src.joins.map(j => j + 0.5) };
}

function batchLegend(byTime, res, ds, S) {
  const resp = ds && ds.response && ds.response !== 'value' ? ds.response : 'value';
  const items = [
    { swatch: 'thin', color: '--est', label: byTime ? resp + ' over time (a step function)' : 'observation' },
    { swatch: 'line', color: '--ok', label: 'batch mean' + (res ? ' (' + plural(res.b, 'batch', 'batches') + ')' : '') },
    { swatch: 'dash', color: '--muted', label: 'batch boundary' }
  ];
  if (S && S.excludeTo != null) items.push({ swatch: 'shade', color: '--muted', label: 'excluded by truncation' });
  if (S && S.joins.length) items.push({ swatch: 'dotted', color: '--accent', label: 'join between replications' });
  legend(el.bleg, items);
}

/**
 * The series batching works on, as batchMeans takes it. One replication is
 * passed whole with the cut, and so batch positions stay those of the
 * original series; a lumped series is passed already cut and joined.
 */
function batchSource(ds) {
  if (lumped && ds.reps.length > 1) {
    const k = keptSeries(ds);
    return {
      lumped: true, rep: { t: k ? k.t : null, v: k ? k.v : new Float64Array(0) }, truncate: null,
      endTime: k ? k.end : null, joins: k ? k.joins : [], nReps: k ? k.nReps : 0
    };
  }
  return {
    lumped: false, rep: ds.reps[repIdx] || ds.reps[0], truncate: cut > 0 ? { by: align, at: cut } : null,
    endTime: ds.endTime, joins: [], nReps: 1
  };
}

// ── Autocorrelation after truncation ──────────────────────────────────────

/**
 * The autocorrelation of the kept series at lags 1 … L, L = min(400, n/4).
 * A time-persistent series is first averaged over equal time steps, and its
 * lags are in time units. Cached with the kept series it came from.
 */
function acfData(ds) {
  const k = keptSeries(ds);
  if (acfCache && acfCache.kept === k) return acfCache.val;
  let val = null;
  if (k && k.v.length) {
    if (ds.kind === 'time') {
      const start = k.t[0], end = k.end;
      if (end > start) {
        const rs = resampleTimeWeighted(k.t, k.v, start, end, RESAMPLE_STEPS);
        if (Array.prototype.every.call(rs.values, Number.isFinite)) {
          const n = rs.values.length, L = Math.min(MAX_LAG, Math.floor(n / 4));
          val = { r: acf(rs.values, L), n, L, step: rs.step, byTime: true };
        }
      }
    } else {
      const n = k.v.length, L = Math.min(MAX_LAG, Math.floor(n / 4));
      if (n >= 8 && L >= 1) val = { r: acf(k.v, L), n, L, step: 1, byTime: false };
    }
    if (val) val.band = 2 / Math.sqrt(val.n);
  }
  acfCache = { kept: k, val };
  return val;
}

/**
 * Each batch mean against the next: the b − 1 pairs whose correlation is
 * the lag-one r1 the page screens on. The frame is sized to the means, so
 * the cloud fills it at any batch count.
 */
function drawLag(res) {
  const items = [{ swatch: 'dot', color: '--est', label: 'one pair of neighboring batch means' }, { swatch: 'dash', color: '--truth', label: 'identity line' }];
  if (!res || res.b < 3) {
    lagFig.render(f => emptyPlot(f, res ? 'Too few batches for a lag-one scatter' : 'No batches yet'));
    legend(el.lleg, items);
    el.lcap.innerHTML = '<p class="ss-cap">Each point pairs a batch mean with the next one; the correlation of those pairs is the lag-one <span class="sym">r<sub>1</sub></span> in the cards above.</p>';
    return;
  }
  const m = res.means, b = res.b;
  const xs = Array.from(m).slice(0, b - 1), ys = Array.from(m).slice(1);
  lagFig.render(f => {
    f.readout((dx, dy, px, py) => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < xs.length; i++) { const d = Math.hypot(f.sx(xs[i]) - px, f.sy(ys[i]) - py); if (d < bd) { bd = d; best = i; } }
      if (best < 0 || bd > 16) return null;
      return ['batches ' + intl(best + 1) + ' and ' + intl(best + 2), '(' + num(xs[best]) + ', ' + num(ys[best]) + ')'];
    });
    lagPlot(f, xs, ys, { label: 'one pair of neighboring batch means' });
  });
  legend(el.lleg, items);
  const rejects = res.lag1Test.p < 1 - res.level;
  const hasC = Number.isFinite(res.lag1Test.C);
  const alpha = pct(1 - res.level, 0);
  el.lcap.innerHTML =
    '<div class="ss-stat-line">' +
      '<div><b><span class="sym">r<sub>1</sub></span> = ' + num(res.lag1) + '</b> from ' + intl(b - 1) + ' pairs</div>' +
      (hasC
        ? '<div>Fishman’s <b><span class="sym">C</span> = ' + num(res.lag1Test.C, 3) + '</b></div>' +
          '<div>one-sided <b>' + pEq(res.lag1Test.p) + '</b></div>' +
          '<div class="ss-stat-verdict">' + (rejects ? 'autocorrelation detected at the ' + alpha + ' level' : 'no autocorrelation detected at the ' + alpha + ' level') + '</div>'
        : '<div class="ss-stat-verdict">too few batches for Fishman’s test</div>') +
    '</div>' +
    '<p class="ss-cap">Each point pairs a batch mean with the next one, ' + intl(b - 1) + ' pairs from ' + plural(b, 'batch', 'batches') +
      ', and <span class="sym">r<sub>1</sub></span> is their correlation, the lag-one autocorrelation in the cards above. ' +
      '<span class="sym">C</span> is Fishman’s test statistic, close to standard normal when the batch means are independent, and <span class="sym">p</span> is its one-sided p-value for the test of no positive correlation. ' +
      'Points strung along the identity line mean neighboring batches still rise and fall together, and so the batches are too short to count as independent; a round cloud with no slope is what independence looks like. ' +
      'Fewer, longer batches pull <span class="sym">r<sub>1</sub></span> toward zero but leave fewer points here, which is why the test has little power with few batches.</p>';
}

function drawAcf(ds, res) {
  const A = ds ? acfData(ds) : null;
  const byTime = !!ds && ds.kind === 'time';
  acfFig.opts.xLabel = byTime ? 'Lag (time units)' : 'Lag (observations)';
  if (!A) {
    acfFig.render(f => emptyPlot(f, ds ? 'Too few observations after truncation for a correlogram' : 'No dataset yet'));
    legend(el.aleg, []);
    el.acap.textContent = 'This correlogram is the autocorrelation of the kept series at each lag. Batches should span several times the lag at which it falls inside the band; the dashed vertical line is the current batch size.';
    return;
  }
  const marker = res && res.ok ? res.size : null;
  const sizeText = marker == null ? '' : byTime ? 'batch length ' + num(marker, 4) : 'batch size ' + intl(marker);
  const xMax = (A.L + 0.6) * A.step;
  // The marker is draggable while it is on the axis: dropping it sets the
  // batch size, or, with the batches set by count, the count giving that
  // size. A size past the axis is drawn at the edge, as before, and typed.
  const drag = marker != null && marker <= xMax ? batchDrag(ds, byTime, res) : null;
  acfFig.render(f => {
    f.x([0, xMax]);
    f.readout(dx => {
      const k = Math.round(dx / A.step);
      if (k < 1 || k > A.L) return null;
      return [
        'lag ' + (byTime ? num(k * A.step, 4) + ' time units' : intl(k)),
        'r = ' + num(A.r[k], 3),
        Math.abs(A.r[k]) <= A.band ? 'inside the ±2/√n band' : 'outside the ±2/√n band'
      ];
    });
    correlogram(f, A.r, { band: A.band, from: 1, lagStep: A.step, marker: marker == null || drag ? null : { at: marker, label: sizeText, color: '--ok' } });
    if (drag) {
      dragLine(f, {
        value: marker, color: '--ok', ariaLabel: byTime ? 'Batch length' : 'Batch size', step: drag.step,
        label: v => drag.label(v),
        onEnd: v => drag.apply(v)
      });
    }
  });
  const items = [
    { swatch: 'line', color: '--est', label: 'autocorrelation at each lag' },
    { swatch: 'dash', color: '--truth', label: '±2/√n band, n = ' + intl(A.n) }
  ];
  if (marker != null) items.push({ swatch: 'dash', color: '--ok', label: 'current ' + (byTime ? 'batch length' : 'batch size') + (drag ? ' (drag it to change the batches)' : '') });
  legend(el.aleg, items);
  el.acap.textContent = 'This correlogram is the autocorrelation of the kept series at each lag. Batches should span several times the lag at which it falls inside the band; the dashed vertical line is the current batch size. ' +
    (drag
      ? 'Drag it to set the batch size' + (mode === 'count' ? ', which here sets the number of batches that gives that size' : '') + '.'
      : 'The batch size lies past the lags shown, and so the line sits at the edge.') +
    (byTime ? ' The trajectory is first averaged over ' + intl(A.n) + ' equal steps of ' + num(A.step, 4) + ' time units, and the lags are in time units.' : '');
}

/**
 * How a drag of the correlogram's batch-size line lands: `snap` rounds a
 * lag to a batch size the controls accept, `label` says what that size
 * gives, and `apply` sets the size or the count and redraws.
 */
function batchDrag(ds, byTime, res) {
  const k = keptSeries(ds);
  const nUsed = k ? k.v.length : 0;
  const span = byTime ? batchSpan(ds) : nUsed;
  const dec = byTime ? timeDecimals(span) : 0;
  const unit = byTime ? Math.pow(10, -dec) : 1;
  // By count, the smallest count is two batches, and so a dragged size stops at half the span.
  const countFor = v => Math.max(2, Math.floor(span / Math.max(unit, v) + 1e-9));
  const snap = v => Math.max(unit, Number(v.toFixed(dec)));
  const sizeText = sz => byTime ? 'batch length ' + num(sz, 4) : 'batch size ' + intl(sz);
  return {
    step: byTime ? Math.max(unit, niceStep(span, 200)) : 1,
    label: v => {
      // At rest the line names the batches as they are; while it moves, what dropping it there would give.
      if (Math.abs(v - res.size) < 1e-9) return sizeText(res.size) + (mode === 'count' ? ' (b = ' + intl(res.b) + ')' : '');
      if (mode !== 'count') return sizeText(snap(v));
      const b = countFor(v);
      return 'b = ' + intl(b) + ' batches of ' + sizeText(byTime ? span / b : Math.floor(span / b)).replace(/^batch (size|length) /, '');
    },
    apply: v => {
      if (mode === 'count') {
        const b = countFor(v);
        if (b === count) { drawBatch(); return; }
        count = b;
        keep('count', b);
      } else {
        const sz = snap(v);
        if (sz === size) { drawBatch(); return; }
        size = sz;
        keep('size', sz);
      }
      // The spinner shows the new value, and the batches, the correlogram's
      // line, and the lag-one scatter follow.
      if (spins.bn) spins.bn.set(mode === 'count' ? count : size, false);
      drawBatch();
    }
  };
}

function placeholderCards() {
  // The same labels and notes as the result cards, with en dashes for the
  // numbers, and so the cards keep their height when a result arrives.
  const L = state.settings.level;
  return [
    card('Batches <span class="sym">b</span>', dash),
    card('Batch size', dash, 'per batch'),
    card('Mean of batch means', dash),
    card('SD of batch means', dash),
    card('Standard error', dash, 'sd / √b'),
    card(DF_LABEL, dash, 'b − 1'),
    card(pct(L, 0) + ' interval', dash, 'mean ± half-width'),
    card('Half-width', dash, 't = ' + dash),
    card(tipSpan('Lag-one <span class="sym">r<sub>1</sub></span>', TIP.r1), dash, 'Fishman’s C = ' + dash + ', p = ' + dash)
  ];
}

function resultCards(res, byTime) {
  const L = res.level;
  const q = 1 - (1 - L) / 2;
  return [
    card('Batches <span class="sym">b</span>', intl(res.b)),
    card('Batch size', num(res.size, 6), byTime ? 'time units per batch' : 'observations per batch'),
    card('Mean of batch means', num(res.mean)),
    card('SD of batch means', num(res.sd)),
    card('Standard error', num(res.se), 'sd / √b'),
    card(DF_LABEL, intl(res.df), 'b − 1'),
    card(pct(L, 0) + ' interval', '[' + num(res.lo) + ', ' + num(res.hi) + ']', 'mean ± half-width'),
    card('Half-width', num(res.hw), 't<sub>' + fixed(q, 3) + ', ' + res.df + '</sub> = ' + num(res.t)),
    card(tipSpan('Lag-one <span class="sym">r<sub>1</sub></span>', TIP.r1), num(res.lag1), 'Fishman’s C = ' + num(res.lag1Test.C, 3) + ', ' + pEq(res.lag1Test.p))
  ];
}

function setCards(list) {
  // The interval card holds two numbers in brackets and always takes two
  // columns, and so it is never cut short and never changes width.
  list[6].classList.add('sc-wide');
  el.cards.innerHTML = '';
  for (const c of list) el.cards.appendChild(c);
}

function unitText(ds, src, res) {
  let range;
  if (res.byTime) range = 'time ' + num(res.batches[0].start) + '–' + num(res.batches[res.b - 1].end);
  else range = 'observations ' + intl(res.batches[0].start + 1) + '–' + intl(res.batches[res.b - 1].end);
  if (src.lumped) {
    return '<p class="unit-line"><span class="unit-lbl">Experimental unit:</span> b = ' + plural(res.b, 'batch mean') + ' from ' + plural(src.nReps, 'replication') +
      ' concatenated' + (cut > 0 ? ' after truncation' : ', untruncated') + ' (' + range + (res.byTime ? ' on the joined timeline' : ' of the joined series') + ')</p>';
  }
  const repName = ds.reps.length > 1 ? 'replication ' + esc(String(src.rep.id)) : 'the one replication';
  return '<p class="unit-line"><span class="unit-lbl">Experimental unit:</span> b = ' + plural(res.b, 'batch mean') + ' from ' + repName + ' (' + range + ')</p>';
}

function emptyTable(msg) {
  el.btab.innerHTML = '<table class="ptab"><thead><tr><th>Batch</th><th>Start</th><th>End</th><th>n</th><th>Mean</th></tr></thead>' +
    '<tbody><tr><td>' + dash + '</td><td>' + dash + '</td><td>' + dash + '</td><td>' + dash + '</td><td>' + dash + '</td></tr></tbody></table>' +
    (msg ? '<p class="muted-line">' + esc(msg) + '</p>' : '');
}

function drawBatch() {
  const ds = current();
  el.warns.innerHTML = '';
  if (!ds) {
    lastBatch = null;
    el.unit.innerHTML = '<p class="unit-line"><span class="unit-lbl">Experimental unit:</span> no dataset chosen.</p>';
    setCards(placeholderCards());
    batchFig.render(f => emptyPlot(f, 'No dataset to batch yet'));
    batchLegend(false, null, ds, null);
    el.bcap.textContent = '';
    emptyTable();
    drawAcf(null, null);
    drawLag(null);
    state.setResult(id, null);
    return;
  }
  const src = batchSource(ds);
  const byTime = ds.kind === 'time';
  const opts = {
    kind: byTime ? 'time' : 'tally',
    truncate: src.truncate,
    endTime: src.endTime,
    level: state.settings.level
  };
  if (mode === 'count') opts.count = count; else opts.size = size;
  let res;
  if (src.lumped && !src.rep.v.length) res = { ok: false, reason: 'Nothing remains in any replication after this cut.' };
  else {
    try { res = batchMeans(src.rep, opts); } catch (err) { res = { ok: false, reason: String(err.message || err) }; }
  }
  lastBatch = res;
  drawAcf(ds, res);
  drawLag(res.ok ? res : null);

  const resp = ds.response && ds.response !== 'value' ? ds.response : 'value';
  batchFig.opts.xLabel = byTime ? 'Simulation time' : 'Observation';
  batchFig.opts.yLabel = resp;

  if (!res.ok) {
    el.unit.innerHTML = '<p class="unit-line"><span class="unit-lbl">Experimental unit:</span> no batches with these settings.</p>';
    setCards(placeholderCards());
    el.warns.appendChild(notice('warn', esc(res.reason)));
    batchFig.render(f => emptyPlot(f, 'No batches to draw'));
    batchLegend(byTime, null, ds, null);
    el.bcap.textContent = '';
    emptyTable();
    state.setResult(id, null);
    return;
  }

  el.unit.innerHTML = unitText(ds, src, res);
  setCards(resultCards(res, byTime));
  for (const msg of res.warnings) el.warns.appendChild(notice('warn', esc(msg)));

  const S = batchSeries(ds, src, res);
  batchFig.render(f => {
    f.readout(dx => {
      if (S.excludeTo != null && dx < S.excludeTo) {
        return ['excluded by truncation', byTime ? 'before time ' + fmtCut(cut) : 'the first ' + plural(res.start, 'observation')];
      }
      const B = S.bounds;
      for (let k = 0; k < res.b; k++) {
        if (dx >= B[k] && dx <= B[k + 1]) {
          const bt = res.batches[k];
          const range = byTime
            ? 'time ' + num(bt.start) + '–' + num(bt.end)
            : 'observations ' + intl(bt.start + 1) + '–' + intl(bt.end);
          return ['batch ' + (k + 1) + ' of ' + res.b, range, 'mean ' + num(bt.mean)];
        }
      }
      if (dx > B[res.b]) return ['past the last batch', 'excluded from the batches'];
      return null;
    });
    batchPlot(f, { xs: S.xs, ys: S.ys, boundaries: S.bounds, means: Array.from(res.means), excludeTo: S.excludeTo, joins: S.joins });
  });
  batchLegend(byTime, res, ds, S);
  const left = byTime ? res.leftover.duration > 0 : res.leftover.n > 0;
  el.bcap.textContent = (byTime
    ? 'Each solid segment is one batch’s time average, drawn across its interval of simulation time.'
    : 'Each solid segment is one batch’s mean, drawn across the observations it averages.') +
    (S.excludeTo != null ? ' The shaded stretch before the cut is excluded by truncation and drawn in gray.' : '') +
    (src.lumped ? ' Each replication’s warm-up was cut before the replications were joined, and the dotted lines mark the joins.' : '') +
    (left ? ' The stretch past the last boundary fills no batch and is excluded.' : '');

  const rows = res.batches.map((b, k) => byTime
    ? [k + 1, b.start, b.end, b.n, b.mean]
    : [k + 1, b.start + 1, b.end, b.n, b.mean]);
  el.btab.innerHTML = '<table class="ptab"><thead><tr><th>Batch</th><th>' + (byTime ? 'Start time' : 'First obs.') + '</th><th>' + (byTime ? 'End time' : 'Last obs.') + '</th><th>' + (byTime ? 'Records' : 'n') + '</th><th>Mean</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + r[0] + '</td><td>' + (byTime ? num(r[1], 6) : intl(r[1])) + '</td><td>' + (byTime ? num(r[2], 6) : intl(r[2])) + '</td><td>' + intl(r[3]) + '</td><td>' + num(r[4], 6) + '</td></tr>').join('') +
    '</tbody></table>';

  storeResult(ds, src, res, rows);
}

function storeResult(ds, src, res, rows) {
  const rep = src.rep;
  const byTime = res.byTime;
  const truncation = cut > 0 ? 'by ' + (align === 'index' ? 'index' : 'time') + ' at ' + fmtCut(cut).replace(/,/g, '') : 'none';
  const sh = shown();
  const provenance = {
    dataset: sh && sh !== ds ? sh.name : ds.name,
    replication: src.lumped ? 'all ' + src.nReps + ', concatenated' : String(rep.id),
    truncation,
    ...(sh && sh !== ds ? { 'source run': ds.name } : {}),
    'batch count': res.b,
    'batch size': res.size + (byTime ? ' time units' : ' observations'),
    'confidence level': pct(res.level, 0),
    'lag-one r1': Number(res.lag1.toPrecision(6)),
    'warm-up alignment': align === 'index' ? 'by observation index' : 'by simulation time, ' + nBins + ' bins',
    'moving-average half-window': w
  };
  const interval = [
    ['batch count', res.b],
    ['batch size', res.size],
    ['mean of batch means', res.mean],
    ['sd of batch means', res.sd],
    ['standard error', res.se],
    ['degrees of freedom', res.df],
    ['confidence level', res.level],
    ['t quantile', res.t],
    ['half-width', res.hw],
    ['lower', res.lo],
    ['upper', res.hi],
    ['lag-one r1', res.lag1],
    ['lag-one C', res.lag1Test.C],
    ['lag-one p', res.lag1Test.p]
  ];
  const summaryHtml = '<p>Batch means on ' + (src.lumped ? plural(src.nReps, 'replication') + ' concatenated, of ' : ds.reps.length > 1 ? 'replication ' + esc(String(rep.id)) + ' of ' : '') + esc(ds.name) +
    ' (truncation ' + esc(truncation) + '): b = ' + res.b + ' batches of ' + num(res.size, 6) + (byTime ? ' time units' : ' observations') +
    ', mean ' + num(res.mean) + ', ' + pct(res.level, 0) + ' interval [' + num(res.lo) + ', ' + num(res.hi) + '] (half-width ' + num(res.hw) + '); lag-one r<sub>1</sub> = ' +
    num(res.lag1) + ' (C = ' + num(res.lag1Test.C, 3) + ', ' + pEq(res.lag1Test.p) + ').</p>';
  state.setResult(id, {
    title: 'Steady state: batch means',
    provenance,
    tables: [
      { name: 'Batch means', headers: ['batch', byTime ? 'start time' : 'first observation', byTime ? 'end time' : 'last observation', byTime ? 'records' : 'n', 'mean'], rows },
      { name: 'Interval', headers: ['quantity', 'value'], rows: interval }
    ],
    summaryHtml
  });
}

export default { id, title, sections, render, onShow, onShowSection };
