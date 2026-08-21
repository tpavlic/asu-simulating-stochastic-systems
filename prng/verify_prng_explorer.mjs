#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for prng_explorer.html.  NOT shipped with the widget.

     node prng/verify_prng_explorer.mjs

   The script slices the block between the PRNG-CORE sentinels out of
   prng_explorer.html and runs it in a Node vm context, and so the code under
   test is byte-for-byte the code the page ships.  There is no second copy
   of the numerics.

   Reference values and their sources:
   - LCG reference vectors (minimal standard, RANDU, the C-standard-style
     power-of-two preset, the toy m = 16 preset, and two moduli near 2^61
     and 2^62 whose products overflow 2^53): computed 2026-08-20 with
     Python 3 arbitrary-precision integers, an implementation independent
     of the page's BigInt code.
   - The minimal-standard 10,000-step check value 1043618065 from seed 1
     is also the published self-test value in Park & Miller (CACM 31(10),
     1988); the Python run reproduces it.
   - Constants: minimal standard a = 16807 = 7^5, m = 2^31 - 1 and RANDU
     a = 65539, m = 2^31 (odd seed) as documented in the sources cited in
     the page itself; verified against the Wikipedia articles "Lehmer
     random number generator", "RANDU", and "Linear congruential
     generator" as of 2026-08-20.
   - Special functions are checked against exact identities
     (Gamma(1/2) = sqrt(pi), P(1,x) = 1 - e^-x, chi-square df = 2 upper
     tail = e^{-x/2}) so that a reader can check the check.
   - The chi-square and K-S p-value calibrations are empirical: on a
     known-good generator both tests must reject at close to their nominal
     5% rate.  This is the check that would catch a wrong constant in the
     Stephens adjustment or a broken tail computation, without trusting
     any single published table.

   PRNG_CALIB_REPS shortens the calibration sections (default 1500).
   PRNG_QUICK=1 skips the direct 2.1-billion-step walk of the minimal
   standard's full cycle; the number-theoretic order proof still runs.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'prng_explorer.html');
const CALIB_REPS = Math.max(200, Number(process.env.PRNG_CALIB_REPS) || 1500);
const QUICK = process.env.PRNG_QUICK === '1';

/* ── Load the core out of the page ─────────────────────────────────── */
function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== PRNG-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== PRNG-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('PRNG-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core))
    throw new Error('PRNG core references the DOM');
  const ctx = { Math, Number, BigInt, NaN, Infinity, Array, Object, String,
                RegExp, JSON, isNaN, isFinite, Float64Array, console };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'prng-core.js' });
  return ctx;
}
const P = loadCore();

/* ── Tiny harness ──────────────────────────────────────────────────── */
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ok      ' + name); }
  else { fail++; console.log('  FAIL    ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
function section(t) { console.log('\n== ' + t + ' =='); }

/* mulberry32: the known-good reference driver for the calibration
   sections.  Deliberately not the generator family under test. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 1. Exact reference vectors (Python 3 big ints, 2026-08-20) ────── */
section('LCG reference vectors (independent big-integer arithmetic)');
const VECTORS = [
  { name: 'minimal standard (a=16807, m=2^31-1, seed 1)',
    a: 16807n, c: 0n, m: 2147483647n, seed: 1n,
    first: [16807n, 282475249n, 1622650073n, 984943658n, 1144108930n] },
  { name: 'RANDU (a=65539, m=2^31, seed 1)',
    a: 65539n, c: 0n, m: 2147483648n, seed: 1n,
    first: [65539n, 393225n, 1769499n, 7077969n, 26542323n] },
  { name: 'C-standard-style (a=1103515245, c=12345, m=2^31, seed 12345)',
    a: 1103515245n, c: 12345n, m: 2147483648n, seed: 12345n,
    first: [1406932606n, 654583775n, 1449466924n, 229283573n, 1109335178n] },
  { name: 'toy (a=5, c=3, m=16, seed 1)',
    a: 5n, c: 3n, m: 16n, seed: 1n,
    first: [8n, 11n, 10n, 5n, 12n] },
  { name: 'm = 2^61-1 (products far above 2^53)',
    a: 1234567890123456789n, c: 987654321n, m: (1n << 61n) - 1n, seed: 42n,
    first: [1123305183471572537n, 373359835689523435n, 1737563868165530452n,
            833817610527289767n, 488688088871627n] },
  { name: 'm = 2^62 (power of two above 2^53)',
    a: 3141592653589793239n, c: 2718281828459045235n, m: 1n << 62n, seed: 1n,
    first: [1248188463621450570n, 863630810918573721n, 2347901540487773426n,
            369478021999104689n, 3234662267895647514n] },
];
for (const v of VECTORS) {
  const g = P.makeLCG(v.a, v.c, v.m, v.seed);
  let ok = true, got = [];
  for (let i = 0; i < v.first.length; i++) {
    const r = g.detail();
    got.push(r.x);
    if (r.x !== v.first[i]) ok = false;
  }
  check(v.name, ok, ok ? '' : 'got ' + got.join(','));
}

/* The u outputs must be exactly x/m for the same states, and lcgStream
   must agree with stepping one at a time. */
{
  const v = VECTORS[0];
  const us = P.lcgStream(v.a, v.c, v.m, v.seed, 5);
  let ok = true;
  for (let i = 0; i < 5; i++) if (us[i] !== Number(v.first[i]) / Number(v.m)) ok = false;
  check('lcgStream u_n === x_n / m and matches stepped states', ok);
}

/* Park & Miller's published self-test: from seed 1, the minimal
   standard's 10,000th state is 1043618065. */
{
  const g = P.makeLCG(16807n, 0n, 2147483647n, 1n);
  for (let i = 0; i < 10000; i++) g.next();
  check('minimal standard reaches 1043618065 after 10,000 steps (Park-Miller self-test)',
        g.state() === 1043618065n, 'got ' + g.state());
}

/* ── 2. The precision trap ─────────────────────────────────────────── */
section('Precision: doubles would get the big-modulus vectors wrong');
{
  /* Re-run the 2^61-1 recurrence in plain double arithmetic.  If this
     agreed with the BigInt vectors, the reference vectors would prove
     nothing about precision; assert that it diverges. */
  const a = 1234567890123456789, c = 987654321, m = Math.pow(2, 61) - 1;
  let x = 42, diverged = false;
  const v = VECTORS[4];
  for (let i = 0; i < 5; i++) {
    x = (a * x + c) % m;
    if (!Number.isSafeInteger(x) || BigInt(Math.round(x)) !== v.first[i]) { diverged = true; break; }
  }
  check('double-precision recurrence diverges from the exact vector', diverged);
}

/* ── 3. Periods ────────────────────────────────────────────────────── */
section('Periods');
function modpow(b, e, m) {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
  return r;
}
{
  /* Order proof: the period of x -> a x mod p from a nonzero seed is the
     multiplicative order of a mod p.  It equals p - 1 exactly when
     a^(p-1) = 1 and a^((p-1)/q) != 1 for every prime q dividing p - 1.
     p - 1 = 2147483646 = 2 * 3^2 * 7 * 11 * 31 * 151 * 331. */
  const p = 2147483647n, factors = [2n, 3n, 7n, 11n, 31n, 151n, 331n];
  check('factorization 2 * 3^2 * 7 * 11 * 31 * 151 * 331 = p - 1',
        2n * 9n * 7n * 11n * 31n * 151n * 331n === p - 1n);
  let ok = modpow(16807n, p - 1n, p) === 1n;
  for (const q of factors) if (modpow(16807n, (p - 1n) / q, p) === 1n) ok = false;
  check('order of 16807 mod 2^31-1 is exactly m-1 = 2,147,483,646 (full period)', ok);
}
if (!QUICK) {
  /* Direct walk of the full cycle.  16807 * x stays below 2^53, and so plain
     double arithmetic is exact here and fast enough to brute-force. */
  const t0 = Date.now();
  let x = 1, count = 0;
  do { x = (16807 * x) % 2147483647; count++; } while (x !== 1 && count <= 2147483647);
  check('direct walk returns to seed 1 after exactly 2,147,483,646 steps',
        count === 2147483646, 'count=' + count + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
} else {
  console.log('  (skip)  direct full-cycle walk (PRNG_QUICK=1)');
}
{
  /* Toy preset: Hull-Dobell says a=5, c=3, m=16 is full period, and so the
     cycle from EVERY seed must have length exactly 16. */
  let ok = true;
  for (let s = 0n; s < 16n; s++) {
    const g = P.makeLCG(5n, 3n, 16n, s);
    let count = 0;
    do { g.next(); count++; } while (g.state() !== s && count <= 17);
    if (count !== 16) ok = false;
  }
  check('toy preset has cycle length exactly 16 from every seed', ok);
}
{
  /* RANDU's period from an odd seed is the order of 65539 in the units of
     Z/2^31, which divides 2^29; confirm it is exactly 2^29. */
  const m = 1n << 31n;
  const ok = modpow(65539n, 1n << 29n, m) === 1n && modpow(65539n, 1n << 28n, m) !== 1n;
  check('order of 65539 mod 2^31 is exactly 2^29 (RANDU period from an odd seed)', ok);
}
{
  /* Power-of-two modulus: the k lowest bits of the C-standard-style
     preset must repeat with period exactly 2^k. */
  let ok = true;
  for (let k = 1n; k <= 8n; k++) {
    const mask = (1n << k) - 1n;
    const g = P.makeLCG(1103515245n, 12345n, 1n << 31n, 12345n);
    const want = Number(1n << k);
    /* collect 4 * 2^k low-bit values and find the minimal period */
    const seq = [];
    for (let i = 0; i < 4 * want; i++) { g.next(); seq.push(Number(g.state() & mask)); }
    let period = 0;
    for (let cand = 1; cand <= 2 * want; cand++) {
      let match = true;
      for (let i = 0; i + cand < seq.length; i++) if (seq[i] !== seq[i + cand]) { match = false; break; }
      if (match) { period = cand; break; }
    }
    if (period !== want) { ok = false; break; }
  }
  check('low k bits of the power-of-two preset cycle with period exactly 2^k (k=1..8)', ok);
}

/* ── 4. RANDU's plane identity ─────────────────────────────────────── */
section('RANDU structure');
{
  /* x_{n+2} = 6 x_{n+1} - 9 x_n (mod 2^31): the algebraic statement of
     the 15-plane collapse, from 65539 = 2^16 + 3 and
     (2^16 + 3)^2 = 2^32 + 6*2^16 + 9 = 6*65539 - 9 (mod 2^31). */
  const m = 1n << 31n;
  const g = P.makeLCG(65539n, 0n, m, 1n);
  let x0 = g.detail().x, x1 = g.detail().x, ok = true;
  for (let i = 0; i < 100000; i++) {
    const x2 = g.detail().x;
    if ((((6n * x1 - 9n * x0) % m) + m) % m !== x2) { ok = false; break; }
    x0 = x1; x1 = x2;
  }
  check('x_{n+2} = 6 x_{n+1} - 9 x_n (mod 2^31) holds for 100,000 consecutive steps', ok);
}

/* ── 5. Special functions against exact identities ─────────────────── */
section('Special functions');
check('logGamma(0.5) = ln sqrt(pi)', approx(P.logGamma(0.5), 0.5 * Math.log(Math.PI), 1e-12));
check('logGamma(5) = ln 24', approx(P.logGamma(5), Math.log(24), 1e-12));
check('logGamma(1) = 0 and logGamma(2) = 0',
      approx(P.logGamma(1), 0, 1e-12) && approx(P.logGamma(2), 0, 1e-12));
{
  let ok = true;
  for (const x of [0.1, 0.5, 1, 2, 5, 10]) {
    if (!approx(P.gammaP(1, x), 1 - Math.exp(-x), 1e-12)) ok = false;           /* P(1,x) = 1 - e^-x */
    if (!approx(P.chiSqUpperP(x, 2), Math.exp(-x / 2), 1e-12)) ok = false;      /* df=2 tail = e^{-x/2} */
  }
  check('gammaP(1,x) = 1 - e^-x and chi-square df=2 upper tail = e^{-x/2}', ok);
}
check('kolmogorovQ is 1 at 0+ and 0 at infinity, monotone in between',
      P.kolmogorovQ(1e-4) === 1 && P.kolmogorovQ(8) < 1e-12 &&
      P.kolmogorovQ(0.5) > P.kolmogorovQ(0.9) && P.kolmogorovQ(0.9) > P.kolmogorovQ(1.5));

/* ── 6. Test calibration on a known-good generator ─────────────────── */
section('Chi-square and K-S hold their nominal size (reps=' + CALIB_REPS + ')');
{
  const n = 500, k = 10, alpha = 0.05;
  let rejChi = 0, rejKS = 0;
  for (let r = 0; r < CALIB_REPS; r++) {
    const rng = mulberry32(777000 + r);
    const us = new Float64Array(n);
    for (let i = 0; i < n; i++) us[i] = rng();
    if (P.chiSqUniform(us, k).p < alpha) rejChi++;
    if (P.ksUniform(us).p < alpha) rejKS++;
  }
  const rChi = rejChi / CALIB_REPS, rKS = rejKS / CALIB_REPS;
  /* With 1500 reps, the standard error of a 5% rate is about 0.56%, and so a
     window of 3% to 7% is roughly +/- 3.5 sigma. */
  check('chi-square rejects at ~5% under a true null (got ' + (100 * rChi).toFixed(1) + '%)',
        rChi > 0.03 && rChi < 0.07);
  check('K-S rejects at ~5% under a true null (got ' + (100 * rKS).toFixed(1) + '%)',
        rKS > 0.03 && rKS < 0.07);
}
{
  /* Power sanity: a grossly nonuniform sample must be rejected hard. */
  const rng = mulberry32(4242), n = 1000, us = new Float64Array(n);
  for (let i = 0; i < n; i++) { const u = rng(); us[i] = u * u; }
  check('both tests reject u^2-transformed values decisively',
        P.chiSqUniform(us, 10).p < 1e-6 && P.ksUniform(us).p < 1e-6);
  /* The toy preset's 16-valued stream is uniform over a 16-point lattice,
     not over the continuous [0, 1]; K-S must flag the coarse
     discreteness. */
  const t = P.lcgStream(5n, 3n, 16n, 1n, 4000);
  check('K-S rejects the toy m=16 stream (coarse discreteness)', P.ksUniform(t).p < 1e-6);
}
{
  /* Shuffle invariance: the uniformity verdict must not depend on order,
     which is the pedagogical point of the uniformity panel.  Reverse a
     stream, and both statistics must be bit-identical. */
  const us = P.lcgStream(16807n, 0n, 2147483647n, 99n, 2000);
  const rev = Array.from(us).reverse();
  const c1 = P.chiSqUniform(us, 20), c2 = P.chiSqUniform(rev, 20);
  const k1 = P.ksUniform(us), k2 = P.ksUniform(rev);
  check('chi-square and K-S are order-blind (reversed stream, identical statistics)',
        c1.stat === c2.stat && k1.d === k2.d);
  /* The reported gap location must reproduce the statistic itself. */
  check('K-S gap location is consistent (y1 - y0 = D_n, at in [0,1])',
        Math.abs((k1.y1 - k1.y0) - k1.d) < 1e-12 && k1.at >= 0 && k1.at <= 1);
}

/* ── 7. MRG, CLCG, and CMRG (MRG32k3a) ─────────────────────────────── */
section('MRG family');
{
  /* Toy MRG (a1=2, a2=6, m=13): the verification brute-forces the claim
     the preset text makes, a state-pair period of exactly 168 = 13^2 - 1
     from every nonzero seed pair. */
  let ok = true;
  outer:
  for (let s0 = 0n; s0 < 13n; s0++) for (let s1 = 0n; s1 < 13n; s1++) {
    if (s0 === 0n && s1 === 0n) continue;
    const g = P.makeMRG([2n, 6n], 13n, [s0, s1]);
    let count = 0;
    do {
      g.next(); count++;
      const st = g.state();
      if (st[0] === s0 && st[1] === s1) break;
    } while (count <= 169);
    if (count !== 168) { ok = false; break outer; }
  }
  check('toy MRG (2, 6 mod 13) has state period exactly 168 from every nonzero seed pair', ok);
}
{
  /* An order-1 MRG must reproduce the c = 0 LCG exactly. */
  const g1 = P.makeMRG([16807n], 2147483647n, [1n]);
  const g2 = P.makeLCG(16807n, 0n, 2147483647n, 1n);
  let ok = true;
  for (let i = 0; i < 1000; i++) if (g1.next() !== g2.next()) ok = false;
  check('order-1 MRG matches the multiplicative LCG for 1,000 steps', ok);
}

section('CLCG (combination rule of L\'Ecuyer 1988)');
{
  /* Reference (y1, y2, z) triples computed 2026-08-21 with Python big
     ints, from seeds (12345, 12345) and from seeds (1, 1). */
  const REF12345 = [
    [493972830n, 502342740n, 2139113653n], [390105768n, 1583784398n, 953804933n],
    [1781664868n, 1377919426n, 403745442n], [1526187241n, 1653218301n, 2020452503n],
    [866180343n, 694147218n, 172033125n]];
  const REF11 = [
    [40014n, 40692n, 2147482885n], [1601120196n, 1655838864n, 2092764895n],
    [1346387765n, 2103410263n, 1390461065n], [439883729n, 1872071452n, 715295840n],
    [732249858n, 652912057n, 79337801n]];
  for (const [seeds, ref, name] of [[[12345n, 12345n], REF12345, '(12345, 12345)'],
                                    [[1n, 1n], REF11, '(1, 1)']]) {
    const g = P.makeCLCG(40014n, 2147483563n, 40692n, 2147483399n, seeds[0], seeds[1]);
    let ok = true;
    for (let i = 0; i < 5; i++) {
      const r = g.detail();
      if (r.x1 !== ref[i][0] || r.x2 !== ref[i][1] || r.z !== ref[i][2]) ok = false;
    }
    check('L\'Ecuyer 1988 CLCG matches the reference vector from seeds ' + name, ok);
  }
  /* The z = 0 output rule: u must be (m1-1)/m1, never 0.  Seeds (1, 1)
     under equal multipliers force z = 0 immediately. */
  const g0 = P.makeCLCG(7n, 13n, 7n, 11n, 1n, 1n);
  const u0 = g0.next();   /* x1 = x2 = 7 -> z = 0 */
  check('CLCG z = 0 maps to (m1-1)/m1', u0 === Number(12n) / Number(13n));
}
{
  /* Toy CLCG (2 mod 13, 7 mod 11): combined state period lcm(12, 10). */
  const g = P.makeCLCG(2n, 13n, 7n, 11n, 1n, 1n);
  let count = 0, ok = false;
  do {
    g.next(); count++;
    const st = g.state();
    if (st[0] === 1n && st[1] === 1n) { ok = (count === 60); break; }
  } while (count <= 61);
  check('toy CLCG state pair returns to (1, 1) after exactly lcm(12, 10) = 60 steps', ok);
}

section('CMRG: MRG32k3a against its published implementation');
{
  /* Reference combined values z (with the z = 0 -> m1 mapping) from the
     all-12345 seed, computed 2026-08-21 with Python big ints in an
     independent implementation of the published recurrences. */
  const REFZ = [545508589n, 1368065410n, 1327943761n, 3546985096n, 951893194n];
  const g = P.makeCMRG([12345n, 12345n, 12345n, 12345n, 12345n, 12345n]);
  let ok = true, uok = true;
  const REFU = [0.12701112204657714, 0.3185275653967945, 0.3091860155832701,
                0.8258468629271136, 0.2216299157820229];
  for (let i = 0; i < 5; i++) {
    const r = g.detail();
    if (r.z !== REFZ[i]) ok = false;
    if (r.u !== REFU[i]) uok = false;   /* bit-exact: same z, same norm constant */
  }
  check('MRG32k3a z values match the reference vector (seeds all 12345)', ok);
  check('MRG32k3a u values are bit-identical to the reference doubles', uok);
  let last = null;
  for (let i = 5; i < 10000; i++) last = g.detail();
  check('MRG32k3a 10,000th combined value is 878310219 (Python reference)',
        last.z === 878310219n, 'got ' + last.z);
}
{
  /* The sum of the first 10^7 outputs from the all-12345 seed:
     5001090.947189088 by the independent Python big-int run (2026-08-21),
     agreeing with the ~5001090.95 check figure that L'Ecuyer's example
     programs print.  Also confirm every output stays inside (0, 1). */
  const g = P.makeCMRG([12345n, 12345n, 12345n, 12345n, 12345n, 12345n]);
  let sum = 0, inRange = true;
  for (let i = 0; i < 10000000; i++) {
    const u = g.next();
    if (u <= 0 || u >= 1) inRange = false;
    sum += u;
  }
  check('MRG32k3a sum of first 10^7 outputs = 5001090.947189088 (tol 1e-3)',
        Math.abs(sum - 5001090.947189088) < 1e-3, 'got ' + sum);
  check('all 10^7 outputs lie strictly inside (0, 1)', inRange);
}
{
  /* genStream must agree with stepping via detail() for every family. */
  const mk = () => [
    P.makeMRG([2n, 6n], 13n, [1n, 1n]),
    P.makeCLCG(40014n, 2147483563n, 40692n, 2147483399n, 12345n, 12345n),
    P.makeCMRG([12345n, 12345n, 12345n, 12345n, 12345n, 12345n])];
  const a = mk(), b = mk();
  let ok = true;
  for (let j = 0; j < 3; j++) {
    const us = P.genStream(a[j], 200);
    for (let i = 0; i < 200; i++) if (us[i] !== b[j].detail().u) ok = false;
  }
  check('genStream and detail() agree for MRG, CLCG, and CMRG', ok);
}

/* ── Summary ───────────────────────────────────────────────────────── */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
