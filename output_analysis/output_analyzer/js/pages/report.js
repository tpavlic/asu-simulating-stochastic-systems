// The Report page: the loaded datasets and the latest result of every
// analysis page on one page, each result preceded by the choices that
// produced it, with buttons to print it (the print stylesheet drops the
// navigation), copy it as text, or download every result table as one CSV.

import * as state from '../state.js';
import { datasetSummary } from '../data/model.js';
import { provenanceLines, downloadText } from '../io/export.js';
import { KIND_LABEL } from '../ui/widgets.js';
import { esc, num } from '../ui/format.js';
import { stamp, truncationText, derivedName, tableBlock } from '../ui/exportrow.js';

/** The page's hash id. */
export const id = 'report';
/** The page's title. */
export const title = 'Report';

// Results are listed in the order the pages appear in the navigation; a page
// not named here follows, in the order its result arrived.
const PAGE_ORDER = ['import', 'explore', 'one', 'two', 'several', 'steady'];

let el = null;

function currentResults() {
  const keys = Object.keys(state.results).filter(k => state.results[k]);
  keys.sort((x, y) => {
    const ix = PAGE_ORDER.indexOf(x), iy = PAGE_ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  return keys.map(k => ({ pageId: k, r: state.results[k] }));
}

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
const DATASET_HEADERS = ['Dataset', 'Kind', 'Replications', 'Observations', 'Mean of outcomes', 'Derived from'];

function htmlTable(headers, rows) {
  return '<div class="scroll-box"><table class="ptab"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + esc(typeof c === 'number' ? num(c, 6) : (c == null ? '' : c)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}

function provEntries(r) {
  const p = r.computedAt instanceof Date ? { computed: stamp(r.computedAt) } : {};
  Object.assign(p, r.provenance || {});
  return Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
}

function provList(r) {
  const rows = provEntries(r);
  if (!rows.length) return '';
  return '<dl class="rp-prov">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
}

function summaryHtml(now) {
  let h = '<div class="sec rp-sec"><div class="sec-hd">Loaded datasets</div><p class="muted-line">' + esc(stamp(now)) + '</p>';
  h += state.datasets.length ? htmlTable(DATASET_HEADERS, datasetRows()) : '<p class="muted-line">No data loaded.</p>';
  h += '</div>';
  const items = currentResults();
  for (const it of items) {
    h += '<div class="sec rp-sec"><div class="sec-hd">' + esc(it.r.title) + '</div>';
    h += provList(it.r);
    if (it.r.summaryHtml) h += '<div class="rp-sum">' + it.r.summaryHtml + '</div>';
    for (const t of it.r.tables || []) h += '<div class="ctrl-grp-lbl rp-tbl">' + esc(t.name) + '</div>' + htmlTable(t.headers || [], t.rows || []);
    h += '</div>';
  }
  if (!items.length) h += '<div class="sec rp-sec"><p class="muted-line">No analysis results yet. Each analysis page adds its result here as soon as it computes one.</p></div>';
  return h;
}

// Plain text from summary markup: one line per block, table rows as
// tab-separated cells, and so a pasted table lands in spreadsheet columns.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
  const lines = [];
  let cur = '';
  const BLOCK = /^(P|DIV|SECTION|H[1-6]|LI|UL|OL|TABLE|THEAD|TBODY|DL|DT|DD|CAPTION|FIGURE|FIGCAPTION|BLOCKQUOTE|PRE)$/;
  const flush = () => { const t = cur.replace(/[ \t \r\n]+/g, ' ').trim(); if (t) lines.push(t); cur = ''; };
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
  const out = ['Output Analyzer report', stamp(now), '', 'Loaded datasets'];
  out.push(state.datasets.length ? textTable(DATASET_HEADERS, datasetRows()) : 'No data loaded.');
  const items = currentResults();
  for (const it of items) {
    out.push('', it.r.title);
    for (const [k, v] of provEntries(it.r)) out.push(k + ': ' + v);
    if (it.r.summaryHtml) out.push(htmlToText(it.r.summaryHtml));
    for (const t of it.r.tables || []) out.push('', t.name, textTable(t.headers || [], t.rows || []));
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
  copyTimer = setTimeout(() => { btn.textContent = 'Copy as text'; btn.style.minWidth = ''; }, 2000);
}

function downloadAll() {
  const blocks = [];
  for (const it of currentResults()) for (const t of it.r.tables || []) blocks.push(tableBlock(it.pageId, it.r, t));
  if (!blocks.length) return;
  const head = provenanceLines({ exported: stamp(new Date()), tables: blocks.length }).join('\n') + '\n';
  downloadText('output_analyzer_results.csv', head + '\n' + blocks.join('\n'));
}

function refresh() {
  if (!el) return;
  const items = currentResults();
  el.body.innerHTML = summaryHtml(new Date());
  el.allBtn.disabled = !items.some(it => (it.r.tables || []).length);
  const empty = !state.datasets.length && !items.length;
  el.printBtn.disabled = empty;
  el.copyBtn.disabled = empty;
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The loaded datasets and the latest result of every analysis page, each result under the choices that produced it. Print it as a record of the session, copy it as text for a document, or download every result table as one CSV file whose <code>#</code> lines carry the same choices. Each analysis page also exports its own tables from the row at its foot.</p>' +
    '<div class="xp-btns rp-tools no-print">' +
      '<button type="button" class="btn-run2" id="rp-print">Print</button>' +
      '<button type="button" class="btn-run2" id="rp-copy">Copy as text</button>' +
      '<button type="button" class="btn-run2" id="rp-all">Download all results (one CSV)</button>' +
    '</div>' +
    '<div id="rp-body"></div>';
  const q = s => root.querySelector(s);
  el = { root, body: q('#rp-body'), printBtn: q('#rp-print'), copyBtn: q('#rp-copy'), allBtn: q('#rp-all') };
  el.printBtn.addEventListener('click', () => window.print());
  el.copyBtn.addEventListener('click', copySummary);
  el.allBtn.addEventListener('click', downloadAll);
  state.on('datasets', refresh);
  state.on('results', refresh);
  refresh();
}

/** Called each time the page is shown. */
export function onShow() { refresh(); }

export default { id, title, render, onShow };
