// Comparing designs: Welch's two-sample procedure, the paired t, Bonferroni
// families of intervals, one-way ANOVA, the post-hoc rules that follow it, the
// compact letter display, and replication planning for comparisons by half-width
// and by power. Pure functions, no DOM. Every vector argument may
// be a number[] or a Float64Array.

import { tCdf, tQuantile, fCdf, fQuantile, normInv, nctCdf, ncfCdf, ptukey, qtukey, qdunnett, smallestN }
  from './special.js';

// Small private helpers, kept here so this module stands on special.js alone.
function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}
// A sample whose values all equal the first (its minimum equals its maximum)
// has variance exactly 0, not the rounding error two passes can leave.
function allEqual(a) {
  if (a.length === 0 || !Number.isFinite(a[0])) return false;
  for (let i = 1; i < a.length; i++) if (a[i] !== a[0]) return false;
  return true;
}
function variance(a) {
  if (a.length > 1 && allEqual(a)) return 0;
  const n = a.length, m = mean(a);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - m; s += d * d; }
  return s / (n - 1);
}
function median(a) {
  const v = Float64Array.from(a).sort();
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

function pearson(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}
// Two-sided p-value of a t statistic, taken from the lower tail so that small
// p-values keep their digits.
function twoSidedP(t, df) {
  if (Number.isNaN(t) || Number.isNaN(df)) return NaN;
  return Math.min(1, 2 * tCdf(-Math.abs(t), df));
}

/**
 * Welch's two-sample t procedure for mean(x) − mean(y), with the
 * Welch–Satterthwaite degrees of freedom, as R's t.test(x, y).
 * @param {number[]|Float64Array} x
 * @param {number[]|Float64Array} y
 * @param {number} level confidence level, e.g. 0.95
 * @returns {{n1: number, n2: number, mean1: number, mean2: number, sd1: number, sd2: number,
 *   diff: number, se: number, df: number, t: number, p: number, hw: number, lo: number, hi: number}}
 */
export function welch(x, y, level) {
  const n1 = x.length, n2 = y.length;
  const mean1 = mean(x), mean2 = mean(y);
  const v1 = variance(x), v2 = variance(y);
  const a = v1 / n1, b = v2 / n2;
  const se = Math.sqrt(a + b);
  const diff = mean1 - mean2;
  // Two samples with no spread at all leave the Welch–Satterthwaite ratio
  // 0/0; the difference is then known exactly, and so the interval has no width,
  // and the test is decided by whether the two constants differ.
  if (se === 0) {
    const df = n1 + n2 - 2;
    const t = diff === 0 ? 0 : (diff > 0 ? Infinity : -Infinity);
    return { n1, n2, mean1, mean2, sd1: 0, sd2: 0, diff, se, df, t, p: diff === 0 ? 1 : 0, hw: 0, lo: diff, hi: diff };
  }
  const df = (a + b) * (a + b) / (a * a / (n1 - 1) + b * b / (n2 - 1));
  const t = diff / se;
  const p = twoSidedP(t, df);
  const hw = tQuantile(1 - (1 - level) / 2, df) * se;
  return { n1, n2, mean1, mean2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
           diff, se, df, t, p, hw, lo: diff - hw, hi: diff + hw };
}

/**
 * The pooled-variance two-sample t procedure for mean(x) − mean(y): the two
 * sample variances pooled with weights n1 − 1 and n2 − 1, on n1 + n2 − 2
 * degrees of freedom, as R's t.test(x, y, var.equal = TRUE).
 * @param {number[]|Float64Array} x
 * @param {number[]|Float64Array} y
 * @param {number} level confidence level, e.g. 0.95
 * @returns {{n1: number, n2: number, mean1: number, mean2: number, sd1: number, sd2: number,
 *   sp: number, diff: number, se: number, df: number, t: number, p: number, hw: number,
 *   lo: number, hi: number}}
 */
export function pooledT(x, y, level) {
  const n1 = x.length, n2 = y.length;
  const mean1 = mean(x), mean2 = mean(y);
  const v1 = variance(x), v2 = variance(y);
  const df = n1 + n2 - 2;
  const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
  const se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
  const diff = mean1 - mean2;
  const t = diff / se;
  const p = twoSidedP(t, df);
  const hw = tQuantile(1 - (1 - level) / 2, df) * se;
  return { n1, n2, mean1, mean2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2), sp: Math.sqrt(sp2),
           diff, se, df, t, p, hw, lo: diff - hw, hi: diff + hw };
}

/**
 * Matches the replications of two datasets for a paired analysis.
 * `'id'` pairs equal ids (compared as strings, the first occurrence on each
 * side; a repeated id beyond its first occurrence stays unmatched).
 * `'position'` pairs index i with index i for i < min(nA, nB).
 * @param {(string|number)[]} idsA
 * @param {(string|number)[]} idsB
 * @param {'id'|'position'} by
 * @returns {{pairs: number[][], unmatchedA: number[], unmatchedB: number[]}}
 *   pairs are [indexA, indexB] in the order of A; unmatched indices ascend
 */
export function matchPairs(idsA, idsB, by) {
  const nA = idsA.length, nB = idsB.length;
  const pairs = [], unmatchedA = [], unmatchedB = [];
  if (by === 'position') {
    const m = Math.min(nA, nB);
    for (let i = 0; i < m; i++) pairs.push([i, i]);
    for (let i = m; i < nA; i++) unmatchedA.push(i);
    for (let i = m; i < nB; i++) unmatchedB.push(i);
    return { pairs, unmatchedA, unmatchedB };
  }
  if (by !== 'id') throw new RangeError("matchPairs: by must be 'id' or 'position'");
  const firstB = new Map();
  for (let i = 0; i < nB; i++) {
    const key = String(idsB[i]);
    if (!firstB.has(key)) firstB.set(key, i);
  }
  const usedB = new Uint8Array(nB), seenA = new Set();
  for (let i = 0; i < nA; i++) {
    const key = String(idsA[i]);
    if (seenA.has(key) || !firstB.has(key)) { unmatchedA.push(i); seenA.add(key); continue; }
    seenA.add(key);
    const jB = firstB.get(key);
    pairs.push([i, jB]);
    usedB[jB] = 1;
  }
  for (let i = 0; i < nB; i++) if (!usedB[i]) unmatchedB.push(i);
  return { pairs, unmatchedA, unmatchedB };
}

/**
 * Matches replications across k designs into complete blocks: by position
 * (block r is replication r of every design, up to the shortest design) or by
 * id (a block is an id present in every design, taking the first occurrence
 * in each). Every replication left out is listed per design.
 * @param {(string|number)[][]} idsList one id list per design
 * @param {'id'|'position'} by
 * @returns {{blocks: number[][], unmatched: number[][], keys: (string|number)[]}}
 *   blocks[b][d] is the index into design d; keys[b] names the block
 */
export function matchBlocks(idsList, by) {
  const k = idsList.length;
  const blocks = [], keys = [];
  const unmatched = idsList.map(() => []);
  if (by === 'position') {
    const m = Math.min(...idsList.map(a => a.length));
    for (let r = 0; r < m; r++) { blocks.push(idsList.map(() => r)); keys.push(r + 1); }
    idsList.forEach((ids, d) => { for (let r = m; r < ids.length; r++) unmatched[d].push(r); });
    return { blocks, unmatched, keys };
  }
  if (by !== 'id') throw new RangeError("matchBlocks: by must be 'id' or 'position'");
  const first = idsList.map(ids => {
    const m = new Map();
    ids.forEach((v, i) => { const key = String(v); if (!m.has(key)) m.set(key, i); });
    return m;
  });
  const used = idsList.map(ids => new Uint8Array(ids.length));
  const seen = new Set();
  idsList[0].forEach((v, i0) => {
    const key = String(v);
    if (seen.has(key)) return;
    seen.add(key);
    if (!first.every(m => m.has(key))) return;
    const row = first.map(m => m.get(key));
    blocks.push(row); keys.push(v);
    row.forEach((i, d) => { used[d][i] = 1; });
  });
  idsList.forEach((ids, d) => { for (let i = 0; i < ids.length; i++) if (!used[d][i]) unmatched[d].push(i); });
  return { blocks, unmatched, keys };
}

/**
 * Paired t procedure on d = x − y, as R's t.test(x, y, paired = TRUE).
 * x and y must already be matched and of equal length.
 * @param {number[]|Float64Array} x
 * @param {number[]|Float64Array} y
 * @param {number} level
 * @returns {{n: number, meanD: number, sdD: number, se: number, df: number, t: number,
 *   p: number, hw: number, lo: number, hi: number, diffs: Float64Array, r: number}}
 *   r is the Pearson correlation of x and y
 */
export function pairedT(x, y, level) {
  if (x.length !== y.length) throw new RangeError('pairedT: x and y must have equal length');
  const n = x.length, diffs = new Float64Array(n);
  for (let i = 0; i < n; i++) diffs[i] = x[i] - y[i];
  // Differences equal up to the subtraction's rounding have no spread.
  const meanD = mean(diffs), sdD = constantDifferences(diffs, x, y) ? 0 : Math.sqrt(variance(diffs));
  const se = sdD / Math.sqrt(n), df = n - 1;
  const t = meanD / se;
  const p = twoSidedP(t, df);
  const hw = tQuantile(1 - (1 - level) / 2, df) * se;
  return { n, meanD, sdD, se, df, t, p, hw, lo: meanD - hw, hi: meanD + hw, diffs, r: pearson(x, y) };
}

/**
 * Each group's own t interval at level 1 − α/k, which holds all k means
 * jointly with confidence at least `level` by Bonferroni's inequality.
 * @param {(number[]|Float64Array)[]} groups
 * @param {number} level
 * @returns {{k: number, perLevel: number, items: {n: number, mean: number, sd: number,
 *   se: number, df: number, hw: number, lo: number, hi: number}[]}}
 */
export function simultaneousMeans(groups, level) {
  const k = groups.length, perLevel = 1 - (1 - level) / k;
  const items = groups.map(g => {
    const n = g.length, m = mean(g), sd = Math.sqrt(variance(g)), se = sd / Math.sqrt(n), df = n - 1;
    const hw = tQuantile(1 - (1 - perLevel) / 2, df) * se;
    return { n, mean: m, sd, se, df, hw, lo: m - hw, hi: m + hw };
  });
  return { k, perLevel, items };
}

/**
 * A Bonferroni family of Welch intervals: every pair i < j (C = k(k − 1)/2),
 * or every design against a control (C = k − 1, j = control). Each interval is
 * at level 1 − α/C, a comparison is flagged when its interval excludes 0, and
 * pAdj = min(1, C·p).
 * @param {(number[]|Float64Array)[]} groups
 * @param {{mode: 'pairs'|'control', control?: number, level: number}} opts
 * @returns {{C: number, perLevel: number, comparisons: {i: number, j: number, diff: number,
 *   se: number, df: number, hw: number, lo: number, hi: number, t: number, p: number,
 *   pAdj: number, flagged: boolean}[]}}
 */
export function bonferroniFamily(groups, { mode, control = 0, level, paired = false }) {
  const k = groups.length, list = [];
  if (mode === 'control') {
    for (let i = 0; i < k; i++) if (i !== control) list.push([i, control]);
  } else {
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) list.push([i, j]);
  }
  const C = list.length, perLevel = 1 - (1 - level) / C;
  const comparisons = list.map(([i, j]) => {
    if (paired) {
      // The groups are already aligned block by block, and each pair's
      // interval is the paired t on its differences.
      const w = pairedT(groups[i], groups[j], perLevel);
      return { i, j, diff: w.meanD, se: w.se, df: w.df, hw: w.hw, lo: w.lo, hi: w.hi, t: w.t, p: w.p, r: w.r,
               pAdj: Math.min(1, C * w.p), flagged: w.lo > 0 || w.hi < 0 };
    }
    const w = welch(groups[i], groups[j], perLevel);
    return { i, j, diff: w.diff, se: w.se, df: w.df, hw: w.hw, lo: w.lo, hi: w.hi, t: w.t, p: w.p,
             pAdj: Math.min(1, C * w.p), flagged: w.lo > 0 || w.hi < 0 };
  });
  return { C, perLevel, comparisons };
}

// "No spread within the groups": a within (or residual) sum of squares at or
// below this fraction of the outcomes' uncentered sum of squares Σy² is
// rounding error, and counts as exactly 0. Values that are equal within each
// group leave a within sum of squares near 1e-31 of Σy², not 0, as long as it
// is summed directly from each value's own deviation (a sum of squares found by
// subtraction carries error near 1e-16 of Σy²); real spread of even one part
// in a billion of the values' size leaves about 1e-18.
const NO_SPREAD = 1e-24;

// F and p for a source with sum of squares ss when nothing is left within the
// groups: infinite (p = 0) when the source has some, and undefined when it too
// is rounding error against the scale `tiny`.
function fWithNoSpread(ss, tiny) {
  return ss > tiny ? { F: Infinity, p: 0 } : { F: NaN, p: NaN };
}

/**
 * True when paired differences d = x − y are equal up to the rounding of the
 * subtraction itself: max(d) − min(d) ≤ 8ε · max(|x|, |y|), ε the machine
 * epsilon. 0.1 − 0.3 and 0.2 − 0.4 differ in the last bit, though both are
 * −0.2.
 * @param {ArrayLike<number>} d the differences
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {boolean}
 */
export function constantDifferences(d, x, y) {
  if (d.length === 0) return false;
  let lo = Infinity, hi = -Infinity, big = 0;
  for (let i = 0; i < d.length; i++) {
    if (!Number.isFinite(d[i])) return false;
    if (d[i] < lo) lo = d[i];
    if (d[i] > hi) hi = d[i];
    big = Math.max(big, Math.abs(x[i]), Math.abs(y[i]));
  }
  return hi - lo <= 8 * Number.EPSILON * big;
}

function sumSq(groups) {
  let s = 0;
  for (const g of groups) for (let r = 0; r < g.length; r++) s += g[r] * g[r];
  return s;
}

/**
 * One-way analysis of variance, as R's summary(aov(y ~ g)). When the within
 * sum of squares is at most 1e-24 of the scale (no spread within any group, up
 * to rounding), it is taken as exactly 0, and F is infinite with p = 0 when the
 * between sum of squares exceeds that bound, and undefined (NaN, with the
 * between sum of squares taken as 0) when it does not; R's aov reports
 * rounding noise there. The scale is Σy² of the groups, or `scale` when given:
 * Levene's test passes the outcomes' own Σy² because the distances it
 * analyzes carry the rounding of the outcomes they came from.
 * @param {(number[]|Float64Array)[]} groups
 * @param {{scale?: number}} [opts]
 * @returns {{k: number, N: number, n: number[], means: number[], grandMean: number,
 *   ssb: number, ssw: number, sst: number, dfb: number, dfw: number, msb: number,
 *   msw: number, F: number, p: number}}
 */
export function anova(groups, { scale = null } = {}) {
  const k = groups.length;
  const n = groups.map(g => g.length);
  const means = groups.map(mean);
  const N = n.reduce((s, v) => s + v, 0);
  let total = 0;
  for (let i = 0; i < k; i++) total += means[i] * n[i];
  const grandMean = total / N;
  let ssb = 0, ssw = 0;
  for (let i = 0; i < k; i++) {
    const d = means[i] - grandMean;
    ssb += n[i] * d * d;
    const g = groups[i];
    for (let r = 0; r < g.length; r++) { const e = g[r] - means[i]; ssw += e * e; }
  }
  const dfb = k - 1, dfw = N - k;
  const tiny = NO_SPREAD * (scale == null ? sumSq(groups) : scale);
  let F, p;
  if (dfw > 0 && ssw <= tiny) {
    ssw = 0;
    if (!(ssb > tiny)) ssb = 0;
    ({ F, p } = fWithNoSpread(ssb, tiny));
  } else {
    F = (ssb / dfb) / (ssw / dfw);
    p = Number.isFinite(F) ? 1 - fCdf(F, dfb, dfw) : NaN;
  }
  const msb = ssb / dfb, msw = ssw / dfw;
  return { k, N, n, means, grandMean, ssb, ssw, sst: ssb + ssw, dfb, dfw, msb, msw, F, p };
}

/**
 * Welch's one-way analysis of variance for means under unequal variances
 * (Welch 1951), as R's oneway.test(var.equal = FALSE): each design's mean is
 * weighted by R_i / s_i², no variance is pooled, and the F statistic is
 * referred to an F distribution on k − 1 and an approximate second degrees
 * of freedom.
 * @param {ArrayLike<number>[]} groups
 * @returns {{k: number, n: number[], means: number[], vars: number[], sds: number[],
 *   grandMean: number, F: number, df1: number, df2: number, p: number}}
 */
export function welchAnova(groups) {
  const k = groups.length;
  if (k < 2) throw new RangeError('welchAnova: at least two groups are needed');
  const n = groups.map(g => g.length), means = groups.map(mean), vars = groups.map(variance);
  if (n.some(m => m < 2) || vars.some(v => !(v > 0))) throw new RangeError('welchAnova: every group needs two or more values with positive spread');
  const w = vars.map((v, i) => n[i] / v);
  const W = w.reduce((a, b) => a + b, 0);
  const grandMean = w.reduce((a, wi, i) => a + wi * means[i], 0) / W;
  const num = w.reduce((a, wi, i) => a + wi * (means[i] - grandMean) ** 2, 0) / (k - 1);
  const tmp = w.reduce((a, wi, i) => a + (1 - wi / W) ** 2 / (n[i] - 1), 0) / (k * k - 1);
  const F = num / (1 + 2 * (k - 2) * tmp);
  const df1 = k - 1, df2 = 1 / (3 * tmp);
  const p = Math.min(1, 1 - fCdf(F, df1, df2));
  return { k, n, means, vars, sds: vars.map(Math.sqrt), grandMean, F, df1, df2, p };
}

/**
 * Pairwise comparisons that let every design keep its own variance, for use
 * with Welch's analysis of variance: each pair's standard error is
 * sqrt(s_i²/R_i + s_j²/R_j) on its own Welch–Satterthwaite degrees of
 * freedom. `'gameshowell'` is the Games–Howell procedure, Tukey's rule on
 * those pairwise quantities (critical difference q · SE / √2, with q the
 * studentized range quantile for k means on the pair's degrees of freedom,
 * and p from the studentized range distribution); `'bonferroniWelch'` is
 * the Bonferroni rule on the pairs' own t intervals at level 1 − α/C.
 * @param {ArrayLike<number>[]} groups
 * @param {{rule: 'gameshowell'|'bonferroniWelch', alpha: number}} o
 * @returns {{rule: string, alpha: number, pairs: {i: number, j: number, diff: number, se: number, df: number,
 *   crit: number, hw: number, lo: number, hi: number, p: number, flagged: boolean}[],
 *   letters: string[], note: string, anova: ReturnType<typeof welchAnova>}}
 */
export function posthocWelch(groups, { rule, alpha }) {
  const a = welchAnova(groups);
  const { k, n, means, vars } = a;
  const list = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) list.push([i, j]);
  const C = list.length;
  const pct = fmtPct(1 - alpha);
  let note;
  if (rule === 'gameshowell') {
    note = C === 1 ? `The Games–Howell interval holds the one difference at about ${pct} confidence.`
      : `Games–Howell intervals hold all ${C} differences at about ${pct} simultaneous confidence, each on its own degrees of freedom.`;
  } else if (rule === 'bonferroniWelch') {
    note = C === 1 ? `With one difference, the Bonferroni interval is the plain Welch interval at ${pct}.`
      : `Bonferroni intervals at level 1 − α/${C}, each a Welch interval on its own degrees of freedom, hold all ${C} differences at ${pct} or more.`;
  } else {
    throw new RangeError(`posthocWelch: unknown rule ${rule}`);
  }
  const pairs = list.map(([i, j]) => {
    const diff = means[i] - means[j];
    const a1 = vars[i] / n[i], a2 = vars[j] / n[j];
    const se = Math.sqrt(a1 + a2);
    const df = (a1 + a2) * (a1 + a2) / (a1 * a1 / (n[i] - 1) + a2 * a2 / (n[j] - 1));
    let crit, hw, p;
    if (rule === 'gameshowell') {
      crit = qtukey(1 - alpha, k, df);
      hw = crit * Math.SQRT1_2 * se;
      p = Math.min(1, 1 - ptukey(Math.abs(diff) / (se * Math.SQRT1_2), k, df));
    } else {
      crit = tQuantile(1 - alpha / (2 * C), df);
      hw = crit * se;
      p = Math.min(1, C * twoSidedP(diff / se, df));
    }
    const lo = diff - hw, hi = diff + hw;
    return { i, j, diff, se, df, crit, hw, lo, hi, p, flagged: lo > 0 || hi < 0 };
  });
  const letters = letterGroups(k, pairs.filter(p => p.flagged).map(p => [p.i, p.j]));
  return { rule, alpha, pairs, letters, note, anova: a };
}

/**
 * Levene's test of equal variances across groups: the one-way ANOVA of the
 * absolute deviations from each group's center. Centered on the medians it is
 * Brown and Forsythe's form, which keeps its level under skewed and
 * heavy-tailed data and is R's car::leveneTest default; centered on the means
 * it is Levene's original. Unlike the F ratio of two variances, it needs no
 * normality and takes any number of groups.
 * @param {(number[]|Float64Array)[]} groups
 * @param {{center?: 'median'|'mean'}} [opts]
 * @returns {{k: number, N: number, center: string, centers: number[], F: number, df1: number, df2: number, p: number}}
 */
export function levene(groups, { center = 'median' } = {}) {
  const k = groups.length;
  const centers = groups.map(g => (center === 'mean' ? mean(g) : median(g)));
  const dev = groups.map((g, i) => Float64Array.from(g, v => Math.abs(v - centers[i])));
  // "No spread" is judged on the outcomes' scale: each distance carries the
  // rounding of the outcomes it was taken from, near ε|y| rather than ε|z|.
  const av = anova(dev, { scale: sumSq(groups) });
  return { k, N: av.N, center, centers, F: av.F, df1: av.dfb, df2: av.dfw, p: av.p };
}

/**
 * The randomized complete block analysis of variance for k designs run under
 * common random numbers, the replication being the block: groups aligned
 * block by block, all of one length R, as R's summary(aov(y ~ g + block)).
 * The fields msw and dfw hold the residual mean square and its degrees of
 * freedom, so that the post-hoc rules read a blocked table like a one-way one.
 * @param {(number[]|Float64Array)[]} groups
 * @returns {{blocked: true, k: number, R: number, N: number, n: number[], means: number[],
 *   blockMeans: number[], grandMean: number, ssb: number, ssblk: number, ssw: number, sst: number,
 *   dfb: number, dfblk: number, dfw: number, msb: number, msblk: number, msw: number,
 *   F: number, p: number, Fblock: number, pBlock: number}}
 */
export function anovaBlocked(groups) {
  const k = groups.length;
  const R = groups[0].length;
  if (!groups.every(g => g.length === R)) throw new RangeError('anovaBlocked: every design needs the same number of blocks');
  const N = k * R;
  const means = groups.map(mean);
  const blockMeans = new Array(R).fill(0);
  let total = 0;
  for (let i = 0; i < k; i++) for (let r = 0; r < R; r++) { blockMeans[r] += groups[i][r] / k; total += groups[i][r]; }
  const grandMean = total / N;
  let ssb = 0, ssblk = 0, sst = 0, ssw = 0;
  for (let i = 0; i < k; i++) { const d = means[i] - grandMean; ssb += R * d * d; }
  for (let r = 0; r < R; r++) { const d = blockMeans[r] - grandMean; ssblk += k * d * d; }
  // The residual sum of squares is summed directly from each residual
  // y − ȳ_i − ȳ_r + ȳ, not found as sst − ssb − ssblk, whose subtraction
  // leaves error near 1e-16 of the total and would hide "no spread left".
  for (let i = 0; i < k; i++) for (let r = 0; r < R; r++) {
    const e = groups[i][r] - grandMean; sst += e * e;
    const res = groups[i][r] - means[i] - blockMeans[r] + grandMean; ssw += res * res;
  }
  const dfb = k - 1, dfblk = R - 1, dfw = (k - 1) * (R - 1);
  const tiny = NO_SPREAD * sumSq(groups);
  // Nothing left once the designs and the blocks are removed: the residual
  // is rounding error, judged as in anova().
  const flat = dfw > 0 && ssw <= tiny;
  if (flat) {
    ssw = 0;
    if (!(ssb > tiny)) ssb = 0;
    if (!(ssblk > tiny)) ssblk = 0;
  }
  const msb = ssb / dfb, msblk = ssblk / dfblk, msw = ssw / dfw;
  const test = (ss, ms, d1) => {
    if (flat) return fWithNoSpread(ss, tiny);
    const f = ms / msw;
    return { F: f, p: Number.isFinite(f) ? 1 - fCdf(f, d1, dfw) : NaN };
  };
  const tD = test(ssb, msb, dfb), tB = test(ssblk, msblk, dfblk);
  return { blocked: true, k, R, N, n: groups.map(() => R), means, blockMeans, grandMean, ssb, ssblk, ssw, sst,
           dfb, dfblk, dfw, msb, msblk, msw, F: tD.F, p: tD.p, Fblock: tB.F, pBlock: tB.p };
}

/**
 * Post-hoc comparisons after one-way ANOVA, all on the pooled mean square
 * within (msw) and its dfw degrees of freedom. For every rule the reported se
 * is sqrt(msw (1/n_i + 1/n_j)), the standard error of mean_i − mean_j, and
 * hw = crit·se except for Tukey, whose crit is the studentized range q and
 * whose hw = q·se/√2.
 *
 * - 'tukey': Tukey–Kramer, q = qtukey(1 − α, k, dfw), all pairs i < j.
 * - 'lsd': Fisher's least significant difference, t_{1−α/2, dfw}, all pairs;
 *   protected by the F test, and no pair is flagged unless F rejects at α.
 * - 'bonferroni': t_{1−α/(2C), dfw} with C = k(k − 1)/2, all pairs.
 * - 'dunnett': every design i ≠ control against the control (j = control),
 *   with the two-sided critical value of Dunnett's distribution at the exact
 *   λ_i = sqrt(n_i / n_control); no letter display.
 *
 * diff = mean_i − mean_j throughout, and a pair is flagged when its interval
 * excludes 0. For the three all-pairs rules, letters is the compact letter
 * display of the flagged pairs.
 * @param {(number[]|Float64Array)[]} groups
 * @param {{rule: 'tukey'|'lsd'|'bonferroni'|'dunnett', alpha: number, control?: number}} opts
 * @returns {{rule: string, alpha: number, crit: number, msw: number, dfw: number,
 *   protected: boolean|null, pairs: {i: number, j: number, diff: number, se: number,
 *   hw: number, lo: number, hi: number, flagged: boolean}[], letters: string[]|null,
 *   note: string, anova: object}}
 */
export function posthoc(groups, { rule, alpha, control = 0, blocked = false }) {
  const a = blocked ? anovaBlocked(groups) : anova(groups);
  const { k, n, means, msw, dfw } = a;
  const list = [];
  if (rule === 'dunnett') {
    for (let i = 0; i < k; i++) if (i !== control) list.push([i, control]);
  } else {
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) list.push([i, j]);
  }
  let crit, scale = 1, prot = null, note;
  const pct = fmtPct(1 - alpha);
  if (rule === 'tukey') {
    crit = qtukey(1 - alpha, k, dfw);
    scale = Math.SQRT1_2;
    note = list.length === 1 ? `The Tukey–Kramer interval holds the one difference at ${pct} confidence.`
      : `Tukey–Kramer intervals hold all ${list.length} differences at ${pct} simultaneous confidence.`;
  } else if (rule === 'lsd') {
    crit = tQuantile(1 - alpha / 2, dfw);
    prot = a.p < alpha;
    note = prot
      ? `The F test rejected at α = ${fmtAlpha(alpha)}, and each pair is judged by its own ${pct} t interval on the pooled variance.`
      : `The F test did not reject at α = ${fmtAlpha(alpha)}; no pair is declared different.`;
  } else if (rule === 'bonferroni') {
    const C = list.length;
    crit = tQuantile(1 - alpha / (2 * C), dfw);
    note = C === 1 ? `With one difference, the Bonferroni interval on the pooled variance is the plain interval at ${pct}.`
      : `Bonferroni intervals at level 1 − α/${C} on the pooled variance hold all ${C} differences at ${pct} or more.`;
  } else if (rule === 'dunnett') {
    const lambdas = list.map(([i]) => Math.sqrt(n[i] / n[control]));
    crit = qdunnett(1 - alpha, lambdas, dfw, true);
    note = list.length === 1 ? `The Dunnett interval holds the one comparison with the control at ${pct} confidence.`
      : `Dunnett intervals hold all ${list.length} comparisons with the control at ${pct} simultaneous confidence.`;
  } else {
    throw new RangeError(`posthoc: unknown rule ${rule}`);
  }
  const pairs = list.map(([i, j]) => {
    const diff = means[i] - means[j];
    const se = Math.sqrt(msw * (1 / n[i] + 1 / n[j]));
    const hw = crit * scale * se;
    const lo = diff - hw, hi = diff + hw;
    const flagged = prot === false ? false : (lo > 0 || hi < 0);
    return { i, j, diff, se, hw, lo, hi, flagged };
  });
  const letters = rule === 'dunnett'
    ? null
    : letterGroups(k, pairs.filter(p => p.flagged).map(p => [p.i, p.j]));
  return { rule, alpha, crit, msw, dfw, protected: prot, pairs, letters, note, anova: a };
}

function fmtPct(level) {
  return `${Math.round(level * 1000) / 10}%`;
}

// α as typed, without the floating-point tail that 1 − level leaves (0.05, not
// 0.050000000000000044).
function fmtAlpha(alpha) {
  return String(Number(alpha.toPrecision(6)));
}

// Label for the g-th letter group: a–z, A–Z, and then a letter with a count.
function letterLabel(g) {
  if (g < 26) return String.fromCharCode(97 + g);
  if (g < 52) return String.fromCharCode(65 + g - 26);
  return String.fromCharCode(97 + (g % 26)) + Math.floor(g / 26);
}

// True when every member of a is in b (a and b are sorted index arrays).
function isSubset(a, b) {
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j < b.length && b[j] < a[i]) j++;
    if (j === b.length || b[j] !== a[i]) return false;
  }
  return true;
}
// Removes groups that are subsets of another, and duplicates.
function absorb(groups) {
  const keep = [];
  for (let a = 0; a < groups.length; a++) {
    let drop = false;
    for (let b = 0; b < groups.length && !drop; b++) {
      if (a === b || !isSubset(groups[a], groups[b])) continue;
      // Equal sets: keep only the first copy.
      if (groups[a].length < groups[b].length || b < a) drop = true;
    }
    if (!drop) keep.push(groups[a]);
  }
  return keep;
}

/**
 * Compact letter display by insert-and-absorb (Piepho 2004). Start with one
 * group over all k designs; for each flagged pair [i, j], replace every group
 * holding both by two copies, one without i and one without j, and absorb
 * any group that is a subset of another. The surviving groups are the maximal
 * sets of designs with no flagged pair among them. They are ordered by their
 * members (smallest member first, ties broken by the next) and labeled a, b,
 * c, …; each design's string is the concatenation of its groups' letters.
 * @param {number} k number of designs, indexed 0..k−1
 * @param {number[][]} flagged pairs [i, j] declared different
 * @returns {string[]} one string per design
 */
export function letterGroups(k, flagged) {
  let groups = [Array.from({ length: k }, (_, i) => i)];
  for (const [i, j] of flagged) {
    if (i === j) continue;
    const next = [];
    let split = false;
    for (const g of groups) {
      if (g.includes(i) && g.includes(j)) {
        next.push(g.filter(v => v !== i), g.filter(v => v !== j));
        split = true;
      } else {
        next.push(g);
      }
    }
    groups = split ? absorb(next) : next;
  }
  groups = absorb(groups).filter(g => g.length > 0);
  groups.sort((a, b) => {
    for (let t = 0; t < Math.min(a.length, b.length); t++) if (a[t] !== b[t]) return a[t] - b[t];
    return a.length - b.length;
  });
  const out = new Array(k).fill('');
  groups.forEach((g, gi) => { const lab = letterLabel(gi); for (const v of g) out[v] += lab; });
  return out;
}

// ── Replication planning for comparisons ──────────────────────────────────
// Every planner gives each design the same n replications and treats the standard
// deviations as known (pilot estimates), and returns {n: null, reason} when an input
// is out of range or the answer would exceed 10^7 replications per design.

const PLAN_CAP = 1e7;
const TOO_MANY = 'More than 10,000,000 replications per design would be needed.';

// The t quantile for planning. Past 10^6 degrees of freedom the first-order
// Cornish–Fisher expansion z + (z³ + z)/(4ν) is within a few parts in 10^12 of the
// quantile, and it stays accurate where the incomplete beta at x = ν/(ν + t²), so
// close to 1, loses digits.
function tCritical(p, df) {
  if (df <= 1e6) return tQuantile(p, df);
  const z = normInv(p);
  return z + (z * z * z + z) / (4 * df);
}

function positiveSd(s) { return Number.isFinite(s) && s > 0; }

/**
 * Welch–Satterthwaite degrees of freedom when both designs have n replications:
 * (s₁² + s₂²)² / (s₁⁴ + s₂⁴) · (n − 1), which is 2(n − 1) when s₁ = s₂.
 * @param {number} sd1
 * @param {number} sd2
 * @param {number} n replications per design
 * @returns {number}
 */
export function welchDfEqualN(sd1, sd2, n) {
  const a = sd1 * sd1, b = sd2 * sd2;
  return (a + b) * (a + b) / (a * a + b * b) * (n - 1);
}

/**
 * Replications per design for a Welch interval on the difference of two means to
 * reach a target half-width: the smallest n ≥ 2 with
 * t_{1−α/2, ν(n)} · sqrt((s₁² + s₂²)/n) ≤ target, ν(n) = welchDfEqualN(s₁, s₂, n).
 * The search starts at the normal approximation (z · sqrt(s₁² + s₂²) / target)².
 * @param {{sd1: number, sd2: number, level?: number, target: number}} o
 * @returns {{n: number|null, hwAtN: number, df: number, reason?: string}}
 */
export function planHalfWidthWelch(o) {
  return planHalfWidthTwo(o, n => welchDfEqualN(o.sd1, o.sd2, n));
}

/**
 * Replications per design for a pooled-variance t interval on the difference of
 * two means to reach a target half-width. With n replications in each design the
 * pooled variance is (s₁² + s₂²)/2, the standard error sqrt((s₁² + s₂²)/n) is
 * Welch's, and only the degrees of freedom differ: 2(n − 1).
 * @param {{sd1: number, sd2: number, level?: number, target: number}} o
 * @returns {{n: number|null, hwAtN: number, df: number, reason?: string}}
 */
export function planHalfWidthPooled(o) {
  return planHalfWidthTwo(o, n => 2 * (n - 1));
}

// The two-sample half-width plan at the degrees of freedom dfAt(n) gives.
function planHalfWidthTwo({ sd1, sd2, level = 0.95, target }, dfAt) {
  const fail = reason => ({ n: null, hwAtN: NaN, df: NaN, reason });
  if (!positiveSd(sd1) || !positiveSd(sd2)) return fail('Both standard deviations must be positive numbers.');
  if (!(target > 0) || !Number.isFinite(target)) return fail('The target half-width must be a positive number.');
  if (!(level > 0 && level < 1)) return fail('The confidence level must lie strictly between 0 and 1.');
  const p = 1 - (1 - level) / 2, v = sd1 * sd1 + sd2 * sd2;
  const hwAt = n => tCritical(p, dfAt(n)) * Math.sqrt(v / n);
  const guess = (normInv(p) * Math.sqrt(v) / target) ** 2;
  if (!(guess <= PLAN_CAP)) return fail(TOO_MANY);
  const { n } = smallestN(k => hwAt(k) <= target, guess, 2, PLAN_CAP);
  if (n === null) return fail(TOO_MANY);
  return { n, hwAtN: hwAt(n), df: dfAt(n) };
}

/**
 * Two-sided power of Welch's test of equal means when the true difference is delta
 * and both designs have n replications, on the Welch–Satterthwaite degrees of
 * freedom ν the true standard deviations imply: 1 − F(t_q; ν, δ) + F(−t_q; ν, δ),
 * where F is the noncentral t CDF, t_q = t_{1−α/2, ν}, and
 * δ = delta / sqrt((s₁² + s₂²)/n). With s₁ = s₂ this is exactly R's
 * power.t.test(type = 'two.sample', strict = TRUE); otherwise it is the usual
 * noncentral-t approximation to Welch's power.
 * @param {{n: number, sd1: number, sd2: number, delta: number, alpha: number}} o
 * @returns {number}
 */
export function powerWelch({ n, sd1, sd2, delta, alpha }) {
  return powerTwo({ n, sd1, sd2, delta, alpha }, welchDfEqualN(sd1, sd2, n));
}

/**
 * Two-sided power of the pooled-variance t test of equal means when the true
 * difference is delta and both designs have n replications, on 2(n − 1) degrees
 * of freedom with the pooled variance (s₁² + s₂²)/2: exactly R's
 * power.t.test(type = 'two.sample', strict = TRUE) at sd = sqrt((s₁² + s₂²)/2).
 * @param {{n: number, sd1: number, sd2: number, delta: number, alpha: number}} o
 * @returns {number}
 */
export function powerPooled({ n, sd1, sd2, delta, alpha }) {
  return powerTwo({ n, sd1, sd2, delta, alpha }, 2 * (n - 1));
}

// Two-sided noncentral-t power of a two-sample test on df degrees of freedom.
function powerTwo({ n, sd1, sd2, delta, alpha }, df) {
  const tq = tCritical(1 - alpha / 2, df);
  const ncp = delta / Math.sqrt((sd1 * sd1 + sd2 * sd2) / n);
  return 1 - nctCdf(tq, df, ncp) + nctCdf(-tq, df, ncp);
}

// The reason a power plan cannot be made, or null when its inputs are usable.
function powerInputProblem(sds, delta, alpha, power) {
  if (!Number.isFinite(delta) || delta === 0) return 'The difference to detect must be a nonzero number.';
  if (!sds.every(positiveSd)) return 'Every standard deviation must be a positive number.';
  if (!(power > 0 && power < 1)) return 'The target power must lie strictly between 0 and 1.';
  if (!(alpha > 0 && alpha < 1)) return 'The significance level must lie strictly between 0 and 1.';
  return null;
}

/**
 * Replications per design for Welch's test to detect a difference delta with the
 * given power: the smallest n ≥ 2 with powerWelch(n) ≥ power, searched from the
 * normal approximation (z_{1−α/2} + z_power)² (s₁² + s₂²) / delta².
 * @param {{sd1: number, sd2: number, delta: number, alpha: number, power: number}} o
 * @returns {{n: number|null, powerAtN: number, df: number, reason?: string}}
 */
export function planPowerWelch(o) {
  return planPowerTwo(o, powerWelch, n => welchDfEqualN(o.sd1, o.sd2, n));
}

/**
 * Replications per design for the pooled-variance t test to detect a difference
 * delta with the given power: the smallest n ≥ 2 with powerPooled(n) ≥ power.
 * @param {{sd1: number, sd2: number, delta: number, alpha: number, power: number}} o
 * @returns {{n: number|null, powerAtN: number, df: number, reason?: string}}
 */
export function planPowerPooled(o) {
  return planPowerTwo(o, powerPooled, n => 2 * (n - 1));
}

// The two-sample power plan for the test whose power function is powerFn.
function planPowerTwo({ sd1, sd2, delta, alpha, power }, powerFn, dfAt) {
  const fail = reason => ({ n: null, powerAtN: NaN, df: NaN, reason });
  const bad = powerInputProblem([sd1, sd2], delta, alpha, power);
  if (bad) return fail(bad);
  const guess = (normInv(1 - alpha / 2) + normInv(power)) ** 2 * (sd1 * sd1 + sd2 * sd2) / (delta * delta);
  if (!(guess <= PLAN_CAP)) return fail(TOO_MANY);
  const at = n => powerFn({ n, sd1, sd2, delta, alpha });
  const { n } = smallestN(k => at(k) >= power, guess, 2, PLAN_CAP);
  if (n === null) return fail(TOO_MANY);
  return { n, powerAtN: at(n), df: dfAt(n) };
}

/**
 * Replications per design for a Bonferroni family of Welch intervals (as
 * bonferroniFamily makes them: every pair, C = k(k − 1)/2, or every design against a
 * control, C = k − 1) to reach a target half-width on every comparison. A comparison
 * (i, j) has half-width t_{1−α/(2C), ν} · sqrt((s_i² + s_j²)/n) with
 * ν = welchDfEqualN(s_i, s_j, n), and n is the smallest n ≥ 2 at which the widest
 * comparison meets the target. The widest is usually the pair with the largest
 * s_i² + s_j², but a pair with a slightly smaller sum and very unequal standard
 * deviations has fewer degrees of freedom and can be wider at small n, and so every
 * comparison is checked.
 * @param {{sds: number[], level?: number, mode: 'pairs'|'control', control?: number,
 *   target: number}} o
 * @returns {{n: number|null, hwAtN: number, pair: number[], C: number, reason?: string}}
 *   pair = [i, j] is the comparison that is widest at n (j = control in control mode)
 */
export function planHalfWidthBonferroni({ sds, level = 0.95, mode, control = 0, target }) {
  const k = Array.isArray(sds) ? sds.length : 0;
  const fail = (reason, C = NaN) => ({ n: null, hwAtN: NaN, pair: [], C, reason });
  if (k < 2) return fail('At least two designs are needed.');
  if (!sds.every(positiveSd)) return fail('Every standard deviation must be a positive number.');
  if (!(target > 0) || !Number.isFinite(target)) return fail('The target half-width must be a positive number.');
  if (!(level > 0 && level < 1)) return fail('The confidence level must lie strictly between 0 and 1.');
  const list = [];
  if (mode === 'control') {
    if (!(Number.isInteger(control) && control >= 0 && control < k)) return fail('The control must be one of the designs.');
    for (let i = 0; i < k; i++) if (i !== control) list.push([i, control]);
  } else {
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) list.push([i, j]);
  }
  const C = list.length, p = 1 - (1 - level) / (2 * C);
  const hwOf = ([i, j], n) => {
    const v = sds[i] * sds[i] + sds[j] * sds[j];
    return tCritical(p, welchDfEqualN(sds[i], sds[j], n)) * Math.sqrt(v / n);
  };
  const widest = n => {
    let best = list[0], hw = hwOf(list[0], n);
    for (let c = 1; c < C; c++) {
      const h = hwOf(list[c], n);
      if (h > hw) { hw = h; best = list[c]; }
    }
    return { pair: best, hw };
  };
  let vmax = 0;
  for (const [i, j] of list) vmax = Math.max(vmax, sds[i] * sds[i] + sds[j] * sds[j]);
  const guess = (normInv(p) * Math.sqrt(vmax) / target) ** 2;
  if (!(guess <= PLAN_CAP)) return fail(TOO_MANY, C);
  const { n } = smallestN(m => widest(m).hw <= target, guess, 2, PLAN_CAP);
  if (n === null) return fail(TOO_MANY, C);
  const w = widest(n);
  return { n, hwAtN: w.hw, pair: w.pair.slice(), C };
}

/**
 * Power of the one-way ANOVA F test at level alpha when one of k designs is shifted
 * by delta and the other k − 1 share a mean, all with standard deviation sigma and n
 * replications each. The noncentrality is λ = n Σ(μ_i − μ̄)²/σ², and for one design
 * shifted by delta Σ(μ_i − μ̄)² = delta² (k − 1)/k, and so λ = n delta² (k − 1)/(k σ²);
 * power = 1 − F(F_{1−α; k−1, k(n−1)}; k − 1, k(n − 1), λ) with F the noncentral F CDF.
 * @param {{n: number, k: number, sigma: number, delta: number, alpha: number}} o
 * @returns {number}
 */
export function powerAnova({ n, k, sigma, delta, alpha, blocked = false }) {
  // With the replication as a block the residual loses the block's degrees
  // of freedom, and sigma is the residual standard deviation.
  const d1 = k - 1, d2 = blocked ? (k - 1) * (n - 1) : k * (n - 1);
  const lambda = n * delta * delta * (k - 1) / (k * sigma * sigma);
  return 1 - ncfCdf(fQuantile(1 - alpha, d1, d2), d1, d2, lambda);
}

/**
 * Replications per design for the one-way ANOVA F test to detect one of k designs
 * shifted by delta with the given power: the smallest n ≥ 2 with powerAnova(n) ≥ power.
 * The search starts from the two-design normal approximation
 * (z_{1−α/2} + z_power)² σ² k / ((k − 1) delta²), which is exact in its limit for k = 2
 * and low for more designs, where the search moves up from it.
 * @param {{k: number, sigma: number, delta: number, alpha: number, power: number}} o
 * @returns {{n: number|null, powerAtN: number, lambda: number, reason?: string}}
 */
export function planPowerAnova({ k, sigma, delta, alpha, power, blocked = false }) {
  const fail = reason => ({ n: null, powerAtN: NaN, lambda: NaN, reason });
  if (!(Number.isInteger(k) && k >= 2)) return fail('At least two designs are needed.');
  const bad = powerInputProblem([sigma], delta, alpha, power);
  if (bad) return fail(bad);
  const guess = (normInv(1 - alpha / 2) + normInv(power)) ** 2 * sigma * sigma * k / ((k - 1) * delta * delta);
  if (!(guess <= PLAN_CAP)) return fail(TOO_MANY);
  const at = n => powerAnova({ n, k, sigma, delta, alpha, blocked });
  const { n } = smallestN(m => at(m) >= power, guess, 2, PLAN_CAP);
  if (n === null) return fail(TOO_MANY);
  return { n, powerAtN: at(n), lambda: n * delta * delta * (k - 1) / (k * sigma * sigma) };
}
