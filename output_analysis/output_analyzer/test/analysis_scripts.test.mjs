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
import { baseRecipe, outcomeVector, oneRecipe } from '../js/io/recipes.js';
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
