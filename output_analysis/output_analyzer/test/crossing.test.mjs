// Tests for bandCrossing in js/stats/steadystate.js. Every expected value is read from
// test/reference/crossing.json, which test/reference/crossing.R computes from R's own acf: the
// first lag, of 1 to min(400, n/4), whose autocorrelation is inside the band of 2/sqrt(n). The
// series are generated in R and carried in the same JSON, apart from the bundled long run, which
// both read from the example's data file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandCrossing, ACF_MAX_LAG } from '../js/stats/steadystate.js';
import { acf } from '../js/stats/descriptive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(fs.readFileSync(path.join(here, 'reference', 'crossing.json'), 'utf8'));

function seriesOf(c) {
  if (c.y) return c.y;
  const lines = fs.readFileSync(path.join(here, '..', 'data', c.file), 'utf8').trim().split('\n').slice(1);
  return lines.map(l => Number(l.split(',')[1]));
}

for (const c of ref.cases) {
  test('bandCrossing: ' + c.name, () => {
    const y = seriesOf(c);
    const L = Math.min(ACF_MAX_LAG, Math.floor(y.length / 4));
    assert.equal(L, c.maxLag);
    const band = 2 / Math.sqrt(y.length);
    assert.ok(Math.abs(band - c.band) < 1e-15);
    assert.equal(bandCrossing(acf(y, L), band), c.crossing);
  });
}

test('bandCrossing: a constant series has no crossing lag', () => {
  assert.equal(bandCrossing(acf(new Array(50).fill(2.5), 12), 2 / Math.sqrt(50)), null);
});
