// Selecting the best design: a subset-selection screen with an indifference
// zone δ, and the replication counts a Rinott second stage would need to pick
// the best among the survivors. Pure functions, no DOM.

import { tQuantile, rinottH } from './special.js';

function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}
function variance(a) {
  const n = a.length, m = mean(a);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - m; s += d * d; }
  return s / (n - 1);
}

function refusal(reason, k) {
  return { ok: false, reason, k, n: null, means: null, s2: null, alpha0: null, alpha1: null,
           t: null, W: null, cutoff: null, survivors: null, best: null, h: null, N: null, additional: null,
           note: reason };
}

/**
 * Subset selection with indifference zone δ at confidence 1 − α, split evenly
 * between the screen (α₀ = α/2) and the second-stage sizing (α₁ = α/2).
 *
 * The screen uses t = t_{(1 − α₀)^(1/(k−1)), n₀−1} with n₀ = min n_i and
 * W_ij = t·sqrt(s²_i/n_i + s²_j/n_j). Under dir 'max', design i survives when
 * mean_i ≥ mean_j − max(0, W_ij − δ) for every j ≠ i; under 'min', when
 * mean_i ≤ mean_j + max(0, W_ij − δ). With h = rinottH(n₀, k, 1 − α₁), a
 * survivor needs N_i = max(n_i, ceil((h·s_i/δ)²)) replications in all, and
 * additional = N_i − n_i; both are null for an eliminated design.
 *
 * With fewer than two designs, a design with fewer than two replications, or
 * δ ≤ 0, the result has ok: false, a reason, and every computed field null.
 * @param {(number[]|Float64Array)[]} groups replication estimates per design
 * @param {{alpha: number, delta: number, dir: 'max'|'min'}} opts
 * @returns {{ok: boolean, reason?: string, k: number, n: number[], means: number[],
 *   s2: number[], alpha0: number, alpha1: number, t: number, W: number[][],
 *   survivors: boolean[], best: number, h: number, N: (number|null)[],
 *   additional: (number|null)[], note: string}}
 *   best is the index of the best sample mean under dir; W has a zero diagonal
 */
export function subsetSelection(groups, { alpha, delta, dir }) {
  const k = groups.length;
  if (k < 2) return refusal('Subset selection needs at least two designs.', k);
  if (!(delta > 0)) return refusal('The indifference zone δ must be positive.', k);
  const n = groups.map(g => g.length);
  const n0 = Math.min(...n);
  if (n0 < 2) return refusal('Every design needs at least two replications.', k);
  const means = groups.map(mean);
  const s2 = groups.map(variance);
  const alpha0 = alpha / 2, alpha1 = alpha / 2;
  const t = tQuantile(Math.pow(1 - alpha0, 1 / (k - 1)), n0 - 1);
  const W = [];
  for (let i = 0; i < k; i++) {
    const row = new Array(k);
    for (let j = 0; j < k; j++) row[j] = i === j ? 0 : t * Math.sqrt(s2[i] / n[i] + s2[j] / n[j]);
    W.push(row);
  }
  const better = dir === 'min' ? (a, b) => a < b : (a, b) => a > b;
  let best = 0;
  for (let i = 1; i < k; i++) if (better(means[i], means[best])) best = i;
  // The cutoff is the value a design's mean had to reach to survive: the
  // tightest of the other designs' means less their allowances max(0, W − δ)
  // (or plus them, when smaller is better).
  const survivors = new Array(k), cutoff = new Array(k);
  for (let i = 0; i < k; i++) {
    let c = dir === 'min' ? Infinity : -Infinity;
    for (let j = 0; j < k; j++) {
      if (j === i) continue;
      const slack = Math.max(0, W[i][j] - delta);
      c = dir === 'min' ? Math.min(c, means[j] + slack) : Math.max(c, means[j] - slack);
    }
    cutoff[i] = c;
    survivors[i] = dir === 'min' ? means[i] <= c : means[i] >= c;
  }
  const h = rinottH(n0, k, 1 - alpha1);
  const N = new Array(k), additional = new Array(k);
  for (let i = 0; i < k; i++) {
    if (!survivors[i]) { N[i] = null; additional[i] = null; continue; }
    const need = Math.ceil(Math.pow(h * Math.sqrt(s2[i]) / delta, 2));
    N[i] = Math.max(n[i], need);
    additional[i] = N[i] - n[i];
  }
  const count = survivors.filter(Boolean).length;
  const pct = `${Math.round((1 - alpha) * 1000) / 10}%`;
  const note = count === 1
    ? `One design survives the screen, and it is the best within δ = ${delta} at ${pct} confidence.`
    : `${count} designs survive the screen: none of them can be ruled out as the best within δ = ${delta}. ` +
      `A second stage that brings each survivor to N replications selects the best at ${pct} confidence.`;
  return { ok: true, k, n, means, s2, alpha0, alpha1, t, W, cutoff, survivors, best, h, N, additional, note };
}
