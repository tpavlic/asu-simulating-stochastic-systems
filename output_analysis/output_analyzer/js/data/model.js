// The dataset model: replications of tally, time-persistent, or
// replication-level output, the replication outcomes every inference page
// works on, and truncation into derived datasets. Pure functions, no DOM.

/** @typedef {{ id: string|number, t: Float64Array|null, v: Float64Array }} Replication */
/** @typedef {{
 *   id: string, name: string, response: string, unit: string,
 *   kind: 'tally' | 'time' | 'reps',
 *   reps: Replication[],
 *   endTime: number|null,
 *   source: { file: string, format: string, notes: string[] },
 *   issues: { line: number, text: string, reason: string }[],
 *   derivedFrom: { id: string, truncate: { by: 'time'|'index', at: number } } | null
 * }} Dataset */

let idCounter = 0;

/**
 * A fresh dataset id: a session counter plus a random suffix, so that ids
 * restored from storage in a later session do not collide with new ones.
 * @returns {string}
 */
export function newId() {
  idCounter += 1;
  return 'ds' + idCounter + '-' + Math.random().toString(36).slice(2, 8);
}

function mean(a) {
  if (!a.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

// Quantile of a sorted array by R's default (type 7) rule.
function quantile7(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

function summary(a) {
  const n = a.length;
  const m = mean(a);
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (a[i] - m) * (a[i] - m);
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
  const s = Float64Array.from(a).sort();
  return {
    n, mean: m, sd, se: sd / Math.sqrt(n),
    min: n ? s[0] : NaN, q1: quantile7(s, 0.25), median: quantile7(s, 0.5),
    q3: quantile7(s, 0.75), max: n ? s[n - 1] : NaN
  };
}

// The record at t[i] holds on [t[i], t[i+1]) and the last one until endTime;
// with no endTime the last record holds for no time. Durations are clipped
// at endTime. NaN when no record holds for a positive duration.
function timeWeightedMean(t, v, endTime) {
  const n = v.length;
  const end = endTime == null ? (n ? t[n - 1] : NaN) : endTime;
  let area = 0, dur = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.min(t[i], end);
    const b = Math.min(i + 1 < n ? t[i + 1] : end, end);
    const d = b - a;
    if (d > 0) { area += d * v[i]; dur += d; }
  }
  return dur > 0 ? area / dur : NaN;
}

function toF64(a) {
  if (a == null) return null;
  return a instanceof Float64Array ? a : Float64Array.from(a);
}

/**
 * Build a dataset from partial fields, filling defaults, converting each
 * replication's vectors to Float64Array, and assigning an id (the given one,
 * or a new one from `newId`).
 * @param {Partial<Dataset> & { reps?: { id?: string|number, t?: ArrayLike<number>|null, v: ArrayLike<number> }[] }} fields
 * @returns {Dataset}
 */
export function makeDataset(fields = {}) {
  const src = fields.source || {};
  return {
    id: fields.id != null ? fields.id : newId(),
    name: fields.name != null ? fields.name : 'data',
    response: fields.response != null ? fields.response : 'value',
    unit: fields.unit != null ? fields.unit : '',
    kind: fields.kind || 'tally',
    reps: (fields.reps || []).map((r, i) => ({
      id: r.id != null ? r.id : i + 1,
      t: toF64(r.t),
      v: toF64(r.v) || new Float64Array(0)
    })),
    endTime: fields.endTime != null ? fields.endTime : null,
    source: {
      file: src.file != null ? src.file : '',
      format: src.format != null ? src.format : '',
      notes: (src.notes || []).slice()
    },
    issues: (fields.issues || []).slice(),
    derivedFrom: fields.derivedFrom || null
  };
}

/**
 * The replication ids, in replication order.
 * @param {Dataset} ds
 * @returns {(string|number)[]}
 */
export function repIds(ds) {
  return ds.reps.map(r => r.id);
}

/**
 * One estimate per replication: the plain mean of a tally replication, the
 * time-weighted mean of a time-persistent one, and the single value of a
 * replication-level one. NaN marks a replication with no estimate (no
 * observations, or no covered duration).
 * @param {Dataset} ds
 * @returns {Float64Array}
 */
export function repEstimates(ds) {
  const out = new Float64Array(ds.reps.length);
  ds.reps.forEach((r, i) => {
    if (ds.kind === 'time') out[i] = timeWeightedMean(r.t, r.v, ds.endTime);
    else if (ds.kind === 'reps') out[i] = r.v.length ? r.v[0] : NaN;
    else out[i] = mean(r.v);
  });
  return out;
}

/**
 * Every observation, concatenated across replications. Throws for a
 * time-persistent dataset, whose raw values carry no meaning without their
 * durations.
 * @param {Dataset} ds
 * @returns {Float64Array}
 */
export function observations(ds) {
  if (ds.kind === 'time') {
    throw new Error('A time-persistent dataset has no plain observations: each value counts in proportion to how long it holds.');
  }
  let n = 0;
  for (const r of ds.reps) n += r.v.length;
  const out = new Float64Array(n);
  let k = 0;
  for (const r of ds.reps) { out.set(r.v, k); k += r.v.length; }
  return out;
}

/**
 * The time-weighted mean over every replication of a time-persistent
 * dataset: the total area under the state over the total time covered, each
 * record holding until the next and the last until the end time (for no time
 * without one), clipped at the end time. The mean is NaN when no time is covered.
 * @param {Dataset} ds
 * @returns {{mean: number, duration: number}}
 */
export function timeWeightedOverall(ds) {
  let area = 0, dur = 0;
  for (const r of ds.reps) {
    const n = r.v.length;
    if (!n) continue;
    const end = ds.endTime == null ? r.t[n - 1] : ds.endTime;
    for (let i = 0; i < n; i++) {
      const a = Math.min(r.t[i], end), b = Math.min(i + 1 < n ? r.t[i + 1] : end, end);
      if (b > a) { area += (b - a) * r.v[i]; dur += b - a; }
    }
  }
  return { mean: dur > 0 ? area / dur : NaN, duration: dur };
}

/**
 * Counts and descriptives for the summary card. `est` summarizes the finite
 * replication outcomes and is null when there are none. `tRange` spans the
 * recorded times and is null when no replication carries times.
 * @param {Dataset} ds
 * @returns {{ kind: string, nObs: number, nReps: number,
 *   perRep: { min: number, max: number, equal: boolean },
 *   tRange: [number, number]|null, issueCount: number,
 *   issues: { line: number, text: string, reason: string }[],
 *   est: { n: number, mean: number, sd: number, se: number, min: number, q1: number,
 *          median: number, q3: number, max: number }|null }}
 */
export function datasetSummary(ds) {
  let nObs = 0, lo = Infinity, hi = -Infinity, pmin = Infinity, pmax = -Infinity, anyT = false;
  for (const r of ds.reps) {
    const n = r.v.length;
    nObs += n;
    if (n < pmin) pmin = n;
    if (n > pmax) pmax = n;
    if (r.t) {
      for (let i = 0; i < r.t.length; i++) {
        anyT = true;
        if (r.t[i] < lo) lo = r.t[i];
        if (r.t[i] > hi) hi = r.t[i];
      }
    }
  }
  const nReps = ds.reps.length;
  const finite = Array.from(repEstimates(ds)).filter(Number.isFinite);
  return {
    kind: ds.kind,
    nObs,
    nReps,
    perRep: nReps ? { min: pmin, max: pmax, equal: pmin === pmax } : { min: 0, max: 0, equal: true },
    tRange: anyT ? [lo, hi] : null,
    issueCount: ds.issues.length,
    issues: ds.issues,
    est: finite.length >= 1 ? summary(finite) : null
  };
}

/**
 * A new dataset with the observations before a cut removed from every
 * replication. `by: 'index'` drops the first `at` observations (or records);
 * `by: 'time'` drops those recorded before time `at`. For time-persistent
 * data cut by time, the state in force at `at` becomes the first record, at
 * t = at, and so the time average after the cut counts it. A replication
 * with nothing left after the cut is dropped and named in `source.notes`.
 * @param {Dataset} ds
 * @param {{ by: 'index'|'time', at: number }} cut
 * @returns {Dataset}
 */
export function truncateDataset(ds, { by, at }) {
  if (ds.kind === 'reps') {
    throw new Error('A dataset of one value per replication has no observations within a replication to truncate.');
  }
  if (by !== 'index' && by !== 'time') throw new Error('Truncate by "index" or by "time".');
  if (!(at >= 0)) throw new Error('The truncation point must be a nonnegative number.');
  const notes = ds.source.notes.slice();
  const reps = [];
  for (const r of ds.reps) {
    let t = null, v;
    if (by === 'index') {
      const k = Math.floor(at);
      v = r.v.slice(k);
      if (r.t) t = r.t.slice(k);
    } else {
      if (!r.t) throw new Error('Replication ' + r.id + ' has no times, and so it cannot be truncated by time.');
      if (ds.kind === 'time') {
        const n = r.v.length;
        const coverEnd = ds.endTime != null ? ds.endTime : (n ? r.t[n - 1] : -Infinity);
        let last = -1;
        while (last + 1 < n && r.t[last + 1] <= at) last++;
        if (coverEnd <= at) {
          v = new Float64Array(0);
          t = new Float64Array(0);
        } else {
          const tt = [], vv = [];
          if (last >= 0) { tt.push(at); vv.push(r.v[last]); }
          for (let i = last + 1; i < n; i++) { tt.push(r.t[i]); vv.push(r.v[i]); }
          t = Float64Array.from(tt);
          v = Float64Array.from(vv);
        }
      } else {
        const keep = [];
        for (let i = 0; i < r.v.length; i++) if (r.t[i] >= at) keep.push(i);
        t = Float64Array.from(keep, i => r.t[i]);
        v = Float64Array.from(keep, i => r.v[i]);
      }
    }
    if (v.length === 0) {
      notes.push('Replication ' + r.id + ' ends before the cut at ' + at + ' and was dropped.');
      continue;
    }
    reps.push({ id: r.id, t, v });
  }
  const suffix = by === 'time'
    ? ' (after warm-up at ' + at + ')'
    : ' (after ' + at + ' observations)';
  return makeDataset({
    name: ds.name + suffix,
    response: ds.response,
    unit: ds.unit,
    kind: ds.kind,
    reps,
    endTime: ds.endTime,
    source: { file: ds.source.file, format: ds.source.format, notes },
    issues: ds.issues,
    derivedFrom: { id: ds.id, truncate: { by, at } }
  });
}

/**
 * Whether the replication outcomes support an interval or a test: at least
 * two replications must yield an estimate. The reason, when refused, is a
 * sentence for the page to show.
 * @param {Dataset} ds
 * @returns {{ ok: boolean, reason?: string }}
 */
/**
 * How a truncated dataset relates to the run it was cut from. The result's
 * `base` is the nearest loaded ancestor the dataset is a truncation of (the
 * dataset itself when it is not one, or its source is gone), `fence` the cut
 * on that run that yields this dataset (0 when base is the dataset itself),
 * and `by` how it was cut, or null. A chain of cuts is followed while each
 * link is loaded, keeps the kind, and cuts the same way as the first: index
 * cuts add up, and time cuts are absolute, and so the latest one stands.
 * @param {object} ds
 * @param {(id: string) => object|undefined} lookup a dataset by id
 * @returns {{ base: object, fence: number, by: ('index'|'time')|null }}
 */
export function truncationView(ds, lookup) {
  let base = ds, fence = 0, by = null;
  while (base.derivedFrom && base.derivedFrom.truncate) {
    const tr = base.derivedFrom.truncate;
    const parent = lookup(base.derivedFrom.id);
    if (!parent || parent.kind !== ds.kind || !(tr.at > 0) || (by && tr.by !== by)) break;
    by = tr.by;
    fence = tr.by === 'index' ? fence + Math.floor(tr.at) : Math.max(fence, tr.at);
    base = parent;
  }
  return by ? { base, fence, by } : { base: ds, fence: 0, by: null };
}

/**
 * The state of one time-persistent replication at each of ascending sample
 * times: the value of the last record at or before the time, and null before
 * the replication's first record or after its last, where nothing holds.
 * @param {Replication} rep
 * @param {ArrayLike<number>} times ascending
 * @returns {(number|null)[]}
 */
export function sampleStep(rep, times) {
  const t = rep.t, v = rep.v, n = v.length;
  const out = new Array(times.length).fill(null);
  if (!t || !n) return out;
  let i = 0;
  for (let k = 0; k < times.length; k++) {
    const s = times[k];
    if (s < t[0] || s > t[n - 1]) continue;
    while (i + 1 < n && t[i + 1] <= s) i++;
    out[k] = v[i];
  }
  return out;
}

/**
 * A time-persistent dataset sampled on a time grid, every `step` from
 * `start` up to `end` (included when it falls on the grid), one column per
 * replication, with at most `max` sample times.
 * @param {Dataset} ds
 * @param {{ start: number, step: number, end: number, max?: number }} grid
 * @returns {{ times: number[], columns: { id: string|number, values: (number|null)[] }[], capped: boolean }}
 */
export function sampleDataset(ds, { start, step, end, max = Infinity }) {
  if (ds.kind !== 'time') throw new Error('Only a time-persistent dataset is sampled on a time grid.');
  if (!(step > 0)) throw new Error('The sampling step must be positive.');
  if (!(end >= start)) throw new Error('The grid ends before it starts.');
  const want = Math.floor((end - start) / step + 1e-9) + 1;
  const n = Math.min(want, max);
  const times = [];
  for (let k = 0; k < n; k++) times.push(start + k * step);
  return { times, columns: ds.reps.map(r => ({ id: r.id, values: sampleStep(r, times) })), capped: n < want };
}

/**
 * Whether two datasets hold the same data: the same kind and response, the
 * same end time, and replication for replication the same id, times, and
 * values. Names, sources, and ids may differ; a file loaded twice is the case.
 * @param {Dataset} a
 * @param {Dataset} b
 * @returns {boolean}
 */
export function sameData(a, b) {
  if (a.kind !== b.kind || a.response !== b.response || a.reps.length !== b.reps.length) return false;
  if ((a.endTime == null) !== (b.endTime == null) || (a.endTime != null && a.endTime !== b.endTime)) return false;
  const eq = (x, y) => {
    if ((x == null) !== (y == null)) return false;
    if (x == null) return true;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !(Number.isNaN(x[i]) && Number.isNaN(y[i]))) return false;
    return true;
  };
  for (let r = 0; r < a.reps.length; r++) {
    const p = a.reps[r], q = b.reps[r];
    if (String(p.id) !== String(q.id) || !eq(p.t, q.t) || !eq(p.v, q.v)) return false;
  }
  return true;
}

export function canInfer(ds) {
  const nEst = Array.from(repEstimates(ds)).filter(Number.isFinite).length;
  if (nEst >= 2) return { ok: true };
  if (ds.reps.length === 1 && ds.kind !== 'reps') {
    const n = ds.reps[0].v.length;
    return {
      ok: false,
      reason: 'This dataset has one replication, which gives one outcome. Its ' + n.toLocaleString('en-US') +
        (n === 1 ? ' observation comes' : ' observations come') +
        ' from a single run and are not independent replications. An interval or a test needs at least two replication outcomes; for one long run, batch means is the alternative.'
    };
  }
  return {
    ok: false,
    reason: 'An interval or a test needs at least two replication outcomes, and this dataset has ' +
      nEst + '.'
  };
}
