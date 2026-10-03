// A page reachable only at #gallery that draws every plot type and every
// shared widget from synthetic data, so that the figure builder can be checked in
// a browser at any width. It has no link in the page navigation and no entry
// in the page menu.

import {
  makeFigure, exportButtons, legend, histogram, ecdf, boxPlot, sequence, runningMean,
  dotPlot, intervals, scatter, lagPlot, correlogram, welchPlot, batchPlot
} from '../ui/plots.js';
import {
  card, cardRow, spinner, levelSelect, unitLine, details, issueList, notice
} from '../ui/widgets.js';

export const id = 'gallery';
export const title = 'Plot Gallery';

// mulberry32: a small seeded generator, and so the gallery draws the same
// figures on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(u) {
  const a = Math.max(1e-12, u()), b = u();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
function mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
function quantile(sorted, p) {
  const h = (sorted.length - 1) * p, lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)]) - sorted[lo]);
}
function boxStats(a) {
  const s = Array.from(a).sort((x, y) => x - y);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const inside = s.filter(v => v >= lo && v <= hi);
  return { q1, median: quantile(s, 0.5), q3, whiskerLo: inside[0], whiskerHi: inside[inside.length - 1], outliers: s.filter(v => v < lo || v > hi), mean: mean(s) };
}
function hist(a, bins) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const w = (hi - lo) / bins, edges = [], counts = new Array(bins).fill(0);
  for (let i = 0; i <= bins; i++) edges.push(lo + i * w);
  for (const v of a) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { edges, counts };
}
function acf(a, L) {
  const n = a.length, m = mean(a);
  let c0 = 0; for (const v of a) c0 += (v - m) * (v - m);
  const r = new Float64Array(L + 1);
  for (let k = 0; k <= L; k++) { let s = 0; for (let i = 0; i + k < n; i++) s += (a[i] - m) * (a[i + k] - m); r[k] = s / c0; }
  return r;
}

function block(root, heading, note) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  sec.innerHTML = '<div class="sec-hd">' + heading + '</div>' + (note ? '<p class="exp-note">' + note + '</p>' : '');
  root.appendChild(sec);
  const box = document.createElement('div');
  sec.appendChild(box);
  const leg = document.createElement('div');
  sec.appendChild(leg);
  return { sec, box, leg };
}

/**
 * Renders every plot type and shared widget into the gallery section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML = '<h2>' + title + '</h2><p class="lede">Every figure type and shared widget, drawn from seeded synthetic data. Hover or tap a plot for its readout; drag the dashed line in the warm-up plot.</p>';
  const u = rng(20261002);

  // Widgets.
  const w = document.createElement('div');
  w.className = 'sec';
  w.innerHTML = '<div class="sec-hd">Widgets</div>';
  root.appendChild(w);
  const fakeDs = { id: 'g1', name: 'avg_wait', kind: 'tally', reps: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, t: null, v: new Float64Array(192 + (i % 3)) })) };
  w.appendChild(unitLine(fakeDs));
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = '<span class="ctrl-pair"><label class="ctrl-lbl" for="gal-b"><span class="tip" tabindex="0" data-tip="The number of batches the run is split into. Arrow keys move it by 1.">Batches b</span></label><input id="gal-b" type="text" value="20"></span>' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="gal-lvl">Confidence level</label><select id="gal-lvl"></select></span>' +
    '<span class="ctrl-note" id="gal-b-echo">b = 20</span>';
  w.appendChild(row);
  spinner(row.querySelector('#gal-b'), { min: 2, max: 200, step: 1, onChange: v => { row.querySelector('#gal-b-echo').textContent = 'b = ' + v; } });
  levelSelect(row.querySelector('#gal-lvl'));
  w.appendChild(cardRow([
    card('Mean', '4.8213', 'R = 20'),
    card('Half-width', '0.3127', 't<sub>0.975, 19</sub> = 2.093'),
    card('95% interval', '[4.5086, 5.1340]'),
    card('Standard error', '0.1494')
  ]));
  w.appendChild(notice('warn', 'These observations come from one replication and are serially correlated; an interval that treats them as independent is too narrow.'));
  w.appendChild(notice('info', 'Truncation applies to every replication at the same point.'));
  w.appendChild(details('Why replications are the unit of inference', '<p>Observations within one replication are correlated with each other. Replication means from independent replications are independent and identically distributed, which is what the t interval assumes.</p>'));
  w.appendChild(issueList([{ line: 14, text: '3.2,abc', reason: 'value is not a number' }, { line: 27, text: '', reason: 'blank row inside a replication' }]));

  // Synthetic data: gamma-shaped waits, an AR(1) series, and a warm-up curve.
  const waits = Array.from({ length: 400 }, () => -Math.log(u()) - Math.log(u()) - Math.log(u()));
  const ar = new Float64Array(20000);
  ar[0] = 0;
  for (let i = 1; i < ar.length; i++) ar[i] = 0.85 * ar[i - 1] + normal(u);
  for (let i = 0; i < ar.length; i++) ar[i] += 10;

  let b = block(root, 'Histogram (fraction of observations)');
  const h = hist(waits, 20);
  let fig = makeFigure(b.box, { height: 260, narrowHeight: 300, xLabel: 'Waiting time (minutes)', yLabel: 'Fraction' });
  fig.render(f => histogram(f, h, { fraction: true }));
  exportButtons(b.box, fig, 'histogram');
  legend(b.leg, [{ swatch: 'bar', color: '--est', label: 'observations' }]);

  b = block(root, 'Empirical cdf');
  const sw = waits.slice().sort((x, y) => x - y);
  const e = { x: sw, p: sw.map((_, i) => (i + 1) / sw.length) };
  fig = makeFigure(b.box, { height: 260, narrowHeight: 300, xLabel: 'Waiting time (minutes)' });
  fig.render(f => ecdf(f, e));
  exportButtons(b.box, fig, 'ecdf');
  legend(b.leg, [{ swatch: 'line', color: '--est', label: 'empirical cdf' }]);

  b = block(root, 'Box plots');
  const groups = [0, 0.6, 1.5].map(s => Array.from({ length: 30 }, () => 5 + s + normal(u) * (1 + s / 2)));
  fig = makeFigure(b.box, { height: 'auto', margin: { b: 40, t: 8 }, xLabel: 'Average wait (minutes)' });
  fig.render(f => boxPlot(f, groups.map((g, i) => ({ label: 'Design ' + 'ABC'[i], stats: boxStats(g) }))));
  exportButtons(b.box, fig, 'boxplots');
  legend(b.leg, [{ swatch: 'bar', color: '--est', label: 'quartile box, median line, 1.5 IQR whiskers' }, { swatch: 'hollow', color: '--est', label: 'outlier' }, { swatch: 'diamond', color: '--truth', label: 'mean' }]);

  b = block(root, 'Observation sequence (20,000 points, thinned per pixel column)');
  fig = makeFigure(b.box, { height: 240, narrowHeight: 280, yLabel: 'Queue length' });
  fig.render(f => sequence(f, ar));
  exportButtons(b.box, fig, 'sequence');
  legend(b.leg, [{ swatch: 'thin', color: '--est', label: 'observation' }]);

  b = block(root, 'Running mean');
  fig = makeFigure(b.box, { height: 240, narrowHeight: 280 });
  fig.render(f => runningMean(f, ar.subarray(0, 3000)));
  exportButtons(b.box, fig, 'running-mean');
  legend(b.leg, [{ swatch: 'line', color: '--est', label: 'running mean' }, { swatch: 'dash', color: '--truth', label: 'final value' }]);

  b = block(root, 'Replication means (dot plot)');
  const repMeans = Array.from({ length: 20 }, () => 4.8 + normal(u) * 0.6);
  fig = makeFigure(b.box, { height: 130, narrowHeight: 150, margin: { t: 8, b: 40 }, xLabel: 'Replication mean of average wait' });
  fig.render(f => dotPlot(f, repMeans, { labels: repMeans.map((_, i) => 'replication ' + (i + 1)), mean: true }));
  exportButtons(b.box, fig, 'dotplot');
  legend(b.leg, [{ swatch: 'dot', color: '--est', label: 'one replication' }, { swatch: 'line', color: '--truth', label: 'mean of the replication means' }]);

  b = block(root, 'Intervals (forest plot)');
  const items = [
    { label: 'A − B', lo: -0.42, hi: 0.31 },
    { label: 'A − C', lo: -1.61, hi: -0.52, flagged: true },
    { label: 'B − C', lo: -1.33, hi: 0.08 },
    { label: 'A − D (a long label to test clipping in the left column)', lo: -0.2, hi: 0.9 },
    { label: 'C − D', lo: 0.35, hi: 1.7, flagged: true }
  ];
  fig = makeFigure(b.box, { height: 'auto', margin: { t: 8, b: 40 }, xLabel: 'Difference in mean wait (minutes)' });
  fig.render(f => intervals(f, items, { ref: 0 }));
  exportButtons(b.box, fig, 'intervals');
  legend(b.leg, [{ swatch: 'interval', color: '--est', label: 'interval includes zero' }, { swatch: 'flagged', color: '--miss', label: 'interval excludes zero' }, { swatch: 'dash', color: '--truth', label: 'zero difference' }]);

  b = block(root, 'Scatter');
  const sx = Array.from({ length: 60 }, () => 5 + normal(u));
  const sy = sx.map(v => 0.7 * v + 1.5 + normal(u) * 0.5);
  fig = makeFigure(b.box, { height: 300, narrowHeight: 330, xLabel: 'Design A replication mean', yLabel: 'Design B replication mean' });
  fig.render(f => scatter(f, sx, sy));
  exportButtons(b.box, fig, 'scatter');
  legend(b.leg, [{ swatch: 'dot', color: '--est', label: 'one replication pair' }]);

  b = block(root, 'Lag plot (lag 1)');
  const a = ar.subarray(0, 600);
  fig = makeFigure(b.box, { height: 300, narrowHeight: 330, xLabel: 'Observation i', yLabel: 'Observation i + 1' });
  fig.render(f => lagPlot(f, a.subarray(0, a.length - 1), a.subarray(1)));
  exportButtons(b.box, fig, 'lag-plot');
  legend(b.leg, [{ swatch: 'dot', color: '--est', label: 'consecutive pair' }, { swatch: 'dash', color: '--truth', label: 'identity line' }]);

  b = block(root, 'Correlogram');
  const r = acf(Array.from(ar.subarray(0, 2000)), 30);
  fig = makeFigure(b.box, { height: 240, narrowHeight: 280 });
  fig.render(f => correlogram(f, r, { band: 2 / Math.sqrt(2000) }));
  exportButtons(b.box, fig, 'correlogram');
  legend(b.leg, [{ swatch: 'line', color: '--est', label: 'autocorrelation at each lag' }, { swatch: 'dash', color: '--truth', label: '±2/√n band' }]);

  b = block(root, 'Warm-up plot with a draggable truncation line');
  const L = 400, R = 10;
  const ybar = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    let s = 0;
    for (let k = 0; k < R; k++) s += 6 * (1 - Math.exp(-i / 60)) + normal(u) * 1.4;
    ybar[i] = s / R;
  }
  const wwin = 10, smooth = new Float64Array(L).fill(NaN), cum = new Float64Array(L);
  for (let i = 0; i < L - wwin; i++) {
    const hw = Math.min(i, wwin);
    let s = 0; for (let k = -hw; k <= hw; k++) s += ybar[i + k];
    smooth[i] = s / (2 * hw + 1);
  }
  let cs = 0; for (let i = 0; i < L; i++) { cs += ybar[i]; cum[i] = cs / (i + 1); }
  const xs = Array.from({ length: L }, (_, i) => i + 1);
  let cut = 150;
  const echo = document.createElement('p');
  echo.className = 'fig-note';
  echo.textContent = 'Cut at observation ' + cut;
  fig = makeFigure(b.box, { height: 280, narrowHeight: 320, xLabel: 'Observation index', yLabel: 'Average across replications' });
  fig.render(f => welchPlot(f, {
    x: xs, raw: ybar, smooth, cumulative: cum, cut, step: 1,
    cutLabel: v => 'cut at ' + Math.round(v),
    onCut: v => { cut = Math.round(v); echo.textContent = 'Cut at observation ' + cut; }
  }));
  exportButtons(b.box, fig, 'warm-up');
  b.sec.insertBefore(echo, b.leg);
  legend(b.leg, [{ swatch: 'thin', color: '--pair', label: 'average across replications' }, { swatch: 'line', color: '--est', label: 'moving average, w = 10' }, { swatch: 'dash', color: '--truth', label: 'cumulative average' }, { swatch: 'dash', color: '--text', label: 'truncation point (drag, or use the arrow keys)' }]);

  b = block(root, 'Batch means');
  const series = ar.subarray(0, 1000);
  const nb = 10, size = 100, bounds = [], means = [];
  for (let k = 0; k <= nb; k++) bounds.push(k * size + 0.5);
  for (let k = 0; k < nb; k++) means.push(mean(series.subarray(k * size, (k + 1) * size)));
  fig = makeFigure(b.box, { height: 260, narrowHeight: 300, yLabel: 'Queue length' });
  fig.render(f => batchPlot(f, { ys: series, boundaries: bounds, means }));
  exportButtons(b.box, fig, 'batch-means');
  legend(b.leg, [{ swatch: 'thin', color: '--est', label: 'observation' }, { swatch: 'line', color: '--ok', label: 'batch mean (' + nb + ' batches of ' + size + ')' }, { swatch: 'dash', color: '--muted', label: 'batch boundary' }]);
}

/** Called each time the gallery is shown. */
export function onShow() {}

export default { id, title, render, onShow };
