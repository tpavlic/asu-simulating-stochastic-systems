// Intervals and tests against R. Every expected value in
// reference/intervals.json was produced by reference/intervals.R: t.test for the
// mean interval, qchisq for the variance interval, var.test for the F ratio,
// cor.test for the correlation, and a brute-force search over n with qt for the
// replication plans. The samples themselves are read from the JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as I from '../js/stats/intervals.js';
import { tQuantile } from '../js/stats/special.js';

const ref = JSON.parse(readFileSync(new URL('./reference/intervals.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)),
    `${label}: got ${got}, want ${want} (tol ${tol})`);

test('tInterval matches t.test at 90, 95, and 99%', () => {
  for (const L of ref.levels) {
    const r = I.tInterval(ref.x, L.level);
    close(r.lo, L.t.ci[0], 1e-11, `lo @${L.level}`);
    close(r.hi, L.t.ci[1], 1e-11, `hi @${L.level}`);
    close(r.mean, L.t.mean, 1e-14, 'mean');
    close(r.se, L.t.se, 1e-13, 'se');
    close(r.t, L.t.q, 1e-10, 't quantile');
    assert.equal(r.df, L.t.df);
    assert.equal(r.n, ref.x.length);
    assert.equal(r.level, L.level);
    close(r.hw, r.t * r.se, 1e-15, 'hw = t * se');
  }
  assert.ok(Number.isNaN(I.tInterval([1], 0.95).hw), 'n = 1 gives NaN');
});

test('varianceInterval matches the qchisq interval', () => {
  for (const L of ref.levels) {
    const r = I.varianceInterval(ref.x, L.level);
    close(r.chiLo, L.var.chiLo, 1e-10, `chiLo @${L.level}`);
    close(r.chiHi, L.var.chiHi, 1e-10, `chiHi @${L.level}`);
    close(r.lo2, L.var.lo2, 1e-10, `lo2 @${L.level}`);
    close(r.hi2, L.var.hi2, 1e-10, `hi2 @${L.level}`);
    close(r.loS, Math.sqrt(L.var.lo2), 1e-10, 'loS');
    close(r.hiS, Math.sqrt(L.var.hi2), 1e-10, 'hiS');
    assert.equal(r.df, ref.x.length - 1);
  }
});

test('fRatio matches var.test in both tails', () => {
  for (const L of ref.levels) {
    const r = I.fRatio(ref.x, ref.y, L.level);
    close(r.F, L.f.F, 1e-13, 'F');
    close(r.p, L.f.p, 1e-11, `p @${L.level}`);
    close(r.lo, L.f.ci[0], 1e-10, `lo @${L.level}`);
    close(r.hi, L.f.ci[1], 1e-10, `hi @${L.level}`);
    assert.equal(r.df1, ref.x.length - 1);
    assert.equal(r.df2, ref.y.length - 1);
  }
  const s = I.fRatio(ref.y, ref.x, 0.95);
  close(s.F, ref.fSwap.F, 1e-13, 'swapped F');
  close(s.p, ref.fSwap.p, 1e-11, 'swapped p');
  close(s.lo, ref.fSwap.ci[0], 1e-10, 'swapped lo');
  close(s.hi, ref.fSwap.ci[1], 1e-10, 'swapped hi');
});

test('fRatio on sets with no spread gives what var.test gives', () => {
  // var.test(c(3.1, 2.9, 4.2), c(5, 5, 5)): F = Inf, p = 0, interval [Inf, Inf];
  // with both sets constant, F, p, and the interval are all NaN; with x constant, all 0.
  const inf = I.fRatio([3.1, 2.9, 4.2], [5, 5, 5], 0.95);
  assert.equal(inf.F, Infinity); assert.equal(inf.p, 0); assert.equal(inf.lo, Infinity); assert.equal(inf.hi, Infinity);
  const nan = I.fRatio([5, 5, 5], [3, 3], 0.95);
  for (const k of ['F', 'p', 'lo', 'hi']) assert.ok(Number.isNaN(nan[k]), k);
  const zero = I.fRatio([5, 5, 5], [3.1, 2.9, 4.2], 0.95);
  for (const k of ['F', 'p', 'lo', 'hi']) assert.equal(zero[k], 0, k);
});

test('correlation matches cor.test, and n < 4 has no interval', () => {
  for (const L of ref.levels) {
    const r = I.correlation(ref.u, ref.w, L.level);
    close(r.r, L.cor.r, 1e-13, 'r');
    close(r.t, L.cor.t, 1e-12, 't');
    close(r.p, L.cor.p, 1e-11, `p @${L.level}`);
    close(r.lo, L.cor.ci[0], 1e-12, `lo @${L.level}`);
    close(r.hi, L.cor.ci[1], 1e-12, `hi @${L.level}`);
    assert.equal(r.df, ref.u.length - 2);
    assert.equal(r.note, null);
  }
  const s = I.correlation(ref.small, [1, 3, 2], 0.95);
  close(s.t, ref.corSmall.t, 1e-12, 'n = 3 t');
  close(s.p, ref.corSmall.p, 1e-11, 'n = 3 p');
  assert.ok(Number.isNaN(s.lo) && Number.isNaN(s.hi), 'n = 3 interval is NaN');
  assert.equal(typeof s.note, 'string');
  assert.throws(() => I.correlation([1, 2, 3], [1, 2]), RangeError);
});

test('planReplications finds the smallest n by the t half-width', () => {
  for (const c of ref.plan) {
    const r = I.planReplications({ sd: c.sd, level: c.level, target: c.target });
    assert.equal(r.n, c.n, `sd=${c.sd} target=${c.target} level=${c.level}`);
    close(r.hwAtN, c.hwAtN, 1e-10, 'hwAtN');
    // n satisfies the inequality and n − 1 does not (or n is the floor of 2). The
    // check through tQuantile is limited to moderate df, where that routine is
    // accurate; the large case is covered by the match with R above.
    const p = 1 - (1 - c.level) / 2;
    if (r.n <= 1e6) {
      assert.ok(tQuantile(p, r.n - 1) * c.sd / Math.sqrt(r.n) <= c.target);
      if (r.n > 2) assert.ok(tQuantile(p, r.n - 2) * c.sd / Math.sqrt(r.n - 1) > c.target);
    }
    assert.ok(r.iterations >= 1);
    // The relative form at target · |mean| is the same problem.
    const mean = -4;
    const rel = I.planReplications({ sd: c.sd, level: c.level, target: c.target / Math.abs(mean), relative: true, mean });
    assert.equal(rel.n, r.n, 'relative equals absolute');
    close(rel.hwAtN, r.hwAtN, 1e-14, 'relative hwAtN');
  }
  assert.equal(I.planReplications({ sd: 2, target: 0 }).n, null);
  assert.equal(I.planReplications({ sd: NaN, target: 1 }).n, null);
  assert.equal(I.planReplications({ sd: 2, target: 0.1, relative: true, mean: 0 }).n, null);
});

test('oneSampleT matches t.test(mu = mu0) below, near, and far from the mean', () => {
  for (const o of ref.oneT) {
    const r = I.oneSampleT(ref.x, o.mu0);
    close(r.t, o.t, 1e-12, `t @${o.mu0}`);
    close(r.p, o.p, 1e-11, `p @${o.mu0}`);
    assert.equal(r.df, o.df);
    assert.equal(r.mu0, o.mu0);
    assert.equal(r.n, ref.x.length);
  }
  // At the sample mean the statistic is 0 and p is 1; one value gives no test.
  const atMean = I.oneSampleT(ref.x, I.tInterval(ref.x).mean);
  close(atMean.t, 0, 1e-12, 't at the mean');
  close(atMean.p, 1, 1e-12, 'p at the mean');
  assert.ok(Number.isNaN(I.oneSampleT([3], 2).t));
  // A constant sample has se = 0: t is infinite off the mean (p = 0) and NaN at it.
  assert.equal(I.oneSampleT([2, 2, 2], 1).t, Infinity);
  assert.equal(I.oneSampleT([2, 2, 2], 1).p, 0);
  assert.ok(Number.isNaN(I.oneSampleT([2, 2, 2], 2).t));
});

test('predictionInterval matches predict.lm(interval = "prediction") at 90, 95, and 99%', () => {
  for (const L of ref.pi) {
    const r = I.predictionInterval(ref.x, L.level);
    close(r.lo, L.lo, 1e-11, `lo @${L.level}`);
    close(r.hi, L.hi, 1e-11, `hi @${L.level}`);
    const ti = I.tInterval(ref.x, L.level);
    close(r.hw, ti.t * ti.sd * Math.sqrt(1 + 1 / ref.x.length), 1e-12, 'hw = t s sqrt(1 + 1/n)');
    assert.ok(r.hw > ti.hw, 'wider than the confidence interval');
    assert.equal(r.df, ref.x.length - 1);
  }
  assert.ok(Number.isNaN(I.predictionInterval([1], 0.95).hw), 'n = 1 gives NaN');
});

test('quantileInterval: the order statistics, the interpolated quantile, and the equal-tails pbinom ranks', () => {
  const sample = { 60: ref.z, 15: ref.x, 4: ref.tiny };
  for (const q of ref.quant) {
    const r = I.quantileInterval(sample[q.n], q.p, q.level);
    const tag = `p=${q.p} L=${q.level} n=${q.n}`;
    assert.equal(r.n, q.n);
    close(r.order, q.order, 1e-14, `order statistic ${tag}`);
    close(r.interp, q.interp, 1e-12, `interpolated ${tag}`);
    assert.equal(r.minN, q.minN, `minN ${tag}`);
    assert.equal(r.bounds, q.bounds, `bounds ${tag}`);
    assert.equal(r.r, q.r, `r ${tag}`);
    assert.equal(r.s, q.s, `s ${tag}`);
    if (q.r === null) assert.ok(Number.isNaN(r.lo), `lo NaN ${tag}`); else close(r.lo, q.lo, 1e-14, `lo ${tag}`);
    if (q.s === null) assert.ok(Number.isNaN(r.hi), `hi NaN ${tag}`); else close(r.hi, q.hi, 1e-14, `hi ${tag}`);
    if (q.achieved === null) assert.ok(Number.isNaN(r.achieved), `achieved NaN ${tag}`);
    else {
      close(r.achieved, q.achieved, 1e-12, `achieved ${tag}`);
      // A two-sided interval reaches the level; a one-sided bound reaches 1 - alpha/2.
      assert.ok(r.achieved >= (q.bounds === 'both' ? q.level : 1 - (1 - q.level) / 2) - 1e-12, `achieved reaches the level ${tag}`);
    }
  }
  // The rank of the order statistic is ceil(n p), and p at the ends is refused.
  assert.equal(I.quantileInterval(ref.z, 0.9, 0.95).k, 54);
  assert.throws(() => I.quantileInterval(ref.z, 0, 0.95), RangeError);
  assert.throws(() => I.quantileInterval(ref.z, 1, 0.95), RangeError);
  const one = I.quantileInterval([5], 0.5, 0.95);
  assert.equal(one.r, null); assert.equal(one.s, null); assert.equal(one.bounds, 'none');
  assert.equal(I.quantileInterval([], 0.5, 0.95).bounds, 'none');
});
