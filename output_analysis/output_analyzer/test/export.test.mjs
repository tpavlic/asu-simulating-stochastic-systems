// Tests for js/io/export.js: the shape of every CSV writer's output. Expected
// values are the tiny inputs written out here, or sums of them worked by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset } from '../js/data/model.js';
import {
  csvEscape, toCsv, provenanceLines, observationsCsv, repSummaryCsv,
  batchMeansCsv, tableCsv, svgToString, svgToPngBlob, downloadText, downloadBlob,
  datasetsObservationsCsv, datasetsReplicationsCsv, sampledCsv, slug, csvHead
} from '../js/io/export.js';

const lines = text => text.split('\n').filter(l => l !== '');

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

// The all-dataset files. Each name below forces a different quoting case: a
// comma and a quote, a bare word, and a space (which the importer would
// otherwise split on).
const allTally = makeDataset({ name: 'Queue, "A"', kind: 'tally', response: 'wait', source: { file: 'queue.csv' },
  reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }] });
const allTime = makeDataset({ name: 'Busy', kind: 'time', response: 'busy', endTime: 10,
  reps: [{ id: 1, t: [0, 4], v: [0, 1] }] });
const allReps = makeDataset({ name: 'Queue days', kind: 'reps', response: 'avg_wait',
  reps: [{ id: 1, v: [2.5] }, { id: 2, v: [3] }] });
const allOpen = makeDataset({ name: 'Open', kind: 'time', response: 'busy',
  reps: [{ id: 1, t: [0, 2], v: [1, 0] }] });
const dataRows = text => lines(text).filter(l => !l.startsWith('#'));

test('all-dataset observations: one row per record, names quoted', () => {
  assert.deepEqual(dataRows(datasetsObservationsCsv([allTally, allTime])), [
    'dataset,replication,time,value',
    '"Queue, ""A""",1,,1',
    '"Queue, ""A""",1,,2',
    '"Busy",1,0,0',
    '"Busy",1,4,1'
  ]);
});

test('all-dataset observations: no time column when no dataset has times', () => {
  assert.deepEqual(dataRows(datasetsObservationsCsv([allTally, allReps])), [
    'dataset,replication,value',
    '"Queue, ""A""",1,1',
    '"Queue, ""A""",1,2',
    '"Queue days",1,2.5',
    '"Queue days",2,3'
  ]);
});

test('all-dataset replications: blank mean for an empty replication', () => {
  assert.deepEqual(dataRows(datasetsReplicationsCsv([allTally, allTime])), [
    'dataset,kind,replication,n_obs,mean',
    '"Queue, ""A""",tally,1,2,1.5',
    '"Queue, ""A""",tally,2,0,',
    // (0 x 4 + 1 x 6) / 10 = 0.6
    '"Busy",time,1,2,0.6'
  ]);
  const spaced = dataRows(datasetsReplicationsCsv([allReps])).slice(1);
  assert.deepEqual(spaced, ['"Queue days",reps,1,1,2.5', '"Queue days",reps,2,1,3']);
  assert.ok(dataRows(datasetsObservationsCsv([allReps])).slice(1).every(l => l.startsWith('"Queue days",')));
});

test('provenance names every dataset and the time-persistent end time', () => {
  const datasetLines = [
    '# dataset 1: Queue, "A" (tally, response wait, source queue.csv)',
    '# dataset 2: Busy (time-persistent, response busy, end time 10)',
    '# dataset 3: Open (time-persistent, response busy, end time none)'
  ];
  const head = write => lines(write([allTally, allTime, allOpen], { exported: '2026-10-07 12:00:00' })).filter(l => l.startsWith('#'));
  assert.deepEqual(head(datasetsObservationsCsv), [...datasetLines, '# exported: 2026-10-07 12:00:00']);
  // The replications file also says what its mean column holds, once for
  // each kind in the list.
  assert.deepEqual(head(datasetsReplicationsCsv), [
    ...datasetLines,
    '# mean (tally): replication mean',
    '# mean (time-persistent): time-weighted replication mean',
    '# exported: 2026-10-07 12:00:00'
  ]);
});

test('all-dataset replications: the mean lines name only the kinds present, in a fixed order', async () => {
  const { ESTIMATE_LABEL, KIND_LABEL } = await import('../js/data/model.js');
  const head = list => lines(datasetsReplicationsCsv(list)).filter(l => l.startsWith('# mean'));
  assert.deepEqual(head([allReps, allTime]), [
    '# mean (' + KIND_LABEL.time + '): ' + ESTIMATE_LABEL.time,
    '# mean (' + KIND_LABEL.reps + '): ' + ESTIMATE_LABEL.reps
  ]);
  assert.deepEqual(head([allReps]), ['# mean (replication values): one value per replication']);
  assert.deepEqual(head([]), []);
});

// R's read.csv(comment.char = "#") ends a line at an unquoted '#', and so a
// data file quotes any field holding one; result tables and csvEscape's
// other callers are unchanged.
test('data files quote a field holding #', () => {
  const hashed = makeDataset({ name: 'Runs #', kind: 'tally', response: 'wait #', endTime: null,
    reps: [{ id: 'run#1', t: [0, 1], v: [1, 2] }, { id: '#2', t: [0], v: [3] }, { id: 'a,#', t: [], v: [] }] });
  assert.deepEqual(dataRows(observationsCsv(hashed, {}, { full: true })), [
    'replication,time,"wait #"', '"run#1",0,1', '"run#1",1,2', '"#2",0,3'
  ]);
  assert.deepEqual(dataRows(observationsCsv(hashed)), ['"wait #"', '1', '2', '3']);
  assert.deepEqual(dataRows(repSummaryCsv(hashed)).map(l => l.split(',')[0]), ['replication', '"run#1"', '"#2"', '"a']);
  assert.ok(repSummaryCsv(hashed).includes('\n"a,#",0,'), 'a field csvEscape already quotes is quoted once');
  assert.deepEqual(dataRows(datasetsReplicationsCsv([hashed])).map(l => l.split(',').slice(0, 3).join(',')),
    ['dataset,kind,replication', '"Runs #",tally,"run#1"', '"Runs #",tally,"#2"', '"Runs #",tally,"a']);
  assert.ok(dataRows(datasetsObservationsCsv([hashed]))[1].startsWith('"Runs #","run#1",0,1'));
  assert.deepEqual(dataRows(sampledCsv(hashed, { times: [0], columns: [{ id: 'run#1', values: [1] }] })), ['time,"replication_run#1"', '0,1']);
  assert.equal(csvEscape('run#1'), 'run#1');
  assert.equal(tableCsv(['id'], [['run#1']]), 'id\nrun#1\n');
});

test('slug: lower-case words joined by hyphens, at most 60 characters', () => {
  assert.equal(slug('Queue, "A"'), 'queue-a');
  assert.equal(slug('Four designs · B'), 'four-designs-b');
  assert.equal(slug('···'), 'data');
  assert.equal(slug('x'.repeat(80)).length, 60);
});

test('slug: never ends in a hyphen where the 60-character cut falls just after one', () => {
  // The cut leaves 59 letters and a hyphen, which is dropped.
  assert.equal(slug('a'.repeat(59) + ' b'), 'a'.repeat(59));
  // A run of separators is already one hyphen, and so one is all that is dropped.
  assert.equal(slug('a'.repeat(59) + ' ,; b'), 'a'.repeat(59));
  assert.equal(slug('a'.repeat(58) + ' b c'), 'a'.repeat(58) + '-b');
  for (let k = 50; k <= 62; k++) {
    const t = slug('w'.repeat(k) + ' tail ' + 'z'.repeat(20));
    assert.ok(t.length <= 60 && !/^-|-$/.test(t), t);
  }
});

test('a time-persistent data file states its end time', async () => {
  const { dsProvenance } = await import('../js/ui/exportrow.js');
  assert.equal(dsProvenance(allTime)['end time'], 10);
  assert.equal(dsProvenance(allOpen)['end time'], 'none (the last record holds for no time)');
  assert.ok(!('end time' in dsProvenance(allTally)));
  assert.match(provenanceLines(dsProvenance(allTime)).join('\n'), /^# end time: 10$/m);
});

test('result tables write an infinite number as Inf and NaN as an empty field', () => {
  const t = tableCsv(['source', 'F', 'p'], [['between', Infinity, 0], ['other', -Infinity, NaN]]);
  assert.equal(t, 'source,F,p\nbetween,Inf,0\nother,-Inf,\n');
  assert.equal(csvEscape(Infinity), '', 'data fields are unchanged');
});

test('csvHead reads the notes, the header, the first records, and a count of the rest', () => {
  const text = observationsCsv(tally, { dataset: 'wait', kind: 'tally' }, { full: true });
  const h = csvHead(text, 4);
  assert.deepEqual(h.notes, ['dataset: wait', 'kind: tally']);
  assert.deepEqual(h.header, ['replication', 'wait']);
  assert.deepEqual(h.rows, [['1', '1'], ['1', '3'], ['1', '5'], ['2', '4']]);
  assert.equal(h.more, 2);
  assert.equal(csvHead(text, 10).more, 0);
});

test('csvHead keeps empty fields and quoted commas, quotes, line breaks, and #', () => {
  const text = '# a: b\nreplication,n_obs,mean\n"run#1",3,\n"x, ""y""\nz",0,\n\n7,1,2\n';
  const h = csvHead(text, 2);
  assert.deepEqual(h.notes, ['a: b']);
  assert.deepEqual(h.rows, [['run#1', '3', ''], ['x, "y"\nz', '0', '']]);
  assert.equal(h.more, 1);
  const r = csvHead(repSummaryCsv(makeDataset({ kind: 'tally', reps: [{ id: 'a', v: [1] }, { id: 'b', v: [] }] })), 8);
  assert.deepEqual(r.rows[1], ['b', '0', '', '', '', '']);
  assert.deepEqual(csvHead('', 3), { notes: [], header: [], rows: [], more: 0 });
});
