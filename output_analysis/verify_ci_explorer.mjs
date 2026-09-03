#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for ci_explorer.html.  NOT shipped with the widget.

     node output_analysis/verify_ci_explorer.mjs

   Slices the block between the CI-CORE sentinels out of ci_explorer.html
   and runs it in a Node vm context, so the code under test is byte-for-
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

/* ═══ 3. Tab ②: common random numbers ═════════════════════════════ */
section('3. Tab ②: CRN capture, paired/Welch half-width ratio, detection rises with ρ');
{
  const R3 = Math.max(500, Math.floor(CALIB_REPS / 4));
  let lastDet = -1;
  [0, 0.5, 0.8, 0.95].forEach(rho => {
    let hi = 0, hc = 0, sumHi = 0, sumHc = 0, det = 0;
    for (let r = 0; r < R3; r++) {
      const run = CI.runCRN(2000 + r, { mu1: 10, mu2: 10.5, sigma: 1, rho: rho, n: 10, conf: 0.95 });
      hi += run.hitInd ? 1 : 0; hc += run.hitCrn ? 1 : 0;
      sumHi += run.ind.h; sumHc += run.crn.h;
      det += (run.crn.lo > 0 || run.crn.hi < 0) ? 1 : 0;
    }
    rateNear(hi / R3, 0.95, R3, 4, `ρ=${rho}: Welch interval captures δ`);
    rateNear(hc / R3, 0.95, R3, 4, `ρ=${rho}: paired interval captures δ`);
    /* E[paired h] / E[Welch h] = sqrt(1-ρ) × (t_{.975,9} / t_{.975,18}) × (c4(10) / c4(19)):
       the paired interval spends 9 df where Welch has about 18, and S over 10
       differences is biased low by c4(10) against roughly c4(19) for the pooled spread. */
    const want = Math.sqrt(1 - rho) * CI.tQuantile(0.975, 9) / CI.tQuantile(0.975, 18) * CI.c4(10) / CI.c4(19);
    close(sumHc / sumHi, want, 0.06, `ρ=${rho}: mean paired/Welch half-width ratio ≈ ${want.toFixed(3)}`);
    ok(det / R3 >= lastDet, `ρ=${rho}: detection rate ${(det / R3).toFixed(3)} not below the previous ρ`);
    lastDet = det / R3;
  });
  const run = CI.runCRN(1, { mu1: 10, mu2: 10.5, sigma: 1, rho: 0.8, n: 10, conf: 0.95 });
  ok(run.y1.length === 10 && run.y2i.length === 10 && run.y2c.length === 10 && run.d.length === 10, 'runCRN returns 10 of each series');
  close(run.d[3], run.y1[3] - run.y2c[3], 1e-15, 'differences are y1 - y2 under CRN');
  close(run.truth, -0.5, 1e-15, 'truth is μ1 - μ2');
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
{
  const f = CI.FUNCS.exp, R = 2000; let sumSe = 0;
  for (let r = 0; r < R; r++) sumSe += CI.runAV(3000 + r, { fn: 'exp', n: 500, conf: 0.95 }).av.s / Math.sqrt(500);
  const wantSe = Math.sqrt((CI.funcVar(f) + CI.funcAntiCov(f)) / 2 / 500);
  close(wantSe, 0.0028, 0.02, 'exp, 500 pairs: closed-form SE of the pair-mean average is 0.0028');
  close(sumSe / R, wantSe, 0.03, 'exp, 500 pairs: mean sample SE matches the closed form');
  const R2 = Math.max(500, Math.floor(CALIB_REPS / 4));
  let hits = 0, hitsInd = 0;
  for (let r = 0; r < R2; r++) {
    const run = CI.runAV(4000 + r, { fn: 'exp', n: 25, conf: 0.95 });
    hits += run.hitAv ? 1 : 0; hitsInd += run.hitInd ? 1 : 0;
  }
  /* Pair means of exp(U) are bounded and skewed, so the t interval on 25 of them
     runs a little under nominal; 6 SE allows for that without hiding a real bug. */
  rateNear(hits / R2, 0.95, R2, 6, 'exp, 25 pairs: antithetic interval captures E[h]');
  rateNear(hitsInd / R2, 0.95, R2, 6, 'exp, 50 independent draws: interval captures E[h]');
  let wider = 0;
  for (let r = 0; r < 500; r++) { const run = CI.runAV(5000 + r, { fn: 'bowl', n: 25, conf: 0.95 }); wider += run.av.h > run.ind.h ? 1 : 0; }
  ok(wider / 500 > 0.9, `bowl: antithetic interval wider than the independent one in ${wider} of 500 runs`);
  const run = CI.runAV(1, { fn: 'sqrt', n: 10, conf: 0.95 });
  ok(run.yInd.length === 20 && run.z.length === 10, 'runAV: 2n independent values, n pair means');
  close(run.yInd[3], run.ya[3], 1e-15, 'runAV: the independent arm reuses the first n draws');
  close(run.z[2], (run.ya[2] + run.yb[2]) / 2, 1e-15, 'runAV: pair mean');
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
/* ═══ 6. Tab ⑤: importance sampling ═══════════════════════════════ */
section('6. Tab ⑤: weighted estimator unbiased, capture at n = 1000, direct sampling fails at T = 5');
close(1 - CI.normCdf(5), 2.8665e-7, 1e-3, 'P(X ≥ 5) = 2.8665e-7');
close(CI.isWeight(5, 5), Math.exp(-12.5), 1e-12, 'W(5) at θ = 5 is exp(−25 + 12.5)');
[3, 5].forEach(T => {
  const R = 2000; let s = 0;
  for (let r = 0; r < R; r++) s += CI.runIS(8000 + r, { T: T, theta: T, n: 1000, conf: 0.95 }).wtd.mean;
  const want = 1 - CI.normCdf(T);
  close(s / R, want, 0.02, `T=${T}, θ=${T}: mean weighted estimate over ${R} runs ≈ ${want.toExponential(4)}`);
});
{
  const R = Math.max(500, Math.floor(CALIB_REPS / 8)); let h = 0;
  for (let r = 0; r < R; r++) h += CI.runIS(9000 + r, { T: 3, theta: 3, n: 1000, conf: 0.95 }).hitWtd ? 1 : 0;
  const c = h / R;
  ok(c >= 0.92 && c <= 0.97, `T=3, θ=3, n=1000: weighted interval capture ${c.toFixed(3)} within [0.92, 0.97]`);
  let miss = 0;
  for (let r = 0; r < 2000; r++) miss += CI.runIS(10000 + r, { T: 5, theta: 5, n: 1000, conf: 0.95 }).hitDirect ? 0 : 1;
  /* About 0.6 of the 2000 runs are expected to see one tail event; allow up to ten. */
  ok(miss / 2000 >= 0.995, `T=5, n=1000: direct interval misses in ${miss} of 2000 runs (its interval is [0, 0])`);
  let h3 = 0, h6 = 0;
  for (let r = 0; r < 300; r++) {
    h3 += CI.runIS(11000 + r, { T: 3, theta: 3, n: 1000, conf: 0.95 }).wtd.h;
    h6 += CI.runIS(11000 + r, { T: 3, theta: 6, n: 1000, conf: 0.95 }).wtd.h;
  }
  ok(h6 > h3, `T=3: shifting too far (θ=6) widens the interval again (mean h ${(h6 / 300).toExponential(2)} > ${(h3 / 300).toExponential(2)})`);
  const run = CI.runIS(1, { T: 3, theta: 3, n: 100, conf: 0.95 });
  ok(run.ys.length === 100 && run.w.length === 100 && run.tail === run.w.filter(v => v > 0).length, 'runIS: series lengths and tail count');
  ok(run.ess > 0 && run.ess <= run.tail, 'runIS: effective sample size between 0 and the tail count');
}

console.log('\n' + (fail ? Ct.r(`${fail} failed`) : Ct.g('all passed')) + `, ${pass} passed`);
if (fail) { failures.forEach(f => console.log('  ' + Ct.r('FAIL') + ' ' + f)); process.exit(1); }
