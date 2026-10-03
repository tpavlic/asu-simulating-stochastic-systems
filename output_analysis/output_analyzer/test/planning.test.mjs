// Replication planning by power and by half-width, against R. Every expected value
// in reference/planning.json was produced by reference/planning.R: pt and pf with a
// noncentrality for the noncentral CDFs; power.t.test(strict = TRUE) for one- and
// two-sample t power and the fractional n it solves for; pt and qt at the Welch df
// for Welch power at unequal standard deviations, with the plan found by stepping n
// in R; brute force over n with qt for the Welch and Bonferroni half-width plans;
// and power.anova.test for ANOVA power and its fractional n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nctCdf, ncfCdf, smallestN } from '../js/stats/special.js';
import { powerOneSample, planPowerOneSample } from '../js/stats/intervals.js';
import { welchDfEqualN, planHalfWidthWelch, powerWelch, planPowerWelch,
         planHalfWidthBonferroni, powerAnova, planPowerAnova } from '../js/stats/compare.js';

const ref = JSON.parse(readFileSync(new URL('./reference/planning.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got}, want ${want} (tol ${tol})`);

test('nctCdf matches pt(t, df, ncp)', () => {
  for (const r of ref.pt) close(nctCdf(r.t, r.df, r.ncp), r.p, 1e-7, `pt(${r.t}, ${r.df}, ${r.ncp})`);
});

test('ncfCdf matches pf(f, d1, d2, ncp)', () => {
  for (const r of ref.pf) close(ncfCdf(r.f, r.d1, r.d2, r.ncp), r.p, 2e-7, `pf(${r.f}, ${r.d1}, ${r.d2}, ${r.ncp})`);
});

test('smallestN finds the threshold from guesses below, at, and above it', () => {
  for (const guess of [2, 37, 38, 39, 5000]) {
    assert.equal(smallestN(n => n >= 38, guess, 2, 1e7).n, 38, `guess ${guess}`);
  }
  assert.equal(smallestN(() => true, 50, 2, 1e7).n, 2);
  assert.equal(smallestN(() => false, 50, 2, 1000).n, null);
});

test('powerOneSample matches power.t.test(type = "one.sample", strict = TRUE)', () => {
  for (const r of ref.osPower) {
    close(powerOneSample({ n: r.n, sd: r.sd, delta: r.delta, alpha: r.alpha }), r.power, 1e-6, `n=${r.n}`);
    close(powerOneSample({ n: r.n, sd: r.sd, delta: -r.delta, alpha: r.alpha }), r.power, 1e-6, 'sign of delta');
  }
});

test('planPowerOneSample is the ceiling of R\'s n and brackets the target', () => {
  for (const r of ref.osPlan) {
    const p = planPowerOneSample({ sd: r.sd, delta: r.delta, alpha: r.alpha, power: r.power });
    assert.equal(p.n, Math.ceil(r.nR), `delta=${r.delta}`);
    assert.ok(p.powerAtN >= r.power);
    const below = powerOneSample({ n: p.n - 1, sd: r.sd, delta: r.delta, alpha: r.alpha });
    assert.ok(p.n === 2 || below < r.power, `n − 1 already reaches the target (${below})`);
    close(p.ncp, r.delta * Math.sqrt(p.n) / r.sd, 1e-12, 'ncp');
  }
});

test('planPowerOneSample refuses unusable input', () => {
  const ok = { sd: 1, delta: 1, alpha: 0.05, power: 0.8 };
  for (const bad of [{ delta: 0 }, { delta: NaN }, { sd: 0 }, { sd: Infinity }, { power: 1 },
                     { power: 0 }, { alpha: 0 }, { alpha: 1 }, { delta: 1e-5 }]) {
    const p = planPowerOneSample({ ...ok, ...bad });
    assert.equal(p.n, null, JSON.stringify(bad));
    assert.equal(typeof p.reason, 'string');
  }
});

test('powerWelch at equal sds matches power.t.test(type = "two.sample", strict = TRUE)', () => {
  for (const r of ref.tsPower) {
    assert.equal(welchDfEqualN(r.sd, r.sd, r.n), 2 * (r.n - 1));
    close(powerWelch({ n: r.n, sd1: r.sd, sd2: r.sd, delta: r.delta, alpha: r.alpha }), r.power, 1e-6, `n=${r.n}`);
  }
});

test('planPowerWelch at equal sds is the ceiling of R\'s n and brackets the target', () => {
  for (const r of ref.tsPlan) {
    const p = planPowerWelch({ sd1: r.sd, sd2: r.sd, delta: r.delta, alpha: r.alpha, power: r.power });
    assert.equal(p.n, Math.ceil(r.nR), `delta=${r.delta}`);
    assert.ok(p.powerAtN >= r.power);
    const below = powerWelch({ n: p.n - 1, sd1: r.sd, sd2: r.sd, delta: r.delta, alpha: r.alpha });
    assert.ok(p.n === 2 || below < r.power);
    assert.equal(p.df, 2 * (p.n - 1));
  }
});

test('powerWelch and planPowerWelch at unequal sds match the formula in R', () => {
  for (const r of ref.uwPower) {
    close(welchDfEqualN(r.sd1, r.sd2, r.n), r.df, 1e-12, 'Welch df');
    close(powerWelch({ n: r.n, sd1: r.sd1, sd2: r.sd2, delta: r.delta, alpha: r.alpha }), r.power, 1e-6, `n=${r.n}`);
  }
  for (const r of ref.uwPlan) {
    const p = planPowerWelch({ sd1: r.sd1, sd2: r.sd2, delta: r.delta, alpha: r.alpha, power: r.power });
    assert.equal(p.n, r.n, `delta=${r.delta}`);
    close(p.powerAtN, r.powerAtN, 1e-6, 'power at n');
  }
  assert.equal(planPowerWelch({ sd1: 1, sd2: -1, delta: 1, alpha: 0.05, power: 0.8 }).n, null);
});

test('planHalfWidthWelch matches a brute-force search in R', () => {
  for (const r of ref.hwPlan) {
    const p = planHalfWidthWelch({ sd1: r.sd1, sd2: r.sd2, level: r.level, target: r.target });
    assert.equal(p.n, r.n, `sds ${r.sd1}, ${r.sd2}`);
    close(p.hwAtN, r.hwAtN, 1e-9, 'half-width at n');
    close(p.df, r.df, 1e-9, 'df at n');
  }
  assert.equal(planHalfWidthWelch({ sd1: 1, sd2: 1, target: 0 }).n, null);
});

test('planHalfWidthBonferroni matches a brute-force search in R, both modes', () => {
  for (const r of ref.bonf) {
    const p = planHalfWidthBonferroni({ sds: r.sds, level: r.level, mode: r.mode, control: r.control, target: r.target });
    assert.equal(p.n, r.n, `${r.mode} @ ${r.target}`);
    assert.equal(p.C, r.C);
    assert.deepEqual(p.pair, r.pair);
    close(p.hwAtN, r.hwAtN, 1e-9, 'half-width at n');
  }
  // The last reference case is one where watching only the pair with the largest
  // s_i² + s_j² would stop a replication short; every comparison is checked instead.
  const last = ref.bonf[ref.bonf.length - 1];
  assert.ok(last.n > last.nMaxSumPair, 'the reference includes a case the largest-sum pair understates');
  assert.equal(planHalfWidthBonferroni({ sds: [1, 1], mode: 'control', control: 5, target: 1 }).n, null);
  assert.equal(planHalfWidthBonferroni({ sds: [1], mode: 'pairs', target: 1 }).n, null);
});

test('powerAnova matches power.anova.test', () => {
  for (const r of ref.avPower) {
    close(powerAnova({ n: r.n, k: r.k, sigma: r.sigma, delta: r.delta, alpha: r.alpha }), r.power, 1e-5, `k=${r.k}, n=${r.n}`);
  }
});

test('planPowerAnova is the ceiling of R\'s n and brackets the target', () => {
  for (const r of ref.avPlan) {
    const p = planPowerAnova({ k: r.k, sigma: r.sigma, delta: r.delta, alpha: r.alpha, power: r.power });
    assert.equal(p.n, Math.ceil(r.nR), `k=${r.k}`);
    assert.ok(p.powerAtN >= r.power);
    const below = powerAnova({ n: p.n - 1, k: r.k, sigma: r.sigma, delta: r.delta, alpha: r.alpha });
    assert.ok(p.n === 2 || below < r.power);
    close(p.lambda, p.n * r.delta ** 2 * (r.k - 1) / (r.k * r.sigma ** 2), 1e-12, 'lambda');
  }
  assert.equal(planPowerAnova({ k: 1, sigma: 1, delta: 1, alpha: 0.05, power: 0.8 }).n, null);
});
