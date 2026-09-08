#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for ci_explorer.html.  NOT shipped with the widget.

     node output_analysis/verify_ci_explorer.mjs

   Slices the block between the CI-CORE sentinels out of ci_explorer.html
   and runs it in a Node vm context, and so the code under test is byte-for-
   byte the code the page ships.  Reference values are exact identities,
   textbook t tables (to 1e-3), and closed-form moments of the function
   menu; the calibration sections count interval captures over
   CI_CALIB_REPS replications (default 20000; set the environment variable
   to shorten a smoke run).
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'ci_explorer.html');
const CALIB_REPS = Math.max(500, Number(process.env.CI_CALIB_REPS) || 20000);

function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== CI-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== CI-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('CI-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core))
    throw new Error('CI core references the DOM');
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN,
                Float64Array };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'ci_explorer.html#CI-CORE' });
  if (!ctx.CI) throw new Error('core ran but exported no CI namespace');
  return { CI: ctx.CI, lines: core.split('\n').length };
}

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
/* A capture rate over R replications is within `k` standard errors of `p`. */
function rateNear(got, p, R, k, label) {
  const se = Math.sqrt(p * (1 - p) / R);
  ok(Math.abs(got - p) <= k * se, `${label}  (${got.toFixed(4)} vs ${p}, ${k} SE = ${(k * se).toFixed(4)})`,
     `got ${got}, want ${p} ± ${(k * se).toFixed(5)}`);
}

const { CI, lines } = loadCore();
console.log(Ct.d(`core loaded: ${lines} lines between the CI-CORE sentinels; calibration uses ${CALIB_REPS} reps`));

/* ═══ 1. Special functions and interval builders ═════════════════════ */
section('1. Special functions (exact identities) and t quantiles (tables, 1e-3)');
close(CI.logGamma(0.5), 0.5 * Math.log(Math.PI), 1e-14, 'logGamma(1/2) = log sqrt(pi)');
close(CI.logGamma(6), Math.log(120), 1e-14, 'logGamma(6) = log 5!');
close(CI.gammaP(1, 0.7), 1 - Math.exp(-0.7), 1e-14, 'P(1,x) = 1 - e^-x');
close(CI.betaInc(2, 3, 0.5), 11 / 16, 1e-14, 'I_0.5(2,3) = 11/16');
close(CI.normCdf(0), 0.5, 1e-15, 'Phi(0) = 1/2');
close(CI.normCdf(1.959963984540054), 0.975, 1e-12, 'Phi(1.96) = 0.975');
close(CI.normInv(CI.normCdf(1.234567)), 1.234567, 1e-12, 'normInv inverts normCdf');
close(CI.normInv(0.975), 1.959963984540054, 1e-12, 'normInv(0.975)');
[[0.975, 1, 12.706], [0.975, 2, 4.303], [0.975, 4, 2.776], [0.975, 17, 2.110],
 [0.975, 29, 2.045], [0.9995, 4, 8.610], [0.995, 9, 3.250], [0.95, 9, 1.833],
 [0.9, 9, 1.383], [0.8, 9, 0.883]].forEach(([p, nu, want]) =>
  close(CI.tQuantile(p, nu), want, 1e-3, `t_{${p}, ${nu}} = ${want}`));
close(CI.tCdf(CI.tQuantile(0.31, 7), 7), 0.31, 1e-12, 't CDF/quantile round trip');

/* ciMean on a hand-checkable sample: 2, 4, 4, 4, 5, 5, 7, 9 has mean 5, s = sqrt(32/7). */
{
  const ci = CI.ciMean([2, 4, 4, 4, 5, 5, 7, 9], 0.95);
  close(ci.mean, 5, 1e-15, 'ciMean: mean');
  close(ci.s, Math.sqrt(32 / 7), 1e-14, 'ciMean: sample sd');
  ok(ci.df === 7, 'ciMean: df = n - 1');
  close(ci.h, 2.365 * Math.sqrt(32 / 7) / Math.sqrt(8), 1e-3, 'ciMean: h = t_{.975,7} s / sqrt(n)');
  close(ci.lo, ci.mean - ci.h, 1e-15, 'ciMean: lo');
  close(ci.hi, ci.mean + ci.h, 1e-15, 'ciMean: hi');
  ok(CI.captured(ci, 5) && !CI.captured(ci, 20), 'captured() brackets');
}
/* ciWelch: equal samples give diff 0, and the df formula reduces to 2(n-1) for equal variances. */
{
  const a = [1, 2, 3, 4, 5], b = [3, 4, 5, 6, 7];
  const w = CI.ciWelch(a, b, 0.95);
  close(w.diff, -2, 1e-15, 'ciWelch: difference of means');
  close(w.df, 8, 1e-12, 'ciWelch: Welch df = 8 for equal variances, n = 5');
  close(w.h, 2.306 * Math.sqrt(2.5 / 5 + 2.5 / 5), 1e-3, 'ciWelch: h = t_{.975,8} sqrt(s1^2/n1 + s2^2/n2)');
}
/* Seeded stream: reproducible and uniform in the crudest sense. */
{
  const r1 = CI.mulberry32(54321), r2 = CI.mulberry32(54321);
  ok(r1() === r2() && r1() === r2(), 'mulberry32 reproduces from a seed');
  const r = CI.mulberry32(7); let s = 0; for (let i = 0; i < 100000; i++) s += r();
  close(s / 100000, 0.5, 5e-3, 'mulberry32 mean ≈ 1/2');
}

/* ═══ 2. Tab ①: capture rate equals the confidence level ═══════════ */
section('2. Tab ①: capture rate = confidence level (' + CALIB_REPS + ' reps per cell, 4 SE)');
[[5, 0.95, 0.1], [18, 0.95, 0.1], [18, 0.6, 1], [30, 0.999, 2], [200, 0.9, 1], [10, 0.8, 0.5]]
  .forEach(([n, conf, sigma]) => {
    let hits = 0;
    for (let r = 0; r < CALIB_REPS; r++) hits += CI.runNormal(1000 + r, { mu: 5, sigma: sigma, n: n, conf: conf }).hit ? 1 : 0;
    rateNear(hits / CALIB_REPS, conf, CALIB_REPS, 4, `n=${n}, ${(conf * 100).toFixed(1)}%, σ=${sigma}`);
  });
/* E[h] = t c4(n) σ/√n exactly for a normal sample; the mean half-width over the
   reps should sit within 1% of it at the spreadsheet's 18 (the widget's default is 20). */
{
  let sumH = 0; const n = 18, sigma = 0.1, conf = 0.95;
  for (let r = 0; r < CALIB_REPS; r++) sumH += CI.runNormal(5000 + r, { mu: 5, sigma: sigma, n: n, conf: conf }).ci.h;
  const want = CI.tQuantile(0.975, n - 1) * CI.c4(n) * sigma / Math.sqrt(n);
  close(sumH / CALIB_REPS, want, 0.01, 'mean half-width at n = 18, σ = 0.1 equals t·c4·σ/√n');
  close(CI.c4(18), 0.98540, 1e-4, 'c4(18) = 0.98540');
}
{
  const rec = CI.histRecord(5.01, { lo: 4.9, hi: 5.1 }, 5, 18, 0.95, 'k');
  ok(rec.est === 5.01 && rec.lo === 4.9 && rec.hi === 5.1 && rec.truth === 5 && rec.hit === true
     && rec.n === 18 && Math.abs(rec.alpha - 0.05) < 1e-12 && rec.key === 'k', 'histRecord shape');
}

/* ═══ 3. Tab ②: systems fed the same or different random numbers ═════ */
section('3. Tab ②: cross moments, capture in both arms, paired/Welch width ratio, detection');
close(CI.funcCross(CI.FUNCS.exp, CI.FUNCS.exp), CI.FUNCS.exp.m2, 1e-9, 'funcCross(exp, exp) = E[exp(U)²]');
close(CI.funcCross(CI.FUNCS.sqrt, CI.FUNCS.sqrt), 0.5, 1e-9, 'funcCross(sqrt, sqrt) = 1/2');
close(CI.funcCross(CI.FUNCS.exp, CI.FUNCS.bowl), 1.25 * Math.E - 3.25, 1e-9, 'funcCross(exp, bowl) = 5e/4 − 13/4');
close(CI.funcCross(CI.FUNCS.exp, CI.FUNCS.recip), 1.1253860830832698, 1e-8, 'funcCross(exp, recip) = (Ei(2) − Ei(1))/e');
{
  const R3 = Math.max(500, Math.floor(CALIB_REPS / 4));
  const cases = [['exp', 'exp', 'same model: strong positive correlation'], ['exp', 'recip', 'opposite responses: pairing widens the interval'], ['bowl', 'bowl', 'no monotone response']];
  let detSame = 0, detOpp = 0;
  cases.forEach(([fn1, fn2, label]) => {
    const p = { fn1: fn1, fn2: fn2, shift2: 0.5, sigE: 0.1, n: 10, conf: 0.95 };
    let hi = 0, hc = 0, sumHi = 0, sumHc = 0, det = 0;
    for (let r = 0; r < R3; r++) {
      const run = CI.runCRN(2000 + r, p);
      hi += run.hitInd ? 1 : 0; hc += run.hitCrn ? 1 : 0; sumHi += run.ind.h; sumHc += run.crn.h;
      det += (run.crn.lo > 0 || run.crn.hi < 0) ? 1 : 0;
    }
    rateNear(hi / R3, 0.95, R3, 6, `${fn1}/${fn2}: Welch interval captures δ`);
    rateNear(hc / R3, 0.95, R3, 6, `${fn1}/${fn2}: paired interval captures δ`);
    const pred = CI.crnPredicted(p);
    const want = pred.ratio * CI.tQuantile(0.975, 9) / CI.tQuantile(0.975, 18) * CI.c4(10) / CI.c4(19);
    close(sumHc / sumHi, want, 0.08, `${fn1}/${fn2} (${label}): mean paired/Welch half-width ratio ≈ ${want.toFixed(3)}`);
    if (fn1 === 'exp' && fn2 === 'exp') detSame = det / R3;
    if (fn2 === 'recip') detOpp = det / R3;
  });
  ok(CI.crnPredicted({ fn1: 'exp', fn2: 'recip', shift2: 0.5, sigE: 0.1 }).rho < 0, 'exp/recip: predicted correlation is negative');
  ok(detSame > detOpp, `detection with common inputs is higher for exp/exp (${detSame.toFixed(3)}) than exp/recip (${detOpp.toFixed(3)})`);
  const run = CI.runCRN(1, { fn1: 'exp', fn2: 'sqrt', shift2: 0.5, sigE: 0.1, n: 10, conf: 0.95 });
  close(run.truth, 2 / 3 + 0.5 - (Math.E - 1), 1e-15, 'truth is E[h2] + shift − E[h1]');
  close(run.d[3], run.y2c[3] - run.y1[3], 1e-15, 'differences are y2 − y1 under common inputs');
  ok(run.u.length === 10 && run.u2.length === 10, 'both input streams returned');
  /* The p-value and the interval agree by construction: p < α exactly when 0 lies
     outside the interval. */
  {
    let agree = 0, N = 400;
    for (let r = 0; r < N; r++) {
      const run = CI.runCRN(12000 + r, { fn1: 'exp', fn2: 'sqrt', shift2: 0.3, sigE: 0.1, n: 10, conf: 0.95 });
      const exclInd = run.ind.lo > 0 || run.ind.hi < 0, exclCrn = run.crn.lo > 0 || run.crn.hi < 0;
      agree += ((run.pInd < 0.05) === exclInd && (run.pCrn < 0.05) === exclCrn) ? 1 : 0;
    }
    ok(agree === N, `p < α exactly when the interval excludes 0 (${agree} of ${N} runs, both arms)`);
  }
  /* With no true difference, the star rate is the false-positive rate α. */
  {
    const R = Math.max(500, Math.floor(CALIB_REPS / 4)); let fp = 0;
    for (let r = 0; r < R; r++) fp += CI.runCRN(13000 + r, { fn1: 'exp', fn2: 'exp', shift2: 0, sigE: 0.1, n: 10, conf: 0.95 }).pCrn < 0.05 ? 1 : 0;
    rateNear(fp / R, 0.05, R, 6, 'exp/exp, shift 0: paired p < 0.05 rate is about α');
  }
  close(CI.pValueZero(2.262, 1, 9), 0.05, 2e-3, 'pValueZero(t_{.975,9}, 1, 9) = 0.05');
  /* The identity on both systems, with no noise: system 2's output under common inputs
     is exactly system 1's output plus the shift, and so every paired difference equals
     the shift exactly, and the paired interval is a single point sitting on the truth.
     The independent arm draws its own fresh input for system 2, and so it keeps
     ordinary sampling variability and should still capture at the nominal rate. */
  {
    const R = 200, p = { fn1: 'ident', fn2: 'ident', shift2: 0.5, sigE: 0, n: 10, conf: 0.95 };
    let allZeroH = true, allHitCrn = true, hitsInd = 0;
    for (let r = 0; r < R; r++) {
      const run = CI.runCRN(70000 + r, p);
      if (run.crn.h !== 0) allZeroH = false;
      if (!run.hitCrn) allHitCrn = false;
      hitsInd += run.hitInd ? 1 : 0;
    }
    ok(allZeroH, 'ident/ident, shift 0.5, σₑ = 0, 200 seeds: run.crn.h === 0 in every run');
    ok(allHitCrn, 'ident/ident, shift 0.5, σₑ = 0, 200 seeds: paired interval captures δ = 0.5 in every run');
    rateNear(hitsInd / R, 0.95, R, 4, 'ident/ident, shift 0.5, σₑ = 0, 200 seeds: Welch interval captures δ at about 95%');
  }
}

/* ═══ 4. Tab ③: function moments, antithetic variance, capture ════ */
section('4. Tab ③: function-menu moments (closed form), antithetic SE, capture');
CI.FUNC_KEYS.forEach(k => {
  const f = CI.FUNCS[k], rand = CI.mulberry32(99), N = 200000;
  let s1 = 0, s2 = 0, sc = 0, su = 0;
  for (let i = 0; i < N; i++) {
    const u = rand(), y = f.h(u), yb = f.h(1 - u);
    s1 += y; s2 += y * y; sc += y * yb; su += (u - 0.5) * y;
  }
  close(s1 / N, f.mean, 0.01, `${k}: E[h] = ${f.mean.toFixed(5)}`);
  close(s2 / N, f.m2, 0.01, `${k}: E[h²] = ${f.m2.toFixed(5)}`);
  close(sc / N, f.cross, 0.01, `${k}: E[h(U) h(1−U)] = ${f.cross.toFixed(5)}`);
  close(su / N, f.covU, k === 'bowl' ? 1e-3 : 0.05, `${k}: cov(U, h(U)) = ${f.covU.toFixed(5)}`);
});
/* The identity's moments are exact rationals, and funcCross against a second model
   has a closed form too. funcCross(f1, f2) evaluates both functions at the same
   argument (E[h1(U) h2(U)], confirmed above by funcCross(exp, bowl) against
   1.25e - 3.25), and so funcCross(exp, ident) = integral of u e^u du over [0, 1] =
   [u e^u - e^u] from 0 to 1 = (e - e) - (0 - 1) = 1, not integral of e^u (1 - u)
   du = e - 2, which is the antithetic-pair cross moment E[h1(U) h2(1 - U)]
   instead (the field FUNCS carries, not what this function computes). */
close(CI.funcVar(CI.FUNCS.ident), 1 / 12, 1e-15, 'ident: Var(U) = m2 - mean^2 = 1/3 - 1/4 = 1/12');
close(CI.funcAntiCov(CI.FUNCS.ident), -1 / 12, 1e-15, 'ident: cov(U, 1-U) = cross - mean^2 = 1/6 - 1/4 = -1/12');
close(CI.funcCross(CI.FUNCS.exp, CI.FUNCS.ident), 1, 1e-9, 'funcCross(exp, ident) = integral of u e^u du over [0, 1] = 1');
{
  const f = CI.FUNCS.exp, R = 2000; let sumSe = 0, sumSeInd = 0;
  for (let r = 0; r < R; r++) {
    const run = CI.runAV(3000 + r, { fn: 'exp', n: 500, conf: 0.95 });
    sumSe += run.av.s / Math.sqrt(500);
    sumSeInd += run.ind.s / Math.sqrt(500);
  }
  const wantSe = Math.sqrt((CI.funcVar(f) + CI.funcAntiCov(f)) / 2 / 500);
  close(wantSe, 0.0028, 0.02, 'exp, 500 pairs: closed-form SE of the antithetic pair-mean average is 0.0028');
  close(sumSe / R, wantSe, 0.03, 'exp, 500 pairs: mean antithetic sample SE matches the closed form');
  /* The independent arm's pair mean averages two uncorrelated evaluations, and so its
     variance is simply half of a single draw's: Var(W) = funcVar(f) / 2, and the SE
     of the mean of 500 such pairs is sigma / sqrt(2 * 500) with sigma^2 = funcVar(f). */
  const wantSeInd = Math.sqrt(CI.funcVar(f) / 2 / 500);
  close(wantSeInd, 0.01556, 0.005, 'exp, 500 pairs: closed-form SE of the independent pair-mean average is 0.0156');
  close(sumSeInd / R, wantSeInd, 0.03, 'exp, 500 pairs: mean independent sample SE matches the closed form');
  const R2 = Math.max(500, Math.floor(CALIB_REPS / 4));
  let hits = 0, hitsInd = 0, sumRatio = 0;
  for (let r = 0; r < R2; r++) {
    const run = CI.runAV(4000 + r, { fn: 'exp', n: 25, conf: 0.95 });
    hits += run.hitAv ? 1 : 0; hitsInd += run.hitInd ? 1 : 0;
  }
  /* Pair means of exp(U) are bounded and skewed, and so the t interval on 25 of them
     runs a little under nominal; 6 SE allows for that without hiding a real bug. */
  rateNear(hits / R2, 0.95, R2, 6, 'exp, 25 pairs: antithetic interval captures E[h]');
  rateNear(hitsInd / R2, 0.95, R2, 6, 'exp, 25 pairs: independent interval captures E[h]');
  /* Both arms now average n pairs, and so their pair-mean variances S_z^2 and S_w^2
     compare directly: Var(Z)/Var(W) = 1 + rho, where rho is the exact correlation of
     h(U) and h(1 − U) from the function's own moments. */
  const R3 = Math.max(500, Math.floor(CALIB_REPS / 8));
  for (let r = 0; r < R3; r++) {
    const run = CI.runAV(4500 + r, { fn: 'exp', n: 50, conf: 0.95 });
    sumRatio += (run.av.s * run.av.s) / (run.ind.s * run.ind.s);
  }
  const rho = CI.funcAntiCov(f) / CI.funcVar(f);
  close(sumRatio / R3, 1 + rho, 0.05, `exp, 50 pairs: mean S_z^2/S_w^2 (${(sumRatio / R3).toFixed(3)}) is near 1 + rho = ${(1 + rho).toFixed(3)}`);
  let wider = 0;
  for (let r = 0; r < 500; r++) { const run = CI.runAV(5000 + r, { fn: 'bowl', n: 25, conf: 0.95 }); wider += run.av.h > run.ind.h ? 1 : 0; }
  ok(wider / 500 > 0.9, `bowl: antithetic interval wider than the independent one in ${wider} of 500 runs`);
  const run = CI.runAV(1, { fn: 'sqrt', n: 10, conf: 0.95 });
  ok(run.w.length === 10 && run.z.length === 10, 'runAV: n independent pair means, n antithetic pair means');
  /* Replay the same stream directly: the first n draws feed ya/yb/z, and only then does
     the independent arm draw its n fresh partners, and so run.w[3] should equal
     (h(u_3) + h(v_3)) / 2 for the fourth of those fresh draws. */
  {
    const f2 = CI.FUNCS.sqrt, rr = CI.mulberry32(1), us = [], fresh = [];
    for (let i = 0; i < 10; i++) us.push(rr());
    for (let i = 0; i < 10; i++) fresh.push(rr());
    close(run.u[3], us[3], 1e-15, 'runAV: shared draws come first in the stream');
    close(run.w[3], (f2.h(us[3]) + f2.h(fresh[3])) / 2, 1e-15, 'runAV: independent pair mean averages the shared draw with a fresh one');
  }
  close(run.z[2], (run.ya[2] + run.yb[2]) / 2, 1e-15, 'runAV: antithetic pair mean');
  close(run.w[2], (run.ya[2] + run.yw[2]) / 2, 1e-15, 'runAV: independent pair mean from the returned yw field');
  /* Own noise sigE added to every output: Cov(Ya, Yb) = Cov(h(U), h(1 - U)) is unchanged
     because the noise is independent of h and of the other arm's noise, but each variance
     grows by sigE^2, and so the pair correlation shrinks to rho * Var h / (Var h + sigE^2).
     Both arms should still capture E[h] near their nominal rate, and the S_z^2/S_w^2 ratio
     should track 1 plus that shrunken correlation, exactly as the noiseless check above
     tracks 1 plus the unshrunken one. */
  {
    const sigE = 0.3, varH = CI.funcVar(f), wantRhoN = rho * varH / (varH + sigE * sigE);
    const R4 = Math.max(500, Math.floor(CALIB_REPS / 4));
    let hitsAv = 0, hitsInd = 0, sumR = 0, sumRatioN = 0;
    for (let r = 0; r < R4; r++) {
      const run4 = CI.runAV(30000 + r, { fn: 'exp', n: 50, conf: 0.95, sigE: sigE });
      hitsAv += run4.hitAv ? 1 : 0; hitsInd += run4.hitInd ? 1 : 0;
      sumR += run4.r; sumRatioN += (run4.av.s * run4.av.s) / (run4.ind.s * run4.ind.s);
    }
    rateNear(hitsAv / R4, 0.95, R4, 6, 'exp, 50 pairs, sigE = 0.3: antithetic interval captures E[h]');
    rateNear(hitsInd / R4, 0.95, R4, 6, 'exp, 50 pairs, sigE = 0.3: independent interval captures E[h]');
    const gotR = sumR / R4;
    ok(Math.abs(gotR - wantRhoN) <= 0.03,
       `exp, sigE = 0.3: mean sample pair correlation ${gotR.toFixed(3)} within ±0.03 of rho_h * Var h / (Var h + sigE²) = ${wantRhoN.toFixed(3)}`);
    close(sumRatioN / R4, 1 + wantRhoN, 0.05,
      `exp, 50 pairs, sigE = 0.3: mean S_z^2/S_w^2 (${(sumRatioN / R4).toFixed(3)}) is near 1 + rho = ${(1 + wantRhoN).toFixed(3)}`);
  }
}
/* The identity is the linear limit: every antithetic pair mean is exactly 0.5, and
   so the pair sample has zero spread (guarded to exactly s = 0, h = 0 in ciMean), and
   its interval sits on the truth in every run. ya = u and yb = 1 - u are an exact
   linear pair, and so their sample correlation is -1 to floating-point precision on
   every run, not only on average. */
{
  const R = 200; let allZero = true, allHit = true, allNegOne = true;
  for (let r = 0; r < R; r++) {
    const run = CI.runAV(50000 + r, { fn: 'ident', n: 25, conf: 0.95 });
    if (run.av.s !== 0 || run.av.h !== 0) allZero = false;
    if (!run.hitAv) allHit = false;
    if (Math.abs(run.r - (-1)) > 1e-9) allNegOne = false;
  }
  ok(allZero, 'ident, 25 pairs, 200 seeds: run.av.s === 0 and run.av.h === 0 in every run');
  ok(allHit, 'ident, 25 pairs, 200 seeds: antithetic interval captures E[h] in every run');
  ok(allNegOne, 'ident, 25 pairs, 200 seeds: sample pair correlation r within 1e-9 of -1 in every run');
}

/* ═══ 5. Tab ④: control variates ═════════════════════════════════ */
section('5. Tab ④: c* against closed form, capture at n = 50, shortfall at n = 10');
CI.FUNC_KEYS.forEach(k => {
  const run = CI.runCV(11, { fn: k, n: 200000, conf: 0.95 }), want = CI.FUNCS[k].covU * 12;
  if (k === 'bowl') ok(Math.abs(run.c) < 0.01, `bowl: estimated c ≈ 0 (${run.c.toFixed(4)})`);
  else close(run.c, want, 0.05, `${k}: estimated c ≈ c* = ${want.toFixed(4)}`);
  close(run.cStar, want, 1e-15, `${k}: cStar field carries the closed form`);
});
close(CI.FUNCS.exp.covU * 12, 1.6903, 1e-3, 'exp: c* = 1.690 (a 1000-draw estimate gives about 1.686)');
{
  const R = Math.max(500, Math.floor(CALIB_REPS / 4));
  let h50 = 0, h10 = 0, hp = 0, narrower = 0, sumRatioBowl = 0;
  for (let r = 0; r < R; r++) {
    const a = CI.runCV(6000 + r, { fn: 'exp', n: 50, conf: 0.95 });
    hp += a.hitPlain ? 1 : 0; h50 += a.hitCv ? 1 : 0; narrower += a.cv.h < a.plain.h ? 1 : 0;
    const b = CI.runCV(7000 + r, { fn: 'exp', n: 10, conf: 0.95 });
    h10 += b.hitCv ? 1 : 0;
    const w = CI.runCV(8000 + r, { fn: 'bowl', n: 50, conf: 0.95 });
    sumRatioBowl += w.cv.h / w.plain.h;
  }
  rateNear(hp / R, 0.95, R, 6, 'exp, n = 50: plain interval captures E[h]');
  const c50 = h50 / R, c10 = h10 / R;
  ok(c50 >= 0.90 && c50 <= 0.965, `exp, n = 50: control-variate capture ${c50.toFixed(3)} within [0.90, 0.965] (true rate about 0.93)`);
  ok(c10 >= 0.78 && c10 <= 0.90, `exp, n = 10: control-variate capture ${c10.toFixed(3)} within [0.78, 0.90] (estimating c from the same ten draws costs about ten points of coverage)`);
  ok(narrower / R > 0.99, `exp, n = 50: control-variate interval narrower in ${narrower} of ${R} runs`);
  close(sumRatioBowl / R, 1, 0.05, 'bowl, n = 50: mean half-width ratio ≈ 1 (no reduction without covariance)');
}
/* With its own noise sigE added to every output: c* is unchanged (Cov(U, Y) =
   Cov(U, h(U)) regardless of sigE) but r² falls by the factor
   Var h / (Var h + sigE^2), and both arms should still capture E[h] near their
   nominal rate. */
{
  const f = CI.FUNCS.exp, varH = CI.funcVar(f), varU = 1 / 12, sigE = 0.3;
  const rhoUh2 = (f.covU * f.covU) / (varU * varH);
  const wantR2 = rhoUh2 * varH / (varH + sigE * sigE);
  const R = Math.max(500, Math.floor(CALIB_REPS / 4));
  let hp = 0, hc = 0, sumC = 0, sumR2 = 0;
  for (let r = 0; r < R; r++) {
    const run = CI.runCV(20000 + r, { fn: 'exp', n: 50, conf: 0.95, sigE: sigE });
    hp += run.hitPlain ? 1 : 0; hc += run.hitCv ? 1 : 0;
    sumC += run.c; sumR2 += run.r2;
  }
  rateNear(hp / R, 0.95, R, 6, 'exp, n = 50, sigE = 0.3: plain interval captures E[h]');
  const c50n = hc / R;
  ok(c50n >= 0.90 && c50n <= 0.965, `exp, n = 50, sigE = 0.3: control-variate capture ${c50n.toFixed(3)} within [0.90, 0.965]`);
  close(sumC / R, f.covU * 12, 0.04, 'exp, sigE = 0.3: mean estimated c ≈ c* = 1.690 (noise does not move c*)');
  const gotR2 = sumR2 / R;
  ok(Math.abs(gotR2 - wantR2) <= 0.02,
     `exp, sigE = 0.3: mean r² ${gotR2.toFixed(4)} within ±0.02 of ρ²_Uh · Var h / (Var h + σₑ²) = ${wantR2.toFixed(4)}`);
}
/* The identity is the linear limit: Y = U exactly, and so the fitted slope c is 1,
   and the control removes all of Y's variance, r² = 1, and z = Y - 1·(U - 0.5) = 0.5
   in every draw (guarded to exactly s = 0, h = 0 in ciMean), and so the interval
   sits on the truth in every run. */
{
  const R = 200; let allC = true, allR2 = true, allHit = true;
  for (let r = 0; r < R; r++) {
    const run = CI.runCV(60000 + r, { fn: 'ident', n: 50, conf: 0.95 });
    if (Math.abs(run.c - 1) > 1e-9) allC = false;
    if (Math.abs(run.r2 - 1) > 1e-9) allR2 = false;
    if (!run.hitCv) allHit = false;
  }
  ok(allC, 'ident, n = 50, 200 seeds: estimated c within 1e-9 of 1 in every run');
  ok(allR2, 'ident, n = 50, 200 seeds: r² within 1e-9 of 1 in every run');
  ok(allHit, 'ident, n = 50, 200 seeds: control-variate interval captures E[h] in every run');
}
/* ═══ 6. Tab ⑤: importance sampling on the three-model menu ══════════ */
section('6. Tab ⑤: weighted estimator unbiased, capture at n = 1000, direct sampling fails at T = 5');
/* A fine composite trapezoid rule; the model integrand is Schwartz-class (a
   Gaussian density times at most a polynomial change-of-variable factor), and
   so this converges far faster than the textbook O(h²) bound suggests—every
   quadrature check below lands at 1e-9 or tighter against a 1e-6 tolerance. */
function trapz(f, lo, hi, m) {
  var h = (hi - lo) / m, s = 0.5 * (f(lo) + f(hi));
  for (var i = 1; i < m; i++) s += f(lo + i * h);
  return s * h;
}
close(1 - CI.normCdf(5), 2.8665e-7, 1e-3, 'P(X ≥ 5) = 2.8665e-7');
close(CI.isWeight(5, 5), Math.exp(-12.5), 1e-12, 'W(5) at θ = 5 is exp(−25 + 12.5)');
[3, 5].forEach(T => {
  const R = 2000; let s = 0;
  for (let r = 0; r < R; r++) s += CI.runIS(8000 + r, { fn: 'ident', T: T, theta: T, n: 1000, conf: 0.95 }).wtd.mean;
  const want = 1 - CI.normCdf(T);
  close(s / R, want, 0.02, `ident, T=${T}, θ=${T}: mean weighted estimate over ${R} runs ≈ ${want.toExponential(4)}`);
});
{
  const R = Math.max(500, Math.floor(CALIB_REPS / 8)); let h = 0;
  for (let r = 0; r < R; r++) h += CI.runIS(9000 + r, { fn: 'ident', T: 3, theta: 3, n: 1000, conf: 0.95 }).hitWtd ? 1 : 0;
  const c = h / R;
  ok(c >= 0.92 && c <= 0.97, `ident, T=3, θ=3, n=1000: weighted interval capture ${c.toFixed(3)} within [0.92, 0.97]`);
  let miss = 0;
  for (let r = 0; r < 2000; r++) miss += CI.runIS(10000 + r, { fn: 'ident', T: 5, theta: 5, n: 1000, conf: 0.95 }).hitDirect ? 0 : 1;
  /* About 0.6 of the 2000 runs are expected to see one tail event; allow up to ten. */
  ok(miss / 2000 >= 0.995, `ident, T=5, n=1000: direct interval misses in ${miss} of 2000 runs (its interval is [0, 0])`);
  let h3 = 0, h6 = 0;
  for (let r = 0; r < 300; r++) {
    h3 += CI.runIS(11000 + r, { fn: 'ident', T: 3, theta: 3, n: 1000, conf: 0.95 }).wtd.h;
    h6 += CI.runIS(11000 + r, { fn: 'ident', T: 3, theta: 6, n: 1000, conf: 0.95 }).wtd.h;
  }
  ok(h6 > h3, `ident, T=3: shifting too far (θ=6) widens the interval again (mean h ${(h6 / 300).toExponential(2)} > ${(h3 / 300).toExponential(2)})`);
  const run = CI.runIS(1, { fn: 'ident', T: 3, theta: 3, n: 100, conf: 0.95 });
  ok(run.ys.length === 100 && run.w.length === 100 && run.tail === run.w.filter(v => v > 0).length, 'runIS: series lengths and tail count');
  ok(run.ess > 0 && run.ess <= run.tail, 'runIS: effective sample size between 0 and the tail count');
  /* hs and lr are new fields: hs the biased draws' model outputs, lr their full
     likelihood ratios (every draw, not only the ones in the event). Checked
     against a non-identity model, so that hs[i] === h(ys[i]) is a real test of
     applying the model rather than a pass-through. */
  const runSq = CI.runIS(1, { fn: 'sq', T: 9, theta: 3, n: 100, conf: 0.95 });
  ok(runSq.lr.length === 100, 'runIS: lr has one entry per draw (lr.length === n)');
  ok(runSq.hs.every((v, i) => v === CI.IS_FUNCS.sq.h(runSq.ys[i])), 'runIS: hs[i] === h(ys[i])');
  ok(runSq.w.every((v, i) => v === (runSq.hs[i] >= 9 ? runSq.lr[i] : 0)), 'runIS: w[i] === (hs[i] >= T ? lr[i] : 0)');
  /* xs and hxs are new fields too (Task 7l): the direct arm's own inputs and
     their outputs, added for the transfer plot's direct-sample view. Checked
     against the same non-identity model, so that hxs[i] === h(xs[i]) is a
     real test of applying the model rather than a pass-through, and hits,
     already checked above as a raw count, is cross-checked here against the
     count of hxs at or beyond T. */
  ok(runSq.xs.length === 100 && runSq.hxs.length === 100, 'runIS: xs and hxs have one entry per draw');
  ok(runSq.hxs.every((v, i) => v === CI.IS_FUNCS.sq.h(runSq.xs[i])), 'runIS: hxs[i] === h(xs[i])');
  ok(runSq.hits === runSq.hxs.filter(v => v >= 9).length, 'runIS: hits === count(hxs >= T)');
}

/* ── The three-model menu's output densities: each integrates to 1, and the
   mass beyond the default T matches the closed-form truth(T) to 1e-6.
   ident has no singularity and integrates directly. exp and sq have a 1/y (or
   1/√y) factor that blows up as y → 0, and so each uses the change of variable
   that its own derivation is built on (y = e^x for exp, y = t² for sq) to turn
   the integrand into a smooth, bounded one before handing it to trapz—exactly
   the substitution named in the outDensity comment above IS_FUNCS. sq's t = 0
   endpoint is still a removable singularity of the un-substituted density (finite
   in the limit, but 0/0 as coded), and so its grid starts a hair above 0 rather
   than at it; the sliver this discards is under 1e-8, far inside the 1e-6
   tolerance. */
section('6a. output densities integrate to 1, and the tail beyond T matches truth(T), to 1e-6');
{
  const M = 100000;
  const id = CI.IS_FUNCS.ident, idT = id.defaultT;
  close(trapz(y => id.outDensity(y, 0), -60, 60, M), 1, 1e-6, 'ident: outDensity(y, 0) integrates to 1');
  close(trapz(y => id.outDensity(y, 3), -60, 60, M), 1, 1e-6, 'ident: outDensity(y, 3) integrates to 1');
  close(trapz(y => id.outDensity(y, 0), idT, 60, M), CI.isTruth('ident', idT), 1e-6, `ident: mass beyond T = ${idT} equals truth(T)`);

  const ex = CI.IS_FUNCS.exp, exT = ex.defaultT, exWay = ex.wayIn(exT);
  const expMass = (theta, xLo, xHi) => trapz(x => ex.outDensity(Math.exp(x), theta) * Math.exp(x), xLo, xHi, M);
  close(expMass(0, -40, 40), 1, 1e-6, 'exp: outDensity(y, 0) integrates to 1 (y = e^x change of variable)');
  close(expMass(3, -40, 40), 1, 1e-6, 'exp: outDensity(y, 3) integrates to 1');
  close(expMass(0, exWay, 40), CI.isTruth('exp', exT), 1e-6, `exp: mass beyond T = ${exT} equals truth(T)`);

  const sq = CI.IS_FUNCS.sq, sqT = sq.defaultT, sqWay = sq.wayIn(sqT);
  const sqMass = (theta, tLo, tHi) => trapz(t => sq.outDensity(t * t, theta) * 2 * t, tLo, tHi, M);
  close(sqMass(0, 1e-8, 40), 1, 1e-6, 'sq: outDensity(y, 0) integrates to 1 (y = t² change of variable)');
  close(sqMass(3, 1e-8, 40), 1, 1e-6, 'sq: outDensity(y, 3) integrates to 1');
  close(sqMass(0, sqWay, 40), CI.isTruth('sq', sqT), 1e-6, `sq: mass beyond T = ${sqT} equals truth(T)`);
}

/* ── Each model at its default T with θ aimed at the (right) way in ────
   n = 1000, 200 seeds: the weighted estimator is unbiased against the sample's
   own spread, and the weighted interval captures near the nominal rate. This
   holds for ident and exp, whose one way in is fully covered by θ. sq is
   deliberately excluded here—see the dedicated block below, which is where
   its very different behavior at this same configuration belongs. */
section('6b. ident and exp at defaultT, θ = wayIn(T), n = 1000, 200 seeds: unbiased and calibrated');
{
  const R = 200;
  ['ident', 'exp'].forEach(key => {
    const f = CI.IS_FUNCS[key], T = f.defaultT, theta = f.wayIn(T), truth = f.truth(T);
    const ests = []; let hits = 0;
    for (let r = 0; r < R; r++) {
      const run = CI.runIS(80000 + r, { fn: key, T: T, theta: theta, n: 1000, conf: 0.95 });
      ests.push(run.wtd.mean); if (run.hitWtd) hits++;
    }
    const m = CI.mean(ests), se = Math.sqrt(CI.sampleVar(ests) / R);
    ok(Math.abs(m - truth) <= 4 * se,
       `${key}, T=${T}, θ=${theta.toFixed(4)}: mean weighted estimate ${m.toExponential(4)} within 4 SE (${(4 * se).toExponential(2)}) of truth ${truth.toExponential(4)}`);
    rateNear(hits / R, 0.95, R, 4, `${key}, T=${T}, θ=${theta.toFixed(4)}: weighted capture rate`);
  });
}

/* ── sq at its default T = 9, θ = 3 = wayIn(9): the "two ways in" silent
   failure ──
   A one-sided shift covers the right way in (x ≥ 3) and never visits the left
   (x ≤ −3), and so the weighted estimate settles at half the truth with a
   narrow interval that misses every time, and nothing in the sample warns:
   ESS looks as healthy as it does on the identity because the uncovered side
   is simply absent from the sample rather than represented by a few huge
   weights. The estimator is unbiased only in the sense that an astronomically
   rare left-side draw would carry an astronomically large weight—a fact this
   section's 200 × 1000 = 200,000 draws never realize.
   A "4 standard errors" band built from that draw's theoretical variance
   would span roughly ±0.57 around a target of 0.0027, wide enough to pass for
   almost any weighted mean a plausible implementation could produce, and so
   it tests nothing. The three checks below compare the sample instead against
   what it actually settles on: the mean weighted estimate against the right
   way in's own tail probability, 1 − Φ(θ) (half of truth(9)), within 4
   empirical standard errors of these 200 seeds; the capture rate against a
   near-zero rate, not the nominal 0.95; and the ESS-to-event-count ratio
   against ident's own ratio at its default T, computed here rather than
   hardcoded. A low ratio alone would not show that ESS fails to warn here—
   only the comparison to ident's equally moderate ratio does. */
section('6c. sq at T = 9, θ = 3: the two-ways-in silent failure—right-way-in mass, capture, and ESS vs ident');
{
  const R = 200, T = 9, theta = 3;
  const rightMass = 1 - CI.normCdf(theta);   // the right way in's own tail probability, half of truth(9)
  const ests = [], ratios = []; let hits = 0;
  for (let r = 0; r < R; r++) {
    const run = CI.runIS(85000 + r, { fn: 'sq', T: T, theta: theta, n: 1000, conf: 0.95 });
    ests.push(run.wtd.mean); ratios.push(run.ess / run.tail); if (run.hitWtd) hits++;
  }
  const m = CI.mean(ests), se = Math.sqrt(CI.sampleVar(ests) / R);
  ok(Math.abs(m - rightMass) <= 4 * se,
     `sq, T=9, θ=3: mean weighted estimate ${m.toExponential(4)} settles within 4 empirical SE (${(4 * se).toExponential(2)}) of the right way in's mass alone, 1 − Φ(θ) = ${rightMass.toExponential(4)}, half of truth(9)`);
  const capRate = hits / R;
  ok(capRate <= 0.02, `sq, T=9, θ=3: weighted interval capture ${capRate.toFixed(3)} is at most 0.02 (${hits} of ${R} runs)—the narrow interval misses almost every time`);

  const meanRatioSq = CI.mean(ratios);
  const idF = CI.IS_FUNCS.ident, idT = idF.defaultT, idTheta = idF.wayIn(idT);
  const idRatios = [];
  for (let r = 0; r < R; r++) {
    const run = CI.runIS(86000 + r, { fn: 'ident', T: idT, theta: idTheta, n: 1000, conf: 0.95 });
    idRatios.push(run.ess / run.tail);
  }
  const meanRatioIdent = CI.mean(idRatios);
  ok(Math.abs(meanRatioSq - meanRatioIdent) <= 0.05,
     `sq, T=9, θ=3: mean ESS/event-count ratio ${meanRatioSq.toFixed(4)} is within 0.05 of ident's own ratio at its default (T=${idT}, θ=${idTheta}), ${meanRatioIdent.toFixed(4)}—ESS looks as healthy here as on the fully-covered identity, which is exactly why it does not warn`);
}

console.log('\n' + (fail ? Ct.r(`${fail} failed`) : Ct.g('all passed')) + `, ${pass} passed`);
if (fail) { failures.forEach(f => console.log('  ' + Ct.r('FAIL') + ' ' + f)); process.exit(1); }
