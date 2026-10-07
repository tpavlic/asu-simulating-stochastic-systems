// Recipes for the "Regenerate these results in" scripts: one pure builder per
// page, taking the inputs the page computed with, running the same js/stats
// functions the page ran, and returning a plain object the writers in
// analysis_scripts.js turn into a script. A recipe carries the data, every
// choice, and `expect`, the analyzer's own value under each report name, so
// that the script can print its value beside the analyzer's and the tests can
// compare them.
//
// A page does not build its recipe when it computes: it registers
// `regen: { build: () => recipe, tooBig }` with its result, and the export
// row calls build() only when a script is asked for.

import { repEstimates, repIds } from '../data/model.js';
import { summary } from '../stats/descriptive.js';
import { tInterval, varianceInterval, planReplications, powerOneSample, planPowerOneSample, fRatio } from '../stats/intervals.js';
import { signedRank, rankSum } from '../stats/nonparam.js';
import { shapiroWilk } from '../stats/normality.js';
import { welch, pooledT, pairedT, levene, planHalfWidthWelch, planHalfWidthPooled, powerWelch, powerPooled,
         planPowerWelch, planPowerPooled, simultaneousMeans, bonferroniFamily, planHalfWidthBonferroni } from '../stats/compare.js';
import { bonferroniFamilyRank } from '../stats/nonparam.js';

/** The sentence that says how a replication outcome was formed, per kind. */
export const OUTCOME_HOW = {
  tally: 'the mean of the replication\'s observations',
  time: 'the time-weighted mean of the replication\'s state (each value counted for the time it held)',
  reps: 'the replication\'s single reported value'
};

/**
 * A page's recipe before its sections: the title, the provenance the page
 * registers (copied), the per-interval level, alpha, and an empty expect map.
 * @param {{page: string, title: string, provenance: object, level: number}} o
 */
export function baseRecipe({ page, title, provenance, level }) {
  return { page, title, provenance: Object.assign({}, provenance), level, alpha: 1 - level, expect: {} };
}

/**
 * The finite replication outcomes of a dataset with their ids, the ids that
 * gave none, and the sentence saying how each outcome was formed.
 * @param {import('../data/model.js').Dataset} ds
 * @returns {{ids: (string|number)[], values: number[], dropped: (string|number)[], how: string}}
 */
export function outcomeVector(ds) {
  const est = repEstimates(ds), ids = repIds(ds);
  const values = [], kept = [], dropped = [];
  for (let i = 0; i < est.length; i++) {
    if (Number.isFinite(est[i])) { values.push(est[i]); kept.push(ids[i]); } else dropped.push(ids[i]);
  }
  return { ids: kept, values, dropped, how: OUTCOME_HOW[ds.kind] || OUTCOME_HOW.tally };
}

/**
 * A value for an expect map: a number as it is (NaN and +/-Infinity pass
 * through), a boolean as 1 or 0, and anything else unchanged.
 * @param {*} v
 */
export function ex(v) { return typeof v === 'number' ? v : (v === true ? 1 : v === false ? 0 : v); }


// ── Shared pieces ────────────────────────────────────────────────────────

/** Whether the Shapiro-Wilk check can run on these values (the rule js/ui/checks.js applies). */
export function shapiroOk(v) {
  return v.length >= 3 && v.length <= 5000 && Math.min(...v) < Math.max(...v);
}

/** The Shapiro-Wilk expect entries for one set, under a key prefix; nothing when the check cannot run. */
export function shapiroExpect(prefix, v) {
  if (!shapiroOk(v)) return {};
  const sw = shapiroWilk(v);
  return { [prefix + 'W [optional]']: sw.W, [prefix + 'p [optional]']: sw.p };
}

/**
 * The planning entries by half-width and by power for one standard deviation,
 * added to `expect`. `plan.h` is the absolute half-width target, used unless
 * `plan.relative`, when the target is `plan.rel` percent of |mean|. Under a
 * rank procedure (`np`) the counts are also given inflated by pi/3.
 * @returns {{h: number}} the resolved half-width target
 */
export function planExpect(expect, { sd, mean, level, plan, R, np, prefix = 'plan ' }) {
  const alpha = 1 - level;
  const hp = planReplications({ sd, level, target: plan.relative ? plan.rel / 100 : plan.h, relative: plan.relative, mean });
  const pp = planPowerOneSample({ sd, delta: plan.delta, alpha, power: plan.power });
  const inflate = n => (n == null ? NaN : np ? Math.ceil(n * Math.PI / 3) : n);
  Object.assign(expect, {
    [prefix + 'half-width target']: hp.h,
    [prefix + 'n for half-width']: hp.n == null ? NaN : hp.n,
    [prefix + 'half-width at n']: hp.hwAtN,
    [prefix + 'delta']: plan.delta,
    [prefix + 'power target']: plan.power,
    [prefix + 'n for power']: pp.n == null ? NaN : pp.n,
    [prefix + 'power at n']: pp.powerAtN,
    'power at current R': sd > 0 && plan.delta > 0 ? powerOneSample({ n: R, sd, delta: plan.delta, alpha }) : NaN
  });
  if (np) {
    expect[prefix + 'n for half-width (rank)'] = inflate(hp.n);
    expect[prefix + 'n for power (rank)'] = inflate(pp.n);
  }
  return { h: hp.h };
}

// ── One System ───────────────────────────────────────────────────────────

/**
 * The One System recipe.
 * @param {{ ds: object, x: ArrayLike<number>, ids: (string|number)[]|null, pooled: boolean, proc: 't'|'np',
 *   level: number, base?: number, title?: string, provenance?: object,
 *   plan: null|{ relative: boolean, rel: number, abs: number|null, delta: number, power: number } }} o
 *   `x` is what the page analyzed (the finite replication outcomes, or the
 *   pooled observations under the override) and `ids` the ids in step with it
 *   (null when pooled). `title` and `provenance` are the page's own, copied
 *   into the recipe. `base` is the stated level the checks line judges by; it
 *   changes the line's verdict but not W or p, and so the recipe does not
 *   need it. `plan` is the planning card's settings, or null while planning
 *   is off. With fewer than two values only the descriptives are formed.
 */
export function oneRecipe({ ds, x, ids, pooled, proc, level, title, provenance, plan }) {
  const xs = Array.from(x);
  const np = proc === 'np' && !pooled;
  const o = outcomeVector(ds);
  const r = baseRecipe({
    page: 'one',
    title: title || (np ? 'Interval on the pseudo-median: ' : 'Interval on the mean: ') + ds.name,
    provenance: provenance || {},
    level
  });
  r.data = { name: ds.name, response: ds.response, unit: ds.unit, ids: pooled ? null : ids, values: xs,
             dropped: pooled ? [] : o.dropped, how: o.how, pooled };
  const s = summary(xs);
  const e = r.expect;
  Object.assign(e, { n: s.n, mean: s.mean, sd: s.sd, se: s.se, min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max });
  const interval = s.n >= 2;
  if (interval && np) {
    const sr = signedRank(xs, { level });
    Object.assign(e, { 'pseudo-median': sr.estimate, V: sr.V, 'signed-rank p': sr.p, exact: ex(sr.exact),
                       'wilcoxon lower': sr.lo, 'wilcoxon upper': sr.hi });
    if (sr.exact) e['achieved level'] = sr.achieved;
  } else if (interval) {
    const ti = tInterval(xs, level);
    Object.assign(e, { df: ti.df, 't quantile': ti.t, 'half-width': ti.hw, lower: ti.lo, upper: ti.hi });
  }
  const checks = interval && !pooled && !np && shapiroOk(xs);
  if (checks) Object.assign(e, shapiroExpect('shapiro ', xs));
  const variance = interval && !pooled;
  if (variance) {
    const vi = varianceInterval(xs, level);
    Object.assign(e, { s2: vi.s2, 'chi2 lower quantile': vi.chiLo, 'chi2 upper quantile': vi.chiHi,
                       'variance lower': vi.lo2, 'variance upper': vi.hi2, 'sd lower': vi.loS, 'sd upper': vi.hiS });
  }
  let planOut = null;
  if (plan && interval && !pooled) {
    const { h } = planExpect(e, { sd: s.sd, mean: s.mean, level, R: s.n, np,
      plan: { h: plan.abs, relative: plan.relative, rel: plan.rel, delta: plan.delta, power: plan.power } });
    planOut = { h, relative: plan.relative, rel: plan.rel, delta: plan.delta, power: plan.power, R: s.n };
  }
  r.one = { pooled, np, interval, variance, checks, plan: planOut };
  r.settings = planOut ? { plan_h: planOut.h, plan_delta: planOut.delta, plan_power: planOut.power } : {};
  return r;
}

// ── Two Systems ──────────────────────────────────────────────────────────

/** A data block for one design, from the page's {v, ids, dropped}. */
function designBlock(ds, e) {
  return { name: ds.name, response: ds.response, unit: ds.unit, ids: e.ids, values: Array.from(e.v),
           dropped: e.dropped, how: OUTCOME_HOW[ds.kind] || OUTCOME_HOW.tally };
}

/**
 * The Two Systems recipe, independent or paired replications.
 * @param {{ dsA: object, dsB: object, eA: {v: ArrayLike<number>, ids: any[], dropped: any[]}, eB: object,
 *   mode: 'independent'|'paired', proc: 't'|'pooled'|'np', level: number, base?: number, title?: string,
 *   provenance?: object, plan: null|{ h: number, delta: number, power: number },
 *   match?: { by: 'id'|'position', pairs: number[][], unmatchedA: number[], unmatchedB: number[] } }} o
 *   `eA` and `eB` are the finite replication outcomes of each design with their
 *   ids and the ids that gave none, as the page forms them. `title` and
 *   `provenance` are the page's own, copied into the recipe. `base` is the
 *   stated level the checks line judges by; it changes the line's verdict but
 *   not W or p, and so the recipe does not need it. `plan` is the planning
 *   card's resolved target half-width, difference to detect, and target power,
 *   or null when the page has no plan to show. Under the rank procedure the
 *   page plans with Welch's t and inflates the counts by pi/3, as here.
 */
export function twoRecipe(o) {
  if (o.mode === 'paired') return twoPairedRecipe(o);
  if (o.mode && o.mode !== 'independent') throw new RangeError('twoRecipe: unknown mode ' + o.mode);
  const { dsA, dsB, eA, eB, proc, level, plan } = o;
  const a = Array.from(eA.v), b = Array.from(eB.v);
  const np = proc === 'np', pooled = proc === 'pooled';
  const alpha = 1 - level;
  const w = pooled ? pooledT(a, b, level) : welch(a, b, level);
  const tName = pooled ? 'Pooled-variance t' : 'Welch';
  const r = baseRecipe({
    page: 'two',
    title: o.title || 'Two Systems: ' + (np ? 'Wilcoxon rank-sum' : tName) + ' comparison',
    provenance: o.provenance || {},
    level
  });
  r.dataA = designBlock(dsA, eA);
  r.dataB = designBlock(dsB, eB);
  const e = r.expect;
  Object.assign(e, { R_A: w.n1, R_B: w.n2, 'mean A': w.mean1, 'mean B': w.mean2, 'sd A': w.sd1, 'sd B': w.sd2 });
  // Levene's test joins the checks line under the pooled t only, and only when
  // each design has two outcomes; a test with no spread to compare reports none.
  const leveneOn = !np && pooled && a.length >= 2 && b.length >= 2;
  if (np) {
    const rs = rankSum(a, b, { level });
    Object.assign(e, { 'median A': summary(a).median, 'median B': summary(b).median, shift: rs.estimate, W: rs.W,
                       'rank-sum p': rs.p, exact: ex(rs.exact), 'shift lower': rs.lo, 'shift upper': rs.hi });
    if (rs.exact) e['achieved level'] = rs.achieved;
  } else {
    Object.assign(e, { difference: w.diff });
    if (pooled) e['pooled sd'] = w.sp;
    Object.assign(e, { se: w.se, df: w.df, t: w.t, p: w.p, lower: w.lo, upper: w.hi, 'half-width': w.hw });
    if (leveneOn) {
      const lv = levene([a, b]);
      if (Number.isFinite(lv.p)) Object.assign(e, { 'levene F': lv.F, 'levene p': lv.p });
    }
  }
  // The Shapiro-Wilk check of each design shows under every procedure: on the
  // comparison's checks line for the t procedures, and on the F ratio's always.
  Object.assign(e, shapiroExpect('shapiro A ', a), shapiroExpect('shapiro B ', b));
  const fratio = a.length >= 2 && b.length >= 2;
  if (fratio) {
    const fr = fRatio(a, b, level);
    Object.assign(e, { F: fr.F, 'F df1': fr.df1, 'F df2': fr.df2, 'F p': fr.p, 'F lower': fr.lo, 'F upper': fr.hi });
  }
  let planOut = null;
  if (plan) {
    const hp = (pooled ? planHalfWidthPooled : planHalfWidthWelch)({ sd1: w.sd1, sd2: w.sd2, level, target: plan.h });
    const pp = (pooled ? planPowerPooled : planPowerWelch)({ sd1: w.sd1, sd2: w.sd2, delta: plan.delta, alpha, power: plan.power });
    // The power the current replications give is taken at the smaller of the two counts.
    const Rlo = Math.min(w.n1, w.n2);
    const cur = w.sd1 > 0 && w.sd2 > 0 ? (pooled ? powerPooled : powerWelch)({ n: Rlo, sd1: w.sd1, sd2: w.sd2, delta: plan.delta, alpha }) : NaN;
    const inflate = n => (n == null ? NaN : Math.ceil(n * Math.PI / 3));
    Object.assign(e, {
      'plan half-width target': plan.h,
      'plan n per design for half-width': hp.n == null ? NaN : hp.n,
      'plan half-width at n': hp.hwAtN,
      'plan delta': plan.delta,
      'plan power target': plan.power,
      'plan n per design for power': pp.n == null ? NaN : pp.n,
      'plan power at n': pp.powerAtN,
      'power at current R': cur
    });
    if (np) {
      e['plan n per design for half-width (rank)'] = inflate(hp.n);
      e['plan n per design for power (rank)'] = inflate(pp.n);
    }
    planOut = { h: plan.h, delta: plan.delta, power: plan.power, Rlo };
  }
  r.two = { mode: 'independent', np, pooled, fratio, checks: !np, levene: leveneOn, plan: planOut };
  r.settings = planOut ? { plan_h: plan.h, plan_delta: plan.delta, plan_power: plan.power } : {};
  return r;
}

/**
 * The Two Systems recipe, paired replications (twoRecipe with mode 'paired').
 * `match` is what matchPairs(eA.ids, eB.ids, by) returned, with `by`: the
 * matched index pairs and the indices of the replications left without a
 * partner. The pooled t has no paired form, and so `proc` 'pooled' reads as
 * the paired t, as on the page. Under the paired t the page plans with the
 * one-sample t on the differences; under the signed-rank procedure, with the
 * same plan inflated by pi/3.
 */
function twoPairedRecipe(o) {
  const { dsA, dsB, eA, eB, match, proc, level, plan } = o;
  const np = proc === 'np';
  const x = Array.from(match.pairs, ([i]) => eA.v[i]), y = Array.from(match.pairs, ([, j]) => eB.v[j]);
  const ids = match.pairs.map(([i, j]) => (match.by === 'id' ? String(eA.ids[i]) : String(eA.ids[i]) + '/' + String(eB.ids[j])));
  const pr = pairedT(x, y, level);
  const r = baseRecipe({
    page: 'two',
    title: o.title || (np ? 'Two Systems: Wilcoxon signed-rank paired comparison' : 'Two Systems: paired comparison'),
    provenance: o.provenance || {},
    level
  });
  r.pairs = {
    ids, a: x, b: y, by: match.by,
    unmatchedA: match.unmatchedA.map(i => String(eA.ids[i])), unmatchedB: match.unmatchedB.map(j => String(eB.ids[j])),
    droppedA: (eA.dropped || []).map(String), droppedB: (eB.dropped || []).map(String),
    nameA: dsA.name, nameB: dsB.name, response: dsA.response, unit: dsA.unit,
    howA: OUTCOME_HOW[dsA.kind] || OUTCOME_HOW.tally, howB: OUTCOME_HOW[dsB.kind] || OUTCOME_HOW.tally
  };
  const e = r.expect;
  e.pairs = pr.n;
  const diffs = Array.from(pr.diffs);
  if (np) {
    const sr = signedRank(diffs, { level });
    Object.assign(e, { 'pseudo-median of differences': sr.estimate, V: sr.V, 'zero differences dropped': sr.zeros,
                       'signed-rank p': sr.p, exact: ex(sr.exact), 'wilcoxon lower': sr.lo, 'wilcoxon upper': sr.hi });
    if (sr.exact) e['achieved level'] = sr.achieved;
  } else {
    Object.assign(e, { 'mean difference': pr.meanD, 'sd of differences': pr.sdD, se: pr.se, df: pr.df, t: pr.t, p: pr.p,
                       lower: pr.lo, upper: pr.hi, 'half-width': pr.hw });
  }
  e.r = pr.r;
  // The paired t's checks line tests the differences for normality; the
  // signed-rank procedure carries no checks line.
  if (!np) Object.assign(e, shapiroExpect('shapiro differences ', diffs));
  let planOut = null;
  if (plan) {
    planExpect(e, { sd: pr.sdD, mean: pr.meanD, level, R: pr.n, np,
      plan: { h: plan.h, relative: false, rel: 0, delta: plan.delta, power: plan.power } });
    // The page takes the power at the current pairs whenever s_D is positive,
    // whatever the sign of delta (the two-sided power is symmetric in it).
    e['power at current R'] = pr.sdD > 0 ? powerOneSample({ n: pr.n, sd: pr.sdD, delta: plan.delta, alpha: 1 - level }) : NaN;
    planOut = { h: plan.h, delta: plan.delta, power: plan.power, R: pr.n };
  }
  r.two = { mode: 'paired', np, checks: !np, plan: planOut };
  r.settings = planOut ? { plan_h: plan.h, plan_delta: plan.delta, plan_power: plan.power } : {};
  return r;
}

// ── Several Systems ──────────────────────────────────────────────────────

/** "i-j" with 1-based design numbers, as the page numbers a pair in its report names. */
export const pairLabel = (i, j) => (i + 1) + '-' + (j + 1);

// Where an interval stands against the benchmark, in the word the page's
// table uses: above it, below it, or containing it (an end that is not a
// number never declares a side).
const benchWord = (lo, hi, bench) => (lo > bench ? 'above' : hi < bench ? 'below' : 'contains');

/**
 * The Several Systems recipe: the designs' outcomes, the means (or
 * pseudo-medians) with simultaneous intervals, the Bonferroni family of
 * differences (or of rank shifts), and the replication plans for both. The
 * analysis of variance, the rank tests, and the screen for the best fill
 * `several.anova`, `several.rank`, and `several.subset`.
 * @param {{ list: object[], groups: ArrayLike<number>[], paired: boolean,
 *   match: null|{ by: 'id'|'position', blocks: number[][], unmatched: number[][], keys: any[] },
 *   level: number, proc: 't'|'np', varMode: 'pooled'|'welch', rule: string, ruleW: string,
 *   adjust: 'bonferroni'|'holm', diffMode: 'pairs'|'control', ctrlIdx: number, dir: 'min'|'max',
 *   bench: number|null, eps: number, plan: { meansH: number, diffsH: number, delta: number, power: number },
 *   title?: string, provenance?: object }} o
 *   `list` is the checked datasets in order and `groups` the outcomes the page
 *   computed on: each design's finite replication outcomes, or under pairing
 *   the outcomes aligned block by block by `match` (matchBlocks's result with
 *   `by`). `level` is the stated level (state.settings.base), which the page
 *   divides by its own family sizes. `bench` is the benchmark, or null when
 *   it is off. `plan` is the planning cards' targets. `title` and
 *   `provenance` are the page's own, copied into the recipe. A pure function
 *   of its argument, and so a page can call it lazily.
 */
export function severalRecipe(o) {
  const { list, groups, paired, match, level, proc, diffMode, ctrlIdx, dir, eps, plan } = o;
  const k = list.length, alpha = 1 - level, np = proc === 'np';
  const bench = o.bench != null && Number.isFinite(o.bench) ? o.bench : null;
  const g = groups.map(x => Array.from(x));
  const r = baseRecipe({ page: 'several', title: o.title || 'Several Systems', provenance: o.provenance || {}, level });
  // The data: the outcomes the page compared, with the ids they came from and
  // the replications left out (no outcome, or under pairing no partner in
  // every design).
  const ovs = list.map(outcomeVector);
  const responses = Array.from(new Set(list.map(d => d.response)));
  const units = Array.from(new Set(list.map(d => d.unit || '')));
  let ids;
  if (paired) {
    // A block matched by id is named by that id; one matched by position, by
    // the ids of its replications in every design.
    ids = match.blocks.map((blk, b) => (match.by === 'id' ? String(match.keys[b]) : blk.map((x, d) => String(ovs[d].ids[x])).join('/')));
  } else ids = ovs.map(ov => ov.ids.map(String));
  r.groups = {
    names: list.map(d => d.name), response: responses.join(', '), unit: units.length === 1 ? units[0] : '',
    values: g, paired, by: paired ? match.by : null, ids,
    dropped: ovs.map(ov => ov.dropped.map(String)),
    unmatched: paired ? match.unmatched.map((u, d) => u.map(x => String(ovs[d].ids[x]))) : list.map(() => []),
    how: list.map(d => OUTCOME_HOW[d.kind] || OUTCOME_HOW.tally)
  };
  const e = r.expect;
  e.k = k;

  // Means (or pseudo-medians) with simultaneous intervals, each at 1 - alpha/k.
  const sm = simultaneousMeans(g, level);
  e['per-interval level'] = sm.perLevel;
  if (np) {
    g.forEach((x, i) => {
      const sr = signedRank(x, { level: sm.perLevel }), d = 'design ' + (i + 1) + ' ';
      Object.assign(e, { [d + 'R']: x.length, [d + 'pseudo-median']: sr.estimate, [d + 'wilcoxon lower']: sr.lo,
                         [d + 'wilcoxon upper']: sr.hi, [d + 'exact']: ex(sr.exact) });
      if (bench != null) e[d + 'vs benchmark'] = benchWord(sr.lo, sr.hi, bench);
    });
  } else {
    sm.items.forEach((it, i) => {
      const d = 'design ' + (i + 1) + ' ';
      Object.assign(e, { [d + 'R']: it.n, [d + 'mean']: it.mean, [d + 'sd']: it.sd, [d + 'se']: it.se, [d + 'df']: it.df,
                         [d + 'lower']: it.lo, [d + 'upper']: it.hi });
      if (bench != null) e[d + 'vs benchmark'] = benchWord(it.lo, it.hi, bench);
    });
    // The checks line under the means tests each design's outcomes.
    g.forEach((x, i) => Object.assign(e, shapiroExpect('shapiro design ' + (i + 1) + ' ', x)));
  }

  // The Bonferroni family of differences (or of rank shifts), each at 1 - alpha/C.
  const fam = bonferroniFamily(g, { mode: diffMode, control: ctrlIdx, level, paired });
  e.C = fam.C;
  e['per-comparison level'] = fam.perLevel;
  if (np) {
    const famR = bonferroniFamilyRank(g, { mode: diffMode, control: ctrlIdx, level, paired });
    for (const c of famR.comparisons) {
      const p = 'shift ' + pairLabel(c.i, c.j);
      Object.assign(e, { [p]: c.diff, [p + ' stat']: c.stat, [p + ' lower']: c.lo, [p + ' upper']: c.hi, [p + ' p']: c.p,
                         [p + ' adjusted p']: c.pAdj, [p + ' exact']: ex(c.exact), [p + ' excludes 0']: ex(c.flagged) });
    }
  } else {
    for (const c of fam.comparisons) {
      const p = 'diff ' + pairLabel(c.i, c.j);
      Object.assign(e, { [p]: c.diff, [p + ' se']: c.se, [p + ' df']: c.df, [p + ' lower']: c.lo, [p + ' upper']: c.hi, [p + ' t']: c.t,
                         [p + ' p']: c.p, [p + ' adjusted p']: c.pAdj, [p + ' excludes 0']: ex(c.flagged) });
      // Under pairing the checks line tests each pair's differences; otherwise it
      // repeats the designs' own checks, reported once under the means.
      if (paired) Object.assign(e, shapiroExpect('shapiro diff ' + pairLabel(c.i, c.j) + ' ', g[c.i].map((v, t) => v - g[c.j][t])));
    }
  }

  // The plans: for the means, the design with the largest s at 1 - alpha/k;
  // for the differences, every Welch interval of the family at 1 - alpha/C,
  // or under pairing the pair whose differences vary most. The rank
  // procedures take the t plans inflated by pi/3.
  const inflate = n => (n == null ? NaN : Math.ceil(n * Math.PI / 3));
  const sds = sm.items.map(it => it.sd);
  const hpM = planReplications({ sd: Math.max(...sds), level: 1 - alpha / k, target: plan.meansH });
  Object.assign(e, { 'plan means half-width target': plan.meansH, 'plan means n': hpM.n == null ? NaN : hpM.n, 'plan means half-width at n': hpM.hwAtN });
  let hpD;
  if (paired) {
    const sdDs = fam.comparisons.map(c => ({ i: c.i, j: c.j, sd: c.se * Math.sqrt(c.df + 1) }));
    const worst = sdDs.reduce((a, b) => (b.sd > a.sd ? b : a));
    const pr = planReplications({ sd: worst.sd, level: 1 - alpha / fam.C, target: plan.diffsH });
    hpD = { n: pr.n, hwAtN: pr.hwAtN, pair: [worst.i, worst.j] };
  } else {
    hpD = planHalfWidthBonferroni({ sds, level, mode: diffMode, control: ctrlIdx, target: plan.diffsH });
  }
  Object.assign(e, { 'plan diffs half-width target': plan.diffsH, 'plan diffs n': hpD.n == null ? NaN : hpD.n, 'plan diffs half-width at n': hpD.hwAtN,
    'plan diffs widest pair': hpD.n == null ? 'none' : pairLabel(hpD.pair[0], hpD.pair[1]) });
  if (np) { e['plan means n (rank)'] = inflate(hpM.n); e['plan diffs n (rank)'] = inflate(hpD.n); }

  r.several = { k, np, paired, diffMode, ctrlIdx, bench, dir, eps,
    plan: { meansH: plan.meansH, diffsH: plan.diffsH, delta: plan.delta, power: plan.power }, anova: null, rank: null, subset: null };
  r.settings = { control: ctrlIdx + 1, plan_means_h: plan.meansH, plan_diffs_h: plan.diffsH, plan_delta: plan.delta, plan_power: plan.power };
  if (bench != null) r.settings.benchmark = bench;
  r.settingsNote = [
    'The comparison family is fixed to the page\'s choice, ' +
      (diffMode === 'control' ? 'each design against the control, design ' + (ctrlIdx + 1) : 'every pair of designs') +
      ', and is written into the code below; changing control does not change it. The intervals, the checks, and the plans read level' +
      (bench != null ? ', benchmark,' : '') + ' and the plan_ half-width targets; control, plan_delta, and plan_power are read only by the analysis of variance\'s post-hoc rules and plan, where the script has them.'
  ];
  severalAnova(r, o, g, sm);
  severalRank(r, o, g);
  severalSubset(r, o, g);
  return r;
}

// The analysis of variance and its post-hoc rules, the rank tests, and the
// screen for the best: each adds its section's fields to the recipe.
function severalAnova() {}
function severalRank() {}
function severalSubset() {}
