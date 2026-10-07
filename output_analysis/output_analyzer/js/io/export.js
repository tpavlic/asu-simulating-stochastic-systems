// Writing results back out: CSV text with `#` provenance lines, the slug that
// file names are built from, and, in the browser only, SVG and PNG figures and
// file downloads. The CSV writers and the slug are pure; the browser functions
// check for a DOM and throw without one.

import { repEstimates, observations } from '../data/model.js';

/**
 * One CSV field by RFC 4180: a field holding a comma, a double quote, or a
 * line break is wrapped in double quotes with inner quotes doubled. null,
 * undefined, and non-finite numbers become an empty field.
 * @param {unknown} v
 * @returns {string}
 */
export function csvEscape(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Rows of fields as CSV text, one line per row, each line ending in "\n".
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',') + '\n').join('');
}

/**
 * Provenance as `# key: value` lines, in the object's key order. Undefined
 * values are skipped and line breaks inside a value become spaces, and so every
 * line stays a comment.
 * @param {Record<string, unknown>|null} [fields]
 * @returns {string[]}
 */
export function provenanceLines(fields) {
  const out = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined) continue;
    const text = Array.isArray(v) ? v.join(', ') : String(v);
    out.push('# ' + k + ': ' + text.replace(/[\r\n]+/g, ' '));
  }
  return out;
}

function withProvenance(provenance, rows) {
  const head = provenanceLines(provenance);
  return (head.length ? head.join('\n') + '\n' : '') + toCsv(rows);
}

/**
 * A file-name slug of a title.
 * @param {string} s
 * @returns {string}
 */
export function slug(s) {
  const t = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (t || 'data').slice(0, 60);
}

/**
 * The imported observations. For a tally or replication-level dataset the
 * default is one plain column headed by the response name, the form a
 * distribution-fitting tool reads; `{ full: true }` adds the replication id
 * and, when present, the time. A time-persistent dataset always gets the
 * full form, because its values mean nothing without their times.
 * @param {import('../data/model.js').Dataset} ds
 * @param {Record<string, unknown>} [provenance]
 * @param {{ full?: boolean }} [opts]
 * @returns {string}
 */
export function observationsCsv(ds, provenance, opts = {}) {
  const full = opts.full || ds.kind === 'time';
  if (!full) {
    const rows = [[ds.response]];
    for (const x of observations(ds)) rows.push([x]);
    return withProvenance(provenance, rows);
  }
  const hasT = ds.reps.some(r => r.t);
  const rows = [hasT ? ['replication', 'time', ds.response] : ['replication', ds.response]];
  for (const r of ds.reps) {
    for (let i = 0; i < r.v.length; i++) {
      rows.push(hasT ? [r.id, r.t ? r.t[i] : null, r.v[i]] : [r.id, r.v[i]]);
    }
  }
  return withProvenance(provenance, rows);
}

/**
 * A time-persistent dataset sampled on a time grid (see `sampleDataset`):
 * a time column and then one column per replication headed by its id, with an
 * empty field where nothing holds.
 * @param {import('../data/model.js').Dataset} ds
 * @param {{ times: number[], columns: { id: string|number, values: (number|null)[] }[] }} sample
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function sampledCsv(ds, sample, provenance) {
  const rows = [['time'].concat(sample.columns.map(c => 'replication_' + c.id))];
  for (let k = 0; k < sample.times.length; k++) {
    rows.push([sample.times[k]].concat(sample.columns.map(c => c.values[k])));
  }
  return withProvenance(provenance, rows);
}

/**
 * One row per replication: id, observation count, and the replication's
 * estimate (time weighted for time-persistent data), plus sd, min, and max
 * for tally data. A one-observation replication has a blank sd.
 * @param {import('../data/model.js').Dataset} ds
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function repSummaryCsv(ds, provenance) {
  const tally = ds.kind === 'tally';
  const rows = [tally ? ['replication', 'n_obs', 'mean', 'sd', 'min', 'max'] : ['replication', 'n_obs', 'mean']];
  const est = repEstimates(ds);
  ds.reps.forEach((r, i) => {
    const row = [r.id, r.v.length, est[i]];
    if (tally) {
      const n = r.v.length;
      let ss = 0, lo = Infinity, hi = -Infinity;
      for (let k = 0; k < n; k++) {
        ss += (r.v[k] - est[i]) ** 2;
        if (r.v[k] < lo) lo = r.v[k];
        if (r.v[k] > hi) hi = r.v[k];
      }
      row.push(n > 1 ? Math.sqrt(ss / (n - 1)) : null, n ? lo : null, n ? hi : null);
    }
    rows.push(row);
  });
  return withProvenance(provenance, rows);
}

// The all-dataset files always quote the dataset name, because a reader that
// splits on spaces or semicolons as well as commas would otherwise cut a name
// such as "Queue days" in two. Quoting a field is valid RFC 4180 whether or
// not it needs it.
function quotedName(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function namedRows(header, body) {
  return toCsv([header]) + body.map(([name, rest]) => quotedName(name) + ',' + rest.map(csvEscape).join(',') + '\n').join('');
}

// One provenance line per dataset, ahead of the caller's own fields (such as
// the export time, which the caller passes so that this stays pure).
function datasetsProvenance(list, provenance) {
  const p = {};
  list.forEach((ds, i) => {
    const parts = [ds.kind, 'response ' + ds.response];
    if (ds.source && ds.source.file) parts.push('source ' + ds.source.file);
    if (ds.kind === 'time') parts.push('end time ' + (ds.endTime != null ? ds.endTime : 'none'));
    p['dataset ' + (i + 1)] = ds.name + ' (' + parts.join(', ') + ')';
  });
  return provenanceLines(Object.assign(p, provenance || {}));
}

function withDatasetsProvenance(list, provenance, text) {
  const head = datasetsProvenance(list, provenance);
  return (head.length ? head.join('\n') + '\n' : '') + text;
}

/**
 * Every record of several datasets in one file: the dataset's name, the
 * replication id, the time when any dataset in the list has time stamps
 * (blank for a record without one), and the value, one row per record with
 * the datasets in list order. A replication with no records has no row; the
 * replications file lists it. The value column is headed `value` because the
 * datasets' responses may differ.
 * @param {import('../data/model.js').Dataset[]} list
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function datasetsObservationsCsv(list, provenance) {
  const hasT = list.some(ds => ds.reps.some(r => r.t));
  const header = hasT ? ['dataset', 'replication', 'time', 'value'] : ['dataset', 'replication', 'value'];
  const body = [];
  for (const ds of list) {
    for (const r of ds.reps) {
      for (let i = 0; i < r.v.length; i++) {
        body.push([ds.name, hasT ? [r.id, r.t ? r.t[i] : null, r.v[i]] : [r.id, r.v[i]]]);
      }
    }
  }
  return withDatasetsProvenance(list, provenance, namedRows(header, body));
}

/**
 * One row per replication of several datasets: the dataset's name and kind,
 * the replication id, its observation count, and its replication outcome
 * (time weighted for time-persistent data), blank for a replication with no
 * outcome.
 * @param {import('../data/model.js').Dataset[]} list
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function datasetsReplicationsCsv(list, provenance) {
  const body = [];
  for (const ds of list) {
    const est = repEstimates(ds);
    ds.reps.forEach((r, i) => body.push([ds.name, [ds.kind, r.id, r.v.length, est[i]]]));
  }
  return withDatasetsProvenance(list, provenance, namedRows(['dataset', 'kind', 'replication', 'n_obs', 'outcome'], body));
}

function estimateVector(x) {
  return x && x.reps ? Array.from(repEstimates(x)) : Array.from(x);
}

/**
 * Replication outcomes in the form a pilot-data box reads: `#` lines, a
 * header, and one number per line. Given one dataset (or vector), one column
 * headed `mean` holding its finite estimates. Given a pair `[a, b]` of
 * datasets or vectors already matched by the caller, two columns headed
 * `mean_A,mean_B` over the first min(nA, nB) positions, skipping a position
 * where either estimate is missing.
 * @param {import('../data/model.js').Dataset|ArrayLike<number>|
 *   [import('../data/model.js').Dataset|ArrayLike<number>, import('../data/model.js').Dataset|ArrayLike<number>]} x
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function pilotCsv(x, provenance) {
  const paired = Array.isArray(x) && x.length === 2 && typeof x[0] === 'object' && x[0] !== null;
  if (!paired) {
    const rows = [['mean']];
    for (const v of estimateVector(x)) if (Number.isFinite(v)) rows.push([v]);
    return withProvenance(provenance, rows);
  }
  const a = estimateVector(x[0]), b = estimateVector(x[1]);
  const rows = [['mean_A', 'mean_B']];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) rows.push([a[i], b[i]]);
  }
  return withProvenance(provenance, rows);
}

/**
 * Batch means as CSV: one row per complete batch, numbered from 1, with its
 * start, end, observation count, and mean.
 * @param {{ batches: { start: number, end: number, n: number, mean: number }[] }} result
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function batchMeansCsv(result, provenance) {
  const rows = [['batch', 'start', 'end', 'n', 'mean']];
  result.batches.forEach((b, i) => rows.push([i + 1, b.start, b.end, b.n, b.mean]));
  return withProvenance(provenance, rows);
}

/**
 * Any result table as CSV after its provenance lines.
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function tableCsv(headers, rows, provenance) {
  return withProvenance(provenance, [headers, ...rows]);
}

function requireDom(what) {
  if (typeof document === 'undefined') throw new Error(what + ' needs a browser.');
}

/**
 * Serialize an SVG element as a stand-alone SVG file: the SVG namespace is
 * set, and the given CSS, when there is any, is inlined as a `<style>`
 * element so the file renders the same away from the page.
 * @param {SVGSVGElement} svg
 * @param {string} [css]
 * @returns {string}
 */
export function svgToString(svg, css = '') {
  requireDom('svgToString');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Rasterize an SVG element to a PNG blob at `scale` times its rendered size
 * (pass devicePixelRatio for a sharp image on a high-density screen). The
 * background is filled white, as an image viewer would otherwise show the
 * transparent areas black or checkered.
 * @param {SVGSVGElement} svg
 * @param {number} [scale]
 * @param {string} [css]
 * @returns {Promise<Blob>}
 */
export function svgToPngBlob(svg, scale = 1, css = '') {
  requireDom('svgToPngBlob');
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = box.width || (vb && vb.width) || 600;
  const h = box.height || (vb && vb.height) || 400;
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const text = svgToString(clone, css);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The PNG could not be created.'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The figure could not be rasterized.'));
    };
    img.src = url;
  });
}

/**
 * Save a blob as a file through a temporary link.
 * @param {string} name
 * @param {Blob} blob
 */
export function downloadBlob(name, blob) {
  requireDom('downloadBlob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save text as a file.
 * @param {string} name
 * @param {string} text
 * @param {string} [mime]
 */
export function downloadText(name, text, mime = 'text/csv;charset=utf-8') {
  requireDom('downloadText');
  downloadBlob(name, new Blob([text], { type: mime }));
}
