// The "Regenerate these results in" scripts: a recipe becomes a MATLAB, R, or
// Python script that recomputes the page's numbers and prints each beside the
// analyzer's own. The harness here writes a script, runs it where the language
// is installed, parses its report lines, and compares them with the recipe's
// `expect` map. R and Python run on every test run when installed (the full
// matrix under OA_SCRIPTS=1, one smoke script per page otherwise); MATLAB runs
// under OA_MATLAB=1 only, because its start-up takes about a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analysisScript, parseReport, scriptFileName, ascii, ANALYSIS_WRITERS } from '../js/io/analysis_scripts.js';
import { baseRecipe, outcomeVector } from '../js/io/recipes.js';
import { makeDataset } from '../js/data/model.js';
import { sniff, buildDatasets } from '../js/io/parse.js';
import { EXAMPLES } from '../js/data/examples.js';

// ── Harness ─────────────────────────────────────────────────────────────

function has(cmd, probeArgs) {
  const r = spawnSync(cmd, probeArgs, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
export const HAS = {
  R: has('Rscript', ['--version']),
  tidy: has('Rscript', ['--vanilla', '-e', 'for (p in c("tibble","dplyr","tidyr","broom","ggplot2")) if (!requireNamespace(p, quietly = TRUE)) quit(status = 1)']),
  py: has('python3', ['-c', 'import numpy, scipy']),
  m: process.env.OA_MATLAB === '1' && has('matlab', ['-batch', 'disp(1)'])
};
const FULL = process.env.OA_SCRIPTS === '1';
export const LANGS = ['R', 'tidy', 'py', 'm'];

/** Loads a bundled example into datasets, as the Import page does. */
export function example(id) {
  const ex = EXAMPLES.find(x => x.id === id);
  const sn = sniff(ex.text, { name: ex.mapping.name });
  return buildDatasets(sn, ex.mapping).datasets;
}

/** Writes the script, runs it, and returns the parsed report (or throws with the output). */
export function runScript(recipe, lang) {
  const dir = mkdtempSync(join(tmpdir(), 'oa-regen-'));
  const name = scriptFileName(recipe, lang);
  const f = join(dir, name);
  try {
    writeFileSync(f, analysisScript(recipe, lang));
    // A hung script fails its test instead of hanging the suite.
    let r;
    if (lang === 'R' || lang === 'tidy') r = spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 });
    else if (lang === 'py') r = spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) });
    else r = spawnSync('matlab', ['-batch', `cd('${dir}'); run('${name}')`], { cwd: dir, encoding: 'utf8', timeout: 600000 });
    if (r.error) throw new Error(`${lang} script did not finish (${name}): ${r.error.message}\n${r.stdout || ''}\n${r.stderr || ''}`);
    if (r.status !== 0) throw new Error(`${lang} script failed (${name}):\n${r.stdout}\n${r.stderr}`);
    return { report: parseReport(r.stdout), stdout: r.stdout, file: f };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Tolerances: a relative 1e-6 on max(1, |expected|) by default; the keys a
// language can only approximate are looser (see the spec, decision 6).
export function tolFor(key, lang) {
  if (/^posthoc .*(tukey|games)/i.test(key)) return { rel: 2e-3 };
  if (/dunnett/i.test(key)) return { rel: lang === 'R' ? 1e-5 : 5e-3 };
  if (/\bN\b|additional/.test(key)) return { abs: 1 + 1e-9 };
  if (/rinott/.test(key)) return { rel: 1e-4 };
  // A Wilcoxon interval under the normal approximation is a root found to 1e-4,
  // by a different root finder in each language.
  if (/(wilcoxon|shift|pseudo-median of differences).*(lower|upper)/.test(key)) return { rel: 2e-4 };
  return { rel: 1e-6 };
}

/** Compares a parsed report with a recipe's expect map; fails with every mismatch listed. */
export function compareReport(report, expect, lang) {
  const bad = [];
  for (const [rawKey, want] of Object.entries(expect)) {
    // "[optional]" marks a line only MATLAB may leave out (the Shapiro-Wilk
    // check, which needs a function MathWorks does not ship).
    const optional = / \[optional\]$/.test(rawKey) && lang === 'm';
    const key = rawKey.replace(/ \[optional\]$/, '');
    if (!report.has(key)) { if (!optional) bad.push(`${key}: missing`); continue; }
    if (want === null) continue;
    const got = report.get(key);
    if (typeof want === 'string') { if (String(got) !== want) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (typeof got !== 'number') { bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (Number.isNaN(want) || Number.isNaN(got)) { if (!(Number.isNaN(want) && Number.isNaN(got))) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (!Number.isFinite(want) || !Number.isFinite(got)) { if (got !== want) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    const t = tolFor(key, lang);
    const err = Math.abs(got - want);
    const ok = t.abs != null ? err <= t.abs : err <= t.rel * Math.max(1, Math.abs(want));
    if (!ok) bad.push(`${key}: got ${got}, expected ${want}`);
  }
  assert.equal(bad.length, 0, `${lang}:\n  ` + bad.join('\n  '));
}

// Why a language's run is skipped, or false to run it.
function skipFor(lang, smoke) {
  if (!HAS[lang]) return `${lang} is not installed`;
  if (!smoke && !FULL && lang !== 'm') return 'OA_SCRIPTS=1 runs the full matrix';
  return false;
}

/**
 * Runs one recipe through every installed language and compares. `smoke`
 * runs even without OA_SCRIPTS=1; `also(stdout, lang)` makes further checks
 * on a run's raw output.
 */
export function checkRecipe(name, recipe, { smoke = false, also = null } = {}) {
  for (const lang of LANGS) {
    test(`${name} regenerates in ${lang}`, { skip: skipFor(lang, smoke) }, () => {
      const { report, stdout } = runScript(recipe, lang);
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang);
      if (also) also(stdout, lang);
    });
  }
}

// ── Task 1: the skeleton ────────────────────────────────────────────────

const AWKWARD = makeDataset({ name: 'Queue "A" – 1\\2', response: 'avg_wait', unit: 'min', kind: 'reps',
  reps: [1, 2, 3, 4, 5, 6].map((id, i) => ({ id, v: [2.5 + 0.3 * i] })) });

// A name and unit no plain() mapping covers: an accent, the micro sign, and a Greek letter.
const ACCENTED = makeDataset({ name: 'Café δ-queue', response: 'délai', unit: 'µs', kind: 'reps',
  reps: [1, 2, 3, 4, 5, 6].map((id, i) => ({ id, v: [2.5 + 0.3 * i] })) });

// One replication outcome: no spread to estimate, and every quartile the value itself.
const SINGLE = makeDataset({ name: 'One day', response: 'avg_wait', unit: 'min', kind: 'reps', reps: [{ id: 7, v: [3.5] }] });

// A tally dataset whose second replication is empty and so gives no outcome.
const GAPPY = makeDataset({ name: 'Gappy', response: 'wait', kind: 'tally',
  reps: [{ id: 'a', v: [1, 2, 3] }, { id: 'b', v: [] }, { id: 'c', v: [4, 6] }] });

function descRecipe(title, ds) {
  const r = baseRecipe({ page: 'one', title, provenance: { dataset: ds.name, 'confidence level': '95%' }, level: 0.95 });
  r.data = Object.assign({ name: ds.name, response: ds.response, unit: ds.unit }, outcomeVector(ds));
  return r;
}

test('parseReport reads report lines and ignores the rest', () => {
  const m = parseReport('hello\nn: 6   (analyzer: 6)\nmean: 3.25\nflag: yes\nname: Queue "A"\nnot a line\n');
  assert.equal(m.get('n'), 6);
  assert.equal(m.get('mean'), 3.25);
  assert.equal(m.get('flag'), 1);
  assert.equal(m.get('name'), 'Queue "A"');
  assert.equal(m.size, 4);
  const s = parseReport('a: NaN   (analyzer: NaN)\nb: nan\nc: Inf\nd: -inf\ne: 1e-05\nf: -2.5E+10\ng: no\nratio 1:2: 0.5\nh: NA\n');
  assert.ok(Number.isNaN(s.get('a')) && Number.isNaN(s.get('b')));
  assert.equal(s.get('c'), Infinity);
  assert.equal(s.get('d'), -Infinity);
  assert.equal(s.get('e'), 1e-5);
  assert.equal(s.get('f'), -2.5e10);
  assert.equal(s.get('g'), 0);
  assert.equal(s.get('ratio 1:2'), 0.5);
  assert.equal(s.get('h'), 'NA', 'an R NA stays a string, and so fails a numeric compare');
});

test('the writers refuse an unknown page or language', () => {
  const r = baseRecipe({ page: 'nowhere', title: 'x', provenance: {}, level: 0.95 });
  assert.throws(() => analysisScript(r, 'R'), RangeError);
  const r2 = baseRecipe({ page: 'one', title: 'x', provenance: {}, level: 0.95 });
  r2.data = { ids: [1, 2], values: [1, 2], how: 'test', name: 'd', response: 'v', unit: '' };
  assert.throws(() => analysisScript(r2, 'julia'), RangeError);
  assert.throws(() => analysisScript(r2, 'toString'), RangeError);
});

test('every script carries the header, the choices, the data, and ASCII only', () => {
  const r = descRecipe('Interval on the mean: ' + AWKWARD.name, AWKWARD);
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('Interval on the mean'), lang + ' title');
    assert.ok(s.includes('confidence level: 95%'), lang + ' provenance');
    assert.ok(s.includes('3.4'), lang + ' data');
    assert.ok(s.includes('report'), lang + ' report helper');
  }
  assert.equal(scriptFileName(r, 'R'), 'interval-on-the-mean-queue-a-1-2-analysis.R');
  assert.equal(scriptFileName(r, 'tidy'), 'interval-on-the-mean-queue-a-1-2-analysis-tidy.R');
  assert.equal(scriptFileName(r, 'py'), 'interval-on-the-mean-queue-a-1-2-analysis.py');
  assert.equal(scriptFileName(r, 'm'), 'interval_on_the_mean_queue_a_1_2_analysis.m');
  assert.deepEqual(Object.keys(ANALYSIS_WRITERS), ['m', 'R', 'tidy', 'py']);
  assert.equal(ANALYSIS_WRITERS.m.label, 'MATLAB');
  assert.equal(ANALYSIS_WRITERS.R.label, 'Base R');
  assert.equal(ANALYSIS_WRITERS.tidy.label, 'Tidy R');
  assert.equal(ANALYSIS_WRITERS.py.label, 'Python');
  assert.ok(analysisScript(r, 'tidy').includes('library(dplyr)'));
  assert.ok(!analysisScript(r, 'R').includes('library('));
});

test('ascii folds accents, the micro sign, Greek letters, and symbols', () => {
  assert.equal(ascii('Café µs δ Σ – “q” ≤ 2'), 'Cafe us delta Sigma - "q" <= 2');
  assert.equal(ascii('a ≠ b, c ≥ d, e ≤ f'), 'a != b, c >= d, e <= f');
  assert.equal(ascii('σ² and x³'), 'sigma^2 and x^3');
  assert.equal(ascii('\u00b5 and \u03bc'), 'u and mu', 'the micro sign is "u", the Greek letter "mu"');
  assert.equal(ascii('a\u0007b\nc'), 'a b c');
  assert.equal(ascii('日本'), '??');
  assert.equal(ascii('😀'), '?');
  const r = descRecipe('Interval on the mean: ' + ACCENTED.name, ACCENTED);
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('Cafe delta-queue (delai, us)'), lang + ' folded name');
  }
  assert.equal(scriptFileName(r, 'R'), 'interval-on-the-mean-cafe-delta-queue-analysis.R');
  assert.equal(scriptFileName(r, 'm'), 'interval_on_the_mean_cafe_delta_queue_analysis.m');
  const long = descRecipe('x'.repeat(80) + ' ' + 'y'.repeat(10), AWKWARD);
  assert.ok(/^x{50}-analysis\.R$/.test(scriptFileName(long, 'R')));
  assert.ok(/^x{50}_analysis\.m$/.test(scriptFileName(long, 'm')));
});

test('a replication with no outcome is left out of the data and named in a comment', () => {
  const o = outcomeVector(GAPPY);
  assert.deepEqual(o.ids, ['a', 'c']);
  assert.deepEqual(o.values, [2, 5]);
  assert.deepEqual(o.dropped, ['b']);
  const r = descRecipe('Gaps', GAPPY);
  const R = analysisScript(r, 'R'), py = analysisScript(r, 'py'), m = analysisScript(r, 'm');
  for (const s of [R, py, m]) assert.ok(s.includes('Replications that gave no outcome were left out: b.'));
  assert.ok(R.includes('rep_id <- c("a", "c")') && R.includes('x <- c(2, 5)'));
  assert.ok(py.includes('rep_id = ["a", "c"]') && py.includes('x = np.array([2, 5])'));
  assert.ok(m.includes("rep_id = {'a', 'c'};") && m.includes('x = [2, 5];'));
});

{
  const r = descRecipe('Descriptives smoke', AWKWARD);
  r.expect = { n: 6, mean: 3.25, sd: 0.5612486080, se: 0.2291287847, min: 2.5, q1: 2.875, median: 3.25, q3: 3.625, max: 4 };
  checkRecipe('descriptives of an awkwardly named dataset', r, { smoke: true });
}

{
  const r = descRecipe('Descriptives of an accented name', ACCENTED);
  r.expect = { n: 6, mean: 3.25, sd: 0.5612486080, se: 0.2291287847, min: 2.5, q1: 2.875, median: 3.25, q3: 3.625, max: 4 };
  checkRecipe('descriptives of an accented, micro-sign dataset', r, { smoke: true });
}

{
  // One outcome: sd and se are NaN, printed "NaN" beside an analyzer value of
  // NaN, and the quartiles are the value itself, in every language.
  const r = descRecipe('Descriptives of one outcome', SINGLE);
  r.expect = { n: 1, mean: 3.5, sd: NaN, se: NaN, min: 3.5, q1: 3.5, median: 3.5, q3: 3.5, max: 3.5 };
  checkRecipe('descriptives of one replication outcome', r, {
    smoke: true,
    also: (stdout, lang) => {
      assert.match(stdout, /^sd: NaN {3}\(analyzer: NaN\)$/m, lang + ' prints a missing sd as NaN');
      assert.match(stdout, /^se: NaN {3}\(analyzer: NaN\)$/m, lang + ' prints a missing se as NaN');
      assert.match(stdout, /^q1: 3\.5 {3}\(analyzer: 3\.5\)$/m, lang + ' quartile of one value');
    }
  });
}
