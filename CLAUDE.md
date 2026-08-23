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

The course framing lives only in the site chrome around the widgets: `index.html`, `README.md`,
this file, and the shared back-link footer. The footer's "All course visualizations" label names
no particular course and stays as is; its iframe-hiding script removes it when the widget is
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
description, OG/Twitter/GA tags) and the back-link footer with its iframe-hiding script, and do not
restructure or restyle anything in between, so a later re-import of the app body does not have to
re-apply your interior edits. This applies to the setup/import path; when the user explicitly asks
you to change the body (for example a footer or layout review pass), that is fine. Otherwise, if the
interior seems to need a change, flag it and ask rather than editing it silently.

When a user asks to add an existing demo to the index/README/CLAUDE.md, **always also audit
the demo's HTML file itself** before finishing:

1. Check that `<head>` has a `<meta name="description">`, the full OG block, and the Twitter/X
   card block. If any are missing, add them (use the preview image dimensions from the actual
   file; aspect ratio should be close to 2:1 for Twitter).
2. Check that the bottom of `<body>` has the standard back-link `<footer>` and the
   iframe-hiding `<script>`. If missing, add them.

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
<title>Demo Title — interactive explainer</title>
<meta name="description" content="One or two sentences describing the demo.">

<!-- Open Graph (Facebook, LinkedIn, Slack, iMessage, etc.) -->
<meta property="og:type" content="website">
<meta property="og:title" content="Demo Title — interactive explainer">
<meta property="og:description" content="One or two sentences describing the demo.">
<meta property="og:image" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo-preview.png">
<meta property="og:image:width" content="ACTUAL_WIDTH">
<meta property="og:image:height" content="ACTUAL_HEIGHT">
<meta property="og:url" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo.html">
<meta property="fb:app_id" content="2385695445236853">

<!-- Twitter/X card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Demo Title — interactive explainer">
<meta name="twitter:description" content="One or two sentences describing the demo.">
<meta name="twitter:image" content="https://tpavlic.github.io/asu-simulating-stochastic-systems/my_demo/my_demo-preview.png">

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-Y66V2TS0R6"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-Y66V2TS0R6');</script>
</head>
```

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
likewise use literal `—`, `<`, `>`, `'`, etc. (This applies only to the social-card meta
`content` attributes; the human-visible `<title>` element and page body still follow normal
HTML escaping rules.)

### 2. Footer with back-link and iframe-hiding script

At the very bottom of `<body>`, before `</body>`, add:

```html
<footer id="course-nav-footer" style="margin-top:0;font-size:0.8rem;color:#78786A;">
  <div style="max-width:MAX_WIDTH;margin:0 auto;padding:0.75rem 0 0 1rem;">
    <a href="../" style="color:inherit;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><span style="font-family:sans-serif">&larr;</span> All course visualizations</a>
  </div>
</footer>
<script>
if (window.self !== window.top) { var f = document.getElementById('course-nav-footer'); if (f) { f.style.display = 'none'; } }
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

The `<script>` hides the footer when the page is embedded in a Canvas LMS iframe. Use
`getElementById('course-nav-footer')` rather than `querySelector('footer')` — some demos
have their own internal `<footer>` elements, and `querySelector` would match the first one
it finds instead of the back-link footer.

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
      <h3>Demo Title — interactive explainer</h3>
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

---

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
- **Drag-and-drop does not exist on a phone.** Anything droppable needs a file input or a paste box
  beside it.
- **Test in a real touch context, not a narrow desktop window.** Touch emulation is what catches a
  control that a mouse can drive and a finger cannot; a resized desktop window will not.

## Site structure

- `index.html` — the root landing page; self-contained HTML (no Jekyll/build step)
- `README.md` — GitHub repo landing page; mirrors the index structure for repo visitors
- Each demo is a **self-contained, single-file HTML page** with all CSS and JS inlined
- Preview images live alongside their HTML file in the same subdirectory
- The site is deployed via **GitHub Pages** directly from the `main` branch (no build step)
- `index-preview.png` is the root page's OG/Twitter card image. It is currently a copy of
  `monte_carlo/mc_explorer-preview.png`, standing in until a landing-page image exists;
  when you replace it, update the `og:image:width`/`height` in `index.html` to the new size and keep
  the ratio near 2:1 for Twitter/X

## Current sections and demos

### Monte Carlo Methods

- `monte_carlo/mc_explorer.html` *(four tabs: dartboard estimation of π, Buffon's needle, area
  estimation by a walking robot, and Monte Carlo integration. The three experiment tabs carry
  accumulating 95% confidence intervals and a 100-run sweep; the robot tab is an animated extension
  with no controls. Expected to gain further tabs tailored to this course)*

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
  piecewise-constant arrival rate from timestamps. Two conventions in this file are relied on by
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

### Output Analysis

- `power_analysis/power_explorer.html` *(statistical power taught by simulation: five tabs — a
  null-vs-alternative explorer over a registry of eight tests (z, t, two-sample t, variance,
  proportion, chi-square GOF, one-way ANOVA, regression slope) with a Monte Carlo engine and
  solve-for-power/solve-for-n in both directions, power curves, a live OC chart, a
  paired-comparison/pilot-data tab, and an advanced tab whose gamma-regression demo runs the
  same engine with no analytic overlay. Conventions relied on by code outside the file, which any
  later edit has to preserve:*
  1. *Everything between the `PA-CORE-BEGIN` / `PA-CORE-END` sentinels is pure numerics with no DOM
     access. `power_analysis/verify_power_explorer.mjs` slices that block out of the HTML and runs
     it in Node, and the Monte Carlo Web Worker is built from the same `<script id="pa-core">`
     element's text. Moving the sentinels, or reaching for `document` inside them, breaks both.*
  2. *`verify_power_explorer.mjs` is not shipped with the widget and is not linked from the site.
     Run it (`node power_analysis/verify_power_explorer.mjs`, about a minute; `PA_MC_M` shortens
     the Monte Carlo sections) after touching anything in the core. It checks the special functions
     against exact identities, the noncentral t/chi-square/F CDFs against R-derived references
     (noncentral F against Poisson mixtures of central beta CDFs, because R's own `pf(ncp)` is only
     accurate to ~1e-9), power-at-zero-effect = α for every test and sidedness, Monte Carlo vs
     analytic power across a grid, solve-for-n round trips, and — when `Rscript` is on the PATH —
     re-runs the export panel's R formulas in R and compares.*
  3. *Three statistical conventions are deliberate. Two-sided t and z power is the exact
     both-rejection-tails quantity, so R's `power.t.test` matches only with `strict = TRUE`, which
     the export snippets therefore carry. The proportion test is the equal-tail exact binomial,
     whose power is genuinely non-monotone in n; the sawtooth and the two solve-for-n answers
     ("first n" and "stable n") are the point, not a bug. And the chi-square GOF analytic curve is
     the large-n noncentral-χ² approximation on purpose, with the gap against the simulated
     histogram surfaced in the UI as a teaching point.)*

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

- **Accent color:** `#8C1D40` (ASU maroon) — used in links and section headings. Derived tints in
  `index.html`: `#6b1631` (dark hover), `#e0c2cc` (rules), `#f0e2e6` (light rules), `#fbf3f5` (row
  hover), `#f5e6ea` (active nav, thumbnail background)
- **Copyright:** © Theodore P. Pavlic, MIT License (`LICENSE` file at repo root)
- **fb:app_id:** `2385695445236853` — include in all OG blocks
- **Google Analytics ID:** `G-Y66V2TS0R6` — include the two-line GA4 snippet in every `<head>`, after the Twitter/X card block and before `</head>`
- **GitHub Pages base URL:** `https://tpavlic.github.io/asu-simulating-stochastic-systems/`
- **YouTube channel:** <https://www.youtube.com/@TedPavlic> — linked from the index header
