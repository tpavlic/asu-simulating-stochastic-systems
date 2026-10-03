// Tests for js/stats/compare.js. Expected values come from
// test/reference/compare.json, written by test/reference/compare.R (base R:
// t.test, aov, TukeyHSD, qt, and a Monte Carlo of Dunnett's statistic), except
// the letter display, which is checked against a brute-force enumeration here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  welch, matchPairs, pairedT, simultaneousMeans, bonferroniFamily, anova, posthoc, letterGroups
} from '../js/stats/compare.js';

const REF = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./reference/compare.json', import.meta.url)), 'utf8'));

function close(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(err <= tol * scale, `${what}: got ${actual}, expected ${expected} (tol ${tol})`);
}

const FOUR = REF.four.groups;
const PAIRS = REF.four.pairs;   // [i, j] with i < j, 0-based, in R's combn order

test('welch matches t.test(x, y) at 0.90, 0.95, and 0.99', () => {
  const { x, y } = REF.two;
  for (const [level, r] of [[0.90, REF.two.welch90], [0.95, REF.two.welch95], [0.99, REF.two.welch99]]) {
    const w = welch(x, y, level);
    close(w.t, r.statistic, 1e-10, `t at ${level}`);
    close(w.df, r.df, 1e-10, `df at ${level}`);
    close(w.p, r.p, 1e-9, `p at ${level}`);
    close(w.lo, r.lo, 1e-9, `lo at ${level}`);
    close(w.hi, r.hi, 1e-9, `hi at ${level}`);
    close(w.mean1, r.estimate[0], 1e-12, 'mean1');
    close(w.mean2, r.estimate[1], 1e-12, 'mean2');
    close(w.diff, w.mean1 - w.mean2, 1e-14, 'diff = mean1 − mean2');
    close(w.hw, (w.hi - w.lo) / 2, 1e-12, 'hw');
    assert.equal(w.n1, x.length);
    assert.equal(w.n2, y.length);
  }
});

test('pairedT matches t.test(x, y, paired = TRUE) and cor(x, y)', () => {
  const { x, y, r, sdD } = REF.paired;
  for (const [level, ref] of [[0.90, REF.paired.t90], [0.95, REF.paired.t95]]) {
    const p = pairedT(x, y, level);
    close(p.t, ref.statistic, 1e-10, 't');
    assert.equal(p.df, ref.df);
    close(p.p, ref.p, 1e-9, 'p');
    close(p.lo, ref.lo, 1e-9, 'lo');
    close(p.hi, ref.hi, 1e-9, 'hi');
    close(p.meanD, ref.estimate, 1e-12, 'mean difference');
    close(p.sdD, sdD, 1e-12, 'sd of differences');
    close(p.r, r, 1e-12, 'r');
    assert.equal(p.diffs.length, x.length);
    close(p.diffs[0], x[0] - y[0], 1e-15, 'd = x − y');
  }
  assert.throws(() => pairedT([1, 2, 3], [1, 2], 0.95));
});

test('matchPairs by id and by position', () => {
  const byId = matchPairs([3, 1, 2, 1, 9], ['1', '2', '3', '4', '2'], 'id');
  assert.deepEqual(byId.pairs, [[0, 2], [1, 0], [2, 1]]);
  assert.deepEqual(byId.unmatchedA, [3, 4]);   // a repeated 1, and an id B lacks
  assert.deepEqual(byId.unmatchedB, [3, 4]);   // an id A lacks, and a repeated 2
  const byPos = matchPairs(['a', 'b', 'c'], ['x', 'y', 'z', 'w', 'v'], 'position');
  assert.deepEqual(byPos.pairs, [[0, 0], [1, 1], [2, 2]]);
  assert.deepEqual(byPos.unmatchedA, []);
  assert.deepEqual(byPos.unmatchedB, [3, 4]);
  const shortB = matchPairs([1, 2, 3], [1], 'position');
  assert.deepEqual(shortB.unmatchedA, [1, 2]);
});

test('simultaneousMeans gives each group its t interval at 1 − α/k', () => {
  const s = simultaneousMeans(FOUR, 0.95);
  assert.equal(s.k, 4);
  close(s.perLevel, 1 - 0.05 / 4, 1e-15, 'perLevel');
  s.items.forEach((it, i) => {
    const r = REF.four.simul[i];
    close(it.mean, r.estimate, 1e-12, `mean ${i}`);
    close(it.lo, r.lo, 1e-9, `lo ${i}`);
    close(it.hi, r.hi, 1e-9, `hi ${i}`);
    assert.equal(it.df, r.df);
  });
});

test('bonferroniFamily: Welch intervals at 1 − α/C, all pairs and versus a control', () => {
  const fp = bonferroniFamily(FOUR, { mode: 'pairs', level: 0.95 });
  assert.equal(fp.C, 6);
  close(fp.perLevel, 1 - 0.05 / 6, 1e-15, 'perLevel');
  fp.comparisons.forEach((c, r) => {
    const ref = REF.four.famPairs[r];
    assert.deepEqual([c.i, c.j], PAIRS[r]);
    close(c.t, ref.statistic, 1e-10, `t ${r}`);
    close(c.df, ref.df, 1e-10, `df ${r}`);
    close(c.lo, ref.lo, 1e-9, `lo ${r}`);
    close(c.hi, ref.hi, 1e-9, `hi ${r}`);
    close(c.p, ref.p, 1e-9, `p ${r}`);
    close(c.pAdj, Math.min(1, 6 * ref.p), 1e-9, `pAdj ${r}`);
    assert.equal(c.flagged, ref.lo > 0 || ref.hi < 0);
  });
  const fc = bonferroniFamily(FOUR, { mode: 'control', control: 0, level: 0.95 });
  assert.equal(fc.C, 3);
  fc.comparisons.forEach((c, r) => {
    const ref = REF.four.famControl[r];
    assert.equal(c.i, r + 1);
    assert.equal(c.j, 0);
    close(c.diff, ref.estimate[0] - ref.estimate[1], 1e-12, 'diff = mean_i − mean_control');
    close(c.lo, ref.lo, 1e-9, `lo ${r}`);
    close(c.hi, ref.hi, 1e-9, `hi ${r}`);
  });
});

test('anova matches summary(aov(y ~ g))', () => {
  const a = anova(FOUR);
  const r = REF.four.anova;
  assert.equal(a.k, 4);
  assert.equal(a.N, 30);
  assert.deepEqual(a.n, REF.four.sizes);
  assert.equal(a.dfb, r.dfb);
  assert.equal(a.dfw, r.dfw);
  close(a.ssb, r.ssb, 1e-10, 'ssb');
  close(a.ssw, r.ssw, 1e-10, 'ssw');
  close(a.sst, r.ssb + r.ssw, 1e-10, 'sst');
  close(a.msb, r.msb, 1e-10, 'msb');
  close(a.msw, r.msw, 1e-10, 'msw');
  close(a.F, r.F, 1e-10, 'F');
  close(a.p, r.p, 1e-9, 'p');
  a.means.forEach((m, i) => close(m, REF.four.means[i], 1e-12, `mean ${i}`));
});

test('posthoc Tukey–Kramer matches TukeyHSD at 0.95 and 0.90', () => {
  for (const [alpha, ref] of [[0.05, REF.four.tukey95], [0.10, REF.four.tukey90]]) {
    const ph = posthoc(FOUR, { rule: 'tukey', alpha });
    assert.equal(ph.protected, null);
    ph.pairs.forEach((p, r) => {
      // R's row "j-i" reports mean_j − mean_i with bounds [lwr, upr]; for
      // diff = mean_i − mean_j the interval is [−upr, −lwr].
      assert.equal(ref.rows[r], `${p.j + 1}-${p.i + 1}`);
      close(p.diff, -ref.diff[r], 1e-10, `diff ${r}`);
      // R's qtukey converges only to about 1e-4, which bounds the agreement.
      close(p.lo, -ref.upr[r], 2e-4, `lo ${r} at alpha ${alpha}`);
      close(p.hi, -ref.lwr[r], 2e-4, `hi ${r} at alpha ${alpha}`);
      assert.equal(p.flagged, ref.lwr[r] > 0 || ref.upr[r] < 0, `flag ${r}`);
    });
    assert.equal(ph.letters.length, 4);
  }
});

test('posthoc LSD and Bonferroni match the by-hand R intervals on the pooled variance', () => {
  for (const [rule, alpha, ref] of [['lsd', 0.05, REF.four.lsd05], ['bonferroni', 0.05, REF.four.bonf05],
                                     ['bonferroni', 0.10, REF.four.bonf10]]) {
    const ph = posthoc(FOUR, { rule, alpha });
    close(ph.crit, ref.crit, 1e-9, `${rule} crit`);
    ph.pairs.forEach((p, r) => {
      assert.deepEqual([p.i, p.j], PAIRS[r]);
      close(p.diff, ref.diff[r], 1e-10, `${rule} diff ${r}`);
      close(p.hw, ref.hw[r], 1e-9, `${rule} hw ${r}`);
      close(p.lo, ref.lo[r], 1e-9, `${rule} lo ${r}`);
      close(p.hi, ref.hi[r], 1e-9, `${rule} hi ${r}`);
    });
  }
  // The F test rejects on these data (p from R), and so LSD is protected.
  assert.ok(REF.four.anova.p < 0.05);
  const lsd = posthoc(FOUR, { rule: 'lsd', alpha: 0.05 });
  assert.equal(lsd.protected, true);
  lsd.pairs.forEach(p => assert.equal(p.flagged, p.lo > 0 || p.hi < 0));
  assert.ok(lsd.pairs.some(p => p.flagged));
});

test('posthoc LSD declares nothing when the F test does not reject', () => {
  // R's F test on the equal-means sample does not reject at 0.05.
  assert.ok(REF.nullFour.p > 0.05);
  const ph = posthoc(REF.nullFour.groups, { rule: 'lsd', alpha: 0.05 });
  close(ph.anova.p, REF.nullFour.p, 1e-9, 'null F-test p');
  assert.equal(ph.protected, false);
  assert.ok(ph.pairs.every(p => p.flagged === false));
  assert.deepEqual(ph.letters, ['a', 'a', 'a', 'a']);
  assert.match(ph.note, /did not reject/);
  assert.match(ph.note, /no pair is declared different/);
});

test('posthoc Dunnett: critical value within 3 Monte Carlo standard errors of R', () => {
  // The reference is the 0.95 quantile of max |T_i| over 500,000 draws in R,
  // with group 1 (index 0) as the control; its standard error comes from the
  // spread of five independent batch quantiles. The tolerance is three of
  // those standard errors.
  const d = REF.four.dunnett;
  const ph = posthoc(FOUR, { rule: 'dunnett', alpha: 0.05, control: 0 });
  assert.ok(Math.abs(ph.crit - d.quantile) <= 3 * d.se,
    `crit ${ph.crit} vs Monte Carlo ${d.quantile} ± ${d.se}`);
  // R also solves Dunnett's integral by nested integrate() and uniroot(), an
  // independent quadrature of the same exact formula, which pins it closely.
  close(ph.crit, d.integrated, 1e-6, 'crit against the integrated value');
  assert.equal(ph.letters, null);
  assert.equal(ph.pairs.length, 3);
  const n = REF.four.sizes, msw = REF.four.anova.msw;
  ph.pairs.forEach((p, r) => {
    assert.equal(p.i, r + 1);
    assert.equal(p.j, 0);
    close(p.diff, REF.four.means[p.i] - REF.four.means[0], 1e-12, 'diff');
    close(p.hw, ph.crit * Math.sqrt(msw * (1 / n[p.i] + 1 / n[0])), 1e-12, 'hw');
  });
  // Another control shifts the comparisons accordingly.
  const ph2 = posthoc(FOUR, { rule: 'dunnett', alpha: 0.05, control: 2 });
  assert.deepEqual(ph2.pairs.map(p => [p.i, p.j]), [[0, 2], [1, 2], [3, 2]]);
});

test('posthoc letters agree with the flagged pairs for every all-pairs rule', () => {
  for (const rule of ['tukey', 'lsd', 'bonferroni']) {
    const ph = posthoc(FOUR, { rule, alpha: 0.05 });
    for (const p of ph.pairs) {
      const share = [...ph.letters[p.i]].some(c => ph.letters[p.j].includes(c));
      assert.equal(share, !p.flagged, `${rule} pair ${p.i},${p.j}`);
    }
  }
});

// mulberry32: a small seeded generator for the random flag patterns.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Brute force: every subset of designs that holds no flagged pair, keeping
// only the maximal ones, each as a sorted, comma-joined key.
function maximalCliques(k, flagged) {
  const bad = flagged.map(([i, j]) => (1 << i) | (1 << j));
  const ok = [];
  for (let m = 1; m < (1 << k); m++) if (bad.every(b => (m & b) !== b)) ok.push(m);
  const maximal = ok.filter(m => !ok.some(o => o !== m && (o & m) === m));
  return new Set(maximal.map(m => [...Array(k).keys()].filter(i => m & (1 << i)).join(',')));
}

test('letterGroups equals the brute-force maximal non-different sets (200 seeded cases, k ≤ 6)', () => {
  const rnd = mulberry32(20261002);
  for (let c = 0; c < 200; c++) {
    const k = 2 + Math.floor(rnd() * 5);
    const prob = rnd();
    const flagged = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      if (rnd() < prob) flagged.push(rnd() < 0.5 ? [i, j] : [j, i]);
    }
    const letters = letterGroups(k, flagged);
    assert.equal(letters.length, k);
    const labels = [...new Set(letters.join(''))];
    const got = new Set(labels.map(L => letters.map((s, i) => (s.includes(L) ? i : -1))
      .filter(i => i >= 0).join(',')));
    assert.equal(got.size, labels.length, `case ${c}: duplicate groups`);
    assert.deepEqual(got, maximalCliques(k, flagged), `case ${c}: k=${k} flagged=${JSON.stringify(flagged)}`);
    // Letters are assigned a, b, c, … in order of each group's smallest member.
    const sorted = [...labels].sort();
    assert.deepEqual(sorted, labels.slice().sort());
    const firstMember = sorted.map(L => letters.findIndex(s => s.includes(L)));
    for (let g = 1; g < firstMember.length; g++) assert.ok(firstMember[g] >= firstMember[g - 1]);
    assert.equal(sorted[0], 'a');
    assert.equal(sorted.length, labels.length);
    sorted.forEach((L, g) => assert.equal(L, String.fromCharCode(97 + g)));
  }
});

test('letterGroups on small hand cases', () => {
  assert.deepEqual(letterGroups(3, []), ['a', 'a', 'a']);
  assert.deepEqual(letterGroups(3, [[0, 2]]), ['a', 'ab', 'b']);
  assert.deepEqual(letterGroups(3, [[0, 1], [0, 2], [1, 2]]), ['a', 'b', 'c']);
});
