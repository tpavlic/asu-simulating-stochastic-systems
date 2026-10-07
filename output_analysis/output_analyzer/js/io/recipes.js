// Recipes for the "Regenerate these results in" scripts: one pure builder per
// page, taking the inputs the page computed with, running the same js/stats
// functions the page ran, and returning a plain object the writers in
// analysis_scripts.js turn into a script. A recipe carries the data, every
// choice, and `expect`, the analyzer's own value under each report name, so
// that the script can print its value beside the analyzer's and the tests can
// compare them. `csv` names the files the Import page saves with the same
// data, which the script shows how to read in place of its own data block.
//
// A page does not build its recipe when it computes: it registers
// `regen: { build: () => recipe, tooBig }` with its result, and the export
// row calls build() only when a script is asked for.

import { repEstimates, repIds, datasetSummary, observations, timeWeightedOverall } from '../data/model.js';
import { summary, acf } from '../stats/descriptive.js';
import { tInterval, varianceInterval, planReplications, powerOneSample, planPowerOneSample, fRatio } from '../stats/intervals.js';
import { signedRank, rankSum, kruskalWallis, dunn, friedman, friedmanPairs } from '../stats/nonparam.js';
import { shapiroWilk } from '../stats/normality.js';
import { welch, pooledT, pairedT, levene, planHalfWidthWelch, planHalfWidthPooled, powerWelch, powerPooled,
         planPowerWelch, planPowerPooled, simultaneousMeans, bonferroniFamily, planHalfWidthBonferroni,
         posthoc, posthocWelch, powerAnova, planPowerAnova } from '../stats/compare.js';
import { bonferroniFamilyRank } from '../stats/nonparam.js';
import { subsetSelection } from '../stats/select.js';
import { alignByIndex, alignByTime, movingAverage, gapAwareAverage, cumulativeAverage, batchMeans, concatenateReps,
         resampleTimeWeighted, ACF_MAX_LAG, ACF_STEPS } from '../stats/steadystate.js';
import { slug } from './export.js';

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
 * The name of a dataset's CSV file as the Import page saves it (Export on the
 * dataset's row): the Observations CSV, or the Replication summary CSV.
 * @param {{name: string}} ds
 * @param {'observations'|'replications'} form
 * @returns {string}
 */
export function csvFileName(ds, form) {
  return slug(ds.name) + (form === 'observations' ? '_observations.csv' : '_replications.csv');
}

/**
 * One entry of `recipe.csv`: a file the data block's contents can be read
 * from, the dataset it holds, its form, and the part of the block it feeds
 * ('x', 'a', 'b', 'group <i>', 'records', or 'replication list').
 */
export function csvEntry(ds, form, role) {
  return { dataset: ds.name, file: csvFileName(ds, form), form, role };
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
  // The pooled observations come from the Observations CSV, the outcomes from the Replication summary CSV.
  r.csv = [csvEntry(ds, pooled ? 'observations' : 'replications', 'x')];
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
  // A relative target is carried as the percentage, and the script works out
  // plan_h from the data's own mean, so that it follows the data if they are edited.
  r.settings = !planOut ? {}
    : planOut.relative ? { plan_rel: planOut.rel, plan_delta: planOut.delta, plan_power: planOut.power }
      : { plan_h: planOut.h, plan_delta: planOut.delta, plan_power: planOut.power };
  return r;
}

/**
 * Whether a One System script would embed more than MAX_NUMBERS numbers:
 * only under the pooled override, which embeds every observation of a tally
 * dataset rather than one outcome per replication. Cheap, and copies nothing.
 * @param {{pooled: boolean, x: ArrayLike<number>}} o the page's recipe inputs
 */
export function oneTooBig({ pooled, x }) {
  return !!pooled && x.length > MAX_NUMBERS;
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
  r.csv = [csvEntry(dsA, 'replications', 'a'), csvEntry(dsB, 'replications', 'b')];
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
  r.csv = [csvEntry(dsA, 'replications', 'a'), csvEntry(dsB, 'replications', 'b')];
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
  r.csv = list.map((d, i) => csvEntry(d, 'replications', 'group ' + (i + 1)));
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
  // Every choice a reader may edit is a setting; the script forms the pairs it
  // compares from control and family at run time.
  r.settings = { control: ctrlIdx + 1, family: diffMode === 'control' ? 'control' : 'pairs' };
  if (bench != null) r.settings.benchmark = bench;
  if (np) r.settings.rank_adjust = o.adjust === 'holm' ? 'holm' : 'bonferroni';
  Object.assign(r.settings, { epsilon: eps, direction: dir === 'min' ? 'min' : 'max', plan_means_h: plan.meansH, plan_diffs_h: plan.diffsH,
    plan_delta: plan.delta, plan_power: plan.power });
  const dunnett = proc !== 'np' && !(o.varMode === 'welch' && !paired) && o.rule === 'dunnett';
  r.settingsNote = [
    'Edit any of these and rerun. level is the confidence that each family of intervals keeps as a whole. ' +
      'family chooses the pairwise comparisons: "pairs" compares every pair of designs, and "control" compares each design with the control, ' +
      'the design numbered control in the list below (numbered from 1, as on the page)' + (dunnett ? ', which Dunnett\'s post-hoc rule also compares every design with' : '') + '. ' +
      (bench != null ? 'benchmark is the value each design\'s interval is checked against. ' : '') +
      (np ? 'rank_adjust is the rule that adjusts the rank tests\' pairwise p-values: "holm" (Holm\'s step-down) or "bonferroni". ' : '') +
      'epsilon is the screen\'s indifference zone, the smallest difference worth telling apart, and direction says whether the larger mean is better ("max") or the smaller ("min"). ' +
      'plan_means_h and plan_diffs_h are the half-widths the replication plans aim for, and plan_delta and plan_power are the shift the F test should detect and the probability of detecting it.'
  ];
  severalAnova(r, o, g);
  severalRank(r, o, g);
  severalSubset(r, o, g);
  return r;
}

// The analysis of variance and its post-hoc rules, the rank tests, and the
// screen for the best: each adds its section's fields to the recipe.

// The post-hoc rules' names in report keys, which the test harness's
// tolerances match on.
const RULE_SLUG = { tukey: 'tukey', lsd: 'lsd', bonferroni: 'bonferroni', dunnett: 'dunnett', gameshowell: 'gameshowell', bonferroniWelch: 'bonferroniwelch' };

/**
 * The analysis of variance section, as the page computes it: Levene's test,
 * the one-way or blocked table (or Welch's analysis), the residuals'
 * Shapiro-Wilk check, the post-hoc rule's pairs and letters, and the F
 * test's power plan, which the page shows under every procedure. Under the
 * rank procedures only the plan is added. Welch's analysis needs two
 * outcomes with some spread in every design; when one has none, the page
 * shows a warning in place of the whole section.
 */
function severalAnova(r, o, g) {
  const { list, paired, level, proc, varMode, rule, ruleW, ctrlIdx, plan } = o;
  const alpha = 1 - level, k = g.length, e = r.expect, np = proc === 'np';
  const welch = varMode === 'welch' && !paired && !np;
  const flat = g.map(x => x.length < 2 || Math.min(...x) === Math.max(...x));
  const welchBad = welch ? list.filter((d, i) => flat[i]).map(d => d.name) : [];
  const welchOk = welch && !welchBad.length;
  // The page's own post hoc: the Welch rule when Welch's analysis is defined,
  // and otherwise the pooled rule, whose table gives the plan its sigma.
  const ph = welchOk ? posthocWelch(g, { rule: ruleW, alpha }) : posthoc(g, { rule, alpha, control: ctrlIdx, blocked: paired });
  const av = ph.anova;
  if (!np) {
    const slug = RULE_SLUG[welch ? ruleW : rule];
    const section = { welch, welchBad, blocked: paired, rule: welch ? ruleW : rule, ruleSlug: slug, protectedLsd: null, letters: false, pairs: [] };
    r.several.anova = section;
    if (welchBad.length) e['welch anova'] = 'not defined';
    else {
      const lv = levene(g);
      Object.assign(e, { 'levene F': lv.F, 'levene df1': lv.df1, 'levene df2': lv.df2, 'levene p': lv.p });
      if (welch) Object.assign(e, { 'welch F': av.F, 'welch df1': av.df1, 'welch df2': av.df2, 'welch p': av.p });
      else {
        Object.assign(e, { 'anova F': av.F, 'anova df1': av.dfb, 'anova df2': av.dfw, 'anova p': av.p, 'ss between': av.ssb, 'ss within': av.ssw, 'ms between': av.msb, 'ms within': av.msw });
        if (paired) Object.assign(e, { 'ss blocks': av.ssblk, 'df blocks': av.dfblk, 'block F': av.Fblock, 'block p': av.pBlock });
      }
      const resid = [];
      g.forEach((x, i) => { for (let t = 0; t < x.length; t++) resid.push(x[t] - av.means[i] - (paired ? av.blockMeans[t] - av.grandMean : 0)); });
      Object.assign(e, shapiroExpect('shapiro residuals ', resid));
      e['posthoc rule'] = slug;
      if (!welch) e['posthoc ' + slug + ' critical value'] = ph.crit;
      if (!welch && rule === 'lsd') { section.protectedLsd = ph.protected; e['posthoc lsd protected'] = ex(ph.protected); }
      for (const p of ph.pairs) {
        const key = 'posthoc ' + slug + ' ' + pairLabel(p.i, p.j);
        Object.assign(e, { [key + ' diff']: p.diff, [key + ' se']: p.se });
        if (welch) Object.assign(e, { [key + ' df']: p.df, [key + ' crit']: p.crit });
        Object.assign(e, { [key + ' hw']: p.hw, [key + ' lower']: p.lo, [key + ' upper']: p.hi });
        if (welch) e[key + ' p'] = p.p;
        e[key + ' different'] = ex(p.flagged);
        section.pairs.push([p.i, p.j]);
      }
      if (ph.letters) { section.letters = true; ph.letters.forEach((l, i) => { e['letters ' + (i + 1)] = l; }); }
    }
  }
  // The plan reads sqrt(msw) of the page's table: the pooled one (blocked
  // under pairing), and under a defined Welch analysis Welch's table, which
  // has no msw, and so no plan.
  const sigma = Math.sqrt(av.msw);
  const pp = planPowerAnova({ k, sigma, delta: plan.delta, alpha, power: plan.power, blocked: paired });
  const Rlo = Math.min(...g.map(x => x.length));
  Object.assign(e, { 'plan anova delta': plan.delta, 'plan anova power target': plan.power, 'plan anova n': pp.n == null ? NaN : pp.n, 'plan anova power at n': pp.powerAtN,
    'power at current R': sigma > 0 ? powerAnova({ n: Rlo, k, sigma, delta: plan.delta, alpha, blocked: paired }) : NaN });
  if (np) e['plan anova n (rank)'] = pp.n == null ? NaN : Math.ceil(pp.n * Math.PI / 3);
  r.several.anovaPlan = { blocked: paired, sigmaFrom: welchOk ? 'none' : np || welchBad.length ? 'pooled' : 'anova' };
}

/**
 * The rank tests the page shows in place of the analysis of variance under
 * the rank procedures: Kruskal-Wallis with Dunn's pairwise comparisons, or
 * under pairing Friedman's test with Siegel and Castellan's, every pair's
 * p-value adjusted by Bonferroni or Holm, the letters, and each design's
 * pseudo-median with its own Wilcoxon interval at the stated level.
 */
function severalRank(r, o, g) {
  const { paired, level, proc, adjust } = o;
  if (proc !== 'np') return;
  const alpha = 1 - level, e = r.expect;
  if (paired) {
    const fr = friedman(g);
    Object.assign(e, { 'friedman chi2': fr.chi2, 'friedman df': fr.df, 'friedman p': fr.p });
  } else {
    const kw = kruskalWallis(g);
    Object.assign(e, { 'kruskal H': kw.H, 'kruskal df': kw.df, 'kruskal p': kw.p });
  }
  const dn = paired ? friedmanPairs(g, { alpha, adjust }) : dunn(g, { alpha, adjust });
  const pairs = [];
  for (const p of dn.pairs) {
    const key = 'rank pair ' + pairLabel(p.i, p.j);
    Object.assign(e, { [key + ' diff']: p.diff, [key + ' se']: p.se, [key + ' z']: p.z, [key + ' p']: p.p, [key + ' adjusted p']: p.pAdj,
                       [key + ' different']: ex(p.flagged) });
    pairs.push([p.i, p.j]);
  }
  dn.letters.forEach((l, i) => { e['rank letters ' + (i + 1)] = l; });
  g.forEach((x, i) => {
    const sr = signedRank(x, { level }), d = 'rank design ' + (i + 1) + ' ';
    Object.assign(e, { [d + 'pseudo-median']: sr.estimate, [d + 'lower']: sr.lo, [d + 'upper']: sr.hi });
  });
  r.several.rank = { paired, adjust, pairs };
}

/**
 * The screen for the best, which the page shows under every procedure: the
 * subset-selection screen with indifference zone eps and Rinott's
 * second-stage sizes, or the reason the screen is not defined.
 */
function severalSubset(r, o, g) {
  const { level, dir, eps } = o;
  const alpha = 1 - level, e = r.expect;
  const ss = subsetSelection(g, { alpha, delta: eps, dir });
  r.several.subset = { ok: ss.ok, reason: ss.ok ? '' : ss.reason };
  if (!ss.ok) { e.screen = 'not defined'; return; }
  Object.assign(e, { 'screen t': ss.t, 'rinott h': ss.h, 'best design': ss.best + 1 });
  g.forEach((x, i) => {
    const d = 'design ' + (i + 1) + ' ';
    Object.assign(e, { [d + 'survives']: ex(ss.survivors[i]), [d + 'N']: ss.N[i] == null ? NaN : ss.N[i],
                       [d + 'additional']: ss.additional[i] == null ? NaN : ss.additional[i] });
  });
}

// ── Steady State ─────────────────────────────────────────────────────────

/** The most numbers a script embeds; a page whose records run past it offers no script. */
export const MAX_NUMBERS = 200000;

/**
 * How many numbers a dataset's records would put in a script: every value,
 * and every time stamp where there is one. Cheap, and copies nothing.
 * @param {{reps: {t: ArrayLike<number>|null, v: ArrayLike<number>}[]}} ds
 */
export function recordCount(ds) {
  let n = 0;
  for (const r of ds.reps) n += r.v.length * (r.t ? 2 : 1);
  return n;
}

/**
 * The files the records of a dataset can be read from: the Observations CSV
 * for the records, and the Replication summary CSV for the list and order of
 * the replications, because one with no records has no row in the first.
 */
function recordsCsv(ds) {
  return [csvEntry(ds, 'observations', 'records'), csvEntry(ds, 'replications', 'replication list')];
}

/** The records of a dataset as plain arrays, every replication in order (an empty one included). */
function recordsOf(ds) {
  return { name: ds.name, response: ds.response, unit: ds.unit, kind: ds.kind, endTime: ds.endTime,
    reps: ds.reps.map(r => ({ id: String(r.id), t: r.t ? Array.from(r.t) : null, v: Array.from(r.v) })) };
}

/**
 * The Steady State recipe: the warm-up plot's averages, the batch means on
 * the series after truncation, and the autocorrelation of that series, each
 * computed as the page computes it.
 * @param {{ ds: object, align: 'index'|'time', nBins: number, w: number, cut: number, repIdx: number,
 *   lumped: boolean, mode: 'count'|'size', count: number, size: number|null, level: number, start: number,
 *   title?: string, provenance?: object }} o
 *   `ds` is the run the page batches (the source run of a derived dataset,
 *   as the page's current() returns it), `start` the time its bins start from
 *   (the page's startTime(ds)), and the rest the page's settings. `title`
 *   and `provenance` are the page's own, copied into the recipe. A pure
 *   function of its argument, and so a page can call it lazily. When the
 *   records would run past MAX_NUMBERS, the recipe carries `tooBig` and no
 *   records.
 */
export function steadyRecipe(o) {
  const { ds, align, nBins, w, cut, repIdx, mode, count, size, level, start } = o;
  const r = baseRecipe({ page: 'steady', title: o.title || 'Steady state: batch means', provenance: o.provenance || {}, level });
  r.csv = recordsCsv(ds);
  if (recordCount(ds) > MAX_NUMBERS) { r.tooBig = true; return r; }
  r.records = recordsOf(ds);
  const e = r.expect;
  const kind = ds.kind === 'time' ? 'time' : 'tally';
  const lumped = !!o.lumped && ds.reps.length > 1;

  // Warm-up: the average across replications, smoothed as the page smooths it.
  let ybar, edges = null;
  if (align === 'index') ybar = alignByIndex(ds.reps).ybar;
  else ({ ybar, edges } = alignByTime(ds.reps, ds.kind, nBins, ds.endTime, start));
  const L = ybar.length, mid = Math.ceil(L / 2);
  let gaps = 0;
  for (let i = 0; i < L; i++) if (!Number.isFinite(ybar[i])) gaps++;
  const smooth = gaps ? gapAwareAverage(ybar, w) : movingAverage(ybar, w), cum = cumulativeAverage(ybar);
  e['warm-up points'] = L;
  if (L) {
    Object.assign(e, { 'warm-up ybar at 1': ybar[0], 'warm-up ybar at mid': ybar[mid - 1],
      'warm-up moving average at mid': smooth[mid - 1], 'warm-up cumulative average at end': cum[L - 1] });
  }
  if (edges) Object.assign(e, { 'warm-up bin width': edges[1] - edges[0], 'warm-up empty bins': gaps });

  // The series batching works on, as the page forms it: one replication passed
  // whole with the cut, or every replication cut and then joined end to end.
  const truncate = cut > 0 ? { by: align, at: cut } : null;
  let src, kept;
  if (lumped) {
    kept = concatenateReps(ds.reps, kind, truncate, ds.endTime);
    src = { rep: { t: kept.t, v: kept.v }, truncate: null, endTime: kept.end };
  } else {
    const rep = ds.reps[repIdx] || ds.reps[0];
    kept = concatenateReps([rep], kind, truncate, ds.endTime);
    src = { rep, truncate, endTime: ds.endTime };
  }
  const opts = { kind, truncate: src.truncate, endTime: src.endTime, level };
  if (mode === 'count') opts.count = count; else opts.size = size;
  let res;
  if (lumped && !src.rep.v.length) res = { ok: false, reason: 'Nothing remains in any replication after this cut.' };
  else { try { res = batchMeans(src.rep, opts); } catch (err) { res = { ok: false, reason: String(err.message || err) }; } }
  if (res.ok) {
    Object.assign(e, { batches: res.b, 'batch size': res.size, 'batch start': res.start, 'records used': res.nUsed });
    res.batches.forEach((b, i) => {
      e['batch ' + (i + 1) + ' mean'] = b.mean;
      if (res.byTime) e['batch ' + (i + 1) + ' records'] = b.n;
    });
    if (res.byTime) e['leftover duration'] = res.leftover.duration; else e['leftover observations'] = res.leftover.n;
    Object.assign(e, { 'mean of batch means': res.mean, 'sd of batch means': res.sd, se: res.se, df: res.df, 't quantile': res.t,
      'half-width': res.hw, lower: res.lo, upper: res.hi, 'lag-one r1': res.lag1, 'fishman C': res.lag1Test.C, 'fishman p': res.lag1Test.p });
  } else e['batch means'] = 'not defined';

  // The autocorrelation of the series after truncation, as the page's
  // correlogram forms it: a time-persistent series is first averaged over
  // ACF_STEPS equal steps of simulation time and is used only when every step
  // is covered; a tally series needs at least 8 observations.
  let series = null;
  if (kept && kept.v.length) {
    if (kind === 'time') {
      const a = kept.t[0], z = kept.end;
      if (z > a) {
        const rs = resampleTimeWeighted(kept.t, kept.v, a, z, ACF_STEPS).values;
        if (Array.prototype.every.call(rs, Number.isFinite)) series = rs;
      }
    } else if (kept.v.length >= 8) series = kept.v;
  }
  const maxLag = series ? Math.min(ACF_MAX_LAG, Math.floor(series.length / 4)) : 0;
  if (maxLag >= 1) {
    const ac = acf(series, maxLag);
    for (let j = 1; j <= Math.min(5, maxLag); j++) e['acf lag ' + j] = ac[j];
  }

  r.steady = { kind, align, lumped, mode, batchOk: res.ok, reason: res.ok ? '' : res.reason };
  r.settings = {
    align, n_bins: nBins, w, cut, start, lumped, replication: (ds.reps[repIdx] ? repIdx : 0) + 1,
    batch_count: mode === 'count' ? count : NaN, batch_size: mode === 'size' ? size : NaN
  };
  r.settingsNote = [
    'align is index (observation i of every replication averaged with observation i of the others, and cut counts the observations deleted from the start of each replication) or time (n_bins equal bins of simulation time from start, and cut is the time the warm-up ends); time-persistent data are aligned by time only. w is the moving average\'s half-width, and cut = 0 deletes nothing.',
    'When lumped is true, every replication is cut and joined end to end; otherwise the replication in position replication (1 is the first) is batched. Set batch_count to a number of batches, or set it to NaN and batch_size to a batch size (observations, or units of simulation time for time-persistent data).'
  ];
  return r;
}

// ── Summary and Plots ────────────────────────────────────────────────────

/**
 * Whether a Summary and Plots script would embed more than MAX_NUMBERS
 * numbers: the shown dataset's records and the outcomes of the datasets
 * Levene's test compares. Cheap, and copies nothing.
 * @param {{ds: object, spread: null|{groups: ArrayLike<number>[]}}} o
 */
export function exploreTooBig({ ds, spread }) {
  let n = recordCount(ds);
  if (spread) for (const g of spread.groups) n += g.length;
  return n > MAX_NUMBERS;
}

/**
 * The Summary and Plots recipe: each replication's count and outcome (and,
 * for tally data, its sd, min, and max), the descriptives of the replication
 * outcomes, the pooled observations or the time-weighted mean of every
 * replication together, the t interval over the outcomes, the Shapiro-Wilk
 * test of the outcomes, and Levene's test across the datasets ticked under
 * Equal variances, each computed as the page computes it.
 * @param {{ ds: object, spread: null|{names: string[], groups: ArrayLike<number>[]}, level: number,
 *   title?: string, provenance?: object }} o
 *   `spread` is the Equal variances section's ticked datasets and their finite
 *   replication outcomes, or null when the section has none to compare.
 *   Levene's test is formed only when there are two or more groups and every
 *   group has two or more outcomes, as the page's checklist requires. `level`
 *   is the per-interval level of the t interval over the outcomes. `title` and
 *   `provenance` are the page's own, copied into the recipe. A pure function
 *   of its argument, and so a page can call it lazily. When the numbers would
 *   run past MAX_NUMBERS, the recipe carries `tooBig` and no records.
 */
export function exploreRecipe(o) {
  const { ds, spread, level } = o;
  const r = baseRecipe({ page: 'explore', title: o.title || 'Summary of ' + ds.name, provenance: o.provenance || { dataset: ds.name }, level });
  // Levene's groups (other datasets' outcomes) stay embedded and are read from no file.
  r.csv = recordsCsv(ds);
  if (exploreTooBig({ ds, spread })) { r.tooBig = true; return r; }
  r.records = recordsOf(ds);
  const ov = outcomeVector(ds);
  r.outcomes = ov;
  const e = r.expect;
  const sm = datasetSummary(ds);
  const est = repEstimates(ds);
  const tally = ds.kind === 'tally';

  // Each replication, as the page's replication summary lists it.
  Object.assign(e, { replications: sm.nReps, observations: sm.nObs });
  ds.reps.forEach((rp, i) => {
    const p = 'rep ' + rp.id + ' ';
    e[p + 'n'] = rp.v.length;
    e[p + 'outcome'] = est[i];
    if (tally) {
      const s = rp.v.length ? summary(rp.v) : null;
      Object.assign(e, { [p + 'sd']: s ? s.sd : NaN, [p + 'min']: s ? s.min : NaN, [p + 'max']: s ? s.max : NaN });
    }
  });

  // The descriptives of the finite outcomes.
  const x = ov.values, n = x.length;
  if (n) {
    const s = summary(x);
    Object.assign(e, { n: s.n, mean: s.mean, sd: s.sd, se: s.se, min: s.min, q1: s.q1, median: s.median, q3: s.q3, max: s.max });
  }

  // Every replication together: the pooled observations of tally data, which
  // the page describes without a standard error, or the time-weighted mean of
  // time-persistent data.
  let pooled = false;
  if (tally) {
    const obs = observations(ds);
    if (obs.length) {
      pooled = true;
      const p = summary(obs);
      Object.assign(e, { 'pooled n': p.n, 'pooled mean': p.mean, 'pooled sd': p.sd, 'pooled min': p.min, 'pooled q1': p.q1,
        'pooled median': p.median, 'pooled q3': p.q3, 'pooled max': p.max });
    }
  }
  const timeTotal = ds.kind === 'time';
  if (timeTotal) {
    const tw = timeWeightedOverall(ds);
    Object.assign(e, { 'time-weighted mean': tw.mean, 'time covered': tw.duration });
  }

  // The t interval over the outcomes, which the Replications section draws.
  const interval = n >= 2;
  if (interval) {
    const ti = tInterval(x, level);
    Object.assign(e, { 'interval df': ti.df, 'interval t quantile': ti.t, 'interval half-width': ti.hw, 'interval lower': ti.lo, 'interval upper': ti.hi });
  }

  // The Shapiro-Wilk test, on the outcomes only: the page withholds it on pooled observations.
  const checks = shapiroOk(x);
  if (checks) Object.assign(e, shapiroExpect('shapiro ', x));

  // Levene's test, only where every group has two or more outcomes.
  if (spread && spread.groups.length >= 2 && spread.groups.every(g => g.length >= 2)) {
    const groups = spread.groups.map(g => Array.from(g));
    const lv = levene(groups);
    Object.assign(e, { 'levene F': lv.F, 'levene df1': lv.df1, 'levene df2': lv.df2, 'levene p': lv.p });
    r.spread = { names: spread.names.slice(), groups };
  }
  r.explore = { kind: ds.kind, outcomes: n > 0, pooled, timeTotal, interval, checks, spread: !!r.spread };
  r.settings = {};
  return r;
}
