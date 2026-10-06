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
