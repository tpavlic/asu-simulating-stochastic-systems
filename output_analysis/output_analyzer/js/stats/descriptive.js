// Descriptive statistics for samples and for time-stamped trajectories. Pure
// functions, no DOM. Vectors may be plain arrays or typed arrays; functions
// that return vectors return Float64Array.

/**
 * Sample mean, with a second pass that corrects the rounding error of the first
 * (the same refinement R's mean() applies).
 * @param {ArrayLike<number>} a
 * @returns {number} NaN for an empty sample
 */
export function mean(a) {
  const n = a.length;
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i];
  const m = s / n;
  let c = 0;
  for (let i = 0; i < n; i++) c += a[i] - m;
  return m + c / n;
}

/**
 * Sample variance with divisor n − 1, by two passes about the mean.
 * @param {ArrayLike<number>} a
 * @returns {number} NaN when n < 2
 */
export function variance(a) {
  const n = a.length;
  if (n < 2) return NaN;
  const m = mean(a);
  let ss = 0, c = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - m; ss += d * d; c += d; }
  return (ss - c * c / n) / (n - 1);
}

/**
 * Sample standard deviation (divisor n − 1).
 * @param {ArrayLike<number>} a
 * @returns {number}
 */
export function sd(a) { return Math.sqrt(variance(a)); }

/**
 * Standard error of the mean, sd / sqrt(n).
 * @param {ArrayLike<number>} a
 * @returns {number}
 */
export function se(a) { return sd(a) / Math.sqrt(a.length); }

/**
 * Smallest and largest values.
 * @param {ArrayLike<number>} a
 * @returns {{min: number, max: number}} both NaN for an empty sample
 */
export function minmax(a) {
  if (a.length === 0) return { min: NaN, max: NaN };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
  return { min: lo, max: hi };
}

/**
 * Ascending sorted copy.
 * @param {ArrayLike<number>} a
 * @returns {Float64Array}
 */
export function sortedCopy(a) { return Float64Array.from(a).sort(); }

/**
 * Sample quantile of an already sorted vector by R's type 7 (the default of
 * quantile()): linear interpolation between order statistics at h = (n − 1)p.
 * @param {ArrayLike<number>} sorted ascending
 * @param {number} p in [0, 1]
 * @returns {number}
 */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0 || !(p >= 0 && p <= 1)) return NaN;
  const h = (n - 1) * p, lo = Math.floor(h), hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Summary of a sample; the quartiles are R's type 7.
 * @param {ArrayLike<number>} a
 * @returns {{n: number, mean: number, sd: number, se: number, min: number, q1: number,
 *   median: number, q3: number, max: number}}
 */
export function summary(a) {
  const s = sortedCopy(a), n = s.length;
  return {
    n, mean: mean(a), sd: sd(a), se: se(a),
    min: n ? s[0] : NaN,
    q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75),
    max: n ? s[n - 1] : NaN
  };
}

/**
 * Empirical cdf as a step function: the distinct values in ascending order and,
 * at each, the fraction of the sample at or below it.
 * @param {ArrayLike<number>} a
 * @returns {{x: Float64Array, p: Float64Array}}
 */
export function ecdf(a) {
  const s = sortedCopy(a), n = s.length, xs = [], ps = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && s[i + 1] === s[i]) continue;   // keep the last of a run of ties
    xs.push(s[i]); ps.push((i + 1) / n);
  }
  return { x: Float64Array.from(xs), p: Float64Array.from(ps) };
}

/**
 * Equal-width histogram over [min, max]. Each bin is [edges[b], edges[b+1]) except the
 * last, which is closed on the right, and so the maximum is counted. A constant sample
 * gives one bin of width 1 centered on its value; an empty sample gives one empty bin
 * on [0, 1]. Always edges.length === counts.length + 1.
 * @param {ArrayLike<number>} a
 * @param {{bins?: number}} [opts] bin count; default max(5, ceil(sqrt(n)))
 * @returns {{edges: Float64Array, counts: Float64Array, binWidth: number}}
 */
export function histogram(a, opts) {
  const n = a.length;
  if (n === 0) return { edges: Float64Array.of(0, 1), counts: new Float64Array(1), binWidth: 1 };
  const { min, max } = minmax(a);
  if (!(max > min)) {
    return { edges: Float64Array.of(min - 0.5, min + 0.5), counts: Float64Array.of(n), binWidth: 1 };
  }
  const want = opts && opts.bins;
  const bins = want > 0 ? Math.floor(want) : Math.max(5, Math.ceil(Math.sqrt(n)));
  const w = (max - min) / bins;
  const edges = new Float64Array(bins + 1);
  for (let b = 0; b <= bins; b++) edges[b] = min + b * w;
  edges[bins] = max;
  const counts = new Float64Array(bins);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    let b = Math.min(bins - 1, Math.floor((x - min) / w));
    // The arithmetic index can land one bin off when x sits on an edge; settle it
    // against the stored edges so the half-open rule holds exactly.
    while (b > 0 && x < edges[b]) b--;
    while (b < bins - 1 && x >= edges[b + 1]) b++;
    counts[b]++;
  }
  return { edges, counts, binWidth: w };
}

/**
 * Box-plot statistics as Tukey drew them and as R's boxplot.stats() computes them:
 * the box is the lower hinge, median, and upper hinge (fivenum()), the fences sit
 * 1.5 hinge spreads beyond the hinges, each whisker ends at the most extreme
 * observation inside its fence, and the observations beyond the fences are listed.
 * Tukey's hinges coincide with the type-7 quartiles for some n and differ slightly
 * for others.
 * @param {ArrayLike<number>} a
 * @returns {{q1: number, median: number, q3: number, whiskerLo: number, whiskerHi: number,
 *   outliers: Float64Array}}
 */
export function boxStats(a) {
  const s = sortedCopy(a), n = s.length;
  if (n === 0) {
    return { q1: NaN, median: NaN, q3: NaN, whiskerLo: NaN, whiskerHi: NaN, outliers: new Float64Array(0) };
  }
  // fivenum(): depths 1, n4, (n + 1)/2, n + 1 − n4, n, averaging the two order
  // statistics around a half-integer depth.
  const n4 = Math.floor((n + 3) / 2) / 2;
  const at = d => 0.5 * (s[Math.floor(d) - 1] + s[Math.ceil(d) - 1]);
  const q1 = at(n4), median = at((n + 1) / 2), q3 = at(n + 1 - n4);
  const reach = 1.5 * (q3 - q1), lo = q1 - reach, hi = q3 + reach;
  let whiskerLo = NaN, whiskerHi = NaN;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = s[i];
    if (x < lo || x > hi) { out.push(x); continue; }
    if (Number.isNaN(whiskerLo)) whiskerLo = x;
    whiskerHi = x;
  }
  return { q1, median, q3, whiskerLo, whiskerHi, outliers: Float64Array.from(out) };
}

/**
 * Running (cumulative) mean: element i is the mean of a[0..i].
 * @param {ArrayLike<number>} a
 * @returns {Float64Array}
 */
export function runningMean(a) {
  const out = new Float64Array(a.length);
  let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; out[i] = s / (i + 1); }
  return out;
}

/**
 * Alias of runningMean.
 * @param {ArrayLike<number>} a
 * @returns {Float64Array}
 */
export function cumulativeMean(a) { return runningMean(a); }

/**
 * Sample autocorrelation r_0..r_maxLag as R's acf(): deviations from the sample
 * mean, each lag's sum of products divided by n (not n − k), and every lag divided
 * by the lag-0 value. maxLag is clipped to n − 1.
 * @param {ArrayLike<number>} a
 * @param {number} maxLag
 * @returns {Float64Array} length min(maxLag, n − 1) + 1; r_0 = 1
 */
export function acf(a, maxLag) {
  const n = a.length;
  if (n === 0) return new Float64Array(0);
  const L = Math.max(0, Math.min(Math.floor(maxLag), n - 1));
  const m = mean(a), d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = a[i] - m;
  const out = new Float64Array(L + 1);
  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += d[i] * d[i];
  for (let k = 0; k <= L; k++) {
    let c = 0;
    for (let i = 0; i + k < n; i++) c += d[i] * d[i + k];
    out[k] = c / c0;
  }
  return out;
}

/**
 * The pairs (a[i], a[i + lag]) for a lag plot.
 * @param {ArrayLike<number>} a
 * @param {number} lag ≥ 1
 * @returns {{x: Float64Array, y: Float64Array}}
 */
export function lagPairs(a, lag) {
  const m = Math.max(0, a.length - lag);
  const x = new Float64Array(m), y = new Float64Array(m);
  for (let i = 0; i < m; i++) { x[i] = a[i]; y[i] = a[i + lag]; }
  return { x, y };
}

/**
 * Pearson correlation coefficient of two equal-length samples.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {number} NaN when either sample has no spread or n < 2
 */
export function pearson(x, y) {
  const n = x.length;
  if (y.length !== n) throw new RangeError('pearson: x and y differ in length');
  if (n < 2) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  return Math.max(-1, Math.min(1, r));
}

// Where the trajectory stops being covered: endTime when given, otherwise the
// last record's time, which gives the last value no duration.
function trajectoryEnd(t, endTime) {
  const last = t[t.length - 1];
  if (endTime === null || endTime === undefined) return last;
  if (endTime < last) throw new RangeError(`endTime ${endTime} precedes the last record at ${last}`);
  return endTime;
}

/**
 * Time-weighted mean of a piecewise-constant trajectory. The value v[i] recorded at
 * t[i] holds on [t[i], t[i+1]); the last value holds on [t[n−1], endTime], or for no
 * time when endTime is null. Times must be nondecreasing.
 * @param {ArrayLike<number>} t record times
 * @param {ArrayLike<number>} v values
 * @param {number|null} endTime end of observation
 * @returns {number} NaN when the total duration is 0
 * @throws {RangeError} when endTime precedes the last record
 */
export function timeWeightedMean(t, v, endTime) {
  const n = t.length;
  if (n === 0) return NaN;
  const end = trajectoryEnd(t, endTime);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const dur = (i + 1 < n ? t[i + 1] : end) - t[i];
    if (dur > 0) area += v[i] * dur;
  }
  const total = end - t[0];
  return total > 0 ? area / total : NaN;
}

/**
 * Per-bin time averages of a piecewise-constant trajectory (the same holding rule as
 * timeWeightedMean). For bin [edges[b], edges[b+1]) the result is the integral of the
 * trajectory over the part of the bin it covers divided by the length of that part;
 * nothing before t[0] or after the end is covered.
 * @param {ArrayLike<number>} t record times, nondecreasing
 * @param {ArrayLike<number>} v values
 * @param {number|null} endTime end of observation (null: the last record's time)
 * @param {ArrayLike<number>} edges ascending bin edges
 * @returns {Float64Array} one average per bin, NaN where the covered length is 0
 * @throws {RangeError} when endTime precedes the last record
 */
export function timeWeightedBins(t, v, endTime, edges) {
  const nb = Math.max(0, edges.length - 1), n = t.length;
  const area = new Float64Array(nb), cover = new Float64Array(nb);
  if (n > 0 && nb > 0) {
    const end = trajectoryEnd(t, endTime);
    let b = 0;
    for (let i = 0; i < n; i++) {
      const a = t[i], c = i + 1 < n ? t[i + 1] : end;
      if (!(c > a)) continue;
      // Segments arrive in time order, and so the first bin that can overlap this
      // one is never before the first bin that overlapped the previous one.
      while (b < nb && edges[b + 1] <= a) b++;
      for (let k = b; k < nb && edges[k] < c; k++) {
        const len = Math.min(c, edges[k + 1]) - Math.max(a, edges[k]);
        if (len > 0) { area[k] += v[i] * len; cover[k] += len; }
      }
    }
  }
  const out = new Float64Array(nb);
  for (let k = 0; k < nb; k++) out[k] = cover[k] > 0 ? area[k] / cover[k] : NaN;
  return out;
}

/**
 * Per-bin means of time-stamped observations: bin b holds the observations with
 * edges[b] ≤ t < edges[b+1], and the last bin is closed on the right. Observations
 * outside [edges[0], edges[last]] belong to no bin.
 * @param {ArrayLike<number>} t observation times
 * @param {ArrayLike<number>} v values
 * @param {ArrayLike<number>} edges ascending bin edges
 * @returns {Float64Array} one mean per bin, NaN for an empty bin
 */
export function tallyBins(t, v, edges) {
  const nb = Math.max(0, edges.length - 1);
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (!(x >= edges[0] && x <= edges[nb])) continue;
    let lo = 0, hi = nb - 1;   // the last b with edges[b] ≤ x, capped at nb − 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (edges[mid] <= x) lo = mid; else hi = mid - 1;
    }
    sum[lo] += v[i]; cnt[lo]++;
  }
  const out = new Float64Array(nb);
  for (let k = 0; k < nb; k++) out[k] = cnt[k] > 0 ? sum[k] / cnt[k] : NaN;
  return out;
}
