/* ══════════════════════════════════════════════════════════════════════
   The slow loops of verify_input_analyzer.mjs, as jobs that can run on
   worker threads.  NOT shipped with the widget.

   Each job is the body of one of the verify script's Monte Carlo loops,
   moved here unchanged: the same seeds, the same draws, the same fits.  A
   job takes a range of replications (or one distribution) and returns
   plain counts and numbers, and the verify script adds the counts up and
   makes its checks on the totals, and so a parallel run prints exactly
   what a serial one does.

   Loaded as a worker thread, this module serves jobs from the verify
   script; imported normally, it hands the same functions to the verify
   script for a serial run (IA_SERIAL=1, or a single-core machine).
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HTML = path.join(here, 'input_analyzer.html');

/* ── Load the core out of the page ─────────────────────────────────── */
export function loadCore() {
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

/* The mirror-image section's sample: 20 minus a gamma(3, 1.5), drawn the
   same way wherever it is needed. */
function mirrorSample(IA) {
  const u = IA.MRG32k3a(1501), x = [];
  for (let i = 0; i < 8000; i++) x.push(20 - IA.DISTS.gamma.sample(u, [3, 1.5]));
  return x;
}

export const JOBS = {
  /* Section 15c: generate from one distribution at its default
     parameters and refit. */
  genRefit(IA, { key, N }) {
    const spec = IA.GEN_SPEC[key], p = spec.map(q => q.def);
    const g = IA.generateSample(key, p, 0, N, 777, null);
    if (!g.ok) return { genOk: false, msg: g.msg };
    const f = IA.fitDist(IA.DISTS[key], g.values, false, false);
    if (!f.ok) return { genOk: true, fitOk: false, msg: f.msg };
    const nML = IA.DISTS[key].mlCount === undefined ? p.length : IA.DISTS[key].mlCount;
    let worst = 0;
    for (let j = 0; j < nML; j++) {
      const denom = Math.abs(p[j]) > 1e-9 ? Math.abs(p[j]) : 1;
      worst = Math.max(worst, Math.abs(f.p[j] - p[j]) / denom);
    }
    let D = null;
    if (key === 'beta') {
      const xs = g.values.slice().sort((a, b) => a - b);
      D = IA.ksStat(xs, IA.fitCdf(f), IA.fitAtom(f)).D;
    }
    return { genOk: true, fitOk: true, worst, D };
  },

  /* Section 15c: a shifted Weibull survives the generate-and-refit round
     trip.  A profile over the shift on 40,000 points takes most of a
     minute, which is why it is a job. */
  shiftRoundTrip(IA) {
    const g = IA.generateSample('weibull', [3, 1.6], 2.5, 40000, 4242, null);
    const f = IA.fitDist(IA.DISTS.weibull, g.values, true, false);
    return { ok: f.ok, shift: f.ok ? f.shift : NaN, shape: f.ok ? f.p[1] : NaN };
  },

  /* Section 15e's control condition: a gamma fit, with the given holds,
     to its own fixed sample of 250, and a 3,000-resample bootstrap. */
  holdControl(IA, { fixed }) {
    const n = 250, u = IA.MRG32k3a(31), x = [];
    for (let i = 0; i < n; i++) x.push(IA.DISTS.gamma.sample(u, [2.5, 1.4]));
    x.sort((a, b) => a - b);
    const f = IA.fitDist(IA.DISTS.gamma, x, false, false, fixed);
    const F = IA.fitCdf(f);
    const D = IA.ksStat(x, F, IA.fitAtom(f)).D, A = IA.adStat(x, F);
    const r = IA.bootstrapRun(f, n, 3000, 777, false, D, A, fixed);
    r.step(3000);
    const res = r.result();
    return { D, tab: IA.ksPvalueClassical(D, n), boot: res.pD, critB: res.critD, critT: IA.ksTableCritical(n) };
  },

  /* Section 15f: the ranking of 2,000 mirror-image values with the mirror
     image on, and which candidate wins by AIC. */
  mirrorRank(IA) {
    const sub = mirrorSample(IA).slice(0, 2000);
    return IA.bestBy(IA.rankAll(sub, IA.CONTINUOUS_KEYS, false, IA.makeBins(sub, 20), {}, {}, true), 'aic');
  },

  /* Section 15f: one of the two bootstraps that must agree exactly, the
     mirrored Weibull on 60 values (mirrored: true) or the shifted one on
     their negatives. */
  mirrorBoot(IA, { mirrored }) {
    const ur = IA.MRG32k3a(77001), y = [];
    for (let i = 0; i < 60; i++) y.push(20 - IA.DISTS.weibull.sample(ur, [3, 1.6]));
    y.sort((a, b) => a - b);
    const data = mirrored ? y : y.map(v => -v).sort((a, b) => a - b);
    const f = mirrored ? IA.fitDist(IA.DISTS.weibull, data, false, false, null, null, true)
                       : IA.fitDist(IA.DISTS.weibull, data, true, false);
    const F = IA.fitCdf(f);
    const b = mirrored
      ? IA.bootstrapRun(f, 60, 200, 31337, false, IA.ksStat(data, F, IA.fitAtom(f)).D, IA.adStat(data, F),
                        null, NaN, 0, null, true)
      : IA.bootstrapRun(f, 60, 200, 31337, true, IA.ksStat(data, F, IA.fitAtom(f)).D, IA.adStat(data, F));
    b.step(200);
    const res = b.result();
    return { pD: res.pD, pA: res.pA };
  },

  /* Section 15f: one candidate, mirrored on x against shifted on -x. */
  mirrorKey(IA, { key }) {
    const x = mirrorSample(IA), neg = x.map(v => -v);
    const xs = x.slice().sort((a, b) => a - b), ns = neg.slice().sort((a, b) => a - b);
    const d = IA.DISTS[key];
    const fm = IA.fitDist(d, x, false, false, null, null, true);
    if (!d.shiftable) {
      const f0 = IA.fitDist(d, x, false, false);
      return { shiftable: false, unchanged: !fm.reflect && fm.ok === f0.ok && (!f0.ok || fm.ll === f0.ll) };
    }
    const fs2 = IA.fitDist(d, neg, true, false);
    return {
      shiftable: true, llM: fm.ll, llS: fs2.ll,
      Dm: IA.ksStat(xs, IA.fitCdf(fm), IA.fitAtom(fm)).D, Ds: IA.ksStat(ns, IA.fitCdf(fs2), IA.fitAtom(fs2)).D,
      Am: IA.adStat(xs, IA.fitCdf(fm)), As: IA.adStat(ns, IA.fitCdf(fs2))
    };
  },

  /* Section 15g, first measurement: the chi-square df conventions on
     uniform data, replications [from, to). */
  chiDf(IA, { from, to, n, K }) {
    let rejPage = 0, rejNaive = 0, used = 0;
    for (let rep = from; rep < to; rep++) {
      const u = IA.MRG32k3a(410000 + rep), x = [];
      for (let i = 0; i < n; i++) x.push(IA.DISTS.uniform.sample(u, [2, 9]));
      const f = IA.fitDist(IA.DISTS.uniform, x, false, false);
      if (!f.ok) continue;
      const c = IA.chiSquareGOF(x, f, IA.makeBins(x, K));
      if (!(c.df >= 1) || !Number.isFinite(c.stat)) continue;
      used++;
      if (c.p < 0.05) rejPage++;
      const dfNaive = c.nGroups - 1 - f.k;
      if (dfNaive >= 1 && IA.gammaQ(dfNaive / 2, c.stat / 2) < 0.05) rejNaive++;
    }
    return { rejPage, rejNaive, used };
  },

  /* Section 15g, second measurement: the bootstrap chi-square under a
     true gamma null, replications [from, to). */
  chiBoot(IA, { from, to, n, K, B }) {
    let rej = 0, used = 0;
    for (let rep = from; rep < to; rep++) {
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
    return { rej, used };
  },

  /* Section 16: bootstrap K-S and A-D calibration for one family,
     replications [from, to). */
  bootCalib(IA, { key, truth, n, B, from, to }) {
    const d = IA.DISTS[key];
    let rejD = 0, rejA = 0, rejTable = 0, used = 0;
    for (let rep = from; rep < to; rep++) {
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
    return { rejD, rejA, rejTable, used };
  }
};

/* ── A pool of worker threads, or a serial stand-in ────────────────────
   run(job, args) records a job and returns a promise of its result, and
   start() sets them all going.  The whole list goes to every worker once,
   and each worker claims the next unclaimed job from a shared counter, so
   that a worker never waits on the main thread for its next job: the main
   thread is busy with sections of its own for minutes at a time, and a
   pool that handed out jobs from there left its workers idle meanwhile.
   Workers number one fewer than the machine's cores (IA_WORKERS
   overrides).  With IA_SERIAL=1, or fewer than two workers, start() runs
   every job on the calling thread instead. */
export function makePool() {
  const cores = (os.availableParallelism ? os.availableParallelism() : os.cpus().length);
  const size = process.env.IA_SERIAL === '1' ? 0
    : Number(process.env.IA_WORKERS || Math.max(0, cores - 1));
  const jobs = [], settle = [];
  let workers = [];
  return {
    size: size >= 2 ? size : 0,
    run(job, args) {
      return new Promise((resolve, reject) => {
        jobs.push({ job, args });
        settle.push({ resolve, reject });
      });
    },
    start() {
      if (size < 2) {
        const { IA } = loadCore();
        jobs.forEach((t, k) => {
          try { settle[k].resolve(JOBS[t.job](IA, t.args)); } catch (e) { settle[k].reject(e); }
        });
        return;
      }
      const next = new SharedArrayBuffer(4);
      for (let w = 0; w < size; w++) {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs, next } });
        worker.on('message', ({ k, res, err }) => {
          if (err) settle[k].reject(new Error(err)); else settle[k].resolve(res);
        });
        worker.on('error', e => { for (const p of settle) p.reject(e); });
        workers.push(worker);
      }
    },
    close() { for (const w of workers) w.terminate(); workers = []; }
  };
}

/* ── Worker side ───────────────────────────────────────────────────── */
if (!isMainThread) {
  const { IA } = loadCore();
  const { jobs, next } = workerData, counter = new Int32Array(next);
  for (let k = Atomics.add(counter, 0, 1); k < jobs.length; k = Atomics.add(counter, 0, 1)) {
    try { parentPort.postMessage({ k, res: JOBS[jobs[k].job](IA, jobs[k].args) }); }
    catch (e) { parentPort.postMessage({ k, err: String(e && e.stack || e) }); }
  }
}
