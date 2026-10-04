// Tests for the paired (blocked) procedures: matchBlocks, the paired
// Bonferroni family, the randomized complete block ANOVA with its post-hoc
// rules, blocked power, and Friedman's test with its pairwise comparisons.
// Expected values come from test/reference/blocked.json, written by
// test/reference/blocked.R (base R: aov(y ~ g + block), TukeyHSD, paired
// t.test, friedman.test, by-hand z tests with p.adjust, and pf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchBlocks, bonferroniFamily, anovaBlocked, posthoc, powerAnova, planPowerAnova } from '../js/stats/compare.js';
import { friedman, friedmanPairs } from '../js/stats/nonparam.js';

const REF = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./reference/blocked.json', import.meta.url)), 'utf8'));

function close(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(err <= tol * scale, `${what}: got ${actual}, expected ${expected} (tol ${tol})`);
}

const G = REF.groups;

test('matchBlocks by id keeps the ids present in every design and lists the rest', () => {
  const m = matchBlocks([[1, 2, 3, 4], [2, 3, 4, 5], [4, 3, 2, 9, 2]], 'id');
  assert.deepEqual(m.keys, [2, 3, 4]);
  assert.deepEqual(m.blocks, [[1, 0, 2], [2, 1, 1], [3, 2, 0]]);
  assert.deepEqual(m.unmatched, [[0], [3], [3, 4]]);
  const p = matchBlocks([[1, 2, 3], [7, 8], [4, 5, 6, 7]], 'position');
  assert.deepEqual(p.blocks, [[0, 0, 0], [1, 1, 1]]);
  assert.deepEqual(p.unmatched, [[2], [], [2, 3]]);
  assert.throws(() => matchBlocks([[1], [1]], 'name'), RangeError);
});

test('anovaBlocked matches summary(aov(y ~ g + block))', () => {
  const a = anovaBlocked(G), r = REF.anova;
  assert.equal(a.dfb, r.dfb); assert.equal(a.dfblk, r.dfblk); assert.equal(a.dfw, r.dfw);
  close(a.ssb, r.ssb, 1e-10, 'ssb'); close(a.ssblk, r.ssblk, 1e-10, 'ssblk'); close(a.ssw, r.ssw, 1e-10, 'ssw');
  close(a.F, r.F, 1e-10, 'F'); close(a.p, r.p, 1e-10, 'p');
  close(a.Fblock, r.Fblock, 1e-10, 'F block'); close(a.pBlock, r.pBlock, 1e-10, 'p block');
  assert.throws(() => anovaBlocked([[1, 2, 3], [1, 2]]), RangeError);
});

test('posthoc Tukey on the blocked table matches TukeyHSD(aov(y ~ g + block), "g")', () => {
  const ph = posthoc(G, { rule: 'tukey', alpha: 0.05, blocked: true });
  assert.equal(ph.dfw, REF.anova.dfw);
  for (const r of REF.tukey) {
    // R reports j − i for its "j-i" rows; the module reports i − j with i < j.
    const pr = ph.pairs.find(q => q.i === r.j && q.j === r.i);
    assert.ok(pr, `pair ${r.i},${r.j}`);
    close(pr.diff, -r.diff, 1e-10, 'diff');
    close(pr.lo, -r.hi, 1e-8, 'lower'); close(pr.hi, -r.lo, 1e-8, 'upper');
  }
});

test('bonferroniFamily paired matches t.test(paired = TRUE) at 1 − α/C', () => {
  const fam = bonferroniFamily(G, { mode: 'pairs', level: 0.95, paired: true });
  assert.equal(fam.C, REF.pairedBonferroni.length);
  REF.pairedBonferroni.forEach((r, q) => {
    const c = fam.comparisons[q];
    assert.equal(c.i, r.i); assert.equal(c.j, r.j);
    close(c.diff, r.diff, 1e-12, 'diff'); close(c.se, r.se, 1e-12, 'se'); assert.equal(c.df, r.df);
    close(c.t, r.t, 1e-10, 't'); close(c.p, r.p, 1e-10, 'p');
    close(c.lo, r.lo, 1e-10, 'lower'); close(c.hi, r.hi, 1e-10, 'upper');
  });
});

test('powerAnova blocked matches pf with (k − 1)(n − 1) residual df, and the plan inverts it', () => {
  for (const r of REF.power) {
    close(powerAnova({ n: r.n, k: r.k, sigma: r.sigma, delta: r.delta, alpha: 0.05, blocked: true }), r.power, 1e-9, `power n ${r.n}`);
  }
  const pl = planPowerAnova({ k: 4, sigma: 1.5, delta: 1, alpha: 0.05, power: 0.8, blocked: true });
  assert.ok(pl.n >= 2);
  assert.ok(pl.powerAtN >= 0.8);
  assert.ok(powerAnova({ n: pl.n - 1, k: 4, sigma: 1.5, delta: 1, alpha: 0.05, blocked: true }) < 0.8);
});

test('friedman matches friedman.test, with and without ties', () => {
  const f = friedman(G), r = REF.friedman;
  close(f.chi2, r.chi2, 1e-10, 'chi2'); assert.equal(f.df, r.df); close(f.p, r.p, 1e-10, 'p');
  f.rankSums.forEach((v, i) => close(v, r.rankSums[i], 1e-12, `rank sum ${i}`));
  assert.equal(f.ties, false);
  const ft = friedman(REF.friedmanTied.groups);
  close(ft.chi2, REF.friedmanTied.chi2, 1e-10, 'tied chi2'); close(ft.p, REF.friedmanTied.p, 1e-10, 'tied p');
  assert.equal(ft.ties, true);
});

test('friedmanPairs matches the Siegel–Castellan z tests with p.adjust', () => {
  for (const adjust of ['bonferroni', 'holm']) {
    const fp = friedmanPairs(G, { alpha: 0.05, adjust });
    REF.friedman.pairs.forEach((r, q) => {
      const pr = fp.pairs[q];
      assert.equal(pr.i, r.i); assert.equal(pr.j, r.j);
      close(pr.diff, r.diff, 1e-12, 'diff'); close(pr.z, r.z, 1e-10, 'z'); close(pr.p, r.p, 1e-10, 'p');
      close(pr.pAdj, r[adjust], 1e-10, `${adjust} adjusted p`);
      assert.equal(pr.flagged, r[adjust] < 0.05);
    });
    assert.equal(fp.letters.length, 4);
  }
});
