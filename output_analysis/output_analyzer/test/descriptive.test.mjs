// Descriptive statistics against R. Every expected value in
// reference/descriptive.json was produced by reference/descriptive.R from R's
// mean, var, sd, quantile(type = 7), acf, boxplot.stats, ecdf, cor, and
// hist(right = FALSE, include.lowest = TRUE) on equal-width breaks; the
// time-weighted and binned references are hand integrations in that script
// (sum of value × overlap of each holding interval with the window). The
// samples themselves are read from the JSON. The few small constructed cases
// (a constant sample, values on bin edges, a single record) check the stated
// definitions directly and need no reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from '../js/stats/descriptive.js';

const ref = JSON.parse(readFileSync(new URL('./reference/descriptive.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
    `${label}: got ${got}, want ${want} (tol ${tol})`);
const closeVec = (got, want, tol, label) => {
  assert.equal(got.length, want.length, `${label}: length`);
  for (let i = 0; i < want.length; i++) close(got[i], want[i], tol, `${label}[${i}]`);
};
// The R scripts write -1 for "no covered time" or "empty bin", which JSON cannot carry as NaN.
const closeBins = (got, want, tol, label) => {
  assert.equal(got.length, want.length, `${label}: length`);
  for (let i = 0; i < want.length; i++) {
    if (want[i] === -1) assert.ok(Number.isNaN(got[i]), `${label}[${i}]: want NaN, got ${got[i]}`);
    else close(got[i], want[i], 1e-12, `${label}[${i}]`);
  }
};

test('mean, variance, sd, se, minmax match R', () => {
  for (const s of ref.sets) {
    close(D.mean(s.x), s.mean, 1e-14, `${s.name} mean`);
    close(D.variance(s.x), s.var, 1e-13, `${s.name} var`);
    close(D.sd(s.x), s.sd, 1e-13, `${s.name} sd`);
    close(D.se(s.x), s.se, 1e-13, `${s.name} se`);
    const mm = D.minmax(s.x);
    assert.equal(mm.min, s.min); assert.equal(mm.max, s.max);
  }
  assert.ok(Number.isNaN(D.mean([])));
  assert.ok(Number.isNaN(D.variance([3])));
});

test('quantile and summary are R type 7', () => {
  for (const s of ref.sets) {
    const sorted = D.sortedCopy(s.x);
    close(D.quantile(sorted, 0.1), s.q10, 1e-14, `${s.name} q10`);
    close(D.quantile(sorted, 0.9), s.q90, 1e-14, `${s.name} q90`);
    const sm = D.summary(s.x);
    assert.equal(sm.n, s.x.length);
    closeVec([sm.q1, sm.median, sm.q3], s.q, 1e-14, `${s.name} quartiles`);
    close(sm.mean, s.mean, 1e-14, `${s.name} summary mean`);
    close(sm.sd, s.sd, 1e-13, `${s.name} summary sd`);
    assert.equal(sm.min, s.min); assert.equal(sm.max, s.max);
  }
});

test('acf matches R acf to lag 5', () => {
  for (const s of ref.sets) closeVec(D.acf(s.x, 5), s.acf, 1e-13, `${s.name} acf`);
  assert.equal(D.acf([1, 2, 3], 10).length, 3, 'maxLag clipped to n - 1');
});

test('boxStats matches boxplot.stats (hinges, whiskers, outliers)', () => {
  for (const s of ref.sets) {
    const b = D.boxStats(s.x);
    closeVec([b.whiskerLo, b.q1, b.median, b.q3, b.whiskerHi], s.box, 1e-14, `${s.name} box`);
    closeVec(b.outliers, s.out, 0, `${s.name} outliers`);
  }
});

test('histogram matches hist on equal-width breaks, last bin closed', () => {
  for (const s of ref.sets) {
    const h = D.histogram(s.x);
    assert.equal(h.edges.length, h.counts.length + 1);
    closeVec(h.edges, s.histEdges, 1e-13, `${s.name} edges`);
    closeVec(h.counts, s.histCounts, 0, `${s.name} counts`);
    assert.equal(h.counts.reduce((a, b) => a + b, 0), s.x.length);
  }
  const c = D.histogram([4, 4, 4]);
  assert.deepEqual([...c.edges], [3.5, 4.5]);
  assert.deepEqual([...c.counts], [3]);
  assert.equal(c.binWidth, 1);
  const k = D.histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 10 });
  assert.equal(k.counts.length, 10);
  assert.deepEqual([...k.counts], [1, 1, 1, 1, 1, 1, 1, 1, 1, 2], 'edge values go right; the max goes in the last bin');
});

test('ecdf, running mean, lag pairs, and pearson match R', () => {
  for (const s of ref.sets) {
    const e = D.ecdf(s.x);
    closeVec(e.x, s.ecdfX, 0, `${s.name} ecdf x`);
    closeVec(e.p, s.ecdfP, 1e-15, `${s.name} ecdf p`);
    closeVec(D.runningMean(s.x), s.runMean, 1e-13, `${s.name} running mean`);
    closeVec(D.cumulativeMean(s.x), s.runMean, 1e-13, `${s.name} cumulative mean`);
    const lp = D.lagPairs(s.x, 1);
    close(D.pearson(lp.x, lp.y), s.lag1cor, 1e-13, `${s.name} lag-1 pairs cor`);
  }
  close(D.pearson(ref.pearson.x, ref.pearson.y), ref.pearson.r, 1e-13, 'pearson');
  assert.throws(() => D.pearson([1, 2], [1, 2, 3]), RangeError);
});

test('timeWeightedMean matches hand integration', () => {
  const { t, v, endTime } = ref.tw;
  close(D.timeWeightedMean(t, v, endTime), ref.tw.mean, 1e-13, 'with endTime');
  close(D.timeWeightedMean(t, v, null), ref.tw.meanNullEnd, 1e-13, 'endTime null');
  assert.throws(() => D.timeWeightedMean(t, v, t[t.length - 1] - 1), RangeError);
  assert.ok(Number.isNaN(D.timeWeightedMean([5], [3], null)), 'zero duration gives NaN');
  assert.ok(Number.isNaN(D.timeWeightedMean([5, 5], [3, 4], 5)), 'zero duration gives NaN');
  close(D.timeWeightedMean([5], [3], 9), 3, 0, 'single record held to endTime');
});

test('timeWeightedBins matches hand integration per bin', () => {
  const { t, v, endTime, edges } = ref.tw;
  closeBins(D.timeWeightedBins(t, v, endTime, edges), ref.tw.bins, 1e-12, 'with endTime');
  closeBins(D.timeWeightedBins(t, v, null, edges), ref.tw.binsNullEnd, 1e-12, 'endTime null');
  assert.throws(() => D.timeWeightedBins(t, v, 1, edges), RangeError);
});

test('tallyBins matches per-bin means, empty bins NaN, last bin closed', () => {
  const { t, v, edges } = ref.tally;
  closeBins(D.tallyBins(t, v, edges), ref.tally.bins, 1e-12, 'tally bins');
});
