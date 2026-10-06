# Arena Output Analyzer `.dat` file format (ARENA_40_OUT1)

Reverse engineered on 2026-10-05 from files written by Arena 16.20.00 (Academic) on the ASU Apporto desktop, using a deterministic model so every value in the files is known exactly. The format is simple: a short CRLF text header, a single `0x1A` (Ctrl-Z) terminator byte, and then a flat array of little-endian IEEE-754 float64 pairs `(time, value)`. No compression, no database, no record framing.

## Layout

```
offset 0        : text header, CRLF-terminated lines (ASCII)
offset N        : 0x1A   (header terminator; also stops `type` from printing the binary tail)
offset N+1 ...  : repeated 16-byte records: float64 LE time, float64 LE value
```

The payload length is always a multiple of 16. The header length varies with the statistic name (162–173 bytes in the test files), so locate the payload by searching for the first `0x1A` byte rather than by a fixed offset.

### Header

Observed bytes of `output1.dat` (259 bytes total; header ends at offset 162):

```
204 \r\n
Output file for:Unnamed Project          by:EC2                      \r\n
Data for:Output 1\r\n
Run date:10/05/2026YDB          3\r\n
File Version: \x07ARENA_40_OUT1 \r\n
\x1a
```

Line by line:

1. A three-digit type code followed by a space. Observed codes: `201` time-persistent (Time Persistent module / DSTAT), `203` tally (Tally module, fed by Record), `204` output (Output module, one value per replication), `205` batch means written by the Output Analyzer's Batch/Truncate (`.flt` files, `by:OUTPUT ANALYZER`, `File Version: OUT_ANALYZER`), `206` counter (Counter module). Code 202 was not observed (probably Frequency). The Output Analyzer uses this code: given a `201` or a `206` file it refuses a classical CI with "File contains time-persistent data. You must first Batch/Truncate the data." (it treats counters as step functions over time; see `arena_output_analyzer_behavior.md`).
2. `Output file for:` + project name left-justified in a 25-character field + `by:` + analyst name left-justified in a 25-character field. ("Unnamed Project" and "EC2" are the Run Setup > Project Parameters defaults on that machine.)
3. `Data for:` + the statistic's Name/Report Label, not padded.
4. `Run date:` + `MM/DD/YYYY`, then a padded field ending in an integer that is the number of replications (`3` in the Arena-written files, `1` in the single-replication `.flt` files the Analyzer wrote). The `YDB` characters in that field (`YD` in `.flt` files) look like leftover bytes; the binary terminators (below) remain the authoritative replication count.
5. `File Version: ` + byte `0x07` + `ARENA_40_OUT1 ` (note the trailing space). The `0x07` is probably a length or flag byte, not a bell; treat the version string as the bytes between it and the CRLF.

### Payload records

Every record is `struct.unpack('<dd', ...)`. A record whose first element is negative is a replication terminator:

- `(-r, 0.0)` ends replication `r` and more replications follow.
- `(-r, -1.0)` ends replication `r` and the file.

All other records are data, with the first element a simulation time (in the model's base time units) or an index, depending on type:

| type | record meaning | example (deterministic test model) |
|---|---|---|
| 204 output | `(replication_number, value)`; exactly one data record per replication | `(1,10.5) (-1,0) (2,20.5) (-2,0) (3,30.5) (-3,-1)` |
| 203 tally | `(TNOW at observation, observed value)`; one record per observation | `(1.5,1.5) (3.5,3.5) … (19.5,19.5) (-1,0) …` |
| 206 counter | `(TNOW at increment, cumulative count after increment)` | `(1.5,1) (3.5,2) … (19.5,10) (-1,0) …` |
| 201 time-persistent | `(TNOW, new value)` step function; see below | `(0,0) (0,1) (1.5,0) (2,1) … (19.5,0) (20,1) (20,1) (-1,0) …` |

Counter files get no closing record: the data end at the last increment (19.5 here, not 20), and the Output Analyzer takes the count to be 0 before the first record.

Time-persistent files have three extra conventions: an initial record at the replication start time with the initial value (here `(0,0)` because the stat is initialized before the first arrival), one record per change in value (a change to the same value is not written, except as noted next), and a closing record `(T_end, last_value)` at the end of the replication so the final segment has a known duration. In the test the arrival at t=20 coincided with the replication end, so the closing record `(20,1)` duplicates the change record `(20,1)`; a zero-width segment, harmless when integrating. Time-weighted mean of a replication = Σ v_i (t_{i+1} − t_i) / (t_last − t_first), which gives exactly 0.75 for the test model (busy 1.5 of every 2 minutes).

## Ground truth for the test files (in `Desktop\dattest`)

Model `dattes.doe` (saved name got truncated from `dattest` while typing; harmless): Create (constant 2 min between arrivals, first at 0) → Process (Seize-Delay-Release `Resource 1`, constant 1.5 min) → Record → Dispose. Run Setup: 3 replications, 20 minutes each, base time unit minutes, no warm-up. Statistics written to DAT files (relative filenames, so they land next to the `.doe`):

| file | bytes | module | expression | expected contents per replication |
|---|---|---|---|---|
| `output1.dat` | 259 | Output | `NREP*10 + 0.5` | one value: 10.5, 20.5, 30.5 for reps 1–3 |
| `tally2.dat` | 691 | Tally `ExitTime` via Record (Expression `TNOW`) | — | 10 observations at t = 1.5, 3.5, …, 19.5 with value = t; mean 10.5 |
| `counter1.dat` | 692 | Counter `Counter 1` via Record (Count 1) | — | 10 records at t = 1.5, …, 19.5 with counts 1..10 |
| `tp1.dat` | 1314 | Time Persistent `ResBusy` | `NR(Resource 1)` | 23 records as shown above; time average 0.75 |
| `tally1.dat` | 222 | Tally wrongly named `Process 1.TotalTime` | — | no observations: just the three terminators `(-1,0) (-2,0) (-3,-1)`. Useful as an "empty statistic" edge case. |

Byte counts check: 162/163-byte header + 1 + 16 × (records + 3 terminators). For example `tp1.dat`: 161 + 1 + 16 × 72 = 1314.

## Practical notes for the widget

- Detection: first bytes are ASCII digits followed by `" \r\n"`, and an `0x1A` appears within the first few hundred bytes; the remainder length is a multiple of 16.
- The statistic name for labeling the series is the `Data for:` line. The type code tells you whether to treat the series as observations (203/204/206) or as a step function needing time-weighted statistics (201).
- Replication boundaries come from the negative-time terminators; do not count on the trailing integer in the `Run date` line.
- Two Arena environment gotchas (not format issues): an absolute `C:\Users\<user>\Desktop\...` path in the Output File field failed with `FOPEN ... No such file or directory` on Apporto because the Desktop is a DFS share (`\\apporto.com\dfs\ASU\Users\<user>\Desktop`); relative filenames resolve against the model's folder and work. And a Tally module row named after a built-in Process tally (`Process 1.TotalTime`) does not capture that tally's data; use a Record module that targets a Tally module entry.

`arena_dat.py` next to this file is a dependency-free reference parser that splits replications and computes per-replication means (time-weighted for type 201). It was validated against byte-exact reconstructions of the files above (same lengths, same decoded values).
