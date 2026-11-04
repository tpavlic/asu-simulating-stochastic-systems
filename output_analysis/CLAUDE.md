# CLAUDE.md — `output_analysis/`

Notes for the widgets in this directory. The Output Analyzer in `output_analyzer/` has its own
`CLAUDE.md` there. Repository-wide conventions (head metadata, footer, embedding, mobile, commit
messages) are in the root `CLAUDE.md`.

- `output_analysis/ci_explorer.html` *(confidence intervals taught by experiment: tab ① draws n
  values from N(μ, σ²), forms the t interval, and keeps a history whose true-mean line steps when μ
  changes; tab ② builds a confidence interval and a prediction interval from one sample of a
  normal, uniform, or exponential population (each set by μ and σ alone), judges the CI against μ
  and the PI against one more draw taken after the sample, and shows the exact chance that the
  run's PI catches a new value, the population's own middle 1 − α as a third teal row under the
  two intervals, two histories on one y-window (the PI history marks each miss's side with a
  caret, and its caption sets the below/above counts against α/2 each), a histogram of where each
  next value landed in units of S, (next − x̄)/S, against the exact normal-theory density with the
  PI's ends at ±t·√(1 + 1/n) (it counts every run since the shape, μ, σ, or n last changed, not
  only the columns the history has room for, and a level change moves only the end lines), the half-widths against n (with S replaced by σ, the PI's leveling
  off at z·σ), and each shape's large-n PI coverage split by side. A total miss rate alone hides
  the exponential's failure (about 5% at 95%), which is why the side of each miss is shown three
  ways. For the normal shape a seed gives tab ①'s sample and interval exactly. The tab strip groups
  ① and ② under "Interval estimates", and so their tabs read "Confidence" and "Prediction";
  tab ③ reads "CRN", with the full name in a tooltip and its aria-label, because with every
  name in full the strip needs 977px of the widget's 984px; tabs ③–⑤ apply
  common random numbers, antithetic variates, and control variates to a
  shared five-model menu (the identity, exp(u), √u, 1/(1 + u), and the bowl) whose exact moments the
  verify script pins, each as a plain history over an improved one on a shared scale; tab ⑥ applies
  importance sampling to a normal input through its own three-model menu (x, exp(x), and x²), with
  the threshold on the output scale, the shift aimed at the input threshold, and closed-form tail
  probabilities. Conventions relied on by code outside the file, which any later edit has to
  preserve:*
  1. *Everything between the `CI-CORE-BEGIN` / `CI-CORE-END` sentinels is pure numerics with no DOM
     access (the block must not contain the words "window" or "document").
     `output_analysis/verify_ci_explorer.mjs` slices that block out of the HTML and runs it in Node.*
  2. *`verify_ci_explorer.mjs` is not shipped with the widget and is not linked from the site. Run
     it (`node output_analysis/verify_ci_explorer.mjs`, about four minutes;
     `CI_CALIB_REPS` shortens the calibration sections) after touching anything in the core. It
     checks the special functions against exact identities and t tables, capture rates against
     1 − α for every tab, each population shape's draws, cdf, and pdf, the prediction interval's
     coverage under normality and its large-n limit and miss side for the other shapes, the
     paired-to-Welch half-width ratio against √(1 − ρ), the function menu's moments against their
     closed forms (the exp(u) pair-mean standard error of 0.0028 and c* of 1.690), the
     importance-sampling estimator's unbiasedness, and tab ⑥'s output densities: it integrates
     each to 1, checks its tail mass beyond T against the closed-form truth, and pins
     the x² model's silent-failure numbers (a weighted estimate at half the truth, near-zero
     capture, and a healthy ESS that gives no warning).*
  3. *The function menu shared by tabs ③–⑤ carries exact moments (`mean`, `m2`, `cross`, `covU`)
     that the verify script pins, and so adding a function means deriving its four moments, not
     only its formula. The `bowl` entry is the deliberate counterexample on which neither
     technique helps and must stay non-monotone with zero covariance.)*
- `output_analysis/multiple_comparisons.html` *(the multiple-comparisons problem taught by
  simulation: seven pages share one family-drawing engine over K simulated designs
  of one system, each replicated R times, with bigger is better as the default direction and every
  page's controls split into what the experimenter chooses and what is true of the designs but
  hidden. Navigation is the grouped pill picker (as in the distribution gallery), the seven pages
  in two groups, "The problem and the usual correction" and "One-shot and sequential alternatives",
  collapsing to a select on narrow screens, with page ① the landing page and the shared situation
  stated once in the header's subtitle. ① Fishing Across K Responses simulates
  the null, one design judged on K responses each with its true mean exactly at its own baseline (one
  small panel per response, on its own scale in its own units), so every flag
  is a false alarm, and tracks the family-wise error rate against the uncorrected and
  Bonferroni-corrected bounds, naming Hotelling's T² and MANOVA as the one-shot versions; ② Fishing Across K Designs runs the same test against a benchmark design or over
  every pair, with common random numbers optional; ③ Can We Just Pick the Best Mean? reports the ordinary
  interval of whichever design's sample mean is best and shows its coverage falling below its
  nominal level; ④ Fewer False Alarms, Fewer Detections plants a real difference and judges the same raw
  p-values three ways at once (none, Bonferroni, and Holm's step-down) to show the power
  Bonferroni gives up and Holm partly recovers, its figure drawing the intervals the selected
  rule gives (uncorrected, Bonferroni, or under Holm each reached comparison at the level of its
  own step and the comparisons past the stop as the whole line, with the caption saying
  these are not confidence intervals; `holmIntervals` in the core), with the interval width
  ratio as a card, and closes the group by pointing at the one-shot alternatives; ⑤ ANOVA and Post Hoc Tests runs
  one-way ANOVA and judges every pair by Tukey's HSD, Fisher's protected LSD, and Bonferroni side
  by side, with a compact-letter display, a pairwise matrix sized to the means plot beside it, and a
  toggle to order the designs by sample mean; and ⑥ Selecting the Best in Two Stages animates the
  textbook's ranking-and-selection procedure stage by stage: a first-stage screen, second-stage
  sizing from Rinott's constant, the added replications, and the final selection, with two
  tallies judged by one rule (the best design or one within ε of it), how often such a design
  survived screening (the screen's own subset-selection guarantee, 1 − α/2) and how often the
  selection was one (1 − α), and a note that the
  survivor set is what a best-scenario chart that stops after screening reports; and ⑦ Simulation
  Optimization closes the arc with no simulated data: a stepped flowchart of the adaptive
  search loop (propose, simulate, estimate, judge, update, report), the metaheuristic and
  response-surface families that drive it, where ranking and selection fits inside it, and what
  the noise does to a reported best. While a correction is selected, tabs ① to ④ also draw each
  interval's uncorrected 1 − α version as a pale slate band (`--ghost`) behind the corrected one,
  from the `rawLo` and `rawHi` that `oneSampleFamily`, `pairFamily`, and `winnerFamily` record, so
  that the corrected line running past the band is the width the correction adds; the colors
  and decisions stay the corrected ones, a "Show uncorrected intervals" checkbox (ticked by
  default) turns the bands off, and with no correction selected the checkbox is grayed. Every history
  strip names what a column counts and its caption carries the family-level tally with its
  reference, and every page runs once by itself the first time it is shown, so a reader lands on
  a drawn family rather than an empty frame. Tabs ② and ④ open with "Each design's replications" above their
  differences (`replicationsPlot`): every replication of the latest run as a faint dot, each
  design's sample mean, and its true mean, over faint horizontal rules at every tick and at the
  unmoved designs' shared mean of 10, with no per-design interval because overlapping
  intervals say nothing reliable about a difference; under common random numbers a gray line
  joins each replication across the designs. The run's outputs are redrawn from its stored seed
  rather than kept in the history, and no post-processing knob changes the figure. Tab ⑥'s figure
  (`lanesPlot`) is two panels sharing one lane per design, the first stage and screening on the
  left and the second stage and selection on the right, on one x span with the same ticks, so that
  a lane reads as one design seen twice; a survivor's first-stage replications reappear in gray in
  the right panel beside the ones the second stage added, so that the overall mean visibly stands
  on both; until a right-hand row has marks of its own, a short note says where the procedure
  stands for that design ("awaits screening (press Step)" before screening, then "screened out",
  "survived screening", or "only survivor: no second stage"), right-aligned at the row's end in
  line with the sizes column, so that mid-Step the panel reads as waiting rather than broken. Below 560px the two panels interleave as the upper and lower row of
  each lane rather than stacking, so that the lane still reads as one design, with "First" and
  "Second" at the left edge of the two sub-rows and the selection outline ringing the whole lane. Between the figure and its legend, the procedure's five steps
  are listed in full (`BEST_STAGES`) under two headings, "Stage 1" for the left panel's sample and
  screen steps and "Stage 2" for the right panel's size, sample again, and select steps, so that
  the title's two stages and the five steps are one hierarchy; each step is a bold "Step n of 5,
  verb:" and a phrase, with the step reached marked by an accent bar and wash and the steps not
  yet reached faded; listing all five
  keeps the block one height at every step without reserving blank space. The legend is two
  groups headed by the panel titles, each listing only its own panel's marks, laid out as two
  columns under their panels (sized from the geometry `lanesPlot` returns, each group's entries in
  one column, and each swatch drawn at its mark's own width) on a wide screen and stacked on a
  narrow one. Prose after a page's last figure follows page ①'s shape: a paragraph
  that reads a number or figure on the page stays expanded under a `.note-hd` heading, and a
  paragraph about what the page does not show (a variant, another tool, an assumption, a related
  method) goes into a collapsed `details.why` box. Commit tag `compare`. Conventions relied on by code outside the file, which any later
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
  3. *A knob is a sampling knob (K, R, σ, δ, the configuration, the direction, common random
     numbers, tab ⑥'s ε and confidence, and whatever else changes which data would be drawn) or a
     post-processing knob, marked `data-post` in the markup (α on tabs ① to ⑤, the comparisons
     setting on tabs ② and ④, the interval level on tabs ①, ②, and ③, the correction rule on tab
     ④, and the post-hoc rule and the sort-by-mean toggle on tab ⑤): a post-processing change
     re-derives every already-drawn family from its own stored seed and sampling parameters rather
     than drawing new data, and so it neither logs a new run nor clears the history. A
     sampling-knob change instead opens a new segment on the next run, marked with a divider;
     every plot's axis is sized once from that segment's own sampling parameters and held fixed
     for every run added to it, rather than being fixed globally or recomputed run by run (the
     one exception is the history strip's count axis on tabs ② and ④, whose maximum is the
     number of comparisons C and so follows the comparisons setting). Each simulated tab's control
     card shows the split in the order of the work: "Chosen by the experimenter before the data
     are gathered" holds the sampling knobs the experimenter sets, "True of the simulated designs,
     hidden from the experimenter" the planted truth, then the seed and Run row, and last, under
     its own rule, "Chosen by the experimenter after the data are gathered" with the
     post-processing knobs; tab ⑥ has no after group because its α and ε size the second stage
     and so change the data drawn.*
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
     configuration puts the simulated designs in the slippage configuration, the standard hard case
     for the 1 − α guarantee. The strip's current column stays
     in the history mid-Step (`pending`, not yet resolved) so the column count and the axis never
     change once the run's outcome is revealed, but its own bar is drawn only once stage 4 reveals
     whether the selection was correct.)*
