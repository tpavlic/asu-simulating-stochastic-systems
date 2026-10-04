// Tests for levene() in js/stats/compare.js. Expected values come from
// test/reference/levene.json, written by test/reference/levene.R (base R:
// anova(lm(abs(y - center) ~ g)) with the median and with the mean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { levene } from '../js/stats/compare.js';

const REF = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./reference/levene.json', import.meta.url)), 'utf8'));

function close(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(err <= tol * scale, `${what}: got ${actual}, expected ${expected} (tol ${tol})`);
}

for (const name of ['four', 'skew', 'two']) {
  for (const center of ['median', 'mean']) {
    test(`levene on ${name} centered on the ${center} matches R`, () => {
      const ref = REF[name][center];
      const r = levene(REF[name].groups, { center });
      assert.equal(r.center, center);
      assert.equal(r.df1, ref.df1);
      assert.equal(r.df2, ref.df2);
      r.centers.forEach((c, i) => close(c, ref.centers[i], 1e-12, `center ${i}`));
      close(r.F, ref.F, 1e-10, 'F');
      close(r.p, ref.p, 1e-10, 'p');
    });
  }
}

test('levene defaults to the median (Brown–Forsythe)', () => {
  const r = levene(REF.skew.groups);
  close(r.F, REF.skew.median.F, 1e-10, 'F');
});
