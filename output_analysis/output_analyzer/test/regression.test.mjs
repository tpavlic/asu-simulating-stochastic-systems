// The least-squares line and its confidence band against R: every expected
// value in reference/regression.json comes from reference/regression.R, which
// fits lm(y ~ x) and calls predict(..., interval = "confidence") at three x
// values and three levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regressionLine } from '../js/stats/intervals.js';

const ref = JSON.parse(readFileSync(new URL('./reference/regression.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got}, want ${want}`);

test('regressionLine matches lm and predict', () => {
  for (const lv of [0.9, 0.95, 0.99]) {
    const g = regressionLine(ref.x, ref.y, lv);
    close(g.slope, ref.slope, 1e-12, 'slope');
    close(g.intercept, ref.intercept, 1e-12, 'intercept');
    close(g.s, ref.s, 1e-12, 'residual sd');
    assert.equal(g.df, ref.df);
    close(g.r2, ref.r2, 1e-12, 'r squared');
    const b = ref['band' + Math.round(lv * 100)];
    ref.at.forEach((xv, i) => {
      const got = g.band(xv);
      close(got.fit, b.fit[i], 1e-12, `fit at ${xv}`);
      close(got.lo, b.lo[i], 1e-9, `lower at ${xv}, level ${lv}`);
      close(got.hi, b.hi[i], 1e-9, `upper at ${xv}, level ${lv}`);
    });
  }
  assert.throws(() => regressionLine([1, 2], [1, 2]), RangeError);
});
