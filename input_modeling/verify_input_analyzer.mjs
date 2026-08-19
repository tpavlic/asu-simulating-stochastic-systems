#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for input_analyzer.html.  NOT shipped with the widget.

     node input_modeling/verify_input_analyzer.mjs

   The script slices the block between the IA-CORE sentinels out of
   input_analyzer.html and runs it in a Node vm context, so the code under
   test is byte-for-byte the code the page ships.  There is no second copy
   of the numerics to drift out of sync.

   Reference values are exact identities wherever one exists -- Gamma(1/2)
   = sqrt(pi), P(1,x) = 1 - e^-x, I_x(2,3) = 11/16 at x = 1/2, psi(1) =
   -Euler's gamma -- rather than digits copied from a table, so a reader
   can check the check.  Where a published constant is used instead, the
   source is named on the line.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'input_analyzer.html');

/* ── Load the core out of the page ─────────────────────────────────── */
function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== IA-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== IA-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('IA-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'input_analyzer.html#IA-CORE' });
  if (!ctx.IA) throw new Error('core ran but exported no IA namespace');
  return { IA: ctx.IA, lines: core.split('\n').length };
}

/* ── Tiny test harness ─────────────────────────────────────────────── */
let pass = 0, fail = 0, group = '';
const failures = [];
const C = process.stdout.isTTY
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
      d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { g: s => s, r: s => s, d: s => s, b: s => s };

function section(name) { group = name; console.log('\n' + C.b(name)); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ' + C.g('PASS') + '  ' + label); }
  else {
    fail++; failures.push(group + ' :: ' + label);
    console.log('  ' + C.r('FAIL') + '  ' + label + (detail ? '\n        ' + C.d(detail) : ''));
  }
}
/* Relative closeness, falling back to absolute near zero. */
function close(got, want, tol, label) {
  const scale = Math.max(1e-300, Math.abs(want));
  const err = Math.abs(got - want) / (Math.abs(want) < 1e-8 ? 1 : scale);
  ok(err <= tol, `${label}  (err ${err.toExponential(2)} <= ${tol.toExponential(1)})`,
     `got  ${got}\n        want ${want}`);
  return err;
}

/* ── Constants used as references ──────────────────────────────────── */
const SQRT_PI = Math.sqrt(Math.PI);
const EULER   = 0.5772156649015328606;   /* Euler-Mascheroni, A&S 6.1.3 */

const { IA, lines } = loadCore();
console.log(C.b('Input Analyzer — numerics verification'));
console.log(C.d(`core block: ${lines} lines, sliced from ${path.relative(process.cwd(), HTML)}`));

/* ══════════════════════════════════════════════════════════════════════
   1.  LOG GAMMA
   ══════════════════════════════════════════════════════════════════════ */
section('1. logGamma — against exact identities');
{
  /* Gamma(n) = (n-1)! */
  let f = 1;
  for (let n = 1; n <= 12; n++) {
    if (n > 1) f *= (n - 1);
    if (n === 1 || n === 2 || n === 6 || n === 11 || n === 12)
      close(IA.logGamma(n), Math.log(f), 1e-14, `logGamma(${n}) = log(${n - 1}!)`);
  }
  /* Gamma(n + 1/2) = (2n)! / (4^n n!) * sqrt(pi) */
  const fact = k => { let p = 1; for (let i = 2; i <= k; i++) p *= i; return p; };
  for (const n of [0, 1, 2, 5, 8]) {
    const want = Math.log(fact(2 * n) / (Math.pow(4, n) * fact(n)) * SQRT_PI);
    close(IA.logGamma(n + 0.5), want, 1e-14, `logGamma(${n + 0.5}) = log((2n)!/(4^n n!) sqrt(pi))`);
  }
  /* Reflection: Gamma(z) Gamma(1-z) = pi / sin(pi z) */
  for (const z of [0.1, 0.3, 0.45, -0.5, -1.5, -2.25]) {
    const lhs = IA.logGamma(z) + IA.logGamma(1 - z);
    const rhs = Math.log(Math.abs(Math.PI / Math.sin(Math.PI * z)));
    close(lhs, rhs, 1e-13, `reflection at z = ${z}`);
  }
  /* Legendre duplication: Gamma(z) Gamma(z+1/2) = 2^(1-2z) sqrt(pi) Gamma(2z) */
  for (const z of [0.7, 1.3, 4.2, 17.5]) {
    const lhs = IA.logGamma(z) + IA.logGamma(z + 0.5);
    const rhs = (1 - 2 * z) * Math.LN2 + Math.log(SQRT_PI) + IA.logGamma(2 * z);
    close(lhs, rhs, 1e-13, `duplication at z = ${z}`);
  }
  /* One published digit string, as an independent cross-check:
     Gamma(1.5) = 0.8862269254527580  (A&S table 6.1, and = sqrt(pi)/2) */
  close(Math.exp(IA.logGamma(1.5)), 0.8862269254527580, 1e-14, 'Gamma(1.5) vs published digits');
}

/* ══════════════════════════════════════════════════════════════════════
   2.  INCOMPLETE GAMMA
   ══════════════════════════════════════════════════════════════════════ */
section('2. gammaP / gammaQ — against exact identities');
{
  /* P(1, x) = 1 - e^-x */
  for (const x of [0.01, 0.5, 1, 3, 12, 40]) {
    close(IA.gammaP(1, x), 1 - Math.exp(-x), 1e-14, `P(1, ${x}) = 1 - e^-x`);
  }
  /* P(n, x) = 1 - e^-x sum_{k<n} x^k/k!   for integer n */
  for (const [n, x] of [[2, 1], [3, 0.5], [5, 7], [10, 4], [10, 25]]) {
    let s = 0, term = 1;
    for (let k = 0; k < n; k++) { if (k) term *= x / k; s += term; }
    close(IA.gammaP(n, x), 1 - Math.exp(-x) * s, 1e-12, `P(${n}, ${x}) = Poisson tail identity`);
  }
  /* P(1/2, x) = erf(sqrt(x)) — checked through the page's own erf, which
     is defined the other way round, so this is a consistency loop. */
  for (const x of [0.25, 2, 9]) {
    close(IA.gammaP(0.5, x), IA.erf(Math.sqrt(x)), 1e-15, `P(1/2, ${x}) = erf(sqrt(x))`);
  }
  /* P + Q = 1 across both branches of the algorithm (x < a+1 and x >= a+1) */
  for (const [a, x] of [[0.3, 0.05], [0.3, 5], [7, 3], [7, 8], [120, 100], [120, 160]]) {
    close(IA.gammaP(a, x) + IA.gammaQ(a, x), 1, 1e-14, `P + Q = 1 at a=${a}, x=${x}`);
  }
  /* Chi-square percentage points, Abramowitz & Stegun table 26.8:
     the 0.95 point of chi-square with df degrees of freedom.  The
     chi-square CDF is P(df/2, x/2). */
  const CHI95 = { 1: 3.841459, 2: 5.991465, 5: 11.070498, 10: 18.307038, 30: 43.772972 };
  for (const df of Object.keys(CHI95)) {
    close(IA.gammaP(df / 2, CHI95[df] / 2), 0.95, 2e-7,
      `chi-square(${df}) CDF at the published 95% point`);
  }
  /* Far tail, where the continued fraction has to carry it alone */
  ok(IA.gammaQ(2, 60) > 0 && IA.gammaQ(2, 60) < 1e-24,
     'Q(2, 60) is a tiny positive number, not an underflow to zero',
     'got ' + IA.gammaQ(2, 60));
  close(IA.gammaQ(2, 60), 61 * Math.exp(-60), 1e-12, 'Q(2, 60) = 61 e^-60');
}

/* ══════════════════════════════════════════════════════════════════════
   3.  INCOMPLETE BETA
   ══════════════════════════════════════════════════════════════════════ */
section('3. betaInc — against exact identities');
{
  for (const x of [0.05, 0.4, 0.93]) {
    close(IA.betaInc(1, 1, x), x, 1e-14, `I_${x}(1,1) = x`);
    close(IA.betaInc(1, 3, x), 1 - Math.pow(1 - x, 3), 1e-13, `I_${x}(1,3) = 1-(1-x)^3`);
    close(IA.betaInc(4, 1, x), Math.pow(x, 4), 1e-13, `I_${x}(4,1) = x^4`);
  }
  /* Symmetry I_x(a,b) = 1 - I_{1-x}(b,a) */
  for (const [a, b, x] of [[0.5, 2.5, 0.3], [7, 3, 0.62], [40, 55, 0.5]]) {
    close(IA.betaInc(a, b, x), 1 - IA.betaInc(b, a, 1 - x), 1e-13,
      `symmetry at a=${a}, b=${b}, x=${x}`);
  }
  /* Integer a,b: I_x(a,b) = sum_{j=a}^{a+b-1} C(a+b-1,j) x^j (1-x)^(n-j).
     At a=2, b=3, x=1/2 this is 11/16 exactly. */
  close(IA.betaInc(2, 3, 0.5), 11 / 16, 1e-14, 'I_0.5(2,3) = 11/16 exactly');
  const binom = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  for (const [a, b, x] of [[3, 5, 0.25], [6, 2, 0.8]]) {
    const n = a + b - 1;
    let s = 0;
    for (let j = a; j <= n; j++) s += binom(n, j) * Math.pow(x, j) * Math.pow(1 - x, n - j);
    close(IA.betaInc(a, b, x), s, 1e-12, `I_${x}(${a},${b}) = binomial tail`);
  }
  /* Student t: the two-sided 95% point for 10 df is 2.228139 (published,
     A&S table 26.10).  P(|T| > t) = I_{df/(df+t^2)}(df/2, 1/2). */
  close(IA.betaInc(5, 0.5, 10 / (10 + 2.228139 ** 2)), 0.05, 5e-7,
    't(10) two-sided tail at the published 97.5% point');
}

/* ══════════════════════════════════════════════════════════════════════
   4.  NORMAL CDF AND ITS INVERSE
   ══════════════════════════════════════════════════════════════════════ */
section('4. normCdf / normInv');
{
  close(IA.normCdf(0), 0.5, 1e-15, 'Phi(0) = 1/2');
  /* Published digits: Phi(1) and Phi(-3), A&S table 26.1 */
  close(IA.normCdf(1), 0.8413447460685429, 1e-14, 'Phi(1) vs published digits');
  close(IA.normCdf(-3), 0.001349898031630095, 1e-12, 'Phi(-3) vs published digits');
  close(IA.normCdf(-1) + IA.normCdf(1), 1, 1e-15, 'symmetry Phi(-z) + Phi(z) = 1');
  /* Deep tail must not flush to zero */
  ok(IA.normCdf(-8) > 0 && IA.normCdf(-8) < 1e-14, 'Phi(-8) stays positive',
     'got ' + IA.normCdf(-8));
  close(IA.normCdf(-8), 6.220960574271782e-16, 1e-9, 'Phi(-8) vs published value');
  /* The 97.5% point, the number every statistics course memorizes */
  close(IA.normInv(0.975), 1.959963984540054, 1e-12, 'z_{0.975} = 1.959963984540054');
  close(IA.normInv(0.95), 1.6448536269514722, 1e-12, 'z_{0.95} = 1.6448536269514722');
  /* Round trip across the whole usable range, including both Acklam tails */
  let worst = 0;
  for (const p of [1e-12, 1e-8, 1e-4, 0.02, 0.02425, 0.1, 0.5, 0.9, 0.97575, 0.9999, 1 - 1e-9]) {
    const e = Math.abs(IA.normCdf(IA.normInv(p)) - p) / p;
    if (e > worst) worst = e;
  }
  ok(worst < 1e-12, `normInv round trip: worst relative error ${worst.toExponential(2)} < 1e-12`);
}

/* ══════════════════════════════════════════════════════════════════════
   5.  DIGAMMA AND TRIGAMMA
   ══════════════════════════════════════════════════════════════════════ */
section('5. digamma / trigamma');
{
  close(IA.digamma(1), -EULER, 1e-14, 'psi(1) = -gamma');
  close(IA.digamma(0.5), -EULER - 2 * Math.LN2, 1e-14, 'psi(1/2) = -gamma - 2 ln 2');
  /* psi(n) = -gamma + sum_{k=1}^{n-1} 1/k */
  for (const n of [2, 5, 9]) {
    let s = 0; for (let k = 1; k < n; k++) s += 1 / k;
    close(IA.digamma(n), -EULER + s, 1e-14, `psi(${n}) = -gamma + H_${n - 1}`);
  }
  /* Recurrence psi(x+1) = psi(x) + 1/x, away from the switchover point */
  for (const x of [0.7, 3.3, 5.9, 6.1, 20]) {
    close(IA.digamma(x + 1) - IA.digamma(x), 1 / x, 1e-12, `psi recurrence at x = ${x}`);
  }
  close(IA.trigamma(1), Math.PI ** 2 / 6, 1e-12, "psi'(1) = pi^2/6");
  close(IA.trigamma(0.5), Math.PI ** 2 / 2, 1e-12, "psi'(1/2) = pi^2/2");
  for (const x of [0.9, 4.5, 6.2, 15]) {
    close(IA.trigamma(x) - IA.trigamma(x + 1), 1 / (x * x), 1e-11,
      `psi' recurrence at x = ${x}`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   6.  PSEUDORANDOM NUMBER GENERATOR
   ══════════════════════════════════════════════════════════════════════ */
section('6. MRG32k3a');
{
  const u = IA.MRG32k3a(12345);
  const N = 500000;
  let mean = 0, m2 = 0, lo = 1, hi = 0;
  const bins = new Array(20).fill(0);
  for (let i = 0; i < N; i++) {
    const v = u();
    mean += v; m2 += v * v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    bins[Math.min(19, Math.floor(v * 20))]++;
  }
  mean /= N;
  const varr = m2 / N - mean * mean;
  ok(lo > 0 && hi < 1, 'output stays strictly inside (0,1)', `min ${lo}, max ${hi}`);
  /* SE of the mean is sqrt(1/12/N) = 4.08e-4; 4 SE is a fair band. */
  ok(Math.abs(mean - 0.5) < 4 * Math.sqrt(1 / 12 / N),
     `mean ${mean.toFixed(6)} within 4 SE of 1/2`);
  close(varr, 1 / 12, 5e-3, 'variance ~ 1/12');
  /* Chi-square uniformity over 20 equal bins, 19 df: reject above 43.82 */
  let chi = 0;
  for (const b of bins) chi += (b - N / 20) ** 2 / (N / 20);
  ok(chi < 43.82, `equal-bin chi-square ${chi.toFixed(2)} < 43.82 (19 df, 0.1% level)`);

  /* Reproducibility and stream separation */
  const a1 = IA.MRG32k3a(777), a2 = IA.MRG32k3a(777);
  let same = true;
  for (let i = 0; i < 2000; i++) if (a1() !== a2()) same = false;
  ok(same, 'the same seed reproduces the same stream exactly');

  const b1 = IA.MRG32k3a(777), b2 = IA.MRG32k3a(778);
  let diff = 0;
  for (let i = 0; i < 2000; i++) if (b1() !== b2()) diff++;
  ok(diff === 2000, 'adjacent seeds give completely different streams',
     `${2000 - diff} of 2000 draws coincided`);

  /* Seed 0 must not be an absorbing state */
  const z = IA.MRG32k3a(0);
  let allSame = true;
  const z0 = z();
  for (let i = 0; i < 100; i++) if (z() !== z0) allSame = false;
  ok(!allSame, 'seed 0 produces a live stream, not a constant');

  /* Normals through the inverse CDF */
  const un = IA.MRG32k3a(99);
  let nm = 0, n2 = 0;
  const M = 400000;
  for (let i = 0; i < M; i++) { const g = un.normal(); nm += g; n2 += g * g; }
  nm /= M;
  ok(Math.abs(nm) < 4 / Math.sqrt(M), `normal mean ${nm.toFixed(5)} within 4 SE of 0`);
  close(n2 / M - nm * nm, 1, 1e-2, 'normal variance ~ 1');
}

/* ══════════════════════════════════════════════════════════════════════
   7.  PARSER
   ══════════════════════════════════════════════════════════════════════ */
section('7. parseTable / columnValues');
{
  const vals = t => {
    const p = IA.parseTable(t);
    return { p, v: IA.columnValues(p.cols[0]).values };
  };
  let r = vals('1\n2\n3\n');
  ok(r.v.join(',') === '1,2,3', 'bare column of numbers');

  r = vals('Wait\n1.5\n2.5\n\n3.5\n');
  ok(r.p.header === true && r.v.join(',') === '1.5,2.5,3.5',
     'header row skipped and blank lines dropped', JSON.stringify(r.v));

  r = vals('1,\n2,\n3,\n');
  ok(r.v.join(',') === '1,2,3', 'trailing commas tolerated', JSON.stringify(r.v));

  let p = IA.parseTable('id,wait,served\n1,4.2,yes\n2,5.1,no\n3,,yes\n');
  ok(p.names.join('|') === 'id|wait|served', 'column names read from the header',
     p.names.join('|'));
  ok(IA.columnValues(p.cols[1]).values.join(',') === '4.2,5.1',
     'a chosen column is extracted, empty cell dropped');
  ok(IA.columnValues(p.cols[2]).values.length === 0 &&
     IA.columnValues(p.cols[2]).skipped === 3, 'a text column yields nothing and reports 3 skips');

  p = IA.parseTable('a;b\n1;2\n3;4\n');
  ok(p.delim === ';' && p.cols.length === 2, 'semicolon delimiter detected', String(p.delim));
  p = IA.parseTable('a\tb\n1\t2\n3\t4\n');
  ok(p.delim === '\t' && p.cols.length === 2, 'tab delimiter detected', JSON.stringify(p.delim));
  p = IA.parseTable('1 2\n3 4\n5 6\n');
  ok(p.delim === null && p.cols.length === 2, 'whitespace-separated columns',
     String(p.delim) + ' / ' + p.cols.length);

  r = vals('4.2\nNA\n5.1\nn/a\n6.0\n');
  ok(r.v.join(',') === '4.2,5.1,6', 'NA and n/a are skipped, not read as zero', JSON.stringify(r.v));
  r = vals('"1.5"\n"2.5"\n');
  ok(r.v.join(',') === '1.5,2.5', 'quoted numbers unquoted');
  r = vals('1e3\n-2.5\n+4\n');
  ok(r.v.join(',') === '1000,-2.5,4', 'scientific, signed, and plus-prefixed numbers');
  ok(IA.parseTable('').cols.length === 0, 'empty input yields no columns');

  /* ── Files that defeated the old delimiter rule ────────────────── */
  {
    /* A preamble of notes above a real table. Every one of those lines
       lacks a comma, and under the old rule each voted against the comma
       being the delimiter until the table lost. */
    const junk = 'asdf\n'.repeat(7) +
      '\ngroup_lower,group_upper,bins_pooled,observed\n' +
      '-0.5,1.5,1,17\n1.5,3.5,1,79\n3.5,5.5,1,63\n5.5,7.5,1,33\n7.5,11.5,2,8\n';
    const pj = IA.parseTable(junk);
    ok(pj.delim === ',' && pj.cols.length === 4,
       `7 lines of preamble: delimiter ${JSON.stringify(pj.delim)}, ${pj.cols.length} columns`);
    ok(pj.header === true && pj.names[0] === 'group_lower',
       'and the real header is found, not the preamble', pj.names.join('|'));
    ok(pj.dropped === 7, `with all 7 preamble lines dropped (got ${pj.dropped})`);
    ok(IA.columnValues(pj.cols[3]).values.join(',') === '17,79,63,33,8',
       'and the data reads correctly');
    /* The preamble filter has to run BEFORE the modal column count, or the
       preamble outvotes the table and the file is read as one column. */
    const many = 'a note about the study\n'.repeat(30) + 'a,b\n1,2\n3,4\n5,6\n7,8\n';
    const pm = IA.parseTable(many);
    ok(pm.cols.length === 2 && pm.names.join(',') === 'a,b',
       `30 preamble lines against 5 data rows still yields ${pm.cols.length} columns`);

    /* Ragged rows, which is what a spreadsheet emits when trailing cells
       are empty. Under the old rule enough of them also sank the file. */
    const ragged = '-0.5,1.5,1,17\n1.5,3.5,1,79\n3.5,5.5,1,63\n5.5,7.5,1,33\n7.5,11.5,2,8\n' +
      '2,\n3,\n2,3,4,5\n2,3,4,\n3,3,3\n2,2,\n1,2\n3,3,4,3,\n';
    const pr = IA.parseTable(ragged);
    ok(pr.delim === ',' && pr.cols.length >= 4,
       `ragged rows: delimiter ${JSON.stringify(pr.delim)}, ${pr.cols.length} columns`);
    ok(pr.ragged > 0, `and the raggedness is reported (${pr.ragged} lines)`);
    ok(IA.columnValues(pr.cols[0]).values.length === 13,
       'with every row contributing its first cell');

    /* "#" is a comment by convention, and by this page's own CSV output. */
    const hashed = '# Input Analyzer\n# observations: 120\n# seed: 42\n\nvalue\n4.2\n6.7\n2.1\n';
    const ph = IA.parseTable(hashed);
    ok(ph.dropped === 3 && ph.names[0] === 'value',
       `comment lines dropped (${ph.dropped}), header found`);
    ok(IA.columnValues(ph.cols[0]).values.join(',') === '4.2,6.7,2.1', 'and the data survives');

    /* A file where every row ends in a separator is not one column wider. */
    const trail = 'a,b,\n1,2,\n3,4,\n5,6,\n';
    const pt = IA.parseTable(trail);
    ok(pt.cols.length === 2, `a uniform trailing separator does not add a column (${pt.cols.length})`);

    /* The cases the old rule got right must still work. */
    ok(IA.parseTable('1,\n2,\n3,\n').cols.length === 1,
       'a one-column file of trailing commas is still one column');
    ok(IA.parseTable('1 2\n3 4\n5 6\n').cols.length === 2, 'whitespace columns still work');
    ok(IA.parseTable('4.2\n6.7\n2.1\n').cols.length === 1, 'a plain column still works');
  }

  /* CSV comments go out as lines, not as a row whose first cell starts
     with a hash. */
  {
    const csv = IA.toCsv([['# a comment, with a comma in it'], ['a', 'b'], [1, 2]]);
    const lines = csv.split('\n');
    ok(lines[0] === '# a comment, with a comma in it',
       'a comment row is emitted verbatim, unquoted and unsplit', JSON.stringify(lines[0]));
    ok(lines[1] === 'a,b' && lines[2] === '1,2', 'and ordinary rows are unaffected');
    ok(IA.toCsv([['#hash', 'second cell']]).split('\n')[0] === '#hash,second cell',
       'a multi-cell row starting with a hash is still a row');
  }

  /* A single line of space-separated values, which is what a student who
     pasted a row instead of a column produces. */
  p = IA.parseTable('3.1 4.1 5.9 2.6');
  ok(p.cols.length === 4, 'one row of four values reads as four columns', String(p.cols.length));
}

/* ══════════════════════════════════════════════════════════════════════
   8.  SUMMARY STATISTICS
   ══════════════════════════════════════════════════════════════════════ */
section('8. summarize');
{
  const s = IA.summarize([2, 4, 4, 4, 5, 5, 7, 9]);
  close(s.mean, 5, 1e-15, 'mean of the textbook eight-point sample');
  close(s.sd, Math.sqrt(32 / 7), 1e-14, 'sample standard deviation uses n-1');
  close(s.med, 4.5, 1e-15, 'median of an even-length sample');
  ok(s.min === 2 && s.max === 9, 'min and max');
  ok(s.nUnique === 5, 'distinct-value count', String(s.nUnique));
  ok(IA.summarize([1, 2, 3]).allInt === true && IA.summarize([1, 2.5]).allInt === false,
     'whole-number detection');
  close(IA.summarize([1, 2, 3, 4, 5]).skew, 0, 1e-14, 'symmetric sample has zero skewness');
}

/* ══════════════════════════════════════════════════════════════════════
   9.  THE EXPONENTIAL AND ITS LOCATION SHIFT, IN DETAIL
   ══════════════════════════════════════════════════════════════════════
   Each distribution is sampled at a known parameter value with a fixed
   seed, refitted, and the estimate is required to land within a few
   standard errors of the truth.  The tolerance is stated as a multiple of
   the asymptotic standard error, not as a bare number, so the test says
   something about the estimator rather than about one lucky sample. */
section('9. The exponential and its location shift, in detail');
{
  const N = 200000;

  /* Exponential: beta-hat = x-bar, SE = beta / sqrt(n) */
  {
    const u = IA.MRG32k3a(20260818), beta = 5.25, x = [];
    for (let i = 0; i < N; i++) x.push(IA.DISTS.expo.sample(u, [beta]));
    const f = IA.fitDist(IA.DISTS.expo, x, false);
    const se = beta / Math.sqrt(N);
    ok(f.ok && Math.abs(f.p[0] - beta) < 4 * se,
      `exponential beta: fitted ${f.p[0].toFixed(5)} vs true ${beta} (4 SE = ${(4 * se).toFixed(5)})`);
    /* The closed form really is the sample mean */
    const xbar = x.reduce((a, b) => a + b, 0) / N;
    close(f.p[0], xbar, 1e-14, 'exponential MLE equals the sample mean exactly');
    /* And the reported log-likelihood matches a direct evaluation */
    close(f.ll, IA.DISTS.expo.loglik(x, f.p), 1e-14, 'reported log-likelihood is reproducible');
    /* AIC / BIC bookkeeping */
    const ic = IA.infoCriteria(f.ll, f.k, N);
    close(ic.aic, 2 * 1 - 2 * f.ll, 1e-14, 'AIC = 2k - 2 logL');
    close(ic.bic, Math.log(N) - 2 * f.ll, 1e-14, 'BIC = k ln n - 2 logL');
  }

  /* Shifted exponential: gamma + Expo(beta).  The MLE of the threshold is
     the sample minimum, whose bias is beta/n -- so the recovery test on
     gamma is a bias test, and it must land within a few beta/n of truth. */
  {
    const u = IA.MRG32k3a(4242), gam = 2.75, beta = 1.4, x = [];
    for (let i = 0; i < N; i++) x.push(gam + IA.DISTS.expo.sample(u, [beta]));
    const f = IA.fitDist(IA.DISTS.expo, x, true);
    const bias = beta / N;
    ok(f.ok, 'shifted exponential fit succeeded');
    /* gamma-hat = x_(1), and x_(1) - gamma is Exponential(beta/n), so the
       gap is beta/n on average and exceeds 10 beta/n with probability e^-10. */
    ok(f.shift >= gam && f.shift - gam < 12 * bias,
      `shifted exponential gamma: fitted ${f.shift.toFixed(8)} vs true ${gam} ` +
      `(gap ${(f.shift - gam).toExponential(2)}, expected ~${bias.toExponential(2)})`);
    ok(f.atBound === true && f.degenerate === false,
      'the shifted exponential is flagged as a boundary estimate, not a degenerate one');
    ok(Math.abs(f.p[0] - beta) < 4 * beta / Math.sqrt(N) + bias,
      `shifted exponential beta: fitted ${f.p[0].toFixed(5)} vs true ${beta}`);
    ok(f.k === 2, 'the shift is counted as an estimated parameter');
    /* The shifted fit must never score worse than the unshifted one on the
       same data: adding a parameter cannot lower the maximized likelihood. */
    const f0 = IA.fitDist(IA.DISTS.expo, x, false);
    ok(f.ll >= f0.ll - 1e-9,
      `shifted log-likelihood ${f.ll.toFixed(3)} >= unshifted ${f0.ll.toFixed(3)}`);
  }

  /* On data that genuinely has no shift, the profile search must not run
     away: gamma should come back near zero and the two fits should score
     almost the same. */
  {
    const u = IA.MRG32k3a(31337), beta = 3, x = [];
    for (let i = 0; i < 20000; i++) x.push(IA.DISTS.expo.sample(u, [beta]));
    const f1 = IA.fitDist(IA.DISTS.expo, x, true);
    const f0 = IA.fitDist(IA.DISTS.expo, x, false);
    ok(Math.abs(f1.shift) < 0.01,
      `unshifted data: fitted gamma ${f1.shift.toExponential(2)} stays near zero`);
    /* The shifted family contains the unshifted one here, so the extra
       parameter cannot LOWER the maximized likelihood -- and on data with
       no real shift it should not raise it by much either. */
    ok(f1.ll - f0.ll > -1e-6 && f1.ll - f0.ll < 5,
      `unshifted data: the extra parameter buys almost nothing (delta logL = ${(f1.ll - f0.ll).toFixed(3)})`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   10.  EXPONENTIAL QUANTILE / CDF, TO THE LAST DIGIT
   ══════════════════════════════════════════════════════════════════════ */
section('10. exponential cdf and quantile, to the last digit');
{
  const d = IA.DISTS.expo, p = [2.5];
  for (const q of [1e-6, 0.01, 0.25, 0.5, 0.9, 0.999, 1 - 1e-9]) {
    close(d.cdf(d.quantile(q, p), p), q, 1e-11, `expo: F(F^-1(${q})) = ${q}`);
  }
  /* pdf integrates to the cdf (midpoint rule, fine grid) */
  let acc = 0;
  const h = 1e-3;
  for (let t = h / 2; t < 12; t += h) acc += d.pdf(t, p) * h;
  close(acc, d.cdf(12, p), 1e-6, 'expo: numerical integral of the pdf matches the cdf');
  /* Plotting positions */
  const pp = IA.plottingPositions(4);
  ok(pp.join(',') === '0.125,0.375,0.625,0.875', 'plotting positions are (i-0.5)/n', pp.join(','));
}

/* ══════════════════════════════════════════════════════════════════════
   11.  MLE RECOVERY FOR EVERY SUPPORTED DISTRIBUTION
   ══════════════════════════════════════════════════════════════════════
   Each distribution is sampled at known parameter values with a fixed
   seed, refitted, and every estimate is required to land within a stated
   tolerance.  Where an asymptotic standard error is easy to state the
   tolerance is a multiple of it; otherwise it is a relative tolerance
   chosen to be comfortably tighter than the estimator's own spread at
   this n, so a real regression shows up rather than being absorbed.
   ══════════════════════════════════════════════════════════════════════ */
section('11. MLE recovery, every distribution');
{
  const N = 30000;
  /* [key, true parameters, per-parameter relative tolerance, seed] */
  const CASES = [
    ['gamma',           [2.60, 1.55],        [0.06, 0.06],       101],
    ['weibull',         [4.20, 1.80],        [0.04, 0.05],       102],
    ['lognormal',       [1.15, 0.62],        [0.03, 0.04],       103],
    ['normal',          [12.5, 3.10],        [0.02, 0.03],       104],
    ['uniform',         [2.00, 9.00],        [0.01, 0.01],       105],
    ['triangular',      [1.00, 6.00, 10.0],  [0.10, 0.06, 0.05], 106],
    ['poisson',         [4.30],              [0.03],             107],
    ['geometric',       [0.28],              [0.03],             108],
    ['discreteUniform', [3, 11],             [0.001, 0.001],     109]
  ];
  for (const [key, truth, tol, seed] of CASES) {
    const d = IA.DISTS[key];
    const u = IA.MRG32k3a(seed);
    const x = [];
    for (let i = 0; i < N; i++) x.push(d.sample(u, truth));
    const f = IA.fitDist(d, x, false, false);
    if (!f.ok) { ok(false, `${key}: fit succeeded`, f.msg); continue; }
    let good = true;
    const parts = [];
    for (let j = 0; j < truth.length; j++) {
      const err = Math.abs(f.p[j] - truth[j]) / Math.abs(truth[j]);
      parts.push(`${d.params[j].sym}=${f.p[j].toPrecision(5)} (true ${truth[j]}, err ${(100*err).toFixed(2)}%)`);
      if (!(err <= tol[j])) good = false;
    }
    ok(good, `${key}: ${parts.join(', ')}`);
  }

  /* Erlang: the shape is constrained to a whole number, so the test is
     that it recovers the RIGHT whole number, not a nearby real one. */
  {
    const u = IA.MRG32k3a(110), truth = [4, 1.7], x = [];
    for (let i = 0; i < N; i++) x.push(IA.DISTS.erlang.sample(u, truth));
    const f = IA.fitDist(IA.DISTS.erlang, x, false, false);
    ok(f.ok && f.p[0] === 4, `erlang: recovered the integer shape k = ${f.ok ? f.p[0] : '?'} (true 4)`);
    ok(f.ok && Math.abs(f.p[1] - 1.7) / 1.7 < 0.04,
       `erlang: scale ${f.ok ? f.p[1].toPrecision(5) : '?'} (true 1.7)`);
    ok(Number.isInteger(f.p[0]), 'erlang: the fitted shape really is a whole number');
  }

  /* Beta.  Its interval is READ OFF the data rather than estimated, and
     that convention -- not the solver -- is what limits how well the true
     shapes come back: for shapes above 1 the density vanishes at the ends,
     so no finite sample reaches them, the fitted interval is narrower than
     the true one, and the shapes absorb the difference.  The page says so
     in as many words.  So the solver is checked against the equations it
     is supposed to solve, and the recovery is checked only loosely. */
  {
    const u = IA.MRG32k3a(111), truth = [2.2, 5.4, 0, 1], x = [];
    for (let i = 0; i < N; i++) x.push(IA.DISTS.beta.sample(u, truth));
    const f = IA.fitDist(IA.DISTS.beta, x, false, false);
    ok(f.ok, 'beta: fit succeeded');
    const [a, b, L, U] = f.p;
    /* The two likelihood equations, at the fitted values, on the page's
       own rescaling:  psi(a) - psi(a+b) = mean(ln y). */
    let ml = 0, m1 = 0;
    for (const v of x) { const y = (v - L) / (U - L); ml += Math.log(y); m1 += Math.log(1 - y); }
    ml /= x.length; m1 /= x.length;
    close(IA.digamma(a) - IA.digamma(a + b), ml, 1e-9, 'beta: first likelihood equation is solved');
    close(IA.digamma(b) - IA.digamma(a + b), m1, 1e-9, 'beta: second likelihood equation is solved');
    ok(L < Math.min.apply(null, x) && U > Math.max.apply(null, x),
       'beta: the fitted interval strictly contains the sampled data');
    ok(Math.abs(a - 2.2) / 2.2 < 0.2 && Math.abs(b - 5.4) / 5.4 < 0.25,
       `beta: shapes ${a.toPrecision(4)}, ${b.toPrecision(4)} are in the right neighbourhood of ` +
       `2.2, 5.4 (the data-range convention biases them; see the note the page shows)`);
    /* And the fit must actually describe the data, which is the claim that
       matters even when the shapes are displaced. */
    const xs = x.slice().sort((p2, q) => p2 - q);
    const D = IA.ksStat(xs, IA.fitCdf(f), IA.fitAtom(f)).D;
    ok(D < 0.02, `beta: the fitted curve tracks the data, D = ${D.toFixed(5)}`);
  }

  /* The triangular endpoints must sit strictly outside the data, or the
     extreme observations get zero density and the likelihood collapses. */
  {
    const u = IA.MRG32k3a(112), x = [];
    for (let i = 0; i < 4000; i++) x.push(IA.DISTS.triangular.sample(u, [2, 3, 9]));
    const f = IA.fitDist(IA.DISTS.triangular, x, false, false);
    const lo = Math.min.apply(null, x), hi = Math.max.apply(null, x);
    ok(f.ok && f.p[0] < lo && f.p[2] > hi,
       'triangular: fitted endpoints lie strictly outside the observed range');
    ok(f.ok && Number.isFinite(f.ll), 'triangular: the log-likelihood is finite');
  }

  /* Every candidate must produce a finite log-likelihood on data it
     accepted, and its own fit must beat a perturbed one -- a cheap but
     surprisingly effective check that a fit really is a maximum. */
  {
    const u = IA.MRG32k3a(113), x = [];
    for (let i = 0; i < 2000; i++) x.push(IA.DISTS.gamma.sample(u, [2, 2]));
    for (const key of IA.CONTINUOUS_KEYS) {
      const d = IA.DISTS[key];
      const f = IA.fitDist(d, x, false, false);
      if (!f.ok) { ok(false, `${key}: fits the gamma sample`, f.msg); continue; }
      if (d.noCriteria) { ok(Number.isFinite(f.ll), `${key}: finite log-likelihood`); continue; }
      let beaten = false;
      /* Only the parameters the fit actually maximized over: the beta's
         interval is read off the data, so moving it is not a competing
         maximum-likelihood claim. */
      const nML = d.mlCount === undefined ? f.p.length : d.mlCount;
      for (let j = 0; j < nML; j++) {
        for (const bump of [0.97, 1.03]) {
          const q = f.p.slice();
          if (!Number.isFinite(q[j])) continue;
          q[j] = q[j] * bump;
          if (d.loglik(x, q) > f.ll + 1e-6) beaten = true;
        }
      }
      ok(!beaten, `${key}: no 3% nudge of any fitted parameter beats the reported fit`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   12.  CDF / QUANTILE / PDF CONSISTENCY, EVERY DISTRIBUTION
   ══════════════════════════════════════════════════════════════════════ */
section('12. cdf / quantile / pdf consistency, every distribution');
{
  const PS = {
    expo: [3.2], gamma: [2.4, 1.3], erlang: [3, 1.1], weibull: [4.0, 1.7],
    lognormal: [0.8, 0.55], normal: [10, 2.5], uniform: [1, 7],
    triangular: [1, 4, 9], beta: [2.0, 3.5, 0.5, 6.5],
    poisson: [4.2], geometric: [0.3], discreteUniform: [2, 9]
  };
  for (const key of Object.keys(PS)) {
    const d = IA.DISTS[key], p = PS[key];
    let worst = 0, worstU = null;
    for (const q of [1e-5, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.99999]) {
      const x = d.quantile(q, p);
      if (d.kind === 'discrete') {
        /* For a step CDF the inverse must satisfy F(x) >= q > F(x-1). */
        const okStep = d.cdf(x, p) >= q - 1e-12 && (x <= d.lo(p) || d.cdf(x - 1, p) < q + 1e-12);
        if (!okStep) { worst = 1; worstU = q; }
      } else {
        const e = Math.abs(d.cdf(x, p) - q) / q;
        if (e > worst) { worst = e; worstU = q; }
      }
    }
    ok(worst < (d.kind === 'discrete' ? 0.5 : 1e-8),
       `${key}: F(F^-1(u)) = u across the range (worst ${worst.toExponential(2)} at u = ${worstU})`);

    /* The pdf must integrate to the cdf.  For a discrete distribution the
       pmf must instead SUM to it. */
    if (d.kind === 'discrete') {
      let acc = 0;
      const top = Math.ceil(d.quantile(0.999999, p));
      for (let kk = Math.max(0, Math.floor(d.lo(p))); kk <= top; kk++) acc += d.pdf(kk, p);
      close(acc, d.cdf(top, p), 1e-10, `${key}: the pmf sums to the cdf`);
    } else {
      const a = d.quantile(1e-6, p), b = d.quantile(0.999, p);
      const M = 20000, h = (b - a) / M;
      let acc = 0;
      for (let m = 0; m < M; m++) acc += d.pdf(a + (m + 0.5) * h, p) * h;
      close(acc, d.cdf(b, p) - d.cdf(a, p), 2e-4, `${key}: the pdf integrates to the cdf`);
    }
    /* The cdf must be monotone. */
    let mono = true, prev = -1;
    for (let t = 0; t <= 60; t++) {
      const x = d.quantile(t / 60.5 + 1e-6, p), F = d.cdf(x, p);
      if (F < prev - 1e-12) mono = false;
      prev = F;
    }
    ok(mono, `${key}: the cdf is monotone`);
  }
  const pp = IA.plottingPositions(4);
  ok(pp.join(',') === '0.125,0.375,0.625,0.875', 'plotting positions are (i-0.5)/n', pp.join(','));
}

/* ══════════════════════════════════════════════════════════════════════
   13.  SAMPLERS AGREE WITH THEIR OWN DISTRIBUTIONS
   ══════════════════════════════════════════════════════════════════════
   A sampler that quietly disagrees with its own cdf would corrupt every
   bootstrap p-value on the page while leaving the fits looking correct,
   so each one is checked against its cdf by a Kolmogorov-Smirnov test
   with the parameters FIXED -- where the textbook critical value is the
   right one to use, because nothing was estimated.
   ══════════════════════════════════════════════════════════════════════ */
section('13. samplers match their own cdf');
{
  const PS = {
    expo: [2.5], gamma: [3.1, 0.8], erlang: [4, 1.2], weibull: [2.2, 1.6],
    lognormal: [0.4, 0.7], normal: [5, 1.5], uniform: [2, 6],
    triangular: [0, 3, 8], beta: [1.7, 2.9, 1, 5],
    poisson: [3.7], geometric: [0.22], discreteUniform: [1, 6]
  };
  const M = 20000;
  for (const key of Object.keys(PS)) {
    const d = IA.DISTS[key], p = PS[key];
    const u = IA.MRG32k3a(500 + key.length * 7);
    const y = [];
    for (let i = 0; i < M; i++) y.push(d.sample(u, p));
    y.sort((a, b) => a - b);
    const fixed = { dist: d, p: p, shift: 0, k: d.np };
    const D = IA.ksStat(y, IA.fitCdf(fixed), IA.fitAtom(fixed)).D;
    /* Parameters were NOT estimated here, so the published asymptotic
       critical value genuinely applies. 1.63/sqrt(n) is the 1% point. */
    const crit = 1.63 / Math.sqrt(M);
    ok(D < crit, `${key}: D = ${D.toFixed(5)} < ${crit.toFixed(5)} (1% point, parameters fixed)`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   14.  BINS, CHI-SQUARE, AND SQUARE ERROR
   ══════════════════════════════════════════════════════════════════════ */
section('14. binning and the chi-square test');
{
  const u = IA.MRG32k3a(700), x = [];
  for (let i = 0; i < 3000; i++) x.push(IA.DISTS.gamma.sample(u, [2.5, 1.4]));
  const f = IA.fitDist(IA.DISTS.gamma, x, false, false);
  for (const k of [5, 10, 25]) {
    const b = IA.makeBins(x, k);
    const tot = b.counts.reduce((a, c) => a + c, 0);
    ok(tot === x.length, `bins(${k}): every observation lands in exactly one bin`);
    const pr = IA.binProbabilities(f, b.edges);
    close(pr.reduce((a, c) => a + c, 0), 1, 1e-9,
      `bins(${k}): the bin probabilities sum to 1 (the tails are closed)`);
    const chi = IA.chiSquareGOF(x, f, b);
    /* Degrees of freedom follow the pooled GROUPS, not the displayed bins. */
    ok(chi.df === chi.nGroups - 1 - f.k, `bins(${k}): df = groups - 1 - parameters`);
    ok(chi.p > 0.001, `bins(${k}): a correct gamma fit is not rejected (p = ${chi.p.toFixed(4)})`);
    /* The floor is the whole point of pooling, so it is asserted. */
    const low = chi.groups.filter(g => g.exp < chi.minExpected).length;
    ok(low === 0, `bins(${k}): every one of the ${chi.nGroups} pooled groups expects at least ` +
       `${chi.minExpected} (${chi.pooled} bins merged away)`);
    /* Pooling must not lose or invent observations. */
    ok(chi.groups.reduce((a, g) => a + g.obs, 0) === x.length,
       `bins(${k}): pooling conserves the observed counts`);
    close(chi.groups.reduce((a, g) => a + g.exp, 0), x.length, 1e-9,
       `bins(${k}): pooling conserves the expected counts`);
    /* Groups must be contiguous and cover every bin exactly once. */
    let covered = true, next = 0;
    for (const g of chi.groups) { if (g.from !== next) covered = false; next = g.to + 1; }
    ok(covered && next === b.k, `bins(${k}): the groups tile the bins with no gap or overlap`);
  }

  /* A bin count far beyond what the data can support must still produce a
     valid test rather than a shower of empty cells. */
  {
    const b = IA.makeBins(x, 40);
    const chi = IA.chiSquareGOF(x, f, b);
    ok(chi.groups.every(g => g.exp >= chi.minExpected),
       `40 bins pool down to ${chi.nGroups} groups, all at or above ${chi.minExpected}`);
    ok(chi.nGroups < 40, 'and that really is fewer groups than bins');
  }
  /* A sample too small for any valid grouping must say so rather than
     report a p-value nobody should use. */
  {
    const tiny = x.slice(0, 12);
    const ft = IA.fitDist(IA.DISTS.gamma, tiny, false, false);
    const chi = IA.chiSquareGOF(tiny, ft, IA.makeBins(tiny, 10));
    ok(chi.nGroups <= 3, `n = 12 pools all the way down to ${chi.nGroups} groups`);
    ok(chi.df < 1 || chi.groups.every(g => g.exp >= chi.minExpected),
       'and either reports too few degrees of freedom or meets the floor');
  }
  /* poolBins on hand-checkable input. */
  {
    const counts = [1, 1, 20, 1, 1], probs = [0.02, 0.02, 0.9, 0.03, 0.03], n = 100;
    const g = IA.poolBins(counts, probs, n, 5);
    ok(g.length === 2, `hand case: five bins pool into ${g.length} groups`, JSON.stringify(g));
    ok(g[0].from === 0 && g[0].to === 2 && g[0].obs === 22, 'first group is bins 0-2');
    close(g[0].exp, 94, 1e-12, 'first group expects 94');
    ok(g[1].from === 3 && g[1].to === 4 && g[1].obs === 2, 'second group is bins 3-4');
    close(g[1].exp, 6, 1e-12, 'second group expects 6');
  }
  {
    /* A trailing group left short must be merged backwards, not left alone. */
    const g = IA.poolBins([10, 10, 1], [0.5, 0.48, 0.02], 100, 5);
    ok(g.length === 2 && g[1].to === 2 && g[1].obs === 11,
       'a short tail group is merged into its neighbour', JSON.stringify(g));
    ok(g.every(q => q.exp >= 5), 'and every surviving group clears the floor');
  }

  /* Integer data must get bins on the half-integers, so no count sits on
     an edge -- the bug that made a perfect Poisson fit fail chi-square. */
  const ui = IA.MRG32k3a(701), xi = [];
  for (let i = 0; i < 4000; i++) xi.push(IA.DISTS.poisson.sample(ui, [3.6]));
  const bi = IA.makeBins(xi, 10);
  ok(bi.integer === true, 'count data is detected and binned on the half-integers');
  let onEdge = false;
  for (const e of bi.edges) if (Number.isInteger(e)) onEdge = true;
  ok(!onEdge, 'no bin edge falls on a whole number');
  const fi = IA.fitDist(IA.DISTS.poisson, xi, false, false);
  const chii = IA.chiSquareGOF(xi, fi, bi);
  ok(chii.p > 0.01, `a correct Poisson fit is not rejected (p = ${chii.p.toFixed(4)})`);
  ok(chii.groups.every(g => g.exp >= chii.minExpected),
     'the pooled groups clear the expected-count floor on count data too');
  close(IA.binProbabilities(fi, bi.edges).reduce((a, c) => a + c, 0), 1, 1e-9,
    'discrete bin probabilities sum to 1');

  /* The point the UI makes in words, asserted here in code: square error
     is a function of the binning, and the log-likelihood is not. */
  const sq = [], lls = [];
  for (const k of [6, 11, 19, 31]) {
    sq.push(IA.squareError(x, f, IA.makeBins(x, k)));
    lls.push(f.ll);
  }
  ok(new Set(sq.map(v => v.toPrecision(6))).size === sq.length,
     'square error changes with every bin count: ' + sq.map(v => v.toExponential(2)).join(', '));
  ok(new Set(lls).size === 1, 'the log-likelihood does not depend on the binning');
}

/* ══════════════════════════════════════════════════════════════════════
   15.  KOLMOGOROV-SMIRNOV AND ANDERSON-DARLING
   ══════════════════════════════════════════════════════════════════════ */
section('15. K-S and A-D statistics');
{
  /* Against a uniform on [0,1] with the sample {0.1, ..., 0.9}: the
     empirical function steps to i/9 at x = i/10, and F(i/10) = i/10, so
     the gap above the step is i/9 - i/10 = i/90, largest at i = 9, and
     the gap below it is i/10 - (i-1)/9 = (10-i)/90, largest at i = 1.
     Both come to 9/90 = 0.1. */
  const x9 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const unif = { dist: IA.DISTS.uniform, p: [0, 1], shift: 0, k: 2 };
  const D9 = IA.ksStat(x9, IA.fitCdf(unif), IA.fitAtom(unif)).D;
  close(D9, 0.1, 1e-12, 'D for a hand-worked nine-point sample');

  /* A perfectly regular sample at the (i-0.5)/n points minimizes D at
     1/(2n), which is a second value that can be checked without a table. */
  const n = 50, xr = [];
  for (let i = 0; i < n; i++) xr.push((i + 0.5) / n);
  close(IA.ksStat(xr, IA.fitCdf(unif), IA.fitAtom(unif)).D, 1 / (2 * n), 1e-12,
    'D is 1/(2n) for a perfectly regular sample');
  /* And A-squared is at its floor there too; the published minimum for
     the (i-0.5)/n configuration follows from the definition. */
  let sA = 0;
  for (let i = 0; i < n; i++)
    sA += (2 * (i + 1) - 1) * (Math.log(xr[i]) + Math.log(1 - xr[n - 1 - i]));
  close(IA.adStat(xr, IA.fitCdf(unif)), -n - sA / n, 1e-12, 'A-squared matches its own definition');

  /* Ties must not inflate D.  Rounding a sample changes D a little, but
     an implementation that walked tied values one at a time would inflate
     it by roughly the weight of the largest tied run. */
  const u = IA.MRG32k3a(800), raw = [];
  for (let i = 0; i < 2000; i++) raw.push(IA.DISTS.expo.sample(u, [1]));
  const rounded = raw.map(v => Math.round(v * 10) / 10).sort((a, b) => a - b);
  const ef = { dist: IA.DISTS.expo, p: [1], shift: 0, k: 1 };
  const Dr = IA.ksStat(rounded, IA.fitCdf(ef), IA.fitAtom(ef)).D;
  const su = IA.summarize(rounded);
  ok(Dr < 0.06, `rounded data (${su.nUnique} distinct of ${su.n}): D = ${Dr.toFixed(5)} stays small`);

  /* For a discrete fit the comparison just below an atom must use the cdf
     just below it.  Without that correction D is roughly the largest
     single-point probability -- about 0.2 for this Poisson -- whatever
     the fit is doing. */
  const up = IA.MRG32k3a(801), xp = [];
  for (let i = 0; i < 3000; i++) xp.push(IA.DISTS.poisson.sample(up, [3.4]));
  xp.sort((a, b) => a - b);
  const pf = { dist: IA.DISTS.poisson, p: [3.4], shift: 0, k: 1 };
  const Dp = IA.ksStat(xp, IA.fitCdf(pf), IA.fitAtom(pf)).D;
  const Dnaive = IA.ksStat(xp, IA.fitCdf(pf), null).D;
  ok(Dp < 0.03, `Poisson, atom-aware: D = ${Dp.toFixed(5)}`);
  ok(Dnaive > 0.15,
     `and the naive version really would have reported D = ${Dnaive.toFixed(5)} on the same perfect fit`);
}

/* ══════════════════════════════════════════════════════════════════════
   15b.  THE CLASSICAL P-VALUES, FOR A FULLY SPECIFIED NULL
   ══════════════════════════════════════════════════════════════════════
   These are the p-values the page prints in its "from the table" column.
   Two things have to be true of them: they must reproduce the published
   tables they stand in for, and -- the point the page makes in words --
   they must be correctly calibrated when nothing was estimated and
   badly calibrated when something was.
   ══════════════════════════════════════════════════════════════════════ */
section('15b. classical K-S and A-D p-values');
{
  /* Feeding the published 5% critical value back in must return 0.05. */
  for (const n of [10, 30, 60, 200, 1000]) {
    close(IA.ksPvalueClassical(IA.ksTableCritical(n), n), 0.05, 2e-3,
      `K-S: the published 5% critical value at n = ${n} returns p = 0.05`);
  }
  /* And the A-D percentage points of D'Agostino & Stephens (1986) Table 4.2. */
  for (const alpha of Object.keys(IA.AD_TABLE)) {
    const z = IA.AD_TABLE[alpha];
    close(IA.adPvalueClassical(z, 1000), Number(alpha), 3e-2,
      `A-D: the published ${alpha} point A^2 = ${z} returns p = ${alpha}`);
  }
  /* Monotone and bounded. */
  let mono = true, prev = 2;
  for (let d = 0.01; d < 0.9; d += 0.01) {
    const q = IA.ksPvalueClassical(d, 100);
    if (q > prev + 1e-12 || q < 0 || q > 1) mono = false;
    prev = q;
  }
  ok(mono, 'K-S p-value decreases monotonically in D and stays inside [0,1]');
  mono = true; prev = 2;
  for (let z = 0.1; z < 12; z += 0.1) {
    const q = IA.adPvalueClassical(z, 100);
    if (q > prev + 1e-9 || q < 0 || q > 1) mono = false;
    prev = q;
  }
  ok(mono, 'A-D p-value decreases monotonically in A^2 and stays inside [0,1]');

  /* Calibration, which is what the page's explanation actually claims.
     With the parameters FIXED in advance, both p-values must be uniform,
     so each should fall below 0.05 about 5% of the time. */
  {
    const R = 3000, n = 40, truth = [2.4, 1.3];
    const fixed = { dist: IA.DISTS.gamma, p: truth, shift: 0, k: 2 };
    const F = IA.fitCdf(fixed), atom = IA.fitAtom(fixed);
    let rejD = 0, rejA = 0;
    for (let rep = 0; rep < R; rep++) {
      const u = IA.MRG32k3a(310000 + rep);
      const x = [];
      for (let i = 0; i < n; i++) x.push(IA.DISTS.gamma.sample(u, truth));
      x.sort((a, b) => a - b);
      if (IA.ksPvalueClassical(IA.ksStat(x, F, atom).D, n) < 0.05) rejD++;
      if (IA.adPvalueClassical(IA.adStat(x, F), n) < 0.05) rejA++;
    }
    const se = Math.sqrt(0.05 * 0.95 / R), band = 4 * se;
    ok(Math.abs(rejD / R - 0.05) < band,
      `K-S table p-value, parameters FIXED: rejects ${(100 * rejD / R).toFixed(2)}% (nominal 5%, +/-${(100 * band).toFixed(2)}%)`);
    ok(Math.abs(rejA / R - 0.05) < band,
      `A-D table p-value, parameters FIXED: rejects ${(100 * rejA / R).toFixed(2)}% (nominal 5%, +/-${(100 * band).toFixed(2)}%)`);
  }

  /* Now the same measurement with the parameters ESTIMATED from each
     sample, which is what the page's readers will actually be doing.
     The claim is that the table p-value is then far too LARGE -- the test
     is too permissive, not too strict.  This is the assertion the whole
     "why your textbook table does not apply" note rests on, so it is
     stated as a bound in the direction the note claims. */
  {
    const R = 1500, n = 40;
    let rejD = 0, rejA = 0, used = 0;
    for (let rep = 0; rep < R; rep++) {
      const u = IA.MRG32k3a(320000 + rep);
      const x = [];
      for (let i = 0; i < n; i++) x.push(IA.DISTS.gamma.sample(u, [2.4, 1.3]));
      x.sort((a, b) => a - b);
      const f = IA.fitDist(IA.DISTS.gamma, x, false, false);
      if (!f.ok) continue;
      used++;
      const F2 = IA.fitCdf(f);
      if (IA.ksPvalueClassical(IA.ksStat(x, F2, IA.fitAtom(f)).D, n) < 0.05) rejD++;
      if (IA.adPvalueClassical(IA.adStat(x, F2), n) < 0.05) rejA++;
    }
    const rD = rejD / used, rA = rejA / used;
    ok(rD < 0.01,
      `K-S table p-value, parameters ESTIMATED: rejects only ${(100 * rD).toFixed(2)}% where 5% is nominal ` +
      `-- too permissive, exactly as the page says`);
    ok(rA < 0.02,
      `A-D table p-value, parameters ESTIMATED: rejects only ${(100 * rA).toFixed(2)}% where 5% is nominal`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   15c.  THE DATA GENERATOR
   ══════════════════════════════════════════════════════════════════════ */
section('15c. generating data from typed parameters');
{
  /* Every offered distribution must generate, and the fit must find its
     way back to the parameters that produced the sample. */
  const N = 20000;
  for (const key of IA.GEN_KEYS) {
    const spec = IA.GEN_SPEC[key], p = spec.map(q => q.def);
    const g = IA.generateSample(key, p, 0, N, 777, null);
    if (!g.ok) { ok(false, `${key}: generates`, g.msg); continue; }
    /* The generate-only members have no fit to recover anything with;
       section 15d checks them on their own terms. */
    if (IA.DISTS[key].generateOnly) {
      ok(g.values.length === N, `${key}: generates ${N} values (generate-only, so nothing to refit)`);
      continue;
    }
    const f = IA.fitDist(IA.DISTS[key], g.values, false, false);
    if (!f.ok) { ok(false, `${key}: the generated sample refits`, f.msg); continue; }
    /* Endpoint parameters of the beta are not estimated, so only the
       parameters the fit owns are compared. */
    const nML = IA.DISTS[key].mlCount === undefined ? p.length : IA.DISTS[key].mlCount;
    let worst = 0;
    for (let j = 0; j < nML; j++) {
      const denom = Math.abs(p[j]) > 1e-9 ? Math.abs(p[j]) : 1;
      worst = Math.max(worst, Math.abs(f.p[j] - p[j]) / denom);
    }
    /* The beta gets a wider band, and the reason is the convention rather
       than the solver: its interval is read off the data range, which for
       shapes above 1 is narrower than the true support, and the shapes
       absorb the difference.  Section 11 checks the solver itself against
       the likelihood equations it is supposed to satisfy; what matters
       here is that the fitted curve still describes the sample. */
    const tol = key === 'beta' ? 0.25 : 0.12;
    ok(worst < tol, `${key}: generate then refit recovers the parameters (worst ${(100 * worst).toFixed(2)}%, band ${(100 * tol).toFixed(0)}%)`);
    if (key === 'beta') {
      const xs = g.values.slice().sort((a, b) => a - b);
      const D = IA.ksStat(xs, IA.fitCdf(f), IA.fitAtom(f)).D;
      ok(D < 0.02, `beta: and the fitted curve still tracks the sample, D = ${D.toFixed(5)}`);
    }
  }

  /* The shift must survive the round trip too. */
  {
    const g = IA.generateSample('weibull', [3, 1.6], 2.5, 40000, 4242, null);
    const f = IA.fitDist(IA.DISTS.weibull, g.values, true, false);
    ok(f.ok && Math.abs(f.shift - 2.5) < 0.05,
      `shifted generation: gamma-hat = ${f.ok ? f.shift.toFixed(4) : '?'} against a true 2.5`);
    ok(f.ok && Math.abs(f.p[1] - 1.6) / 1.6 < 0.08,
      `shifted generation: shape ${f.ok ? f.p[1].toFixed(4) : '?'} against a true 1.6`);
  }

  /* Reproducibility from the seed, which is what the seed box promises. */
  {
    const a = IA.generateSample('gamma', [2, 1.5], 0, 500, 99, 2);
    const b = IA.generateSample('gamma', [2, 1.5], 0, 500, 99, 2);
    const c = IA.generateSample('gamma', [2, 1.5], 0, 500, 100, 2);
    ok(a.values.join(',') === b.values.join(','), 'the same seed generates the same sample');
    ok(a.values.join(',') !== c.values.join(','), 'a different seed generates a different sample');
  }

  /* Rounding must actually round, and must create the ties the page warns
     about. */
  {
    const full = IA.generateSample('gamma', [2, 1.5], 0, 2000, 9, null);
    const one = IA.generateSample('gamma', [2, 1.5], 0, 2000, 9, 1);
    const uf = IA.summarize(full.values).nUnique, uo = IA.summarize(one.values).nUnique;
    ok(uf === 2000, `full precision leaves ${uf} distinct values in 2000`);
    ok(uo < 200, `rounding to one decimal leaves only ${uo} distinct values`);
    ok(one.values.every(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9),
      'every rounded value really has one decimal place');
  }

  /* Validation must catch what the fits cannot survive. */
  const bad = [
    ['uniform', [10, 2], 'b must be greater than a'],
    ['triangular', [5, 1, 10], 'm must be greater than a'],
    ['erlang', [2.5, 1], 'k must be a whole number'],
    ['geometric', [1.4], 'p must be at most 1'],
    ['gamma', [-1, 2], 'a negative shape is refused'],
    ['normal', [0, 0], 'a zero standard deviation is refused'],
    ['poisson', [1e7], 'a Poisson mean beyond the accurate range is refused']
  ];
  for (const [key, p, why] of bad) {
    ok(IA.validateGenParams(key, p) !== null, `rejected: ${why}`, 'validator returned null');
  }
  ok(IA.validateGenParams('gamma', [2, 1.5]) === null, 'and sensible parameters are accepted');
  ok(!IA.generateSample('gamma', [2, 1.5], 0, 1, 5, null).ok, 'a sample size of 1 is refused');

  /* Every generatable distribution has a spec entry, and vice versa. */
  ok(IA.GEN_KEYS.every(k => IA.GEN_SPEC[k] && IA.DISTS[k]),
     'every generatable key has both a spec and a distribution');
  ok(Object.keys(IA.GEN_SPEC).length === IA.GEN_KEYS.length,
     'the spec table and the offered list agree');
  for (const k of IA.GEN_KEYS) {
    ok(IA.GEN_SPEC[k].length === IA.DISTS[k].params.length,
       `${k}: the generator asks for exactly the parameters the fit reports`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   15d.  THE JOHNSON SYSTEM
   ══════════════════════════════════════════════════════════════════════
   Generate-only by design: it exists so that a reader can make data that
   no fitting candidate can match exactly.  What has to be true is that it
   generates correctly, that its closed forms agree with each other, and
   that it stays off the fitting menu.
   ══════════════════════════════════════════════════════════════════════ */
section('15d. Johnson S_B and S_U');
{
  for (const key of ['johnsonSB', 'johnsonSU']) {
    const d = IA.DISTS[key], p = IA.GEN_SPEC[key].map(q => q.def);
    ok(d.generateOnly === true, `${key}: is marked generate-only`);
    ok(!IA.CONTINUOUS_KEYS.includes(key) && !IA.DISCRETE_KEYS.includes(key),
       `${key}: is NOT on the fitting menu`);
    ok(IA.GEN_KEYS.includes(key), `${key}: IS on the generator menu`);
    ok(d.fit([1, 2, 3]).ok === false, `${key}: fit refuses, with a reason`);

    /* Closed forms must agree with each other. */
    let worst = 0;
    for (const u of [1e-5, 0.01, 0.25, 0.5, 0.75, 0.99, 0.99999]) {
      worst = Math.max(worst, Math.abs(d.cdf(d.quantile(u, p), p) - u) / u);
    }
    ok(worst < 1e-10, `${key}: F(F^-1(u)) = u (worst ${worst.toExponential(2)})`);
    /* And the pdf must integrate to the cdf. */
    const lo = d.quantile(1e-5, p), hi = d.quantile(0.99999, p);
    const M = 40000, h = (hi - lo) / M;
    let acc = 0;
    for (let m = 0; m < M; m++) acc += d.pdf(lo + (m + 0.5) * h, p) * h;
    close(acc, d.cdf(hi, p) - d.cdf(lo, p), 5e-4, `${key}: the pdf integrates to the cdf`);

    /* The sampler must match its own cdf.  Parameters are fixed, so the
       published critical value applies. */
    const u01 = IA.MRG32k3a(6100 + key.length);
    const y = [];
    for (let i = 0; i < 20000; i++) y.push(d.sample(u01, p));
    y.sort((a, b) => a - b);
    const fixed = { dist: d, p, shift: 0, k: 4 };
    const D = IA.ksStat(y, IA.fitCdf(fixed), IA.fitAtom(fixed)).D;
    ok(D < 1.63 / Math.sqrt(20000), `${key}: sampler matches its cdf, D = ${D.toFixed(5)}`);
  }
  /* S_B is bounded by construction; S_U is not, and a large sample from
     it must actually stray below zero at the shipped defaults -- that is
     the property the page tells the reader to expect. */
  {
    const p = IA.GEN_SPEC.johnsonSB.map(q => q.def);
    const g = IA.generateSample('johnsonSB', p, 0, 50000, 11, null);
    const s2 = IA.summarize(g.values);
    ok(s2.min > p[2] && s2.max < p[2] + p[3],
       `S_B stays strictly inside (${p[2]}, ${p[2] + p[3]}): [${s2.min.toFixed(4)}, ${s2.max.toFixed(4)}]`);
  }
  {
    const p = IA.GEN_SPEC.johnsonSU.map(q => q.def);
    const g = IA.generateSample('johnsonSU', p, 0, 50000, 12, null);
    const neg = g.values.filter(v => v < 0).length;
    ok(neg > 0 && neg < 200,
       `S_U at the shipped defaults produces ${neg} negative values in 50,000 — rare, but real`);
    const f = IA.fitDist(IA.DISTS.gamma, g.values, false, false);
    ok(f.ok === false, 'and a gamma consequently refuses the raw sample');
    const fs = IA.fitDist(IA.DISTS.gamma, g.values, true, false);
    ok(fs.ok === true, 'while the same gamma fits once the location shift is on');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   15e.  HOLDING PARAMETERS
   ══════════════════════════════════════════════════════════════════════
   Holding every parameter is the control condition for everything the
   page claims about estimated parameters: with nothing estimated, the
   published table is the correct reference, and the bootstrap must agree
   with it.  That is asserted here rather than asserted in prose.
   ══════════════════════════════════════════════════════════════════════ */
section('15e. holding parameters fixed');
{
  const truth = [2.5, 1.4], n = 250;
  const u = IA.MRG32k3a(31);
  const x = [];
  for (let i = 0; i < n; i++) x.push(IA.DISTS.gamma.sample(u, truth));
  x.sort((a, b) => a - b);
  const G = IA.DISTS.gamma;

  /* k must fall by one for each parameter held. */
  const cases = [[null, 2], [[2.5, null], 1], [[null, 1.4], 1], [[2.5, 1.4], 0]];
  for (const [fixed, wantK] of cases) {
    const f = IA.fitDist(G, x, false, false, fixed);
    ok(f.ok && f.k === wantK,
      `holds ${JSON.stringify(fixed)}: k = ${f.ok ? f.k : '?'} (expected ${wantK})`);
    if (fixed) {
      for (let j = 0; j < fixed.length; j++) {
        if (fixed[j] === null) continue;
        close(f.p[j], fixed[j], 1e-12, `  and parameter ${j} really is held at ${fixed[j]}`);
      }
    }
  }
  /* A held value must not be silently improved on. */
  {
    const f = IA.fitDist(G, x, false, false, [1.0, null]);
    ok(f.ok && f.p[0] === 1.0, 'a deliberately wrong held shape stays wrong');
    const free = IA.fitDist(G, x, false, false, null);
    ok(f.ll < free.ll, 'and it scores worse than the unconstrained fit, as it must');
  }
  /* Partially held fits must still be maxima over the free parameters. */
  {
    const f = IA.fitDist(G, x, false, false, [2.5, null]);
    let beaten = false;
    for (const bump of [0.97, 1.03]) {
      if (G.loglik(x, [2.5, f.p[1] * bump]) > f.ll + 1e-7) beaten = true;
    }
    ok(!beaten, 'with the shape held, the free scale is still at its maximum');
  }

  /* THE CONTROL CONDITION.  With everything held, the bootstrap null and
     the classical null are the same distribution, so the two p-values
     must agree -- and with nothing held they must not. */
  {
    const runOne = (fixed) => {
      const f = IA.fitDist(G, x, false, false, fixed);
      const F = IA.fitCdf(f);
      const D = IA.ksStat(x, F, IA.fitAtom(f)).D, A = IA.adStat(x, F);
      const r = IA.bootstrapRun(f, n, 3000, 777, false, D, A, fixed);
      r.step(3000);
      const res = r.result();
      return { D, tab: IA.ksPvalueClassical(D, n), boot: res.pD,
               critB: res.critD, critT: IA.ksTableCritical(n) };
    };
    const held = runOne([2.5, 1.4]);
    ok(Math.abs(held.tab - held.boot) < 0.03,
      `all held: table p = ${held.tab.toFixed(4)} and bootstrap p = ${held.boot.toFixed(4)} agree`);
    ok(Math.abs(held.critT - held.critB) / held.critT < 0.06,
      `all held: table critical value ${held.critT.toFixed(4)} and bootstrap ${held.critB.toFixed(4)} agree`);
    const free = runOne(null);
    ok(free.critB < held.critB * 0.85,
      `and with nothing held the bootstrap critical value drops to ${free.critB.toFixed(4)}, ` +
      `well below the ${held.critB.toFixed(4)} that applies when nothing was estimated`);
  }

  /* A held location shift costs no parameter and is honoured exactly. */
  {
    const us = IA.MRG32k3a(88), xs = [];
    for (let i = 0; i < 400; i++) xs.push(2.0 + IA.DISTS.expo.sample(us, [1.5]));
    xs.sort((a, b) => a - b);
    const est = IA.fitDist(IA.DISTS.expo, xs, true, false, null, null);
    const heldS = IA.fitDist(IA.DISTS.expo, xs, true, false, null, 2.0);
    ok(est.ok && est.k === 2, `shift estimated: k = ${est.ok ? est.k : '?'} (expected 2)`);
    ok(heldS.ok && heldS.shift === 2.0 && heldS.k === 1,
      `shift held at 2.0: shift = ${heldS.ok ? heldS.shift : '?'}, k = ${heldS.ok ? heldS.k : '?'} (expected 1)`);
    close(heldS.p[0], IA.summarize(xs).mean - 2.0, 1e-9,
      'and the remaining mean is the sample mean of the shifted data');
    /* An impossible held shift must be refused, not silently absorbed. */
    const bad = IA.fitDist(IA.DISTS.expo, xs, true, false, null, 99);
    ok(!bad.ok, 'a shift above the data is refused');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   15f.  THE CHI-SQUARE DEGREES OF FREEDOM
   ══════════════════════════════════════════════════════════════════════
   The page counts only REGULAR parameters against the chi-square degrees
   of freedom, on the grounds that an extreme order statistic converges
   too fast to absorb any.  That is a claim about the size of the test, so
   it is measured: under a true null, a correctly specified df gives a
   p-value that rejects about 5% of the time.  Both conventions are run,
   and the numbers are printed either way.
   ══════════════════════════════════════════════════════════════════════ */
section('15f. chi-square degrees of freedom');
{
  /* Order-statistic parameters are identified, and only those. */
  ok(IA.DISTS.uniform.orderStat.join(',') === '0,1', 'uniform: both endpoints are order statistics');
  ok(IA.DISTS.beta.orderStat.join(',') === '2,3', 'beta: L and U are order statistics');
  ok(IA.DISTS.gamma.orderStat === undefined, 'gamma: no order-statistic parameters');
  ok(IA.DISTS.triangular.orderStat === undefined,
     'triangular: its endpoints are found by search, not read off the data, so they are regular');

  const u0 = IA.MRG32k3a(4), x0 = [];
  for (let i = 0; i < 400; i++) x0.push(IA.DISTS.gamma.sample(u0, [2.5, 1.4]));
  const b0 = IA.makeBins(x0, 10);
  {
    const f = IA.fitDist(IA.DISTS.uniform, x0, false, false);
    const c = IA.chiSquareGOF(x0, f, b0);
    ok(f.k === 2 && c.kChi === 0,
      `uniform: k = ${f.k} for AIC and BIC, but kChi = ${c.kChi} for the chi-square df`);
  }
  {
    const f = IA.fitDist(IA.DISTS.beta, x0, false, false);
    const c = IA.chiSquareGOF(x0, f, b0);
    ok(f.k === 4 && c.kChi === 2, `beta: k = ${f.k}, kChi = ${c.kChi}`);
  }
  {
    const f = IA.fitDist(IA.DISTS.expo, x0, true, false);
    const c = IA.chiSquareGOF(x0, f, b0);
    ok(f.atBound === true, 'shifted exponential: the shift is at the boundary');
    ok(f.k === 2 && c.kChi === 1,
      `shifted exponential: k = ${f.k} but kChi = ${c.kChi}, since the shift is an order statistic`);
  }
  {
    const f = IA.fitDist(IA.DISTS.gamma, x0, false, false, [2.5, null]);
    const c = IA.chiSquareGOF(x0, f, b0);
    ok(c.kChi === 1, `a held parameter is not estimated, so kChi drops to ${c.kChi}`);
  }

  /* The measurement.  Uniform data, uniform fit: the endpoints are order
     statistics, so the page's convention subtracts nothing and the naive
     one subtracts two. */
  {
    const R = 1200, n = 200, K = 8;
    let rejPage = 0, rejNaive = 0, used = 0;
    for (let rep = 0; rep < R; rep++) {
      const u = IA.MRG32k3a(410000 + rep), x = [];
      for (let i = 0; i < n; i++) x.push(IA.DISTS.uniform.sample(u, [2, 9]));
      const f = IA.fitDist(IA.DISTS.uniform, x, false, false);
      if (!f.ok) continue;
      const c = IA.chiSquareGOF(x, f, IA.makeBins(x, K));
      if (!(c.df >= 1) || !Number.isFinite(c.stat)) continue;
      used++;
      if (c.p < 0.05) rejPage++;
      /* The same statistic against the naive df, subtracting all of k. */
      const dfNaive = c.nGroups - 1 - f.k;
      if (dfNaive >= 1 && IA.gammaQ(dfNaive / 2, c.stat / 2) < 0.05) rejNaive++;
    }
    const rP = rejPage / used, rN = rejNaive / used;
    const se = Math.sqrt(0.05 * 0.95 / used);
    console.log(C.d(`  uniform fit, ${used} replications: this page's df rejects ` +
      `${(100 * rP).toFixed(2)}%, subtracting all of k rejects ${(100 * rN).toFixed(2)}%, nominal 5%`));
    ok(Math.abs(rP - 0.05) < 4 * se + 0.01,
      `order-statistic df is calibrated: rejects ${(100 * rP).toFixed(2)}% (nominal 5%)`);
    ok(rN > rP,
      `and subtracting the endpoints too rejects more often (${(100 * rN).toFixed(2)}%), as the ` +
      `super-efficiency argument predicts`);
  }

  /* And the bootstrap chi-square must be calibrated whatever the df
     convention, because it uses none. */
  {
    const R = 250, n = 150, K = 8, B = 300;
    let rej = 0, used = 0;
    for (let rep = 0; rep < R; rep++) {
      const u = IA.MRG32k3a(420000 + rep), x = [];
      for (let i = 0; i < n; i++) x.push(IA.DISTS.gamma.sample(u, [2, 1.5]));
      x.sort((a, b) => a - b);
      const f = IA.fitDist(IA.DISTS.gamma, x, false, false);
      if (!f.ok) continue;
      const c = IA.chiSquareGOF(x, f, IA.makeBins(x, K));
      if (!Number.isFinite(c.stat)) continue;
      const F = IA.fitCdf(f);
      const r = IA.bootstrapRun(f, n, B, 700000 + rep, false,
                                IA.ksStat(x, F, IA.fitAtom(f)).D, IA.adStat(x, F),
                                null, c.stat, K, null);
      r.step(B);
      const res = r.result();
      if (!Number.isFinite(res.pChi)) continue;
      used++;
      if (res.pChi < 0.05) rej++;
    }
    const rate = rej / used, se = Math.sqrt(0.05 * 0.95 / used);
    ok(Math.abs(rate - 0.05) < 4 * se + 0.015,
      `bootstrap chi-square rejects ${(100 * rate).toFixed(1)}% of the time (nominal 5%, ${used} reps)`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   16.  THE BOOTSTRAP REJECTS AT THE NOMINAL RATE UNDER A TRUE NULL
   ══════════════════════════════════════════════════════════════════════
   The claim the page makes is that the bootstrap p-value is calibrated
   where the borrowed table is not.  That is checked here by simulation:
   draw a fresh sample from a known distribution, fit it, run the
   bootstrap, and record whether the p-value falls below 0.05.  Under a
   true null that should happen about 5% of the time.

   With R replications the standard error of the measured rate is
   sqrt(.05 x .95 / R), so the test is stated as a confidence band around
   0.05 rather than as a fixed threshold.  The same loop also measures
   what the TEXTBOOK critical value would have rejected, which is the
   number the page's explanation is really about.
   ══════════════════════════════════════════════════════════════════════ */
section('16. bootstrap calibration under a true null');
{
  const R = Number(process.env.IA_CALIB_REPS || 200);
  const B = Number(process.env.IA_CALIB_B || 300);
  const n = 60;
  const se = Math.sqrt(0.05 * 0.95 / R);
  console.log(C.d(`  ${R} replications x ${B} resamples, n = ${n} (set IA_CALIB_REPS / IA_CALIB_B to change)`));

  for (const [key, truth] of [['expo', [2.0]], ['gamma', [2.5, 1.2]], ['weibull', [3.0, 1.6]]]) {
    const d = IA.DISTS[key];
    let rejD = 0, rejA = 0, rejTable = 0, used = 0;
    for (let rep = 0; rep < R; rep++) {
      const u = IA.MRG32k3a(90000 + rep * 17 + key.length);
      const x = [];
      for (let i = 0; i < n; i++) x.push(d.sample(u, truth));
      x.sort((a, b) => a - b);
      const f = IA.fitDist(d, x, false, false);
      if (!f.ok) continue;
      const F = IA.fitCdf(f);
      const obsD = IA.ksStat(x, F, IA.fitAtom(f)).D, obsA = IA.adStat(x, F);
      const run = IA.bootstrapRun(f, n, B, 1234567 + rep, false, obsD, obsA);
      run.step(B);
      const res = run.result();
      used++;
      if (res.pD < 0.05) rejD++;
      if (res.pA < 0.05) rejA++;
      if (obsD > IA.ksTableCritical(n)) rejTable++;
    }
    const rD = rejD / used, rA = rejA / used, rT = rejTable / used;
    /* Four standard errors, plus a small allowance for the discreteness
       of a p-value built from B resamples. */
    const band = 4 * se + 0.01;
    ok(Math.abs(rD - 0.05) < band,
       `${key}: bootstrap K-S rejects ${(100 * rD).toFixed(1)}% of the time (nominal 5%, band +/-${(100 * band).toFixed(1)}%)`);
    ok(Math.abs(rA - 0.05) < band,
       `${key}: bootstrap A-D rejects ${(100 * rA).toFixed(1)}% of the time (nominal 5%, band +/-${(100 * band).toFixed(1)}%)`);
    /* This one is not a pass/fail claim about the code; it is the
       measurement the page's explanation rests on, printed so the claim
       can be checked rather than believed. */
    console.log(C.d(`        the textbook K-S table would have rejected ${(100 * rT).toFixed(1)}% ` +
      `-- it is meant to reject 5%, and it under-rejects because the parameters were estimated`));
  }

  /* And the p-values must be reproducible from the seed, which is the
     promise the seed field on the page makes. */
  {
    const u = IA.MRG32k3a(4242), x = [];
    for (let i = 0; i < 80; i++) x.push(IA.DISTS.gamma.sample(u, [2, 1]));
    x.sort((a, b) => a - b);
    const f = IA.fitDist(IA.DISTS.gamma, x, false, false);
    const F = IA.fitCdf(f);
    const oD = IA.ksStat(x, F, IA.fitAtom(f)).D, oA = IA.adStat(x, F);
    const go = s2 => { const r = IA.bootstrapRun(f, 80, 200, s2, false, oD, oA); r.step(200); return r.result(); };
    const a = go(777), b = go(777), c = go(778);
    ok(a.pD === b.pD && a.pA === b.pA && a.critD === b.critD,
       'the same seed reproduces the same bootstrap p-values exactly');
    ok(a.pD !== c.pD || a.critD !== c.critD, 'a different seed gives a different bootstrap');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   17.  ARRIVAL PROCESSES
   ══════════════════════════════════════════════════════════════════════ */
section('17. arrival-process analysis');
{
  const gaps = IA.interarrivals([5, 1, 9, 3]);
  ok(gaps.sorted.join(',') === '1,3,5,9', 'timestamps are sorted before differencing');
  ok(gaps.gaps.join(',') === '2,2,4', 'gaps are the differences of the sorted times');

  /* A homogeneous Poisson process must not be flagged as nonstationary
     more than about 5% of the time. */
  let flagged = 0, R = 200;
  for (let rep = 0; rep < R; rep++) {
    const u = IA.MRG32k3a(60000 + rep);
    let t = 0; const times = [];
    while (true) { t += -4 * Math.log(u()); if (t >= 480) break; times.push(t); }
    const prof = IA.rateProfile(times, 48, 0, 480);
    const st = IA.stationarityTest(prof);
    if (st && st.ok && st.p < 0.05) flagged++;
  }
  const rate = flagged / R;
  ok(Math.abs(rate - 0.05) < 4 * Math.sqrt(0.05 * 0.95 / R) + 0.01,
     `a constant-rate process is flagged ${(100 * rate).toFixed(1)}% of the time (nominal 5%)`);

  /* And a rate that genuinely changes must be caught almost every time. */
  let caught = 0;
  for (let rep = 0; rep < 60; rep++) {
    const u = IA.MRG32k3a(61000 + rep);
    let t = 0; const times = [];
    const lamMax = 0.8, lam = s2 => 0.1 + 0.7 * Math.exp(-Math.pow((s2 - 240) / 50, 2));
    while (true) { t += -Math.log(u()) / lamMax; if (t >= 480) break; if (u() < lam(t) / lamMax) times.push(t); }
    const st = IA.stationarityTest(IA.rateProfile(times, 48, 0, 480));
    if (st && st.ok && st.p < 0.05) caught++;
  }
  ok(caught >= 57, `a peaked rate is detected in ${caught} of 60 runs`);

  /* Rate arithmetic. */
  const prof = IA.rateProfile([0.5, 1.5, 2.5, 12, 13], 10, 0, 20);
  ok(prof.k === 2, 'two intervals of width 10 span [0, 20]');
  ok(prof.rows[0].n === 3 && prof.rows[1].n === 2, 'arrivals fall in the right intervals');
  close(prof.rows[0].rate, 0.3, 1e-12, 'rate = count / width');
  close(prof.rows[0].se, Math.sqrt(3) / 10, 1e-12, 'standard error = sqrt(count) / width');

  /* ── The two routes to a constant rate ─────────────────────────── */
  {
    /* chi-square quantiles, against the published table, since both exact
       intervals are built on them. */
    const CHI = [[1, 0.95, 3.841459], [10, 0.95, 18.307038], [10, 0.025, 3.246973],
                 [30, 0.975, 46.979242], [100, 0.05, 77.929465]];
    for (const [df, pr, want] of CHI) {
      close(IA.chiSqQuantile(pr, df), want, 2e-6,
        `chi-square quantile at ${pr} on ${df} df matches the published table`);
    }

    const g = IA.generateArrivals('homog', [0.25], 4000, 4242);
    const r = IA.rateMLE(g.times);
    /* The gap route must BE the exponential MLE, not merely agree with it. */
    const gaps = IA.interarrivals(g.times).gaps;
    const ef = IA.fitDist(IA.DISTS.expo, gaps, false, false);
    close(r.lamGap, 1 / ef.p[0], 1e-13,
      'the gap-route rate is exactly 1 / (the exponential MLE fitted to the gaps)');
    close(r.meanGap, ef.p[0], 1e-13, 'and the mean gap is exactly that fitted mean');
    /* The count route is the pooled Poisson MLE: total count over total width. */
    close(r.lamCount, r.n / r.T, 1e-15, 'the count-route rate is n / T');
    /* Pooling the section-3 block estimates must give the same thing. */
    {
      const prof = IA.rateProfile(g.times, 200, g.times[0], g.times[g.times.length - 1]);
      let tot = 0, wid = 0;
      for (const row of prof.rows) { tot += row.n; wid += row.width; }
      close(tot / wid, r.lamCount, 1e-12,
        'and pooling the per-block Poisson estimates gives that same number');
    }
    /* The two routes differ by exactly one arrival's worth. */
    close(r.lamGap / r.lamCount, r.m / r.n, 1e-13,
      'the gap and count routes differ by exactly the factor (n-1)/n');
    /* Both must bracket the truth. */
    ok(r.loGap < 0.25 && r.hiGap > 0.25, `gap interval [${r.loGap.toFixed(5)}, ${r.hiGap.toFixed(5)}] covers the true 0.25`);
    ok(r.loCount < 0.25 && r.hiCount > 0.25, `count interval [${r.loCount.toFixed(5)}, ${r.hiCount.toFixed(5)}] covers the true 0.25`);

    /* Coverage, which is the claim an interval actually makes. */
    let covered = 0, R = 600;
    for (let rep = 0; rep < R; rep++) {
      const gg = IA.generateArrivals('homog', [0.3], 300, 740000 + rep);
      if (!gg.ok) continue;
      const rr = IA.rateMLE(gg.times);
      if (rr.loGap <= 0.3 && rr.hiGap >= 0.3) covered++;
    }
    const cov = covered / R;
    ok(Math.abs(cov - 0.95) < 4 * Math.sqrt(0.95 * 0.05 / R) + 0.01,
      `the exact gap interval covers the true rate ${(100 * cov).toFixed(1)}% of the time (nominal 95%)`);
  }

  /* ── The arrival-process generator ─────────────────────────────── */
  for (const key of IA.ARRIVAL_KEYS) {
    const spec = IA.ARRIVAL_PROCESSES[key], p = spec.params.map(q => q.def), T = 480;
    const g = IA.generateArrivals(key, p, T, 20260819);
    ok(g.ok, `${key}: generates`, g.ok ? '' : g.msg);
    if (!g.ok) continue;
    /* Thinning must produce about the number of arrivals the rate function
       integrates to.  The integral is done by fine quadrature, which is an
       independent calculation from the generator's own. */
    const lam = spec.rate(p, T);
    let expected = 0;
    const M = 40000;
    for (let i = 0; i < M; i++) expected += lam((i + 0.5) * T / M) * (T / M);
    const se = Math.sqrt(expected);
    ok(Math.abs(g.times.length - expected) < 4 * se,
      `${key}: ${g.times.length} arrivals against an expected ${expected.toFixed(1)} (4 SE = ${(4 * se).toFixed(1)})`);
    /* Times must lie inside the window and come out sorted. */
    let ordered = true;
    for (let i = 1; i < g.times.length; i++) if (g.times[i] < g.times[i - 1]) ordered = false;
    ok(ordered, `${key}: the times come out in order`);
    ok(g.times[0] >= 0 && g.times[g.times.length - 1] < T, `${key}: every time lies inside [0, ${T})`);
    /* And the local rate must track lambda(t): counts in the first and last
       thirds should be in the ratio the rate function says. */
    const third = T / 3;
    let n1 = 0, n3 = 0;
    for (const t of g.times) { if (t < third) n1++; else if (t >= 2 * third) n3++; }
    let e1 = 0, e3 = 0;
    for (let i = 0; i < M; i++) {
      const t = (i + 0.5) * T / M;
      if (t < third) e1 += lam(t) * (T / M);
      else if (t >= 2 * third) e3 += lam(t) * (T / M);
    }
    ok(Math.abs(n1 - e1) < 4 * Math.sqrt(e1) + 2 && Math.abs(n3 - e3) < 4 * Math.sqrt(e3) + 2,
      `${key}: local counts follow lambda(t) (first third ${n1} vs ${e1.toFixed(1)}, ` +
      `last third ${n3} vs ${e3.toFixed(1)})`);
  }
  /* Reproducibility, and that the parameters actually matter. */
  {
    const a = IA.generateArrivals('peak', [0.1, 0.6, 210, 45], 480, 5);
    const b = IA.generateArrivals('peak', [0.1, 0.6, 210, 45], 480, 5);
    const c = IA.generateArrivals('peak', [0.1, 0.6, 210, 45], 480, 6);
    ok(a.times.join(',') === b.times.join(','), 'the same seed generates the same arrivals');
    ok(a.times.join(',') !== c.times.join(','), 'a different seed generates different arrivals');
    const flat = IA.generateArrivals('peak', [0.25, 0, 210, 45], 480, 5);
    const st = IA.stationarityTest(IA.rateProfile(flat.times, 48, 0, 480));
    ok(st.ok && st.p > 0.01, `a peak of height zero is indistinguishable from constant (p = ${st.p.toFixed(3)})`);
  }
  /* The generated homogeneous process must not be flagged more often than
     the test's own size allows, and the peaked one must be caught. */
  {
    let flagged = 0, caught = 0, R = 200;
    for (let rep = 0; rep < R; rep++) {
      const h = IA.generateArrivals('homog', [0.25], 480, 720000 + rep);
      const sh = IA.stationarityTest(IA.rateProfile(h.times, 48, 0, 480));
      if (sh && sh.ok && sh.p < 0.05) flagged++;
    }
    for (let rep = 0; rep < 60; rep++) {
      const k = IA.generateArrivals('peak', [0.1, 0.6, 210, 45], 480, 730000 + rep);
      const sk = IA.stationarityTest(IA.rateProfile(k.times, 48, 0, 480));
      if (sk && sk.ok && sk.p < 0.05) caught++;
    }
    const rate = flagged / R;
    ok(Math.abs(rate - 0.05) < 4 * Math.sqrt(0.05 * 0.95 / R) + 0.01,
      `generated constant-rate processes are flagged ${(100 * rate).toFixed(1)}% of the time (nominal 5%)`);
    ok(caught >= 54, `and the generated peak is caught in ${caught} of 60 runs`);
  }
  /* Validation. */
  ok(IA.validateArrivalParams('homog', [-1], 480) !== null, 'a negative rate is refused');
  ok(IA.validateArrivalParams('homog', [0.25], 0) !== null, 'a zero-length window is refused');
  ok(IA.validateArrivalParams('homog', [0.25], 480) === null, 'and sensible settings are accepted');
  ok(!IA.generateArrivals('homog', [1e-9], 480, 1).ok, 'a rate too low to produce arrivals is reported');

  /* ── The sanity flags on pasted timestamps ─────────────────────── */
  {
    const asc = IA.interarrivals([1, 4, 9, 13]);
    ok(asc.wasAscending === true && asc.negatives === 0 && asc.ties === 0,
       'clean timestamps raise no flags');
    const jumbled = IA.interarrivals([5, 1, 9, 3]);
    ok(jumbled.wasAscending === false, 'out-of-order input is flagged (it is usually a column of gaps)');
    ok(jumbled.sorted.join(',') === '1,3,5,9', 'and it is still sorted and analysed');
    const neg = IA.interarrivals([-10, -4, 0, 6]);
    ok(neg.negatives === 2, 'negative times are counted');
    ok(neg.gaps.join(',') === '6,4,6', 'and are NOT skipped: the gaps are unaffected by the origin');
    /* Translation invariance is the reason negatives are kept rather than
       dropped, so it is asserted rather than assumed. */
    const shifted = IA.interarrivals([-10, -4, 0, 6].map(v => v + 1000));
    ok(shifted.gaps.join(',') === neg.gaps.join(','),
       'moving the time origin changes nothing about the gaps');
    const p1 = IA.rateProfile([-10, -4, 0, 6], 8, -10, 6);
    const p2 = IA.rateProfile([990, 996, 1000, 1006], 8, 990, 1006);
    ok(p1.rows.map(r => r.n).join(',') === p2.rows.map(r => r.n).join(','),
       'and nothing about the rate profile either');
    const tied = IA.interarrivals([1, 2, 2, 3, 5, 5, 5]);
    ok(tied.ties === 3, `simultaneous arrivals are counted (${tied.ties} of them)`);
  }

  /* ── Durations written as clock time (tab 1) ───────────────────── */
  {
    /* Two parts carry the same arithmetic under either convention; what
       differs is the unit the answer is in. Three parts genuinely differ. */
    close(IA.toClockDuration('2:45', 'ms'), 2.75, 1e-12, 'MM:SS 2:45 = 2.75 minutes');
    close(IA.toClockDuration('2:45', 'hm'), 2.75, 1e-12, 'HH:MM 2:45 = 2.75 hours');
    close(IA.toClockDuration('1:30:00', 'ms'), 90, 1e-12, 'MM:SS convention: 1:30:00 = 90 minutes');
    close(IA.toClockDuration('1:30:00', 'hm'), 1.5, 1e-12, 'HH:MM convention: 1:30:00 = 1.5 hours');
    close(IA.toClockDuration('1:30:00', 'ms') / IA.toClockDuration('1:30:00', 'hm'), 60, 1e-12,
      'and the two differ by exactly the factor 60');
    close(IA.toClockDuration('0:45.5', 'ms'), 45.5 / 60, 1e-12, 'a fractional second is allowed');
    close(IA.toClockDuration('90:00', 'ms'), 90, 1e-12, 'a value past 59 minutes is allowed');
    ok(Number.isNaN(IA.toClockDuration('4.2', 'ms')), 'a plain number is not a clock duration');
    ok(Number.isNaN(IA.toClockDuration('2:75', 'ms')), 'an impossible second is rejected');
    ok(Number.isNaN(IA.toClockDuration('', 'ms')), 'an empty cell is not a duration');
    /* A column converts only when every cell is clock-shaped, or one
       series would silently mix minutes with bare numbers. */
    const all = IA.columnDurations(['2:45', '0:30', '1:15'], 'ms');
    ok(all.clock === true && all.unit === 'minutes' &&
       all.values.join(',') === '2.75,0.5,1.25', 'an all-clock column converts');
    const mixed = IA.columnDurations(['2:45', '4.2'], 'ms');
    ok(mixed.clock === false && mixed.values.join(',') === '4.2',
       'a column mixing clock and plain values stays numeric');
    const plain = IA.columnDurations(['1.5', '2.5'], 'ms');
    ok(plain.clock === false && plain.values.join(',') === '1.5,2.5',
       'a plain numeric column is untouched');
    ok(IA.columnDurations(['2:45', '0:30'], 'hm').unit === 'hours',
       'and the reported unit follows the convention');
  }

  /* Clock times. */
  close(IA.toClockMinutes('08:05'), 485, 1e-12, 'clock time 08:05');
  close(IA.toClockMinutes('08:05:30'), 485.5, 1e-12, 'clock time 08:05:30');
  close(IA.toClockMinutes('1:15 pm'), 795, 1e-12, 'clock time 1:15 pm');
  close(IA.toClockMinutes('12:30 am'), 30, 1e-12, 'clock time 12:30 am');
  ok(Number.isNaN(IA.toClockMinutes('4.5')), 'a bare number is not a clock time');
  ok(Number.isNaN(IA.toClockMinutes('08:75')), 'an impossible minute is rejected');
  const ct = IA.columnTimes(['08:00', '08:30', '09:15']);
  ok(ct.clock === true && ct.values.join(',') === '480,510,555', 'a column of clock times converts');
  const cn = IA.columnTimes(['1.5', '08:30']);
  ok(cn.clock === false, 'a column mixing numbers and clock times is read as numbers');
  /* And a column of clock times must not lose its first entry to the
     header test. */
  const ptc = IA.parseTable('08:00:10\n08:00:21\n08:04:44\n');
  ok(ptc.header === false && IA.columnTimes(ptc.cols[0]).values.length === 3,
     'a bare column of clock times keeps all three rows');
}

/* ══════════════════════════════════════════════════════════════════════
   18.  EXPORT EXPRESSIONS
   ══════════════════════════════════════════════════════════════════════
   These cannot be checked against the tools themselves, so what is
   checked is that every candidate produces every line, that the numbers
   inside them are the fitted ones, and that the conversions the page
   claims to perform -- rate versus mean, log-scale versus data-scale --
   really are performed.
   ══════════════════════════════════════════════════════════════════════ */
section('18. export expressions');
{
  const u = IA.MRG32k3a(900), x = [];
  for (let i = 0; i < 500; i++) x.push(IA.DISTS.gamma.sample(u, [2, 1.5]));
  const xi = [];
  const ui = IA.MRG32k3a(901);
  for (let i = 0; i < 500; i++) xi.push(IA.DISTS.poisson.sample(ui, [3.3]));

  for (const key of IA.CONTINUOUS_KEYS.concat(IA.DISCRETE_KEYS)) {
    const d = IA.DISTS[key];
    const data = d.kind === 'discrete' ? xi : x;
    const f = IA.fitDist(d, data, false, false);
    if (!f.ok) { ok(false, `${key}: fits`, f.msg); continue; }
    const e = IA.expressions(f);
    const missing = ['arena', 'simio', 'anylogic', 'r', 'matlab', 'python'].filter(t => !e[t]);
    ok(missing.length === 0, `${key}: all six tools get an expression`,
       'missing: ' + missing.join(', '));
    const s2 = IA.reproScripts(f, data, 20260818, 2000);
    ok(!!(s2.r && s2.matlab && s2.python), `${key}: all three refit scripts are produced`);
  }

  /* AnyLogic takes the RATE where Arena takes the mean; the page says so,
     and the expression has to actually do it. */
  {
    const f = IA.fitDist(IA.DISTS.expo, x, false, false);
    const e = IA.expressions(f);
    const mean = f.p[0];
    ok(e.arena.includes(IA.num(mean)), `Arena carries the mean ${IA.num(mean)}`, e.arena);
    ok(e.anylogic.includes(IA.num(1 / mean)), `AnyLogic carries the rate ${IA.num(1 / mean)}`, e.anylogic);
    ok(e.r.includes('rate = ' + IA.num(1 / mean)), 'R names the rate explicitly', e.r);
    ok(e.python.includes('scale=' + IA.num(mean)), "scipy's scale is the mean", e.python);
  }
  /* Arena's LOGN takes the mean and sd of X, not of ln X. */
  {
    const f = IA.fitDist(IA.DISTS.lognormal, x, false, false);
    const [mu, sg] = f.p;
    const mX = Math.exp(mu + sg * sg / 2), sX = mX * Math.sqrt(Math.expm1(sg * sg));
    const e = IA.expressions(f);
    ok(e.arena.includes(IA.num(mX)) && e.arena.includes(IA.num(sX)),
       `Arena's LOGN is given the data-scale mean ${IA.num(mX)} and sd ${IA.num(sX)}`, e.arena);
    ok(e.r.includes('meanlog = ' + IA.num(mu)), 'R is given the log-scale mu', e.r);
    ok(e.python.includes('scale=' + IA.num(Math.exp(mu))), "scipy's scale is exp(mu)", e.python);
    ok(!e.arena.includes('meanlog'), 'and Arena is not handed a log-scale parameter');
  }
  /* Arena writes the Weibull scale first, R the shape first. */
  {
    const f = IA.fitDist(IA.DISTS.weibull, x, false, false);
    const [scale, shape] = f.p;
    const e = IA.expressions(f);
    ok(e.arena === `WEIB(${IA.num(scale)}, ${IA.num(shape)})`, 'Arena: WEIB(scale, shape)', e.arena);
    ok(e.matlab.startsWith(`wblrnd(${IA.num(scale)}, ${IA.num(shape)}`), 'MATLAB: wblrnd(scale, shape)', e.matlab);
    ok(e.r.includes(`shape = ${IA.num(shape)}`) && e.r.includes(`scale = ${IA.num(scale)}`),
       'R names both, so the order cannot bite', e.r);
  }
  /* A shift becomes an added constant in Arena. */
  {
    const shifted = x.map(v => v + 3);
    const f = IA.fitDist(IA.DISTS.expo, shifted, true, false);
    const e = IA.expressions(f);
    ok(e.arena.startsWith(IA.num(f.shift) + ' + EXPO('), 'Arena writes the shift as an added constant', e.arena);
    ok(e.python.includes('loc=' + IA.num(f.shift)), "scipy takes it as loc", e.python);
  }
  /* scipy's geometric starts at 1, so it needs loc=-1 to match this page. */
  {
    const f = IA.fitDist(IA.DISTS.geometric, xi, false, false);
    const e = IA.expressions(f);
    ok(e.python.includes('loc=-1'), "scipy's geom is shifted to start at 0", e.python);
    ok(e.arena.includes('AINT'), 'Arena gets an inverse-transform expression', e.arena);
  }
  /* A discrete uniform in Arena needs the upper end raised by one. */
  {
    const f = IA.fitDist(IA.DISTS.discreteUniform, xi, false, false);
    const e = IA.expressions(f);
    ok(e.arena.includes(IA.num(f.p[1] + 1)), 'Arena UNIF upper end is one above the largest value', e.arena);
    ok(e.python.includes(`stats.randint(${IA.num(f.p[0])}, ${IA.num(f.p[1] + 1)})`),
       "scipy's randint excludes its upper end", e.python);
  }
  /* CSV round trip. */
  {
    const csv = IA.toCsv([['a', 'b,c', 'd"e'], [1, 2, 3]]);
    ok(csv === 'a,"b,c","d""e"\n1,2,3\n', 'CSV quoting', JSON.stringify(csv));
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Summary
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n' + C.b('─'.repeat(60)));
console.log(C.b(`${pass} passed, ${fail} failed`));
if (fail) {
  console.log(C.r('\nFailures:'));
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail ? 1 : 0);
