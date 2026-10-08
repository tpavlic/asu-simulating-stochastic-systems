// Small rules the pages apply, kept apart from the pages so that they can be
// tested in Node: the ticks a dataset checklist opens with, and Two Systems'
// verdict on the F ratio of the variances. Pure functions, no DOM.

/**
 * The ticks a dataset checklist opens with. A stored list stands at any
 * length, even one or none, less any id no longer offered; every offered
 * dataset is ticked only before any choice (nothing stored) or when a
 * non-empty stored list has none of its datasets left.
 * @param {unknown} stored the list kept with the session, or anything else when there is none
 * @param {string[]} offered the ids of the datasets the checklist offers
 * @returns {string[]}
 */
export function initialTicks(stored, offered) {
  if (!Array.isArray(stored)) return offered.slice();
  const kept = stored.filter(x => offered.includes(x));
  return kept.length || !stored.length ? kept : offered.slice();
}

/**
 * The F ratio's verdict, and the "interval contains 1" entry of its exported
 * table. Two designs with no spread make F = 0/0, and so there is no ratio to
 * judge. The page reaches fRatio only with two or more outcomes in each
 * design; the undefined interval of fewer is judged here all the same, rather
 * than read as one that excludes 1.
 * @param {ReturnType<typeof import('../stats/intervals.js').fRatio>} fr
 * @returns {{ text: string, contains: 'yes'|'no'|'not defined' }}
 */
export function fRatioVerdict(fr) {
  if (fr.s1 === 0 && fr.s2 === 0) return { text: 'Neither design varies, and so the variances cannot be compared.', contains: 'not defined' };
  if (Number.isNaN(fr.lo) || Number.isNaN(fr.hi)) return { text: 'The F ratio needs at least two replication outcomes of each design.', contains: 'not defined' };
  return fr.lo <= 1 && 1 <= fr.hi
    ? { text: 'The interval contains 1: insufficient evidence that the variances differ at this level.', contains: 'yes' }
    : { text: 'The interval excludes 1: the variances differ at this level.', contains: 'no' };
}
