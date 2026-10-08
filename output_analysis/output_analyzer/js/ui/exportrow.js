// The export row at the foot of a page: one button per result table the page
// has computed (a CSV with `#` provenance lines), any files the page adds
// (the data files on Summary and Plots, the paired pilot on Two Systems), and
// a Print button that prints the page as shown, without the navigation. The
// row follows the page's results as they change. When the page's result
// carries `regen: { build, tooBig, files }`, a second line offers the scripts
// that regenerate its results in MATLAB, Base R, Tidy R, and Python; the
// recipe is built only when one of those buttons is pressed. Where the data
// run past the cap (`tooBig`), the scripts hold no data and read the CSV files
// `files` names, and the line adds a Data button for each of those files,
// written from `files` alone without building the recipe.

import * as state from '../state.js';
import { repEstimates, repIds, ESTIMATE_LABEL } from '../data/model.js';
import { observationsCsv, repSummaryCsv, pilotCsv, tableCsv, provenanceLines, downloadText, slug } from '../io/export.js';
import { analysisScript, scriptFileName, ANALYSIS_WRITERS } from '../io/analysis_scripts.js';
import { csvFileName } from '../io/recipes.js';
import { matchPairs } from '../stats/compare.js';
import { KIND_LABEL, details } from './widgets.js';
import { registerTips } from './tooltip.js';
import { esc, intl, plural } from './format.js';

const PILOT_TIP = 'One bare numeric column of replication outcomes, the form a pilot-data paste box reads; such a reader skips the header and the # lines.';
const PAIRED_TIP = 'Two matched columns, read as a paired pilot: the outcomes of replications with the same id in both datasets, as common random numbers would pair them.';
// A script's tip; `from` says where its data come from.
const REGEN_TIP = {
  m: from => 'A MATLAB script that recomputes every result on this page from ' + from + ', printing each beside the value shown here. Needs the Statistics and Machine Learning Toolbox.',
  R: from => 'An R script that recomputes every result on this page from ' + from + ', printing each beside the value shown here. Base R and its stats package only.',
  tidy: () => 'The same R analysis written the tidyverse way: the data as a tibble, summaries with dplyr, test results through broom, and any figure with ggplot2. Needs tibble, dplyr, tidyr, broom, and ggplot2.',
  py: from => 'A Python script that recomputes every result on this page from ' + from + ', printing each beside the value shown here. Needs NumPy and SciPy 1.11 or later.'
};
const FROM_EMBEDDED = 'the data embedded in it', FROM_FILES = 'the CSV files the Data buttons save';
const REGEN_HELP =
  '<p>Each script holds every choice made above and code that recomputes every number shown here, printing each beside the value the page got. It also holds the data this page analyzed, or, where those would run past 200,000 numbers, reads them from CSV files. ' +
  'The analysis is done with the language’s own functions wherever it has one, and with a short function written into the script where it has none, so that the script can be read as a worked example and changed.</p>' +
  '<p>A script embeds replication outcomes on the inference pages (every observation, under One System’s pooled override) and the records of the run on Steady State and Summary and Plots, and in comments beside them it shows the lines that read the same data from the CSV files Export saves on the Import page. ' +
  'Where the data would run past 200,000 numbers, the script embeds none and runs those lines instead: a Data button beside the four script buttons saves each file the script reads, to be kept in the folder the script runs from.</p>';
// The note under the line when the scripts read their data from files.
const regenFilesNote = n => 'These data run past 200,000 numbers, and so each script reads them from the CSV ' + (n === 1
  ? 'file the Data button saves; keep it in one folder with the script.'
  : 'files the Data buttons save; keep them in one folder with the script.');

const ONECOL_TIP = 'Every observation in one bare column under the response name, the form a distribution-fitting tool reads. The replication boundaries are left out.';

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * A timestamp for provenance lines, local time to the second.
 * @param {Date} d
 * @returns {string}
 */
export function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/** The truncation a derived dataset carries, as a sentence fragment. */
export function truncationText(ds) {
  const tr = ds.derivedFrom && ds.derivedFrom.truncate;
  if (!tr) return undefined;
  const what = ds.kind === 'time' ? 'records' : 'observations';
  return tr.by === 'time'
    ? what + ' before time ' + tr.at + ' removed'
    : 'first ' + tr.at + ' ' + what + ' of each replication removed';
}

/** The name of the dataset a derived one came from. */
export function derivedName(ds) {
  if (!ds.derivedFrom) return undefined;
  const parent = state.get(ds.derivedFrom.id);
  return parent ? parent.name : ds.derivedFrom.id;
}

function finiteCount(ds) {
  let n = 0;
  for (const v of repEstimates(ds)) if (Number.isFinite(v)) n++;
  return n;
}

/**
 * The `#` lines every data file carries: what the dataset is, where it came
 * from, how it was derived when it was truncated, and, for time-persistent
 * data, the end time until which each replication's last record holds.
 * @param {object} ds
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
export function dsProvenance(ds, extra) {
  const p = {
    dataset: ds.name,
    kind: KIND_LABEL[ds.kind] || ds.kind,
    response: ds.response,
    replications: ds.reps.length
  };
  if (ds.kind === 'time') p['end time'] = ds.endTime != null ? ds.endTime : 'none (the last record holds for no time)';
  if (ds.source && ds.source.file) p['source file'] = ds.source.file;
  if (ds.derivedFrom) {
    p['derived from'] = derivedName(ds);
    p.truncation = truncationText(ds);
  }
  Object.assign(p, extra || {});
  p.exported = stamp(new Date());
  return p;
}

/**
 * The text of one of a dataset's data files, as the Import page writes it: the
 * Observations CSV in its full form, or the Replication summary CSV. The
 * regenerate scripts read these, under the names csvFileName gives.
 * @param {object} ds
 * @param {'observations'|'replications'} form
 * @returns {string}
 */
export function dataFileText(ds, form) {
  return form === 'observations' ? observationsCsv(ds, dsProvenance(ds), { full: true })
    : repSummaryCsv(ds, dsProvenance(ds, { estimate: ESTIMATE_LABEL[ds.kind] }));
}

/**
 * The data files of one dataset, as button descriptors for an export row.
 * @param {object|null} ds
 * @returns {{label: string, tip?: string, disabled?: boolean, run: () => void}[]}
 */
export function datasetFiles(ds) {
  if (!ds) return [];
  const base = slug(ds.name);
  const pilotOk = finiteCount(ds) >= 2;
  const out = [
    { label: 'Observations CSV', run: () => downloadText(csvFileName(ds, 'observations'), dataFileText(ds, 'observations')) }
  ];
  if (ds.kind !== 'time') {
    out.push({ label: 'Observations, one column', tip: ONECOL_TIP, run: () => downloadText(base + '_observations_column.csv', observationsCsv(ds, dsProvenance(ds))) });
  }
  out.push({ label: 'Replication summary CSV', run: () => downloadText(csvFileName(ds, 'replications'), dataFileText(ds, 'replications')) });
  out.push({
    label: 'Pilot-ready CSV', tip: PILOT_TIP, disabled: !pilotOk,
    note: pilotOk ? '' : 'A pilot needs at least two replication outcomes, and this dataset has ' + intl(finiteCount(ds)) + '.',
    run: () => downloadText(base + '_pilot.csv', pilotCsv(ds, dsProvenance(ds, { estimate: ESTIMATE_LABEL[ds.kind], form: 'pilot data, one column' })))
  });
  return out;
}

/** The explanation of the data files, for a details block under the row. */
export const DATA_FILES_HELP =
  '<p><strong>Observations CSV</strong>: every observation with its replication id and its time where one was recorded. Time-persistent data always carry their times because each value counts in proportion to how long it holds.</p>' +
  '<p><strong>Observations, one column</strong>: the same observations as one bare column, the form a distribution-fitting tool reads. It is not offered for time-persistent data.</p>' +
  '<p><strong>Replication summary CSV</strong>: one row per replication with its observation count and its outcome (the time-weighted mean for time-persistent data), plus the standard deviation, minimum, and maximum for tally data.</p>' +
  '<p><strong>Pilot-ready CSV</strong>: one column of replication outcomes under the header <code>mean</code>, which a sample-size planner reads as pilot data. The paired pilot on Two Systems holds two columns, <code>mean_A</code> and <code>mean_B</code>.</p>';

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

/**
 * The paired-pilot file of two datasets, as one button descriptor (disabled,
 * with the reason as its note, when the pair cannot be formed).
 * @param {object|null} a
 * @param {object|null} b
 */
export function pairedPilotFile(a, b) {
  if (!a || !b || a.id === b.id) return [];
  const v = pairedVectors(a, b);
  const unmatched = v.unmatchedA + v.unmatchedB;
  let msg = plural(v.xa.length, 'pair') + ' matched by replication id';
  if (unmatched) msg += '; ' + plural(unmatched, 'replication') + ' without a partner left out';
  if (v.missing) msg += '; ' + plural(v.missing, 'pair') + ' with a missing outcome left out';
  msg += '.';
  const ok = v.xa.length >= 2;
  return [{
    label: 'Paired pilot CSV', tip: PAIRED_TIP, disabled: !ok, note: ok ? '' : msg + ' A paired pilot needs at least two pairs.',
    run: () => {
      const prov = {
        'dataset A': a.name,
        'dataset B': b.name,
        kind: a.kind === b.kind ? (KIND_LABEL[a.kind] || a.kind) : (KIND_LABEL[a.kind] || a.kind) + ' (A), ' + (KIND_LABEL[b.kind] || b.kind) + ' (B)',
        estimate: a.kind === b.kind ? ESTIMATE_LABEL[a.kind] : ESTIMATE_LABEL[a.kind] + ' (A), ' + ESTIMATE_LABEL[b.kind] + ' (B)',
        'matched by': 'replication id',
        pairs: v.xa.length,
        'unmatched replications': v.unmatchedA + v.unmatchedB + ' (' + v.unmatchedA + ' in A, ' + v.unmatchedB + ' in B)'
      };
      if (v.missing) prov['pairs with a missing outcome'] = v.missing;
      if (a.derivedFrom) { prov['A derived from'] = derivedName(a); prov['A truncation'] = truncationText(a); }
      if (b.derivedFrom) { prov['B derived from'] = derivedName(b); prov['B truncation'] = truncationText(b); }
      prov.form = 'pilot data, two matched columns';
      prov.exported = stamp(new Date());
      downloadText('paired_pilot_' + slug(a.name) + '_vs_' + slug(b.name) + '.csv', pilotCsv([v.xa, v.xb], prov));
    }
  }];
}

// A table name follows "Download" mid-sentence, and so its first letter is
// lowered unless the first word is an acronym (ANOVA) or a person's name.
function lowerFirst(s) {
  s = String(s);
  if (/^(Pearson|Welch|Tukey|Bonferroni|Dunnett|Fisher|Rinott|Shapiro)\b/.test(s)) return s;
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * The `#` lines of one result table: the table, the result, when it was
 * computed, and every choice the page recorded.
 * @param {string} pageId
 * @param {object} r the page's result
 * @param {object} [table]
 */
export function resultProvenance(pageId, r, table) {
  const p = {};
  if (table) p.table = table.name;
  p.result = r.title;
  if (r.computedAt instanceof Date) p.computed = stamp(r.computedAt);
  Object.assign(p, r.provenance || {});
  return p;
}

/** One result table as CSV text with its provenance lines. */
export function tableBlock(pageId, r, t) {
  return tableCsv(t.headers || [], t.rows || [], resultProvenance(pageId, r, t));
}

// The descriptors each container's buttons were last drawn from, for the
// one click listener the container carries.
const drawnItems = new WeakMap();

/**
 * Draws file descriptors (as `datasetFiles` returns them: a label, an
 * optional tip, `disabled` with a `note` saying why, `print` for the Print
 * button, and `run`) into `container` as a wrapping row of buttons, with the
 * notes in a line under them, and registers the buttons' tips. Each call
 * replaces what the last one drew in the same container.
 * @param {HTMLElement} container
 * @param {{label: string, tip?: string, disabled?: boolean, note?: string, print?: boolean, run: () => void}[]} items
 */
export function fileButtons(container, items) {
  let btns = container.querySelector(':scope > .xp-btns');
  if (!btns) {
    container.innerHTML = '<div class="xp-btns"></div><p class="muted-line xp-note" aria-live="polite" hidden></p>';
    btns = container.querySelector(':scope > .xp-btns');
    btns.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      const it = (drawnItems.get(container) || [])[Number(b.getAttribute('data-i'))];
      if (it) it.run();
    });
  }
  const note = container.querySelector(':scope > .xp-note');
  drawnItems.set(container, items);
  btns.innerHTML = items.map((it, i) =>
    '<button type="button" class="' + (it.print ? 'btn-run2' : 'xp-btn') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') +
    (it.tip ? ' data-tip="' + esc(it.tip) + '" data-tip-press' : '') + '>' + esc(it.label) + '</button>').join('');
  const notes = items.filter(it => it.note).map(it => it.note);
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
  registerTips(container);
}

/**
 * The Data buttons of a regenerate line, one per file in `files` (a page's
 * `regen.files`, `{ ds, form }` entries), each naming the file a CSV-mode
 * script reads. A dataset listed twice in one form gets one button; two
 * datasets whose names give one file name are told apart by name.
 * @param {{ds: object, form: 'observations'|'replications'}[]} files
 * @returns {{label: string, file: string, tip: string, run: () => void}[]}
 */
export function regenDataFiles(files) {
  const out = [];
  for (const { ds, form } of files || []) {
    if (!ds || out.some(f => f.ds === ds && f.form === form)) continue;
    out.push({ ds, form, file: csvFileName(ds, form) });
  }
  const count = new Map();
  for (const f of out) count.set(f.file, (count.get(f.file) || 0) + 1);
  return out.map(({ ds, form, file }) => ({
    file,
    label: 'Data: ' + file + (count.get(file) > 1 ? ' (' + ds.name + ')' : ''),
    tip: 'The ' + (form === 'observations' ? 'Observations CSV' : 'Replication summary CSV') + ' of ' + ds.name +
      ', which the scripts read. Export on its row of the Import page saves the same file.',
    run: () => downloadText(file, dataFileText(ds, form))
  }));
}

/**
 * Installs the export row at the end of a page.
 * @param {HTMLElement} root the page's section
 * @param {string} pageId the page whose results the row offers
 * @param {{ extra?: () => {label: string, tip?: string, disabled?: boolean, note?: string, run: () => void}[],
 *   tables?: (t: object) => boolean, help?: string, printLabel?: string }} [opts] `extra` returns the
 *   page's own files, evaluated at every refresh; `tables` keeps only the result tables it
 *   accepts; `help` is HTML for a details block under the row
 * @returns {{ refresh: () => void }}
 */
export function installExportRow(root, pageId, opts = {}) {
  const row = document.createElement('div');
  row.className = 'sec xp-row';
  row.innerHTML = '<div class="sec-hd">Export</div><div class="xp-files" id="xp-' + pageId + '"></div>';
  // The regenerate line, hidden until the page's result carries a recipe;
  // its explanation sits inside it and hides with it.
  const regen = document.createElement('div');
  regen.className = 'xp-regen';
  regen.hidden = true;
  regen.innerHTML = '<span class="xp-regen-lbl">Regenerate these results in</span><div class="xp-btns xp-regen-btns"></div><p class="muted-line xp-regen-note" aria-live="polite" hidden></p>';
  regen.appendChild(details('What a regenerated script holds', REGEN_HELP));
  // The data files' explanation follows the buttons it explains, above the regenerate line.
  if (opts.help) row.appendChild(details('What each data file holds', opts.help));
  row.appendChild(regen);
  root.appendChild(row);
  const files = row.querySelector('.xp-files');
  const regenBtns = regen.querySelector('.xp-regen-btns'), regenNote = regen.querySelector('.xp-regen-note');
  let dataItems = [];
  function refresh() {
    const items = [];
    const r = state.results[pageId];
    for (const t of (r && r.tables) || []) {
      if (opts.tables && !opts.tables(t)) continue;
      items.push({ label: 'Download ' + lowerFirst(t.name), run: () => {
        const body = provenanceLines({ exported: stamp(new Date()) }).join('\n') + '\n' + tableBlock(pageId, r, t);
        downloadText(slug(pageId) + '_' + slug(t.name) + '.csv', body);
      } });
    }
    if (opts.extra) items.push(...opts.extra());
    items.push({ label: opts.printLabel || 'Print this page', print: true, run: () => window.print() });
    const rg = r && r.regen;
    regen.hidden = !rg;
    if (rg) {
      // Past the cap the scripts read their data from files, and the line
      // offers each file beside them.
      const big = !!rg.tooBig;
      dataItems = big ? regenDataFiles(rg.files) : [];
      const from = big ? FROM_FILES : FROM_EMBEDDED;
      regenBtns.innerHTML = Object.entries(ANALYSIS_WRITERS).map(([k, w]) =>
        '<button type="button" class="xp-btn" data-lang="' + k + '" data-tip="' + esc(REGEN_TIP[k](from)) + '" data-tip-press>' + esc(w.label) + '</button>').join('') +
        dataItems.map((d, i) => '<button type="button" class="xp-btn xp-data" data-file="' + i + '" data-tip="' + esc(d.tip) + '" data-tip-press>' + esc(d.label) + '</button>').join('');
      regenNote.textContent = big ? regenFilesNote(dataItems.length) : '';
      regenNote.hidden = !big;
    }
    fileButtons(files, items);
    registerTips(regen);
  }
  // The recipe is built here, once per press, from the inputs the page
  // captured when it registered its result; a Data button writes its file
  // without it.
  regenBtns.addEventListener('click', ev => {
    const r = state.results[pageId];
    const fb = ev.target.closest('button[data-file]');
    if (fb) {
      const d = dataItems[Number(fb.getAttribute('data-file'))];
      if (d) d.run();
      return;
    }
    const b = ev.target.closest('button[data-lang]');
    if (!b || b.disabled || !r || !r.regen) return;
    const lang = b.getAttribute('data-lang');
    const big = !!r.regen.tooBig;
    try {
      const recipe = r.regen.build();
      downloadText(scriptFileName(recipe, lang), analysisScript(recipe, lang, { csv: big }), ANALYSIS_WRITERS[lang].mime + ';charset=utf-8');
      regenNote.textContent = big ? regenFilesNote(dataItems.length) : '';
      regenNote.hidden = !big;
    } catch (err) {
      regenNote.textContent = 'The script could not be written: ' + (err && err.message ? err.message : String(err));
      regenNote.hidden = false;
    }
  });
  state.on('results', ({ pageId: p } = {}) => { if (!p || p === pageId) refresh(); });
  state.on('datasets', refresh);
  state.on('selection', refresh);
  refresh();
  return { refresh };
}
