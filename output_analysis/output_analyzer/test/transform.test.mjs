// Tests for the transforms of the replication outcomes. Every expected value
// is an exact identity of the transform itself (ln e = 1, logit 1/2 = 0,
// arcsin √(1/4) = π/6), and so no R reference is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSFORMS, transformOf, isTransform, applyTransform, backTransform, backInterval, transformLabel, fittingTransforms, transformSets }
  from '../js/stats/transform.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + ' vs ' + b);

test('the menu holds None first, then the five transforms', () => {
  assert.deepEqual(TRANSFORMS.map(t => t.id), ['none', 'log', 'sqrt', 'asin_sqrt', 'logit', 'reciprocal']);
  assert.equal(transformOf('nonsense').id, 'none');
  assert.equal(isTransform('log'), true);
  assert.equal(isTransform('none'), false);
  assert.equal(isTransform('nonsense'), false);
});

test('known values', () => {
  const at = (id, y) => applyTransform([y], id).values[0];
  close(at('log', Math.E), 1);
  close(at('sqrt', 2.25), 1.5);
  close(at('asin_sqrt', 0.25), Math.PI / 6);
  close(at('asin_sqrt', 1), Math.PI / 2);
  assert.equal(at('asin_sqrt', 0), 0);
  assert.equal(at('logit', 0.5), 0);
  close(at('logit', 0.75), Math.log(3));
  close(at('reciprocal', 4), 0.25);
  assert.equal(at('none', -3), -3);
});

test('every transform round-trips through its inverse', () => {
  const samples = { log: [1e-6, 0.3, 1, 42, 1e6], sqrt: [0, 0.01, 1, 9, 1e4], asin_sqrt: [0, 0.01, 0.5, 0.99, 1],
                    logit: [0.001, 0.2, 0.5, 0.8, 0.999], reciprocal: [1e-3, 0.5, 1, 7, 1e5], none: [-5, 0, 3.5] };
  for (const [id, ys] of Object.entries(samples)) {
    const { values, bad } = applyTransform(ys, id);
    assert.deepEqual(bad, [], id);
    ys.forEach((y, i) => close(backTransform(values[i], id), y, 1e-10));
  }
});

test('values outside the domain are reported by index and left NaN', () => {
  const r = applyTransform([2, 0, -1, 3], 'log');
  assert.deepEqual(r.bad, [1, 2]);
  assert.ok(Number.isNaN(r.values[1]) && Number.isNaN(r.values[2]));
  close(r.values[3], Math.log(3));
  assert.deepEqual(applyTransform([0, 0.5, 1], 'logit').bad, [0, 2]);
  assert.deepEqual(applyTransform([0, 1, 1.0001], 'asin_sqrt').bad, [2]);
  assert.deepEqual(applyTransform([-0.001, 0], 'sqrt').bad, [0]);
  assert.deepEqual(applyTransform([0, -2, 3], 'reciprocal').bad, [0, 1]);
});

test('a value that is not a finite number passes through as NaN and is not counted as bad', () => {
  const r = applyTransform([NaN, 4, Infinity], 'sqrt');
  assert.deepEqual(r.bad, []);
  assert.ok(Number.isNaN(r.values[0]) && Number.isNaN(r.values[2]));
  assert.equal(r.values[1], 2);
});

test('an interval carries back in increasing order, swapped for the reciprocal', () => {
  const lg = backInterval(0, 1, 'log');
  assert.equal(lg.lo, 1);
  close(lg.hi, Math.E);
  const rc = backInterval(0.25, 0.5, 'reciprocal');
  assert.deepEqual(rc, { lo: 2, hi: 4 });
});

test('an interval end past the image of the domain maps to the domain\'s edge', () => {
  assert.deepEqual(backInterval(-0.5, 2, 'sqrt'), { lo: 0, hi: 4 });
  assert.deepEqual(backInterval(-0.1, 2, 'asin_sqrt'), { lo: 0, hi: 1 });
  // A harmonic-mean interval whose reciprocal-scale lower end is at or below 0 is unbounded above.
  assert.deepEqual(backInterval(-0.1, 0.5, 'reciprocal'), { lo: 2, hi: Infinity });
  assert.ok(Number.isNaN(backTransform(NaN, 'reciprocal')));
  assert.ok(Number.isNaN(backTransform(NaN, 'sqrt')));
});

test('transformLabel names the transform and lowers the label\'s first letter', () => {
  assert.equal(transformLabel('Replication mean of wait', 'none'), 'Replication mean of wait');
  assert.equal(transformLabel('Replication mean of wait', 'log'), 'Log of replication mean of wait');
  assert.equal(transformLabel('wait per replication', 'reciprocal'), 'Reciprocal of wait per replication');
  assert.equal(transformLabel('WIP per replication', 'sqrt'), 'Square root of WIP per replication');
});

test('fittingTransforms lists the transforms whose domain holds every finite value', () => {
  assert.deepEqual(fittingTransforms([0.2, 0.5, NaN]), ['log', 'sqrt', 'asin_sqrt', 'logit', 'reciprocal']);
  assert.deepEqual(fittingTransforms([0, 0.5, 1]), ['sqrt', 'asin_sqrt']);
  assert.deepEqual(fittingTransforms([0, 3]), ['sqrt']);
  assert.deepEqual(fittingTransforms([-1, 3]), []);
});

test('transformSets names the replications outside the domain, set by set', () => {
  const r = transformSets([{ name: 'A', values: [1, 0, 2], ids: ['r1', 'r2', 'r3'] }, { name: 'B', values: [3, 4], ids: [1, 2] }], 'log');
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, [{ name: 'A', ids: ['r2'], all: false }]);
  assert.equal(transformSets([{ name: 'B', values: [0, -1], ids: [1, 2] }], 'log').problems[0].all, true);
  assert.deepEqual(r.fitting, ['sqrt']);
  close(r.values[1][1], Math.log(4));
  const ok = transformSets([{ name: 'A', values: [1, 2], ids: [1, 2] }], 'sqrt');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.problems, []);
});
