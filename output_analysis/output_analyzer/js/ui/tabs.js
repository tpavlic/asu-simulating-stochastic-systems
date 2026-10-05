// Page navigation: the page links (a sidebar or a tab row, depending on the
// width), their narrow-screen <select>, and the URL hash. Every page is a
// <section class="tp" id="tab-ID">, and every page link an
// <a class="tab" href="#ID" data-tab="ID">, and so a reader can copy a link to
// any page and a link ending in #ID opens on that page.
//
// A page may also be divided into sections shown one at a time. Its hash is
// then #ID/SECTION, every element in the page carrying data-section="SECTION"
// is shown only while that section is open, and the shell fills the page's
// <div data-subnav> with one link per section, lists the open page's sections
// under its sidebar item, and adds them to the <select> as indented options.
// A page that cannot fill one of its sections for the data it shows says so
// through setSectionAvailable, which hides that section's strip button and
// grays its sidebar sub-item and <select> option.

let onShowCb = null;
let current = null;
let currentSec = null;
// The sections of each divided page, in order, and the one last open on each,
// which a link naming only the page reopens.
const SECTIONS = new Map();
const lastSection = new Map();
// The sections of each page that the current data cannot fill, with the
// reason shown on their grayed links: page id → Map(section id → tip).
const SECTIONS_OFF = new Map();

/**
 * Whether `name` is a page this document actually carries, or a page and one
 * of its sections ('several/anova'), read from the markup itself rather than
 * from a second list that could drift out of step. Pages reachable only by
 * link (no entry in the navigation) count as well.
 * @param {string} name
 * @returns {boolean}
 */
export function validTab(name) {
  if (!name || typeof name !== 'string') return false;
  const parts = name.split('/');
  if (parts.length > 2) return false;
  const el = document.getElementById('tab-' + parts[0]);
  if (!(el && el.classList.contains('tp'))) return false;
  if (parts.length === 1) return true;
  const list = SECTIONS.get(parts[0]);
  return !!list && list.some(s => s.id === parts[1]);
}

/**
 * The id of the page currently shown, or null before initTabs runs.
 * @returns {string|null}
 */
export function currentTab() { return current; }

/**
 * The id of the section open on the current page, or null when that page is
 * not divided into sections.
 * @returns {string|null}
 */
export function currentSection() { return currentSec; }

/**
 * Whether a page's link is marked unavailable (aria-disabled), which is how
 * the pages that need data are held back until something is loaded.
 * @param {string} name
 */
export function isDisabled(name) {
  const a = document.querySelector('.tab[data-tab="' + name + '"]');
  return !!a && a.getAttribute('aria-disabled') === 'true';
}

/**
 * Whether a section of a divided page is marked unavailable for the current
 * data (see setSectionAvailable).
 * @param {string} page
 * @param {string} sec
 */
export function isSectionDisabled(page, sec) {
  const off = SECTIONS_OFF.get(page);
  return !!off && off.has(sec);
}

// The first section of `page` that is available, or its first section.
function firstAvailable(page) {
  const list = SECTIONS.get(page);
  if (!list) return null;
  const s = list.find(x => !isSectionDisabled(page, x.id)) || list[0];
  return s.id;
}

// A page's <select> option, and its sections' options, are disabled while
// the page is, and a section's also while the section is.
function syncOptions(page) {
  const sel = document.getElementById('tab-select');
  if (!sel) return;
  const pageOff = isDisabled(page);
  sel.querySelectorAll('option[value="' + page + '"], option[value^="' + page + '/"]').forEach(o => {
    const sec = o.value.split('/')[1];
    o.disabled = pageOff || (sec ? isSectionDisabled(page, sec) : false);
  });
}

/**
 * Marks the sections of a divided page available or not for the data it
 * currently shows. An unavailable section's button in the page's own strip is
 * hidden, and so the page offers only what applies, and its sidebar sub-item and
 * <select> option are grayed and inert with a tooltip saying why, and so the
 * navigation keeps its shape. An open section that becomes unavailable
 * gives way to the first available one.
 * @param {string} page
 * @param {Object<string, string|null>} off section id → why it is unavailable,
 *   or null (or absent) when it is available
 */
export function setSectionAvailable(page, off) {
  const list = SECTIONS.get(page);
  if (!list) return;
  const map = new Map();
  for (const s of list) { const tip = off ? off[s.id] : null; if (tip) map.set(s.id, String(tip)); }
  SECTIONS_OFF.set(page, map);
  const root = document.getElementById('tab-' + page);
  if (root) root.querySelectorAll('.subtab[data-section]').forEach(a => { a.hidden = map.has(a.getAttribute('data-section')); });
  document.querySelectorAll('.tab-subs[data-subs-for="' + page + '"] .tab-sub[data-section]').forEach(a => {
    const sid = a.getAttribute('data-section');
    const tip = map.get(sid);
    a.classList.toggle('disabled', !!tip);
    // An available link keeps the section's own description as its tooltip.
    const own = (list.find(s => s.id === sid) || {}).tip;
    if (tip) { a.setAttribute('aria-disabled', 'true'); a.setAttribute('data-tip', tip); }
    else { a.removeAttribute('aria-disabled'); if (own) a.setAttribute('data-tip', own); else a.removeAttribute('data-tip'); }
  });
  syncOptions(page);
  if (current === page && currentSec && map.has(currentSec)) showTab(page + '/' + firstAvailable(page));
}

/**
 * Marks pages available or not: the page link is grayed and inert, the
 * matching <select> options (the page's and its sections') disabled, and a
 * tooltip on the link says why. A page that is open when it becomes
 * unavailable is left to the caller to switch away from.
 * @param {string[]} names
 * @param {boolean} disabled
 * @param {string} [tip] shown on the page link while disabled
 */
export function setAvailable(names, disabled, tip) {
  for (const name of names) {
    const a = document.querySelector('.tab[data-tab="' + name + '"]');
    if (a) {
      a.classList.toggle('disabled', disabled);
      if (disabled) { a.setAttribute('aria-disabled', 'true'); if (tip) a.setAttribute('data-tip', tip); }
      else { a.removeAttribute('aria-disabled'); a.removeAttribute('data-tip'); }
    }
    syncOptions(name);
  }
}

// Brings `el` to the top of the window when its top has scrolled above it,
// and leaves the page where it is otherwise. The sidebar stays in view while
// the page scrolls, and so a reader can switch pages from far down the
// previous one; the new page then opens at its top, under the dataset strip,
// rather than wherever the old page's scroll position happens to land in it.
// A section switch reveals the section links the same way.
function revealTop(el) {
  const target = el || document.querySelector('.oa-main');
  if (!target) return;
  const top = target.getBoundingClientRect().top;
  if (top < 0) window.scrollTo({ top: Math.max(0, window.scrollY + top - 12) });
}

// The open page's section links, when it has them and they are on screen.
function visibleSubnav() {
  const root = current ? document.getElementById('tab-' + current) : null;
  if (!root) return null;
  return Array.from(root.querySelectorAll('[data-subnav]')).find(n => n.offsetParent !== null) || null;
}

function fullName(page, sec) { return sec ? page + '/' + sec : page; }

function activate(page, sec) {
  const pageChanged = page !== current;
  document.querySelectorAll('.tp').forEach(el => el.classList.toggle('active', el.id === 'tab-' + page));
  document.querySelectorAll('.tab[data-tab]').forEach(el => {
    const on = el.getAttribute('data-tab') === page;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });

  // The open section's containers are shown and the others hidden; the
  // section links themselves carry data-section too and are left alone.
  const root = document.getElementById('tab-' + page);
  if (sec && root) {
    root.querySelectorAll('[data-section]:not(.subtab)').forEach(el => { el.hidden = el.getAttribute('data-section') !== sec; });
    lastSection.set(page, sec);
  }
  document.querySelectorAll('.subtab[data-section], .tab-sub[data-section]').forEach(a => {
    const owner = a.closest('[data-subs-for]');
    const ownerPage = owner ? owner.getAttribute('data-subs-for') : (a.closest('.tp') || { id: '' }).id.replace(/^tab-/, '');
    const on = ownerPage === page && a.getAttribute('data-section') === sec;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  // The sidebar lists the sections of the open page only.
  document.querySelectorAll('.tab-subs[data-subs-for]').forEach(box => { box.hidden = box.getAttribute('data-subs-for') !== page; });

  const sel = document.getElementById('tab-select');
  const v = fullName(page, sec);
  if (sel && sel.value !== v && sel.querySelector('option[value="' + v + '"]')) sel.value = v;
  // A closed <select> shows only the chosen option, and so the chosen section
  // names its page too; the others keep their short, indented labels.
  if (sel) sel.querySelectorAll('option[data-full]').forEach(o => { o.textContent = o.value === v ? o.dataset.full : o.dataset.short; });
  current = page;
  currentSec = sec;
  if (onShowCb) onShowCb(page, sec, pageChanged);
}

/**
 * Shows a page, or a page's section: marks its link and section active, syncs
 * the <select>, writes the hash with history.replaceState (switching pages or
 * sections never grows the back/forward history), and calls the onShow
 * callback given to initTabs. `name` is a page id ('several') or a page id
 * and a section id ('several/anova'); a divided page named alone opens the
 * section last open on it, or its first section. An unknown name is ignored.
 * @param {string} name
 */
export function showTab(name) {
  if (!validTab(name)) return;
  const parts = name.split('/');
  const page = parts[0];
  if (isDisabled(page)) return;
  const list = SECTIONS.get(page);
  let sec = null;
  if (list) {
    // A name the page no longer has (an old link) falls back like a missing one.
    const named = parts[1] && list.some(s => s.id === parts[1]) ? parts[1] : null;
    sec = named || (list.some(s => s.id === lastSection.get(page)) ? lastSection.get(page) : list[0].id);
    // A section the data cannot fill is not opened; its first available
    // neighbor is, and a link naming it lands there.
    if (isSectionDisabled(page, sec)) sec = firstAvailable(page);
  }
  activate(page, sec);
  // replaceState, not pushState: the address bar always names the page a
  // copied link would open, without a history entry per page visited.
  const full = fullName(page, sec);
  if (location.hash.slice(1) !== full) history.replaceState(null, '', '#' + full);
}

// The section links of one page: a strip at the top of the page's content
// (wherever the page put its <div data-subnav>), a list under the page's
// sidebar item, and indented options after the page's own in the <select>.
function buildSections(page, list) {
  const link = document.querySelector('.tab[data-tab="' + page + '"]');
  const pageTitle = link ? (link.querySelector('.tab-t') || link).textContent.trim() : page;
  const root = document.getElementById('tab-' + page);
  const tipAttr = s => (s.tip ? ' data-tip="' + String(s.tip).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"' : '');
  const anchor = (cls, s) => '<a class="' + cls + '" href="#' + page + '/' + s.id + '" data-section="' + s.id + '"' + tipAttr(s) + '>' + s.label + '</a>';
  if (root) {
    root.querySelectorAll('[data-subnav]').forEach(nav => {
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', 'Sections of ' + pageTitle);
      nav.innerHTML = list.map(s => anchor('subtab', s)).join('');
    });
  }
  if (link) {
    const box = document.createElement('div');
    box.className = 'tab-subs';
    box.setAttribute('data-subs-for', page);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Sections of ' + pageTitle);
    box.hidden = true;
    box.innerHTML = list.map(s => anchor('tab-sub', s)).join('');
    link.after(box);
  }
  const sel = document.getElementById('tab-select');
  const opt = sel ? sel.querySelector('option[value="' + page + '"]') : null;
  if (opt) {
    let after = opt;
    for (const s of list) {
      const o = document.createElement('option');
      o.value = page + '/' + s.id;
      // Em spaces, because a select collapses ordinary ones.
      o.dataset.short = '\u2003\u2014 ' + s.label;
      o.dataset.full = opt.textContent.trim() + '\u00a0\u2013 ' + s.label;
      o.textContent = o.dataset.short;
      o.disabled = opt.disabled;
      after.after(o);
      after = o;
    }
  }
}

/**
 * Wires the page links, the section links, the <select id="tab-select">, and
 * the hashchange listener, primes the default page, and then, if the URL
 * arrived with a hash naming another page or section, switches to it through
 * the same showTab path.
 * @param {{ defaultTab?: string,
 *   onShow?: (id: string, section: string|null, pageChanged: boolean) => void,
 *   sections?: Object<string, {id: string, label: string}[]> }} [opts]
 */
export function initTabs(opts = {}) {
  const defaultTab = opts.defaultTab || 'import';
  onShowCb = opts.onShow || null;
  // Read before priming: priming does not touch the hash, but reading it
  // first keeps the incoming link independent of whatever priming does.
  const startHash = location.hash.slice(1);

  for (const [page, list] of Object.entries(opts.sections || {})) {
    if (!Array.isArray(list) || !list.length || !document.getElementById('tab-' + page)) continue;
    SECTIONS.set(page, list.map(s => ({ id: String(s.id), label: String(s.label), tip: s.tip ? String(s.tip) : null })));
    buildSections(page, SECTIONS.get(page));
  }

  document.querySelectorAll('.tab[data-tab]').forEach(a => {
    a.addEventListener('click', e => {
      // A modified click (new tab, new window) keeps the browser's own
      // behavior, which the href makes correct.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      const name = a.getAttribute('data-tab');
      showTab(name);
      // A disabled link opens its tooltip instead, and the page stays put.
      if (current === name) revealTop();
    });
  });
  const sel = document.getElementById('tab-select');
  if (sel) {
    sel.addEventListener('change', () => {
      const before = current;
      showTab(sel.value);
      if (current === before) revealTop(visibleSubnav());
    });
  }

  // A section link, or a prose link to another page (<a href="#import">),
  // goes through the same path as a page link, and so it replaces the hash
  // rather than adding a history entry. Links rendered later are covered by
  // the delegation. A section switch leaves the page where it is unless the
  // section links have scrolled out of view above it.
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || a.classList.contains('tab')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const name = a.getAttribute('href').slice(1);
    if (!validTab(name)) return;
    e.preventDefault();
    // A grayed section link opens its tooltip instead, and the page stays put.
    if (a.getAttribute('aria-disabled') === 'true') return;
    const sectionLink = a.classList.contains('subtab') || a.classList.contains('tab-sub');
    showTab(name);
    if (sectionLink) revealTop(visibleSubnav());
    else window.scrollTo({ top: 0 });
  });

  // An externally opened #id link, or a back/forward step across one, lands
  // on that page or section.
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (name && name !== fullName(current, currentSec) && validTab(name)) showTab(name);
  });

  showDefault(defaultTab);
  if (startHash && startHash !== fullName(current, currentSec) && validTab(startHash)) showTab(startHash);
  // A hash that names no page, or a page that is not available yet, is
  // replaced by the page actually shown, and so a copied link never carries a
  // stale fragment.
  const shown = fullName(current, currentSec);
  if (startHash && startHash !== shown) history.replaceState(null, '', '#' + shown);
}

// Primes the default page without touching the hash.
function showDefault(defaultTab) {
  const page = validTab(defaultTab) && !defaultTab.includes('/') ? defaultTab : 'import';
  const list = SECTIONS.get(page);
  activate(page, list ? list[0].id : null);
}
