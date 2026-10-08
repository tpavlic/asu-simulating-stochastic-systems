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

When a user asks to add an existing demo to the index/README/CLAUDE.md, **always also audit
the demo's HTML file itself** before finishing:

1. Check that `<head>` has a `<meta name="description">`, the full OG block, and the Twitter/X
   card block. If any are missing, add them (use the preview image dimensions from the actual
   file; aspect ratio should be close to 2:1 for Twitter).
2. Check that the bottom of `<body>` has the standard back-link `<footer>` and the embed
   `<script>` (footer hiding plus the host-resize message). If missing, add them.

Do this proactively — the user should not have to ask separately.

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
before the dash is non-breaking, so the dash cannot wrap to the start of a line. In the
`<title>` element and the `og:title` and `twitter:title` values, that space is a literal U+00A0,
never `&nbsp;`: tools that read these as plain text (link unfurlers, bookmark exporters,
scripts) can show an entity verbatim, as the literal-characters rule below explains. In a
visible heading in the page body, such as an `index.html` entry, write `Demo Title&nbsp;–
subtitle`. The space after the dash is an ordinary space. Every widget, `index.html`, and `README.md` follow this form, so keep it
consistent when adding or renaming one.

**Twitter/X image requirements** (stricter than other platforms):

- Aim for an aspect ratio near **2:1** (e.g. 1200×600, 2400×1200) and keep the important
  content centered. Twitter's own card code enforces only a 280×150 minimum, so a wider ratio
  is not rejected, but the card is rendered toward 2:1 and the edges may not survive.
- File size must be **under 5 MB**.
- Only if a ratio actually causes a problem, add a cropped or padded version for `twitter:image`
  while leaving `og:image` on the full-resolution original. Do not do this pre-emptively.

**Use literal characters, not HTML entities, in `og:*` and `twitter:*` `content` attributes.**
Social-card scrapers read these values as plain text, not HTML, so they often do not decode
entities — a title like `Foo &amp; Bar` can surface verbatim as "Foo &amp; Bar". Worse, an
ampersand followed by a space (`Foo & Bar`) is not even a valid entity, so escaping is both
unnecessary and harmful here. Write the literal character instead: `og:title` and
`twitter:title` (and the matching `:description` tags) should contain `&`, not `&amp;`, and
likewise use literal `–`, `<`, `>`, `'`, and a literal non-breaking space, etc. (This applies only to the social-card meta
`content` attributes; the human-visible `<title>` element and page body still follow normal
HTML escaping rules.)

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
hover-underline, and match the underline behavior of the page's other footer links — see the
link-decoration rule below.

The `<script>` does two things when the page is embedded in an iframe, and nothing at all on a
direct visit, because everything sits behind the `window.self !== window.top` guard. First, it hides
the back-link footer. Use `getElementById('course-nav-footer')` rather than `querySelector('footer')`,
because some demos have their own internal `<footer>` elements and `querySelector` would match the
first one it finds. Second, it reports the page's content height to the host with the
`lti.frameResize` message, which Canvas LMS listens for on every page (the listener matches the
sender against every iframe on the page, not only LTI launches, and applies no maximum), so the
iframe grows and shrinks with the active tab instead of scrolling inside itself. Three details keep
that working:

- **Measure the `<html>` element's box, not `scrollHeight`.** `scrollHeight` is floored at the
  viewport height, so once the host has grown the iframe for a tall tab it would never report a
  shorter one, and the iframe could never shrink back. The bounding rect of
  `document.documentElement` is content-driven and includes the body margins.
- **Viewport-tied `min-height` rules are neutralized when embedded.** The `min-height: 100vh`
  idiom that fills a window would track the frame's own height and keep it from ever shrinking, so
  the script walks the page's stylesheets and zeroes any `min-height` given in `vh` units, whether
  on `body` or on an inner wrapper. It touches only `min-height`, so a fixed-position overlay sized
  with `height: 100vh` keeps working, and fixed-position elements are out of flow anyway.
- **Let the `ResizeObserver` do the tracking.** It fires on tab switches, on results panels that
  appear after a run, on late-loading web fonts, and on reflow after the host's column changes
  width, so no per-widget hook into the tab code is needed. The `last` check keeps it from
  re-sending an unchanged height. The timed re-sends exist because Canvas attaches its listener
  only once its own bundle has booted, which on a wiki page can be well after a small static
  widget has finished loading; a height posted before that point is lost, and the observer will
  not repeat it unless the content moves. Test the resize against a host page whose listener
  attaches a few seconds late, not only against one that is listening from the start.

The message carries only a subject string and one integer, is delivered in-browser to the parent
window only, and makes no network request, so the `'*'` target origin is fine: the embedding site is
not known in advance, and nothing in the payload needs protecting. See "Embedding in Canvas LMS"
below for the matching iframe code and how to test the resize.

**Watch for body padding:** if the demo's `body` CSS has no `padding-bottom`, the footer will
sit flush against the viewport edge. Add `padding-bottom` to the body or `margin-bottom` to
the footer if needed.

**Footer/copyright layout — conventions and pitfalls:**

- **Footer copyright centered; back-link left-aligned** to the content's left edge, with only a
  small gap between them. Put a subtle footer copyright line (`© 2026 Theodore P. Pavlic ·
  MIT License`, MIT linked, `MIT&nbsp;License` non-breaking) just above the back-link.
- **A generic `footer { … }` rule leaks into `#course-nav-footer`.** Many demos style their own
  copyright `<footer>` with `font-family:var(--mono)`, `text-align:center|right`, and padding;
  since `#course-nav-footer` is also a `<footer>`, those cascade in and make the back-link look
  monospace / centered / oddly padded. Fix by overriding on the back-link's inline style
  (`font-family:inherit; text-align:left; padding:0`) or scoping the demo's rule to
  `footer:not(#course-nav-footer)`.
- **The back-link footer sits OUTSIDE the page's main content wrapper** (it is a direct
  `<body>` child placed after the wrapper). If the demo sets its `font-family` (or text color)
  on that wrapper — e.g. `.wrap { font-family: sans-serif }` — rather than on `body`, the
  back-link does not inherit it and falls back to the browser default (serif). Set
  `font-family` explicitly on `#course-nav-footer` to match the page, and align its left edge
  to the wrapper's content, not with extra padding.
- **Header copyright vs title baseline.** A header flex row with `align-items:flex-start` makes
  a small top-right copyright sit visibly *above* the large title's glyphs (different
  half-leading). Use `align-items:baseline`.
- **`html, body { padding: … }` applies the padding twice** (once to each element), doubling the
  top/side/bottom space. Put layout padding on `body` only.
- **Don't try to center the footer copyright on the organic tab-row width.** CSS can't reference
  another element's rendered width, hardcoded pixel guesses land off-center, and JS measurement
  is fragile (web fonts load late; tabs may collapse to a dropdown). Left-align it instead, or
  center it under a fixed content-column `max-width`.
- **Per-tab pages sharing one `<footer>`:** a bottom copyright shows a top rule only on the tab
  whose last element happens to have a border. Give the copyright `<footer>` its own
  `border-top` so the rule is consistent across tabs.
- **`#body { flex:1 }` under `body { min-height:100vh; display:flex; flex-direction:column }`**
  stretches the widget and strands the back-link at the very bottom on tall windows. Drop the
  `flex:1` so the footer sits directly under the content.
- **In-plot copyright** baked into `<canvas>`/`<svg>` `<text>` can still be linked by wrapping
  the `<text>` in an SVG `<a href="…" target="_blank" rel="noopener">` (keeps the same look).
- **Back-link arrow (`&larr;`) glyph varies by font fallback.** The page webfonts (Outfit,
  Inter, etc.) usually lack a `←` glyph, so it falls back down the stack. A stack containing
  `system-ui`/`-apple-system` renders a short, stubby `←` (San Francisco on macOS), whereas
  falling through to the generic `sans-serif` gives a longer, nicer `←` (Helvetica/Arial).
  For a consistent long arrow, wrap just the arrow in `<span style="font-family:sans-serif">&larr;</span>`
  (as in the template above) so it never picks up `system-ui`.
- **A generic `footer { … }` rule also leaks `border-top` and `margin-top` onto
  `#course-nav-footer`.** Beyond font/align, a demo's copyright `footer{}` styling can put a hard
  rule (`border-top`) and a large top margin on the back-link footer too (both are `<footer>`),
  giving an unwanted second horizontal rule and a big gap. Reset `border-top`/`margin-top`/`padding`
  on `#course-nav-footer` inline, or scope the rule to `footer:not(#course-nav-footer)`.
- **Reused `cr-br`/`cr-sep` wrap classes can carry the wrong default.** Some headers put the
  copyright in a narrow column and set `cr-br` to show (two-line) by default; a footer copyright
  that reuses those classes inherits the two-line default. Give the footer copyright its own
  scoped wrap rules (`.foo .cr-sep{display:inline}.foo .cr-br{display:none}` + a narrow media
  query) so it is one line with the dot by default and only reflows to two lines on narrow screens.
- **At most one hard rule in the footer area.** The copyright footer and the back-link footer can
  each carry a `border-top`, and having both stacks two rules bracketing the copyright, which reads
  as too much. Keep at most one. If the body is built from panels with hard edges, no footer rule is
  needed. If the body is borderless, a single rule above the copyright can help, mirroring the rule
  under the lede at the top of the page, but then do not also put one on the back-link footer.
- **When you remove a footer rule, drop the `padding-top` that paired with it.** A `border-top` is
  usually paired with a `padding-top` that seats the text below the rule (for example on the
  back-link footer's inner `<div>`). Once the rule is gone, reduce that padding (say `0.75rem` to
  `0.35rem`), or the element floats with a phantom gap.
- **Tighten the copyright-to-back-link gap from the content side, not with a negative margin on the
  back-link footer.** The copyright is usually the last child inside the main content wrapper, so the
  gap below it is the wrapper's `padding-bottom`, not the copyright's own margin. Reduce that wrapper
  bottom padding (a positive value) rather than pulling the back-link up with a negative `margin-top`.
- **Space under the back-link: do not stack `body` padding-bottom and the footer's own
  `padding-bottom`.** If `body` has all-sides padding (e.g. `padding:18px`), a back-link footer that
  also sets a bottom padding doubles the space, so that page's back-link sits visibly lower than
  sibling pages whose footers have none. Pick one source (usually the body padding) and keep it
  consistent across pages.
- **Header copyright in a colored banner.** For a right-aligned copyright/license in a colored
  header, make it a flex child pushed right with `margin-left:auto`, styled like the muted subtitle.
  On a dark or colored banner keep the license link `color:inherit` (the banner's light text) rather
  than the page accent, which would be unreadable there, but keep hover-underline so its behavior
  matches the footer link. To balance a two-line title, stack it on two lines by default (copyright
  on top, license below) and collapse to one line as the header narrows, using a toggled `<br>` and
  a `·` separator (two-line: the `<br>` shows and the separator is hidden; one-line: the `<br>` is
  hidden, the separator shows, and `width:100%` drops the block onto its own line under the
  subtitle). Split it back to two lines at a much narrower breakpoint. Match the header separator's
  spacing to the footer separator's (e.g. `margin:0 .3em`) so both dots look the same.

**Link decoration (underline) consistency.** Within each page, the copyright/license "MIT License"
links and the back-link should share ONE underline behavior; the default is **hover-underline**
(no resting underline, no hover-bold, no hover color-shift — the underline appears only on hover).
Use a resting (always-on) underline only when a link is the *same color* as its surrounding text
so nothing else signals it is a link; better still, give such links a distinct accent color and
keep hover-underline. Colors may differ by context and need not match across header/footer:

- Choose each link's color to be readable **and** distinct from adjacent text *in its own
  context*. An accent that reads on a light footer (maroon, orange, blue) is often unreadable on
  a dark header banner — there, let the header "MIT License" link keep the banner's own text color
  (it is fine if it does not obviously look like a link).
- The back-link should match the page's link color: set the `#course-nav-footer` element's `color`
  to that accent (the anchor keeps `color:inherit`).
- Bring body/reference links into the same behavior (e.g. via the page's global `a{}` rule:
  `a{…;text-decoration:none} a:hover{text-decoration:underline}`) so the whole page is consistent.

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
4. Record the section and its demos under "Current sections and demos" below.

Order sections to follow the arc of the course rather than the order demos happen to be written.

### 4. Entry in `README.md`

Add a row to the appropriate table under `## Contents`:

```markdown
| [`my_demo/`](my_demo/) | Brief description matching the index entry |
```

### 5. A short tag for the demo's commits

The commits that introduce a demo usually name it in their summaries and so need no prefix, but the
narrow follow-up edits ("Fix the margins", "Reword tab 3's lede") do. Settle on a short tag for the
new widget now (see "Commit messages" below) so those later commits have one to reach for. If the
demo joins a directory that already holds one, tag at the widget level from here on: the two are
independent tools sharing a topic, and the directory name no longer picks out either.

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
          loading="lazy" allowfullscreen></iframe>
  <p><a href="https://tpavlic.github.io/asu-simulating-stochastic-systems/monte_carlo/mc_explorer.html" target="_blank" rel="noopener">Open the Monte Carlo Explorer in a new tab</a></p>
  ```

- **The `height` attribute is the fallback** for any host that ignores the resize message. Set it to
  the tallest tab, measured with the footer hidden at about 780px (the narrow end of Canvas's
  desktop content column) and rounded up a little to absorb results that appear after a run. Where
  the message is honored, the attribute is overwritten within a frame of load and never seen.
- **Test the resize with a local host page**, not by eye: serve the repository over HTTP (Playwright
  refuses `file:` URLs), embed the widget in a page whose `message` listener applies
  `lti.frameResize` to the sending iframe, and check on every tab that the iframe's height equals
  the widget's content height and that the widget's `scrollHeight` does not exceed the iframe's
  `clientHeight`. Walk the tabs in both directions so a failure to shrink shows up.

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
  Output Analyzer in `output_analysis/output_analyzer/` is authored as ES modules under its `js/`
  directory, but its page is still self-contained: `inline_modules.mjs` embeds every module into
  the page as inert text, and a small loader in the page turns them into modules at run time, so
  the page opens from disk and embeds like every sibling (see its entry under "Current sections
  and demos" for the editing rule)
- Preview images live alongside their HTML file in the same subdirectory
- The site is deployed via **GitHub Pages** directly from the `main` branch (no build step)
- `index-preview.png` is the root page's OG/Twitter card image: a 2×2 montage of the four
  widget previews (rounded tiles with drop shadows on white), built by `make_index_preview.py`
  at the repo root. Re-run that script whenever a widget preview changes or a new widget's tile
  should join, and keep its `W`/`H` in step with the `og:image:width`/`height` in `index.html`
  (ratio near 2:1 for Twitter/X). The script is not linked from the site

## Commit messages

**A localized edit to one widget has to make that widget identifiable from the commit message, and
preferably from the subject line itself.** Normally that takes the form of a short prefix – the
widget's tag, a colon, and a space – so a narrow summary is not stranded in `git log --oneline`
with no sign of where it landed:

```text
prng: Rework tab 6's cards, and label the lattice plots
power: Fix the margins on the narrow-screen layout
```

Tags are not enumerated anywhere and are not permanent, because widgets keep arriving. While a
directory holds a single widget its name is the natural tag (`prng`, or a trimmed `power` for
`power_analysis/`); once it holds several independent tools, tag the widget instead (`analyzer`,
`tutorial`, qualified as `input/analyzer` where the bare form is ambiguous), and let earlier
commits keep the tags they were written with. `monte_carlo/` now holds two: `mc` stays the
explorer's tag and `mcx` is the examples widget's. `input_modeling/` also now holds two: `analyzer`
is `input_analyzer.html`'s tag and `models` is `prob_models.html`'s. `output_analysis/` also now
holds three: `ci` is `ci_explorer.html`'s tag, `compare` is `multiple_comparisons.html`'s, and `oa` is
the multi-file app in its `output_analyzer/` subdirectory. Reuse
whatever a widget has been tagged before – `git log --oneline -- prng/` shows it – and keep the
tag short: the whole subject line should stay at 72 characters or fewer. This is not Conventional
Commits, as there is no `feat:`/`fix:` type and the tag names a widget rather than a kind of
change.

**Omit the tag when the subject already says where the work is**, either because it names its target
("Add mobile-friendliness rules to CLAUDE.md") or because it describes a sweep ("Change the color
scheme on every widget", "Update the conventions for mobile devices"). Such a commit still owes the
reader its scope, but carries that scope in the summary, where a tag would understate it. A commit
spanning exactly two widgets can carry both tags (`mc, prng: …`), though splitting it is usually
better.

## Current sections and demos

### Monte Carlo Methods

- `monte_carlo/mc_explorer.html` *(four tabs: dartboard estimation of π, Buffon's needle, area
  estimation by a walking robot, and Monte Carlo integration. The three experiment tabs carry
  accumulating 95% confidence intervals and a 100-run sweep; the robot tab is an animated extension
  with no controls. Expected to gain further tabs tailored to this course)*
- `monte_carlo/mc_examples.html` *(six tabs, each a short simulation per replication rendered as a
  spreadsheet-style table that can be stepped row by row, a bespoke structure view, and an
  accumulating output histogram with a draggable success threshold, t and Wilson intervals, an
  experiment log of finished batches (each row expandable into that batch's own histogram), and a
  New batch / Clear all / Clear log trio: ① a queueing node (the book's M/M/1 and M/M/2
  spreadsheets) with exponential interarrival and service times, a capacity toggle, and an end
  time T at which the clock stops (a customer who has begun service by T is counted with its
  wait; one still in the queue at T is shown, muted, but not counted, and the chart's axis ends
  at T), whose three outputs are the average wait, the longest wait, and server utilization --
  the one time average among them, on a fixed 0-to-1 axis against an expected-utilization
  reference line that is shown only while ρ < 1, exactly where the steady-state wait's line
  is, and carrying the widget's only two-sided success target (a min/max band, since servers
  that sit idle are capacity paid for and not used, and servers busy every minute have no
  slack left), ② the order-up-to (M, N) refrigerator policy with three outputs, ③
  bearing replacement under three policies over 20 000 operating hours, ④ the newsvendor with Q
  (its spinner lives inside the flowchart's own svg), ⑤ aid drops into the book's octagon, with
  n and a slider for each landing spread set inside the distribution table, the landing
  distribution always drawn under the drops as a continuous gray surface, and a map frame that
  never re-scales (the slider ranges are capped so under 2.5% of packages fall past its edge),
  and ⑥ a three-path activity network with 1, 2, and 4 uniform steps of equal mean and support
  (chosen to differ from the book's breakfast network, which is a lab exercise) and no decision,
  whose point is that only the path that finishes last matters (the histogram of the longest path
  shows it). Commit tag `mcx`.
  Conventions relied on by code outside the file, which any later edit has to preserve:*
  1. *Everything between the `MCX-CORE-BEGIN` / `MCX-CORE-END` sentinels is pure numerics with no
     DOM access, and the block must not contain the words "window" or "document".
     `monte_carlo/verify_mc_examples.mjs` slices that block out of the HTML and runs it in Node.*
  2. *`verify_mc_examples.mjs` is not shipped with the widget and is not linked from the site. Run
     it (`node monte_carlo/verify_mc_examples.mjs`, a few seconds; `MCX_CALIB_REPS` shortens the
     interval-coverage section) after touching anything in the core. It checks the samplers and
     intervals, the newsvendor Monte Carlo mean against the exact expected profit for every Q, the
     order-up-to model against the book's Table 2.21 row by row (fed the book's own demand and
     lead-time sequence), the drop model against quadrature of the bivariate normal over the octagon
     and a binomial fit (at the book's own standard deviations and at three other pairs, since
     those are a knob), the bearing policies against exact discrete renewal functions on the
     100-hour grid (with and without a warm-up), the activity network against scaled Irwin–Hall CDFs and numerically
     integrated longest-path probabilities, and the queueing node against the book's Tables 2.11
     and 2.15 row by row, against the Erlang-C steady-state wait on long replications, for
     the cut at T (every counted customer began service by T, and the cut ones carry null
     fields), and for server utilization (against a grid integration of the number in service
     at four knob settings, bounded in [0, 1], and approaching ρ on long replications).*
  3. *Deliberate conventions: histograms plot the fraction of runs on axes with a bin width fixed
     per output at design time; the range starts at a design-time value too and extends to fit
     (never shrinks within a batch), except for an output whose whole range is fixed by its sample
     space or exact support (the drops count, the network finish time, the queue's server
     utilization), and each logged batch's
     histogram (redrawn on demand when its log row expands) keeps the range it ended with rather
     than the live one's; the newsvendor's 17-cent lost-profit charge is the book's and is
     a toggle; the bearing clock counts operating hours only (downtime is charged, not clocked),
     bearing-hours are 3 × 20 000, and under the age policy a life equal to T is replaced as planned;
     the one-step path's density is taken as 1 on the closed interval so the exact finish-time
     density integrates to 1 under quadrature.*
  4. *The three dynamic tabs carry a warm-up W (a post-processing knob, marked `data-post` in the
     markup): it changes which observations a replication yields, never the system simulated, and
     so changing it neither logs nor clears the batch. The harness keeps every committed
     replication's seed and re-derives the batch, and the shown replication, by re-running the
     seeds under the new params. Rows inside the warm-up carry `phase: 'warm'`. On the queue, W is
     minutes and a customer counts if it arrives at or after W and has begun service by T (a
     customer still in the queue at T carries `phase: 'cut'` with null begin, wait, end, and sys,
     and a replication with no counted customer is counted in `noObs` and yields no
     observation, utilization included, so that all three outputs come from the same
     replications), server utilization is measured over [W, T] like the waits rather than over
     the whole run; on the inventory and bearing tabs the run is
     lengthened by W (days, or operating hours) and the 25 days or 20,000 hours after W are
     measured, on a fixed axis of 25 + 10 days or 20,000 + 5,000 hours, and the bearing tab's
     replace-on-failure policy is generated in clock order across the three positions so a
     longer horizon only appends draws. At W = 0 every model is the book's, draw for draw.*
  5. *An output's success region is an interval, and the harness handles all three kinds
     through one path: `success: 'le'` passes up to the threshold, `'ge'` from it up, and
     `'band'` between a `{ lo, hi }` pair, which is then the shape of that output's `thr`
     entry and so must be cloned rather than shared when a batch is logged. A band output
     also declares `thrIdHi` for its second spinner. The band is general on purpose but is
     used in exactly one place, the queue's server utilization, because every other output
     in the widget has only one end worth stating.)*

### Pseudorandom Number Generation

- `prng/prng_explorer.html` *(seven tabs: ① the LCG with step-by-step arithmetic and uniformity
  and independence testing, ② combined LCGs, ③ MRGs & MRG32k3a, and a bracketed "Watermarking
  randomness" group ④–⑦ that builds from implicit parameter fingerprints through keyed
  re-seeding to SynthID-style tournament sampling, ending in a tiny embedded Markov model that
  writes marked prose and reads the mark back through a twenty-one-key detector lineup. Conventions
  relied on by code outside the file, which any later edit has to preserve:*
  1. *Everything between the `PRNG-CORE-BEGIN` / `PRNG-CORE-END` sentinels is pure numerics with
     no DOM access, and the sentinel block must not even contain the words "window" or "document"
     -- the Markov training corpus lives inside it, so corpus edits must avoid those words.
     `prng/verify_prng_explorer.mjs` slices that block out of the HTML and runs it in Node.*
  2. *`verify_prng_explorer.mjs` is not shipped with the widget and is not linked from the site.
     Run it (`node prng/verify_prng_explorer.mjs`; `PRNG_QUICK=1` skips the direct 2.1-billion-step
     walk of the minimal standard's full cycle, and `PRNG_CALIB_REPS` shortens the calibration
     sections) after touching anything in the core. It checks LCG and MRG reference vectors
     computed independently with Python big integers, Hull--Dobell verdicts against brute-forced
     periods, special functions against exact identities, chi-square and K-S calibration on
     known-good generators, exact re-seeding prediction, tournament distribution preservation
     with detector calibration, and the Markov section's corpus pins, grammar guards, forced-
     fraction gradient, and detection strength.*
  3. *The Markov chain's grammar guarantees rest on corpus discipline plus three state bits, not
     smoothing: no sentence-opening bigram is ever a sentence-ending bigram, every clause carries
     a verb, every comma-requiring opener gets its comma before its period, and the chain's state
     tracks all three empirically. The corpus token and vocabulary counts are pinned in the verify
     script, and so any corpus edit must update them and re-run the Markov checks.)*

### Input Modeling

- `input_modeling/input_analyzer.html` *(a replacement for and extension of Arena's Input Analyzer:
  two tabs, one fitting fourteen candidate distributions to a pasted sample and one estimating a
  piecewise-constant arrival rate from timestamps. Every plot card carries a row of SVG, PNG, M,
  R, and PY buttons above the plot: the `Plot` builder records each mark it draws as data, files
  the result under the plot's title in `PLOT_SPECS`, and the `FIG_SCRIPTS` block writes a MATLAB,
  R, or Python script that redraws the plot from that data. That block is a copy of
  `output_analysis/output_analyzer/js/io/scripts.js` with the exports removed and the
  application's name changed, and so a change to the writers is made in the module first and
  copied here. The plot itself is a probe (`armProbe`): the pointer over it, or a tap on it, draws
  a crosshair with dashed projections onto both axes and the value at each, four significant
  figures, and a tap elsewhere takes a finger-placed probe away. Two conventions in this file are relied on by
  code outside it, and any later edit has to preserve them:*
  1. *Everything between the `IA-CORE-BEGIN` / `IA-CORE-END` sentinels is pure numerics with no DOM
     access. `input_modeling/verify_input_analyzer.mjs` slices that block out of the HTML and runs
     it in Node, and the bootstrap Web Worker is built from the same `<script id="ia-core">`
     element's text. Moving the sentinels, or reaching for `document` inside them, breaks both.*
  2. *`verify_input_analyzer.mjs` is not shipped with the widget and is not linked from the site. Run
     it (`node input_modeling/verify_input_analyzer.mjs`, about seven minutes) after touching
     anything in the core; it checks the special functions against exact identities, recovers known
     parameters for every distribution, and measures the bootstrap's rejection rate under a true
     null, confirms that the classical K-S and A-D p-values are correctly calibrated when the
     parameters are fixed and far too permissive when they are estimated, and measures the
     chi-square rejection rate under both degrees-of-freedom conventions. `IA_CALIB_REPS` and
     `IA_CALIB_B` shorten the slow calibration sections.*
  3. *Two parameter counts are deliberate and must not be collapsed into one. `fit.k` counts every
     quantity estimated from the data and drives AIC and BIC; `regularCount(fit)` excludes
     parameters that are extreme order statistics -- a uniform's endpoints, a beta's interval, a
     shift that converged onto the sample minimum -- and is what the chi-square degrees of freedom
     subtract. The verification measures both: on uniform data the order-statistic count rejects at
     4.0% against a nominal 5%, and subtracting everything rejects at 11.5%.)*
- `input_modeling/prob_models.html` *(a gallery of nineteen input-modeling distributions, one per
  tab, each with a live pdf or pmf and cdf plot against three labeled reference settings, formulas
  and moments, choose-it-when prose, related-distribution jump links, and an animated
  inverse-transform generator; ten tabs add a second panel constructing the same draw from simpler
  pieces (a sum of exponentials for Erlang, the Box–Muller spinner for the normal, two normals
  arriving from the plane's edges for the Rayleigh, a transfer map from a standard normal to its
  square for chi-square and from a normal to its exponential for the log-normal, and, for Student's
  t and for the F, two independent inputs meeting at a point on axes drawn to one scale, so that the
  draw is the slope of the ray from the origin – Z over S/σ = √(V/ν) for the t, V₁/d₁ over V₂/d₂
  for the F – and so on). Chi-square, F, and t are not chosen as input models: they share the
  "Common use in statistical applications" heading in place of the other tabs' "Common use in
  stochastic models", and each carries a "Statistical application" card between its plots and its
  formulas that derives its statistic in steps, the t's and F's beside contours of the joint density
  their slope is read off, redrawn as the parameters move. Every panel's draw summary is a table of
  the mean and sd with 95% intervals beside the distribution's own, drawn in full before the first
  draw with dashes in the estimate cells,
  plus a goodness-of-fit test against the distribution at its known parameters (Kolmogorov–Smirnov
  for a continuous tab, chi-square for a discrete one). Green marks a draw's input and orange its
  output wherever the two are drawn apart. Navigation is a pill picker standing above every page in two
  groups, continuous and discrete, each pill carrying its distribution's support and a colored edge
  marking its group, and collapsing to a `<select>` below 61em. A Map tab holds a thumbnail tile per
  distribution, grouped by the modeling question each answers, and four family-relationship diagrams
  -- shown together, unlinked, on the Map, and singly with the current tab's own node highlighted on
  each tab that belongs to one -- draw how the distributions are built from each other. Conventions
  relied on by code outside the file, which any later edit has to preserve:*
  1. *Every axis is fixed at design time, with each knob's range capped so that even at the most
     extreme reachable setting, the true curve keeps under about 5% of its mass outside the frame,
     and each frame is sized to the three reference settings a reader compares against rather than
     to the widest reachable knob corner. A pmf is drawn as stems standing on the integers, never as
     a curve or as bars; a sample is drawn as bars.*
  2. *Everything between the `DG-CORE-BEGIN` / `DG-CORE-END` sentinels is pure numerics with no DOM
     access, and the block must not contain the words "window" or "document".
     `input_modeling/verify_prob_models.mjs` slices that block out of the HTML and runs it in Node.*
  3. *`verify_prob_models.mjs` is not shipped with the widget and is not linked from the site. Run it
     (`node input_modeling/verify_prob_models.mjs`; about ten minutes at the default
     `DG_CALIB_REPS` of 200, and about two at 40) after touching anything in the core. It checks the special functions
     against exact identities, every pdf against quadrature of its own cdf and every quantile as its
     round trip, every sampler against its own cdf by goodness of fit, moments against closed forms,
     the chi-square and F constructions against sums and ratios of standard normals, every "built
     from other distributions" panel's construction against its distribution's own direct sampler,
     every closed-form generator recipe against the core's own quantile, and the goodness-of-fit
     tests' calibration (rejection rate near 5% on the distribution's own draws, and well above it
     on draws from a different one).)*

### Output Analysis

- `power_analysis/power_explorer.html` *(statistical power taught by simulation: six tabs – a
  null-vs-alternative explorer over a registry of nine tests (z, t, pooled two-sample t at any
  group-size ratio, Welch's two-sample t, variance, proportion, chi-square GOF, one-way ANOVA,
  regression slope) with a Monte Carlo engine and solve-for-power/solve-for-n in both directions,
  power curves, an OC chart tab that carries its own test, α, sidedness, and chart-shaping inputs
  (independent of tabs ① and ②, which share one set of settings), a paired-comparison/pilot-data tab, an advanced tab whose
  gamma-regression demo runs the same engine with no analytic overlay and which ends with a
  three-language (MATLAB/R/Python) Monte Carlo power-analysis template held in inert
  `<script type="text/plain">` blocks, and a Pooled vs. Welch tab, opened by a short section on
  the power implications of each test's assumptions, that decides the same simulated datasets
  with both two-sample tests: it draws one dataset as rugs under the two populations, each test's
  null and alternative statistics as back-to-back histograms split by the replication's own
  decision (the four cells of the confusion matrix), and sweeps both tests' actual α and power
  across the ratio of the two standard deviations, with an option to hold the total sample fixed
  as the split changes. Commit tag `power`. Conventions relied on by code outside the file,
  which any later edit has to preserve:*
  1. *Everything between the `PA-CORE-BEGIN` / `PA-CORE-END` sentinels is pure numerics with no DOM
     access. `power_analysis/verify_power_explorer.mjs` slices that block out of the HTML and runs
     it in Node, and the Monte Carlo Web Worker is built from the same `<script id="pa-core">`
     element's text. Moving the sentinels, or reaching for `document` inside them, breaks both.*
  2. *`verify_power_explorer.mjs` is not shipped with the widget and is not linked from the site.
     Run it (`node power_analysis/verify_power_explorer.mjs`, about three minutes when MATLAB is
     present, most of it MATLAB's cold start; `PA_MC_M` shortens the Monte Carlo sections) after
     touching anything in the core. It checks the special functions
     against exact identities, the noncentral t/chi-square/F CDFs against R-derived references
     (noncentral F against Poisson mixtures of central beta CDFs, because R's own `pf(ncp)` is only
     accurate to ~1e-9), power-at-zero-effect = α for every test and sidedness, Monte Carlo vs
     analytic power across a grid, solve-for-n round trips, and — when `Rscript` is on the PATH —
     re-runs the export panel's R formulas in R and compares. Its final section slices the
     Monte Carlo template out of those text/plain blocks verbatim and runs it in R, Python,
     and MATLAB (each skipped when absent), and so template edits must keep the worked example's
     α̂ near 0.05 and its power near the exact 0.5645.*
  3. *Three statistical conventions are deliberate. Two-sided t and z power is the exact
     both-rejection-tails quantity, so R's `power.t.test` matches only with `strict = TRUE`, which
     the export snippets therefore carry. The proportion test is the equal-tail exact binomial,
     whose power is genuinely non-monotone in n; the sawtooth and the two solve-for-n answers
     ("first n" and "stable n") are the point, not a bug. And the chi-square GOF analytic curve is
     the large-n noncentral-χ² approximation on purpose, with the gap against the simulated
     histogram surfaced in the UI as a teaching point.*
  4. *The two-sample tests share one sizing rule: n is group A's size and group B has
     `groupB(n, p)` = max(2, round(r·n)) observations, halves rounding up. The export snippets
     write that rule out as a formula for any split but r = 1, with `floor(r*nA + 0.5)` in R and
     Python (whose `round` sends halves to even); MATLAB's `sampsizepwr(..., 'Ratio', r)` is not
     used there, because it leaves r·n unrounded. Welch's effect is standardized by the root mean
     square of the two standard deviations, so that it is Cohen's d when they are equal and the two
     tests share one axis. Welch's analytic power is the noncentral-t approximation at the
     Welch–Satterthwaite df the true standard deviations imply (its `approxNote` makes the page say
     "approximate" wherever it would say "exact"), and its Monte Carlo decides each dataset at that
     dataset's own df through the registry's optional `reject` hook, which is why `mcRun` records
     each alternative replication's decision (`rejFlags`) for the convergence trace instead of
     re-deriving it from the statistic. The comparison tab's `cmpRun` draws exactly the datasets the
     one-test engine draws at the same seed, which the verify script checks count for count; its
     headline run also keeps every statistic and every decision (Welch's decisions cannot be
     re-derived from its statistic) plus the first dataset, and keeping them changes no count.*
  5. *The samplers' normal draws go through `normInvSample`, Acklam's approximation without
     `normInv`'s erfc refinement (relative error under 1.2e-9, pinned by the verify script); the
     refinement made each draw about thirty times slower. `normInv` itself keeps it, because shown
     quantiles and critical values are printed to full precision.)*
- `output_analysis/ci_explorer.html` *(confidence intervals taught by experiment: tab ① draws n
  values from N(μ, σ²), forms the t interval, and keeps a history whose true-mean line steps when μ
  changes; tabs ②–④ apply common random numbers, antithetic variates, and control variates to a
  shared five-model menu (the identity, exp(u), √u, 1/(1 + u), and the bowl) whose exact moments the
  verify script pins, each as a plain history over an improved one on a shared scale; tab ⑤ applies
  importance sampling to a normal input through its own three-model menu (x, exp(x), and x²), with
  the threshold on the output scale, the shift aimed at the input threshold, and closed-form tail
  probabilities. Conventions relied on by code outside the file, which any later edit has to
  preserve:*
  1. *Everything between the `CI-CORE-BEGIN` / `CI-CORE-END` sentinels is pure numerics with no DOM
     access (the block must not contain the words "window" or "document").
     `output_analysis/verify_ci_explorer.mjs` slices that block out of the HTML and runs it in Node.*
  2. *`verify_ci_explorer.mjs` is not shipped with the widget and is not linked from the site. Run
     it (`node output_analysis/verify_ci_explorer.mjs`, about three and a half minutes;
     `CI_CALIB_REPS` shortens the calibration sections) after touching anything in the core. It
     checks the special functions against exact identities and t tables, capture rates against
     1 − α for every tab, the paired-to-Welch half-width ratio against √(1 − ρ), the function menu's
     moments against their closed forms (the exp(u) pair-mean standard error of 0.0028 and c* of
     1.690), the importance-sampling estimator's unbiasedness, and tab ⑤'s output densities:
     it integrates each to 1, checks its tail mass beyond T against the closed-form truth, and pins
     the x² model's silent-failure numbers (a weighted estimate at half the truth, near-zero
     capture, and a healthy ESS that gives no warning).*
  3. *The function menu shared by tabs ②–④ carries exact moments (`mean`, `m2`, `cross`, `covU`)
     that the verify script pins, and so adding a function means deriving its four moments, not
     only its formula. The `bowl` entry is the deliberate counterexample on which neither
     technique helps and must stay non-monotone with zero covariance.)*
- `output_analysis/multiple_comparisons.html` *(the multiple-comparisons problem taught by
  simulation: seven pages share one family-drawing engine over K simulated designs
  of one system, each replicated R times, with bigger is better as the default direction and every
  page's controls split into what the experimenter chooses and what is true of the designs but
  hidden. Navigation is the grouped pill picker (as in the distribution gallery), the seven pages
  in two groups, "The multiple comparisons problem" and "One-shot and sequential alternatives",
  collapsing to a select on narrow screens, with page ① the landing page and the shared situation
  stated once in the header's subtitle. ① One Design Against K Requirements simulates
  the null, one design judged on K responses each with its true mean exactly at its own target (one
  small panel per response, on its own scale in its own units), so every flag
  is a false alarm, and tracks the family-wise error rate against the uncorrected and
  Bonferroni-corrected bounds, naming Hotelling's T² and MANOVA as the one-shot versions; ② Designs Against Each Other runs the same test against a benchmark design or over
  every pair, with common random numbers optional; ③ Power Under Correction plants a real difference
  and judges the same raw p-values three ways at once (none, Bonferroni, and Holm's step-down) to
  show the power Bonferroni gives up and Holm partly recovers, with the interval width ratio as a
  card; ④ Reporting the Winner reports the ordinary interval of whichever design's sample mean is
  best and shows its coverage falling below its nominal level; ⑤ ANOVA and Post Hoc Tests runs
  one-way ANOVA and judges every pair by Tukey's HSD, Fisher's protected LSD, and Bonferroni side
  by side, with a compact-letter display, a pairwise matrix sized to the means plot beside it, and a
  toggle to order the designs by sample mean; and ⑥ Selecting the Best in Two Stages animates the
  textbook's ranking-and-selection procedure stage by stage: a first-stage screen, second-stage
  sizing from Rinott's constant, the added replications, and the final selection; and ⑦ Simulation
  Optimization closes the arc with no simulated data: a stepped flowchart of the adaptive
  search loop (propose, simulate, estimate, judge, update, report), the metaheuristic and
  response-surface families that drive it, where ranking and selection fits inside it, and what
  the noise does to a reported best. Every history
  strip names what a column counts and its caption carries the family-level tally with its
  reference. Commit tag `compare`. Conventions relied on by code outside the file, which any later
  edit has to preserve:*
  1. *Everything between the `MCP-CORE-BEGIN` / `MCP-CORE-END` sentinels is pure numerics with no
     DOM access, and the block must not contain the words "window" or "document".
     `output_analysis/verify_multiple_comparisons.mjs` slices that block out of the HTML and runs
     it in Node.*
  2. *`verify_multiple_comparisons.mjs` is not shipped with the widget and is not linked from the
     site. Run it (`node output_analysis/verify_multiple_comparisons.mjs`, about two and a half
     minutes at the default `MCP_CALIB_REPS` of 4000) after touching anything in the core. It checks
     the special functions, the noncentral t distribution, the studentized range, and Rinott's
     constant against exact identities and the book's own tables; the one-sample family's
     family-wise error rate and joint coverage under the global null; the pairwise family's
     Bonferroni family-wise error and per-interval capture in the benchmark and all-pairs modes,
     paired and unpaired, and that pairing under common random numbers narrows the interval; the
     three correction rules' power and family-wise error against their noncentral-t and
     Holm-threshold references; the winner's known-σ coverage, its Bonferroni-level coverage, and
     its selection bias against σ/√R · E[max of K]; the compact letter display against brute force
     and the three post-hoc rules' family-wise error and power under the full and a partial null;
     and the two-stage procedure against the textbook's own worked example (the screening t, Table
     12.4's W matrix, the survivors, and the rounded second-stage sizes) and its 1 − α
     correct-selection guarantee across four (K, R₀, confidence) settings.*
  3. *A knob is a sampling knob (K, R, σ, δ, α, the configuration, and whatever else changes which
     data would be drawn) or a post-processing knob, marked `data-post` in the markup (the
     interval level on tabs ①, ②, and ④, the correction rule on tab ③, and the
     post-hoc rule and the sort-by-mean toggle on tab ⑤): a post-processing change re-derives every already-drawn family from
     its own stored seed and sampling parameters rather than drawing new data, and so it neither
     logs a new run nor clears the history. A sampling-knob change instead opens a new segment on
     the next run, marked with a divider; every plot's axis is sized once from that segment's own
     sampling parameters and held fixed for every run added to it, rather than being fixed globally
     or recomputed run by run.*
  4. *The compact letter display (tab ⑤) is the maximal windows of the sorted sample means whose
     spread stays within the selected rule's critical difference: designs sharing a letter are not
     declared different from one another under that rule, and a window nested entirely inside an
     already-recorded one adds no letter of its own.*
  5. *Tab ⑥'s procedure is the textbook's own (Banks, Carson, Nelson, and Nicol, 5th ed., section
     12.2.2): Rinott's constant is found by solving Rinott's integral numerically rather than by a
     lookup table, and is pinned against both Table A.12 and the book's own worked example. `dir`
     ('min' or 'max') sets which sample mean is better; a `cfg` other than all-equal moves one
     design (`one`), two together (`two`, where offered), or fans every design out in equal steps
     (`spread`), by `delta` in the direction `dir` favors, and locking δ to ε on tab ⑥'s `one`
     configuration puts the 1 − α guarantee at its hardest point. The strip's current column stays
     in the history mid-Step (`pending`, not yet resolved) so the column count and the axis never
     change once the run's outcome is revealed, but its own bar is drawn only once stage 4 reveals
     whether the selection was correct.)*

- `output_analysis/output_analyzer/output_analyzer.html` *(the Output Analyzer: a browser replacement for the
  output-analysis utility bundled with a commercial simulation package, and for the comparison and
  best-scenario parts of its process analyzer, built as one entry page plus native ES modules under
  its `js/` directory with no build step. Nine pages behind a four-group navigation (Data, Analysis, Session, More information) that is a sticky left sidebar at 1100px and
  wider, a bracketed one-line tab strip down to 700px (the Canvas column), and a `<select>` below:
  three pages (② Summary and Plots, ⑤ Several Systems, ⑦ Steady State) carry a second level of
  sub-sections shown one at a time, routed as `#several/anova` and listed under the page in the
  sidebar and indented in the select; a section the shown dataset cannot fill is left out of the
  page's own strip and grayed in the sidebar and the select with a tooltip saying what the data
  lack: ① Import
  (loaded datasets first, then the bundled examples, then drag-and-drop, file, and paste; time–value records with a −1 replication
  delimiter, delimited columns with a mapping dialog that asks tally versus time-persistent rather
  than guessing, wide files with a response picker, a scenario column splitting into one dataset per
  design; every rejected row listed with its line number; and the binary `.dat` files Arena
  writes for its Output Analyzer, and the `.flt` and `.fst` files that analyzer writes, read by
  `js/io/arena.js` without a dialog because their header names the statistic and its kind,
  each treated as the Output Analyzer treats it: 201 time-persistent, 207 frequency, and 206
  counter all as a step function with no dataset end time, so each replication's last record
  (Arena's closing record, or a counter's last increment) holds for no time and every time
  average runs over that replication's own run, the counter starting at 0 from time 0 and a
  counter whose count falls getting a note that a warm-up period cleared it there; 203 tally
  and 205 (the Analyzer's batch means or moving average) as timed observations; 204 as one
  value per replication; a counter also loads a second dataset of final counts, labeled as the
  page's own summary; the zero-filled tail the Analyzer's Batch/Truncate writes with every
  replication selected is read as padding, not data; and a table of the loaded datasets, described
  below), ② Summary and Plots (descriptives, a raw table that
  for time-persistent data can instead sample the state on a time grid with the replications side
  by side (`sampleDataset` in `js/data/model.js`, blank where nothing holds, with its own CSV), nine plot types offered only where meaningful for the data's kind, among them a lag plot at
  a chosen lag k beside a correlogram to 400 lags with lag k highlighted, the lag set by a slider,
  a spinner, or a tap on a stem, and a Normality section
  with the normal quantile–quantile plot and the Shapiro–Wilk test of the replication outcomes, the
  test withheld on pooled observations because they are not independent, and an Equal variances
  section running Levene's test across a checklist of loaded datasets, whose ticks stand as the
  reader leaves them, even at one or none, with a line saying the test needs two or more
  (`initialTicks` in `js/ui/rules.js`)), ③ One System (the
  absolute analysis: t interval on one system's replication outcomes, or the Wilcoxon signed-rank
  interval on the pseudo-median behind a Procedure switch, the pooled-observations override behind
  a warning, and a "How many replications" card by target half-width or by target power of the
  one-sample t test, and the chi-square interval on the variance), ④ Two Systems (the relative analysis: Welch by default, with the
  pooled-variance t as a Procedure choice whose checks line adds Levene's test; paired
  only when the reader says so, matched on replication id or position with unmatched replications
  listed, the choice fixed by how the replications were run and never by the data; a Procedure
  switch to the Wilcoxon rank-sum or signed-rank test with the Hodges–Lehmann estimate and its
  interval; in paired mode the differences strip plus a switchable pair view, by replication with
  filled A and hollow B joined per pair, or as slopes between two columns; replications per design
  by half-width on the difference or by power), ⑤ Several Systems
  ("Benchmark comparison", Bonferroni simultaneous means with an optional benchmark drawn as a
  draggable line that declares each design above or below it when its interval excludes it, and
  "Pairwise comparisons", Bonferroni differences, all pairs or versus a control, the sections
  titled by the question asked rather than by the correction, each with a
  "How many replications" card at its foot sized by a target half-width, as the ANOVA section has
  one sized by the F test's target power (under Welch's analysis, that plan still takes σ and the
  grand mean from the ordinary one-way analysis, and the card says it assumes a common σ; the
  scripts do the same), the rank procedures taking the t plan inflated by π/3;
  one-way ANOVA opened by
  Levene's test of equal variances (Brown–Forsythe, median-centered), with Tukey–Kramer, protected
  LSD, Bonferroni, and Dunnett post-hoc tests and a compact letter display carried on a
  design-level plot with letters and brackets for the pairs declared different, designs and pairs
  numbered 1…k throughout, and a Variances switch whose unequal setting runs Welch's analysis of
  variance with Games–Howell or Bonferroni-on-Welch-pairs post-hoc rules (withheld under pairing,
  which has no Welch form); a page-wide Procedure switch whose nonparametric setting turns the
  Bonferroni means and differences into Wilcoxon intervals on pseudo-medians and shifts and the
  analysis section into the Kruskal–Wallis test (Friedman under pairing) with Dunn's or Friedman's
  pairwise comparisons under Bonferroni or Holm, drawn as each design's Hodges–Lehmann pseudo-median
  with its Wilcoxon interval and the letters; and "Screen for the best", the textbook's subset-selection
  screen with indifference zone ε (its control lives in this section, since nothing else uses it)
  and Rinott second-stage sizes, drawn as the design plot with the
  survivors in color and the eliminated designs muted; a "Replications are" switch, independent by
  default, declares that replication i of every design shared its random inputs, whereupon the
  replications are matched into blocks by id or by position, the Bonferroni differences become
  paired t intervals, the analysis of variance blocks on the replication (its own row in the
  table, the post-hoc rules on the residual mean square), Friedman's test with Siegel–Castellan
  pairwise comparisons replaces Kruskal–Wallis and Dunn, and planning works on the paired
  differences and the blocked F test), ⑥ Steady
  State (Welch moving-average warm-up plot, the ensemble average across replications aligned by
  time bins (the default wherever the data carry time stamps, since a warm-up period is set in
  simulation software as a time) or by observation index, with a draggable cut that is never
  computed for the reader and the excluded stretch shaded; "Save truncated set" producing a derived
  dataset, which the page then shows as the run it came from with a fence at the saved cut
  (`truncationView` in `js/data/model.js`), so that the fence can be moved back or forward and saved
  again, always cutting the original run, and Summary and Plots' Within a run section draws that
  deleted stretch gray behind the fence; a correlogram of the truncated series with
  the batch size marked, to choose a batch length that spans several correlation lengths; and batch
  means on one replication or on all replications concatenated, by observation count or by
  time-weighted time intervals with Fishman's lag-one test),
  ⑦ Report (the loaded datasets and every page's latest result on one page, each under the
  choices that produced it, with Print, Copy as text, and one combined CSV of every table), and
  ⑧ Storage (what localStorage holds between visits, and "Forget this session"), and ⑨ References
  (the sources behind every page, grouped by page, with the simulation package's own textbook
  under "Simulation software"; the only place a book or paper is named, so that no page text
  ever calls anything "the textbook"). The former Variance and Correlation page is retired: the
  chi-square interval on one system's variance is an "Interval on the variance" section of One
  System, the F ratio of two variances a "Variances of A and B" section of Two Systems
  (independent mode), and the correlation lives only in Two Systems' paired Correlation r card;
  the hash `#variance` lands on One System. Each row of the Import page's table of loaded datasets
  has a name box, which renames the dataset when focus leaves it or on Enter (Enter keeps focus in
  the box), and an Export control revealing that dataset's data files, drawn by `fileButtons` in
  `js/ui/exportrow.js` as the export rows' are. "Export all" below the table writes two files,
  through `datasetsObservationsCsv` and `datasetsReplicationsCsv` in `js/io/export.js`.
  `datasets_observations.csv` holds every record under `dataset`, `replication`, `time` (present
  when any dataset has time stamps), and `value`. `datasets_replications.csv` holds one row per
  replication under `dataset`, `kind`, `replication`, `n_obs`, and `mean`, the header one
  dataset's own replication summary uses, and a `# mean (<kind>)` line for each kind present says
  what that mean is (`ESTIMATE_LABEL`, beside `KIND_LABEL` in `js/data/model.js`). Both files
  always quote the `dataset` field because the importer also splits cells on spaces, tabs, and
  semicolons. The observations file reads back in through the delimited path with `dataset` as a
  scenario column, one dataset per name, each named `<file> · <name>` with the response `value`.
  The page promises that round trip only for datasets of one kind that all have, or all lack,
  time stamps (the importer drops blank cells) and, when time-persistent, share one end time (the
  importer applies one end time to the whole file), and it says that a replication with no
  records does not come back. A name with leading or trailing spaces comes back because the
  field is quoted; an empty name or one holding a line break does not, as
  `datasetsObservationsCsv`'s JSDoc explains. Every data file of a time-persistent dataset states
  its end time, or "none", in its provenance (`dsProvenance`). Exporting is otherwise per page:
  every analysis page ends in an export row (`installExportRow` in
  `js/ui/exportrow.js`) offering that page's result tables as CSV with `#` provenance lines and a
  "Print this page" button, Summary and Plots adds the shown dataset's data files (observations,
  one-column observations, replication summary, and a pilot-ready single column the Power
  Explorer's pilot box reads as pasted), and Two Systems adds the paired pilot of A and B. Every
  analysis page's export row also offers "Regenerate these results in" MATLAB, Base R, Tidy R, and
  Python: a script holding the data the page analyzed (replication outcomes on the inference pages,
  the run's records on Steady State and Summary and Plots), every choice made on the page, and code
  that recomputes every number shown and prints each beside the analyzer's own value. The scripts
  call each language's own procedure where it has one and carry a short function where it has none.
  In every language, they write out the Hodges–Lehmann estimates, Games–Howell, Rinott's constant,
  Fishman's test, the time-weighted averages, the compact letter display, and the replication-count
  searches. Outside R, they also write out the Wilcoxon intervals, Welch's analysis of variance, and
  Friedman's test, and Dunnett's critical value is written out everywhere but in SciPy on an
  unblocked design. Tidy R prints the same report lines as Base R through a tidyverse layer: the
  data as a tibble beside the vectors, the descriptives through dplyr, each test object through
  `broom::tidy()`, and ggplot2 for the three figures the scripts draw (the design intervals on
  Several Systems, the batch means on Steady State, and the histogram and quantile–quantile plot on
  Summary and Plots), which the other scripts draw with base graphics, Matplotlib, and MATLAB's own
  plotting. The files are `<title>-analysis.R`, `<title>-analysis-tidy.R`, `<title>-analysis.py`,
  and `<title>_analysis.m`. Each script also shows, in comments after its data, the lines that
  read the same data from the CSV files the Import page's Export saves. Where the data run
  past 200,000 numbers, which Steady State, Summary and Plots, and One System's pooled override
  can reach, the four buttons write scripts that embed no data and run those lines instead, a Data
  button beside them saves each file a script reads, and a note says to keep the files in the
  script's folder. The print stylesheet hides the navigation, the dataset strip, the
  figure toolbars, and the export rows, so printing any page prints what it shows. The confidence
  level is one shared setting with a "Custom…" entry (a stated level and a Bonferroni count C,
  applied per interval everywhere; Several Systems reads the stated level, `state.settings.base`,
  because it divides α by its own family sizes), and every parametric result carries a checks line
  from `js/ui/checks.js` (Shapiro–Wilk on what the procedure takes as normal, Levene's test where a
  variance is pooled; flags only, never gates, and a line whose checks all pass says so with a check
  badge). Every figure carries five download buttons: SVG, PNG, and M, R, and PY, the last three
  being scripts (MATLAB, base-graphics R, matplotlib Python) that redraw the figure from the data
  embedded in them; the images and the R and Python scripts share one hyphenated file name, and the
  MATLAB script takes the underscored identifier its language requires. Commit tag `oa`. Conventions
  relied on by code outside the page, which any later edit has to preserve:*
  1. *The `js/` files are the source, and the page embeds a copy of every one of them between its
     `OA-MODULES-BEGIN` / `OA-MODULES-END` markers as `<script type="text/plain" data-module>`
     blocks, which the loader after the end marker turns into blob-URL modules with their relative
     imports rewritten, so the page needs no fetch and opens from `file://`. After editing any
     module, run `node output_analysis/output_analyzer/inline_modules.mjs` to refresh the page;
     `test/inline.test.mjs` fails while the page is stale. Never edit the embedded copies by hand,
     and never put `<script`, `</script`, or `<!--` inside a module (the inliner refuses them).*
  2. *`js/stats/*` (including `nonparam.js`, whose Wilcoxon procedures use the exact distributions
     on untied samples under 50 and the classical normal approximation otherwise, where R 4.4 and
     later compute an exact permutation distribution instead), `js/io/parse.js`, `js/io/arena.js`,
     `js/io/scripts.js`, `js/io/recipes.js`, `js/io/analysis_scripts.js`, `js/io/script_lib.js`,
     `js/ui/format.js`, `js/ui/rules.js`, and `js/data/model.js` are pure modules
     with no DOM access and must not contain the words "window" or "document";
     `node --test output_analysis/output_analyzer/test/` imports them directly (about thirty
     seconds, nearly all of it convention 11's smoke runs of the regenerate scripts in R, Tidy R,
     and Python; the other test files take about a second once matplotlib's font cache is warm). Run
     it after touching any of them. `test/scripts.test.mjs` also runs a generated R script under
     `Rscript` and a Python one under matplotlib when those are installed, and skips them otherwise;
     the MATLAB script is not run by the tests, and so after changing `js/io/scripts.js` run one
     through MATLAB (`matlab -batch`) as well. Small rules the pages apply live in `js/ui/rules.js`
     (`initialTicks` and `fRatioVerdict`), which `test/page_rules.test.mjs` tests, and so no test
     imports a page module. A page module, and every module it imports, still touches the DOM,
     `window`, or `localStorage` only when called, never at the top level as it loads.*
  3. *Every expected value in `test/` comes from the R scripts in `test/reference/`, which print the
     JSON beside them; regenerate a JSON only by re-running its R script. Dunnett's critical values
     are pinned against both a Monte Carlo and a nested `integrate`/`uniroot` solution in R; Rinott's
     constant against Table A.12 of Banks, Carson, Nelson, and Nicol; the lag-one test's calibration
     against a Monte Carlo under independence; the Shapiro–Wilk test and the quantile–quantile
     pieces against `shapiro.test`, `ppoints`, and `qqline`; Levene's test against a by-hand
     `anova(lm(abs(y − median) ~ g))`; the Wilcoxon procedures against `wilcox.test` with
     `conf.int = TRUE` (`exact = FALSE` on the tied samples); Kruskal–Wallis against `kruskal.test`
     and Dunn's z tests against a by-hand base-R computation with `p.adjust`; the blocked ANOVA
     against `aov(y ~ g + block)` with `TukeyHSD`, the paired Bonferroni family against paired
     `t.test`, Friedman against `friedman.test`, the blocked F power against `pf`, Welch's
     analysis of variance against `oneway.test(var.equal = FALSE)`, and Games–Howell against a
     by-hand `ptukey`/`qtukey` computation on each pair's Welch degrees of freedom. On one to three
     degrees of freedom, the Tukey and Dunnett quantiles and Rinott's constant are pinned against
     a nested `integrate`/`uniroot` solution in `lowdf.R`, not R's own `qtukey`, which is about 1%
     off at 2, and against exact identities in `special.test.mjs` (Tukey's q with two designs is
     √2 times a t quantile, and Dunnett's with one comparison is a t quantile). Convention 12's
     degenerate cases are pinned against `flat.R`, which writes out by hand what `t.test` stops on
     and keeps `aov`'s raw F beside the rule's.*
  4. *The `arena/` directory holds the `.dat` format as it was read off files from Arena 16.20
     (`arena_dat_format.md`), what the Output Analyzer itself does with counters, replications of
     unequal length, warm-up periods, re-runs, its own `.flt`/`.fst` files, and its Classical CI
     and Moving Average (`arena_output_analyzer_behavior.md`, `arena_dat_followup_experiments.md`;
     its moving average is a trailing forecast, not a Welch window), a standard-library Python
     reference parser (`arena_dat.py`), and in `samples/` the files those were checked against,
     written by a deterministic model whose every value is known: `equal20/` (three 20-minute
     replications, with the Analyzer's batch, truncated-batch, observation-batch, moving-average,
     and malformed all-replications files), `unequal/` (replications ending at 10, 20, and 30,
     with the Analyzer's lumped `.flt`, an artifact kept as a fixture), and `warmup5/` (a 5-minute
     warm-up, with a frequency file); `test/arena.test.mjs` reads them and checks the reader
     against the documented values and the Analyzer's own numbers. Nothing in the directory is
     linked from the site.*
  5. *`js/data/examples.js` is generated by `data/generate_examples.mjs` (a seeded M/M/1 simulator)
     and must match `data/*` byte for byte; `test/examples.test.mjs` regenerates and compares, so
     change the generator, never the generated files.*
  6. *In the page text the per-replication number is a "replication outcome" (a "replication
     mean", "replication time average", or "replication value" where the kind is known), never a
     "replication estimate": the outcome is the datum that inference runs across, and the estimate
     is what the inference produces. The code keeps `repEstimates` as its name for the same array.
     With one replication the One System figure draws the one outcome alone, with no mean line.*
  7. *The data model never blurs the three kinds: `tally` (observations within replications),
     `time` (time-persistent state, always duration-weighted; the last record holds until `endTime`
     and otherwise for no time), and `reps` (one value per replication). Every inference page works
     on `repEstimates(ds)`, and a one-replication set is refused by `canInfer` except through the
     explicit override on page ③.*
  8. *Pages register results through `state.setResult(pageId, {title, provenance, tables})`, which
     stamps `computedAt` and which the page's own export row and the Report page read; provenance
     carries every choice that produced the numbers. Every pill but Import and Storage is grayed
     and inert until the loaded datasets meet that page's requirement (`GATES` in `js/main.js`):
     any dataset for ②, ③, and ⑦; two datasets with at least two replication outcomes each
     for ④ and ⑤; a tally or time-persistent dataset for ⑥. The tooltip on a gray item says what
     is missing. Page ids are permanent hash slugs (`import, explore, one, two, several,
     steady, report, storage, references`; the retired `variance` redirects to `one`); ③'s slug is `one`, and a sub-section
     is `page/section` (`several/means|diffs|anova|subset`, `explore/summary|dist|run|reps|
     normality|spread`, `steady/warmup|batch`). The hash carries only the page and section, never a
     setting. A page tells the router which of its sections the shown data cannot fill with
     `setSectionAvailable(page, {section: reason})` from `js/ui/tabs.js`; a link naming such a
     section lands on the page's first available one.*
  9. *Every control's state persists: pages store it with `state.setPick(pageId, key, value)`
     and read it back with `state.getPick`, the session saves `state.picks` beside the datasets in
     localStorage, and "Forget this session" clears both. `datasetSelect`'s `remember` option does
     this for dataset pickers. A stored value is applied only when valid for the current data.*
  10. *Every mark helper in `js/ui/plots.js`, and every custom drawing in a page, records what it
     drew as data in `fig.series` using the vocabulary documented at the top of `js/io/scripts.js`
     (points, line, step, bars, hline, vline, segments, band, span, rects, text), and a figure
     drawn as rows calls `recordRows(fig, labels)` so the rows become a categorical axis;
     `figureSpec(fig)` hands that to the three script writers behind the M, R, and PY buttons. A
     new mark or a new custom drawing must record its series too, or its scripts come out empty.
     The Input Analyzer carries a copy of the writers (see its entry), which a change here is
     copied into.*
  11. *The regenerate scripts are built from recipes, lazily. A page registers
     `regen: { build, tooBig, files }` in its `state.setResult` object: `build` closes over the
     inputs the page computed with (its own title and provenance object included, copied rather than
     reworded) and runs only when a button is pressed, `tooBig` is a cheap count
     (`recordCount(ds) > MAX_NUMBERS` on Steady State, `exploreTooBig` on Summary and Plots,
     `oneTooBig` on One System, which counts only under the pooled override, and false elsewhere),
     and `files` lists the data files the scripts read as `{ ds, form }`, so that the Data
     buttons (`regenDataFiles`, writing through `dataFileText`) work without building the
     recipe. The Report page ignores `regen`. A page control that changes any regenerated
     number has to re-register the result, or the script carries the old settings (on Steady State,
     w and the time bins; on Summary and Plots, the level and the Equal variances checklist). The
     builders in `js/io/recipes.js` (`oneRecipe`, `twoRecipe`, `severalRecipe`, `steadyRecipe`, and
     `exploreRecipe`) run the same `js/stats` functions as the page and record the analyzer's value
     of every reported number in `recipe.expect`; logic the page and a builder share lives in one
     place (`gapAwareAverage`, `ACF_MAX_LAG`, and `ACF_STEPS` in `js/stats/steadystate.js`,
     `timeWeightedOverall` in `js/data/model.js`), never in a copy. Every builder also names the
     data files that hold its data in `recipe.csv` (`{ dataset, file, form, role }` entries, each
     file named by `csvFileName` in `js/io/recipes.js`, which builds, with `slug()` from
     `js/io/export.js`, the names that `datasetFiles` in `js/ui/exportrow.js` writes; on Steady
     State, the source run of a truncated view), and
     `csvReadBlock(L, recipe, { live })` writes the lines that read them. By default, the block is
     commented and follows the embedded data, each read line behind `READ_MARK` (the comment
     character and three spaces, whose removal leaves exactly the live line); in CSV mode,
     `analysisScript(recipe, lang, { csv: true })`, it is live and replaces the data. Past the cap,
     a builder returns a full recipe marked `csvOnly`, with every `expect` value but no data, whose
     scripts are always in CSV mode. In CSV mode, a Summary and Plots script writes out the
     analyzer's per-replication values for the first 1,000 replications only (`REP_LINES_MAX` in
     `js/io/recipes.js`), and the later replications' lines print without an analyzer column.
     `exploreTooBig` counts each replication's id and analyzer values (`repKeys`) and the Levene
     groups along with the records, so that no script embeds more than the cap. The read lines
     define every name the embedded block assigns, take the value column by position (the last)
     because each language rewrites a response header such as `busy servers`, read replication
     ids as text so that `007` stays `007`, drop blank outcomes before any matching by id or
     position, as the pages do, and read records from both files, because only the replication
     summary lists a replication with no records. R reads with
     `read.csv(file, comment.char = "#", colClasses = c(replication = "character"))`; Tidy R wraps
     that in `as_tibble()` and gives the `readr::read_csv` call in a comment, as readr is not a
     dependency; Python uses the standard library's `csv` module through a small `read_csv` helper,
     not `numpy.genfromtxt`, which fills a blank in a column of whole numbers with −1 and fails on a
     text id after numeric ones; and MATLAB calls `readtable` with `detectImportOptions` and
     `setvartype` typing `replication` as a string and every other column as a double (on a file
     with a header and no rows, `readtable` would type them as cells). The data files quote any
     field holding `#` (an id such as `run#1`), because R's `comment.char` ends a line at an
     unquoted one and Python's reader skips a line that starts with one. On Steady State and Summary
     and Plots, `kind` and `end_time` are assigned in the Settings block, so that a CSV-mode script
     has them, and Summary and Plots' Levene groups stay embedded in every mode. The one exception
     is a `csvOnly` script whose Levene groups alone would pass the cap (about 200,000 ticked
     outcomes), which leaves the test out and says why in a comment (`spreadOmitted`).
     `js/io/analysis_scripts.js` assembles each script from the literal snippets in
     `js/io/script_lib.js` (`LIB.py`, `LIB.m`, and `LIB.R`, which both R dialects share); no snippet
     may contain a backtick or `${`, which would end its template literal. Every string bound for a
     script passes through `ascii()`, which keeps every script 7-bit ASCII. R data blocks are
     one-line statements (a long vector is built by appending chunks) because Rscript's parse is
     quadratic in a long expression: a near-cap script took about three minutes as one expression
     and four seconds as statements. Every script prints its results through one `report` helper as
     `name: value   (analyzer: value)` lines, with numbers in `%.10g`, `NaN` for a missing number,
     and yes/no for a flag; the report names are defined by the emitters in
     `js/io/analysis_scripts.js`, pinned by `test/analysis_scripts.test.mjs`, and must stay
     identical and in the same order across the four scripts. Every choice a reader may edit is
     assigned in the script's Settings block; Several Systems' scripts form their pairwise and
     post-hoc comparisons from its `control` and `family` settings at run time and look up the
     analyzer's value for each pair by its label. `test/analysis_scripts.test.mjs` writes each
     fixture's scripts, runs them, and compares every line with `recipe.expect` (the analyzer's own
     values, not convention 3's R references). With no flag, it runs only the fixtures marked
     `smoke: true` (a subset on every page) in Base R, Tidy R, and Python (with SciPy 1.11 or later)
     where they are installed; `OA_SCRIPTS=1` runs every fixture in those three, and `OA_MATLAB=1`
     runs every fixture in MATLAB. The full check sets both flags for that file and takes about
     seven minutes. The R and Python scripts run one at a time, synchronously, and so
     `--test-concurrency=1` changes nothing there. The MATLAB scripts all run in one MATLAB session,
     which `startMatlab()` starts in the background once every test is registered and which overlaps
     the R and Python runs; the header of its driver, `test/run_matlab_batch.m`, says how each
     script runs as it would in a MATLAB of its own and how the harness stops one that hangs. The harness proves the read lines by running them: `checkCsvRead` writes each `recipe.csv` file
     with the Import page's own writers, uncomments the block (`csvModeScript`), and compares every
     report line with `expect`, and `checkCsvMode` does the same for CSV-mode scripts beside files
     written by `dataFileText`, the patterns in `EMBEDDED` confirming that no data remain in them. A
     fixture passes `also: noWarning` to check that no run prints a warning, and a skipped language
     is not a pass after a change to its snippets. The tolerance is
     1e-6 relative, looser only where a routine approximates: 2e-4 on a Wilcoxon interval end under
     the normal approximation (a root found to 1e-4 by a different finder in each language), 1e-5 on
     studentized-range and Dunnett quantiles (5e-5 in R, whose `qtukey` is good to about four digits
     and misses by 1.1e-5 at 3 df), and 2e-3 on SciPy's unblocked `dunnett`, a randomized quadrature
     that the script seeds. On fewer degrees of freedom still, where R's `qtukey` is about 1% or
     more off at 2 and not defined below (it returns NaN with a warning), the R scripts keep R's
     own `qtukey` and `ptukey` from 2 degrees of freedom up and say in a comment that they are
     approximate there; below 2, they leave the critical value, the half-width, and the
     Games–Howell p-value NaN without calling them, declare no pair different, and carry on
     through the letters, the screen, and the plans. A fixture's `notInR` pattern names the keys
     that R and Tidy R print but are not held to; MATLAB takes Tukey's q from the script's own
     `studrange_inv` because `multcompare`'s value is off by 8.4e-5 at 2 df. Built-in tests stop,
     warn, or return NaN on constant data (R's `t.test` stops, and SciPy returns NaN), and on data
     with no spread within groups they report rounding noise; each snippet therefore applies
     convention 12's rules by hand there, and fixtures pin every such case. A new procedure needs
     the same. R's `wilcox.test` is called with `exact` set by the analyzer's rule and
     `correct = TRUE`, and the script computes the estimate, and any interval end the
     approximation cannot reach, by hand. R's Kruskal–Wallis statistic comes from exact tie counts
     because `kruskal.test` counts ties after rounding to 15 digits. The shared R helpers return
     their test object as `$test` (`NULL` where constant data skip the test), and Tidy R prints
     `broom::tidy()` of that object rather than calling the test again; `L.tidy` changes only the
     data block, the descriptives, the printed test objects, and the figures, and a test asserts
     that Tidy R's report lines equal Base R's and that its stderr adds nothing to Base R's
     (`stderrAdded`). Apart from convention 12's rules, building the scripts changed the analyzer
     in one place: `fRatio` gives p = 0
     for an infinite F and NaN for an undefined one, as `var.test` does (pinned in
     `test/intervals.test.mjs`).*
  12. *Degenerate data follow one rule each, in the analyzer and in every script. A sample is
     constant when its minimum equals its maximum (`allEqual` in `js/stats/descriptive.js`), and
     its variance is then exactly 0 in `variance`, in the private copies in `compare.js` and
     `select.js`, and in `steadystate.js`'s centering, so that the t procedures, `fRatio`, the
     screen, the batch means, and the planners need no flatness test of their own; the
     autocorrelation of a constant series is NaN. Paired differences are constant when
     max(d) − min(d) ≤ 8ε · max(|x|, |y|) (`constantDifferences` in `compare.js`): a
     subtraction's rounding error grows with its operands, and so 0.1 − 0.3 and 0.2 − 0.4 differ
     in the last bit. `pairedT` uses the test, and the checks line skips Shapiro–Wilk on such
     differences. In `anova()` and `anovaBlocked()`, and so in `levene()`, a within-group sum of
     squares at most `NO_SPREAD` (1e-24) times the outcomes' Σy² counts as no spread: F is then ∞
     with p = 0 when the between (or block) part exceeds that bound, and NaN when it does not. The
     bound holds only because every residual sum of squares is summed from each value's own
     deviation, never found by subtraction (which leaves error near 1e-16 of Σy²), and Levene's test
     takes its scale from the outcomes, not from their distances to the medians. Pages show an
     infinite statistic as ∞ through `stat()` in `js/ui/format.js`, never as a dash, and the
     result-table CSVs write `Inf` and `-Inf` (`resultField` in `js/io/export.js`), with NaN still
     an empty field and the data files unchanged. On two constant designs, Two Systems' F-ratio
     verdict says that neither varies and so the variances cannot be compared (`fRatioVerdict` in
     `js/ui/rules.js`). The
     studentized-range and Dunnett quantiles and Rinott's constant search an expanding bracket
     (`rootAbove` in `js/stats/special.js`), and their outer integral over s = S/σ runs in
     Gauss–Legendre panels in log s (`chiNodes`), which keeps them accurate down to one degree of
     freedom and gives a first stage of two replications its Rinott h. The scripts compute Rinott's
     constant on the same chi scale, splitting the integral at 1/h and 10/h, and search an expanding
     bracket too.*)

Add each new section here as its first demo lands, following the "Adding a new section" procedure
above.

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
- **fb:app_id:** `2385695445236853` — include in all OG blocks
- **Google Analytics ID:** `G-Y66V2TS0R6` — include the two-line GA4 snippet in every `<head>`, after the Twitter/X card block and before `</head>`
- **GitHub Pages base URL:** `https://tpavlic.github.io/asu-simulating-stochastic-systems/`
- **YouTube channel:** <https://www.youtube.com/@TedPavlic> — linked from the index header
