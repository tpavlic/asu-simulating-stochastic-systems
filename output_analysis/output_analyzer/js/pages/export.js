// The Export page: CSV files of the loaded data (the observations, one row
// per replication, and the pilot-ready columns a sample-size planner reads),
// CSV files of every result an analysis page has computed, a printable
// summary in a new window or as plain text, and the session-restore status.
// Every CSV starts with `#` lines carrying the choices that produced it.

import * as state from '../state.js';
import { repEstimates, repIds, canInfer, datasetSummary } from '../data/model.js';
import {
  observationsCsv, repSummaryCsv, pilotCsv, tableCsv, provenanceLines, downloadText
} from '../io/export.js';
import { matchPairs } from '../stats/compare.js';
import { KIND_LABEL, datasetSelect, details } from '../ui/widgets.js';
import { registerTips } from '../ui/tooltip.js';
import { esc, intl, num, plural } from '../ui/format.js';
import { sessionStatus, forgetSession, MAX_CHARS } from '../ui/session.js';

// A table name follows "Download" mid-sentence, and so its first letter is
// lowered unless the first word is an acronym (ANOVA) or a person's name.
function lowerFirst(s) {
  s = String(s);
  if (/^(Pearson|Welch|Tukey|Bonferroni|Dunnett|Fisher|Rinott)\b/.test(s)) return s;
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/** The page's hash id. */
export const id = 'export';
/** The page's title. */
export const title = 'Export';

// Results are listed in the order the pages appear in the navigation; a page
// not named here follows, in the order its result arrived.
const PAGE_ORDER = ['import', 'explore', 'one', 'two', 'several', 'variance', 'steady'];

const ESTIMATE_LABEL = {
  tally: 'replication mean',
  time: 'time-weighted replication mean',
  reps: 'one value per replication'
};

const PILOT_TIP = 'One bare numeric column of replication estimates, the form a pilot-data paste box reads; such a reader skips the header and the # lines.';
const PAIRED_TIP = 'Two matched columns, read as a paired pilot.';
const ONECOL_TIP = 'Every observation in one bare column under the response name, the form a distribution-fitting tool reads. The replication boundaries are left out.';

let el = null;               // the page's live elements
let pairA = null, pairB = null;
const seenAt = new Map();    // page id -> when its current result arrived

function pad2(n) { return String(n).padStart(2, '0'); }

function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function slug(s) {
  const t = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (t || 'data').slice(0, 60);
}

function truncationText(ds) {
  const tr = ds.derivedFrom && ds.derivedFrom.truncate;
  if (!tr) return undefined;
  const what = ds.kind === 'time' ? 'records' : 'observations';
  return tr.by === 'time'
    ? what + ' before time ' + tr.at + ' removed'
    : 'first ' + tr.at + ' ' + what + ' of each replication removed';
}

function derivedName(ds) {
  if (!ds.derivedFrom) return undefined;
  const parent = state.get(ds.derivedFrom.id);
  return parent ? parent.name : ds.derivedFrom.id;
}

function finiteCount(ds) {
  let n = 0;
  for (const v of repEstimates(ds)) if (Number.isFinite(v)) n++;
  return n;
}

// The `#` lines every data file carries: what the dataset is, where it came
// from, and how it was derived when it was truncated.
function dsProvenance(ds, extra) {
  const p = {
    dataset: ds.name,
    kind: KIND_LABEL[ds.kind] || ds.kind,
    response: ds.response,
    replications: ds.reps.length
  };
  if (ds.source && ds.source.file) p['source file'] = ds.source.file;
  if (ds.derivedFrom) {
    p['derived from'] = derivedName(ds);
    p.truncation = truncationText(ds);
  }
  Object.assign(p, extra || {});
  p.exported = stamp(new Date());
  return p;
}

// ── Data card ─────────────────────────────────────────────────────────

function dataButtons(ds) {
  const pilotOk = finiteCount(ds) >= 2;
  const b = [];
  b.push('<button type="button" class="xp-btn" data-act="obs">Observations CSV</button>');
  if (ds.kind !== 'time') {
    b.push('<button type="button" class="xp-btn" data-act="obs1" data-tip="' + esc(ONECOL_TIP) + '" data-tip-press>Observations, one column</button>');
  }
  b.push('<button type="button" class="xp-btn" data-act="reps">Replication summary CSV</button>');
  b.push('<button type="button" class="xp-btn" data-act="pilot"' + (pilotOk ? '' : ' disabled') +
    ' data-tip="' + esc(PILOT_TIP) + '" data-tip-press>Pilot-ready CSV</button>');
  return b.join('');
}

function renderDataList() {
  const list = el.dataList;
  if (!state.datasets.length) {
    list.innerHTML = '<p class="muted-line">No data loaded. Load a file, paste data, or open an example on the <a href="#import">Import</a> page.</p>';
    return;
  }
  list.innerHTML = state.datasets.map(ds => {
    const meta = [KIND_LABEL[ds.kind] || ds.kind, 'R = ' + intl(ds.reps.length)];
    if (ds.derivedFrom) meta.push('derived from ' + derivedName(ds));
    const noPilot = finiteCount(ds) < 2
      ? '<span class="xp-prov">A pilot needs at least two replication estimates, and this dataset has ' + intl(finiteCount(ds)) + '.</span>'
      : '';
    return '<div class="xp-item" data-ds="' + esc(ds.id) + '">' +
      '<div class="xp-id"><span class="xp-name">' + esc(ds.name) + '</span><span class="xp-meta">' + esc(meta.join(' · ')) + '</span></div>' +
      '<div class="xp-btns">' + dataButtons(ds) + '</div>' + noPilot + '</div>';
  }).join('');
}

function onDataClick(ev) {
  const btn = ev.target.closest('button[data-act]');
  if (!btn || btn.disabled) return;
  const row = btn.closest('[data-ds]');
  const ds = row && state.get(row.getAttribute('data-ds'));
  if (!ds) return;
  const base = slug(ds.name);
  const act = btn.getAttribute('data-act');
  if (act === 'obs') {
    downloadText(base + '_observations.csv', observationsCsv(ds, dsProvenance(ds), { full: true }));
  } else if (act === 'obs1') {
    downloadText(base + '_observations_column.csv', observationsCsv(ds, dsProvenance(ds)));
  } else if (act === 'reps') {
    downloadText(base + '_replications.csv', repSummaryCsv(ds, dsProvenance(ds, { estimate: ESTIMATE_LABEL[ds.kind] })));
  } else if (act === 'pilot') {
    downloadText(base + '_pilot.csv', pilotCsv(ds, dsProvenance(ds, { estimate: ESTIMATE_LABEL[ds.kind], form: 'pilot data, one column' })));
  }
}

// The replications of A and B matched by id, keeping only the pairs where
// both estimates are finite, as the two vectors the paired pilot writes.
function pairedVectors(a, b) {
  const m = matchPairs(repIds(a), repIds(b), 'id');
  const ea = repEstimates(a), eb = repEstimates(b);
  const xa = [], xb = [];
  let missing = 0;
  for (const [i, j] of m.pairs) {
    if (Number.isFinite(ea[i]) && Number.isFinite(eb[j])) { xa.push(ea[i]); xb.push(eb[j]); } else missing++;
  }
  return { xa: Float64Array.from(xa), xb: Float64Array.from(xb), unmatchedA: m.unmatchedA.length, unmatchedB: m.unmatchedB.length, missing };
}

function pairState() {
  const a = state.get(pairA ? pairA.value() : '');
  const b = state.get(pairB ? pairB.value() : '');
  if (!a || !b) return { ok: false, msg: state.datasets.length ? 'Choose two datasets with at least two replication estimates each.' : '' };
  if (a.id === b.id) return { ok: false, msg: 'Choose two different datasets.' };
  const v = pairedVectors(a, b);
  const unmatched = v.unmatchedA + v.unmatchedB;
  let msg = plural(v.xa.length, 'pair') + ' matched by replication id';
  if (unmatched) msg += '; ' + plural(unmatched, 'replication') + ' without a partner left out (' + intl(v.unmatchedA) + ' in A, ' + intl(v.unmatchedB) + ' in B)';
  if (v.missing) msg += '; ' + plural(v.missing, 'pair') + ' with a missing estimate left out';
  msg += '.';
  if (v.xa.length < 2) return { ok: false, msg: msg + ' A paired pilot needs at least two pairs.' };
  return { ok: true, msg, a, b, v };
}

function refreshPair() {
  const s = pairState();
  el.pairBtn.disabled = !s.ok;
  el.pairNote.textContent = s.msg;
}

function downloadPaired() {
  const s = pairState();
  if (!s.ok) return;
  const { a, b, v } = s;
  const prov = {
    'dataset A': a.name,
    'dataset B': b.name,
    kind: a.kind === b.kind ? (KIND_LABEL[a.kind] || a.kind) : (KIND_LABEL[a.kind] || a.kind) + ' (A), ' + (KIND_LABEL[b.kind] || b.kind) + ' (B)',
    estimate: a.kind === b.kind ? ESTIMATE_LABEL[a.kind] : ESTIMATE_LABEL[a.kind] + ' (A), ' + ESTIMATE_LABEL[b.kind] + ' (B)',
    'matched by': 'replication id',
    pairs: v.xa.length,
    'unmatched replications': v.unmatchedA + v.unmatchedB + ' (' + v.unmatchedA + ' in A, ' + v.unmatchedB + ' in B)'
  };
  if (v.missing) prov['pairs with a missing estimate'] = v.missing;
  if (a.derivedFrom) { prov['A derived from'] = derivedName(a); prov['A truncation'] = truncationText(a); }
  if (b.derivedFrom) { prov['B derived from'] = derivedName(b); prov['B truncation'] = truncationText(b); }
  prov.form = 'pilot data, two matched columns';
  prov.exported = stamp(new Date());
  downloadText('paired_pilot_' + slug(a.name) + '_vs_' + slug(b.name) + '.csv', pilotCsv([v.xa, v.xb], prov));
}

// ── Results card ──────────────────────────────────────────────────────

function currentResults() {
  const keys = Object.keys(state.results).filter(k => state.results[k]);
  keys.sort((x, y) => {
    const ix = PAGE_ORDER.indexOf(x), iy = PAGE_ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  return keys.map(k => ({ pageId: k, r: state.results[k], at: seenAt.get(k) || null }));
}

function resultProvenance(item, table) {
  const p = {};
  if (table) p.table = table.name;
  p.result = item.r.title;
  if (item.at) p.computed = stamp(item.at);
  Object.assign(p, item.r.provenance || {});
  return p;
}

function tableBlock(item, t) {
  return tableCsv(t.headers || [], t.rows || [], resultProvenance(item, t));
}

function provText(prov) {
  return Object.entries(prov || {}).filter(([, v]) => v !== undefined)
    .map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v))).join(' · ');
}

function renderResults() {
  const items = currentResults();
  el.allBtn.disabled = !items.some(it => (it.r.tables || []).length);
  el.printBtn.disabled = !state.datasets.length && !items.length;
  el.copyBtn.disabled = el.printBtn.disabled;
  if (!items.length) {
    el.resList.innerHTML = '<p class="muted-line">No results yet. Each analysis page adds its tables here as soon as it computes them.</p>';
    return;
  }
  el.resList.innerHTML = items.map(it => {
    const tables = it.r.tables || [];
    const btns = tables.map((t, i) => '<button type="button" class="xp-btn" data-page="' + esc(it.pageId) + '" data-table="' + i + '">Download ' + esc(lowerFirst(t.name)) + '</button>').join('');
    const when = it.at ? 'computed ' + it.at.toLocaleTimeString() : '';
    const prov = provText(it.r.provenance);
    return '<div class="xp-item">' +
      '<div class="xp-id"><span class="xp-name">' + esc(it.r.title) + '</span>' + (when ? '<span class="xp-meta">' + esc(when) + '</span>' : '') + '</div>' +
      '<div class="xp-btns">' + (btns || '<span class="xp-meta">No tables</span>') + '</div>' +
      (prov ? '<span class="xp-prov">' + esc(prov) + '</span>' : '') + '</div>';
  }).join('');
}

function onResultClick(ev) {
  const btn = ev.target.closest('button[data-page]');
  if (!btn) return;
  const pageId = btn.getAttribute('data-page');
  const r = state.results[pageId];
  const t = r && r.tables && r.tables[Number(btn.getAttribute('data-table'))];
  if (!t) return;
  const item = { pageId, r, at: seenAt.get(pageId) || null };
  const body = provenanceLines({ exported: stamp(new Date()) }).join('\n') + '\n' + tableBlock(item, t);
  downloadText(slug(pageId) + '_' + slug(t.name) + '.csv', body);
}

function downloadAll() {
  const blocks = [];
  for (const it of currentResults()) for (const t of it.r.tables || []) blocks.push(tableBlock(it, t));
  if (!blocks.length) return;
  const head = provenanceLines({ exported: stamp(new Date()), tables: blocks.length }).join('\n') + '\n';
  downloadText('output_analyzer_results.csv', head + '\n' + blocks.join('\n'));
}

// ── Printable summary ─────────────────────────────────────────────────

function datasetRows() {
  return state.datasets.map(ds => {
    const s = datasetSummary(ds);
    return [
      ds.name,
      KIND_LABEL[ds.kind] || ds.kind,
      s.nReps,
      s.nObs,
      s.est ? num(s.est.mean, 5) : '–',
      ds.derivedFrom ? derivedName(ds) + ' (' + truncationText(ds) + ')' : ''
    ];
  });
}
const DATASET_HEADERS = ['Dataset', 'Kind', 'Replications', 'Observations', 'Mean of estimates', 'Derived from'];

function htmlTable(headers, rows) {
  return '<table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + esc(typeof c === 'number' ? num(c, 6) : (c == null ? '' : c)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
}

function provList(prov) {
  const rows = Object.entries(prov).filter(([, v]) => v !== undefined);
  if (!rows.length) return '';
  return '<dl class="prov">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(Array.isArray(v) ? v.join(', ') : String(v)) + '</dd>').join('') + '</dl>';
}

function summaryBodyHtml(now) {
  let h = '<h1>Output Analyzer summary</h1><p class="date">' + esc(stamp(now)) + '</p>';
  h += '<h2>Loaded datasets</h2>';
  h += state.datasets.length ? htmlTable(DATASET_HEADERS, datasetRows()) : '<p>No data loaded.</p>';
  const items = currentResults();
  for (const it of items) {
    h += '<section class="res"><h2>' + esc(it.r.title) + '</h2>';
    const prov = Object.assign(it.at ? { computed: stamp(it.at) } : {}, it.r.provenance || {});
    h += provList(prov);
    if (it.r.summaryHtml) h += '<div class="sum">' + it.r.summaryHtml + '</div>';
    else for (const t of it.r.tables || []) h += '<h3>' + esc(t.name) + '</h3>' + htmlTable(t.headers || [], t.rows || []);
    h += '</section>';
  }
  if (!items.length) h += '<p>No analysis results yet.</p>';
  return h;
}

const PRINT_CSS = [
  'html, body { background: #fff; color: #000; }',
  'body { font: 11pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 18mm 16mm; max-width: 180mm; }',
  '* { color: #000 !important; background: transparent !important; box-shadow: none !important; }',
  'h1 { font-size: 16pt; margin: 0 0 2pt; } h2 { font-size: 13pt; margin: 16pt 0 4pt; } h3 { font-size: 11pt; margin: 10pt 0 3pt; }',
  '.date { margin: 0 0 8pt; }',
  'table { border-collapse: collapse; margin: 4pt 0 8pt; font-size: 10pt; }',
  'th, td { border: 0.5pt solid #000; padding: 2pt 6pt; text-align: left; vertical-align: top; }',
  'th { font-weight: 700; }',
  'dl.prov { display: grid; grid-template-columns: max-content 1fr; gap: 0 10pt; font-size: 9pt; margin: 0 0 6pt; }',
  'dl.prov dt { font-weight: 700; } dl.prov dd { margin: 0; }',
  'section.res { break-inside: avoid-page; }',
  '.tools { margin: 0 0 12pt; } .tools button { font: inherit; padding: 4pt 12pt; cursor: pointer; }',
  '@media print { .tools { display: none; } body { margin: 0; } }'
].join('\n');

function openPrintable() {
  const now = new Date();
  const w = window.open('', '_blank');
  if (!w) {
    el.printNote.textContent = 'The browser blocked the new window. Allow pop-ups for this page, or copy the summary as text instead.';
    return;
  }
  el.printNote.textContent = '';
  const doc = w.document;
  doc.open();
  doc.write('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Output Analyzer summary</title><style>' + PRINT_CSS + '</style></head><body>' +
    '<div class="tools"><button type="button" id="print-btn">Print</button></div>' +
    summaryBodyHtml(now) + '</body></html>');
  doc.close();
  const b = doc.getElementById('print-btn');
  if (b) b.addEventListener('click', () => w.print());
}

// Plain text from summary markup: one line per block, table rows as
// tab-separated cells, and so a pasted table lands in spreadsheet columns.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
  const lines = [];
  let cur = '';
  const BLOCK = /^(P|DIV|SECTION|H[1-6]|LI|UL|OL|TABLE|THEAD|TBODY|DL|DT|DD|CAPTION|FIGURE|FIGCAPTION|BLOCKQUOTE|PRE)$/;
  const flush = () => { const t = cur.replace(/[ \t \r\n]+/g, ' ').trim(); if (t) lines.push(t); cur = ''; };
  const walk = n => {
    if (n.nodeType === 3) { cur += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG') return;
    if (tag === 'BR') { flush(); return; }
    if (tag === 'TR') {
      flush();
      lines.push(Array.from(n.children).map(c => c.textContent.replace(/\s+/g, ' ').trim()).join('\t'));
      return;
    }
    const block = BLOCK.test(tag);
    if (block) flush();
    for (const c of n.childNodes) walk(c);
    if (block) flush();
  };
  walk(doc.body);
  flush();
  return lines.join('\n');
}

function textTable(headers, rows) {
  const cell = c => (typeof c === 'number' ? num(c, 6) : (c == null ? '' : String(c)));
  return [headers.map(cell).join('\t')].concat(rows.map(r => r.map(cell).join('\t'))).join('\n');
}

function summaryText(now) {
  const out = ['Output Analyzer summary', stamp(now), '', 'Loaded datasets'];
  out.push(state.datasets.length ? textTable(DATASET_HEADERS, datasetRows()) : 'No data loaded.');
  const items = currentResults();
  for (const it of items) {
    out.push('', it.r.title);
    const prov = Object.assign(it.at ? { computed: stamp(it.at) } : {}, it.r.provenance || {});
    for (const [k, v] of Object.entries(prov)) if (v !== undefined) out.push(k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v)));
    if (it.r.summaryHtml) out.push(htmlToText(it.r.summaryHtml));
    else for (const t of it.r.tables || []) out.push('', t.name, textTable(t.headers || [], t.rows || []));
  }
  if (!items.length) out.push('', 'No analysis results yet.');
  return out.join('\n') + '\n';
}

async function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // A denied permission or an unfocused document; the fallback below
    // copies through a selection instead.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

let copyTimer = null;
async function copySummary() {
  const btn = el.copyBtn;
  const ok = await writeClipboard(summaryText(new Date()));
  // Holding the width keeps the shorter label from pulling the row in.
  btn.style.minWidth = btn.offsetWidth + 'px';
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { btn.textContent = 'Copy summary as text'; btn.style.minWidth = ''; }, 2000);
}

// ── Session card ──────────────────────────────────────────────────────

function sizeText(chars) {
  if (chars >= 1024 * 1024) return (chars / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(chars / 1024)) + ' KB';
}

function renderSession() {
  const s = sessionStatus();
  el.sessStatus.textContent = s.available
    ? 'Session restore is on: data stays in this browser until you forget it.'
    : 'Session restore is unavailable in this context: data stays in memory until the page is closed.';
  const lines = [];
  if (s.restored) lines.push('Restored ' + plural(s.restored, 'dataset') + ' from the last visit.');
  if (s.dropped) lines.push(plural(s.dropped, 'stored dataset', 'stored datasets') + ' could not be read and ' + (s.dropped === 1 ? 'was' : 'were') + ' dropped.');
  if (s.skipped === 'too-large') {
    lines.push('The loaded data come to ' + sizeText(s.chars) + ', over the ' + sizeText(MAX_CHARS) + ' that session restore keeps, and so they will not come back after a reload.');
  } else if (s.skipped === 'write-failed') {
    lines.push('The browser refused to store this session (its storage is full or blocked), and so it will not come back after a reload.');
  } else if (s.available && s.saved && state.datasets.length) {
    lines.push('Stored: ' + plural(state.datasets.length, 'dataset') + ' and the confidence level, ' + sizeText(s.chars) + '.');
  } else if (s.available) {
    lines.push('Nothing is stored: no data are loaded.');
  }
  el.sessSize.textContent = lines.join(' ');
  el.forgetBtn.disabled = !state.datasets.length && !s.saved;
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Download the loaded data, their replication summaries, and every result table as CSV files, or open a printable summary of the analyses. Every file starts with <code>#</code> lines that record the choices behind it (the dataset, the confidence level, any truncation, and the number of comparisons adjusted for) so that a result can be traced back to its data and settings.</p>' +

    '<div class="sec"><div class="sec-hd">Data</div>' +
    '<p class="exp-note">One row per loaded dataset. A pilot-ready file holds one numeric column of replication estimates, which a sample-size planner reads as pilot data.</p>' +
    '<div class="xp-list" id="xp-data"></div>' +
    '<div class="xp-pair">' +
    '<div class="ctrl-grp-lbl">Paired pilot</div>' +
    '<div class="ctrl-row xp-pair-row">' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="xp-pa">A</label><select id="xp-pa"></select></span>' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="xp-pb">B</label><select id="xp-pb"></select></span>' +
    '<button type="button" class="xp-btn" id="xp-pair-btn" data-tip="' + esc(PAIRED_TIP) + '" data-tip-press>Paired pilot CSV</button>' +
    '</div>' +
    '<p class="muted-line" id="xp-pair-note" aria-live="polite"></p>' +
    '</div></div>' +

    '<div class="sec"><div class="sec-hd">Results</div>' +
    '<p class="exp-note">The latest result of each analysis page, with one file per table. The combined file holds every table, each after a <code># table:</code> line and its own <code>#</code> lines.</p>' +
    '<div class="xp-list" id="xp-res"></div>' +
    '<div class="xp-btns xp-all"><button type="button" class="btn-run2" id="xp-all">Download all results (one CSV)</button></div>' +
    '</div>' +

    '<div class="sec"><div class="sec-hd">Printable summary</div>' +
    '<p class="exp-note">The loaded datasets and every result on one plain page, each result preceded by the choices that produced it.</p>' +
    '<div class="xp-btns"><button type="button" class="btn-run2" id="xp-print">Open printable summary</button>' +
    '<button type="button" class="btn-run2" id="xp-copy">Copy summary as text</button></div>' +
    '<p class="muted-line" id="xp-print-note" aria-live="polite"></p>' +
    '</div>' +

    '<div class="sec"><div class="sec-hd">Session</div>' +
    '<p class="xp-status" id="xp-sess"></p>' +
    '<p class="muted-line" id="xp-sess-size" aria-live="polite"></p>' +
    '<div class="xp-btns"><button type="button" class="btn-clear" id="xp-forget">Forget this session</button></div>' +
    '</div>' +

    '<p class="exp-note">Plots are exported from their own SVG and PNG buttons, above each figure&rsquo;s top-right corner.</p>';

  const q = s => root.querySelector(s);
  el = {
    root,
    dataList: q('#xp-data'),
    pairBtn: q('#xp-pair-btn'),
    pairNote: q('#xp-pair-note'),
    resList: q('#xp-res'),
    allBtn: q('#xp-all'),
    printBtn: q('#xp-print'),
    copyBtn: q('#xp-copy'),
    printNote: q('#xp-print-note'),
    sessStatus: q('#xp-sess'),
    sessSize: q('#xp-sess-size'),
    forgetBtn: q('#xp-forget')
  };
  el.dataList.insertAdjacentElement('afterend', details('What each data file holds',
    '<p><strong>Observations CSV</strong>: every observation with its replication id, and its time where one was recorded. Time-persistent data always carry their times, because each value counts in proportion to how long it holds.</p>' +
    '<p><strong>Observations, one column</strong>: the same observations as one bare column, the form a distribution-fitting tool reads. It is not offered for time-persistent data.</p>' +
    '<p><strong>Replication summary CSV</strong>: one row per replication with its observation count and its estimate (the time-weighted mean for time-persistent data), plus the standard deviation, minimum, and maximum for tally data.</p>' +
    '<p><strong>Pilot-ready CSV</strong>: one column of replication estimates under the header <code>mean</code>. <strong>Paired pilot CSV</strong>: two columns, <code>mean_A</code> and <code>mean_B</code>, holding the estimates of replications with the same id in both datasets, as common random numbers would pair them. A replication without a partner is left out, and the count left out is in the file&rsquo;s <code>#</code> lines.</p>'));

  const pilotFilter = ds => canInfer(ds).ok;
  pairA = datasetSelect(q('#xp-pa'), { filter: pilotFilter });
  pairB = datasetSelect(q('#xp-pb'), { filter: pilotFilter });
  // Start B on a different dataset from A when there is one.
  const choosePairDefaults = () => {
    const opts = Array.from(q('#xp-pb').options).filter(o => o.value);
    if (q('#xp-pb').value === q('#xp-pa').value && opts.length > 1) {
      const other = opts.find(o => o.value !== q('#xp-pa').value);
      if (other) { q('#xp-pb').value = other.value; q('#xp-pb').dispatchEvent(new Event('change', { bubbles: true })); }
    }
  };
  q('#xp-pa').addEventListener('change', refreshPair);
  q('#xp-pb').addEventListener('change', refreshPair);

  el.dataList.addEventListener('click', onDataClick);
  el.pairBtn.addEventListener('click', downloadPaired);
  el.resList.addEventListener('click', onResultClick);
  el.allBtn.addEventListener('click', downloadAll);
  el.printBtn.addEventListener('click', openPrintable);
  el.copyBtn.addEventListener('click', copySummary);
  el.forgetBtn.addEventListener('click', () => { forgetSession(); refreshAll(); });

  state.on('datasets', () => { choosePairDefaults(); refreshAll(); });
  state.on('results', ({ pageId } = {}) => {
    if (pageId) {
      if (state.results[pageId]) seenAt.set(pageId, (state.results[pageId].computedAt instanceof Date) ? state.results[pageId].computedAt : new Date());
      else seenAt.delete(pageId);
    }
    renderResults();
  });
  state.on('session', renderSession);

  choosePairDefaults();
  refreshAll();
}

function refreshAll() {
  if (!el) return;
  renderDataList();
  refreshPair();
  renderResults();
  renderSession();
  registerTips(el.root);
}

/** Called each time the page is shown. */
export function onShow() {
  refreshAll();
}

export default { id, title, render, onShow };
