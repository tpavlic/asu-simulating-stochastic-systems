// The Shapiro–Wilk test and the normal Q–Q pieces against R: every expected
// value in reference/normality.json comes from reference/normality.R, which
// runs shapiro.test, ppoints, quantile, and qqline's quartile line on
// fourteen samples from n = 3 to n = 1000, normal and not, with and without
// ties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapiroWilk, shapiroCoefficients, normalQQ, plottingPositions } from '../js/stats/normality.js';

const ref = JSON.parse(readFileSync(new URL('./reference/normality.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got}, want ${want}`);

test('shapiroWilk matches shapiro.test', () => {
  for (const [name, r] of Object.entries(ref)) {
    const g = shapiroWilk(r.x);
    assert.equal(g.n, r.x.length);
    close(g.W, r.W, 1e-6, `${name} W`);
    // p is a smooth function of W, and so a tiny p carries only relative
    // accuracy; the rest agree closely.
    if (r.p < 1e-6) close(Math.log(g.p), Math.log(r.p), 1e-3, `${name} log p`);
    else close(g.p, r.p, 1e-6, `${name} p`);
  }
});

test('shapiroWilk refuses what shapiro.test refuses', () => {
  assert.throws(() => shapiroWilk([1, 2]), RangeError);
  assert.throws(() => shapiroWilk([3, 3, 3, 3]), RangeError);
  assert.throws(() => shapiroWilk(new Float64Array(5001).map((_, i) => i)), RangeError);
  assert.equal(shapiroCoefficients(3)[0], Math.SQRT1_2);
  for (const n of [4, 5, 6, 11, 12, 100]) {
    const a = shapiroCoefficients(n);
    assert.equal(a.length, Math.floor(n / 2));
    for (let i = 1; i < a.length; i++) assert.ok(a[i] > 0 && a[i] < a[i - 1], `coefficients of n=${n} fall from the extreme inward`);
  }
});

test('W is 1 on a sample at the normal quantiles and small on a lopsided one', () => {
  const n = 25, z = Array.from(plottingPositions(n), p => -Math.sqrt(2) * ierf(1 - 2 * p));
  const g = shapiroWilk(z);
  assert.ok(g.W > 0.995 && g.p > 0.5, `nearly normal: W ${g.W}, p ${g.p}`);
  const skew = Array.from({ length: 40 }, (_, i) => Math.exp(i / 8));
  const h = shapiroWilk(skew);
  assert.ok(h.W < 0.8 && h.p < 1e-4, `lopsided: W ${h.W}, p ${h.p}`);
});

test('normalQQ matches ppoints, qnorm, and qqline', () => {
  for (const [name, r] of Object.entries(ref)) {
    const g = normalQQ(r.x);
    const pp = plottingPositions(r.x.length);
    r.ppoints.forEach((p, i) => close(pp[i], p, 1e-12, `${name} ppoints[${i}]`));
    r.theoretical.forEach((t, i) => close(g.theoretical[i], t, 1e-9, `${name} theoretical[${i}]`));
    r.sample.forEach((v, i) => close(g.sample[i], v, 0, `${name} sample[${i}]`));
    close(g.slope, r.slope, 1e-9, `${name} slope`);
    close(g.intercept, r.intercept, 1e-9, `${name} intercept`);
  }
  assert.throws(() => normalQQ([1]), RangeError);
});

// A crude inverse error function, enough to place 25 points on a normal shape.
function ierf(y) {
  let x = 0;
  for (let k = 0; k < 60; k++) {
    const e = erf(x) - y;
    x -= e / (2 / Math.sqrt(Math.PI) * Math.exp(-x * x));
  }
  return x;
}
function erf(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - r : r - 1;
}
