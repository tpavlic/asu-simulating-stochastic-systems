// Tests for concatenateReps and resampleTimeWeighted in js/stats/steadystate.js, and for batch
// means on a joined series. Every expected value is read from test/reference/steadystate2.json,
// which test/reference/steadystate2.R computes by hand in base R (index and time cuts applied
// replication by replication and the results joined with c(), trajectories shifted to start where
// the previous one ended, and time averages as sums of value × overlap). The input replications are
// generated in R and carried in the same JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatenateReps, resampleTimeWeighted, batchMeans } from '../js/stats/steadystate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = JSON.parse(fs.readFileSync(path.join(here, 'reference', 'steadystate2.json'), 'utf8'));

function close(a, b, tol, what) {
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: got ${a}, expected ${b}`);
}
function closeAll(a, b, tol, what) {
  assert.equal(a.length, b.length, `${what}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < b.length; i++) close(a[i], b[i], tol, `${what}[${i}]`);
}

test('tally replications cut by index join end to end', () => {
  const res = concatenateReps(R.tally, 'tally', { by: 'index', at: 6 }, null);
  assert.equal(res.t, null);
  assert.equal(res.end, null);
  assert.equal(res.nReps, 3);
  closeAll(res.v, R.tally_index.v, 0, 'joined values');
  assert.deepEqual(res.joins, R.tally_index.joins);
});

test('tally replications cut by time keep observations at or after the cut', () => {
  const res = concatenateReps(R.tally, 'tally', { by: 'time', at: 4 }, null);
  closeAll(res.v, R.tally_time.v, 0, 'joined values');
  assert.deepEqual(res.joins, R.tally_time.joins);
});

test('batch means on a joined tally series match R', () => {
  const joined = concatenateReps(R.tally, 'tally', { by: 'index', at: 6 }, null);
  const bm = batchMeans({ t: null, v: joined.v }, { kind: 'tally', truncate: null, count: 9 });
  assert.equal(bm.ok, true, bm.reason);
  closeAll(bm.means, R.tally_index.means, 1e-12, 'batch means');
});

test('time-persistent trajectories cut by time are shifted to start where the previous ended', () => {
  const res = concatenateReps(R.traj, 'time', { by: 'time', at: 2.5 }, R.endT);
  assert.equal(res.nReps, 3);
  closeAll(res.t, R.time_join.t, 1e-12, 'joined times');
  closeAll(res.v, R.time_join.v, 0, 'joined values');
  closeAll(res.joins, R.time_join.joins, 1e-12, 'join times');
  close(res.end, R.time_join.end, 1e-12, 'end');
});

test('batch means on a joined trajectory are time averages over the joined timeline', () => {
  const joined = concatenateReps(R.traj, 'time', { by: 'time', at: 2.5 }, R.endT);
  const bm = batchMeans({ t: joined.t, v: joined.v }, { kind: 'time', truncate: null, count: 8, endTime: joined.end });
  assert.equal(bm.ok, true, bm.reason);
  closeAll(bm.means, R.time_join.means, 1e-12, 'batch means');
});

test('one replication passes through as its own truncated series', () => {
  const res = concatenateReps([R.traj[0]], 'time', { by: 'time', at: 2.5 }, R.endT);
  assert.equal(res.joins.length, 0);
  close(res.t[0], 2.5, 0, 'first time');
  close(res.end, R.endT, 0, 'end');
});

test('a replication with nothing after the cut is skipped', () => {
  const reps = [{ t: null, v: [1, 2, 3] }, { t: null, v: [4, 5, 6, 7, 8] }];
  const res = concatenateReps(reps, 'tally', { by: 'index', at: 3 }, null);
  assert.equal(res.nReps, 1);
  assert.deepEqual(Array.from(res.v), [7, 8]);
  assert.deepEqual(res.joins, []);
});

test('resampling onto equal time steps gives the time average over each step', () => {
  const kept = concatenateReps([R.traj[0]], 'time', { by: 'time', at: 2.5 }, R.endT);
  const rs = resampleTimeWeighted(kept.t, kept.v, kept.t[0], kept.end, R.resampled.steps);
  close(rs.step, (R.endT - 2.5) / R.resampled.steps, 1e-14, 'step');
  closeAll(rs.values, R.resampled.values, 1e-12, 'resampled values');
});
