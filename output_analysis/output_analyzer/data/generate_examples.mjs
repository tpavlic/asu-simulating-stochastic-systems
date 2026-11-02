// Generates the bundled example datasets for the output analyzer.
//
// System: a single-server queue (M/M/1) with first-in first-out service, started empty. Customers
// arrive as a Poisson process of rate lambda and are served in exponentially distributed times of
// mean 1/mu. The time unit is minutes. Waiting times in queue follow the Lindley recursion
//   W[n+1] = max(0, W[n] + S[n] - A[n+1]),
// where S[n] is customer n's service time and A[n+1] is the interarrival time before customer
// n+1. The number in queue (customers waiting, not the one in service) is simulated event by
// event and recorded at every change. Two examples give the queue room for only a few customers
// in all, turn away an arrival who finds it full, and count the customers served in a day; one
// of them also draws some designs' service times from an Erlang distribution with k phases (the
// sum of k exponential draws of mean 1/(k mu)), whose standard deviation is 1/sqrt(k) of its mean.
//
// One example instead simulates a batch oven: a call for 2 to 12 muffins (uniform) arrives each
// minute from minute 0 to minute 30, and the oven, which holds 30 muffins and bakes them for a
// fixed time, is loaded oldest first (a call split at the capacity) whenever it is empty and at
// least a threshold number of muffins wait. The run stops at minute 30.
//
// Randomness: mulberry32 streams, with exponential draws by inverse transform, -ln(1 - u) * mean.
// Each replication uses two streams, one for arrivals and one for services, seeded from a base
// seed plus the replication index (the service stream's seed is offset further so the two never
// coincide). Reusing the same base seed across designs reuses the same uniforms, which is how the
// common-random-numbers set is built.
//
// Datasets (the base seeds are in SEEDS below; change them, or the parameters in the build
// functions, to produce a different but equally valid family of files):
//   queue_reps.csv             20 days of 480 minutes, lambda = 1, mean service 0.8 (rho = 0.8)
//   two_designs_independent.csv  designs A (0.8) and B (0.75), 15 days each, independent streams
//   two_designs_crn.csv        the same designs with the same streams reused for both, the day
//                              in a column headed block, which marks the ids as blocks
//   four_designs.csv           designs A..D (0.80, 0.78, 0.75, 0.70), 10 days each, independent
//   six_designs.csv            designs A..F of a queue with room for 8 customers in all, 20 days of 480
//                              minutes each, independent: the customers served each day. A, C, and E
//                              serve in exponential times of mean 1.30, 1.20, and 1.10; B, D, and F in
//                              Erlang times with 9 phases (standard deviation a third of the mean) of
//                              mean 1.35, 1.25, and 1.15, each a little slower than its exponential partner
//   customers_served.csv       designs A..E (mean service 1.00, 0.97, 0.80, 0.65, 0.62) of a queue with room
//                              for 4 customers in all, 20 days of 480 minutes each, independent: the
//                              customers served each day, arrivals who find the room full turned away
//   served_versus_control.csv  the same queue with room for 4, designs A..E (mean service 1.00, 0.95,
//                              0.94, 0.93, 0.92), 20 days each, independent: A is the current design
//                              and B..E four candidates, each a little faster, to compare with it
//   four_designs_crn.csv       designs A..D (0.80, 0.78, 0.75, 0.70), 10 days each, one stream set reused for all four,
//                              the day in a column headed block
//   transient_waits.txt        10 replications of the first 300 waits at rho = 0.9
//   steady_state_long.csv      one run of 5000 waits at rho = 0.8
//   queue_length.txt           5 replications of 600 minutes of the number in queue at rho = 0.8
//   service_level.csv          designs A..C (mean service 0.5, 0.7, 0.8), 15 days each, independent:
//                              each day's fraction of customers who waited less than 2 minutes
//   muffin_oven.csv            a batch oven loaded greedily (threshold 1) or nearly full (threshold
//                              20) at a bake time of 4 minutes, 10 replications whose demand stream
//                              is shared by both policies: four outputs per run (average time in
//                              system, utilization, most muffins waiting, muffins unfinished), the
//                              stream in a column headed block
//   utilization.csv            designs A..C (mean service 0.4, 1.0, 1.8 at mean interarrival 2.0),
//                              12 days of 480 minutes each, independent: whether the server is busy,
//                              recorded at every change
//
// Usage, from anywhere:
//   node output_analysis/output_analyzer/data/generate_examples.mjs [--out <dir>]
// With no argument the files are written in place (data/ and js/data/examples.js next to this
// script's parent directory). With --out, the same layout is written under <dir>.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SEEDS = {
  reps: 20261001,
  indepA: 31000,
  indepB: 47000,
  crn: 59000,
  four: [61000, 67000, 73000, 79000],
  six: [420000, 426000, 432000, 438000, 444000, 450000],
  served: [480000, 486000, 492000, 498000, 504000],
  versusControl: [1100000, 1106000, 1112000, 1118000, 1124000],
  fourCrn: 150000,
  transient: 83000,
  steady: 97001,
  queueLength: 101000,
  serviceLevel: [170000, 176000, 182000],
  utilization: [190000, 196000, 202000],
  oven: 1190000
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two streams for one replication: arrivals and services. */
function streams(base, rep) {
  return { arr: mulberry32(base + rep), srv: mulberry32(base + rep + 0x9E3779B1) };
}

const expo = (u, mean) => -Math.log(1 - u) * mean;

/**
 * Lindley recursion. Draws interarrival times until the arrival clock reaches `until` (or until
 * `maxCustomers` customers exist), and one service time per customer.
 * Returns arrays of arrival times and waits in queue.
 */
function lindley(st, meanArr, meanSrv, { until = Infinity, maxCustomers = Infinity } = {}) {
  const arrivals = [];
  const waits = [];
  let clock = 0;
  let w = 0;
  let prevS = 0;
  for (let n = 0; n < maxCustomers; n++) {
    const a = expo(st.arr(), meanArr);
    clock += a;
    if (clock >= until) break;
    w = n === 0 ? 0 : Math.max(0, w + prevS - a);
    prevS = expo(st.srv(), meanSrv);
    arrivals.push(clock);
    waits.push(w);
  }
  return { arrivals, waits };
}

/** One terminating day: average wait, longest wait, and customers served. */
function day(st, meanSrv) {
  const { waits } = lindley(st, 1.0, meanSrv, { until: 480 });
  let sum = 0;
  let max = 0;
  for (const w of waits) { sum += w; if (w > max) max = w; }
  return { avg: sum / waits.length, max, n: waits.length };
}

/** Event-driven M/M/1; returns [time, number in queue] at every change, ending at `endTime`. */
function queueLength(st, meanArr, meanSrv, endTime) {
  const rec = [[0, 0]];
  let q = 0;
  let busy = false;
  let nextArr = expo(st.arr(), meanArr);
  let nextDep = Infinity;
  for (;;) {
    const t = Math.min(nextArr, nextDep);
    if (t > endTime) break;
    if (nextArr <= nextDep) {
      if (busy) { q++; rec.push([t, q]); }
      else { busy = true; nextDep = t + expo(st.srv(), meanSrv); }
      nextArr = t + expo(st.arr(), meanArr);
    } else if (q > 0) {
      q--; rec.push([t, q]);
      nextDep = t + expo(st.srv(), meanSrv);
    } else {
      busy = false; nextDep = Infinity;
    }
  }
  rec.push([endTime, q]);
  return rec;
}

/** Event-driven M/M/1; returns [time, 1 if the server is busy else 0] at every change, ending at `endTime`. */
function busyServer(st, meanArr, meanSrv, endTime) {
  const rec = [[0, 0]];
  let q = 0;
  let busy = false;
  let nextArr = expo(st.arr(), meanArr);
  let nextDep = Infinity;
  for (;;) {
    const t = Math.min(nextArr, nextDep);
    if (t > endTime) break;
    if (nextArr <= nextDep) {
      if (busy) q++;
      else { busy = true; rec.push([t, 1]); nextDep = t + expo(st.srv(), meanSrv); }
      nextArr = t + expo(st.arr(), meanArr);
    } else if (q > 0) {
      q--;
      nextDep = t + expo(st.srv(), meanSrv);
    } else {
      busy = false; rec.push([t, 0]); nextDep = Infinity;
    }
  }
  return rec;
}

/**
 * Event-driven M/M/1 with room for `room` customers in all (the one in service included), started
 * empty: an arrival who finds the room full is turned away. With `phases` above 1, a service time
 * is Erlang instead, the sum of that many exponential draws. Returns the customers whose service
 * ended by `endTime`.
 */
function servedWithRoom(st, meanArr, meanSrv, room, endTime, phases = 1) {
  const service = () => {
    let s = 0;
    for (let i = 0; i < phases; i++) s += expo(st.srv(), meanSrv / phases);
    return s;
  };
  let n = 0;
  let served = 0;
  let nextArr = expo(st.arr(), meanArr);
  let nextDep = Infinity;
  for (;;) {
    const t = Math.min(nextArr, nextDep);
    if (t > endTime) break;
    if (nextArr <= nextDep) {
      if (n < room) { n++; if (n === 1) nextDep = t + service(); }
      nextArr = t + expo(st.arr(), meanArr);
    } else {
      n--; served++;
      nextDep = n > 0 ? t + service() : Infinity;
    }
  }
  return served;
}

/**
 * One run of the batch oven against the call sizes `sizes` (one per minute from minute 0), with
 * at one time an arrival handled before a departure. Returns the average time in system of the
 * muffins that left, the time average of the fraction of the oven in use, the most muffins ever
 * waiting, and the muffins still in the system at the end.
 */
function ovenRun(threshold, sizes, bake, { cap = 30, end = 30 } = {}) {
  let clk = 0, waiting = 0, baking = 0, used = 0, tisSum = 0, done = 0, usedArea = 0, maxWaiting = 0, next = 0;
  // Every call still in the system, oldest first; those baking lead.
  const line = [];
  const events = [{ kind: 1, t: 0 }, { kind: -1, t: end }];
  while (events.length) {
    events.sort((a, b) => a.t - b.t || b.kind - a.kind);
    if (events[0].t > clk || events[0].kind === -1) { usedArea += used * (events[0].t - clk); maxWaiting = Math.max(maxWaiting, waiting); }
    const e = events.shift();
    clk = e.t;
    if (e.kind === -1) break;
    if (e.kind === 1) {
      line.push({ arrival: clk, size: sizes[next] });
      waiting += sizes[next++];
      if (next < sizes.length) events.push({ kind: 1, t: clk + 1 });
    } else {
      const c = line.shift();
      tisSum += (clk - c.arrival) * c.size; done += c.size;
      baking -= c.size; used = baking / cap;
    }
    if (baking === 0 && waiting >= threshold) {
      for (let k = 0; k < line.length; k++) {
        if (baking + line[k].size > cap) {
          const part = { arrival: line[k].arrival, size: cap - baking };
          line[k].size -= part.size;
          line.splice(k, 0, part);
        }
        events.push({ kind: 0, t: clk + bake });
        baking += line[k].size; waiting -= line[k].size; used = baking / cap;
        if (baking === cap) break;
      }
    }
  }
  return { tis: tisSum / done, utilization: usedArea / clk, maxWaiting, unfinished: waiting + baking };
}

/** At most four decimals, no trailing zeros. */
const fmt = (x) => String(Number(x.toFixed(4)));

function buildQueueReps() {
  const lines = ['replication,avg_wait,max_wait,n_served'];
  for (let r = 1; r <= 20; r++) {
    const d = day(streams(SEEDS.reps, r), 0.8);
    lines.push(`${r},${fmt(d.avg)},${fmt(d.max)},${d.n}`);
  }
  return lines.join('\n') + '\n';
}

// `idName` heads the replication column: "block" for designs run on common
// random numbers, which marks the ids as blocks when the file loads.
function designsCsv(designs, reps, idName = 'replication') {
  const lines = ['design,' + idName + ',avg_wait'];
  for (const { name, mean, base } of designs) {
    for (let r = 1; r <= reps; r++) {
      lines.push(`${name},${r},${fmt(day(streams(base, r), mean).avg)}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Each day's customers served by a queue with room for `room` customers in all, per design; a
 * design's `phases` (1 when absent) makes its service times Erlang.
 */
function servedCsv(designs, reps, room) {
  const lines = ['design,replication,served'];
  for (const { name, mean, base, phases = 1 } of designs) {
    for (let r = 1; r <= reps; r++) lines.push(`${name},${r},${servedWithRoom(streams(base, r), 1.0, mean, room, 480, phases)}`);
  }
  return lines.join('\n') + '\n';
}

/** Each day's fraction of customers whose wait in queue was under `target` minutes, per design. */
function serviceLevelCsv(designs, reps, target) {
  const lines = ['design,replication,served_within_2'];
  for (const { name, mean, base } of designs) {
    for (let r = 1; r <= reps; r++) {
      const { waits } = lindley(streams(base, r), 1.0, mean, { until: 480 });
      lines.push(`${name},${r},${fmt(waits.filter(w => w < target).length / waits.length)}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** The server's busy state at every change, per design and day, with times to two decimals. */
function utilizationCsv(designs, reps) {
  const lines = ['design,replication,time,busy'];
  for (const { name, mean, base } of designs) {
    for (let r = 1; r <= reps; r++) {
      for (const [t, b] of busyServer(streams(base, r), 2.0, mean, 480)) lines.push(`${name},${r},${Number(t.toFixed(2))},${b}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Two loading policies of the batch oven, each replication's demand stream shared by both. */
function ovenCsv(policies, bake, reps) {
  const lines = ['policy,block,avg_time_in_system,utilization,max_waiting,unfinished'];
  for (const { name, threshold } of policies) {
    for (let r = 1; r <= reps; r++) {
      const u = mulberry32(SEEDS.oven + r);
      const sizes = Array.from({ length: 31 }, () => 2 + Math.floor(u() * 11));
      const o = ovenRun(threshold, sizes, bake);
      lines.push(`${name},${r},${fmt(o.tis)},${fmt(o.utilization)},${o.maxWaiting},${o.unfinished}`);
    }
  }
  return lines.join('\n') + '\n';
}

function buildTransient() {
  const lines = [];
  for (let r = 1; r <= 10; r++) {
    const { arrivals, waits } = lindley(streams(SEEDS.transient, r), 1.0, 0.9, { maxCustomers: 300 });
    arrivals.forEach((t, i) => lines.push(`${fmt(t)} ${fmt(waits[i])}`));
    lines.push('-1 0');
  }
  return lines.join('\n') + '\n';
}

function buildSteady() {
  const { arrivals, waits } = lindley(streams(SEEDS.steady, 1), 1.0, 0.8, { maxCustomers: 5000 });
  const lines = ['time,wait'];
  arrivals.forEach((t, i) => lines.push(`${fmt(t)},${fmt(waits[i])}`));
  return lines.join('\n') + '\n';
}

function buildQueueLength() {
  const lines = [];
  for (let r = 1; r <= 5; r++) {
    for (const [t, q] of queueLength(streams(SEEDS.queueLength, r), 1.0, 0.8, 600)) {
      lines.push(`${fmt(t)} ${q}`);
    }
    lines.push('-1 0');
  }
  return lines.join('\n') + '\n';
}

const nullMap = { kind: null, value: null, time: null, rep: null, scenario: null, name: null, endTime: null, blocks: false };

function entries() {
  const A = (name, mean, base, phases = 1) => ({ name, mean, base, phases });
  return [
    {
      id: 'queue-reps', title: 'Replication intervals (average wait, 20 days)', file: 'queue_reps.csv',
      kind: 'reps', format: 'columns',
      description: 'Twenty independent 8-hour days of a single-server queue with exponential interarrival times (mean 1.0 minute) and service times (mean 0.8 minute), reporting each day\'s average wait, longest wait, and customers served. Use it to form a confidence interval from replications; the Assign its columns myself button opens the dialog in which the other two columns can be loaded as responses too.',
      text: buildQueueReps(),
      mapping: { ...nullMap, kind: 'reps', value: 1, rep: 0, name: 'Queue days' }
    },
    {
      id: 'two-independent', title: 'Independent replications (average wait, 2 designs)', file: 'two_designs_independent.csv',
      kind: 'reps', format: 'columns',
      description: 'Average wait over an 8-hour day for a queue served at a mean of 0.8 minute (design A) and one served at 0.75 minute (design B), with 15 days each drawn from independent random streams. Nothing pairs a day of one design with a day of the other, and so the two are compared with a two-sample interval.',
      text: designsCsv([A('A', 0.8, SEEDS.indepA), A('B', 0.75, SEEDS.indepB)], 15),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Two designs, independent' }
    },
    {
      id: 'two-crn', title: 'Common random numbers (average wait, 2 designs)', file: 'two_designs_crn.csv',
      kind: 'reps', format: 'columns',
      description: 'The same two queues and 15 days each as the independent-replications example, but both designs see the same arrival and service random numbers on each day, and so the file\'s block column names the day. Two Systems opens the pair as a paired difference; switch it to Independent to see how much wider the interval becomes without the pairing.',
      text: designsCsv([A('A', 0.8, SEEDS.crn), A('B', 0.75, SEEDS.crn)], 15, 'block'),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, blocks: true, name: 'Two designs, paired' }
    },
    {
      id: 'muffin-oven', title: 'Paired comparison, four outputs (muffin oven, 2 policies)', file: 'muffin_oven.csv',
      kind: 'reps', format: 'columns',
      description: 'An oven that holds 30 muffins and bakes them for 4 minutes takes a call for 2 to 12 muffins each minute for 30 minutes, and it is loaded, oldest muffins first, whenever it is empty and enough muffins wait: one for the greedy policy, 20 for the nearly full one. Each of 10 replications runs both policies against the same random demand stream, which the file\'s block column names, and each run reports the average time in system of the muffins that finished, the oven\'s utilization, the most muffins ever waiting, and the muffins unfinished at the end. Two Systems opens the two policies as paired differences; the Assign its columns myself button opens the dialog in which the other outputs can be loaded in place of the time in system. The time in system cannot tell the two policies apart, but the muffins unfinished favor the nearly full policy.',
      text: ovenCsv([{ name: 'greedy', threshold: 1 }, { name: 'nearly_full', threshold: 20 }], 4, 10),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, blocks: true, name: 'Muffin oven' }
    },
    {
      id: 'four-designs', title: 'Nonparametric ANOVA (average wait, 4 designs)', file: 'four_designs.csv',
      kind: 'reps', format: 'columns',
      description: 'Average wait over an 8-hour day for four versions of a queue with mean service times 0.80, 0.78, 0.75, and 0.70 minute, with 10 independent days each. The days\' average waits are skewed to the right, and so the residuals of the one-way analysis of variance fail Shapiro–Wilk (p ≈ 0.009). Use it for the nonparametric analysis: the pooled F test just misses at the 5% level (p ≈ 0.052), whereas the Kruskal–Wallis test, which needs no normality, just rejects (p ≈ 0.048), and Dunn\'s pairwise comparisons declare A and D different.',
      text: designsCsv([A('A', 0.8, SEEDS.four[0]), A('B', 0.78, SEEDS.four[1]), A('C', 0.75, SEEDS.four[2]), A('D', 0.7, SEEDS.four[3])], 10),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Four designs' }
    },
    {
      id: 'six-designs', title: 'Screen for the best, unequal spreads (customers served, 6 designs)', file: 'six_designs.csv',
      kind: 'reps', format: 'columns',
      description: 'Customers served over an 8-hour day by six versions of a single-server queue with room for 8 customers in all (the one in service and 7 waiting), where an arrival who finds the room full is turned away. Customers arrive at a mean of one a minute, faster than any design serves them, and so the room is usually full and a day\'s count is mostly the number of services that fit in it. Designs A, C, and E serve in exponential times of mean 1.30, 1.20, and 1.10 minutes; B, D, and F serve a little more slowly, at means of 1.35, 1.25, and 1.15 minutes, but far more consistently, in times whose standard deviation is a third of their mean. Each design has 20 independent days. Every design\'s counts look normal, but the consistent designs\' counts spread about half as widely, and Levene\'s test flags it: the pooled analysis of variance assumes equal spreads, and so Welch\'s analysis is the one to use. The screen for the best uses each design\'s own variance and needs no equal spreads, and its checks pass. With bigger taken as better, it keeps E and F, which it cannot tell apart, and Rinott\'s second stage would need about three and a half times as many replications of E as of F, whose counts vary less.',
      text: servedCsv([A('A', 1.3, SEEDS.six[0]), A('B', 1.35, SEEDS.six[1], 9), A('C', 1.2, SEEDS.six[2]), A('D', 1.25, SEEDS.six[3], 9), A('E', 1.1, SEEDS.six[4]), A('F', 1.15, SEEDS.six[5], 9)], 20, 8),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Six designs' }
    },
    {
      id: 'customers-served', title: 'Parametric ANOVA and screen for the best (customers served, 5 designs)', file: 'customers_served.csv',
      kind: 'reps', format: 'columns',
      description: 'Customers served over an 8-hour day by five versions of a single-server queue with room for 4 customers in all (the one in service and 3 waiting), where an arrival who finds the room full is turned away. Customers arrive at a mean of one a minute, the designs\' mean service times are 1.00, 0.97, 0.80, 0.65, and 0.62 minute, and each design has 20 independent days. A day\'s count totals hundreds of customers, and so the outcomes are close to normal and spread about equally across the designs. Use it for a one-way analysis of variance whose assumption checks pass: the F test rejects equal means, neither Shapiro–Wilk on the residuals nor Levene\'s test flags anything, and Tukey\'s procedure groups A with B and D with E. With bigger taken as better, the screen keeps D and E, which it cannot tell apart.',
      text: servedCsv([A('A', 1.0, SEEDS.served[0]), A('B', 0.97, SEEDS.served[1]), A('C', 0.8, SEEDS.served[2]), A('D', 0.65, SEEDS.served[3]), A('E', 0.62, SEEDS.served[4])], 20, 4),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Customers served' }
    },
    {
      id: 'versus-control', title: 'Holm\'s step-down versus a control (customers served, 5 designs)', file: 'served_versus_control.csv',
      kind: 'reps', format: 'columns',
      description: 'Customers served over an 8-hour day by the queue of the parametric ANOVA example, with room for 4 customers in all and arrivals at a mean of one a minute: the current design A, whose mean service time is 1.00 minute, and four candidates that each serve a little faster, at means of 0.95, 0.94, 0.93, and 0.92 minute (B, C, D, and E), with 20 independent days each. Every design\'s counts look normal, and the designs spread about equally. Under Pairwise comparisons, switched to versus control with A as the control, each candidate\'s difference from A has its own p-value (about 0.044, 0.016, 0.021, and 0.0002 for B, C, D, and E). Bonferroni compares every one with 0.05/4 = 0.0125 and declares only E different from A. Holm\'s step-down compares the smallest with 0.0125, the next with 0.05/3, then 0.05/2 and 0.05, and declares all four, though it holds the chance of any false declaration at 5% just as Bonferroni does. Dunnett\'s procedure, offered in the analysis of variance for comparisons with a control, declares only E as well: like Bonferroni, it judges every comparison against one threshold, and the extra declarations come from stepping down.',
      text: servedCsv([A('A', 1.0, SEEDS.versusControl[0]), A('B', 0.95, SEEDS.versusControl[1]), A('C', 0.94, SEEDS.versusControl[2]), A('D', 0.93, SEEDS.versusControl[3]), A('E', 0.92, SEEDS.versusControl[4])], 20, 4),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Versus a control' }
    },
    {
      id: 'four-crn', title: 'Blocked by common random numbers (average wait, 4 designs)', file: 'four_designs_crn.csv',
      kind: 'reps', format: 'columns',
      description: 'The four queue designs of the nonparametric ANOVA example (mean service times 0.80, 0.78, 0.75, and 0.70 minute, 10 days each), but with day i of every design driven by the same random inputs, and so the file\'s block column names the day. Several Systems opens the four designs paired across designs: the day effect they share comes out as a block, and the differences become paired intervals.',
      text: designsCsv([A('A', 0.8, SEEDS.fourCrn), A('B', 0.78, SEEDS.fourCrn), A('C', 0.75, SEEDS.fourCrn), A('D', 0.7, SEEDS.fourCrn)], 10, 'block'),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, blocks: true, name: 'Four designs, CRN' }
    },
    {
      id: 'transient', title: 'Warm-up (transient waits, 10 runs)', file: 'transient_waits.txt',
      kind: 'tally', format: 'minus1',
      description: 'Waiting times of the first 300 customers in each of 10 runs of a busy single-server queue (utilization 0.9) that starts empty, listed with each customer\'s arrival time and ended by a −1 row. Use it to find where the averaged waits stop climbing, and so choose how much of each run to delete as warm-up.',
      text: buildTransient(),
      mapping: { ...nullMap, kind: 'tally', value: 1, time: 0, name: 'Transient waits' }
    },
    {
      id: 'steady-long', title: 'Batch means (waits, one long run)', file: 'steady_state_long.csv',
      kind: 'tally', format: 'columns',
      description: 'The waiting times of 5000 consecutive customers in one long run of a single-server queue at utilization 0.8, with each customer\'s arrival time. Use it to split the run into batches, check that the batch means are nearly uncorrelated, and form an interval for the long-run mean wait.',
      text: buildSteady(),
      mapping: { ...nullMap, kind: 'tally', value: 1, time: 0, rep: null, name: 'One long run' }
    },
    {
      id: 'queue-length', title: 'Time-persistent average (queue length, 5 runs)', file: 'queue_length.txt',
      kind: 'time', format: 'minus1',
      description: 'The number of customers waiting in a single-server queue at utilization 0.8, recorded at the moment of every change over 600 minutes, in 5 runs. Use it to see why a time-persistent quantity is averaged with weights equal to how long each value is held.',
      text: buildQueueLength(),
      mapping: { ...nullMap, kind: 'time', value: 1, time: 0, endTime: 600, name: 'Queue length' }
    },
    {
      id: 'service-level', title: 'Transform to even out spreads (service level, 3 designs)', file: 'service_level.csv',
      kind: 'reps', format: 'columns',
      description: 'The fraction of each 8-hour day\'s customers who waited less than 2 minutes, for three versions of a queue with mean service times 0.5, 0.7, and 0.8 minute, with 15 independent days each. A share of customers varies least near 0 or 1, and so the busier designs\' service levels spread more widely: Levene\'s test and the checks lines flag it. Under the logit transform, the spreads even out; the arcsine square root helps less.',
      text: serviceLevelCsv([A('A', 0.5, SEEDS.serviceLevel[0]), A('B', 0.7, SEEDS.serviceLevel[1]), A('C', 0.8, SEEDS.serviceLevel[2])], 15, 2),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Service level' }
    },
    {
      id: 'utilization', title: 'Time-persistent proportion (utilization, 3 designs)', file: 'utilization.csv',
      kind: 'time', format: 'columns',
      description: 'Whether the server of a single-server queue is busy, recorded at every change over 8-hour days, for three versions with mean service times 0.4, 1.0, and 1.8 minutes and a mean interarrival time of 2 minutes, with 12 independent days each. Each day\'s utilization, the time-weighted mean of the busy state, is a proportion, but because a day\'s utilization is its total work divided by its length, its spread grows in step with its level across designs that differ in their service times. Under the log transform the spreads even out; the arcsine square root and the logit, built for shares of counts, do not.',
      text: utilizationCsv([A('A', 0.4, SEEDS.utilization[0]), A('B', 1.0, SEEDS.utilization[1]), A('C', 1.8, SEEDS.utilization[2])], 12),
      mapping: { ...nullMap, kind: 'time', value: 3, time: 2, rep: 1, scenario: 0, endTime: 480, name: 'Utilization' }
    }
  ];
}

function moduleText(list) {
  const body = list.map((e) => {
    const { text, ...rest } = e;
    if (/[`\\]|\$\{/.test(text)) throw new Error('unescaped characters in ' + e.file);
    const head = Object.entries(rest).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join('\n');
    return `  {\n${head}\n    text: \`${text}\`\n  }`;
  }).join(',\n');
  return `// Generated by data/generate_examples.mjs; do not edit by hand.

/**
 * Bundled example datasets. \`text\` is the file's contents as the importer reads it, and
 * \`mapping\` is the column assignment that loads it without a dialog (column indices, 0-based).
 * @type {{id: string, title: string, file: string, kind: 'tally'|'time'|'reps', format: 'minus1'|'columns', description: string, text: string, mapping: object}[]}
 */
export const EXAMPLES = [
${body}
];
`;
}

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const outDir = oi >= 0 ? path.resolve(argv[oi + 1]) : ROOT;
const list = entries();
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'js', 'data'), { recursive: true });
for (const e of list) fs.writeFileSync(path.join(outDir, 'data', e.file), e.text);
fs.writeFileSync(path.join(outDir, 'js', 'data', 'examples.js'), moduleText(list));
console.log(`wrote ${list.length} datasets under ${outDir}`);
