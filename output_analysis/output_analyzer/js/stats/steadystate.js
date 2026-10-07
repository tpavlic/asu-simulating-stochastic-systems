// Steady-state output analysis: aligning replications for a warm-up plot, Welch's moving
// average, the cumulative average, batch means on one long replication, and the lag-one
// autocorrelation test on the batch means.
//
// A time-persistent trajectory is a list of records (t[i], v[i]): the value v[i] holds on
// [t[i], t[i+1]), and the last value holds until an end time (none given: it holds for no time).
// A tally series is a list of observations, optionally time-stamped.

import { tQuantile, normCdf } from './special.js';

// ---------------------------------------------------------------------------------------------
// Time weighting and time bins
// ---------------------------------------------------------------------------------------------

/** End of the last record's holding interval: the end time if given, else the last record time. */
function lastEnd(t, endTime) {
  const n = t.length;
  return endTime == null ? t[n - 1] : endTime;
}

/** Index of the bin [edges[b], edges[b+1]) holding x, or -1 below edges[0]; B − 1 at or above the top. */
function binOf(edges, x) {
  const B = edges.length - 1;
  if (x < edges[0]) return -1;
  if (x >= edges[B]) return B;
  let lo = 0, hi = B;          // invariant: edges[lo] <= x < edges[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= x) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Time-weighted mean of a trajectory over [t[0], end], where end is endTime or, when endTime is
 * null, t[n−1] (the last value then carries no weight). NaN when the trajectory covers no time.
 */
function twMean(t, v, endTime) {
  const n = t.length;
  if (n === 0) return NaN;
  const end = lastEnd(t, endTime);
  let area = 0, dur = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.max(0, (i + 1 < n ? t[i + 1] : end) - t[i]);
    area += v[i] * d; dur += d;
  }
  return dur > 0 ? area / dur : NaN;
}

/**
 * Time average of a trajectory over the covered part of each bin [edges[b], edges[b+1]): every
 * holding interval contributes its value times the duration it overlaps the bin. NaN for a bin
 * the trajectory does not cover. It makes one sweep over the records, and so the work is O(n log B + B).
 */
function twBins(t, v, endTime, edges) {
  const B = edges.length - 1;
  const area = new Float64Array(B), dur = new Float64Array(B);
  const n = t.length;
  const end = n ? lastEnd(t, endTime) : 0;
  for (let i = 0; i < n; i++) {
    const a = t[i], z = i + 1 < n ? t[i + 1] : end;
    if (!(z > a)) continue;
    let b = Math.max(0, binOf(edges, a));
    for (; b < B && edges[b] < z; b++) {
      const ov = Math.min(z, edges[b + 1]) - Math.max(a, edges[b]);
      if (ov > 0) { area[b] += v[i] * ov; dur[b] += ov; }
    }
  }
  const out = new Float64Array(B);
  for (let b = 0; b < B; b++) out[b] = dur[b] > 0 ? area[b] / dur[b] : NaN;
  return out;
}

/**
 * Mean of the observations whose times fall in each bin, edges[b] ≤ t < edges[b+1], with the
 * last bin closed on the right. NaN for an empty bin.
 */
function tlBins(t, v, edges) {
  const B = edges.length - 1;
  const sum = new Float64Array(B), cnt = new Float64Array(B);
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (!(x >= edges[0]) || x > edges[B]) continue;
    const b = Math.min(binOf(edges, x), B - 1);
    sum[b] += v[i]; cnt[b] += 1;
  }
  const out = new Float64Array(B);
  for (let b = 0; b < B; b++) out[b] = cnt[b] > 0 ? sum[b] / cnt[b] : NaN;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Aligning replications
// ---------------------------------------------------------------------------------------------

/**
 * Average across replications at each observation index.
 * @param {{t: ArrayLike<number>|null, v: ArrayLike<number>}[]} reps
 * @returns {{ybar: Float64Array, counts: Int32Array, L: number}} ybar[i] is the mean of v[i]
 *   over the replications with more than i observations, counts[i] how many there are, and L the
 *   longest replication's length.
 */
export function alignByIndex(reps) {
  let L = 0;
  for (const r of reps) L = Math.max(L, r.v.length);
  const sum = new Float64Array(L), counts = new Int32Array(L);
  for (const r of reps) {
    for (let i = 0; i < r.v.length; i++) { sum[i] += r.v[i]; counts[i] += 1; }
  }
  const ybar = new Float64Array(L);
  for (let i = 0; i < L; i++) ybar[i] = counts[i] > 0 ? sum[i] / counts[i] : NaN;
  return { ybar, counts, L };
}

/**
 * Average across replications in bins of equal simulation-time width over [0, T], where T is
 * endTime or, when endTime is null, the latest last record time over the replications. For
 * `'time'` each replication contributes its time average over the covered part of each bin (its
 * last record holding until endTime, or for no time when endTime is null); for `'tally'` it
 * contributes the mean of its observations in the bin. A replication that leaves a bin uncovered
 * or empty contributes nothing to it.
 * @param {{t: ArrayLike<number>, v: ArrayLike<number>}[]} reps time-stamped replications
 * @param {'time'|'tally'} kind
 * @param {number} nBins
 * @param {number|null} endTime
 * @param {number} [start=0] the time the bins start from, the cut for a series already truncated by time
 * @returns {{edges: Float64Array, centers: Float64Array, ybar: Float64Array, counts: Int32Array}}
 *   ybar[b] averages the replications that contribute to bin b (NaN when none do), and counts[b]
 *   is how many contribute.
 */
export function alignByTime(reps, kind, nBins, endTime, start = 0) {
  let T = endTime;
  if (T == null) {
    T = -Infinity;
    for (const r of reps) {
      if (!r.t) throw new Error('Aligning by time needs time stamps on every replication.');
      if (r.t.length) T = Math.max(T, r.t[r.t.length - 1]);
    }
    if (!Number.isFinite(T)) T = 0;
  }
  const B = Math.max(1, Math.floor(nBins));
  const t0 = Number.isFinite(start) && start < T ? start : 0;
  const edges = new Float64Array(B + 1), centers = new Float64Array(B);
  for (let b = 0; b <= B; b++) edges[b] = b === 0 ? t0 : b === B ? T : t0 + ((T - t0) * b) / B;
  for (let b = 0; b < B; b++) centers[b] = 0.5 * (edges[b] + edges[b + 1]);
  const sum = new Float64Array(B), counts = new Int32Array(B);
  for (const r of reps) {
    if (!r.t) throw new Error('Aligning by time needs time stamps on every replication.');
    if (!r.t.length) continue;
    const m = kind === 'time'
      ? twBins(r.t, r.v, endTime ?? r.t[r.t.length - 1], edges)
      : tlBins(r.t, r.v, edges);
    for (let b = 0; b < B; b++) if (!Number.isNaN(m[b])) { sum[b] += m[b]; counts[b] += 1; }
  }
  const ybar = new Float64Array(B);
  for (let b = 0; b < B; b++) ybar[b] = counts[b] > 0 ? sum[b] / counts[b] : NaN;
  return { edges, centers, ybar, counts };
}

// ---------------------------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------------------------

/**
 * Welch's moving average with half-width w (0-based indices): for w ≤ i ≤ L − 1 − w, the mean of
 * ybar[i−w..i+w]; for i < w, the symmetric shrinking span ybar[0..2i]; NaN past L − 1 − w, where
 * the span would run off the end. w = 0 returns a copy.
 * @param {ArrayLike<number>} ybar
 * @param {number} w
 * @returns {Float64Array}
 */
export function movingAverage(ybar, w) {
  const L = ybar.length;
  const out = new Float64Array(L);
  w = Math.max(0, Math.floor(w));
  if (w === 0) { for (let i = 0; i < L; i++) out[i] = ybar[i]; return out; }
  // Prefix sums make every span an O(1) difference.
  const pre = new Float64Array(L + 1);
  for (let i = 0; i < L; i++) pre[i + 1] = pre[i] + ybar[i];
  for (let i = 0; i < L; i++) {
    if (i > L - 1 - w) { out[i] = NaN; continue; }
    const h = i < w ? i : w;
    out[i] = (pre[i + h + 1] - pre[i - h]) / (2 * h + 1);
  }
  return out;
}

/**
 * Welch's moving average over a series with empty (non-finite) entries: the same symmetric span
 * as movingAverage, averaging only the finite entries in it (NaN when none is finite). The
 * Steady State page uses it when some time bin holds no observation from any replication, where
 * movingAverage's running sum would carry the gap to every later point.
 * @param {ArrayLike<number>} y
 * @param {number} half the half-width w
 * @returns {Float64Array}
 */
export function gapAwareAverage(y, half) {
  const L = y.length, out = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    if (i > L - 1 - half) { out[i] = NaN; continue; }
    const h = i < half ? i : half;
    let s = 0, c = 0;
    for (let k = i - h; k <= i + h; k++) if (Number.isFinite(y[k])) { s += y[k]; c++; }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

/**
 * Cumulative average: entry i is the mean of ybar[0..i], skipping NaN entries (NaN until the
 * first finite one).
 * @param {ArrayLike<number>} ybar
 * @returns {Float64Array}
 */
export function cumulativeAverage(ybar) {
  const out = new Float64Array(ybar.length);
  let s = 0, c = 0;
  for (let i = 0; i < ybar.length; i++) {
    if (!Number.isNaN(ybar[i])) { s += ybar[i]; c += 1; }
    out[i] = c > 0 ? s / c : NaN;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lag-one autocorrelation
// ---------------------------------------------------------------------------------------------

/** Mean and sum of squared deviations of a. */
function centered(a) {
  const b = a.length;
  let m = 0;
  for (let j = 0; j < b; j++) m += a[j];
  m /= b;
  let ss = 0;
  for (let j = 0; j < b; j++) ss += (a[j] - m) * (a[j] - m);
  return { m, ss };
}

/**
 * Lag-one sample autocorrelation r₁ = Σ_{j<b} (a_j − ā)(a_{j+1} − ā) / Σ_j (a_j − ā)², the
 * estimator R's `acf` uses. NaN for fewer than two values or a constant series.
 * @param {ArrayLike<number>} a
 * @returns {number}
 */
export function lag1(a) {
  const b = a.length;
  if (b < 2) return NaN;
  const { m, ss } = centered(a);
  if (!(ss > 0)) return NaN;
  let num = 0;
  for (let j = 0; j + 1 < b; j++) num += (a[j] - m) * (a[j + 1] - m);
  return num / ss;
}

/**
 * Fishman's test of zero lag-one autocorrelation:
 * C = sqrt((b² − 1)/(b − 2)) · [r₁ + ((a₁ − ā)² + (a_b − ā)²) / (2 Σ(a_j − ā)²)], which is close
 * to N(0, 1) under independence. One-sided: a large C indicates positive correlation, the kind
 * batches that are too small leave behind. Needs b ≥ 4 and a nonconstant series.
 * @param {ArrayLike<number>} a
 * @returns {{C: number, p: number, flag: boolean}} p = 1 − Φ(C), and flag is p < 0.05
 */
export function lag1Test(a) {
  const b = a.length;
  if (b < 4) return { C: NaN, p: NaN, flag: false };
  const { m, ss } = centered(a);
  if (!(ss > 0)) return { C: NaN, p: NaN, flag: false };
  const r1 = lag1(a);
  const d1 = a[0] - m, db = a[b - 1] - m;
  const C = Math.sqrt((b * b - 1) / (b - 2)) * (r1 + (d1 * d1 + db * db) / (2 * ss));
  const p = 1 - normCdf(C);
  return { C, p, flag: p < 0.05 };
}

// ---------------------------------------------------------------------------------------------
// Batch means
// ---------------------------------------------------------------------------------------------

/**
 * Cuts the warm-up off one replication. Returns the kept times and values plus, for each kept
 * record, its index in the original series (the carried record of a time-persistent cut gets the
 * index of the record whose state it carries).
 */
function truncateRep(rep, kind, truncate) {
  const t = rep.t, v = rep.v, n = v.length;
  const idx = [], tt = [], vv = [];
  if (!truncate || !(truncate.at > 0)) {
    for (let i = 0; i < n; i++) { idx.push(i); vv.push(v[i]); if (t) tt.push(t[i]); }
    return { idx, t: t ? tt : null, v: vv };
  }
  const at = truncate.at;
  if (truncate.by === 'index') {
    for (let i = Math.floor(at); i < n; i++) { idx.push(i); vv.push(v[i]); if (t) tt.push(t[i]); }
    return { idx, t: t ? tt : null, v: vv };
  }
  if (!t) return null;
  if (kind === 'time') {
    // The state in force at the cut is the last record at or before it; it becomes the first
    // record, at the cut time, and every later record follows.
    let k = -1;
    for (let i = 0; i < n; i++) if (t[i] <= at) k = i;
    if (k >= 0) { idx.push(k); tt.push(at); vv.push(v[k]); }
    for (let i = 0; i < n; i++) if (t[i] > at) { idx.push(i); tt.push(t[i]); vv.push(v[i]); }
    return { idx, t: tt, v: vv };
  }
  for (let i = 0; i < n; i++) if (t[i] >= at) { idx.push(i); tt.push(t[i]); vv.push(v[i]); }
  return { idx, t: tt, v: vv };
}

/** Number formatting for warning text: up to four significant digits, no trailing zeros. */
function fmt(x) {
  return String(Number(x.toPrecision(4)));
}

/**
 * Batch means on one replication: truncation, batches, and then a t interval on the batch means
 * with the lag-one autocorrelation and Fishman's test.
 *
 * Truncation: `{by: 'index', at}` drops the first `at` observations; `{by: 'time', at}` drops
 * tally observations with t < at, and cuts a time-persistent trajectory at `at`, carrying the
 * state in force there as the first record so the remaining trajectory starts at `at`.
 *
 * Batches: for tally data, consecutive runs of `size` observations, or `count` runs of
 * floor(n / count); the leftover observations are excluded and reported in `leftover.n`. For
 * time-persistent data, equal time intervals of width `size`, or `count` intervals over the
 * remaining [start, T], where T is endTime or, when null, the last record time; each batch mean is
 * the time average over its interval, and a leftover duration T − start − b·size is excluded and
 * reported in `leftover.duration`. Each batch's `start` and `end` are, for tally, 0-based indices
 * into the untruncated series (start inclusive, end exclusive), and for time-persistent data the
 * interval's time bounds; `n` counts the records in the batch.
 *
 * @param {{t: ArrayLike<number>|null, v: ArrayLike<number>}} rep
 * @param {{kind: 'tally'|'time', truncate: {by: 'index'|'time', at: number}|null,
 *   count?: number|null, size?: number|null, endTime?: number|null, level?: number}} opts
 *   exactly one of `count` or `size`; `level` defaults to 0.95
 * @returns {{ok: false, reason: string} | {ok: true, b: number, size: number, byTime: boolean,
 *   batches: {start: number, end: number, n: number, mean: number}[],
 *   leftover: {n: number, duration?: number}, means: Float64Array, mean: number, sd: number,
 *   se: number, df: number, t: number, hw: number, lo: number, hi: number, level: number,
 *   lag1: number, lag1Test: {C: number, p: number, flag: boolean}, nUsed: number,
 *   start: number, warnings: string[]}}
 *   `nUsed` is the number of records after truncation and `start` where the batching begins (an
 *   index into the untruncated series for tally, a time for time-persistent data).
 */
export function batchMeans(rep, opts) {
  const { kind, truncate = null, count = null, size = null, endTime = null } = opts || {};
  const level = opts && opts.level != null ? opts.level : 0.95;
  const byTime = kind === 'time';
  const hasCount = count != null, hasSize = size != null;
  if (hasCount === hasSize) return { ok: false, reason: 'Give either a batch count or a batch size, not both.' };
  if (hasCount && !(count >= 1)) return { ok: false, reason: 'The batch count must be at least 1.' };
  if (hasSize && !(size > 0)) return { ok: false, reason: 'The batch size must be positive.' };
  if (byTime && !rep.t) return { ok: false, reason: 'Time-persistent data need time stamps.' };

  const kept = truncateRep(rep, kind, truncate);
  if (!kept) return { ok: false, reason: 'Truncating by time needs time stamps.' };
  const nUsed = kept.v.length;

  const batches = [];
  let b, bsize, leftover, start;
  if (!byTime) {
    if (hasCount) { b = Math.floor(count); bsize = Math.floor(nUsed / b); }
    else { bsize = Math.floor(size); b = bsize > 0 ? Math.floor(nUsed / bsize) : 0; }
    if (bsize < 1) b = 0;
    leftover = { n: nUsed - b * bsize };
    start = nUsed ? kept.idx[0] : NaN;
    for (let k = 0; k < b; k++) {
      let s = 0;
      for (let i = k * bsize; i < (k + 1) * bsize; i++) s += kept.v[i];
      batches.push({ start: kept.idx[k * bsize], end: kept.idx[(k + 1) * bsize - 1] + 1, n: bsize, mean: s / bsize });
    }
  } else {
    if (nUsed === 0) return { ok: false, reason: 'No records remain after truncation.' };
    const t = kept.t, v = kept.v;
    start = t[0];
    const T = endTime == null ? t[nUsed - 1] : endTime;
    const span = T - start;
    if (!(span > 0)) return { ok: false, reason: 'The trajectory covers no time after truncation.' };
    if (hasCount) { b = Math.floor(count); bsize = span / b; }
    else {
      bsize = size;
      // A small relative slack keeps a span that is an exact multiple of the size, up to
      // rounding, from losing its last batch.
      b = Math.floor(span / bsize + 1e-9);
    }
    const edges = new Float64Array(b + 1);
    for (let k = 0; k <= b; k++) edges[k] = start + k * bsize;
    let dur = hasCount ? 0 : T - start - b * bsize;
    if (Math.abs(dur) <= 1e-9 * Math.max(1, Math.abs(span))) dur = 0;
    if (hasCount) edges[b] = T;
    const means = b > 0 ? twBins(t, v, T, edges) : new Float64Array(0);
    const counts = new Array(b).fill(0);
    let nLeft = 0;
    for (let i = 0; i < nUsed; i++) {
      const k = b > 0 ? binOf(edges, t[i]) : b;
      if (k >= 0 && k < b) counts[k] += 1;
      else if (k === b && b > 0 && dur === 0 && t[i] === edges[b]) counts[b - 1] += 1;
      else if (k === b) nLeft += 1;
    }
    leftover = { n: nLeft, duration: dur };
    for (let k = 0; k < b; k++) batches.push({ start: edges[k], end: edges[k + 1], n: counts[k], mean: means[k] });
  }

  if (b < 2) {
    return { ok: false, reason: 'Batch means need at least 2 batches; these settings give ' + b + '.' };
  }
  const means = Float64Array.from(batches, x => x.mean);
  const { m, ss } = centered(means);
  const sd = Math.sqrt(ss / (b - 1));
  const se = sd / Math.sqrt(b);
  const df = b - 1;
  const tq = tQuantile(1 - (1 - level) / 2, df);
  const hw = tq * se;
  const r1 = lag1(means);
  const test = lag1Test(means);

  const warnings = [];
  if (b < 10) {
    warnings.push('Only ' + b + ' batches: with fewer than 10 batches, the interval rests on few degrees of freedom and the lag-one test has little power.');
  }
  if (test.flag) {
    warnings.push('The batch means show significant positive lag-one correlation (C = ' + fmt(test.C) + ', ' + (test.p < 0.001 ? 'p < 0.001' : 'p = ' + fmt(test.p)) + '); larger batches are needed before the interval can be trusted.');
  }
  if (!byTime && leftover.n > 0) {
    warnings.push('The last ' + leftover.n + (leftover.n === 1 ? ' observation does' : ' observations do') + ' not fill a batch and ' + (leftover.n === 1 ? 'is' : 'are') + ' excluded.');
  }
  if (byTime && leftover.duration > 0) {
    warnings.push('The last ' + fmt(leftover.duration) + ' time units do not fill a batch and are excluded.');
  }

  return {
    ok: true, b, size: bsize, byTime, batches, leftover, means,
    mean: m, sd, se, df, t: tq, hw, lo: m - hw, hi: m + hw, level,
    lag1: r1, lag1Test: test, nUsed, start, warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Joining replications, and resampling a trajectory onto equal time steps
// ---------------------------------------------------------------------------------------------

/**
 * Joins replications end to end after each one's warm-up is cut, so that batch means can treat
 * them as one long run (what some output analyzers call lumping).
 *
 * Tally: the kept observations of each replication, in replication order; `t` is null, and each
 * entry of `joins` is the 0-based position in the joined series of a later replication's first
 * observation.
 *
 * Time-persistent: each replication's kept trajectory covers [s, E], where s is its first kept
 * record time (the cut time when cut by time, because the state in force there is carried) and E is
 * endTime or, when endTime is null, its last record time. The first trajectory keeps its own times;
 * every later one is shifted so its s lands where the previous one ended, and so the state at a
 * join jumps to the next run's first state. Each entry of `joins` is a join time on that timeline,
 * and `end` is where the joined trajectory ends.
 *
 * A replication with nothing left after the cut (or, time-persistent, covering no time) is skipped
 * and does not count in `nReps`.
 * @param {{t: ArrayLike<number>|null, v: ArrayLike<number>}[]} reps
 * @param {'tally'|'time'} kind
 * @param {{by: 'index'|'time', at: number}|null} truncate the same cut batchMeans takes
 * @param {number|null} endTime
 * @returns {{t: Float64Array|null, v: Float64Array, joins: number[], end: number|null, nReps: number}}
 *   `end` is null for tally data
 */
export function concatenateReps(reps, kind, truncate, endTime) {
  const byTime = kind === 'time';
  const tt = [], vv = [], joins = [];
  let nReps = 0, cum = NaN;
  for (const rep of reps) {
    const kept = truncateRep(rep, kind, truncate);
    if (!kept || !kept.v.length) continue;
    if (!byTime) {
      if (nReps > 0) joins.push(vv.length);
      for (let i = 0; i < kept.v.length; i++) vv.push(kept.v[i]);
      nReps++;
      continue;
    }
    if (!kept.t) continue;
    const n = kept.t.length;
    const s = kept.t[0];
    const E = endTime == null ? kept.t[n - 1] : endTime;
    if (!(E > s)) continue;
    const off = nReps === 0 ? 0 : cum - s;
    if (nReps > 0) joins.push(cum);
    for (let i = 0; i < n; i++) { tt.push(kept.t[i] + off); vv.push(kept.v[i]); }
    cum = E + off;
    nReps++;
  }
  return {
    t: byTime ? Float64Array.from(tt) : null,
    v: Float64Array.from(vv),
    joins,
    end: byTime ? (nReps ? cum : NaN) : null,
    nReps,
  };
}

/**
 * The correlogram of the series batching works on runs to lag min(ACF_MAX_LAG, n/4), and a
 * time-persistent series is first averaged over ACF_STEPS equal steps of simulation time (see
 * resampleTimeWeighted). The Steady State page and its regenerated scripts both read these.
 */
export const ACF_MAX_LAG = 400;
export const ACF_STEPS = 2000;

/**
 * Resamples a time-persistent trajectory onto `steps` equal intervals of [start, end]: each value
 * is the time average of the trajectory over its interval, as alignByTime computes for one bin. A
 * series on equal time steps is what an autocorrelation of time-persistent output needs because the
 * records themselves arrive at uneven times.
 * @param {ArrayLike<number>} t record times, ascending
 * @param {ArrayLike<number>} v record values
 * @param {number} start
 * @param {number} end where the last record stops holding
 * @param {number} steps
 * @returns {{step: number, edges: Float64Array, values: Float64Array}} NaN for an interval the
 *   trajectory does not cover
 */
export function resampleTimeWeighted(t, v, start, end, steps) {
  const B = Math.max(1, Math.floor(steps));
  const step = (end - start) / B;
  const edges = new Float64Array(B + 1);
  for (let b = 0; b <= B; b++) edges[b] = b === B ? end : start + b * step;
  const values = t.length ? twBins(t, v, end, edges) : new Float64Array(B).fill(NaN);
  return { step, edges, values };
}
