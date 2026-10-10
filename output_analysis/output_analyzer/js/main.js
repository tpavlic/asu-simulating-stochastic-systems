// Boot: renders every page into its section, wires the page navigation and
// the URL hash, installs the tooltips, keeps the dataset strip under the
// navigation in step with the loaded datasets, and restores the last session.

import * as state from './state.js';
import { initTabs, setAvailable, currentTab, showTab } from './ui/tabs.js';
import { initTooltips, registerTips } from './ui/tooltip.js';
import { redrawVisible } from './ui/plots.js';
import { available as storeAvailable } from './ui/store.js';
import { initSession } from './ui/session.js';
import { KIND_LABEL } from './ui/widgets.js';
import { esc, intl, plural } from './ui/format.js';
import { canInfer } from './data/model.js';

import * as importPage from './pages/import.js';
import * as explorePage from './pages/explore.js';
import * as onePage from './pages/one.js';
import * as twoPage from './pages/two.js';
import * as severalPage from './pages/several.js';
import * as steadyPage from './pages/steady.js';
import * as reportPage from './pages/report.js';
import * as storagePage from './pages/storage.js';
import * as referencesPage from './pages/references.js';
import * as galleryPage from './pages/gallery.js';

// A page module may export its id, title, render, and onShow by name, or as
// one default object; either shape works here. A page divided into sections
// shown one at a time also exports `sections` ([{ id, label }]) and, if it
// needs to know when one opens, `onShowSection(id)`.
function pageOf(mod) {
  const d = mod.default && typeof mod.default === 'object' ? mod.default : {};
  return {
    id: mod.id || d.id,
    title: mod.title || d.title,
    render: mod.render || d.render || (() => {}),
    onShow: mod.onShow || d.onShow || (() => {}),
    sections: mod.sections || d.sections || null,
    onShowSection: mod.onShowSection || d.onShowSection || null
  };
}

const PAGES = [importPage, explorePage, onePage, twoPage, severalPage, steadyPage, reportPage, storagePage, referencesPage, galleryPage].map(pageOf);
const BY_ID = new Map(PAGES.map(p => [p.id, p]));

function renderDataStrip() {
  const el = document.getElementById('data-strip');
  if (!el) return;
  const list = state.datasets;
  if (!list.length) {
    el.innerHTML = '<span class="ds-empty">No data loaded yet. Open <a href="#import">Import</a> to load a file or an example.</span>';
    return;
  }
  const chips = list.map(ds => {
    const R = ds.reps ? ds.reps.length : 0;
    return '<span class="ds-chip"><span class="ds-chip-name">' + esc(ds.name) + '</span>' +
      '<span class="kind-badge">' + esc(KIND_LABEL[ds.kind] || ds.kind) + '</span>' +
      '<span class="ds-chip-r">R = ' + intl(R) + '</span></span>';
  }).join('');
  el.innerHTML = '<span class="ds-count">' + esc(plural(list.length, 'dataset')) + ' loaded:</span>' + chips;
}

// Every page but Import works on loaded data, and each has its own
// requirement: a page's link stays gray and inert until the loaded datasets meet it,
// with the tooltip saying what is missing, and goes gray again if a removal
// takes the requirement away while that page is open.
const GATES = [
  { pages: ['explore', 'one', 'report'],
    ok: () => state.datasets.length > 0,
    tip: 'Load a file or an example on the Import page first.' },
  { pages: ['two', 'several'],
    ok: () => state.datasets.filter(d => canInfer(d).ok).length >= 2,
    tip: 'Comparing designs needs two or more datasets, each with at least two replication estimates. Load another dataset on the Import page first.' },
  { pages: ['steady'],
    ok: () => state.datasets.some(d => d.kind === 'tally' || d.kind === 'time'),
    tip: 'The warm-up plot and batch means work on observations within a run. Load a dataset of observations or of a time-persistent state on the Import page first.' }
];
function gatePages() {
  let closeCurrent = false;
  for (const g of GATES) {
    const disabled = !g.ok();
    setAvailable(g.pages, disabled, g.tip);
    if (disabled && g.pages.includes(currentTab())) closeCurrent = true;
  }
  registerTips(document.querySelector('nav.pnav'));
  if (closeCurrent) showTab('import');
}

function boot() {
  for (const p of PAGES) {
    const root = document.getElementById('tab-' + p.id);
    if (!root) continue;
    try { p.render(root); } catch (err) { console.error(err); root.innerHTML = '<p class="lede">This page could not be drawn.</p>'; }
  }

  initTooltips();
  registerTips(document.body);

  renderDataStrip();
  state.on('datasets', renderDataStrip);

  // Bring back the datasets and settings of the last visit, and keep them
  // stored from here on. Every page has rendered and subscribed by now, and so
  // each sees the restored datasets arrive through its 'datasets' listener.
  try { initSession(); } catch (err) { console.error(err); }

  if (!storeAvailable()) {
    const note = document.getElementById('store-note');
    if (note) {
      note.textContent = 'Session restore is unavailable in this context; data stays in memory until the page is closed.';
      note.hidden = false;
    }
  }

  gatePages();
  state.on('datasets', gatePages);

  // The retired Variance and Correlation page: its interval lives on One
  // System and its F ratio on Two Systems, and an old link lands on the first.
  if (/^#variance(\/|$)/.test(location.hash)) history.replaceState(null, '', '#one');
  initTabs({
    defaultTab: 'import',
    sections: Object.fromEntries(PAGES.filter(p => Array.isArray(p.sections) && p.sections.length).map(p => [p.id, p.sections])),
    onShow: (id, section, pageChanged) => {
      const p = BY_ID.get(id);
      // The strip of loaded datasets belongs to the pages that work on them;
      // the References page uses none.
      const strip = document.getElementById('data-strip');
      if (strip) strip.hidden = id === 'references';
      // A switch between sections of the open page only changes what is
      // shown, and so the page does not recompute.
      if (p && pageChanged !== false) { try { p.onShow(); } catch (err) { console.error(err); } }
      if (p && section && p.onShowSection) { try { p.onShowSection(section); } catch (err) { console.error(err); } }
      // A figure drawn while its page or section was hidden had no width to measure.
      const root = document.getElementById('tab-' + id);
      if (root) requestAnimationFrame(() => redrawVisible(root));
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
