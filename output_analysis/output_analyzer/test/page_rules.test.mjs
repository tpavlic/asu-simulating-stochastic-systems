// Tests for the small rules the pages apply, each a pure function: the ticks
// the Equal variances checklist on Summary and Plots opens with, Two Systems'
// verdict on the F ratio of the variances with its exported "interval
// contains 1" entry, and the labels the figures and the regenerate scripts
// share. Expected values follow from each rule as its
// JSDoc states it; the one statistic used, fRatio on constant designs, gives
// standard deviations of exactly 0 by its own definition (pinned in
// flat.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTicks, fRatioVerdict, roleLabels, outcomeAxis, estimateAxis, shortNames } from '../js/ui/rules.js';
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

test('roleLabels drops a prefix the two names share, and never repeats the role letter', () => {
  assert.deepEqual(roleLabels({ name: 'file · A' }, { name: 'file · B' }), ['A', 'B']);
  assert.deepEqual(roleLabels({ name: 'file · fast' }, { name: 'file · slow' }), ['A · fast', 'B · slow']);
  assert.deepEqual(roleLabels({ name: 'one · x' }, { name: 'two · y' }), ['A · one · x', 'B · two · y']);
});

test('outcomeAxis and estimateAxis name the outcome by the data kind', () => {
  assert.equal(outcomeAxis(null), 'Replication outcome');
  assert.equal(outcomeAxis({ kind: 'tally', response: 'wait' }, true), 'Observation of wait');
  assert.equal(outcomeAxis({ kind: 'reps', response: 'cost' }), 'cost per replication');
  assert.equal(outcomeAxis({ kind: 'time', response: 'queue' }), 'Time-weighted replication mean of queue');
  assert.equal(estimateAxis({ kind: 'reps', response: 'cost' }), 'cost');
  assert.equal(estimateAxis({ kind: 'tally', response: 'wait' }), 'Replication mean of wait');
});

test('shortNames keeps only what follows a prefix every name shares', () => {
  assert.deepEqual(shortNames([{ name: 'f · A' }, { name: 'f · B' }, { name: 'f · C' }]), ['A', 'B', 'C']);
  assert.deepEqual(shortNames([{ name: 'f · A' }, { name: 'g · B' }]), ['f · A', 'g · B']);
  assert.deepEqual(shortNames([{ name: 'f · A' }, { name: 'f · A' }]), ['f · A', 'f · A']);
  assert.deepEqual(shortNames([{ name: 'only' }]), ['only']);
});

test('outcomeAxis and estimateAxis name the transform, and leave the pooled observations alone', () => {
  const tally = { kind: 'tally', response: 'wait' }, time = { kind: 'time', response: 'queue length' }, reps = { kind: 'reps', response: 'Cost' };
  assert.equal(outcomeAxis(tally, false, 'log'), 'Log of replication mean of wait');
  assert.equal(outcomeAxis(time, false, 'sqrt'), 'Square root of time-weighted replication mean of queue length');
  assert.equal(outcomeAxis(reps, false, 'reciprocal'), 'Reciprocal of cost per replication');
  assert.equal(outcomeAxis(tally, true, 'log'), 'Observation of wait');
  assert.equal(outcomeAxis(null, false, 'logit'), 'Logit of replication outcome');
  assert.equal(outcomeAxis(tally, false), 'Replication mean of wait');
  assert.equal(estimateAxis(tally, 'asin_sqrt'), 'Arcsine square root of replication mean of wait');
  assert.equal(estimateAxis(reps, 'log'), 'Log of cost');
  assert.equal(estimateAxis(reps), 'Cost');
});
