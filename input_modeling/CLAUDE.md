# CLAUDE.md — `input_modeling/`

Notes for the widgets in this directory. Repository-wide conventions (head metadata, footer,
embedding, mobile, commit messages) are in the root `CLAUDE.md`.

- `input_modeling/input_analyzer.html` *(a replacement for and extension of Arena's Input Analyzer:
  four tabs, one fitting twenty candidate distributions to a pasted sample (with the two Johnson
  members, S_B and S_U, fitted only when a checkbox in the Candidates card asks for them, off by
  default because four parameters that reach almost any shape win a ranking on flexibility alone;
  their rows always carry a note saying so) and reading a frequency table (a column of whole
  numbers 0 or above offers an "Each value is" switch, which opens on one observation for every
  data source but the Board defects (table) sample, since a column headed Frequency can hold the
  observations themselves; read as counts, the table is expanded into its observations before
  anything is fitted, the count column is guessed by its header or, between two columns of whole
  numbers, by the larger total, and the outcomes come from another column or are numbered
  0, 1, 2, … or 1, 2, 3, … by row, which refuses a missing count or a blank line inside the table because either
  would shift every later outcome), one estimating a piecewise-constant arrival rate
  from timestamps, one relating two variables (a scatter with each column's histogram on its
  margins, a pairing switch that keeps both histograms while it shows the pairs shuffled or sorted
  together or opposite, with the range of r those values allow, the three correlation
  coefficients, a least-squares model of Y given X with a Breusch–Pagan check of its spread, and
  NORTA pairs, X and Y drawn together with each column's own distribution and the data's Spearman
  ρ or Pearson r, shown beside the data on one frame), and one looking for patterns over time
  (opened by a diagram of how its sections assemble a model as the mean over time plus variation
  around it, then a run sequence drawn with that mean, a lag plot beside a correlogram with a Ljung–Box
  test, a mean over time that is a constant plus an optional straight-line trend and up to two cycles
  of known period, each with up to three harmonics (a second cycle whose harmonic repeats one of the
  first's is refused), written out as a fitted model and drawn through the readings or as the
  residuals around it, a periodogram for an unknown period, and one section for
  the variation around that mean, switched among independent draws, an AR(1), NORTA's AR(1) on a
  normal scale, matched to the lag-one correlation, and EAR(1) for exponential readings with a
  constant mean (grayed while a trend or a cycle is fitted, the reader's choice kept); its export
  repeats those choices, synced both ways, writes the model out before the lines, and warns that an
  exported trend holds only over the data's own span). The last two send residuals, per-unit values, AR(1) innovations, or a column or
  the readings themselves to the first tab, and a fit made there becomes the noise term of their
  export or a NORTA distribution (`ST.handoff`, keyed to the data and model that sent them and
  cleared whenever the first tab's data change; tab ③ keeps a captured fit for each column in
  `PST.marg` and tab ④ in `SST.marg`, so that a second hand-off does not lose the first); their exports read each tool's clock in the data's time
  unit (Arena's `*ToBaseTime`, Simio's hours, AnyLogic's `time(UNIT)`). Every plot card carries a row of SVG, PNG, COPY, M,
  R, and PY buttons above the plot (COPY puts the PNG on the clipboard, and is left out where the
  browser cannot write an image there): the `Plot` builder records each mark it draws as data, files
  the result under the plot's title in `PLOT_SPECS`, and the `FIG_SCRIPTS` block writes a MATLAB,
  R, or Python script that redraws the plot from those data. That block is a copy of
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
  2. *`verify_input_analyzer.mjs` and its companion `verify_input_analyzer_jobs.mjs` are not shipped
     with the widget and are not linked from the site. Run the first (`node
     input_modeling/verify_input_analyzer.mjs`, about twelve minutes on a multi-core machine) after
     touching anything in the core. Its slow Monte Carlo loops live in the jobs module and run on
     worker threads, one fewer than the cores, with the same seeds as a serial loop, and so the output
     is the same either way; `IA_SERIAL=1` runs them on one thread (several times longer), and
     `IA_WORKERS` sets the thread count. A new slow loop belongs in the jobs module as a job returning
     plain counts. The script checks the special functions against exact identities, recovers known
     parameters for every distribution, and measures the bootstrap's rejection rate under a true
     null, confirms that the classical K-S and A-D p-values are correctly calibrated when the
     parameters are fixed and far too permissive when they are estimated, and measures the
     chi-square rejection rate under both degrees-of-freedom conventions. `IA_CALIB_REPS` and
     `IA_CALIB_B` shorten the slow calibration sections.*
  3. *Two parameter counts are deliberate and must not be collapsed into one. `fit.k` counts every
     quantity estimated from the data and drives AIC and BIC; `regularCount(fit)` excludes
     parameters that are extreme order statistics -- a uniform's endpoints, a beta's interval -- and
     an estimated location shift wherever it lands, and is what the chi-square degrees of freedom
     subtract. The verification measures both: on uniform data the order-statistic count rejects at
     4.0% against a nominal 5%, and subtracting everything rejects at 11.5%. The shift was once
     subtracted when it landed inside the range, but under a true null at n = 100 and 300, across
     every shiftable family, that rejected 6.5% to 16.8% of correct shifted fits, and leaving it out
     rejected 3.5% to 6.9%; the verify measures it on a shifted gamma. A fit can also name its
     own order-statistic parameters in `fit.orderStat`, which `regularCount` reads before the
     family's `orderStat`: the binomial's n is one when it lands on the largest count. The negative
     binomial and the binomial report their Poisson limit as `edge: 'poisson'` (variance not above,
     or not below, the mean), and a family whose one-held fit is closed form or whose parameter
     must be whole supplies `fitHeld`, which `fitWithHolds` calls in place of its Nelder–Mead
     search.*
  4. *The Johnson members are fitted by maximum likelihood over all four parameters: given the
     location and scale, the shapes are closed form (z = γ + δw is standard normal for the
     transformed sample w), and the fit is a two-dimensional Nelder–Mead on that profile, over
     (ξ, ln λ) for S_U and over the two log gaps between the endpoints and the sample extremes for
     S_B, whose profile falls to −∞ as an endpoint reaches an observation. Both of S_B's ends are
     therefore estimated (unlike the beta's) and all four parameters are regular for the
     chi-square. A fit that runs past 20 ranges from the data reports `edge: 'normal'` or
     `'lognormal'`, named by comparing with the closed-form fits of those limits, and S_U with
     |γ|/δ above 2.5 reports its lognormal limit. Inside the bootstrap, `FIT_FAST` and `FIT_HINT`
     (set by fitDist and bootstrapRun) start the search from the parent fit with fewer iterations.*
  5. *A mirrored fit ("Fit the mirror image c − X", for a long left tail) is stored as an ordinary
     shifted fit with `reflect: true`, its right end c in `shift`: `fitDist` fits the shifted model
     to −x and negates the start, and so the profile search, the at-bound diagnosis, and the holds are
     the shift's own, and `fitCdf`, `fitPdf`, `fitQuantile`, and `fitSampler` read `shift` and
     `reflect` together. Any new code that reads `fit.shift` has to check `fit.reflect` as well. Only
     `shiftable` candidates are mirrored, and the Pearson type VI is deliberately not `shiftable`:
     with a shift it has four weakly identified parameters, and its shifted bootstrap took minutes.*
  6. *The dependence numerics (core sections 15b to 15e) are checked by
     `verify_input_analyzer_dependence.mjs`, which the main verify runs and which also runs alone in
     a few seconds. Its reference values come from `verify_dependence_reference.R`, which generates
     every dataset with a fixed seed and writes the data and R's results to
     `verify_dependence_reference.json`; regenerate the JSON only by re-running that script. It also
     runs the R and Python scripts the two tabs export, each of which prints every number beside the
     page's and says "agrees" or "DIFFERS", and the MATLAB ones under `IA_MATLAB=1`, both with the
     data embedded and, past 250 values a column, reading the tab's own CSV download (`pairCsv`,
     `seriesCsv`), whose `#` lines Python reads past with the standard library's `csv` module
     rather than `numpy.genfromtxt`. The periodogram runs on an FFT (Bluestein's method for a
     length that is not a power of two) after removing a straight line, as `spec.pgram` does by
     default, and Kendall's S uses Knight's merge count, so that both stay fast at tens of
     thousands of points; every control on tab ④ recomputes them. A fit to
     residuals is centered by `centeringMean`, which treats a mean within 1e-9 of the fit's
     interquartile range as 0, so that an export never carries a meaningless "+ 3e-12".*
  7. *NORTA (core section 15e) solves the normals' correlation exactly, not by simulation: each
     output's Hermite coefficients come from a midpoint rule on |z| ≤ 8 (`nortaGrid`), the outputs'
     Pearson r (or Spearman ρ, through each value's mid-cdf, so that ties count) is a power series
     in the normals' ρ (Mehler's formula) cut at `NORTA_K` terms, which must be even, with a
     remainder fitted so that the map is exact at ρ = ±1, and Spearman between two continuous
     marginals is 2 sin(πρ/6) in closed form. The data's own distribution is the piecewise-linear
     empirical through `NORTA_BREAKS` (21) quantiles, the form the exports write, or the observed
     values. R, MATLAB, and Python write every family through their quantile functions; Arena,
     Simio, and AnyLogic get a block only for families whose quantile is a formula (the normal, the
     lognormal, and the Johnson members as formulas of Z, the counts as a sum of indicators of U), and
     write Φ by Abramowitz and Stegun 26.2.17 (`phiAS`, within 7.5e-8), which the verification
     evaluates block by block at fixed normals. Arena 16.20 and AnyLogic 8.9.10 ran the blocks
     unchanged (Arena's logical expressions as 0 or 1, `EP`, `**`, and a 16-term count; AnyLogic's
     Java statements and ternaries) and matched the expected moments. Simio has not run them, but
     its Reference Guide documents every function the Simio blocks call (`Math.If(test, value,
     otherwise)`, `Math.Floor`, `Math.Exp`, `Math.Log`, `Math.Abs`, `Math.Sqrt`, `Math.Min`, and
     `Math.Max`) and an Assign step's rows running in order.*
  8. *A continuous fit's bootstrap rounds each resample to the data's recording step
     (`recordingGrid`, applied by `snapToGrid` inside `bootstrapRun`), and the R, MATLAB, and Python
     snippets do the same with a `rec` function, skipping a rounded resample their fitter refuses,
     as the page does. Without the rounding, the resamples have none of the data's ties, and on
     data recorded to whole seconds with a spread of about ten seconds, the bootstrap rejected a
     correct shifted gamma 100% of the time; with it, the rejection rate is at or below nominal
     (section 16b of the verify measures both). The step is the fewest decimal places that write
     every value, grown to the gaps' common divisor only with at least `GRID_MIN_DISTINCT` (8)
     distinct values two of which sit one step apart, and so a few irregular outcomes never get a
     coincidental coarse step. Values on no decimal step (seconds written as minutes) get no grid,
     and the tie note says the bootstrap cannot correct for their ties. The grid never enters the
     choice of family: data that look discrete are fitted as discrete exactly as before. On data
     with a step, a shifted fit flagged degenerate falls back to a shift h/2 below the smallest
     value rather than 0.001 of the range below it: a block of tied values at the minimum is what
     makes the profile diverge there, and at the old fallback a coarse shifted lognormal (step about
     0.6 of the SD) was rejected by its rounded bootstrap more than half the time on correct models
     (section 16b checks it). Above a step of `COARSE_STEP_SD` (0.5) of the SD, the tie note says
     the bootstrap p-values are approximate; at about 0.6, a correct shifted gamma was rejected up
     to about twice as often as nominal. Item 10 describes the fit to recorded ranges, which
     replaces these fits on coarse data.*
  9. *`fitDist`'s eighth argument, `opts`, carries the fit options that `rankAll` passes; every
     fit records in `fit.opts` the ones that applied to it (holding and cutting only where no
     value is negative), and `bootstrapRun` refits every resample under them. "Keep models at or
     above zero" (`#zero-pick`, `ST.zero`) chooses among no, by holding each start at 0 or above
     (the default, `floor0`), and by cutting each off at zero (`cut0` as well). `floor0` caps the
     shift search at γ = 0 when no value is negative; a fit stopped there is `floorBound`, the unshifted model, with the shift not counted
     in k. It also holds the minimum of a family that has one (`minParam`: the triangular, PERT,
     beta, and Johnson S_B) at or above 0 (`floorMinFit`, `floorParam`, counted nowhere). `cut0`
     is item 11. `start1`
     ("Smallest possible value is 1", off by default) fits the families in `START1_KEYS` to x − 1
     and stores `shift: 1, start1: true`; `expressions` adds "1 +" to every tool's line (the
     geometric becomes AnyLogic's and SciPy's trials count), and the snippets subtract 1 from the
     data right after reading it. A shift that converges onto the minimum is reported as the
     minimum exactly when the family can take a value of 0 there (the exponential). The fit card
     notes any continuous model that puts 0.01% or more of its draws below zero when no value is
     negative (`belowZeroNote`). A frequency table numbered by row can start at 1 (`ST.freq.out`
     of −2). Tab ①'s samples are one grouped menu (`#sample-pick` and its Load button): continuous
     values measured exactly, continuous values rounded when recorded (Phone IVR service times,
     whole seconds, and Machine setup times, to the half minute), continuous values best fit with
     truncated distributions (Tool wear per shift, a normal(1, 1.2) truncated below zero, whose
     `hint` names the setting that shows it), continuous values with a block of zeros (Rework
     time per part, 108 zeros among 200, the rest a gamma(2, 2.5); its hint points to the zeros'
     box), and discrete counts. Every tab labels its samples "Sample data". The Phone IVR sample loads as
     counts, its count note points to Continuous with the shift, and once Family is Continuous the
     note says each value is fitted as the range it was rounded from (`renderStats` reruns when
     Family changes).*
  10. *Values on a step of `INTERVAL_STEP_SD` (0.05) of the SD or more are fitted to the ranges
     they stand for (core section 7b, `opts.rec` from `recordingRec`): each continuous candidate,
     the empirical excepted, maximizes the grouped (interval-censored) likelihood by Nelder–Mead
     from the exact fit, or inside the bootstrap from the parent fit (`FIT_HINT`,
     `FIT_HINT_SHIFT`), and its `ll`, AIC, and BIC are sums of log-probabilities. The likelihood
     is bounded, and so no range fit is `degenerate` or `atBound`, and its shift can land above the
     smallest recorded value (the fit card's `rangeFitNote` says why). "Values were" beside Family
     (`ST.recKind`: nearest, down, up, trunc, or exact) appears only above the cutoff under a
     continuous family; rounded down and up move each range by half a step, and the bootstrap rounds
     its resamples the same way (`snapToGrid` reads `grid.kind`). Truncated (the digits past the
     step dropped, which moves every value toward 0), a recorded v stands for [v, v + h] above 0,
     [v − h, v] below it, and [−h, h] at 0 (`recSpan`, which every range end goes through), and
     so rounded down and truncated differ wherever a value is 0 or below; the option is offered
     only when 0 is on the grid (`zeroOnGrid`). A range fit's starting fit is never cut for an
     exact 0 (`inCut`): cut, it ran off to a start hundreds of units below 0, and the held range fit
     then failed from there. Section 16d of the verify checks truncation's ranges, rounding, and
     mirror image, recovers a normal(0.8, 1.5) truncated to whole numbers (mean errors near 0.01,
     against 0.3 fitted as rounded down), runs the R and Python scripts, and measures the bootstrap
     of a normal truncated to 0.5 (K–S 6.0%, A–D 4.5%, nominal 5%). The cutoff was measured on shifted
     gamma, lognormal, and Weibull fits at n = 150 against the true parameters: at 0.02 the two
     fits agree; from 0.05 the exact fit's errors grow (the gamma's by 9–16% at 0.05 and 30–50% at
     0.1), and the range fit's stay at the unrounded data's. Of the built-in samples, only the
     two rounded when recorded reach the cutoff. `reproScripts` hands a range fit to `rangeScripts`, which
     writes each family's CDF and quantile in R, MATLAB, and Python, maximizes the same likelihood
     from the page's estimates, and prints each number beside the page's (estimates to three digits,
     the log-likelihood to six); a Pearson type VI run off to its gamma limit prints MATLAB's without
     a verdict, because MATLAB's `betainc` parts from R's and SciPy's at a shape near 1e9. The
     goodness-of-fit statistics of a range fit compare the recorded values with the distribution of
     a recorded value, a step function on the grid: `gofCdf` (F at the top of each range),
     `fitAtom` (each range's probability), `cdfBelow` (the chi-square and square-error bins), and
     `adStatFit`, the grouped-data form of A² summed over the grid. Scored against the smooth F
     instead, a recorded 5 under a fitted start of 5.2 has F(5) = 0, such values are far commoner in
     resamples than in the data, and the bootstrap rejected 0 to 4% (K–S) and 0% (A–D) of correct
     fits; the order-statistic A² on the step CDF still rejected none, its ties swamping it. With
     both changes, correct shifted gamma, lognormal, and Weibull fits at a step of 0.45 and 0.6 of
     the SD were rejected 1.5% to 6.5% of the time (200 each), and so the coarse-step warning is
     given only for a fit of values recorded exactly. The bin
     slider rescores the square error (`rescoreBins`) rather than refitting. Timings: the verify's
     `vm` sandbox runs this code 20–50 times slower than a browser; on the page the whole ranking
     takes about 0.1 s and a 2000-resample bootstrap of a range fit about a second.*
  11. *With `cut0`, a continuous candidate is cut off at zero (core section 7c, `fitCut`; the page
     says "truncated below zero" wherever a reader sees it, and the code says cut): its
     start, minimum, or the normal's left tail may lie below 0, the part below 0 is removed, and
     the rest is scaled up, F_cut(v) = (F(v) − F(0)) / (1 − F(0)). The cut is stored as `fit.cut`
     (the bound, 0) and `fit.cutMass` (F(0) before the cut) and applied in `fitCdf`, `fitPdf`,
     `fitQuantile`, `fitSampler` (draw again while below the bound, or invert past a 75% cut),
     `fitLo`, and `fitMean`, and so everything downstream reads it. `CUT_KEYS` lists the families
     cut: not the exponential (cut, it is the same exponential whatever its shift), the uniform,
     the Pearson type VI, or the empirical and discrete families. The fit maximizes the cut
     likelihood by Nelder–Mead from the held and the unconstrained ordinary fits and keeps the held
     fit when cutting gains nothing; a mirror image always reaches below 0 and is always cut. The
     shifted families and the beta may cut at most `CUT_MAX_MASS` (half) of themselves: without the
     limit, a cut gamma, lognormal, or Weibull ran its start off thousands of units below 0 in a
     quarter of samples of 150, and with it, 7 to 12 of 30 fits stop at the limit and the share
     they cut runs high, because the data place their start only loosely. The normal, the Johnson
     members, the triangular, and the PERT may cut up to `CUT_DEEP_MASS` (99.9%), and so a normal
     can peak below 0; it recovered a normal(−2, 2) cut at 0 and never reached the limit. A fit at
     its limit is `cutLimit`. A start, a mirror image's end, or a beta's lower end also stops
     `JOHNSON_EDGE` (20) ranges from the data (`startLimit`, labeled and explained in the note, the
     scripts holding to the same wall): within the share limit, a log-logistic ran off toward its
     logistic limit to a start of −66488 and a scale of 66490, and its six-figure export lines drew
     a mean of 1.519 for a model whose mean is 1.560. In the default mode (`floor0` alone), a family that cannot produce
     an exact 0 in the data once its start or minimum is held at 0 is cut instead of failing
     (`cutForZero`), and its bootstrap refits with the cut too. The fit card's `cutNote` says what
     was cut and why, that the parameters describe the model before the cut, when a fit stopped at
     its limit, that a shifted family's start is placed only loosely, and, when the data hold an
     exact 0 that a resample would rarely reproduce, that the A–D p-value runs low; the table labels
     a row cut for an exact 0 or stopped at its limit, and `derivedRows` gives a cut model's own
     mean and median. Exports (`cutExpressions`): R, MATLAB, and Python draw every cut family exactly,
     a uniform mapped into the part kept through NORTA's quantile writers (`nortaVecQuantile` reads a
     cut fit's quantile as the whole model's at 1 − (1 − m)(1 − U)); Arena, Simio, and AnyLogic draw
     the Weibull and the log-logistic exactly in one expression with one uniform, mirrored or not,
     and every other family there gets the uncut line with a note on drawing again until the value
     is at or above 0 (an Arena Decide loop, a Simio process loop, an AnyLogic do-while). Every
     exact line is held at 0 by a maximum that absorbs only rounding. NORTA's Arena, Simio, and
     AnyLogic blocks refuse a cut family written in Z, for want of the normal quantile. The Simio
     closed forms use only documented functions but have not been run in Simio. Arena (Academic,
     16.2x, 100,000 draws) and AnyLogic 8.9.10 PLE (1,000,000 draws) ran the truncated Weibull and
     log-logistic lines, mirrored and not, and a gamma with a lump at 0, unchanged on 2026-11-09:
     no draw below 0, every mean within 0.63%, the share at or below the median within 0.0034 of
     0.5, and the lump's share of zeros within 0.0031 of 0.54. The scripts
     (`rangeScripts`, now for ranges, a cut, or both) maximize the cut likelihood from the page's
     estimates, using each family's density in R and MATLAB (`RANGE_FAM`'s third entry) for values
     recorded exactly, and print each number beside the page's; a cut shifted family's or beta's
     estimates, which the data place only loosely, print without a verdict. Python's Nelder–Mead
     gets a looser point tolerance than value tolerance, as SciPy stops only when both settle and a
     flat ridge kept it running to its cap. The ranking CSV leaves a cut row's Arena column empty
     unless the line is exact. Section 16e of the verify checks
     the cut functions against each other and the truncated normal's closed forms, the limits,
     the minimum hold, exact zeros, ranges, the mirror image, and the bootstrap's calibration (a
     cut normal and a cut gamma at 4.0% to 5.5%, and data recorded to 0.1 with exact zeros in the
     default mode at 6.0% (K–S) and 8.0% (A–D), against a nominal 5%).*
  12. *Exact zeros can be set aside as a lump at 0 (`#lump-chk` under the data, offered by
     `lumpInfo` when the values are continuous, none is below 0, at least one is exactly 0, and at
     least two are above it; off on every new load). `ST.xAll` and `ST.sAll` hold every value and
     feed the data cards; `applyLump` sets `ST.x` and `ST.s`, which everything else reads, to the
     values above 0 while the box is ticked. The fits, tests, bootstrap, plots, scripts, and the
     data CSV (whose header says so) then see only those values; `withZeroLump` (core) writes the
     lump into every tool's line, with one uniform for it (Arena's comparison as 0 or 1, Simio's
     `Math.If`, AnyLogic's ternary, R's `ifelse`, MATLAB's mask, NumPy's `where`, SciPy's frozen
     model drawn with `rvs` first), and the scripts open by saying the zeros were set aside.
     `lumpNote` states p0 and the mean with the zeros, or, while the box is clear, suggests it
     when three or more exact zeros sit in values recorded exactly (a continuous model gives 0 no
     probability; the model itself is no guide, since a beta or gamma with a shape below 1 piles
     its density against 0 to reach them), or, for a range fit, when the zeros outnumber the 0
     range's expected count. A fit made with the zeros set aside is not handed to tab ③ or ④,
     which cannot draw the lump. On exact values, a truncated beta's lower end stays a thousandth
     of the range below the smallest value, as the shifted families' starts do: on a block of
     zeros it otherwise ran up to within 1e-317 of 0, where the likelihood has no maximum. Section
     16f of the verify checks the lines' form, draws from the AnyLogic line as JavaScript and from
     the R and Python lines (share of zeros and the rest against the model), and that beta.)*
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
