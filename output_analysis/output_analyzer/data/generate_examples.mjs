// Generates the bundled example datasets for the output analyzer.
//
// System: a single-server queue (M/M/1) with first-in first-out service, started empty. Customers
// arrive as a Poisson process of rate lambda and are served in exponentially distributed times of
// mean 1/mu. The time unit is minutes. Waiting times in queue follow the Lindley recursion
//   W[n+1] = max(0, W[n] + S[n] - A[n+1]),
// where S[n] is customer n's service time and A[n+1] is the interarrival time before customer
// n+1. The number in queue (customers waiting, not the one in service) is simulated event by
// event and recorded at every change.
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
//   two_designs_crn.csv        the same designs with the same streams reused for both
//   four_designs.csv           designs A..D (0.80, 0.78, 0.75, 0.70), 10 days each, independent
//   six_designs.csv            designs A..F (0.90, 0.88, 0.80, 0.75, 0.65, 0.60), 15 days each, independent
//   four_designs_crn.csv       designs A..D (0.80, 0.78, 0.75, 0.70), 10 days each, one stream set reused for all four
//   transient_waits.txt        10 replications of the first 300 waits at rho = 0.9
//   steady_state_long.csv      one run of 5000 waits at rho = 0.8
//   queue_length.txt           5 replications of 600 minutes of the number in queue at rho = 0.8
//   service_level.csv          designs A..C (mean service 0.5, 0.7, 0.8), 15 days each, independent:
//                              each day's fraction of customers who waited less than 2 minutes
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
  six: [110000, 116000, 122000, 128000, 134000, 140000],
  fourCrn: 150000,
  transient: 83000,
  steady: 97001,
  queueLength: 101000,
  serviceLevel: [170000, 176000, 182000],
  utilization: [190000, 196000, 202000]
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

function designsCsv(designs, reps) {
  const lines = ['design,replication,avg_wait'];
  for (const { name, mean, base } of designs) {
    for (let r = 1; r <= reps; r++) {
      lines.push(`${name},${r},${fmt(day(streams(base, r), mean).avg)}`);
    }
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

const nullMap = { kind: null, value: null, time: null, rep: null, scenario: null, name: null, endTime: null };

function entries() {
  const A = (name, mean, base) => ({ name, mean, base });
  return [
    {
      id: 'queue-reps', title: 'Queue days: replication intervals', file: 'queue_reps.csv',
      kind: 'reps', format: 'columns',
      description: 'Twenty independent 8-hour days of a single-server queue with exponential interarrival times (mean 1.0 minute) and service times (mean 0.8 minute), reporting each day\'s average wait, longest wait, and customers served. Use it to form a confidence interval from replications; the Assign its columns myself button opens the dialog in which the other two columns can be loaded as responses too.',
      text: buildQueueReps(),
      mapping: { ...nullMap, kind: 'reps', value: 1, rep: 0, name: 'Queue days' }
    },
    {
      id: 'two-independent', title: 'Two designs: independent runs', file: 'two_designs_independent.csv',
      kind: 'reps', format: 'columns',
      description: 'Average wait over an 8-hour day for a queue served at a mean of 0.8 minute (design A) and one served at 0.75 minute (design B), with 15 days each drawn from independent random streams. Use it to compare two systems with a two-sample interval, ignoring any pairing.',
      text: designsCsv([A('A', 0.8, SEEDS.indepA), A('B', 0.75, SEEDS.indepB)], 15),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Two designs, independent' }
    },
    {
      id: 'two-crn', title: 'Two designs: common random numbers', file: 'two_designs_crn.csv',
      kind: 'reps', format: 'columns',
      description: 'The same two queues and 15 days each as the independent set, but both designs see the same arrival and service random numbers on each day. Use it to compare the two systems as a paired difference and to see how much narrower the interval becomes.',
      text: designsCsv([A('A', 0.8, SEEDS.crn), A('B', 0.75, SEEDS.crn)], 15),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Two designs, paired' }
    },
    {
      id: 'four-designs', title: 'Four designs: ANOVA and selection', file: 'four_designs.csv',
      kind: 'reps', format: 'columns',
      description: 'Average wait over an 8-hour day for four versions of a queue with mean service times 0.80, 0.78, 0.75, and 0.70 minute, with 10 independent days each. Use it for one-way analysis of variance, all-pairs comparisons, and picking the best design.',
      text: designsCsv([A('A', 0.8, SEEDS.four[0]), A('B', 0.78, SEEDS.four[1]), A('C', 0.75, SEEDS.four[2]), A('D', 0.7, SEEDS.four[3])], 10),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Four designs' }
    },
    {
      id: 'six-designs', title: 'Six designs: screen for the best', file: 'six_designs.csv',
      kind: 'reps', format: 'columns',
      description: 'Average wait over an 8-hour day for six versions of a queue with mean service times 0.90, 0.88, 0.80, 0.75, 0.65, and 0.60 minute, with 15 independent days each. With smaller taken as better, the screen keeps one design; with bigger taken as better, it keeps two that it cannot tell apart.',
      text: designsCsv([A('A', 0.9, SEEDS.six[0]), A('B', 0.88, SEEDS.six[1]), A('C', 0.8, SEEDS.six[2]), A('D', 0.75, SEEDS.six[3]), A('E', 0.65, SEEDS.six[4]), A('F', 0.6, SEEDS.six[5])], 15),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Six designs' }
    },
    {
      id: 'four-crn', title: 'Four designs: common random numbers', file: 'four_designs_crn.csv',
      kind: 'reps', format: 'columns',
      description: 'The four queue designs of the ANOVA example (mean service times 0.80, 0.78, 0.75, and 0.70 minute, 10 days each), but with day i of every design driven by the same random inputs. Use it with the replications declared paired across designs on the Several Systems page: the replication effect the designs share comes out as a block, and the differences become paired intervals.',
      text: designsCsv([A('A', 0.8, SEEDS.fourCrn), A('B', 0.78, SEEDS.fourCrn), A('C', 0.75, SEEDS.fourCrn), A('D', 0.7, SEEDS.fourCrn)], 10),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Four designs, CRN' }
    },
    {
      id: 'transient', title: 'Transient waits: warm-up', file: 'transient_waits.txt',
      kind: 'tally', format: 'minus1',
      description: 'Waiting times of the first 300 customers in each of 10 runs of a busy single-server queue (utilization 0.9) that starts empty, listed with each customer\'s arrival time and ended by a −1 row. Use it to find where the averaged waits stop climbing, and so choose how much of each run to delete as warm-up.',
      text: buildTransient(),
      mapping: { ...nullMap, kind: 'tally', value: 1, time: 0, name: 'Transient waits' }
    },
    {
      id: 'steady-long', title: 'One long run: batch means', file: 'steady_state_long.csv',
      kind: 'tally', format: 'columns',
      description: 'The waiting times of 5000 consecutive customers in one long run of a single-server queue at utilization 0.8, with each customer\'s arrival time. Use it to split the run into batches, check that the batch means are nearly uncorrelated, and form an interval for the long-run mean wait.',
      text: buildSteady(),
      mapping: { ...nullMap, kind: 'tally', value: 1, time: 0, rep: null, name: 'One long run' }
    },
    {
      id: 'queue-length', title: 'Queue length: time-persistent', file: 'queue_length.txt',
      kind: 'time', format: 'minus1',
      description: 'The number of customers waiting in a single-server queue at utilization 0.8, recorded at the moment of every change over 600 minutes, in 5 runs. Use it to see why a time-persistent quantity is averaged with weights equal to how long each value is held.',
      text: buildQueueLength(),
      mapping: { ...nullMap, kind: 'time', value: 1, time: 0, endTime: 600, name: 'Queue length' }
    },
    {
      id: 'service-level', title: 'Service level: a proportion to transform', file: 'service_level.csv',
      kind: 'reps', format: 'columns',
      description: 'The fraction of each 8-hour day\'s customers who waited less than 2 minutes, for three versions of a queue with mean service times 0.5, 0.7, and 0.8 minute, with 15 independent days each. A share of customers varies least near 0 or 1, and so the busier designs\' service levels spread more widely: Levene\'s test and the checks lines flag it. Under the logit transform, the spreads even out; the arcsine square root helps less.',
      text: serviceLevelCsv([A('A', 0.5, SEEDS.serviceLevel[0]), A('B', 0.7, SEEDS.serviceLevel[1]), A('C', 0.8, SEEDS.serviceLevel[2])], 15, 2),
      mapping: { ...nullMap, kind: 'reps', value: 2, rep: 1, scenario: 0, name: 'Service level' }
    },
    {
      id: 'utilization', title: 'Utilization: a time-persistent proportion', file: 'utilization.csv',
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
