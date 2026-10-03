// The figure-script writers: each of the three languages gets a script
// holding every kind of series the plots record, the scripts carry the data
// and labels, and, where R and Python are installed, each script runs
// without error and draws something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matlabScript, rScript, pythonScript, normalizeSpec, sanitizeName } from '../js/io/scripts.js';

const spec = {
  name: 'queue days – estimates/histogram',
  title: 'Every kind of mark',
  xLabel: 'Replication mean of avg_wait',
  yLabel: 'Count',
  xlim: [0, 10],
  ylim: [-2, 8],
  xTicks: null,
  yTicks: { at: [1, 2, 3], labels: ['design 1', 'design "two"', "it's 3"] },
  series: [
    { kind: 'bars', edges: [0, 2, 4, 6, 8, 10], heights: [1, 3, 5, 2, 0], label: 'counts', color: '#D97A3F' },
    { kind: 'points', x: Float64Array.from([1, 2, 3, NaN, 5]), y: [1, 4, 2, 3, 5], label: 'estimates', color: '#D97A3F' },
    { kind: 'points', x: [1.5, 2.5], y: [1, 1], label: 'hollow', color: '#1F77B4', hollow: true, marker: 'd' },
    { kind: 'line', x: [0, 2, 4, 6, 8, 10], y: [0, 1, 0.5, 2, 1.5, 3], label: 'a line', color: '#1F77B4', width: 2 },
    { kind: 'step', x: [0, 1, 2, 3, 10], y: [0, 0.25, 0.5, 1, 1], label: 'empirical cdf', color: '#8C1D40', dash: true },
    { kind: 'hline', y: 2.5, label: 'reference', color: '#555555', dash: true },
    { kind: 'vline', x: 7, color: '#555555', dash: 'dotted' },
    { kind: 'segments', x0: [1, 2], y0: [6, 6], x1: [3, 4], y1: [7, 5], label: 'pairs', color: '#8C1D40' },
    { kind: 'band', x: [0, 5, 10], lo: [-1, -0.5, -1], hi: [0, 0.5, 0], label: 'band', color: '#1F77B4' },
    { kind: 'span', x0: 0, x1: 1.5, label: 'excluded', color: '#999999' },
    { kind: 'rects', x0: [5, 6], y0: [6, 7], x1: [6, 7], y1: [7, 8], color: '#D97A3F' },
    { kind: 'text', x: [9, 9.5], y: [7, 6], text: ['a', 'b'], color: '#8C1D40', anchor: 'middle' },
    { kind: 'bogus', x: [1] }
  ]
};

test('normalizeSpec cleans the name, drops unknown kinds, and fills missing limits', () => {
  const n = normalizeSpec(spec);
  assert.equal(n.name, 'queue_days_estimates_histogram');
  assert.equal(n.series.length, spec.series.length - 1);
  assert.equal(sanitizeName('1st-figure'), 'fig_1st_figure');
  assert.equal(sanitizeName(''), 'figure');
  const rows = normalizeSpec({ name: 'r', yTicks: { at: [3, 2, 1], labels: ['top', 'mid', 'low'] }, series: [] });
  assert.deepEqual(rows.yTicks, { at: [1, 2, 3], labels: ['low', 'mid', 'top'] });
  const auto = normalizeSpec({ name: 'a', series: [{ kind: 'points', x: [1, 3], y: [2, 2] }] });
  assert.ok(auto.xlim[0] < 1 && auto.xlim[1] > 3);
  assert.ok(auto.ylim[0] < 2 && auto.ylim[1] > 2);
  assert.throws(() => normalizeSpec(null), TypeError);
});

test('each script carries the data, the labels, and the save hint', () => {
  const m = matlabScript(spec), r = rScript(spec), py = pythonScript(spec);
  for (const [s, nan] of [[m, 'NaN'], [r, 'NA'], [py, 'np.nan']]) {
    assert.ok(s.includes('Every kind of mark'));
    assert.ok(s.includes('Replication mean of avg_wait'));
    assert.ok(s.includes('empirical cdf'));
    assert.ok(s.includes('1, 2, 3, ' + nan + ', 5'), 'NaN spelled ' + nan);
    assert.ok(s.includes('queue_days_estimates_histogram.'));
    assert.ok(!/[–’]/.test(s), 'typographic characters are replaced');
  }
  assert.ok(m.includes("'design \"two\"'") && m.includes("'it''s 3'"));
  assert.ok(r.includes('"design \\"two\\""') && r.includes('"it\'s 3"'));
  assert.ok(py.includes('"design \\"two\\""'));
  // A long vector wraps, and MATLAB's continuation marks every break.
  const long = { name: 'long', series: [{ kind: 'line', x: Array.from({ length: 200 }, (_, i) => i / 7), y: Array.from({ length: 200 }, (_, i) => Math.sin(i)), color: '#000000' }] };
  const ml = matlabScript(long);
  const inside = ml.slice(ml.indexOf('x1 = ['), ml.indexOf('];'));
  assert.ok(inside.split('\n').length > 3);
  for (const line of inside.split('\n').slice(0, -1)) assert.ok(line.endsWith(' ...'), 'MATLAB continuation: ' + line.slice(-10));
});

const dir = mkdtempSync(join(tmpdir(), 'oa-scripts-'));
const has = cmd => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;

test('the R script runs under Rscript', { skip: !has('Rscript') && 'Rscript is not installed' }, () => {
  const f = join(dir, 'fig.R');
  writeFileSync(f, rScript(spec));
  const r = spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, 'Rplots.pdf')) && statSync(join(dir, 'Rplots.pdf')).size > 500, 'R drew a page');
});

test('the Python script runs under matplotlib', { skip: !has('python3') && 'python3 is not installed' }, () => {
  const probe = spawnSync('python3', ['-c', 'import matplotlib, numpy'], { encoding: 'utf8' });
  if (probe.status !== 0) return;
  const f = join(dir, 'fig.py');
  writeFileSync(f, pythonScript(spec).replace('plt.show()', 'fig.savefig("fig.png", dpi=50)'));
  const r = spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, 'fig.png')) && statSync(join(dir, 'fig.png')).size > 500, 'matplotlib drew a page');
});
