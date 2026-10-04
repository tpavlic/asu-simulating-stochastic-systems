// Tests for js/stats/nonparam.js. Expected values come from
// test/reference/nonparam.json, written by test/reference/nonparam.R (base R:
// wilcox.test with conf.int, exact where R is exact and with exact = FALSE on
// the tied samples, kruskal.test, and Dunn's z tests with p.adjust).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { midranks, psignrank, qsignrank, pwilcox, qwilcox, signedRank, rankSum, kruskalWallis, dunn } from '../js/stats/nonparam.js';

const REF = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./reference/nonparam.json', import.meta.url)), 'utf8'));

function close(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(err <= tol * scale, `${what}: got ${actual}, expected ${expected} (tol ${tol})`);
}

test('midranks average tied ranks and report the tie sizes', () => {
  const r = midranks([3, 1, 3, 2, 3, 1]);
  assert.deepEqual(Array.from(r.ranks), [5, 1.5, 5, 3, 5, 1.5]);
  assert.deepEqual(r.ties, [2, 3]);
});

test('the exact signed-rank distribution sums to one and is symmetric', () => {
  for (const n of [1, 5, 12, 30]) {
    const max = n * (n + 1) / 2;
    close(psignrank(max, n), 1, 1e-12, `n ${n}`);
    for (let v = 0; v < 5; v++) close(psignrank(v, n), 1 - psignrank(max - v - 1, n), 1e-12, `symmetry ${n} ${v}`);
    assert.equal(qsignrank(psignrank(3, n), n), Math.min(3, max));
  }
});

test('the exact rank-sum distribution sums to one and is symmetric', () => {
  for (const [m, n] of [[1, 1], [3, 4], [10, 12], [20, 25]]) {
    const max = m * n;
    close(pwilcox(max, m, n), 1, 1e-12, `${m},${n}`);
    for (let w = 0; w < 4; w++) close(pwilcox(w, m, n), 1 - pwilcox(max - w - 1, m, n), 1e-12, `symmetry ${m},${n} ${w}`);
    assert.equal(qwilcox(pwilcox(2, m, n), m, n), Math.min(2, max));
  }
});

for (const name of Object.keys(REF.signed)) {
  test(`signedRank on ${name} matches wilcox.test(x, mu, conf.int = TRUE)`, () => {
    const ref = REF.signed[name];
    const r = signedRank(ref.x, { mu: ref.mu, level: ref.level });
    assert.equal(r.exact, ref.exact, 'exact path');
    close(r.V, ref.V, 1e-12, 'V');
    close(r.p, ref.p, 1e-9, 'p');
    // On the approximate path R finds its estimate and its bounds by
    // uniroot; the Hodges–Lehmann median and the inverted test land within
    // that tolerance.
    const tol = ref.exact ? 1e-12 : 2e-4;
    close(r.estimate, ref.estimate, tol, 'estimate');
    close(r.lo, ref.lo, tol, 'lower');
    close(r.hi, ref.hi, tol, 'upper');
    close(r.achieved, ref.achieved, 1e-12, 'achieved level');
  });
}

for (const name of Object.keys(REF.ranksum)) {
  test(`rankSum on ${name} matches wilcox.test(x, y, conf.int = TRUE)`, () => {
    const ref = REF.ranksum[name];
    const r = rankSum(ref.x, ref.y, { level: ref.level });
    assert.equal(r.exact, ref.exact, 'exact path');
    close(r.W, ref.W, 1e-12, 'W');
    close(r.p, ref.p, 1e-9, 'p');
    const tol = ref.exact ? 1e-12 : 2e-4;
    close(r.estimate, ref.estimate, tol, 'estimate');
    close(r.lo, ref.lo, tol, 'lower');
    close(r.hi, ref.hi, tol, 'upper');
    close(r.achieved, ref.achieved, 1e-12, 'achieved level');
  });
}

for (const name of Object.keys(REF.kw)) {
  test(`kruskalWallis and dunn on ${name} match kruskal.test and the by-hand z tests`, () => {
    const ref = REF.kw[name];
    const k = kruskalWallis(ref.groups);
    close(k.H, ref.H, 1e-10, 'H');
    assert.equal(k.df, ref.df);
    close(k.p, ref.p, 1e-10, 'p');
    for (const adjust of ['bonferroni', 'holm']) {
      const d = dunn(ref.groups, { alpha: 0.05, adjust });
      assert.equal(d.pairs.length, ref[adjust].length);
      d.pairs.forEach((pr, q) => {
        const e = ref[adjust][q];
        assert.equal(pr.i, e.i); assert.equal(pr.j, e.j);
        close(pr.z, e.z, 1e-10, `${adjust} z ${q}`);
        close(pr.p, e.p, 1e-10, `${adjust} p ${q}`);
        close(pr.pAdj, e.pAdj, 1e-10, `${adjust} adjusted p ${q}`);
        assert.equal(pr.flagged, e.pAdj < 0.05);
      });
      assert.equal(d.letters.length, ref.groups.length);
    }
  });
}

test('signedRank drops zeros and reports them, and uses the approximation under ties', () => {
  const r = signedRank([0, 1, -2, 3, 0, 4]);
  assert.equal(r.zeros, 2);
  assert.equal(r.nUsed, 4);
  assert.equal(r.exact, false);
});
