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
// language can only approximate are looser (see the spec, decision 6). A
// post-hoc rule's differences, standard errors, and degrees of freedom are
// exact; what rests on its quantile (the critical value, the half-width, the
// interval's ends, and a p-value) is held to 1e-5 for the studentized range
// and Dunnett's quantile in every language (MATLAB's scripts compute Dunnett's
// value themselves, because multcompare's root search stops at about 1e-4).
// SciPy's dunnett, which Python uses without blocks and with some spread to
// compare, finds its critical value by randomized quadrature and is held to 2e-3.
export function tolFor(key, lang, recipe) {
  // R's qtukey and ptukey are documented as accurate to about 4 digits; at a few
  // residual degrees of freedom they miss the analyzer's studentized range by up to
  // about 1.1e-5 relative (3 df), and so R alone is held to 5e-5 on these keys.
  if (/^posthoc (tukey|gameshowell) .*(critical value|crit|hw|lower|upper| p)$/.test(key)) return { rel: lang === 'R' ? 5e-5 : 1e-5 };
  if (/^posthoc dunnett .*(critical value|hw|lower|upper)$/.test(key)) {
    const A = recipe && recipe.several && recipe.several.anova;
    const scipy = lang === 'py' && A && !A.blocked && recipe.expect['ms within'] > 0;
    return { rel: scipy ? 2e-3 : 1e-5 };
  }
  if (/\bN\b|additional/.test(key)) return { abs: 1 + 1e-9 };
  if (/rinott/.test(key)) return { rel: 1e-4 };
  // A Wilcoxon interval under the normal approximation is a root found to 1e-4,
  // by a different root finder in each language.
  if (/(wilcoxon|shift|pseudo-median of differences|^rank design \d+).*(lower|upper)/.test(key)) return { rel: 2e-4 };
  return { rel: 1e-6 };
}

/** Compares a parsed report with a recipe's expect map; fails with every mismatch listed. */
export function compareReport(report, expect, lang, recipe) {
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
    const t = tolFor(key, lang, recipe);
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
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang, recipe);
      // The tidyverse layer of the Tidy R script (its tibbles, broom's tables,
      // and ggplot2's figures) says nothing on stderr, in every fixture.
      if (lang === 'tidy') assert.ok(!/ggplot|geom_|stat_|Removed \d+ rows?|broom|tibble|dplyr|pillar|summarise|Multiple parameters|naming those columns/i.test(stderr), 'the tidyverse is silent:\n' + stderr);
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

// ── Task 5: Several Systems, the means and the differences ──────────────
import { severalRecipe } from '../js/io/recipes.js';
import { matchBlocks } from '../js/stats/compare.js';
import { LIB } from '../js/io/script_lib.js';

const FOUR = example('four-designs');
const FOUR_CRN = example('four-crn');
const SIX_D = example('six-designs');   // SIX names Task 1's descriptives above
const SEV_PLAN = { meansH: 0.5, diffsH: 0.6, delta: 0.4, power: 0.8 };
const SEV_RULES = { tukey: 'Tukey’s HSD', lsd: 'Fisher’s LSD (protected)', bonferroni: 'Bonferroni (pooled variance)', dunnett: 'Dunnett vs control' };

// The provenance several.js registers, planning keys included.
function sevProv(list, o, match) {
  const k = list.length, np = o.proc === 'np', C = o.diffMode === 'control' ? k - 1 : k * (k - 1) / 2;
  const welchOn = o.varMode === 'welch' && !o.paired && !np;
  return {
    datasets: list.map(d => d.name).join('; '), 'confidence level': Math.round(o.level * 1000) / 10 + '%',
    direction: o.dir === 'min' ? 'smaller is better' : 'bigger is better', 'comparisons adjusted for': C,
    'difference family': o.diffMode === 'pairs' ? 'all pairs' : 'versus control',
    procedure: np ? 'nonparametric (Wilcoxon, ' + (o.paired ? 'Friedman' : 'Kruskal–Wallis and Dunn') + ')' : 't procedures',
    'post-hoc rule': np ? 'not applicable' : welchOn ? (o.ruleW === 'gameshowell' ? 'Games–Howell' : 'Bonferroni (Welch pairs)') : SEV_RULES[o.rule],
    variances: np ? 'not applicable' : welchOn ? 'unequal (Welch)' : 'pooled',
    replications: o.paired ? 'paired across designs, matched by ' + (match.by === 'id' ? 'replication id' : 'position') + ' (' + match.blocks.length + ' blocks)' : 'independent',
    'Dunn adjustment': o.adjust === 'holm' ? 'Holm' : 'Bonferroni', control: list[o.ctrlIdx].name,
    benchmark: o.bench != null ? o.bench : 'none', 'indifference zone': o.eps,
    'planning replications': 'equal per design' + (np ? ', the t plan inflated by pi/3 for the rank procedures' : ''),
    'planning half-width target (means)': 'h = ' + o.plan.meansH, 'planning half-width target (differences)': 'h = ' + o.plan.diffsH,
    'planning comparisons': (o.diffMode === 'control' ? 'each design against the control, ' + list[o.ctrlIdx].name : 'all pairs') + ', C = ' + C,
    'planning shift to detect': 'δ = ' + o.plan.delta, 'planning target power': Math.round(o.plan.power * 100) + '%',
    'planning significance level': String(Math.round((1 - o.level) * 1000) / 1000)
  };
}

/**
 * The Several Systems recipe of `list` as the page builds it: each design's
 * finite outcomes, or under pairing the outcomes aligned into blocks matched
 * by `over.by` (id by default). Later tasks reuse it with their own `over`.
 */
function sevRecipe(list, over = {}) {
  const o = Object.assign({ paired: false, by: 'id', level: 0.95, proc: 't', varMode: 'pooled', rule: 'tukey', ruleW: 'gameshowell',
    adjust: 'bonferroni', diffMode: 'pairs', ctrlIdx: 0, dir: 'max', bench: null, eps: 0.5, plan: SEV_PLAN }, over);
  let groups = list.map(d => Float64Array.from(outcomeVector(d).values)), match = null;
  if (o.paired) {
    const ids = list.map(d => outcomeVector(d).ids);
    match = Object.assign(matchBlocks(ids, o.by), { by: o.by });
    groups = list.map((d, i) => Float64Array.from(match.blocks, blk => groups[i][blk[i]]));
  }
  return severalRecipe(Object.assign({}, o, { list, groups, match, title: 'Several Systems', provenance: sevProv(list, o, match) }));
}

test('severalRecipe carries every design, the family, and the planning keys', () => {
  const r = sevRecipe(FOUR);
  assert.equal(r.title, 'Several Systems');
  assert.equal(r.provenance['difference family'], 'all pairs');
  assert.equal(r.expect.k, 4);
  assert.equal(r.expect.C, 6);
  for (const k of ['design 1 mean', 'design 4 upper', 'design 2 df', 'diff 1-2', 'diff 3-4 adjusted p', 'diff 1-2 excludes 0', 'plan means n',
    'plan diffs widest pair', 'shapiro design 2 W [optional]']) assert.ok(k in r.expect, k);
  assert.ok(!('design 1 vs benchmark' in r.expect) && !('plan means n (rank)' in r.expect) && !('shapiro diff 1-2 W [optional]' in r.expect));
  assert.deepEqual(Object.keys(r.groups).sort(), ['by', 'dropped', 'how', 'ids', 'names', 'paired', 'response', 'unit', 'unmatched', 'values']);
  assert.deepEqual(Object.keys(r.settings), ['control', 'plan_means_h', 'plan_diffs_h', 'plan_delta', 'plan_power']);
  assert.equal(r.several.rank, null);
  assert.deepEqual(r.several.subset, { ok: true, reason: '' }, 'the screen runs under every procedure');
  // A pure function of its argument: built twice, the same recipe.
  assert.deepEqual(JSON.parse(JSON.stringify(sevRecipe(FOUR))), JSON.parse(JSON.stringify(r)));
  const R = analysisScript(r, 'R');
  assert.ok(R.includes('groups <- list(') && R.includes('t.test(') && R.includes('rep_ids <- list(') && R.includes('segments('));
  assert.ok(analysisScript(r, 'py').includes('import matplotlib.pyplot as plt'));
  assert.ok(analysisScript(r, 'm').includes("plot(fig_mid, 1:k, 'ko'"));
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('Four designs - A') && s.includes("Tukey's HSD"), lang + ' names the designs and the choices');
  }
  // Versus a control, with a benchmark.
  const rc = sevRecipe(FOUR, { diffMode: 'control', ctrlIdx: 2, bench: 2.4, level: 0.9 });
  assert.equal(rc.expect.C, 3);
  assert.ok('diff 1-3' in rc.expect && 'diff 4-3' in rc.expect && !('diff 1-2' in rc.expect));
  assert.equal(rc.settings.benchmark, 2.4);
  assert.ok(analysisScript(rc, 'R').includes('abline(v = benchmark'));
  // Under the rank procedures: pseudo-medians, shifts, and the inflated plans.
  const rn = sevRecipe(SIX_D, { proc: 'np' });
  assert.equal(rn.expect.C, 15);
  for (const k of ['design 6 pseudo-median', 'design 1 exact', 'shift 1-6 stat', 'shift 2-3 exact', 'plan means n (rank)', 'plan diffs n (rank)']) assert.ok(k in rn.expect, k);
  assert.ok(!('design 1 mean' in rn.expect) && !('shapiro design 1 W [optional]' in rn.expect));
  assert.ok(analysisScript(rn, 'R').includes('rank_sum(groups[[1]], groups[[2]], per_c)'));
  // Paired: blocks named by id, paired t intervals, the differences' checks.
  const rp = sevRecipe(FOUR_CRN, { paired: true });
  assert.equal(rp.groups.ids.length, 10);
  assert.ok('shapiro diff 1-2 W [optional]' in rp.expect);
  assert.ok(analysisScript(rp, 'R').includes('paired_t(groups[[1]], groups[[2]], per_c)'));
  assert.ok(analysisScript(rp, 'm').includes('block_id = '));
  // The paired flag the analysis of variance reads, and the note on what the settings change.
  assert.ok(analysisScript(r, 'R').includes('paired <- FALSE') && analysisScript(rp, 'py').includes('paired = True') && analysisScript(rp, 'm').includes('paired = true;'));
  for (const lang of LANGS) {
    const flat = analysisScript(rc, lang).replace(/\n[#%] /g, ' ');   // the comment's lines joined
    assert.ok(flat.includes('each design against the control, design 3, and is written into') && flat.includes('changing control does not change it'), lang + ' says the family is fixed');
  }
  // The analysis of variance's rank plan line.
  assert.ok(analysisScript(rn, 'R').includes('report("plan anova n (rank)", ceiling(ppa$n * pi / 3)'));
});

const sevChecks = { also: noWarning };
checkRecipe('Several Systems, means and all-pairs differences on four-designs', sevRecipe(FOUR), { smoke: true, also: noWarning });
checkRecipe('Several Systems, versus control with a benchmark, 90%', sevRecipe(FOUR, { diffMode: 'control', ctrlIdx: 2, bench: 2.4, level: 0.9 }), sevChecks);
checkRecipe('Several Systems, rank procedures on six-designs', sevRecipe(SIX_D, { proc: 'np' }), sevChecks);
checkRecipe('Several Systems, rank procedures versus control with a benchmark', sevRecipe(FOUR, { proc: 'np', diffMode: 'control', ctrlIdx: 3, bench: 1.9 }), sevChecks);
checkRecipe('Several Systems, paired on four-crn', sevRecipe(FOUR_CRN, { paired: true }), sevChecks);
checkRecipe('Several Systems, paired versus control by position, 99%', sevRecipe(FOUR_CRN, { paired: true, by: 'position', diffMode: 'control', ctrlIdx: 3, level: 0.99 }), sevChecks);
checkRecipe('Several Systems, paired rank procedures versus control', sevRecipe(FOUR_CRN, { paired: true, proc: 'np', diffMode: 'control', ctrlIdx: 1 }), sevChecks);
checkRecipe('Several Systems, paired rank procedures over all pairs with a benchmark', sevRecipe(FOUR_CRN, { paired: true, proc: 'np', bench: 2.5 }), sevChecks);

// The benchmark's three verdicts appear across these fixtures.
test('the benchmark fixtures declare designs above, below, and containing it', () => {
  const words = new Set();
  for (const r of [sevRecipe(FOUR, { diffMode: 'control', ctrlIdx: 2, bench: 2.4, level: 0.9 }), sevRecipe(FOUR, { proc: 'np', diffMode: 'control', ctrlIdx: 3, bench: 1.9 })]) {
    for (let i = 1; i <= 4; i++) words.add(r.expect['design ' + i + ' vs benchmark']);
  }
  assert.deepEqual([...words].sort(), ['above', 'below', 'contains']);
});

// Unequal counts, a replication with no outcome, and under pairing a replication with no partner.
{
  const A = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 3.5] }] });
  const B = makeDataset({ name: 'B', response: 'w', kind: 'reps', reps: [[1, 1.2], [2, 2.2], [3, 2.6], [4, 2.7], [5, 2.4], [6, 3.0]].map(([id, v]) => ({ id, v: [v] })) });
  const Cd = makeDataset({ name: 'C', response: 'w', kind: 'reps', reps: [[1, 0.9], [3, 1.7], [4, 2.1], [5, 1.5], [6, 1.1]].map(([id, v]) => ({ id, v: [v] })) });
  const r = sevRecipe([A, B, Cd]);
  assert.deepEqual(r.groups.dropped, [['2'], [], []]);
  assert.deepEqual(r.expect['design 1 R'], 4);
  for (const lang of LANGS) assert.ok(analysisScript(r, lang).includes('gave no outcome were left out (design: ids): 1: 2.'), lang);
  checkRecipe('Several Systems, unequal counts with an empty replication', r, sevChecks);
  const rp = sevRecipe([A, B, Cd], { paired: true });
  assert.equal(rp.groups.ids.join(','), '1,3,4,5');
  assert.deepEqual(rp.groups.unmatched, [[], ['2', '6'], ['6']]);
  for (const lang of LANGS) assert.ok(analysisScript(rp, lang).includes('no partner in every design were left out (design: ids): 2: 2, 6; 3: 6.'), lang);
  checkRecipe('Several Systems, paired with an empty and unmatched replications', rp, sevChecks);
  const rq = sevRecipe([A, B, Cd], { paired: true, by: 'position', proc: 'np' });
  assert.equal(rq.groups.ids[1], '3/2/3');
  checkRecipe('Several Systems, paired by position under the rank procedures', rq, sevChecks);
}

// Designs with no spread (R12). One flat design: its interval is its mean,
// every Welch comparison with it still runs, and the plan for the
// differences has no answer, as on the page. Every design flat: the
// differences are known exactly, Welch's test is decided by whether two
// constants differ, and the means plan asks for the fewest replications.
// Under pairing, two designs equal in every block have differences all zero,
// and their t and p are undefined (the adjusted p too).
{
  const flat = makeDataset({ name: 'Flat design', response: 'avg_wait', kind: 'reps', reps: [1, 2, 3, 4, 5].map(id => ({ id, v: [2.5] })) });
  const r = sevRecipe([FOUR[0], FOUR[1], flat]);
  assert.equal(r.expect['design 3 lower'], 2.5); assert.equal(r.expect['design 3 upper'], 2.5); assert.equal(r.expect['design 3 sd'], 0);
  assert.ok(Number.isNaN(r.expect['plan diffs n']) && Number.isNaN(r.expect['plan diffs half-width at n']));
  assert.equal(r.expect['plan diffs widest pair'], 'none');
  assert.ok(!('shapiro design 3 W [optional]' in r.expect));
  checkRecipe('Several Systems, a flat design under the t procedures', r, sevChecks);
  checkRecipe('Several Systems, a flat design under the rank procedures', sevRecipe([FOUR[0], FOUR[1], flat], { proc: 'np', bench: 2.5 }), sevChecks);
  const consts = [[5, 5, 5, 5], [3, 3, 3], [5, 5, 5, 5, 5]].map((v, i) => reps('K' + (i + 1), v));
  const rk = sevRecipe(consts, { bench: 4 });
  assert.equal(rk.expect['diff 1-2 t'], Infinity); assert.equal(rk.expect['diff 1-3 t'], 0); assert.equal(rk.expect['diff 1-3 p'], 1);
  assert.equal(rk.expect['plan means n'], 2); assert.equal(rk.expect['plan means half-width at n'], 0);
  checkRecipe('Several Systems, every design flat', rk, sevChecks);
  checkRecipe('Several Systems, every design flat under the rank procedures', sevRecipe(consts, { proc: 'np' }), sevChecks);
  const same = [10.5, 11.2, 9.8, 12.1, 10.9, 11.6];
  const rz = sevRecipe([reps('P', same), reps('Q', same), reps('S', same.map((v, i) => v + 0.3 + 0.1 * (i % 3)))], { paired: true, diffMode: 'control', ctrlIdx: 0 });
  assert.ok(Number.isNaN(rz.expect['diff 2-1 t']) && Number.isNaN(rz.expect['diff 2-1 p']) && Number.isNaN(rz.expect['diff 2-1 adjusted p']));
  checkRecipe('Several Systems, paired designs equal in every block', rz, sevChecks);
  checkRecipe('Several Systems, paired rank procedures on designs equal in every block', sevRecipe([reps('P', same), reps('Q', same), reps('S', same.map((v, i) => v + 0.3 + 0.1 * (i % 3)))],
    { paired: true, proc: 'np', diffMode: 'control', ctrlIdx: 0 }), sevChecks);
}

// Holm's step-down adjustment, which the rank tests' pairwise comparisons
// offer beside Bonferroni: the snippet against a direct reference, ties and
// a value capped at 1 included, in every language. Missing p-values (every
// outcome equal) stay missing, as in R and the analyzer.
{
  const sets = [[0.01, 0.04, 0.03, 0.04, 0.005, 0.5, 0.2], [NaN, NaN, NaN]];
  const holmRef = ps => {
    const C = ps.length, order = ps.map((v, i) => i).sort((a, b) => ps[a] - ps[b]), out = new Array(C);
    let run = 0;
    order.forEach((idx, rank) => { run = Math.max(run, Math.min(1, (C - rank) * ps[idx])); out[idx] = run; });
    return out;
  };
  const num = (lang, v) => (Number.isNaN(v) ? (lang === 'py' ? 'float("nan")' : 'NaN') : String(v));
  const body = lang => sets.flatMap((p, s) => {
    const v = p.map(x => num(lang, x)).join(', ');
    if (lang === 'R') return ['p <- c(' + v + ')', 'h <- adjust_p(p, "holm"); b <- adjust_p(p, "bonferroni")',
      'for (i in seq_along(p)) { report(paste("holm ' + s + '", i), h[i]); report(paste("bonferroni ' + s + '", i), b[i]) }'];
    if (lang === 'py') return ['p = [' + v + ']', 'h = adjust_p(p, "holm"); b = adjust_p(p, "bonferroni")', 'for i in range(len(p)):',
      '    report(f"holm ' + s + ' {i + 1}", h[i]); report(f"bonferroni ' + s + ' {i + 1}", b[i])'];
    return ['p = [' + v + '];', "h = adjust_p(p, 'holm'); b = adjust_p(p, 'bonferroni');",
      "for i = 1:numel(p), report(sprintf('holm " + s + " %d', i), h(i)); report(sprintf('bonferroni " + s + " %d', i), b(i)); end"];
  });
  const same = (got, want) => (Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) < 1e-12);
  for (const lang of ['R', 'py', 'm']) {
    test('the Holm snippet adjusts as p.adjust does in ' + lang, { skip: !HAS[lang] ? lang + ' is not installed' : (!FULL && lang !== 'm' ? 'OA_SCRIPTS=1 runs the full matrix' : false) }, () => {
      const L = lang === 'py' ? ['import numpy as np', LIB.py.report, LIB.py.holm, ...body('py')] : lang === 'R' ? [LIB.R.report, LIB.R.holm, ...body('R')] : [...body('m'), LIB.m.report, LIB.m.holm];
      const dir = mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = join(dir, lang === 'm' ? 'holm_check.m' : lang === 'R' ? 'holm.R' : 'holm.py');
        writeFileSync(f, L.join('\n') + '\n');
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
            : spawnSync('matlab', ['-batch', `cd('${dir}'); holm_check`], { cwd: dir, encoding: 'utf8', timeout: 600000 });
        assert.equal(run.status, 0, run.stdout + run.stderr);
        noWarning(run.stdout, lang, run.stderr || '');
        const rep = parseReport(run.stdout);
        sets.forEach((p, s) => {
          const want = holmRef(p), bonf = p.map(v => Math.min(1, p.length * v));
          p.forEach((_, i) => {
            const h = rep.get('holm ' + s + ' ' + (i + 1)), b = rep.get('bonferroni ' + s + ' ' + (i + 1));
            assert.ok(same(h, want[i]), 'holm ' + s + ' ' + (i + 1) + ': ' + h + ' vs ' + want[i]);
            assert.ok(same(b, bonf[i]), 'bonferroni ' + s + ' ' + (i + 1) + ': ' + b + ' vs ' + bonf[i]);
          });
        });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

// ── Task 6: Several Systems, the analysis of variance and the post-hoc rules ──
import { letterGroups } from '../js/stats/compare.js';

test('severalRecipe carries the ANOVA, the post-hoc pairs, the letters, and the F plan', () => {
  const r = sevRecipe(FOUR);
  for (const k of ['levene p', 'anova F', 'anova p', 'ms within', 'posthoc tukey critical value', 'posthoc tukey 1-2 hw', 'posthoc tukey 3-4 different', 'letters 1',
    'shapiro residuals W [optional]', 'plan anova n', 'power at current R']) assert.ok(k in r.expect, k);
  assert.equal(r.expect['posthoc rule'], 'tukey');
  assert.equal(r.several.anova.ruleSlug, 'tukey');
  assert.equal(r.several.anovaPlan.sigmaFrom, 'anova');
  assert.ok(analysisScript(r, 'R').includes('TukeyHSD('));
  assert.ok(analysisScript(r, 'py').includes('tukey_hsd('));
  assert.ok(analysisScript(r, 'm').includes('multcompare('));
  // Dunnett: each design against the control, no letters; the Python call counts the control from 0.
  const rd = sevRecipe(FOUR, { rule: 'dunnett', ctrlIdx: 1 });
  assert.ok('posthoc dunnett 3-2 hw' in rd.expect && !('posthoc dunnett 1-3 hw' in rd.expect) && !('letters 1' in rd.expect));
  assert.ok(analysisScript(rd, 'py').includes('posthoc_pooled(groups, av, "dunnett", alpha, posthoc_pairs, control - 1)'));
  assert.ok(analysisScript(rd, 'py').includes('stats.dunnett(') && analysisScript(rd, 'py').includes('random_state=np.random.default_rng(1)'));
  for (const lang of ['R', 'py', 'm']) assert.ok(analysisScript(rd, lang).includes('posthoc_pairs must compare each design with control'), lang + ' guards the Dunnett pairs');
  // LSD on four-designs: the F test does not reject at 5%, and so no pair is declared different.
  const rl = sevRecipe(FOUR, { rule: 'lsd' });
  assert.equal(rl.expect['posthoc lsd protected'], 0);
  assert.ok(Object.keys(rl.expect).filter(k => / different$/.test(k)).every(k => rl.expect[k] === 0));
  // Welch: per-pair degrees of freedom, critical values, and p; no pooled critical value; no plan.
  const rw = sevRecipe(FOUR, { varMode: 'welch' });
  for (const k of ['welch F', 'welch df2', 'posthoc gameshowell 1-2 df', 'posthoc gameshowell 1-2 crit', 'posthoc gameshowell 2-4 p', 'letters 4']) assert.ok(k in rw.expect, k);
  assert.ok(!('anova F' in rw.expect) && !('posthoc gameshowell critical value' in rw.expect));
  assert.ok(Number.isNaN(rw.expect['plan anova n']) && Number.isNaN(rw.expect['power at current R']));
  assert.ok(analysisScript(rw, 'm').includes('function q = studrange_inv('));
  // Blocked: the blocks' row, and Python's Tukey on the residual mean square, not tukey_hsd.
  const rb = sevRecipe(FOUR_CRN, { paired: true });
  for (const k of ['ss blocks', 'df blocks', 'block F', 'block p']) assert.ok(k in rb.expect, k);
  assert.equal(rb.expect['anova df2'], 27);
  // The rank procedures report no analysis of variance here (Task 7's rank tests take its place), only the F plan.
  const rn = sevRecipe(SIX_D, { proc: 'np' });
  assert.equal(rn.several.anova, null);
  assert.equal(rn.several.anovaPlan.sigmaFrom, 'pooled');
  assert.ok('plan anova n (rank)' in rn.expect && !('levene p' in rn.expect));
  for (const lang of LANGS) assert.ok(/^[\x00-\x7f]*$/.test(analysisScript(rd, lang)) && /^[\x00-\x7f]*$/.test(analysisScript(rw, lang)), lang + ' script is not ASCII');
});

for (const rule of ['tukey', 'lsd', 'bonferroni', 'dunnett']) {
  checkRecipe('Several Systems, one-way ANOVA with ' + rule + ' on four-designs', sevRecipe(FOUR, { rule, ctrlIdx: 1 }), { smoke: rule === 'tukey', also: noWarning });
}
checkRecipe('Several Systems, LSD on six-designs at 99%', sevRecipe(SIX_D, { rule: 'lsd', level: 0.99 }), sevChecks);
for (const ruleW of ['gameshowell', 'bonferroniWelch']) {
  checkRecipe('Several Systems, Welch ANOVA with ' + ruleW, sevRecipe(FOUR, { varMode: 'welch', ruleW }), sevChecks);
}
// Six designs under Games-Howell: pairs declared different, and letters to match.
checkRecipe('Several Systems, Welch ANOVA with Games-Howell on six-designs', sevRecipe(SIX_D, { varMode: 'welch' }), sevChecks);
checkRecipe('Several Systems, blocked ANOVA with Tukey on four-crn', sevRecipe(FOUR_CRN, { paired: true }), sevChecks);
checkRecipe('Several Systems, blocked ANOVA with Dunnett versus design 3', sevRecipe(FOUR_CRN, { paired: true, rule: 'dunnett', ctrlIdx: 2 }), sevChecks);
checkRecipe('Several Systems, blocked ANOVA with protected LSD', sevRecipe(FOUR_CRN, { paired: true, rule: 'lsd' }), sevChecks);
// Dunnett with unequal counts (an empty replication), where each comparison has its own lambda.
{
  const A = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 3.5] }] });
  const B = makeDataset({ name: 'B', response: 'w', kind: 'reps', reps: [[1, 1.2], [2, 2.2], [3, 2.6], [4, 2.7], [5, 2.4], [6, 3.0]].map(([id, v]) => ({ id, v: [v] })) });
  const Cd = makeDataset({ name: 'C', response: 'w', kind: 'reps', reps: [[1, 0.9], [3, 1.7], [4, 2.1], [5, 1.5], [6, 1.1]].map(([id, v]) => ({ id, v: [v] })) });
  checkRecipe('Several Systems, Dunnett with unequal counts', sevRecipe([A, B, Cd], { rule: 'dunnett', ctrlIdx: 1 }), sevChecks);
}

// Two designs in two blocks: the residual has 1 degree of freedom, and Dunnett's
// critical value (the t quantile there, about 12.7) lies past the searches'
// first bracket.
{
  const rd = sevRecipe([reps('U', [2.1, 3.4]), reps('V', [2.9, 3.6])], { paired: true, rule: 'dunnett', ctrlIdx: 0 });
  assert.equal(rd.expect['anova df2'], 1);
  assert.ok(Math.abs(rd.expect['posthoc dunnett critical value'] - 12.7062047361747) < 1e-6);
  checkRecipe('Several Systems, blocked Dunnett on 1 residual degree of freedom', rd, sevChecks);
}

// Review Focus 3: a flat design under Welch's analysis of variance. The page
// shows a warning in place of the section, and plans the F test on the
// pooled analysis it falls back to.
{
  const flat = makeDataset({ name: 'Flat design', response: 'avg_wait', kind: 'reps', reps: [1, 2, 3, 4, 5].map(id => ({ id, v: [2.5] })) });
  const r = sevRecipe([FOUR[0], FOUR[1], flat], { varMode: 'welch' });
  assert.equal(r.expect['welch anova'], 'not defined');
  assert.ok(!('posthoc gameshowell 1-2 hw' in r.expect) && !('levene p' in r.expect));
  assert.equal(r.several.anovaPlan.sigmaFrom, 'pooled');
  assert.ok(Number.isFinite(r.expect['plan anova n']));
  checkRecipe('Several Systems, Welch ANOVA undefined on a flat design', r, sevChecks);
  // Every design flat under Bonferroni (pooled): F is infinite, every half-width 0, and the plan has no answer.
  const consts = [[5, 5, 5, 5], [3, 3, 3], [5, 5, 5, 5, 5]].map((v, i) => reps('K' + (i + 1), v));
  const rk = sevRecipe(consts, { rule: 'bonferroni' });
  assert.equal(rk.expect['anova F'], Infinity); assert.equal(rk.expect['anova p'], 0); assert.equal(rk.expect['posthoc bonferroni 1-2 hw'], 0);
  assert.ok(Number.isNaN(rk.expect['plan anova n']) && Number.isNaN(rk.expect['levene p']));
  assert.deepEqual([1, 2, 3].map(i => rk.expect['letters ' + i]), ['a', 'b', 'a']);
  checkRecipe('Several Systems, every design flat under Bonferroni', rk, sevChecks);
  checkRecipe('Several Systems, every design flat under Dunnett', sevRecipe(consts, { rule: 'dunnett', ctrlIdx: 2 }), sevChecks);
}

// The letter display past 26 groups and on a chain of overlapping groups,
// against the analyzer's own letterGroups, in every language.
{
  const cases = [
    { k: 5, flagged: [[0, 1], [1, 2], [3, 4], [0, 4]] },
    { k: 4, flagged: [] },
    { k: 30, flagged: [] }
  ];
  // Thirty designs, each different from every other: thirty groups of one, past z and Z's start.
  cases[2].flagged = [];
  for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) cases[2].flagged.push([i, j]);
  const lit = (lang, f) => (lang === 'R' ? 'list(' + f.map(([i, j]) => 'c(' + (i + 1) + ', ' + (j + 1) + ')').join(', ') + ')'
    : lang === 'py' ? '[' + f.map(([i, j]) => '(' + i + ', ' + j + ')').join(', ') + ']'
      : f.length ? '[' + f.map(([i, j]) => (i + 1) + ' ' + (j + 1)).join('; ') + ']' : 'zeros(0, 2)');
  for (const lang of ['R', 'py', 'm']) {
    test('the letter display matches letterGroups in ' + lang, { skip: !HAS[lang] ? lang + ' is not installed' : (!FULL && lang !== 'm' ? 'OA_SCRIPTS=1 runs the full matrix' : false) }, () => {
      const body = cases.flatMap((c, s) => (lang === 'R' ? ['cld <- letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ')', 'for (i in seq_along(cld)) report(paste("case ' + s + '", i), cld[i])']
        : lang === 'py' ? ['cld = letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ')', 'for i, v in enumerate(cld): report(f"case ' + s + ' {i + 1}", v)']
          : ['cld = letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ');', "for i = 1:numel(cld), report(sprintf('case " + s + " %d', i), cld{i}); end"]));
      const L = lang === 'py' ? ['import numpy as np', LIB.py.report, LIB.py.letters, ...body] : lang === 'R' ? [LIB.R.report, LIB.R.letters, ...body] : [...body, LIB.m.report, LIB.m.letters];
      const dir = mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = join(dir, lang === 'm' ? 'letters_check.m' : lang === 'R' ? 'letters.R' : 'letters.py');
        writeFileSync(f, L.join('\n') + '\n');
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
            : spawnSync('matlab', ['-batch', `cd('${dir}'); letters_check`], { cwd: dir, encoding: 'utf8', timeout: 600000 });
        assert.equal(run.status, 0, run.stdout + run.stderr);
        noWarning(run.stdout, lang, run.stderr || '');
        const rep = parseReport(run.stdout);
        cases.forEach((c, s) => letterGroups(c.k, c.flagged).forEach((want, i) => assert.equal(rep.get('case ' + s + ' ' + (i + 1)), want, 'case ' + s + ' design ' + (i + 1))));
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

// Dunnett's pairs are written in while its control is a setting: a script whose
// control is edited without its pairs stops with a message instead of
// comparing against the wrong design.
for (const lang of ['R', 'py', 'm']) {
  test('a Dunnett script stops when control no longer matches its pairs in ' + lang, { skip: !HAS[lang] ? lang + ' is not installed' : (!FULL && lang !== 'm' ? 'OA_SCRIPTS=1 runs the full matrix' : false) }, () => {
    const r = sevRecipe(FOUR, { rule: 'dunnett', ctrlIdx: 1 });
    const name = lang === 'm' ? 'dunnett_guard.m' : lang === 'R' ? 'guard.R' : 'guard.py';
    const from = lang === 'R' ? 'control <- 2\n' : lang === 'py' ? 'control = 2\n' : 'control = 2;\n';
    const text = analysisScript(r, lang);
    assert.ok(text.includes(from), 'the settings carry ' + from.trim());
    const dir = mkdtempSync(join(tmpdir(), 'oa-regen-'));
    try {
      const f = join(dir, name);
      writeFileSync(f, text.replace(from, from.replace('2', '3')));
      const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
        : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) })
          : spawnSync('matlab', ['-batch', `cd('${dir}'); dunnett_guard`], { cwd: dir, encoding: 'utf8', timeout: 600000 });
      assert.notEqual(run.status, 0, 'the script ran to the end');
      assert.ok((run.stdout + run.stderr).includes('posthoc_pairs must compare each design with control'), run.stdout + run.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── Task 7: Several Systems, the rank tests and the screen for the best ──

test('severalRecipe carries the rank tests, the screen, and the letters', () => {
  const r = sevRecipe(SIX_D, { proc: 'np', adjust: 'holm' });
  for (const k of ['kruskal H', 'kruskal p', 'rank pair 1-2 z', 'rank pair 5-6 adjusted p', 'rank pair 1-6 different', 'rank letters 1', 'rank design 3 pseudo-median',
    'rank design 6 upper', 'screen t', 'rinott h', 'design 1 survives', 'design 1 N', 'design 6 additional', 'best design']) assert.ok(k in r.expect, k);
  assert.deepEqual(r.several.rank, { paired: false, adjust: 'holm', pairs: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]] });
  // R counts the ties exactly itself; kruskal.test, which rounds them to 15 digits, is left as a comment.
  assert.ok(analysisScript(r, 'R').includes('# kw <- kruskal.test(y, g)') && !/^\s*kw <- kruskal\.test/m.test(analysisScript(r, 'R')));
  assert.ok(analysisScript(r, 'R').includes('kruskal_dunn(groups, alpha, "holm", rank_pairs)'));
  assert.ok(analysisScript(r, 'py').includes('stats.kruskal('));
  assert.ok(analysisScript(r, 'm').includes('kruskalwallis('));
  const rp = sevRecipe(FOUR_CRN, { paired: true, proc: 'np' });
  assert.ok('friedman chi2' in rp.expect && !('kruskal H' in rp.expect));
  assert.ok(analysisScript(rp, 'R').includes('friedman.test('));
  // Under the t procedures: no rank section, but the screen.
  const rt = sevRecipe(FOUR);
  assert.equal(rt.several.rank, null);
  assert.ok(!Object.keys(rt.expect).some(k => /^(rank|kruskal|friedman)/.test(k)) && 'rinott h' in rt.expect);
  for (const x of [r, rp, rt]) for (const lang of LANGS) assert.ok(/^[\x00-\x7f]*$/.test(analysisScript(x, lang)), lang + ' script is not ASCII');
});

checkRecipe('Several Systems, Kruskal-Wallis and Dunn (Holm) on six-designs', sevRecipe(SIX_D, { proc: 'np', adjust: 'holm', eps: 0.3 }), { smoke: true, also: noWarning });
checkRecipe('Several Systems, Friedman and its pairs on four-crn', sevRecipe(FOUR_CRN, { paired: true, proc: 'np', dir: 'min' }), sevChecks);
checkRecipe('Several Systems, Friedman with Holm by position', sevRecipe(FOUR_CRN, { paired: true, by: 'position', proc: 'np', adjust: 'holm', level: 0.9 }), sevChecks);
checkRecipe('Several Systems, the screen for the best, smaller is better', sevRecipe(SIX_D, { dir: 'min', eps: 1.0 }), sevChecks);

// Every outcome equal in every design: no tie correction is possible, and so
// H is left uncorrected (0, p = 1) and every Dunn z and p is missing; under
// pairing every block is tied and Friedman's statistic is missing too.
{
  const same = ['P', 'Q', 'S'].map(n => reps(n, [4, 4, 4, 4]));
  const r = sevRecipe(same, { proc: 'np', adjust: 'holm' });
  assert.ok(Math.abs(r.expect['kruskal H']) < 1e-9 && Math.abs(r.expect['kruskal p'] - 1) < 1e-6);
  for (const k of ['rank pair 1-2 z', 'rank pair 1-2 p', 'rank pair 2-3 adjusted p']) assert.ok(Number.isNaN(r.expect[k]), k);
  assert.equal(r.expect['rank pair 1-3 different'], 0);
  assert.deepEqual([1, 2, 3].map(i => r.expect['rank letters ' + i]), ['a', 'a', 'a']);
  checkRecipe('Several Systems, Kruskal-Wallis and Dunn on outcomes all equal', r, sevChecks);
  const rp = sevRecipe(same, { paired: true, proc: 'np' });
  assert.ok(Number.isNaN(rp.expect['friedman chi2']) && Number.isNaN(rp.expect['friedman p']));
  assert.equal(rp.expect['rank pair 1-2 p'], 1);
  checkRecipe('Several Systems, Friedman on blocks tied throughout', rp, sevChecks);
}

// The screen on small first stages. Three replications each: nu = 2, and
// Rinott's h near 10.75 at P* = 0.975 for four designs. Two each: the root
// lies past the analyzer's search, which stops at 12, and so h and every N
// are missing on the page and in the scripts.
{
  const small = [[2.1, 3.4, 2.8], [3.9, 4.4, 3.1], [2.5, 2.2, 3.0], [4.1, 3.6, 4.8]].map((v, i) => reps('S' + (i + 1), v));
  const r = sevRecipe(small, { eps: 0.4 });
  assert.ok(Math.abs(r.expect['rinott h'] - 10.7548339283) < 1e-4, String(r.expect['rinott h']));
  checkRecipe('Several Systems, the screen on three replications per design', r, sevChecks);
  const two = [[2.1, 3.4], [3.9, 4.4], [2.5, 2.2]].map((v, i) => reps('T' + (i + 1), v));
  // Under the rank procedures, because on two outcomes per design Levene's F is rounding noise near
  // 1e30 and the pooled analysis's three residual degrees of freedom put Tukey's quantile where
  // R's qtukey is good to about 1e-5 only.
  const r2 = sevRecipe(two, { eps: 0.4, proc: 'np' });
  assert.ok(Number.isNaN(r2.expect['rinott h']));
  assert.ok(Object.keys(r2.expect).filter(k => /^design \d+ (N|additional)$/.test(k)).every(k => Number.isNaN(r2.expect[k])));
  checkRecipe('Several Systems, the screen on two replications per design (no h)', r2, sevChecks);
}

// The screen refuses an indifference zone of 0 (or one not set), and the
// script says why in ASCII (R18: the reason names delta).
{
  const r = sevRecipe(FOUR, { eps: 0 });
  assert.equal(r.expect.screen, 'not defined');
  assert.ok(/δ/.test(r.several.subset.reason));
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is not ASCII');
    assert.ok(s.includes('The indifference zone delta must be positive.'), lang + ' gives the reason');
  }
  checkRecipe('Several Systems, screen undefined at eps = 0', r, sevChecks);
  checkRecipe('Several Systems, screen undefined with no indifference zone set', sevRecipe(FOUR, { eps: NaN, proc: 'np' }), sevChecks);
}

// Two outcomes equal to 15 significant digits but not exactly: the tie
// correction must count them as distinct, as the exact ranks do (R's
// kruskal.test would count them as tied).
{
  const near = [[1, 2.5, 3.1, 4.2], [1 + 2 ** -52, 5.5, 6.1, 7.3], [0.4, 0.9, 2.2, 8.8]].map((v, i) => reps('N' + (i + 1), v));
  const r = sevRecipe(near, { proc: 'np' });
  assert.equal(r.expect['kruskal H'], 2);
  checkRecipe('Several Systems, Kruskal-Wallis on outcomes that differ only by rounding', r, sevChecks);
}

// Integer outcomes with many partial ties, four designs by twelve replications:
// every Wilcoxon interval, Dunn's and Friedman's tie corrections, and the
// pseudo-medians take the normal approximation, under Holm.
{
  const tied = [0, 1, 2, 3].map(d => reps('Z' + (d + 1), Array.from({ length: 12 }, (_, i) => ((i * 7 + d * 3) % 5) + Math.floor(d / 2) + (i % 3 === 0 ? 1 : 0))));
  const rk = sevRecipe(tied, { proc: 'np', adjust: 'holm' });
  assert.ok([1, 2, 3, 4].every(i => rk.expect['design ' + i + ' exact'] === 0));
  checkRecipe('Several Systems, Kruskal-Wallis and Dunn (Holm) on tied integer outcomes', rk, sevChecks);
  checkRecipe('Several Systems, Friedman (Holm) on tied integer outcomes', sevRecipe(tied, { paired: true, proc: 'np', adjust: 'holm' }), sevChecks);
}

// Two outcomes per design under the t procedures. Levene's F is 0/0 rounding
// noise here (each design's two distances from its median are equal up to
// rounding), which the analyzer reports as a number; it is not compared. The
// pooled analysis has 3 residual degrees of freedom, where R's qtukey is
// held to its looser tolerance (see tolFor).
{
  const two = [[2.1, 3.4], [3.9, 4.4], [2.5, 2.2]].map((v, i) => reps('T' + (i + 1), v));
  const r = sevRecipe(two, { eps: 0.4 });
  for (const k of ['levene F', 'levene p']) { assert.ok(k in r.expect, k); r.expect[k] = null; }
  // R says so: anova() on Levene's near-perfect fit warns that its F is unreliable, and that
  // warning, and only it, is expected.
  const leveneNoise = /Warning message:\s*In anova\.lm\(lm\(z ~ g\)\) :\s*ANOVA F-tests on an essentially perfect fit are unreliable\s*/;
  checkRecipe('Several Systems, two replications per design under the t procedures', r, {
    also: (stdout, lang, stderr) => noWarning(stdout, lang, lang === 'R' || lang === 'tidy' ? stderr.replace(leveneNoise, '') : stderr)
  });
}

// ── Task 8: Steady State ───────────────────────────────────────────────
import { steadyRecipe, recordCount, MAX_NUMBERS } from '../js/io/recipes.js';
import { batchMeans } from '../js/stats/steadystate.js';
import { truncateDataset } from '../js/data/model.js';

const TRANSIENT = example('transient')[0];     // tally, ten replications, time-stamped
const LONG = example('steady-long')[0];        // tally, one long replication
const QLEN = example('queue-length')[0];       // time-persistent, five replications ending at 600

const steadyBase = { align: 'index', nBins: 50, w: 5, cut: 0, repIdx: 0, lumped: false, mode: 'count', count: 20, size: null, level: 0.95, start: 0 };

// The provenance the page registers, in its key order (storeResult in steady.js),
// less the batch results, which the script recomputes.
function stProv(ds, o) {
  return {
    dataset: o.shownName || ds.name,
    replication: o.lumped && ds.reps.length > 1 ? 'all, concatenated' : String((ds.reps[o.repIdx] || ds.reps[0]).id),
    truncation: o.cut > 0 ? 'by ' + o.align + ' at ' + o.cut : 'none',
    'confidence level': Math.round(o.level * 100) + '%',
    'warm-up alignment': o.align === 'index' ? 'by observation index' : 'by simulation time, ' + o.nBins + ' bins',
    'moving-average half-window': o.w
  };
}
const stRecipe = (ds, over = {}) => {
  const o = Object.assign({ ds }, steadyBase, over);
  return steadyRecipe(Object.assign({ title: 'Steady state: batch means', provenance: stProv(ds, o) }, o));
};
const stChecks = { also: noWarning };

test('steadyRecipe carries the records, the warm-up, the batches, and the autocorrelation', () => {
  const r = stRecipe(LONG);
  assert.equal(r.records.reps.length, 1);
  for (const k of ['warm-up points', 'warm-up moving average at mid', 'batches', 'batch 1 mean', 'batch 20 mean', 'half-width', 'fishman C', 'acf lag 1', 'acf lag 5']) assert.ok(k in r.expect, k);
  assert.equal(r.expect.batches, 20);
  assert.equal(r.provenance['moving-average half-window'], 5, 'the page\'s own provenance is carried');
  for (const lang of LANGS) {
    const s = analysisScript(r, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is ASCII');
    assert.ok(/fishman/.test(s) && /batch_means\(bt, bv, kind, b_end, batch_count, batch_size, level, b_first\)/.test(s), lang + ' batch means');
  }
  // Building is pure: twice gives the same recipe.
  assert.deepEqual(JSON.parse(JSON.stringify(stRecipe(LONG))), JSON.parse(JSON.stringify(r)));
});

test('the batch start is the analyzer\'s first kept position, not zero', () => {
  assert.equal(stRecipe(LONG, { cut: 200 }).expect['batch start'], 200);
  const byTime = stRecipe(TRANSIENT, { align: 'time', repIdx: 2, cut: 20, count: 8 });
  assert.ok(byTime.expect['batch start'] > 0);
  assert.equal(stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }).expect['batch start'], 0, 'a joined series starts at 0');
  assert.equal(stRecipe(QLEN, { align: 'time', cut: 100, count: 10 }).expect['batch start'], 100, 'a trajectory cut by time starts at the cut');
});

checkRecipe('Steady State, one long run by count', stRecipe(LONG), { smoke: true, also: noWarning });
checkRecipe('Steady State, one long run by size after a cut by index, 90%', stRecipe(LONG, { cut: 200, mode: 'size', size: 150, level: 0.9 }), stChecks);
checkRecipe('Steady State, transient waits lumped after a cut by index', stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }), stChecks);
checkRecipe('Steady State, transient waits aligned by time, replication 3, cut by time', stRecipe(TRANSIENT, { align: 'time', nBins: 40, repIdx: 2, cut: 20, count: 8 }), stChecks);
checkRecipe('Steady State, transient waits lumped by time, by size', stRecipe(TRANSIENT, { align: 'time', nBins: 60, lumped: true, cut: 30, mode: 'size', size: 75, level: 0.99 }), stChecks);

// Review Focus 4: a time-persistent run cut by time carries the state in force
// at the cut as its first record, at the cut time, and the first batch's time
// average counts it. Dropping the records before the cut instead loses the
// stretch from the cut to the next record and changes the first batch mean,
// which this fixture would catch.
{
  const r = stRecipe(QLEN, { align: 'time', nBins: 30, cut: 100, count: 10 });
  const rep = QLEN.reps[0];
  const dropped = { t: rep.t.filter(x => x > 100), v: rep.v.filter((_, i) => rep.t[i] > 100) };
  const naive = batchMeans(dropped, { kind: 'time', count: 10, endTime: QLEN.endTime, level: 0.95 });
  assert.ok(Math.abs(naive.batches[0].mean - r.expect['batch 1 mean']) > 1e-3, 'the carried record moves the first batch mean');
  assert.ok(r.expect['records used'] === dropped.v.length + 1, 'the carried record is counted');
  checkRecipe('Steady State, time-persistent run cut by time, by count', r, stChecks);
  checkRecipe('Steady State, time-persistent run cut by time, by size', stRecipe(QLEN, { align: 'time', nBins: 30, repIdx: 3, cut: 100, mode: 'size', size: 47.5 }), stChecks);
  checkRecipe('Steady State, time-persistent runs lumped after a cut by time, by size', stRecipe(QLEN, { align: 'time', lumped: true, cut: 50, mode: 'size', size: 200 }), stChecks);
  checkRecipe('Steady State, time-persistent runs lumped after a cut by time, by count', stRecipe(QLEN, { align: 'time', nBins: 80, lumped: true, cut: 75.5, count: 25, level: 0.9 }), stChecks);
  // The page aligns time-persistent data by time only; the scripts follow the
  // analyzer's functions by observation index too.
  checkRecipe('Steady State, time-persistent run aligned and cut by index', stRecipe(QLEN, { align: 'index', repIdx: 1, cut: 40, count: 12 }), stChecks);
  // A derived dataset shown alone (its source no longer loaded) starts its bins at its own cut.
  const derived = truncateDataset(QLEN, { by: 'time', at: 100 });
  const rd = stRecipe(derived, { align: 'time', nBins: 25, start: 100, cut: 150, count: 10 });
  assert.equal(rd.expect['warm-up bin width'], (600 - 100) / 25);
  checkRecipe('Steady State, a time-persistent set already truncated at 100, cut again at 150', rd, stChecks);
}

// Time-persistent replications of unequal length and no end time: each run's
// last record holds for no time, the late bins average only the runs still
// going, and the joined run shifts each one to where the previous one ended.
{
  const lens = [300, 520, 760, 410, 848];
  const unequal = makeDataset({ name: 'Queue length, unequal', response: 'q', kind: 'time',
    reps: QLEN.reps.map((r, i) => ({ id: r.id, t: Array.from(r.t).slice(0, lens[i]), v: Array.from(r.v).slice(0, lens[i]) })) });
  const ends = unequal.reps.map(r => r.t[r.t.length - 1]);
  assert.ok(Math.max(...ends) - Math.min(...ends) > 50, 'the runs end at different times');
  checkRecipe('Steady State, time-persistent runs of unequal length, one run cut by time', stRecipe(unequal, { align: 'time', nBins: 40, repIdx: 2, cut: 60, count: 10 }), stChecks);
  checkRecipe('Steady State, time-persistent runs of unequal length, lumped by size', stRecipe(unequal, { align: 'time', nBins: 40, lumped: true, cut: 60, mode: 'size', size: 90 }), stChecks);
}

// An empty replication: the alignment skips it, and joining skips it.
{
  const gappyT = makeDataset({ name: 'Transient, one empty', response: TRANSIENT.response, kind: 'tally',
    reps: TRANSIENT.reps.map((r, i) => (i === 1 ? { id: r.id, t: [], v: [] } : { id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  const ri = stRecipe(gappyT, { lumped: true, cut: 25, count: 15 });
  assert.equal(ri.records.reps[1].v.length, 0);
  for (const lang of LANGS) assert.ok(/holding no records \(ids\): 2\./.test(analysisScript(ri, lang)), lang + ' names the empty replication');
  checkRecipe('Steady State, tally with an empty replication, lumped by index', ri, stChecks);
  checkRecipe('Steady State, tally with an empty replication, by time', stRecipe(gappyT, { align: 'time', nBins: 45, repIdx: 3, cut: 40, mode: 'size', size: 30 }), stChecks);
  const gappyQ = makeDataset({ name: 'Queue length, one empty', response: 'q', kind: 'time', endTime: 600,
    reps: QLEN.reps.map((r, i) => (i === 2 ? { id: r.id, t: [], v: [] } : { id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  checkRecipe('Steady State, time-persistent with an empty replication, lumped by count', stRecipe(gappyQ, { align: 'time', nBins: 20, lumped: true, cut: 100, count: 12 }), stChecks);
}

// Time bins that no replication reaches: the moving average skips them, as the page's does.
{
  const sparse = makeDataset({ name: 'Sparse', response: 'wait', kind: 'tally', reps: [
    { id: 1, t: [0.5, 1.2, 1.9, 7.5, 8.1, 9.4, 9.9, 12.2, 15.7, 18.3, 19.1], v: [1, 3, 2, 6, 4, 5, 7, 5, 6, 4, 5] },
    { id: 2, t: [0.2, 1.5, 7.9, 8.8, 13.1, 16.4, 19.8], v: [2, 2, 5, 6, 4, 5, 6] }] });
  const r = stRecipe(sparse, { align: 'time', nBins: 20, w: 3, count: 3 });
  assert.ok(r.expect['warm-up empty bins'] > 0, 'some bins are empty');
  checkRecipe('Steady State, tally aligned by time with empty bins', r, stChecks);
}

// Settings that give fewer than two batches: the page shows no result, and a
// script whose settings are edited to such values says the batch means are not defined.
{
  const r = stRecipe(LONG, { cut: 4990, count: 20 });
  assert.equal(r.expect['batch means'], 'not defined');
  checkRecipe('Steady State, too few observations for the batches', r, stChecks);
}

// Too many numbers: the recipe carries no records, and the page disables the buttons.
test('a run past 200,000 numbers gives no script', () => {
  const big = makeDataset({ name: 'big', response: 'q', kind: 'time', reps: [{ id: 1, t: Array.from({ length: 120000 }, (_, i) => i), v: Array.from({ length: 120000 }, (_, i) => i % 7) }] });
  assert.equal(MAX_NUMBERS, 200000);
  assert.ok(recordCount(big) > MAX_NUMBERS);
  assert.ok(recordCount(LONG) <= MAX_NUMBERS && recordCount(QLEN) <= MAX_NUMBERS);
  const r = stRecipe(big, { align: 'time' });
  assert.equal(r.tooBig, true);
  assert.ok(!r.records && !('batches' in r.expect));
});

// Rscript parses the statement so far after every line it reads, and so a data
// literal spread over many lines takes time that grows with the square of its
// length. Every R data block is written as one-line statements, and the Steady
// State script keeps the analyzer's per-batch values outside any block.
test('R data blocks are one-line statements', () => {
  const open = line => {
    const bare = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    let d = 0;
    for (const ch of bare) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--; }
    return d;
  };
  const queue = example('queue-reps')[0];
  const recipes = [
    ['steady, tally', stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 })],
    ['steady, time-persistent', stRecipe(QLEN, { align: 'time', cut: 100, count: 60 })],
    ['steady, long', stRecipe(LONG)],
    ['one', descRecipe('Queue days', queue)],
    ['two, independent', twoOf(IND_A, IND_B, 't', 0.95, PLAN2)],
    ['two, paired', pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2)],
    ['several', sevRecipe(FOUR)],
    ['several, paired', sevRecipe(FOUR_CRN, { paired: true })],
    ['explore, tally', exploreRecipe({ ds: TRANSIENT, spread: null, level: 0.95, title: 'Summary of ' + TRANSIENT.name, provenance: { dataset: TRANSIENT.name } })],
    ['explore, with the spread test', exploreRecipe({ ds: IND_A, spread: { names: [IND_A.name, IND_B.name], groups: [IND_A, IND_B].map(d => outcomeVector(d).values) },
      level: 0.95, title: 'Summary of ' + IND_A.name, provenance: { dataset: IND_A.name } })]
  ];
  for (const [label, r] of recipes) {
    for (const lang of ['R', 'tidy']) {
      const s = analysisScript(r, lang);
      const data = s.slice(s.indexOf('\n## Data ----'), s.indexOf('\n## ', s.indexOf('\n## Data ----') + 5));
      const lines = data.split('\n').filter(l => l.trim() && !/^\s*#/.test(l));
      assert.ok(lines.length > 1, label + ': a data block');
      for (const l of lines) {
        assert.equal(open(l), 0, label + ' ' + lang + ': a statement spans lines: ' + l.slice(0, 80));
        assert.ok(l.length < 4096, label + ': a line under 4 KB');
      }
      // Tidy R adds the same data as a tibble, also one statement on one line.
      if (lang === 'tidy') assert.ok(lines.some(l => /^(d_tbl|pairs_tbl|records_tbl) <- /.test(l)), label + ': a tibble in the tidy data block');
      if (r.page === 'steady') {
        assert.ok(/\npage_means <- c\(/.test(s), label + ': page_means at top level');
        for (const l of s.split('\n')) assert.ok(!/^\s+page_(means|records|acf) <- /.test(l), label + ': no analyzer vector inside a block');
      }
    }
  }
  // A long vector is appended in parts, and a short one stays one statement.
  const s = analysisScript(stRecipe(LONG), 'R');
  assert.ok(/\nv_ <- c\(v_, /.test(s) && /\nreps\[\[1\]\] <- list\(id = "1", t = t_, v = v_\)/.test(s));
  assert.ok(/b_first <- if \(length\(kept\$idx\)\) kept\$idx\[1\] - 1 else NaN/.test(s), 'an empty b_first is NaN');
});

// Both a batch count and a batch size: the script refuses, as the analyzer does.
{
  const r = JSON.parse(JSON.stringify(stRecipe(LONG)));
  for (const k of Object.keys(r.expect)) if (/^(batch|batches|records used|leftover|mean of|sd of|se$|df$|t quantile|half-width|lower|upper|lag-one|fishman)/.test(k)) delete r.expect[k];
  r.expect['batch means'] = 'not defined';
  r.settings.batch_size = 150;
  checkRecipe('Steady State, a batch count and a batch size both set', r, {
    also: (stdout, lang, stderr) => { noWarning(stdout, lang, stderr); assert.ok(stdout.includes('Give either a batch count or a batch size, not both.'), lang + ' refuses'); }
  });
}

// ── Task 9: Summary and Plots ──────────────────────────────────────────
import { exploreRecipe, exploreTooBig } from '../js/io/recipes.js';

// The page's inputs: its title and provenance, and the Equal variances
// section's ticked datasets with their finite replication outcomes.
const exSpread = (...list) => ({ names: list.map(d => d.name), groups: list.map(d => outcomeVector(d).values) });
const exRecipe = (ds, spread = null, level = 0.95) =>
  exploreRecipe({ ds, spread, level, title: 'Summary of ' + ds.name, provenance: { dataset: ds.name } });
const exChecks = { also: noWarning };

test('exploreRecipe carries the replications, the outcomes, the check, and the spread test', () => {
  const r = exRecipe(TRANSIENT, exSpread(TRANSIENT, LONG));
  for (const k of ['replications', 'observations', 'rep 1 n', 'rep 1 outcome', 'rep 1 sd', 'mean', 'q3', 'pooled median',
    'interval half-width', 'shapiro W [optional]', 'shapiro p [optional]']) assert.ok(k in r.expect, k);
  assert.ok(!('levene F' in r.expect) && !r.spread && !r.explore.spread, 'one outcome in LONG leaves Levene undefined on that pair');
  assert.equal(r.provenance.dataset, TRANSIENT.name);
  const r2 = exRecipe(IND_A, exSpread(IND_A, IND_B));
  for (const k of ['levene F', 'levene df1', 'levene df2', 'levene p']) assert.ok(k in r2.expect, k);
  assert.equal(r2.expect['levene df2'], 28);
  assert.deepEqual(r2.spread.names, [IND_A.name, IND_B.name]);
  assert.ok(!('rep 1 sd' in r2.expect) && !('pooled n' in r2.expect), 'replication values have no observations to describe');
  // A single group is no comparison either.
  assert.ok(!('levene F' in exRecipe(IND_A, exSpread(IND_A)).expect));
  const q = exRecipe(QLEN);
  assert.ok('time-weighted mean' in q.expect && 'time covered' in q.expect && !('pooled n' in q.expect));
  assert.ok(Math.abs(q.expect['time covered'] - 5 * 600) < 1e-9, 'five runs from 0 to 600');
  for (const lang of LANGS) {
    const s = analysisScript(r2, lang);
    assert.ok(/^[\x00-\x7f]*$/.test(s), lang + ' script is ASCII');
    assert.ok(/levene_test\(spread_groups\)/.test(s) && /shapiro_check\(["']shapiro["'], x, /.test(s), lang + ' Levene and Shapiro-Wilk');
  }
  // Building is pure: twice gives the same recipe.
  assert.deepEqual(JSON.parse(JSON.stringify(exRecipe(TRANSIENT))), JSON.parse(JSON.stringify(exRecipe(TRANSIENT))));
});

checkRecipe('Summary and Plots on replication values with the spread test', exRecipe(IND_A, exSpread(IND_A, IND_B)), { smoke: true, also: noWarning });
checkRecipe('Summary and Plots on tally data', exRecipe(TRANSIENT), exChecks);
checkRecipe('Summary and Plots on tally data at 90%, with three datasets compared', exRecipe(TRANSIENT, exSpread(TRANSIENT, IND_A, IND_B), 0.9), exChecks);
checkRecipe('Summary and Plots on time-persistent data', exRecipe(QLEN), exChecks);
checkRecipe('Summary and Plots on replication values', exRecipe(example('queue-reps')[0]), exChecks);

// One long replication: one outcome, and so NaN sd and se, no interval, and
// no Shapiro-Wilk test; the pooled observations are still described.
{
  const r = exRecipe(LONG);
  assert.ok(Number.isNaN(r.expect.sd) && Number.isNaN(r.expect.se));
  assert.ok(!('interval df' in r.expect) && !('shapiro W [optional]' in r.expect) && 'pooled sd' in r.expect);
  checkRecipe('Summary and Plots on one long replication', r, {
    also: (stdout, lang, stderr) => { noWarning(stdout, lang, stderr); assert.ok(stdout.includes('sd: NaN   (analyzer: NaN)'), lang + ' prints a NaN sd'); }
  });
}

// A replication with no records gives no outcome and is named; one with a
// single observation has no sd of its own.
{
  const odd = makeDataset({ name: 'Odd tally', response: 'wait', unit: 'min', kind: 'tally',
    reps: [{ id: 'a', v: [1, 2, 3, 5] }, { id: 'b', v: [] }, { id: 'c', v: [4] }, { id: 'd', v: [4, 6, 7] }] });
  const r = exRecipe(odd);
  assert.ok(Number.isNaN(r.expect['rep b outcome']) && Number.isNaN(r.expect['rep c sd']) && r.expect.n === 3);
  for (const lang of LANGS) assert.ok(/left out: b\./.test(analysisScript(r, lang)), lang + ' names the replication with no outcome');
  checkRecipe('Summary and Plots on tally data with an empty and a one-observation replication', r, exChecks);
  // Time-persistent runs of unequal length with no end time, one of them empty.
  const lens = [300, 0, 760, 410, 848];
  const unequal = makeDataset({ name: 'Queue length, unequal', response: 'q', kind: 'time',
    reps: QLEN.reps.map((rp, i) => ({ id: rp.id, t: Array.from(rp.t).slice(0, lens[i]), v: Array.from(rp.v).slice(0, lens[i]) })) });
  const ru = exRecipe(unequal);
  assert.ok(Number.isNaN(ru.expect['rep ' + unequal.reps[1].id + ' outcome']) && ru.expect.n === 4);
  checkRecipe('Summary and Plots on time-persistent runs of unequal length with no end time', ru, exChecks);
}

// Constant outcomes: no spread, and so no Shapiro-Wilk test; the interval is the mean itself.
{
  const flat = makeDataset({ name: 'Flat', response: 'v', kind: 'reps', reps: [1, 2, 3, 4].map(id => ({ id, v: [2.5] })) });
  const r = exRecipe(flat, exSpread(flat, IND_A));
  assert.ok(!('shapiro W [optional]' in r.expect) && r.expect['interval half-width'] === 0 && 'levene p' in r.expect);
  checkRecipe('Summary and Plots on constant replication values', r, exChecks);
}

// Too many numbers: no records, and the page disables the buttons.
test('a Summary and Plots dataset past 200,000 numbers gives no script', () => {
  const big = makeDataset({ name: 'big', response: 'q', kind: 'tally', reps: [{ id: 1, v: Array.from({ length: 200001 }, (_, i) => i % 7) }] });
  assert.ok(exploreTooBig({ ds: big, spread: null }));
  assert.ok(!exploreTooBig({ ds: TRANSIENT, spread: exSpread(TRANSIENT, IND_A) }));
  // The spread groups count toward the cap too.
  const near = makeDataset({ name: 'near', response: 'q', kind: 'tally', reps: [{ id: 1, v: Array.from({ length: MAX_NUMBERS - 10 }, (_, i) => i % 7) }] });
  assert.ok(!exploreTooBig({ ds: near, spread: null }) && exploreTooBig({ ds: near, spread: exSpread(IND_A, IND_B) }));
  const r = exRecipe(big);
  assert.equal(r.tooBig, true);
  assert.ok(!r.records && !('n' in r.expect));
});

// ── Task 11: the Tidy R dialect ────────────────────────────────────────

test('the Tidy R script reads its data as a tibble, summarises with dplyr, tidies its tests, and plots with ggplot2', () => {
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, base: 0.95, plan: PLAN });
  const s = analysisScript(r, 'tidy');
  for (const needle of ['tibble(', 'summarise(', 'broom::tidy(']) assert.ok(s.includes(needle), needle);
  assert.ok(!s.includes('ggplot('), 'One System draws no figure');
  assert.ok(!analysisScript(r, 'R').includes('tibble('), 'Base R stays base');
  const sev = analysisScript(sevRecipe(FOUR), 'tidy');
  assert.ok(sev.includes('tibble(design = '), 'the designs as a long tibble');
  for (const t of [sev, analysisScript(stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }), 'tidy'), analysisScript(exRecipe(TRANSIENT), 'tidy')]) {
    assert.ok(t.includes('ggplot('), 'a page with a figure draws it with ggplot2');
  }
});

// Every page in both R dialects: the tidy forms appear in Tidy R only, base
// graphics in Base R only, and both print the same report lines in the same
// order, which is what lets the harness compare Tidy R's output as it does
// Base R's.
test('Tidy R carries each page\'s tidy forms and the same report lines as Base R', () => {
  const pooledX = TRANSIENT.reps.flatMap(p => Array.from(p.v));
  const cases = [
    ['one, t', oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, base: 0.95, plan: PLAN }),
      ['d_tbl <- tibble(rep_id = rep_id, outcome = x)', 'd <- d_tbl |> describe_tbl(outcome)', 'if (!is.null(ti$test)) print(broom::tidy(ti$test))']],
    ['one, signed-rank', oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.95, base: 0.95, plan: PLAN }),
      ['print(broom::tidy(sr$test))']],
    ['one, pooled', oneRecipe({ ds: TRANSIENT, x: pooledX, ids: null, pooled: true, proc: 't', level: 0.95, base: 0.95, plan: null }),
      ['d_tbl <- tibble(observation = x)', 'd <- d_tbl |> describe_tbl(observation)']],
    ['two, Welch', twoOf(IND_A, IND_B, 't', 0.95, PLAN2),
      ['d_tbl <- bind_rows(tibble(design = "A", outcome = a), tibble(design = "B", outcome = b))', 'da <- d_tbl |> filter(design == "A") |> describe_tbl(outcome)',
        'print(broom::tidy(w$test))', 'print(suppressMessages(broom::tidy(fr$test)))']],
    ['two, rank-sum', twoOf(IND_A, IND_B, 'np', 0.95, PLAN2), ['print(broom::tidy(rs$test))']],
    ['two, paired t', pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2), ['pairs_tbl <- tibble(pair_id = pair_id, a = a, b = b)', 'print(broom::tidy(pr$test))']],
    ['two, paired signed-rank', pairedRecipe(CRN_A, CRN_B, 'np', 'position', PLAN2), ['print(broom::tidy(sr$test))']],
    ['several, Tukey', sevRecipe(FOUR),
      ['d_tbl <- tibble(design = factor(rep(seq_len(k), lengths(groups))), name = rep(design_names, lengths(groups)), outcome = unlist(groups))',
        'bind_rows(sm$items)', 'print(broom::tidy(av$fit))', 'broom::tidy(TukeyHSD(av$fit, "design"', 'print(bind_rows(ph$pairs))',
        'family_tests[["1-2"]] <- cmp$test', 'family_tbl <- bind_rows(lapply(family_tests, broom::tidy), .id = "pair")', 'p <- ggplot(fig_tbl, aes(y = design))']],
    ['several, Welch', sevRecipe(FOUR, { varMode: 'welch' }), ['print(suppressMessages(broom::tidy(av$test)))', 'print(bind_rows(ph$pairs))']],
    ['several, Kruskal-Wallis with a benchmark', sevRecipe(SIX_D, { proc: 'np', bench: 2 }),
      ['bind_rows(lapply(srs, function(s) broom::tidy(s$test)), .id = "design")', 'print(bind_rows(rk$pairs))', 'geom_vline(xintercept = benchmark']],
    ['several, Friedman', sevRecipe(FOUR_CRN, { paired: true, proc: 'np' }),
      ['block = rep(block_id, times = k)', 'print(broom::tidy(rk$test))', 'print(tibble(design = seq_len(k), survives = ss$survivors']],
    ['steady', stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }),
      ['records_tbl <- bind_rows(lapply(reps, function(r) tibble(', 'print(broom::tidy(bm$test))', 'ggplot(batch_tbl, aes(batch, mean))']],
    ['explore', exRecipe(TRANSIENT),
      ['records_tbl <- bind_rows(', 'out_tbl <- tibble(rep_id = ', 'd <- out_tbl |> filter(is.finite(outcome)) |> describe_tbl(outcome)', 'po <- records_tbl |> describe_tbl(v)',
        'print(broom::tidy(ti$test))', 'sw <- shapiro_check(', 'print(broom::tidy(sw))', 'plot_outcomes(tibble(outcome = x), outcome, ']],
    ['explore, Levene', exRecipe(IND_A, exSpread(IND_A, IND_B)), ['print(broom::tidy(lv$test))']]
  ];
  const tidyMarks = ['tibble(', 'describe_tbl', 'summarise(', 'broom::', 'ggplot', 'bind_rows(', 'library('];
  const baseGraphics = /(^|[^\w.])(plot|hist|qqnorm|qqline|segments|abline|par)\(/m;
  const reports = s => s.split('\n').filter(l => /\breport\(/.test(l) && !/^\s*#/.test(l) && !/^report <- function/.test(l)).map(l => l.trim());
  for (const [label, r, needles] of cases) {
    const tidy = analysisScript(r, 'tidy'), base = analysisScript(r, 'R');
    for (const n of needles) assert.ok(tidy.includes(n), label + ': ' + n);
    for (const m of tidyMarks) assert.ok(!base.includes(m), label + ': Base R has no ' + m);
    assert.ok(!baseGraphics.test(tidy.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')), label + ': Tidy R draws no base graphics');
    assert.ok(/^[\x00-\x7f]*$/.test(tidy), label + ': Tidy R is ASCII');
    assert.ok(!/\$\{|`/.test(tidy), label + ': no template residue');
    assert.deepEqual(reports(tidy), reports(base), label + ': the same report lines');
    if (r.page === 'one' || r.page === 'two') assert.ok(!tidy.includes('ggplot('), label + ': no figure');
  }
});
