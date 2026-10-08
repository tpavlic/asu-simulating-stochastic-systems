// The "Regenerate these results in" scripts: a recipe becomes a MATLAB, R, or
// Python script that recomputes the page's numbers and prints each beside the
// analyzer's own. The harness here writes a script, runs it where the language
// is installed, parses its report lines, and compares them with the recipe's
// `expect` map. R and Python run on every test run when installed (the full
// matrix under OA_SCRIPTS=1, and otherwise only the fixtures marked smoke, a
// subset on every page); MATLAB runs under OA_MATLAB=1 only, because its
// start-up takes about a minute, and then runs every script in one session
// (see "MATLAB batch" below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisScript, parseReport, scriptFileName, ascii, sectionLine, ANALYSIS_WRITERS } from '../js/io/analysis_scripts.js';
import { baseRecipe, outcomeVector, oneRecipe, oneTooBig, twoRecipe } from '../js/io/recipes.js';
import { makeDataset } from '../js/data/model.js';
import { sniff, buildDatasets } from '../js/io/parse.js';
import { EXAMPLES } from '../js/data/examples.js';

// ── Harness ─────────────────────────────────────────────────────────────

function has(cmd, probeArgs) {
  const r = spawnSync(cmd, probeArgs, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
// The Python scripts need SciPy 1.11 or later (studentized_range.ppf, dunnett,
// tukey_hsd's intervals); an older one exits with status 3 here.
const PY_PROBE = 'import re, sys, numpy, scipy; v = tuple(int(re.match(r"\\d+", p).group()) for p in scipy.__version__.split(".")[:2]); sys.exit(0 if v >= (1, 11) else 3)';
function pyStatus() {
  const r = spawnSync('python3', ['-c', PY_PROBE], { encoding: 'utf8' });
  if (r.error || r.status === 1) return 'python3 with NumPy and SciPy is not installed';
  if (r.status === 3) return 'SciPy is older than 1.11';
  return r.status === 0 ? true : 'python3 with NumPy and SciPy is not installed';
}
const PY = pyStatus();
export const HAS = {
  R: has('Rscript', ['--version']),
  tidy: has('Rscript', ['--vanilla', '-e', 'if (getRversion() < "4.1" || packageVersion("dplyr") < "1.1") quit(status = 1); for (p in c("tibble","tidyr","broom","ggplot2")) if (!requireNamespace(p, quietly = TRUE)) quit(status = 1)']),
  py: PY === true,
  // Found on the PATH, not started: the batch below starts MATLAB once, and a
  // MATLAB that cannot start fails every MATLAB test with its own message.
  m: process.env.OA_MATLAB === '1' && has('sh', ['-c', 'command -v matlab'])
};
// Why a language cannot run here.
const MISSING = { R: 'R is not installed', tidy: 'R 4.1 with dplyr 1.1, tibble, tidyr, broom, and ggplot2 is not installed', py: PY,
  m: process.env.OA_MATLAB === '1' ? 'MATLAB is not installed' : 'MATLAB runs under OA_MATLAB=1 only' };
const FULL = process.env.OA_SCRIPTS === '1';
export const LANGS = ['R', 'tidy', 'py', 'm'];

/** Loads a bundled example into datasets, as the Import page does. */
export function example(id) {
  const ex = EXAMPLES.find(x => x.id === id);
  const sn = sniff(ex.text, { name: ex.mapping.name });
  return buildDatasets(sn, ex.mapping).datasets;
}

/**
 * Writes the script, runs it, and returns the parsed report and both output
 * streams (or throws with the output). `text` replaces the script the recipe
 * gives, and `files` (name to contents) are written beside it, where the
 * script runs. MATLAB runs here in a session of its own; the fixtures below
 * run their MATLAB scripts through the batch instead (runIn).
 */
export function runScript(recipe, lang, { text = null, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oa-regen-'));
  const name = scriptFileName(recipe, lang);
  const f = join(dir, name);
  try {
    for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
    writeFileSync(f, text != null ? text : analysisScript(recipe, lang));
    // A hung script fails its test instead of hanging the suite. A script with a
    // line per replication can print megabytes, past spawnSync's 1 MB default.
    const big = 256 * 1024 * 1024;
    let r;
    if (lang === 'R' || lang === 'tidy') r = spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: big });
    else if (lang === 'py') r = spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: big, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) });
    else r = spawnSync('matlab', ['-batch', `cd('${dir}'); run('${name}')`], { cwd: dir, encoding: 'utf8', timeout: 600000, maxBuffer: big });
    return Object.assign(scriptResult(r, lang, name), { file: f });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A finished run ({ status, stdout, stderr, error }, as spawnSync gives it) as runScript returns it, or the error it throws. */
function scriptResult(r, lang, name) {
  if (r.error) throw new Error(`${lang} script did not finish (${name}): ${r.error.message}\n${r.stdout || ''}\n${r.stderr || ''}`);
  if (r.status !== 0) throw new Error(`${lang} script failed (${name}):\n${r.stdout}\n${r.stderr}`);
  return { report: parseReport(r.stdout), stdout: r.stdout, stderr: r.stderr || '' };
}

// ── MATLAB batch ────────────────────────────────────────────────────────
//
// MATLAB takes from fifteen seconds to a minute to start, which, once per
// script, came to most of the full matrix's hour. Every MATLAB script in this
// file therefore runs in one session. A test registers its script when it is
// defined (matlabJob, with a function that builds the script and its files),
// the batch starts once every test is defined (startMatlab, the last line of
// this file) and runs in the background while the R and Python tests run, and
// each MATLAB test then waits for its own script's result (matlabOutcome),
// which reads as a run of its own would. test/run_matlab_batch.m runs each
// script from its own folder in a fresh workspace and writes what it printed
// into that folder. A script still running after M_TIMEOUT is stopped and
// fails its own test, as does one that brings MATLAB down, and the scripts
// after it run in a new session. A run filtered by --test-name-pattern or
// --test-skip-pattern batches only the scripts of the tests it selects, and a
// test whose script was left out gets it from a later batch.

const HERE = dirname(fileURLToPath(import.meta.url));
const M_TIMEOUT = 600000;   // one script, as when each started a MATLAB of its own, or the gap between two
const M_START = 600000;     // MATLAB's start, up to its first script
const M_EXIT = 120000;      // MATLAB's exit, after its last script
const mJobs = [];
let mRoot = null, mChild = null, mBatches = 0, mOpen = false;

// The name patterns node passes to this file's process, as regular expressions.
function namePatterns(flag) {
  const out = [], a = process.execArgv;
  for (let i = 0; i < a.length; i++) {
    let v = null;
    if (a[i].startsWith(flag + '=')) v = a[i].slice(flag.length + 1);
    else if (a[i] === flag && i + 1 < a.length) v = a[++i];
    if (v == null) continue;
    const m = /^\/(.*)\/([a-z]*)$/s.exec(v);
    out.push(m ? new RegExp(m[1], m[2]) : new RegExp(v));
  }
  return out;
}
const NAME_ONLY = namePatterns('--test-name-pattern'), NAME_SKIP = namePatterns('--test-skip-pattern');
const selected = title => (!NAME_ONLY.length || NAME_ONLY.some(re => re.test(title))) && !NAME_SKIP.some(re => re.test(title));

/**
 * Registers the MATLAB script of the test titled `title`, or returns null when
 * MATLAB does not run here (`smoke` as for skipFor). `build()` returns
 * { name, text, files }: the script's file name, its text, and the files
 * (name to contents) written beside it. It runs when the batch starts, and an
 * error it throws fails the test.
 */
function matlabJob(title, smoke, build) {
  if (skipFor('m', smoke)) return null;
  const job = { id: mJobs.length, wanted: selected(title), build, dir: null, script: null, result: null };
  job.done = new Promise(resolve => { job.settle = r => { if (!job.result) { job.result = r; resolve(r); } }; });
  mJobs.push(job);
  if (mOpen && job.wanted) runMatlab();
  return job;
}

/** Waits for a job's run: { status, stdout, stderr, error }, as spawnSync gives it. */
function matlabOutcome(job) {
  job.wanted = true;
  if (!job.result && !collect(job)) runMatlab();
  return job.done;
}

// Settles a job the driver has finished, and says whether it had.
function collect(j) {
  if (j.result || !j.dir || !existsSync(join(j.dir, 'status.txt'))) return !!j.result;
  const read = f => readFileSync(join(j.dir, f), 'utf8');
  j.settle({ status: Number(read('status.txt')), stdout: read('stdout.txt'), stderr: read('stderr.txt'), error: null });
  return true;
}

/** Waits for a job's run as matlabOutcome does, and throws the error its build() threw, if any. */
async function matlabRun(job) {
  const r = await matlabOutcome(job);
  if (r.buildError) throw r.buildError;
  return r;
}

/** Runs a fixture's script: in the batch when `job` is given, and otherwise as runScript does. */
async function runIn(job, recipe, lang, opts) {
  if (!job) return runScript(recipe, lang, opts);
  return scriptResult(await matlabRun(job), 'm', job.script + '.m');
}

/** Starts the batch; called once, after every test is defined. */
function startMatlab() {
  mOpen = true;
  runMatlab();
}

function stopMatlab() {
  if (mChild) try { process.kill(-mChild.pid, 'SIGKILL'); } catch { /* already gone */ }
}

// Starts one MATLAB session on every wanted script not yet run, unless one is
// running; when it ends, the next starts on whatever is left.
function runMatlab() {
  if (mChild || !mOpen) return;
  const todo = mJobs.filter(j => j.wanted && !j.result);
  if (!todo.length) return;
  if (!mRoot) {
    mRoot = mkdtempSync(join(tmpdir(), 'oa-matlab-'));
    // MATLAB runs in a process group of its own, so that stopping it stops
    // every process it started; this process stops it on the way out.
    process.on('exit', () => { stopMatlab(); rmSync(mRoot, { recursive: true, force: true }); });
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => { stopMatlab(); if (!process.listenerCount(sig)) process.kill(process.pid, sig); });
    }
  }
  const list = [];
  for (const j of todo) {
    if (!j.dir) {
      try {
        const { name, text, files = {} } = j.build();
        const dir = join(mRoot, 'job' + String(j.id).padStart(4, '0'));
        mkdirSync(dir);
        for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
        writeFileSync(join(dir, name), text);
        j.dir = dir;
        j.script = name.replace(/\.m$/, '');
      } catch (e) {
        j.settle({ status: null, stdout: '', stderr: '', error: e, buildError: e });
        continue;
      }
    }
    list.push(j);
  }
  if (!list.length) return;
  const n = ++mBatches;
  const listFile = join(mRoot, 'batch' + n + '.txt'), logFile = join(mRoot, 'batch' + n + '.log');
  writeFileSync(listFile, list.map(j => j.dir + '\t' + j.script).join('\n') + '\n');
  const q = s => s.replace(/'/g, "''");
  const fd = openSync(logFile, 'w');
  try {
    mChild = spawn('matlab', ['-batch', `addpath('${q(HERE)}'); run_matlab_batch('${q(listFile)}')`],
      { cwd: mRoot, stdio: ['ignore', fd, fd], detached: true });
  } finally { closeSync(fd); }
  const child = mChild, t0 = Date.now();
  const at = (j, f) => join(j.dir, f);
  const read = (j, f) => (existsSync(at(j, f)) ? readFileSync(at(j, f), 'utf8') : '');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  let stopped = null;   // the job MATLAB was stopped in, 'start', or 'between'
  // `done` counts the finished scripts, and `doneAt` is when the latest of them
  // finished. Between two scripts (in the driver's own clean-up) or after the
  // last, MATLAB is stopped once nothing has finished for M_TIMEOUT or M_EXIT,
  // and the scripts not yet started run in a new session.
  let done = 0, doneAt = t0;
  const poll = () => {
    for (const j of list) collect(j);
    const n = list.filter(j => j.result).length;
    if (n !== done) { done = n; doneAt = Date.now(); }
    if (stopped) return;
    const cur = list.find(j => !j.result && existsSync(at(j, 'started.txt')));
    if (cur && Date.now() - statSync(at(cur, 'started.txt')).mtimeMs > M_TIMEOUT) { stopped = cur; stopMatlab(); }
    if (!cur && !list.some(j => existsSync(at(j, 'started.txt'))) && Date.now() - t0 > M_START) { stopped = 'start'; stopMatlab(); }
    if (!cur && done && Date.now() - doneAt > (done === list.length ? M_EXIT : M_TIMEOUT)) { stopped = 'between'; stopMatlab(); }
  };
  const timer = setInterval(poll, 200);
  let ended = false;
  const end = how => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    mChild = null;
    poll();
    const begun = list.some(j => existsSync(at(j, 'started.txt')));
    for (const j of list) {
      if (j.result) continue;
      let why;
      if (stopped === j) why = `it was still running after ${M_TIMEOUT / 1000} s, and so MATLAB was stopped`;
      else if (existsSync(at(j, 'started.txt'))) why = `MATLAB stopped while running it (${how})`;
      else if (!begun) why = stopped === 'start' ? `MATLAB had not started a script after ${M_START / 1000} s` : `MATLAB did not start (${how})`;
      else continue;   // not started: the next session runs it
      j.settle({ status: null, stdout: read(j, 'stdout.txt'), stderr: why + '\n' + log(), error: new Error(why) });
    }
    runMatlab();
  };
  child.on('error', e => end(e.message));
  child.on('exit', (code, signal) => end(signal ? 'signal ' + signal : 'exit status ' + code));
}

// Tolerances: a relative 1e-6 on max(1, |expected|) by default; the keys a
// language can only approximate are looser (see the spec, decision 6). A
// post-hoc rule's differences, standard errors, and degrees of freedom are
// exact; what rests on its quantile (the critical value, the half-width, the
// interval's ends, and a p-value) is held to 1e-5 for the studentized range
// and Dunnett's quantile in every language (MATLAB's scripts compute Dunnett's
// value themselves, because multcompare's root search stops at about 1e-4, and
// Tukey's, because multcompare's studentized range is approximate on few
// degrees of freedom).
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
  if (!HAS[lang]) return MISSING[lang];
  if (!smoke && !FULL && lang !== 'm') return 'OA_SCRIPTS=1 runs the full matrix';
  return false;
}

/**
 * Runs one recipe through every installed language and compares. `smoke`
 * runs even without OA_SCRIPTS=1; `also(stdout, lang, stderr)` makes further
 * checks on a run's raw output. `notInR` matches the keys that R and Tidy R
 * print but are not held to: those resting on R's own qtukey and ptukey,
 * which are approximate on few degrees of freedom (about 1% or more off at 2,
 * several percent with many designs), where the scripts keep them as the
 * idiomatic call and say so in a comment.
 */
export function checkRecipe(name, recipe, { smoke = false, also = null, notInR = null } = {}) {
  // Base R's stderr for this fixture, kept from its own run (or run when Tidy R needs it).
  let baseErr = null;
  for (const lang of LANGS) {
    const title = `${name} regenerates in ${lang}`;
    const job = lang === 'm' ? matlabJob(title, smoke, () => ({ name: scriptFileName(recipe, 'm'), text: analysisScript(recipe, 'm') })) : null;
    test(title, { skip: skipFor(lang, smoke) }, async () => {
      const { report, stdout, stderr } = await runIn(job, recipe, lang);
      if (lang === 'R') baseErr = stderr;
      let expect = recipe.expect;
      if (notInR && (lang === 'R' || lang === 'tidy')) {
        expect = Object.assign({}, expect);
        for (const k of Object.keys(expect)) if (notInR.test(k)) expect[k] = null;
      }
      compareReport(report, expect, lang === 'tidy' ? 'R' : lang, recipe);
      // The tidyverse layer of the Tidy R script (its tibbles, broom's tables,
      // and ggplot2's figures) adds nothing to what Base R prints on stderr.
      if (lang === 'tidy') {
        if (baseErr === null) baseErr = runScript(recipe, 'R').stderr;
        assert.deepEqual(stderrAdded(stderr, baseErr), [], 'Tidy R prints on stderr what Base R does not:\n' + stderr);
      }
      if (also) also(stdout, lang, stderr);
    });
  }
}

/** The lines of `stderr` that `base` lacks, blank lines ignored. */
export function stderrAdded(stderr, base) {
  const seen = new Set(String(base).split(/\r?\n/).map(l => l.trim()));
  return String(stderr).split(/\r?\n/).map(l => l.trim()).filter(l => l && !seen.has(l));
}

/**
 * The report lines of a script's output whose names `expect` holds, counted
 * twice: every such line, and those ending in "(analyzer: ...)". parseReport
 * strips that column, and so a lookup of the analyzer's value that fails, and
 * prints the line without it, shows up only here.
 */
export function analyzerColumnCounts(stdout, expect) {
  const names = new Set(Object.keys(expect).map(k => k.replace(/ \[optional\]$/, '')));
  let lines = 0, withColumn = 0;
  const bare = [];
  for (const raw of String(stdout).split(/\r?\n/)) {
    const m = /^(.+?): (.*)$/.exec(raw);
    if (!m || !names.has(m[1])) continue;
    lines++;
    if (/\s\(analyzer: .*\)$/.test(m[2])) withColumn++;
    else bare.push(m[1]);
  }
  return { lines, withColumn, bare };
}

/** A script's text up to its Data section, which opens on the line the writers emit for it. */
export function settingsOf(text, lang) {
  const at = text.indexOf('\n' + sectionLine(lang, 'Data') + '\n');
  assert.ok(at > 0, lang + ': a Data section');
  return text.slice(0, at);
}

/** Asserts that every report line `recipe.expect` names carries the analyzer's value. */
export function assertAnalyzerColumns(stdout, recipe, lang) {
  const { lines, withColumn, bare } = analyzerColumnCounts(stdout, recipe.expect);
  assert.ok(lines > 0, lang + ' printed no report line the recipe names');
  assert.equal(withColumn, lines, lang + ': report lines with no analyzer column: ' + bare.join('; '));
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
  return oneRecipe({ ds, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, title,
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

test('stderrAdded keeps the lines one run prints on stderr that another does not', () => {
  assert.deepEqual(stderrAdded('Warning message:\nIn f(x) : odd\n\nRemoved 2 rows\n', 'Warning message:\nIn f(x) : odd\n'), ['Removed 2 rows']);
  assert.deepEqual(stderrAdded('', 'Warning message:'), []);
  assert.deepEqual(stderrAdded('  \n', ''), []);
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

// Ids are numbers only when every one prints back exactly as the page shows it.
test('ids such as 007 or 1.0 stay strings, and plain ones become numbers', () => {
  const mk = ids => makeDataset({ name: 'ids', response: 'v', kind: 'reps', reps: ids.map((id, i) => ({ id, v: [1 + i] })) });
  const R = ids => analysisScript(descRecipe('Ids', mk(ids)), 'R');
  assert.ok(R(['007', '8', '9']).includes('rep_id <- c("007", "8", "9")'));
  assert.ok(R(['1.0', '2', '3']).includes('rep_id <- c("1.0", "2", "3")'));
  assert.ok(R(['01', '02', '03']).includes('rep_id <- c("01", "02", "03")'));
  assert.ok(R(['1', '2', '10']).includes('rep_id <- c(1, 2, 10)'));
  assert.ok(R([1, 2, 3]).includes('rep_id <- c(1, 2, 3)'));
  assert.ok(analysisScript(descRecipe('Ids', mk(['007', '8', '9'])), 'm').includes("rep_id = {'007', '8', '9'};"));
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
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, provenance: prov, plan: PLAN });
  assert.equal(r.page, 'one');
  assert.equal(r.title, 'Interval on the mean: ' + QUEUE.name);
  assert.deepEqual(r.provenance, prov);
  assert.notEqual(r.provenance, prov, 'the provenance is copied');
  assert.equal(r.data.values.length, 20);
  for (const k of ['n', 'mean', 'df', 't quantile', 'lower', 'upper', 'shapiro W [optional]', 's2', 'sd upper', 'plan n for half-width', 'plan n for power', 'power at current R']) assert.ok(k in r.expect, k);
  assert.ok(!('pseudo-median' in r.expect));
  assert.ok(!('plan n for power (rank)' in r.expect));
  assert.ok(r.expect['plan half-width target'] > 0);
  // A relative target travels as its percentage, and the script works out plan_h from the data's own mean.
  assert.deepEqual(Object.keys(r.settings), ['plan_rel', 'plan_delta', 'plan_power']);
  assert.equal(r.settings.plan_rel, 10);
  assert.ok(analysisScript(r, 'R').includes('plan_h <- plan_rel / 100 * abs(d$mean)'));
  assert.ok(analysisScript(r, 'py').includes('plan_h = plan_rel / 100 * abs(d["mean"])'));
  assert.ok(analysisScript(r, 'm').includes('plan_h = plan_rel / 100 * abs(d.mean);'));
  const ra = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, provenance: prov,
    plan: { relative: false, rel: 10, abs: 0.25, delta: 0.3, power: 0.8 } });
  assert.deepEqual(ra.settings, { plan_h: 0.25, plan_delta: 0.3, plan_power: 0.8 });
  assert.ok(!analysisScript(ra, 'R').includes('plan_rel'));
  const s = analysisScript(r, 'R');
  assert.ok(s.includes('t.test('), 'R uses t.test');
  assert.ok(s.includes('shapiro.test('), 'R uses shapiro.test');
  for (const lang of LANGS) assert.ok(/^[\x00-\x7f]*$/.test(analysisScript(r, lang)), lang + ' script is not ASCII');
});

test('oneRecipe under the Wilcoxon procedure: no t interval, no check, and rank-inflated plans', () => {
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.9, provenance: oneProv(QUEUE, 0.9, 'np'), plan: PLAN });
  assert.equal(r.title, 'Interval on the pseudo-median: ' + QUEUE.name);
  assert.equal(r.expect.exact, 1);
  assert.ok('achieved level' in r.expect && !('df' in r.expect) && !('shapiro W [optional]' in r.expect));
  assert.ok(r.expect['plan n for power (rank)'] >= r.expect['plan n for power']);
  const R = analysisScript(r, 'R');
  assert.ok(R.includes('wilcox.test(') && R.includes('exact = exact, correct = TRUE'));
});

{
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, provenance: oneProv(QUEUE, 0.95, 't'), plan: PLAN });
  checkRecipe('One System, t interval on queue-reps', r, { smoke: true });
  const rn = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.90, provenance: oneProv(QUEUE, 0.9, 'np'),
    plan: { relative: false, rel: 10, abs: 0.25, delta: 0.5, power: 0.9 } });
  checkRecipe('One System, Wilcoxon on queue-reps (exact)', rn);
}

// Review Focus 1: a replication that gave no outcome is left out and named.
{
  const ds = makeDataset({ name: 'gappy', response: 'wait', kind: 'tally', reps: [{ id: 1, v: [1, 2, 3] }, { id: 2, v: [] }, { id: 3, v: [2, 2, 5] }, { id: 4, v: [4] }] });
  const o = outcomeVector(ds);
  assert.deepEqual(o.dropped, [2]);
  const r = oneRecipe({ ds, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, provenance: oneProv(ds, 0.95, 't'), plan: null });
  assert.equal(r.expect.n, 3);
  assert.ok(analysisScript(r, 'py').includes('left out: 2'));
  checkRecipe('One System on a dataset with an empty replication', r);
}

// Review Focus 2: ties and n >= 50 put the Wilcoxon interval on the normal approximation.
{
  const tied = makeDataset({ name: 'tied', response: 'v', kind: 'reps', reps: [3, 3, 4, 5, 5, 5, 6, 7, 7, 9].map((v, i) => ({ id: i + 1, v: [v] })) });
  const r = oneRecipe({ ds: tied, x: tied.reps.map(p => p.v[0]), ids: tied.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, provenance: oneProv(tied, 0.95, 'np'), plan: null });
  assert.equal(r.expect.exact, 0);
  checkRecipe('One System, Wilcoxon with ties (normal approximation)', r);
  // Sixty distinct outcomes, so that only n >= 50 sends the procedure to the approximation.
  const vals = Array.from({ length: 60 }, (_, i) => Math.round(1e6 * (5 + 2 * Math.sin(i * 1.7) + 0.003 * i)) / 1e6);
  assert.equal(new Set(vals).size, 60);
  const big = makeDataset({ name: 'sixty', response: 'v', kind: 'reps', reps: vals.map((v, i) => ({ id: i + 1, v: [v] })) });
  const rb = oneRecipe({ ds: big, x: vals, ids: big.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, provenance: oneProv(big, 0.95, 'np'), plan: null });
  assert.equal(rb.expect.exact, 0);
  checkRecipe('One System, Wilcoxon on sixty untied outcomes (normal approximation)', rb);
}

// Outcomes that are all equal, nonzero and zero: the Wilcoxon interval is the
// common value at both ends in every language, with no warning printed.
for (const c of [5, 0]) {
  const ds = makeDataset({ name: 'constant ' + c, response: 'v', kind: 'reps', reps: [1, 2, 3, 4, 5, 6].map(id => ({ id, v: [c] })) });
  const x = ds.reps.map(p => p.v[0]);
  const r = oneRecipe({ ds, x, ids: ds.reps.map(p => p.id), pooled: false, proc: 'np', level: 0.95, provenance: oneProv(ds, 0.95, 'np'), plan: null });
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
  const r = oneRecipe({ ds, x: [1.5, 2.5, 3.5, 2, 2.2, 5.1, 0.4], ids: null, pooled: true, proc: 't', level: 0.99, provenance: prov, plan: PLAN });
  assert.equal(r.expect.n, 7);
  assert.ok(!('s2' in r.expect) && !('plan n for power' in r.expect) && !('shapiro W [optional]' in r.expect));
  assert.ok(analysisScript(r, 'm').includes('pooled across its replications'));
  checkRecipe('One System on pooled observations', r);
}

// The pooled override embeds every observation, and so it is held to the
// 200,000-number cap, past which its scripts read the Observations CSV;
// replication outcomes are not held to it.
test('One System under the pooled override is held to the 200,000-number cap', () => {
  const many = new Float64Array(MAX_NUMBERS + 1);
  assert.equal(oneTooBig({ pooled: true, x: many }), true);
  assert.equal(oneTooBig({ pooled: true, x: many.subarray(0, MAX_NUMBERS) }), false);
  assert.equal(oneTooBig({ pooled: false, x: many }), false);
});

// A plan with no answer: a relative target on a zero mean, printed NaN in every language.
{
  const ds = makeDataset({ name: 'centered', response: 'v', kind: 'reps', reps: [-2, -1, 0, 1, 2].map((v, i) => ({ id: i + 1, v: [v] })) });
  const r = oneRecipe({ ds, x: [-2, -1, 0, 1, 2], ids: [1, 2, 3, 4, 5], pooled: false, proc: 't', level: 0.95, provenance: oneProv(ds, 0.95, 't'), plan: PLAN });
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
  return twoRecipe({ dsA, dsB, eA: est(dsA), eB: est(dsB), mode: 'independent', proc, level,
    provenance: twoProv(dsA, dsB, level, proc, plan), plan });
}
const reps = (name, vals) => makeDataset({ name, response: 'w', kind: 'reps', reps: vals.map((v, i) => ({ id: i + 1, v: [v] })) });
const noWarning = (stdout, lang, stderr) => assert.ok(!/warning/i.test(stdout + stderr), lang + ' prints no warning:\n' + stdout + stderr);

test('twoRecipe (independent) carries both designs, the Welch keys, and the page\'s provenance', () => {
  const prov = twoProv(IND_A, IND_B, 0.95, 't', PLAN2);
  const r = twoRecipe({ dsA: IND_A, dsB: IND_B, eA: est(IND_A), eB: est(IND_B), mode: 'independent', proc: 't', level: 0.95, provenance: prov, plan: PLAN2 });
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
  return twoRecipe({ dsA, dsB, eA, eB, mode: 'paired', match: m, proc, level,
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

// The pairs comment adds "(A)" and "(B)" only where the names do not already end in them.
test('the pairs comment names A and B once when the dataset names end in them', () => {
  const flat = r => analysisScript(r, 'R').replace(/\n# /g, ' ');
  const ends = flat(pairedRecipe(reps('Design A', [1, 2, 3]), reps('Design B', [1.5, 2.1, 3.3]), 't', 'id', null));
  assert.ok(ends.includes('a holds Design A and b holds Design B, matched by replication id'), 'no letter repeated');
  const other = flat(pairedRecipe(reps('Old line', [1, 2, 3]), reps('New line', [1.5, 2.1, 3.3]), 't', 'id', null));
  assert.ok(other.includes('a holds Old line (A) and b holds New line (B), matched'), 'the letters added');
  const swapped = flat(pairedRecipe(reps('Run B', [1, 2, 3]), reps('Run A', [1.5, 2.1, 3.3]), 't', 'id', null));
  assert.ok(swapped.includes('a holds Run B (A) and b holds Run A (B)'), 'a name ending in the other letter keeps its own');
});

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
    const r = oneRecipe({ ds, x: v, ids: v.map((_, i) => i + 1), pooled: false, proc: 'np', level: 0.95, provenance: oneProv(ds, 0.95, 'np'), plan: null });
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
  assert.deepEqual(Object.keys(r.settings), ['control', 'family', 'epsilon', 'direction', 'plan_means_h', 'plan_diffs_h', 'plan_delta', 'plan_power']);
  assert.deepEqual([r.settings.family, r.settings.epsilon, r.settings.direction], ['pairs', 0.5, 'max']);
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
  assert.deepEqual(Object.keys(rc.settings), ['control', 'family', 'benchmark', 'epsilon', 'direction', 'plan_means_h', 'plan_diffs_h', 'plan_delta', 'plan_power']);
  assert.equal(rc.settings.family, 'control');
  assert.ok(analysisScript(rc, 'R').includes('abline(v = benchmark'));
  // Under the rank procedures: pseudo-medians, shifts, and the inflated plans.
  const rn = sevRecipe(SIX_D, { proc: 'np' });
  assert.equal(rn.expect.C, 15);
  for (const k of ['design 6 pseudo-median', 'design 1 exact', 'shift 1-6 stat', 'shift 2-3 exact', 'plan means n (rank)', 'plan diffs n (rank)']) assert.ok(k in rn.expect, k);
  assert.ok(!('design 1 mean' in rn.expect) && !('shapiro design 1 W [optional]' in rn.expect));
  assert.ok(analysisScript(rn, 'R').includes('cmp <- rank_sum(groups[[i]], groups[[j]], per_c)'));
  // Paired: blocks named by id, paired t intervals, the differences' checks.
  const rp = sevRecipe(FOUR_CRN, { paired: true });
  assert.equal(rp.groups.ids.length, 10);
  assert.ok('shapiro diff 1-2 W [optional]' in rp.expect);
  assert.ok(analysisScript(rp, 'R').includes('cmp <- paired_t(groups[[i]], groups[[j]], per_c)'));
  assert.ok(analysisScript(rp, 'm').includes('block_id = '));
  // The paired flag the analysis of variance reads, and the note on what the settings change.
  assert.ok(analysisScript(r, 'R').includes('paired <- FALSE') && analysisScript(rp, 'py').includes('paired = True') && analysisScript(rp, 'm').includes('paired = true;'));
  for (const lang of LANGS) {
    const text = analysisScript(rc, lang), flat = text.replace(/\n[#%] /g, ' ');   // the comment's lines joined
    assert.ok(flat.includes('family chooses the pairwise comparisons') && flat.includes('benchmark is the value'), lang + ' explains the settings');
    // Every editable choice is assigned in the Settings block, before the data.
    const settings = settingsOf(text, lang);
    for (const v of ['control', 'family', 'benchmark', 'epsilon', 'direction', 'plan_means_h', 'plan_diffs_h', 'plan_delta', 'plan_power']) {
      assert.ok(new RegExp('\\n' + v + ' (<-|=) ').test(settings), lang + ': ' + v + ' is a setting');
      assert.ok(!new RegExp('\\n' + v + ' (<-|=) ').test(text.slice(settings.length)), lang + ': ' + v + ' is assigned once');
    }
    // The pairs are formed from the settings, not written in.
    assert.ok(/family_pairs (<-|=) /.test(text) && !/family_pairs (<-|=) (list\(c\(\d|\[\(\d|\[\d+ \d)/.test(text), lang + ': family_pairs from the settings');
  }
  // The analysis of variance's rank plan line.
  assert.ok(analysisScript(rn, 'R').includes('report("plan anova n (rank)", ceiling(ppa$n * pi / 3)'));
});

const sevChecks = { also: noWarning };
// The checks of a fixture whose every report line must carry the analyzer's
// value: the pairs the page compared are looked up by label at run time.
const sevPinned = r => ({ also: (stdout, lang, stderr) => { noWarning(stdout, lang, stderr); assertAnalyzerColumns(stdout, r, lang); } });
{
  const r = sevRecipe(FOUR);
  checkRecipe('Several Systems, means and all-pairs differences on four-designs', r, Object.assign({ smoke: true }, sevPinned(r)));
  const rc = sevRecipe(FOUR, { diffMode: 'control', ctrlIdx: 2, bench: 2.4, level: 0.9 });
  checkRecipe('Several Systems, versus control with a benchmark, 90%', rc, sevPinned(rc));
}
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
  const text = lang => (lang === 'py' ? ['import numpy as np', LIB.py.report, LIB.py.holm, ...body('py')] : lang === 'R' ? [LIB.R.report, LIB.R.holm, ...body('R')] : [...body('m'), LIB.m.report, LIB.m.holm]).join('\n') + '\n';
  for (const lang of ['R', 'py', 'm']) {
    const title = 'the Holm snippet adjusts as p.adjust does in ' + lang;
    const job = lang === 'm' ? matlabJob(title, false, () => ({ name: 'holm_check.m', text: text('m') })) : null;
    test(title, { skip: skipFor(lang, false) }, async () => {
      const dir = job ? null : mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = dir && join(dir, lang === 'R' ? 'holm.R' : 'holm.py');
        if (dir) writeFileSync(f, text(lang));
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
            : await matlabRun(job);
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
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

// ── Task 6: Several Systems, the analysis of variance and the post-hoc rules ──
import { letterGroups } from '../js/stats/compare.js';
import { dunn } from '../js/stats/nonparam.js';

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
  assert.ok(analysisScript(rd, 'R').includes('posthoc_pairs <- lapply(setdiff(seq_len(k), control), function(i) c(i, control))'));
  assert.ok(analysisScript(r, 'R').includes('posthoc_pairs <- combn(k, 2, simplify = FALSE)'));
  assert.ok(analysisScript(rd, 'py').includes('stats.dunnett(') && analysisScript(rd, 'py').includes('random_state=np.random.default_rng(1)'));
  // LSD on four-designs: the F test does not reject at 5%, and so no pair is declared different.
  const rl = sevRecipe(FOUR, { rule: 'lsd' });
  assert.equal(rl.expect['posthoc lsd protected'], 0);
  assert.ok(Object.keys(rl.expect).filter(k => / different$/.test(k)).every(k => rl.expect[k] === 0));
  // Welch: per-pair degrees of freedom, critical values, and p; no pooled critical value; the
  // F test planned on the ordinary analysis's sigma, and so exactly as under pooled variances.
  const rw = sevRecipe(FOUR, { varMode: 'welch' });
  for (const k of ['welch F', 'welch df2', 'posthoc gameshowell 1-2 df', 'posthoc gameshowell 1-2 crit', 'posthoc gameshowell 2-4 p', 'letters 4']) assert.ok(k in rw.expect, k);
  assert.ok(!('anova F' in rw.expect) && !('posthoc gameshowell critical value' in rw.expect));
  assert.equal(rw.several.anovaPlan.sigmaFrom, 'pooled');
  assert.ok(Number.isFinite(rw.expect['plan anova n']) && Number.isFinite(rw.expect['power at current R']));
  for (const k of ['plan anova n', 'plan anova power at n', 'power at current R']) assert.equal(rw.expect[k], r.expect[k], k);
  for (const lang of LANGS) assert.ok(analysisScript(rw, lang).includes('av_pooled'), lang);
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
  const r = sevRecipe(FOUR, { rule, ctrlIdx: 1 });
  checkRecipe('Several Systems, one-way ANOVA with ' + rule + ' on four-designs', r, Object.assign({ smoke: rule === 'tukey' }, sevPinned(r)));
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
  // At 99% it is 63.657, past 20, where the analyzer's search used to stop.
  const r99 = sevRecipe([reps('U', [2.1, 3.4]), reps('V', [2.9, 3.6])], { paired: true, rule: 'dunnett', ctrlIdx: 0, level: 0.99 });
  assert.ok(Math.abs(r99.expect['posthoc dunnett critical value'] - 63.656741162871185) < 1e-6);
  checkRecipe('Several Systems, blocked Dunnett on 1 residual degree of freedom at 99%', r99, sevChecks);
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
  const text = lang => {
    const body = cases.flatMap((c, s) => (lang === 'R' ? ['cld <- letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ')', 'for (i in seq_along(cld)) report(paste("case ' + s + '", i), cld[i])']
        : lang === 'py' ? ['cld = letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ')', 'for i, v in enumerate(cld): report(f"case ' + s + ' {i + 1}", v)']
          : ['cld = letter_groups(' + c.k + ', ' + lit(lang, c.flagged) + ');', "for i = 1:numel(cld), report(sprintf('case " + s + " %d', i), cld{i}); end"]));
    return (lang === 'py' ? ['import numpy as np', LIB.py.report, LIB.py.letters, ...body] : lang === 'R' ? [LIB.R.report, LIB.R.letters, ...body] : [...body, LIB.m.report, LIB.m.letters]).join('\n') + '\n';
  };
  for (const lang of ['R', 'py', 'm']) {
    const title = 'the letter display matches letterGroups in ' + lang;
    const job = lang === 'm' ? matlabJob(title, false, () => ({ name: 'letters_check.m', text: text('m') })) : null;
    test(title, { skip: skipFor(lang, false) }, async () => {
      const dir = job ? null : mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = dir && join(dir, lang === 'R' ? 'letters.R' : 'letters.py');
        if (dir) writeFileSync(f, text(lang));
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
            : await matlabRun(job);
        assert.equal(run.status, 0, run.stdout + run.stderr);
        noWarning(run.stdout, lang, run.stderr || '');
        const rep = parseReport(run.stdout);
        cases.forEach((c, s) => letterGroups(c.k, c.flagged).forEach((want, i) => assert.equal(rep.get('case ' + s + ' ' + (i + 1)), want, 'case ' + s + ' design ' + (i + 1))));
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

// control is a setting, and the script forms its comparisons from it: a script
// whose control is edited from design 2 to design 3 prints the numbers the page
// gives with design 3 as the control, for Dunnett's rule and for the
// Bonferroni family against the control, and prints those comparisons without
// an analyzer column, the page having made none of them.
{
  const over = { rule: 'dunnett', diffMode: 'control' };
  const r = sevRecipe(FOUR, Object.assign({ ctrlIdx: 1 }, over)), r3 = sevRecipe(FOUR, Object.assign({ ctrlIdx: 2 }, over));
  const from = lang => (lang === 'R' ? 'control <- 2\n' : lang === 'py' ? 'control = 2\n' : 'control = 2;\n');
  const edited = lang => analysisScript(r, lang).replace(from(lang), from(lang).replace('2', '3'));
  for (const lang of ['R', 'py', 'm']) {
    const title = 'editing control alone changes the comparisons to match in ' + lang;
    const job = lang === 'm' ? matlabJob(title, false, () => ({ name: 'control_edit.m', text: edited('m') })) : null;
    test(title, { skip: skipFor(lang, false) }, async () => {
      assert.ok(analysisScript(r, lang).includes(from(lang)), 'the settings carry ' + from(lang).trim());
      const dir = job ? null : mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = dir && join(dir, lang === 'R' ? 'control_edit.R' : 'control_edit.py');
        if (dir) writeFileSync(f, edited(lang));
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) })
            : await matlabRun(job);
        assert.equal(run.status, 0, run.stdout + run.stderr);
        const want = Object.fromEntries(Object.entries(r3.expect).filter(([k]) => /^(posthoc dunnett |diff |C$|per-comparison level$|plan diffs )/.test(k)));
        assert.ok(Object.keys(want).some(k => k.startsWith('posthoc dunnett 2-3 ')) && Object.keys(want).some(k => k.startsWith('diff 4-3 ')));
        compareReport(parseReport(run.stdout), want, lang, r3);
        assert.match(run.stdout, /^posthoc dunnett 1-3 diff: [^(]*$/m, 'a comparison the page did not make prints alone');
        assert.match(run.stdout, /^diff 4-3 se: [^(]*$/m, 'a comparison the page did not make prints alone');
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    });
  }
}

// ── Task 7: Several Systems, the rank tests and the screen for the best ──

test('severalRecipe carries the rank tests, the screen, and the letters', () => {
  const r = sevRecipe(SIX_D, { proc: 'np', adjust: 'holm' });
  for (const k of ['kruskal H', 'kruskal p', 'rank pair 1-2 z', 'rank pair 5-6 adjusted p', 'rank pair 1-6 different', 'rank letters 1', 'rank design 3 pseudo-median',
    'rank design 6 upper', 'screen t', 'rinott h', 'design 1 survives', 'design 1 N', 'design 6 additional', 'best design']) assert.ok(k in r.expect, k);
  assert.deepEqual(r.several.rank, { paired: false, pairs: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]] });
  // R counts the ties exactly itself; kruskal.test, which rounds them to 15 digits, is left as a comment.
  assert.ok(analysisScript(r, 'R').includes('# kw <- kruskal.test(y, g)') && !/^\s*kw <- kruskal\.test/m.test(analysisScript(r, 'R')));
  // The adjustment is a setting, assigned once in the Settings block, and the rank section reads it.
  for (const lang of LANGS) {
    const text = analysisScript(r, lang), settings = settingsOf(text, lang);
    assert.ok(/\nrank_adjust (<-|=) ["']holm["']/.test(settings), lang + ': rank_adjust is a setting');
    assert.ok(!/\nrank_adjust (<-|=) /.test(text.slice(settings.length)), lang + ': rank_adjust is assigned once');
    assert.ok(text.includes('kruskal_dunn(groups, alpha, rank_adjust, rank_pairs)'), lang + ': the rank section reads rank_adjust');
    assert.ok(!/(kruskal_dunn|friedman_pairs)\(groups, alpha, ["']/.test(text), lang + ': no adjustment written into the call');
    const flat = text.replace(/\n[#%] /g, ' ');
    assert.ok(flat.includes('adjusted by the rule in rank_adjust (holm or bonferroni)') && flat.includes('rank_adjust is the rule that adjusts'), lang + ': the comments name the setting');
  }
  assert.ok(analysisScript(sevRecipe(FOUR_CRN, { paired: true, proc: 'np' }), 'py').includes('friedman_pairs(groups, alpha, rank_adjust, rank_pairs)'));
  assert.equal(sevRecipe(SIX_D, { proc: 'np' }).settings.rank_adjust, 'bonferroni');
  assert.ok(!('rank_adjust' in sevRecipe(FOUR).settings), 'no rank adjustment under the t procedures');
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

{
  const r = sevRecipe(SIX_D, { proc: 'np', adjust: 'holm', eps: 0.3 });
  checkRecipe('Several Systems, Kruskal-Wallis and Dunn (Holm) on six-designs', r, Object.assign({ smoke: true }, sevPinned(r)));
  const rf = sevRecipe(FOUR_CRN, { paired: true, proc: 'np', dir: 'min' });
  checkRecipe('Several Systems, Friedman and its pairs on four-crn', rf, sevPinned(rf));
}

// The analyzer-column check catches a lookup that fails. With the page's labels
// of the rank-shift family reversed ("2-1" for "1-2"), the script finds none of
// its pairs among them, prints every shift line without the analyzer's value,
// and assertAnalyzerColumns names those lines.
{
  const r = sevRecipe(SIX_D, { proc: 'np', adjust: 'holm', eps: 0.3 });
  const reverse = text => text.split('\n')
    .map(l => (/^page_family_pairs (<-|=) /.test(l) ? l.replace(/(["'])(\d+)-(\d+)\1/g, '$1$3-$2$1') : l)).join('\n');
  for (const lang of ['R', 'py']) {
    test('the analyzer-column check catches a failed rank-shift lookup in ' + lang, { skip: skipFor(lang, true) }, () => {
      const text = analysisScript(r, lang), mutated = reverse(text);
      assert.notEqual(mutated, text, 'the labels are reversed');
      const { stdout } = runScript(r, lang, { text: mutated });
      const { bare } = analyzerColumnCounts(stdout, r.expect);
      assert.ok(bare.includes('shift 1-2') && bare.includes('shift 5-6 adjusted p'), 'the shift lines are bare: ' + bare.join('; '));
      assert.ok(bare.every(k => /^shift \d+-\d+/.test(k)), 'only the shift lines are bare: ' + bare.join('; '));
      assert.throws(() => assertAnalyzerColumns(stdout, r, lang), /no analyzer column: shift 1-2/);
    });
  }
}

// rank_adjust is a setting: a Kruskal-Wallis script written under Holm and
// edited to "bonferroni" prints Dunn's Bonferroni-adjusted p-values, the pairs
// they declare different, and the letters those pairs give.
{
  const r = sevRecipe(SIX_D, { proc: 'np', adjust: 'holm' });
  const groups = SIX_D.map(d => Float64Array.from(outcomeVector(d).values));
  const dn = dunn(groups, { alpha: 0.05, adjust: 'bonferroni' });
  const from = lang => (lang === 'R' ? 'rank_adjust <- "holm"\n' : lang === 'py' ? 'rank_adjust = "holm"\n' : "rank_adjust = 'holm';\n");
  const edited = lang => analysisScript(r, lang).replace(from(lang), from(lang).replace('holm', 'bonferroni'));
  for (const lang of ['R', 'py', 'm']) {
    const title = 'editing rank_adjust to bonferroni changes the adjusted p-values and the letters in ' + lang;
    const job = lang === 'm' ? matlabJob(title, true, () => ({ name: 'rank_adjust_edit.m', text: edited('m') })) : null;
    test(title, { skip: skipFor(lang, true) }, async () => {
      assert.ok(dn.pairs.some(p => Math.abs(p.pAdj - r.expect['rank pair ' + (p.i + 1) + '-' + (p.j + 1) + ' adjusted p']) > 1e-6), 'Holm and Bonferroni differ on these data');
      assert.ok(analysisScript(r, lang).includes(from(lang)), 'the settings carry ' + from(lang).trim());
      const dir = job ? null : mkdtempSync(join(tmpdir(), 'oa-regen-'));
      try {
        const f = dir && join(dir, lang === 'R' ? 'rank_adjust.R' : 'rank_adjust.py');
        if (dir) writeFileSync(f, edited(lang));
        const run = lang === 'R' ? spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000 })
          : lang === 'py' ? spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) })
            : await matlabRun(job);
        assert.equal(run.status, 0, run.stdout + run.stderr);
        noWarning(run.stdout, lang, run.stderr || '');
        const want = {};
        for (const p of dn.pairs) {
          const key = 'rank pair ' + (p.i + 1) + '-' + (p.j + 1);
          want[key + ' adjusted p'] = p.pAdj;
          want[key + ' different'] = p.flagged ? 1 : 0;
        }
        dn.letters.forEach((l, i) => { want['rank letters ' + (i + 1)] = l; });
        compareReport(parseReport(run.stdout), want, lang, r);
      } finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    });
  }
}
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
// Rinott's h near 10.75 at P* = 0.975 for four designs. Two each: nu = 1,
// and h near 47.02 for three designs, past the old search, which stopped at
// 12 and left h and every N missing; the scripts' integrals must resolve the
// inner probability's rise near s = 1/h there without a warning.
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
  assert.ok(Math.abs(r2.expect['rinott h'] - 47.018598657983844) < 1e-4, String(r2.expect['rinott h']));
  const sized = Object.keys(r2.expect).filter(k => /^design \d+ N$/.test(k));
  assert.ok(sized.length > 0 && sized.every(k => r2.expect[k] > 2), 'every survivor needs more than its two replications');
  checkRecipe('Several Systems, the screen on two replications per design', r2, sevChecks);
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

// Two outcomes per design under the t procedures. Each design's two distances
// from its median are equal up to rounding, and so Levene's test has no spread
// within any design: F is infinite and p is 0 in every language, where the
// built-in tests report rounding noise (R's anova() also warns of an
// essentially perfect fit). The pooled analysis has 3 residual degrees of
// freedom, where R's qtukey is held to its looser tolerance (see tolFor).
{
  const two = [[2.1, 3.4], [3.9, 4.4], [2.5, 2.2]].map((v, i) => reps('T' + (i + 1), v));
  const r = sevRecipe(two, { eps: 0.4 });
  assert.equal(r.expect['levene F'], Infinity); assert.equal(r.expect['levene p'], 0);
  checkRecipe('Several Systems, two replications per design under the t procedures', r, sevChecks);
}

// Quantiles past the old search, which stopped at 20 (and at 12 for Rinott's
// h), on few residual degrees of freedom; Dunnett's on 1 is with the blocked
// fixtures above.
{
  // Three designs in two blocks: Tukey on 2 residual degrees of freedom at 99%, where R's qtukey is
  // about 2e-4 off, and Rinott's h near 236 on a first stage of two replications. Each design's two
  // outcomes lie at distances from their median that are exact in binary, and so Levene's within
  // sum of squares is exactly 0 (F infinite) rather than rounding noise.
  const blk3 = [[2, 3.5], [4, 4.5], [2.5, 2.25]].map((v, i) => reps('B' + (i + 1), v));
  const rt = sevRecipe(blk3, { paired: true, level: 0.99, eps: 0.4 });
  assert.equal(rt.expect['anova df2'], 2);
  assert.equal(rt.expect['levene F'], Infinity);
  assert.ok(Math.abs(rt.expect['posthoc tukey critical value'] - 19.018935987312428) < 1e-6);
  assert.ok(rt.expect['rinott h'] > 200);
  checkRecipe('Several Systems, Tukey on 2 degrees of freedom at 99%, in blocks', rt,
    Object.assign({ notInR: /^posthoc tukey .*(critical value|hw|lower|upper)$/ }, sevChecks));
  // Games-Howell at 99% on four designs of three outcomes with very different spreads: each pair's
  // Welch degrees of freedom lie between 2 and 3.4, and the critical values reach 22.
  const gh = [[2.1, 3.4, 2.8], [3.9, 4.0, 3.95], [2.5, 2.2, 3.0], [5.1, 3.6, 7.8]].map((v, i) => reps('G' + (i + 1), v));
  const rg = sevRecipe(gh, { varMode: 'welch', level: 0.99, eps: 0.4 });
  assert.ok(rg.expect['posthoc gameshowell 2-4 crit'] > 22 && rg.expect['posthoc gameshowell 2-4 df'] < 2.01);
  checkRecipe('Several Systems, Games-Howell at 99% on 2 to 3.4 degrees of freedom', rg,
    Object.assign({ notInR: /^posthoc gameshowell .*(crit|hw|lower|upper| p)$/ }, sevChecks));
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

// Too many numbers: the recipe is full but holds no records, and its scripts
// read the run's CSV files (the CSV mode section below runs them).
test('a run past 200,000 numbers gives a full recipe that holds no records', () => {
  const big = makeDataset({ name: 'big', response: 'q', kind: 'time', reps: [{ id: 1, t: Array.from({ length: 120000 }, (_, i) => i), v: Array.from({ length: 120000 }, (_, i) => i % 7) }] });
  assert.equal(MAX_NUMBERS, 200000);
  assert.ok(recordCount(big) > MAX_NUMBERS);
  assert.ok(recordCount(LONG) <= MAX_NUMBERS && recordCount(QLEN) <= MAX_NUMBERS);
  const r = stRecipe(big, { align: 'time' });
  assert.equal(r.csvOnly, true);
  assert.ok(!('tooBig' in r));
  assert.deepEqual(r.records, { name: 'big', response: 'q', unit: big.unit, kind: 'time', endTime: big.endTime, timed: true, ids: ['1'] });
  assert.ok('batches' in r.expect && 'acf lag 1' in r.expect && 'warm-up ybar at 1' in r.expect);
  assert.equal(r.settings.kind, 'time');
  assert.ok(Number.isNaN(r.settings.end_time), 'no end time is NaN in Settings');
  assert.ok(!stRecipe(LONG).csvOnly);
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
      const head = '\n' + sectionLine(lang, 'Data');
      const data = s.slice(s.indexOf(head), s.indexOf('\n## ', s.indexOf(head) + 5));
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
import { exploreRecipe, exploreTooBig, repKeys, REP_LINES_MAX } from '../js/io/recipes.js';

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
  // Tidy R summarises each replication's records for tally and time-persistent
  // data only: one value per replication has no count or times to show.
  const summary = 'print(records_tbl |> summarise(records = n()';
  for (const ds of [TRANSIENT, QLEN]) assert.ok(analysisScript(exRecipe(ds), 'tidy').includes(summary), ds.kind + ': the records summary');
  const repsTidy = analysisScript(exRecipe(IND_A), 'tidy');
  assert.ok(repsTidy.includes('records_tbl <- bind_rows(') && !repsTidy.includes(summary) && !repsTidy.includes('dplyr counts each replication'), 'reps: no records summary');
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

// Too many numbers: a full recipe with no records, whose scripts read the CSV files.
test('a Summary and Plots dataset past 200,000 numbers gives a full recipe that holds no records', () => {
  const big = makeDataset({ name: 'big', response: 'q', kind: 'tally', reps: [{ id: 1, v: Array.from({ length: 200001 }, (_, i) => i % 7) }] });
  assert.ok(exploreTooBig({ ds: big, spread: null }));
  assert.ok(!exploreTooBig({ ds: TRANSIENT, spread: exSpread(TRANSIENT, IND_A) }));
  // The spread groups count toward the cap too.
  const near = makeDataset({ name: 'near', response: 'q', kind: 'tally', reps: [{ id: 1, v: Array.from({ length: MAX_NUMBERS - 10 }, (_, i) => i % 7) }] });
  assert.ok(!exploreTooBig({ ds: near, spread: null }) && exploreTooBig({ ds: near, spread: exSpread(IND_A, IND_B) }));
  const r = exRecipe(big);
  assert.equal(r.csvOnly, true);
  assert.ok(!r.records.reps && r.records.ids.length === 1 && r.records.timed === false);
  assert.ok('n' in r.expect && 'pooled median' in r.expect && 'rep 1 outcome' in r.expect);
  assert.deepEqual(r.settings, { kind: 'tally', end_time: NaN });
});

// ── Task 11: the Tidy R dialect ────────────────────────────────────────

test('the Tidy R script reads its data as a tibble, summarises with dplyr, tidies its tests, and plots with ggplot2', () => {
  const r = oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, plan: PLAN });
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
    ['one, t', oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, plan: PLAN }),
      ['d_tbl <- tibble(rep_id = rep_id, outcome = x)', 'd <- d_tbl |> describe_tbl(outcome)', 'if (!is.null(ti$test)) print(broom::tidy(ti$test))']],
    ['one, signed-rank', oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 'np', level: 0.95, plan: PLAN }),
      ['print(broom::tidy(sr$test))']],
    ['one, pooled', oneRecipe({ ds: TRANSIENT, x: pooledX, ids: null, pooled: true, proc: 't', level: 0.95, plan: null }),
      ['d_tbl <- tibble(observation = x)', 'd <- d_tbl |> describe_tbl(observation)']],
    ['two, Welch', twoOf(IND_A, IND_B, 't', 0.95, PLAN2),
      ['d_tbl <- bind_rows(tibble(design = "A", outcome = a), tibble(design = "B", outcome = b))', 'da <- d_tbl |> filter(design == "A") |> describe_tbl(outcome)',
        'print(broom::tidy(w$test))', 'print(suppressMessages(broom::tidy(fr$test)))']],
    ['two, rank-sum', twoOf(IND_A, IND_B, 'np', 0.95, PLAN2), ['print(broom::tidy(rs$test))']],
    ['two, paired t', pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2), ['pairs_tbl <- tibble(pair_id = pair_id, a = a, b = b)', 'print(broom::tidy(pr$test))']],
    ['two, paired signed-rank', pairedRecipe(CRN_A, CRN_B, 'np', 'position', PLAN2), ['print(broom::tidy(sr$test))']],
    ['several, Tukey', sevRecipe(FOUR),
      ['d_tbl <- tibble(design = factor(rep(seq_len(k), lengths(groups))), name = rep(design_names, lengths(groups)), outcome = unlist(groups))',
        'means_tbl <- bind_cols(distinct(d_tbl, design, name), bind_rows(sm$items))', 'fig_tbl <- means_tbl |> transmute(', 'print(broom::tidy(av$fit))', 'broom::tidy(TukeyHSD(av$fit, "design"', 'print(bind_rows(ph$pairs))',
        'family_tests[[lab]] <- cmp$test', 'family_tbl <- bind_rows(lapply(family_tests, broom::tidy), .id = "pair")', 'p <- ggplot(fig_tbl, aes(y = design))']],
    ['several, Welch', sevRecipe(FOUR, { varMode: 'welch' }), ['print(suppressMessages(broom::tidy(av$test)))', 'print(bind_rows(ph$pairs))',
      'oneway.test(outcome ~ design, var.equal = FALSE)', 'anova(lm(distance ~ group))']],
    ['several, Kruskal-Wallis with a benchmark', sevRecipe(SIX_D, { proc: 'np', bench: 2 }),
      ['bind_cols(distinct(d_tbl, design, name), bind_rows(lapply(srs, function(s) broom::tidy(s$test))))', 'fig_tbl <- tibble(design = seq_len(k), mid = sapply(srs, ',
        'print(bind_rows(rk$pairs))', 'geom_vline(xintercept = benchmark']],
    ['several, Friedman', sevRecipe(FOUR_CRN, { paired: true, proc: 'np' }),
      ['block = rep(block_id, times = k)', 'print(broom::tidy(rk$test))', 'print(tibble(design = seq_len(k), survives = ss$survivors']],
    ['steady', stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }),
      ['records_tbl <- bind_rows(lapply(reps, function(r) tibble(', 'print(broom::tidy(bm$test))', 'ggplot(batch_tbl, aes(batch, mean))']],
    ['explore', exRecipe(TRANSIENT),
      ['records_tbl <- bind_rows(', 'out_tbl <- tibble(rep_id = ', 'd <- out_tbl |> filter(is.finite(outcome)) |> describe_tbl(outcome)', 'po <- records_tbl |> describe_tbl(v)',
        'print(broom::tidy(ti$test))', 'sw <- shapiro_check(', 'print(broom::tidy(sw))', 'plot_outcomes(filter(out_tbl, is.finite(outcome)), outcome, ']],
    ['explore, Levene', exRecipe(IND_A, exSpread(IND_A, IND_B)), ['print(broom::tidy(lv$test))', 'anova(lm(distance ~ group))']]
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

// ── Layout and wording ─────────────────────────────────────────────────

// A figure is the last thing a script does, so that every report line prints
// before a figure opens on screen; Python imports only the SciPy submodules
// its code calls; the comments read as English; and the Summary and Plots
// figure uses the page's bins and plotting positions.
test('scripts end with their figure, import what they use, and say what the page draws', () => {
  const sect = { R: /\n## (.*) ----\n/g, tidy: /\n## (.*) ----\n/g, py: /\n# ---- (.*) ----\n/g, m: /\n%% (.*)\n/g };
  const withFigure = [sevRecipe(FOUR, { bench: 2.4 }), sevRecipe(SIX_D, { proc: 'np' }), stRecipe(TRANSIENT, { lumped: true, cut: 50, count: 10 }),
    stRecipe(QLEN, { align: 'time', cut: 100, count: 60 }), exRecipe(TRANSIENT), exRecipe(IND_A, exSpread(IND_A, IND_B))];
  for (const r of withFigure) {
    for (const lang of LANGS) {
      const s = analysisScript(r, lang);
      const heads = [...s.matchAll(sect[lang])].map(m => m[1]).filter(h => h !== 'Local functions');
      assert.ok(/^Figure/.test(heads[heads.length - 1]), r.page + ' ' + lang + ': the figure is last, not ' + heads[heads.length - 1]);
      const tail = lang === 'm' ? s.slice(0, s.indexOf('\n%% Local functions')) : s;
      assert.ok(!/\breport\(/.test(tail.slice(tail.lastIndexOf('Figure'))), r.page + ' ' + lang + ': no report line after the figure');
      assert.ok(!/cut at at|before at\b|at time at\b|over steps equal/.test(s), r.page + ' ' + lang + ': comments read as English');
    }
  }
  const imports = r => analysisScript(r, 'py').split('\n').find(l => l.startsWith('from scipy import'));
  assert.equal(imports(oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, plan: null })), 'from scipy import stats');
  assert.equal(imports(sevRecipe(FOUR, { rule: 'dunnett', ctrlIdx: 1 })), 'from scipy import integrate, optimize, stats');
  // A replication-value dataset's records are one value per replication, not tally observations.
  const reps = analysisScript(exRecipe(IND_A), 'R').replace(/\n# /g, ' ');
  assert.ok(reps.includes('one value v per replication') && !reps.includes('tally observations v'));
  // The page's histogram bins and quantile-quantile positions, in Python and MATLAB too.
  const py = analysisScript(exRecipe(TRANSIENT), 'py'), m = analysisScript(exRecipe(TRANSIENT), 'm'), R = analysisScript(exRecipe(TRANSIENT), 'R');
  assert.ok(py.includes('np.linspace(x.min(), x.max(), nb + 1)') && py.includes('off = 3 / 8 if n_x <= 10 else 0.5') && !py.includes('probplot'));
  assert.ok(m.includes('linspace(min(x), max(x), nb + 1)') && m.includes('histogram(x, edges)') && !m.includes('qqplot('));
  assert.ok(R.includes('hist(x, breaks = breaks, right = FALSE, include.lowest = TRUE'));
  // Python's Requires line names Matplotlib only where the script draws a figure.
  const pyNeeds = r => analysisScript(r, 'py').split('\n\n')[0].replace(/\n# +/g, ' ');
  for (const r of withFigure) assert.ok(pyNeeds(r).includes('SciPy 1.11 or later (Matplotlib, if installed, draws the figure).'), r.page + ': Matplotlib named');
  for (const r of [oneRecipe({ ds: QUEUE, x: queueX(), ids: queueIds(), pooled: false, proc: 't', level: 0.95, plan: PLAN }), twoOf(IND_A, IND_B, 't', 0.95, PLAN2), exRecipe(LONG)]) {
    assert.ok(pyNeeds(r).includes('SciPy 1.11 or later.') && !/matplotlib/i.test(pyNeeds(r)), r.page + ': no figure, and so no Matplotlib');
  }
  // MATLAB's Shapiro-Wilk helper picks swtest's calling form by its argument list, so that
  // a real error in swtest is never taken for the wrong calling form.
  assert.ok(LIB.m.shapiro.includes("if nargin('swtest') < 0") && !/\bcatch\b/.test(LIB.m.shapiro));
});

// ── The CSV files that hold the same data ──────────────────────────────
// Every script shows, beside its data block, the lines that read the same
// data from the files the Import page saves. The proof writes those files
// with the page's own writers, uncomments the lines, deletes the embedded
// data, runs the script, and compares every report line with expect.
import { csvReadBlock } from '../js/io/analysis_scripts.js';
import { csvFileName } from '../js/io/recipes.js';
import { slug, observationsCsv, repSummaryCsv } from '../js/io/export.js';
import { dsProvenance } from '../js/ui/exportrow.js';
import { observations } from '../js/data/model.js';

const SECT = Object.fromEntries(LANGS.map(lang => [lang, sectionLine(lang, 'Data')]));
const MARK = { R: '#   ', tidy: '#   ', py: '#   ', m: '%   ' };

// A dataset's file as the Import page writes it (Export on its row): the
// Observations CSV in its full form, or the Replication summary CSV.
function importPageFile(ds, form) {
  return form === 'observations' ? observationsCsv(ds, dsProvenance(ds), { full: true }) : repSummaryCsv(ds, dsProvenance(ds));
}

/**
 * A script with its read lines enabled: the embedded data, everything from
 * the Data heading to the read block, deleted, and the read block's marked
 * lines uncommented. Returns the script and the uncommented lines.
 */
export function csvModeScript(script, lang) {
  const c = lang === 'm' ? '%' : '#';
  const lines = script.split('\n');
  const d = lines.indexOf(SECT[lang]);
  const s = lines.findIndex(l => l.startsWith(c + ' To read the same data from '));
  assert.ok(d >= 0 && s > d + 1, lang + ': a read block after the embedded data');
  let e = s;
  while (e < lines.length && lines[e].startsWith(c)) e++;
  const block = lines.slice(s, e).map(l => (l.startsWith(MARK[lang]) ? l.slice(MARK[lang].length) : l));
  const code = lines.slice(s, e).filter(l => l.startsWith(MARK[lang])).map(l => l.slice(MARK[lang].length));
  assert.ok(code.length > 1, lang + ': marked read lines');
  return { text: [...lines.slice(0, d + 1), ...block, ...lines.slice(e)].join('\n'), code };
}

/**
 * Runs a recipe's scripts with the read lines enabled against the files the
 * Import page writes for `datasets`, in every installed language, and
 * compares every report line with expect, with no warning printed.
 */
function checkCsvRead(name, recipe, datasets, { smoke = false } = {}) {
  const csvFiles = () => {
    const files = {};
    for (const f of recipe.csv) {
      const ds = datasets.find(x => x.name === f.dataset);
      assert.ok(ds, 'a dataset for ' + f.file);
      assert.equal(f.file, slug(ds.name) + (f.form === 'observations' ? '_observations.csv' : '_replications.csv'), 'the Import page\'s file name');
      files[f.file] = importPageFile(ds, f.form);
    }
    return files;
  };
  for (const lang of LANGS) {
    const title = `${name} regenerates from its CSV files in ${lang}`;
    const job = lang === 'm' ? matlabJob(title, smoke, () => ({ name: scriptFileName(recipe, 'm'), text: csvModeScript(analysisScript(recipe, 'm'), 'm').text, files: csvFiles() })) : null;
    test(title, { skip: skipFor(lang, smoke) }, async () => {
      const files = csvFiles();
      const { text, code } = csvModeScript(analysisScript(recipe, lang), lang);
      // What the comment shows is exactly what a script that reads the files runs.
      const c = lang === 'm' ? '%' : '#';
      assert.deepEqual(code, csvReadBlock(lang, recipe, { live: true }).filter(l => !l.startsWith(c)));
      // No embedded data remain.
      assert.ok(!/^(x|a|b) (<-|=) (c|np\.array|\[)|^reps\[\[1\]\] <- list\(id|^    dict\(id=|^reps\(1\) = struct|^groups\[\[1\]\] <- c|^groups = (\[|\{)\[|^pair_id (<-|=) /m.test(text.slice(0, text.indexOf(c + ' To read'))),
        lang + ': the embedded data are gone');
      const { report, stdout, stderr } = await runIn(job, recipe, lang, { text, files });
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang, recipe);
      noWarning(stdout, lang, stderr);
    });
  }
}

// Review Focus 1 and 2: a name with a comma, quotes, a non-ASCII dash, and a
// backslash, with ids that only text keeps (007, 1.0) and a replication with
// no observations, and so no outcome.
const QUEUE_COMMA = makeDataset({ name: 'Queue, "A" – 1\\2', response: 'busy servers', unit: 'min', kind: 'tally',
  reps: [{ id: '007', v: [1, 2, 4] }, { id: 'b', v: [] }, { id: 3, v: [4, 5] }, { id: 4, v: [2, 3, 3, 6] }, { id: '1.0', v: [5] }, { id: 6, v: [3.5, 2.5] }] });

test('recipes name the files the Import page saves, built by the same slug', () => {
  assert.equal(slug(QUEUE_COMMA.name), 'queue-a-1-2');
  const o = outcomeVector(QUEUE_COMMA);
  const r1 = oneRecipe({ ds: QUEUE_COMMA, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, plan: null });
  assert.deepEqual(r1.csv, [{ dataset: QUEUE_COMMA.name, file: 'queue-a-1-2_replications.csv', form: 'replications', role: 'x' }]);
  const rp = oneRecipe({ ds: QUEUE_COMMA, x: Array.from(QUEUE_COMMA.reps.flatMap(r => Array.from(r.v))), ids: null, pooled: true, proc: 't', level: 0.95, plan: null });
  assert.deepEqual(rp.csv.map(f => [f.file, f.form]), [['queue-a-1-2_observations.csv', 'observations']]);
  assert.deepEqual(twoOf(IND_A, IND_B, 't', 0.95, null).csv.map(f => f.role), ['a', 'b']);
  assert.deepEqual(pairedRecipe(CRN_A, CRN_B, 't', 'id', null).csv.map(f => f.file), [CRN_A, CRN_B].map(d => csvFileName(d, 'replications')));
  assert.deepEqual(sevRecipe(FOUR).csv.map(f => f.role), ['group 1', 'group 2', 'group 3', 'group 4']);
  for (const r of [stRecipe(LONG), exRecipe(TRANSIENT, exSpread(TRANSIENT, IND_A))]) {
    const ds = r.page === 'steady' ? LONG : TRANSIENT;
    assert.deepEqual(r.csv, [{ dataset: ds.name, file: csvFileName(ds, 'observations'), form: 'observations', role: 'records' },
      { dataset: ds.name, file: csvFileName(ds, 'replications'), form: 'replications', role: 'replication list' }], 'Levene\'s groups get no entry');
  }
  // Every script names its file in each language, and the read lines are all comments.
  for (const lang of LANGS) {
    const s = analysisScript(r1, lang);
    assert.ok(s.includes('queue-a-1-2_replications.csv') && /^[\x00-\x7f]*$/.test(s), lang);
    const block = csvReadBlock(lang, r1);
    assert.ok(block.every(l => l.startsWith(lang === 'm' ? '%' : '#')), lang + ': every line a comment');
    assert.ok(block.join(' ').includes('Queue, "A" - 1\\2'), lang + ': the dataset named in ASCII');
  }
});

test('two datasets whose names slug alike are told apart by name in the comment', () => {
  const twin = makeDataset({ name: 'Queue A 1 2', response: 'w', kind: 'reps', reps: [1, 2, 3].map(id => ({ id, v: [id + 0.5] })) });
  assert.equal(slug(twin.name), slug(QUEUE_COMMA.name));
  const r = twoOf(QUEUE_COMMA, twin, 't', 0.95, null);
  for (const lang of LANGS) {
    const s = analysisScript(r, lang).replace(/\n[#%] /g, ' ');
    assert.ok(s.includes('Queue, "A" - 1\\2 and Queue A 1 2 both save to queue-a-1-2_replications.csv; save one under another name and change it here.'), lang);
  }
  // Two designs from one dataset name no clash.
  assert.ok(!analysisScript(twoOf(IND_A, IND_A, 't', 0.95, null), 'R').includes('both save to'));
});

// One fixture per page and per procedure family.
{
  const o = outcomeVector(QUEUE_COMMA);
  checkCsvRead('One System, t, on a comma-named dataset with an empty replication',
    oneRecipe({ ds: QUEUE_COMMA, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, plan: PLAN }), [QUEUE_COMMA], { smoke: true });
  const obs = observations(QUEUE_COMMA);
  checkCsvRead('One System, pooled observations',
    oneRecipe({ ds: QUEUE_COMMA, x: obs, ids: null, pooled: true, proc: 't', level: 0.95, plan: null }), [QUEUE_COMMA]);
  checkCsvRead('Two Systems, independent Welch', twoOf(QUEUE_COMMA, IND_B, 't', 0.95, PLAN2), [QUEUE_COMMA, IND_B]);
  const gA = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 3.5] }, { id: 5, v: [9] }] });
  const gB = makeDataset({ name: 'B', response: 'w', kind: 'reps', reps: [[3, 2.6], [1, 1.2], [2, 2.2], [4, 2.7], [5, 2.4], [7, 1.0]].map(([id, v]) => ({ id, v: [v] })) });
  const rid = pairedRecipe(gA, gB, 't', 'id', PLAN2);
  assert.equal(rid.expect.pairs, 4, 'a duplicate id of A and an id of B with no partner are left out');
  checkCsvRead('Two Systems, paired t by id with an empty, a duplicated, and unmatched replications', rid, [gA, gB]);
  checkCsvRead('Two Systems, paired signed-rank by position', pairedRecipe(gA, gB, 'np', 'position', PLAN2, 0.9), [gA, gB]);
  const A = makeDataset({ name: 'A', response: 'w', kind: 'tally', reps: [{ id: 1, v: [1, 2] }, { id: 2, v: [] }, { id: 3, v: [2, 4] }, { id: 4, v: [3] }, { id: 5, v: [2.5, 3.5] }] });
  const B = makeDataset({ name: 'B', response: 'w', kind: 'reps', reps: [[1, 1.2], [2, 2.2], [3, 2.6], [4, 2.7], [5, 2.4], [6, 3.0]].map(([id, v]) => ({ id, v: [v] })) });
  const Cd = makeDataset({ name: 'C', response: 'w', kind: 'reps', reps: [[6, 1.1], [1, 0.9], [3, 1.7], [4, 2.1], [5, 1.5]].map(([id, v]) => ({ id, v: [v] })) });
  checkCsvRead('Several Systems, independent, with an empty replication', sevRecipe([A, B, QUEUE_COMMA]), [A, B, QUEUE_COMMA]);
  const sp = sevRecipe([A, B, Cd], { paired: true });
  assert.equal(sp.groups.ids.join(','), '1,3,4,5');
  checkCsvRead('Several Systems, paired by id, with an empty and unmatched replications', sp, [A, B, Cd]);
  checkCsvRead('Several Systems, paired by position under the rank procedures', sevRecipe([A, B, Cd], { paired: true, by: 'position', proc: 'np' }), [A, B, Cd]);
  // The records: tally and time-persistent runs, each with an empty replication.
  const gappyT = makeDataset({ name: 'Transient, one empty', response: 'wait time', kind: 'tally',
    reps: TRANSIENT.reps.map((r, i) => (i === 1 ? { id: r.id, t: [], v: [] } : { id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  checkCsvRead('Steady State, tally with an empty replication, lumped', stRecipe(gappyT, { lumped: true, cut: 25, count: 15 }), [gappyT]);
  const gappyQ = makeDataset({ name: 'Queue length, one empty', response: 'number in queue', kind: 'time', endTime: 600,
    reps: QLEN.reps.map((r, i) => (i === 2 ? { id: r.id, t: [], v: [] } : { id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  checkCsvRead('Steady State, time-persistent with an empty replication, by time', stRecipe(gappyQ, { align: 'time', nBins: 20, lumped: true, cut: 100, count: 12 }), [gappyQ]);
  const odd = makeDataset({ name: 'Odd tally', response: 'wait', unit: 'min', kind: 'tally',
    reps: [{ id: 'a', v: [1, 2, 3, 5] }, { id: 'b', v: [] }, { id: 'c', v: [4] }, { id: 'd', v: [4, 6, 7] }] });
  checkCsvRead('Summary and Plots, tally with an empty and a one-observation replication', exRecipe(odd), [odd], { smoke: true });
  checkCsvRead('Summary and Plots, replication values with the spread test', exRecipe(IND_A, exSpread(IND_A, IND_B)), [IND_A]);
  const lens = [300, 0, 760, 410, 848];
  const unequal = makeDataset({ name: 'Queue length, unequal', response: 'q', kind: 'time',
    reps: QLEN.reps.map((rp, i) => ({ id: rp.id, t: Array.from(rp.t).slice(0, lens[i]), v: Array.from(rp.v).slice(0, lens[i]) })) });
  checkCsvRead('Summary and Plots, time-persistent runs with no end time and an empty one', exRecipe(unequal), [unequal]);
}

// Replication ids that only text keeps: a mostly numeric id column with one
// text id, and ids such as 007, 01, and 1.0, which a reader that types the
// column as numbers would turn into 7, 1, and 1 (or a text id into NaN). Every
// language reads them as text, and so the Summary and Plots report names
// (rep <id> ...) and the matching by id follow the page.
{
  checkCsvRead('Summary and Plots on the comma-named dataset (ids 007, b, 1.0)', exRecipe(QUEUE_COMMA), [QUEUE_COMMA]);
  checkCsvRead('Steady State on the comma-named dataset, lumped', stRecipe(QUEUE_COMMA, { lumped: true, count: 3 }), [QUEUE_COMMA]);
  const zeros = makeDataset({ name: 'Zero-padded ids', response: 'w', kind: 'reps',
    reps: [['007', 2.1], ['01', 2.6], ['12', 1.9], ['1.0', 2.4], ['7', 3.0]].map(([id, v]) => ({ id, v: [v] })) });
  const rz = exRecipe(zeros);
  assert.ok('rep 007 n' in rz.expect && 'rep 7 n' in rz.expect && 'rep 1.0 outcome' in rz.expect);
  checkCsvRead('Summary and Plots with ids 007, 01, 12, 1.0, and 7', rz, [zeros]);
  const mA = makeDataset({ name: 'Mixed A', response: 'w', kind: 'reps', reps: [[1, 2.0], [2, 2.4], [3, 1.9], ['x', 3.1], [4, 2.2]].map(([id, v]) => ({ id, v: [v] })) });
  const mB = makeDataset({ name: 'Mixed B', response: 'w', kind: 'reps', reps: [[2, 2.5], [1, 1.8], ['x', 2.6], [4, 2.0], [3, 1.5], [5, 2.2]].map(([id, v]) => ({ id, v: [v] })) });
  const rm = pairedRecipe(mA, mB, 't', 'id', null);
  assert.equal(rm.expect.pairs, 5);
  checkCsvRead('Two Systems, paired by id on mostly numeric ids with one text id', rm, [mA, mB]);
  const mC = makeDataset({ name: 'Mixed C', response: 'w', kind: 'reps', reps: [['x', 2.9], [4, 1.7], [1, 1.1], [3, 2.3], [2, 2.0]].map(([id, v]) => ({ id, v: [v] })) });
  const rs = sevRecipe([mA, mB, mC], { paired: true });
  assert.equal(rs.groups.ids.length, 5);
  checkCsvRead('Several Systems, paired by id on mostly numeric ids with one text id', rs, [mA, mB, mC]);
}

// A '#' inside a replication id or a response name. R's read.csv(comment.char
// = "#") ends a line at an unquoted '#', which would cut the row short and drop
// it, and so the data files quote such a field; every language reads it whole.
{
  const hashT = makeDataset({ name: 'Runs #2', response: 'wait #', kind: 'tally',
    reps: [{ id: 'run#1', v: [1, 2, 4] }, { id: 'run#2', v: [] }, { id: '#3', v: [4, 5] }, { id: 'run#4', v: [2, 3, 3, 6] }] });
  const rh = exRecipe(hashT);
  assert.ok('rep run#1 n' in rh.expect && 'rep #3 outcome' in rh.expect);
  checkCsvRead('Summary and Plots with ids run#1 and #3 and a response holding #', rh, [hashT]);
  const hA = makeDataset({ name: 'Hash A', response: 'w', kind: 'reps', reps: [['run#1', 2.0], ['run#2', 2.4], ['run#3', 1.9], ['run#4', 3.1], ['run#5', 2.2]].map(([id, v]) => ({ id, v: [v] })) });
  const hB = makeDataset({ name: 'Hash B', response: 'w', kind: 'reps', reps: [['run#2', 2.5], ['run#1', 1.8], ['run#4', 2.6], ['run#5', 2.0], ['run#3', 1.5]].map(([id, v]) => ({ id, v: [v] })) });
  const rp = pairedRecipe(hA, hB, 't', 'id', null);
  assert.equal(rp.expect.pairs, 5);
  checkCsvRead('Two Systems, paired by id on ids run#1 to run#5', rp, [hA, hB]);
}

// ── CSV mode: scripts that read their data from the CSV files ──────────
// Past the 200,000-number cap a page's scripts hold no data and read the CSV
// files its Data buttons save (any recipe can be written this way). The
// proof writes those files with the buttons' own writer, runs the CSV-mode
// script beside them, and compares every report line with expect.
import { dataFileText, regenDataFiles } from '../js/ui/exportrow.js';

// The data literals an embedded script writes, anchored at a line's start, so
// that the analysis code's own reps[[i]] and the read lines never match.
const EMBEDDED = {
  R: [/^x <- c\(/m, /^(a|b|t_|v_) <- c\(/m, /^reps\[\[\d+\]\] <- list\(id = /m, /^groups\[\[\d+\]\] <- c\(/m],
  py: [/^x = np\.array\(\[(-?\d|np\.nan)/m, /^(a|b) = np\.array\(\[(-?\d|np\.nan)/m, /^    dict\(id=/m, /^groups = \[np\.array\(\[(-?\d|np\.nan)/m],
  m: [/^x = \[/m, /^(a|b) = \[/m, /^reps\(\d+\) = struct/m, /^groups = \{\[/m]
};
EMBEDDED.tidy = EMBEDDED.R;
const embeddedIn = (script, lang) => EMBEDDED[lang].filter(re => re.test(script)).map(String);

/**
 * Runs a recipe's CSV-mode scripts beside the files its Data buttons save, in
 * `langs` where installed, and compares every report line with expect, with no
 * warning printed. `timed` asserts that each R run (Base and Tidy) finishes
 * under 60 seconds, and `also(stdout, lang, stderr)` makes further checks.
 */
function checkCsvMode(name, recipe, datasets, { smoke = false, langs = LANGS, timed = false, also = null } = {}) {
  const csvFiles = () => {
    const files = {};
    for (const f of recipe.csv) {
      const ds = datasets.find(x => x.name === f.dataset);
      assert.ok(ds, 'a dataset for ' + f.file);
      files[f.file] = dataFileText(ds, f.form);
    }
    return files;
  };
  for (const lang of langs) {
    const title = `${name} reads its CSV files in ${lang}`;
    const job = lang === 'm' ? matlabJob(title, smoke, () => ({ name: scriptFileName(recipe, 'm'), text: analysisScript(recipe, 'm', { csv: true }), files: csvFiles() })) : null;
    test(title, { skip: skipFor(lang, smoke) }, async () => {
      const files = csvFiles();
      const text = analysisScript(recipe, lang, { csv: true });
      assert.deepEqual(embeddedIn(text, lang), [], lang + ': no embedded data');
      const t0 = Date.now();
      const { report, stdout, stderr } = await runIn(job, recipe, lang, { text, files });
      const secs = (Date.now() - t0) / 1000;
      if (timed && (lang === 'R' || lang === 'tidy')) assert.ok(secs < 60, lang + ' took ' + secs + ' s');
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang, recipe);
      noWarning(stdout, lang, stderr);
      if (also) also(stdout, lang, stderr);
    });
  }
}

test('a CSV-mode script holds no data, runs the read lines, and names its files', () => {
  const o = outcomeVector(QUEUE_COMMA);
  const cases = [
    stRecipe(QLEN, { align: 'time', cut: 100, count: 10 }),
    exRecipe(TRANSIENT),
    exRecipe(IND_A, exSpread(IND_A, IND_B)),
    oneRecipe({ ds: QUEUE_COMMA, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, plan: null }),
    oneRecipe({ ds: TRANSIENT, x: observations(TRANSIENT), ids: null, pooled: true, proc: 't', level: 0.95, plan: null }),
    twoOf(IND_A, IND_B, 't', 0.95, null),
    pairedRecipe(CRN_A, CRN_B, 't', 'id', null),
    sevRecipe(FOUR)
  ];
  for (const r of cases) {
    const files = Array.from(new Set(r.csv.map(f => f.file)));
    for (const lang of LANGS) {
      const label = r.page + ' ' + lang;
      const embedded = analysisScript(r, lang), csv = analysisScript(r, lang, { csv: true });
      // The patterns find the data an embedded script holds, and none in CSV mode.
      assert.ok(embeddedIn(embedded, lang).length > 0, label + ': the patterns find the embedded data');
      assert.deepEqual(embeddedIn(csv, lang), [], label + ': no embedded data');
      // The read lines run as they stand, under the Data heading, and no line is a marked comment.
      const live = csvReadBlock(lang, r, { live: true });
      const at = csv.indexOf('\n' + SECT[lang] + '\n');
      assert.ok(at > 0 && csv.slice(at + SECT[lang].length + 2).startsWith(live.join('\n') + '\n'), label + ': the live read block opens the Data block');
      const dataBlock = csv.slice(at + 1).split(/\n(?=## |# ---- |%% )/)[0];
      assert.ok(!dataBlock.split('\n').some(l => l.startsWith(MARK[lang])) && !csv.includes('To read the same data from'), label + ': no commented read lines');
      // The header says which files the script needs, and from where.
      const head = csv.slice(0, csv.indexOf('\n\n')).replace(/\n[#%] +/g, ' ');
      assert.ok(head.includes('It also needs the data file' + (files.length > 1 ? 's ' : ' ')) && head.includes('in the folder it runs from.'), label + ': the Requires line');
      for (const f of files) assert.ok(head.includes(f), label + ': the header names ' + f);
      assert.ok(/^[\x00-\x7f]*$/.test(csv) && !/\$\{|`/.test(csv), label + ': ASCII, no template residue');
      assert.ok(!/setwd\(/.test(csv), label + ': no setwd');
      // The same report lines in the same order, in both modes.
      const reports = s => s.split('\n').filter(l => /\breport\(/.test(l) && !/^\s*[#%]/.test(l) && !/^report <- function|^def report|^function report/.test(l)).map(l => l.trim());
      assert.deepEqual(reports(csv), reports(embedded), label + ': the same report lines');
    }
  }
});

// kind and end_time are settings on Steady State and Summary and Plots, and so
// a script that reads its records still has them; neither the records block
// nor the read lines assign them again.
test('kind and end_time are assigned once, in the Settings block', () => {
  const gappyQ = makeDataset({ name: 'Q', response: 'q', kind: 'time', endTime: 600, reps: QLEN.reps.map(r => ({ id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  for (const r of [stRecipe(gappyQ, { align: 'time', cut: 100, count: 10 }), exRecipe(gappyQ), exRecipe(TRANSIENT)]) {
    for (const lang of LANGS) {
      for (const csv of [false, true]) {
        const s = analysisScript(r, lang, { csv });
        const settings = s.slice(s.indexOf('Settings'), s.indexOf('\n' + SECT[lang] + '\n'));
        const want = r.records.kind === 'time' ? (lang === 'm' ? 'end_time = 600;' : lang === 'py' ? 'end_time = 600' : 'end_time <- 600') : null;
        if (want) assert.ok(settings.includes('\n' + want + '\n'), r.page + ' ' + lang + ': end_time in Settings');
        assert.ok(/\nkind (<-|=) ["']/.test(settings), r.page + ' ' + lang + ': kind in Settings');
        const rest = s.slice(s.indexOf('\n' + SECT[lang] + '\n'));
        assert.ok(!/\n[#%]?\s*(kind|end_time) (<-|=) /.test(rest), r.page + ' ' + lang + (csv ? ' csv' : '') + ': kind and end_time are not assigned again, in code or in a commented read line');
      }
    }
  }
});

// The Data buttons name exactly the files the scripts read.
test('the Data buttons save the files the CSV-mode scripts read', () => {
  const ds = QUEUE_COMMA;
  const st = stRecipe(ds, { lumped: true, count: 3 });
  const items = regenDataFiles([{ ds, form: 'observations' }, { ds, form: 'replications' }, { ds, form: 'observations' }]);
  assert.deepEqual(items.map(d => d.label), st.csv.map(f => 'Data: ' + f.file), 'one button per file, in order, a repeat dropped');
  assert.deepEqual(items.map(d => d.file), ['queue-a-1-2_observations.csv', 'queue-a-1-2_replications.csv']);
  // The button's file is the Import page's: the Observations CSV in full and the Replication summary CSV.
  assert.equal(dataFileText(ds, 'observations').split('\n').filter(l => !l.startsWith('#'))[0], 'replication,busy servers');
  assert.ok(/^# end time:/m.test(dataFileText(QLEN, 'replications')), 'a time-persistent file states its end time');
  // Two datasets whose names give one file name are told apart by name.
  const twin = makeDataset({ name: 'Queue A 1 2', response: 'w', kind: 'reps', reps: [1, 2, 3].map(id => ({ id, v: [id + 0.5] })) });
  const two = regenDataFiles([{ ds, form: 'replications' }, { ds: twin, form: 'replications' }]);
  assert.deepEqual(two.map(d => d.label), ['Data: queue-a-1-2_replications.csv (' + ds.name + ')', 'Data: queue-a-1-2_replications.csv (Queue A 1 2)']);
});

// Review Focus 3: time-persistent data with and without an end time, whose
// CSV-mode scripts take end_time from Settings and reach the same time
// averages; and one fixture on every other page.
{
  const qEnd = makeDataset({ name: 'Queue length, end 600', response: 'number in queue', kind: 'time', endTime: 600,
    reps: QLEN.reps.map((r, i) => (i === 2 ? { id: r.id, t: [], v: [] } : { id: r.id, t: Array.from(r.t), v: Array.from(r.v) })) });
  const lens = [300, 520, 760, 410, 848];
  const qOpen = makeDataset({ name: 'Queue length, no end time', response: 'q', kind: 'time',
    reps: QLEN.reps.map((r, i) => ({ id: r.id, t: Array.from(r.t).slice(0, lens[i]), v: Array.from(r.v).slice(0, lens[i]) })) });
  checkCsvMode('Steady State in CSV mode, time-persistent with an end time', stRecipe(qEnd, { align: 'time', nBins: 30, lumped: true, cut: 100, count: 12 }), [qEnd], { smoke: true });
  checkCsvMode('Steady State in CSV mode, time-persistent with no end time', stRecipe(qOpen, { align: 'time', nBins: 40, repIdx: 2, cut: 60, count: 10 }), [qOpen]);
  checkCsvMode('Summary and Plots in CSV mode, time-persistent with an end time', exRecipe(qEnd), [qEnd]);
  checkCsvMode('Summary and Plots in CSV mode, time-persistent with no end time', exRecipe(qOpen), [qOpen]);
  checkCsvMode('Summary and Plots in CSV mode, replication values with the spread test', exRecipe(IND_A, exSpread(IND_A, IND_B)), [IND_A]);
  const o = outcomeVector(QUEUE_COMMA);
  checkCsvMode('One System in CSV mode, t, on a comma-named dataset', oneRecipe({ ds: QUEUE_COMMA, x: o.values, ids: o.ids, pooled: false, proc: 't', level: 0.95, plan: PLAN }), [QUEUE_COMMA]);
  checkCsvMode('Two Systems in CSV mode, paired t by id', pairedRecipe(CRN_A, CRN_B, 't', 'id', PLAN2), [CRN_A, CRN_B]);
  checkCsvMode('Several Systems in CSV mode, independent', sevRecipe(FOUR), FOUR);
  const hashR = makeDataset({ name: 'Hash runs', response: 'w', kind: 'reps', reps: [2.0, 2.4, 1.9, 3.1, 2.2].map((v, i) => ({ id: 'run#' + (i + 1), v: [v] })) });
  const oh = outcomeVector(hashR);
  checkCsvMode('One System in CSV mode on ids run#1 to run#5', oneRecipe({ ds: hashR, x: oh.values, ids: oh.ids, pooled: false, proc: 't', level: 0.95, plan: PLAN }), [hashR]);
  // An observations file with no records at all, only its header: every
  // language still reads its columns as numbers (MATLAB's readtable, left to
  // itself, would type them as text), and every replication gives no outcome.
  for (const kind of ['tally', 'time']) {
    const none = makeDataset({ name: 'No records, ' + kind, response: 'wait', kind, endTime: kind === 'time' ? 10 : undefined,
      reps: [1, 2].map(id => (kind === 'time' ? { id, t: [], v: [] } : { id, v: [] })) });
    const r = exRecipe(none);
    assert.equal(r.expect.observations, 0);
    checkCsvMode('Summary and Plots in CSV mode, an observations file with no records (' + kind + ')', r, [none]);
  }
}

// Over the cap: generated runs of more than 200,000 numbers, whose recipes
// are csvOnly and whose scripts can only read the files.
{
  // A time-persistent state: four replications of 27,600 records (220,800
  // numbers), each record at a time near its index, ending at a stated time.
  const n = 27600;
  const tpBig = makeDataset({ name: 'Big queue length', response: 'number in queue', kind: 'time', endTime: n + 2,
    reps: [0, 1, 2, 3].map(i => ({ id: i + 1, t: Array.from({ length: n }, (_, j) => j + ((j * 37 + i) % 10) / 20), v: Array.from({ length: n }, (_, j) => ((j * 7 + i * 3) % 13) / 4) })) });
  // Tally observations: five replications of 44,001 (220,005 numbers), ids
  // that only text keeps, and an empty replication.
  const m = 44001;
  const tallyBig = makeDataset({ name: 'Big waits', response: 'wait time', unit: 'min', kind: 'tally',
    reps: ['007', '2', '3', '4', '1.0'].map((id, i) => ({ id, v: Array.from({ length: m }, (_, j) => ((j * 31 + i * 17) % 101) / 8 + i / 10) })).concat([{ id: 'e', v: [] }]) });
  assert.ok(recordCount(tpBig) > MAX_NUMBERS && recordCount(tallyBig) > MAX_NUMBERS);
  const st = stRecipe(tpBig, { align: 'time', nBins: 40, lumped: true, cut: 1000, count: 20 });
  const ex = exRecipe(tallyBig);
  const pooledX = observations(tallyBig);
  const one = oneRecipe({ ds: tallyBig, x: pooledX, ids: null, pooled: true, proc: 't', level: 0.95, plan: null });
  test('pages past the cap give csvOnly recipes with every expected value and no data', () => {
    for (const r of [st, ex, one]) {
      assert.equal(r.csvOnly, true, r.page);
      assert.ok(Object.keys(r.expect).length > 10, r.page + ': a full expect map');
      assert.ok(JSON.stringify(r).length < 20000, r.page + ': the recipe copies no data');
      for (const lang of LANGS) {
        const s = analysisScript(r, lang);
        assert.equal(s, analysisScript(r, lang, { csv: true }), r.page + ' ' + lang + ': a csvOnly recipe is always written in CSV mode');
        assert.deepEqual(embeddedIn(s, lang), [], r.page + ' ' + lang + ': no embedded data');
      }
    }
    assert.ok(oneTooBig({ pooled: true, x: pooledX }) && one.data.values.length === 0);
    assert.ok('rep 007 n' in ex.expect && Number.isNaN(ex.expect['rep e outcome']));
  });
  checkCsvMode('Steady State past the cap, time-persistent', st, [tpBig], { timed: true });
  checkCsvMode('Summary and Plots past the cap, tally', ex, [tallyBig], { timed: true });
  checkCsvMode('One System past the cap, pooled observations', one, [tallyBig], { langs: ['R', 'py'], timed: true });
}

// Very many replications. Thirty thousand tally replications of one or two
// observations, and an empty one, hold 50,000 records, under the cap, but
// with each replication's id and its five analyzer values (n, outcome, sd,
// min, and max) a script would hold 230,006 numbers, and so the recipe is
// csvOnly. Its scripts write out the analyzer's values for the first
// REP_LINES_MAX replications only, and each later replication's lines print
// without them. A dataset of 1,500 replication values stays under the cap and
// keeps every analyzer value when its data are embedded; written to read its
// files, it keeps the first 1,000.
{
  const many = makeDataset({ name: 'Many short runs', response: 'wait', unit: 'min', kind: 'tally',
    reps: Array.from({ length: 30000 }, (_, i) => ({ id: i + 1, v: (i % 3 ? [((i * 37) % 101) / 8, ((i * 53) % 97) / 8] : [((i * 41) % 89) / 8]) }))
      .concat([{ id: 'e', v: [] }]) });
  const fifteen = makeDataset({ name: 'Fifteen hundred days', response: 'avg wait', kind: 'reps',
    reps: Array.from({ length: 1500 }, (_, i) => ({ id: 'd' + (i + 1), v: [((i * 29) % 103) / 10] })) });
  const rm = exRecipe(many), r15 = exRecipe(fifteen);
  test('very many replications: the analyzer\'s values for the first 1,000 only, in a script that reads its files', () => {
    assert.equal(REP_LINES_MAX, 1000);
    assert.ok(recordCount(many) <= MAX_NUMBERS && exploreTooBig({ ds: many, spread: null }), 'the per-replication values take it past the cap');
    assert.equal(rm.csvOnly, true);
    assert.ok(Number.isNaN(rm.expect['rep e outcome']) && Number.isNaN(rm.expect['rep 1 sd']) && 'rep 30000 max' in rm.expect);
    for (const lang of LANGS) {
      const s = analysisScript(rm, lang), flat = s.replace(/\n[#%] /g, ' ');
      assert.deepEqual(embeddedIn(s, lang), [], lang + ': no embedded data');
      assert.ok(s.length < 100000, lang + ': a small script (' + s.length + ' characters)');
      assert.ok(flat.includes('They are written out for the first 1,000 of the 30,001 replications only'), lang + ': says why');
      for (const k of repKeys('tally')) assert.ok(s.includes('page_at(page_' + k + ', pos)'), lang + ': ' + k + ' looked up by position');
    }
    assert.ok(!r15.csvOnly && !exploreTooBig({ ds: fifteen, spread: null }));
    for (const lang of LANGS) {
      const embedded = analysisScript(r15, lang), csv = analysisScript(r15, lang, { csv: true });
      assert.ok(!embedded.includes('page_at(') && !embedded.includes('written out for the first'), lang + ': every analyzer value when embedded');
      assert.ok(csv.includes('page_at(page_outcome, pos)') && csv.replace(/\n[#%] /g, ' ').includes('first 1,000 of the 1,500 replications'), lang + ': the first 1,000 when reading files');
    }
  });
  const pastFirst = (stdout, lang, stderr) => {
    noWarning(stdout, lang, stderr);
    assert.match(stdout, /^rep 1000 n: \d+ {3}\(analyzer: \d+\)$/m, lang + ': the 1,000th replication carries the analyzer\'s value');
    assert.match(stdout, /^rep 1001 n: \d+$/m, lang + ': the next prints alone');
  };
  checkCsvMode('Summary and Plots past the cap, thirty thousand tally replications', rm, [many], { timed: true, also: pastFirst });
  checkCsvMode('Summary and Plots in CSV mode, 1,500 replication values', r15, [fifteen], { also: (stdout, lang, stderr) => {
    pastFirst(stdout.replace(/^rep d(\d+) /gm, 'rep $1 '), lang, stderr);
  } });
}

// Levene's groups stay embedded in every script, and a script that reads its
// records from files must still hold no more than MAX_NUMBERS numbers: when the
// groups alone would take it past, the recipe leaves the test out and the
// script says why. Groups that fit stay.
test('Levene groups too large to embed are left out of a script that reads its files', () => {
  const big = makeDataset({ name: 'big', response: 'q', kind: 'tally', reps: [{ id: 1, v: Array.from({ length: MAX_NUMBERS + 1 }, (_, i) => i % 7) }] });
  const groups = n => [0, 1].map(k => Float64Array.from({ length: n }, (_, i) => ((i * 7 + k) % 13) / 2));
  // The room the groups have: the cap less one replication's analyzer values (199,995).
  assert.equal(MAX_NUMBERS - repKeys('tally').length, 199995);
  const out = exploreRecipe({ ds: big, spread: { names: ['G1', 'G2'], groups: groups(99998) }, level: 0.95, title: 'Summary of big', provenance: {} });
  assert.equal(out.csvOnly, true);
  assert.ok(!('levene F' in out.expect) && !out.spread);
  assert.deepEqual(out.explore.spreadOmitted, { names: ['G1', 'G2'], count: 199996 });
  for (const lang of LANGS) {
    const s = analysisScript(out, lang), flat = s.replace(/\n[#%] /g, ' ');
    assert.ok(flat.includes('The page runs Levene\'s test across G1 and G2, but their 199,996 replication outcomes would take this script past the 200,000 numbers'), lang + ': says why');
    assert.ok(!s.includes('spread_groups') && !s.includes('levene_test'), lang + ': no Levene test');
  }
  const kept = exploreRecipe({ ds: big, spread: { names: ['G1', 'G2'], groups: groups(99997) }, level: 0.95, title: 'Summary of big', provenance: {} });
  assert.ok('levene F' in kept.expect && kept.spread && !kept.explore.spreadOmitted);
});

// ── Repeated values and no spread within groups ────────────────────────
// Values repeated in a way that does not sum exactly (0.1 three times sums to
// 0.30000000000000004): their variance is exactly 0 in the analyzer and in
// every script, where NumPy's and MATLAB's var leave rounding error and
// MATLAB's vartest2 then reports F = 0 for two constant sets. An analysis of
// variance with no spread within the designs has F infinite (p = 0), or
// undefined when the between part is rounding error too, where aov, f_oneway,
// anova1, and anova2 report F near 1e31.
{
  const r01 = n => Array(n).fill(0.1), r03 = n => Array(n).fill(0.3), r07 = n => Array(n).fill(0.7);
  const varied = [3.1, 2.9, 4.2, 3.6, 3.3];
  // Two Systems: both constant, and one constant against a varied design.
  for (const proc of ['t', 'pooled', 'np']) {
    const r = twoOf(reps('A', r01(3)), reps('B', r03(3)), proc, 0.95, PLAN2);
    if (proc !== 'np') { assert.equal(r.expect.t, -Infinity); assert.equal(r.expect.p, 0); assert.equal(r.expect['half-width'], 0); }
    assert.ok(Number.isNaN(r.expect.F) && Number.isNaN(r.expect['plan n per design for half-width']));
    checkRecipe('Two Systems, ' + proc + ', 0.1 and 0.3 each repeated', r, { also: noWarning });
  }
  const one = twoOf(reps('A', r07(3)), reps('B', varied), 'pooled', 0.95, PLAN2);
  assert.equal(one.expect['sd A'], 0); assert.equal(one.expect.F, 0); assert.equal(one.expect['F p'], 0);
  checkRecipe('Two Systems, pooled, 0.7 repeated against a varied design', one, { also: noWarning });
  checkRecipe('Two Systems, paired t on 0.1 and 0.3 each repeated', pairedRecipe(reps('A', r01(3)), reps('B', r03(3)), 't', 'id', PLAN2), { also: noWarning });
  // One System: 0.1 seven times.
  const flat7 = makeDataset({ name: 'Point one', response: 'v', kind: 'reps', reps: r01(7).map((v, i) => ({ id: i + 1, v: [v] })) });
  const ro = oneRecipe({ ds: flat7, x: r01(7), ids: flat7.reps.map(p => p.id), pooled: false, proc: 't', level: 0.95,
    provenance: oneProv(flat7, 0.95, 't'), plan: { relative: false, rel: 10, abs: 0.05, delta: 0.3, power: 0.8 } });
  assert.equal(ro.expect['half-width'], 0);
  checkRecipe('One System, t interval on 0.1 repeated seven times', ro, { also: noWarning });
  // Several Systems: three constant designs, one-way and in blocks, and designs additive in blocks.
  const consts = [r01(3), r03(3), r07(3)].map((v, i) => reps('C' + (i + 1), v));
  const rc = sevRecipe(consts, { eps: 0.4 });
  assert.equal(rc.expect['anova F'], Infinity); assert.equal(rc.expect['anova p'], 0); assert.equal(rc.expect['ms within'], 0);
  assert.ok(Number.isNaN(rc.expect['levene F']) && Number.isNaN(rc.expect['levene p']));
  checkRecipe('Several Systems, 0.1, 0.3, and 0.7 each repeated, Tukey', rc, sevChecks);
  checkRecipe('Several Systems, 0.1, 0.3, and 0.7 each repeated, Dunnett', sevRecipe(consts, { rule: 'dunnett', ctrlIdx: 1 }), sevChecks);
  const rb = sevRecipe(consts, { paired: true, rule: 'bonferroni' });
  assert.equal(rb.expect['anova F'], Infinity);
  checkRecipe('Several Systems, 0.1, 0.3, and 0.7 each repeated, in blocks', rb, sevChecks);
  // Each design's two outcomes differ by exactly 1, and so the paired differences are exact
  // constants, while the residual found by subtraction is rounding error (about 1e-15).
  const additive = [[2.1, 3.1], [2.3, 3.3], [4.3, 5.3]].map((v, i) => reps('D' + (i + 1), v));
  const ra = sevRecipe(additive, { paired: true });
  assert.equal(ra.expect['anova F'], Infinity);
  checkRecipe('Several Systems, designs additive in the blocks', ra, sevChecks);
  // Summary and Plots: Levene across two datasets whose distances from their medians all agree,
  // and a dataset of 0.1 repeated.
  const eqA = reps('E1', [0.1, 0.3]), eqB = reps('E2', [1.1, 1.3]);
  const re = exRecipe(eqA, exSpread(eqA, eqB));
  assert.ok(Number.isNaN(re.expect['levene F']));
  checkRecipe('Summary and Plots, Levene on equal spreads of two outcomes each', re, exChecks);
  const flat4 = reps('Flat point one', r01(4));
  const rf = exRecipe(flat4, exSpread(flat4, IND_A));
  assert.equal(rf.expect['interval half-width'], 0);
  checkRecipe('Summary and Plots on 0.1 repeated', rf, exChecks);
  // Large offsets: the rule is judged on the outcomes' own sum of squares, and residuals are
  // summed directly, so neither the distances' nor a subtraction's rounding reads as spread.
  for (const off of [1e6, 1e9]) {
    const two = [[2.1, 3.4], [3.9, 4.4], [2.5, 2.2]].map((v, i) => reps('T' + (i + 1), v.map(x => x + off)));
    const rt = sevRecipe(two, { eps: 0.4 });
    assert.equal(rt.expect['levene F'], Infinity); assert.equal(rt.expect['levene p'], 0);
    checkRecipe('Several Systems, two replications per design near ' + off, rt, sevChecks);
  }
  const c6 = [0.1, 0.3, 0.7].map((v, i) => reps('M' + (i + 1), Array(3).fill(1e6 + v)));
  const rc6 = sevRecipe(c6, { eps: 0.4 });
  assert.equal(rc6.expect['anova F'], Infinity, 'the means near a million differ by 0.2 and 0.4');
  checkRecipe('Several Systems, constant designs near a million', rc6, sevChecks);
  const add6 = [[2.1, 3.1], [2.3, 3.3], [4.3, 5.3]].map((v, i) => reps('A' + (i + 1), v.map(x => x + 1e6)));
  const radd6 = sevRecipe(add6, { paired: true });
  assert.equal(radd6.expect['anova F'], Infinity); assert.equal(radd6.expect['block F'], Infinity);
  checkRecipe('Several Systems, designs additive in the blocks near a million', radd6, sevChecks);
  // Paired differences equal only up to the subtraction's rounding: 0.1 - 0.3, 0.2 - 0.4, 0.5 - 0.7.
  const pa = reps('PA', [0.1, 0.2, 0.5]), pb = reps('PB', [0.3, 0.4, 0.7]);
  const rpr = pairedRecipe(pa, pb, 't', 'id', PLAN2);
  assert.equal(rpr.expect['sd of differences'], 0); assert.equal(rpr.expect.t, -Infinity);
  checkRecipe('Two Systems, paired t on differences equal up to rounding', rpr, { also: noWarning });
  const pc = reps('PC', [0.9, 1.4, 0.6]);
  const rsp = sevRecipe([pa, pb, pc], { paired: true, rule: 'bonferroni' });
  checkRecipe('Several Systems, paired differences equal up to rounding', rsp, sevChecks);
  // Five pairs whose differences are equal up to rounding: the paired t has no spread, and the
  // differences' normality check is skipped (on the rounding's own pattern Shapiro-Wilk gives
  // W = 0.759 in the analyzer and 0.881 in SciPy).
  const qa = reps('QA', [0.1, 0.2, 0.5, 0.7, 1.1]), qb = reps('QB', [0.3, 0.4, 0.7, 0.9, 1.3]);
  const rq = pairedRecipe(qa, qb, 't', 'id', PLAN2);
  assert.equal(rq.expect['sd of differences'], 0);
  assert.ok(!('shapiro differences W [optional]' in rq.expect));
  checkRecipe('Two Systems, paired t on five differences equal up to rounding', rq, { also: noWarning });
  const qc = reps('QC', [0.9, 1.4, 0.6, 1.8, 1.0]);
  const rsq = sevRecipe([qa, qb, qc], { paired: true, rule: 'bonferroni' });
  assert.ok(!('shapiro diff 1-2 W [optional]' in rsq.expect) && 'shapiro diff 1-3 W [optional]' in rsq.expect);
  checkRecipe('Several Systems, paired, five differences equal up to rounding', rsq, sevChecks);
  // Barely above the bound: groups {m, m + 1e-8, m - 1e-8}. The analyzer and R's aov give F near
  // 3e16; SciPy's f_oneway gives inf and MATLAB's anova1 no F, and so both take F from the sums
  // of squares summed directly.
  const near = [1, 2, 3].map(m => reps('N' + m, [m, m + 1e-8, m - 1e-8]));
  const rn = sevRecipe(near, { eps: 0.4 });
  assert.ok(Number.isFinite(rn.expect['anova F']) && rn.expect['anova F'] > 1e15, 'F ' + rn.expect['anova F']);
  checkRecipe('Several Systems, spread barely above the bound', rn, sevChecks);
  // Steady State: a constant run of 0.1, whose batch means are all equal.
  const flatRun = makeDataset({ name: 'Flat run', response: 'v', kind: 'tally', reps: [{ id: 1, v: Array(200).fill(0.1) }] });
  const rs = stRecipe(flatRun, { count: 10 });
  assert.equal(rs.expect['half-width'], 0);
  assert.ok(Number.isNaN(rs.expect['fishman C']) && Number.isNaN(rs.expect['acf lag 1']));
  checkRecipe('Steady State, a constant run of 0.1', rs, stChecks);
}

// Every test is defined: the MATLAB batch can start (see "MATLAB batch" above).
// Keep this line last.
startMatlab();
