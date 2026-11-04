# Footer and copyright layout

Conventions and pitfalls for the copyright line and the back-link footer (`#course-nav-footer`)
on the widget pages. The footer template, its embed script, and the rule for the back-link's color
are in `CLAUDE.md`, under "Footer with back-link and embed script".

## Layout conventions and pitfalls

- **Footer copyright centered; back-link left-aligned** to the content's left edge, with only a
  small gap between them. Put a subtle footer copyright line (`© 2026 Theodore P. Pavlic ·
  MIT License`, MIT linked, `MIT&nbsp;License` non-breaking) just above the back-link.
- **A generic `footer { … }` rule leaks into `#course-nav-footer`**, which is also a `<footer>`.
  Many demos style their own copyright `<footer>` with `font-family:var(--mono)`,
  `text-align:center|right`, padding, a `border-top`, and a large `margin-top`; those cascade in and
  make the back-link monospace, centered, or oddly padded, and add a second rule and a big gap. Fix
  by resetting them on the back-link's inline style (`font-family:inherit; text-align:left;
  padding:0; border-top:0; margin-top:0`) or by scoping the demo's rule to
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
- **Spacing below the back-link comes from one source.** If the demo's `body` has no
  `padding-bottom`, the footer sits flush against the viewport edge; add `padding-bottom` to the
  body or `margin-bottom` to the footer. If `body` already has all-sides padding (e.g.
  `padding:18px`), do not also give the back-link footer a bottom padding, or that page's back-link
  sits visibly lower than its siblings'. Put layout padding on `body` only: `html, body { padding:
  … }` applies it twice.
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

## Link decoration (underline) consistency

Within each page, the copyright/license "MIT License" links and the back-link should share ONE
underline behavior; the default is **hover-underline** (no resting underline, no hover-bold, no
hover color-shift — the underline appears only on hover). Use a resting (always-on) underline only
when a link is the *same color* as its surrounding text so nothing else signals it is a link; better
still, give such links a distinct accent color and keep hover-underline. Colors may differ by
context and need not match across header/footer:

- Choose each link's color to be readable **and** distinct from adjacent text *in its own
  context*. An accent that reads on a light footer (maroon, orange, blue) is often unreadable on
  a dark header banner — there, let the header "MIT License" link keep the banner's own text color
  (it is fine if it does not obviously look like a link).
- Bring body/reference links into the same behavior (e.g. via the page's global `a{}` rule:
  `a{…;text-decoration:none} a:hover{text-decoration:underline}`) so the whole page is consistent.
