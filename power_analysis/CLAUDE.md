# CLAUDE.md — `power_analysis/`

Notes for the widget in this directory. Repository-wide conventions (head metadata, footer,
embedding, mobile, commit messages) are in the root `CLAUDE.md`.

- `power_analysis/power_explorer.html` *(statistical power taught by simulation: six tabs – a
  null-vs-alternative explorer over a registry of nine tests (z, t, pooled two-sample t at any
  group-size ratio, Welch's two-sample t, variance, proportion, chi-square GOF, one-way ANOVA,
  regression slope) with a Monte Carlo engine and solve-for-power/solve-for-n in both directions,
  power curves, an OC chart tab that carries its own test, α, sidedness, and chart-shaping inputs
  (independent of tabs ① and ②, which share one set of settings), a Paired Samples tab whose
  two cards each carry their own α, alternative, Δ, and target power (a pilot card that runs the
  paired-t power analysis on pasted pairs or differences (plotting pairs as a scatter with
  marginal histograms, and a single column of differences as a dot plot with the `tTestOne`
  interval at the card's α and alternative, whose Δ line drags Δ by pointer events), re-pairs
  the two columns in the box
  through `pairingOrder`/`repairText` as permutations of the order as entered, and sends its values
  to tab ① (opened solving for n, since the plan is the output) or to the card below, and a
  correlation card that sweeps ρ; a send keeps the full-precision values beside the boxes so the
  two cards agree exactly), an advanced tab whose
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
