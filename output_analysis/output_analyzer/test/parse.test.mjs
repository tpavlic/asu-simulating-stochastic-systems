// Tests for js/io/parse.js. Each input file is written out in the test, and
// each expected count, line number, and value is read off that text by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCells, parseRows, sniff, buildDatasets, wideResponses } from '../js/io/parse.js';
import { repEstimates, makeDataset } from '../js/data/model.js';
import { datasetsObservationsCsv } from '../js/io/export.js';
import { EXAMPLES } from '../js/data/examples.js';

const vec = a => Array.from(a);

test('splitCells: every delimiter, trimming, and quoted cells', () => {
  assert.deepEqual(splitCells('1,2,3'), ['1', '2', '3']);
  assert.deepEqual(splitCells('1\t2;3'), ['1', '2', '3']);
  assert.deepEqual(splitCells('  1    2   3  '), ['1', '2', '3']);
  assert.deepEqual(splitCells('1, 2 ,3'), ['1', '2', '3']);
  assert.deepEqual(splitCells('1,,2'), ['1', '2']);
  assert.deepEqual(splitCells('"a, b",2'), ['a, b', '2']);
  assert.deepEqual(splitCells('"say ""hi""";4'), ['say "hi"', '4']);
});

test('parseRows: blanks, CRLF, NaN and Inf are non-numeric', () => {
  const p = parseRows('1,2\r\n\r\nNaN,3\r\nInf,-Inf\r\n4,5e-1\r\n');
  assert.equal(p.blanks, 1);
  assert.equal(p.rows.length, 4);
  assert.deepEqual(p.rows.map(r => r.line), [1, 3, 4, 5]);
  assert.deepEqual(p.rows[0].nums, [1, 2]);
  assert.equal(p.rows[1].nums, null);
  assert.equal(p.rows[2].nums, null);
  assert.deepEqual(p.rows[3].nums, [4, 0.5]);
  assert.deepEqual(p.rows[3].cells, ['4', '5e-1']);
});

test('sniff: header, comments, blank lines, and CRLF', () => {
  const text = '# written by a simulation\r\nrep,value\r\n\r\n1,4.5\r\n1,5.5\r\n# a note\r\n2,6\r\n\r\n';
  const s = sniff(text, { name: 'out' });
  assert.deepEqual(s.header, ['rep', 'value']);
  assert.equal(s.comments, 2);
  assert.equal(s.blanks, 2);
  assert.equal(s.format, 'columns');
  assert.deepEqual(s.numericCols, [0, 1]);
  assert.deepEqual(s.issues, []);
  assert.deepEqual(s.suggested, { kind: 'tally', value: 1, time: null, rep: 0, scenario: null, name: 'out', endTime: null });
  const { datasets } = buildDatasets(s, s.suggested);
  assert.equal(datasets.length, 1);
  assert.equal(datasets[0].response, 'value');
  assert.deepEqual(datasets[0].reps.map(r => r.id), [1, 2]);
  // rep 1: (4.5 + 5.5)/2 = 5; rep 2: 6
  assert.deepEqual(vec(repEstimates(datasets[0])), [5, 6]);
});

test('sniff: a single column is replication-level data', () => {
  const s = sniff('3.1\n2.9\n3.4\n');
  assert.equal(s.format, 'single');
  assert.equal(s.header, null);
  assert.equal(s.suggested.kind, 'reps');
  assert.equal(s.suggested.value, 0);
  const { datasets } = buildDatasets(s, s.suggested);
  assert.deepEqual(datasets[0].reps.map(r => r.id), [1, 2, 3]);
  assert.deepEqual(vec(repEstimates(datasets[0])), [3.1, 2.9, 3.4]);
  // the same column read as one replication of tally observations
  const t = buildDatasets(s, { ...s.suggested, kind: 'tally' }).datasets[0];
  assert.equal(t.reps.length, 1);
  assert.deepEqual(vec(t.reps[0].v), [3.1, 2.9, 3.4]);
});

test('minus1: three replications delimited by -1', () => {
  const text = [
    '0 1', '2 3', '-1 0',      // lines 1-3: replication 1
    '0 2', '-1 0',             // lines 4-5: replication 2
    '0 5', '1 4', '3 1', '-1 0' // lines 6-9: replication 3
  ].join('\n');
  const s = sniff(text);
  assert.equal(s.format, 'minus1');
  assert.equal(s.suggested.kind, null);
  assert.equal(s.suggested.value, 1);
  assert.equal(s.suggested.time, 0);
  const { datasets, issues } = buildDatasets(s, { ...s.suggested, kind: 'tally' });
  assert.deepEqual(issues, []);
  const ds = datasets[0];
  assert.equal(ds.source.format, 'minus1');
  assert.deepEqual(ds.source.notes, []);
  assert.deepEqual(ds.reps.map(r => r.id), [1, 2, 3]);
  assert.deepEqual(ds.reps.map(r => vec(r.v)), [[1, 3], [2], [5, 4, 1]]);
  assert.deepEqual(vec(ds.reps[2].t), [0, 1, 3]);
});

test('minus1: a trailing replication without -1 is kept with a note', () => {
  const s = sniff('0,1\n1,2\n-1,0\n0,7\n2,9\n');
  const ds = buildDatasets(s, { ...s.suggested, kind: 'time', endTime: 4 }).datasets[0];
  assert.equal(ds.reps.length, 2);
  assert.deepEqual(vec(ds.reps[1].v), [7, 9]);
  assert.equal(ds.source.notes.length, 1);
  assert.match(ds.source.notes[0], /line 4/);
  assert.equal(ds.endTime, 4);
  // rep 2: 7 on [0, 2), 9 on [2, 4): (14 + 18)/4 = 8
  assert.equal(repEstimates(ds)[1], 8);
});

test('minus1: two -1 rows in a row are an empty replication issue', () => {
  const s = sniff('0,1\n-1,0\n-1,0\n0,2\n-1,0\n');
  const { datasets, issues } = buildDatasets(s, { ...s.suggested, kind: 'tally' });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
  assert.match(issues[0].reason, /empty replication/);
  assert.deepEqual(datasets[0].reps.map(r => vec(r.v)), [[1], [2]]);
  assert.deepEqual(datasets[0].issues, issues);
});

test('a malformed row in the middle is reported and nothing else is dropped', () => {
  const text = 'rep,value\n1,2.0\n1,3.0\n1,abc\n2,4.0\n2,5.0,6\n2,6.0\n';
  const s = sniff(text);
  assert.deepEqual(s.issues.map(i => i.line), [4, 6]);
  assert.match(s.issues[0].reason, /non-numeric/);
  assert.equal(s.issues[0].text, '1,abc');
  assert.match(s.issues[1].reason, /expected 2 cells, found 3/);
  const { datasets, issues } = buildDatasets(s, s.suggested);
  assert.deepEqual(issues.map(i => i.line), [4, 6]);
  assert.deepEqual(datasets[0].reps.map(r => vec(r.v)), [[2, 3], [4, 6]]);
  assert.equal(datasets[0].issues.length, 2);
});

test('a later non-numeric row is an issue, not a header', () => {
  const s = sniff('1.5\n2.5\nmean\n3.5\n');
  assert.equal(s.header, null);
  assert.equal(s.format, 'single');
  assert.deepEqual(s.issues.map(i => i.line), [3]);
  assert.equal(s.rows.filter(r => r.ok).length, 3);
});

test('a wide file with three response columns', () => {
  const text = 'replication,avg_wait,max_wait,util\n1,2.0,9.0,0.8\n2,3.0,11.0,0.9\n3,4.0,10.0,0.7\n';
  const s = sniff(text, { name: 'mm1' });
  assert.equal(s.suggested.rep, 0);
  assert.equal(s.suggested.value, 1);
  assert.equal(s.suggested.kind, 'tally');
  const resp = wideResponses(s);
  assert.deepEqual(resp, [
    { col: 1, name: 'avg_wait' }, { col: 2, name: 'max_wait' }, { col: 3, name: 'util' }
  ]);
  const built = resp.map(r => buildDatasets(s, { ...s.suggested, kind: 'reps', value: r.col, name: 'mm1 · ' + r.name }).datasets[0]);
  assert.deepEqual(built.map(d => d.response), ['avg_wait', 'max_wait', 'util']);
  assert.deepEqual(vec(repEstimates(built[1])), [9, 11, 10]);
  assert.deepEqual(built[2].reps.map(r => r.id), [1, 2, 3]);
  // without a header the columns are named by position
  const h = sniff('1 2 3\n4 5 6\n');
  assert.deepEqual(wideResponses(h).map(r => r.name), ['col 1', 'col 2', 'col 3']);
});

test('a scenario column produces one dataset per scenario', () => {
  const text = 'design,rep,cost\nA,1,10\nB,1,20\nA,2,12\nB,2,22\nB,3,24\n';
  const s = sniff(text, { name: 'runs.csv' });
  assert.equal(s.suggested.scenario, 0);
  assert.equal(s.suggested.rep, 1);
  assert.equal(s.suggested.value, 2);
  assert.deepEqual(s.numericCols, [1, 2]);
  assert.deepEqual(s.issues, []);
  const { datasets } = buildDatasets(s, { ...s.suggested, kind: 'reps' });
  assert.deepEqual(datasets.map(d => d.name), ['runs.csv · A', 'runs.csv · B']);
  assert.deepEqual(vec(repEstimates(datasets[0])), [10, 12]);
  assert.deepEqual(vec(repEstimates(datasets[1])), [20, 22, 24]);
  assert.deepEqual(datasets[1].reps.map(r => r.id), [1, 2, 3]);
});

test('a text column in a file without a header is not read as a header', () => {
  const s = sniff('A,1,10\nB,1,20\n');
  assert.equal(s.header, null);
  assert.deepEqual(s.numericCols, [1, 2]);
  assert.equal(s.rows.filter(r => r.ok).length, 2);
});

test('a repeated replication id under reps is an issue', () => {
  const s = sniff('rep,y\n1,5\n2,6\n2,7\n');
  const { datasets, issues } = buildDatasets(s, { ...s.suggested, kind: 'reps' });
  assert.deepEqual(issues.map(i => i.line), [4]);
  assert.deepEqual(vec(repEstimates(datasets[0])), [5, 6]);
});

test('a replication column with unequal replication sizes', () => {
  const text = 'run\twait\n3\t1\n3\t2\n3\t3\n7\t10\n5\t4\n5\t6\n';
  const s = sniff(text);
  const ds = buildDatasets(s, s.suggested).datasets[0];
  // ids in order of first appearance; sizes 3, 1, 2
  assert.deepEqual(ds.reps.map(r => r.id), [3, 7, 5]);
  assert.deepEqual(ds.reps.map(r => r.v.length), [3, 1, 2]);
  // means: (1+2+3)/3 = 2, 10, (4+6)/2 = 5
  assert.deepEqual(vec(repEstimates(ds)), [2, 10, 5]);
});

test('time data: a decrease in time is an issue and the row is dropped', () => {
  const text = 'rep,time,queue\n1,0,0\n1,2,1\n1,1.5,4\n1,3,2\n2,0,1\n';
  const s = sniff(text);
  assert.equal(s.suggested.time, 1);
  assert.equal(s.suggested.kind, null);
  assert.throws(() => buildDatasets(s, s.suggested));
  assert.throws(() => buildDatasets(s, { ...s.suggested, kind: 'time', time: null }));
  const { datasets, issues } = buildDatasets(s, { ...s.suggested, kind: 'time', endTime: 5 });
  assert.deepEqual(issues.map(i => i.line), [4]);
  assert.match(issues[0].reason, /earlier/);
  const ds = datasets[0];
  assert.deepEqual(vec(ds.reps[0].t), [0, 2, 3]);
  assert.deepEqual(vec(ds.reps[0].v), [0, 1, 2]);
  // rep 1: 0 on [0,2), 1 on [2,3), 2 on [3,5): (0 + 1 + 4)/5 = 1; rep 2: 1 on [0,5) = 1
  assert.deepEqual(vec(repEstimates(ds)), [1, 1]);
});

// The all-dataset observations file, read back through the delimited-columns
// path. The importer names each dataset "<file base> · <dataset>" and gives it
// the response "value", and it drops blank cells, so the round trip holds for
// a file whose datasets are of one kind and all have, or all lack, times.
function roundTrip(group, kind, endTime) {
  const text = datasetsObservationsCsv(group, { exported: '2026-10-07 12:00:00' });
  const s = sniff(text, { name: 'datasets_observations' });
  assert.deepEqual(s.issues, []);
  assert.equal(s.suggested.scenario, 0);
  const { datasets, issues } = buildDatasets(s, { ...s.suggested, kind, endTime });
  assert.deepEqual(issues, []);
  assert.equal(datasets.length, group.length);
  group.forEach((orig, i) => {
    const back = datasets[i];
    const prefix = 'datasets_observations · ';
    assert.ok(back.name.startsWith(prefix), back.name);
    assert.equal(back.name.slice(prefix.length), orig.name);
    assert.equal(back.kind, orig.kind);
    assert.equal(back.response, 'value');
    assert.equal(back.endTime, orig.endTime);
    assert.deepEqual(back.reps.map(r => r.id), orig.reps.map(r => r.id), orig.name);
    assert.deepEqual(back.reps.map(r => (r.t ? vec(r.t) : null)), orig.reps.map(r => (r.t ? vec(r.t) : null)), orig.name);
    assert.deepEqual(back.reps.map(r => vec(r.v)), orig.reps.map(r => vec(r.v)), orig.name);
  });
}

test('the bundled examples round-trip through the all-dataset observations file', () => {
  const groups = new Map();
  for (const ex of EXAMPLES) {
    const built = buildDatasets(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).datasets;
    for (const ds of built) {
      ds.source.file = ex.file;
      // The importer applies one end time to a whole file, and so time-persistent
      // examples with different end times travel in files of their own.
      const key = ds.kind + (ds.reps.some(r => r.t) ? ' timed' : ' untimed') + (ds.kind === 'time' ? ' to ' + ds.endTime : '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ds);
    }
  }
  // reps without times (seven examples), tally with times (two), time-persistent ending at 480 and at 600 (one each)
  assert.deepEqual([...groups.keys()].sort(), ['reps untimed', 'tally timed', 'time timed to 480', 'time timed to 600']);
  assert.equal(groups.get('reps untimed').length, 22);
  for (const [key, group] of groups) {
    const ends = new Set(group.map(ds => ds.endTime));
    assert.equal(ends.size, 1, key);
    roundTrip(group, group[0].kind, group[0].endTime);
  }
});

// What datasetsObservationsCsv's JSDoc says does not come back, and the one
// case that does.
test('names that do and do not survive the round trip', () => {
  const back = name => {
    const group = [makeDataset({ name, kind: 'tally', reps: [{ id: 1, v: [1, 2] }] }),
      makeDataset({ name: 'other', kind: 'tally', reps: [{ id: 1, v: [3] }] })];
    const s = sniff(datasetsObservationsCsv(group), { name: 'f' });
    const { datasets } = buildDatasets(s, { ...s.suggested, kind: 'tally' });
    return { names: datasets.map(d => d.name), issues: s.issues.map(i => i.reason) };
  };
  // Leading and trailing spaces are kept in the quoted field.
  assert.deepEqual(back('  lead').names, ['f ·   lead', 'f · other']);
  assert.deepEqual(back('trail  ').names, ['f · trail  ', 'f · other']);
  // An empty name is a blank cell, and each of its rows is one cell short.
  assert.deepEqual(back(''), { names: ['f · other'], issues: ['expected 3 cells, found 2', 'expected 3 cells, found 2'] });
  // A line break splits each row in two: the first half is rejected and the
  // second is read under a different name.
  const broken = back('a\nb');
  assert.deepEqual(broken.issues, ['expected 3 cells, found 1', 'expected 3 cells, found 1']);
  assert.ok(!broken.names.includes('f · a\nb'));
  assert.equal(broken.names.length, 2);
});

test('a dataset name with a space and a semicolon survives the round trip', () => {
  const group = [
    makeDataset({ name: 'Line 1; shift A', kind: 'tally', reps: [{ id: 1, v: [3, 4] }, { id: 2, v: [5] }] }),
    makeDataset({ name: 'Line 2, "night"', kind: 'tally', reps: [{ id: 1, v: [6] }] })
  ];
  const text = datasetsObservationsCsv(group);
  assert.match(text, /^"Line 1; shift A",1,3$/m);
  roundTrip(group, 'tally', null);
});
