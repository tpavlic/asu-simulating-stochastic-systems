// Tests for js/stats/steadystate.js. Every expected value is read from
// test/reference/steadystate.json, which test/reference/steadystate.R computes by hand in base R
// (batch means summed directly, time-weighted means as sums of value × duration, Welch's moving
// average by its 1-based definition, Fishman's statistic term by term, and a Monte Carlo of
// Fishman's test under independence). The input series are generated in R and carried in the same
// JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignByIndex, alignByTime, movingAverage, cumulativeAverage, lag1, lag1Test, batchMeans,
} from '../js/stats/steadystate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = JSON.parse(fs.readFileSync(path.join(here, 'reference', 'steadystate.json'), 'utf8'));

function close(a, b, tol, what) {
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: got ${a}, expected ${b}`);
}
function closeAll(a, b, tol, what) {
  assert.equal(a.length, b.length, `${what}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < b.length; i++) close(a[i], b[i], tol, `${what}[${i}]`);
}

// Checks a tally or time batch-means result against an R batch summary.
function checkBatches(res, ref, what) {
  assert.equal(res.ok, true, `${what}: ${res.reason}`);
  assert.equal(res.b, ref.b, `${what}: b`);
  close(res.size, ref.size, 1e-12, `${what}: size`);
  closeAll(res.means, ref.means, 1e-12, `${what}: means`);
  closeAll(res.batches.map(x => x.start), ref.start, 1e-12, `${what}: start`);
  closeAll(res.batches.map(x => x.end), ref.end, 1e-12, `${what}: end`);
  close(res.mean, ref.mean, 1e-12, `${what}: mean`);
  close(res.sd, ref.sd, 1e-11, `${what}: sd`);
  close(res.lag1, ref.r1, 1e-11, `${what}: r1`);
  close(res.lag1, ref.acf1, 1e-11, `${what}: r1 against acf`);
  close(res.lag1Test.C, ref.C, 1e-10, `${what}: C`);
  close(res.lag1Test.p, ref.p, 1e-7, `${what}: p`);
  close(res.lo, ref.lo, 1e-7, `${what}: lo`);
  close(res.hi, ref.hi, 1e-7, `${what}: hi`);
}

test('tally batch means: AR(1), truncate 100, 20 batches (R)', () => {
  const ref = R.ar1.count20;
  const res = batchMeans({ t: null, v: R.ar1.series },
    { kind: 'tally', truncate: { by: 'index', at: 100 }, count: 20, level: 0.95 });
  checkBatches(res, ref, 'count20');
  assert.equal(res.leftover.n, ref.leftover);
  assert.equal(res.nUsed, 1900);
  assert.ok(res.batches.every(x => x.n === ref.size));
});

test('tally batch means: AR(1), truncate 100, batch size 150 with leftover (R)', () => {
  const ref = R.ar1.size150;
  const res = batchMeans({ t: null, v: R.ar1.series },
    { kind: 'tally', truncate: { by: 'index', at: 100 }, size: 150, level: 0.95 });
  checkBatches(res, ref, 'size150');
  assert.equal(res.leftover.n, ref.leftover);
  assert.ok(res.leftover.n > 0);
  assert.ok(res.warnings.some(w => /not fill a batch/.test(w)), 'leftover warning');
});

test('tally batch means: AR(1), 7 batches at 90% (R), warns on fewer than 10', () => {
  const ref = R.ar1.count7;
  const res = batchMeans({ t: null, v: R.ar1.series },
    { kind: 'tally', truncate: null, count: 7, level: 0.90 });
  checkBatches(res, ref, 'count7');
  assert.equal(res.leftover.n, ref.leftover);
  assert.ok(res.warnings.some(w => /fewer than 10 batches/.test(w)));
});

test('time-persistent batch means: cut at time 10, 6 equal intervals (R)', () => {
  const tr = R.traj, ref = tr.count6;
  const res = batchMeans({ t: tr.t, v: tr.v },
    { kind: 'time', truncate: { by: 'time', at: tr.cut }, count: 6, endTime: tr.endTime });
  checkBatches(res, ref, 'count6');
  assert.equal(res.byTime, true);
  assert.equal(res.start, tr.cut);
  assert.equal(res.nUsed, tr.truncT.length);
  assert.deepEqual(res.batches.map(x => x.n), ref.n);
  assert.equal(res.leftover.duration, 0);
  assert.equal(res.warnings.filter(w => /not fill a batch/.test(w)).length, 0);
});

test('time-persistent batch means: interval width 7 with a leftover duration (R)', () => {
  const tr = R.traj, ref = tr.size7;
  const res = batchMeans({ t: tr.t, v: tr.v },
    { kind: 'time', truncate: { by: 'time', at: tr.cut }, size: 7, endTime: tr.endTime });
  checkBatches(res, ref, 'size7');
  assert.deepEqual(res.batches.map(x => x.n), ref.n);
  close(res.leftover.duration, ref.leftover, 1e-12, 'leftover duration');
  assert.ok(res.warnings.some(w => /time units do not fill a batch/.test(w)));
});

test('time-persistent truncation carries the state in force at the cut (R)', () => {
  // A first batch that ends before the next state change after the cut has the carried state as
  // its mean, which R records.
  const tr = R.traj;
  const eps = (tr.truncT[1] - tr.cut) / 2;
  const res = batchMeans({ t: tr.t, v: tr.v },
    { kind: 'time', truncate: { by: 'time', at: tr.cut }, size: eps, endTime: tr.endTime });
  assert.equal(res.ok, true);
  assert.equal(res.batches[0].mean, tr.carried);
  // A single interval is refused; two equal halves average to the time average over the whole
  // remaining trajectory, which is also the mean of R's six equal intervals.
  const one = batchMeans({ t: tr.t, v: tr.v },
    { kind: 'time', truncate: { by: 'time', at: tr.cut }, size: tr.endTime - tr.cut, endTime: tr.endTime });
  assert.equal(one.ok, false, 'one batch is refused');
  const two = batchMeans({ t: tr.t, v: tr.v },
    { kind: 'time', truncate: { by: 'time', at: tr.cut }, count: 2, endTime: tr.endTime });
  close(two.mean, tr.count6.mean, 1e-12, 'two halves average to the same time average');
});

test('alignByIndex on five tally replications of unequal length (R)', () => {
  const res = alignByIndex(R.tallyReps.map(r => ({ t: r.t, v: r.v })));
  assert.equal(res.L, R.alignIndex.L);
  assert.ok(res.counts instanceof Int32Array);
  closeAll(res.ybar, R.alignIndex.ybar, 1e-12, 'ybar');
  assert.deepEqual(Array.from(res.counts), R.alignIndex.counts);
});

test('alignByTime, tally, 8 bins over [0, max last time] (R)', () => {
  const res = alignByTime(R.tallyReps.map(r => ({ t: r.t, v: r.v })), 'tally', 8, null);
  closeAll(res.edges, R.alignTally.edges, 1e-12, 'edges');
  closeAll(res.ybar, R.alignTally.ybar, 1e-12, 'ybar');
  assert.deepEqual(Array.from(res.counts), R.alignTally.counts);
  for (let b = 0; b < 8; b++) close(res.centers[b], (res.edges[b] + res.edges[b + 1]) / 2, 1e-15, 'center');
});

test('alignByTime, time-persistent, two trajectories with no end time (R)', () => {
  const reps = [{ t: R.traj.t, v: R.traj.v }, { t: R.traj3.t, v: R.traj3.v }];
  const res = alignByTime(reps, 'time', 5, null);
  closeAll(res.edges, R.alignTime.edges, 1e-12, 'edges');
  closeAll(res.ybar, R.alignTime.ybar, 1e-12, 'ybar');
  assert.deepEqual(Array.from(res.counts), R.alignTime.counts);
});

test('alignByTime, one bin over [0, endTime] is the whole time-weighted mean (R)', () => {
  const res = alignByTime([{ t: R.traj.t, v: R.traj.v }], 'time', 1, R.traj.endTime);
  close(res.ybar[0], R.traj.twWhole, 1e-12, 'time-weighted mean');
});

test("Welch's moving average, w = 2 and w = 5, and w = 0 (R)", () => {
  const y = R.welch.y;
  for (const [w, ref] of [[2, R.welch.w2], [5, R.welch.w5]]) {
    const ma = movingAverage(y, w);
    assert.equal(ma.length, y.length);
    closeAll(ma.slice(0, ref.length), ref, 1e-12, `w=${w}`);
    for (let i = ref.length; i < y.length; i++) assert.ok(Number.isNaN(ma[i]), `w=${w} NaN at ${i}`);
  }
  const copy = movingAverage(y, 0);
  assert.deepEqual(Array.from(copy), y);
});

test('cumulative average (R)', () => {
  closeAll(cumulativeAverage(R.welch.y), R.welch.cum, 1e-12, 'cum');
});

test('lag1 and lag1Test edge cases', () => {
  assert.deepEqual(lag1Test([1, 2, 3]), { C: NaN, p: NaN, flag: false });
  assert.ok(Number.isNaN(lag1([5, 5, 5, 5])));
  assert.equal(lag1Test([5, 5, 5, 5]).flag, false);
  close(lag1(R.ar1.count20.means), R.ar1.count20.r1, 1e-11, 'lag1');
  const r = batchMeans({ t: null, v: [1, 2, 3] }, { kind: 'tally', truncate: null, count: 1 });
  assert.equal(r.ok, false);
  assert.equal(batchMeans({ t: null, v: [1, 2, 3, 4] }, { kind: 'tally', count: 2, size: 2 }).ok, false);
  // Batches of 5 on the R AR(1) series (phi = 0.7) leave strong positive lag-one correlation.
  const small = batchMeans({ t: null, v: R.ar1.series }, { kind: 'tally', truncate: null, size: 5 });
  assert.equal(small.lag1Test.flag, true);
  assert.ok(small.warnings.some(w => /lag-one correlation/.test(w)));
});

test("Fishman's test rejects near the R Monte Carlo rate under independence", () => {
  // R's rate comes from 20000 independent N(0, 1) series of length 20 (see the R script);
  // here 2000 series from a seeded mulberry32 generator with Box–Muller normals.
  let s = 0x2f6b9a1d;
  const u = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const norm = () => {
    let a = u();
    while (a === 0) a = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
  const N = 2000, b = 20;
  let rej = 0;
  const x = new Float64Array(b);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < b; j++) x[j] = norm();
    if (lag1Test(x).flag) rej += 1;
  }
  const rate = rej / N;
  console.log(`lag1Test rejection rate: JS ${rate} (N = ${N}), R ${R.mc.b20} (N = ${R.mc.N}), R b = 10 ${R.mc.b10}`);
  assert.ok(Math.abs(rate - R.mc.b20) <= 0.02, `JS rate ${rate} vs R ${R.mc.b20}`);
  // The R rates themselves sit near the nominal 0.05 at b = 20 and b = 10.
  assert.ok(Math.abs(R.mc.b20 - 0.05) < 0.01 && Math.abs(R.mc.b10 - 0.05) < 0.01);
});
