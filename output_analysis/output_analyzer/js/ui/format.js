// Number formatting for the page: cards, tables, readouts, and tick labels.
// Pure functions with no DOM access, and so the tests import them directly.
// Negative numbers keep the ASCII hyphen-minus, and so a value copied out of
// the page pastes into a spreadsheet as a number.

/** The en dash shown wherever a value is missing or not finite. */
export const dash = '–';

/**
 * A number to `sig` significant digits with trailing zeros trimmed, in fixed
 * notation for ordinary magnitudes and in exponential notation only below
 * 1e-4 or at 1e15 and above, where fixed notation would print a run of zeros.
 * Non-finite values (NaN, ±Infinity, null, undefined) print as an en dash.
 * @param {number} v
 * @param {number} [sig=4]
 * @returns {string}
 */
export function num(v, sig = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return dash;
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a < 1e-4 || a >= 1e15) return trimExp(v.toExponential(Math.max(0, sig - 1)));
  const dp = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return trimFixed(v.toFixed(Math.min(dp, 15)));
}

/**
 * A number with exactly `d` decimals (no trimming), or an en dash when not
 * finite. A result that rounds to zero prints without a minus sign.
 * @param {number} v
 * @param {number} [d=2]
 * @returns {string}
 */
export function fixed(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return dash;
  const s = v.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/**
 * A proportion as a percentage with `d` decimals: pct(0.953) is "95.3%".
 * @param {number} p a proportion, 0.953 for 95.3%
 * @param {number} [d=1]
 * @returns {string}
 */
export function pct(p, d = 1) {
  if (p === null || p === undefined || !Number.isFinite(p)) return dash;
  return fixed(p * 100, d) + '%';
}

/**
 * A confidence level as a percentage with only the decimals it needs:
 * "95%", "99.5%", "98.75%".
 * @param {number} level
 */
export function lvl(level) {
  if (level === null || level === undefined || !Number.isFinite(level)) return dash;
  return trimFixed((level * 100).toFixed(2)) + '%';
}

/**
 * A p-value: "< 0.001" below one in a thousand, three decimals otherwise.
 * @param {number} p
 * @returns {string}
 */
export function pValue(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return dash;
  if (p < 0.001) return '< 0.001';
  return Math.min(1, p).toFixed(3);
}

/**
 * A p-value with its name: "p = 0.042", or "p < 0.001" below the shown
 * precision, so that the two never read "p = < 0.001".
 * @param {number} p
 * @returns {string}
 */
export function pEq(p) {
  const s = pValue(p);
  return s.startsWith('<') ? 'p ' + s : 'p = ' + s;
}

/**
 * A count with its noun, singular for exactly one: plural(20, 'replication')
 * is "20 replications", and the count carries thousands separators.
 * @param {number} n
 * @param {string} one the singular noun
 * @param {string} [many] the plural noun; defaults to `one + 's'`
 * @returns {string}
 */
export function plural(n, one, many) {
  return intl(n) + ' ' + (n === 1 ? one : (many === undefined ? one + 's' : many));
}

/**
 * A number with comma thousands separators on its integer part; any decimals
 * are kept as JavaScript prints them. Non-finite values print as an en dash.
 * @param {number} n
 * @returns {string}
 */
export function intl(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return dash;
  const s = String(n);
  if (/e/i.test(s)) return s;
  const neg = s[0] === '-';
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const ip = dot < 0 ? body : body.slice(0, dot);
  const fp = dot < 0 ? '' : body.slice(dot);
  return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
}

/**
 * Escapes text for safe insertion into HTML.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function trimFixed(s) {
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
function trimExp(s) {
  const k = s.indexOf('e');
  const mant = trimFixed(s.slice(0, k));
  const ex = s.slice(k + 1).replace(/^\+/, '');
  return mant + 'e' + ex;
}
