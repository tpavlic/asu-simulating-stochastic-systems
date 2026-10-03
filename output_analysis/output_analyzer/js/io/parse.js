// Reading simulation output from delimited text: splitting lines into cells,
// detecting a header and the file's layout, suggesting a column mapping, and
// building datasets from a mapping. Every row that is not used is reported
// with its line number and a reason. Pure functions, no DOM.

import { makeDataset } from '../data/model.js';

/** @typedef {{ kind: 'tally'|'time'|'reps'|null, value: number|null, time: number|null,
 *   rep: number|null, scenario: number|null, name: string, endTime: number|null }} Mapping */
/** @typedef {{ line: number, text: string, reason: string }} Issue */

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// A cell's number, or null when the cell is not a plain finite decimal. NaN,
// Inf, and -Inf are therefore non-numeric.
function cellNumber(s) {
  return NUMBER_RE.test(s) ? Number(s) : null;
}

/**
 * Split one line into cells on commas, tabs, semicolons, or runs of spaces.
 * Cells are trimmed and empty ones dropped. A double-quoted cell is kept
 * whole, delimiters included, with its quotes removed and a doubled quote
 * read as one quote.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCells(line) {
  const cells = [];
  let cur = '', quoted = false, i = 0;
  const flush = () => {
    const c = quoted ? cur : cur.trim();
    if (c !== '') cells.push(c);
    cur = '';
    quoted = false;
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' && cur.trim() === '' && !quoted) {
      let j = i + 1, s = '';
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += line[j++];
      }
      cur = s;
      quoted = true;
      i = j + 1;
      continue;
    }
    if (ch === ',' || ch === '\t' || ch === ';' || ch === ' ') {
      flush();
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  flush();
  return cells;
}

/**
 * Split text into rows of cells. Blank lines are counted in `blanks` and
 * omitted; lines whose first non-space character is `#` are comments,
 * counted in `comments` and omitted. `nums` is every cell's number, or null
 * when any cell is non-numeric; `vals` holds each cell's number or null.
 * @param {string} text
 * @returns {{ rows: { line: number, text: string, cells: string[], nums: number[]|null,
 *   vals: (number|null)[] }[], blanks: number, comments: number }}
 */
export function parseRows(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const rows = [];
  let blanks = 0, comments = 0;
  lines.forEach((raw, k) => {
    const trimmed = raw.trim();
    if (trimmed === '') { blanks++; return; }
    if (trimmed[0] === '#') { comments++; return; }
    const cells = splitCells(trimmed);
    if (!cells.length) { blanks++; return; }
    const vals = cells.map(cellNumber);
    const nums = vals.every(x => x !== null) ? vals.slice() : null;
    rows.push({ line: k + 1, text: raw, cells, nums, vals });
  });
  return { rows, blanks, comments };
}

const ROLE_NAMES = {
  time: ['time', 't', 'clock', 'sim_time', 'simtime'],
  rep: ['rep', 'replication', 'run', 'repl'],
  scenario: ['scenario', 'system', 'design', 'config', 'configuration', 'treatment',
    'alternative', 'policy']
};

/**
 * Read a text file's layout. The first row is a header when it has a
 * non-numeric cell and either every cell is non-numeric or some column is
 * non-numeric there but numeric in the next row (a text column such as a
 * scenario name is not mistaken for a header). The column count is the
 * header's width, or else the most common row width. A column is numeric
 * when a majority of the rows of that width hold a number in it; a row with
 * the wrong width, or with a non-numeric cell in a numeric column, is an
 * issue. `rows` lists every data row with `ok` marking the usable ones.
 * `format` is 'minus1' for two numeric columns with some row starting −1,
 * 'single' for one numeric column, and 'columns' otherwise.
 * @param {string} text
 * @param {{ name?: string }} [opts]
 * @returns {{ format: 'minus1'|'single'|'columns', header: string[]|null, nCols: number,
 *   numericCols: number[], rows: { line: number, text: string, cells: string[],
 *   nums: number[]|null, vals: (number|null)[], ok: boolean }[], suggested: Mapping,
 *   issues: Issue[], blanks: number, comments: number }}
 */
export function sniff(text, opts = {}) {
  const parsed = parseRows(text);
  const all = parsed.rows;
  let header = null;
  let data = all;
  if (all.length && all[0].nums === null) {
    const first = all[0], next = all[1];
    const allText = first.vals.every(x => x === null);
    const textOverNumber = next != null && first.vals.some((x, j) => x === null && next.vals[j] != null);
    if (allText || textOverNumber || !next) {
      header = first.cells.map(s => s.trim());
      data = all.slice(1);
    }
  }

  let nCols = 0;
  if (header) {
    nCols = header.length;
  } else if (data.length) {
    const counts = new Map();
    for (const r of data) counts.set(r.cells.length, (counts.get(r.cells.length) || 0) + 1);
    let best = -1;
    for (const [w, c] of counts) if (c > best) { best = c; nCols = w; }
  }

  const shaped = data.filter(r => r.cells.length === nCols);
  const numeric = [];
  for (let j = 0; j < nCols; j++) {
    let k = 0;
    for (const r of shaped) if (r.vals[j] !== null) k++;
    numeric.push(shaped.length > 0 && k * 2 > shaped.length);
  }
  const numericCols = [];
  numeric.forEach((b, j) => { if (b) numericCols.push(j); });

  const issues = [];
  const rows = data.map(r => {
    let reason = null;
    if (r.cells.length !== nCols) {
      reason = 'expected ' + nCols + (nCols === 1 ? ' cell' : ' cells') + ', found ' + r.cells.length;
    } else {
      const bad = numericCols.filter(j => r.vals[j] === null);
      if (bad.length) {
        reason = 'non-numeric ' + (bad.length === 1 ? 'cell' : 'cells') + ' in ' +
          bad.map(j => (header ? '"' + header[j] + '"' : 'column ' + (j + 1))).join(', ') +
          ': ' + bad.map(j => '"' + r.cells[j] + '"').join(', ');
      }
    }
    if (reason) issues.push({ line: r.line, text: r.text, reason });
    return { line: r.line, text: r.text, cells: r.cells, nums: r.nums, vals: r.vals, ok: reason === null };
  });

  let format = 'columns';
  if (nCols === 1 && numeric[0]) format = 'single';
  else if (nCols === 2 && numeric[0] && numeric[1] && rows.some(r => r.ok && r.vals[0] === -1)) format = 'minus1';

  const lower = header ? header.map(s => s.toLowerCase()) : null;
  const find = role => {
    if (!lower) return null;
    const j = lower.findIndex(h => ROLE_NAMES[role].includes(h));
    if (j < 0) return null;
    return role === 'time' && !numeric[j] ? null : j;
  };
  const name = opts.name != null ? opts.name : 'data';
  /** @type {Mapping} */
  let suggested;
  if (format === 'minus1') {
    suggested = { kind: null, value: 1, time: 0, rep: null, scenario: null, name, endTime: null };
  } else if (format === 'single') {
    suggested = { kind: 'reps', value: 0, time: null, rep: null, scenario: null, name, endTime: null };
  } else {
    const time = find('time'), rep = find('rep'), scenario = find('scenario');
    const used = [time, rep, scenario];
    const value = numericCols.find(j => !used.includes(j));
    let kind;
    if (time != null) kind = null;
    else kind = rep != null ? 'tally' : 'reps';
    suggested = { kind, value: value != null ? value : null, time, rep, scenario, name, endTime: null };
  }

  return {
    format, header, nCols, numericCols, rows, suggested, issues,
    blanks: parsed.blanks, comments: parsed.comments
  };
}

/**
 * The numeric columns a response picker offers: every numeric column except
 * those the suggested mapping uses as time, replication, or scenario. Names
 * come from the header, or are "col N" (1-based) without one.
 * @param {ReturnType<typeof sniff>} sniffed
 * @returns {{ col: number, name: string }[]}
 */
export function wideResponses(sniffed) {
  const s = sniffed.suggested;
  const used = [s.time, s.rep, s.scenario].filter(j => j != null);
  return sniffed.numericCols
    .filter(j => !used.includes(j))
    .map(j => ({ col: j, name: sniffed.header ? sniffed.header[j] : 'col ' + (j + 1) }));
}

// The key that groups rows by a column: the number when the cell is numeric
// (so "1" and "1.0" are one replication), otherwise the trimmed text.
function cellKey(row, j) {
  return row.vals[j] !== null ? row.vals[j] : row.cells[j];
}

/**
 * Build datasets from sniffed rows and a mapping. Rows split into one
 * dataset per distinct scenario value (in order of first appearance), then
 * into replications: by the replication column, by −1 delimiter rows for the
 * 'minus1' format, or one replication when neither applies, except that a
 * 'reps' dataset without a replication column takes each row as its own
 * replication. Each dataset's issues are the sniff issues plus the issues
 * raised while building it.
 * @param {ReturnType<typeof sniff>} sniffed
 * @param {Mapping} mapping
 * @returns {{ datasets: import('../data/model.js').Dataset[], issues: Issue[] }}
 */
export function buildDatasets(sniffed, mapping) {
  const kind = mapping.kind;
  if (kind !== 'tally' && kind !== 'time' && kind !== 'reps') {
    throw new Error('Choose what the values are: observations (tally), a time-persistent state (time), or one value per replication (reps).');
  }
  const numeric = j => j != null && sniffed.numericCols.includes(j);
  if (!numeric(mapping.value)) throw new Error('The value column must be a numeric column.');
  if (mapping.time != null && !numeric(mapping.time)) throw new Error('The time column must be a numeric column.');
  if (kind === 'time' && mapping.time == null) throw new Error('Time-persistent data need a time column.');

  const minus1 = sniffed.format === 'minus1';
  const header = sniffed.header;
  const response = header ? header[mapping.value] : 'value';
  const baseName = mapping.name != null ? mapping.name : 'data';
  const endTime = mapping.endTime != null ? mapping.endTime : null;

  // Group usable rows by scenario, in order of first appearance.
  const groups = new Map();
  for (const r of sniffed.rows) {
    if (!r.ok) continue;
    const key = mapping.scenario != null ? r.cells[mapping.scenario] : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const allBuild = [];
  const datasets = [];
  for (const [scen, rows] of groups) {
    const issues = [];
    const notes = [];
    // Replications as lists of rows.
    /** @type {{ id: string|number, rows: typeof rows }[]} */
    let reps = [];
    if (mapping.rep != null) {
      const byId = new Map();
      for (const r of rows) {
        const id = cellKey(r, mapping.rep);
        if (!byId.has(id)) { byId.set(id, { id, rows: [] }); reps.push(byId.get(id)); }
        byId.get(id).rows.push(r);
      }
    } else if (minus1) {
      let cur = [];
      let lastWasDelim = false;
      for (const r of rows) {
        if (r.vals[0] === -1) {
          if (cur.length) {
            reps.push({ id: reps.length + 1, rows: cur });
          } else {
            issues.push({
              line: r.line, text: r.text,
              reason: lastWasDelim
                ? 'empty replication: two −1 rows in a row'
                : 'empty replication: a −1 row before any observation'
            });
          }
          cur = [];
          lastWasDelim = true;
        } else {
          cur.push(r);
          lastWasDelim = false;
        }
      }
      if (cur.length) {
        reps.push({ id: reps.length + 1, rows: cur });
        notes.push('The last replication (' + cur.length +
          (cur.length === 1 ? ' observation' : ' observations') +
          ', from line ' + cur[0].line + ') has no closing −1 row; it was kept.');
      }
    } else if (kind === 'reps') {
      reps = rows.map((r, i) => ({ id: i + 1, rows: [r] }));
    } else {
      reps = rows.length ? [{ id: 1, rows }] : [];
    }

    const built = [];
    for (const rep of reps) {
      let use = rep.rows;
      if (kind === 'reps' && use.length > 1) {
        for (const r of use.slice(1)) {
          issues.push({
            line: r.line, text: r.text,
            reason: 'replication ' + rep.id + ' already has a value (line ' + use[0].line + ')'
          });
        }
        use = use.slice(0, 1);
      }
      if (kind === 'time') {
        const kept = [];
        let prev = -Infinity;
        for (const r of use) {
          const t = r.vals[mapping.time];
          if (t < prev) {
            issues.push({
              line: r.line, text: r.text,
              reason: 'time ' + r.cells[mapping.time] + ' is earlier than the previous record in replication ' + rep.id
            });
            continue;
          }
          prev = t;
          kept.push(r);
        }
        use = kept;
      }
      if (!use.length) continue;
      built.push({
        id: rep.id,
        t: mapping.time != null ? use.map(r => r.vals[mapping.time]) : null,
        v: use.map(r => r.vals[mapping.value])
      });
    }

    allBuild.push(...issues);
    const dsIssues = sniffed.issues.concat(issues).sort((a, b) => a.line - b.line);
    datasets.push(makeDataset({
      name: mapping.scenario != null ? baseName + ' · ' + scen : baseName,
      response,
      kind,
      reps: built,
      endTime,
      source: { file: baseName, format: sniffed.format, notes },
      issues: dsIssues
    }));
  }

  const issues = sniffed.issues.concat(allBuild).sort((a, b) => a.line - b.line);
  return { datasets, issues };
}
