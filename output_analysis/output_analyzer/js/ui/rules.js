// Small rules the pages apply, kept apart from the pages so that they can be
// tested in Node and shared with the regenerate scripts: the ticks a dataset
// checklist opens with, Two Systems' verdict on the F ratio of the variances,
// and the labels the figures carry. Pure functions, no DOM.

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

/**
 * The row label for a design in a Two Systems figure: its role letter,
 * followed by the dataset's name with any prefix the two names share
 * ("file · A" and "file · B" become "A" and "B") unless that is the role
 * letter itself.
 * @param {{name: string}} dsA
 * @param {{name: string}} dsB
 * @returns {[string, string]}
 */
export function roleLabels(dsA, dsB) {
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const pa = cut(dsA.name), pb = cut(dsB.name);
  const shared = pa && pb && pa[0] === pb[0] && pa[1] !== pb[1];
  const na = shared ? pa[1] : dsA.name, nb = shared ? pb[1] : dsB.name;
  return [na === 'A' ? 'A' : 'A · ' + na, nb === 'B' ? 'B' : 'B · ' + nb];
}

/**
 * The axis label for a dataset's replication outcomes on One System, or for
 * its observations under the pooled override.
 * @param {{kind: string, response?: string}|null} ds
 * @param {boolean} [pooled]
 */
export function outcomeAxis(ds, pooled) {
  if (!ds) return 'Replication outcome';
  const r = ds.response || 'value';
  if (pooled) return 'Observation of ' + r;
  if (ds.kind === 'reps') return r + ' per replication';
  if (ds.kind === 'time') return 'Time-weighted replication mean of ' + r;
  return 'Replication mean of ' + r;
}

/**
 * The axis label for a dataset's replication outcomes on Summary and Plots.
 * @param {{kind: string, response: string}} ds
 */
export function estimateAxis(ds) {
  if (ds.kind === 'reps') return ds.response;
  if (ds.kind === 'time') return 'Time-weighted replication mean of ' + ds.response;
  return 'Replication mean of ' + ds.response;
}

/**
 * The designs' names as the Several Systems figures label them: the part
 * after a prefix every name shares ("file · A", "file · B" become "A", "B"),
 * or the whole names when they share none or the parts would repeat.
 * @param {{name: string}[]} list
 * @returns {string[]}
 */
export function shortNames(list) {
  const names = list.map(d => d.name);
  if (names.length < 2) return names;
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const parts = names.map(cut);
  if (parts.some(p => !p) || parts.some(p => p[0] !== parts[0][0])) return names;
  const tails = parts.map(p => p[1]);
  return new Set(tails).size === tails.length ? tails : names;
}
