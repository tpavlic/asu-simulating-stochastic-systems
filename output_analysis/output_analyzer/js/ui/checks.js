// A line of assumption checks under a parametric result: the Shapiro–Wilk
// test on each set of values the procedure takes as normal, Levene's test
// across the sets when a variance is pooled, and a note on small samples.
// The checks flag; they never gate a result, and they say that independence
// cannot be checked from the data.

import { shapiroWilk } from '../stats/normality.js';
import { levene } from '../stats/compare.js';
import { notice } from './widgets.js';
import * as state from '../state.js';
import { esc, num, pValue, intl, pEq } from './format.js';

// Below this many values the checks have little power, and the line says so.
const SMALL = 8;

// A test's clause in the color of its outcome: the words carry the verdict,
// and the color repeats it. A statement no test can settle is muted.
const verdict = (bad, html) => '<span class="' + (bad ? 'chk-bad' : 'chk-ok') + '">' + html + '</span>';
const na = html => '<span class="chk-na">' + html + '</span>';
// A link to the Normality section of Summary and Plots, showing the named
// dataset when one is given (the click selects it before the hash changes).
const normLink = (text, dsId) => '<a href="#explore/normality"' + (dsId ? ' data-ds="' + esc(dsId) + '"' : '') + '>' + text + '</a>';
// A part's heading in the color of the worst outcome within it, or muted
// when nothing in it could be tested.
const heading = (text, bad, tested) => '<b class="' + (bad ? 'chk-bad' : tested ? 'chk-ok' : 'chk-na') + '">' + text + '</b>';

/**
 * Builds the checks callout.
 * @param {{ sets: {name: string, values: ArrayLike<number>, dsId?: string}[], pooled?: boolean, alpha?: number, declared?: string,
 *   procedure?: string, varianceSets?: ArrayLike<number>[], alternative?: string, linkDs?: string }} o
 *   `varianceSets` are the groups Levene's test compares when they differ from
 *   `sets` (an analysis of variance checks normality on the residuals but
 *   spreads across the designs); `alternative` names what to prefer when the
 *   spreads differ. `linkDs` is the dataset the Normality link opens when the
 *   rejecting set is not itself a dataset (residuals, paired differences).
 *   `pooled` adds Levene's test across the sets; `declared` is the sentence
 *   on independence, starting after the word "Independence".
 * @returns {HTMLElement}
 */
export function assumptionChecks({ sets, pooled = false, alpha = 0.05, declared = null, procedure = 'this procedure',
                                   varianceSets = null, alternative = 'a procedure that does not pool the variances, such as Welch’s', linkDs = null }) {
  const parts = [];
  let warn = false, tested = false, normBad = false, normTested = false, firstBad = null;
  for (const st of sets) {
    const v = Array.from(st.values).filter(Number.isFinite);
    const n = v.length;
    if (n < 3) { parts.push(na('Shapiro–Wilk on ' + esc(st.name) + ': too few values to test (n = ' + n + ')')); continue; }
    if (n > 5000) { parts.push(na('Shapiro–Wilk on ' + esc(st.name) + ': n = ' + intl(n) + ' is beyond the test')); continue; }
    if (Math.min(...v) === Math.max(...v)) { parts.push(na('Shapiro–Wilk on ' + esc(st.name) + ': every value is the same, and so there is no shape to test')); continue; }
    tested = normTested = true;
    const sw = shapiroWilk(v);
    const bad = sw.p < alpha;
    if (bad) { warn = true; normBad = true; }
    if (bad && firstBad === null) firstBad = st.dsId || null;
    const flag = bad ? ' <b>(' + normLink('rejects normality for ' + esc(st.name), st.dsId || linkDs) + ')</b>' : '';
    parts.push(verdict(bad, 'Shapiro–Wilk on ' + esc(st.name) + ': W = ' + num(sw.W, 3) + ', ' + pEq(sw.p) + flag));
  }
  const minN = Math.min(...sets.map(st => st.values.length));
  const small = minN < SMALL;
  let html = heading('Normality checks.', normBad, normTested) + ' ' + parts.join('; ') + '.' +
    (normBad ? ' Consult the ' + normLink('Normality section of Summary and Plots', firstBad || linkDs) + ' and consider a nonparametric procedure instead of ' + procedure + '. The results on this page assume normality and should be interpreted with caution when the data are not consistent with that assumption.' : '') +
    (small && tested ? ' With n = ' + intl(minN) + ' these checks have little power.' : '');
  const vsets = varianceSets ? varianceSets.map(v => Array.from(v).filter(Number.isFinite)) : sets.map(st => Array.from(st.values).filter(Number.isFinite));
  if (pooled && vsets.length >= 2 && vsets.every(v => v.length >= 2)) {
    const lv = levene(vsets);
    if (lv.F === Infinity) {
      // Every value lies the same distance from its group's median, as two values
      // always do: F is infinite, but the test then compares only the groups'
      // ranges, which says little about their variances.
      html += ' ' + heading('Heteroscedasticity (unequal variance) tests.', false, false) + ' ' + na('Levene (Brown–Forsythe) test across the groups: ' + pEq(lv.p) +
        ', but every value lies the same distance from its group’s median (as two values always do), and so the test compares one distance per group and says little about the variances') + '.';
    } else if (Number.isFinite(lv.p)) {
      tested = true;
      const bad = lv.p < alpha;
      if (bad) warn = true;
      html += ' ' + heading('Heteroscedasticity (unequal variance) tests.', bad, true) + ' ' + verdict(bad, 'Levene (Brown–Forsythe) test across the groups: ' + pEq(lv.p) +
        (bad ? ' <b>(unequal variances detected)</b>' : '')) +
        (bad ? '. Consider ' + alternative + '. The pooled results on this page assume equal variances and should be interpreted with caution when the spreads differ.' : '.');
    } else {
      html += ' ' + heading('Heteroscedasticity (unequal variance) tests.', false, false) + ' ' + na('Levene (Brown–Forsythe) test: cannot be computed, because every value lies the same distance from its group’s median (as happens when no group varies)') + '.';
    }
  }
  if (declared) html += ' ' + na('<b>Independence</b> ' + declared);
  if (!tested) html = '<b>The assumptions could not be checked.</b> ' + html;
  const box = notice(warn ? 'warn' : tested ? 'ok' : 'info', html);
  box.addEventListener('click', e => {
    const a = e.target.closest('a[data-ds]');
    if (a) state.select(a.dataset.ds);
  });
  return box;
}
