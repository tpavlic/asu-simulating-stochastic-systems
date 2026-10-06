// Confidence intervals and tests for one or two samples: the Student t interval
// for a mean, replication planning for a target half-width, chi-square intervals
// for a variance, the F ratio of two variances, and Pearson correlation. Pure
// functions, no DOM. Each matches the corresponding R routine (t.test,
// var.test, cor.test) on the same data. Replication planning by power follows
// R's power.t.test(..., strict = TRUE).

import { mean, variance, pearson } from './descriptive.js';
import { tCdf, tQuantile, normInv, chi2Quantile, fCdf, fQuantile, betaInc, nctCdf, smallestN }
  from './special.js';

/**
 * Student t confidence interval for a mean: mean ± t_{1−α/2, n−1} · s / sqrt(n).
 * @param {ArrayLike<number>} x the sample (replication estimates)
 * @param {number} [level=0.95] confidence level
 * @returns {{n: number, mean: number, sd: number, se: number, df: number, t: number,
 *   hw: number, lo: number, hi: number, level: number}} NaN fields when n < 2
 */
export function tInterval(x, level = 0.95) {
  const n = x.length, m = mean(x);
  if (n < 2) {
    return { n, mean: m, sd: NaN, se: NaN, df: NaN, t: NaN, hw: NaN, lo: NaN, hi: NaN, level };
  }
  const s = Math.sqrt(variance(x)), se = s / Math.sqrt(n), df = n - 1;
  const t = tQuantile(1 - (1 - level) / 2, df), hw = t * se;
  return { n, mean: m, sd: s, se, df, t, hw, lo: m - hw, hi: m + hw, level };
}

// The t quantile for planning. Past 10^6 degrees of freedom the first-order
// Cornish–Fisher expansion, z + (z³ + z)/(4ν), is within a few parts in 10^12 of
// the quantile, and it stays accurate where an incomplete-beta evaluation at
// x = ν/(ν + t²), so close to 1, loses digits.
function tCritical(p, df, z) {
  return df <= 1e6 ? tQuantile(p, df) : z + (z * z * z + z) / (4 * df);
}

/**
 * Number of replications needed for a target half-width, treating sd as known: the
 * smallest n ≥ 2 with t_{1−α/2, n−1} · sd / sqrt(n) ≤ h, where h = target, or
 * target · |mean| when relative. The search starts at the normal approximation
 * ceil((z · sd / h)²) and steps, which is valid because the half-width is decreasing
 * in n: up until the inequality holds, and then down while it still holds.
 * @param {{sd: number, level?: number, target: number, relative?: boolean, mean?: number}} o
 * @returns {{n: number|null, hwAtN: number, iterations: number, h: number}} n is null
 *   when h ≤ 0, when sd is not a finite nonnegative number, or when the answer would
 *   exceed 10^15 replications (past which consecutive integers are not all
 *   representable in floating point)
 */
export function planReplications({ sd, level = 0.95, target, relative = false, mean: mu }) {
  const h = relative ? target * Math.abs(mu) : target;
  if (!(h > 0) || !Number.isFinite(h) || !Number.isFinite(sd) || sd < 0) {
    return { n: null, hwAtN: NaN, iterations: 0, h };
  }
  const p = 1 - (1 - level) / 2;
  const z = normInv(p);
  const hwAt = k => tCritical(p, k - 1, z) * sd / Math.sqrt(k);
  let n = Math.max(2, Math.ceil((z * sd / h) ** 2));
  if (!(n <= 1e15)) return { n: null, hwAtN: NaN, iterations: 0, h };
  let hw = hwAt(n), iterations = 1;
  while (hw > h) { n++; hw = hwAt(n); iterations++; }
  while (n > 2) {
    const below = hwAt(n - 1);
    iterations++;
    if (below > h) break;
    n--; hw = below;
  }
  return { n, hwAtN: hw, iterations, h };
}

/**
 * Chi-square confidence interval for a variance and, by square roots, for a standard
 * deviation: [(n−1)s² / χ²_{1−α/2}, (n−1)s² / χ²_{α/2}] on n − 1 degrees of freedom.
 * Valid for normal data; it is sensitive to non-normality in a way the t interval is not.
 * @param {ArrayLike<number>} x
 * @param {number} [level=0.95]
 * @returns {{n: number, df: number, s2: number, s: number, lo2: number, hi2: number,
 *   loS: number, hiS: number, chiLo: number, chiHi: number}} chiLo = χ²_{α/2} and
 *   chiHi = χ²_{1−α/2}; NaN fields when n < 2
 */
export function varianceInterval(x, level = 0.95) {
  const n = x.length, df = n - 1;
  if (n < 2) {
    return { n, df: NaN, s2: NaN, s: NaN, lo2: NaN, hi2: NaN, loS: NaN, hiS: NaN, chiLo: NaN, chiHi: NaN };
  }
  const s2 = variance(x), a = 1 - level;
  const chiLo = chi2Quantile(a / 2, df), chiHi = chi2Quantile(1 - a / 2, df);
  const lo2 = df * s2 / chiHi, hi2 = df * s2 / chiLo;
  return { n, df, s2, s: Math.sqrt(s2), lo2, hi2, loS: Math.sqrt(lo2), hiS: Math.sqrt(hi2), chiLo, chiHi };
}

// Upper tail P(F ≥ f) of the F distribution, taken from the complementary beta
// function directly rather than as 1 − cdf, which would lose digits for large f.
function fUpper(f, d1, d2) {
  if (!(f > 0)) return 1;
  return betaInc(0.5 * d2, 0.5 * d1, d2 / (d2 + d1 * f));
}

/**
 * F test and confidence interval for the ratio of two variances σ₁²/σ₂², as R's
 * var.test(x, y, conf.level = level): F = s₁²/s₂² on (n₁ − 1, n₂ − 1) degrees of
 * freedom, two-sided p = 2 · min(P(F ≤ f), P(F ≥ f)), and the interval
 * [F / F_{1−α/2}, F / F_{α/2}].
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @param {number} [level=0.95]
 * @returns {{n1: number, n2: number, s1: number, s2: number, F: number, df1: number,
 *   df2: number, p: number, lo: number, hi: number}} NaN fields when either n < 2
 */
export function fRatio(x, y, level = 0.95) {
  const n1 = x.length, n2 = y.length, df1 = n1 - 1, df2 = n2 - 1;
  if (n1 < 2 || n2 < 2) {
    return { n1, n2, s1: NaN, s2: NaN, F: NaN, df1, df2, p: NaN, lo: NaN, hi: NaN };
  }
  const v1 = variance(x), v2 = variance(y), F = v1 / v2, a = 1 - level;
  // A y with no spread makes F infinite, which var.test reports with p = 0, and
  // two sets with no spread make it 0/0, with no p at all.
  const p = F === Infinity ? 0 : Number.isNaN(F) ? NaN
    : Math.min(1, 2 * Math.min(fCdf(F, df1, df2), fUpper(F, df1, df2)));
  const lo = F / fQuantile(1 - a / 2, df1, df2), hi = F / fQuantile(a / 2, df1, df2);
  return { n1, n2, s1: Math.sqrt(v1), s2: Math.sqrt(v2), F, df1, df2, p, lo, hi };
}

/**
 * Pearson correlation with the test of zero correlation and the Fisher-z interval, as
 * R's cor.test(x, y, conf.level = level): t = r · sqrt((n − 2)/(1 − r²)) on n − 2
 * degrees of freedom, two-sided p, and tanh(atanh(r) ± z_{1−α/2}/sqrt(n − 3)).
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y same length as x
 * @param {number} [level=0.95]
 * @returns {{n: number, r: number, t: number, df: number, p: number, lo: number,
 *   hi: number, note: string|null}} the interval is NaN for n < 4, and t and p for
 *   n < 3, each case explained in note
 * @throws {RangeError} when x and y differ in length
 */
export function correlation(x, y, level = 0.95) {
  const n = x.length;
  if (y.length !== n) throw new RangeError('correlation: x and y differ in length');
  const r = pearson(x, y), df = n - 2;
  if (n < 3) {
    return { n, r, t: NaN, df, p: NaN, lo: NaN, hi: NaN,
             note: 'The test and the interval need at least 3 pairs.' };
  }
  const t = r * Math.sqrt(df / (1 - r * r));
  const p = Math.min(1, 2 * Math.min(tCdf(t, df), tCdf(-t, df)));
  if (n < 4) {
    return { n, r, t, df, p, lo: NaN, hi: NaN,
             note: 'The Fisher-z interval needs at least 4 pairs.' };
  }
  const zc = normInv(1 - (1 - level) / 2), w = zc / Math.sqrt(n - 3), zr = Math.atanh(r);
  return { n, r, t, df, p, lo: Math.tanh(zr - w), hi: Math.tanh(zr + w), note: null };
}

// Largest replication count any planner here returns; past it the answer is reported
// as unreachable rather than as a number nobody could run.
const PLAN_CAP = 1e7;

/**
 * Two-sided power of the one-sample t test against a true shift delta from the
 * reference mean, with standard deviation sd, n replications, and level alpha. Both
 * rejection tails count, as in R's power.t.test(type = 'one.sample', strict = TRUE):
 * 1 − F(t_q; n − 1, δ) + F(−t_q; n − 1, δ), where F is the noncentral t CDF,
 * t_q = t_{1−α/2, n−1}, and δ = delta · sqrt(n) / sd.
 * @param {{n: number, sd: number, delta: number, alpha: number}} o
 * @returns {number}
 */
export function powerOneSample({ n, sd, delta, alpha }) {
  const df = n - 1, tq = tQuantile(1 - alpha / 2, df), ncp = delta * Math.sqrt(n) / sd;
  return 1 - nctCdf(tq, df, ncp) + nctCdf(-tq, df, ncp);
}

// The reason a power plan cannot be made, or null when its inputs are usable.
function powerInputProblem(sd, delta, alpha, power) {
  if (!Number.isFinite(delta) || delta === 0) return 'The difference to detect must be a nonzero number.';
  if (!Number.isFinite(sd) || !(sd > 0)) return 'The standard deviation must be a positive number.';
  if (!(power > 0 && power < 1)) return 'The target power must lie strictly between 0 and 1.';
  if (!(alpha > 0 && alpha < 1)) return 'The significance level must lie strictly between 0 and 1.';
  return null;
}

/**
 * Replications needed for the one-sample t test to detect a shift delta with the
 * given power: the smallest n ≥ 2 with powerOneSample(n) ≥ power. The search starts
 * at the normal approximation ((z_{1−α/2} + z_power) · sd / delta)² and moves from
 * there to the exact threshold, which is valid because the power grows with n.
 * @param {{sd: number, delta: number, alpha: number, power: number}} o
 * @returns {{n: number|null, powerAtN: number, ncp: number, reason?: string}} n is
 *   null, with a reason, when an input is out of range or the answer exceeds 10^7
 */
export function planPowerOneSample({ sd, delta, alpha, power }) {
  const bad = powerInputProblem(sd, delta, alpha, power);
  if (bad) return { n: null, powerAtN: NaN, ncp: NaN, reason: bad };
  const guess = ((normInv(1 - alpha / 2) + normInv(power)) * sd / delta) ** 2;
  const tooMany = 'More than 10,000,000 replications would be needed.';
  if (!(guess <= PLAN_CAP)) return { n: null, powerAtN: NaN, ncp: NaN, reason: tooMany };
  const at = n => powerOneSample({ n, sd, delta, alpha });
  const { n } = smallestN(k => at(k) >= power, guess, 2, PLAN_CAP);
  if (n === null) return { n: null, powerAtN: NaN, ncp: NaN, reason: tooMany };
  return { n, powerAtN: at(n), ncp: delta * Math.sqrt(n) / sd };
}

/**
 * The least-squares line of y on x with the confidence band for the mean of y
 * at a given x: slope b = r·s_y/s_x, intercept ȳ − b·x̄, residual standard
 * deviation s on n − 2 degrees of freedom, and at x the fitted value
 * ± t_{1−α/2, n−2} · s · sqrt(1/n + (x − x̄)²/S_xx), which is what R's
 * predict(lm(y ~ x), interval = "confidence") returns.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @param {number} [level]
 * @returns {{ n: number, slope: number, intercept: number, s: number, df: number, t: number,
 *   xbar: number, sxx: number, r2: number, band: (x: number) => {fit: number, lo: number, hi: number} }}
 */
export function regressionLine(x, y, level = 0.95) {
  const n = x.length;
  if (y.length !== n) throw new RangeError('regressionLine: x and y differ in length');
  if (n < 3) throw new RangeError('regressionLine: at least 3 pairs are needed');
  const xbar = mean(x), ybar = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xbar, dy = y[i] - ybar;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxy / sxx, intercept = ybar - slope * xbar, df = n - 2;
  const sse = syy - slope * sxy;
  const s = Math.sqrt(Math.max(0, sse) / df);
  const t = tQuantile(1 - (1 - level) / 2, df);
  const r2 = syy > 0 ? 1 - sse / syy : NaN;
  const band = (xv) => {
    const fit = intercept + slope * xv;
    const hw = t * s * Math.sqrt(1 / n + (xv - xbar) * (xv - xbar) / sxx);
    return { fit, lo: fit - hw, hi: fit + hw };
  };
  return { n, slope, intercept, s, df, t, xbar, sxx, r2, band };
}
