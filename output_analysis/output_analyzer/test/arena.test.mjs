// Tests for js/io/arena.js against the sample files in arena/samples/, which
// Arena 16.20 wrote for a model whose every value is known: arrivals every 2
// minutes from time 0 and a 1.5-minute service, so a busy flag toggles 1/0
// and a counter steps up at 1.5, 3.5, 5.5, …. equal20/ holds 3 replications
// of 20 minutes and unequal/ 3 replications ending at 10, 20, and 30. The
// expected values are those arena/arena_dat_format.md and
// arena/arena_output_analyzer_behavior.md record, including what the Output
// Analyzer itself reported for the same files.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isArenaDat, parseArenaDat, arenaDataset, arenaFinalCounts } from '../js/io/arena.js';
import { repEstimates, datasetSummary } from '../js/data/model.js';
import { batchMeans } from '../js/stats/steadystate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'arena', 'samples');
const read = f => new Uint8Array(fs.readFileSync(path.join(DIR, f)));
const vec = a => Array.from(a);
const seq = (from, step, n) => Array.from({ length: n }, (_, i) => from + step * i);
const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, a + ' vs ' + b);

test('isArenaDat: every sample passes, text and random bytes do not', () => {
  for (const sub of ['equal20', 'unequal', 'warmup5']) {
    for (const f of fs.readdirSync(path.join(DIR, sub))) assert.ok(isArenaDat(read(sub + '/' + f)), f);
  }
  const text = s => new Uint8Array(Buffer.from(s, 'latin1'));
  assert.equal(isArenaDat(text('1,2\n3,4\n')), false);
  assert.equal(isArenaDat(text('204 \r\nno terminator here')), false);
  // A text file whose first line is a number and a space, with a stray 0x1A,
  // still fails without a header line and without a whole record after it.
  assert.equal(isArenaDat(text('204 \r\nabc\x1a' + '0123456789abcdef')), false);
  assert.equal(isArenaDat(text('204 \r\nData for:x\r\n\x1a12345')), false);
  assert.equal(isArenaDat(text('204 \r\nData for:x\r\n\x1a' + '0123456789abcdef')), true);
  assert.equal(isArenaDat(text('204 \r\nData for:x\r\n\x1a' + '0123456789abcdefXYZ')), true);
  assert.equal(isArenaDat(new Uint8Array(0)), false);
});

test('output1.dat: type 204, one value per replication', () => {
  const d = parseArenaDat(read('equal20/output1.dat'));
  assert.equal(d.typeCode, 204);
  assert.equal(d.typeName, 'output');
  assert.equal(d.project, 'Unnamed Project');
  assert.equal(d.analyst, 'EC2');
  assert.equal(d.dataFor, 'Output 1');
  assert.equal(d.runDate, '10/05/2026');
  assert.equal(d.closed, true);
  assert.deepEqual(d.reps.map(r => r.t), [[1], [2], [3]]);
  assert.deepEqual(d.reps.map(r => r.v), [[10.5], [20.5], [30.5]]);
  const ds = arenaDataset(d, { file: 'output1.dat' });
  assert.equal(ds.kind, 'reps');
  assert.equal(ds.name, 'Output 1');
  assert.equal(ds.response, 'Output 1');
  assert.equal(ds.source.format, 'arena');
  assert.equal(ds.source.file, 'output1.dat');
  assert.deepEqual(vec(repEstimates(ds)), [10.5, 20.5, 30.5]);
  assert.equal(ds.reps[0].t, null);
});

test('tally2.dat: type 203, ten timed observations per replication', () => {
  const d = parseArenaDat(read('equal20/tally2.dat'));
  assert.equal(d.typeCode, 203);
  assert.equal(d.dataFor, 'ExitTime');
  assert.equal(d.reps.length, 3);
  for (const r of d.reps) {
    assert.deepEqual(r.t, seq(1.5, 2, 10));
    assert.deepEqual(r.v, seq(1.5, 2, 10));
  }
  const ds = arenaDataset(d);
  assert.equal(ds.kind, 'tally');
  assert.deepEqual(vec(repEstimates(ds)), [10.5, 10.5, 10.5]);
  assert.deepEqual(vec(ds.reps[2].t), seq(1.5, 2, 10));
  assert.equal(datasetSummary(ds).nObs, 30);
});

test('tp1.dat: type 201, a step function whose time average is 0.75 over its own run', () => {
  const d = parseArenaDat(read('equal20/tp1.dat'));
  assert.equal(d.typeCode, 201);
  assert.equal(d.dataFor, 'ResBusy');
  assert.equal(d.reps.length, 3);
  assert.equal(d.reps[0].t.length, 23);
  assert.deepEqual(d.reps[0].t.slice(0, 4), [0, 0, 1.5, 2]);
  assert.deepEqual(d.reps[0].v.slice(0, 4), [0, 1, 0, 1]);
  assert.deepEqual(d.reps[0].t.slice(-3), [19.5, 20, 20]);
  assert.deepEqual(d.reps[0].v.slice(-3), [0, 1, 1]);
  const ds = arenaDataset(d);
  assert.equal(ds.kind, 'time');
  assert.equal(ds.endTime, null);
  for (const e of vec(repEstimates(ds))) near(e, 0.75);
  assert.ok(!ds.source.notes.some(n => /different times/.test(n)));
  // The Output Analyzer's own time-based batches of 10 on replication 1.
  const b = batchMeans(ds.reps[0], { kind: 'time', size: 10 });
  assert.ok(b.ok, b.reason);
  assert.equal(b.b, 2);
  near(b.means[0], 0.75); near(b.means[1], 0.75);
});

test('counter1.dat: type 206, the running count as a step function from 0, and the final count beside it', () => {
  const d = parseArenaDat(read('equal20/counter1.dat'));
  assert.equal(d.typeCode, 206);
  assert.equal(d.dataFor, 'Counter 1');
  assert.deepEqual(d.reps[0].t, seq(1.5, 2, 10));
  assert.deepEqual(d.reps[0].v, seq(1, 1, 10));
  const ds = arenaDataset(d);
  assert.equal(ds.kind, 'time');
  assert.equal(ds.endTime, null);
  assert.deepEqual(vec(ds.reps[0].t), [0].concat(seq(1.5, 2, 10)));
  assert.deepEqual(vec(ds.reps[0].v), [0].concat(seq(1, 1, 10)));
  // Count k holds for 2 minutes, k = 1…9, and the last increment holds for
  // no time: 2·45 over [0, 19.5].
  for (const e of vec(repEstimates(ds))) near(e, 90 / 19.5);
  // The Output Analyzer's time-based batch of 10 on replication 1 was 2.25,
  // the integral of the count over [0, 10) with 0 before the first record
  // (its second batch, [10, 20), was dropped as incomplete). Two batches of 5
  // cover the same stretch: 5/5 and 17.5/5, whose average is 2.25.
  const b = batchMeans(ds.reps[0], { kind: 'time', size: 5 });
  assert.ok(b.ok, b.reason);
  near(b.means[0], 1.0); near(b.means[1], 3.5);
  near((b.means[0] + b.means[1]) / 2, 2.25);
  assert.ok(ds.source.notes.some(n => /running count/.test(n)));
  const fc = arenaFinalCounts(d, { file: 'counter1.dat' });
  assert.equal(fc.kind, 'reps');
  assert.equal(fc.name, 'Counter 1 (final count)');
  assert.deepEqual(vec(repEstimates(fc)), [10, 10, 10]);
  assert.ok(fc.source.notes.some(n => /page’s own/.test(n)));
});

test('batch-means .flt files: type 205, batch means at their midpoints as observations', () => {
  const d = parseArenaDat(read('equal20/tp1_b10.flt'));
  assert.equal(d.typeCode, 205);
  assert.equal(d.typeName, 'written by the Output Analyzer');
  assert.equal(d.analyst, 'OUTPUT ANALYZER');
  assert.equal(d.reps.length, 1);
  assert.deepEqual(d.reps[0].t, [5, 15]);
  assert.deepEqual(d.reps[0].v, [0.75, 0.75]);
  const ds = arenaDataset(d);
  assert.equal(ds.kind, 'tally');
  assert.deepEqual(vec(repEstimates(ds)), [0.75]);
  const c = arenaDataset(parseArenaDat(read('equal20/counter1_b10.flt')));
  assert.deepEqual(vec(c.reps[0].t), [5]);
  assert.deepEqual(vec(c.reps[0].v), [2.25]);
  // Lumping unequal runs is the Analyzer's own artifact (0.6 = 9/15, with a
  // negative-duration segment at the join); the file still reads as written.
  const l = arenaDataset(parseArenaDat(read('unequal/tp1_lump15.flt')));
  assert.deepEqual(vec(l.reps[0].t), [7.5]);
  near(l.reps[0].v[0], 0.6);
});

test('other Analyzer-written files: observation batches, truncated time batches, a moving average', () => {
  // Observation batches of 3 on ExitTime: each at the time of its middle
  // observation; the trailing partial batch was dropped by the Analyzer.
  const ob = arenaDataset(parseArenaDat(read('equal20/tally2_obs3.flt')));
  assert.equal(ob.kind, 'tally');
  assert.deepEqual(vec(ob.reps[0].t), [3.5, 9.5, 15.5]);
  assert.deepEqual(vec(ob.reps[0].v), [3.5, 9.5, 15.5]);
  // Time batches of 5 after truncating the first 5 minutes: midpoints in the
  // original time, and the busy flag's averages over [5,10), [10,15), [15,20).
  const tb = arenaDataset(parseArenaDat(read('equal20/tp1_trunc5_b5.flt')));
  assert.deepEqual(vec(tb.reps[0].t), [7.5, 12.5, 17.5]);
  for (const [a, b] of [[tb.reps[0].v[0], 0.7], [tb.reps[0].v[1], 0.8], [tb.reps[0].v[2], 0.7]]) near(a, b, 1e-9);
  // A moving average of 2: the mean of the previous two observations, at the
  // time of the observation it forecasts, from the third one on.
  const ma = parseArenaDat(read('equal20/tally2_ma2.fst'));
  assert.equal(ma.typeCode, 205);
  assert.equal(ma.dataFor, 'ExitTime(1)');
  const ds = arenaDataset(ma);
  assert.deepEqual(vec(ds.reps[0].t), seq(5.5, 2, 8));
  assert.deepEqual(vec(ds.reps[0].v), seq(2.5, 2, 8));
  assert.ok(ds.source.notes.some(n => /moving average/.test(n)));
});

test('the malformed "All replications" batch file: padding after the terminator is not data', () => {
  const bytes = read('equal20/tally2_all_obs3.flt');
  assert.equal(bytes.length, 304);
  assert.ok(isArenaDat(bytes));
  const d = parseArenaDat(bytes);
  assert.equal(d.reps.length, 1);
  assert.deepEqual(d.reps[0].t, [3.5, 9.5, 15.5]);
  assert.equal(d.closed, false);
  assert.equal(d.padding, 4);
  assert.equal(d.strayBytes, 15);
  const ds = arenaDataset(d);
  assert.equal(ds.reps.length, 1);
  assert.ok(ds.source.notes.some(n => /4 empty records/.test(n) && /15 stray bytes/.test(n)));
  assert.ok(!ds.source.notes.some(n => /without its closing marker/.test(n)));
});

test('warmup5/: records start at 0, the counter restarts and says so, a frequency file reads as time-persistent', () => {
  // The busy flag's trajectory is the same as without a warm-up, with a
  // doubled record at the warm-up instant that holds for no time.
  const tp = arenaDataset(parseArenaDat(read('warmup5/tp1.dat')));
  assert.equal(tp.reps[0].t[0], 0);
  assert.equal(tp.reps[0].t.length, 24);
  for (const e of vec(repEstimates(tp))) near(e, 0.75);
  // The counter's increments before the clear are in the file with their
  // running count; the count restarts at the first increment after it.
  const d = parseArenaDat(read('warmup5/counter1.dat'));
  assert.deepEqual(d.reps[0].v, [1, 2, 1, 2, 3, 4, 5, 6, 7, 8]);
  const ct = arenaDataset(d);
  assert.ok(ct.source.notes.some(n => /falls from 2 to 1 between times 3.5 and 5.5 in replication 1/.test(n)));
  assert.deepEqual(vec(repEstimates(arenaFinalCounts(d))), [8, 8, 8]);
  // A frequency statistic (207) on the same expression: the same step
  // function as the busy flag, 24 records per replication.
  const f = parseArenaDat(read('warmup5/freq1.dat'));
  assert.equal(f.typeCode, 207);
  assert.equal(f.typeName, 'frequency');
  assert.equal(f.dataFor, 'Frequency 1');
  const fd = arenaDataset(f);
  assert.equal(fd.kind, 'time');
  assert.equal(fd.reps[0].t.length, 24);
  for (const e of vec(repEstimates(fd))) near(e, 0.75);
  assert.ok(fd.source.notes.some(n => /frequency statistic/.test(n)));
  // A tally file carries no trace of the warm-up.
  const ta = arenaDataset(parseArenaDat(read('warmup5/tally2.dat')));
  assert.deepEqual(vec(ta.reps[0].t), seq(1.5, 2, 10));
});

test('unequal/: replications ending at 10, 20, and 30 each average over their own run', () => {
  const tp = arenaDataset(parseArenaDat(read('unequal/tp1.dat')));
  assert.equal(tp.endTime, null);
  assert.deepEqual(tp.reps.map(r => r.t[r.t.length - 1]), [10, 20, 30]);
  for (const e of vec(repEstimates(tp))) near(e, 0.75);
  assert.ok(tp.source.notes.some(n => /different times \(10 to 30\)/.test(n)));
  const ct = arenaDataset(parseArenaDat(read('unequal/counter1.dat')));
  assert.deepEqual(ct.reps.map(r => r.t[r.t.length - 1]), [9.5, 19.5, 29.5]);
  near(repEstimates(ct)[0], 20 / 9.5);
  near(repEstimates(ct)[2], 2 * 105 / 29.5);
  const fc = arenaFinalCounts(parseArenaDat(read('unequal/counter1.dat')));
  assert.deepEqual(vec(repEstimates(fc)), [5, 10, 15]);
  const ta = arenaDataset(parseArenaDat(read('unequal/tally2.dat')));
  assert.deepEqual(ta.reps.map(r => r.v.length), [5, 10, 15]);
  assert.deepEqual(vec(repEstimates(ta)), [5.5, 10.5, 15.5]);
});

test('tally1.dat: three empty replications are refused with the statistic named', () => {
  const d = parseArenaDat(read('equal20/tally1.dat'));
  assert.equal(d.typeCode, 203);
  assert.equal(d.reps.length, 3);
  assert.ok(d.reps.every(r => r.v.length === 0));
  assert.throws(() => arenaDataset(d), /no records for “Process ExitTime”/);
});

test('a file cut off before its final terminator keeps the open replication and says so', () => {
  const whole = read('equal20/tally2.dat');
  const cut = whole.subarray(0, whole.length - 16 * 3);
  assert.ok(isArenaDat(cut));
  const d = parseArenaDat(cut);
  assert.equal(d.closed, false);
  assert.equal(d.reps.length, 3);
  assert.equal(d.reps[2].v.length, 8);
  const ds = arenaDataset(d);
  assert.ok(ds.source.notes.some(n => /closing marker/.test(n)));
});

test('an unknown type code is refused', () => {
  const d = parseArenaDat(read('equal20/output1.dat'));
  d.typeCode = 202;
  assert.throws(() => arenaDataset(d), /type code 202/);
  assert.throws(() => arenaFinalCounts(parseArenaDat(read('equal20/tally2.dat'))), /only from a counter/);
});
