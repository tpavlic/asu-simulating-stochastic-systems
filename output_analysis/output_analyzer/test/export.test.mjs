// Tests for js/io/export.js: the shape of every CSV writer's output. Expected
// values are the tiny inputs written out here, or sums of them worked by hand.
// The pilot CSV is read back with a minimal reader that skips `#` lines and
// non-numeric (header) lines, as a pilot-data paste box does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset } from '../js/data/model.js';
import {
  csvEscape, toCsv, provenanceLines, observationsCsv, repSummaryCsv, pilotCsv,
  batchMeansCsv, tableCsv, svgToString, svgToPngBlob, downloadText, downloadBlob
} from '../js/io/export.js';

const lines = text => text.split('\n').filter(l => l !== '');

// Numeric rows of a pasted CSV: `#` lines and any line with a non-numeric
// cell are skipped.
function readNumericColumns(text) {
  const rows = [];
  for (const line of lines(text)) {
    if (line.trim().startsWith('#')) continue;
    const cells = line.split(/[,;\t]| +/).filter(s => s !== '');
    const nums = cells.map(Number);
    if (nums.every(Number.isFinite)) rows.push(nums);
  }
  return rows;
}

const tally = makeDataset({
  name: 'wait', response: 'wait', kind: 'tally',
  reps: [{ id: 1, v: [1, 3, 5] }, { id: 2, v: [4] }, { id: 3, v: [2, 2] }]
});
const reps = makeDataset({ name: 'cost', kind: 'reps', reps: [{ v: [10] }, { v: [12] }, { v: [11] }] });

test('csvEscape and toCsv quote by RFC 4180', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a, b'), '"a, b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('two\nlines'), '"two\nlines"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(NaN), '');
  assert.equal(csvEscape(2.5), '2.5');
  assert.equal(toCsv([['a', 'b'], [1, 'x,y']]), 'a,b\n1,"x,y"\n');
});

test('provenanceLines keeps insertion order', () => {
  assert.deepEqual(
    provenanceLines({ dataset: 'wait', level: 0.95, truncation: 'none', skipped: undefined }),
    ['# dataset: wait', '# level: 0.95', '# truncation: none']
  );
});

test('repSummaryCsv for tally data carries sd, min, and max', () => {
  const out = lines(repSummaryCsv(tally, { dataset: 'wait' }));
  assert.equal(out[0], '# dataset: wait');
  assert.equal(out[1], 'replication,n_obs,mean,sd,min,max');
  // rep 1: mean 3, sd sqrt((4 + 0 + 4)/2) = 2; rep 2: one observation, sd blank;
  // rep 3: mean 2, sd 0
  assert.equal(out[2], '1,3,3,2,1,5');
  assert.equal(out[3], '2,1,4,,4,4');
  assert.equal(out[4], '3,2,2,0,2,2');
  assert.equal(out.length, 5);
});

test('repSummaryCsv for reps and time data has three columns', () => {
  assert.deepEqual(lines(repSummaryCsv(reps)), ['replication,n_obs,mean', '1,1,10', '2,1,12', '3,1,11']);
  const time = makeDataset({ kind: 'time', endTime: 4, reps: [{ id: 'r1', t: [0, 1], v: [2, 6] }] });
  // 2 on [0,1), 6 on [1,4): (2 + 18)/4 = 5
  assert.deepEqual(lines(repSummaryCsv(time)), ['replication,n_obs,mean', 'r1,2,5']);
});

test('pilotCsv: one numeric column after # and header lines', () => {
  const text = pilotCsv(tally, { dataset: 'wait', level: 0.95 });
  const out = lines(text);
  assert.deepEqual(out.slice(0, 3), ['# dataset: wait', '# level: 0.95', 'mean']);
  const rows = readNumericColumns(text);
  assert.ok(rows.every(r => r.length === 1));
  // estimates (1+3+5)/3 = 3, 4, (2+2)/2 = 2
  assert.deepEqual(rows.map(r => r[0]), [3, 4, 2]);
  assert.deepEqual(readNumericColumns(pilotCsv([7, 8, 9])).map(r => r[0]), [7, 8, 9]);
});

test('pilotCsv: the paired form has two columns over the first min length', () => {
  const text = pilotCsv([tally, reps], { pairing: 'by position' });
  const out = lines(text);
  assert.equal(out[1], 'mean_A,mean_B');
  const rows = readNumericColumns(text);
  assert.ok(rows.every(r => r.length === 2));
  assert.deepEqual(rows, [[3, 10], [4, 12], [2, 11]]);
  // vectors of unequal length are cut to the shorter
  assert.deepEqual(readNumericColumns(pilotCsv([[1, 2, 3], [4, 5]])), [[1, 4], [2, 5]]);
});

test('observationsCsv: a plain column by default, the full form on request', () => {
  assert.deepEqual(lines(observationsCsv(reps)), ['value', '10', '12', '11']);
  const full = lines(observationsCsv(tally, null, { full: true }));
  assert.equal(full[0], 'replication,wait');
  assert.equal(full[1], '1,1');
  assert.equal(full.length, 7);
  const time = makeDataset({ kind: 'time', reps: [{ id: 1, t: [0, 2], v: [1, 0] }] });
  assert.deepEqual(lines(observationsCsv(time)), ['replication,time,value', '1,0,1', '1,2,0']);
});

test('batchMeansCsv and tableCsv', () => {
  const result = { batches: [{ start: 0, end: 10, n: 10, mean: 1.5 }, { start: 10, end: 20, n: 10, mean: 2.5 }] };
  assert.deepEqual(lines(batchMeansCsv(result, { batch_size: 10 })), [
    '# batch_size: 10', 'batch,start,end,n,mean', '1,0,10,10,1.5', '2,10,20,10,2.5'
  ]);
  assert.deepEqual(lines(tableCsv(['pair', 'diff'], [['A - B', -1.25]], { comparisons: 1 })), [
    '# comparisons: 1', 'pair,diff', 'A - B,-1.25'
  ]);
});

test('browser-only functions throw without a DOM', () => {
  assert.throws(() => svgToString({}), /browser/);
  assert.throws(() => svgToPngBlob({}, 2), /browser/);
  assert.throws(() => downloadText('a.csv', 'x'), /browser/);
  assert.throws(() => downloadBlob('a.png', null), /browser/);
});

test('sampledCsv: a time column, one column per replication, empty where nothing holds', async () => {
  const { sampledCsv } = await import('../js/io/export.js');
  const ds = makeDataset({ name: 'q', kind: 'time', reps: [{ id: 1, t: [0, 2], v: [0, 1] }, { id: 'b', t: [1, 3], v: [7, 9] }] });
  const sample = { times: [0, 1, 2, 3], columns: [{ id: 1, values: [0, 0, 1, null] }, { id: 'b', values: [null, 7, 7, 9] }] };
  const text = sampledCsv(ds, sample, { dataset: 'q', form: 'sampled' });
  assert.deepEqual(lines(text), ['# dataset: q', '# form: sampled', 'time,replication_1,replication_b', '0,0,', '1,0,7', '2,1,7', '3,,9']);
});
