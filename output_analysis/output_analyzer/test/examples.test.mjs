// Regenerates the example datasets into a temporary directory and checks that they match the
// committed files byte for byte, and that each module entry's text equals its data file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'data', 'generate_examples.mjs');
const { EXAMPLES } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'examples.js')).href);
const { sniff, buildDatasets } = await import(pathToFileURL(path.join(ROOT, 'js', 'io', 'parse.js')).href);
const { repEstimates } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'model.js')).href);
const { levene } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { pairedT } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { applyTransform } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'transform.js')).href);

test('regenerated files match the committed ones byte for byte', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-'));
  try {
    execFileSync('node', [GEN, '--out', tmp]);
    const files = fs.readdirSync(path.join(tmp, 'data'));
    assert.equal(files.length, 12);
    for (const f of files) {
      assert.ok(fs.readFileSync(path.join(tmp, 'data', f)).equals(fs.readFileSync(path.join(ROOT, 'data', f))), f);
    }
    const mod = path.join('js', 'data', 'examples.js');
    assert.ok(fs.readFileSync(path.join(tmp, mod)).equals(fs.readFileSync(path.join(ROOT, mod))), mod);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('each entry carries its data file text and a mapping with a kind', () => {
  assert.equal(EXAMPLES.length, 12);
  for (const e of EXAMPLES) {
    assert.equal(e.text, fs.readFileSync(path.join(ROOT, 'data', e.file), 'utf8'), e.file);
    assert.ok(['tally', 'time', 'reps'].includes(e.mapping.kind), e.id);
    assert.equal(e.mapping.kind, e.kind);
    assert.ok(['minus1', 'columns'].includes(e.format));
  }
});

// The two proportion examples exist to show which transform evens out the
// designs' spreads, and so their descriptions' claims are pinned here: Levene's
// test rejects equal spreads on the raw outcomes, and stops rejecting under
// the transform each description names, but not under the other.
test('the service-level and utilization examples show the transforms their descriptions name', () => {
  const p = (id, tf) => {
    const ex = EXAMPLES.find(e => e.id === id);
    const groups = buildDatasets(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).datasets.map(d => applyTransform(repEstimates(d), tf).values);
    return levene(groups).p;
  };
  assert.ok(p('service-level', 'none') < 0.01 && p('service-level', 'logit') > 0.5 && p('service-level', 'asin_sqrt') < 0.05);
  assert.ok(p('utilization', 'none') < 0.01 && p('utilization', 'log') > 0.5 && p('utilization', 'asin_sqrt') < 0.01 && p('utilization', 'logit') < 0.01);
});

// The oven example's description says that the choice of output decides the comparison: paired
// across the shared demand streams, the time in system cannot tell the policies apart, and the
// muffins unfinished, loaded through the dialog in its place, favor the nearly full policy.
test('the muffin-oven example shows the outputs disagreeing, as its description says', () => {
  const ex = EXAMPLES.find(e => e.id === 'muffin-oven');
  const sn = sniff(ex.text, { name: ex.mapping.name });
  const paired = value => {
    const [greedy, full] = buildDatasets(sn, Object.assign({}, ex.mapping, { value })).datasets.map(repEstimates);
    assert.equal(greedy.length, 10);
    return pairedT(full, greedy, 0.95);
  };
  assert.deepEqual(sn.header, ['policy', 'replication', 'avg_time_in_system', 'utilization', 'max_waiting', 'unfinished']);
  const tis = paired(2), left = paired(5);
  assert.ok(tis.p > 0.2, 'time in system p ' + tis.p);
  assert.ok(left.p < 0.05 && left.meanD < 0, 'unfinished p ' + left.p + ', mean difference ' + left.meanD);
});
