#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for prob_models.html.  NOT shipped with the widget.

     node input_modeling/verify_prob_models.mjs

   Slices the block between the DG-CORE sentinels out of the HTML and runs it
   in a Node vm context, so the code under test is byte-for-byte the code the
   page ships. Reference values are exact identities, quadrature of each pdf,
   closed-form moments, and goodness-of-fit calibration of every sampler.
   DG_CALIB_REPS (default 200) shortens the calibration sections.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'prob_models.html');
const REPS = Math.max(40, Number(process.env.DG_CALIB_REPS) || 200);
const t0 = Date.now();

function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== DG-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== DG-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('DG-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core)) throw new Error('DG core references the DOM');
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN, Float64Array };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'prob_models.html#DG-CORE' });
  if (!ctx.DG) throw new Error('core ran but exported no DG namespace');
  return ctx.DG;
}

let pass = 0, fail = 0, group = '';
const failures = [];
const tty = process.stdout.isTTY;
const g = s => tty ? `\x1b[32m${s}\x1b[0m` : s, r = s => tty ? `\x1b[31m${s}\x1b[0m` : s, bold = s => tty ? `\x1b[1m${s}\x1b[0m` : s;
function section(name) { group = name; console.log('\n' + bold(name)); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ' + g('PASS') + '  ' + label); }
  else { fail++; failures.push(group + ' :: ' + label); console.log('  ' + r('FAIL') + '  ' + label + (detail ? '\n        ' + detail : '')); }
}
function close(got, want, tol, label) {
  const scale = Math.abs(want) < 1e-8 ? 1 : Math.abs(want);
  const err = Math.abs(got - want) / scale;
  ok(err <= tol, `${label}  (rel err ${Number.isFinite(err) ? err.toExponential(2) : err} <= ${tol.toExponential(1)})`, `got ${got}, want ${want}`);
}
function rateOk(count, R, p, k, label) {
  const se = Math.sqrt(p * (1 - p) / R), got = count / R;
  ok(Math.abs(got - p) <= k * se, `${label}  (${got.toFixed(4)} vs ${p.toFixed(4)}, ${k} se = ${(k * se).toFixed(4)})`);
}
/* Composite Simpson on [a, b] with n (even) panels. */
function simpson(f, a, b, n) {
  const h = (b - a) / n; let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
/* A shape parameter below 1 in the Beta, Gamma, or Weibull makes the density
   genuinely infinite at a support endpoint, even though the integral over
   the whole interval is finite -- the same way 1/sqrt(x) diverges at 0 while
   still integrating to a finite value on (0, 1]. Plain Simpson cannot
   resolve that: sampling the endpoint directly sums an infinite term, and
   sampling nearby instead just swaps it for an enormous but equally
   unrepresentative one, because the density is genuinely huge across the
   whole neighborhood, not only at the single point x = edge.
   The fix is the standard one for an integrable power-law singularity:
   substitute t = |x - edge|^p, where p is the density's local exponent
   (f ~ c|x - edge|^(p-1)) fitted from two samples near the edge. The
   substitution's Jacobian exactly cancels the power law, leaving a finite,
   smooth integrand in t that ordinary Simpson integrates accurately. */
function halfMass(f, edge, far, n) {
  const s = far > edge ? 1 : -1;
  const width = Math.abs(far - edge);
  const probe = width * 1e-3;
  const f1 = f(edge + s * probe), f2 = f(edge + s * probe / 2);
  const p = 1 - Math.log(f2 / f1) / Math.log(2);
  const c = f1 / Math.pow(probe, p - 1);
  const T = Math.pow(width, p);
  function g(t) {
    if (t <= 0) return c / p;
    const delta = Math.pow(t, 1 / p);
    const x = edge + s * delta;
    /* A very small t can underflow x back to exactly 'edge' in floating
       point (subtracting a tiny delta from 1 rounds to 1, for instance),
       which would sample the infinite density directly; fall back to the
       same fitted power law for that regime instead. */
    const fx = x === edge ? c * Math.pow(delta, p - 1) : f(x);
    return fx * (1 / p) * Math.pow(t, 1 / p - 1);
  }
  return simpson(g, 0, T, n);
}
/* A density with a small shape parameter (a slowly decaying Weibull or
   Gamma tail) can need an enormously distant point before its cdf is within
   1e-9 of 1, and so the interval from a middling point out to that tail can span
   many orders of magnitude -- far more than a fixed panel count can resolve
   on a uniform grid, since nearly every panel would land where the density
   is negligible. Substituting x = near * e^v turns that multiplicative
   range into an additive one of ordinary size.
   When the support genuinely has no upper end, far is only ever a
   quantile-based stand-in for infinity, and extendable says so: it lets far
   be doubled and the integral over [near, far] recomputed until an extra
   doubling no longer moves the answer, because a stand-in can fall well
   short. An F distribution whose denominator degrees of freedom sit just
   above the four its variance needs to stay finite decays so slowly that
   its second moment still carries a non-negligible sliver beyond even a
   1 - 1e-10 quantile (about 2% of the variance, for F(1, 5)), and no single
   finite quantile is a safe stand-in for every such distribution in the
   registry. When the support's upper end is an exact finite value instead,
   far must not be pushed past it: the density is genuinely, not just
   negligibly, zero out there, and widening the panel spacing to reach past
   a real edge only loses resolution right where the density actually
   changes. */
function tailMass(f, near, far, n, extendable) {
  if (far <= near) far = near * 2;
  if (!extendable) {
    const V = Math.log(far / near);
    function g(v) { const x = near * Math.exp(v); return f(x) * x; }
    return simpson(g, 0, V, n);
  }
  let hi = far, prev = null, cur = 0;
  for (let iter = 0; iter < 40; iter++) {
    const V = Math.log(hi / near);
    function g(v) { const x = near * Math.exp(v); return f(x) * x; }
    cur = simpson(g, 0, V, n);
    if (prev !== null && Math.abs(cur - prev) <= Math.abs(cur) * 1e-9) break;
    prev = cur;
    hi *= 4;
  }
  return cur;
}
/* Integrates f (a density, or a density times a moment weight) over the
   distribution's full support, splitting at the median rather than the
   arithmetic mean so both halves carry comparable mass even when the
   support is extremely skewed, and routing each half to whichever of the
   helpers above its behavior needs: a power-law spike at the edge, a long
   thin tail (only meaningful when the support does not reach below 0), or
   an ordinary well-behaved stretch. hiUnbounded marks whether b is the
   support's real upper edge or only a quantile standing in for infinity,
   which is what tells the long-thin-tail branch whether it may push past b. */
function fullMass(f, a, b, median, n, hiUnbounded) {
  const fa = f(a), fb = f(b);
  const mid = (Number.isFinite(median) && median > a && median < b) ? median : (a + b) / 2;
  const left = Number.isFinite(fa) ? simpson(f, a, mid, n) : halfMass(f, a, mid, n);
  let right;
  if (!Number.isFinite(fb)) right = halfMass(f, b, mid, n);
  else if (a >= 0 && mid > 0) right = tailMass(f, mid, b, n, !!hiUnbounded);
  else right = simpson(f, mid, b, n);
  return left + right;
}
/* Integrates f from the support's lower end to some interior point x. Only
   that lower end can be a power-law spike here: x is always a middling
   quantile (0.1, 0.5, or 0.9) rather than a near-1 tail cutoff, and so the
   long-thin-tail case fullMass handles never arises and a plain
   arithmetic-mean split is adequate. */
function partMass(f, a, x, n) {
  const fa = f(a);
  if (Number.isFinite(fa)) return simpson(f, a, x, n);
  const mid = (a + x) / 2;
  return halfMass(f, a, mid, n) + simpson(f, mid, x, n);
}

const DG = loadCore();

section('Special functions');
{
  const sf = DG.sf;
  close(Math.exp(sf.lgamma(5)), 24, 1e-12, 'Γ(5) = 4!');
  close(Math.exp(sf.lgamma(0.5)), Math.sqrt(Math.PI), 1e-12, 'Γ(1/2) = √π');
  close(Math.exp(sf.lgamma(7.5)), 1871.254305797788, 1e-11, 'Γ(7.5)');
  close(sf.gammaP(1, 2), 1 - Math.exp(-2), 1e-12, 'P(1, x) = 1 − e^−x');
  close(sf.gammaP(3, 2.5), 1 - Math.exp(-2.5) * (1 + 2.5 + 2.5 * 2.5 / 2), 1e-12, 'P(3, x) matches the Erlang-3 cdf');
  close(sf.gammaP(0.5, 2), sf.erf(Math.sqrt(2)), 1e-11, 'P(1/2, x) = erf(√x)');
  close(sf.betaI(1, 1, 0.3), 0.3, 1e-12, 'I_x(1, 1) = x');
  close(sf.betaI(2, 3, 0.4), 1 - Math.pow(0.6, 4) - 4 * 0.4 * Math.pow(0.6, 3), 1e-12, 'I_x(2, 3) by the binomial identity');
  close(sf.betaI(2.5, 1.5, 0.5) + sf.betaI(1.5, 2.5, 0.5), 1, 1e-12, 'I_x(a, b) + I_{1−x}(b, a) = 1');
  close(sf.erf(0.5), 0.5204998778130465, 1e-12, 'erf(0.5)');
  close(sf.erfc(2), 0.004677734981047266, 1e-10, 'erfc(2)');
  close(sf.normCdf(1.959963984540054), 0.975, 1e-10, 'Φ(1.96) = 0.975');
  close(sf.normQ(0.975), 1.959963984540054, 1e-9, 'Φ⁻¹(0.975)');
  close(sf.normQ(sf.normCdf(-3.3)), -3.3, 1e-8, 'Φ⁻¹(Φ(−3.3)) round trip');
  close(Math.exp(sf.logChoose(10, 3)), 120, 1e-12, 'C(10, 3) = 120');
  close(Math.exp(sf.logChoose(50, 25)), 126410606437752, 1e-10, 'C(50, 25)');
}

section('Generic quantiles');
{
  const F = x => 1 - Math.exp(-2 * x);
  close(DG.bisectQ(F, 0.5, 0, 50), Math.log(2) / 2, 1e-10, 'bisectQ inverts an exponential cdf');
  close(DG.bisectQ(F, 0.999999, 0, 50), -Math.log(1e-6) / 2, 1e-8, 'bisectQ handles a far-tail u');
  const Fd = k => k < 0 ? 0 : Math.min(1, 0.2 * (Math.floor(k) + 1));
  ok(DG.searchQ(Fd, 0.5, 0) === 2 && DG.searchQ(Fd, 0.2, 0) === 0 && DG.searchQ(Fd, 0.2000001, 0) === 1, 'searchQ returns the smallest k with F(k) >= u');
}

section('RNG');
{
  const rand = DG.mulberry32(12345);
  let n = 0, sum = 0, lo = 1, hi = 0;
  for (let i = 0; i < 100000; i++) { const u = DG.unif(rand); n++; sum += u; lo = Math.min(lo, u); hi = Math.max(hi, u); }
  ok(lo > 0 && hi < 1, `unif stays inside (0, 1)  (min ${lo.toExponential(2)}, max ${hi})`);
  close(sum / n, 0.5, 5e-3, 'unif mean near 1/2');
  const a = DG.mulberry32(7), b = DG.mulberry32(7);
  ok(a() === b() && a() === b(), 'the same seed reproduces the same stream');
}

section('Registry shape');
{
  const ids = DG.dists.map(d => d.id);
  ok(ids.join(',') === 'unif,tri,norm,expo,erlang,weib,bern,binom,geom,nbinom,pois,gamma,chisq,fdist,beta,lnorm,rayl,dunif', 'eighteen distributions in tab order');
  for (const d of DG.dists) {
    ok(d.refs.length === 3 && d.params.length >= 1 && ['closed', 'search', 'numeric'].includes(d.gen.kind), `${d.id}: three refs, params, and a generator kind`);
    /* Three edges is the true floor, not an arbitrary one: the Bernoulli has
       exactly two possible outcomes, and so its integer-bin histogram can never
       have more than two bins no matter how it is implemented. */
    ok(d.axis.x0 < d.axis.x1 && d.axis.y1 > 0 && d.gen.bins.length >= 3, `${d.id}: axis and generator bins declared`);
  }
}

/* The parameter sets each distribution is checked at: its three reference sets
   plus its knob defaults plus two corners of the knob ranges. */
function paramSets(d) {
  const def = {}; for (const q of d.params) def[q.key] = q.def;
  const lo = {}; for (const q of d.params) lo[q.key] = q.min;
  const hi = {}; for (const q of d.params) hi[q.key] = q.max;
  return [...d.refs.map(r => r.p), def, d.clamp(lo), d.clamp(hi)];
}

section('Normalization, cdf against pdf, and quantile round trips');
for (const d of DG.dists) {
  for (const p of paramSets(d)) {
    const tag = `${d.id} ${JSON.stringify(p)}`;
    const s = d.support(p);
    if (d.type === 'c') {
      const a = Number.isFinite(s.lo) ? s.lo : d.quantile(1e-9, p), b = Number.isFinite(s.hi) ? s.hi : d.quantile(1 - 1e-9, p);
      const median = d.quantile(0.5, p);
      const mass = fullMass(x => d.pdf(x, p), a, b, median, 20000, !Number.isFinite(s.hi));
      close(mass, 1, 2e-4, `${tag}: pdf integrates to 1 over the support`);
      for (const q of [0.1, 0.5, 0.9]) {
        const x = d.quantile(q, p);
        close(d.cdf(x, p), q, 1e-7, `${tag}: cdf(quantile(${q})) = ${q}`);
        close(partMass(t => d.pdf(t, p), a, x, 20000), d.cdf(x, p) - d.cdf(a, p), 2e-4, `${tag}: cdf(${q} quantile) matches ∫pdf`);
      }
    } else {
      let sum = 0, k = s.lo, prev = 0, okInc = true;
      const kmax = Number.isFinite(s.hi) ? s.hi : d.quantile(1 - 1e-10, p) + 5;
      for (; k <= kmax; k++) { sum += d.pdf(k, p); if (Math.abs(d.cdf(k, p) - prev - d.pdf(k, p)) > 1e-10) okInc = false; prev = d.cdf(k, p); }
      close(sum, 1, 1e-8, `${tag}: pmf sums to 1`);
      ok(okInc, `${tag}: pmf equals the cdf's increments`);
      for (const q of [0.1, 0.5, 0.9]) {
        const x = d.quantile(q, p);
        ok(d.cdf(x, p) >= q - 1e-12 && (x === s.lo || d.cdf(x - 1, p) < q), `${tag}: quantile(${q}) is the smallest k with F(k) >= u`);
      }
    }
  }
}

section('Moments');
for (const d of DG.dists) {
  for (const p of paramSets(d)) {
    const tag = `${d.id} ${JSON.stringify(p)}`;
    const s = d.support(p);
    let m1, m2;
    if (d.type === 'c') {
      const a = Number.isFinite(s.lo) ? s.lo : d.quantile(1e-10, p), b = Number.isFinite(s.hi) ? s.hi : d.quantile(1 - 1e-10, p);
      const median = d.quantile(0.5, p);
      const hiUnbounded = !Number.isFinite(s.hi);
      m1 = fullMass(x => x * d.pdf(x, p), a, b, median, 40000, hiUnbounded); m2 = fullMass(x => x * x * d.pdf(x, p), a, b, median, 40000, hiUnbounded);
    } else {
      m1 = 0; m2 = 0; const kmax = Number.isFinite(s.hi) ? s.hi : d.quantile(1 - 1e-12, p) + 10;
      for (let k = s.lo; k <= kmax; k++) { const f = d.pdf(k, p); m1 += k * f; m2 += k * k * f; }
    }
    close(d.mean(p), m1, 2e-3, `${tag}: mean`);
    close(d.variance(p), m2 - m1 * m1, 5e-3, `${tag}: variance`);
  }
}

section('Samplers against their own cdf (goodness of fit at 1%)');
/* Continuous: Kolmogorov–Smirnov on n = 1000 draws, critical value 1.628/√n.
   Discrete: chi-square on n = 2000 draws with cells pooled to expected >= 5.
   Over REPS replications the rejection rate should sit near 0.01. */
function ksReject(d, p, rand) {
  const n = 1000, xs = []; for (let i = 0; i < n; i++) xs.push(d.sample(rand, p));
  xs.sort((a, b) => a - b);
  let D = 0; for (let i = 0; i < n; i++) { const F = d.cdf(xs[i], p); D = Math.max(D, F - i / n, (i + 1) / n - F); }
  return D > 1.628 / Math.sqrt(n);
}
function chi2Reject(d, p, rand) {
  const n = 2000, s = d.support(p), counts = new Map();
  for (let i = 0; i < n; i++) { const k = d.sample(rand, p); counts.set(k, (counts.get(k) || 0) + 1); }
  const kmax = Number.isFinite(s.hi) ? s.hi : d.quantile(1 - 1e-9, p) + 3;
  const cells = []; let eAcc = 0, oAcc = 0;
  for (let k = s.lo; k <= kmax; k++) {
    eAcc += n * d.pdf(k, p); oAcc += counts.get(k) || 0;
    if (eAcc >= 5) { cells.push([oAcc, eAcc]); eAcc = 0; oAcc = 0; }
  }
  if (eAcc > 0 || oAcc > 0) { if (cells.length) { cells[cells.length - 1][0] += oAcc; cells[cells.length - 1][1] += eAcc; } else cells.push([oAcc, eAcc]); }
  let stat = 0; for (const [o, e] of cells) stat += (o - e) * (o - e) / e;
  const df = cells.length - 1;
  return 1 - DG.sf.gammaP(df / 2, stat / 2) < 0.01;
}
for (const d of DG.dists) {
  for (const p of d.refs.map(r => r.p)) {
    const rand = DG.mulberry32(101 + d.id.length);
    let rej = 0;
    for (let i = 0; i < REPS; i++) if (d.type === 'c' ? ksReject(d, p, rand) : chi2Reject(d, p, rand)) rej++;
    rateOk(rej, REPS, 0.01, 4, `${d.id} ${JSON.stringify(p)}: sampler rejection rate`);
  }
}

section('Clamping');
{
  const u = DG.byId.unif.clamp({ a: 5, b: 3 }); ok(u.b > u.a, 'uniform: b is pushed above a');
  const t = DG.byId.tri.clamp({ a: 0, b: 10, c: 12 }); ok(t.c > t.a && t.c < t.b, 'triangular: c is pulled inside (a, b)');
  const du = DG.byId.dunif.clamp({ a: 4, b: 2 }); ok(du.b >= du.a, 'discrete uniform: b is pushed to at least a');
}

/* Two-sample Kolmogorov-Smirnov statistic: the largest gap between the two
   samples' empirical cdfs, evaluated at every distinct value either sample
   takes. Ties are resolved by value rather than by which sample an equal
   entry came from: both empirical cdfs have to include every tied entry
   before the gap at that value is measured, or a discrete sample with many
   repeated values (a binomial count, say) reports a spurious gap from
   however the sort happened to interleave the tied entries. */
function ks2(xs, ys) {
  const n = xs.length, m = ys.length;
  const sx = xs.slice().sort((a, b) => a - b), sy = ys.slice().sort((a, b) => a - b);
  const values = Array.from(new Set(sx.concat(sy))).sort((a, b) => a - b);
  let ix = 0, iy = 0, D = 0;
  for (const v of values) {
    while (ix < n && sx[ix] <= v) ix++;
    while (iy < m && sy[iy] <= v) iy++;
    D = Math.max(D, Math.abs(ix / n - iy / m));
  }
  return D;
}

section('Chi-square and F identities');
/* These pin the two relationships that make the chi-square and the F worth
   adding to the gallery: the chi-square is the special case of the gamma
   that a sum of squared normals lands on, and the F is what falls out of
   dividing two independent chi-squares by their own degrees of freedom. */
{
  const chisq = DG.byId.chisq, gamma = DG.byId.gamma, rayl = DG.byId.rayl, fdist = DG.byId.fdist;

  for (const x of [0, 0.1, 0.5, 1, 2, 5, 10]) {
    close(chisq.pdf(x, { k: 2 }), 0.5 * Math.exp(-x / 2), 1e-12, `chisq(k=2) pdf(${x}) = exponential(mean 2) pdf`);
    close(chisq.cdf(x, { k: 2 }), 1 - Math.exp(-x / 2), 1e-12, `chisq(k=2) cdf(${x}) = exponential(mean 2) cdf`);
  }

  for (const k of [1, 2, 3, 4, 10]) {
    for (const x of [0.1, 1, 5, 15]) {
      close(chisq.pdf(x, { k }), gamma.pdf(x, { k: k / 2, theta: 2 }), 1e-12, `chisq(k=${k}) pdf(${x}) = Gamma(${k / 2}, 2) pdf`);
      close(chisq.cdf(x, { k }), gamma.cdf(x, { k: k / 2, theta: 2 }), 1e-12, `chisq(k=${k}) cdf(${x}) = Gamma(${k / 2}, 2) cdf`);
    }
  }

  /* R ~ Rayleigh(sigma) implies R^2 / sigma^2 ~ chisq(2): P(R^2/sigma^2 <= x)
     = P(R <= sigma sqrt(x)), so the Rayleigh cdf at sigma*sqrt(x) must equal
     the chi-square cdf at x for every sigma. */
  for (const sigma of [0.5, 1, 2]) {
    for (const x of [0.1, 1, 3, 8]) {
      close(rayl.cdf(sigma * Math.sqrt(x), { sigma }), chisq.cdf(x, { k: 2 }), 1e-12, `Rayleigh(sigma=${sigma}) at sigma*sqrt(${x}) = chisq(2) cdf(${x})`);
    }
  }

  /* A sum of k squared standard normals is, by definition, a chisq(k)
     variate; compare that construction against the chisq sampler by a
     two-sample KS test rather than by a moment, since it is the whole
     distribution the definition claims, not just its mean or variance. */
  for (const k of [1, 3, 6]) {
    const randA = DG.mulberry32(9001 + k), randB = DG.mulberry32(9101 + k), n = 4000;
    const xs = [];
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) { const z = DG.sf.normQ(DG.unif(randA)); s += z * z; }
      xs.push(s);
    }
    const ys = []; for (let i = 0; i < n; i++) ys.push(chisq.sample(randB, { k }));
    const D = ks2(xs, ys), crit = 1.95 * Math.sqrt(2 / n);
    ok(D < crit, `sum of ${k} squared standard normals matches chisq(${k}) (D = ${D.toFixed(4)} < ${crit.toFixed(4)})`);
  }

  /* F(d1, d2) is, by definition, the ratio of two independent chi-squares
     each divided by its own degrees of freedom; compare that construction
     against the F sampler by the same two-sample KS test. */
  for (const [d1, d2] of [[1, 10], [5, 10], [10, 20]]) {
    const randA = DG.mulberry32(9201 + d1 + d2), randB = DG.mulberry32(9301 + d1 + d2), n = 4000;
    const xs = [];
    for (let i = 0; i < n; i++) xs.push((chisq.sample(randA, { k: d1 }) / d1) / (chisq.sample(randA, { k: d2 }) / d2));
    const ys = []; for (let i = 0; i < n; i++) ys.push(fdist.sample(randB, { d1, d2 }));
    const D = ks2(xs, ys), crit = 1.95 * Math.sqrt(2 / n);
    ok(D < crit, `chisq(${d1})/${d1} over chisq(${d2})/${d2} matches F(${d1}, ${d2}) (D = ${D.toFixed(4)} < ${crit.toFixed(4)})`);
  }

  /* F(1, d2)'s cdf also equals 2*T(sqrt(x)) - 1 for a Student t variate T
     with d2 degrees of freedom, but checking that would mean adding a t cdf
     to the core purely to verify a distribution the widget does not carry;
     the KS check above already exercises F(1, d2) against its own
     definition, so that identity is left unchecked here. */
}

section('Constructions match the direct samplers');
/* DG.construct builds eight distributions out of nothing but uniform draws,
   independently of the quantile-based sampler each Dist object carries. A
   two-sample Kolmogorov–Smirnov test compares the whole distribution the
   construction produces against the whole distribution the direct sampler
   produces, rather than only a moment the two could share by coincidence. */
{
  const C = DG.construct;
  const rand = DG.mulberry32(11), n = 4000;
  for (const [id, p, draw] of [
    ['erlang', { k: 3, lam: 1.5 }, r => C.erlang(r, { k: 3, lam: 1.5 }).x],
    ['binom', { n: 12, p: 0.3 }, r => C.binom(r, { n: 12, p: 0.3 }).x],
    ['nbinom', { r: 3, p: 0.4 }, r => C.nbinom(r, { r: 3, p: 0.4 }).x],
    ['norm', { mu: 0, sigma: 1 }, r => C.boxMuller(r, 1).a],
    ['rayl', { sigma: 1.5 }, r => C.boxMuller(r, 1.5).r],
    ['beta', { alpha: 2, beta: 5 }, r => C.betaOrder(r, { alpha: 2, beta: 5 }).x],
    ['chisq', { k: 5 }, r => C.chisq(r, { k: 5 }).x],
    ['fdist', { d1: 5, d2: 10 }, r => C.fdist(r, { d1: 5, d2: 10 }).x],
  ]) {
    const d = DG.byId[id], xs = [], ys = [];
    for (let i = 0; i < n; i++) { xs.push(draw(rand)); ys.push(d.sample(rand, p)); }
    const D = ks2(xs, ys), crit = 1.628 * Math.sqrt(2 / n);
    ok(D < crit, `${id}: construction vs direct sampler, two-sample KS D = ${D.toFixed(4)} < ${crit.toFixed(4)}`);
  }
  const bm = C.boxMuller(DG.mulberry32(5), 2);
  close(bm.a * bm.a + bm.b * bm.b, bm.r * bm.r, 1e-12, 'Box–Muller: a² + b² = r²');
  ok(C.betaOrder(DG.mulberry32(1), { alpha: 2.5, beta: 5 }) === null, 'betaOrder declines non-integer parameters');
  const e = C.erlang(DG.mulberry32(9), { k: 4, lam: 2 });
  close(e.parts.reduce((s, v) => s + v, 0), e.x, 1e-12, 'Erlang: the stages sum to the draw');
  const cs = C.chisq(DG.mulberry32(13), { k: 6 });
  close(cs.sqs.reduce((s, v) => s + v, 0), cs.x, 1e-12, 'Chi-square construction: the squared normals sum to the draw');
  close(cs.run[cs.run.length - 1], cs.x, 1e-12, 'Chi-square construction: the running total ends at the draw');
  const fs = C.fdist(DG.mulberry32(17), { d1: 4, d2: 8 });
  close(fs.x, fs.r1 / fs.r2, 1e-12, 'F construction: the ratio of the two scaled chi-squares is the draw');
}

section('Closed-form recipes agree with the quantile');
{
  const rand = DG.mulberry32(3);
  const rec = {
    unif: (u, p) => p.a + (p.b - p.a) * u,
    tri: (u, p) => u < (p.c - p.a) / (p.b - p.a) ? p.a + Math.sqrt(u * (p.b - p.a) * (p.c - p.a)) : p.b - Math.sqrt((1 - u) * (p.b - p.a) * (p.b - p.c)),
    expo: (u, p) => -Math.log(1 - u) / p.lam,
    weib: (u, p) => p.mu * Math.pow(-Math.log(1 - u), 1 / p.k),
    rayl: (u, p) => p.sigma * Math.sqrt(-2 * Math.log(1 - u)),
    bern: (u, p) => u > 1 - p.p ? 1 : 0,
    geom: (u, p) => p.p >= 1 ? 1 : Math.ceil(Math.log(1 - u) / Math.log(1 - p.p)),
    dunif: (u, p) => Math.min(p.b, p.a + Math.floor((p.b - p.a + 1) * u)),
  };
  for (const id of Object.keys(rec)) {
    const d = DG.byId[id]; let worst = 0;
    for (const p of paramSets(d)) for (let i = 0; i < 2000; i++) { const u = DG.unif(rand); worst = Math.max(worst, Math.abs(rec[id](u, p) - d.quantile(u, p))); }
    ok(worst < 1e-9, `${id}: the displayed recipe equals the core quantile (max |Δ| ${worst.toExponential(1)})`);
  }

  /* The discrete uniform's displayed recipe is the standard floor form, but
     the core computes the equivalent ceiling form a + ceil(n*u) - 1; the two
     agree everywhere except when n*u lands exactly on an integer, which
     happens with probability zero over a continuous u. Count how often that
     tie actually falls out of 2000 draws per parameter set. */
  {
    const d = DG.byId.dunif; let mismatches = 0, ties = 0, total = 0;
    for (const p of paramSets(d)) {
      const n = p.b - p.a + 1;
      for (let i = 0; i < 2000; i++) {
        total++;
        const u = DG.unif(rand);
        const floorForm = Math.min(p.b, p.a + Math.floor(n * u));
        const ceilForm = d.quantile(u, p);
        const isTie = Math.abs(n * u - Math.round(n * u)) < 1e-9;
        if (isTie) ties++;
        else if (floorForm !== ceilForm) mismatches++;
      }
    }
    ok(mismatches === 0, `dunif: floor and ceiling forms agree away from the exact-integer tie (0 mismatches over ${total} draws, ${ties} exact ties)`);
  }
}

// SECTIONS-END

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fail) { console.log(failures.map(f => '  ' + f).join('\n')); process.exit(1); }
