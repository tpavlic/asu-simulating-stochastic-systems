// The Storage page: what this browser keeps between visits (the loaded
// datasets, the confidence level, and every control's setting), whether it
// could be stored, and the button that forgets it all.

import * as state from '../state.js';
import { KIND_LABEL } from '../ui/widgets.js';
import { esc, intl, plural } from '../ui/format.js';
import { sessionStatus, forgetSession, MAX_CHARS } from '../ui/session.js';

/** The page's hash id. */
export const id = 'storage';
/** The page's title. */
export const title = 'Storage';

let el = null;

function sizeText(chars) {
  if (chars >= 1024 * 1024) return (chars / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(chars / 1024)) + ' KB';
}

function refresh() {
  if (!el) return;
  const s = sessionStatus();
  el.status.textContent = s.available
    ? 'Session restore is on: the data and settings stay in this browser until you forget them.'
    : 'Session restore is unavailable in this context: the data stay in memory until the page is closed.';
  const lines = [];
  if (s.restored) lines.push('Restored ' + plural(s.restored, 'dataset') + ' from the last visit.');
  if (s.dropped) lines.push(plural(s.dropped, 'stored dataset', 'stored datasets') + ' could not be read and ' + (s.dropped === 1 ? 'was' : 'were') + ' dropped.');
  if (s.skipped === 'too-large') {
    lines.push('The loaded data come to ' + sizeText(s.chars) + ', over the ' + sizeText(MAX_CHARS) + ' that session restore keeps, and so they will not come back after a reload.');
  } else if (s.skipped === 'write-failed') {
    lines.push('The browser refused to store this session (its storage is full or blocked), and so it will not come back after a reload.');
  } else if (s.available && s.saved && state.datasets.length) {
    lines.push('Stored: ' + plural(state.datasets.length, 'dataset') + ', the confidence level, and every control’s setting, ' + sizeText(s.chars) + ' in all.');
  } else if (s.available) {
    lines.push('Nothing is stored: no data are loaded.');
  }
  el.size.textContent = lines.join(' ');
  el.list.innerHTML = state.datasets.length
    ? '<ul class="ss-list">' + state.datasets.map(ds => '<li><span class="xp-name">' + esc(ds.name) + '</span> <span class="xp-meta">' +
        esc((KIND_LABEL[ds.kind] || ds.kind) + ' · R = ' + intl(ds.reps.length)) + '</span></li>').join('') + '</ul>'
    : '<p class="muted-line">No data loaded. Load a file, paste data, or open an example on the <a href="#import">Import</a> page.</p>';
  el.forget.disabled = !state.datasets.length && !s.saved;
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Everything loaded and chosen here is kept in this browser, on this computer, and comes back on the next visit: the datasets, the confidence level, and the setting of every control on every page. Nothing is sent anywhere. The browser keeps a separate store for each place the page is opened from, so what was loaded on the page at its own address is not seen when the page is embedded in a course site, and the other way around. Forgetting the session clears all of it and starts over.</p>' +
    '<div class="sec"><div class="sec-hd">Stored in this browser</div>' +
      '<p class="xp-status" id="ss-status"></p>' +
      '<p class="muted-line" id="ss-size" aria-live="polite"></p>' +
      '<div id="ss-list"></div>' +
    '</div>' +
    '<div class="sec"><div class="sec-hd">Start over</div>' +
      '<p class="exp-note">Removes every loaded dataset and every stored setting from this browser and reloads the page, so that every control starts from its default. Files on disk are untouched; what was exported stays exported.</p>' +
      '<div class="xp-btns"><button type="button" class="btn-clear" id="ss-forget">Forget this session</button></div>' +
    '</div>';
  const q = s => root.querySelector(s);
  el = { root, status: q('#ss-status'), size: q('#ss-size'), list: q('#ss-list'), forget: q('#ss-forget') };
  // Two clicks, as on the Import page's Remove all: the first arms the
  // button and names what the second will do, and three idle seconds disarm it.
  let armTimer = null;
  const disarm = () => { el.forget.dataset.armed = ''; el.forget.textContent = 'Forget this session'; };
  el.forget.addEventListener('click', () => {
    if (el.forget.dataset.armed === '1') {
      clearTimeout(armTimer);
      disarm();
      forgetSession();
      refresh();
      // A reload is the one sure way to put every page's controls, the
      // remembered sections, and the confidence level back to their
      // defaults: each page keeps its state in its own module.
      try { history.replaceState(null, '', '#storage'); } catch (err) { /* a file:// page may refuse */ }
      location.reload();
      return;
    }
    el.forget.dataset.armed = '1';
    el.forget.textContent = 'Click again to forget ' + (state.datasets.length ? plural(state.datasets.length, 'dataset') + ' and every setting' : 'every stored setting');
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { if (el.forget.isConnected) disarm(); }, 3000);
  });
  state.on('datasets', refresh);
  state.on('session', refresh);
  refresh();
}

/** Called each time the page is shown. */
export function onShow() { refresh(); }

export default { id, title, render, onShow };
