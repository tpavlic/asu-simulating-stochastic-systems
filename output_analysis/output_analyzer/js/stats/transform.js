// Transforms of the replication outcomes: the one shared choice that puts every
// outcome on another scale before any inference, so that every design is
// compared on the same scale. Each transform is strictly monotone on its
// domain, and so an interval on the transformed scale carries back to the
// response's own units end for end (in reverse order for the reciprocal).
// Pure functions, no DOM.

const HALF_PI = Math.PI / 2;

/**
 * A transform: its id (also its name in the regenerate scripts), the label its
 * menu shows, the word an axis label starts with, the scale's name as a
 * modifier ("on the square-root scale"), the function and its
 * inverse, the domain as a test and in words, whether it reverses order, and
 * the name of the back-transformed center.
 * @typedef {{ id: string, label: string, word: string, scale: string, f: (y: number) => number, inv: (v: number) => number,
 *   ok: (y: number) => boolean, domain: string, decreasing: boolean, center: string }} Transform
 */

/**
 * The transforms in menu order. Each inverse is defined on the whole line: an
 * interval end that falls outside the image of the domain (a lower end below
 * 0 on the square-root scale) maps to the edge of the domain, or to Infinity
 * for the reciprocal, whose interval on a positive harmonic mean is then
 * unbounded above.
 * @type {Transform[]}
 */
export const TRANSFORMS = [
  { id: 'none', label: 'None', word: '', scale: 'original', f: y => y, inv: v => v, ok: () => true, domain: 'any value', decreasing: false, center: 'mean' },
  { id: 'log', label: 'Log', word: 'Log', scale: 'log', f: Math.log, inv: Math.exp, ok: y => y > 0,
    domain: 'above 0', decreasing: false, center: 'geometric mean' },
  { id: 'sqrt', label: 'Square root', word: 'Square root', scale: 'square-root', f: Math.sqrt, inv: v => (Number.isNaN(v) ? NaN : v <= 0 ? 0 : v * v), ok: y => y >= 0,
    domain: 'at least 0', decreasing: false, center: 'back-transformed mean' },
  { id: 'asin_sqrt', label: 'Arcsine square root', word: 'Arcsine square root', scale: 'arcsine-square-root', f: y => Math.asin(Math.sqrt(y)),
    inv: v => (Number.isNaN(v) ? NaN : v <= 0 ? 0 : v >= HALF_PI ? 1 : Math.sin(v) ** 2), ok: y => y >= 0 && y <= 1,
    domain: 'between 0 and 1', decreasing: false, center: 'back-transformed mean' },
  { id: 'logit', label: 'Logit', word: 'Logit', scale: 'logit', f: y => Math.log(y / (1 - y)), inv: v => 1 / (1 + Math.exp(-v)), ok: y => y > 0 && y < 1,
    domain: 'strictly between 0 and 1', decreasing: false, center: 'back-transformed mean' },
  { id: 'reciprocal', label: 'Reciprocal', word: 'Reciprocal', scale: 'reciprocal', f: y => 1 / y, inv: v => (Number.isNaN(v) ? NaN : v > 0 ? 1 / v : Infinity), ok: y => y > 0,
    domain: 'above 0', decreasing: true, center: 'harmonic mean' }
];

/**
 * The default shift or half-width on the log scale: ln 1.1 to two significant
 * digits, a ratio of 1.1. A difference of logs is the log of a ratio, and so
 * this default means the same in any units, where a percent of the mean of
 * the logs (which a change of units moves by a constant) would not.
 */
export const LOG_DEFAULT_SHIFT = 0.095;

const BY_ID = new Map(TRANSFORMS.map(t => [t.id, t]));

/**
 * The transform with this id, or None for an unknown one.
 * @param {string} id
 * @returns {Transform}
 */
export function transformOf(id) {
  return BY_ID.get(id) || BY_ID.get('none');
}

/** Whether `id` names a transform other than None. */
export function isTransform(id) {
  return BY_ID.has(id) && id !== 'none';
}

/**
 * Applies a transform to every value. A value that is not a finite number
 * passes through as NaN and is not counted as outside the domain, because
 * the pages already drop it as a replication with no outcome.
 * @param {ArrayLike<number>} values
 * @param {string} id
 * @returns {{values: Float64Array, bad: number[]}} the transformed values, and
 *   the indices of the finite values outside the domain (left NaN)
 */
export function applyTransform(values, id) {
  const t = transformOf(id);
  const out = new Float64Array(values.length), bad = [];
  for (let i = 0; i < values.length; i++) {
    const y = values[i];
    if (!Number.isFinite(y)) out[i] = NaN;
    else if (!t.ok(y)) { out[i] = NaN; bad.push(i); }
    else out[i] = t.f(y);
  }
  return { values: out, bad };
}

/**
 * One value carried back to the response's units.
 * @param {number} v
 * @param {string} id
 */
export function backTransform(v, id) {
  return transformOf(id).inv(v);
}

/**
 * An interval on the transformed scale carried back to the response's units,
 * its ends in increasing order.
 * @param {number} lo
 * @param {number} hi
 * @param {string} id
 * @returns {{lo: number, hi: number}}
 */
export function backInterval(lo, hi, id) {
  const t = transformOf(id);
  return t.decreasing ? { lo: t.inv(hi), hi: t.inv(lo) } : { lo: t.inv(lo), hi: t.inv(hi) };
}

/**
 * An axis or column label on the transformed scale: "Log of replication mean
 * of wait". A label whose first two letters are capitals (an acronym) keeps
 * its case.
 * @param {string} label
 * @param {string} id
 */
export function transformLabel(label, id) {
  const t = transformOf(id);
  if (t.id === 'none') return label;
  const s = String(label);
  const lower = /^[A-Z][A-Z]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
  return t.word + ' of ' + lower;
}

/**
 * The transforms other than None whose domain holds every finite value.
 * @param {ArrayLike<number>} values
 * @returns {string[]} their ids, in menu order
 */
export function fittingTransforms(values) {
  const v = Array.from(values).filter(Number.isFinite);
  return TRANSFORMS.filter(t => t.id !== 'none' && v.every(t.ok)).map(t => t.id);
}

/**
 * Transforms the finite replication outcomes of several sets (one per design)
 * with one transform, and finds the replications whose outcome lies outside
 * its domain.
 * @param {{name: string, values: ArrayLike<number>, ids: (string|number)[]}[]} sets
 *   each set's outcomes with the replication ids in step with them
 * @param {string} id
 * @returns {{ok: boolean, values: Float64Array[], problems: {name: string, ids: (string|number)[], all: boolean}[], fitting: string[]}}
 *   the transformed values of each set, the sets with outcomes outside the
 *   domain (none when `ok`; `all` when every outcome of the set is), and the
 *   transforms whose domain holds every outcome of every set
 */
export function transformSets(sets, id) {
  const values = [], problems = [];
  for (const set of sets) {
    const r = applyTransform(set.values, id);
    values.push(r.values);
    const finite = Array.from(set.values).filter(Number.isFinite).length;
    if (r.bad.length) problems.push({ name: set.name, ids: r.bad.map(i => set.ids[i]), all: r.bad.length === finite });
  }
  const all = [];
  for (const set of sets) for (const v of Array.from(set.values)) all.push(v);
  return { ok: problems.length === 0, values, problems, fitting: fittingTransforms(all) };
}
