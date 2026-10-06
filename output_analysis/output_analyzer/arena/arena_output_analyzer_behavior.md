# How the Arena Output Analyzer treats counter files and unequal replication lengths

Empirical results from the real Output Analyzer (Arena 16.20, Apporto desktop, 2026-10-05), using the deterministic `dattest` model from `arena_dat_format.md`: constant arrivals every 2 min, constant 1.5 min service, so `ResBusy = NR(Resource 1)` toggles 1/0 and `Counter 1` increments by one at t = 1.5, 3.5, 5.5, …

## Question 1: counters

The Analyzer treats a counter file (type code 206) as a step function over time, exactly like a time-persistent (201) file, not as a set of observations and not as a final-count-per-replication summary.

Evidence:

- Analyze > Conf. Interval on Mean > Classical on `counter1.dat` gives the same refusal as for `tp1.dat`: "File contains time-persistent data. You must first Batch/Truncate the data."
- Graph > Table samples the counter on a time grid and holds the count between records. With 0.5-minute increments it shows 0 at t = 0, 0.5, 1 (before the first record), 1 at t = 1.5, 2, 2.5, 3, 2 at t = 3.5 … 10 at t = 19.5. Sampling exactly at a record time returns the new value.
- Analyze > Batch/Truncate (time-based, size 10, replication 1) on `counter1.dat` produced a batch mean of 2.25 at time 5. That is the time integral of the count step function over [0, 10) with the count taken as 0 before the first record: 2·1 + 2·2 + 2·3 + 2·4 + 0.5·5 = 22.5, divided by 10.

So the quantity the Analyzer attaches to a counter is the time-average count (and batch means thereof), not the final count. If the widget wants to match, load type 206 through the same time-persistent code path as type 201 with the convention "value is 0 before the first record." The "final count per replication" view is a reasonable extra (it is what the Arena category report prints), but it should be labeled as a widget convenience, since the Analyzer never computes it.

One detail that matters for integration: Arena writes a closing `(T_end, last_value)` record for time-persistent statistics but not for counters. The counter data therefore end at the last increment (19.5 here), and the Analyzer's second 10-minute batch [10, 20) was dropped as incomplete, whereas `tp1.dat`, with its closing `(20, 1)` record, produced both batches: `(5, 0.75)` and `(15, 0.75)`.

## Question 2: replications that end at different times

I reran the model with Replication Length = Infinite and Terminating Condition `TNOW >= 10*NREP`, so the three replications end at t = 10, 20, and 30. The file is otherwise the same format; the closing records are `(10,1)`, `(20,1)`, `(30,1)` and the terminators `(-1,0)`, `(-2,0)`, `(-3,-1)`.

With Replications = "All" (the normal choice), the Analyzer keeps every replication on its own time range and never extends a shorter replication:

- Graph > Table over 0–32 shows `ResBusy (1)` = 1 at t = 10 (its closing record) and 0 at t = 12 and beyond, `ResBusy (2)` = 0 from t = 22 on, `ResBusy (3)` = 0 only at t = 32. Values after a replication's last record display as 0, not as the held last value. The same happens for a single replication: after `tp1.dat`'s closing record at 20, the table shows 0 at 20.5, 21, …
- Graph > Plot draws the three replications as overlaid step functions on a shared time axis that runs to the longest replication (30); each trace simply stops at its own end (the last trace is drawn dropping to 0 at its final record).
- Batch/Truncate and the CI tools operate per replication, so the time average of a short replication is over its own interval. (Batch/Truncate with "All" selected returned −1 for every summary line and wrote no useful file; it wants a single replication number or "Lumped".)

With Replications = "Lumped", the Analyzer does not re-base time. Batch/Truncate (time-based, size 15) on the unequal-length `tp1.dat` returned a single batch `(7.5, 0.6)`. The value 0.6 = 9/15 is reproduced exactly by concatenating the records in file order and integrating with the raw times: rep 1 contributes 7.5 over [0, 10], the jump from rep 1's closing `(10, 1)` to rep 2's initial `(0, 0)` contributes −10, and rep 2's first 15 minutes contribute 11.5. Lumping is only meaningful for observational files (tallies, outputs); for time-persistent and counter files it produces artifacts, and the Table view ignores it anyway (still shows three separate columns).

## Recommendation for the widget

To stay consistent with the Analyzer: treat 206 like 201 (step function, 0 before the first record), compute every time-weighted statistic per replication over that replication's own `[t_first, t_last]`, where `t_last` is the closing record for 201 files and the last increment for 206 files, and when overlaying replications of different lengths on one axis, extend the axis to the longest replication but end each trace at its own last record rather than holding its value. The current behavior (hold the last value to the latest end) changes the shorter replications' time averages if those padded series are ever used for statistics, so if the hold is kept for plotting it should be display-only. Do not offer a "Lumped" mode for 201/206 data; the Analyzer's own result for that case is not a meaningful number.

## Files left in `Desktop\dattest`

- `equal20\` has the original equal-length run (all five `.dat` files, 20 minutes × 3) plus `counter1_b10.flt` and `tp1_b10.flt`, the batch-means files described above.
- The top-level `.dat` files are now from the unequal-length run (10/20/30), and `tp1_lump15.flt` is the Lumped batch result.

`.flt` files use the same container format with type code 205, `by:OUTPUT ANALYZER`, and `File Version: OUT_ANALYZER`; records are `(batch_midpoint_time, batch_mean)` followed by the usual `(-1, -1)` terminator. Their `Run date` field ends in `1`, which confirms that the trailing integer in that header line is the replication count.
