// The application's shared state: the loaded datasets, the one a page last
// selected, and the settings every page reads (the confidence level). Pages
// read `datasets` and `settings` directly and subscribe to changes with `on`.
// The array and the settings object are mutated in place and never replaced,
// and so a reference taken at import time stays current.

/** @typedef {import('./data/model.js').Dataset} Dataset */

/** Every loaded dataset, in the order it was added. */
export const datasets = [];

/** Settings shared by every page. `level` is 0.90, 0.95, or 0.99. */
export const settings = { level: 0.95 };

/** The confidence levels the page offers. */
export const LEVELS = [0.90, 0.95, 0.99];

let selectedId = null;
let counter = 0;
const listeners = { datasets: new Set(), selection: new Set(), settings: new Set(), results: new Set(), picks: new Set() };

/**
 * Subscribes to an event: 'datasets' (added, removed, renamed), 'selection'
 * (the selected dataset changed), 'settings' (the level changed), or
 * 'results' (a page stored a new result).
 * @param {'datasets'|'selection'|'settings'|'results'|'picks'} event
 * @param {(payload: *) => void} fn
 * @returns {() => void} a function that unsubscribes
 */
export function on(event, fn) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
}

/**
 * Calls every listener of `event` with `payload`. One failing listener does
 * not stop the others; its error is reported on the console.
 * @param {string} event
 * @param {*} [payload]
 */
export function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(payload); } catch (err) { console.error(err); }
  }
}

/**
 * Adds a dataset (or replaces the one with the same id) and emits 'datasets'.
 * A dataset without an id is given one.
 * @param {Dataset} ds
 * @returns {Dataset}
 */
export function add(ds) {
  if (!ds.id) ds.id = 'ds-' + Date.now().toString(36) + '-' + (++counter);
  const i = datasets.findIndex(d => d.id === ds.id);
  if (i >= 0) datasets[i] = ds; else datasets.push(ds);
  emit('datasets', { type: 'add', id: ds.id });
  return ds;
}

/**
 * Removes a dataset by id and emits 'datasets'; clears the selection, with a
 * 'selection' event, when it was the selected one.
 * @param {string} id
 * @returns {boolean} whether a dataset was removed
 */
export function remove(id) {
  const i = datasets.findIndex(d => d.id === id);
  if (i < 0) return false;
  datasets.splice(i, 1);
  emit('datasets', { type: 'remove', id });
  if (selectedId === id) { selectedId = null; emit('selection', null); }
  return true;
}

/**
 * Renames a dataset's display name and emits 'datasets'.
 * @param {string} id
 * @param {string} name
 * @returns {boolean} whether the dataset exists
 */
export function rename(id, name) {
  const ds = get(id);
  if (!ds) return false;
  ds.name = String(name);
  emit('datasets', { type: 'rename', id });
  return true;
}

/**
 * The dataset with this id, or null.
 * @param {string} id
 * @returns {Dataset|null}
 */
export function get(id) {
  return datasets.find(d => d.id === id) || null;
}

/**
 * Marks a dataset as the selected one (null clears) and emits 'selection'.
 * @param {string|null} id
 */
export function select(id) {
  const next = id && get(id) ? id : null;
  if (next === selectedId) return;
  selectedId = next;
  emit('selection', selectedId);
}

/**
 * The selected dataset's id, or null.
 * @returns {string|null}
 */
export function selected() { return selectedId; }

/**
 * Sets the confidence level shared by every page and emits 'settings'.
 * Values other than 0.90, 0.95, and 0.99 are ignored.
 * @param {number} level
 * @returns {boolean} whether the level was accepted
 */
export function setLevel(level) {
  const v = Number(level);
  const hit = LEVELS.find(l => Math.abs(l - v) < 1e-9);
  if (hit === undefined) return false;
  if (settings.level !== hit) {
    settings.level = hit;
    emit('settings', { level: hit });
  }
  return true;
}

/**
 * The latest result of every analysis page, keyed by page id, so the Export
 * page can write out what the reader has computed. A page stores its result
 * whenever it recomputes and stores null when its inputs no longer allow one.
 * @typedef {{ title: string, provenance: Object<string, string|number>,
 *   tables: {name: string, headers: string[], rows: (string|number)[][]}[],
 *   summaryHtml?: string }} PageResult
 * @type {Object<string, PageResult|null>}
 */
export const results = {};

/**
 * What each page's pickers hold, keyed by page id and then by the picker's
 * own key (a dataset id, a mode name, a list of ids), so a reload brings a
 * page back on the datasets it was looking at. Saved with the session.
 * @type {Object<string, Object<string, *>>}
 */
export const picks = {};

/**
 * Records a picker's choice for a page and emits 'picks'. A null value
 * removes the entry.
 * @param {string} pageId
 * @param {string} key
 * @param {*} value a string, number, boolean, or array of strings
 */
export function setPick(pageId, key, value) {
  const bag = picks[pageId] || (picks[pageId] = {});
  if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
  emit('picks', { pageId, key });
}

/**
 * A page's recorded choice, or `undefined` when none is stored.
 * @param {string} pageId
 * @param {string} key
 */
export function getPick(pageId, key) {
  const bag = picks[pageId];
  return bag ? bag[key] : undefined;
}

/**
 * Stores a page's latest result (or null) and emits 'results'.
 * @param {string} pageId
 * @param {PageResult|null} result
 */
export function setResult(pageId, result) {
  if (result && typeof result === 'object' && !(result.computedAt instanceof Date)) result.computedAt = new Date();
  results[pageId] = result;
  emit('results', { pageId });
}

/** The same API as one object, for `import state from './state.js'`. */
const state = { datasets, settings, LEVELS, results, picks, on, emit, add, remove, rename, get, select, selected, setLevel, setResult, setPick, getPick };
export default state;
