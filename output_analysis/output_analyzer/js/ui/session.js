// Session restore: the loaded datasets and the shared settings are written to
// localStorage (through ui/store.js) after every change and read back at
// boot, and so a reload or an accidental close does not lose the data. The
// stored value is validated field by field on the way back in: anything that
// does not have the shape a dataset needs is dropped rather than trusted.
// Correctness never depends on storage; when it is unavailable, or the data
// are too large to keep, the page works on what it holds in memory.

import * as state from '../state.js';
import { makeDataset } from '../data/model.js';
import { save, load, removeKey, available } from './store.js';

/** The store key; ui/store.js prefixes it, giving "output-analyzer:session". */
export const SESSION_KEY = 'session';

/** The largest serialized session, in characters, that is written to storage. */
export const MAX_CHARS = 4 * 1024 * 1024;

const KINDS = ['tally', 'time', 'reps'];

/**
 * @typedef {{ available: boolean, saved: boolean, chars: number,
 *   skipped: null | 'too-large' | 'write-failed', restored: number, dropped: number }} SessionStatus
 */

/** @type {SessionStatus} */
const status = { available: false, saved: false, chars: 0, skipped: null, restored: 0, dropped: 0 };
let warned = false;
let suspended = false;
let scheduled = false;
let installed = false;

function announce() {
  state.emit('session', sessionStatus());
}

function plainArray(a) {
  // JSON writes NaN and ±Infinity as null; restoreArray turns null back into NaN.
  return a ? Array.from(a) : null;
}

function serializeDataset(ds) {
  return {
    id: ds.id,
    name: ds.name,
    response: ds.response,
    unit: ds.unit,
    kind: ds.kind,
    endTime: ds.endTime,
    source: ds.source,
    issues: ds.issues,
    derivedFrom: ds.derivedFrom,
    reps: ds.reps.map(r => ({ id: r.id, t: plainArray(r.t), v: plainArray(r.v) }))
  };
}

/**
 * The current status of session storage: whether it is available, whether
 * the last save succeeded, the size of the stored session in characters, why
 * a save was skipped, and how many datasets the last restore brought back or
 * dropped. The 'session' state event carries the same object.
 * @returns {SessionStatus}
 */
export function sessionStatus() {
  status.available = available();
  return Object.assign({}, status);
}

/**
 * Writes the loaded datasets and the settings to storage. A session larger
 * than MAX_CHARS is not written, and any older stored session is removed so
 * that a reload never brings back a set of data that no longer matches the
 * page; a one-time console warning says so.
 * @returns {SessionStatus}
 */
export function saveSession() {
  if (!available()) {
    status.saved = false;
    status.skipped = null;
    status.chars = 0;
    announce();
    return sessionStatus();
  }
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    settings: { level: state.settings.level, base: state.settings.base, bonfC: state.settings.bonfC, custom: state.settings.custom, transform: state.settings.transform },
    selected: state.selected(),
    picks: state.picks,
    datasets: state.datasets.map(serializeDataset)
  };
  let text;
  try {
    text = JSON.stringify(payload);
  } catch (err) {
    text = null;
  }
  if (text === null || text.length > MAX_CHARS) {
    removeKey(SESSION_KEY);
    status.saved = false;
    status.skipped = 'too-large';
    status.chars = text === null ? 0 : text.length;
    if (!warned) {
      warned = true;
      console.warn('The loaded data are too large to keep for session restore (' +
        Math.round(status.chars / 1024) + ' KB, over the ' + Math.round(MAX_CHARS / 1024) +
        ' KB limit); they stay in memory until the page is closed.');
    }
    announce();
    return sessionStatus();
  }
  const ok = save(SESSION_KEY, payload);
  if (!ok) removeKey(SESSION_KEY);
  status.saved = ok;
  status.skipped = ok ? null : 'write-failed';
  status.chars = text.length;
  announce();
  return sessionStatus();
}

// Coalesces the burst of events one import can raise (a scenario column adds
// one dataset per scenario) into a single write at the end of the task.
function scheduleSave() {
  if (suspended || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!suspended) saveSession();
  });
}

const isStr = x => typeof x === 'string';
const isFiniteNum = x => typeof x === 'number' && Number.isFinite(x);

// A stored numeric vector: an array of numbers, with null standing for a
// value JSON could not write. Anything else is rejected.
function restoreArray(a) {
  if (!Array.isArray(a)) return null;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === null) out[i] = NaN;
    else if (typeof x === 'number') out[i] = x;
    else return null;
  }
  return out;
}

function restoreRep(r, kind) {
  if (!r || typeof r !== 'object') return null;
  if (!(isStr(r.id) || isFiniteNum(r.id))) return null;
  const v = restoreArray(r.v);
  if (!v || v.length === 0) return null;
  let t = null;
  if (r.t !== null && r.t !== undefined) {
    t = restoreArray(r.t);
    if (!t || t.length !== v.length) return null;
  }
  if (kind === 'time' && !t) return null;
  return { id: r.id, t, v };
}

function restoreDerived(d) {
  if (!d || typeof d !== 'object' || !isStr(d.id)) return null;
  const tr = d.truncate;
  if (!tr || (tr.by !== 'time' && tr.by !== 'index') || !isFiniteNum(tr.at)) return null;
  return { id: d.id, truncate: { by: tr.by, at: tr.at } };
}

function restoreDataset(o) {
  if (!o || typeof o !== 'object') return null;
  if (!isStr(o.id) || !o.id || !KINDS.includes(o.kind) || !Array.isArray(o.reps) || !o.reps.length) return null;
  const reps = [];
  for (const r of o.reps) {
    const rr = restoreRep(r, o.kind);
    // One malformed replication would silently change every estimate, and so
    // the whole dataset is dropped rather than kept without it.
    if (!rr) return null;
    reps.push(rr);
  }
  const src = o.source && typeof o.source === 'object' ? o.source : {};
  const issues = Array.isArray(o.issues)
    ? o.issues.filter(it => it && typeof it === 'object' && isFiniteNum(it.line) && isStr(it.reason))
      .map(it => ({ line: it.line, text: isStr(it.text) ? it.text : '', reason: it.reason }))
    : [];
  return makeDataset({
    id: o.id,
    name: isStr(o.name) && o.name ? o.name : 'data',
    response: isStr(o.response) && o.response ? o.response : 'value',
    unit: isStr(o.unit) ? o.unit : '',
    kind: o.kind,
    reps,
    endTime: isFiniteNum(o.endTime) ? o.endTime : null,
    source: {
      file: isStr(src.file) ? src.file : '',
      format: isStr(src.format) ? src.format : '',
      notes: Array.isArray(src.notes) ? src.notes.filter(isStr) : []
    },
    issues,
    derivedFrom: restoreDerived(o.derivedFrom)
  });
}

/**
 * Reads the stored session and adds every dataset that passes validation
 * through `state.add`, with its id, and restores the confidence level and
 * every page's remembered settings (`state.picks`), which are set before the
 * datasets and again after them, followed by one more 'datasets' event of
 * type 'restore'.
 * Datasets whose id is already loaded are skipped. Never throws: a missing,
 * unreadable, or malformed stored value restores nothing, and a malformed
 * dataset inside an otherwise good one is dropped on its own.
 * @returns {{ restored: number, dropped: number }}
 */
export function restoreSession() {
  let restored = 0, dropped = 0;
  const restoredPicks = [];
  suspended = true;
  try {
    const stored = available() ? load(SESSION_KEY) : null;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      // Picks come back before the datasets, and so a picker rebuilding itself on
      // the 'datasets' events below finds its remembered choice waiting.
      if (stored.picks && typeof stored.picks === 'object' && !Array.isArray(stored.picks)) {
        for (const page of Object.keys(stored.picks)) {
          const bag = stored.picks[page];
          if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
          for (const key of Object.keys(bag)) {
            const v = bag[key];
            const okScalar = isStr(v) || typeof v === 'number' || typeof v === 'boolean';
            const okList = Array.isArray(v) && v.every(isStr);
            if (okScalar || okList) { state.setPick(page, key, v); restoredPicks.push([page, key, v]); }
          }
        }
      }
      if (Array.isArray(stored.datasets)) {
        const seen = new Set(state.datasets.map(d => d.id));
        for (const o of stored.datasets) {
          let ds = null;
          try { ds = restoreDataset(o); } catch (err) { ds = null; }
          if (!ds || seen.has(ds.id)) { dropped++; continue; }
          seen.add(ds.id);
          state.add(ds);
          restored++;
        }
      }
      if (stored.settings && typeof stored.settings === 'object') {
        const st = stored.settings;
        if (st.custom && Number.isFinite(st.base)) state.setCustomLevel(st.base, Number.isFinite(st.bonfC) ? st.bonfC : 1);
        else state.setLevel(st.level);
        if (isStr(st.transform)) state.setTransform(st.transform);
      }
      if (isStr(stored.selected)) state.select(stored.selected);
      // The datasets arrive one at a time, and a page answering the first
      // ones (a picker falling back to the first dataset, a page following the
      // selection) can overwrite a pick that names a dataset still to come.
      // Once all of them are back, the stored picks are set again and every
      // page is told once more, and so each settles on what was stored.
      if (restored > 0) {
        for (const [page, key, v] of restoredPicks) state.setPick(page, key, v);
        state.emit('datasets', { type: 'restore' });
      }
    }
  } catch (err) {
    // A failure part way leaves whatever was restored in place; the page
    // works on it, and the next save writes it back consistently.
  } finally {
    suspended = false;
  }
  status.restored = restored;
  status.dropped = dropped;
  return { restored, dropped };
}

/**
 * Restores the stored session and then saves after every 'datasets' and
 * 'settings' event. Called once at boot; later calls do nothing.
 * @returns {{ restored: number, dropped: number }}
 */
export function initSession() {
  if (installed) return { restored: status.restored, dropped: status.dropped };
  installed = true;
  const r = restoreSession();
  state.on('datasets', scheduleSave);
  state.on('settings', scheduleSave);
  state.on('picks', scheduleSave);
  // Writing once now drops anything the restore rejected from storage and
  // records the stored size for the Export page.
  saveSession();
  return r;
}

/**
 * Forgets the session: removes every loaded dataset, every stored result, and
 * every page's remembered settings, and then removes the stored session.
 * Saving resumes with the next dataset loaded.
 */
export function forgetSession() {
  suspended = true;
  try {
    for (const id of state.datasets.map(d => d.id)) state.remove(id);
    for (const k of Object.keys(state.results)) if (state.results[k]) state.setResult(k, null);
    // Emptied in place, after the removals, because a picker answering a
    // removal records its new (empty) value.
    for (const page of Object.keys(state.picks)) delete state.picks[page];
    state.emit('picks', { pageId: null, key: null });
  } finally {
    suspended = false;
  }
  removeKey(SESSION_KEY);
  status.saved = false;
  status.skipped = null;
  status.chars = 0;
  status.restored = 0;
  status.dropped = 0;
  announce();
}
