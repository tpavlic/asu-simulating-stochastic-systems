// Data with no spread: repeated values, whose variance is exactly 0 however
// they sum, and analyses of variance with no spread within the groups, whose F
// is infinite or undefined rather than rounding noise. Expected values come
// from test/reference/flat.json, written by test/reference/flat.R, which also
// records the noise R's own aov() and acf() report there (aovF, acfR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { variance, sd, acf } from '../js/stats/descriptive.js';
import { welch, pooledT, pairedT, simultaneousMeans, anova, anovaBlocked, levene, posthoc, constantDifferences,
  planHalfWidthWelch, planHalfWidthBonferroni } from '../js/stats/compare.js';
import { tInterval, fRatio } from '../js/stats/intervals.js';
import { subsetSelection } from '../js/stats/select.js';
import { lag1, lag1Test, batchMeans } from '../js/stats/steadystate.js';

// JSON has no infinite or undefined numbers; the reference writes them as strings.
const decode = v => (v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v === 'NaN' ? NaN : v);
const REF = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./reference/flat.json', import.meta.url)), 'utf8'),
  (k, v) => decode(v));

function same(actual, expected, what, tol = 1e-12) {
  if (Number.isNaN(expected) || !Number.isFinite(expected)) {
    assert.ok(Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected)), `${what}: got ${actual}, expected ${expected}`);
    return;
  }
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${what}: got ${actual}, expected ${expected}`);
}
const rep = (v, n) => Array(n).fill(v);

test('repeated values have variance exactly 0, as R\'s var gives', () => {
  for (const { value, n, var: v } of REF.variance) {
    assert.equal(v, 0);
    assert.equal(variance(rep(value, n)), 0, `${value} x ${n}`);
    assert.equal(sd(Float64Array.from(rep(value, n))), 0);
  }
  assert.ok(Number.isNaN(variance([0.1])), 'one value has no variance');
  assert.ok(Number.isNaN(variance([NaN, NaN])), 'NaN values are not constant');
});

test('Welch and pooled t on two constants: the difference exactly, with infinite t', () => {
  for (const [name, fn] of [['welch', welch], ['pooled', pooledT]]) {
    const ref = REF[name], r = fn(ref.a, ref.b, 0.95);
    assert.equal(r.sd1, 0); assert.equal(r.sd2, 0); assert.equal(r.se, 0);
    same(r.diff, ref.diff, name + ' diff');
    same(r.t, ref.t, name + ' t'); same(r.p, ref.p, name + ' p'); same(r.df, ref.df, name + ' df');
    assert.equal(r.hw, 0); same(r.lo, ref.lo, name + ' lo'); same(r.hi, ref.hi, name + ' hi');
  }
});

test('the paired t on constant differences', () => {
  const ref = REF.paired, r = pairedT(ref.a, ref.b, 0.95);
  assert.equal(r.sdD, ref.sdD); same(r.meanD, ref.meanD, 'meanD');
  same(r.t, ref.t, 't'); same(r.p, ref.p, 'p'); assert.equal(r.hw, 0);
});

test('paired differences equal up to the subtraction\'s rounding are constant', () => {
  const ref = REF.pairedRounding;
  assert.equal(ref.constant, true);
  assert.ok(ref.spread > 0, 'the differences are not bit-equal');
  assert.equal(constantDifferences(Float64Array.from(ref.d), ref.a, ref.b), true);
  const r = pairedT(ref.a, ref.b, 0.95);
  assert.equal(r.sdD, 0); assert.equal(r.hw, 0);
  same(r.meanD, ref.meanD, 'meanD'); same(r.t, ref.t, 't'); same(r.p, ref.p, 'p');
  // Real differences, however small against the values, are not.
  assert.equal(constantDifferences([1e-9, 2e-9], [1, 1], [1 - 1e-9, 1 - 2e-9]), false);
});

test('the t interval and the simultaneous means on repeated values have no width', () => {
  const ti = tInterval(rep(0.1, 7));
  assert.equal(ti.sd, 0); assert.equal(ti.hw, 0); assert.equal(ti.lo, ti.hi);
  const sm = simultaneousMeans([rep(0.1, 3), rep(0.7, 3)], 0.95);
  assert.deepEqual(sm.items.map(x => [x.sd, x.hw]), [[0, 0], [0, 0]]);
});

test('the F ratio of variances on repeated values, as var.test', () => {
  const both = fRatio(REF.fratioBoth.a, REF.fratioBoth.b, 0.95);
  same(both.F, REF.fratioBoth.F, 'F'); same(both.p, REF.fratioBoth.p, 'p');
  const one = fRatio(REF.fratioOne.a, REF.fratioOne.b, 0.95);
  for (const k of ['F', 'p', 'lo', 'hi']) same(one[k], REF.fratioOne[k], k);
});

test('the plans for the differences have no answer on repeated values', () => {
  const w = welch(rep(0.1, 3), [3.1, 2.9, 4.2, 3.6, 3.3], 0.95);
  assert.equal(w.sd1, 0);
  assert.equal(planHalfWidthWelch({ sd1: w.sd1, sd2: w.sd2, target: 0.5 }).n, null);
  const sm = simultaneousMeans([rep(0.1, 3), rep(0.3, 3), rep(0.7, 3)], 0.95);
  assert.equal(planHalfWidthBonferroni({ sds: sm.items.map(x => x.sd), mode: 'pairs', target: 0.5 }).n, null);
});

test('one-way ANOVA with no spread within the designs: F infinite, or undefined when the means agree', () => {
  // Near a million the sums of squares lose about ten digits to cancellation in
  // both languages, and so they are compared to 1e-8.
  for (const name of ['anovaConstants', 'anovaEqual', 'anovaConstants1e6']) {
    const ref = REF[name], r = anova(ref.groups);
    assert.ok(Number.isFinite(ref.aovF), name + ': R\'s aov reports a number here');
    assert.equal(r.ssw, 0); assert.equal(r.msw, 0);
    same(r.ssb, ref.ssb, name + ' ssb', 1e-8); same(r.F, ref.F, name + ' F'); same(r.p, ref.p, name + ' p');
    assert.equal(r.dfw, ref.dfw);
  }
  // Half a unit of spread near a million is real spread.
  const real = anova(REF.anovaReal1e6.groups);
  same(real.F, REF.anovaReal1e6.F, 'real F', 1e-8); same(real.p, REF.anovaReal1e6.p, 'real p', 1e-8);
  // Barely above the bound, F is finite and huge; its last digits rest on how each language
  // rounds the means, and so it is compared to 1e-6.
  const nf = anova(REF.anovaNearFlat.groups);
  assert.ok(nf.ssw > 0 && Number.isFinite(nf.F));
  same(nf.F, REF.anovaNearFlat.F, 'near-flat F', 1e-6); same(nf.F, REF.anovaNearFlat.aovF, 'near-flat F against aov', 1e-6);
  // The post-hoc rules then have no width.
  const ph = posthoc(REF.anovaConstants.groups, { rule: 'tukey', alpha: 0.05 });
  assert.ok(ph.pairs.every(p => p.hw === 0 && p.flagged));
});

test('Levene with no spread within any design: F infinite, or undefined when the distances agree', () => {
  for (const name of ['leveneTwo', 'leveneTwo1e6', 'leveneTwo1e9', 'leveneEqual', 'leveneConstants']) {
    const ref = REF[name], r = levene(ref.groups);
    same(r.F, ref.F, name + ' F'); same(r.p, ref.p, name + ' p');
    assert.equal(r.df1, ref.dfb); assert.equal(r.df2, ref.dfw);
  }
  // The scale is the uncentered sum of squares: on equal spreads the within and the
  // centered total sums of squares are both rounding error, of the same size.
  assert.ok(Math.abs(REF.leveneEqual.aovF) > 0 && Math.abs(REF.leveneEqual.aovF) < 1);
});

test('the blocked analysis with nothing left after the designs and blocks', () => {
  for (const name of ['blockedAdditive', 'blockedAdditive1e6', 'blockedConstants']) {
    const ref = REF[name], r = anovaBlocked(ref.groups);
    assert.equal(r.ssw, 0);
    same(r.ssb, ref.ssb, name + ' ssb', 1e-8); same(r.ssblk, ref.ssblk, name + ' ssblk', 1e-8);
    for (const k of ['F', 'p', 'Fblock', 'pBlock']) same(r[k], ref[k], name + ' ' + k);
  }
});

test('a constant series has no lag-one autocorrelation, and its batch means no width', () => {
  const x = REF.acfConstant.x;
  same(lag1(x), REF.acfConstant.r1, 'lag1');
  assert.ok(Number.isFinite(REF.acfConstant.acfR), 'R\'s acf reports a number here');
  assert.ok(Number.isNaN(lag1Test(x).C));
  assert.ok(Array.from(acf(x, 2)).every(Number.isNaN));
  const bm = batchMeans({ t: null, v: rep(0.1, 40) }, { kind: 'tally', truncate: null, count: 8, level: 0.95 });
  assert.ok(bm.ok);
  assert.equal(bm.sd, 0); assert.equal(bm.hw, 0);
  assert.ok(Number.isNaN(bm.lag1) && Number.isNaN(bm.lag1Test.C));
});

test('the screen takes a repeated design\'s variance as exactly 0', () => {
  const s = subsetSelection([rep(0.1, 3), [2.1, 3.4, 2.8], [3.9, 4.0, 3.95]], { alpha: 0.05, delta: 0.4, dir: 'max' });
  assert.ok(s.ok);
  assert.equal(s.s2[0], 0);
});
