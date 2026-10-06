# Follow-up experiments on Arena `.dat` files and the Output Analyzer

Arena 16.20 (Academic), Output Analyzer from the same install, Apporto desktop, 2026-10-05. Same deterministic model as before (`dattes.doe`: constant arrivals every 2 min starting at t = 0, constant 1.5 min service on `Resource 1`, Record module writing `ExitTime = TNOW` and `Counter 1`, Time Persistent `ResBusy = NR(Resource 1)`, Output `NREP*10 + 0.5`, 3 replications). The companion archive `dattest_experiments.zip` (on the Apporto Desktop) holds the raw files in three folders: `equal20\` (3 × 20 min, no warm-up, plus all the `.flt`/`.fst` files below), `unequal\` (reps end at 10/20/30), and `warmup5\` (3 × 20 min with a 5-min warm-up, plus `freq1.dat` and the `.doe`).

## 1. Warm-up period (the one that matters for the counter convention)

Run Setup: Warm-up 5 minutes, Replication Length 20 minutes. Arena's replication length is the total run length including the warm-up, so the run spans [0, 20) with statistics cleared at t = 5. Everything else is identical to the `equal20` run.

What the files contain:

- `tp1.dat` (201): records start at **t = 0**, not 5. Each replication begins `(0,0) (0,1) (1.5,0) (2,1) (3.5,0) (4,1)` and then, at the warm-up instant, `(5,1) (5,1)`: a closing record for the warm-up segment and a re-opening record with the state at that moment (the resource is busy at t = 5 because the job that arrived at 4 is in service until 5.5). The pre-warm-up data are therefore in the file, with the clear marked only by that doubled record at t = 5. Per replication there are 25 records (vs 23 without warm-up); the file is 1362 bytes.
- `counter1.dat` (206): the count **restarts at 0 after the warm-up**. Rep 1 reads `(1.5,1) (3.5,2) (5.5,1) (7.5,2) (9.5,3) … (19.5,8)`; i.e., the pre-warm-up increments are present with their running count, then at 5.5 the count is 1 again. There is no explicit record at t = 5. Same 33 records / 692 bytes as before.
- `tally2.dat` (203): all ten observations `(1.5,1.5) (3.5,3.5) (5.5,5.5) … (19.5,19.5)` are present, including the two that fall inside the warm-up. 691 bytes, unchanged. A tally file carries no trace of the warm-up at all.
- `output1.dat` (204): unchanged.

What the Analyzer does with them: nothing special. Table (All, 0–21 step 1) shows ResBusy = 1 at t = 1–5 and the counter at 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, … for t = 0, 1, 2, …; it reads the pre-warm-up records as ordinary data and shows the counter dropping from 2 to 1 between t = 5 and t = 6. The Analyzer has no notion of where the statistics were cleared; a user who wants the warm-up excluded uses Batch/Truncate with Initial Time = 5.

Implications for the reader: the files do say where the run starts (time 0, as the first record), so "0 before the first record" is not creating a false five minutes. The file does not say where the warm-up ends. For 201 files it can be inferred from a duplicated-time pair whose two values are equal (`(5,1) (5,1)`), though a genuine zero-width segment at a change (`(20,1) (20,1)` at the end of the equal run) looks the same; for 206 files it can only be inferred from a count that decreases; for 203/204 files it cannot be inferred. If the widget wants to honor a warm-up, it has to take the value from the user, exactly as the Analyzer does.

## 2. Re-running with the same output file names

Ran the model twice in a row without deleting anything. Sizes and contents were identical before and after (692/259/219/691/1314 bytes); only the timestamps changed. Arena **overwrites** the `.dat` files; it does not append. (The `(-1,0) … (-3,-1)` block appears exactly once.) Six-replication files would only arise from a 6-replication run.

## 3. Other `.flt` shapes

All `.flt` files have the same container: type code `205`, `by:OUTPUT ANALYZER`, `File Version: OUT_ANALYZER`, `Data for:` the source statistic name, and the `Run date` field ends in the replication count.

- Observation batching, `tally2.dat` rep 1, batch size 3 (`equal20\tally2_obs3.flt`): records `(3.5, 3.5) (9.5, 9.5) (15.5, 15.5) (-1, -1)`. The first field is the **time of the middle observation of the batch** (observations at 1.5/3.5/5.5 → 3.5), which for odd sizes is also the mean of the observation times; the second is the batch mean. The 10th observation was dropped as a trailing partial batch; the summary says "Number of Trailing Obs'ns Truncated: 1" and covariance 0.5. Header says 1 replication.
- Time batching with truncation, `tp1.dat` rep 1, Initial Time 5, batch 5 (`equal20\tp1_trunc5_b5.flt`): `(7.5, 0.7) (12.5, 0.8) (17.5, 0.7) (-1, -1)`. The first field is the **batch midpoint** in original time (not re-based to 0 after truncation); the values are the time averages of `ResBusy` over [5,10), [10,15), [15,20), which are exactly 0.7, 0.8, 0.7 for this schedule. Summary: Initial Time Truncated 5, 3 batches, trailing time truncated 0, covariance −0.5.
- Observation batching with **Replications = All**, `tally2.dat`, size 3 (`equal20\tally2_all_obs3.flt`): the Analyzer produced **no summary window** (as with every "All" batch attempt earlier) but did write a 304-byte file: header claims 3 replications, payload is `(3.5,3.5) (9.5,9.5) (15.5,15.5) (-1,0) (0,0) (0,0) (0,0) (0,0)`. Only replication 1's batches are present, the rep-1 terminator says "more follow", and then four all-zero records with no `(-r,-1)` end marker. In other words, Batch/Truncate with "All" is broken in this build and leaves a malformed file. A reader should (a) not trust the header's replication count, (b) stop at the first record it cannot interpret rather than reading zero pairs as data at t = 0, and (c) be tolerant of a missing final terminator. The earlier `tp1_b10.flt` and `counter1_b10.flt` from "All" attempts (194/208 bytes) presumably have the same shape; they are in `equal20\` too.

Also in `equal20\`: `tally2_ma2.fst`, written by Graph > Moving Average (see item 6). Same container, type code 205, `Data for:ExitTime(1)`, records `(5.5,2.5) (7.5,4.5) … (19.5,16.5) (-1,-1)`.

## 4. Type 202 is Frequency

Added a Frequency module row: Type Value, Expression `NR(Resource 1)`, Collection Period Entire Replication, categories Busy = 1 and Idle = 0, Output File `freq1.dat`. Header: `207 ` (not 202), `Data for:Frequency 1`, otherwise standard `ARENA_40_OUT1`. So the codes are 201 DSTAT, 203 TALLY, 204 OUTPUT, 205 Analyzer-written, 206 COUNTER, 207 FREQUENCY; 202 remains unobserved (perhaps a legacy SIMAN type).

Payload: 75 records, 1366 bytes, identical in structure to the time-persistent file: `(0,0) (0,1) (1.5,0) (2,1) … (20,1) (20,1) (-1,0) …`, i.e., the raw value of the expression over time, with the same warm-up doubling at t = 5 as `tp1.dat` (this file was written in the warm-up run). The category definitions are not in the file; the Analyzer shows it in Table exactly like `ResBusy`. A reader can treat 207 as 201.

## 5. Classical CI on `tally2.dat` (equal run), All vs Lumped

- **All**: three intervals, one per replication, each computed from that replication's 10 observations: average 10.5, standard deviation 6.06, 0.95 half-width 4.33, min 1.5, max 19.5, N = 10 (t₉ = 2.262 × 6.06/√10 = 4.33). The "Observation Intervals" chart draws min–max whiskers and the CI bar per replication.
- **Lumped**: one interval from all 30 observations pooled: average 10.5, SD 5.84, half-width 2.18, min 1.5, max 19.5, N = 30 (t₂₉ = 2.045 × 5.84/√30 = 2.18).

Neither is an interval across replication means (which here would be degenerate, since all three replication means are exactly 10.5). The Analyzer's Classical CI treats individual tally observations as the sample and, with "All", never combines replications; "Lumped" pools them as if independent.

## 6. Moving Average (Graph > Moving Average, `tally2.dat` rep 1, Value 2)

The "smoothed" value at observation k is the **mean of the previous 2 observations (a trailing, one-step-ahead forecast)**, not a centered window: no value for the first two observations, then 2.5 at t = 5.5 (= (1.5+3.5)/2), 4.5 at 7.5, …, 16.5 at 19.5. The table reports "absolute deviation" = |actual − smooth| = 3 for each, Total 24, Mean Abs. Deviation 2.667 (24/9, i.e., divided by N−1 = 9 rather than by the 8 forecasts), Mean Bias −2.667. The saved `.fst` file holds `(t_k, smooth_k)` for the forecast points only. For the Welch-plot page this means the Analyzer's "moving average" is a forecasting smoother and is not the same thing as a centered Welch window.

## Environment notes

Batch/Truncate with Replications = "All" writes a broken file and shows a summary of −1s or no summary at all; use a single replication number or "Lumped". The Output Analyzer locks every `.dat` it has open (Compress-Archive failed until I exited it), so students who re-run Arena with the Analyzer open on the same file may get an FOPEN error. Long pasted commands in the Apporto session drop characters; keep commands short if you script against this desktop.
