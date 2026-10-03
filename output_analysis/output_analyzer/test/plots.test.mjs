// Tests for the pure helpers in js/ui/plots.js: tick steps, tick values,
// domains, tick labels, the linear scale, and the series thinning used for
// long runs. The expected values follow from the documented rules (a step of
// 1, 2, or 5 times a power of ten closest to the wanted count on a log
// scale; ticks at every multiple of the step inside the window), worked by
// hand; no R reference is involved. Importing plots.js under Node also
// checks that the module touches the DOM only inside functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  niceStep, niceTicks, niceDomain, padDomain, extent, fmtTick, linearScale, decimateMinMax
} from '../js/ui/plots.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('niceStep picks 1, 2, or 5 times a power of ten', () => {
  assert.equal(niceStep(1, 5), 0.2);      // raw 0.2
  assert.equal(niceStep(10, 5), 2);       // raw 2
  assert.equal(niceStep(15.9, 5), 5);     // raw 3.18, past sqrt(10)
  assert.equal(niceStep(15, 5), 2);       // raw 3, below sqrt(10)
  assert.equal(niceStep(100, 5), 20);
  assert.equal(niceStep(7.5, 5), 2);      // raw 1.5, past sqrt(2)
  assert.equal(niceStep(0.003, 3), 0.001);
  assert.equal(niceStep(0, 5), 1);        // degenerate span
});

test('niceTicks: multiples of the step inside the window', () => {
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-3.7, 12.2, 5), [0, 5, 10]);
  assert.deepEqual(niceTicks(12.2, -3.7, 5), [0, 5, 10]);
  assert.deepEqual(niceTicks(0.1, 0.35, 5), [0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
  assert.deepEqual(niceTicks(5, 5, 5), [5]);
  assert.deepEqual(niceTicks(NaN, 1, 5), []);
});

test('niceTicks: values carry no binary noise and no negative zero', () => {
  const t = niceTicks(-0.3, 0.3, 6);
  assert.deepEqual(t, [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
  assert.ok(!Object.is(t[3], -0));
});

test('niceTicks: every window gives a sensible count, evenly spaced', () => {
  for (const [lo, hi] of [[0, 1], [3, 1e6], [-1e-5, 2e-5], [97, 103], [0.5, 0.51], [-50, -2]]) {
    for (const want of [3, 5, 8]) {
      const t = niceTicks(lo, hi, want);
      assert.ok(t.length >= 2 && t.length <= 2.5 * want + 2, `${lo},${hi},${want}: ${t.length}`);
      const step = niceStep(hi - lo, want);
      for (let i = 0; i < t.length; i++) {
        assert.ok(t[i] >= lo - 1e-9 * step && t[i] <= hi + 1e-9 * step);
        if (i) close(t[i] - t[i - 1], step, 1e-9 * Math.abs(step) + 1e-15);
      }
    }
  }
});

test('niceDomain widens outward to the step', () => {
  assert.deepEqual(niceDomain(0.13, 0.87, 5), [0, 1]);
  assert.deepEqual(niceDomain(-3.7, 12.2, 5), [-5, 15]);
  assert.deepEqual(niceDomain(0, 10, 5), [0, 10]);
});

test('padDomain pads both ends but never carries a domain across zero', () => {
  assert.deepEqual(padDomain(0, 10, 0.1), [0, 11]);      // nonnegative data keep a floor of 0
  assert.deepEqual(padDomain(2, 10, 0.1), [1.2, 10.8]);  // padding that stays positive is kept
  assert.deepEqual(padDomain(-10, 0, 0.1), [-11, 0]);    // and the mirror for nonpositive data
  assert.deepEqual(padDomain(-4, 6, 0.1), [-5, 7]);      // data on both sides pad freely
  assert.deepEqual(padDomain(5, 5), [4.5, 5.5]);
  assert.deepEqual(padDomain(0, 0), [-1, 1]);            // a constant 0 still gets room to draw
});

test('extent skips non-finite values and spans several arrays', () => {
  assert.deepEqual(extent([3, NaN, -1, Infinity], new Float64Array([7, 2])), [-1, 7]);
  const e = extent([NaN]);
  assert.ok(Number.isNaN(e[0]) && Number.isNaN(e[1]));
});

test('fmtTick: decimals from the step', () => {
  assert.equal(fmtTick(0.30000000000000004, 0.1), '0.3');
  assert.equal(fmtTick(1.25, 0.25), '1.25');
  assert.equal(fmtTick(2, 0.5), '2.0');
  assert.equal(fmtTick(5, 5), '5');
  assert.equal(fmtTick(-0, 1), '0');
  assert.equal(fmtTick(-1e-17, 0.5), '0.0');
  assert.equal(fmtTick(-2, 1), '-2');
});

test('fmtTick: separators from 10,000 and exponents for tiny steps', () => {
  assert.equal(fmtTick(20000, 5000), '20,000');
  assert.equal(fmtTick(9000, 1000), '9000');
  assert.equal(fmtTick(-12500, 2500), '-12,500');
  assert.equal(fmtTick(2e-5, 1e-5), '2e-5');
  assert.equal(fmtTick(0, 1e-5), '0');
  assert.equal(fmtTick(2e7, 5e6), '2e7');
});

test('linearScale maps, inverts, and reports its domain', () => {
  const s = linearScale(0, 10, 0, 500);
  assert.equal(s(0), 0);
  assert.equal(s(10), 500);
  assert.equal(s(2.5), 125);
  close(s.invert(125), 2.5);
  assert.deepEqual(s.domain, [0, 10]);
  assert.deepEqual(s.ticks(5), [0, 2, 4, 6, 8, 10]);
  const y = linearScale(0, 1, 200, 0);   // a y scale runs downward
  assert.equal(y(0), 200);
  assert.equal(y(1), 0);
  close(y.invert(50), 0.75);
});

test('decimateMinMax keeps every point of a short series', () => {
  const xs = [1, 2, 3, 4], ys = [4, 3, 2, 1];
  assert.deepEqual(decimateMinMax(xs, ys, 10), { x: xs, y: ys });
});

test('decimateMinMax keeps each bucket\'s extremes in index order', () => {
  const n = 10000, xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i; ys[i] = Math.sin(i / 50); }
  ys[1234] = 9; ys[8765] = -9;
  const d = decimateMinMax(xs, ys, 100);
  assert.ok(d.x.length <= 400);
  assert.ok(d.y.includes(9) && d.y.includes(-9));
  for (let i = 1; i < d.x.length; i++) assert.ok(d.x[i] > d.x[i - 1]);
  assert.equal(d.x[0], 0);
  assert.equal(d.x[d.x.length - 1], n - 1);
});
