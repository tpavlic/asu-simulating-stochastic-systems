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
import { tInterval, varianceInterval, planReplications, powerOneSample, planPowerOneSample } from '../stats/intervals.js';
import { signedRank } from '../stats/nonparam.js';
import { shapiroWilk } from '../stats/normality.js';

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
