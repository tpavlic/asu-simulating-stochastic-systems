// Nonparametric procedures on replication estimates: the Wilcoxon
// signed-rank test with the Hodges–Lehmann pseudo-median, the Wilcoxon
// rank-sum (Mann–Whitney) test with the Hodges–Lehmann shift, the
// Kruskal–Wallis test, and Dunn's pairwise comparisons after it. The
// Wilcoxon procedures follow R's wilcox.test: exact distributions when the
// sample is small and free of ties, and otherwise the normal approximation
// with a continuity correction and a tie correction; intervals come from
// the order statistics of the Walsh averages or the cross differences in
// the exact case, and from inverting the approximate test otherwise. R 4.4
// and later compute an exact permutation distribution under ties as well;
// this module keeps the classical approximation there, which is what
// wilcox.test(exact = FALSE) gives and what earlier R and most other
// software report.

import { normCdf, normInv, chi2Cdf } from './special.js';
import { letterGroups } from './compare.js';

/**
 * Midranks of the values, with the sizes of the tied groups.
 * @param {ArrayLike<number>} v
 * @returns {{ranks: Float64Array, ties: number[]}}
 */
export function midranks(v) {
  const n = v.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b]);
  const ranks = new Float64Array(n);
  const ties = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && v[idx[j + 1]] === v[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, ties };
}

function tieSum(ties) {
  let s = 0;
  for (const t of ties) s += t * t * t - t;
  return s;
}

function sorted(a) { return Float64Array.from(a).sort(); }

function median(sortedArr) {
  const n = sortedArr.length;
  return n % 2 ? sortedArr[(n - 1) / 2] : (sortedArr[n / 2 - 1] + sortedArr[n / 2]) / 2;
}

// ── Exact distributions ───────────────────────────────────────────────────

const signrankCache = new Map();
/** Counts of subsets of {1..n} by their sum: the exact signed-rank distribution times 2^n. */
function signrankCounts(n) {
  if (signrankCache.has(n)) return signrankCache.get(n);
  const max = n * (n + 1) / 2;
  const c = new Float64Array(max + 1);
  c[0] = 1;
  for (let k = 1; k <= n; k++) for (let s = max; s >= k; s--) c[s] += c[s - k];
  signrankCache.set(n, c);
  return c;
}

/**
 * P(V ≤ v) for the signed-rank statistic of n untied, nonzero values, as R's psignrank.
 * @param {number} v
 * @param {number} n
 */
export function psignrank(v, n) {
  if (v < 0) return 0;
  const c = signrankCounts(n), max = n * (n + 1) / 2;
  if (v >= max) return 1;
  let s = 0;
  for (let i = 0; i <= Math.floor(v); i++) s += c[i];
  return s / Math.pow(2, n);
}

/** The smallest v with P(V ≤ v) ≥ p, as R's qsignrank. */
export function qsignrank(p, n) {
  const c = signrankCounts(n), max = n * (n + 1) / 2, total = Math.pow(2, n);
  let s = 0;
  for (let v = 0; v <= max; v++) {
    s += c[v];
    if (s / total >= p * (1 - 1e-12)) return v;
  }
  return max;
}

const wilcoxCache = new Map();
/** Counts of the Mann–Whitney U for sample sizes m and n, for u = 0..mn. */
function wilcoxCounts(m, n) {
  const key = m + ',' + n;
  if (wilcoxCache.has(key)) return wilcoxCache.get(key);
  // c[u] = number of arrangements with U = u, built up one x value at a
  // time: the generating function is the Gaussian binomial coefficient.
  const max = m * n;
  let c = new Float64Array(max + 1);
  c[0] = 1;
  // Multiply by (1 − q^(n+i)) / (1 − q^i) for i = 1..m.
  for (let i = 1; i <= m; i++) {
    const d = new Float64Array(max + 1);
    // numerator: c(q) * (1 − q^(n+i))
    for (let u = 0; u <= max; u++) d[u] = c[u] - (u >= n + i ? c[u - n - i] : 0);
    // divide by (1 − q^i): d(q) / (1 − q^i) = d(q) (1 + q^i + q^2i + …)
    for (let u = i; u <= max; u++) d[u] += d[u - i];
    c = d;
  }
  wilcoxCache.set(key, c);
  return c;
}

/**
 * P(W ≤ w) for the Mann–Whitney statistic of untied samples of sizes m and n, as R's pwilcox.
 * @param {number} w
 * @param {number} m
 * @param {number} n
 */
export function pwilcox(w, m, n) {
  if (w < 0) return 0;
  const c = wilcoxCounts(m, n), max = m * n;
  if (w >= max) return 1;
  let s = 0, total = 0;
  for (let i = 0; i <= max; i++) { total += c[i]; if (i <= Math.floor(w)) s += c[i]; }
  return s / total;
}

/** The smallest w with P(W ≤ w) ≥ p, as R's qwilcox. */
export function qwilcox(p, m, n) {
  const c = wilcoxCounts(m, n), max = m * n;
  let total = 0;
  for (let i = 0; i <= max; i++) total += c[i];
  let s = 0;
  for (let w = 0; w <= max; w++) {
    s += c[w];
    if (s / total >= p * (1 - 1e-12)) return w;
  }
  return max;
}

// ── Root finding on a monotone step function, as R's uniroot in wilcox.test ──

function uniroot(f, lo, hi, tol) {
  // Brent-style bisection with secant steps is overkill for a step function;
  // bisection to the tolerance R uses (1e-4) gives the same point to that
  // tolerance.
  let flo = f(lo), fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < 200 && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (fm === 0) return mid;
    if (fm * flo < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// ── Wilcoxon signed-rank ──────────────────────────────────────────────────

/**
 * Wilcoxon signed-rank test of location mu for one sample (or for paired
 * differences), with the Hodges–Lehmann estimate (the median of the Walsh
 * averages) and its interval, as R's wilcox.test(x, mu, conf.int = TRUE).
 * Zeros are dropped before ranking, as in R; the result says whether the
 * exact distribution was used.
 * @param {ArrayLike<number>} x
 * @param {{mu?: number, level?: number}} [opts]
 * @returns {{n: number, nUsed: number, V: number, p: number, exact: boolean, estimate: number,
 *   lo: number, hi: number, level: number, achieved: number, zeros: number, ties: boolean}}
 */
export function signedRank(x, { mu = 0, level = 0.95 } = {}) {
  const all = Array.from(x).filter(Number.isFinite);
  const n = all.length;
  const d = all.map(v => v - mu).filter(v => v !== 0);
  const zeros = n - d.length;
  const m = d.length;
  const abs = d.map(Math.abs);
  const { ranks, ties } = midranks(abs);
  let V = 0;
  for (let i = 0; i < m; i++) if (d[i] > 0) V += ranks[i];
  const hasTies = ties.length > 0;
  const exact = m < 50 && !hasTies && zeros === 0;
  let p;
  if (m === 0) p = NaN;
  else if (exact) {
    p = V > m * (m + 1) / 4 ? 1 - psignrank(V - 1, m) : psignrank(V, m);
    p = Math.min(1, 2 * p);
  } else {
    const mean = m * (m + 1) / 4;
    const sigma = Math.sqrt(m * (m + 1) * (2 * m + 1) / 24 - tieSum(ties) / 48);
    const z = (V - mean - Math.sign(V - mean) * 0.5) / sigma;
    p = m ? 2 * Math.min(normCdf(z), 1 - normCdf(z)) : NaN;
  }
  // Walsh averages of the values themselves (not of the differences from mu),
  // which is what the estimate and the interval describe.
  const w = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) w.push((all[i] + all[j]) / 2);
  const walsh = sorted(w);
  const estimate = n ? median(walsh) : NaN;
  const alpha = 1 - level;
  let lo = NaN, hi = NaN, achieved = NaN;
  if (n === 0) {
    // nothing to estimate
  } else if (exact) {
    // As R: the quantile is stepped up when it sits exactly on the tail
    // probability, and a quantile of zero means the interval is the whole line.
    let qu = qsignrank(alpha / 2, n);
    if (psignrank(qu, n) <= alpha / 2 + 10 * Number.EPSILON) qu += 1;
    if (qu === 0) { achieved = 0; lo = -Infinity; hi = Infinity; } else {
      const ql = n * (n + 1) / 2 - qu;
      achieved = 2 * psignrank(Math.trunc(qu) - 1, n);
      lo = walsh[qu - 1]; hi = walsh[ql];
    }
  } else if (n >= 2) {
    // R inverts the approximate test: the d at which the corrected
    // standardized statistic of x − d meets ±z_{α/2}.
    const stat = (dd, zq) => {
      const dx = all.map(v => v - dd).filter(v => v !== 0);
      const mm = dx.length;
      const r = midranks(dx.map(Math.abs));
      let Vd = 0;
      for (let i = 0; i < mm; i++) if (dx[i] > 0) Vd += r.ranks[i];
      const mean = mm * (mm + 1) / 4;
      const sigma = Math.sqrt(mm * (mm + 1) * (2 * mm + 1) / 24 - tieSum(r.ties) / 48);
      const corr = zq === 0 ? 0 : Math.sign(Vd - mean) * 0.5;
      return (Vd - mean - corr) / sigma - zq;
    };
    const zq = normInv(1 - alpha / 2);
    const mumin = Math.min(...all), mumax = Math.max(...all);
    lo = uniroot(dd => stat(dd, zq), mumin, mumax, 1e-4);
    hi = uniroot(dd => stat(dd, -zq), mumin, mumax, 1e-4);
    achieved = alpha;
  }
  return { n, nUsed: m, V, p, exact, estimate, lo, hi, level, achieved: Number.isFinite(achieved) ? 1 - achieved : NaN, zeros, ties: hasTies };
}

// ── Wilcoxon rank-sum (Mann–Whitney) ──────────────────────────────────────

/**
 * Wilcoxon rank-sum test of x against y, with the Hodges–Lehmann shift
 * estimate (the median of the x − y cross differences) and its interval,
 * as R's wilcox.test(x, y, conf.int = TRUE). W is R's statistic, the
 * Mann–Whitney U counted for x.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @param {{level?: number}} [opts]
 * @returns {{nx: number, ny: number, W: number, p: number, exact: boolean, estimate: number,
 *   lo: number, hi: number, level: number, achieved: number, ties: boolean}}
 */
export function rankSum(x, y, { level = 0.95 } = {}) {
  const xs = Array.from(x).filter(Number.isFinite), ys = Array.from(y).filter(Number.isFinite);
  const nx = xs.length, ny = ys.length, N = nx + ny;
  const { ranks, ties } = midranks(xs.concat(ys));
  let rx = 0;
  for (let i = 0; i < nx; i++) rx += ranks[i];
  const W = rx - nx * (nx + 1) / 2;
  const hasTies = ties.length > 0;
  const exact = nx < 50 && ny < 50 && !hasTies;
  let p;
  if (!nx || !ny) p = NaN;
  else if (exact) {
    p = W > nx * ny / 2 ? 1 - pwilcox(W - 1, nx, ny) : pwilcox(W, nx, ny);
    p = Math.min(1, 2 * p);
  } else {
    const mean = nx * ny / 2;
    const sigma = Math.sqrt(nx * ny / 12 * ((N + 1) - tieSum(ties) / (N * (N - 1))));
    const z = (W - mean - Math.sign(W - mean) * 0.5) / sigma;
    p = 2 * Math.min(normCdf(z), 1 - normCdf(z));
  }
  const d = [];
  for (const a of xs) for (const b of ys) d.push(a - b);
  const diffs = sorted(d);
  const estimate = d.length ? median(diffs) : NaN;
  const alpha = 1 - level;
  let lo = NaN, hi = NaN, achieved = NaN;
  if (!nx || !ny) {
    // nothing to estimate
  } else if (exact) {
    let qu = qwilcox(alpha / 2, nx, ny);
    if (pwilcox(qu, nx, ny) <= alpha / 2 + 10 * Number.EPSILON) qu += 1;
    if (qu === 0) { achieved = 0; lo = -Infinity; hi = Infinity; } else {
      const ql = nx * ny - qu;
      achieved = 2 * pwilcox(Math.trunc(qu) - 1, nx, ny);
      lo = diffs[qu - 1]; hi = diffs[ql];
    }
  } else {
    const stat = (dd, zq) => {
      const r = midranks(xs.map(v => v - dd).concat(ys));
      let s = 0;
      for (let i = 0; i < nx; i++) s += r.ranks[i];
      const Wd = s - nx * (nx + 1) / 2;
      const mean = nx * ny / 2;
      const sigma = Math.sqrt(nx * ny / 12 * ((N + 1) - tieSum(r.ties) / (N * (N - 1))));
      const corr = zq === 0 ? 0 : Math.sign(Wd - mean) * 0.5;
      return (Wd - mean - corr) / sigma - zq;
    };
    const zq = normInv(1 - alpha / 2);
    const mumin = Math.min(...xs) - Math.max(...ys), mumax = Math.max(...xs) - Math.min(...ys);
    lo = uniroot(dd => stat(dd, zq), mumin, mumax, 1e-4);
    hi = uniroot(dd => stat(dd, -zq), mumin, mumax, 1e-4);
    achieved = alpha;
  }
  return { nx, ny, W, p, exact, estimate, lo, hi, level, achieved: Number.isFinite(achieved) ? 1 - achieved : NaN, ties: hasTies };
}

// ── Kruskal–Wallis and Dunn ───────────────────────────────────────────────

/**
 * The Kruskal–Wallis rank test across groups, with the tie correction, as
 * R's kruskal.test.
 * @param {(number[]|Float64Array)[]} groups
 * @returns {{k: number, N: number, n: number[], meanRanks: number[], H: number, df: number, p: number, ties: boolean}}
 */
export function kruskalWallis(groups) {
  const k = groups.length;
  const n = groups.map(g => g.length);
  const all = [];
  for (const g of groups) for (const v of g) all.push(v);
  const N = all.length;
  const { ranks, ties } = midranks(all);
  const meanRanks = new Array(k);
  let pos = 0, H = 0;
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < n[i]; r++) s += ranks[pos + r];
    pos += n[i];
    meanRanks[i] = n[i] ? s / n[i] : NaN;
    if (n[i]) H += s * s / n[i];
  }
  H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
  const corr = 1 - tieSum(ties) / (N * N * N - N);
  if (corr > 0) H /= corr;
  const df = k - 1;
  const p = 1 - chi2Cdf(H, df);
  return { k, N, n, meanRanks, H, df, p, ties: ties.length > 0 };
}

/**
 * Dunn's pairwise comparisons of mean ranks after Kruskal–Wallis, each
 * pair's z on the pooled rank variance with the tie correction, and the
 * p-values adjusted by Bonferroni or by Holm's step-down. A pair is flagged
 * when its adjusted p is below α; letters is the compact letter display of
 * the flagged pairs.
 * @param {(number[]|Float64Array)[]} groups
 * @param {{alpha: number, adjust?: 'bonferroni'|'holm'}} opts
 * @returns {{k: number, C: number, adjust: string, pairs: {i: number, j: number, diff: number, se: number, z: number, p: number, pAdj: number, flagged: boolean}[], letters: string[], kw: object}}
 */
export function dunn(groups, { alpha, adjust = 'bonferroni' }) {
  const kw = kruskalWallis(groups);
  const k = kw.k, N = kw.N;
  const all = [];
  for (const g of groups) for (const v of g) all.push(v);
  const { ties } = midranks(all);
  const varTerm = N * (N + 1) / 12 - tieSum(ties) / (12 * (N - 1));
  const pairs = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const diff = kw.meanRanks[i] - kw.meanRanks[j];
    const se = Math.sqrt(varTerm * (1 / kw.n[i] + 1 / kw.n[j]));
    const z = diff / se;
    const p = 2 * (1 - normCdf(Math.abs(z)));
    pairs.push({ i, j, diff, se, z, p, pAdj: NaN, flagged: false });
  }
  const C = pairs.length;
  if (adjust === 'holm') {
    const order = pairs.map((_, i) => i).sort((a, b) => pairs[a].p - pairs[b].p);
    let running = 0;
    order.forEach((idx, rank) => {
      const adj = Math.min(1, (C - rank) * pairs[idx].p);
      running = Math.max(running, adj);
      pairs[idx].pAdj = running;
    });
  } else {
    for (const pr of pairs) pr.pAdj = Math.min(1, C * pr.p);
  }
  for (const pr of pairs) pr.flagged = pr.pAdj < alpha;
  const letters = letterGroups(k, pairs.filter(pr => pr.flagged).map(pr => [pr.i, pr.j]));
  return { k, C, adjust, pairs, letters, kw };
}
