// Tooltips. One floating element serves every [data-tip] on the page, and so
// two tips can never be open at once and the text can carry markup. The
// title attribute is deliberately not used anywhere, because iOS and Android
// show it neither on tap nor on long press.
//
// The listeners are delegated to the document, and so an element a page
// renders later works without registration. What does need registering is
// the accessibility mirror (see registerTips); a MutationObserver does that
// for every element added or retitled after initTooltips runs.

let installed = false;
let tip = null;
let host = null;
let seq = 0;
const mirrors = new Map();   // trigger element -> its hidden description span

/**
 * Installs the tooltip engine once: the #tipbox element, the hover, focus,
 * tap, and long-press listeners, and a MutationObserver that mirrors the
 * text of every [data-tip] added later into the accessibility tree.
 * Calling it again does nothing.
 */
export function initTooltips() {
  if (installed) return;
  installed = true;

  tip = document.createElement('div');
  tip.id = 'tipbox';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  host = document.createElement('div');
  host.className = 'sr-only';
  document.body.appendChild(host);
  registerTips(document.body);

  // Remembering what opened the tip keeps one input from closing another's:
  // tapping a term blurs whatever had focus, and an unconditional focusout
  // would shut the tip in the same breath as the tap that opened it.
  let openedBy = null;
  function place(x, y) {
    const r = tip.getBoundingClientRect();
    let nx = x - r.width / 2, ny = y + 12;
    if (nx + r.width > window.innerWidth - 8) nx = window.innerWidth - 8 - r.width;
    if (ny + r.height > window.innerHeight - 8) ny = y - r.height - 14;
    tip.style.left = Math.max(8, nx) + 'px';
    tip.style.top = Math.max(8, ny) + 'px';
  }
  function show(t, x, y, how) {
    tip.innerHTML = t.getAttribute('data-tip');
    tip.style.opacity = '1';
    openedBy = how;
    place(x, y);
  }
  function showAt(t, how) { const r = t.getBoundingClientRect(); show(t, r.left + r.width / 2, r.bottom, how); }
  function hide() { tip.style.opacity = '0'; openedBy = null; }
  function hideIf(how) { if (openedBy === how) hide(); }
  function target(e) { return e.target && e.target.closest ? e.target.closest('[data-tip]') : null; }

  // Hover for a mouse, focus for a keyboard, tap for a finger.
  document.addEventListener('mousemove', e => { const t = target(e); if (t) show(t, e.clientX, e.clientY, 'hover'); else hideIf('hover'); });
  document.addEventListener('focusin', e => { const t = target(e); if (t) showAt(t, 'focus'); });
  document.addEventListener('focusout', () => hideIf('focus'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);

  // Tap opens a tip on anything except a control that tap already operates.
  document.addEventListener('click', e => {
    const t = target(e);
    if (t && !t.hasAttribute('data-tip-press')) {
      // A term can sit inside a <label>, where the default action would hand
      // focus to the field and raise the keyboard on a phone. The tip is the
      // whole intent here.
      e.preventDefault();
      showAt(t, 'tap');
    } else hide();
  });

  // Long press for a control that tap already operates: 450ms held still,
  // cancelled by 10px of movement, and the click it would fire is swallowed.
  let timer = null, x0 = 0, y0 = 0, swallow = false;
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest ? e.target.closest('[data-tip-press]') : null;
    if (!t) return;
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { timer = null; swallow = true; showAt(t, 'press'); }, 450);
  });
  document.addEventListener('pointermove', e => {
    if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) { clearTimeout(timer); timer = null; }
  });
  ['pointerup', 'pointercancel'].forEach(ev => {
    document.addEventListener(ev, () => { if (timer) { clearTimeout(timer); timer = null; } });
  });
  // Capture phase, and so the press never reaches the button's own handler.
  document.addEventListener('click', e => {
    if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Elements a page renders later, or whose tip text a page rewrites, are
  // mirrored in a microtask after the change; mirrors of removed triggers
  // are dropped at the same time.
  let pending = false;
  const mo = new MutationObserver(records => {
    // The tip box and the mirror host change on every show and every
    // registration; those changes never add a trigger.
    if (records.every(r => r.target === tip || r.target === host || host.contains(r.target))) return;
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; prune(); registerTips(document.body); });
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tip'] });
}

/**
 * Mirrors the text of every [data-tip] inside `root` (and `root` itself) into
 * a visually hidden span, pointed at with aria-describedby. The spans are
 * parked outside their triggers on purpose: inside a button or a label they
 * would be read as part of its name. Safe to call repeatedly; a trigger
 * already mirrored only has its text refreshed.
 * @param {Element} [root=document.body]
 */
export function registerTips(root) {
  if (!host) return;
  const scope = root || document.body;
  const els = Array.from(scope.querySelectorAll('[data-tip]'));
  if (scope.hasAttribute && scope.hasAttribute('data-tip')) els.unshift(scope);
  for (const el of els) {
    const text = el.getAttribute('data-tip');
    let sp = mirrors.get(el);
    if (!sp) {
      sp = document.createElement('span');
      sp.id = 'tipdesc-' + (++seq);
      host.appendChild(sp);
      mirrors.set(el, sp);
      el.setAttribute('aria-describedby', sp.id);
    }
    if (sp.dataset.src !== text) { sp.innerHTML = text; sp.dataset.src = text; }
  }
}

function prune() {
  for (const [el, sp] of mirrors) {
    if (!el.isConnected || !el.hasAttribute('data-tip')) {
      sp.remove();
      mirrors.delete(el);
      if (el.getAttribute('aria-describedby') === sp.id) el.removeAttribute('aria-describedby');
    }
  }
}
