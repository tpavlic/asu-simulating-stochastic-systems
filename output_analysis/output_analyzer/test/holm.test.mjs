// Holm's step-down against R: adjustP against p.adjust, the benchmark tests
// against t.test(x, mu) and wilcox.test(x, mu), the adjust option of the
// Bonferroni families against t.test and wilcox.test pair by pair, and the
// 'holm' and 'holmWelch' post-hoc rules against pairwise.t.test and a by-hand
// blocked computation on aov's residual mean square; the pins come from
// test/reference/holm.R, whose data are chosen so that Holm declares strictly
// more than Bonferroni in every family.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adjustP, stepDownLevels, benchmarkFamily, bonferroniFamily, posthoc, posthocWelch, simultaneousMeans } from '../js/stats/compare.js';
import { benchmarkFamilyRank, bonferroniFamilyRank } from '../js/stats/nonparam.js';

const REF = JSON.parse(readFileSync(new URL('./reference/holm.json', import.meta.url), 'utf8'));
const A = 0.05, LEVEL = 0.95;
const near = (got, want, tol, label) => {
  if (want === null) { assert.ok(Number.isNaN(got), `${label}: got ${got}, want NaN`); return; }
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${label}: got ${got}, want ${want}`);
};
const each = (got, want, tol, label) => {
  assert.equal(got.length, want.length, label + ' length');
  want.forEach((w, q) => near(got[q], w, tol, `${label}[${q}]`));
};
const count = (xs, f) => xs.filter(f).length;

test('adjustP matches p.adjust, counting a missing p-value in C', () => {
  const ps = REF.adjust.p.map(v => (v === null ? NaN : v));
  each(adjustP(ps, 'holm'), REF.adjust.holm, 1e-15, 'holm');
  each(adjustP(ps, 'bonferroni'), REF.adjust.bonferroni, 1e-15, 'bonferroni');
  assert.throws(() => adjustP(ps, 'hochberg'), RangeError);
});

test('stepDownLevels gives each step its level and stops at the first that fails', () => {
  // Sorted: 0.01 (step 1, against 0.05/4), 0.03 (step 2, against 0.05/3, fails), then 0.04 and the NaN past the stop.
  const lv = stepDownLevels([0.01, 0.04, 0.03, NaN], 0.05);
  assert.deepEqual(lv.map(l => l.step), [1, 3, 2, 4]);
  assert.deepEqual(lv.map(l => l.rejected), [true, false, false, false]);
  near(lv[0].level, 1 - 0.05 / 4, 1e-15, 'step 1');
  near(lv[2].level, 1 - 0.05 / 3, 1e-15, 'step 2');
  assert.equal(lv[1].level, null);
  assert.equal(lv[3].level, null);
  // Ties keep their input order.
  assert.deepEqual(stepDownLevels([0.02, 0.02], 0.05).map(l => l.step), [1, 2]);
});

test('stepDownLevels rejects what Holm declares, and its t intervals agree with the tests', () => {
  for (const value of [REF.benchT.value, REF.benchT.value + 0.3, REF.benchT.value - 0.3]) {
    const fam = benchmarkFamily(REF.groups, { value, level: LEVEL, adjust: 'holm' });
    const lv = stepDownLevels(fam.tests.map(t => t.p), A);
    lv.forEach((l, i) => {
      assert.equal(l.rejected, fam.tests[i].declared, `design ${i} at ${value}`);
      if (l.level === null) return;
      const it = simultaneousMeans([REF.groups[i]], l.level).items[0];
      assert.equal(it.lo > value || it.hi < value, l.rejected, `design ${i}'s interval at ${value}`);
    });
    // Exactly one comparison stops the step-down unless every one is rejected.
    const failed = lv.filter(l => l.level !== null && !l.rejected).length;
    assert.equal(failed, lv.every(l => l.rejected) ? 0 : 1);
  }
});

test('benchmarkFamily matches t.test(x, mu) with Holm adjustment, and declares more than the intervals', () => {
  const { value } = REF.benchT;
  const holm = benchmarkFamily(REF.groups, { value, level: LEVEL, adjust: 'holm' });
  each(holm.tests.map(t => t.t), REF.benchT.t, 1e-12, 't');
  each(holm.tests.map(t => t.p), REF.benchT.p, 1e-10, 'p');
  each(holm.tests.map(t => t.pAdj), REF.benchT.holm, 1e-10, 'holm');
  // Under Bonferroni, a declaration is exactly an interval that excludes the benchmark.
  const bonf = benchmarkFamily(REF.groups, { value, level: LEVEL, adjust: 'bonferroni' });
  const sm = simultaneousMeans(REF.groups, LEVEL);
  bonf.tests.forEach((t, i) => assert.equal(t.declared, sm.items[i].lo > value || sm.items[i].hi < value, 'design ' + i));
  assert.ok(count(holm.tests, t => t.declared) > count(bonf.tests, t => t.declared), 'Holm declares more');
  holm.tests.forEach((t, i) => {
    if (t.declared) assert.equal(t.side, sm.items[i].mean > value ? 'above' : 'below');
    else assert.equal(t.side, null);
  });
});

test('benchmarkFamilyRank matches wilcox.test(x, mu) with Holm adjustment', () => {
  const { value } = REF.benchW;
  const holm = benchmarkFamilyRank(REF.rankGroups, { value, level: LEVEL, adjust: 'holm' });
  each(holm.tests.map(t => t.V), REF.benchW.V, 0, 'V');
  each(holm.tests.map(t => t.p), REF.benchW.p, 1e-12, 'p');
  each(holm.tests.map(t => t.pAdj), REF.benchW.holm, 1e-12, 'holm');
  const bonf = benchmarkFamilyRank(REF.rankGroups, { value, level: LEVEL, adjust: 'bonferroni' });
  each(bonf.tests.map(t => t.pAdj), REF.benchW.bonferroni, 1e-12, 'bonferroni');
  assert.ok(count(holm.tests, t => t.declared) > count(bonf.tests, t => t.declared), 'Holm declares more');
});

for (const [mode, key] of [['pairs', 'welch'], ['control', 'welchControl']]) {
  test(`bonferroniFamily (${mode}) adjusts its Welch p-values by Holm as p.adjust does`, () => {
    const holm = bonferroniFamily(REF.groups, { mode, control: 0, level: LEVEL, adjust: 'holm' });
    const bonf = bonferroniFamily(REF.groups, { mode, control: 0, level: LEVEL });
    assert.equal(holm.adjust, 'holm');
    assert.equal(bonf.adjust, 'bonferroni');
    each(holm.comparisons.map(c => c.p), REF.family[key].p, 1e-10, 'p');
    each(holm.comparisons.map(c => c.pAdj), REF.family[key].holm, 1e-10, 'holm');
    each(bonf.comparisons.map(c => c.pAdj), REF.family[key].bonferroni, 1e-10, 'bonferroni');
    // The intervals do not depend on the adjustment; under Bonferroni the
    // declarations are the intervals that exclude 0, and Holm declares those and more.
    holm.comparisons.forEach((c, q) => {
      assert.equal(c.lo, bonf.comparisons[q].lo);
      assert.equal(bonf.comparisons[q].declared, bonf.comparisons[q].flagged);
      if (c.flagged) assert.ok(c.declared, 'a flagged comparison is declared under Holm');
      assert.equal(c.declared, c.pAdj < A);
    });
    assert.ok(count(holm.comparisons, c => c.declared) > count(bonf.comparisons, c => c.declared), 'Holm declares more');
  });
}

test('bonferroniFamilyRank adjusts its rank-sum p-values by Holm as p.adjust does', () => {
  const holm = bonferroniFamilyRank(REF.rankGroups, { mode: 'pairs', level: LEVEL, adjust: 'holm' });
  const bonf = bonferroniFamilyRank(REF.rankGroups, { mode: 'pairs', level: LEVEL });
  each(holm.comparisons.map(c => c.p), REF.family.rank.p, 1e-12, 'p');
  each(holm.comparisons.map(c => c.pAdj), REF.family.rank.holm, 1e-12, 'holm');
  each(bonf.comparisons.map(c => c.pAdj), REF.family.rank.bonferroni, 1e-12, 'bonferroni');
  holm.comparisons.forEach(c => assert.equal(c.declared, c.pAdj < A));
  assert.ok(count(holm.comparisons, c => c.declared) > count(bonf.comparisons, c => c.declared), 'Holm declares more');
});

test('posthoc rule holm matches pairwise.t.test(pool.sd = TRUE, p.adjust.method = "holm")', () => {
  const ph = posthoc(REF.groups, { rule: 'holm', alpha: A });
  each(ph.pairs.map(p => p.p), REF.posthoc.pooled.p, 1e-10, 'p');
  each(ph.pairs.map(p => p.pAdj), REF.posthoc.pooled.holm, 1e-10, 'holm');
  ph.pairs.forEach(p => { assert.equal(p.flagged, p.pAdj < A); assert.ok(Number.isNaN(p.hw) && Number.isNaN(p.lo)); });
  assert.ok(Number.isNaN(ph.crit));
  const bonf = posthoc(REF.groups, { rule: 'bonferroni', alpha: A });
  assert.ok(count(ph.pairs, p => p.flagged) > count(bonf.pairs, p => p.flagged), 'Holm declares more');
  assert.equal(ph.letters.length, REF.groups.length);
});

test('posthocWelch rule holmWelch matches pairwise.t.test(pool.sd = FALSE, p.adjust.method = "holm")', () => {
  const ph = posthocWelch(REF.groups, { rule: 'holmWelch', alpha: A });
  each(ph.pairs.map(p => p.p), REF.posthoc.welch.p, 1e-10, 'p');
  each(ph.pairs.map(p => p.pAdj), REF.posthoc.welch.holm, 1e-10, 'holm');
  ph.pairs.forEach(p => assert.equal(p.flagged, p.pAdj < A));
  const bonf = posthocWelch(REF.groups, { rule: 'bonferroniWelch', alpha: A });
  assert.ok(count(ph.pairs, p => p.flagged) > count(bonf.pairs, p => p.flagged), 'Holm declares more');
});

test('posthoc rule holm on blocked designs uses the residual mean square of aov(y ~ g + block)', () => {
  const B = REF.blocked;
  const ph = posthoc(REF.pairedGroups, { rule: 'holm', alpha: A, blocked: true });
  assert.equal(ph.dfw, B.df);
  each(ph.pairs.map(p => p.t), B.t, 1e-10, 't');
  each(ph.pairs.map(p => p.p), B.p, 1e-10, 'p');
  each(ph.pairs.map(p => p.pAdj), B.holm, 1e-10, 'holm');
  const bonf = posthoc(REF.pairedGroups, { rule: 'bonferroni', alpha: A, blocked: true });
  assert.ok(count(ph.pairs, p => p.flagged) > count(bonf.pairs, p => p.flagged), 'Holm declares more');
});

test('bonferroniFamily paired adjusts the paired t p-values by Holm', () => {
  const B = REF.blocked;
  const holm = bonferroniFamily(REF.pairedGroups, { mode: 'pairs', level: LEVEL, paired: true, adjust: 'holm' });
  const bonf = bonferroniFamily(REF.pairedGroups, { mode: 'pairs', level: LEVEL, paired: true });
  each(holm.comparisons.map(c => c.p), B.pairedP, 1e-10, 'p');
  each(holm.comparisons.map(c => c.pAdj), B.pairedHolm, 1e-10, 'holm');
  each(bonf.comparisons.map(c => c.pAdj), B.pairedBonferroni, 1e-10, 'bonferroni');
  assert.ok(count(holm.comparisons, c => c.declared) > count(bonf.comparisons, c => c.declared), 'Holm declares more');
});

test('Holm on constant data: a design at the benchmark is not declared, one away from it is', () => {
  const t = benchmarkFamily([[5, 5, 5], [6, 6, 6], [4, 5, 6]], { value: 5, level: LEVEL, adjust: 'holm' });
  assert.ok(Number.isNaN(t.tests[0].p) && Number.isNaN(t.tests[0].pAdj) && !t.tests[0].declared);
  assert.equal(t.tests[1].p, 0);
  assert.equal(t.tests[1].side, 'above');
  const ph = posthoc([[1, 1, 1], [1, 1, 1], [2, 2, 2]], { rule: 'holm', alpha: A });
  assert.deepEqual(ph.pairs.map(p => p.flagged), [false, true, true]);
});
