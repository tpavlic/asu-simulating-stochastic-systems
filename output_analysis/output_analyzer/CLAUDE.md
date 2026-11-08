# CLAUDE.md — `output_analysis/output_analyzer/`

Notes for the Output Analyzer. Repository-wide conventions (head metadata, footer, embedding,
mobile, commit messages) are in the root `CLAUDE.md`.

- `output_analysis/output_analyzer/output_analyzer.html` *(the Output Analyzer: a browser replacement for the
  output-analysis utility bundled with a commercial simulation package, and for the comparison and
  best-scenario parts of its process analyzer, built as one entry page plus native ES modules under
  its `js/` directory with no build step. Nine pages behind a four-group navigation (Data, Analysis, Session, More information) that is a sticky left sidebar at 1100px and
  wider, a bracketed one-line tab strip down to 700px (the Canvas column), and a `<select>` below:
  three pages (② Summary and Plots, ⑤ Several Systems, ⑦ Steady State) carry a second level of
  sub-sections shown one at a time, routed as `#several/anova` and listed under the page in the
  sidebar and indented in the select; a section the shown data or settings cannot fill is grayed
  and inert in the page's own strip, the sidebar, and the select, with a tooltip saying why: ① Import
  (loaded datasets first, then the bundled examples, then drag-and-drop, file, and paste; time–value records with a −1 replication
  delimiter, delimited columns with a mapping dialog that asks tally versus time-persistent rather
  than guessing, wide files with a response picker, a scenario column splitting into one dataset per
  design, and a box declaring the replication ids blocks (one id in different scenarios is one
  block: the same random-number stream, subject, batch, or day), ticked when the replication column
  is headed `block`; every dataset one accepted file makes shares a `loadId` (set only when the
  file has a replication column) and carries `blocks`, which the "ids are blocks" box on each of
  those datasets' rows in the loaded-datasets table changes for all of them at once (`setBlocks`
  in `js/state.js`); a box loading replications run in antithetic pairs as their pair averages
  (`pairAverages` in `js/data/model.js`: each replication's outcome is computed first, as on every
  page, and outcomes 1 and 2, 3 and 4, … are averaged into one replication value each, with ids
  such as `1-2`; no observation is paired, none is loaded, and the dataset takes its name with
  " (pair averages)", with `source.pairs` set and a note giving the correlation within the pairs
  and the variance ratio that the dialog's preview also shows; numbered replications must come as
  1 and 2, 3 and 4, …, so that a missing one never shifts the pairs, and other ids pair by
  position; refused for an odd count, fewer than four, a replication with no outcome, or numbered
  replications that are not whole pairs in order); every rejected row listed with its line number; and the binary `.dat` files Arena
  writes for its Output Analyzer, and the `.flt` and `.fst` files that analyzer writes, read by
  `js/io/arena.js` without a dialog because their header names the statistic and its kind
  (unless "Open Arena files in a dialog" under the drop zone is ticked, which opens each in a
  short dialog holding only the antithetic-pairs box),
  and the text that analyzer's File, Data File, Export command writes (All or Lumped), which
  `isArenaText` tells apart by its content, never by a `.txt` name, since a delimited file may
  carry one, and a lumped output file is read as one value per replication numbered by each
  record's time; each treated as the Output Analyzer treats it: 201 time-persistent, 207 frequency, and 206
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
  by side (`sampleDataset` in `js/data/model.js`, blank where nothing holds, with its own CSV), nine plot types offered only where meaningful for the data's kind, among them a
  Distribution section whose histogram bins by `histChoice` in `js/ui/rules.js`: one bar per value
  (`histogram(values, { perValue: true })` in `js/stats/descriptive.js`, on the half-integers across
  the span of whole numbers and otherwise halfway between neighboring distinct values) by default when
  the values look discrete by rules adapted from the Input Analyzer's, with its repeat requirement
  at every size because a few replications would otherwise be called discrete too often
  (`looksDiscrete`: whole non-negative numbers each seen twice on average with at most 30 distinct
  values or at most 10√mean of them, or at most ten exact values each seen three times on average),
  offered as a "One per value" switch whenever it
  takes at most 150 bars, with a table of the distinct values, their counts, and proportions under
  the plots while it is on (at most 30 values); otherwise k equal-width bins from the smallest value
  to the largest, Sturges' rule (`sturgesBins`, ⌈log₂ n + 1⌉ as R's `hist` takes by default, kept
  between 3 and 40) unless the slider or spinner sets k, the row's note giving the count and width of
  the bins, and an Auto button, pressed while the count is Sturges', that puts it back, its tooltip
  the one place the rule is named with its formula (the page is not there to teach the rule, as the
  Input Analyzer's note beside its Auto button is); the choice is
  kept per dataset (`hist:<ds id>`), and the regenerate scripts carry it as `hist_per_value` and
  `hist_bins` in their Settings and form the edges with `fig_value_edges` when a bar per value is on;
  a lag plot at
  a chosen lag k beside a correlogram to 400 lags with lag k highlighted, the lag set by a slider,
  a spinner, or a tap on a stem, and a Normality section
  with the normal quantile–quantile plot and the Shapiro–Wilk test of the replication outcomes, the
  test withheld on pooled observations because they are not independent, and an Equal variances
  section running Levene's test across a checklist of loaded datasets, whose ticks stand as the
  reader leaves them, even at one or none, with a line saying the test needs two or more
  (`initialTicks` in `js/ui/rules.js`)), ③ One System (the
  absolute analysis, laid out as Several Systems' sections are, each a figure or a control row
  over a table rather than a grid of cards: an "Interval estimates" section with the replication outcomes drawn first, then one table
  holding the t interval on one system's replication outcomes, or the Wilcoxon signed-rank
  interval on the pseudo-median behind a Procedure switch, and the prediction interval for one
  further outcome, with the pooled-observations override behind a warning; under a transform, the
  carried-back values are the table's last columns; a "Test against a stated mean" box above the
  figure, off by default (ticked, a field for μ₀ appears beside it, the figure draws μ₀ as a dashed
  line that can be dragged, the field and the test following it, and draws the interval red and
  dashed with a hollow dot when it excludes μ₀, as Several Systems flags an interval that excludes
  the benchmark, and the four figure helpers' `fig_strips` do the same for an interval that excludes
  `ref`), with the test written as a note row under the confidence interval's own row of the table
  (`rowNote`: a verdict badge, then the one-sample t statistic, the critical t, and its p-value in
  the verdict's color, red for a rejection and the indigo `--ok` otherwise, and the reading of the
  verdict on its own line; the signed-rank test at μ₀ under the rank procedure); off, the page, its
  export tables, the Report page, and the scripts carry no test, and the provenance says the stated
  mean is "none", as Several Systems' benchmark does when it is off; the card's sub-sections are headed by `.sub-hd`, the within-card
  heading style Summary and Plots' sub-sections share; and in the same card a "Confidence interval on a quantile" sub-section
  (a one-row table: the point estimate Y₍⌈pR⌉₎, the distribution-free
  interval from two order statistics with α/2 of the binomial probability in each tail, the
  ranks SciPy's `quantile_test` returns, shown in brackets beside the ranks [r, s] and the
  achieved confidence, with the interpolated quantile and the choice of ranks in a footnote;
  when the sample is too small for both ends it gives the one bound it can in brackets with a
  dash for the other, its confidence, and the smallest R at which both ends exist), then a "Confidence interval on the variance" sub-section (the chi-square
  interval as a one-row table, last because it is about spread where the mean, the prediction
  interval, and the quantile are about where outcomes lie, its lede saying it is the variance of
  the outcomes, not of their mean), and a "How many replications for the confidence interval on the mean" card by target
  half-width or by target power of the one-sample t test), ④ Two Systems (the relative analysis: Welch by default, with the
  pooled-variance t as a Procedure choice whose checks line adds Levene's test; paired
  only when the reader declares it, never inferred from the data: the Independent/Paired switch
  opens Paired exactly when both datasets come from one load whose ids are blocks
  (`pairingDefault` in `js/ui/rules.js`; datasets from different files open Independent even when
  each marked its blocks), with a note under the switch saying why, and the reader's own choice is
  kept per pair of datasets (`mode:<A id>|<B id>`); a Paired the reader pressed carries over to a
  later pair that has no choice of its own and opens Independent by default, when both datasets
  were loaded at the time of the press (`mode:last` holds the mode and the ids loaded then, so a
  file loaded later never inherits it) and at least two replications match, with the note saying
  it was carried over and to choose Independent if the designs did not share a block, and a note
  saying why it was not carried when too few match; an Independent press never carries, because
  a file marked as blocks opens Paired on its own evidence; the figures label each design by its
  role and then its name in parentheses, "A (fast)" and "B (slow)", never dropping the letter
  even when the name is one (`roleLabels` in `js/ui/rules.js`); matched on replication id or position (declared
  blocks always by id) with unmatched replications listed and counted in the experimental-unit
  line; a Procedure
  switch to the Wilcoxon rank-sum or signed-rank test with the Hodges–Lehmann estimate and its
  interval; in paired mode the differences strip plus a switchable pair view, by replication with
  filled A and hollow B joined per pair, or as slopes between two columns; replications per design
  by half-width on the difference or by power), ⑤ Several Systems
  ("Benchmark comparison", Bonferroni simultaneous means with an optional benchmark drawn as a
  draggable line that declares each design above or below it when its interval excludes it, and
  "Pairwise comparisons", Bonferroni differences, all pairs or versus a control, the sections
  titled by the question asked rather than by the correction, each with a "Decide by" switch
  (Bonferroni by default, or Holm, shown where the family has two or more comparisons) that
  declares a design or pair by Holm's step-down on its own test (the one-sample t or signed-rank
  test against the benchmark, the Welch, paired, rank-sum, or signed-rank test between designs)
  while the intervals stay Bonferroni's, and so a declared row whose interval excludes the
  reference is red and dashed, one declared by Holm alone is drawn plainly with a red "(Holm)"
  decision at its right edge (`note` on `intervals` in `js/ui/plots.js`), and every row carries
  its decision under either rule, so that the plot keeps its width as the switch moves
  (`benchmarkFamily`, `adjustP`, and `declareFamily` in `js/stats/compare.js`,
  `benchmarkFamilyRank` in `js/stats/nonparam.js`); under Holm, a "Show step-down intervals"
  box, off by default, draws each row's interval at the level of its own step in the step-down
  (the r-th smallest p-value at 1 − α/(C − r + 1), `stepDownLevels` in `js/stats/compare.js`)
  and a row past the stop, "not reached", across the whole axis with an arrowhead at each end
  (never tested, it is in effect tested at a threshold of 0, whose interval is the 100% one;
  `intervals` runs an infinite end to the edge), with the axis held to the
  Bonferroni intervals and the rows redrawn in place as the benchmark line is dragged (the
  `update` that `intervals` returns); the captions say these are not confidence intervals, the
  table keeps Bonferroni's, and the scripts draw them through `step_down_levels`; and each section has a
  "How many replications" card at its foot sized by a target half-width, as the ANOVA section has
  one sized by the F test's target power (under Welch's analysis, that plan still takes σ and the
  grand mean from the ordinary one-way analysis, and the card says it assumes a common σ; the
  scripts do the same), the rank procedures taking the t plan inflated by π/3;
  one-way ANOVA opened by
  Levene's test of equal variances (Brown–Forsythe, median-centered), with Tukey–Kramer, protected
  LSD, Bonferroni, Holm, and Dunnett post-hoc tests and a compact letter display carried on a
  design-level plot with letters and brackets for the pairs declared different, designs and pairs
  numbered 1…k throughout, and a Variances switch whose unequal setting runs Welch's analysis of
  variance with Games–Howell, Bonferroni-on-Welch-pairs, or Holm-on-Welch-pairs post-hoc rules
  (withheld under pairing, which has no Welch form); the two Holm rules give each pair a t, a p,
  and an adjusted p and no interval, and so under them the section draws no figure of
  differences; a page-wide Procedure switch whose nonparametric setting turns the
  Bonferroni means and differences into Wilcoxon intervals on pseudo-medians and shifts and the
  analysis section into the Kruskal–Wallis test (Friedman under pairing) with Dunn's or Friedman's
  pairwise comparisons under Bonferroni or Holm (the post-hoc rule select, relabeled "Pairwise
  adjustment", carries the choice), drawn as each design's Hodges–Lehmann pseudo-median
  with its Wilcoxon interval and the letters; and "Screen for the best", the textbook's subset-selection
  screen with indifference zone ε (its control lives in this section, since nothing else uses it)
  and Rinott second-stage sizes, drawn as the design plot with the
  survivors in color and the eliminated designs muted, under the t procedures only: the screen has
  no rank version, and so the nonparametric Procedure grays its section (`severalSectionsOff` in
  `js/ui/rules.js`), its open section grays the nonparametric button with a tooltip saying why
  (`rankProcWithheld`), a prominent warning stands in place of any result should the two meet
  anyway, its checks line advises more replications or a transform rather than a nonparametric
  procedure, and the regenerate scripts leave it out under the rank procedures; a page-wide "Show designs as" switch draws
  each design on every design plot as its center with its interval (the default) or as a Tukey
  box plot of its replication outcomes with the center as a diamond (the convention R,
  Matplotlib, and MATLAB's `boxchart` share, so that the four regenerated figures agree:
  `boxes` on the scripts' `fig_intervals`), with an "also each outcome" box that, under
  intervals, draws every outcome as a faint dot behind its row (`dots`); the intervals, the
  letters, the brackets, and every verdict are unchanged by the switch, and each caption says
  so; a "Replications are" switch declares that replication i of every
  design shares a block (common random numbers, or the same subject, batch, or day); it opens
  Paired exactly when every checked design comes from one load whose ids are blocks
  (`pairingDefault`), with a note saying why, and keeps the reader's choice per set of checked
  designs (`pairing:<sorted ids>`); paired, the replications are matched into blocks by id or by
  position (declared blocks always by id), the Bonferroni differences become
  paired t intervals, the analysis of variance blocks on the replication (its own row in the
  table, the post-hoc rules on the residual mean square), Friedman's test with Siegel–Castellan
  pairwise comparisons replaces Kruskal–Wallis and Dunn, and planning works on the paired
  differences and the blocked F test), ⑥ Steady
  State (Welch moving-average warm-up plot, the ensemble average across replications aligned by
  time bins (the default wherever the data carry time stamps, since a warm-up period is set in
  simulation software as a time) or by observation index, two "Also show" boxes that draw each
  replication's own series thin behind the averages and the t band on the ensemble average at
  each point (the textbook's mean plot with its control limits; `ensembleBand` in
  `js/stats/steadystate.js`, from the per-replication `rows` and `sd` the alignment functions
  return), with a draggable cut that is never
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
  chi-square interval on one system's variance is a "Confidence interval on the variance" section of One
  System, the F ratio of two variances a "Variances of A and B" section of Two Systems
  (independent mode), and the correlation lives only in Two Systems' paired Correlation r card;
  the hash `#variance` lands on One System. Each row of the Import page's table of loaded datasets
  has a name box, which renames the dataset when focus leaves it or on Enter (Enter keeps focus in
  the box); no two datasets share a name, because every data file and script is named from it and
  the all-datasets observations file tells datasets apart by it: `state.add` gives a new dataset a
  name in use the next free number, "name (2)" (`uniqueName` in `js/data/model.js`), and
  `state.rename` refuses a name in use, the box putting the old name back with a note under it, and an Export control revealing that dataset's data files, drawn by `fileButtons` in
  `js/ui/exportrow.js` as the export rows' are, with a "Preview the data" disclosure that shows the
  start of the observations file and the replication summary as the files write them (their `#`
  lines and first eight rows, read back by `csvHead` in `js/io/export.js`; `dataPreview` in
  `js/ui/exportrow.js`). "Export all" below the table writes two files,
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
  "Print this page" button, and Summary and Plots adds the shown dataset's data files
  (observations, one-column observations except for time-persistent data, and the replication
  summary). No file is written for a sample-size planner's pilot box: the help under the data
  files (`dataFilesHelp`, written for the dataset's kind) says to copy the replication summary's
  `mean` column, or for a paired pilot the `A` and `B` columns of Two Systems' Matched pairs
  table, which pairs replications as the page does. Every
  analysis page's export row also offers "Regenerate these results in" MATLAB, Base R, Tidy R, and
  Python: a script holding the data the page analyzed (replication outcomes on the inference pages,
  the run's records on Steady State and Summary and Plots), every choice made on the page, and code
  that recomputes every number shown, prints each under its section's heading, and ends in one
  line saying whether every number agrees with the page (a `check_details` setting prints each
  beside the analyzer's own value instead). It then draws every figure the page showed when the
  button was pressed: the section open, and on Two Systems the pair view, on Summary and Plots the
  pooled choice, the replication, the axis, and the lag. The scripts
  call each language's own procedure where it has one and carry a short function where it has none.
  In every language, they write out the Hodges–Lehmann estimates, Games–Howell, Rinott's constant,
  Fishman's test, the time-weighted averages, the compact letter display, and the replication-count
  searches. Outside R, they also write out the Wilcoxon intervals, Welch's analysis of variance, and
  Friedman's test, and Dunnett's critical value is written out everywhere but in SciPy on an
  unblocked design. Tidy R prints the same report lines as Base R through a tidyverse layer: the
  data as a tibble beside the vectors, the descriptives through dplyr, each test object through
  `broom::tidy()`, and ggplot2 for every figure, which the other scripts draw with base graphics,
  Matplotlib, and MATLAB's own plotting. The files are `<title>-analysis.R`, `<title>-analysis-tidy.R`, `<title>-analysis.py`,
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
  badge). The transform of the replication outcomes is a second shared setting (`state.settings.transform`,
  with the transforms in `js/stats/transform.js`: none, log, square root, arcsine square root, logit, and
  reciprocal), picked beside the level on One, Two, and Several Systems and inside Summary and Plots'
  Normality and Equal variances sections, the only sections it changes there. Every replication outcome is
  put through it before any inference; Steady State and the pooled observations never are. An outcome
  outside the transform's domain stops the page's result with a warning naming the replications and the
  transforms that do fit. Each page carries its intervals back to the response's units (the center is the
  geometric mean under the log and the harmonic mean under the reciprocal), and under the log Two and Several
  Systems carry differences back as ratios. A value the reader types in the response's units (a target, δ,
  the benchmark, ε) is kept per transform as well as per dataset. Every figure carries six buttons: SVG, PNG, COPY (the PNG, at two to three times its
  on-screen size, put on the clipboard, and left out where the browser cannot write an image
  there), and M, R, and PY, the last three being scripts (MATLAB, base-graphics R, matplotlib Python) that redraw the figure from the data
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
     `js/io/figure_scripts.js`, the four `js/io/figure_lib_*.js`, `js/ui/format.js`,
     `js/ui/rules.js`, and `js/data/model.js` are pure modules
     with no DOM access and must not contain the words "window" or "document";
     `node --test output_analysis/output_analyzer/test/` imports them directly (about thirty
     seconds, nearly all of it convention 11's smoke runs of the regenerate scripts in R, Tidy R,
     and Python; the other test files take about a second once matplotlib's font cache is warm). Run
     it after touching any of them. `test/scripts.test.mjs` also runs a generated R script under
     `Rscript` and a Python one under matplotlib when those are installed, and skips them otherwise;
     the MATLAB script is not run by the tests, and so after changing `js/io/scripts.js` run one
     through MATLAB (`matlab -batch`) as well. Small rules the pages apply live in `js/ui/rules.js`
     (`initialTicks` and `fRatioVerdict`), with the labels the figures and the scripts share
     (`roleLabels`, `outcomeAxis`, `estimateAxis`, and `shortNames`), which
     `test/page_rules.test.mjs` tests, and so no test
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
     by-hand `ptukey`/`qtukey` computation on each pair's Welch degrees of freedom. Holm's step-down
     is pinned in `holm.R` against `p.adjust(n = length(p))`, `t.test(x, mu)`, `wilcox.test(x, mu)`,
     `pairwise.t.test` (pooled and not), and a by-hand blocked computation on `aov`'s residual mean
     square, on data drawn so that Holm declares strictly more than Bonferroni in every family. On one to three
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
     written by a deterministic model whose every value is known, plus `text/`, two small
     files in the shape of the analyzer's own text export: `equal20/` (three 20-minute
     replications, with the Analyzer's batch, truncated-batch, observation-batch, moving-average,
     and malformed all-replications files), `unequal/` (replications ending at 10, 20, and 30,
     with the Analyzer's lumped `.flt`, an artifact kept as a fixture), and `warmup5/` (a 5-minute
     warm-up, with a frequency file); `test/arena.test.mjs` reads them and checks the reader
     against the documented values and the Analyzer's own numbers. Nothing in the directory is
     linked from the site.*
  5. *`js/data/examples.js` is generated by `data/generate_examples.mjs` (a seeded M/M/1 simulator,
     for the customers-served, versus-control, and six-designs examples the same queue with room
     for 4, 4, and 8 customers in all, half of six-designs' designs serving in Erlang times, and for the
     muffin-oven example a batch oven with a loading threshold) and must match
     `data/*` byte for byte; `test/examples.test.mjs` regenerates and compares, so
     change the generator, never the generated files. The examples run on common random numbers
     (`two-crn`, `four-crn`, `muffin-oven`) head their replication column `block` and set
     `blocks: true` in their mappings, so that they open paired whether loaded directly or through
     Assign its columns myself, and no other example does; the test checks both. The test also
     pins what the descriptions of `service-level`, `utilization`, `muffin-oven`,
     `customers-served`, `versus-control`, `four-designs`, and `six-designs` claim about their analyses
     (`customers-served` is the pooled one-way analysis of variance with neither Shapiro–Wilk on the
     residuals nor Levene's test flagging; `versus-control` is Holm against Bonferroni versus a
     control, Bonferroni declaring only E different from A and Holm's step-down all four, with
     Dunnett declaring only E; `four-designs` is the nonparametric one, its residuals
     failing Shapiro–Wilk, the pooled F test just missing, and Kruskal–Wallis just rejecting; and
     `six-designs` is the screen on unequal spreads, every design and the residuals passing
     Shapiro–Wilk while Levene's test rejects), and so a change of seeds or parameters has to keep
     those claims or reword them. The Import page lists the examples in groups by the page they
     serve, the simplest analysis first within each (`groups` in `js/pages/import.js`), and each
     title names the method first and then the response and size. `test/fixtures/six_designs_waits.csv`
     keeps the average waits that six-designs held before it became counts of customers served,
     which the Holm and step-down fixtures of `test/analysis_scripts.test.mjs` need.*
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
     for ④, one such dataset for ⑤ (one checked design gets the benchmark comparison alone,
     Bonferroni with k = 1 being the plain interval, and the pairwise, ANOVA, and screen sections
     are marked unavailable through `setSectionAvailable` until a second design is checked; the
     recipe then carries `several.single` and the scripts skip those sections and the
     differences' plan); a tally or time-persistent dataset for ⑥. The tooltip on a gray item says what
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
     The Input Analyzer carries a copy of the writers (see `input_modeling/CLAUDE.md`), which a
     change here is copied into.*
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
     may contain a backtick or `${`, which would end its template literal. A recipe's `transform` (an id
     from `js/stats/transform.js`) puts `outcome_transform` in the Settings block and, in the Data
     section after the data are in and before any tibble is built, a line sending every outcome through
     `transform_outcomes` (LIB's `transform`); the data blocks and the CSV files keep the outcomes as
     given, and the back-transformed and ratio report lines go through `back_transform` and
     `back_interval`. Summary and Plots transforms only in its Normality section (`x_tf`) and before
     Levene's test, and a transform its outcomes do not fit leaves both out. With no transform, a
     script carries none of these lines. Every string bound for a
     script passes through `ascii()`, which keeps every script 7-bit ASCII. R data blocks are
     one-line statements (a long vector is built by appending chunks) because Rscript's parse is
     quadratic in a long expression: a near-cap script took about three minutes as one expression
     and four seconds as statements. Every script prints its results through one `report` helper,
     which by default prints an aligned name and value (seven significant digits) under a heading
     for each section that reports (`report_section`, placed by `headings()` in
     `js/io/analysis_scripts.js`), checks the value against the analyzer's within the tolerance
     `tolFor` gives that name, and leaves `report_summary()`, after the last section that reports
     and before any figure, to say in one line whether every value agrees or to list those that do
     not. The Settings block sets `check_details`, and with it set (as `detailed()` in the harness
     sets it for every script the tests run) the helper prints the contract instead,
     `name: value   (analyzer: value)` lines, with numbers in `%.10g`, `NaN` for a missing number,
     and yes/no for a flag; the report names are defined by the emitters in
     `js/io/analysis_scripts.js`, pinned by `test/analysis_scripts.test.mjs`, and must stay
     identical and in the same order across the four scripts. Every choice a reader may edit is
     assigned in the script's Settings block; Several Systems' scripts form their pairwise and
     post-hoc comparisons from its `control` and `family` settings at run time and look up the
     analyzer's value for each pair by its label. They read the "Decide by" switches as `bench_adjust`
     and `diff_adjust` at run time too, and so a script reports each design's test against the
     benchmark under either rule, and adjusts the pairwise p-values in a second loop once every
     comparison has run (`bench_tests`, `bench_decision`, and `adjust_p` in `js/io/script_lib.js`).
     `test/analysis_scripts.test.mjs` writes each
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
     is not a pass after a change to its snippets. The figures come last, in a Figures section that
     `figureBlock` in `js/io/figure_scripts.js` writes from `FIGURES[page]`: each figure is one
     call of a helper the script carries, `fig_strips`, `fig_intervals`, `fig_pairs_by_rep`,
     `fig_pairs_slopes`, `fig_hist`, `fig_ecdf`, `fig_box`, `fig_qq`, `fig_series`,
     `fig_running`, `fig_lag`, `fig_acf`, `fig_warmup` (which takes the replications' rows and
     the band when the view showed them), or `fig_batches`, with `fig_value_edges` giving the
     histogram one bin per value, each written once per
     dialect in `js/io/figure_lib_r.js`, `figure_lib_tidy.js` (ggplot2), `figure_lib_py.js`
     (Matplotlib, imported only inside the helpers, with one `show_figures()` at the end and a
     guard that skips the figures when Matplotlib is missing), and `figure_lib_m.js` (core
     MATLAB graphics, options passed as a struct), under the contract stated at the top of
     `js/io/figure_scripts.js`.
     A helper named `common` in each holds what the others share, and so a script's own variables
     never take the helpers' `fig_` prefix. A page passes the view as `view` when the recipe is
     built, at the press of the button (`currentSection()` from `js/ui/tabs.js` and the page's
     own picks), and the recipe records what the figures need in `recipe.fig`; a figure follows
     the page's rules where that is cheap (the histogram's bins, the quantile-quantile plotting
     positions, the order of the designs, the letters and brackets) and is otherwise an
     approximation of the page's, since the scripts are templates. The harness's "Figures of
     every view" fixtures run each view in all four languages and count the figures R and
     Python draw. The tolerance is
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
