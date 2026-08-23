# Visual theme for course widgets

Build this widget to be embedded in an ASU Canvas LMS page: white background, ASU maroon headings
and links, thin rules, no heavy chrome. Match that.

The theme is course-flavored; the content must not be. Do not name the course, its catalog number,
the university, the instructor, or a semester anywhere in the widget — not in the title, headings,
body text, or `<head>` metadata. These widgets are general topic tools that any instructor can
find on the web and embed in their own class, so frame everything by topic (the method, the
distribution, the algorithm), never by course.

## Chrome palette

Declare these in `:root` and route every chrome color through them – headings, section labels,
active tabs, buttons, focus rings, borders, accent rules:

```css
:root {
  --accent:      #8C1D40;  /* ASU maroon */
  --accent-dark: #6b1631;  /* hover/pressed */
  --bg:          #ffffff;  /* page: white, to match a Canvas page */
  --card:        #ffffff;
  --border:      #e3dadd;  /* panels read as panels via borders, not fills */
  --text:        #191919;
  --muted:       #6e6e6e;
  --accent-wash: rgba(140,29,64,.06);  /* callout/highlight fills */
  --accent-tint: rgba(140,29,64,.10);
  --chart-bg:    #fbfafa;  /* plot interiors */
}
```

Reference the tokens, never a literal: `color: var(--accent)`, not `color: #8C1D40`.

Keep the page background white. A tinted page background renders as a visible pasted-in rectangle
inside a white Canvas page. Give panels definition with a 1.5px `var(--border)`, and reserve the
tints for small callouts.

## Data colors

Anything that encodes meaning – a plotted series, accept vs. reject, in vs. out, captured vs.
missed – must NOT use the chrome tokens. Declare data colors as their own group in `:root`, with a
comment saying what each one means. Three constraints:

- **Never use maroon as a data color.** Against a warm red or orange it sits at about 2:1, which is
  not separable as adjacent marks, and it already reads as "error" or "reject".
- **Never use ASU gold `#FFC627` for text, thin lines, or plot marks** – it is 1.57:1 on white.
  Large fills and thick rules only. Dark ochre `#8b6914` is the readable substitute.
- **Never let color alone carry meaning.** Two marks that a reader must tell apart need a second
  cue: shape, fill (solid vs. hollow), dash pattern, or a direct label. Even a good hue pair fails
  here – teal `#0F6E8C` and orange `#C2570A` are a well-separated pair to normal vision, but under
  protanopia they simulate to 1.08:1, essentially the same lightness. Legends must show the second
  cue, not just a colored dot.
- **Check each mark against its own background, not against the other mark.** WCAG 1.4.11 asks for
  3:1 against the adjacent background, which teal (5.79:1) and orange (4.50:1) both clear on white.
  Two data colors sitting at low contrast *with each other* is acceptable when form already
  separates them – but where a line crosses a dense fill, give the line a white halo (stroke it
  wide in white, then narrow in its own color) rather than hunting for a darker hue.

Prefer one visual language reused across the whole widget over a fresh pair per chart. For example,
teal `#0F6E8C` for the exact thing (true curve, CI hit) and orange `#C2570A` for the sampled thing
(estimate, CI miss), with maroon reserved for chrome.

## Canvas and SVG

Draw from the same tokens. A hex hardcoded in JS cannot be re-themed, so a palette change would
move the page and leave the plots behind. Read the values once:

```js
const css = getComputedStyle(document.documentElement);
const tok = n => css.getPropertyValue(n).trim();
const C = {
  accent: tok('--accent'), muted: tok('--muted'), bg: tok('--chart-bg'),   // chrome
  truth: tok('--truth'), est: tok('--est'),                                // data
};
```

Size every canvas backing store at `logical x devicePixelRatio` and call
`ctx.setTransform(dpr,0,0,dpr,0,0)` once, then draw in logical units – otherwise plots are blurry
on a retina display.

**Prefer plain SVG for a plot that only changes when the reader does something.** An `<svg>` with a
`viewBox` and no `width`/`height` attributes is resolution-independent: sharp at any zoom on any
display, with no `devicePixelRatio` bookkeeping and no redraw when its container resizes. Keep
`<canvas>` for the cases that earn it – a plot redrawn every frame, or one carrying more marks than
the DOM wants to hold, a few thousand being the rough threshold. If a plot is offered as a download,
render it at `devicePixelRatio` rather than at a fixed 2x, so a phone gets a file as sharp as its
own screen.

## Touch and small screens

These widgets are opened on phones, so a 390px touch screen is a target rather than a fallback. The
full checklist is in `CLAUDE.md`; the parts that are presentation are here.

- **Touch targets at 24x24 CSS pixels or more** (WCAG 2.5.8). Grow the hit area with padding and
  `min-height`, never by enlarging the drawn control – a checkbox scaled to 24px square dominates
  its row, and a 17px one inside a `<label>` that clears 24px is already fine, because the label is
  what a finger lands on. Range inputs are the common miss: the default is about 16px tall, so give
  them `height: 26px`.
- **Nothing may depend on hover.** An affordance revealed on `:hover` is invisible on a touch screen,
  so pair it with `@media (hover: none)` that keeps it showing, and say in the page text that the
  feature is there – a hover reveal is undiscoverable with a mouse too if nothing hints at it.
- **No horizontal scroll at 390px, on any tab.** The two habitual causes are a `white-space: nowrap`
  label beside a control and a wide table outside an `overflow-x: auto` wrapper. Measure it rather
  than eyeballing it.
- Set `-webkit-text-size-adjust: 100%` on `body`, or iOS Safari inflates the text in landscape and
  every width in the layout stops meaning what it says.
- **A plot must not shrink its labels to fit.** An `<svg>` with a fixed wide `viewBox` and
  `width: 100%` scales its text down with the chart, and so a 940-unit plot in a 310px column renders
  its 11px labels at 3.6px. Wrapping it in `overflow-x: auto` only trades that for sideways
  panning, which on the tab a reader is meant to interact with is just as bad. Instead pick the
  `viewBox` from the space the plot actually has: set its width to the container's width (capped at
  the designed width) so one unit is one CSS pixel, and give it a taller aspect below the
  breakpoint: axes that sit side by side on a laptop have to stack on a phone. The measure
  to check is `renderedWidth / viewBoxWidth`; at 1.0 every label is its nominal size, and below
  about 0.85 the small type is already hard to read.
- **Re-measure on resize and on tab switch.** A plot drawn while its tab was hidden had no width to
  measure, and so it falls back to its designed size and keeps it. Redraw the visible plots when the
  viewport *width* changes, ignoring the height-only resize iOS fires when its address bar slides
  away, and re-check a tab's geometry when it is shown.

## Links

One underline behavior per page: no resting underline, underline on hover. Color links
`var(--accent)` so color marks them as links rather than a permanent underline. Apply this to the
copyright and license links too, so every link on the page behaves the same way.

## Contrast reference

| Color | On white | Use for |
|---|---|---|
| ASU maroon `#8C1D40` | 8.88:1 | chrome: text, rules, button fills |
| ASU gold `#FFC627` | 1.57:1 | large fills and thick rules only, never text or marks |
| Dark ochre `#8b6914` | 5.09:1 | the readable stand-in for gold |
| Teal `#0F6E8C` | 5.79:1 | data |
| Orange `#C2570A` | 4.50:1 | data |
| Indigo `#3F4C8C` | 8.00:1 | data |

Maroon against orange is 2.08:1 and against crimson `#c0392b` is 1.63:1 – the reason maroon stays
out of the data palette.
