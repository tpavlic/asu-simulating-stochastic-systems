// Small rules the pages apply, kept apart from the pages so that they can be
// tested in Node and shared with the regenerate scripts: the ticks a dataset
// checklist opens with, whether a comparison opens paired, Two Systems'
// verdict on the F ratio of the variances, the labels the figures carry, and
// which of Several Systems' sections and procedures can be chosen together.
// Pure functions, no DOM.

import { transformLabel } from '../stats/transform.js';
import { looksDiscrete, sturgesBins, HIST_BINS_MIN, HIST_BINS_MAX, VALUE_BINS_MAX } from '../stats/descriptive.js';

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
 * Whether a comparison of these datasets opens paired, with the sentence
 * that says why. It does exactly when every one of them came from the same
 * load of one file whose replication column was marked as blocks: block 3
 * of one file need not be block 3 of another, and so datasets from different
 * files open independent even when each file marked its blocks. The reader
 * can still choose Paired for them. `why` is empty when no dataset has
 * blocks, as there is then nothing to explain.
 * @param {{ loadId?: string|null, blocks?: boolean }[]} list the datasets compared
 * @returns {{ paired: boolean, why: string }}
 */
export function pairingDefault(list) {
  const blocked = list.filter(d => d.blocks && d.loadId != null);
  if (list.length < 2 || !blocked.length) return { paired: false, why: '' };
  if (blocked.length === list.length && list.every(d => d.loadId === list[0].loadId)) {
    return { paired: true, why: 'Paired by default: ' + (list.length === 2 ? 'both datasets come' : 'these datasets all come') + ' from one file whose replication column is marked as blocks.' };
  }
  return { paired: false, why: 'Independent by default: blocks are matched only among datasets from one file whose replication column is marked as blocks, and ' +
    (list.length === 2 ? 'these two do' : 'these do') + ' not all come from one such file. Choose Paired if their replications do correspond.' };
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
 * The row label for a design in a Two Systems figure: its role letter, and
 * then in parentheses the dataset's name with any prefix the two names share
 * dropped ("file · fast" and "file · slow" become "A (fast)" and "B (slow)").
 * The letter is never dropped, even when the name is itself a letter: a
 * dataset named "C" in the B role reads "B (C)", and one named "A" in the A
 * role reads "A (A)", so that no row can be read as a difference of two
 * designs or as a role it does not hold.
 * @param {{name: string}} dsA
 * @param {{name: string}} dsB
 * @returns {[string, string]}
 */
export function roleLabels(dsA, dsB) {
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const pa = cut(dsA.name), pb = cut(dsB.name);
  const shared = pa && pb && pa[0] === pb[0] && pa[1] !== pb[1];
  const na = shared ? pa[1] : dsA.name, nb = shared ? pb[1] : dsB.name;
  return ['A (' + na + ')', 'B (' + nb + ')'];
}

/**
 * The axis label for a dataset's replication outcomes on One System, or for
 * its observations under the pooled override. Under a transform the label
 * names it ("Log of replication mean of wait"); the pooled observations are
 * never transformed.
 * @param {{kind: string, response?: string}|null} ds
 * @param {boolean} [pooled]
 * @param {string} [tf] the transform's id
 */
export function outcomeAxis(ds, pooled, tf = 'none') {
  if (!ds) return transformLabel('Replication outcome', tf);
  const r = ds.response || 'value';
  if (pooled) return 'Observation of ' + r;
  if (ds.kind === 'reps') return transformLabel(r + ' per replication', tf);
  if (ds.kind === 'time') return transformLabel('Time-weighted replication mean of ' + r, tf);
  return transformLabel('Replication mean of ' + r, tf);
}

/**
 * The axis label for a dataset's replication outcomes on Summary and Plots,
 * naming the transform when one is given.
 * @param {{kind: string, response: string}} ds
 * @param {string} [tf] the transform's id
 */
export function estimateAxis(ds, tf = 'none') {
  if (ds.kind === 'reps') return transformLabel(ds.response, tf);
  if (ds.kind === 'time') return transformLabel('Time-weighted replication mean of ' + ds.response, tf);
  return transformLabel('Replication mean of ' + ds.response, tf);
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

// Why a Several Systems section, or the nonparametric Procedure, is unavailable.
const NEED_TWO = 'Needs two or more checked designs.';
const SCREEN_NO_RANK = 'The screen for the best has no nonparametric version. Choose “t procedures” under Procedure to use it.';
const RANK_NOT_HERE = 'Unavailable in Screen for the best, which has no nonparametric version. Open another section to use the rank procedures.';

/**
 * The sections of Several Systems that cannot be opened, each with the
 * reason its grayed link gives, or null when every section can: with one
 * checked design, those that compare designs, and under the rank procedures
 * the screen for the best, which has no rank version.
 * @param {{k: number, proc: 't'|'np'}} o k is the number of checked designs
 * @returns {Object<string, string>|null}
 */
export function severalSectionsOff({ k, proc }) {
  if (k === 1) return { diffs: NEED_TWO, anova: NEED_TWO, subset: NEED_TWO };
  return proc === 'np' ? { subset: SCREEN_NO_RANK } : null;
}

/**
 * Why Several Systems' Procedure switch withholds its nonparametric setting
 * while `section` is open, or null when it offers it: the screen for the
 * best has no rank version, and so the two are never chosen together.
 * @param {string|null} section
 * @returns {string|null}
 */
export function rankProcWithheld(section) {
  return section === 'subset' ? RANK_NOT_HERE : null;
}

/**
 * How the Distribution section bins a histogram of `values`, given the reader's
 * stored choice `pick` ({ mode: 'value' | 'width', bins }, or nothing). A bar per
 * value is offered whenever it takes at most VALUE_BINS_MAX bars (`canValue`), and
 * is the default when the values look discrete by `looksDiscrete`; otherwise, and
 * on request, the bins are equal-width, `bins` of them, Sturges' rule unless the
 * reader set a count, kept in the slider's range.
 * @param {ArrayLike<number>} values
 * @param {{mode?: string, bins?: number}|null|undefined} pick
 * @returns {{perValue: boolean, bins: number, canValue: boolean, discrete: boolean,
 *   rule: 'count'|'few'|null, nUnique: number, auto: boolean}}
 *   `auto` says the bin count is Sturges' rather than the reader's.
 */
export function histChoice(values, pick) {
  const info = looksDiscrete(values);
  const canValue = info.nUnique >= 1 && info.bars <= VALUE_BINS_MAX;
  const mode = pick && (pick.mode === 'width' || pick.mode === 'value') ? pick.mode : info.discrete ? 'value' : 'width';
  const asked = pick && Number.isFinite(pick.bins) && pick.bins > 0 ? Math.round(pick.bins) : null;
  const bins = asked ? Math.max(HIST_BINS_MIN, Math.min(HIST_BINS_MAX, asked)) : sturgesBins(values.length);
  return { perValue: mode === 'value' && canValue, bins, canValue, discrete: info.discrete, rule: info.rule, nUnique: info.nUnique, auto: !asked };
}

/**
 * The multiples of the correlogram's crossing lag (`bandCrossing` in
 * js/stats/steadystate.js) that the batch-size check reads: a batch shorter
 * than BATCH_SHORT_FACTOR times the lag is too short, and BATCH_TARGET_FACTOR
 * times it is the cautious target that the suggested run aims at.
 */
export const BATCH_SHORT_FACTOR = 3;
export const BATCH_TARGET_FACTOR = 10;

/**
 * How the batches compare with the crossing lag, and the run that would give
 * batches of the cautious target length. Every length is in the series' own
 * units: observations, or time units for time-persistent data.
 * @param {{size: number, b: number, span: number, crossing: number|null, maxLag: number, integer: boolean}} o
 *   `size` and `b` are the batches' size and count, `span` the length of the
 *   series batched, `crossing` the crossing lag (null when no lag shown is
 *   inside the band), `maxLag` the last lag shown, and `integer` says that a
 *   size is a whole number of observations
 * @returns {null | {tier: 'short'|'check'|'ok'|'unknown', ratio: number, beyond: boolean, lag: number,
 *   target: {size: number, b: number, run: number}, fits: number, many: boolean}}
 *   `tier` is 'short' under BATCH_SHORT_FACTOR, 'check' under
 *   BATCH_TARGET_FACTOR, and 'ok' from there up; with no crossing shown
 *   (`beyond`), `lag` is the last lag shown and `ratio` an upper bound, and
 *   so the batches are 'short' when even that bound is short and 'unknown'
 *   otherwise. `target` is BATCH_TARGET_FACTOR times `lag` rounded up to two
 *   significant figures, the count kept between 10 and 30, and the run they
 *   take; `fits` is how many target-size batches this series holds; `many`
 *   flags more than 30 batches. Null without a batch size or a correlogram.
 */
export function batchGuidance({ size, b, span, crossing, maxLag, integer }) {
  if (!(size > 0) || !(maxLag > 0)) return null;
  const beyond = crossing == null;
  const lag = beyond ? maxLag : crossing;
  const ratio = size / lag;
  const tier = beyond ? (ratio < BATCH_SHORT_FACTOR ? 'short' : 'unknown')
    : ratio < BATCH_SHORT_FACTOR ? 'short' : ratio < BATCH_TARGET_FACTOR ? 'check' : 'ok';
  const tSize = roundUpTwoFigures(BATCH_TARGET_FACTOR * lag, integer);
  const tb = Math.min(30, Math.max(10, b));
  return { tier, ratio, beyond, lag, target: { size: tSize, b: tb, run: tb * tSize }, fits: Math.floor(span / tSize + 1e-9), many: b > 30 };
}

function roundUpTwoFigures(x, integer) {
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  const v = Number((Math.ceil(x / p - 1e-9) * p).toPrecision(12));
  return integer ? Math.max(1, Math.ceil(v)) : v;
}
