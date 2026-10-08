// Reading the binary .dat files that Arena writes for its Output Analyzer
// (file version ARENA_40_OUT1), and the .flt and .fst files the Output
// Analyzer's own Batch/Truncate and Moving Average write: a short CRLF text
// header, one 0x1A byte, and then a flat array of little-endian float64
// (time, value) pairs, where a pair whose first element is negative ends a
// replication. The layout, and what the Output Analyzer makes of each file
// type, were read off files written by Arena 16.20 against a model whose
// every value was known in advance; the notes in arena/ beside the page
// record what was seen. Pure functions, no DOM.

import { makeDataset } from '../data/model.js';

/** The statistic kinds the first header line names. */
export const TYPE_CODES = {
  201: 'time-persistent',
  203: 'tally',
  204: 'output',
  205: 'written by the Output Analyzer',
  206: 'counter',
  207: 'frequency'
};

/** @typedef {{ typeCode: number, typeName: string, project: string, analyst: string,
 *   dataFor: string, runDate: string, headerLines: string[],
 *   reps: { id: number, t: number[], v: number[] }[], closed: boolean,
 *   padding: number, strayBytes: number }} ArenaDat */

const HEADER_LIMIT = 1024;

/**
 * Whether the bytes look like an Arena output file: a first line of digits
 * and a space, a 0x1A within the first kilobyte with a "Data for:" or
 * "File Version:" line before it, and at least one 16-byte record after it.
 * The payload need not be whole records: the Output Analyzer's Batch/Truncate
 * with every replication selected writes a file that ends in stray bytes.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isArenaDat(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return false;
  let i = 0;
  while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39) i++;
  if (i === 0 || i > 4 || bytes[i] !== 0x20) return false;
  const sep = bytes.indexOf(0x1a);
  if (sep < 0 || sep > HEADER_LIMIT) return false;
  const head = decodeLatin1(bytes.subarray(0, sep));
  if (!/Data for:|File Version:/.test(head)) return false;
  return bytes.length - sep - 1 >= 16;
}

function decodeLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * The header's fields. The project and analyst sit in two 25-character
 * fields after "Output file for:" and "by:"; the run date is the ten
 * characters after "Run date:", and the rest of that line is not relied on.
 * @param {Uint8Array} bytes the bytes before the 0x1A
 */
function parseHeader(bytes) {
  const lines = decodeLatin1(bytes).split('\r\n').filter(s => s !== '');
  const out = { lines, typeCode: null, project: '', analyst: '', dataFor: '', runDate: '' };
  const code = Number(lines[0] != null ? lines[0].trim() : NaN);
  if (Number.isInteger(code)) out.typeCode = code;
  for (const ln of lines.slice(1)) {
    if (ln.startsWith('Output file for:')) {
      const rest = ln.slice('Output file for:'.length);
      out.project = rest.slice(0, 25).trim();
      const tail = rest.slice(25);
      if (tail.startsWith('by:')) out.analyst = tail.slice(3).trim();
    } else if (ln.startsWith('Data for:')) {
      out.dataFor = ln.slice('Data for:'.length).trim();
    } else if (ln.startsWith('Run date:')) {
      out.runDate = ln.slice('Run date:'.length, 'Run date:'.length + 10);
    }
  }
  return out;
}

/**
 * Parse an Arena output file into its header fields and its replications,
 * each a list of (time, value) records with the terminators removed. A
 * terminator (−r, 0) ends replication r; (−r, −1) ends the last one, and
 * `closed` says whether it was seen. A file cut off before its final
 * terminator keeps the open replication, except when that open stretch is
 * nothing but (0, 0) records after a terminator: the Output Analyzer's
 * Batch/Truncate with every replication selected writes such a file (the
 * first replication's batches, its terminator, zero-filled records, and a
 * few stray bytes), and those records are counted in `padding`, not read.
 * @param {Uint8Array} bytes
 * @returns {ArenaDat}
 */
export function parseArenaDat(bytes) {
  const sep = bytes.indexOf(0x1a);
  if (sep < 0) throw new Error('This is not an Arena output file: the header terminator is missing.');
  const hdr = parseHeader(bytes.subarray(0, sep));
  const body = bytes.subarray(sep + 1);
  const n = Math.floor(body.length / 16);
  const strayBytes = body.length - 16 * n;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const reps = [];
  let t = [], v = [];
  let closed = false, sawTerminator = false;
  for (let i = 0; i < n; i++) {
    const a = view.getFloat64(16 * i, true);
    const b = view.getFloat64(16 * i + 8, true);
    if (a < 0) {
      reps.push({ id: reps.length + 1, t, v });
      t = []; v = [];
      closed = b === -1;
      sawTerminator = true;
    } else {
      t.push(a); v.push(b);
      closed = false;
    }
  }
  let padding = 0;
  if (t.length) {
    const blank = sawTerminator && t.every(x => x === 0) && v.every(x => x === 0);
    if (blank) padding = t.length;
    else reps.push({ id: reps.length + 1, t, v });
  }
  const code = hdr.typeCode;
  return {
    typeCode: code,
    typeName: TYPE_CODES[code] || 'unknown',
    project: hdr.project,
    analyst: hdr.analyst,
    dataFor: hdr.dataFor,
    runDate: hdr.runDate,
    headerLines: hdr.lines,
    reps,
    closed,
    padding,
    strayBytes
  };
}

function headerNote(dat) {
  const from = [];
  if (dat.project) from.push('project “' + dat.project + '”');
  if (dat.analyst) from.push('analyst ' + dat.analyst);
  if (dat.runDate) from.push('run on ' + dat.runDate);
  return from.length ? 'Header: ' + from.join(', ') + '.' : null;
}

// A counter whose count falls restarted at Arena's warm-up instant, which
// the file does not otherwise record.
function warmupNote(reps) {
  for (const r of reps) {
    for (let i = 1; i < r.v.length; i++) {
      if (r.v[i] < r.v[i - 1]) {
        return 'The count falls from ' + r.v[i - 1] + ' to ' + r.v[i] + ' between times ' + r.t[i - 1] + ' and ' + r.t[i] +
          ' in replication ' + r.id + ', which is where a warm-up period cleared the statistics; the records before that are the warm-up’s. To delete them, cut there on the Steady State page.';
      }
    }
  }
  return null;
}

function endsNote(reps) {
  const ends = reps.map(r => r.t[r.t.length - 1]);
  const lo = Math.min(...ends), hi = Math.max(...ends);
  return lo === hi ? null :
    'The replications end at different times (' + lo + ' to ' + hi + '); each one’s time average is taken over its own run, and nothing is held past a run’s last record.';
}

/**
 * Build a dataset from a parsed Arena file, treating each file type the way
 * the Output Analyzer does. A time-persistent file becomes a time-persistent
 * dataset: Arena closes every replication with a record at its end, and so the
 * dataset carries no end time and each replication's last record holds for
 * no time, which makes every time average run over that replication's own
 * run. A counter file records the running count at each increment and is
 * likewise a time-persistent dataset, with the count 0 from time 0 until the
 * first increment and the data ending at the last one. A tally file becomes
 * observations with their time stamps, as does a batch-means file (each
 * record a batch mean at its batch's midpoint); an output file one value per
 * replication. The notes say what was read.
 * @param {ArenaDat} dat
 * @param {{ file?: string, name?: string }} [opts]
 * @returns {import('../data/model.js').Dataset}
 */
export function arenaDataset(dat, opts = {}) {
  const code = dat.typeCode;
  if (!TYPE_CODES[code]) {
    throw new Error('The file’s type code ' + code + ' is not one this reader knows (201 time-persistent, 203 tally, 204 output, 205 written by the Output Analyzer, 206 counter, 207 frequency).');
  }
  const stat = dat.dataFor || 'data';
  const name = opts.name != null ? opts.name : stat;
  const notes = [];
  const R = dat.reps.length;
  const nonEmpty = dat.reps.filter(r => r.v.length);
  if (!nonEmpty.length) {
    throw new Error('The file holds no records for “' + stat + '”: every one of its ' + R + ' replications is empty.');
  }
  if (nonEmpty.length < R) {
    notes.push((R - nonEmpty.length) + ' of the ' + R + ' replications in the file ' +
      (R - nonEmpty.length === 1 ? 'holds' : 'hold') + ' no records and ' +
      (R - nonEmpty.length === 1 ? 'was' : 'were') + ' left out.');
  }
  if (dat.padding) {
    notes.push('The file ends in ' + dat.padding + ' empty records and no closing marker, the shape the Output Analyzer’s Batch/Truncate writes when every replication is selected; only the replications before them were read' +
      (dat.strayBytes ? ', and ' + dat.strayBytes + ' stray bytes at the end were skipped' : '') + '.');
  } else if (!dat.closed) {
    notes.push('The file ends without its closing marker; the last replication was kept as read.');
  }
  if (!dat.padding && dat.strayBytes) notes.push(dat.strayBytes + ' stray bytes at the end of the file, less than one record, were skipped.');

  let kind, reps;
  if (code === 201 || code === 207) {
    kind = 'time';
    reps = nonEmpty.map(r => ({ id: r.id, t: r.t, v: r.v }));
    notes.push((code === 207
      ? 'A frequency statistic from an Arena output file, read as time-persistent data because the file holds its expression’s value over time rather than the categories. '
      : 'Time-persistent data from an Arena output file. ') +
      'Each record is the value from its time until the next record, and the replication’s last record is its closing value at the end of the run, which holds for no time.');
    const e = endsNote(reps); if (e) notes.push(e);
  } else if (code === 206) {
    kind = 'time';
    reps = nonEmpty.map(r => (r.t[0] > 0
      ? { id: r.id, t: [0].concat(r.t), v: [0].concat(r.v) }
      : { id: r.id, t: r.t, v: r.v }));
    notes.push('A counter from an Arena output file, read as the running count over time: 0 from time 0 until the first increment, each record the count from its time until the next, and the data ending at the last increment. The count each replication ended with is loaded beside it as a second dataset.');
    const w = warmupNote(nonEmpty); if (w) notes.push(w);
    const e = endsNote(reps); if (e) notes.push(e);
  } else if (code === 203) {
    kind = 'tally';
    reps = nonEmpty.map(r => ({ id: r.id, t: r.t, v: r.v }));
    notes.push('Observations from an Arena output file, each with the simulation time it was recorded at.');
  } else if (code === 205) {
    kind = 'tally';
    reps = nonEmpty.map(r => ({ id: r.id, t: r.t, v: r.v }));
    notes.push('Written by the Output Analyzer and read as observations: batch means from Batch/Truncate, each at the time of its batch’s middle, or a moving average from Graph, each at the time it forecasts.');
  } else {
    kind = 'reps';
    reps = nonEmpty.map(r => ({ id: r.id, t: null, v: [r.v[0]] }));
    const extra = nonEmpty.filter(r => r.v.length > 1).length;
    if (extra) notes.push(extra + (extra === 1 ? ' replication carries' : ' replications carry') + ' more than one output value; the first was kept.');
    notes.push('One value per replication from an Arena output file.');
  }
  const h = headerNote(dat); if (h) notes.push(h);

  return makeDataset({
    name,
    response: stat,
    kind,
    reps,
    endTime: null,
    source: { file: opts.file != null ? opts.file : '', format: 'arena', notes }
  });
}

/**
 * The count each replication of a counter file ended with, as one value per
 * replication. The Output Analyzer never computes this; it is this page's own
 * summary, offered because the final count (customers served, parts made) is
 * what a counter is usually kept for.
 * @param {ArenaDat} dat a parsed counter (206) file
 * @param {{ file?: string, name?: string }} [opts]
 * @returns {import('../data/model.js').Dataset}
 */
export function arenaFinalCounts(dat, opts = {}) {
  if (dat.typeCode !== 206) throw new Error('Final counts are read only from a counter file.');
  const stat = dat.dataFor || 'data';
  const nonEmpty = dat.reps.filter(r => r.v.length);
  if (!nonEmpty.length) throw new Error('The file holds no records for “' + stat + '”.');
  const notes = ['The count each replication of “' + stat + '” ended with, one value per replication. This summary is the page’s own; the Output Analyzer reads a counter only as a running count over time.'];
  const h = headerNote(dat); if (h) notes.push(h);
  return makeDataset({
    name: opts.name != null ? opts.name : stat + ' (final count)',
    response: stat,
    kind: 'reps',
    reps: nonEmpty.map(r => ({ id: r.id, t: null, v: [r.v[r.v.length - 1]] })),
    endTime: null,
    source: { file: opts.file != null ? opts.file : '', format: 'arena', notes }
  });
}
