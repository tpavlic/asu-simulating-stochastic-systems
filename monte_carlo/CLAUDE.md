# CLAUDE.md — `monte_carlo/`

Notes for the widgets in this directory. Repository-wide conventions (head metadata, footer,
embedding, mobile, commit messages) are in the root `CLAUDE.md`.

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
