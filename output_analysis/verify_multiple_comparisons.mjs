#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for multiple_comparisons.html.  NOT shipped with the widget.

     node output_analysis/verify_multiple_comparisons.mjs

   Slices the block between the MCP-CORE sentinels out of multiple_comparisons.html
   and runs it in a Node vm context, and so the code under test is byte-for-
   byte the code the page ships.  Reference values are exact identities and
   textbook tables; later sections' calibration counts rates over
   MCP_CALIB_REPS replications (default 4000; set the environment variable
   to shorten a smoke run).
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'multiple_comparisons.html');
const CALIB_REPS = Math.max(200, Number(process.env.MCP_CALIB_REPS) || 4000);

function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== MCP-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== MCP-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('MCP-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core))
    throw new Error('MCP core references the DOM');
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN,
                Float64Array };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'multiple_comparisons.html#MCP-CORE' });
  if (!ctx.MCP) throw new Error('core ran but exported no MCP namespace');
  return { MCP: ctx.MCP, lines: core.split('\n').length };
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
/* A rate over R replications is within `k` standard errors of `p`. */
function rateNear(got, p, R, k, label) {
  const se = Math.sqrt(p * (1 - p) / R);
  ok(Math.abs(got - p) <= k * se, `${label}  (${got.toFixed(4)} vs ${p}, ${k} SE = ${(k * se).toFixed(4)})`,
     `got ${got}, want ${p} ± ${(k * se).toFixed(5)}`);
}
function rateAtMost(got, p, R, k, label) {   // a Monte Carlo rate that must not exceed p by more than k SEs
  const se = Math.sqrt(p * (1 - p) / R);
  ok(got <= p + k * se, label, `got ${got.toFixed(4)}, bound ${p} + ${k}·${se.toFixed(4)}`);
}
function rateAtLeast(got, p, R, k, label) {
  const se = Math.sqrt(p * (1 - p) / R);
  ok(got >= p - k * se, label, `got ${got.toFixed(4)}, floor ${p} − ${k}·${se.toFixed(4)}`);
}

const { MCP, lines } = loadCore();
console.log(Ct.d(`core loaded: ${lines} lines between the MCP-CORE sentinels; calibration uses ${CALIB_REPS} reps`));

section('1. Special functions');
close(MCP.normCdf(1.959963984540054), 0.975, 1e-9, 'normCdf(1.96) = 0.975');
close(MCP.normInv(0.975), 1.959963984540054, 1e-8, 'normInv(0.975)');
close(MCP.tQuantile(0.975, 9), 2.262157, 1e-5, 't_{0.975,9}');
close(MCP.tQuantile(0.995, 4), 4.604095, 1e-5, 't_{0.995,4}');
close(MCP.tQuantile(0.9975, 4), 5.597568, 1e-5, 't_{0.9975,4} (the book’s 99.5% interval factor)');
close(MCP.fCdf(3.0, 4, 20), 0.9567990017, 1e-7, 'F CDF(3; 4, 20)');    // R: pf(3, 4, 20)
close(MCP.fCdf(1.0, 1, 10), 0.6591068677, 1e-7, 'F CDF(1; 1, 10)');    // R: pf(1, 1, 10)
close(1 - MCP.fCdf(4.0, 2, 30), 0.0288446233, 1e-6, 'F tail(4; 2, 30)'); // R: 1 - pf(4, 2, 30)
const w = MCP.wilson(3, 20, 0.95);
close(w.lo, 0.052369, 2e-4, 'Wilson lo(3/20)'); close(w.hi, 0.360419, 2e-4, 'Wilson hi(3/20)');
ok(MCP.wilson(0, 10, 0.95).lo === 0 && MCP.wilson(10, 10, 0.95).hi === 1, 'Wilson at the ends');
// normCdf is Cody's rational approximation now, not the erfc route; check it against the old
// formula on whichever tail stays small (the lower tail for z <= 0, and 1 - Phi for z > 0),
// at 161 points spanning the range every caller here actually uses. The z > 0 side is obtained
// by symmetry as normCdf(-z) rather than by subtracting normCdf(z) from 1: for z past about 3
// the lower tail is stored as a double within a few ulp of 1, and 1 minus that cancels away
// exactly the precision this check exists to confirm, in either implementation.
for (let i = 0; i <= 160; i++) {
  const z = -8 + i * 0.1;
  const want = 0.5 * MCP.erfc(Math.abs(z) / Math.SQRT2);
  const got = z <= 0 ? MCP.normCdf(z) : MCP.normCdf(-z);
  close(got, want, 1e-13, `normCdf tail at |z| = ${Math.abs(z).toFixed(1)}`);
}
// The z > 0 branch itself (the "swap" that turns the small tail into the returned lower-tail
// probability) is exercised directly, at ordinary magnitude, by the existing normCdf(1.96)
// check above and by every ptukey/qtukey/rinottH reference check below.
ok(MCP.normCdf(-37.5) > 0 && MCP.normCdf(-37.5) < 1e-300, 'normCdf(-37.5) in (0, 1e-300)');
ok(MCP.normCdf(-50) === 0, 'normCdf(-50) === 0');

section('1b. Noncentral t, studentized range, Rinott, order statistics');
close(MCP.nctCdf(2.0, 18, 1.5), 0.6728479927, 1e-6, 'nct CDF');       // R: pt(2, 18, 1.5)
close(MCP.nctCdf(0, 10, 0), 0.5, 1e-12, 'nct at zero noncentrality');
// R: for k, df: ptukey(3, k, df), qtukey(.95, k, df), qtukey(.99, k, df)
const TUKEY = [
  [3, 8, 0.8533364442, 4.041036, 5.635393], [3, 20, 0.8892432021, 3.577935, 4.639220],
  [3, 36, 0.9003464067, 3.456758, 4.396094], [3, 100, 0.9093521802, 3.364572, 4.216183],
  [5, 8, 0.7022669246, 4.885754, 6.624813], [5, 20, 0.7500621066, 4.231857, 5.293253],
  [5, 36, 0.7665733471, 4.059968, 4.969288], [5, 100, 0.7807411015, 3.928937, 4.730065],
  [8, 8, 0.5277861111, 5.596180, 7.473848], [8, 20, 0.5648204831, 4.767584, 5.838914],
  [8, 36, 0.5787291653, 4.547335, 5.439497], [8, 100, 0.5912978010, 4.378517, 5.144248],
  [10, 8, 0.4420489338, 5.918277, 7.863188], [10, 20, 0.4657454160, 5.007883, 6.086476],
  [10, 36, 0.4746359464, 4.764227, 5.650806], [10, 100, 0.4827455094, 4.576785, 5.328306]];
for (const [k, df, p3, q95, q99] of TUKEY) {
  close(MCP.ptukey(3, k, df), p3, 2e-6, `ptukey(3; ${k}, ${df})`);
  close(MCP.qtukey(0.95, k, df), q95, 3e-4, `qtukey(.95; ${k}, ${df})`);
  close(MCP.qtukey(0.99, k, df), q99, 3e-4, `qtukey(.99; ${k}, ${df})`);
}
ok(MCP.ptukey(0, 5, 20) === 0 && MCP.ptukey(60, 5, 20) > 0.999999, 'ptukey limits');
// Table A.12 of Banks, Carson, Nelson, and Nicol (5th ed.), plus the worked example's h(10, 8, 0.975)
const RINOTT = [[0.90, 5, 2, 2.291], [0.90, 5, 10, 4.786], [0.90, 10, 5, 3.137], [0.90, 20, 10, 3.437],
  [0.90, 50, 2, 1.844], [0.95, 5, 2, 3.107], [0.95, 5, 10, 5.797], [0.95, 10, 2, 2.614],
  [0.95, 10, 8, 4.106], [0.95, 20, 5, 3.385], [0.95, 50, 10, 3.687], [0.975, 10, 8, 4.635],
  [0.95, 50, 2, 2.373], [0.90, 10, 10, 3.746], [0.90, 5, 5, 3.837], [0.95, 20, 10, 3.875]];
for (const [p, r0, k, h] of RINOTT) close(MCP.rinottH(r0, k, p), h, 3e-3 / h, `Rinott h(${r0}, ${k}, ${p})`);
close(MCP.expectedMaxNormal(2), 0.5641896, 1e-6, 'E[max of 2]');
close(MCP.expectedMaxNormal(8), 1.4236003, 1e-5, 'E[max of 8]');
close(MCP.expectedMaxNormal(10), 1.5387527, 1e-5, 'E[max of 10]');

section('2. Family sampling and the one-sample family (tab 1)');
{
  const m = MCP.trueMeans('one', 5, 10, 2, 'min');
  ok(m.join() === '10,10,10,10,8', 'trueMeans one/min');
  ok(MCP.trueMeans('two', 4, 10, 1, 'max').join() === '10,10,11,11', 'trueMeans two/max');
  ok(MCP.trueMeans('spread', 3, 10, 2, 'min').join() === '10,9,8', 'trueMeans spread');
  ok(MCP.trueMeans('equal', 2, 10, 5, 'min').join() === '10,10', 'trueMeans equal, K = 2');
  const a = MCP.drawFamily(7, { K: 3, R: 4, sigma: 2, means: [10, 10, 10], crn: false });
  const b = MCP.drawFamily(7, { K: 3, R: 4, sigma: 2, means: [10, 10, 10], crn: false });
  ok(JSON.stringify(a) === JSON.stringify(b) && a.Y.length === 3 && a.Y[0].length === 4, 'drawFamily is a function of the seed');
  // CRN: replication r of every design shares a component, and so within-replication differences have variance 2(1 - rho) sigma^2
  let sPlain = 0, sCrn = 0, n = 0;
  for (let s = 1; s <= 400; s++) {
    const P = MCP.drawFamily(s, { K: 2, R: 10, sigma: 1, means: [0, 0], crn: false }).Y;
    const C = MCP.drawFamily(s, { K: 2, R: 10, sigma: 1, means: [0, 0], crn: true }).Y;
    for (let r = 0; r < 10; r++) { sPlain += (P[0][r] - P[1][r]) ** 2; sCrn += (C[0][r] - C[1][r]) ** 2; n++; }
  }
  close(sPlain / n, 2, 0.06, 'independent difference variance = 2σ²');
  close(sCrn / n, 2 * (1 - MCP.RHO_CRN), 0.08, 'CRN difference variance = 2(1 − ρ)σ²');
  // Tab 1 calibration under the global null
  const R = CALIB_REPS;
  for (const K of [2, 5, 10]) for (const level of ['raw', 'bonf']) {
    let anyFalse = 0, allCap = 0;
    for (let s = 1; s <= R; s++) {
      const Y = MCP.drawFamily(s, { K, R: 10, sigma: 2, means: MCP.trueMeans('equal', K, 10, 0, 'min'), crn: false }).Y;
      const f = MCP.oneSampleFamily(Y, { alpha: 0.05, level, theta0: 10, means: MCP.trueMeans('equal', K, 10, 0, 'min') });
      anyFalse += f.anyFalse; allCap += f.allCaptured;
      if (s === 1) ok(f.C === K && f.items.length === K && f.df === 9, `one-sample shape K=${K}`);
    }
    if (level === 'raw') rateNear(anyFalse / R, MCP.fwerIndep(0.05, K), R, 3.5, `tab 1 FWER uncorrected K=${K} = 1−(1−α)^K`);
    else { rateAtMost(anyFalse / R, 0.05, R, 2.5, `tab 1 FWER Bonferroni K=${K} ≤ α`);
           rateAtLeast(allCap / R, 0.95, R, 2.5, `tab 1 joint coverage Bonferroni K=${K} ≥ 1−α`); }
  }
}
section('3. Pairwise family (tab 2)');
{
  const R = CALIB_REPS;
  for (const mode of ['bench', 'all']) for (const paired of [false, true]) {
    let anyFalse = 0, capSum = 0, capN = 0, halfPooled = 0, halfPaired = 0;
    for (let s = 1; s <= R; s++) {
      const means = MCP.trueMeans('equal', 5, 10, 0, 'min');
      const Y = MCP.drawFamily(s, { K: 5, R: 10, sigma: 2, means, crn: paired }).Y;
      const f = MCP.pairFamily(Y, { alpha: 0.05, level: 'bonf', mode, paired, means });
      anyFalse += f.anyFalse;
      for (const it of f.items) { capSum += it.captured; capN++; }
      if (s === 1) ok(f.C === (mode === 'bench' ? 4 : 10) && f.df === (paired ? 9 : 18), `pair shape ${mode}/${paired}`);
    }
    rateAtMost(anyFalse / R, 0.05, R, 2.5, `tab 2 Bonferroni FWER ≤ α (${mode}, paired=${paired})`);
    // The families drawn, not the intervals within them, are the independent unit: capN counts
    // every interval across all R families, which understates the standard error by a factor of
    // C and makes this check flaky. R is the right sample size for the rate's own uncertainty.
    rateAtLeast(capSum / capN, 1 - 0.05 / (mode === 'bench' ? 4 : 10), R, 3, `tab 2 per-interval capture at its own level (${mode}, paired=${paired})`);
  }
  // paired intervals under CRN are narrower than pooled ones on the same data
  let np = 0, pp = 0;
  for (let s = 1; s <= 300; s++) {
    const means = [10, 10]; const Y = MCP.drawFamily(s, { K: 2, R: 10, sigma: 2, means, crn: true }).Y;
    np += MCP.pairFamily(Y, { alpha: 0.05, level: 'raw', mode: 'bench', paired: false, means }).items[0].half;
    pp += MCP.pairFamily(Y, { alpha: 0.05, level: 'raw', mode: 'bench', paired: true, means }).items[0].half;
  }
  ok(pp < 0.6 * np, 'paired half-width under CRN well under the pooled one', `${(pp / np).toFixed(3)}`);
  ok(MCP.fwerIndep(0.05, 10) > 0.401 && MCP.fwerIndep(0.05, 10) < 0.402, '1−0.95^10 = 0.4013');
  ok(MCP.bonfBound(0.05, 45) === 1 && MCP.bonfBound(0.01, 5) === 0.05, 'Bonferroni bound');
}
section('4. Three rules on planted differences (tab 3)');
{
  ok(JSON.stringify(MCP.holm([0.01, 0.04, 0.03, 0.2], 0.05).reject) === '[true,false,false,false]', 'Holm stops at the first non-rejection');
  ok(JSON.stringify(MCP.holm([0.001, 0.012, 0.02, 0.5], 0.05).reject) === '[true,true,true,false]', 'Holm step-down thresholds α/4, α/3, α/2, α');
  const R = CALIB_REPS;
  const means = MCP.trueMeans('one', 5, 10, 2.5, 'min');
  const power = { none: 0, bonf: 0, holm: 0 }, fw = { none: 0, bonf: 0, holm: 0 };
  for (let s = 1; s <= R; s++) {
    const Y = MCP.drawFamily(s, { K: 5, R: 10, sigma: 2, means, crn: false }).Y;
    const f = MCP.rulesFamily(Y, { alpha: 0.05, mode: 'bench', paired: false, means });
    if (s === 1) ok(f.raw.nNull === 3 && f.raw.nNonNull === 1, 'one non-null comparison among four');
    for (const k of ['none', 'bonf', 'holm']) { power[k] += f.rules[k].nTrueDet; fw[k] += f.rules[k].anyFalse; }
  }
  rateNear(power.bonf / R, MCP.pairPower(2.5, 2, 10, 0.05 / 4), R, 3.5, 'Bonferroni power = noncentral t at α/C');
  rateNear(power.none / R, MCP.pairPower(2.5, 2, 10, 0.05), R, 3.5, 'uncorrected power = noncentral t at α');
  rateAtMost(fw.holm / R, 0.05, R, 2.5, 'Holm FWER ≤ α');
  ok(power.holm >= power.bonf, 'Holm power ≥ Bonferroni power on the same seeds', `${power.holm} vs ${power.bonf}`);
  ok(power.none > power.bonf, 'uncorrected power exceeds Bonferroni');
  const z = MCP.rulesFamily(MCP.drawFamily(3, { K: 4, R: 8, sigma: 2, means: [10,10,10,10], crn: false }).Y,
                            { alpha: 0.05, mode: 'bench', paired: false, means: [10,10,10,10] });
  ok(z.raw.nNonNull === 0 && z.rules.bonf.nTrueDet === 0, 'δ = 0 leaves no non-null comparison');
}

section('5. Pick the winner (tab 4)');
{
  close(MCP.winnerCoverage(0.05, 8), 0.8167, 1e-3, 'known-σ winner coverage, K = 8');
  const R = CALIB_REPS; let cov = 0, covB = 0, biasSum = 0, biasSumSq = 0;
  const means = MCP.trueMeans('equal', 8, 10, 0, 'min');
  for (let s = 1; s <= R; s++) {
    const Y = MCP.drawFamily(s, { K: 8, R: 200, sigma: 2, means, crn: false }).Y;
    const f = MCP.winnerFamily(Y, { alpha: 0.05, level: 'raw', dir: 'min', means });
    cov += f.winItem.captured; biasSum += f.bias; biasSumSq += f.bias * f.bias;
    covB += MCP.winnerFamily(Y, { alpha: 0.05, level: 'bonf', dir: 'min', means }).winItem.captured;
  }
  rateNear(cov / R, MCP.winnerCoverage(0.05, 8), R, 3.5, 'winner coverage at large R matches the known-σ reference');
  rateAtLeast(covB / R, 0.975, R, 2.5, 'winner coverage with the 1 − α/K interval ≥ 1 − α/2');
  // The bias's own sample sd, not a fixed relative tolerance, sets how tightly R families can
  // pin down its mean, and so the check tightens on its own as CALIB_REPS grows instead of
  // carrying a tolerance tuned to one rep count.
  const biasMean = biasSum / R, biasVar = Math.max(0, (biasSumSq / R - biasMean * biasMean) * R / (R - 1));
  const biasSd = Math.sqrt(biasVar), biasWant = -2 / Math.sqrt(200) * MCP.expectedMaxNormal(8);
  ok(Math.abs(biasMean - biasWant) <= 4 * biasSd / Math.sqrt(R), 'selection bias = −σ/√R · E[max of K]',
     `got ${biasMean}, want ${biasWant}, 4·sd/√R = ${(4 * biasSd / Math.sqrt(R)).toFixed(5)}`);
  // dir: 'max' picks the largest sample mean, which the same slippage pulls
  // upward rather than downward, and so its bias carries the opposite sign
  // from the dir: 'min' case checked above.
  let biasSumMax = 0;
  for (let s = 1; s <= R; s++) {
    const Y = MCP.drawFamily(s, { K: 8, R: 200, sigma: 2, means, crn: false }).Y;
    biasSumMax += MCP.winnerFamily(Y, { alpha: 0.05, level: 'raw', dir: 'max', means }).bias;
  }
  const biasMeanMax = biasSumMax / R, biasWantMax = 2 / Math.sqrt(200) * MCP.expectedMaxNormal(8);
  ok(Math.abs(biasMeanMax - biasWantMax) <= 4 * biasSd / Math.sqrt(R), 'dir: max selection bias = +σ/√R · E[max of K]',
     `got ${biasMeanMax}, want ${biasWantMax}`);
}
section('6. ANOVA and post hoc (tab 5)');
{
  ok(MCP.letterGroups([1, 2, 3, 10, 11], 1.5).join() === 'a,ab,b,c,c', 'letters: overlapping windows');
  ok(MCP.letterGroups([5, 5.1], 1).join() === 'a,a', 'letters K = 2 same group');
  ok(MCP.letterGroups([5, 9], 1).join() === 'a,b', 'letters K = 2 different');
  // brute force: every non-significant pair shares a letter, every significant pair shares none
  for (let s = 1; s <= 200; s++) {
    const rnd = MCP.mulberry32(s); const m = []; for (let i = 0; i < 6; i++) m.push(10 * rnd());
    const L = MCP.letterGroups(m, 2.5); let good = true;
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const shares = [...L[i]].some(c => L[j].includes(c));
      if ((Math.abs(m[i] - m[j]) <= 2.5) !== shares) good = false;
    }
    if (!good) { ok(false, `letters vs brute force, seed ${s}`, JSON.stringify([m, L])); break; }
    if (s === 200) ok(true, 'letters agree with brute force on 200 random families');
  }
  const R = CALIB_REPS;
  const cases = [['equal', 5, 3], ['two', 3, 3], ['two', 5, 3]];
  for (const [cfg, K, delta] of cases) {
    const means = MCP.trueMeans(cfg, K, 10, delta, 'min');
    let fRej = 0, fw = { tukey: 0, lsd: 0, bonf: 0 }, det = { tukey: 0, lsd: 0, bonf: 0 }, nn = 0;
    for (let s = 1; s <= R; s++) {
      const Y = MCP.drawFamily(s, { K, R: 10, sigma: 2, means, crn: false }).Y;
      const f = MCP.anovaFamily(Y, { alpha: 0.05, means });
      fRej += f.p <= 0.05; nn = f.nNonNullPairs;
      for (const k of ['tukey', 'lsd', 'bonf']) { fw[k] += f.rules[k].anyFalse; det[k] += f.rules[k].nTrueDet; }
    }
    if (cfg === 'equal') {
      rateNear(fRej / R, 0.05, R, 3.5, 'F test size = α under the null');
      for (const k of ['tukey', 'lsd', 'bonf']) rateAtMost(fw[k] / R, 0.05, R, 2.5, `${k} FWER ≤ α under the full null`);
    } else if (K === 3) {
      rateAtMost(fw.lsd / R, 0.05, R, 2.5, 'protected LSD holds FWER at K = 3');
    } else {
      ok(fw.lsd / R > 0.05 + 3 * Math.sqrt(0.05 * 0.95 / R), 'protected LSD exceeds α at K = 5 under a partial null', `${(fw.lsd / R).toFixed(3)}`);
      rateAtMost(fw.tukey / R, 0.05, R, 2.5, 'Tukey FWER ≤ α under a partial null');
      rateAtMost(fw.bonf / R, 0.05, R, 2.5, 'Bonferroni FWER ≤ α under a partial null');
      ok(det.tukey >= det.bonf, 'Tukey detects at least as many true pairs as Bonferroni', `${det.tukey} vs ${det.bonf}`);
    }
  }
  const one = MCP.anovaFamily(MCP.drawFamily(9, { K: 4, R: 10, sigma: 2, means: [10,10,10,10], crn: false }).Y, { alpha: 0.05, means: [10,10,10,10] });
  ok(one.df1 === 3 && one.df2 === 36 && one.C === 6 && one.rules.tukey.cd > one.rules.lsd.cd && one.rules.bonf.cd > one.rules.tukey.cd, 'ANOVA df, C, and the ordering LSD < Tukey < Bonferroni of critical differences');
}
section('7. Select the best (tab 6)');
{
  // The textbook's worked example (Example 12.3): K = 8, R0 = 10, 1 − α = 0.95, ε = 0.15, smaller is better
  close(MCP.tQuantile(Math.pow(0.975, 1 / 7), 9), 3.455, 2e-3, 'screening t for K = 8, R0 = 10');
  const Ybar = [46.86, 45.70, 47.23, 45.13, 46.80, 47.81, 47.41, 46.94], S2 = [0.21, 0.37, 0.29, 0.09, 0.28, 0.98, 0.12, 0.28];
  const scr = MCP.screenStage(Ybar, S2, { K: 8, R0: 10, alpha: 0.05, eps: 0.15, dir: 'min' });
  ok(scr.sampleBest === 3, 'sample best is Oxidize');
  const wantW = [0.60, 0.74, 0.68, null, 0.67, 1.13, 0.50, 0.67];
  for (let i = 0; i < 8; i++) if (i !== 3) close(scr.W[i][3], wantW[i], 0.02, `W_${i + 1},4 (Table 12.4)`);
  ok(scr.survivors.join() === '1,3', 'survivors are Clean and Oxidize');
  const h = MCP.rinottH(10, 8, 0.975);
  ok(Math.ceil((h * Math.sqrt(0.37) / 0.15) ** 2) === 354 && Math.ceil((h * Math.sqrt(0.09) / 0.15) ** 2) === 86,
     'second-stage sizes from the rounded table variances (the book’s 349 and 90 come from unrounded ones)');
  // Guarantee: P(correct selection) ≥ 1 − α in the slippage configuration
  const R = Math.max(400, Math.floor(CALIB_REPS / 2));
  for (const [K, R0, conf] of [[3, 10, 0.95], [5, 10, 0.95], [8, 5, 0.90], [2, 10, 0.90]]) {
    const means = MCP.trueMeans('one', K, 10, 1, 'min'); let cs = 0, reps = 0, bestSurv = 0;
    for (let s = 1; s <= R; s++) {
      const f = MCP.selectBest(s, { K, R0, sigma: 2, means, alpha: 1 - conf, eps: 1, dir: 'min' });
      cs += f.correct; reps += f.totalReps; bestSurv += f.survivors.includes(f.sampleBest);
      if (s === 1) ok(f.best === K - 1 && f.sizes.length === K, `selectBest shape K=${K}`);
    }
    ok(bestSurv === R, 'the sample-best always survives screening');
    rateAtLeast(cs / R, conf, R, 2, `P(correct selection) ≥ ${conf} (K=${K}, R0=${R0})`);
    ok(reps / R >= K * R0, 'total replications at least the first stage');
  }
  const eq = MCP.selectBest(5, { K: 4, R0: 10, sigma: 2, means: [10,10,10,10], alpha: 0.05, eps: 1, dir: 'min' });
  ok(eq.correct === true, 'under all equal every selection is within ε');
  // The guarantee above was only ever exercised at dir: 'min'; a slippage
  // configuration where the best design is the largest, not the smallest,
  // checks the sign flip in screenStage and selectBest that dir: 'max' drives.
  {
    const K = 5, R0 = 10, conf = 0.95, meansMax = MCP.trueMeans('one', K, 10, 1, 'max');
    let cs = 0;
    for (let s = 1; s <= R; s++) {
      cs += MCP.selectBest(s, { K, R0, sigma: 2, means: meansMax, alpha: 1 - conf, eps: 1, dir: 'max' }).correct;
    }
    rateAtLeast(cs / R, conf, R, 2, `dir: max P(correct selection) ≥ ${conf} (K=${K}, R0=${R0})`);
  }
  // Item 1's fix: a design exactly eps worse than the best must read as
  // incorrect, not correct, however floating-point rounding lands on
  // Ybar[best] - Ybar[selected] at that exact boundary. 'one' at delta = eps
  // puts every other design exactly eps behind the best, in both directions.
  {
    const RB = 600;
    for (const dir of ['min', 'max']) {
      const meansB = MCP.trueMeans('one', 5, 10, 0.7, dir);
      let checked = 0;
      for (let s = 1; s <= RB; s++) {
        const f = MCP.selectBest(s, { K: 5, R0: 5, sigma: 2, means: meansB, alpha: 0.05, eps: 0.7, dir });
        if (f.selected !== f.best) { ok(f.correct === false, `eps boundary: a wrong pick reads incorrect (dir ${dir}, seed ${s})`); checked++; }
      }
      ok(checked > 0, `eps boundary check exercised at least one wrong pick (dir ${dir})`, `${checked} of ${RB}`);
    }
  }
}

console.log('\n' + (fail ? Ct.r(`${fail} failed`) : Ct.g('all passed')) + `, ${pass} passed`);
if (fail) { failures.forEach(f => console.log('  ' + Ct.r('FAIL') + ' ' + f)); process.exit(1); }
