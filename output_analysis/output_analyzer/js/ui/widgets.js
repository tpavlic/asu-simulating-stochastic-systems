// Small UI building blocks shared by the pages: numeric spinners, result
// cards, dataset pickers, the experimental-unit banner, collapsible notes,
// the rejected-row list, the confidence-level picker, and callouts.

import * as state from '../state.js';
import { esc, intl, plural, pct, lvl } from './format.js';

/** How each dataset kind is named on the page. */
export const KIND_LABEL = { tally: 'tally', time: 'time-persistent', reps: 'replication values' };

function decimalsOf(step) {
  for (let d = 0; d <= 8; d++) if (Math.abs(step - Number(step.toFixed(d))) < 1e-9) return d;
  return 8;
}

/**
 * Turns a text field into a spinner: an up/down pair that shows on hover or
 * focus (and sits beside the field at full size on a touch screen, where a
 * hidden control is no control), ArrowUp/ArrowDown on the field (Shift for
 * ten steps), and clamping to [min, max] at the step's decimals whenever the
 * value is stepped or typed. `onChange(value)` runs after every accepted
 * change.
 * @param {HTMLInputElement} input
 * @param {{ min?: number, max?: number, step?: number, shiftStep?: number, decimals?: number,
 *   onChange?: (v: number) => void }} [opts]
 * @returns {{ get: () => number, set: (v: number, notify?: boolean) => number, wrap: HTMLElement }}
 */
export function spinner(input, opts = {}) {
  const min = opts.min === undefined ? -Infinity : opts.min;
  const max = opts.max === undefined ? Infinity : opts.max;
  const step = opts.step || 1;
  const shiftStep = opts.shiftStep || step * 10;
  const decimals = opts.decimals !== undefined ? opts.decimals : decimalsOf(step);
  if (!input.className) input.className = 'par-inp';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', decimals ? 'decimal' : 'numeric');

  const clampRound = v => {
    if (!Number.isFinite(v)) v = Number.isFinite(min) ? min : 0;
    return Math.min(max, Math.max(min, Number(v.toFixed(decimals))));
  };
  let last = clampRound(Number(input.value));
  const set = (v, notify = true) => {
    const next = clampRound(v);
    input.value = String(next);
    const changed = next !== last;
    last = next;
    if (notify && changed && opts.onChange) opts.onChange(next);
    return next;
  };
  const stepBy = (dir, shift) => { if (!input.disabled) set(clampRound(Number(input.value)) + dir * (shift ? shiftStep : step)); };

  let wrap = input.parentElement;
  if (!wrap || !wrap.classList.contains('spin')) {
    wrap = document.createElement('span');
    wrap.className = 'spin';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btns = document.createElement('span');
    btns.className = 'spin-btns';
    const lbl = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
    const fieldName = lbl ? lbl.textContent.trim() : (input.getAttribute('aria-label') || 'value');
    [['▲', 1, 'Increase'], ['▼', -1, 'Decrease']].forEach(([glyph, dir, name]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'spin-btn'; b.textContent = glyph; b.tabIndex = -1;
      b.setAttribute('aria-label', name + ' ' + fieldName);
      b.addEventListener('click', ev => { stepBy(dir, ev.shiftKey); input.focus(); });
      btns.appendChild(b);
    });
    wrap.appendChild(btns);
  }
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      stepBy(ev.key === 'ArrowUp' ? 1 : -1, ev.shiftKey);
    } else if (ev.key === 'Enter') {
      set(Number(input.value));
    }
  });
  input.addEventListener('change', () => set(Number(input.value)));
  input.value = String(last);
  return { get: () => last, set, wrap };
}

/**
 * A result card: a small uppercase label on top, the value below in the
 * monospace face, and an optional note under it.
 * @param {string} label HTML
 * @param {string} valueHtml HTML
 * @param {string} [noteHtml] HTML
 * @returns {HTMLDivElement}
 */
export function card(label, valueHtml, noteHtml) {
  const el = document.createElement('div');
  el.className = 'sc';
  el.innerHTML = '<div class="sc-lbl">' + label + '</div><div class="sc-val">' + valueHtml + '</div>' +
    (noteHtml ? '<div class="sc-note">' + noteHtml + '</div>' : '');
  // A long value (an interval in brackets) takes the full row on a phone
  // rather than being cut short with an ellipsis.
  if (el.querySelector('.sc-val').textContent.length > 14) el.classList.add('sc-wide');
  return el;
}

/**
 * A responsive grid of cards.
 * @param {HTMLElement[]} cards
 * @returns {HTMLDivElement}
 */
export function cardRow(cards) {
  const el = document.createElement('div');
  el.className = 'sg';
  for (const c of cards) el.appendChild(c);
  return el;
}

function optionLabel(ds) {
  return ds.name + ' (' + KIND_LABEL[ds.kind] + ', R = ' + intl(ds.reps ? ds.reps.length : 0) + ')';
}

/**
 * Fills a <select> with the loaded datasets that pass `filter` and keeps it
 * in sync on every 'datasets' event, preserving the chosen dataset while it
 * still exists. When the chosen dataset disappears the select moves to the
 * placeholder (or the first dataset) and fires its own 'change' event, and
 * so the page's change handler sees it.
 * @param {HTMLSelectElement} selectEl
 * With `remember: { page, key }`, every change is recorded with
 * `state.setPick(page, key, id)` and the recorded dataset is chosen whenever
 * it is loaded.
 * @param {{ filter?: (ds: Object) => boolean, placeholder?: string, value?: string,
 *   remember?: { page: string, key: string } }} [opts]
 * @returns {{ refresh: () => void, value: () => string, destroy: () => void }}
 */
export function datasetSelect(selectEl, opts = {}) {
  const filter = opts.filter || (() => true);
  const mem = opts.remember || null;
  const remembered = () => (mem ? state.getPick(mem.page, mem.key) : undefined);
  let chosen = opts.value || selectEl.value || '';
  function refresh() {
    const list = state.datasets.filter(filter);
    const before = selectEl.value;
    // A remembered choice wins whenever its dataset is loaded. Every change
    // to the picker records its value, and so the remembered choice is the
    // current one, except while a session is restored, when it names a
    // dataset that may arrive after the picker has fallen back to another.
    const want = remembered();
    if (typeof want === 'string' && list.some(d => d.id === want)) chosen = want;
    selectEl.innerHTML = '';
    if (opts.placeholder !== undefined || !list.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = list.length ? (opts.placeholder || 'Choose a dataset') : 'No datasets loaded';
      selectEl.appendChild(o);
    }
    for (const ds of list) {
      const o = document.createElement('option');
      o.value = ds.id; o.textContent = optionLabel(ds);
      selectEl.appendChild(o);
    }
    if (chosen && list.some(d => d.id === chosen)) selectEl.value = chosen;
    else selectEl.value = opts.placeholder !== undefined || !list.length ? '' : list[0].id;
    chosen = selectEl.value;
    selectEl.disabled = !list.length;
    if (selectEl.value !== before) selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const onChange = () => {
    chosen = selectEl.value;
    if (mem) state.setPick(mem.page, mem.key, chosen || null);
  };
  selectEl.addEventListener('change', onChange);
  const off = state.on('datasets', refresh);
  refresh();
  return {
    refresh,
    value: () => selectEl.value,
    destroy: () => { off(); selectEl.removeEventListener('change', onChange); }
  };
}

/**
 * A checklist of the loaded datasets that pass `filter`, one checkbox label
 * per dataset (each label clears the 24px touch target), kept in sync on
 * every 'datasets' event with the checked ones preserved.
 * @param {HTMLElement} container
 * @param {{ filter?: (ds: Object) => boolean, checked?: string[], onChange?: (ids: string[]) => void }} [opts]
 * @returns {{ selected: () => string[], setChecked: (ids: string[]) => void, refresh: () => void, destroy: () => void }}
 */
export function datasetChecklist(container, opts = {}) {
  const filter = opts.filter || (() => true);
  let checked = new Set(opts.checked || []);
  container.classList.add('ds-list');
  function refresh() {
    const list = state.datasets.filter(filter);
    const prev = selected();
    for (const id of Array.from(checked)) if (!list.some(d => d.id === id)) checked.delete(id);
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<p class="muted-line">No datasets loaded.</p>';
    }
    for (const ds of list) {
      const lab = document.createElement('label');
      lab.className = 'ds-chk';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = ds.id; cb.checked = checked.has(ds.id);
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(ds.id); else checked.delete(ds.id);
        if (opts.onChange) opts.onChange(selected());
      });
      const span = document.createElement('span');
      span.innerHTML = '<span class="ds-chk-name">' + esc(ds.name) + '</span> <span class="kind-badge">' + esc(KIND_LABEL[ds.kind] || ds.kind) + '</span> <span class="ds-chk-r">R = ' + intl(ds.reps ? ds.reps.length : 0) + '</span>';
      lab.appendChild(cb); lab.appendChild(span);
      container.appendChild(lab);
    }
    const now = selected();
    if (opts.onChange && now.join('\n') !== prev.join('\n')) opts.onChange(now);
  }
  function selected() {
    return state.datasets.filter(d => checked.has(d.id)).map(d => d.id);
  }
  const off = state.on('datasets', refresh);
  refresh();
  return {
    selected,
    setChecked: ids => { checked = new Set(ids); refresh(); },
    refresh,
    destroy: off
  };
}

/**
 * The experimental-unit sentence for a dataset, as a one-line banner:
 * "Experimental unit: R = 20 replications (replication means of 3,842
 * observations)".
 * @param {Object} ds a Dataset
 * @returns {HTMLParagraphElement}
 */
export function unitLine(ds) {
  const el = document.createElement('p');
  el.className = 'unit-line';
  if (!ds) { el.textContent = 'Experimental unit: no dataset chosen.'; return el; }
  const R = ds.reps ? ds.reps.length : 0;
  let nObs = 0;
  for (const r of ds.reps || []) nObs += r.v ? r.v.length : 0;
  let detail;
  if (ds.kind === 'reps') detail = 'one value per replication';
  else if (ds.kind === 'time') detail = 'time-weighted replication means of ' + plural(nObs, 'record');
  else detail = 'replication means of ' + plural(nObs, 'observation');
  if (R === 1 && ds.kind !== 'reps') detail += '; one replication gives one estimate, and an interval needs at least two';
  el.innerHTML = '<span class="unit-lbl">Experimental unit:</span> R = ' + plural(R, 'replication') + ' (' + esc(detail) + ')';
  return el;
}

/**
 * A collapsible note, closed by default.
 * @param {string} summaryText plain text for the summary line
 * @param {string} bodyHtml HTML for the body
 * @returns {HTMLDetailsElement}
 */
export function details(summaryText, bodyHtml) {
  const d = document.createElement('details');
  d.className = 'why';
  d.innerHTML = '<summary>' + esc(summaryText) + '</summary><div class="why-body">' + bodyHtml + '</div>';
  return d;
}

/**
 * The rows an import rejected, each with its line number, its text, and the
 * reason, in a collapsed <details>; a single muted line when there are none.
 * @param {{ line: number, text: string, reason: string }[]} issues
 * @returns {HTMLElement}
 */
export function issueList(issues) {
  if (!issues || !issues.length) {
    const p = document.createElement('p');
    p.className = 'muted-line';
    p.textContent = 'No rows were rejected.';
    return p;
  }
  const d = document.createElement('details');
  d.className = 'why issues';
  const rows = issues.map(it => '<tr><td>' + intl(it.line) + '</td><td class="iss-text">' + esc(it.text === undefined ? '' : it.text) + '</td><td>' + esc(it.reason) + '</td></tr>').join('');
  d.innerHTML = '<summary>' + esc(plural(issues.length, 'row was', 'rows were') + ' rejected') + '</summary>' +
    '<div class="why-body"><div class="scroll-box"><table class="ptab iss-tab"><thead><tr><th>Line</th><th>Text</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  return d;
}

/**
 * Binds a <select> to the shared confidence level (90%, 95%, or 99%): it
 * shows the current level, sets it on change, and follows changes made by
 * any other level picker on the page.
 * @param {HTMLSelectElement} selectEl
 * @returns {() => void} a function that unbinds it
 */
export function levelSelect(selectEl) {
  selectEl.innerHTML = state.LEVELS.map(l => '<option value="' + l + '">' + pct(l, 0) + '</option>').join('') +
    '<option value="custom">Custom…</option>';
  // The custom entry opens a stated level and a Bonferroni count beside the
  // picker, with the per-interval level they give written out.
  const box = document.createElement('span');
  box.className = 'lvl-custom';
  box.innerHTML = '<label class="lvl-lbl">level <input type="number" class="par-inp lvl-base" min="50" max="99.99" step="0.1" inputmode="decimal" aria-label="Stated confidence level, percent">%</label>' +
    '<label class="lvl-lbl"><span class="tip" tabindex="0" data-tip="The number of statements to hold jointly at the stated level. Each interval is then formed at 1 − α/C, the Bonferroni inequality done by hand. Set 1 for a single interval.">C</span> <input type="number" class="par-inp lvl-c" min="1" max="10000" step="1" inputmode="numeric" aria-label="Bonferroni count"></label>' +
    '<span class="ctrl-note lvl-note"></span>';
  selectEl.insertAdjacentElement('afterend', box);
  const base = box.querySelector('.lvl-base'), cnt = box.querySelector('.lvl-c'), note = box.querySelector('.lvl-note');
  const sync = () => {
    const st = state.settings;
    selectEl.value = st.custom ? 'custom' : String(st.level);
    box.style.display = st.custom ? '' : 'none';
    if (st.custom) {
      if (document.activeElement !== base) base.value = String(Math.round(st.base * 10000) / 100);
      if (document.activeElement !== cnt) cnt.value = String(st.bonfC);
      note.textContent = st.bonfC > 1
        ? 'α = ' + trimNum(1 - st.base) + ' over C = ' + st.bonfC + ' gives ' + lvl(st.level) + ' per interval'
        : 'every interval at ' + lvl(st.level);
    }
  };
  const apply = () => {
    const b = Number(base.value) / 100, C = Number(cnt.value);
    if (!state.setCustomLevel(b, C)) sync();
  };
  selectEl.addEventListener('change', () => {
    if (selectEl.value === 'custom') {
      const st = state.settings;
      state.setCustomLevel(st.custom ? st.base : st.level, st.custom ? st.bonfC : 1);
    } else {
      state.setLevel(Number(selectEl.value));
    }
  });
  base.addEventListener('change', apply);
  cnt.addEventListener('change', apply);
  sync();
  return state.on('settings', sync);
}

function trimNum(v) { return String(Number(v.toFixed(4))); }

/**
 * A callout block: 'warn' for a caution (an ochre rule and a "!" badge) or
 * 'info' for a note (an accent wash and an "i" badge). The badge's shape
 * carries the kind as well as its color.
 * @param {'warn'|'info'} kind
 * @param {string} html
 * @returns {HTMLDivElement}
 */
export function notice(kind, html) {
  const el = document.createElement('div');
  const k = kind === 'warn' ? 'warn' : 'info';
  el.className = 'notice notice-' + k;
  el.setAttribute('role', 'note');
  el.innerHTML = '<span class="notice-badge" aria-hidden="true">' + (k === 'warn' ? '!' : 'i') + '</span><div class="notice-body">' +
    '<span class="sr-only">' + (k === 'warn' ? 'Warning: ' : 'Note: ') + '</span>' + html + '</div>';
  return el;
}
