/* ══════════════════════════════════════════════════════════════════════
   Verification of the dependence numerics (the Relate Two Variables and
   Look for Patterns over Time tabs).  NOT shipped with the widget.

   verify_input_analyzer.mjs runs these sections with the rest; this file
   also runs on its own, which takes a few seconds:

     node input_modeling/verify_input_analyzer_dependence.mjs

   The reference values come from verify_dependence_reference.R, which
   generates every dataset with a fixed seed and writes the data and R's
   results to verify_dependence_reference.json.  Regenerate the JSON only by
   re-running that script.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REF = JSON.parse(fs.readFileSync(path.join(here, 'verify_dependence_reference.json'), 'utf8'));

/* Rejection rate of a test at 5% over R replications of independent data. */
function rejectRate(IA, seed, R, n, testP) {
  const u = IA.MRG32k3a(seed);
  const norm = () => IA.normInv(u());
  let rej = 0;
  for (let i = 0; i < R; i++) {
    const x = [], y = [];
    for (let j = 0; j < n; j++) { x.push(norm()); y.push(norm()); }
    if (testP(x, y) < 0.05) rej++;
  }
  return rej / R;
}

export function runDependence(IA, { section, ok, close }) {
  /* ── 19. Two variables ─────────────────────────────────────────── */
  section('19. two variables: pairing, correlation, regression');

  {
    const t = IA.parseTable('x,y\n1,2\n,3\n4,a\n5,6\n7.5,8\n');
    const pc = IA.pairedColumns(t, 0, 1);
    ok(JSON.stringify(pc.x) === '[1,5,7.5]' && JSON.stringify(pc.y) === '[2,6,8]' && pc.dropped === 2,
       'pairedColumns keeps a row only when both cells parse, and counts the rest', JSON.stringify(pc));
    ok(JSON.stringify(pc.rows) === '[0,3,4]', 'pairedColumns reports which rows it kept', JSON.stringify(pc.rows));
  }
  {
    const rk = IA.ranks([10, 20, 20, 5]);
    ok(JSON.stringify(rk) === '[2,3.5,3.5,1]', 'ranks average over ties', JSON.stringify(rk));
  }

  REF.pairs.forEach((d, i) => {
    const lab = `pair set ${i + 1} (n = ${d.x.length})`;
    const p = IA.pearson(d.x, d.y, 0.95);
    close(p.r, d.r, 1e-12, `${lab}: Pearson r against cor.test`);
    close(p.t, d.t, 1e-10, `${lab}: Pearson t`);
    close(p.p, d.p, 1e-9, `${lab}: Pearson p-value`);
    close(p.lo, d.lo, 1e-10, `${lab}: Fisher-z interval, lower end`);
    close(p.hi, d.hi, 1e-10, `${lab}: Fisher-z interval, upper end`);
    const s = IA.spearman(d.x, d.y);
    close(s.rho, d.rho, 1e-12, `${lab}: Spearman rho`);
    close(s.p, d.rhoP, 1e-9, `${lab}: Spearman p-value (t approximation, exact = FALSE)`);
    const k = IA.kendallTauB(d.x, d.y);
    close(k.tau, d.tau, 1e-12, `${lab}: Kendall tau-b`);
    ok(k.exact === d.tauExact, `${lab}: Kendall p-value is ${d.tauExact ? 'exact' : 'the normal approximation'}, as in R`);
    close(k.p, d.tauP, 1e-9, `${lab}: Kendall p-value`);
  });

  REF.regs.forEach((d, i) => {
    const lab = `regression ${i + 1} (n = ${d.x.length})`;
    const f = IA.olsSimple(d.x, d.y, 0.95);
    close(f.a, d.a, 1e-10, `${lab}: intercept against lm`);
    close(f.b, d.b, 1e-10, `${lab}: slope`);
    close(f.seA, d.seA, 1e-9, `${lab}: intercept standard error`);
    close(f.seB, d.seB, 1e-9, `${lab}: slope standard error`);
    close(f.ciA[0], d.ciA[0], 1e-9, `${lab}: intercept interval, lower end`);
    close(f.ciA[1], d.ciA[1], 1e-9, `${lab}: intercept interval, upper end`);
    close(f.ciB[0], d.ciB[0], 1e-9, `${lab}: slope interval, lower end`);
    close(f.r2, d.r2, 1e-10, `${lab}: R squared`);
    close(f.s, d.s, 1e-10, `${lab}: residual standard deviation`);
    close(f.pB, d.pB, 1e-8, `${lab}: slope p-value`);
    const bp = IA.breuschPagan(d.x, f.resid);
    close(bp.stat, d.bp, 1e-9, `${lab}: Breusch-Pagan (Koenker) statistic against lmtest::bptest`);
    close(bp.p, d.bpP, 1e-9, `${lab}: Breusch-Pagan p-value`);
  });

  {
    const u = IA.MRG32k3a(77);
    let good = true, worst = '';
    for (let rep = 0; rep < 200; rep++) {
      const n = 5 + Math.floor(u() * 40), x = [], y = [];
      for (let j = 0; j < n; j++) { x.push(Math.exp(IA.normInv(u()))); y.push(u() * u()); }
      const fr = IA.frechetPairings(x, y), r = IA.pairCorr(x, y);
      if (!(fr.together >= r - 1e-12 && r >= fr.opposite - 1e-12)) { good = false; worst = JSON.stringify({ fr, r }); }
    }
    ok(good, 'sorted together never falls below the observed r, nor sorted opposite above it (200 random pairs)', worst);
    const xl = [], yl = [];
    for (let j = 0; j < 400; j++) { xl.push(Math.exp(2 * IA.normInv(u()))); yl.push(IA.normInv(u())); }
    const fl = IA.frechetPairings(xl, yl);
    ok(fl.together < 0.8 && fl.opposite > -0.8,
       `a lognormal against a normal cannot reach r = 1 (range ${fl.opposite.toFixed(3)} to ${fl.together.toFixed(3)})`);
    const ys = IA.shuffleWith(IA.MRG32k3a(5), yl);
    ok(ys.length === yl.length && ys.slice().sort((a, b) => a - b).join() === yl.slice().sort((a, b) => a - b).join(),
       'a shuffle keeps exactly the same values');
  }

  {
    const R = 3000, n = 40;
    const rp = rejectRate(IA, 101, R, n, (x, y) => IA.pearson(x, y, 0.95).p);
    const rs = rejectRate(IA, 202, R, n, (x, y) => IA.spearman(x, y).p);
    const rk = rejectRate(IA, 303, R, n, (x, y) => IA.kendallTauB(x, y).p);
    const rb = rejectRate(IA, 404, R, n, (x, y) => IA.breuschPagan(x, IA.olsSimple(x, y, 0.95).resid).p);
    for (const [nm, v] of [['Pearson', rp], ['Spearman', rs], ['Kendall', rk], ['Breusch-Pagan', rb]])
      ok(v > 0.035 && v < 0.065, `${nm} rejects at ${(100 * v).toFixed(1)}% under independence (nominal 5%, ${R} reps of n = ${n})`);
  }

  {
    let threw = '';
    let res;
    try {
      res = [IA.pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5], 0.95), IA.spearman([2, 2, 2, 2], [1, 2, 3, 4]),
             IA.kendallTauB([3, 3, 3, 3], [1, 2, 3, 4]), IA.olsSimple([2, 2, 2, 2], [1, 2, 3, 4], 0.95)];
    } catch (e) { threw = String(e); }
    ok(!threw && Number.isNaN(res[0].r) && Number.isNaN(res[1].rho) && Number.isNaN(res[2].tau) && Number.isNaN(res[3].b),
       'a constant column gives NaN, never an exception', threw);
  }

  {
    const D = IA.DISTS, cases = [
      ['expo', { dist: D.expo, p: [2], shift: 0.5 }, 2.5],
      ['gamma', { dist: D.gamma, p: [2.5, 1.2], shift: 0 }, 3],
      ['weibull', { dist: D.weibull, p: [2, 1.5], shift: 0 }, 2 * Math.exp(IA.logGamma(1 + 1 / 1.5))],
      ['lognormal', { dist: D.lognormal, p: [0.3, 0.5], shift: 0 }, Math.exp(0.3 + 0.125)],
      ['normal', { dist: D.normal, p: [-1.5, 2], shift: 0 }, -1.5],
      ['uniform', { dist: D.uniform, p: [2, 5], shift: 0 }, 3.5],
      ['triangular', { dist: D.triangular, p: [1, 2, 6], shift: 0 }, 3],
      ['beta', { dist: D.beta, p: [2, 3, 1, 6], shift: 0 }, 3],
      ['loglogistic', { dist: D.loglogistic, p: [3, 2], shift: 0 }, 2 * (Math.PI / 3) / Math.sin(Math.PI / 3)],
      ['mirrored expo', { dist: D.expo, p: [2], shift: 10, reflect: true }, 8],
      ['johnsonSB (quadrature)', { dist: D.johnsonSB, p: [0, 1, 0, 1], shift: 0 }, 0.5],
    ];
    for (const [nm, fit, want] of cases) close(IA.fitMean(fit), want, 1e-4, `fitMean: ${nm}`);
    ok(IA.fitMean({ dist: D.loglogistic, p: [0.9, 2], shift: 0 }) === Infinity,
       'fitMean of a log-logistic with shape at most 1 is infinite');
  }
}

export function runTimeOrder(IA, { section, ok, close }) {
  section('20. one variable in time order: correlogram, cycle, AR(1), periodogram');

  {
    const t = IA.parseTable('hour,val\n0,5\n1,\n2,7\n3,x\n4,9\n');
    const sr = IA.seriesFrom(t, 1, 0, null);
    ok(JSON.stringify(sr.y) === '[5,7,9]' && JSON.stringify(sr.t) === '[0,2,4]' && sr.dropped === 2 && sr.sorted,
       'seriesFrom keeps a reading only when its value and its time both parse', JSON.stringify(sr));
    const se = IA.seriesFrom(t, 1, null, 2.5);
    ok(JSON.stringify(se.t) === '[0,5,10]', 'equally spaced times count the original rows, so a dropped reading leaves a gap', JSON.stringify(se.t));
    const tc = IA.parseTable('t,v\n08:00,1\n08:15,2\n08:30,3\n08:50,4\n');
    const sc = IA.seriesFrom(tc, 1, 0, null);
    ok(JSON.stringify(sc.t) === '[480,495,510,530]' && sc.clock, 'clock times read as minutes past midnight', JSON.stringify(sc));
    ok(Math.abs(sc.gapCV - Math.sqrt(((15 - 50 / 3) ** 2 * 2 + (20 - 50 / 3) ** 2) / 2) / (50 / 3)) < 1e-12,
       'gapCV is the coefficient of variation of the gaps', String(sc.gapCV));
    const tu = IA.parseTable('t,v\n3,1\n1,2\n2,3\n');
    ok(IA.seriesFrom(tu, 1, 0, null).sorted === false, 'an unsorted time column is reported as such');
  }

  const T = REF.ts, n = T.y.length;
  const a = IA.acf(T.y, 20);
  let worst = 0;
  for (let k = 0; k <= 20; k++) worst = Math.max(worst, Math.abs(a[k] - T.acf[k]));
  ok(worst < 1e-12, `acf to lag 20 matches R's acf (largest gap ${worst.toExponential(2)})`);
  const lb0 = IA.ljungBox(a, n, 10, 0), lb1 = IA.ljungBox(a, n, 10, 1);
  close(lb0.Q, T.lb0.Q, 1e-10, 'Ljung-Box Q at 10 lags against Box.test');
  close(lb0.p, T.lb0.p, 1e-9, 'Ljung-Box p-value, fitdf = 0');
  ok(lb1.df === 9, 'Ljung-Box after an AR(1) loses one degree of freedom');
  close(lb1.p, T.lb1.p, 1e-9, 'Ljung-Box p-value, fitdf = 1');
  const ar = IA.ar1(T.y);
  close(ar.phi, T.phi, 1e-12, 'AR(1) phi against ar.yw');
  close(ar.sigmaE * ar.sigmaE, T.varPred, 1e-10, 'AR(1) innovation variance against ar.yw var.pred');
  close(ar.mean, T.mean, 1e-12, 'AR(1) mean');
  ok(ar.innov.length === n - 1, 'one innovation per reading after the first');

  T.harm = REF.harm;
  REF.harm.fits.forEach((d, i) => {
    const lab = `harmonic fit ${i + 1} (${d.H} harmonic${d.H > 1 ? 's' : ''}${d.trend ? ', trend' : ''})`;
    const f = IA.harmonicFit(REF.harm.t, REF.harm.y, d.P, d.H, d.trend);
    const mine = [f.m];
    for (let k = 0; k < d.H; k++) mine.push(f.c[k], f.s[k]);
    if (d.trend) mine.push(f.g);
    let wc = 0;
    for (let k = 0; k < mine.length; k++) wc = Math.max(wc, Math.abs(mine[k] - d.coef[k]) / Math.max(1, Math.abs(d.coef[k])));
    ok(wc < 1e-10, `${lab}: coefficients match lm (largest gap ${wc.toExponential(2)})`);
    close(f.r2, d.r2, 1e-10, `${lab}: R squared`);
    close(f.sd, d.s, 1e-10, `${lab}: residual standard deviation`);
    close(f.F, d.F, 1e-9, `${lab}: F statistic`);
    ok(f.df1 === d.df1 && f.df2 === d.df2, `${lab}: F degrees of freedom ${f.df1}, ${f.df2}`);
    close(f.p, d.p, 1e-8, `${lab}: F p-value`);
    let wr = 0;
    for (let k = 0; k < d.resid.length; k++) wr = Math.max(wr, Math.abs(f.resid[k] - d.resid[k]));
    ok(wr < 1e-10, `${lab}: residuals match`);
  });

  REF.pgram.forEach(d => {
    const pg = IA.periodogram(REF.harm.y, d.span);
    ok(pg.freq.length === d.freq.length, `periodogram, span ${d.span}: ${d.freq.length} frequencies`);
    let wf = 0, ws = 0;
    for (let k = 0; k < d.freq.length; k++) {
      wf = Math.max(wf, Math.abs(pg.freq[k] - d.freq[k]));
      ws = Math.max(ws, Math.abs(pg.spec[k] - d.spec[k]) / Math.max(1e-12, Math.abs(d.spec[k])));
    }
    ok(wf < 1e-14 && ws < 1e-9, `periodogram, span ${d.span}: matches spec.pgram (largest relative gap ${ws.toExponential(2)})`);
    let kmax = 0;
    for (let k = 1; k < pg.spec.length; k++) if (pg.spec[k] > pg.spec[kmax]) kmax = k;
    /* Smoothing spreads the trend's low-frequency power toward the peak, and
       a wide kernel over 144 readings can move the maximum one Fourier
       frequency; the unsmoothed and lightly smoothed peaks must be exact. */
    const kTrue = REF.harm.y.length / 24 - 1;
    ok(d.span <= 3 ? kmax === kTrue : Math.abs(kmax - kTrue) <= 1,
       `periodogram, span ${d.span}: tallest peak at period ${pg.period[kmax]} (true 24)`);
  });

  {
    const u = IA.MRG32k3a(909), R = 2000, nn = 200;
    let rej = 0;
    for (let i = 0; i < R; i++) {
      const y = [];
      for (let j = 0; j < nn; j++) y.push(IA.normInv(u()));
      if (IA.ljungBox(IA.acf(y, 20), nn, 20, 0).p < 0.05) rej++;
    }
    ok(rej / R > 0.035 && rej / R < 0.065, `Ljung-Box rejects at ${(100 * rej / R).toFixed(1)}% on independent data (nominal 5%)`);

    const t = [], y = [];
    for (let j = 0; j < 480; j++) { t.push(j); y.push(20 + 4 * Math.cos(2 * Math.PI * (j - 15) / 24) + IA.normInv(u())); }
    const f = IA.harmonicFit(t, y, 24, 1, false);
    ok(Math.abs(f.amp[0] - 4) < 0.25, `harmonicFit recovers an amplitude of 4 (${f.amp[0].toFixed(3)})`);
    ok(Math.abs(f.peakAt[0] - 15) < 0.4, `harmonicFit puts the peak at t = 15 (${f.peakAt[0].toFixed(3)})`);

    const z = [0];
    for (let j = 1; j < 2000; j++) z.push(0.8 * z[j - 1] + IA.normInv(u()));
    const a1 = IA.ar1(z);
    ok(Math.abs(a1.phi - 0.8) < 0.05, `ar1 recovers phi = 0.8 (${a1.phi.toFixed(3)})`);
    ok(Math.abs(a1.sigmaE - 1) < 0.05, `ar1 recovers an innovation sd of 1 (${a1.sigmaE.toFixed(3)})`);
  }

  {
    let threw = '', r;
    try { r = [IA.acf([3, 3, 3, 3, 3], 3), IA.ar1([2, 2, 2, 2]), IA.harmonicFit([0, 1, 2, 3, 4, 5], [1, 1, 1, 1, 1, 1], 6, 1, false)]; }
    catch (e) { threw = String(e); }
    ok(!threw && Number.isNaN(r[0][1]) && Number.isNaN(r[1].phi) && Number.isNaN(r[2].F),
       'a constant series gives NaN, never an exception', threw);
  }
}

/* Run on its own. */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { loadCore } = await import('./verify_input_analyzer_jobs.mjs');
  const { IA } = loadCore();
  let pass = 0, fail = 0;
  const failures = [];
  let group = '';
  const t = {
    section(name) { group = name; console.log('\n' + name); },
    ok(cond, label, detail) {
      if (cond) { pass++; console.log('  PASS  ' + label); }
      else { fail++; failures.push(group + ' :: ' + label); console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
    },
    close(got, want, tol, label) {
      const err = Math.abs(got - want) / (Math.abs(want) < 1e-8 ? 1 : Math.abs(want));
      t.ok(err <= tol, `${label}  (err ${err.toExponential(2)} <= ${tol.toExponential(1)})`, `got  ${got}\n        want ${want}`);
    },
  };
  try { runDependence(IA, t); runTimeOrder(IA, t); }
  catch (e) { fail++; failures.push(group + ' :: threw ' + e.message); console.log('  FAIL  threw: ' + e.stack); }
  console.log(`\n${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(fail ? 1 : 0);
}
