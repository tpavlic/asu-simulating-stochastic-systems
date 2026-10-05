// Welch's one-way analysis of variance against R's oneway.test(var.equal =
// FALSE), and the Games–Howell and Bonferroni-on-Welch-pairs comparisons
// against a by-hand base-R computation (ptukey, qtukey, t.test); the pins
// come from test/reference/welchanova.R.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { welchAnova, posthocWelch, letterGroups } from '../js/stats/compare.js';

const REF = JSON.parse(readFileSync(new URL('./reference/welchanova.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got}, want ${want} (tol ${tol})`);

test('welchAnova matches oneway.test(var.equal = FALSE)', () => {
  const a = welchAnova(REF.groups);
  close(a.F, REF.welch.F, 1e-9, 'F');
  assert.equal(a.df1, REF.welch.df1);
  close(a.df2, REF.welch.df2, 1e-8, 'df2');
  close(a.p, REF.welch.p, 1e-9, 'p');
  assert.deepEqual(a.n, REF.sizes);
});

test('welchAnova refuses a group with one value or no spread', () => {
  assert.throws(() => welchAnova([[1, 2, 3], [4]]), RangeError);
  assert.throws(() => welchAnova([[1, 2, 3], [2, 2, 2]]), RangeError);
});

for (const [key, alpha] of [['gh05', 0.05], ['gh10', 0.10]]) {
  test(`posthocWelch Games–Howell at α = ${alpha} matches R by hand`, () => {
    const ph = posthocWelch(REF.groups, { rule: 'gameshowell', alpha });
    assert.equal(ph.pairs.length, REF[key].length);
    REF[key].forEach((r, t) => {
      const p = ph.pairs[t];
      assert.equal(p.i, r.i); assert.equal(p.j, r.j);
      close(p.diff, r.diff, 1e-12, 'diff');
      close(p.se, r.se, 1e-12, 'se');
      close(p.df, r.df, 1e-9, 'df');
      close(p.crit, r.crit, 2e-6, 'q');
      close(p.hw, r.hw, 1e-5, 'hw');
      close(p.lo, r.lo, 1e-5, 'lo');
      close(p.hi, r.hi, 1e-5, 'hi');
      close(p.p, r.p, 1e-6, 'p');
      assert.equal(p.flagged, r.lo > 0 || r.hi < 0);
    });
    assert.deepEqual(ph.letters, letterGroups(4, ph.pairs.filter(p => p.flagged).map(p => [p.i, p.j])));
    assert.equal(ph.anova.F, welchAnova(REF.groups).F);
  });
}

for (const [key, alpha] of [['bw05', 0.05], ['bw01', 0.01]]) {
  test(`posthocWelch Bonferroni on Welch pairs at α = ${alpha} matches t.test at 1 − α/C`, () => {
    const ph = posthocWelch(REF.groups, { rule: 'bonferroniWelch', alpha });
    REF[key].forEach((r, t) => {
      const p = ph.pairs[t];
      close(p.diff, r.diff, 1e-12, 'diff');
      close(p.df, r.df, 1e-9, 'df');
      close(p.crit, r.crit, 1e-9, 't');
      close(p.lo, r.lo, 1e-9, 'lo');
      close(p.hi, r.hi, 1e-9, 'hi');
      close(p.p, r.p, 1e-9, 'adjusted p');
    });
  });
}

test('posthocWelch rejects an unknown rule', () => {
  assert.throws(() => posthocWelch(REF.groups, { rule: 'tukey', alpha: 0.05 }), RangeError);
});
