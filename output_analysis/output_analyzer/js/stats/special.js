// Special functions and distribution routines: the numerics every analysis
// page stands on. Pure functions, no DOM. The gamma, beta, normal, and t
// routines and the Gauss–Legendre quadrature are the same implementations the
// sibling widgets in this repository carry. The studentized range, Dunnett's
// distribution (new here), and Rinott's constant share one nested quadrature,
// whose outer rule works in log s (see chiNodes) so that it holds on few
// degrees of freedom, where each quantile lies far out.

const LANCZOS_G7 = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
];
const LOG_SQRT_2PI = 0.9189385332046728;   // 0.5 * log(2 pi)
export const SQRT_2PI = 2.5066282746310002;

/** log Γ(x) by the Lanczos approximation (g = 7, n = 9), with reflection below 0.5. */
export function logGamma(x) {
  if (!(x > -Infinity) || Number.isNaN(x)) return NaN;
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS_G7[0];
  for (let i = 1; i < 9; i++) a += LANCZOS_G7[i] / (z + i);
  const t = z + 7.5;
  return LOG_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
export function logBeta(a, b) { return logGamma(a) + logGamma(b) - logGamma(a + b); }

const GAM_EPS = 3e-16, GAM_FPMIN = 1e-300, GAM_ITMAX = 2000;

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) return gser(a, x);
  return 1 - gcf(a, x);
}
/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function gammaQ(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gser(a, x);
  return gcf(a, x);
}
function gser(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < GAM_ITMAX; n++) {
    ap++; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * GAM_EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}
function gcf(a, x) {
  let b = x + 1 - a, c = 1 / GAM_FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= GAM_ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < GAM_FPMIN) d = GAM_FPMIN;
    c = b + an / c;  if (Math.abs(c) < GAM_FPMIN) c = GAM_FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) <= GAM_EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized incomplete beta I_x(a, b) by Lentz's continued fraction. */
export function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = -logBeta(a, b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
  return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
}
function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < GAM_FPMIN) d = GAM_FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= GAM_ITMAX; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < GAM_FPMIN) d = GAM_FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < GAM_FPMIN) c = GAM_FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < GAM_FPMIN) d = GAM_FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < GAM_FPMIN) c = GAM_FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) <= GAM_EPS) break;
  }
  return h;
}

export function erf(x)  { return x < 0 ? -gammaP(0.5, x * x) : gammaP(0.5, x * x); }
export function erfc(x) { return x < 0 ? 1 + gammaP(0.5, x * x) : gammaQ(0.5, x * x); }

export function normPdf(z) { return Math.exp(-0.5 * z * z) / SQRT_2PI; }

// Standard normal CDF by W. J. Cody's rational Chebyshev approximation (Math.
// Comp. 23, 1969), the coefficients and three-branch structure R's pnorm uses,
// specialized to the lower tail. The studentized-range, Dunnett, and Rinott
// routines each nest this call inside a double quadrature inside a root
// finder, and so its speed is what makes those answers arrive in milliseconds.
const CODY_A = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582,
                18154.981253343561249, 0.065682337918207449113];
const CODY_B = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205,
                45507.789335026729956];
const CODY_C = [0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979,
                597.27027639480026226, 2494.5375852903726711, 6848.1904505362823326,
                11602.651437647350124, 9842.7148383839780218, 1.0765576773720192317e-8];
const CODY_D = [22.266688044328115691, 235.38790178262499861, 1519.377599407554805,
                6485.558298266760755, 18615.571640885098091, 34900.952721145977266,
                38912.003286093271411, 19685.429676859990727];
const CODY_P = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807,
                0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
const CODY_Q = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515,
                0.00378239633202758244, 7.29751555083966205e-5];
const CODY_SQRT_32 = Math.sqrt(32);
const CODY_1_SQRT_2PI = 1 / SQRT_2PI;
// Cody's do_del: exp(−x²/2) formed from two exponentials of smaller arguments
// (a head rounded to 1/16 and a remainder), which is what gives the two outer
// branches their extra digits.
function codyExpTail(x, temp) {
  const head = Math.trunc(x * 16) / 16;
  const del = (x - head) * (x + head);
  return Math.exp(-0.5 * head * head) * Math.exp(-0.5 * del) * temp;
}
/** Standard normal CDF Φ(z). */
export function normCdf(z) {
  if (Number.isNaN(z)) return NaN;
  const y = Math.abs(z);
  let xnum, xden, temp, i, cum;
  if (y <= 0.67448975) {
    if (y > 1.1102230246251565e-16) {
      const xsq = z * z;
      xnum = CODY_A[4] * xsq; xden = xsq;
      for (i = 0; i < 3; i++) { xnum = (xnum + CODY_A[i]) * xsq; xden = (xden + CODY_B[i]) * xsq; }
    } else { xnum = 0; xden = 0; }
    temp = z * (xnum + CODY_A[3]) / (xden + CODY_B[3]);
    return 0.5 + temp;
  }
  if (y <= CODY_SQRT_32) {
    xnum = CODY_C[8] * y; xden = y;
    for (i = 0; i < 7; i++) { xnum = (xnum + CODY_C[i]) * y; xden = (xden + CODY_D[i]) * y; }
    temp = (xnum + CODY_C[7]) / (xden + CODY_D[7]);
    cum = codyExpTail(y, temp);
    return z > 0 ? 1 - cum : cum;
  }
  if (z > -38.4674 && z < 8.2924) {
    const xsq2 = 1 / (z * z);
    xnum = CODY_P[5] * xsq2; xden = xsq2;
    for (i = 0; i < 4; i++) { xnum = (xnum + CODY_P[i]) * xsq2; xden = (xden + CODY_Q[i]) * xsq2; }
    temp = xsq2 * (xnum + CODY_P[4]) / (xden + CODY_Q[4]);
    temp = (CODY_1_SQRT_2PI - temp) / y;
    cum = codyExpTail(z, temp);
    return z > 0 ? 1 - cum : cum;
  }
  return z > 0 ? 1 : 0;
}

// Acklam's rational approximation to the normal quantile, with one Halley
// refinement step through erfc, which brings it to full double precision.
const ACK_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
                1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const ACK_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
                6.680131188771972e+01, -1.328068155288572e+01];
const ACK_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const ACK_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
               3.754408661907416e+00];
/** Standard normal quantile Φ⁻¹(p). */
export function normInv(p) {
  if (!(p > 0) || !(p < 1)) return p <= 0 ? -Infinity : (p >= 1 ? Infinity : NaN);
  const pl = 0.02425;
  let q, r, x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((ACK_C[0]*q+ACK_C[1])*q+ACK_C[2])*q+ACK_C[3])*q+ACK_C[4])*q+ACK_C[5]) /
        ((((ACK_D[0]*q+ACK_D[1])*q+ACK_D[2])*q+ACK_D[3])*q+1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    x = (((((ACK_A[0]*r+ACK_A[1])*r+ACK_A[2])*r+ACK_A[3])*r+ACK_A[4])*r+ACK_A[5])*q /
        (((((ACK_B[0]*r+ACK_B[1])*r+ACK_B[2])*r+ACK_B[3])*r+ACK_B[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((ACK_C[0]*q+ACK_C[1])*q+ACK_C[2])*q+ACK_C[3])*q+ACK_C[4])*q+ACK_C[5]) /
         ((((ACK_D[0]*q+ACK_D[1])*q+ACK_D[2])*q+ACK_D[3])*q+1);
  }
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * SQRT_2PI * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

/** Bisection on a bracketed monotone root. */
export function bisect(f, lo, hi, iters) {
  let flo = f(lo), fhi = f(hi), mid = 0, fm;
  if (!(flo * fhi <= 0)) return NaN;
  for (let i = 0; i < (iters || 90); i++) {
    mid = 0.5 * (lo + hi);
    fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    if (hi - lo < Math.abs(mid) * 1e-15 + 1e-300) break;
  }
  return 0.5 * (lo + hi);
}
/** Widens [lo, hi] geometrically until f changes sign across it; null if it never does. */
export function bracketRoot(f, lo, hi, grow, tries) {
  grow = grow || 2; tries = tries || 60;
  let flo = f(lo), fhi = f(hi);
  for (let i = 0; i < tries && flo * fhi > 0; i++) {
    if (Math.abs(flo) < Math.abs(fhi)) { lo -= (hi - lo) * (grow - 1); flo = f(lo); }
    else { hi += (hi - lo) * (grow - 1); fhi = f(hi); }
  }
  return flo * fhi <= 0 ? [lo, hi] : null;
}
/** Quantile of a cdf by bracketing from [lo, hi] and bisecting. */
export function qFromCdf(cdf, p, lo, hi) {
  if (!(p > 0)) return lo;
  if (!(p < 1)) return hi;
  const f = x => cdf(x) - p;
  const br = bracketRoot(f, lo, hi);
  if (!br) return NaN;
  return bisect(f, br[0], br[1]);
}

/** Student t CDF with ν degrees of freedom. */
export function tCdf(t, nu) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = nu / (nu + t * t);
  const half = 0.5 * betaInc(0.5 * nu, 0.5, x);
  return t >= 0 ? 1 - half : half;
}
export function tPdf(t, nu) {
  return Math.exp(logGamma(0.5 * (nu + 1)) - logGamma(0.5 * nu) - 0.5 * Math.log(nu * Math.PI)
                  - 0.5 * (nu + 1) * Math.log(1 + t * t / nu));
}
const T_Q_MEMO = new Map();
/** Student t quantile; memoized because every interval on a page asks for the same few. */
export function tQuantile(p, nu) {
  const k = p + '|' + nu;
  if (T_Q_MEMO.has(k)) return T_Q_MEMO.get(k);
  const q = qFromCdf(x => tCdf(x, nu), p, -2, 2);
  T_Q_MEMO.set(k, q);
  return q;
}

export function chi2Cdf(x, k) { return x <= 0 ? 0 : gammaP(0.5 * k, 0.5 * x); }
export function chi2Pdf(x, k) {
  if (x <= 0) return 0;
  return Math.exp((0.5 * k - 1) * Math.log(x) - 0.5 * x - 0.5 * k * Math.LN2 - logGamma(0.5 * k));
}
export function chi2Quantile(p, k) {
  return qFromCdf(x => chi2Cdf(x, k), p, 1e-8, Math.max(4, 2 * k));
}
export function fCdf(x, d1, d2) {
  if (!(x > 0)) return 0;
  return betaInc(0.5 * d1, 0.5 * d2, d1 * x / (d1 * x + d2));
}
export function fQuantile(p, d1, d2) {
  return qFromCdf(x => fCdf(x, d1, d2), p, 1e-8, 8);
}

// ── Quadrature ────────────────────────────────────────────────────────────
const GL_CACHE = new Map();
/** Gauss–Legendre nodes and weights on [−1, 1], cached per n. */
export function gaussLegendre(n) {
  if (GL_CACHE.has(n)) return GL_CACHE.get(n);
  const x = new Float64Array(n), w = new Float64Array(n), m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), z1, pp;
    do {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      z1 = z; z = z1 - p1 / pp;
    } while (Math.abs(z - z1) > 1e-14);
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  const g = { x, w };
  GL_CACHE.set(n, g);
  return g;
}
/** Composite Gauss–Legendre integral of f over [a, b] in `panels` panels of `n` points. */
export function quad(f, a, b, panels, n) {
  const g = gaussLegendre(n), h = (b - a) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const lo = a + p * h, c = lo + 0.5 * h, r = 0.5 * h;
    for (let i = 0; i < n; i++) s += g.w[i] * f(c + r * g.x[i]);
  }
  return s * 0.5 * h;
}
// Log density of S = sqrt(V / ν) for V ~ χ²(ν): the factor a sample standard
// deviation carries relative to σ.
function chiDensityLog(s, nu) {
  if (!(s > 0)) return -Infinity;
  return Math.log(2) + 0.5 * nu * Math.log(nu) + (nu - 1) * Math.log(s) - 0.5 * nu * s * s
       - 0.5 * nu * Math.LN2 - logGamma(0.5 * nu);
}
// Nodes over s for integrals against the chi density, as Gauss–Legendre
// panels in log s. On few degrees of freedom the density keeps its mass down
// toward 0, and the integrands below rise from 0 to 1 near s = 1/q, which is
// far below 1 when the quantile q is large; a panel in log s spans the same
// ratio of s at every scale, and so that rise is resolved wherever it falls.
// The nodes run from where the density's lower tail holds 1e-12 (from the
// bound P(S ≤ s) ≤ x^(ν/2) / Γ(ν/2 + 1), x = ν s²/2), or from 12 spreads
// below 1 when that is higher, to 12 spreads above 1, in panels at most one
// unit of log s wide.
const CHI_NODES_MEMO = new Map();
function chiNodes(nu) {
  if (CHI_NODES_MEMO.has(nu)) return CHI_NODES_MEMO.get(nu);
  const sd = 1 / Math.sqrt(2 * nu), half = 0.5 * nu;
  const tail = Math.sqrt(2 / nu * Math.exp((Math.log(1e-12) + logGamma(half + 1)) / half));
  const a = Math.log(Math.max(tail, 1 - 12 * sd)), b = Math.log(1 + 12 * sd);
  const n = 16, panels = Math.max(12, Math.ceil(b - a)), g = gaussLegendre(n), h = (b - a) / panels;
  const S = [], W = [];
  for (let p = 0; p < panels; p++) {
    const c = a + p * h + 0.5 * h, r = 0.5 * h;
    for (let i = 0; i < n; i++) {
      const s = Math.exp(c + r * g.x[i]);
      S.push(s); W.push(g.w[i] * r * s * Math.exp(chiDensityLog(s, nu)));
    }
  }
  if (CHI_NODES_MEMO.size > 64) CHI_NODES_MEMO.clear();
  const nd = { s: S, w: W };
  CHI_NODES_MEMO.set(nu, nd);
  return nd;
}
// Nodes over x in [−8, 8] with φ(x) and Φ(x) precomputed: shared by every
// inner integral over a standard normal below.
let RANGE_NODES = null;
function rangeNodes() {
  if (RANGE_NODES) return RANGE_NODES;
  const g = gaussLegendre(16), panels = 8, h = 16 / panels, rad = 0.5 * h;
  const X = [], PDF = [], CDF = [], W = [];
  for (let p = 0; p < panels; p++) {
    const c = -8 + p * h + rad;
    for (let i = 0; i < 16; i++) {
      const x = c + rad * g.x[i];
      X.push(x); PDF.push(normPdf(x)); CDF.push(normCdf(x)); W.push(g.w[i] * rad);
    }
  }
  return (RANGE_NODES = { x: X, pdf: PDF, cdf: CDF, w: W });
}
// Range CDF of k standard normals: k ∫ φ(x) [Φ(x + r) − Φ(x)]^(k−1) dx.
function rangeCdf(r, k, rn) {
  if (!(r > 0)) return 0;
  let s = 0;
  for (let i = 0; i < rn.x.length; i++) {
    const d = normCdf(rn.x[i] + r) - rn.cdf[i];
    s += rn.w[i] * rn.pdf[i] * Math.pow(d, k - 1);
  }
  return k * s;
}
/** Studentized range CDF: P(Q ≤ q) for k means and ν error degrees of freedom. */
export function ptukey(q, k, nu) {
  if (!(q > 0)) return 0;
  const nd = chiNodes(nu), rn = rangeNodes();
  let s = 0;
  for (let i = 0; i < nd.s.length; i++) s += nd.w[i] * rangeCdf(q * nd.s[i], k, rn);
  return Math.min(1, s);
}
/** Root of a monotone f on [lo, hi] by the Illinois variant of regula falsi. */
export function solveMonotone(f, lo, hi, tol) {
  let a = lo, b = hi, fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return NaN;
  let side = 0, c, fc;
  for (let i = 0; i < 60; i++) {
    c = (a * fb - b * fa) / (fb - fa);
    fc = f(c);
    if (Math.abs(fc) < 1e-15 || Math.abs(b - a) < tol) return c;
    if (fc * fb > 0) { b = c; fb = fc; if (side === -1) fa *= 0.5; side = -1; }
    else { a = c; fa = fc; if (side === 1) fb *= 0.5; side = 1; }
  }
  return c;
}
/**
 * Root of an increasing f with f(0) ≤ 0: the upper end starts at `hi` and
 * doubles until f there is no longer negative, the lower end following it
 * up, and the root is then found between them, to a bracket width of tol
 * times the lower end once that passes 1. NaN in two cases: at once when f
 * is NaN at an upper end (an argument such as a degrees of freedom is out of
 * range, and no doubling would help), and when f stays negative through 60
 * doublings, that is, when no root exists.
 */
export function rootAbove(f, hi, tol) {
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const v = f(hi);
    if (Number.isNaN(v)) return NaN;
    if (v >= 0) return solveMonotone(f, lo, hi, tol * Math.max(1, lo));
    lo = hi; hi *= 2;
  }
  return NaN;
}
const Q_TUKEY_MEMO = new Map();
/** Studentized range quantile q with P(Q ≤ q) = p. */
export function qtukey(p, k, nu) {
  const key = p + '|' + k + '|' + nu;
  if (Q_TUKEY_MEMO.has(key)) return Q_TUKEY_MEMO.get(key);
  const q = rootAbove(q => ptukey(q, k, nu) - p, 20, 1e-7);
  Q_TUKEY_MEMO.set(key, q);
  return q;
}

// ── Dunnett's distribution ────────────────────────────────────────────────
// For k treatments compared with one control, with sample sizes n_i and n_0 and
// a pooled variance on ν degrees of freedom, the statistics T_i = (Ȳ_i − Ȳ_0) /
// (S sqrt(1/n_i + 1/n_0)) share the control's mean. Conditioning on the
// control's standardized mean z and on s = S/σ, the T_i are independent, and
// with λ_i = sqrt(n_i / n_0),
//   P(max |T_i| ≤ c) = ∫ f(s) ∫ φ(z) ∏_i [Φ(λ_i z + c s a_i) − Φ(λ_i z − c s a_i)] dz ds,
//   a_i = sqrt(1 + λ_i²),
// with the inner bracket replaced by Φ(λ_i z + c s a_i) for the one-sided case.
// This is exact for unequal sample sizes, not an approximation through an
// average correlation.
/**
 * @param {number} c critical value
 * @param {number[]} lambdas sqrt(n_i / n_0) for each treatment i
 * @param {number} nu error degrees of freedom
 * @param {boolean} twoSided
 */
export function pdunnett(c, lambdas, nu, twoSided) {
  if (!(c > 0)) return 0;
  const nd = chiNodes(nu), rn = rangeNodes();
  const a = lambdas.map(l => Math.sqrt(1 + l * l));
  let outer = 0;
  for (let j = 0; j < nd.s.length; j++) {
    const cs = c * nd.s[j];
    let inner = 0;
    for (let i = 0; i < rn.x.length; i++) {
      const z = rn.x[i];
      let prod = 1;
      for (let m = 0; m < lambdas.length; m++) {
        const lz = lambdas[m] * z, w = cs * a[m];
        prod *= twoSided ? normCdf(lz + w) - normCdf(lz - w) : normCdf(lz + w);
        if (prod === 0) break;
      }
      inner += rn.w[i] * rn.pdf[i] * prod;
    }
    outer += nd.w[j] * inner;
  }
  return Math.min(1, outer);
}
const Q_DUNNETT_MEMO = new Map();
/** Dunnett critical value with P(max |T_i| ≤ c) = p (or the one-sided version). */
export function qdunnett(p, lambdas, nu, twoSided) {
  const key = p + '|' + lambdas.join(',') + '|' + nu + '|' + twoSided;
  if (Q_DUNNETT_MEMO.has(key)) return Q_DUNNETT_MEMO.get(key);
  const q = rootAbove(c => pdunnett(c, lambdas, nu, twoSided) - p, 20, 1e-7);
  Q_DUNNETT_MEMO.set(key, q);
  return q;
}

// ── Rinott's constant ─────────────────────────────────────────────────────
// The h with P* = ∫ g(v) [ ∫ g(u) Φ(h u v / sqrt(u² + v²)) du ]^(k−1) dv, g the chi
// density with ν = n0 − 1: the constant in the second-stage sample size
// N_i = max(n0, ceil((h S_i / δ)²)) of Rinott's two-stage procedure.
const RINOTT_H_MEMO = new Map();
export function rinottH(n0, k, pstar) {
  const key = n0 + '|' + k + '|' + pstar;
  if (RINOTT_H_MEMO.has(key)) return RINOTT_H_MEMO.get(key);
  const nu = n0 - 1, nd = chiNodes(nu), n = nd.s.length;
  const UV = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    const v = nd.s[a];
    for (let b = 0; b < n; b++) { const u = nd.s[b]; UV[a * n + b] = u * v / Math.sqrt(u * u + v * v); }
  }
  function pcs(h) {
    let outer = 0;
    for (let a = 0; a < n; a++) {
      let inner = 0;
      for (let b = 0; b < n; b++) inner += nd.w[b] * normCdf(h * UV[a * n + b]);
      outer += nd.w[a] * Math.pow(inner, k - 1);
    }
    return outer;
  }
  const h = rootAbove(h => pcs(h) - pstar, 12, 1e-6);
  RINOTT_H_MEMO.set(key, h);
  return h;
}

// ── Noncentral t and F ────────────────────────────────────────────────────
// Both distributions are Poisson mixtures of central ones (Johnson, Kotz, and
// Balakrishnan, Continuous Univariate Distributions, vol. 2, chapters 29–31). The
// noncentral F is
//   P(F ≤ f; d1, d2, λ) = Σ_j pois(j; λ/2) I_x(d1/2 + j, d2/2),  x = d1 f/(d1 f + d2),
// and the noncentral t follows Lenth's algorithm AS 243 (Applied Statistics 38(1):
// 185–189, 1989), a pair of similar series. Each sum starts at the Poisson mode and
// walks outward in both directions with the weights carried by recurrence, and so no
// term is ever formed from an overflowing power or factorial.
const PM_ITMAX = 4000;
// Past this half-noncentrality the series cost (which grows like its square root)
// is impractical, and each function substitutes its large-noncentrality limit. A
// power calculation stops at a noncentrality of single digits; only degenerate
// input, such as an effect size of 1e16 from a standard deviation of 1e-16, gets here.
const NC_LAM_MAX = 1e6;

// Poisson(l) mixture Σ_j pois(j; l) term(j), for term in [0, 1] and decreasing in j.
function poisMix(l, term) {
  if (!(l > 0)) return term(0);
  const j0 = Math.floor(l);
  const w0 = Math.exp(-l + j0 * Math.log(l) - logGamma(j0 + 1));
  let sum = w0 * term(j0), w = w0;
  for (let j = j0 + 1; j <= j0 + PM_ITMAX; j++) {
    w *= l / j;
    if (w < 1e-18) break;
    sum += w * term(j);
  }
  w = w0;
  for (let j = j0; j >= 1 && j > j0 - PM_ITMAX; j--) {
    w *= j / l;
    if (w < 1e-18) break;
    sum += w * term(j - 1);
  }
  return sum;
}

/**
 * Noncentral F CDF with d1 and d2 degrees of freedom and noncentrality λ, as R's
 * pf(f, d1, d2, ncp = lambda), summed as a Poisson(λ/2) mixture of central beta CDFs.
 * @param {number} f
 * @param {number} d1 numerator degrees of freedom
 * @param {number} d2 denominator degrees of freedom
 * @param {number} lambda noncentrality, ≥ 0
 * @returns {number}
 */
export function ncfCdf(f, d1, d2, lambda) {
  if (!(f > 0)) return 0;
  if (!(lambda > 0)) return fCdf(f, d1, d2);
  // The numerator grows without bound with the noncentrality, and so F runs past
  // any fixed f.
  if (0.5 * lambda > NC_LAM_MAX) return 0;
  const x = d1 * f / (d1 * f + d2);
  return poisMix(0.5 * lambda, j => betaInc(0.5 * d1 + j, 0.5 * d2, x));
}

/**
 * Noncentral t CDF with df degrees of freedom and noncentrality ncp, as R's
 * pt(t, df, ncp), by AS 243 (Lenth 1989). For t ≥ 0,
 *   P(T ≤ t) = Φ(−δ) + ½ Σ_j [p_j I_x(j + ½, ν/2) + q_j I_x(j + 1, ν/2)],
 * with x = t²/(t² + ν), λ = δ²/2, p_j the Poisson(λ) weights, and
 * q_j = δ e^{−λ} λ^j / (√2 Γ(j + 3/2)); negative t uses the reflection
 * P(T ≤ t; δ) = 1 − P(T ≤ −t; −δ).
 * @param {number} t
 * @param {number} df degrees of freedom, > 0
 * @param {number} ncp noncentrality δ
 * @returns {number}
 */
export function nctCdf(t, df, ncp) {
  if (!(df > 0)) return NaN;
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (ncp === 0) return tCdf(t, df);
  if (t < 0) return 1 - nctCdf(-t, df, -ncp);
  const lam = 0.5 * ncp * ncp;
  // Johnson and Welch's normal approximation (Biometrika 31:362, 1940), accurate
  // for exactly the large noncentralities that make the series impractical.
  if (lam > NC_LAM_MAX) {
    return normCdf((t * (1 - 1 / (4 * df)) - ncp) / Math.sqrt(1 + t * t / (2 * df)));
  }
  const x = t * t / (t * t + df), hnu = 0.5 * df;
  let sum = 0;
  if (x > 0) {
    const j0 = Math.floor(lam);
    // Weights at the mode, in log space so that λ up to about 10³ cannot underflow
    // the prefactor before the recurrence starts.
    const lpow = j0 > 0 ? j0 * Math.log(lam) : 0;
    const p0 = Math.exp(-lam + lpow - logGamma(j0 + 1));
    const q0 = ncp / Math.SQRT2 * Math.exp(-lam + lpow - logGamma(j0 + 1.5));
    sum += p0 * betaInc(j0 + 0.5, hnu, x) + q0 * betaInc(j0 + 1, hnu, x);
    let p = p0, q = q0;
    for (let j = j0 + 1; j <= j0 + PM_ITMAX; j++) {
      p *= lam / j;
      q *= lam / (j + 0.5);
      if (Math.abs(p) < 1e-18 && Math.abs(q) < 1e-18) break;
      sum += p * betaInc(j + 0.5, hnu, x) + q * betaInc(j + 1, hnu, x);
    }
    p = p0; q = q0;
    for (let j = j0; j >= 1 && j > j0 - PM_ITMAX; j--) {
      p *= j / lam;
      q *= (j + 0.5) / lam;
      if (Math.abs(p) < 1e-18 && Math.abs(q) < 1e-18) break;
      sum += p * betaInc(j - 0.5, hnu, x) + q * betaInc(j, hnu, x);
    }
  }
  const v = normCdf(-ncp) + 0.5 * sum;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// ── Smallest integer satisfying a monotone condition ──────────────────────

/**
 * The smallest integer n in [lo, cap] with ok(n) true, for a condition that is false
 * below some threshold and true from it on (a half-width that shrinks with n, or a
 * power that grows with it). The search starts at a guess, such as a normal
 * approximation, and moves by doubling steps (up while the condition fails, down
 * while it holds) until it brackets the threshold, and then bisects. That returns
 * exactly what stepping one integer at a time would, in a logarithmic number of
 * evaluations even when the guess is far off.
 * @param {(n: number) => boolean} ok monotone condition
 * @param {number} guess starting point, clamped into [lo, cap]
 * @param {number} lo smallest admissible n
 * @param {number} cap largest admissible n
 * @returns {{n: number|null, evaluations: number}} n is null when ok(cap) is false
 */
export function smallestN(ok, guess, lo, cap) {
  let evaluations = 0;
  const test = n => { evaluations++; return ok(n); };
  let n = Math.min(cap, Math.max(lo, Math.ceil(guess)));
  let bad, good;               // ok(bad) is false and ok(good) is true; bad < good
  if (test(n)) {
    good = n; bad = lo - 1;
    for (let step = 1; good > lo; step *= 2) {
      const m = Math.max(lo, good - step);
      if (test(m)) good = m; else { bad = m; break; }
    }
  } else {
    bad = n; good = null;
    for (let step = 1; bad < cap; step *= 2) {
      const m = Math.min(cap, bad + step);
      if (test(m)) { good = m; break; }
      bad = m;
    }
    if (good === null) return { n: null, evaluations };
  }
  while (good - bad > 1) {
    const m = Math.floor((bad + good) / 2);
    if (test(m)) good = m; else bad = m;
  }
  return { n: good, evaluations };
}
