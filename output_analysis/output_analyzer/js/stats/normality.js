// Checks of normality for the replication estimates: the Shapiro–Wilk test
// and the pieces of a normal quantile–quantile plot. Pure functions, no DOM.

import { normInv, normCdf } from './special.js';
import { sortedCopy, quantile } from './descriptive.js';

// Royston's approximation (Applied Statistics algorithm AS R94, 1995) to the
// Shapiro–Wilk coefficients and to the distribution of W, as R's
// shapiro.test computes them: the coefficients from the expected normal order
// statistics at the Blom positions (i − 3/8)/(n + 1/4), corrected at the two
// extremes by polynomials in 1/√n, and the significance from a normalizing
// transformation of W whose mean and spread are polynomials in n (n ≤ 11) or
// in log n.
const C1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
const C2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
const C3 = [0.544, -0.39978, 0.025054, -6.714e-4];
const C4 = [1.3822, -0.77857, 0.062767, -0.0020322];
const C5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
const C6 = [-0.4803, -0.082676, 0.0030302];
const G = [-2.273, 0.459];

function poly(cc, x) {
  let v = 0;
  for (let i = cc.length - 1; i >= 0; i--) v = v * x + cc[i];
  return v;
}

/**
 * The Shapiro–Wilk coefficients a₁ … a_{⌊n/2⌋} for the upper half of the
 * sorted sample (the lower half takes their negatives, and the middle value of
 * an odd n weighs nothing).
 * @param {number} n 3 or more
 * @returns {Float64Array}
 */
export function shapiroCoefficients(n) {
  if (!(Number.isInteger(n) && n >= 3)) throw new RangeError('n must be at least 3');
  const nn2 = Math.floor(n / 2);
  const a = new Float64Array(nn2);
  if (n === 3) { a[0] = Math.SQRT1_2; return a; }
  const an25 = n + 0.25;
  const m = new Float64Array(nn2);
  let summ2 = 0;
  for (let i = 0; i < nn2; i++) { m[i] = normInv((i + 1 - 0.375) / an25); summ2 += m[i] * m[i]; }
  summ2 *= 2;
  const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
  const a1 = poly(C1, rsn) - m[0] / ssumm2;
  let i1, fac;
  if (n > 5) {
    const a2 = -m[1] / ssumm2 + poly(C2, rsn);
    fac = Math.sqrt((summ2 - 2 * m[0] * m[0] - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
    a[1] = a2;
    i1 = 2;
  } else {
    fac = Math.sqrt((summ2 - 2 * m[0] * m[0]) / (1 - 2 * a1 * a1));
    i1 = 1;
  }
  a[0] = a1;
  // m is negative on this half, and so the coefficients come out positive.
  for (let i = i1; i < nn2; i++) a[i] = -m[i] / fac;
  return a;
}

/**
 * The Shapiro–Wilk test of normality. W is the squared correlation between the
 * sorted sample and the Shapiro–Wilk coefficients, 1 for a perfectly normal
 * shape and smaller for any other; the p-value is Royston's approximation,
 * valid from n = 3 up to about 5000.
 * @param {ArrayLike<number>} x the sample (3 ≤ n ≤ 5000)
 * @returns {{ W: number, p: number, n: number }}
 */
export function shapiroWilk(x) {
  const s = sortedCopy(x), n = s.length;
  if (n < 3) throw new RangeError('the Shapiro–Wilk test needs at least 3 values');
  if (n > 5000) throw new RangeError('the Shapiro–Wilk test is defined for at most 5000 values');
  const range = s[n - 1] - s[0];
  if (!(range > 0)) throw new RangeError('every value is the same');
  const a = shapiroCoefficients(n), nn2 = a.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += s[i];
  mean /= n;
  let num = 0, den = 0;
  for (let i = 0; i < nn2; i++) num += a[i] * (s[n - 1 - i] - s[i]);
  for (let i = 0; i < n; i++) den += (s[i] - mean) * (s[i] - mean);
  let W = num * num / den;
  if (W > 1) W = 1;
  let p;
  if (n === 3) {
    // Exact for n = 3.
    p = Math.max(0, (6 / Math.PI) * (Math.asin(Math.sqrt(W)) - Math.PI / 3));
  } else {
    const w1 = 1 - W;
    let y = Math.log(w1), m, sd;
    if (n <= 11) {
      const gamma = poly(G, n);
      if (y >= gamma) return { W, p: 1e-99, n };
      y = -Math.log(gamma - y);
      m = poly(C3, n);
      sd = Math.exp(poly(C4, n));
    } else {
      const ln = Math.log(n);
      m = poly(C5, ln);
      sd = Math.exp(poly(C6, ln));
    }
    p = 1 - normCdf((y - m) / sd);
  }
  return { W, p, n };
}

/**
 * The plotting positions a normal quantile–quantile plot uses, as R's ppoints:
 * (i − a)/(n + 1 − 2a) with a = 3/8 for n ≤ 10 and 1/2 otherwise.
 * @param {number} n
 * @returns {Float64Array}
 */
export function plottingPositions(n) {
  const a = n <= 10 ? 3 / 8 : 0.5;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (i + 1 - a) / (n + 1 - 2 * a);
  return out;
}

/**
 * A normal quantile–quantile plot's pieces: the sorted sample against the
 * standard normal quantiles at the plotting positions, and the line through
 * the first and third quartiles (R's qqline), whose slope estimates the
 * standard deviation and whose intercept the mean of a normal sample.
 * @param {ArrayLike<number>} x the sample (2 or more values)
 * @returns {{ theoretical: Float64Array, sample: Float64Array, slope: number, intercept: number }}
 */
export function normalQQ(x) {
  const s = sortedCopy(x), n = s.length;
  if (n < 2) throw new RangeError('a quantile–quantile plot needs at least 2 values');
  const pp = plottingPositions(n);
  const theoretical = new Float64Array(n);
  for (let i = 0; i < n; i++) theoretical[i] = normInv(pp[i]);
  const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75);
  const z1 = normInv(0.25), z3 = normInv(0.75);
  const slope = (q3 - q1) / (z3 - z1);
  return { theoretical, sample: s, slope, intercept: q1 - slope * z1 };
}
