#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   Verification for mc_examples.html.  NOT shipped with the widget.

     node monte_carlo/verify_mc_examples.mjs

   Slices the block between the MCX-CORE sentinels out of mc_examples.html and
   runs it in a Node vm context, so the code under test is byte-for-byte the
   code the page ships. Reference values are exact identities, the book's own
   Table 2.21 sequence, quadrature of the bivariate normal over the delivery
   zone, discrete renewal functions for the bearing policies, and Irwin–Hall
   CDFs for the activity network. MCX_CALIB_REPS (default 20000) shortens the
   calibration sections.
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, 'mc_examples.html');
const REPS = Math.max(500, Number(process.env.MCX_CALIB_REPS) || 20000);

function loadCore() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf('/* ===== MCX-CORE-BEGIN ===== */');
  const b = src.indexOf('/* ===== MCX-CORE-END ===== */');
  if (a < 0 || b < 0) throw new Error('MCX-CORE sentinels not found in ' + HTML);
  const core = src.slice(a, b);
  if (/\bdocument\b|\bwindow\b/.test(core)) throw new Error('MCX core references the DOM');
  const ctx = { Math, Number, NaN, Infinity, Array, Object, String, RegExp, JSON, isNaN, Float64Array };
  vm.createContext(ctx);
  vm.runInContext(core, ctx, { filename: 'mc_examples.html#MCX-CORE' });
  if (!ctx.MCX) throw new Error('core ran but exported no MCX namespace');
  return ctx.MCX;
}

let pass = 0, fail = 0, group = '';
const failures = [];
const tty = process.stdout.isTTY;
const g = s => tty ? `\x1b[32m${s}\x1b[0m` : s, r = s => tty ? `\x1b[31m${s}\x1b[0m` : s, bold = s => tty ? `\x1b[1m${s}\x1b[0m` : s;
function section(name) { group = name; console.log('\n' + bold(name)); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ' + g('PASS') + '  ' + label); }
  else { fail++; failures.push(group + ' :: ' + label); console.log('  ' + r('FAIL') + '  ' + label + (detail ? '\n        ' + detail : '')); }
}
function close(got, want, tol, label) {
  const scale = Math.abs(want) < 1e-8 ? 1 : Math.abs(want);
  const err = Math.abs(got - want) / scale;
  ok(err <= tol, `${label}  (rel err ${Number.isFinite(err) ? err.toExponential(2) : err} <= ${tol.toExponential(1)})`, `got ${got}, want ${want}`);
}
/* An observed rate over R trials is within k standard errors of p. */
function rateOk(count, R, p, k, label) {
  const se = Math.sqrt(p * (1 - p) / R), got = count / R;
  ok(Math.abs(got - p) <= k * se, `${label}  (${got.toFixed(4)} vs ${p.toFixed(4)}, ${k} se = ${(k * se).toFixed(4)})`);
}
/* A Monte Carlo mean over R replications is within k standard errors of `want`. */
function mcMeanOk(xs, want, k, label) {
  const n = xs.length, m = xs.reduce((s, x) => s + x, 0) / n;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1), se = Math.sqrt(v / n);
  ok(Math.abs(m - want) <= k * se, `${label}  (${m.toFixed(4)} vs ${want.toFixed(4)}, ${k} se = ${(k * se).toFixed(4)})`);
}

const t0 = Date.now();
const M = loadCore();

section('Generator and samplers');
{
  const rand = M.mulberry32(12345);
  let mn = 1, mx = 0, s = 0; const N = 200000;
  for (let i = 0; i < N; i++) { const u = M.unif(rand); if (u < mn) mn = u; if (u > mx) mx = u; s += u; }
  ok(mn > 0 && mx < 1, 'unif stays inside (0, 1)');
  close(s / N, 0.5, 5e-3, 'unif mean is 0.5');
  const r2 = M.mulberry32(7); let sz = 0, sz2 = 0;
  for (let i = 0; i < N; i++) { const z = M.normal(r2); sz += z; sz2 += z * z; }
  ok(Math.abs(sz / N) < 0.01, `normal mean near 0 (${(sz / N).toFixed(4)})`);
  close(sz2 / N, 1, 0.01, 'normal second moment near 1');
  const t = M.makeTable([40, 50, 60], [0.2, 0.5, 0.3]);
  ok(t.cum.length === 3 && Math.abs(t.cum[2] - 1) < 1e-12, 'makeTable cumulates to 1');
  ok(M.discrete(t, 0.0) === 0 && M.discrete(t, 0.1999) === 0 && M.discrete(t, 0.2) === 1 && M.discrete(t, 0.6999) === 1 && M.discrete(t, 0.7) === 2 && M.discrete(t, 0.9999) === 2, 'discrete maps u to the right cell at the boundaries');
  const cnt = [0, 0, 0], r3 = M.mulberry32(99);
  for (let i = 0; i < N; i++) cnt[M.discrete(t, M.unif(r3))]++;
  rateOk(cnt[0], N, 0.2, 4, 'discrete cell 0 rate'); rateOk(cnt[2], N, 0.3, 4, 'discrete cell 2 rate');
  close(M.tableMean(t), 51, 1e-12, 'tableMean');
}

section('Special functions and intervals');
{
  close(M.Phi(0), 0.5, 1e-8, 'Phi(0)');
  close(M.Phi(1.959963985), 0.975, 1e-6, 'Phi(1.96)');
  close(M.Phi(-2.5758293), 0.005, 1e-4, 'Phi(-2.576)');
  const tTab = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 9: 2.262, 19: 2.093, 29: 2.045, 99: 1.984 };
  for (const df in tTab) close(M.tQuantile975(+df), tTab[df], 2e-3, `t_{.975}(${df})`);
  const w = M.wilson(7, 20);
  close(w.lo, 0.1811, 3e-3, 'Wilson lower (7/20)'); close(w.hi, 0.5671, 3e-3, 'Wilson upper (7/20)');
  const w0 = M.wilson(0, 10); ok(w0.lo === 0 && w0.hi > 0 && w0.hi < 0.4, 'Wilson at zero successes');
  const ci = M.meanCI([1, 2, 3, 4, 5]);
  close(ci.mean, 3, 1e-12, 'meanCI mean'); close(ci.hw, 2.776 * Math.sqrt(2.5 / 5), 2e-3, 'meanCI half-width');
  const pm = M.binomPmf(10, 0.3); close(pm.reduce((a, b) => a + b, 0), 1, 1e-12, 'binomPmf sums to 1'); close(pm[3], 0.266827932, 1e-8, 'binomPmf(10,.3)[3]');
  close(M.irwinHallCdf(1, 0.3), 0.3, 1e-12, 'IH_1 cdf'); close(M.irwinHallCdf(2, 1), 0.5, 1e-12, 'IH_2 cdf at 1');
  close(M.irwinHallCdf(3, 1.5), 0.5, 1e-12, 'IH_3 cdf at 1.5'); close(M.irwinHallPdf(2, 0.5), 0.5, 1e-12, 'IH_2 pdf at .5');
  close(M.simpson(x => x * x, 0, 3, 100), 9, 1e-9, 'simpson');
  /* Coverage of both intervals on a Bernoulli(0.3) and an exponential mean. */
  let covW = 0, covT = 0; const R = Math.min(REPS, 5000), rr = M.mulberry32(2024);
  for (let i = 0; i < R; i++) {
    let k = 0; for (let j = 0; j < 40; j++) if (M.unif(rr) < 0.3) k++;
    const wi = M.wilson(k, 40); if (wi.lo <= 0.3 && 0.3 <= wi.hi) covW++;
    const xs = []; for (let j = 0; j < 30; j++) xs.push(-Math.log(M.unif(rr)));
    const c = M.meanCI(xs); if (c.mean - c.hw <= 1 && 1 <= c.mean + c.hw) covT++;
  }
  rateOk(covW, R, 0.95, 3.5, 'Wilson coverage n=40 p=.3 (within 3.5 se of .95)');
  ok(covT / R > 0.92, `t interval coverage on a skewed sample n=30 (${(covT / R).toFixed(3)} > .92)`);
}

section('Newsvendor');
{
  const nv = M.models.nv;
  const mix = M.nvMixturePmf();
  close(mix.reduce((a, b) => a + b, 0), 1, 1e-12, 'mixture pmf sums to 1');
  close(mix[2], 0.35 * 0.15 + 0.45 * 0.40 + 0.20 * 0.16, 1e-12, 'mixture at demand 60');
  close(M.nvDailyProfit(70, 60, true), 0.50 * 60 - 0.33 * 70 + 0.05 * 10, 1e-12, 'daily profit Q=70 D=60');
  close(M.nvDailyProfit(70, 90, true), 0.50 * 70 - 0.33 * 70 - 0.17 * 20, 1e-12, 'daily profit Q=70 D=90 with lost profit');
  close(M.nvDailyProfit(70, 90, false), 0.50 * 70 - 0.33 * 70, 1e-12, 'daily profit Q=70 D=90 without');
  /* Book's day 1 at Q=70: type u .94 -> Poor, demand u .80 -> 60. */
  const rep = nv.run({ Q: 70, charge: true }, { type: () => 0.94, demand: () => 0.80 });
  ok(rep.rows.length === 20 && rep.rows[0].type === 'Poor' && rep.rows[0].demand === 60, 'inverse transform: u=.94 is Poor, u=.80 in Poor is 60');
  close(rep.outputs.profit, 20 * (0.50 * 60 - 0.33 * 70 + 0.05 * 10), 1e-9, '20 identical days add up');
  for (const Q of [40, 60, 70, 90, 100]) for (const charge of [true, false]) {
    const want = M.nvExpectedProfit(Q, charge), xs = [];
    for (let i = 0; i < 4000; i++) xs.push(nv.replicate(1000 + i, { Q, charge }).outputs.profit);
    mcMeanOk(xs, want, 3.5, `MC mean profit matches exact, Q=${Q}, charge=${charge}`);
  }
  const r1 = nv.replicate(42, { Q: 70, charge: true }), r2 = nv.replicate(42, { Q: 70, charge: true });
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'same seed reproduces the replication');
}

section('Order-up-to inventory (Table 2.21)');
{
  const inv = M.models.inv;
  const demand = [2,1,2,1,2,3,2,3,2,3,1,2,2,3,1,0,4,2,3,3,2,1,4,1,1];
  const leads = [1, 2, 1, 1, 1];  /* orders placed on days 5, 10, 15, 20, 25 */
  let k = 0;
  const rep = inv.run({ M: 11, N: 5 }, { demandValue: d => demand[d - 1], leadValue: () => leads[k++] });
  const wantEnd = [1,0,6,5,3,0,6,3,1,0,0,0,6,3,2,2,7,5,2,0,0,8,4,3,2];
  const wantShort = [0,0,0,0,0,0,0,0,0,2,3,5,0,0,0,0,0,0,0,1,3,0,0,0,0];
  const wantBegin = [3,1,8,6,5,3,8,6,3,1,0,0,13,6,3,2,11,7,5,2,0,12,8,4,3];
  ok(rep.rows.length === 26, '26 rows (day 0 plus 25 days)');
  ok(rep.rows.slice(1).every((r, i) => r.ending === wantEnd[i]), 'ending inventory matches every day', JSON.stringify(rep.rows.slice(1).map(r => r.ending)));
  ok(rep.rows.slice(1).every((r, i) => r.shortage === wantShort[i]), 'shortage matches every day', JSON.stringify(rep.rows.slice(1).map(r => r.shortage)));
  ok(rep.rows.slice(1).every((r, i) => r.begin === wantBegin[i]), 'beginning inventory matches every day', JSON.stringify(rep.rows.slice(1).map(r => r.begin)));
  const orders = rep.rows.filter(r => r.order != null).map(r => [r.day, r.order, r.lead, r.daysUntil]);
  ok(JSON.stringify(orders) === JSON.stringify([[0,8,2,2],[5,8,1,1],[10,13,2,2],[15,9,1,1],[20,12,1,1],[25,9,1,1]]), 'orders: day, quantity, lead, days until arrival', JSON.stringify(orders));
  ok(rep.rows[1].daysUntil === 1 && rep.rows[2].daysUntil == null, 'countdown after the day-0 order');
  close(rep.outputs.avgInv, 2.76, 1e-12, 'average ending inventory 2.76');
  ok(rep.summary.totalShort === 14, 'total shortage 14');
  ok(rep.outputs.shortDays === 5, 'five days with a shortage');
  close(rep.outputs.cost, 1 * 69 + 10 * 14, 1e-9, '25-day cost at the default h = 1, p = 10 is $209');
  const rep2 = inv.run({ M: 11, N: 5, h: 2, p: 0 }, { demandValue: d => demand[d - 1], leadValue: (() => { let j = 0; return () => leads[j++]; })() });
  close(rep2.outputs.cost, 138, 1e-9, '25-day cost at h = 2, p = 0 is $138');
  ok(rep.rows[10].pen === 20 && rep.rows[10].hold === 0 && rep.rows[3].hold === 6, 'per-day holding and backorder charges on days 3 and 10');
  ok(rep.rows[1].onOrder === 8 && rep.rows[2].onOrder === 8 && rep.rows[3].onOrder === 0 && rep.rows[6].onOrder === 8 && rep.rows[7].onOrder === 0, 'on order reads 8 on days 1–2 and 6, and 0 on days 3 and 7 after the arrivals', JSON.stringify(rep.rows.slice(1, 8).map(r => r.onOrder)));
  const a = inv.replicate(3, { M: 11, N: 5 }), b = inv.replicate(3, { M: 11, N: 5 });
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed reproduces');
  const xs = []; for (let i = 0; i < 2000; i++) xs.push(inv.replicate(i, { M: 11, N: 5 }).outputs.avgInv);
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  ok(m > 2 && m < 4.5, `average ending inventory over 2000 runs is plausible (${m.toFixed(3)})`);
  const big = inv.replicate(5, { M: 20, N: 1 });
  ok(big.outputs.shortDays <= 2, 'M=20, N=1 rarely runs short');
  /* The book's later order rule, M - ending - on order + shortage, keeps the
     inventory position (on hand + on order - backorders) from exceeding M at a
     review even when lead times outrun the review period; the older rule
     without the on-order term double-orders. Daily reviews with a 3-day lead. */
  const dbl = inv.run({ M: 11, N: 1 }, { demandValue: () => 2, leadValue: () => 3 });
  ok(dbl.rows.slice(1).every(r => r.onOrder != null), 'rows carry the on-order quantity');
  const posMax = Math.max(...dbl.rows.slice(1).map(r => r.ending - r.shortage + r.onOrder - (r.demand || 0) + (r.order || 0)));
  ok(dbl.rows.slice(1).every(r => r.order == null || r.ending - r.shortage + r.onOrder + r.order <= 11), 'inventory position after a review never exceeds M with daily reviews and a 3-day lead', 'max ' + posMax);
  const totalOrdered = dbl.rows.reduce((a, r) => a + (r.order || 0), 0);
  ok(totalOrdered <= 11 + 25 * 2, `total ordered over 25 days is at most M plus total demand (${totalOrdered} <= 61)`);
}

section('Delivery drops');
{
  const dr = M.models.dr, poly = dr.tables.poly;
  ok(M.insidePolygon(poly, 0, 0) && M.insidePolygon(poly, 450, 0) && !M.insidePolygon(poly, 900, -400) && !M.insidePolygon(poly, -450, 0) && M.insidePolygon(poly, 100, 500) && !M.insidePolygon(poly, -300, 500), 'inside test at known points');
  /* Cross-check the ray-cast test against the interval decomposition on a grid that
     avoids the zone's vertical edges, where the two tests differ by convention. */
  let agree = 0, total = 0;
  for (let y = -600; y <= 700; y += 10) { const iv = M.polygonXIntervals(poly, y + 0.5); for (let x = -700.5; x <= 700; x += 10) { total++; const inIv = iv.some(([a, b]) => x > a && x < b); if (inIv === M.insidePolygon(poly, x, y + 0.5)) agree++; } }
  ok(agree === total, `ray cast and interval decomposition agree on ${total} grid points (${agree})`);
  const p = M.drHitProb();
  ok(p > 0.5 && p < 0.8, `hit probability by quadrature is plausible (${p.toFixed(5)})`);
  const rep = dr.run({ n: 3 }, { z: (() => { const zs = [0, 0, 2.25, 0, 0, -2.5]; let i = 0; return () => zs[i++]; })() });
  ok(rep.rows[0].hit === true && rep.rows[1].hit === false && rep.rows[2].hit === false && rep.outputs.hits === 1, 'z-driven run: (0,0) hits, (900,0) misses, (0,-500) misses');
  const N = 20000; let hits = 0; const counts = new Array(11).fill(0);
  for (let i = 0; i < N; i++) { const rr = dr.replicate(i, { n: 10 }); hits += rr.outputs.hits; counts[rr.outputs.hits]++; }
  rateOk(hits, 10 * N, p, 4, 'pooled hit rate matches quadrature');
  const pmf = M.binomPmf(10, p); let chi = 0;
  for (let k = 0; k <= 10; k++) { const e = N * pmf[k]; if (e >= 5) chi += (counts[k] - e) ** 2 / e; }
  ok(chi < 30, `hit count is binomial (chi-square ${chi.toFixed(1)} < 30 on about 9 df)`);
}

section('Bearing replacement');
{
  const br = M.models.br, c = br.tables.cost;
  ok(c.eventEach(0) === 32 + 200 + 10 && c.eventEach(10) === 342, 'single-bearing event cost: $32 + 20 min × $10 + 20 min × $0.50 + delay × $10');
  ok(c.eventSet(0) === 96 + 400 + 20 && c.eventSet(15) === 666, 'three-bearing event cost');
  ok(c.planned === 516, 'planned replacement has no delay');
  const life = br.tables.life; close(M.tableMean(life), 1337, 1e-12, 'mean bearing life 1337 h');
  const cyc = M.brCycleTable('set'); close(M.tableMean(cyc), 1142.35, 2e-3, 'mean of the minimum of three lives');
  const cycT = M.brCycleTable('age', 1300); ok(Math.abs(cycT.probs.reduce((a, b) => a + b, 0) - 1) < 1e-12 && cycT.values[cycT.values.length - 1] === 1300, 'age-T cycle table ends at T');
  /* A deterministic run: every life 1000 h, every delay 5 min, policy each. */
  const rep = br.run({ policy: 'each', T: 1300 }, { life: () => 0.05, delay: () => 0.1 });
  ok(rep.summary.events === 60 && Math.abs(rep.summary.total - 60 * c.eventEach(5)) < 1e-9, '20 000 h at 1000 h lives: 20 events per position');
  close(rep.outputs.cost, 60 * c.eventEach(5) / 6, 1e-12, 'output is total / 6');
  const repS = br.run({ policy: 'set', T: 1300 }, { life: () => 0.05, delay: () => 0.1 });
  ok(repS.summary.events === 20 && repS.rows[0].cause === 'install' && repS.rows.slice(1).every(r => r.cause === 'failure'), 'set policy: 20 set replacements (plus the install row)');
  const repA = br.run({ policy: 'age', T: 1300 }, { life: () => 0.9, delay: () => 0.1 });
  ok(repA.rows[0].cause === 'install' && repA.rows.slice(1).every(r => r.cause === 'planned') && repA.summary.events === 15, 'age policy with long lives: planned every 1300 h, 15 in the horizon (plus the install row)');
  const repA2 = br.run({ policy: 'age', T: 1000 }, { life: () => 0.05, delay: () => 0.1 });
  ok(repA2.rows.slice(1).every(r => r.cause === 'planned'), 'a life equal to T is replaced as planned');
  // Task 60: the install row and the first replacement rows carry the
  // expected lives (u = 0.05 discretizes to 1000 h throughout this
  // deterministic setup), and the new row leaves cost/cum untouched.
  ok(rep.rows[0].cause === 'install' && rep.rows[0].pos === 'all' && rep.rows[0].cost === 0 && rep.rows[0].cum === 0
    && JSON.stringify(rep.rows[0].lifeH) === JSON.stringify([1000, 1000, 1000])
    && rep.rows[1].cause === 'failure' && JSON.stringify(rep.rows[1].lifeH) === JSON.stringify([1000])
    && rep.rows[1].cum === rep.rows[1].cost,
    "each policy: the install row carries the three initial lives, cost 0, and the first replacement row's own single life");
  ok(repS.rows[0].cause === 'install' && JSON.stringify(repS.rows[0].lifeH) === JSON.stringify([1000, 1000, 1000]) && repS.rows[0].cost === 0
    && JSON.stringify(repS.rows[1].lifeH) === JSON.stringify([1000, 1000, 1000]) && repS.rows[1].cum === repS.rows[1].cost
    && repS.rows[repS.rows.length - 1].cum === repS.summary.total,
    'set policy: the install row and the first replacement row each carry three lives, and cost/cum are unaffected by the install row');
  for (const [policy, T] of [['each', 1300], ['set', 1300], ['age', 1300], ['age', 1100], ['age', 1700]]) {
    const want = M.brExpectedCost(policy, T), xs = [];
    for (let i = 0; i < 4000; i++) xs.push(br.replicate(i, { policy, T }).outputs.cost);
    mcMeanOk(xs, want, 3.5, `MC mean cost matches renewal reference, ${policy} T=${T} (${want.toFixed(1)})`);
  }
  ok(M.brExpectedCost('set', 0) < M.brExpectedCost('each', 0), 'replace-all is cheaper per bearing-hour than replace-on-failure');
  const lanes = br.replicate(11, { policy: 'set', T: 1300 }).summary.lanes;
  ok(lanes.length === 3 && lanes[0].length === lanes[1].length && lanes[0].every((b, i) => b.end === lanes[1][i].end), 'set policy cuts all three lanes at the same clocks');
}

section('Activity network');
{
  const an = M.models.an;
  close(M.anPathCdf(0, 8), 0.5, 1e-12, 'path 1 median 8'); close(M.anPathCdf(1, 8), 0.5, 1e-12, 'path 2 median 8'); close(M.anPathCdf(2, 8), 0.5, 1e-12, 'path 3 median 8');
  close(M.anPathCdf(0, 4), 0, 1e-12, 'support starts at 4'); close(M.anPathCdf(2, 12), 1, 1e-12, 'support ends at 12');
  close(M.simpson(t => M.anPathPdf(2, t), 4, 12, 2000), 1, 1e-8, 'path 3 pdf integrates to 1');
  close(M.anFinishCdf(8), 0.125, 1e-12, 'finish cdf at 8 is 1/8');
  close(M.simpson(t => M.anFinishPdf(t), 4, 12, 4000), 1, 1e-6, 'finish pdf integrates to 1');
  const lp = M.anLongestProbs(); close(lp.reduce((a, b) => a + b, 0), 1, 1e-6, 'longest-path probabilities sum to 1');
  ok(lp[0] > lp[1] && lp[1] > lp[2], `the widest path is longest most often (${lp.map(x => x.toFixed(3)).join(', ')})`);
  const rep = an.run({}, { u: () => 0.5 });
  ok(rep.rows.length === 7 && Math.abs(rep.outputs.finish - 8) < 1e-12 && rep.summary.totals.every(t => Math.abs(t - 8) < 1e-12), 'all-median run finishes at 8');
  const N = 20000, fin = [], longest = [0, 0, 0];
  for (let i = 0; i < N; i++) { const rr = an.replicate(i, {}); fin.push(rr.outputs.finish); longest[rr.summary.longest]++; }
  for (const t of [7, 8, 9, 10, 11]) rateOk(fin.filter(x => x <= t).length, N, M.anFinishCdf(t), 4, `empirical finish cdf at ${t}`);
  for (let j = 0; j < 3; j++) rateOk(longest[j], N, lp[j], 4, `longest-path frequency, path ${j + 1}`);
}

section('Queueing node (Tables 2.11 and 2.15)');
{
  const q = M.models.q;
  const r0 = M.mulberry32(5); let se = 0; const NE = 100000;
  for (let i = 0; i < NE; i++) se += M.expInv(M.unif(r0), 0.5);
  close(se / NE, 2, 0.02, 'exponential by inverse transform has mean 1/rate');
  close(M.mmcWq(0.8, 1, 1), 4, 1e-12, 'M/M/1 Wq = rho/(mu - lambda) = 4');
  close(M.mmcWq(1.6, 1, 2), 0.7111111111 / 0.4, 1e-8, 'M/M/2 Erlang-C Wq at lambda 1.6, mu 1');
  /* Book Table 2.11 (M/M/1): the first eleven customers. */
  const ia1 = [null, 5, 5, 4, 2, 8, 7, 8, 5, 2, 1], sv1 = [2, 2, 4, 4, 3, 2, 3, 5, 1, 6, 4];
  const t11 = q.run({ lam: 1, mu: 1, c: 1, n: 11 }, { iaValue: i => ia1[i - 1], svcValue: i => sv1[i - 1] });
  const g = k => t11.rows.map(r => r[k]);
  ok(JSON.stringify(g('arr')) === JSON.stringify([0, 5, 10, 14, 16, 24, 31, 39, 44, 46, 47]), 'arrival times', JSON.stringify(g('arr')));
  ok(JSON.stringify(g('begin')) === JSON.stringify([0, 5, 10, 14, 18, 24, 31, 39, 44, 46, 52]), 'service begins', JSON.stringify(g('begin')));
  ok(JSON.stringify(g('wait')) === JSON.stringify([0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 5]), 'waiting time in queue', JSON.stringify(g('wait')));
  ok(JSON.stringify(g('end')) === JSON.stringify([2, 7, 14, 18, 21, 26, 34, 44, 45, 52, 56]), 'service ends', JSON.stringify(g('end')));
  ok(JSON.stringify(g('sys')) === JSON.stringify([2, 2, 4, 4, 5, 2, 3, 5, 1, 6, 9]), 'time in system', JSON.stringify(g('sys')));
  ok(JSON.stringify(g('idle')) === JSON.stringify([null, 3, 3, 0, 0, 3, 5, 5, 0, 1, 0]), 'server idle time', JSON.stringify(g('idle')));
  /* Book Table 2.15 (M/M/2, Able then Baker): ten callers. */
  const ia2 = [null, 1, 1, 3, 2, 2, 1, 2, 4, 1], sv2 = [4, 4, 3, 3, 5, 5, 5, 4, 2, 3];
  const t15 = q.run({ lam: 1, mu: 1, c: 2, n: 10 }, { iaValue: i => ia2[i - 1], svcValue: i => sv2[i - 1] });
  const h = k => t15.rows.map(r => r[k]);
  ok(JSON.stringify(h('server')) === JSON.stringify(['Able', 'Baker', 'Able', 'Baker', 'Able', 'Baker', 'Able', 'Baker', 'Able', 'Baker']), 'server chosen alternates', JSON.stringify(h('server')));
  ok(JSON.stringify(h('freeA')) === JSON.stringify([0, 4, 4, 7, 7, 12, 12, 17, 17, 19]) && JSON.stringify(h('freeB')) === JSON.stringify([0, 0, 5, 5, 8, 8, 14, 14, 18, 18]), 'when Able and Baker are available', JSON.stringify([h('freeA'), h('freeB')]));
  ok(JSON.stringify(h('begin')) === JSON.stringify([0, 1, 4, 5, 7, 9, 12, 14, 17, 18]), 'service begins (M/M/2)', JSON.stringify(h('begin')));
  ok(JSON.stringify(h('nextA')) === JSON.stringify([4, 4, 7, 7, 12, 12, 17, 17, 19, 19]) && JSON.stringify(h('nextB')) === JSON.stringify([0, 5, 5, 8, 8, 14, 14, 18, 18, 21]), 'next completion times', JSON.stringify([h('nextA'), h('nextB')]));
  ok(JSON.stringify(h('wait')) === JSON.stringify([0, 0, 2, 0, 0, 0, 2, 2, 1, 1]), 'caller delay', JSON.stringify(h('wait')));
  ok(JSON.stringify(h('sys')) === JSON.stringify([4, 4, 5, 3, 5, 5, 7, 6, 3, 4]), 'time in system (M/M/2)', JSON.stringify(h('sys')));
  ok(q.columnsFor({ c: 2 }).length === 12 && q.columnsFor({ c: 1 }).length === 9, 'column sets by capacity (amended Task 60: no u columns)');
  /* Task 67: T (end time), not n (a customer count), is the decision now;
     this exercises that path (n undefined, T terminates the loop) rather
     than the fixed-cap one Tables 2.11/2.15 use above. */
  const a = q.replicate(9, { lam: 0.8, mu: 1, c: 1, T: 25 }), b = q.replicate(9, { lam: 0.8, mu: 1, c: 1, T: 25 });
  ok(JSON.stringify(a) === JSON.stringify(b) && a.rows.length > 0 && a.rows[0].ia === null && a.rows.every(r => r.arr <= 25), 'same seed reproduces; first customer arrives at 0; every arrival by T');
  /* Long replications approach the steady-state wait (the start-from-empty
     transient is a small downward bias); T = 5000 min gives a comparable
     customer count to the old n = 4000 at these rates. */
  const w1 = []; for (let i = 0; i < 40; i++) w1.push(q.replicate(100 + i, { lam: 0.8, mu: 1, c: 1, T: 5000 }).outputs.avgWait);
  const m1 = w1.reduce((x, y) => x + y, 0) / 40;
  ok(Math.abs(m1 - 4) / 4 < 0.08, `M/M/1 long-run average wait near 4 (${m1.toFixed(3)})`);
  const w2 = []; for (let i = 0; i < 40; i++) w2.push(q.replicate(200 + i, { lam: 1.6, mu: 1, c: 2, T: 5000 }).outputs.avgWait);
  const m2 = w2.reduce((x, y) => x + y, 0) / 40;
  ok(Math.abs(m2 - 1.7778) / 1.7778 < 0.08, `M/M/2 long-run average wait near 1.778 (${m2.toFixed(3)})`);
  /* Every customer arrives at or before T, and the arrival count across many
     replications is Poisson-plausible: mean lambda*T, standard error of the
     200-replication sample mean sqrt(lambda*T/200). */
  const lamChk = 0.8, Tchk = 200, repsChk = 200;
  let allByT = true; const counts = [];
  for (let i = 0; i < repsChk; i++) {
    const rep = q.replicate(3000 + i, { lam: lamChk, mu: 1, c: 1, T: Tchk });
    if (!rep.rows.every(r => r.arr <= Tchk)) allByT = false;
    counts.push(rep.rows.length);
  }
  ok(allByT, 'every customer in a replication arrives at or before T');
  const meanCount = counts.reduce((x, y) => x + y, 0) / repsChk, expectedCount = lamChk * Tchk;
  const seCount = Math.sqrt(expectedCount / repsChk);
  ok(Math.abs(meanCount - expectedCount) <= 4 * seCount, `arrival count is Poisson-plausible (mean ${meanCount.toFixed(1)} vs lambda*T = ${expectedCount}, 4 se = ${(4 * seCount).toFixed(2)})`);
}

// SECTIONS-END

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (fail) { console.log(failures.map(f => '  ' + f).join('\n')); process.exit(1); }
