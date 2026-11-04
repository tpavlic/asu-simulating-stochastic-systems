# CLAUDE.md — conventions for this repository

This repository hosts supplemental course visualizations for **Simulating Stochastic Systems** at
Arizona State University, taught by Theodore P. Pavlic. The live site is at
<https://tpavlic.github.io/asu-simulating-stochastic-systems/>.

---

## Widgets are course-neutral

**Never reference the course inside a widget.** Each widget is a general-purpose teaching tool
that any instructor anywhere should be able to find on the web and embed in their own class, so a
widget must not name this course, its catalog number, the university, the instructor, or a
semester — not in its visible text, its `<title>`, its `<head>` description or OG/Twitter card
text, or its preview image. Frame everything by topic ("Monte Carlo integration", "input
modeling"), never by course ("in this course", "for Simulating Stochastic Systems").

**Widgets also stand alone: never link to, embed, or name another widget from inside a widget.**
Another instructor embeds one widget in their own page and may have no wish to hand their students
the rest of this site, so a cross-link would send readers somewhere that instructor did not choose.
Where a related idea lives in a sibling widget, say the idea in a sentence or leave it out; do not
point at the sibling. The back-link footer is the one exception, and its embed script already hides
it inside an iframe.

The course framing lives only in the site chrome around the widgets: `index.html`, `README.md`,
this file, and the shared back-link footer. The footer's "All course visualizations" label names
no particular course and stays as is; its embed script removes it when the widget is
embedded in an LMS page, so it appears only on direct visits, where a link back to the index is
intentional. URLs are exempt — `og:url`, `og:image`, and the GitHub Pages
base necessarily contain the repository name, and that is fine; the rule is about human-readable
text. When importing or reviewing a widget whose body already contains a course reference, treat
it like any other interior issue under the setup-edit rule below: flag it rather than silently
editing it.

---

## Registering an existing visualization

**Confine setup edits to the file's outer edges (the `<head>` and the back-link footer); leave the
body interior untouched.** These apps are often authored or edited in a separate tool (such as Claude
Desktop) and then re-imported, so the body between the head and the footer is owned by that tool.
When you register, add, or set up a demo here, restrict your changes to the head metadata (title,
description, OG/Twitter/GA tags) and the back-link footer with its embed script, and do not
restructure or restyle anything in between, so a later re-import of the app body does not have to
re-apply your interior edits. This applies to the setup/import path; when the user explicitly asks
you to change the body (for example a footer or layout review pass), that is fine. Otherwise, if the
interior seems to need a change, flag it and ask rather than editing it silently.

When a user asks to add an existing demo to the index, README, or widget list, **always also audit
the demo's HTML file itself** against steps 1 and 2 of the checklist below (the `<head>` metadata
and the back-link footer with its embed script) and add whatever is missing, taking the preview
image dimensions from the actual file. Do this proactively — the user should not have to ask
separately.

---

## Adding a new visualization — full checklist

Each visualization lives in its own subdirectory:

```bash
my_demo/
  my_demo.html          # self-contained page (no build step)
  my_demo-preview.png   # preview image for OG/Twitter cards
```

### 1. `<head>` metadata in `my_demo.html`

Every demo page must have a proper HTML5 document structure (`<!DOCTYPE html>`, `<html lang="en">`,
`<head>`, `<body>`) — do not leave the file as a bare fragment.

Inside `<head>`, include all of the following, filling in the actual values:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Title – interactive explainer</title>
<meta name="description" content="One or two sentences describing the demo.">

<!-- Open Graph (Facebook, LinkedIn, Slack, iMessage, etc.) -->
<meta property="og:type" content="website">
<meta property="og:title" content="Demo Title – interactive explainer">
<meta property="og:description" content="One or two sentences describing the demo.">
<meta property="og:image" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo-preview.png">
<meta property="og:image:width" content="ACTUAL_WIDTH">
<meta property="og:image:height" content="ACTUAL_HEIGHT">
<meta property="og:url" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo.html">
<meta property="fb:app_id" content="2385695445236853">

<!-- Twitter/X card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Demo Title – interactive explainer">
<meta name="twitter:description" content="One or two sentences describing the demo.">
<meta name="twitter:image" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo-preview.png">

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-Y66V2TS0R6"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-Y66V2TS0R6');</script>
</head>
```

**Separate a title from its subtitle with a spaced en dash (`–`), never an em dash.** The space
before the dash is non-breaking, so the dash cannot wrap to the start of a line; the space after it
is ordinary. In a visible heading in the page body, such as an `index.html` entry, write
`Demo Title&nbsp;– subtitle`. In the `<title>` element and the `og:title` and `twitter:title`
values, write a literal U+00A0 instead, per the next rule. Every widget, `index.html`, and
`README.md` follow this form, so keep it consistent when adding or renaming one.

**Use literal characters, not HTML entities, in `og:*` and `twitter:*` `content` attributes**, and
for the non-breaking space in `<title>`. Social-card scrapers, link unfurlers, bookmark exporters,
and scripts read these values as plain text and often do not decode entities, so a title like
`Foo &amp; Bar` can surface verbatim. An ampersand followed by a space (`Foo & Bar`) is not even a
valid entity, so escaping is both unnecessary and harmful here. Write `&`, `–`, `<`, `>`, `'`, and
a literal U+00A0 in those values. Apart from that space, the `<title>` element and the page body
follow normal HTML escaping.

**Twitter/X image requirements** (stricter than other platforms):

- Aim for an aspect ratio near **2:1** (e.g. 1200×600, 2400×1200) and keep the important
  content centered. Twitter's own card code enforces only a 280×150 minimum, so a wider ratio
  is not rejected, but the card is rendered toward 2:1 and the edges may not survive.
- File size must be **under 5 MB**.
- Only if a ratio actually causes a problem, add a cropped or padded version for `twitter:image`
  while leaving `og:image` on the full-resolution original. Do not do this pre-emptively.

### 2. Footer with back-link and embed script

At the very bottom of `<body>`, before `</body>`, add:

```html
<footer id="course-nav-footer" style="margin-top:0;font-size:0.8rem;color:#78786A;">
  <div style="max-width:MAX_WIDTH;margin:0 auto;padding:0.75rem 0 0 1rem;">
    <a href="../" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><span style="font-family:sans-serif">&larr;</span> All course visualizations</a>
  </div>
</footer>
<script>
if (window.self !== window.top) {
  var f = document.getElementById('course-nav-footer'); if (f) { f.style.display = 'none'; }
  // A min-height tied to the viewport (the "fill the window" idiom) would track the frame's
  // own height and keep the frame from ever shrinking, so neutralize such rules here, where
  // the frame is sized to the content. Cross-origin sheets (web fonts) throw and are skipped.
  (function () {
    function drop(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.style && /vh\b/.test(r.style.minHeight)) { r.style.minHeight = '0'; }
        if (r.cssRules) { drop(r.cssRules); }
      }
    }
    for (var s = 0; s < document.styleSheets.length; s++) { try { drop(document.styleSheets[s].cssRules); } catch (e) {} }
  })();
  // Embedded in another page: report the content height to the host so the iframe can
  // grow and shrink with the active tab instead of scrolling inside itself. Canvas LMS
  // listens for this message on every page and resizes whichever iframe sent it. It is
  // never sent on a direct visit, and it never leaves the browser.
  (function () {
    var last = 0;
    function report(force) {
      var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h > 0 && (force || h !== last)) { last = h; window.parent.postMessage({ subject: 'lti.frameResize', height: h }, '*'); }
    }
    if (window.ResizeObserver) { new ResizeObserver(function () { report(false); }).observe(document.documentElement); }
    window.addEventListener('load', function () { report(true); });
    // The host's listener may attach after this page has loaded (Canvas boots a large
    // bundle after its HTML arrives), so repeat the current height a few times.
    [500, 1500, 3000, 6000, 12000].forEach(function (ms) { setTimeout(function () { report(true); }, ms); });
    report(true);
  })();
}
</script>
```

Replace `MAX_WIDTH` with the page's primary content `max-width` (e.g. `860px`). The inner
`<div>` constrains the link to the same width as the page body so it aligns on wide screens.

**Back-link color: match the page's own link color — but mind how `color:inherit` works.**
The anchor keeps `color:inherit`, but `inherit` takes the **footer element's** computed color, NOT
the page's `a { color: ... }` rule (an inline `color:inherit` on the anchor outranks the `a`
selector). So the color is set on the **`#course-nav-footer` element** and the anchor inherits it.

Resolve that color at import time, in this order:

1. **If the page follows the `THEME.md` token contract** (it declares `--accent` in `:root`), write
   `color:var(--accent,#XXXXXX)`, where the fallback `#XXXXXX` is that page's accent value copied
   out of its `:root` at import. The token keeps the back-link correct if the page is later
   re-themed, and the literal keeps it correct if a re-imported body drops the token.
2. **If the page has a distinct link or accent color but no token**, hardcode that color.
3. **If the page has no distinct link color**, use the muted default `#78786A`.

A page already on the course palette therefore ends up maroon through step 1, and an off-palette
page ends up matching itself through step 2 or 3 — neither outcome needs a special case. What to
avoid is hardcoding `#8C1D40` on a page that is not on the course palette: a lone maroon link under
a green-and-cream widget looks like a mistake, and the fix is to theme the page (see `THEME.md`),
not to recolor the link in isolation.

Check contrast against the footer's background: on dark-themed pages whose links are white or
light, use the nearest readable accent instead. Keep `text-decoration:none` plus the
hover-underline, and match the underline behavior of the page's other footer links (see the
link-decoration rules in `FOOTER.md`).

The `<script>` acts only inside an iframe (the `window.self !== window.top` guard) and does nothing
on a direct visit; its comments explain each part. Beyond them:

- **Find the footer by id.** Use `getElementById('course-nav-footer')`, not
  `querySelector('footer')`, because some demos have their own `<footer>` elements and
  `querySelector` would match the first one.
- **Canvas honors the message broadly.** Canvas LMS listens for `lti.frameResize` on every page,
  matches the sender against every iframe (not only LTI launches), and applies no maximum.
- **Measure the `<html>` element's box, not `scrollHeight`.** `scrollHeight` is floored at the
  viewport height, so once the host has grown the iframe for a tall tab it would never report a
  shorter one. The bounding rect of `document.documentElement` is content-driven and includes the
  body margins.
- **Only `min-height` in `vh` units is neutralized**, whether on `body` or an inner wrapper, so a
  fixed-position overlay sized with `height: 100vh` keeps working.
- **The `ResizeObserver` does the tracking.** It fires on tab switches, on results panels that
  appear after a run, on late-loading web fonts, and on reflow after the host's column changes
  width, so no per-widget hook into the tab code is needed.
- **The `'*'` target origin is fine.** The message carries only a subject string and one integer,
  is delivered in-browser to the parent window only, and makes no network request; the embedding
  site is not known in advance, and nothing in the payload needs protecting.

See "Embedding in Canvas LMS" below for the matching iframe code and how to test the resize.

**Before adding, reviewing, or restyling a footer, copyright line, or footer link, read
`FOOTER.md`.** It holds the layout conventions (copyright centered above a left-aligned back-link,
at most one rule in the footer area, one underline behavior per page) and the pitfalls found so far
in importing widgets, such as a demo's generic `footer {}` rule leaking into `#course-nav-footer`.

### 3. Entry in `index.html`

Add a `<li>` inside the correct `<section class="demo-section">` in `index.html`. Each section
ends with a placeholder comment marking where to insert (`<!-- Add more <topic> demos here -->`):

```html
<li>
  <a class="demo-row" href="my_demo/my_demo.html">
    <img class="demo-thumb"
         src="my_demo/my_demo-preview.png"
         alt="My Demo preview"
         width="120" height="90">
    <div class="demo-text">
      <h3>Demo Title&nbsp;– interactive explainer</h3>
      <p>One sentence description that conveys what the demo shows and why it matters for the course.</p>
    </div>
  </a>
</li>
```

#### Adding a new section

Sections are created as demos arrive, so the first demo in a new topic area brings its section with
it. To add one:

1. Insert the section into `index.html` **above** the `#more` section, using this template (mind the
   box-drawing banner; the opening line carries 54 `═` and the closing line 55):

   ```html
   <!-- ══════════════════════════════════════════════════════
        Section Name
   ═══════════════════════════════════════════════════════ -->
   <section id="section-slug" class="demo-section">
     <h2>Section Name</h2>
     <ul class="demo-list">

       <!-- demo <li> entries go here, newest last -->

       <!-- Add more section-topic demos here -->

     </ul>
   </section>
   ```

2. Add `<li><a href="#section-slug">Short Label</a></li>` to **both** nav lists: the
   `<nav class="side-nav">` at the top of the page and the `#nav-drawer` list near the bottom.
   The sidebar is narrow (168px), so keep the label short (abbreviate where needed, as in
   "Random Variates" for "Random Variate Generation"). The `#more` entry stays last in both.
3. Add a matching `### Section Name` heading and table to the Contents in `README.md`.
4. Add the section and its first demo to "Widgets" below.

Order sections to follow the arc of the course rather than the order demos happen to be written.

### 4. Entry in `README.md`

Add a row to the appropriate table under `## Contents`:

```markdown
| [`my_demo/`](my_demo/) | Brief description matching the index entry |
```

### 5. A short tag and a row under "Widgets"

Settle on a short commit tag for the new widget (see "Commit messages" below) and add it, with the
widget's path and verify command, under "Widgets" below. If the demo joins a directory that already
holds one, tag at the widget level from here on: the two are independent tools sharing a topic, and
the directory name no longer picks out either.

### 6. Notes in the directory's `CLAUDE.md`

Anything a later edit needs to know that the code does not make obvious (the core sentinels, what
the verify script checks and how long it takes, conventions that code outside the file relies on)
goes in the `CLAUDE.md` of the widget's own directory, not in this file. Claude Code loads that file
only when a file in its directory is read, so this one stays small.

---

## Embedding in Canvas LMS

Widgets are embedded in Canvas pages as plain iframes pasted through the Rich Content Editor's HTML
view. Canvas's sanitizer keeps `src`, `width`, `height`, `loading`, `allowfullscreen`, `frameborder`,
`scrolling`, `allow`, and `sandbox` on an iframe, plus the global `style`, `title`, `class`, and
`id`, and the `src` must be http or https. Do not add `sandbox` (it blocks the widget's scripts) or
`scrolling="no"` (it clips content wherever the resize message is not honored).

- **Titles stay the widget's own.** The `<title>` element and the iframe's `title` attribute both
  carry the widget's name exactly as it appears on the page. The Canvas page that hosts the
  iframe is titled in Canvas, and whatever prefix that page uses is a Canvas-side choice that
  never enters the widget or the embed code.
- **Embed code**, with the URL, title, and fallback height changed per widget:

  ```html
  <iframe src="https://tpavlic.github.io/asu-simulating-stochastic-systems/monte_carlo/mc_explorer.html"
          title="Monte Carlo Explorer"
          width="100%" height="1560"
          style="width:100%;border:0;display:block;"
          allow="clipboard-write"
          loading="lazy" allowfullscreen></iframe>
  ```

- **The embed code is the iframe alone.** Never add an "Open … in a new tab" link or any other
  text under it: the widget should read as a seamless part of the Canvas page, not as something
  embedded from elsewhere.

- **`allow="clipboard-write"` lets the plots' COPY buttons work in Chrome.** Chrome refuses a
  clipboard write from a cross-origin frame that the host has not granted it, and the widget then
  says the copy was blocked and points to the PNG button; Safari and Firefox need no grant. Canvas keeps the
  attribute, as above.
- **The `height` attribute is the fallback** for any host that ignores the resize message. Set it to
  the tallest tab, measured with the footer hidden at about 780px (the narrow end of Canvas's
  desktop content column) and rounded up a little to absorb results that appear after a run. Where
  the message is honored, the attribute is overwritten within a frame of load and never seen.
- **Test the resize with a local host page**, not by eye: serve the repository over HTTP (Playwright
  refuses `file:` URLs), embed the widget in a page whose `message` listener applies
  `lti.frameResize` to the sending iframe, and check on every tab that the iframe's height equals
  the widget's content height and that the widget's `scrollHeight` does not exceed the iframe's
  `clientHeight`. Walk the tabs in both directions so a failure to shrink shows up. Test against a
  listener that attaches a few seconds late too, not only one listening from the start: Canvas
  attaches its listener only once its own bundle has booted, which is why the script re-sends.

## HiDPI `<canvas>` rendering

Any `<canvas>` drawing (plots, diagrams, scatter/loss charts, histograms) looks blurry on
retina/HiDPI unless the backing store is scaled by `devicePixelRatio`. Draw in **logical** units
but size the backing store at `logical × dpr` and scale the context once:

```js
const dpr = window.devicePixelRatio || 1, W = 600, H = 175;   // logical size
cv.style.width = W + 'px';                                     // display size (height:auto keeps ratio)
cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
const ctx = cv.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                        // all drawing below uses logical W,H
```

- Draw with the logical `W`/`H`, **not** `cv.width`/`cv.height` (those are now the larger backing
  store — using them would double-scale).
- For a canvas redrawn every frame, guard the resize (`if (cv.width !== Math.round(W*dpr)) { … }`)
  so an incremental (non-clearing) draw loop is not wiped each frame.
- Mouse/click mapping that uses `getBoundingClientRect()` normalized to `[0,1]` is unaffected by
  the backing-store change, so interaction keeps working.

When adding or reviewing a demo with canvas graphics, check that this dpr scaling is present.

**Plain SVG sidesteps all of this and is usually the better choice.** A `<svg>` with a `viewBox`
and no `width`/`height` attributes is resolution-independent: it is sharp at any zoom on any
display, it needs no `devicePixelRatio` bookkeeping, and it needs no redraw when its container
resizes. Reach for `<canvas>` when a plot is redrawn every frame (an animation, a live simulation)
or when it carries so many marks that one DOM node each would be slow — a few thousand is the rough
threshold. For a plot that changes only when the reader changes something, use SVG.

## Mobile and touch

Every widget gets opened on a phone, both directly and inside the Canvas app, so treat a 390px
touch screen as a first-class target rather than a degraded one. When adding or reviewing a demo,
check all of the following.

- **No horizontal scroll at 390px, on every tab.** Measure it (`document.documentElement.scrollWidth`
  against `clientWidth`) rather than eyeballing it, and check each tab separately, since one tab
  overflowing is easy to miss. The usual culprits are a `white-space: nowrap` label sitting beside a
  control and a wide table that is not inside an `overflow-x: auto` wrapper.
- **Touch targets at 24×24 CSS pixels or more** (WCAG 2.5.8). Grow the *hit area* with padding and
  `min-height`, not the drawn control — a checkbox scaled to 24px square dominates the row it sits
  in. A 17px checkbox inside a `<label>` that clears 24px is fine, because the label is what a
  finger actually hits.
- **Range inputs need an explicit height.** A default one is about 16px tall, which is both under
  the minimum and genuinely hard to hit; `height: 26px` grows the strip a finger lands on without
  changing how the thumb looks.
- **`-webkit-text-size-adjust: 100%` on `body`.** iOS Safari inflates text when the phone is turned
  to landscape, which breaks every width the layout depends on.
- **A hover-only affordance is invisible on a touch screen.** Anything revealed on `:hover` needs an
  `@media (hover: none)` rule that keeps it visible, plus a sentence somewhere on the page saying
  the feature exists — a hover reveal is undiscoverable even with a mouse if nothing hints at it.
- **Never let a `title` attribute be the only copy of an explanation.** It shows nothing on a touch
  screen, cannot be reached from the keyboard, and is announced inconsistently by screen readers.
  The HTML spec itself discourages relying on it. Use the shared tooltip described in `THEME.md`,
  and mirror the text into the accessibility tree with `aria-describedby`. Restoring the `title`
  alongside is not the fix: the browser would raise its own bubble next to the custom one.
- **Reach for `aria-describedby` wherever a control carries an explanation its visible label does
  not.** Point it at a visually hidden span holding the text, and park that span outside the control.
  Inside a `<button>` or `<label>` it is read as part of the control's *name* rather than as its
  description. The same applies to any hint a sighted user gets from position or color alone; if it
  is worth saying on screen, it is worth putting where a screen reader will find it.
- **Drag-and-drop does not exist on a phone.** Anything droppable needs a file input or a paste box
  beside it.
- **Every interaction has to work with a finger, not only with a cursor.** A draggable handle on a
  plot is the usual miss: it needs pointer events rather than mouse events, a hit area of at least
  24px around the drawn mark (compute it in `viewBox` units from the rendered scale because the
  drawn dot stays small), and a `touchstart` listener that calls `preventDefault` **only** when the
  gesture starts on a handle, and so a swipe across the rest of the chart still scrolls the page.
  Anything a mouse gets from hovering needs a tap path too: on the OC chart in `power_analysis/`, a
  tap moves the lookup to the point touched, which is the finger's version of dragging the dot
  there.
- **Check that plots stay legible, not just that the page fits.** Measure
  `renderedWidth / viewBoxWidth` for every `<svg>` plot at 390px: 1.0 means the labels render at
  their nominal size, and anything below about 0.85 is shrunken type. A wide plot needs a
  narrow-screen `viewBox` sized to its container (see `THEME.md`), and its labels then need
  re-checking at that size because two annotations that clear each other across 940 units can
  collide across 310.
- **Test in a real touch context, not a narrow desktop window.** Touch emulation is what catches a
  control that a mouse can drive and a finger cannot; a resized desktop window will not. Script the
  audit rather than eyeballing it: walk every tab at 390px and report page overflow, any control
  whose hit box is under 24px, and every plot's rendered-to-viewBox scale.

## Site structure

- `index.html` — the root landing page; self-contained HTML (no Jekyll/build step)
- `README.md` — GitHub repo landing page; mirrors the index structure for repo visitors
- Each demo is a **self-contained, single-file HTML page** with all CSS and JS inlined. The
  Output Analyzer is authored as ES modules but inlined into its page by a script, so it too opens
  from disk and embeds like every sibling (see `output_analysis/output_analyzer/CLAUDE.md` for the
  editing rule)
- Each widget directory has a `CLAUDE.md` holding its widgets' notes
- `THEME.md` governs color and the shared widget chrome; `FOOTER.md` holds the footer layout
  conventions and pitfalls
- Preview images live alongside their HTML file in the same subdirectory
- The site is deployed via **GitHub Pages** directly from the `main` branch (no build step)
- `index-preview.png` is the root page's OG/Twitter card image: a 2×2 montage of the four
  widget previews (rounded tiles with drop shadows on white), built by `make_index_preview.py`
  at the repo root. Re-run that script whenever a widget preview changes or a new widget's tile
  should join, and keep its `W`/`H` in step with the `og:image:width`/`height` in `index.html`
  (ratio near 2:1 for Twitter/X). The script is not linked from the site

## Branches

**Commit and push directly to `main`.** This repository has a single developer, and so there is no
review step for a branch to wait on: never open a pull request, and do not create a branch unless
the user asks for one (they may, for a long side project). This holds even when a session's setup
names a feature branch to develop on.

## Commit messages

**A localized edit to one widget has to make that widget identifiable from the commit message, and
preferably from the subject line itself.** Normally that takes the form of a short prefix – the
widget's tag, a colon, and a space – so a narrow summary is not stranded in `git log --oneline`
with no sign of where it landed:

```text
prng: Rework tab 6's cards, and label the lattice plots
power: Fix the margins on the narrow-screen layout
```

Tags are not permanent, because widgets keep arriving. While a directory holds a single widget its
name is the natural tag (`prng`, or a trimmed `power` for `power_analysis/`); once it holds several
independent tools, tag the widget instead (`models`, `compare`, or initials such as `ia` and `oa`
where a bare word would fit two widgets), and let earlier commits keep the tags they were written
with. The current tags are listed under "Widgets" below; `git log --oneline -- <dir>/` shows what a
widget has been tagged before. Keep the tag short: the whole subject line should stay at 72
characters or fewer. This is not Conventional Commits, as there is no `feat:`/`fix:` type and the
tag names a widget rather than a kind of change.

**Omit the tag when the subject already says where the work is**, either because it names its target
("Add mobile-friendliness rules to CLAUDE.md") or because it describes a sweep ("Change the color
scheme on every widget", "Update the conventions for mobile devices"). Such a commit still owes the
reader its scope, but carries that scope in the summary, where a tag would understate it. A commit
spanning exactly two widgets can carry both tags (`mc, prng: …`), though splitting it is usually
better.

## Widgets

Each directory's `CLAUDE.md` holds the notes for its widgets. Most widgets keep their numerics
between `XX-CORE-BEGIN` / `XX-CORE-END` sentinels: pure numerics with no DOM access, and the block
must not contain the words "window" or "document". A `verify_*.mjs` script beside the widget slices
that block out of the HTML and runs it in Node. The verify scripts are not shipped with the widgets
and are not linked from the site; run a widget's script after touching anything in its core.

### Monte Carlo Methods

- `monte_carlo/mc_explorer.html` — tag `mc`; no verify script
- `monte_carlo/mc_examples.html` — tag `mcx`; `node monte_carlo/verify_mc_examples.mjs`

### Pseudorandom Number Generation

- `prng/prng_explorer.html` — tag `prng`; `node prng/verify_prng_explorer.mjs`

### Input Modeling

- `input_modeling/input_analyzer.html` — tag `ia` (earlier commits: `analyzer`);
  `node input_modeling/verify_input_analyzer.mjs`
- `input_modeling/prob_models.html` — tag `models`; `node input_modeling/verify_prob_models.mjs`

### Output Analysis

- `power_analysis/power_explorer.html` — tag `power`; `node power_analysis/verify_power_explorer.mjs`
- `output_analysis/ci_explorer.html` — tag `ci`; `node output_analysis/verify_ci_explorer.mjs`
- `output_analysis/multiple_comparisons.html` — tag `compare`;
  `node output_analysis/verify_multiple_comparisons.mjs`
- `output_analysis/output_analyzer/output_analyzer.html` — tag `oa`;
  `node --test output_analysis/output_analyzer/test/`


## Course topic vocabulary

Use the course's own vocabulary for section titles so students can orient themselves. The course
covers pseudorandom number generation and randomness testing, random variate generation (inverse
transform, acceptance-rejection, convolution), input modeling and distribution fitting,
discrete-event simulation, queueing models, output analysis (replications, confidence intervals,
warm-up and steady-state), comparison of alternative systems, variance-reduction techniques, and
verification and validation.

## Shared conventions

- **Color choices are governed by `THEME.md`**, which carries the contrast reference table, the
  rule that color alone may never carry meaning, and the reasoning behind the data palette. Consult
  it before picking any new color rather than matching one by eye.
- **Accent color:** `#8C1D40` (ASU maroon) — used in links and section headings. Derived tints in
  `index.html`: `#6b1631` (dark hover), `#e0c2cc` (rules), `#f0e2e6` (light rules), `#fbf3f5` (row
  hover), `#f5e6ea` (active nav, thumbnail background)
- **Copyright:** © Theodore P. Pavlic, MIT License (`LICENSE` file at repo root)
- **YouTube channel:** <https://www.youtube.com/@TedPavlic> — linked from the index header
