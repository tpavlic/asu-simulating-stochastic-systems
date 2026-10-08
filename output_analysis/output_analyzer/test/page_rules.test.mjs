// Tests for two small rules the pages apply, each a pure function: the ticks
// the Equal variances checklist on Summary and Plots opens with, and Two
// Systems' verdict on the F ratio of the variances with its exported
// "interval contains 1" entry. Expected values follow from each rule as its
// JSDoc states it; the one statistic used, fRatio on constant designs, gives
// standard deviations of exactly 0 by its own definition (pinned in
// flat.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTicks } from '../js/ui/widgets.js';
import { fRatioVerdict } from '../js/pages/two.js';
import { fRatio } from '../js/stats/intervals.js';

test('initialTicks: every offered dataset before any choice', () => {
  assert.deepEqual(initialTicks(undefined, ['a', 'b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(initialTicks(null, ['a', 'b']), ['a', 'b']);
});

test('initialTicks: the reader\'s own ticks stand, even one or none', () => {
  assert.deepEqual(initialTicks(['b', 'c'], ['a', 'b', 'c']), ['b', 'c']);
  assert.deepEqual(initialTicks(['b'], ['a', 'b', 'c']), ['b']);
  assert.deepEqual(initialTicks([], ['a', 'b', 'c']), []);
});

test('initialTicks: ids no longer offered are dropped, and a list with none left gives way', () => {
  assert.deepEqual(initialTicks(['b', 'gone'], ['a', 'b']), ['b']);
  assert.deepEqual(initialTicks(['gone'], ['a', 'b']), ['a', 'b']);
});

test('fRatioVerdict: two constant designs have no ratio to judge', () => {
  const fr = fRatio([0.3, 0.3, 0.3], [0.7, 0.7, 0.7], 0.95);
  assert.equal(fr.s1, 0);
  assert.equal(fr.s2, 0);
  const v = fRatioVerdict(fr);
  assert.equal(v.contains, 'not defined');
  assert.equal(v.text, 'Neither design varies, and so the variances cannot be compared.');
});

test('fRatioVerdict: one constant design is still judged', () => {
  // F = 0 with the interval [0, 0], and F infinite with [∞, ∞]: both exclude 1.
  for (const [x, y] of [[[0.3, 0.3, 0.3], [1, 2, 4]], [[1, 2, 4], [0.3, 0.3, 0.3]]]) {
    const v = fRatioVerdict(fRatio(x, y, 0.95));
    assert.equal(v.contains, 'no');
    assert.match(v.text, /excludes 1/);
  }
});

test('fRatioVerdict: an undefined interval is not read as excluding 1', () => {
  const v = fRatioVerdict(fRatio([1], [1, 2, 3], 0.95));
  assert.equal(v.contains, 'not defined');
  assert.doesNotMatch(v.text, /excludes|contains/);
});

test('fRatioVerdict: contains and excludes 1 follow the interval', () => {
  assert.equal(fRatioVerdict({ s1: 1, s2: 2, lo: 0.1, hi: 1 }).contains, 'yes');
  assert.equal(fRatioVerdict({ s1: 1, s2: 2, lo: 1, hi: 3 }).contains, 'yes');
  assert.equal(fRatioVerdict({ s1: 1, s2: 2, lo: 1.2, hi: 3 }).contains, 'no');
  assert.match(fRatioVerdict({ s1: 1, s2: 2, lo: 0.5, hi: 2 }).text, /^The interval contains 1/);
});
