/* ══════════════════════════════════════════════════════════════════════
   Verification of the dependence numerics (the Relate Two Variables and
   Look for Patterns over Time tabs). NOT shipped with the widget.

   verify_input_analyzer.mjs runs these sections with the rest; this file
   also runs on its own, which takes a few seconds:

     node input_modeling/verify_input_analyzer_dependence.mjs

   The reference values come from verify_dependence_reference.R, which
   generates every dataset with a fixed seed and writes the data and R's
   results to verify_dependence_reference.json. Regenerate the JSON only by
   re-running that script.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

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
    /* Kendall's S by brute force, to check the page's merge-count method on
       tied data of every size. */
    const brute = (x, y) => { let S = 0; for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) S += Math.sign(x[i] - x[j]) * Math.sign(y[i] - y[j]); return S; };
    const u = IA.MRG32k3a(515);
    let bad = '';
    for (let rep = 0; rep < 300; rep++) {
      const n = 2 + Math.floor(u() * 120), x = [], y = [];
      for (let j = 0; j < n; j++) { x.push(Math.floor(u() * 8)); y.push(rep % 3 ? Math.floor(u() * 6) : u()); }
      const k = IA.kendallTauB(x, y);
      if (Number.isFinite(k.S) && k.S !== brute(x, y)) bad = JSON.stringify({ n, S: k.S, want: brute(x, y) });
    }
    ok(!bad, "Kendall's S equals the brute-force count on 300 tied samples", bad);
    const xl = [], yl = [];
    for (let j = 0; j < 20000; j++) { xl.push(Math.floor(u() * 50)); yl.push(xl[j] + u()); }
    let t0 = Date.now(); IA.kendallTauB(xl, yl); const tk = Date.now() - t0;
    ok(tk < 200, `Kendall on 20,000 tied pairs takes ${tk} ms (under 200)`);
    t0 = Date.now(); IA.periodogram(yl, 3); const tp = Date.now() - t0;
    ok(tp < 200, `the periodogram of 20,000 readings takes ${tp} ms (under 200)`);
    const ty = []; for (let j = 0; j < 30011; j++) ty.push(Math.sin(2 * Math.PI * j / 37) + 0.001 * j);
    const pg = IA.periodogram(ty, 1); let km = 0;
    for (let k = 1; k < pg.spec.length; k++) if (pg.spec[k] > pg.spec[km]) km = k;
    ok(Math.abs(pg.period[km] - 37) < 0.1, `a prime-length record with a trend finds its period of 37 (${pg.period[km].toFixed(2)})`);
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
    /* A wide kernel over 144 readings can move the maximum one Fourier
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

/* Runs a generated script and returns what it printed, or null when the
   language is not installed. Each script prints one line per reported
   number, marked "agrees" or "DIFFERS" against the value the page showed. */
function runScript(cmd, args, code, ext, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-dep-'));
  for (const f of files || []) fs.writeFileSync(path.join(dir, f.name), f.text);
  const file = path.join(dir, 'script.' + ext);
  fs.writeFileSync(file, code);
  const r = spawnSync(cmd, [...args, file], { encoding: 'utf8', cwd: dir, timeout: 180000 });
  if (r.error && r.error.code === 'ENOENT') return null;
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}
/* MATLAB starts slowly, and so its scripts run only when IA_MATLAB=1. */
function runMatlab(code, files) {
  if (!process.env.IA_MATLAB) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-dep-'));
  for (const f of files || []) fs.writeFileSync(path.join(dir, f.name), f.text);
  fs.writeFileSync(path.join(dir, 'dep_check.m'), code);
  const r = spawnSync('matlab', ['-batch', `set(0, 'DefaultFigureVisible', 'off'); cd('${dir}'); dep_check`],
                      { encoding: 'utf8', timeout: 600000 });
  if (r.error && r.error.code === 'ENOENT') return null;
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}
function judgeScript(ok, lang, what, res, minLines) {
  if (res === undefined) { console.log(`  (skipped: ${lang}; set IA_MATLAB=1 to run it)`); return; }
  if (!res) { console.log(`  (skipped: ${lang} is not installed)`); return; }
  const agree = (res.out.match(/\bagrees\b/g) || []).length, differ = (res.out.match(/\bDIFFERS\b/g) || []).length;
  ok(res.status === 0 && differ === 0 && agree >= minLines,
     `${lang} script for ${what}: ${agree} values agree with the page, ${differ} differ`,
     res.out.split('\n').filter(l => /DIFFERS|Error|error/.test(l)).slice(0, 8).join('\n        ') || res.out.slice(-800));
}

export function runExports(IA, { section, ok, close }) {
  section('21. export expressions and scripts for the dependence tabs');
  const D = IA.DISTS;
  {
    const base = { a: 1.5, b: 0.25, s: 0.8, xName: 'Items', clip: false, noise: null };
    const e = IA.pairExpressions(base);
    ok(e.arena === '1.5 + 0.25*Items + NORM(0, 0.8)', 'Arena line for a + bX with normal noise', e.arena);
    ok(e.simio === '1.5 + 0.25*Items + Random.Normal(0, 0.8)', 'Simio line', e.simio);
    ok(e.anylogic === '1.5 + 0.25*Items + normal(0.8, 0)', 'AnyLogic line takes the sd first', e.anylogic);
    ok(/rnorm\(n, mean = 0, sd = 0\.8\)/.test(e.r) && /1\.5 \+ 0\.25\*x/.test(e.r), 'R line uses the vector x', e.r);
    const neg = IA.pairExpressions(Object.assign({}, base, { b: -0.25 }));
    ok(neg.arena === '1.5 - 0.25*Items + NORM(0, 0.8)', 'a negative slope is written with a minus sign', neg.arena);
    const cl = IA.pairExpressions(Object.assign({}, base, { clip: true }));
    ok(cl.arena === 'MX(0, 1.5 + 0.25*Items + NORM(0, 0.8))' && cl.simio.startsWith('Math.Max(0, ') &&
       cl.anylogic.startsWith('Math.max(0, ') && cl.r.startsWith('pmax(0, ') && cl.python.startsWith('np.maximum(0, '),
       'clipping at zero uses each tool\'s maximum', cl.arena);
    const g = { dist: D.gamma, p: [2, 1.3], shift: 0 };
    const rs = IA.pairExpressions(Object.assign({}, base, { noise: { kind: 'resid', fit: g } }));
    ok(rs.arena === '1.5 + 0.25*Items + (GAMM(1.3, 2) - 2.6)', 'residuals fitted on tab 1 are centered by their mean', rs.arena);
    ok(/\(stats\.gamma\(a=2, loc=0, scale=1\.3\)\.rvs\(size=n\) - 2\.6\)/.test(rs.python), 'Python draws from the frozen fit', rs.python);
    const nr = IA.pairExpressions(Object.assign({}, base, { noise: { kind: 'resid', fit: { dist: D.normal, p: [-3e-12, 1.1], shift: 0 } } }));
    ok(nr.arena === '1.5 + 0.25*Items + NORM(-3e-12, 1.1)', 'a fitted mean that is rounding error is not subtracted', nr.arena);
    const pu = IA.pairExpressions(Object.assign({}, base, { noise: { kind: 'perunit', fit: g } }));
    ok(pu.arena === 'Items*GAMM(1.3, 2)', 'the per-unit model multiplies X by a draw', pu.arena);
  }
  {
    /* The time expressions, evaluated: the Arena line with the noise set to
       zero must give the fitted cycle at the data's own times, whatever the
       model's base unit. */
    const m = { m: 40, c: [12, 3], s: [-5, 1.5], P: 24, g: 0.02, unit: 'hours', t0: 0, sd: 4, noise: null, ar: null };
    const det = t => 40 + 12 * Math.cos(2 * Math.PI * t / 24) - 5 * Math.sin(2 * Math.PI * t / 24) +
                     3 * Math.cos(4 * Math.PI * t / 24) + 1.5 * Math.sin(4 * Math.PI * t / 24) + 0.02 * t;
    const ev = (expr, env) => new Function(...Object.keys(env), 'return ' + expr)(...Object.values(env));
    const arenaEnv = (tnow, base) => ({ TNOW: tnow, COS: Math.cos, SIN: Math.sin, NORM: () => 0, MX: Math.max,
      SecondsToBaseTime: v => v * base.s, MinutesToBaseTime: v => v * base.m, HoursToBaseTime: v => v * base.h, DaysToBaseTime: v => v * base.d });
    const baseHours = { s: 1 / 3600, m: 1 / 60, h: 1, d: 24 }, baseMinutes = { s: 1 / 60, m: 1, h: 60, d: 1440 };
    const e = IA.timeExpressions(m);
    let worst = 0;
    for (const tt of [0, 5.5, 13, 30]) {
      worst = Math.max(worst, Math.abs(ev(e.arena, arenaEnv(tt, baseHours)) - det(tt)));
      worst = Math.max(worst, Math.abs(ev(e.arena, arenaEnv(tt * 60, baseMinutes)) - det(tt)));
    }
    ok(worst < 1e-6, `the Arena cycle line gives the fitted cycle in hours- and minutes-based models (worst ${worst.toExponential(2)})`, e.arena);
    const em = IA.timeExpressions(Object.assign({}, m, { unit: 'minutes', P: 1440, c: [12], s: [-5], g: null }));
    ok(/\(60\*Run\.TimeNow\)/.test(em.simio), 'Simio converts its hours to the data\'s minutes', em.simio);
    ok(/time\(MINUTE\)/.test(em.anylogic), 'AnyLogic reads the clock in minutes', em.anylogic);
    ok(/MinutesToBaseTime\(1\)/.test(em.arena), 'Arena divides by one minute in base units', em.arena);
    const ss = { Math: { Cos: Math.cos, Sin: Math.sin, Max: Math.max }, Random: { Normal: () => 0 }, Run: { TimeNow: 2.5 } };
    const sv = new Function('Math', 'Random', 'Run', 'return ' + em.simio)(ss.Math, ss.Random, ss.Run);
    close(sv, 40 + 12 * Math.cos(2 * Math.PI * 150 / 1440) - 5 * Math.sin(2 * Math.PI * 150 / 1440), 1e-6,
          'the Simio line, evaluated at 2.5 hours, gives the cycle at 150 minutes');
    const eo = IA.timeExpressions(Object.assign({}, m, { unit: 'other' }));
    ok(/TNOW/.test(eo.arena) && !/BaseTime/.test(eo.arena) && /time\(\)/.test(eo.anylogic), 'an unnamed unit uses the bare clock', eo.arena);
    const e0 = IA.timeExpressions(Object.assign({}, m, { t0: 6 }));
    const w0 = Math.abs(ev(e0.arena, arenaEnv(2, baseHours)) - det(8));
    ok(w0 < 1e-6, 'a clock origin of 6 shifts the model\'s time 0 to data time 6', e0.arena);
    const ea = IA.timeExpressions(Object.assign({}, m, { ar: { phi: 0.7, sigmaE: 1.2 } }));
    const en = IA.timeExpressions(Object.assign({}, m, { ar: { phi: -0.3, sigmaE: 1 } }));
    ok(/filter\(1, \[1, 0\.3\]/.test(en.ar.matlab), 'a negative phi gives MATLAB [1, 0.3], not [1, --0.3]', en.ar.matlab);
    ok(ea.ar && ea.ar.notes && typeof ea.ar.notes.anylogic === 'string' && /FIRST/.test(ea.ar.notes.anylogic),
       'the AR(1) update line carries its noise draw\'s parameter notes', JSON.stringify(ea.ar && ea.ar.notes));
    ok(ea.ar && /Z = 0\.7\*Z \+ NORM\(0, 1\.2\)/.test(ea.ar.arena) && /\+ Z$/.test(ea.arena),
       'with an AR(1), the draw is the cycle plus Z, and Z has its own update line', ea.arena + ' | ' + (ea.ar && ea.ar.arena));
  }
  {
    const u = IA.MRG32k3a(31), x = [], y = [];
    for (let i = 0; i < 40; i++) { const xi = 1 + Math.floor(u() * 20); x.push(xi); y.push(Math.round((0.5 + 0.3 * xi + 0.1 * xi * IA.normInv(u())) * 100) / 100); }
    const sc = IA.pairScripts(x, y, { xName: 'items', yName: 'time', level: 0.95, src: 'verify' });
    judgeScript(ok, 'R', 'two variables', runScript('Rscript', ['--vanilla'], sc.r, 'R'), 14);
    judgeScript(ok, 'Python', 'two variables', runScript('python3', ['-I'], sc.python, 'py'), 14);
    const t = [], yy = [];
    for (let i = 0; i < 168; i++) { t.push(i); yy.push(30 + 8 * Math.cos(2 * Math.PI * (i - 14) / 24) + 2 * IA.normInv(u())); }
    const ts = IA.timeScripts({ t, y: yy }, { maxLag: 40, m: 20, P: 24, H: 1, trend: false, cycle: true, ar: true, span: 3, src: 'verify' });
    judgeScript(ok, 'R', 'a series', runScript('Rscript', ['--vanilla'], ts.r, 'R'), 10);
    judgeScript(ok, 'Python', 'a series', runScript('python3', ['-I'], ts.python, 'py'), 10);
    judgeScript(ok, 'MATLAB', 'two variables', runMatlab(sc.matlab), 14);
    judgeScript(ok, 'MATLAB', 'a series', runMatlab(ts.matlab), 10);
    /* Past MAX_INLINE values the scripts read the tab's CSV download
       instead of embedding the data, and the file carries # provenance
       lines and a blank line above its header. */
    const xb = [], yb = [], tb = [], sb = [];
    for (let i = 0; i < 300; i++) { const xi = 1 + Math.floor(u() * 20); xb.push(xi); yb.push(Math.round((0.5 + 0.3 * xi + IA.normInv(u())) * 100) / 100); }
    for (let i = 0; i < 300; i++) { tb.push(i); sb.push(30 + 8 * Math.cos(2 * Math.PI * i / 24) + 2 * IA.normInv(u())); }
    const prov = ['# Input Analyzer', '# data source: verify', '# a third line', '# a fourth line'];
    const pcsv = IA.pairCsv(xb, yb, prov), scsv = IA.seriesCsv(tb, sb, null, prov);
    const scB = IA.pairScripts(xb, yb, { xName: 'items', yName: 'time', level: 0.95 });
    const tsB = IA.timeScripts({ t: tb, y: sb }, { maxLag: 40, m: 20, P: 24, H: 1, trend: false, cycle: true, ar: true, span: 3 });
    ok(!/^x = np\.array/m.test(scB.python) && /input-analyzer-pairs\.csv/.test(scB.python), 'past 250 values the pair scripts read the CSV');
    const withCsv = (name, text) => ({ name, text });
    judgeScript(ok, 'R', 'two variables read from CSV', runScript('Rscript', ['--vanilla'], scB.r, 'R', [withCsv('input-analyzer-pairs.csv', pcsv)]), 14);
    judgeScript(ok, 'Python', 'two variables read from CSV', runScript('python3', ['-I'], scB.python, 'py', [withCsv('input-analyzer-pairs.csv', pcsv)]), 14);
    judgeScript(ok, 'R', 'a series read from CSV', runScript('Rscript', ['--vanilla'], tsB.r, 'R', [withCsv('input-analyzer-series.csv', scsv)]), 10);
    judgeScript(ok, 'Python', 'a series read from CSV', runScript('python3', ['-I'], tsB.python, 'py', [withCsv('input-analyzer-series.csv', scsv)]), 10);
    judgeScript(ok, 'MATLAB', 'two variables read from CSV', runMatlab(scB.matlab, [withCsv('input-analyzer-pairs.csv', pcsv)]), 14);
    judgeScript(ok, 'MATLAB', 'a series read from CSV', runMatlab(tsB.matlab, [withCsv('input-analyzer-series.csv', scsv)]), 10);
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
  try { runDependence(IA, t); runTimeOrder(IA, t); runExports(IA, t); }
  catch (e) { fail++; failures.push(group + ' :: threw ' + e.message); console.log('  FAIL  threw: ' + e.stack); }
  console.log(`\n${pass} passed, ${fail} failed`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(fail ? 1 : 0);
}
