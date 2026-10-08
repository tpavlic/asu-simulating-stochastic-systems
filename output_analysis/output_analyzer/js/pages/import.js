// The Import page: a drop zone, a file chooser, a paste box, and the bundled
// examples; the mapping dialog that assigns a file's columns to roles and
// asks what the values are; and the table of loaded datasets, where each can
// be renamed, exported as CSV, or removed. Every dataset enters the
// application through state.add, and so a restored session goes through the
// same door.

import * as state from '../state.js';
import { sniff, buildDatasets } from '../io/parse.js';
import { isArenaDat, parseArenaDat, arenaDataset, arenaFinalCounts } from '../io/arena.js';
import { sameData } from '../data/model.js';
import { EXAMPLES } from '../data/examples.js';
import { details, issueList, notice, KIND_LABEL } from '../ui/widgets.js';
import { esc, intl, plural, num, breakPoints } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';
import { datasetFiles, fileButtons, stamp, dataFilesHelp } from '../ui/exportrow.js';
import { datasetsObservationsCsv, datasetsReplicationsCsv, downloadText } from '../io/export.js';

/** The page's hash id. */
export const id = 'import';
/** The page's title. */
export const title = 'Import';

const FORMAT_LABEL = {
  minus1: 'time–value records, with a −1 row ending each replication',
  single: 'one column of values',
  columns: 'delimited columns',
  arena: 'Arena output file'
};

const ALL_OBS_TIP = 'Every record of every loaded dataset in one file, one row per record under dataset, replication, time, and value, in the order of the table. The time column is present when some dataset has time stamps.';
const ALL_REPS_TIP = 'One row per replication of every loaded dataset, under dataset, kind (tally, time, or reps), replication, n_obs, and mean, which holds the replication outcome (the time-weighted mean for time-persistent data), as in each dataset’s own replication summary.';

const KINDS = [
  { kind: 'tally', label: 'Tally', tip: 'Each value is one observation, such as one customer’s wait. A replication’s outcome is the plain mean of its observations.' },
  { kind: 'time', label: 'Time-persistent', tip: 'Each value is a state, such as the number in queue, that holds from its time until the next record. A replication’s outcome is the time-weighted mean.' },
  { kind: 'reps', label: 'Replication values', tip: 'Each value is already one replication’s summary, such as one day’s average wait.' }
];

let rootEl = null;
let els = {};
/** Files and pastes waiting for the mapping dialog, oldest first. */
const queue = [];
/** The file or paste the mapping dialog is showing, or null. */
let pending = null;
/** What the last accepted import added, for the status area. */
let lastImport = null;
/** Ids of datasets whose rejected-row list is expanded in the table. */
const expanded = new Set();
/** Ids of datasets whose data files are shown in the table. */
const exportOpen = new Set();
let removeAllTimer = null;

function visible() { return !!rootEl && rootEl.classList.contains('active'); }

function baseName(file) {
  const s = String(file || '').replace(/^.*[\\/]/, '');
  const k = s.lastIndexOf('.');
  return k > 0 ? s.slice(0, k) : (s || 'data');
}

// The delimiter the first data lines use, for the dialog's description. The
// parser itself splits on any of them.
function delimiterOf(text) {
  const lines = String(text).split(/\r\n|\r|\n/).map(s => s.trim()).filter(s => s && s[0] !== '#').slice(0, 30);
  if (lines.some(s => s.includes('\t'))) return 'tab';
  if (lines.some(s => s.includes(','))) return 'comma';
  if (lines.some(s => s.includes(';'))) return 'semicolon';
  if (lines.some(s => /\S\s+\S/.test(s))) return 'spaces';
  return 'none (one column)';
}

function colName(sn, j) {
  return sn.header && sn.header[j] != null && sn.header[j] !== '' ? sn.header[j] : 'column ' + (j + 1);
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Load a bundled example or your own simulation output from a file or from pasted text. Every dataset holds one of three kinds of values, and its kind decides how a replication’s outcome is computed:</p>' +
    '<ul class="im-kinds">' +
      '<li><span class="kind-badge">' + KIND_LABEL.tally + '</span> one observation per event within a run, such as each customer’s wait; a replication’s outcome is the mean of its observations.</li>' +
      '<li><span class="kind-badge">' + KIND_LABEL.time + '</span> a state recorded each time it changes, such as the number in queue, each value holding until the next record; a replication’s outcome is the time-weighted mean.</li>' +
      '<li><span class="kind-badge">' + KIND_LABEL.reps + '</span> one summary per run, such as each day’s average wait, which is that replication’s outcome.</li>' +
    '</ul>' +
    '<p class="lede">A file or pasted text can hold any of the three, in the formats listed under <a href="#import" class="im-jump">Text formats</a> below, and opens a dialog where you set the kind and each column’s role before anything loads. The binary .dat files Arena writes for its Output Analyzer, and the .flt and .fst files that analyzer writes itself, name their kind in their header, and so they load without a dialog. Every row the reader cannot use is listed with its line number and the reason, and nothing is dropped silently.</p>' +
    '<div class="sec">' +
      '<div class="sec-hd">Loaded datasets</div>' +
      '<p class="exp-note">Every loaded dataset, including one read from an Arena file, can be saved as CSV: press Export on its row, or use Export all to save every dataset’s observations in one file and their replication outcomes in another. That observations file loads back in as delimited columns, one dataset per name, when its datasets are of one kind, all have or all lack time stamps, and, for time-persistent data, share one end time, which the file’s # lines give. A replication with no records has no row in the file and does not come back.</p>' +
      '<div id="im-list"></div>' +
    '</div>' +
    '<div id="im-status"></div>' +
    '<div class="sec ctrl-card">' +
      '<div class="im-block">' +
        '<div class="ctrl-grp-lbl">Bundled examples</div>' +
        '<div class="ctrl-row im-row">' +
          '<span class="ctrl-pair"><label class="ctrl-lbl" for="im-ex">Load example</label><select id="im-ex"></select></span>' +
          '<button type="button" class="btn-run" id="im-ex-load">Load</button>' +
          '<button type="button" class="btn-clear" id="im-ex-map">Assign its columns myself</button>' +
        '</div>' +
        '<p class="im-ex-desc" id="im-ex-desc"></p>' +
      '</div>' +
      '<div class="im-block" id="im-formats" tabindex="-1">' +
        '<div class="ctrl-grp-lbl">Text formats</div>' +
        '<ul class="im-kinds im-fmts">' +
          '<li><span class="kind-badge">' + KIND_LABEL.tally + '</span> two columns, time and value, with a row whose first value is −1 ending each replication; or columns under a header row, one of them headed <code>rep</code> (or <code>run</code>) to say which replication each row belongs to; or a single column, read as one replication.</li>' +
          '<li><span class="kind-badge">' + KIND_LABEL.time + '</span> the same two forms as a tally, with the time column required; the dialog takes an end time until which each replication’s last value holds.</li>' +
          '<li><span class="kind-badge">' + KIND_LABEL.reps + '</span> a single column with one value per replication; or columns under a header row, each numeric column a response.</li>' +
        '</ul>' +
        '<p class="ctrl-note">In any of these, a header can name a <code>scenario</code> (or <code>design</code>) column, which splits the rows into one dataset per design. Columns may be separated by commas, tabs, semicolons, or spaces, and a line starting with # is a comment.</p>' +
      '</div>' +
      '<div class="im-block">' +
        '<div class="ctrl-grp-lbl">From a file</div>' +
        '<div class="im-drop" id="im-drop">' +
          '<div class="im-drop-lbl">Drop one or more files here</div>' +
          '<label class="btn-run2 im-file">or choose a file<input type="file" id="im-file" multiple accept=".csv,.txt,.tsv,.dat,.flt,.fst,.prn,text/plain,text/csv"></label>' +
          '<div class="ctrl-note im-drop-note">Text in one of the formats above, or an Arena Output Analyzer .dat, .flt, or .fst file.</div>' +
        '</div>' +
      '</div>' +
      '<div class="im-block">' +
        '<label class="ctrl-grp-lbl" for="im-paste">Paste data</label>' +
        '<textarea id="im-paste" rows="5" spellcheck="false" placeholder="replication,avg_wait&#10;1,2.62&#10;2,3.27&#10;3,3.86"></textarea>' +
        '<div class="ctrl-row im-row"><button type="button" class="btn-run2" id="im-read">Read pasted data</button><span class="ctrl-note" id="im-paste-note"></span></div>' +
      '</div>' +
    '</div>' +
    '<div id="im-dialog"></div>' +
    '<div id="im-why"></div>';

  els = {
    drop: root.querySelector('#im-drop'),
    file: root.querySelector('#im-file'),
    paste: root.querySelector('#im-paste'),
    pasteNote: root.querySelector('#im-paste-note'),
    read: root.querySelector('#im-read'),
    ex: root.querySelector('#im-ex'),
    exLoad: root.querySelector('#im-ex-load'),
    exMap: root.querySelector('#im-ex-map'),
    exDesc: root.querySelector('#im-ex-desc'),
    dialog: root.querySelector('#im-dialog'),
    status: root.querySelector('#im-status'),
    list: root.querySelector('#im-list')
  };

  root.querySelector('#im-why').appendChild(details('Why the kind matters',
    '<p>A time-persistent state is recorded only when it changes, and so its records say nothing about how long each value lasted until their times are read with them. Averaging the recorded values would count a spike that lasted a second the same as a plateau that lasted an hour; the time-weighted mean counts each value in proportion to how long it held.</p>' +
    '<p>Whatever the kind, the replication outcomes are the unit of inference: observations within one run are correlated with their neighbors, whereas the outcomes of independent replications are independent and identically distributed, which is what a t interval assumes.</p>'));

  // The lede's link to the Text formats block scrolls there and moves focus
  // there; it never changes the hash, which names only the page, and it stops
  // the click before the page router, which would scroll back to the top.
  root.querySelector('.im-jump').addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const box = root.querySelector('#im-formats');
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    box.focus({ preventScroll: true });
  });

  // Drop zone: files, or text dragged from another window.
  const drop = els.drop;
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('is-over');
  }));
  drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-over'); });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) readFiles(dt.files);
    else {
      const s = dt.getData('text/plain') || dt.getData('text');
      if (s) enqueue('dropped text', s);
    }
  });
  els.file.addEventListener('change', () => {
    if (els.file.files && els.file.files.length) readFiles(els.file.files);
    els.file.value = '';
  });

  els.read.addEventListener('click', () => {
    const s = els.paste.value;
    if (!s.trim()) { els.pasteNote.textContent = 'The box is empty; paste some data first.'; return; }
    els.pasteNote.textContent = '';
    enqueue('pasted data', s);
  });

  els.ex.innerHTML = EXAMPLES.map(ex => '<option value="' + esc(ex.id) + '">' + esc(ex.title) + '</option>').join('');
  const showDesc = () => {
    const ex = EXAMPLES.find(x => x.id === els.ex.value);
    els.exDesc.textContent = ex ? ex.description : '';
  };
  els.ex.addEventListener('change', showDesc);
  showDesc();
  els.exLoad.addEventListener('click', () => loadExample(els.ex.value));
  els.exMap.addEventListener('click', () => {
    const ex = EXAMPLES.find(x => x.id === els.ex.value);
    if (ex) enqueue(ex.file, ex.text, ex.mapping && ex.mapping.name, ex.kind, ex.mapping && ex.mapping.endTime);
  });

  state.on('datasets', () => { if (visible()) renderList(); });
  renderList();
  renderDialog();
  renderStatus();
}

/** Called each time the page is shown. */
export function onShow() {
  renderList();
}

// ── Reading input ───────────────────────────────────────────────────────

// Every file is read as bytes first because an Arena output file is binary
// after its header and is told apart by its first bytes; anything else is
// decoded as UTF-8 text and queued for the mapping dialog.
function readFiles(fileList) {
  const files = Array.from(fileList);
  Promise.all(files.map(f => f.arrayBuffer().then(buf => ({ name: f.name, bytes: new Uint8Array(buf) }), err => ({ name: f.name, error: err }))))
    .then(list => {
      for (const it of list) {
        if (it.error) {
          lastImport = { error: 'The file ' + it.name + ' could not be read: ' + (it.error.message || it.error) + '.' };
          renderStatus();
        } else if (isArenaDat(it.bytes)) {
          loadArena(it.name, it.bytes);
        } else {
          enqueue(it.name, new TextDecoder().decode(it.bytes));
        }
      }
    });
}

// An Arena output file needs no mapping: its header names the statistic and
// says whether the records are observations, a state over time, or one
// value per replication. A counter loads twice, as the running count the
// Output Analyzer reads and as the final count per replication.
function loadArena(fileName, bytes) {
  try {
    const dat = parseArenaDat(bytes);
    const list = [arenaDataset(dat, { file: fileName })];
    if (dat.typeCode === 206) list.push(arenaFinalCounts(dat, { file: fileName }));
    const { added, skipped } = addNew(list);
    lastImport = { what: fileName, datasets: added, skipped, issues: [], notes: collectNotes(added) };
  } catch (err) {
    lastImport = { error: 'The file ' + fileName + ' could not be loaded: ' + err.message };
  }
  renderStatus();
}

// Queues one text for the mapping dialog and shows it when nothing else is
// waiting.
function enqueue(fileName, text, displayName, kind, endTime) {
  queue.push({ fileName, text, displayName, kind, endTime });
  if (!pending) nextPending();
  else updateWaiting();
}

function updateWaiting() {
  const w = els.dialog && els.dialog.querySelector('#im-waiting');
  if (w) w.textContent = queue.length ? '(' + plural(queue.length, 'more file') + ' waiting)' : '';
}

function nextPending() {
  const it = queue.shift();
  if (!it) { pending = null; renderDialog(); return; }
  const name = it.displayName || (it.fileName === 'pasted data' || it.fileName === 'dropped text' ? it.fileName : baseName(it.fileName));
  const sn = sniff(it.text, { name });
  const s = sn.suggested;
  // A replication column whose every id appears once (within its scenario)
  // holds one value per replication; a known kind (an example's) takes
  // precedence over both guesses.
  let kind = s.kind;
  if (kind === 'tally' && s.rep != null) {
    const ids = sn.rows.filter(r => r.ok).map(r => (s.scenario != null ? r.cells[s.scenario] + '\u0000' : '') + r.cells[s.rep]);
    if (ids.length && new Set(ids).size === ids.length) kind = 'reps';
  }
  if (it.kind) kind = it.kind;
  pending = {
    fileName: it.fileName,
    text: it.text,
    sniffed: sn,
    delimiter: delimiterOf(it.text),
    mapping: {
      kind, value: s.value, time: s.time, rep: s.rep, scenario: s.scenario,
      name, endTime: null
    },
    endText: it.endTime != null ? String(it.endTime) : '',
    wide: false,
    wideCols: null
  };
  renderDialog();
  if (els.dialog.firstChild && els.dialog.scrollIntoView && visible()) {
    els.dialog.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function loadExample(exId) {
  const ex = EXAMPLES.find(x => x.id === exId);
  if (!ex) return;
  try {
    const sn = sniff(ex.text, { name: ex.mapping.name });
    const res = buildDatasets(sn, ex.mapping);
    if (!res.datasets.length) throw new Error('The example produced no datasets.');
    for (const ds of res.datasets) ds.source.file = ex.file;
    const { added, skipped } = addNew(res.datasets);
    lastImport = {
      what: 'the example “' + ex.title + '”',
      datasets: added,
      skipped,
      issues: res.issues,
      notes: collectNotes(added)
    };
  } catch (err) {
    lastImport = { error: 'The example could not be loaded: ' + err.message };
  }
  renderStatus();
}

function collectNotes(list) {
  const out = [];
  for (const ds of list) for (const n of ds.source.notes) if (!out.includes(n)) out.push(n);
  return out;
}

// Adds the datasets that are not already loaded with the same data, selects
// the first of them (or the loaded copy of the first duplicate), and returns
// what was added and what was skipped for the status box. A file dropped
// twice, or an example loaded twice, adds nothing the second time.
function addNew(list) {
  const added = [], skipped = [];
  for (const ds of list) {
    const dup = state.datasets.find(d => sameData(d, ds));
    if (dup) skipped.push({ name: ds.name, as: dup });
    else { state.add(ds); added.push(ds); }
  }
  if (added.length) state.select(added[0].id);
  else if (skipped.length) state.select(skipped[0].as.id);
  return { added, skipped };
}

// ── The mapping dialog ──────────────────────────────────────────────────

// The columns the response checklist offers: the numeric columns not used as
// time, replication, or scenario.
function wideCandidates() {
  const sn = pending.sniffed, m = pending.mapping;
  const used = [m.time, m.rep, m.scenario].filter(j => j != null);
  return sn.numericCols.filter(j => !used.includes(j));
}

// The end-time field's value: null when blank, a number when valid, and
// undefined when the text is not a usable time.
function endTimeValue() {
  const s = pending.endText.trim();
  if (s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

// What is wrong with the current mapping, as a sentence, or null.
function mappingProblem() {
  const sn = pending.sniffed, m = pending.mapping;
  if (m.kind == null) return 'Say whether these are observations or a time-persistent state; the file does not say.';
  if (pending.wide) {
    if (!pending.wideCols || !pending.wideCols.size) return 'Choose at least one column to load.';
  } else if (m.value == null || !sn.numericCols.includes(m.value)) {
    return 'Choose a numeric value column.';
  }
  if (m.kind === 'time' && m.time == null) return 'A time-persistent state needs a time column.';
  const roles = [['value', pending.wide ? null : m.value], ['time', m.time], ['replication', m.rep], ['scenario', m.scenario]].filter(r => r[1] != null);
  for (let a = 0; a < roles.length; a++) {
    for (let b = a + 1; b < roles.length; b++) {
      if (roles[a][1] === roles[b][1]) return 'The column ' + colName(sn, roles[a][1]) + ' is assigned to both ' + roles[a][0] + ' and ' + roles[b][0] + '; each column takes one role.';
    }
  }
  if (pending.wide) {
    for (const j of pending.wideCols) {
      if (j === m.time || j === m.rep || j === m.scenario) return 'The column ' + colName(sn, j) + ' is both a response and a role column.';
    }
  }
  if (m.kind === 'time' && endTimeValue() === undefined) return 'The end time must be a number or left blank.';
  return null;
}

// Builds the datasets the current mapping would give, without adding them.
function trialBuild() {
  const sn = pending.sniffed, m = pending.mapping;
  const base = Object.assign({}, m, { endTime: m.kind === 'time' ? (endTimeValue() ?? null) : null, name: m.name.trim() || 'data' });
  if (sn.format === 'minus1') { base.rep = null; base.scenario = null; }
  if (sn.format === 'single') { base.time = null; base.rep = null; base.scenario = null; }
  const cols = pending.wide ? Array.from(pending.wideCols).sort((a, b) => a - b) : [base.value];
  const datasets = [];
  const issues = [];
  const seen = new Set();
  for (const j of cols) {
    const mm = Object.assign({}, base, { value: j, name: pending.wide ? base.name + ' · ' + colName(sn, j) : base.name });
    const res = buildDatasets(sn, mm);
    for (const ds of res.datasets) { ds.source.file = pending.fileName; datasets.push(ds); }
    for (const it of res.issues) {
      const key = it.line + '|' + it.reason;
      if (!seen.has(key)) { seen.add(key); issues.push(it); }
    }
  }
  issues.sort((a, b) => a.line - b.line);
  return { datasets, issues };
}

function roleSelect(idName, label, cols, value, allowNone, tip) {
  const opts = (allowNone ? '<option value="">none</option>' : '') +
    cols.map(j => '<option value="' + j + '"' + (j === value ? ' selected' : '') + '>' + esc(colName(pending.sniffed, j)) + '</option>').join('');
  const lab = tip ? '<span class="tip" tabindex="0" data-tip="' + esc(tip) + '">' + label + '</span>' : label;
  return '<span class="ctrl-pair"><label class="ctrl-lbl" for="' + idName + '">' + lab + '</label><select id="' + idName + '">' + opts + '</select></span>';
}

function renderDialog() {
  const box = els.dialog;
  if (!box) return;
  box.innerHTML = '';
  if (!pending) return;
  const sn = pending.sniffed, m = pending.mapping;
  const allCols = Array.from({ length: sn.nCols }, (_, j) => j);
  const usable = sn.rows.filter(r => r.ok).length;
  const waiting = ' <span class="ctrl-note" id="im-waiting">' + (queue.length ? '(' + plural(queue.length, 'more file') + ' waiting)' : '') + '</span>';

  const sec = document.createElement('div');
  sec.className = 'sec im-dialog';
  sec.setAttribute('role', 'region');
  sec.setAttribute('aria-label', 'Assign columns');

  // What the reader found.
  const facts = [
    ['File', esc(pending.fileName)],
    ['Delimiter', esc(pending.delimiter)],
    ['Header', sn.header ? 'yes: ' + esc(sn.header.join(', ')) : 'none'],
    ['Detected format', esc(FORMAT_LABEL[sn.format] || sn.format)],
    ['Data rows', intl(usable) + ' usable of ' + intl(sn.rows.length)],
    ['Blank lines', intl(sn.blanks)],
    ['Comment lines', intl(sn.comments)],
    ['Malformed rows', intl(sn.issues.length)]
  ];
  let html = '<div class="sec-hd">Assign columns' + waiting + '</div>' +
    '<dl class="im-facts">' + facts.map(f => '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>').join('') + '</dl>';

  // Preview of the first rows.
  const prev = sn.rows.slice(0, 8);
  const heads = allCols.map(j => '<th>' + esc(colName(sn, j)) + '</th>').join('');
  const body = prev.map(r => '<tr' + (r.ok ? '' : ' class="im-bad"') + '><td>' + intl(r.line) + '</td>' +
    allCols.map(j => '<td>' + esc(r.cells[j] !== undefined ? r.cells[j] : '') + '</td>').join('') +
    '<td>' + (r.ok ? 'read' : 'rejected') + '</td></tr>').join('');
  html += '<div class="ctrl-grp-lbl">First ' + plural(prev.length, 'row') + ' of ' + intl(sn.rows.length) + '</div>' +
    '<div class="scroll-box im-prev"><table class="ptab"><thead><tr><th>Line</th>' + heads + '<th>Status</th></tr></thead><tbody>' + body + '</tbody></table></div>';

  // Roles.
  html += '<div class="ctrl-grp-lbl im-gap">Roles</div><div class="ctrl-row im-roles">';
  const wideCols = wideCandidates();
  const showWide = sn.format === 'columns' && wideCols.length >= 2;
  if (!showWide) pending.wide = false;
  html += '<span id="im-value-wrap">' + roleSelect('im-value', 'Value column', sn.numericCols, m.value, false) + '</span>';
  if (sn.format !== 'single') {
    html += roleSelect('im-time', 'Time column', sn.numericCols, m.time, true, 'The simulation time at which each value was recorded. A time-persistent state needs one; a tally may have one.');
  }
  if (sn.format === 'columns') {
    html += roleSelect('im-rep', 'Replication column', allCols, m.rep, true, 'The column naming the replication each row belongs to. With none, the rows form one replication; for one value per replication, each row is its own replication.');
    html += roleSelect('im-scen', 'Scenario column', allCols, m.scenario, true, 'The column naming the design or scenario. Each distinct value becomes its own dataset.');
  }
  html += '</div>';
  if (sn.format === 'minus1') html += '<p class="ctrl-note im-gap-b">The rows whose first value is −1 mark where each replication ends.</p>';
  if (showWide) {
    html += '<label class="ctrl-chk"><input type="checkbox" id="im-wide"' + (pending.wide ? ' checked' : '') + '> Load every numeric column as its own dataset</label>' +
      '<div class="ds-list im-wide-list" id="im-wide-list"' + (pending.wide ? '' : ' hidden') + '></div>';
  }

  // Statistic type.
  html += '<div class="ctrl-grp-lbl im-gap">Statistic type</div>' +
    '<div class="seg im-seg" role="group" aria-label="Statistic type">' +
    KINDS.map(k => '<button type="button" class="seg-btn" data-kind="' + k.kind + '" aria-pressed="false" aria-describedby="im-kind-' + k.kind + '">' + k.label + '</button>').join('') +
    '</div>' +
    KINDS.map(k => '<span class="sr-only" id="im-kind-' + k.kind + '">' + esc(k.tip) + '</span>').join('') +
    '<p class="ctrl-note im-kind-note" id="im-kind-note"></p>';

  // End time and display name.
  html += '<div class="ctrl-row im-gap">' +
    '<span class="ctrl-pair" id="im-end-wrap"><label class="ctrl-lbl" for="im-end"><span class="tip" tabindex="0" data-tip="The last recorded value holds until this time. Left blank, it holds for no time.">End time</span></label>' +
    '<input type="text" id="im-end" class="par-inp" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="optional" aria-describedby="im-end-desc"></span>' +
    '<span class="sr-only" id="im-end-desc">The last recorded value holds until this time. Left blank, it holds for no time.</span>' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="im-name">Display name</label><input type="text" id="im-name" class="txt-inp" autocomplete="off" spellcheck="false"></span>' +
    '</div>';

  html += '<p class="im-preview" id="im-preview" aria-live="polite"></p>' +
    '<div id="im-issues"></div>' +
    '<div class="im-accept-row"><button type="button" class="btn-run" id="im-accept">Accept</button>' +
    '<button type="button" class="btn-clear" id="im-cancel">Cancel</button>' +
    '<span class="im-need" id="im-need" aria-live="polite"></span></div>';

  sec.innerHTML = html;
  box.appendChild(sec);

  const q = s => sec.querySelector(s);
  const intOrNull = v => (v === '' ? null : Number(v));
  q('#im-value').addEventListener('change', e => { m.value = intOrNull(e.target.value); updateDialog(); });
  if (q('#im-time')) q('#im-time').addEventListener('change', e => {
    m.time = intOrNull(e.target.value);
    if (m.time == null && m.kind === 'time') m.kind = null;
    refreshWide(); updateDialog();
  });
  if (q('#im-rep')) q('#im-rep').addEventListener('change', e => { m.rep = intOrNull(e.target.value); refreshWide(); updateDialog(); });
  if (q('#im-scen')) q('#im-scen').addEventListener('change', e => { m.scenario = intOrNull(e.target.value); refreshWide(); updateDialog(); });
  if (q('#im-wide')) q('#im-wide').addEventListener('change', e => {
    pending.wide = e.target.checked;
    if (pending.wide && !pending.wideCols) pending.wideCols = new Set(wideCandidates());
    refreshWide(); updateDialog();
  });
  sec.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    m.kind = b.getAttribute('data-kind');
    updateDialog();
  }));
  const end = q('#im-end');
  end.value = pending.endText;
  end.addEventListener('input', () => { pending.endText = end.value; updateDialog(); });
  const nm = q('#im-name');
  nm.value = m.name;
  nm.addEventListener('input', () => { m.name = nm.value; updateDialog(); });
  q('#im-accept').addEventListener('click', accept);
  q('#im-cancel').addEventListener('click', () => { nextPending(); });

  refreshWide();
  updateDialog();
  registerTips(sec);
}

// Rebuilds the response checklist for wide files from the current roles.
function refreshWide() {
  const list = els.dialog.querySelector('#im-wide-list');
  const valueWrap = els.dialog.querySelector('#im-value-wrap');
  if (valueWrap) valueWrap.hidden = !!pending.wide;
  if (!list) return;
  list.hidden = !pending.wide;
  if (!pending.wide) return;
  const cand = wideCandidates();
  for (const j of Array.from(pending.wideCols)) if (!cand.includes(j)) pending.wideCols.delete(j);
  list.innerHTML = '';
  for (const j of cand) {
    const lab = document.createElement('label');
    lab.className = 'ds-chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = pending.wideCols.has(j);
    cb.addEventListener('change', () => { if (cb.checked) pending.wideCols.add(j); else pending.wideCols.delete(j); updateDialog(); });
    const span = document.createElement('span');
    span.textContent = colName(pending.sniffed, j);
    lab.appendChild(cb); lab.appendChild(span);
    list.appendChild(lab);
  }
}

// Updates the parts of the dialog that follow the mapping: the statistic
// type buttons, the end-time field, the preview sentence, the issue list,
// and whether Accept is enabled.
function updateDialog() {
  const sec = els.dialog.querySelector('.im-dialog');
  if (!sec || !pending) return;
  const sn = pending.sniffed, m = pending.mapping;
  sec.querySelectorAll('.seg-btn').forEach(b => {
    const k = b.getAttribute('data-kind');
    b.disabled = k === 'time' && m.time == null;
    b.setAttribute('aria-pressed', String(m.kind === k));
  });
  const note = sec.querySelector('#im-kind-note');
  const kindTip = KINDS.find(k => k.kind === m.kind);
  note.textContent = (kindTip ? kindTip.tip : 'The file does not say what the values are.') +
    (m.time == null ? ' A time-persistent state needs a time column.' : '');
  sec.querySelector('#im-end-wrap').hidden = m.kind !== 'time';
  const end = sec.querySelector('#im-end');
  end.setAttribute('aria-invalid', String(m.kind === 'time' && endTimeValue() === undefined));

  const problem = mappingProblem();
  const accept = sec.querySelector('#im-accept');
  const need = sec.querySelector('#im-need');
  const prevEl = sec.querySelector('#im-preview');
  const issuesEl = sec.querySelector('#im-issues');
  issuesEl.innerHTML = '';
  let issues = sn.issues;
  let ok = !problem;
  if (ok) {
    try {
      const res = trialBuild();
      issues = res.issues;
      if (!res.datasets.length) {
        ok = false;
        need.textContent = 'No usable rows remain under this mapping.';
        prevEl.textContent = '';
      } else {
        need.textContent = '';
        const parts = res.datasets.slice(0, 6).map(ds => ds.name + ' (R = ' + intl(ds.reps.length) + ')');
        if (res.datasets.length > 6) parts.push('and ' + intl(res.datasets.length - 6) + ' more');
        const what = { tally: 'tally observations', time: 'a time-persistent state', reps: 'one value per replication' }[m.kind];
        prevEl.textContent = 'Accepting adds ' + plural(res.datasets.length, 'dataset') + ' of ' + what + ': ' + parts.join(', ') + '.';
      }
    } catch (err) {
      ok = false;
      need.textContent = err.message;
      prevEl.textContent = '';
    }
  } else {
    need.textContent = problem;
    prevEl.textContent = '';
  }
  accept.disabled = !ok;
  if (issues.length) {
    const n = notice('warn', '<p>Under this mapping, ' + esc(plural(issues.length, 'row is', 'rows are')) + ' not read. Open the list for each one’s line number and the reason.</p>');
    const list = issueList(issues);
    n.querySelector('.notice-body').appendChild(list);
    issuesEl.appendChild(n);
  } else {
    issuesEl.appendChild(issueList([]));
  }
}

function accept() {
  if (!pending || mappingProblem()) return;
  let res;
  try {
    res = trialBuild();
  } catch (err) {
    els.dialog.querySelector('#im-need').textContent = err.message;
    return;
  }
  if (!res.datasets.length) return;
  const { added, skipped } = addNew(res.datasets);
  lastImport = {
    what: pending.fileName === 'pasted data' || pending.fileName === 'dropped text' ? 'the ' + pending.fileName : pending.fileName,
    datasets: added,
    skipped,
    issues: res.issues,
    notes: collectNotes(added)
  };
  renderStatus();
  nextPending();
}

// ── Status of the last import ───────────────────────────────────────────

function renderStatus() {
  const box = els.status;
  if (!box) return;
  box.innerHTML = '';
  if (!lastImport) return;
  if (lastImport.error) { box.appendChild(notice('warn', esc(lastImport.error))); return; }
  const skipped = lastImport.skipped || [];
  const names = lastImport.datasets.map(ds => '<b>' + esc(ds.name) + '</b> (' + esc(KIND_LABEL[ds.kind]) + ', R = ' + intl(ds.reps.length) + ')').join(', ');
  let html = lastImport.datasets.length
    ? '<p>Added ' + plural(lastImport.datasets.length, 'dataset') + ' from ' + esc(lastImport.what) + ': ' + names + '. Open <a href="#explore">Summary and Plots</a> to look at ' + (lastImport.datasets.length === 1 ? 'it' : 'them') + '.</p>'
    : '<p>Nothing was added from ' + esc(lastImport.what) + '.</p>';
  for (const sk of skipped) {
    html += '<p><b>' + esc(sk.name) + '</b> is already loaded' + (sk.as.name === sk.name ? '' : ' as <b>' + esc(sk.as.name) + '</b>') + ', with the same data, and was not added again.</p>';
  }
  for (const n of lastImport.notes) html += '<p>' + esc(n) + '</p>';
  box.appendChild(notice('info', html));
  if (lastImport.issues.length) {
    const n = notice('warn', '<p>' + esc(plural(lastImport.issues.length, 'row was', 'rows were')) + ' not read from ' + esc(lastImport.what) + '. Open the list for each one’s line number and the reason.</p>');
    n.querySelector('.notice-body').appendChild(issueList(lastImport.issues));
    box.appendChild(n);
  }
}

// ── The loaded datasets ─────────────────────────────────────────────────

function sourceText(ds) {
  const fmt = FORMAT_LABEL[ds.source.format] ? (ds.source.format === 'minus1' ? '−1 delimited records' : FORMAT_LABEL[ds.source.format]) : ds.source.format;
  let s = (ds.source.file || '–') + (fmt ? ' · ' + fmt : '');
  if (ds.derivedFrom && ds.derivedFrom.truncate) {
    const tr = ds.derivedFrom.truncate;
    s += ' · truncated ' + (tr.by === 'time' ? 'at time ' + num(tr.at) : 'after ' + plural(tr.at, 'observation'));
  }
  return s;
}

function renderList() {
  const box = els.list;
  if (!box) return;
  // The control that had focus is found again after the redraw by its
  // data-focus key, so that a toggle or a name box keeps focus.
  const active = document.activeElement;
  const focusKey = active && box.contains(active) && active.dataset ? active.dataset.focus || null : null;
  box.innerHTML = '';
  const list = state.datasets;
  for (const set of [expanded, exportOpen]) {
    for (const idx of Array.from(set)) if (!list.some(d => d.id === idx)) set.delete(idx);
  }
  if (!list.length) {
    box.innerHTML = '<p class="muted-line">No datasets loaded yet. Load a file, paste data, or load an example above.</p>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'tab-wrap im-ds-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'ptab im-ds-tab';
  tbl.innerHTML = '<thead><tr><th>Name</th><th>Type</th><th>Replications</th><th>Observations</th><th>Source</th><th>Rejected rows</th><th class="no-print">Export</th><th class="no-print"><span class="sr-only">Remove</span></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const ds of list) {
    let nObs = 0;
    for (const r of ds.reps) nObs += r.v.length;
    const tr = document.createElement('tr');
    const nIss = ds.issues.length, nNotes = ds.source.notes.length;
    tr.innerHTML =
      '<td><input type="text" class="txt-inp im-name" aria-label="Display name of ' + esc(ds.name) + '"></td>' +
      '<td><span class="kind-badge">' + esc(KIND_LABEL[ds.kind] || ds.kind) + '</span></td>' +
      '<td>' + intl(ds.reps.length) + '</td>' +
      '<td>' + intl(nObs) + '</td>' +
      '<td class="im-src">' + breakPoints(esc(sourceText(ds))) + '</td>' +
      '<td class="im-rej"></td>' +
      '<td class="no-print"><button type="button" class="im-link im-xp"></button></td>' +
      '<td class="no-print"><button type="button" class="btn-clear im-rm">Remove</button></td>';
    const inp = tr.querySelector('.im-name');
    inp.value = ds.name;
    inp.dataset.focus = 'name:' + ds.id;
    // A rename redraws the table. Enter renames at once, and the redraw puts
    // focus back in the new name box. Leaving the box (by Tab or a click)
    // renames once focus has moved on, and so the redraw finds the control
    // that now has focus and gives it focus again.
    const commit = () => {
      const v = inp.value.trim();
      if (!v) { inp.value = ds.name; return; }
      if (v !== ds.name) state.rename(ds.id, v);
    };
    inp.addEventListener('change', () => setTimeout(commit, 0));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    const rej = tr.querySelector('.im-rej');
    if (nIss || nNotes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'im-link';
      b.textContent = 'Rows rejected: ' + intl(nIss) + (nNotes ? ' · ' + plural(nNotes, 'note') : '');
      b.setAttribute('aria-expanded', String(expanded.has(ds.id)));
      b.dataset.focus = 'rej:' + ds.id;
      b.addEventListener('click', () => {
        if (expanded.has(ds.id)) expanded.delete(ds.id); else expanded.add(ds.id);
        renderList();
      });
      rej.appendChild(b);
    } else {
      rej.textContent = 'none';
    }
    const xp = tr.querySelector('.im-xp');
    xp.textContent = 'Export';
    xp.setAttribute('aria-label', 'Export ' + ds.name);
    xp.setAttribute('aria-expanded', String(exportOpen.has(ds.id)));
    xp.dataset.focus = 'xp:' + ds.id;
    xp.addEventListener('click', () => {
      if (exportOpen.has(ds.id)) exportOpen.delete(ds.id); else exportOpen.add(ds.id);
      renderList();
    });
    const rm = tr.querySelector('.im-rm');
    rm.dataset.focus = 'rm:' + ds.id;
    rm.addEventListener('click', () => { expanded.delete(ds.id); exportOpen.delete(ds.id); state.remove(ds.id); });
    tb.appendChild(tr);
    if (expanded.has(ds.id) && (nIss || nNotes)) {
      const er = document.createElement('tr');
      er.className = 'im-exp-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      for (const n of ds.source.notes) {
        const p = document.createElement('p');
        p.className = 'muted-line';
        p.textContent = n;
        td.appendChild(p);
      }
      const il = issueList(ds.issues);
      if (il.tagName === 'DETAILS') il.open = true;
      td.appendChild(il);
      er.appendChild(td);
      tb.appendChild(er);
    }
    // The data files of the dataset, in a box held to the width of the
    // table's scrolling frame, so that on a narrow screen the buttons wrap
    // where they can be seen.
    if (exportOpen.has(ds.id)) {
      const er = document.createElement('tr');
      er.className = 'im-exp-row no-print';
      const td = document.createElement('td');
      td.colSpan = 8;
      const inner = document.createElement('div');
      inner.className = 'im-xp-box';
      const files = document.createElement('div');
      files.setAttribute('role', 'group');
      files.setAttribute('aria-label', 'Data files of ' + ds.name);
      inner.appendChild(files);
      inner.appendChild(details('What each data file holds', dataFilesHelp(ds)));
      td.appendChild(inner);
      er.appendChild(td);
      tb.appendChild(er);
      fileButtons(files, datasetFiles(ds));
    }
  }
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  box.appendChild(wrap);

  const row = document.createElement('div');
  row.className = 'ctrl-row im-rm-all no-print';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'btn-clear';
  all.textContent = 'Remove all';
  all.addEventListener('click', () => {
    if (all.dataset.armed === '1') {
      clearTimeout(removeAllTimer);
      expanded.clear();
      for (const ds of state.datasets.slice()) state.remove(ds.id);
      return;
    }
    all.dataset.armed = '1';
    all.textContent = 'Click again to remove all ' + plural(state.datasets.length, 'dataset');
    clearTimeout(removeAllTimer);
    removeAllTimer = setTimeout(() => {
      if (!all.isConnected) return;
      all.dataset.armed = '';
      all.textContent = 'Remove all';
    }, 3000);
  });
  // Every dataset in two files, beside Remove all.
  const xa = document.createElement('div');
  xa.className = 'im-xp-all no-print';
  xa.setAttribute('role', 'group');
  xa.setAttribute('aria-label', 'Export all datasets');
  xa.innerHTML = '<span class="im-xp-lbl">Export all</span><div class="im-xp-all-files"></div>';
  const none = !list.length;
  const note = none ? 'Load a dataset first.' : '';
  fileButtons(xa.querySelector('.im-xp-all-files'), [
    { label: 'Observations CSV', tip: ALL_OBS_TIP, disabled: none, note,
      run: () => downloadText('datasets_observations.csv', datasetsObservationsCsv(state.datasets, { exported: stamp(new Date()) })) },
    { label: 'Replication summary CSV', tip: ALL_REPS_TIP, disabled: none,
      run: () => downloadText('datasets_replications.csv', datasetsReplicationsCsv(state.datasets, { exported: stamp(new Date()) })) }
  ]);
  row.appendChild(xa);
  row.appendChild(all);
  box.appendChild(row);

  if (focusKey) {
    const again = Array.from(box.querySelectorAll('[data-focus]')).find(e => e.dataset.focus === focusKey);
    if (again) again.focus();
  }
}

export default { id, title, render, onShow };
