// Regenerates the example datasets into a temporary directory and checks that they match the
// committed files byte for byte, and that each module entry's text equals its data file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'data', 'generate_examples.mjs');
const { EXAMPLES } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'examples.js')).href);
const { sniff, buildDatasets } = await import(pathToFileURL(path.join(ROOT, 'js', 'io', 'parse.js')).href);
const { repEstimates } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'model.js')).href);
const { levene } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { pairedT } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { applyTransform } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'transform.js')).href);
const { pairingDefault } = await import(pathToFileURL(path.join(ROOT, 'js', 'ui', 'rules.js')).href);
const { posthoc, bonferroniFamily } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { shapiroWilk } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'normality.js')).href);
const { subsetSelection } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'select.js')).href);
const { anova, welchAnova } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'compare.js')).href);
const { kruskalWallis, dunn } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'nonparam.js')).href);

// Each design's replication outcomes of an example, loaded with its own mapping.
const groupsOf = id => {
  const ex = EXAMPLES.find(e => e.id === id);
  return buildDatasets(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).datasets.map(d => Array.from(repEstimates(d)));
};
// The screen at the page's default indifference zone, 10% of the pooled standard deviation to two digits.
const pageScreen = (groups, dir) => subsetSelection(groups, { alpha: 0.05, delta: Number((0.1 * Math.sqrt(anova(groups).msw)).toPrecision(2)), dir });

test('regenerated files match the committed ones byte for byte', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-'));
  try {
    execFileSync('node', [GEN, '--out', tmp]);
    const files = fs.readdirSync(path.join(tmp, 'data'));
    assert.equal(files.length, 14);
    for (const f of files) {
      assert.ok(fs.readFileSync(path.join(tmp, 'data', f)).equals(fs.readFileSync(path.join(ROOT, 'data', f))), f);
    }
    const mod = path.join('js', 'data', 'examples.js');
    assert.ok(fs.readFileSync(path.join(tmp, mod)).equals(fs.readFileSync(path.join(ROOT, mod))), mod);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('each entry carries its data file text and a mapping with a kind', () => {
  assert.equal(EXAMPLES.length, 14);
  for (const e of EXAMPLES) {
    assert.equal(e.text, fs.readFileSync(path.join(ROOT, 'data', e.file), 'utf8'), e.file);
    assert.ok(['tally', 'time', 'reps'].includes(e.mapping.kind), e.id);
    assert.equal(e.mapping.kind, e.kind);
    assert.ok(['minus1', 'columns'].includes(e.format));
  }
});

// The two proportion examples exist to show which transform evens out the
// designs' spreads, and so their descriptions' claims are pinned here: Levene's
// test rejects equal spreads on the raw outcomes, and stops rejecting under
// the transform each description names, but not under the other.
test('the service-level and utilization examples show the transforms their descriptions name', () => {
  const p = (id, tf) => {
    const ex = EXAMPLES.find(e => e.id === id);
    const groups = buildDatasets(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).datasets.map(d => applyTransform(repEstimates(d), tf).values);
    return levene(groups).p;
  };
  assert.ok(p('service-level', 'none') < 0.01 && p('service-level', 'logit') > 0.5 && p('service-level', 'asin_sqrt') < 0.05);
  assert.ok(p('utilization', 'none') < 0.01 && p('utilization', 'log') > 0.5 && p('utilization', 'asin_sqrt') < 0.01 && p('utilization', 'logit') < 0.01);
});

// The oven example's description says that the choice of output decides the comparison: paired
// across the shared demand streams, the time in system cannot tell the policies apart, and the
// muffins unfinished, loaded through the dialog in its place, favor the nearly full policy.
test('the muffin-oven example shows the outputs disagreeing, as its description says', () => {
  const ex = EXAMPLES.find(e => e.id === 'muffin-oven');
  const sn = sniff(ex.text, { name: ex.mapping.name });
  const paired = value => {
    const [greedy, full] = buildDatasets(sn, Object.assign({}, ex.mapping, { value })).datasets.map(repEstimates);
    assert.equal(greedy.length, 10);
    return pairedT(full, greedy, 0.95);
  };
  assert.deepEqual(sn.header, ['policy', 'block', 'avg_time_in_system', 'utilization', 'max_waiting', 'unfinished']);
  const tis = paired(2), left = paired(5);
  assert.ok(tis.p > 0.2, 'time in system p ' + tis.p);
  assert.ok(left.p < 0.05 && left.meanD < 0, 'unfinished p ' + left.p + ', mean difference ' + left.meanD);
});

// The customers-served example exists to show a pooled one-way analysis of variance with no
// assumption flagged, and so its description's claims are pinned here at the page's default
// 95%: the F test rejects, Shapiro-Wilk on the residuals and Levene's test across the designs
// both keep p well above 0.1, Tukey's letters group A with B and D with E, and with bigger taken
// as better the screen, at the page's default indifference zone (10% of the pooled standard
// deviation), keeps D and E.
test('the customers-served example passes its checks and groups the designs as its description says', () => {
  const ex = EXAMPLES.find(e => e.id === 'customers-served');
  const groups = buildDatasets(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).datasets.map(d => Array.from(repEstimates(d)));
  assert.deepEqual(groups.map(g => g.length), [20, 20, 20, 20, 20]);
  const ph = posthoc(groups, { rule: 'tukey', alpha: 0.05 });
  const av = ph.anova;
  const resid = groups.flatMap((g, i) => g.map(v => v - av.means[i]));
  assert.ok(av.p < 0.001, 'F test p ' + av.p);
  assert.ok(shapiroWilk(resid).p > 0.5, 'Shapiro-Wilk p ' + shapiroWilk(resid).p);
  assert.ok(levene(groups).p > 0.5, 'Levene p ' + levene(groups).p);
  assert.deepEqual(ph.letters, ['a', 'a', 'b', 'c', 'c']);
  const ss = subsetSelection(groups, { alpha: 0.05, delta: Number((0.1 * Math.sqrt(av.msw)).toPrecision(2)), dir: 'max' });
  assert.deepEqual(ss.survivors, [false, false, false, true, true]);
});

// The versus-control example exists to show Holm's step-down declaring more than Bonferroni
// against a control, and so its description's claims are pinned here at the page's default 95%:
// every design's outcomes pass Shapiro-Wilk (p above 0.1), the residuals and Levene's test keep
// p above 0.5, the four p-values against A round to the values the description gives (three decimals, four
// for the smallest), Bonferroni
// declares only E, Holm's step-down declares all four, and Dunnett's procedure only E.
test('the versus-control example has Holm declaring all that Bonferroni misses, as its description says', () => {
  const groups = groupsOf('versus-control');
  assert.deepEqual(groups.map(g => g.length), [20, 20, 20, 20, 20]);
  const av = anova(groups);
  const resid = groups.flatMap((g, i) => g.map(v => v - av.means[i]));
  for (const [i, g] of groups.entries()) assert.ok(shapiroWilk(g).p > 0.1, 'Shapiro-Wilk on design ' + (i + 1) + ': p ' + shapiroWilk(g).p);
  assert.ok(shapiroWilk(resid).p > 0.5, 'Shapiro-Wilk on the residuals: p ' + shapiroWilk(resid).p);
  assert.ok(levene(groups).p > 0.5, 'Levene p ' + levene(groups).p);
  const declared = adjust => bonferroniFamily(groups, { mode: 'control', control: 0, level: 0.95, adjust })
    .comparisons.filter(c => c.declared).map(c => c.i);
  assert.deepEqual(declared('bonferroni'), [4]);
  assert.deepEqual(declared('holm'), [1, 2, 3, 4]);
  const ps = bonferroniFamily(groups, { mode: 'control', control: 0, level: 0.95 }).comparisons.map(c => Number(c.p.toFixed(c.p < 0.01 ? 4 : 3)));
  assert.deepEqual(ps, [0.044, 0.016, 0.021, 0.0002]);
  assert.deepEqual(posthoc(groups, { rule: 'dunnett', alpha: 0.05, control: 0 }).pairs.filter(p => p.flagged).map(p => p.i), [4]);
  const ex = EXAMPLES.find(e => e.id === 'versus-control');
  for (const claim of ['0.044, 0.016, 0.021, and 0.0002', 'declares only E different from A', 'declares all four']) assert.ok(ex.description.includes(claim), claim);
});

// The four-designs example is the nonparametric one, and its description gives the numbers, to
// the digits it states them in: Shapiro-Wilk on the residuals of the one-way analysis of variance
// rejects (p = 0.009), the pooled F test just misses at 5% (p = 0.052), Kruskal-Wallis just
// rejects (p = 0.048), and Dunn's comparisons, under either adjustment, declare only A and D
// different.
test('the four-designs example fails normality and is decided by the rank test, as its description says', () => {
  const groups = groupsOf('four-designs');
  assert.deepEqual(groups.map(g => g.length), [10, 10, 10, 10]);
  const av = anova(groups);
  const resid = groups.flatMap((g, i) => g.map(v => v - av.means[i]));
  const r3 = x => Number(x.toFixed(3));
  assert.equal(r3(shapiroWilk(resid).p), 0.009);
  assert.equal(r3(av.p), 0.052);
  assert.equal(r3(kruskalWallis(groups).p), 0.048);
  for (const adjust of ['bonferroni', 'holm']) {
    assert.deepEqual(dunn(groups, { alpha: 0.05, adjust }).pairs.filter(p => p.flagged).map(p => [p.i, p.j]), [[0, 3]], adjust);
  }
  const ex = EXAMPLES.find(e => e.id === 'four-designs');
  for (const claim of ['p ≈ 0.009', 'p ≈ 0.052', 'p ≈ 0.048', 'declare A and D different']) assert.ok(ex.description.includes(claim), claim);
});

// The six-designs example exists to show the screen for the best on unequal spreads, which it
// allows because it uses each design's own variance. Its description's claims are pinned here at
// the page's default 95%: every design's outcomes and the residuals of the one-way analysis of
// variance pass Shapiro-Wilk comfortably (p above 0.25), Levene's test rejects equal spreads
// clearly (p below 0.001), the three Erlang designs' standard deviations are about half the
// exponential ones', and with bigger taken as better the screen keeps E and F, whose second-stage
// sizes differ by about three and a half times.
test('the six-designs example has unequal spreads that the screen takes in stride, as its description says', () => {
  const groups = groupsOf('six-designs');
  assert.deepEqual(groups.map(g => g.length), [20, 20, 20, 20, 20, 20]);
  const av = anova(groups);
  const resid = groups.flatMap((g, i) => g.map(v => v - av.means[i]));
  for (const [i, g] of groups.entries()) assert.ok(shapiroWilk(g).p > 0.25, 'Shapiro-Wilk on design ' + (i + 1) + ': p ' + shapiroWilk(g).p);
  assert.ok(shapiroWilk(resid).p > 0.5, 'Shapiro-Wilk on the residuals: p ' + shapiroWilk(resid).p);
  assert.ok(levene(groups).p < 0.001, 'Levene p ' + levene(groups).p);
  const sd = g => { const m = g.reduce((x, y) => x + y) / g.length; return Math.sqrt(g.reduce((t, v) => t + (v - m) ** 2, 0) / (g.length - 1)); };
  const ratio = [0, 2, 4].map(i => sd(groups[i + 1]) / sd(groups[i]));
  assert.ok(ratio.every(q => q > 0.4 && q < 0.6), 'Erlang over exponential standard deviations ' + ratio);
  assert.ok(av.p < 0.001 && welchAnova(groups).p < 0.001);
  const ss = pageScreen(groups, 'max');
  assert.deepEqual(ss.survivors, [false, false, false, false, true, true]);
  assert.equal(Math.round(ss.N[4] / ss.N[5] * 2) / 2, 3.5);
});

// The examples run on common random numbers name their replication column "block", and so
// they open paired both when loaded with their own mapping and when the file is read with the
// mapping the importer suggests (the Assign its columns myself path); the others do not.
test('the common-random-numbers examples mark their ids as blocks, and only they do', () => {
  const BLOCKED = ['two-crn', 'muffin-oven', 'four-crn'];
  for (const ex of EXAMPLES) {
    const sn = sniff(ex.text, { name: ex.mapping.name });
    const blocked = BLOCKED.includes(ex.id);
    assert.equal(!!ex.mapping.blocks, blocked, ex.id + ' mapping');
    assert.equal(!!sn.suggested.blocks, blocked, ex.id + ' suggested mapping');
    for (const mapping of [ex.mapping, Object.assign({}, sn.suggested, { kind: ex.mapping.kind, value: ex.mapping.value })]) {
      const ds = buildDatasets(sn, mapping).datasets;
      if (ds.length < 2) continue;
      assert.equal(pairingDefault(ds).paired, blocked, ex.id);
    }
  }
});
