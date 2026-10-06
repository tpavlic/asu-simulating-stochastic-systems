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
import { baseRecipe, outcomeVector, oneRecipe, twoRecipe } from '../js/io/recipes.js';
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

/** Writes the script, runs it, and returns the parsed report and both output streams (or throws with the output). */
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
    return { report: parseReport(r.stdout), stdout: r.stdout, stderr: r.stderr || '', file: f };
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
    // check, whose swtest the toolbox has only from R2026b).
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
 * runs even without OA_SCRIPTS=1; `also(stdout, lang, stderr)` makes further
 * checks on a run's raw output.
 */
export function checkRecipe(name, recipe, { smoke = false, also = null } = {}) {
  for (const lang of LANGS) {
    test(`${name} regenerates in ${lang}`, { skip: skipFor(lang, smoke) }, () => {
      const { report, stdout, stderr } = runScript(recipe, lang);
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang);
      if (also) also(stdout, lang, stderr);
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

// The One System recipe of a dataset's replication outcomes, as the page
// builds it with planning off, under a given title.
function descRecipe(title, ds) {
  const o = outcomeVector(ds);
  return oneRecipe({ ds, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, base: 0.95, title,
    provenance: { dataset: ds.name, 'confidence level': '95%' }, plan: null });
}

// The descriptives every Task 1 smoke fixture pins, checked against the recipe's own.
function assertDescriptives(r, want) {
  for (const [k, v] of Object.entries(want)) {
    if (Number.isNaN(v)) assert.ok(Number.isNaN(r.expect[k]), k);
    else assert.ok(Math.abs(r.expect[k] - v) <= 1e-9 * Math.max(1, Math.abs(v)), k + ': ' + r.expect[k] + ' vs ' + v);
  }
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

const SIX = { n: 6, mean: 3.25, sd: 0.5612486080, se: 0.2291287847, min: 2.5, q1: 2.875, median: 3.25, q3: 3.625, max: 4 };

{
  const r = descRecipe('Descriptives smoke', AWKWARD);
  assertDescriptives(r, SIX);
  checkRecipe('One System on an awkwardly named dataset', r, { smoke: true });
}

{
  const r = descRecipe('Descriptives of an accented name', ACCENTED);
  assertDescriptives(r, SIX);
  checkRecipe('One System on an accented, micro-sign dataset', r, { smoke: true });
}

{
  // One outcome: sd and se are NaN, printed "NaN" beside an analyzer value of
  // NaN, and the quartiles are the value itself, in every language. With no
  // spread to estimate, the recipe holds the descriptives only.
  const r = descRecipe('Descriptives of one outcome', SINGLE);
  assertDescriptives(r, { n: 1, mean: 3.5, sd: NaN, se: NaN, min: 3.5, q1: 3.5, median: 3.5, q3: 3.5, max: 3.5 });
  assert.deepEqual(Object.keys(r.expect), ['n', 'mean', 'sd', 'se', 'min', 'q1', 'median', 'q3', 'max']);
  checkRecipe('descriptives of one replication outcome', r, {
    smoke: true,
    also: (stdout, lang) => {
      assert.match(stdout, /^sd: NaN {3}\(analyzer: NaN\)$/m, lang + ' prints a missing sd as NaN');
      assert.match(stdout, /^se: NaN {3}\(analyzer: NaN\)$/m, lang + ' prints a missing se as NaN');
      assert.match(stdout, /^q1: 3\.5 {3}\(analyzer: 3\.5\)$/m, lang + ' quartile of one value');
    }
  });
}

// ── Task 2: One System ──────────────────────────────────────────────────

const QUEUE = example('queue-reps')[0];   // 20 replication values of avg_wait
const PLAN = { relative: true, rel: 10, abs: null, delta: 0.3, power: 0.8 };
const queueX = () => QUEUE.reps.map(p => p.v[0]);
const queueIds = () => QUEUE.reps.map(p => p.id);
// The provenance the page registers, which the recipe copies.
const oneProv = (ds, level, proc) => ({ dataset: ds.name, 'confidence level': Math.round(level * 1000) / 10 + '%',
  procedure: proc === 'np' ? 'Wilcoxon signed-rank (nonparametric)' : 't interval', 'unit of inference': 'replication means' });

test('oneRecipe carries the data, the choices, and every expect key of the t path', () => {
  const prov = oneProv(QUEUE, 0.95, 't');
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, base: 0.95, provenance: prov, plan: PLAN });
  assert.equal(r.page, 'one');
  assert.equal(r.title, 'Interval on the mean: ' + QUEUE.name);
  assert.deepEqual(r.provenance, prov);
  assert.notEqual(r.provenance, prov, 'the provenance is copied');
  assert.equal(r.data.values.length, 20);
  for (const k of ['n', 'mean', 'df', 't quantile', 'lower', 'upper', 'shapiro W [optional]', 's2', 'sd upper', 'plan n for half-width', 'plan n for power', 'power at current R']) assert.ok(k in r.expect, k);
  assert.ok(!('pseudo-median' in r.expect));
  assert.ok(!('plan n for power (rank)' in r.expect));
  assert.ok(r.expect['plan half-width target'] > 0);
  assert.deepEqual(Object.keys(r.settings), ['plan_h', 'plan_delta', 'plan_power']);
  const s = analysisScript(r, 'R');
  assert.ok(s.includes('t.test('), 'R uses t.test');
  assert.ok(s.includes('shapiro.test('), 'R uses shapiro.test');
  for (const lang of LANGS) assert.ok(/^[\x00-\x7f]*$/.test(analysisScript(r, lang)), lang + ' script is not ASCII');
});

test('oneRecipe under the Wilcoxon procedure: no t interval, no check, and rank-inflated plans', () => {
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.9, base: 0.9, provenance: oneProv(QUEUE, 0.9, 'np'), plan: PLAN });
  assert.equal(r.title, 'Interval on the pseudo-median: ' + QUEUE.name);
  assert.equal(r.expect.exact, 1);
  assert.ok('achieved level' in r.expect && !('df' in r.expect) && !('shapiro W [optional]' in r.expect));
  assert.ok(r.expect['plan n for power (rank)'] >= r.expect['plan n for power']);
  const R = analysisScript(r, 'R');
  assert.ok(R.includes('wilcox.test(') && R.includes('exact = exact, correct = TRUE'));
});

{
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, base: 0.95, provenance: oneProv(QUEUE, 0.95, 't'), plan: PLAN });
  checkRecipe('One System, t interval on queue-reps', r, { smoke: true });
  const rn = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.90, base: 0.90, provenance: oneProv(QUEUE, 0.9, 'np'),
    plan: { relative: false, rel: 10, abs: 0.25, delta: 0.5, power: 0.9 } });
  checkRecipe('One System, Wilcoxon on queue-reps (exact)', rn);
}

// Review Focus 1: a replication that gave no outcome is left out and named.
{
  const ds = makeDataset({ name: 'gappy', response: 'wait', kind: 'tally', reps: [{ id: 1, v: [1, 2, 3] }, { id: 2, v: [] }, { id: 3, v: [2, 2, 5] }, { id: 4, v: [4] }] });
  const o = outcomeVector(ds);
  assert.deepEqual(o.dropped, [2]);
  const r = oneRecipe({ ds, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, base: 0.95, provenance: oneProv(ds, 0.95, 't'), plan: null });
  assert.equal(r.expect.n, 3);
  assert.ok(analysisScript(r, 'py').includes('left out: 2'));
  checkRecipe('One System on a dataset with an empty replication', r);
}

// Review Focus 2: ties and n >= 50 put the Wilcoxon interval on the normal approximation.
{
  const tied = makeDataset({ name: 'tied', response: 'v', kind: 'reps', reps: [3, 3, 4, 5, 5, 5, 6, 7, 7, 9].map((v, i) => ({ id: i + 1, v: [v] })) });
  const r = oneRecipe({ ds: tied, x: tied.reps.map(p => p.v[0]), ids: tied.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, base: 0.95, provenance: oneProv(tied, 0.95, 'np'), plan: null });
  assert.equal(r.expect.exact, 0);
  checkRecipe('One System, Wilcoxon with ties (normal approximation)', r);
  // Sixty distinct outcomes, so that only n >= 50 sends the procedure to the approximation.
  const vals = Array.from({ length: 60 }, (_, i) => Math.round(1e6 * (5 + 2 * Math.sin(i * 1.7) + 0.003 * i)) / 1e6);
  assert.equal(new Set(vals).size, 60);
  const big = makeDataset({ name: 'sixty', response: 'v', kind: 'reps', reps: vals.map((v, i) => ({ id: i + 1, v: [v] })) });
  const rb = oneRecipe({ ds: big, x: vals, ids: big.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, base: 0.95, provenance: oneProv(big, 0.95, 'np'), plan: null });
  assert.equal(rb.expect.exact, 0);
  checkRecipe('One System, Wilcoxon on sixty untied outcomes (normal approximation)', rb);
}

// Outcomes that are all equal, nonzero and zero: the Wilcoxon interval is the
// common value at both ends in every language, with no warning printed.
for (const c of [5, 0]) {
  const ds = makeDataset({ name: 'constant ' + c, response: 'v', kind: 'reps', reps: [1, 2, 3, 4, 5, 6].map(id => ({ id, v: [c] })) });
  const x = ds.reps.map(p => p.v[0]);
  const r = oneRecipe({ ds, x, ids: ds.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, base: 0.95, provenance: oneProv(ds, 0.95, 'np'), plan: null });
  assert.equal(r.expect['wilcoxon lower'], c);
  assert.equal(r.expect['wilcoxon upper'], c);
  assert.equal(r.expect.exact, 0);
  if (c === 0) assert.ok(Number.isNaN(r.expect['signed-rank p']));
  checkRecipe('One System, Wilcoxon on outcomes all equal to ' + c, r, {
    also: (stdout, lang, stderr) => assert.ok(!/warning/i.test(stdout + stderr), lang + ' prints no warning:\n' + stderr)
  });
}

// The pooled override: the observations themselves, no variance, no plan, no check.
{
  const ds = makeDataset({ name: 'pooled', response: 'wait', kind: 'tally', reps: [{ id: 1, v: [1.5, 2.5, 3.5] }, { id: 2, v: [2, 2.2, 5.1, 0.4] }] });
  const prov = Object.assign(oneProv(ds, 0.99, 't'), { 'unit of inference': 'pooled observations (override)' });
  const r = oneRecipe({ ds, x: [1.5, 2.5, 3.5, 2, 2.2, 5.1, 0.4], ids: null, pooled: true, proc: 't', level: 0.99, base: 0.99, provenance: prov, plan: PLAN });
  assert.equal(r.expect.n, 7);
  assert.ok(!('s2' in r.expect) && !('plan n for power' in r.expect) && !('shapiro W [optional]' in r.expect));
  assert.ok(analysisScript(r, 'm').includes('pooled across its replications'));
  checkRecipe('One System on pooled observations', r);
}

// A plan with no answer: a relative target on a zero mean, printed NaN in every language.
{
  const ds = makeDataset({ name: 'centered', response: 'v', kind: 'reps', reps: [-2, -1, 0, 1, 2].map((v, i) => ({ id: i + 1, v: [v] })) });
  const r = oneRecipe({ ds, x: [-2, -1, 0, 1, 2], ids: [1, 2, 3, 4, 5], pooled: false, proc: 't', level: 0.95, base: 0.95, provenance: oneProv(ds, 0.95, 't'), plan: PLAN });
  assert.ok(Number.isNaN(r.expect['plan n for half-width']));
  checkRecipe('One System with a plan that has no answer', r);
}

// ── Task 3: Two Systems, independent replications ───────────────────────

// The page's {v, ids, dropped} for one design.
const est = ds => { const o = outcomeVector(ds); return { v: Float64Array.from(o.values), ids: o.ids, dropped: o.dropped }; };
const [IND_A, IND_B] = example('two-independent');
const PLAN2 = { h: 0.4, delta: 0.5, power: 0.8 };
// The provenance the page registers for an independent comparison, planning keys included.
function twoProv(dsA, dsB, level, proc, plan) {
  const prov = { datasets: 'A: ' + dsA.name + '; B: ' + dsB.name, 'confidence level': Math.round(level * 1000) / 10 + '%',
    procedure: proc === 'np' ? 'Wilcoxon rank-sum (nonparametric)' : proc === 'pooled' ? 'pooled-variance t' : 'Welch t',
    paired: 'no', 'matched by': 'not applicable', 'unmatched replications': 'not applicable' };
  if (plan) Object.assign(prov, { 'planning mode shown': 'by half-width', 'planning replications': 'equal per design',
    'planning half-width target': 'h = ' + plan.h, 'planning difference to detect': 'δ = ' + plan.delta,
    'planning target power': Math.round(plan.power * 100) + '%', 'planning significance level': String(Math.round((1 - level) * 1000) / 1000) });
  return prov;
}
function twoOf(dsA, dsB, proc, level, plan) {
  return twoRecipe({ dsA, dsB, eA: est(dsA), eB: est(dsB), mode: 'independent', proc, level, base: level,
    provenance: twoProv(dsA, dsB, level, proc, plan), plan });
}
const reps = (name, vals) => makeDataset({ name, response: 'w', kind: 'reps', reps: vals.map((v, i) => ({ id: i + 1, v: [v] })) });
const noWarning = (stdout, lang, stderr) => assert.ok(!/warning/i.test(stdout + stderr), lang + ' prints no warning:\n' + stdout + stderr);

test('twoRecipe (independent) carries both designs, the Welch keys, and the page\'s provenance', () => {
  const prov = twoProv(IND_A, IND_B, 0.95, 't', PLAN2);
  const r = twoRecipe({ dsA: IND_A, dsB: IND_B, eA: est(IND_A), eB: est(IND_B), mode: 'independent', proc: 't', level: 0.95, base: 0.95, provenance: prov, plan: PLAN2 });
  assert.equal(r.page, 'two');
  assert.equal(r.title, 'Two Systems: Welch comparison');
  for (const lang of LANGS) assert.ok(!/see the note|note above/.test(analysisScript(r, lang)), lang + ' script points at no note it lacks');
  assert.deepEqual(r.provenance, prov);
  assert.notEqual(r.provenance, prov, 'the provenance is copied');
  assert.equal(r.dataA.values.length, 15);
  assert.equal(r.dataB.values.length, 15);
  for (const k of ['R_A', 'difference', 'df', 'p', 'half-width', 'F', 'F upper', 'shapiro A W [optional]', 'plan n per design for power', 'power at current R']) assert.ok(k in r.expect, k);
  assert.ok(!('pooled sd' in r.expect) && !('levene F' in r.expect) && !('plan n per design for power (rank)' in r.expect));
  assert.deepEqual(Object.keys(r.settings), ['plan_h', 'plan_delta', 'plan_power']);
  assert.ok(analysisScript(r, 'R').includes('t.test(a, b'));
  assert.ok(analysisScript(r, 'py').includes('ttest_ind('));
  assert.ok(analysisScript(r, 'm').includes('ttest2('));
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('Design A.') && s.includes('Design B.'), lang + ' names both designs');
    assert.ok(s.includes('planning difference to detect: delta = 0.5'), lang + ' provenance folded to ASCII');
  }
  assert.throws(() => twoRecipe({ dsA: IND_A, dsB: IND_B, eA: est(IND_A), eB: est(IND_B), mode: 'sideways', proc: 't', level: 0.95, plan: null }), RangeError);
});

test('twoRecipe under the pooled t and the rank-sum procedure', () => {
  const rp = twoOf(IND_A, IND_B, 'pooled', 0.99, PLAN2);
  assert.ok('pooled sd' in rp.expect && 'levene F' in rp.expect && 'levene p' in rp.expect);
  assert.ok(analysisScript(rp, 'R').includes('var.equal = pooled') && analysisScript(rp, 'R').includes('two_sample_t(a, b, level, TRUE)'));
  const rn = twoOf(IND_A, IND_B, 'np', 0.95, PLAN2);
  // The page checks normality on the F ratio's line under every procedure, the rank one included.
  assert.ok(!('df' in rn.expect) && 'shapiro A W [optional]' in rn.expect && 'shapiro B p [optional]' in rn.expect && !('levene F' in rn.expect));
  for (const lang of LANGS) assert.ok(analysisScript(rn, lang).includes('Checks on the F ratio'), lang + ' checks the F ratio');
  assert.ok(rn.expect['plan n per design for power (rank)'] >= rn.expect['plan n per design for power']);
  const R = analysisScript(rn, 'R');
  assert.ok(R.includes('wilcox.test(a, b') && R.includes('exact = exact, correct = TRUE'));
});

for (const [proc, label, level] of [['t', 'Welch', 0.95], ['pooled', 'pooled t', 0.99], ['np', 'rank-sum', 0.95]]) {
  checkRecipe('Two Systems, independent, ' + label, twoOf(IND_A, IND_B, proc, level, PLAN2), { smoke: proc === 't', also: noWarning });
}

// Unequal counts and a dropped replication on one side, with Levene's test under the pooled t.
{
  const gA = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 2.5] }] });
  const gB = reps('B', [3.1, 2.9, 4.2]);
  const r = twoOf(gA, gB, 'pooled', 0.9, null);
  assert.equal(r.expect.R_A, 4);
  assert.deepEqual(r.dataA.dropped, [2]);
  assert.ok(analysisScript(r, 'R').includes('left out: 2'));
  assert.ok('levene p' in r.expect);
  checkRecipe('Two Systems, independent, unequal counts with a dropped replication', r, { also: noWarning });
}

// The rank-sum procedure on untied samples (exact, with an achieved level) and
// on a few tied ones, where the approximate test never reaches significance
// and the analyzer reports no interval ends.
{
  const rx = twoOf(reps('A', [2.1, 3.4, 1.9, 2.8, 3.9, 2.2]), reps('B', [1.2, 2.0, 1.7, 2.5, 1.1]), 'np', 0.9, PLAN2);
  assert.equal(rx.expect.exact, 1);
  assert.ok('achieved level' in rx.expect);
  checkRecipe('Two Systems, rank-sum, exact', rx, { also: noWarning });
  const rt = twoOf(reps('A', [1, 2, 2]), reps('B', [3, 3, 4]), 'np', 0.95, null);
  assert.equal(rt.expect.exact, 0);
  assert.ok(Number.isNaN(rt.expect['shift lower']) && Number.isNaN(rt.expect['shift upper']));
  checkRecipe('Two Systems, rank-sum on three tied outcomes each (no interval)', rt, { also: noWarning });
  // Exact with too few outcomes for any interval at 95%: the whole line, achieved level 1.
  const r2 = twoOf(reps('A', [1, 3]), reps('B', [2, 2.5]), 'np', 0.95, null);
  assert.equal(r2.expect['shift lower'], -Infinity);
  assert.equal(r2.expect['achieved level'], 1);
  checkRecipe('Two Systems, rank-sum on two outcomes each (unbounded interval)', r2, { also: noWarning });
}

// Designs with no spread. One constant design: every procedure runs, the F
// ratio is 0 or infinite, and the plans have no answer. Both constant: the
// difference is known exactly; Welch's test is decided by whether the
// constants differ, the pooled t is undefined when they are equal, the F
// ratio is undefined, Levene's test has nothing to compare, and the rank-sum
// interval is the one possible shift.
{
  const varied = [3.1, 2.9, 4.2, 3.6, 3.3];
  const cases = [
    ['A constant', reps('A', [5, 5, 5, 5]), reps('B', varied)],
    ['B constant', reps('A', varied), reps('B', [5, 5, 5, 5])],
    ['both constant, different', reps('A', [5, 5, 5, 5]), reps('B', [3, 3, 3])],
    ['both constant, equal', reps('A', [4, 4, 4]), reps('B', [4, 4, 4, 4])]
  ];
  // Levene's test with nothing to compare prints the page's refusal and no F or p.
  const leveneRefused = (stdout, lang, stderr) => {
    noWarning(stdout, lang, stderr);
    assert.match(stdout, /^levene: no spread within any design to compare$/m, lang + ' prints the refusal');
    assert.doesNotMatch(stdout, /^levene [Fp]:/m, lang + ' prints no Levene statistic');
  };
  for (const [label, dA, dB] of cases) {
    for (const proc of ['t', 'pooled', 'np']) {
      const r = twoOf(dA, dB, proc, 0.95, PLAN2);
      for (const lang of LANGS) assert.ok(!/see the note|note above/.test(analysisScript(r, lang)), lang + ' script points at no note it lacks');
      const refused = proc === 'pooled' && label.startsWith('both constant');
      checkRecipe('Two Systems, ' + proc + ', ' + label, r, { also: refused ? leveneRefused : noWarning });
    }
  }
  const w = twoOf(cases[2][1], cases[2][2], 't', 0.95, PLAN2).expect;
  assert.equal(w.t, Infinity); assert.equal(w.p, 0); assert.equal(w.df, 5); assert.equal(w['half-width'], 0);
  assert.ok(Number.isNaN(w.F) && Number.isNaN(w['F p']));
  assert.ok(Number.isNaN(w['plan n per design for half-width']) && Number.isNaN(w['power at current R']));
  const we = twoOf(cases[3][1], cases[3][2], 't', 0.95, null).expect;
  assert.equal(we.t, 0); assert.equal(we.p, 1);
  const pe = twoOf(cases[3][1], cases[3][2], 'pooled', 0.95, null).expect;
  assert.ok(Number.isNaN(pe.t) && Number.isNaN(pe.p) && !('levene F' in pe));
  const fb = twoOf(cases[1][1], cases[1][2], 't', 0.95, null).expect;
  assert.equal(fb.F, Infinity); assert.equal(fb['F p'], 0); assert.equal(fb['F upper'], Infinity);
  const nb = twoOf(cases[2][1], cases[2][2], 'np', 0.95, null).expect;
  assert.equal(nb['shift lower'], 2); assert.equal(nb['shift upper'], 2);
  const ne = twoOf(cases[3][1], cases[3][2], 'np', 0.95, null).expect;
  assert.ok(Number.isNaN(ne['rank-sum p']));
}

// Two outcomes per design whose distances from their medians are equal within
// each design and differ between them: Levene's F is infinite and p is 0.
{
  const r = twoOf(reps('A', [1, 3]), reps('B', [2, 6]), 'pooled', 0.95, null);
  assert.equal(r.expect['levene F'], Infinity);
  assert.equal(r.expect['levene p'], 0);
  checkRecipe('Two Systems, pooled, Levene with no spread within either design', r, { also: noWarning });
}

// The rank procedure on outcomes the Shapiro-Wilk check can test: the F ratio's
// checks line reports both designs.
{
  const r = twoOf(IND_A, IND_B, 'np', 0.9, null);
  assert.ok('shapiro A W [optional]' in r.expect && 'shapiro B W [optional]' in r.expect);
  checkRecipe('Two Systems, rank-sum with the F ratio\'s normality checks', r, {
    also: (stdout, lang, stderr) => {
      noWarning(stdout, lang, stderr);
      if (lang !== 'm') assert.match(stdout, /^shapiro A W: .*\(analyzer: /m, lang + ' reports shapiro A W');
    }
  });
}

// ── Task 4: Two Systems, paired replications ────────────────────────────
import { matchPairs } from '../js/stats/compare.js';

const [CRN_A, CRN_B] = example('two-crn');
// The provenance the page registers for a paired comparison, planning keys included.
function pairedProv(dsA, dsB, level, proc, by, unmatched, plan) {
  const prov = { datasets: 'A: ' + dsA.name + '; B: ' + dsB.name, 'confidence level': Math.round(level * 1000) / 10 + '%',
    procedure: proc === 'np' ? 'Wilcoxon signed-rank (nonparametric)' : 'paired t',
    paired: 'yes', 'matched by': by === 'id' ? 'replication id' : 'position', 'unmatched replications': unmatched };
  if (plan) Object.assign(prov, { 'planning mode shown': 'by half-width', 'planning replications': 'equal per design',
    'planning half-width target': 'h = ' + plan.h, 'planning difference to detect': 'δ = ' + plan.delta,
    'planning target power': Math.round(plan.power * 100) + '%', 'planning significance level': String(Math.round((1 - level) * 1000) / 1000) });
  return prov;
}
function pairedRecipe(dsA, dsB, proc, by, plan, level = 0.95) {
  const eA = est(dsA), eB = est(dsB);
  const m = Object.assign(matchPairs(eA.ids, eB.ids, by), { by });
  return twoRecipe({ dsA, dsB, eA, eB, mode: 'paired', match: m, proc, level, base: level,
    provenance: pairedProv(dsA, dsB, level, proc, by, m.unmatchedA.length + m.unmatchedB.length, plan), plan });
}
// A pair of reps datasets whose matched differences a - b are `diffs`, with b varied.
function pairedOf(diffs, b = diffs.map((_, i) => 10 + ((i * 7) % 5) + 0.25 * i)) {
  return [reps('A', diffs.map((d, i) => b[i] + d)), reps('B', b)];
}

test('twoRecipe (paired) carries the matched pairs and the paired keys', () => {
  const r = pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2);
  assert.equal(r.title, 'Two Systems: paired comparison');
  assert.equal(r.pairs.a.length, r.expect.pairs);
  assert.equal(r.provenance.paired, 'yes');
  for (const k of ['mean difference', 'sd of differences', 'r', 'lower', 'shapiro differences W [optional]', 'plan n for power', 'power at current R']) assert.ok(k in r.expect, k);
  assert.ok(!('pseudo-median of differences' in r.expect) && !('plan n for power (rank)' in r.expect) && !('R_A' in r.expect));
  assert.deepEqual(Object.keys(r.settings), ['plan_h', 'plan_delta', 'plan_power']);
  assert.ok(analysisScript(r, 'R').includes('paired = TRUE'));
  assert.ok(analysisScript(r, 'py').includes('ttest_rel('));
  assert.ok(analysisScript(r, 'm').includes('ttest(a, b'));
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('matched by replication id') && s.includes('pair_id'), lang + ' describes the pairs');
  }
  const rn = pairedRecipe(CRN_A, CRN_B, 'np', 'position', PLAN2, 0.9);
  assert.equal(rn.title, 'Two Systems: Wilcoxon signed-rank paired comparison');
  assert.ok('pseudo-median of differences' in rn.expect && 'zero differences dropped' in rn.expect && !('t' in rn.expect));
  assert.ok(!('shapiro differences W [optional]' in rn.expect), 'the signed-rank procedure has no checks line');
  assert.ok(rn.expect['plan n for power (rank)'] >= rn.expect['plan n for power']);
  assert.ok(analysisScript(rn, 'R').includes('signed_rank(pr$diffs, level)'));
  // The pooled t has no paired form: it reads as the paired t, as on the page.
  assert.deepEqual(pairedRecipe(CRN_A, CRN_B, 'pooled', 'id', null).expect, pairedRecipe(CRN_A, CRN_B, 't', 'id', null).expect);
});

checkRecipe('Two Systems, paired t on two-crn', pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2), { smoke: true, also: noWarning });
checkRecipe('Two Systems, paired signed-rank on two-crn', pairedRecipe(CRN_A, CRN_B, 'np', 'position', PLAN2, 0.9), { also: noWarning });

// Unmatched replications on both sides, matched by id.
{
  const pA = makeDataset({ name: 'A', response: 'w', kind: 'reps', reps: [[1, 2.0], [2, 2.4], [3, 1.9], [5, 3.1], [6, 2.2]].map(([id, v]) => ({ id, v: [v] })) });
  const pB = makeDataset({ name: 'B', response: 'w', kind: 'reps', reps: [[1, 1.8], [2, 2.5], [3, 1.5], [4, 2.0], [6, 2.0]].map(([id, v]) => ({ id, v: [v] })) });
  const r = pairedRecipe(pA, pB, 't', 'id', null);
  assert.equal(r.expect.pairs, 4);
  assert.deepEqual(r.pairs.unmatchedA, ['5']);
  assert.deepEqual(r.pairs.unmatchedB, ['4']);
  assert.ok(analysisScript(r, 'm').includes('no partner'));
  checkRecipe('Two Systems, paired with unmatched replications', r, { also: noWarning });
  // Matched by position instead, each pair is named by both of its ids.
  const rp = pairedRecipe(pA, pB, 'np', 'position', { h: 0.3, delta: -0.4, power: 0.9 });
  assert.equal(rp.pairs.ids[3], '5/4');
  assert.ok(rp.expect['power at current R'] > 0, 'the page takes the power for a negative delta too');
  checkRecipe('Two Systems, paired signed-rank by position with a negative delta', rp, { also: noWarning });
}

// A replication of A that gave no outcome is left out before matching, and the scripts say so.
{
  const gA = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 3.5] }] });
  const gB = reps('B', [1.2, 2.2, 2.6, 2.7, 2.4]);
  const r = pairedRecipe(gA, gB, 't', 'id', PLAN2);
  assert.equal(r.expect.pairs, 4);
  assert.deepEqual(r.pairs.droppedA, ['2']);
  assert.deepEqual(r.pairs.unmatchedB, ['2']);
  for (const lang of LANGS) assert.ok(analysisScript(r, lang).includes('gave no outcome were left out: 2'), lang + ' names the empty replication');
  checkRecipe('Two Systems, paired with an empty replication', r, { also: noWarning });
}

// Degenerate pairs. Differences all equal: the mean difference has no width,
// t is infinite (p = 0), or undefined when every difference is zero, and the
// signed-rank interval is the common difference. A design with no spread has
// no correlation with the other.
{
  const cases = [
    ['differences all equal to 2', ...pairedOf([2, 2, 2, 2, 2])],
    ['differences all zero', ...pairedOf([0, 0, 0, 0, 0])],
    ['A constant', reps('A', [5, 5, 5, 5, 5]), reps('B', [3, 4, 6, 2, 5])],
    ['some differences zero', ...pairedOf([0, 1, 0, -2, 3, 1, 0, 2])]
  ];
  for (const [label, dA, dB] of cases) {
    for (const proc of ['t', 'np']) checkRecipe('Two Systems, paired ' + proc + ', ' + label, pairedRecipe(dA, dB, proc, 'id', PLAN2), { also: noWarning });
  }
  const c2 = pairedRecipe(cases[0][1], cases[0][2], 't', 'id', PLAN2).expect;
  assert.equal(c2.t, Infinity); assert.equal(c2.p, 0); assert.equal(c2['half-width'], 0); assert.equal(c2.lower, 2);
  assert.ok(Number.isNaN(c2['power at current R']) && Number.isNaN(c2['plan n for power']));
  assert.ok(!('shapiro differences W [optional]' in c2));
  const c0 = pairedRecipe(cases[1][1], cases[1][2], 't', 'id', PLAN2).expect;
  assert.ok(Number.isNaN(c0.t) && Number.isNaN(c0.p)); assert.equal(c0.upper, 0);
  const n0 = pairedRecipe(cases[1][1], cases[1][2], 'np', 'id', null).expect;
  assert.ok(Number.isNaN(n0['signed-rank p'])); assert.equal(n0['wilcoxon lower'], 0); assert.equal(n0['zero differences dropped'], 5);
  const n2 = pairedRecipe(cases[0][1], cases[0][2], 'np', 'id', null).expect;
  assert.equal(n2['wilcoxon lower'], 2); assert.equal(n2['wilcoxon upper'], 2);
  assert.ok(Number.isNaN(pairedRecipe(cases[2][1], cases[2][2], 't', 'id', null).expect.r));
  assert.equal(pairedRecipe(cases[3][1], cases[3][2], 'np', 'id', null).expect['zero differences dropped'], 3);
}

// A few tied values under the signed-rank approximation, where the inverted
// test cannot reach significance at one end of the range or at both. The
// analyzer reports such an end as NaN and keeps the requested level, where R's
// wilcox.test lowers the level until an interval exists (for 1, 2, 2 it gives
// [2, 2] at level 0). Pinned on the One System path and on the paired one.
{
  const patterns = [
    ['1, 2, 2', [1, 2, 2], [NaN, NaN]],
    ['1, 2, 2, 2, 2, 2, 2, 2', [1, 2, 2, 2, 2, 2, 2, 2], [1.5, NaN]],
    ['1, 1, 1, 1, 1, 1, 1, 2', [1, 1, 1, 1, 1, 1, 1, 2], [NaN, 1.5]]
  ];
  const near = (got, want) => (Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) < 1e-3);
  for (const [label, v, [lo, hi]] of patterns) {
    const ds = reps('tied ' + label, v);
    const r = oneRecipe({ ds, x: v, ids: v.map((_, i) => i + 1), pooled: false, proc: 'np', level: 0.95, base: 0.95, provenance: oneProv(ds, 0.95, 'np'), plan: null });
    assert.equal(r.expect.exact, 0);
    assert.ok(near(r.expect['wilcoxon lower'], lo) && near(r.expect['wilcoxon upper'], hi), label + ': ' + r.expect['wilcoxon lower'] + ', ' + r.expect['wilcoxon upper']);
    checkRecipe('One System, Wilcoxon on ' + label + ' (an end out of reach)', r, { also: noWarning });
    const [pA, pB] = pairedOf(v);
    const rp = pairedRecipe(pA, pB, 'np', 'id', null);
    assert.deepEqual(Array.from(rp.pairs.a, (a, i) => a - rp.pairs.b[i]).map(d => Math.round(d * 1e9) / 1e9), v);
    assert.ok(near(rp.expect['wilcoxon lower'], lo) && near(rp.expect['wilcoxon upper'], hi), 'paired ' + label);
    checkRecipe('Two Systems, paired signed-rank on differences ' + label + ' (an end out of reach)', rp, { also: noWarning });
  }
}
