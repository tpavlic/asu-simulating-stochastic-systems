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
  0, 1, 2, … by row, which refuses a missing count or a blank line inside the table because either
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
     input_modeling/verify_input_analyzer.mjs`, about three minutes on a multi-core machine) after
     touching anything in the core. Its slow Monte Carlo loops live in the jobs module and run on
     worker threads, one fewer than the cores, with the same seeds as a serial loop, and so the output
     is the same either way; `IA_SERIAL=1` runs them on one thread (about fifteen minutes), and
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
     data recorded to whole seconds with a spread of about ten seconds the bootstrap rejected a
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
     0.6 of the SD) was rejected by its rounded bootstrap about half the time on correct models
     (section 16b checks it). Above a step of `COARSE_STEP_SD` (0.5) of the SD, the tie note says
     the bootstrap p-values are approximate; at about 0.6, a correct shifted gamma was rejected up
     to about twice as often as nominal. Fitting to interval probabilities would remove the
     remaining error but would make every continuous fit a numerical search, and it was deferred
     for that reason.)*
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
