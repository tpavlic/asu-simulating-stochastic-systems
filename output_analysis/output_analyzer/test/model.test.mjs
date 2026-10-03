// Tests for js/data/model.js. Every expected value is worked out by hand in a
// comment beside it from the tiny inputs written out in the test; the
// arithmetic is sums and products, so no external reference is needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDataset, newId, repIds, repEstimates, observations, datasetSummary,
  truncateDataset, canInfer
} from '../js/data/model.js';

const near = (a, b, tol = 1e-12) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
const nearArr = (a, b, tol = 1e-12) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < b.length; i++) near(a[i], b[i], tol);
};

const tally = () => makeDataset({
  name: 'wait', kind: 'tally',
  reps: [
    { id: 1, t: [1, 2, 3, 4], v: [10, 20, 30, 40] },
    { id: 2, t: [1, 3, 5], v: [5, 7, 9] }
  ]
});
const timeDs = (endTime = 10) => makeDataset({
  name: 'queue', kind: 'time', endTime,
  reps: [
    { id: 'a', t: [0, 2, 5], v: [1, 3, 0] },
    { id: 'b', t: [0, 4], v: [2, 6] }
  ]
});

test('makeDataset fills defaults and converts vectors', () => {
  const ds = makeDataset({ reps: [{ v: [1, 2] }] });
  assert.equal(typeof ds.id, 'string');
  assert.equal(ds.kind, 'tally');
  assert.equal(ds.endTime, null);
  assert.deepEqual(ds.source, { file: '', format: '', notes: [] });
  assert.deepEqual(ds.issues, []);
  assert.equal(ds.derivedFrom, null);
  assert.ok(ds.reps[0].v instanceof Float64Array);
  assert.equal(ds.reps[0].t, null);
  assert.equal(ds.reps[0].id, 1);
  assert.notEqual(newId(), newId());
});

test('repEstimates for tally: plain mean per replication', () => {
  // (10+20+30+40)/4 = 25; (5+7+9)/3 = 7
  nearArr(repEstimates(tally()), [25, 7]);
  assert.deepEqual(repIds(tally()), [1, 2]);
});

test('repEstimates for time: time-weighted mean to endTime', () => {
  // a: 1 on [0,2), 3 on [2,5), 0 on [5,10): (2 + 9 + 0)/10 = 1.1
  // b: 2 on [0,4), 6 on [4,10): (8 + 36)/10 = 4.4
  nearArr(repEstimates(timeDs(10)), [1.1, 4.4]);
  // Without endTime the last record holds for no time:
  // a: (2 + 9)/5 = 2.2; b: 2 on [0,4) only = 2
  nearArr(repEstimates(timeDs(null)), [2.2, 2]);
});

test('repEstimates for reps: the single value', () => {
  const ds = makeDataset({ kind: 'reps', reps: [{ v: [3.5] }, { v: [4.5] }, { v: [6] }] });
  nearArr(repEstimates(ds), [3.5, 4.5, 6]);
});

test('observations concatenates, and throws for time data', () => {
  nearArr(observations(tally()), [10, 20, 30, 40, 5, 7, 9]);
  assert.throws(() => observations(timeDs()));
});

test('datasetSummary counts and summarizes the estimates', () => {
  const s = datasetSummary(tally());
  assert.equal(s.kind, 'tally');
  assert.equal(s.nObs, 7);
  assert.equal(s.nReps, 2);
  assert.deepEqual(s.perRep, { min: 3, max: 4, equal: false });
  assert.deepEqual(s.tRange, [1, 5]);
  assert.equal(s.issueCount, 0);
  // estimates 25 and 7: mean 16, sd = sqrt(((9)^2 + (9)^2)/1) = sqrt(162)
  assert.equal(s.est.n, 2);
  near(s.est.mean, 16);
  near(s.est.sd, Math.sqrt(162));
  near(s.est.se, Math.sqrt(162) / Math.sqrt(2));
  // type-7 quartiles of [7, 25]: h = 0.25 -> 7 + 0.25*18 = 11.5; median 16; q3 7 + 0.75*18 = 20.5
  near(s.est.q1, 11.5);
  near(s.est.median, 16);
  near(s.est.q3, 20.5);
  assert.equal(s.est.min, 7);
  assert.equal(s.est.max, 25);
  const none = datasetSummary(makeDataset({ kind: 'reps' }));
  assert.equal(none.est, null);
  assert.equal(none.tRange, null);
});

test('truncateDataset by index on tally data', () => {
  const ds = tally();
  const d = truncateDataset(ds, { by: 'index', at: 3 });
  assert.equal(d.name, 'wait (after 3 observations)');
  assert.deepEqual(d.derivedFrom, { id: ds.id, truncate: { by: 'index', at: 3 } });
  assert.notEqual(d.id, ds.id);
  // rep 1 keeps [40] at t = 4; rep 2 (3 observations) is empty and dropped
  assert.equal(d.reps.length, 1);
  nearArr(d.reps[0].v, [40]);
  nearArr(d.reps[0].t, [4]);
  assert.equal(d.source.notes.length, 1);
  assert.match(d.source.notes[0], /Replication 2/);
  // the original is untouched
  assert.equal(ds.reps[0].v.length, 4);
});

test('truncateDataset by time on tally data drops observations before the cut', () => {
  const d = truncateDataset(tally(), { by: 'time', at: 2.5 });
  assert.equal(d.name, 'wait (after warm-up at 2.5)');
  nearArr(d.reps[0].v, [30, 40]);
  nearArr(d.reps[1].v, [7, 9]);
  nearArr(d.reps[1].t, [3, 5]);
});

test('truncateDataset by time on time data carries the state in force', () => {
  const d = truncateDataset(timeDs(10), { by: 'time', at: 3 });
  // a: the state at t = 3 is 3 (set at t = 2), then 0 at t = 5
  nearArr(d.reps[0].t, [3, 5]);
  nearArr(d.reps[0].v, [3, 0]);
  // b: the state at t = 3 is 2 (set at t = 0), then 6 at t = 4
  nearArr(d.reps[1].t, [3, 4]);
  nearArr(d.reps[1].v, [2, 6]);
  // a: (3*2 + 0*5)/7 = 6/7; b: (2*1 + 6*6)/7 = 38/7
  nearArr(repEstimates(d), [6 / 7, 38 / 7]);
  // a cut exactly on a record keeps that record's value as the state
  const e = truncateDataset(timeDs(10), { by: 'time', at: 2 });
  nearArr(e.reps[0].t, [2, 5]);
  nearArr(e.reps[0].v, [3, 0]);
});

test('truncateDataset by time drops a time replication that ends before the cut', () => {
  // with no endTime, b's coverage ends at t = 4, and a's at t = 5
  const d = truncateDataset(timeDs(null), { by: 'time', at: 4.5 });
  assert.equal(d.reps.length, 1);
  assert.equal(d.reps[0].id, 'a');
  // a: 3 on [4.5, 5): the only covered time after the cut
  nearArr(repEstimates(d), [3]);
  assert.match(d.source.notes[0], /Replication b/);
});

test('truncateDataset by index on time data and refusal for reps', () => {
  const d = truncateDataset(timeDs(10), { by: 'index', at: 1 });
  nearArr(d.reps[0].t, [2, 5]);
  nearArr(d.reps[1].t, [4]);
  // b: 6 on [4, 10) = 6
  near(repEstimates(d)[1], 6);
  assert.throws(() => truncateDataset(makeDataset({ kind: 'reps', reps: [{ v: [1] }] }), { by: 'index', at: 1 }));
});

test('canInfer needs two replication estimates', () => {
  assert.deepEqual(canInfer(tally()), { ok: true });
  const one = makeDataset({ kind: 'tally', reps: [{ v: [1, 2, 3, 4, 5] }] });
  const r = canInfer(one);
  assert.equal(r.ok, false);
  assert.match(r.reason, /one replication/);
  assert.match(r.reason, /not independent replications/);
  assert.match(r.reason, /5 observations/);
  const reps1 = canInfer(makeDataset({ kind: 'reps', reps: [{ v: [2] }] }));
  assert.equal(reps1.ok, false);
  assert.match(reps1.reason, /at least two/);
});
