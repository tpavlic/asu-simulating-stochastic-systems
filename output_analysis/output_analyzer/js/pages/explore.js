// The Summary and Plots page: one dataset's counts and descriptives, its raw
// table, and the plots that make sense for its statistic type. Plots of the
// replication estimates describe what the inference pages work on; plots of
// one replication's observations show how values move within a run. The
// results fall into five sections shown one at a time under the dataset
// picker, and a section with no plot for the data's kind says so.

import * as state from '../state.js';
import { repEstimates, datasetSummary, observations } from '../data/model.js';
import {
  summary, histogram as histBins, ecdf as ecdfOf, boxStats, acf, lagPairs, pearson, mean
} from '../stats/descriptive.js';
import { tInterval } from '../stats/intervals.js';
import {
  makeFigure, exportButtons, legend, histogram, ecdf, boxPlot, sequence, runningMean,
  dotPlot, intervals, scatter, lagPlot, correlogram, svgEl, tok, extent
} from '../ui/plots.js';
import {
  card, cardRow, datasetSelect, unitLine, details, levelSelect, spinner, notice, KIND_LABEL
} from '../ui/widgets.js';
import { num, esc, intl, plural, pct, dash } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'explore';
/** The page's title. */
export const title = 'Summary and Plots';
/** The page's sections, shown one at a time under the dataset picker. */
export const sections = [
  { id: 'summary', label: 'Summary' },
  { id: 'dist', label: 'Distribution' },
  { id: 'run', label: 'Within a run' },
  { id: 'reps', label: 'Replications' },
  { id: 'compare', label: 'Compare' }
];

const RAW_CAP = 2000;
const FOREST_CAP = 60;

let rootEl = null;
let els = {};
let dsPicker = null;
/** The 1-based replication the single-run plots show. */
let repIndex = 1;
/** Whether the histogram and cdf show pooled observations (tally only). */
let pooled = false;
/** The horizontal axis of a tally's sequence plots when it carries times. */
let xMode = 'index';
/** Every mounted result section, so a rebuild can release its figures. */
let mounted = [];
/** The sections that draw one replication, rebuilt when the replication changes. */
let repSections = [];
let ciSection = null;
let shownId = null;

function visible() { return !!rootEl && rootEl.classList.contains('active'); }

function current() { return dsPicker ? state.get(dsPicker.value()) : null; }

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">See what one dataset holds before you analyze it: its counts, the descriptives of its replication estimates, and the plots that suit its statistic type. The plots of a single replication show how observations move within one run, and the inference pages use only the replication estimates.</p>' +
    '<div class="sec ctrl-card">' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-ds">Dataset</label><select id="ex-ds"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-lvl">Confidence level</label><select id="ex-lvl"></select></span>' +
      '</div>' +
    '</div>' +
    '<div class="subnav" data-subnav></div>' +
    '<div id="ex-results">' +
      '<div data-section="summary" id="ex-s-summary"></div>' +
      '<div data-section="dist" id="ex-s-dist"></div>' +
      '<div data-section="run">' +
        '<div class="sec ctrl-card" id="ex-run-ctrl"><div class="ctrl-row"><span class="ctrl-pair" id="ex-rep-wrap"></span></div></div>' +
        '<div id="ex-s-run"></div>' +
      '</div>' +
      '<div data-section="reps" id="ex-s-reps"></div>' +
      '<div data-section="compare">' +
        '<div class="sec ctrl-card"><div class="ctrl-row">' +
          '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-cmp"><span class="tip" tabindex="0" data-tip="A second dataset with the same number of replications. Its replication estimates are plotted against this dataset’s, matched by position.">Compare with</span></label><select id="ex-cmp"></select></span>' +
        '</div></div>' +
        '<div id="ex-s-compare"></div>' +
      '</div>' +
    '</div>';

  els = {
    ds: root.querySelector('#ex-ds'),
    cmp: root.querySelector('#ex-cmp'),
    repWrap: root.querySelector('#ex-rep-wrap'),
    lvl: root.querySelector('#ex-lvl'),
    results: root.querySelector('#ex-results'),
    runCtrl: root.querySelector('#ex-run-ctrl'),
    body: {}
  };
  for (const s of sections) els.body[s.id] = root.querySelector('#ex-s-' + s.id);
  dsPicker = datasetSelect(els.ds, { value: state.selected() || undefined, remember: { page: id, key: 'ds' } });
  els.ds.addEventListener('change', () => {
    if (els.ds.value) state.select(els.ds.value);
    if (visible()) renderAll(); else shownId = null;
  });
  els.cmp.addEventListener('change', () => { state.setPick(id, 'compare', els.cmp.value || null); if (visible()) renderAll(); });
  levelSelect(els.lvl);
  applyStored();

  state.on('datasets', () => { applyStored(); if (visible()) renderAll(); else shownId = null; });
  state.on('selection', sel => {
    if (sel && sel !== els.ds.value && state.get(sel)) {
      els.ds.value = sel;
      els.ds.dispatchEvent(new Event('change'));
    }
  });
  state.on('settings', () => { if (visible() && ciSection) ciSection.rebuild(); });
}

/** Called each time the page is shown. */
export function onShow() {
  const sel = state.selected();
  if (sel && state.get(sel) && els.ds.value !== sel) els.ds.value = sel;
  // The picker remembers its choice through its change event.
  els.ds.dispatchEvent(new Event('change'));
}

// ── Section plumbing ────────────────────────────────────────────────────

// A result card (.sec) whose content `build(api)` draws; `rebuild` redraws it
// in place, holding its height while it does, and releases the figures it
// made before.
function mount(parent, build) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  parent.appendChild(sec);
  const figs = [];
  const api = {
    sec,
    fig(box, opts) { const f = makeFigure(box, opts); figs.push(f); return f; },
    release() { for (const f of figs) if (f.ro) f.ro.disconnect(); figs.length = 0; },
    rebuild() {
      const h = sec.offsetHeight;
      if (h) sec.style.minHeight = h + 'px';
      api.release();
      sec.innerHTML = '';
      build(api);
      registerTips(sec);
      sec.style.minHeight = '';
    }
  };
  api.rebuild();
  mounted.push(api);
  return api;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// One figure with its download buttons, followed by its legend.
function figure(api, parent, name, opts, draw, legendItems) {
  const box = el('div', 'ex-fig');
  parent.appendChild(box);
  const f = api.fig(box, opts);
  f.render(draw);
  exportButtons(box, f, name);
  if (legendItems) legend(box.appendChild(el('div')), legendItems);
  return f;
}

function caption(parent, html) { parent.appendChild(el('p', 'ex-cap', html)); }

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data'; }

// ── Data helpers ────────────────────────────────────────────────────────

function finite(a) { return Float64Array.from(Array.from(a).filter(Number.isFinite)); }

// The overall time-weighted mean over every replication: total area under
// the state over total covered time, each record holding until the next and
// the last until the end time (for no time without one).
function timeWeightedOverall(ds) {
  let area = 0, dur = 0;
  for (const r of ds.reps) {
    const n = r.v.length;
    if (!n) continue;
    const end = ds.endTime == null ? r.t[n - 1] : ds.endTime;
    for (let i = 0; i < n; i++) {
      const a = Math.min(r.t[i], end), b = Math.min(i + 1 < n ? r.t[i + 1] : end, end);
      if (b > a) { area += (b - a) * r.v[i]; dur += b - a; }
    }
  }
  return { mean: dur > 0 ? area / dur : NaN, duration: dur };
}

// A time-persistent replication as a step function: each value held from its
// record time to the next, and the last to the end time when one is given.
function stepSeries(r, endTime) {
  const n = r.v.length, xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? r.t[i + 1] : (endTime != null && endTime > r.t[i] ? endTime : r.t[i]);
    xs.push(r.t[i], next); ys.push(r.v[i], r.v[i]);
  }
  return { xs, ys };
}

// The running time-weighted mean of a time-persistent replication at each
// record time after the first, and at the end time when one is given.
function runningTimeMean(r, endTime) {
  const n = r.v.length, xs = [], ys = [];
  if (!n) return { xs, ys };
  const t0 = r.t[0];
  let area = 0;
  for (let i = 1; i < n; i++) {
    area += (r.t[i] - r.t[i - 1]) * r.v[i - 1];
    if (r.t[i] > t0) { xs.push(r.t[i]); ys.push(area / (r.t[i] - t0)); }
  }
  if (endTime != null && endTime > r.t[n - 1]) {
    area += (endTime - r.t[n - 1]) * r.v[n - 1];
    xs.push(endTime); ys.push(area / (endTime - t0));
  }
  return { xs, ys };
}

function estimateWord(ds) {
  if (ds.kind === 'reps') return 'replication values';
  if (ds.kind === 'time') return 'time-weighted replication means';
  return 'replication means';
}

function estimateAxis(ds) {
  if (ds.kind === 'reps') return ds.response;
  if (ds.kind === 'time') return 'Time-weighted replication mean of ' + ds.response;
  return 'Replication mean of ' + ds.response;
}

// ── Rendering ───────────────────────────────────────────────────────────

function releaseAll() {
  for (const m of mounted) m.release();
  mounted = [];
  repSections = [];
  ciSection = null;
}

// Brings back the horizontal-axis choice (kept with the session); the other
// settings here belong to one dataset and come back in renderAll.
function applyStored() {
  const x = state.getPick(id, 'axis');
  if (x === 'index' || x === 'time') xMode = x;
}

// The comparison dataset stays as it was while it still qualifies; failing
// that, the one the reader last chose (kept with the session) when it does.
function fillCompare(ds) {
  const want = state.getPick(id, 'compare');
  const R = ds ? ds.reps.length : 0;
  const list = ds ? state.datasets.filter(d => d.id !== ds.id && d.reps.length === R && R >= 2) : [];
  const prev = list.some(d => d.id === els.cmp.value) ? els.cmp.value : want;
  els.cmp.innerHTML = '<option value="">none</option>' + list.map(d => '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>').join('');
  els.cmp.value = list.some(d => d.id === prev) ? prev : '';
  els.cmp.disabled = !list.length;
}

function fillRepControl(ds) {
  const wrap = els.repWrap;
  wrap.innerHTML = '';
  if (!ds || ds.kind === 'reps' || !ds.reps.length) { wrap.hidden = true; els.runCtrl.hidden = true; return; }
  wrap.hidden = false;
  els.runCtrl.hidden = false;
  const R = ds.reps.length;
  if (repIndex > R || repIndex < 1) repIndex = 1;
  wrap.innerHTML = '<label class="ctrl-lbl" for="ex-rep"><span class="tip" tabindex="0" data-tip="The replication whose observations the sequence, running-mean, lag, and correlogram plots show. Arrow keys step through them.">Replication r</span></label>' +
    '<input type="text" id="ex-rep" value="' + repIndex + '">' +
    '<span class="ctrl-note" id="ex-rep-note"></span>';
  const note = wrap.querySelector('#ex-rep-note');
  const setNote = () => {
    const r = ds.reps[repIndex - 1];
    note.textContent = 'of ' + intl(R) + (String(r.id) !== String(repIndex) ? ' (id ' + r.id + ')' : '');
  };
  spinner(wrap.querySelector('#ex-rep'), {
    min: 1, max: R, step: 1,
    onChange: v => { repIndex = v; state.setPick(id, 'rep:' + ds.id, v); setNote(); for (const s of repSections) s.rebuild(); }
  });
  setNote();
}

// One muted sentence in a section that has no plot for this dataset.
function emptyLine(body, text) { body.appendChild(el('p', 'muted-line ex-empty', text)); }

function renderAll() {
  if (!els.results) return;
  const ds = current();
  const box = els.results;
  const h = box.offsetHeight;
  if (h) box.style.minHeight = h + 'px';
  releaseAll();
  const B = els.body;
  for (const k in B) B[k].innerHTML = '';
  // A newly shown dataset starts at its first replication with the
  // replication estimates, unless the reader chose otherwise for it before.
  if (ds && shownId !== ds.id) {
    const r = state.getPick(id, 'rep:' + ds.id);
    repIndex = Number.isInteger(r) && r >= 1 ? Math.min(r, ds.reps.length) : 1;
    pooled = state.getPick(id, 'pooled:' + ds.id) === true;
  }
  shownId = ds ? ds.id : null;
  fillCompare(ds);
  fillRepControl(ds);
  if (!ds) {
    const msg = '<p>No dataset is loaded. Open <a href="#import">Import</a> to load a file, paste data, or open an example.</p>';
    for (const k in B) B[k].appendChild(notice('info', msg));
    box.style.minHeight = '';
    state.setResult('explore', null);
    return;
  }

  const est = repEstimates(ds);
  const estF = finite(est);
  const R = ds.reps.length;
  const ctx = { ds, est, estF, R };
  const estimates = n => (n === 0 ? 'none' : n === 1 ? 'one' : intl(n));

  mount(B.summary, api => buildSummary(api, ctx));
  B.summary.appendChild(el('div', 'ex-raw')).appendChild(rawTable(ds));

  if (ds.kind === 'tally' || estF.length >= 2) mount(B.dist, api => buildDistribution(api, ctx));
  if (estF.length >= 5) mount(B.dist, api => buildBox(api, ctx));
  if (!B.dist.firstChild) {
    emptyLine(B.dist, 'Distribution plots need at least two ' + estimateWord(ds) + '; this dataset has ' + estimates(estF.length) + '.');
  }

  if (ds.kind !== 'reps') {
    repSections.push(mount(B.run, api => buildSequence(api, ctx)));
    repSections.push(mount(B.run, api => buildRunning(api, ctx)));
  } else {
    emptyLine(B.run, 'Within-run plots need observations inside a replication; this dataset holds one value per replication.');
  }
  if (ds.kind === 'tally') repSections.push(mount(B.run, api => buildLag(api, ctx)));

  if (estF.length >= 2) {
    mount(B.reps, api => buildDots(api, ctx));
    ciSection = mount(B.reps, api => buildIntervals(api, ctx));
  } else {
    emptyLine(B.reps, 'The dot plot and the interval plot need at least two ' + estimateWord(ds) + '; this dataset has ' + estimates(estF.length) + '.');
  }

  const other = els.cmp.value ? state.get(els.cmp.value) : null;
  if (other) mount(B.compare, api => buildScatter(api, ctx, other));
  else if (els.cmp.disabled) {
    emptyLine(B.compare, R >= 2
      ? 'A scatter plot needs a second loaded dataset with the same number of replications as this one, ' + intl(R) + '; none is loaded.'
      : 'A scatter plot pairs replication estimates, and this dataset has only one replication.');
  } else {
    emptyLine(B.compare, 'Choose a dataset under Compare with to plot its replication estimates against this dataset’s, matched by position.');
  }

  registerTips(rootEl);
  box.style.minHeight = '';
  storeResult(ds, est);
}

function storeResult(ds, est) {
  const tally = ds.kind === 'tally';
  const headers = tally ? ['replication', 'n_obs', 'mean', 'sd', 'min', 'max'] : ['replication', 'n_obs', 'mean'];
  const val = v => (Number.isFinite(v) ? v : '');
  const rows = ds.reps.map((r, i) => {
    const row = [r.id, r.v.length, val(est[i])];
    if (tally) {
      const s = r.v.length ? summary(r.v) : null;
      row.push(val(s ? s.sd : NaN), val(s ? s.min : NaN), val(s ? s.max : NaN));
    }
    return row;
  });
  const sm = datasetSummary(ds);
  const e = sm.est;
  state.setResult('explore', {
    title: 'Summary of ' + ds.name,
    provenance: { dataset: ds.name },
    tables: [{ name: 'replication summary', headers, rows }],
    summaryHtml: '<p><b>' + esc(ds.name) + '</b> (' + esc(KIND_LABEL[ds.kind]) + '): ' + esc(plural(sm.nReps, 'replication')) + ', ' +
      esc(plural(sm.nObs, ds.kind === 'time' ? 'record' : 'observation')) +
      (e ? '; mean of the ' + esc(estimateWord(ds)) + ' ' + num(e.mean) + ', sd ' + num(e.sd) : '') + '.</p>'
  });
}

// ── Summary ─────────────────────────────────────────────────────────────

function buildSummary(api, { ds }) {
  const sec = api.sec;
  const sm = datasetSummary(ds);
  sec.appendChild(el('div', 'sec-hd', 'Summary'));
  sec.appendChild(unitLine(ds));
  const per = sm.nReps ? (sm.perRep.equal ? intl(sm.perRep.min) + ' (equal)' : intl(sm.perRep.min) + '–' + intl(sm.perRep.max)) : dash;
  let tNote = '';
  if (ds.kind === 'time') {
    tNote = ds.endTime != null ? 'last record held until ' + num(ds.endTime)
      : 'no end time: the last record holds for no time';
  }
  const tRange = sm.tRange ? num(sm.tRange[0]) + '–' + num(sm.tRange[1]) : 'no times';
  const wrapVal = c => { c.querySelector('.sc-val').classList.add('wrap'); return c; };
  sec.appendChild(cardRow([
    wrapVal(card('Name', '<span class="ex-name">' + esc(ds.name) + '</span>')),
    wrapVal(card('Statistic type', esc(KIND_LABEL[ds.kind] || ds.kind))),
    card(ds.kind === 'time' ? 'Records' : 'Observations', intl(sm.nObs)),
    card('Replications', intl(sm.nReps)),
    card('Per replication', per),
    wrapVal(card('Time range', tRange, tNote ? esc(tNote) : undefined)),
    card('Rejected rows', intl(sm.issueCount), sm.issueCount ? 'listed on the Import page' : undefined)
  ]));

  const e = sm.est;
  const v = x => (e ? num(x) : dash);
  sec.appendChild(el('div', 'ctrl-grp-lbl ex-sub', 'Descriptives of the ' + esc(estimateWord(ds))));
  sec.appendChild(cardRow([
    card('<span class="sym">n</span>', e ? intl(e.n) : dash), card('Mean', v(e && e.mean)), card('<span class="sym">sd</span>', v(e && e.sd)),
    card('<span class="sym">se</span>', v(e && e.se)), card('Min', v(e && e.min)), card('<span class="sym">q1</span>', v(e && e.q1)),
    card('Median', v(e && e.median)), card('<span class="sym">q3</span>', v(e && e.q3)), card('Max', v(e && e.max))
  ]));

  if (ds.kind === 'tally') {
    const obs = observations(ds);
    const p = obs.length ? summary(obs) : null;
    const w = x => (p ? num(x) : dash);
    sec.appendChild(el('div', 'ctrl-grp-lbl ex-sub', 'Pooled observations, for description only'));
    sec.appendChild(cardRow([
      card('<span class="sym">n</span>', p ? intl(p.n) : dash), card('Mean', w(p && p.mean)), card('<span class="sym">sd</span>', w(p && p.sd)),
      card('Min', w(p && p.min)), card('<span class="sym">q1</span>', w(p && p.q1)), card('Median', w(p && p.median)),
      card('<span class="sym">q3</span>', w(p && p.q3)), card('Max', w(p && p.max))
    ]));
    sec.appendChild(el('p', 'ex-cap', 'The pooled observations come from within runs and are correlated with their neighbors, and so they carry no standard error here.'));
  } else if (ds.kind === 'time') {
    const tw = timeWeightedOverall(ds);
    sec.appendChild(el('div', 'ctrl-grp-lbl ex-sub', 'All replications together, time-weighted'));
    sec.appendChild(cardRow([
      card('Time-weighted mean', num(tw.mean), 'every value weighted by how long it held'),
      card('Time covered', num(tw.duration), 'summed over the replications')
    ]));
  }
}

function rawTable(ds) {
  const d = details('Show the raw table', '<div class="ex-raw-body"></div>');
  d.classList.add('ex-raw-panel');
  let filled = false;
  d.addEventListener('toggle', () => {
    if (!d.open || filled) return;
    filled = true;
    const hasT = ds.reps.some(r => r.t);
    let total = 0;
    for (const r of ds.reps) total += r.v.length;
    const rows = [];
    outer: for (const r of ds.reps) {
      for (let i = 0; i < r.v.length; i++) {
        if (rows.length >= RAW_CAP) break outer;
        rows.push('<tr><td>' + esc(r.id) + '</td>' + (hasT ? '<td>' + (r.t ? num(r.t[i], 8) : dash) + '</td>' : '') + '<td>' + num(r.v[i], 8) + '</td></tr>');
      }
    }
    const body = d.querySelector('.ex-raw-body');
    body.innerHTML = '<p class="muted-line">' + (total > RAW_CAP ? 'Showing the first ' + intl(RAW_CAP) + ' of ' + intl(total) + ' rows.' : 'All ' + plural(total, 'row') + '.') + '</p>' +
      '<div class="scroll-box"><table class="ptab"><thead><tr><th>Replication</th>' + (hasT ? '<th>Time</th>' : '') + '<th>Value</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  });
  return d;
}

// ── Distribution of the estimates ───────────────────────────────────────

function buildDistribution(api, { ds, estF }) {
  const sec = api.sec;
  const forced = ds.kind === 'tally' && estF.length < 2;
  const usePooled = ds.kind === 'tally' && (pooled || forced);
  sec.appendChild(el('div', 'sec-hd', 'Histogram and empirical cdf'));
  if (ds.kind === 'tally') {
    const row = el('div', 'ctrl-row ex-tight');
    row.innerHTML = '<label class="ctrl-chk"><input type="checkbox" id="ex-pooled"' + (usePooled ? ' checked' : '') + (forced ? ' disabled' : '') + '> Pooled observations</label>' +
      (forced ? '<span class="ctrl-note">With one replication there is one estimate, and so these plots show the observations.</span>' : '');
    sec.appendChild(row);
    row.querySelector('#ex-pooled').addEventListener('change', e => { pooled = e.target.checked; state.setPick(id, 'pooled:' + ds.id, pooled); api.rebuild(); });
  }
  const values = usePooled ? observations(ds) : estF;
  const what = usePooled ? 'pooled observations' : estimateWord(ds);
  const xLabel = usePooled ? ds.response : estimateAxis(ds);
  const pair = el('div', 'ex-pair');
  sec.appendChild(pair);
  const base = slug(ds.name) + (usePooled ? '-observations' : '-estimates');
  figure(api, pair, base + '-histogram', { height: 260, narrowHeight: 260, xLabel, yLabel: 'Fraction', ariaLabel: 'Histogram of the ' + what },
    f => histogram(f, histBins(values), { fraction: true }),
    [{ swatch: 'bar', color: '--est', label: esc(what) }]);
  figure(api, pair, base + '-ecdf', { height: 260, narrowHeight: 260, xLabel, ariaLabel: 'Empirical cdf of the ' + what },
    f => ecdf(f, ecdfOf(values)),
    [{ swatch: 'line', color: '--est', label: 'empirical cdf' }]);
  if (usePooled) {
    caption(sec, 'Each bar is the fraction of the ' + intl(values.length) + ' pooled observations in its bin, and the cdf rises by 1/n at each one. Pooled observations are not independent: each run’s values are correlated with their neighbors, and so these plots describe their spread but support no interval.');
  } else {
    caption(sec, 'Each bar is the fraction of the ' + intl(values.length) + ' ' + esc(what) + ' in its bin, and the cdf rises by 1/R at each one. These estimates, one per replication, are the values every interval on the other pages is built from.');
  }
}

function buildBox(api, { ds, estF }) {
  const sec = api.sec;
  sec.appendChild(el('div', 'sec-hd', 'Box plot of the ' + esc(estimateWord(ds))));
  const st = Object.assign({}, boxStats(estF), { mean: mean(estF) });
  figure(api, sec, slug(ds.name) + '-boxplot', { height: 'auto', margin: { t: 8, b: 44, l: 16 }, xLabel: estimateAxis(ds), ariaLabel: 'Box plot of the ' + estimateWord(ds) },
    f => boxPlot(f, st),
    [{ swatch: 'bar', color: '--est', label: 'box from q1 to q3, median line, whiskers to 1.5 IQR' }]
      .concat(st.outliers.length ? [{ swatch: 'hollow', color: '--est', label: 'estimate beyond a whisker' }] : [])
      .concat([{ swatch: 'diamond', color: '--truth', label: 'mean' }]));
  caption(sec, 'The box spans the middle half of the ' + intl(estF.length) + ' estimates with the median inside it, and each whisker reaches the most extreme estimate within 1.5 box widths of the box.');
}

// ── One replication ─────────────────────────────────────────────────────

function chosenRep(ds) { return ds.reps[Math.min(ds.reps.length, Math.max(1, repIndex)) - 1]; }

function axisToggle(api, ds, rep) {
  if (ds.kind !== 'tally' || !rep.t) return;
  const row = el('div', 'ctrl-row ex-tight');
  row.innerHTML = '<span class="ctrl-lbl" id="ex-xmode-lbl">Horizontal axis</span><span class="seg" role="group" aria-labelledby="ex-xmode-lbl">' +
    '<button type="button" class="seg-btn" data-x="index" aria-pressed="' + (xMode === 'index') + '">Observation number</button>' +
    '<button type="button" class="seg-btn" data-x="time" aria-pressed="' + (xMode === 'time') + '">Time</button></span>';
  row.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    if (xMode === b.dataset.x) return;
    xMode = b.dataset.x;
    state.setPick(id, 'axis', xMode);
    for (const s of repSections) s.rebuild();
  }));
  api.sec.appendChild(row);
}

function buildSequence(api, { ds }) {
  const sec = api.sec;
  const rep = chosenRep(ds);
  const time = ds.kind === 'time';
  sec.appendChild(el('div', 'sec-hd', (time ? 'State over time' : 'Observation sequence') + ', replication ' + esc(rep.id)));
  axisToggle(api, ds, rep);
  const name = slug(ds.name) + '-rep-' + slug(rep.id) + '-sequence';
  if (time) {
    const s = stepSeries(rep, ds.endTime);
    figure(api, sec, name, { height: 240, narrowHeight: 260, xLabel: 'Time', yLabel: ds.response, ariaLabel: 'State against time, replication ' + rep.id },
      f => {
        f.readout(dx => {
          let k = -1;
          for (let i = 0; i < rep.t.length && rep.t[i] <= dx; i++) k = i;
          return k < 0 ? null : ['t = ' + num(dx), 'state ' + num(rep.v[k]) + ' since t = ' + num(rep.t[k])];
        });
        sequence(f, s.ys, { xs: s.xs, width: 1.4 });
      },
      [{ swatch: 'line', color: '--est', label: 'state, held until the next record' }]);
    caption(sec, 'Each value holds from its record time until the next record' +
      (ds.endTime != null ? ', and the last until the end time ' + num(ds.endTime) + '.' : '; with no end time given, the last record holds for no time.') +
      ' The replication’s estimate weights each value by how long it held.');
  } else {
    const useT = rep.t && xMode === 'time';
    figure(api, sec, name, { height: 240, narrowHeight: 260, xLabel: useT ? 'Time' : 'Observation number', yLabel: ds.response, ariaLabel: 'Observations in order, replication ' + rep.id },
      f => sequence(f, rep.v, useT ? { xs: rep.t } : {}),
      [{ swatch: 'thin', color: '--est', label: 'observation' }]);
    caption(sec, 'The ' + plural(rep.v.length, 'observation') + ' of replication ' + esc(rep.id) + ' in the order the run recorded them. Neighbors tend to sit close together, which is the serial correlation the lag plot and correlogram below measure.');
  }
}

function buildRunning(api, { ds, est }) {
  const sec = api.sec;
  const rep = chosenRep(ds);
  const time = ds.kind === 'time';
  sec.appendChild(el('div', 'sec-hd', (time ? 'Running time-weighted mean' : 'Running mean') + ', replication ' + esc(rep.id)));
  const name = slug(ds.name) + '-rep-' + slug(rep.id) + '-running-mean';
  const legendItems = [{ swatch: 'line', color: '--est', label: time ? 'time-weighted mean from the start to t' : 'running mean' },
    { swatch: 'dash', color: '--truth', label: 'final value, the replication’s estimate' }];
  if (time) {
    const s = runningTimeMean(rep, ds.endTime);
    const final = s.ys.length ? s.ys[s.ys.length - 1] : NaN;
    figure(api, sec, name, { height: 240, narrowHeight: 260, xLabel: 'Time', yLabel: 'Running time-weighted mean', ariaLabel: 'Running time-weighted mean, replication ' + rep.id },
      f => {
        if (!s.xs.length) return;
        f.x(extent(s.xs));
        f.y(extent(s.ys), { pad: 0.08, nice: true });
        f.axes();
        if (Number.isFinite(final)) {
          const y = Math.round(f.sy(final) * 10) / 10;
          svgEl('line', { x1: 0, x2: f.iw, y1: y, y2: y, stroke: tok('--truth'), 'stroke-width': 1.5, 'stroke-dasharray': '6,4' }, f.inner);
        }
        f.readout(dx => {
          let k = -1;
          for (let i = 0; i < s.xs.length && s.xs[i] <= dx; i++) k = i;
          return k < 0 ? null : ['t = ' + num(s.xs[k]), 'time-weighted mean ' + num(s.ys[k])];
        });
        sequence(f, s.ys, { xs: s.xs, width: 1.8 });
      }, legendItems);
    caption(sec, 'At each record time t, the time-weighted mean of the state from the start of the run to t. Its final value, ' + num(final) + ', is replication ' + esc(rep.id) + '’s estimate.');
  } else {
    const useT = rep.t && xMode === 'time';
    figure(api, sec, name, { height: 240, narrowHeight: 260, xLabel: useT ? 'Time' : 'Observation number', yLabel: 'Running mean', ariaLabel: 'Running mean, replication ' + rep.id },
      f => runningMean(f, rep.v, useT ? { xs: rep.t } : {}), legendItems);
    caption(sec, 'The running mean after observation i is the average of the first i observations. Its final value, ' + num(est[repIndex - 1]) + ', is replication ' + esc(rep.id) + '’s estimate.');
  }
}

function buildLag(api, { ds }) {
  const sec = api.sec;
  const rep = chosenRep(ds);
  sec.appendChild(el('div', 'sec-hd', 'Lag plot and correlogram, replication ' + esc(rep.id)));
  const n = rep.v.length;
  const L = Math.min(40, Math.floor(n / 4));
  if (n < 8 || L < 1) {
    sec.appendChild(el('p', 'muted-line', 'Replication ' + esc(rep.id) + ' has ' + plural(n, 'observation') + ', too few for a lag plot or a correlogram.'));
    return;
  }
  const pair = el('div', 'ex-pair');
  sec.appendChild(pair);
  const lp = lagPairs(rep.v, 1);
  const base = slug(ds.name) + '-rep-' + slug(rep.id);
  figure(api, pair, base + '-lag-plot', { height: 300, narrowHeight: 300, xLabel: 'Observation i', yLabel: 'Observation i + 1', ariaLabel: 'Lag plot, replication ' + rep.id },
    f => lagPlot(f, lp.x, lp.y),
    [{ swatch: 'dot', color: '--est', label: 'consecutive pair' }, { swatch: 'dash', color: '--truth', label: 'identity line' }]);
  const r = acf(rep.v, L);
  const band = 2 / Math.sqrt(n);
  figure(api, pair, base + '-correlogram', { height: 300, narrowHeight: 300, ariaLabel: 'Correlogram, replication ' + rep.id },
    f => correlogram(f, r, { band }),
    [{ swatch: 'line', color: '--est', label: 'autocorrelation at each lag' }, { swatch: 'dash', color: '--truth', label: '±2/√n band, n = ' + intl(n) }]);
  caption(sec, 'Points that hug the identity line, and autocorrelations outside the ±2/√n band, mark observations correlated with their neighbors. The lag-one autocorrelation here is ' + num(r[1], 3) + '. A t interval over these observations would treat them as independent and come out too narrow.');
}

// ── Across replications ─────────────────────────────────────────────────

function buildDots(api, { ds, est, estF }) {
  const sec = api.sec;
  sec.appendChild(el('div', 'sec-hd', 'Replication dot plot'));
  const labels = ds.reps.map(r => 'replication ' + r.id);
  const vals = Array.from(est);
  figure(api, sec, slug(ds.name) + '-dotplot', { height: 140, narrowHeight: 160, margin: { t: 8, b: 44 }, xLabel: estimateAxis(ds), ariaLabel: 'Dot plot of the ' + estimateWord(ds) },
    f => dotPlot(f, vals, { labels, mean: true }),
    [{ swatch: 'dot', color: '--est', label: 'one replication’s estimate' }, { swatch: 'line', color: '--truth', label: 'mean of the estimates' }]);
  caption(sec, 'Each dot is one of the ' + intl(estF.length) + ' ' + esc(estimateWord(ds)) + ', and their spread around the mean, ' + num(mean(estF)) + ', is the variation an interval over replications measures.');
}

function buildIntervals(api, { ds, estF }) {
  const sec = api.sec;
  const level = state.settings.level;
  sec.appendChild(el('div', 'sec-hd', 'Confidence intervals, ' + pct(level, 0)));
  const all = tInterval(estF, level);
  const items = [{ label: 'all replications', lo: all.lo, hi: all.hi, center: all.mean, color: '--truth' }];
  let shown = 0, eligible = 0;
  if (ds.kind === 'tally') {
    for (const r of ds.reps) {
      if (r.v.length < 2) continue;
      eligible++;
      if (shown >= FOREST_CAP) continue;
      const ti = tInterval(r.v, level);
      items.push({ label: 'replication ' + r.id, lo: ti.lo, hi: ti.hi, center: ti.mean, color: '--est' });
      shown++;
    }
  }
  const legendItems = [{ swatch: 'interval', color: '--truth', label: 'interval over the ' + esc(estimateWord(ds)) }];
  if (shown) legendItems.push({ swatch: 'interval', color: '--est', label: 'one replication’s own interval over its observations' });
  legendItems.push({ swatch: 'dash', color: '--truth', label: 'mean of the estimates' });
  figure(api, sec, slug(ds.name) + '-intervals', { height: 'auto', margin: { t: 8, b: 44 }, xLabel: estimateAxis(ds), ariaLabel: 'Confidence intervals' },
    f => intervals(f, items, { ref: all.mean }), legendItems);
  let cap = (shown ? 'The top row is the ' : 'The row is the ') + pct(level, 0) + ' t interval over the ' + intl(estF.length) + ' ' + esc(estimateWord(ds)) +
    ', mean ± t<sub>' + num(1 - (1 - level) / 2, 3) + ', ' + intl(all.df) + '</sub> · s/√R = ' + num(all.mean) + ' ± ' + num(all.hw) + '.';
  if (shown) {
    cap += ' The rows below it are each replication’s own interval over its observations. They describe the variation within one run and are not the inference: the observations in a run are correlated, which makes these intervals too narrow, and each one is about that run alone.';
    if (eligible > shown) cap += ' The first ' + intl(shown) + ' of ' + intl(eligible) + ' replications are drawn.';
  }
  caption(sec, cap);
}

function buildScatter(api, { ds, est }, other) {
  const sec = api.sec;
  const oest = repEstimates(other);
  const xs = [], ys = [];
  for (let i = 0; i < Math.min(est.length, oest.length); i++) {
    if (Number.isFinite(est[i]) && Number.isFinite(oest[i])) { xs.push(est[i]); ys.push(oest[i]); }
  }
  sec.appendChild(el('div', 'sec-hd', 'Scatter against ' + esc(other.name)));
  const r = xs.length >= 2 ? pearson(xs, ys) : NaN;
  figure(api, sec, slug(ds.name) + '-vs-' + slug(other.name) + '-scatter',
    { height: 300, narrowHeight: 320, xLabel: ds.name + ' estimate', yLabel: other.name + ' estimate', ariaLabel: 'Scatter of replication estimates' },
    f => scatter(f, xs, ys),
    [{ swatch: 'dot', color: '--est', label: 'one replication of each, matched by position' }]);
  caption(sec, 'Pearson’s r = ' + num(r, 3) + ' over ' + plural(xs.length, 'pair') + ' of replication estimates, the first replication of one dataset matched with the first of the other, and so on. A strong positive r is what common random numbers produce when both datasets used the same streams in the same order.');
}

export default { id, title, sections, render, onShow };
