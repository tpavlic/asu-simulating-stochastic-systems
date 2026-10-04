// A line of assumption checks under a parametric result: the Shapiro–Wilk
// test on each set of values the procedure takes as normal, Levene's test
// across the sets when a variance is pooled, and a note on small samples.
// The checks flag; they never gate a result, and they say that independence
// cannot be checked from the data.

import { shapiroWilk } from '../stats/normality.js';
import { levene } from '../stats/compare.js';
import { notice } from './widgets.js';
import { esc, num, pValue, intl } from './format.js';

// Below this many values the checks have little power, and the line says so.
const SMALL = 8;

/**
 * Builds the checks callout.
 * @param {{ sets: {name: string, values: ArrayLike<number>}[], pooled?: boolean, alpha?: number, declared?: string }} o
 *   `pooled` adds Levene's test across the sets; `declared` is the sentence
 *   on independence, starting after the word "Independence".
 * @returns {HTMLElement}
 */
export function assumptionChecks({ sets, pooled = false, alpha = 0.05, declared = null }) {
  const parts = [];
  let warn = false;
  for (const st of sets) {
    const v = Array.from(st.values).filter(Number.isFinite);
    const n = v.length;
    if (n < 3) { parts.push('Shapiro–Wilk on ' + esc(st.name) + ': too few values to test (n = ' + n + ')'); continue; }
    if (n > 5000) { parts.push('Shapiro–Wilk on ' + esc(st.name) + ': n = ' + intl(n) + ' is beyond the test'); continue; }
    const sw = shapiroWilk(v);
    const bad = sw.p < alpha;
    if (bad) warn = true;
    parts.push('Shapiro–Wilk on ' + esc(st.name) + ': W = ' + num(sw.W, 3) + ', p = ' + pValue(sw.p) + (bad ? ' <b>(rejects normality)</b>' : ''));
  }
  if (pooled && sets.length >= 2 && sets.every(st => st.values.length >= 2)) {
    const lv = levene(sets.map(st => Array.from(st.values).filter(Number.isFinite)));
    const bad = lv.p < alpha;
    if (bad) warn = true;
    parts.push('Levene (Brown–Forsythe) across the sets: p = ' + pValue(lv.p) + (bad ? ' <b>(the spreads differ)</b>' : ''));
  }
  const minN = Math.min(...sets.map(st => st.values.length));
  const small = minN < SMALL;
  const tail = warn
    ? 'A check that rejects is a reason to look at the Normality section of Summary and Plots and to consider the nonparametric procedure; the result above still stands, as a procedure that assumes normality, on these numbers.'
    : 'No evidence against the assumptions at α = ' + num(alpha, 2) + (small ? ', although with n = ' + intl(minN) + ' these checks have little power' : '') + '.';
  const indep = declared ? ' Independence ' + declared : '';
  return notice(warn ? 'warn' : 'info', '<b>Checks.</b> ' + parts.join('; ') + '. ' + tail + indep);
}
