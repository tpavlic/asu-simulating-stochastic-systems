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
(estimate), with maroon reserved for chrome. A third data color, red `#D62828` (5.0:1 on
white), marks an interval that missed the true value in the Confidence Interval and Variance
Reduction Techniques Explorer, so a miss is not the same orange as the sample it came from; the
miss is also dashed with a hollow dot.

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

## Tooltips

A dotted underline means one thing across these widgets: there is an explanation here. Never carry
it on a `title` attribute, which is invisible on touch, unreachable from the keyboard, and read out
unevenly by screen readers.

- **One floating element serves the whole page.** Give every trigger a `data-tip` attribute and let
  a single `#tipbox` render whichever one is active, so two tips can never be open at once and the
  text may hold markup. The worked version is in `monte_carlo/mc_explorer.html`.
- **Three ways in: hover, focus, tap.** Mouse, keyboard, and finger each need one. Mark the trigger
  `.tip` (`text-decoration: underline dotted`, `cursor: help`, `tabindex="0"`).
- **A control that tap already operates opens its tip on a long press instead**, around 450ms held
  still, cancelled by about 10px of movement, with the click that follows swallowed in the capture
  phase. A button or a checkbox label cannot use tap for both jobs. Such a trigger still gets the
  dotted underline: it says a tooltip exists, not which gesture opens it. Add
  `-webkit-touch-callout: none` so iOS does not raise its own menu over the press.
- **A trigger inside a `<label>` must call `preventDefault()` on the tap**, or the label hands focus
  to its field and a phone raises the keyboard behind the tip.
- **Mirror the text with `aria-describedby`** into a visually hidden span parked outside the
  trigger. Inside a button or label it would be read as part of the name. This is what replaces the
  accessibility that `title` used to provide, without the doubled bubble.

## Links

One underline behavior per page: no resting underline, underline on hover. Color links
`var(--accent)` so color marks them as links rather than a permanent underline. Apply this to the
copyright and license links too, so every link on the page behaves the same way.

## Tabs and deep links

Every tab is externally linkable. A reader should be able to right-click a tab and copy a link
straight to it, and a link ending in `#id` should open on that tab rather than the default one.

- **A tab control is an `<a href="#id">`, never a `<button>`.** The click handler still does the
  work (`onclick="showTab('id',this);return false;"`, or `e.preventDefault()` first when the tab is
  wired through `addEventListener` instead of an inline `onclick`), but the anchor is what makes
  "Copy Link" show up on right-click. This includes the pill/tile pickers some widgets use in place
  of a plain tab row, and any hand-written prose link that jumps to another tab. It does not extend
  to the narrow-screen `<select id="tab-select">` fallback, which stays a `<select>` and drives the
  same handler through its `change` event. No CSS change is needed for the conversion: `.tab`
  already carries its own border, background, and cursor, and the nav row is a flex container, so a
  flex item is block-boxed the same way regardless of whether the tag is `<a>` or `<button>`.
- **The tab-switching function sets the hash itself, with `history.replaceState`, never
  `pushState`.** Switching tabs should update the address bar so the current tab is always what a
  copied link points to, but it must never grow the back/forward history — a reader tapping through
  eight tabs should not have to fight the back button eight times to leave the page.
  `if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);` inside the
  function that activates a tab is enough; nothing upstream needs to change, because every path that
  switches tabs (a click, the `<select>`, a `hashchange`, the boot-time read) already funnels through it.
- **A `validTab(name)` guard checks the hash against the real tab set before acting on it**, so a
  stray or stale fragment never breaks the page. Building the selector as
  `'.tab[data-tab="' + name + '"]'` and testing it with `document.querySelector` is enough, since it
  reads the same markup the tab row already carries rather than a second list that could drift out
  of step.
- **If a tab is identified by its position (a numeric index) rather than a string key, hash a fixed
  slug for that tab, never the raw index.** A link built from the index breaks the moment a tab is
  inserted anywhere but the end: every later tab's index shifts, so a link someone already shared
  silently opens the wrong content instead of failing loudly. Keep the index for whatever internal
  wiring already depends on it, and add one small array mapping each position to a permanent name
  (`const TAB_SLUGS = ['overview', 'perpproj', ...]`) used only for the hash and for translating an
  incoming hash back to an index.
- **A `hashchange` listener re-activates a tab when the hash changes from outside the page** (an
  external link opened while the page is already loaded, or a back/forward step across one), by
  calling the same tab-switching function the click handlers use.
- **At boot, read the hash once and switch to that tab if it names one other than the default.**
  Let the page's own startup sequence finish priming its default tab first, and only then check
  `location.hash`, so a widget whose default tab does lazy setup work inside its tab-switching
  function (a canvas sized on first visit, an animation started or stopped) still gets that setup
  when the incoming link points elsewhere. One boot-time call to the existing tab-switching function
  covers it; no separate render path is needed.

The worked version is `input_modeling/prob_models.html`; the same pattern, adapted to each widget's
own tab-switching function, is also in `monte_carlo/mc_explorer.html`, `monte_carlo/mc_examples.html`,
`prng/prng_explorer.html`, `input_modeling/input_analyzer.html`, `power_analysis/power_explorer.html`,
and `output_analysis/ci_explorer.html`.

## Contrast reference

| Color | On white | Use for |
| --- | --- | --- |
| ASU maroon `#8C1D40` | 8.88:1 | chrome: text, rules, button fills |
| ASU gold `#FFC627` | 1.57:1 | large fills and thick rules only, never text or marks |
| Dark ochre `#8b6914` | 5.09:1 | the readable stand-in for gold |
| Teal `#0F6E8C` | 5.79:1 | data |
| Orange `#C2570A` | 4.50:1 | data |
| Indigo `#3F4C8C` | 8.00:1 | data |
| Red `#D62828` | 5.01:1 | data: the missed-interval color in the Confidence Interval and Variance Reduction Techniques Explorer |

Maroon against orange is 2.08:1 and against crimson `#c0392b` is 1.63:1 – the reason maroon stays
out of the data palette.
