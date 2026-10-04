// Tests for js/stats/select.js. Expected values come from
// test/reference/select.json, written by test/reference/select.R: the
// subset-selection screen coded by hand in base R, and Rinott's h found there
// by nested integrate() and uniroot().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subsetSelection } from '../js/stats/select.js';
import { rinottH } from '../js/stats/special.js';

const REF = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./reference/select.json', import.meta.url)), 'utf8'));

function close(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(err <= tol * scale, `${what}: got ${actual}, expected ${expected} (tol ${tol})`);
}

const G = REF.groups;

for (const dir of ['max', 'min']) {
  test(`subsetSelection matches the R screen and sizing (dir ${dir}, alpha 0.05, delta 1)`, () => {
    const ref = REF[dir];
    const s = subsetSelection(G, { alpha: REF.alpha, delta: REF.delta, dir });
    assert.equal(s.ok, true);
    assert.equal(s.k, 4);
    assert.deepEqual(s.n, ref.n);
    close(s.alpha0, 0.025, 1e-15, 'alpha0');
    close(s.alpha1, 0.025, 1e-15, 'alpha1');
    close(s.t, ref.t, 1e-9, 'screening t');
    s.means.forEach((m, i) => close(m, ref.means[i], 1e-12, `mean ${i}`));
    s.s2.forEach((v, i) => close(v, ref.s2[i], 1e-12, `s2 ${i}`));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) close(s.W[i][j], ref.W[i][j], 1e-9, `W ${i},${j}`);
    assert.deepEqual(s.survivors, ref.survivors);
    // The cutoff is the tightest neighbor bound, and clearing it is survival.
    for (let i = 0; i < 4; i++) {
      let c = dir === 'min' ? Infinity : -Infinity;
      for (let j = 0; j < 4; j++) {
        if (j === i) continue;
        const slack = Math.max(0, s.W[i][j] - REF.delta);
        c = dir === 'min' ? Math.min(c, s.means[j] + slack) : Math.max(c, s.means[j] - slack);
      }
      close(s.cutoff[i], c, 1e-12, `cutoff ${i}`);
      assert.equal(s.survivors[i], dir === 'min' ? s.means[i] <= c : s.means[i] >= c, `cutoff decides ${i}`);
    }
    assert.equal(s.best, ref.best);
    assert.ok(s.survivors[s.best], 'the sample best always survives');
    // h is Rinott's constant at n0 = min n, k, and 1 − α1.
    assert.equal(s.h, rinottH(Math.min(...s.n), 4, 1 - s.alpha1));
    close(s.h, REF.h.value, 1e-6, 'h against R integrate()');
    // R writes −1 for an eliminated design, whose N is null here.
    ref.N.forEach((N, i) => {
      if (N < 0) {
        assert.equal(s.N[i], null);
        assert.equal(s.additional[i], null);
      } else {
        assert.equal(s.N[i], N, `N ${i}`);
        assert.equal(s.additional[i], N - s.n[i], `additional ${i}`);
      }
    });
    assert.equal(typeof s.note, 'string');
  });
}

test('the two directions pick opposite ends, and these data give one and three survivors', () => {
  const mx = subsetSelection(G, { alpha: 0.05, delta: 1, dir: 'max' });
  const mn = subsetSelection(G, { alpha: 0.05, delta: 1, dir: 'min' });
  assert.equal(mx.survivors.filter(Boolean).length, REF.max.survivors.filter(Boolean).length);
  assert.equal(mn.survivors.filter(Boolean).length, REF.min.survivors.filter(Boolean).length);
  const maxIdx = mx.means.indexOf(Math.max(...mx.means));
  const minIdx = mn.means.indexOf(Math.min(...mn.means));
  assert.equal(mx.best, maxIdx);
  assert.equal(mn.best, minIdx);
});

test('every survivor at a wide indifference zone also survives at a narrow one', () => {
  for (const dir of ['max', 'min']) {
    const narrow = subsetSelection(G, { alpha: 0.05, delta: 0.25, dir });
    const wide = subsetSelection(G, { alpha: 0.05, delta: 1, dir });
    narrow.survivors.forEach((s, i) => { if (wide.survivors[i]) assert.ok(s, `${dir} design ${i}`); });
  }
});

test('subsetSelection refuses k < 2, delta ≤ 0, and n < 2', () => {
  const nullFields = ['n', 'means', 's2', 'alpha0', 'alpha1', 't', 'W', 'cutoff', 'survivors', 'best', 'h', 'N', 'additional'];
  for (const [groups, opts] of [
    [[G[0]], { alpha: 0.05, delta: 1, dir: 'max' }],
    [G, { alpha: 0.05, delta: 0, dir: 'max' }],
    [G, { alpha: 0.05, delta: -1, dir: 'min' }],
    [[G[0], [3]], { alpha: 0.05, delta: 1, dir: 'max' }],
  ]) {
    const s = subsetSelection(groups, opts);
    assert.equal(s.ok, false);
    assert.equal(typeof s.reason, 'string');
    for (const f of nullFields) assert.equal(s[f], null, f);
  }
});
