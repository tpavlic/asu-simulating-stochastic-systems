#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for power_explorer.html.  NOT shipped with the widget.

     node power_analysis/verify_power_explorer.mjs

   The script slices the block between the PA-CORE sentinels out of
   power_explorer.html and runs it in a Node vm context, so the code under
   test is byte-for-byte the code the page ships (and the code its Web
   Worker is built from).  There is no second copy of the numerics.

   Reference values and their sources:
   - Exact identities wherever one exists (Gamma(1/2) = sqrt(pi),
     P(1,x) = 1 - e^-x, I_x(2,3) = 11/16 at x = 1/2), so a reader can
     check the check.
   - Noncentral t and chi-square CDFs, central quantiles, binomial CDFs,
     and the R power-function crosschecks: computed with R 4.6.1
     (pt/pchisq with ncp, qt/qchisq/qf, pbinom, power.t.test,
     power.anova.test, prop.test) on 2026-08-19.  Each line names the
     call.
   - Noncentral F: R's own pf(ncp) is the AS 226 approximation, accurate
     only to ~1e-9, so the references here are Poisson mixtures of R's
     central pbeta (sum_j dpois(j, l/2) * pbeta(x, d1/2 + j, d2/2),
     j = 0..2000), which is exact to ~1e-15 and against which pf(ncp)
     itself deviates in the 9th decimal.
   - The pooled two-sample t at an unequal split (n_A = 12, n_B = 30):
     MATLAB R2026a sampsizepwr('t2', [0 2], 1.2, [], 12, 'Ratio', 2.5),
     computed on 2026-09-26.  sampsizepwr leaves r*n unrounded, and so it
     is a valid reference only where r*n is a whole number, as it is here.
   - power.t.test values use strict = TRUE, which counts both rejection
     tails; the default drops the far tail and differs in the 4th-5th
     decimal.  The widget computes the strict (exact) quantity.

   The Monte Carlo sections use PA_MC_M replications per check (default
   40000; set the environment variable to shorten a smoke run).  With the
   default, the full script takes on the order of a minute.  A shortened
   run trades sharpness for speed: with dozens of 99.9% intervals checked
   at a small m, an occasional single miss is expected noise, and only a
   failure that survives the default m indicates a bug.

   If Rscript is on the PATH, section 11 re-derives a row of power
   values in R with the same formulas the widget's export panel emits,
   and compares them against the core.  Without Rscript it is skipped.

   Section 13 checks the pooled-versus-Welch comparison: that both tests
   see the very same datasets (their counts equal the one-test engine's at
   the same seed), and the textbook behavior of the pooled test's level
   when the variances and the group sizes both differ.

   Section 12 slices the Beyond Formulas tab's Monte Carlo template out
   of the HTML verbatim and runs it in R, Python, and MATLAB (each
   skipped when its interpreter is absent), checking that the seeded
   attained-alpha and power estimates land near 0.05 and the exact
   0.5645.  The MATLAB leg pays a cold-start cost of tens of seconds.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'power_explorer.html');
const MC_M = Math.max(2000, Number(process.env.PA_MC_M) || 40000);

/* ── Load the core out of the page ─────────────────────────────────── */
function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== PA-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== PA-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('PA-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core))
    throw new Error('PA core references the DOM; the worker would break');
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN,
                Float64Array, Uint8Array };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'power_explorer.html#PA-CORE' });
  if (!ctx.PA) throw new Error('core ran but exported no PA namespace');
  return { PA: ctx.PA, lines: core.split('\n').length };
}

/* ── Tiny test harness ─────────────────────────────────────────────── */
let pass = 0, fail = 0, group = '';
const failures = [];
const Ct = process.stdout.isTTY
  ? { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
      d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { g: s => s, r: s => s, d: s => s, b: s => s };

function section(name) { group = name; console.log('\n' + Ct.b(name)); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ' + Ct.g('PASS') + '  ' + label); }
  else {
    fail++; failures.push(group + ' :: ' + label);
    console.log('  ' + Ct.r('FAIL') + '  ' + label + (detail ? '\n        ' + Ct.d(detail) : ''));
  }
}
function close(got, want, tol, label) {
  const scale = Math.abs(want) < 1e-8 ? 1 : Math.abs(want);
  const err = Math.abs(got - want) / scale;
  ok(err <= tol, `${label}  (err ${Number.isFinite(err) ? err.toExponential(2) : err} <= ${tol.toExponential(1)})`,
     `got ${got}, want ${want}`);
}

const { PA, lines } = loadCore();
console.log(Ct.d(`core loaded: ${lines} lines between the PA-CORE sentinels; MC sections use m = ${MC_M}`));

function defaults(t) {
  const o = {};
  t.params.forEach(q => { o[q.key] = Array.isArray(q.def) ? q.def.slice() : q.def; });
  return o;
}
function mc(testId, params, n, alpha, sided, m, seed) {
  const run = PA.mcRun(testId, params, n, alpha, sided, m, seed);
  run.step(m);
  return run.result();
}

/* ═══ 1. Special functions: exact identities ═══════════════════════ */
section('1. Special functions (exact identities; canonical copies from input_analyzer.html)');
{
  /* The sampler's inverse normal skips normInv's refinement step; it must
     stay within Acklam's published relative error of 1.15e-9, tails
     included, so that a seed gives the same datasets as the refined one. */
  let worst = 0;
  const rng = PA.MRG32k3a(31337);
  for (let i = 0; i < 400000; i++) {
    const u = i < 2000 ? (i + 0.5) / 2e9 : (i < 4000 ? 1 - (i - 1999.5) / 2e9 : rng());
    const a = PA.normInv(u);
    worst = Math.max(worst, Math.abs(PA.normInvSample(u) - a) / Math.abs(a));
  }
  ok(worst < 1.2e-9, `normInvSample within 1.2e-9 relative of normInv (worst ${worst.toExponential(2)})`);
}
close(PA.logGamma(0.5), 0.5 * Math.log(Math.PI), 1e-14, 'logGamma(1/2) = log sqrt(pi)');
close(PA.logGamma(6), Math.log(120), 1e-14, 'logGamma(6) = log 5!');
close(PA.gammaP(1, 0.7), 1 - Math.exp(-0.7), 1e-14, 'P(1,x) = 1 - e^-x');
close(PA.betaInc(2, 3, 0.5), 11 / 16, 1e-14, 'I_0.5(2,3) = 11/16');
close(PA.normCdf(0), 0.5, 1e-15, 'Phi(0) = 1/2');
close(PA.normInv(PA.normCdf(1.234567)), 1.234567, 1e-12, 'normInv inverts normCdf');
close(PA.erf(1) + PA.erfc(1), 1, 1e-14, 'erf + erfc = 1');

/* ═══ 2. Central distributions and quantiles (R 4.6.1) ═════════════ */
section('2. Central CDFs and quantiles vs R 4.6.1');
close(PA.tQuantile(0.975, 19), 2.09302405440831, 1e-12, 'qt(0.975, 19)');
close(PA.tQuantile(0.95, 19), 1.72913281152137, 1e-12, 'qt(0.95, 19)');
close(PA.tQuantile(0.975, 1), 12.7062047361747, 1e-12, 'qt(0.975, 1)');
close(PA.chi2Quantile(0.025, 24), 12.4011502174444, 1e-12, 'qchisq(0.025, 24)');
close(PA.chi2Quantile(0.975, 24), 39.3640770266039, 1e-12, 'qchisq(0.975, 24)');
close(PA.fQuantile(0.95, 3, 36), 2.86626555094018, 1e-12, 'qf(0.95, 3, 36)');
close(PA.binomCdf(12, 50, 0.3), 0.222865784887181, 1e-12, 'pbinom(12, 50, 0.3)');
close(PA.binomCdf(249, 1000, 0.26), 0.225273868611018, 1e-12, 'pbinom(249, 1000, 0.26)');
/* CDF/quantile round trips */
close(PA.tCdf(PA.tQuantile(0.31, 7), 7), 0.31, 1e-12, 't CDF/quantile round trip');
close(PA.chi2Cdf(PA.chi2Quantile(0.87, 13), 13), 0.87, 1e-12, 'chi2 CDF/quantile round trip');
close(PA.fCdf(PA.fQuantile(0.61, 4, 22), 4, 22), 0.61, 1e-12, 'F CDF/quantile round trip');

/* ═══ 3. Noncentral CDFs ═══════════════════════════════════════════ */
section('3. Noncentral t (R pt with ncp), chi-square (R pchisq with ncp), F (Poisson mixture of R pbeta)');
/* pt(t, df, ncp), R 4.6.1.  Tolerance 1e-9: this AS 243 implementation
   and R's agree to ~5e-11 even on far-tail values of order 1e-4, and
   neither side claims more there. */
[[2, 10, 1, 0.807611562530311],
 [0.5, 1, 0.5, 0.459860194076523],
 [-1.5, 25, 2, 0.000322173144429505],
 [3, 5, 4, 0.198625176940898],
 [18, 30, 15, 0.871817990239812],
 [2.086, 20, 2.5, 0.337715931594736],
 [-3, 8, -2, 0.233879251156524],
 [0, 12, 1.7, 0.044565462758543],
 [1.5, 3, 0, 0.884708067377589],
 [40, 60, 35, 0.901115606075065],
 [2.5, 199, 2.8, 0.381782066204917],
 [-0.5, 40, 3, 0.000240153885870287]
].forEach(([t, nu, d, want]) => close(PA.nctCdf(t, nu, d), want, 1e-9, `nctCdf(${t}, ${nu}, ${d})`));

/* pchisq(x, df, ncp), R 4.6.1 (the 3.84146 row is the Poisson-mixture
   value at exactly x = 3.84146; R's printout in the session log was for
   x = 3.841459) */
[[10, 5, 1, 0.862666813559958],
 [2, 1, 4, 0.278689687340668],
 [50, 10, 30, 0.808094961628726],
 [0.5, 2, 0.1, 0.211674108995152],
 [25, 4, 12, 0.879911930360357],
 [3.84146, 1, 7.849, 0.199993114780664],
 [120, 40, 60, 0.866394666095425],
 [0.001, 3, 5, 6.90509148224332e-07],
 [800, 500, 250, 0.867368097196202]
].forEach(([x, k, l, want]) => close(PA.ncx2Cdf(x, k, l), want, 1e-10, `ncx2Cdf(${x}, ${k}, ${l})`));

/* Noncentral F: sum_j dpois(j, l/2) * pbeta(d1 f/(d1 f + d2), d1/2+j, d2/2)
   evaluated in R 4.6.1 with j = 0..2000 (R's pf(ncp) deviates from these
   in the 9th decimal; this implementation matches them to ~1e-15). */
[[2, 3, 20, 5, 0.403130085034589],
 [1, 1, 10, 2, 0.324239300437872],
 [4.5, 2, 30, 10, 0.370641175556558],
 [0.5, 5, 5, 1, 0.176913557254021],
 [3.1, 4, 45, 16, 0.199618718335192],
 [2.7, 1, 198, 7.85, 0.123680976163167],
 [10, 6, 12, 40, 0.676067097456853]
].forEach(([f, d1, d2, l, want]) => close(PA.ncfCdf(f, d1, d2, l), want, 1e-11, `ncfCdf(${f}, ${d1}, ${d2}, ${l})`));

/* zero noncentrality collapses to the central distribution */
close(PA.nctCdf(1.5, 3, 0), PA.tCdf(1.5, 3), 1e-13, 'nct(delta=0) = central t');
close(PA.ncx2Cdf(7, 4, 0), PA.chi2Cdf(7, 4), 1e-13, 'ncx2(lambda=0) = central chi2');
close(PA.ncfCdf(2, 3, 9, 0), PA.fCdf(2, 3, 9), 1e-13, 'ncF(lambda=0) = central F');

/* ═══ 4. Exact binomial machinery (R enumeration) ══════════════════ */
section('4. Equal-tail exact binomial region, power, attained level (R 4.6.1 enumeration)');
[[50, 0.3, 0.5, 0.05, 8, 23, 0.760056750928738, 0.0305294724710406],
 [100, 0.5, 0.6, 0.05, 39, 61, 0.462093382348394, 0.0352002002177048],
 [30, 0.2, 0.05, 0.05, 1, 12, 0.553542084472193, 0.0200156125086483],
 [200, 0.5, 0.55, 0.05, 85, 115, 0.261982886684658, 0.0400371916133996],
 [15, 0.5, 0.8, 0.10, 3, 12, 0.6481631158272, 0.03515625]
].forEach(([n, p0, p1, a, klo, khi, pow, att]) => {
  const r = PA.binomRegion(n, p0, a, 'two');
  ok(r.klo === klo && r.khi === khi, `region n=${n} p0=${p0} a=${a}: (${r.klo}, ${r.khi})`,
     `want (${klo}, ${khi})`);
  close(PA.TESTS.p.analyticPower(n, { p0, p1 }, a, 'two'), pow, 1e-11, `binomial power n=${n}`);
  close(PA.TESTS.p.attainedAlpha(n, { p0, p1 }, a, 'two'), att, 1e-11, `attained alpha n=${n}`);
});

/* ═══ 5. Wilson interval (R prop.test, correct = FALSE) ════════════ */
section('5. Wilson score interval vs R prop.test(correct = FALSE)');
{
  const w = PA.wilson(8, 10);
  close(w.lo, 0.490162471536642, 1e-9, 'wilson(8, 10) lower');
  close(w.hi, 0.943317848545625, 1e-9, 'wilson(8, 10) upper');
  const w0 = PA.wilson(0, 25);
  close(w0.lo, 0, 1e-12, 'wilson(0, 25) lower = 0');
  close(w0.hi, 0.133192250939048, 1e-9, 'wilson(0, 25) upper');
}

/* ═══ 6. Analytic power at zero effect equals alpha ════════════════ */
section('6. Power at zero effect = alpha, every test, every sidedness');
for (const id of ['z', 't', 't2', 'tw', 'var', 'gof', 'anova', 'reg']) {
  const t = PA.TESTS[id];
  const p0 = t.nullParams(defaults(t));
  const sides = t.sidedFixed ? [t.sidedFixed] : ['two', 'left', 'right'];
  for (const a of [0.01, 0.05, 0.1]) {
    for (const s of sides) {
      close(t.analyticPower(30, p0, a, s), a, 1e-9, `${id} (${s}, alpha=${a})`);
    }
  }
}
/* the two-sample tests at an unequal split, and Welch at unequal variances */
for (const [id, params] of [['t2', { muA: 0, muB: 0, sigma: 2, r: 2.5 }],
                            ['tw', { muA: 0, muB: 0, sigmaA: 1, sigmaB: 3, r: 0.4 }]]) {
  for (const s of ['two', 'left', 'right'])
    close(PA.TESTS[id].analyticPower(17, params, 0.05, s), 0.05, 1e-9, `${id} r=${params.r} (${s}, alpha=0.05)`);
}
/* the p test attains at most alpha, exactly the null region probability */
{
  const t = PA.TESTS.p;
  for (const [n, p0v, a] of [[50, 0.3, 0.05], [23, 0.5, 0.05], [200, 0.55, 0.01]]) {
    const att = t.attainedAlpha(n, { p0: p0v, p1: p0v }, a, 'two');
    ok(att <= a + 1e-12, `p test attained alpha ${att.toFixed(5)} <= ${a} (n=${n}, p0=${p0v})`);
    close(t.analyticPower(n, { p0: p0v, p1: p0v }, a, 'two'), att, 1e-12,
          `p test power at zero effect = attained alpha (n=${n})`);
  }
}

/* ═══ 7. Analytic power vs R's own power functions ═════════════════ */
section('7. Analytic power vs R power.t.test(strict = TRUE) / power.anova.test');
close(PA.TESTS.t.analyticPower(20, { mu0: 0, mu1: 0.5, sigma: 1 }, 0.05, 'two'),
      0.564504418439084, 1e-10, 'one-sample t, n=20, d=0.5, two-sided (strict)');
close(PA.TESTS.t.analyticPower(30, { mu0: 0, mu1: 0.4, sigma: 1 }, 0.05, 'right'),
      0.689512766297012, 1e-10, 'one-sample t, n=30, d=0.4, one-sided');
close(PA.TESTS.t2.analyticPower(25, { muA: 1.2, muB: 0, sigma: 2 }, 0.05, 'two'),
      0.547312459262732, 1e-10, 'two-sample t, n=25/group, d=0.6, two-sided (strict)');
close(PA.TESTS.t2.analyticPower(25, { muA: 1.2, muB: 0, sigma: 2, r: 1 }, 0.05, 'two'),
      0.547312459262732, 1e-10, 'pooled t with r = 1 is the balanced design');
close(PA.TESTS.t2.analyticPower(12, { muA: 1.2, muB: 0, sigma: 2, r: 2.5 }, 0.05, 'two'),
      0.403145781705295, 1e-10, 'pooled t, n_A=12, n_B=30 (MATLAB sampsizepwr Ratio 2.5)');
/* Welch at equal standard deviations and equal groups has df 2n - 2, and
   so its approximation is the pooled test's exact power. */
close(PA.TESTS.tw.analyticPower(25, { muA: 1.2, muB: 0, sigmaA: 2, sigmaB: 2, r: 1 }, 0.05, 'two'),
      0.547312459262732, 1e-10, 'Welch at equal sds and groups reduces to the pooled power');
close(PA.TESTS.tw.df(25, { sigmaA: 2, sigmaB: 2, r: 1 }), 48, 1e-12, 'Welch df at equal sds and groups is 2n - 2');
/* power.anova.test(groups=4, n=12, between.var=1, within.var=9) = 0.330363878430393;
   lambda = n (g-1) bv / wv = 4, i.e. Cohen's f = sqrt(4/48).  Tolerance
   1e-8 because R's value goes through its own pf(ncp). */
close(PA.TESTS.anova.powerAtEffect(Math.sqrt(4 / 48), 12, { means: [0, 0, 0, 0], sigma: 1 }, 0.05, 'right'),
      0.330363878430393, 1e-8, 'one-way ANOVA, g=4, n=12/group');

/* ═══ 8. Monte Carlo power vs analytic power (the central check) ═══ */
section(`8. Monte Carlo vs analytic across the grid (m = ${MC_M}; exact value must land in a 99.9% Wilson interval)`);
/* Disagreement here means one of the two is wrong; treat it as a bug. */
const GRID = [
  ['z', { mu0: 0, mu1: 0.5, sigma: 1 }, 15, 0.05, 'two'],
  ['z', { mu0: 2, mu1: 1.4, sigma: 1.5 }, 24, 0.10, 'left'],
  ['t', { mu0: 0, mu1: 0.5, sigma: 1 }, 20, 0.05, 'two'],
  ['t', { mu0: 0, mu1: -0.6, sigma: 1 }, 12, 0.05, 'left'],
  ['t', { mu0: 1, mu1: 1.3, sigma: 0.8 }, 40, 0.01, 'right'],
  ['t2', { muA: 1.2, muB: 0, sigma: 2 }, 25, 0.05, 'two'],
  ['t2', { muA: 0, muB: 0.9, sigma: 1.5 }, 14, 0.10, 'left'],
  ['t2', { muA: 1.2, muB: 0, sigma: 2, r: 2.5 }, 12, 0.05, 'two'],
  ['t2', { muA: 0, muB: 0.7, sigma: 1, r: 0.3 }, 30, 0.05, 'left'],
  ['var', { v0: 4, v1: 8 }, 20, 0.05, 'two'],
  ['var', { v0: 4, v1: 2 }, 20, 0.05, 'two'],
  ['var', { v0: 1, v1: 1.8 }, 35, 0.05, 'right'],
  ['p', { p0: 0.3, p1: 0.5 }, 50, 0.05, 'two'],
  ['p', { p0: 0.5, p1: 0.62 }, 37, 0.05, 'right'],
  ['p', { p0: 0.2, p1: 0.1 }, 80, 0.10, 'left'],
  ['anova', { means: [8, 9, 10], sigma: 2 }, 10, 0.05, 'right'],
  ['anova', { means: [0, 0, 0.8, 1.2, 0.4], sigma: 1.6 }, 8, 0.05, 'right'],
  ['reg', { b1: 0.4, sigma: 1, sx: 1 }, 30, 0.05, 'two'],
  ['reg', { b1: -0.5, sigma: 1.2, sx: 0.7 }, 22, 0.05, 'left']
];
let seedBase = 977001;
for (const [id, params, n, alpha, sided] of GRID) {
  const t = PA.TESTS[id];
  const exact = t.analyticPower(n, params, alpha, sided);
  const r = mc(id, params, n, alpha, sided, MC_M, seedBase += 13);
  const w = PA.wilson(r.rejAlt, r.m, 0.999);
  ok(exact >= w.lo && exact <= w.hi,
     `${id} n=${n} alpha=${alpha} ${sided}: exact ${exact.toFixed(4)} in MC 99.9% CI [${w.lo.toFixed(4)}, ${w.hi.toFixed(4)}]`);
  /* the same run's null arm must attain the level */
  const target = t.attainedAlpha ? t.attainedAlpha(n, params, alpha, sided) : alpha;
  const wN = PA.wilson(r.rejNull, r.m, 0.999);
  ok(target >= wN.lo && target <= wN.hi,
     `${id} null-run level ${(r.rejNull / r.m).toFixed(4)} consistent with ${target.toFixed(4)}`);
}
/* Welch: the analytic curve is the noncentral t at the df the TRUE
   variances imply, an approximation, and each simulated dataset uses its
   own df.  The approximation is close but not exact, and so it is held to
   4 SE + 0.005 rather than to pure Monte Carlo error, and the null level
   to within 0.005 of alpha beyond its interval. */
for (const [params, n, alpha, sided] of [
  [{ muA: 1, muB: 0, sigmaA: 1, sigmaB: 3, r: 0.5 }, 20, 0.05, 'two'],
  [{ muA: 0, muB: 0.8, sigmaA: 2, sigmaB: 1, r: 3 }, 10, 0.05, 'left'],
  [{ muA: 1.2, muB: 0, sigmaA: 2, sigmaB: 2, r: 1 }, 25, 0.05, 'two'],
  [{ muA: 0.5, muB: 0, sigmaA: 0.5, sigmaB: 1.5, r: 2 }, 15, 0.01, 'right']]) {
  const t = PA.TESTS.tw;
  const approx = t.analyticPower(n, params, alpha, sided);
  const r = mc('tw', params, n, alpha, sided, MC_M, seedBase += 13);
  const est = r.rejAlt / r.m, se = Math.sqrt(est * (1 - est) / r.m);
  ok(Math.abs(est - approx) < 4 * se + 0.005,
     `tw n=${n} r=${params.r} sd ${params.sigmaA}/${params.sigmaB} ${sided}: MC ${est.toFixed(4)} vs approximation ${approx.toFixed(4)}`);
  const wN = PA.wilson(r.rejNull, r.m, 0.999);
  ok(alpha >= wN.lo - 0.005 && alpha <= wN.hi + 0.005,
     `tw null-run level ${(r.rejNull / r.m).toFixed(4)} near ${alpha}`);
}
/* gof: the analytic curve is the LARGE-n noncentral chi-square
   approximation, so it is checked at a large n and against a widened
   tolerance rather than pure MC error; the small-n gap is real and is
   surfaced in the widget as a teaching point. */
{
  const params = { p0v: [0.25, 0.25, 0.25, 0.25], p1v: [0.30, 0.24, 0.23, 0.23] };
  const t = PA.TESTS.gof;
  const exact = t.analyticPower(600, params, 0.05, 'right');
  const r = mc('gof', params, 600, 0.05, 'right', MC_M, 424243);
  const est = r.rejAlt / r.m;
  const se = Math.sqrt(est * (1 - est) / r.m);
  ok(Math.abs(est - exact) < 4 * se + 0.01,
     `gof n=600: MC ${est.toFixed(4)} vs noncentral-chi2 approximation ${exact.toFixed(4)} (tolerance 4 SE + 0.01)`);
  const wN = PA.wilson(r.rejNull, r.m, 0.999);
  ok(0.05 >= wN.lo - 0.005 && 0.05 <= wN.hi + 0.005,
     `gof null-run level ${(r.rejNull / r.m).toFixed(4)} near 0.05 (chi-square approximation)`);
}
/* The gamma-regression demo has no analytic power at all; what CAN be
   checked is that the Wald-t test is roughly calibrated at a large n
   (it is asymptotic: the response is not normal and the dispersion is
   estimated) and that power moves the right way with the slope. */
{
  const rNull = mc('glm', { b0: 1, b1: 0.25, shape: 2 }, 200, 0.05, 'two', Math.min(MC_M, 20000), 5551);
  const lvl = rNull.rejNull / rNull.m;
  ok(lvl > 0.038 && lvl < 0.066, `glm Wald-t null level ${lvl.toFixed(4)} in [0.038, 0.066] at n=200 (asymptotic)`);
  const rLo = mc('glm', { b0: 1, b1: 0.1, shape: 2 }, 60, 0.05, 'two', 8000, 5552);
  const rHi = mc('glm', { b0: 1, b1: 0.4, shape: 2 }, 60, 0.05, 'two', 8000, 5553);
  ok(rHi.rejAlt / rHi.m > rLo.rejAlt / rLo.m + 0.2,
     `glm power increases with slope (${(rLo.rejAlt / rLo.m).toFixed(3)} -> ${(rHi.rejAlt / rHi.m).toFixed(3)})`);
}

/* ═══ 9. Solve-for-n round trips ═══════════════════════════════════ */
section('9. Solve-for-n round trips: power(n*) >= target > power(n* - 1)');
const SOLVE = [
  ['z', { mu0: 0, mu1: 0.5, sigma: 1 }, 0.05, 'two', 0.8],
  ['t', { mu0: 0, mu1: 0.5, sigma: 1 }, 0.05, 'two', 0.8],
  ['t', { mu0: 0, mu1: 0.25, sigma: 1 }, 0.05, 'right', 0.9],
  ['t2', { muA: 1.2, muB: 0, sigma: 2 }, 0.05, 'two', 0.9],
  ['t2', { muA: 1.2, muB: 0, sigma: 2, r: 1.5 }, 0.05, 'two', 0.9],
  ['tw', { muA: 1, muB: 0, sigmaA: 1, sigmaB: 3, r: 0.5 }, 0.05, 'right', 0.9],
  ['var', { v0: 4, v1: 8 }, 0.05, 'two', 0.8],
  ['var', { v0: 4, v1: 2 }, 0.05, 'two', 0.8],
  ['gof', { p0v: [0.25, 0.25, 0.25, 0.25], p1v: [0.4, 0.2, 0.2, 0.2] }, 0.05, 'right', 0.85],
  ['anova', { means: [8, 9, 10], sigma: 2 }, 0.05, 'right', 0.8],
  ['reg', { b1: 0.4, sigma: 1, sx: 1 }, 0.05, 'two', 0.95]
];
for (const [id, params, alpha, sided, target] of SOLVE) {
  const t = PA.TESTS[id];
  const res = PA.solveNAnalytic(t, params, alpha, sided, target);
  const atN = t.analyticPower(res.n, params, alpha, sided);
  const atPrev = res.n - 1 >= t.nMin ? t.analyticPower(res.n - 1, params, alpha, sided) : 0;
  ok(res.n && atN >= target && atPrev < target,
     `${id} target ${target} (${sided}): n* = ${res.n}, power ${atN.toFixed(4)}, at n*-1 ${atPrev.toFixed(4)}`);
}
/* R crosscheck of one of the rows: power.t.test(delta=0.25, power=0.9,
   one.sided) returns n = 138.3856365, so the minimum integer n is 139. */
{
  const res = PA.solveNAnalytic(PA.TESTS.t, { mu0: 0, mu1: 0.25, sigma: 1 }, 0.05, 'right', 0.9);
  ok(res.n === 139, `one-sided t solve matches R: n* = ${res.n} (power.t.test gives 138.39)`);
}
/* The p test is exempted from the round-trip law by design: power is not
   monotone in n.  What must hold instead: the first-crossing property at
   n*, a dip after n* really dips, and the reported stable n clears the
   target on a sampled window beyond it. */
{
  const t = PA.TESTS.p;
  const params = { p0: 0.5, p1: 0.6 }, alpha = 0.05, target = 0.8;
  const res = PA.solveNAnalytic(t, params, alpha, 'two', target);
  const pw = n => t.analyticPower(n, params, alpha, 'two');
  ok(pw(res.n) >= target && (res.n === t.nMin || pw(res.n - 1) < target),
     `p first crossing at n = ${res.n} (power ${pw(res.n).toFixed(4)})`);
  if (res.lastDip) {
    ok(pw(res.lastDip) < target, `p really dips after first crossing: power(${res.lastDip}) = ${pw(res.lastDip).toFixed(4)} < ${target}`);
    let allAbove = true;
    for (let n = res.stableN; n <= res.stableN + 60; n++) if (pw(n) < target) allAbove = false;
    ok(allAbove, `p stable n = ${res.stableN}: no dip in the next 60 sample sizes`);
  } else {
    ok(true, 'p case produced no dip for this configuration (allowed)');
  }
  /* and the sawtooth itself is real: some n -> n+1 step loses power */
  let sawtooth = false;
  for (let n = 20; n < 300; n++) if (pw(n + 1) < pw(n) - 1e-12) { sawtooth = true; break; }
  ok(sawtooth, 'power(n+1) < power(n) somewhere in 20..300: the sawtooth exists');
}

/* ═══ 10. Small structural checks ══════════════════════════════════ */
section('10. Paired-comparison algebra, design scaling, logistic fit');
close(PA.pairedSigmaD(2, 3, 0), Math.sqrt(13), 1e-14, 'sigma_d at rho=0');
close(PA.pairedSigmaD(2, 2, 1), 0, 1e-12, 'sigma_d at rho=1, equal sigmas');
close(PA.pairedSigmaD(1, 1, -1), 2, 1e-12, 'sigma_d at rho=-1, equal sigmas');
{
  const x = PA.regDesign(37, 1.7);
  const mean = Array.from(x).reduce((a, b) => a + b, 0) / 37;
  const sd = Math.sqrt(Array.from(x).reduce((a, b) => a + b * b, 0) / 37);
  close(mean, 0, 1e-12, 'regression design is centered');
  close(sd, 1.7, 1e-12, 'regression design has population SD exactly s_x');
}
{
  /* gamma sampler moments: mean = shape, variance = shape for scale 1
     (Marsaglia-Tsang above 1; the power-boost branch below 1) */
  const rng0 = PA.MRG32k3a(777);
  let m1 = 0, m2 = 0;
  const NS = 200000;
  for (let i = 0; i < NS; i++) { const g = PA.gammaSample(rng0, 2.5); m1 += g; m2 += g * g; }
  m1 /= NS;
  const vv = m2 / NS - m1 * m1;
  ok(Math.abs(m1 - 2.5) < 0.02, `gammaSample(2.5) mean ${m1.toFixed(4)} near 2.5`);
  ok(Math.abs(vv - 2.5) < 0.06, `gammaSample(2.5) variance ${vv.toFixed(4)} near 2.5`);
  let m3 = 0;
  for (let i = 0; i < 50000; i++) m3 += PA.gammaSample(rng0, 0.5);
  ok(Math.abs(m3 / 50000 - 0.5) < 0.02, `gammaSample(0.5) mean ${(m3 / 50000).toFixed(4)} near 0.5 (boost branch)`);
}
{
  /* glmFit recovers known coefficients on a large clean sample */
  const rng = PA.MRG32k3a(31415);
  const d = PA.TESTS.glm.simulate(20000, { b0: 1, b1: 0.3, shape: 2 }, rng);
  const f = PA.glmFit(d.x, d.y, 20000);
  ok(f && Math.abs(f.b1 - 0.3) < 0.03, `glmFit recovers b1 = 0.3 (got ${f && f.b1.toFixed(4)})`);
}
{
  /* pairedSummary recovers a constructed correlation */
  const rng = PA.MRG32k3a(2718);
  const n = 5000, a = [], b = [];
  for (let i = 0; i < n; i++) {
    const z1 = rng.normal(), z2 = rng.normal();
    a.push(2 * z1);
    b.push(3 * (0.6 * z1 + Math.sqrt(1 - 0.36) * z2));
  }
  const ps = PA.pairedSummary(a, b);
  ok(Math.abs(ps.rho - 0.6) < 0.03, `pairedSummary recovers rho = 0.6 (got ${ps.rho.toFixed(4)})`);
}
{
  /* Pilot input shapes. A list may be written down a column or across one
     line; two columns over several rows stay a paired pilot, and the
     one-row rule must never fire on them. */
  const cols = (t) => PA.pilotColumns(t);
  const colWise = cols('4.67\n3.51\n5.01\n');
  ok(colWise.cols.length === 1 && colWise.cols[0].length === 3 && !colWise.fromRow,
     'pilotColumns: one number per line stays one column');
  for (const [label, text] of [['commas', '4.67, 3.51, 5.01'],
                               ['spaces', '4.67 3.51 5.01'],
                               ['tabs', '4.67\t3.51\t5.01'],
                               ['trailing newline', '4.67, 3.51, 5.01\n']]) {
    const r = cols(text);
    ok(r.fromRow && r.cols.length === 1 && r.cols[0].length === 3 &&
       Math.abs(r.cols[0][2] - 5.01) < 1e-12,
       `pilotColumns: one row of values reads as one column (${label})`);
  }
  const two = cols('4.6, 5.1\n3.2, 3.9\n5.8, 6.4');
  ok(!two.fromRow && two.cols.length === 2 && two.cols[0].length === 3,
     'pilotColumns: two columns over three rows stay paired');
  const twoRows = cols('4.6, 5.1');
  ok(twoRows.fromRow && twoRows.cols.length === 1 && twoRows.cols[0].length === 2,
     'pilotColumns: a lone pair of values is a two-value list, not an n = 1 pilot');
  /* Transposing a sideways paste, with each value's text carried across
     unchanged rather than reformatted. */
  const sideways = '12, 15, 11, 14, 13\n10, 14, 9, 13, 11';
  const fixed = PA.transposeText(sideways);
  ok(fixed === '12, 10\n15, 14\n11, 9\n14, 13\n13, 11',
     'transposeText turns 2 rows of 5 into 5 rows of 2');
  const after = cols(fixed);
  ok(after.cols.length === 2 && after.cols[0].length === 5,
     'the transposed paste reads as 5 paired rows');
  ok(PA.transposeText(PA.transposeText(sideways)) === sideways,
     'transposeText is its own inverse on a rectangular paste');
  ok(PA.transposeText('1.10, 2.50\n3.00, 4.00') === '1.10, 3.00\n2.50, 4.00',
     'transposeText preserves each value as typed, trailing zeros included');
  ok(PA.transposeText('1.1, 1.2, 1.3\n1.4, 1.5') === '1.1, 1.4\n1.2, 1.5\n1.3',
     'transposeText keeps every value of a ragged paste');
  ok(PA.transposeText('5 6\t7\n8;9 10') === '5, 8\n6, 9\n7, 10',
     'transposeText accepts the same delimiters as the parser');

  const one = cols('4.67');
  ok(!one.fromRow && one.cols.length === 1 && one.cols[0].length === 1,
     'pilotColumns: a single value is left as is (too short to summarize)');
  const rowSummary = PA.summarizeCol(cols('2, 4, 4, 4, 5, 5, 7, 9').cols[0]);
  ok(rowSummary.n === 8 && Math.abs(rowSummary.mean - 5) < 1e-12 &&
     Math.abs(rowSummary.sd - Math.sqrt(32 / 7)) < 1e-12,
     'summarizeCol on a row-entered list: n = 8, mean 5, s = sqrt(32/7)');
}
{
  /* A runaway noncentrality must terminate. The Poisson mixtures walk
     outward from term lambda, and an uncapped walk at lambda = 1e31 hung
     the page; each CDF now substitutes its large-lambda limit. The time
     bound is the check that matters -- these once did not return. */
  const timed = (label, fn, limit) => {
    const t0 = Date.now();
    const v = fn();
    const ms = Date.now() - t0;
    ok(ms < 2000, `${label} returns in ${ms}ms (was an unbounded walk)`);
    ok(Number.isFinite(v) && v >= 0 && v <= 1, `${label} = ${v} is a probability`);
    if (limit !== undefined)
      ok(Math.abs(v - limit) < 1e-9, `${label} = ${v} at its large-noncentrality limit ${limit}`);
    return v;
  };
  timed('nctCdf(2.09, 1, 1e16)', () => PA.nctCdf(2.09, 1, 1e16), 0);
  timed('nctCdf(2.09, 1, -1e16)', () => PA.nctCdf(2.09, 1, -1e16), 1);
  timed('ncx2Cdf(7.8, 3, 1e20)', () => PA.ncx2Cdf(7.8, 3, 1e20), 0);
  timed('ncfCdf(3.1, 2, 27, 1e20)', () => PA.ncfCdf(3.1, 2, 27, 1e20), 0);

  /* The Johnson-Welch form that stands in past the bound, checked against
     the series in the range where the series is still cheap. */
  for (const [t, nu, del] of [[3, 20, 6], [1.7, 12, 4], [5, 40, 9]]) {
    const series = PA.nctCdf(t, nu, del);
    const jw = PA.normCdf((t * (1 - 1 / (4 * nu)) - del) / Math.sqrt(1 + t * t / (2 * nu)));
    ok(Math.abs(series - jw) < 0.02,
       `Johnson-Welch within 0.02 of the nct series at t=${t}, nu=${nu}, del=${del}` +
       ` (${series.toFixed(5)} vs ${jw.toFixed(5)})`);
  }
  /* The normal approximation standing in for a large-noncentrality
     chi-square, checked the same way. */
  for (const [x, k, l] of [[40, 3, 30], [120, 5, 100]]) {
    const series = PA.ncx2Cdf(x, k, l);
    const nrm = PA.normCdf((x - (k + l)) / Math.sqrt(2 * (k + 2 * l)));
    ok(Math.abs(series - nrm) < 0.03,
       `ncx2 normal approximation within 0.03 of the series at x=${x}, k=${k}, l=${l}` +
       ` (${series.toFixed(5)} vs ${nrm.toFixed(5)})`);
  }

  /* A sample correlation is in [-1, 1]; only rounding takes it outside. */
  const perfect = PA.pairedSummary([1.1, 1.4], [1.2, 1.5]);
  ok(perfect.rho >= -1 && perfect.rho <= 1, `pairedSummary clamps rho to [-1, 1] (got ${perfect.rho})`);

  /* The regression itself: differences equal in exact arithmetic leave a
     residue of 1e-16, which must not be read as real spread. */
  const resid = PA.pairedSummary([1.1, 1.4], [1.2, 1.5]);
  ok(resid.sdD > 0 && resid.sdD < 1e-12,
     `paired differences that cancel leave only rounding (s_d = ${resid.sdD.toExponential(2)})`);
  const t1 = Date.now();
  const nAbsurd = PA.solveNAnalytic(PA.TESTS.t, { mu0: 0, mu1: 0.5, sigma: resid.sdD },
                                    0.05, 'two', 0.8);
  ok(Date.now() - t1 < 2000 && nAbsurd && nAbsurd.n === PA.TESTS.t.nMin,
     'solveNAnalytic with a rounding-residue sigma returns nMin promptly');
}

/* ═══ 11. The exported R formulas, executed in R ═══════════════════ */
section('11. Export-panel R formulas, run in R (skipped if Rscript is absent)');
let hasR = true;
try { execFileSync('Rscript', ['--version'], { stdio: 'pipe' }); } catch { hasR = false; }
if (!hasR) {
  console.log('  ' + Ct.d('SKIP  Rscript not found on PATH'));
} else {
  /* These lines are the same computations the widget's panel 5 emits for
     R, evaluated at one configuration each. */
  const rCode = `
fmt <- function(x) cat(sprintf("%.15g\\n", x))
fmt(power.t.test(n = 20, delta = 0.5, sd = 1, sig.level = 0.05,
                 type = "one.sample", alternative = "two.sided", strict = TRUE)$power)
fmt(power.t.test(n = 25, delta = 1.2, sd = 2, sig.level = 0.05,
                 type = "two.sample", alternative = "two.sided", strict = TRUE)$power)
means <- c(8, 9, 10)
fmt(power.anova.test(groups = 3, n = 10, between.var = var(means),
                     within.var = 2^2, sig.level = 0.05)$power)
v0 <- 4; v1 <- 8; n <- 25; alpha <- 0.05; nu <- n - 1; r <- v1/v0
fmt(pchisq(qchisq(alpha/2, nu)/r, nu) + pchisq(qchisq(1 - alpha/2, nu)/r, nu, lower.tail = FALSE))
n <- 50; p0 <- 0.3; p1 <- 0.5; alpha <- 0.05; k <- 0:n
klo <- max(c(-1, k[pbinom(k, n, p0) <= alpha/2]))
khi <- min(c(n + 1, k[pbinom(k - 1, n, p0, lower.tail = FALSE) <= alpha/2]))
fmt((klo >= 0)*pbinom(klo, n, p1) + (khi <= n)*pbinom(khi - 1, n, p1, lower.tail = FALSE))
p0 <- c(0.25, 0.25, 0.25, 0.25); p1 <- c(0.4, 0.2, 0.2, 0.2); n <- 100; alpha <- 0.05; kk <- length(p0)
fmt(1 - pchisq(qchisq(1 - alpha, kk - 1), kk - 1, ncp = n*sum((p1 - p0)^2/p0)))
b1 <- 0.4; sigma <- 1; sx <- 1; n <- 30; alpha <- 0.05
delta <- b1*sx*sqrt(n)/sigma; tc <- qt(1 - alpha/2, n - 2)
fmt(pt(tc, n - 2, ncp = delta, lower.tail = FALSE) + pt(-tc, n - 2, ncp = delta))
mu0 <- 0; mu1 <- 0.5; sigma <- 1; n <- 20; alpha <- 0.05
theta <- (mu1 - mu0)/(sigma/sqrt(n)); zc <- qnorm(1 - alpha/2)
fmt(pnorm(-zc - theta) + pnorm(zc - theta, lower.tail = FALSE))
muA <- 1.2; muB <- 0; sigma <- 2; r <- 2.5; alpha <- 0.05
pwp <- function(nA) {
  nB <- max(2, floor(r * nA + 0.5)); nu <- nA + nB - 2
  delta <- (muA - muB) / (sigma * sqrt(1/nA + 1/nB)); tc <- qt(1 - alpha/2, nu)
  pt(tc, nu, ncp = delta, lower.tail = FALSE) + pt(-tc, nu, ncp = delta)
}
fmt(pwp(12)); fmt(pwp(11))
muA <- 1; muB <- 0; sA <- 1; sB <- 3; r <- 0.5; alpha <- 0.05
pww <- function(nA) {
  nB <- max(2, floor(r * nA + 0.5)); vA <- sA^2 / nA; vB <- sB^2 / nB
  nu <- (vA + vB)^2 / (vA^2 / (nA - 1) + vB^2 / (nB - 1))
  delta <- (muA - muB) / sqrt(vA + vB); tc <- qt(1 - alpha/2, nu)
  pt(tc, nu, ncp = delta, lower.tail = FALSE) + pt(-tc, nu, ncp = delta)
}
fmt(pww(20)); fmt(pww(7))
`;
  const out = execFileSync('Rscript', ['-e', rCode], { encoding: 'utf8' })
    .trim().split('\n').map(Number);
  const mine = [
    PA.TESTS.t.analyticPower(20, { mu0: 0, mu1: 0.5, sigma: 1 }, 0.05, 'two'),
    PA.TESTS.t2.analyticPower(25, { muA: 1.2, muB: 0, sigma: 2 }, 0.05, 'two'),
    PA.TESTS.anova.analyticPower(10, { means: [8, 9, 10], sigma: 2 }, 0.05, 'right'),
    PA.TESTS['var'].analyticPower(25, { v0: 4, v1: 8 }, 0.05, 'two'),
    PA.TESTS.p.analyticPower(50, { p0: 0.3, p1: 0.5 }, 0.05, 'two'),
    PA.TESTS.gof.analyticPower(100, { p0v: [0.25, 0.25, 0.25, 0.25], p1v: [0.4, 0.2, 0.2, 0.2] }, 0.05, 'right'),
    PA.TESTS.reg.analyticPower(30, { b1: 0.4, sigma: 1, sx: 1 }, 0.05, 'two'),
    PA.TESTS.z.analyticPower(20, { mu0: 0, mu1: 0.5, sigma: 1 }, 0.05, 'two'),
    PA.TESTS.t2.analyticPower(12, { muA: 1.2, muB: 0, sigma: 2, r: 2.5 }, 0.05, 'two'),
    PA.TESTS.t2.analyticPower(11, { muA: 1.2, muB: 0, sigma: 2, r: 2.5 }, 0.05, 'two'),
    PA.TESTS.tw.analyticPower(20, { muA: 1, muB: 0, sigmaA: 1, sigmaB: 3, r: 0.5 }, 0.05, 'two'),
    PA.TESTS.tw.analyticPower(7, { muA: 1, muB: 0, sigmaA: 1, sigmaB: 3, r: 0.5 }, 0.05, 'two')
  ];
  const names = ['t (power.t.test strict)', 't2 (power.t.test strict)', 'anova (power.anova.test)',
                 'var (pchisq formula)', 'p (pbinom enumeration)', 'gof (pchisq ncp)',
                 'reg (pt ncp)', 'z (pnorm formula)',
                 'pooled t, n_A=12, r=2.5 (pt ncp formula)',
                 'pooled t, n_A=11, r=2.5: n_B = 27.5 rounds half up to 28',
                 'Welch approximation, n_A=20, r=0.5 (pt ncp at Welch df)',
                 'Welch approximation, n_A=7, r=0.5: n_B = 3.5 rounds half up to 4'];
  /* 1e-8: the t/F rows go through R's noncentral approximations */
  mine.forEach((v, i) => close(v, out[i], 1e-8, `R agrees: ${names[i]}`));
}

/* ═══ 12. The Monte Carlo template, run in each language ═══════════ */
section('12. Monte Carlo template of tab 5 (R, Python, MATLAB; skipped if absent)');
{
  const os = await import('node:os');
  const html = fs.readFileSync(HTML, 'utf8');
  const tpl = (id) => {
    const m = html.match(new RegExp(
      '<script type="text/plain" id="' + id + '">\n?([\\s\\S]*?)</scr' + 'ipt>'));
    if (!m) throw new Error('template ' + id + ' not found in the HTML');
    return m[1];
  };
  /* The exact answers for the template's worked example, with 4-SE bands
     at its m = 10000: the estimates are seeded and so deterministic, but
     the bands keep the check honest across interpreter-version changes. */
  const checkPair = (lang, ah, ph) => {
    ok(Math.abs(ah - 0.05) < 0.009,
       `${lang} template: attained alpha ${ah.toFixed(4)} near 0.05`);
    ok(Math.abs(ph - 0.5645) < 0.020,
       `${lang} template: power ${ph.toFixed(4)} near exact 0.5645`);
  };
  const marker = (out) => {
    const line = out.split('\n').find(l => l.startsWith('PAMC'));
    if (!line) throw new Error('no PAMC marker line in output:\n' + out);
    return line.trim().split(/\s+/).slice(1).map(Number);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mct-'));
  const runIf = (name, cmd, args, file, code, markerLine) => {
    try { execFileSync(cmd, ['--version'], { stdio: 'pipe' }); }
    catch { console.log('  ' + Ct.d(`SKIP  ${cmd} not found on PATH`)); return; }
    const f = path.join(tmp, file);
    fs.writeFileSync(f, code + '\n' + markerLine + '\n');
    const out = execFileSync(cmd, args.concat([f]), { encoding: 'utf8', timeout: 600000 });
    const [ah, ph] = marker(out);
    checkPair(name, ah, ph);
  };
  runIf('R', 'Rscript', [], 'pamc_tpl.R', tpl('mct-r'),
        'cat("PAMC", r0/m, r1/m, "\n")');
  runIf('Python', 'python3', [], 'pamc_tpl.py', tpl('mct-python'),
        'print("PAMC", r0/m, r1/m)');
  /* matlab -batch takes a command, not a file, and the script must sit on
     its path; -h serves as the presence probe (--version is not one). */
  let hasMatlab = true;
  try { execFileSync('which', ['matlab'], { stdio: 'pipe' }); } catch { hasMatlab = false; }
  if (!hasMatlab) {
    console.log('  ' + Ct.d('SKIP  matlab not found on PATH'));
  } else {
    const f = path.join(tmp, 'pamc_tpl.m');
    fs.writeFileSync(f, tpl('mct-matlab') + "\nfprintf('PAMC %.10f %.10f\\n', r0/m, r1/m);\n");
    const out = execFileSync('matlab',
      ['-batch', `cd('${tmp.replace(/'/g, "''")}'); pamc_tpl`],
      { encoding: 'utf8', timeout: 600000 });
    const [ah, ph] = marker(out);
    checkPair('MATLAB', ah, ph);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ═══ 13. Pooled against Welch on shared datasets ══════════════════ */
section('13. Pooled vs. Welch comparison: shared datasets and the pooled level');
{
  /* At equal standard deviations the comparison draws exactly the datasets
     the one-test engine draws at the same seed, and so each test's counts
     must equal that engine's, not merely agree statistically. */
  const p = { muA: 1.2, muB: 0, sigmaA: 2, sigmaB: 2, r: 2 };
  const c = PA.cmpRun(p, 12, 0.05, 'two', 5000, 4242); c.step(5000);
  const cr = c.result();
  const a = mc('t2', { muA: 1.2, muB: 0, sigma: 2, r: 2 }, 12, 0.05, 'two', 5000, 4242);
  const b = mc('tw', p, 12, 0.05, 'two', 5000, 4242);
  ok(cr.pool.alt === a.rejAlt && cr.pool.nul === a.rejNull,
     `pooled counts equal the one-test engine's (${cr.pool.alt}/${cr.pool.nul} vs ${a.rejAlt}/${a.rejNull})`);
  ok(cr.welch.alt === b.rejAlt && cr.welch.nul === b.rejNull,
     `Welch counts equal the one-test engine's (${cr.welch.alt}/${cr.welch.nul} vs ${b.rejAlt}/${b.rejNull})`);
  ok(cr.nA === 12 && cr.nB === 24, `group sizes n_A = 12, n_B = round(2 * 12) = 24 (got ${cr.nA}, ${cr.nB})`);
}
{
  /* sigmasAtRatio holds the root-mean-square sd, and so the standardized
     effect, while the ratio moves. */
  for (const rho of [0.25, 1, 3]) {
    const sg = PA.sigmasAtRatio(1.7, rho);
    close(Math.sqrt((sg.sigmaA ** 2 + sg.sigmaB ** 2) / 2), 1.7, 1e-14, `rms sd held at ratio ${rho}`);
    close(sg.sigmaB / sg.sigmaA, rho, 1e-14, `sd ratio is ${rho}`);
  }
}
{
  /* The textbook behavior (the Behrens-Fisher problem): with unequal groups,
     the pooled test is liberal when the SMALLER group has the larger
     variance and conservative when the larger group has it; with equal
     groups it stays near its level; Welch holds its level throughout. */
  const m = Math.min(MC_M, 40000);
  const lvl = (n, r, rho, seed) => {
    const sg = PA.sigmasAtRatio(1, rho);
    const run = PA.cmpRun({ muA: 0, muB: 0, sigmaA: sg.sigmaA, sigmaB: sg.sigmaB, r }, n, 0.05, 'two', m, seed);
    run.step(m);
    const x = run.result();
    return { pool: x.pool.nul / m, welch: x.welch.nul / m };
  };
  const lib = lvl(8, 3, 0.25, 6101), con = lvl(8, 3, 4, 6102), bal = lvl(15, 1, 0.25, 6103);
  ok(lib.pool > 0.15, `smaller group more variable (n 8 vs 24, sd ratio 4:1): pooled level ${lib.pool.toFixed(4)} > 0.15`);
  ok(con.pool < 0.015, `larger group more variable: pooled level ${con.pool.toFixed(4)} < 0.015`);
  ok(bal.pool > 0.045 && bal.pool < 0.07, `equal groups (15 and 15), sd ratio 4:1: pooled level ${bal.pool.toFixed(4)} in (0.045, 0.07)`);
  for (const [nm, v] of [['liberal case', lib], ['conservative case', con], ['equal groups', bal]])
    ok(v.welch > 0.04 && v.welch < 0.06, `Welch holds its level in the ${nm}: ${v.welch.toFixed(4)} in (0.04, 0.06)`);
}
{
  /* Keeping the statistics for the plots must not change a single count,
     and the kept decisions must sum to the counts, including Welch's,
     whose critical value varies by dataset. */
  const p = { muA: 1, muB: 0, sigmaA: 2, sigmaB: 1, r: 2.5 };
  const a = PA.cmpRun(p, 10, 0.05, 'two', 5000, 99, true); a.step(5000);
  const b = PA.cmpRun(p, 10, 0.05, 'two', 5000, 99); b.step(5000);
  const ra = a.result(), rb = b.result();
  ok(JSON.stringify([ra.pool, ra.welch]) === JSON.stringify([rb.pool, rb.welch]),
     'keeping statistics leaves every count unchanged');
  const sum = arr => arr.reduce((x, y) => x + y, 0);
  ok(sum(ra.stats.pool.nulRej) === ra.pool.nul && sum(ra.stats.pool.altRej) === ra.pool.alt &&
     sum(ra.stats.welch.nulRej) === ra.welch.nul && sum(ra.stats.welch.altRej) === ra.welch.alt,
     'kept decisions sum to the rejection counts for both tests and both arms');
  let beyond = 0;
  for (const t of ra.stats.pool.nul) if (t <= ra.critPool.lo || t >= ra.critPool.hi) beyond++;
  ok(beyond === ra.pool.nul, `pooled null statistics beyond the critical values (${beyond}) equal its count`);
  ok(ra.sample.a.length === 10 && ra.sample.b.length === 25, 'the kept sample has n_A = 10 and n_B = 25 values');
}
{
  /* The sweep stepper covers every ratio with its own run and the full
     count of replications. */
  const st = PA.cmpStages({ params: { muA: 1, muB: 0, sigmaA: 2, sigmaB: 1, r: 2.5 }, n: 10, alpha: 0.05,
                            sided: 'two', m: 1000, mSweep: 500, seed: 5, ratios: [0.25, 1, 4] });
  let guard = 0;
  while (!st.finished() && guard++ < 10000) st.step(137);
  const res = st.result();
  ok(res.head.m === 1000 && res.sweep.length === 3 && res.sweep.every(x => x.m === 500),
     `cmpStages runs the headline (m = ${res.head.m}) and every ratio (${res.sweep.map(x => x.ratio).join(', ')})`);
}

/* ═══ Summary ══════════════════════════════════════════════════════ */
console.log('\n' + Ct.b('══════════════════════════════════════════'));
console.log(Ct.b(`${pass} passed, ${fail} failed`));
if (failures.length) {
  console.log(Ct.r('\nFailures:'));
  failures.forEach(f => console.log('  ' + Ct.r('✗ ') + f));
}
process.exit(fail ? 1 : 0);
