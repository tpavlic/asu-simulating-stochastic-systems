// Special functions against R. Every expected value in reference/special.json
// was produced by reference/special.R with R's own ptukey, qtukey, qt, pt,
// qchisq, qf, pf, pnorm, qnorm, and lgamma; the Dunnett critical values are
// a Monte Carlo of the max-|T| statistic in R, compared within three standard
// errors of the batch means.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../js/stats/special.js';

const ref = JSON.parse(readFileSync(new URL('./reference/special.json', import.meta.url), 'utf8'));
const close = (got, want, tol, label) =>
  assert.ok(Math.abs(got - want) <= tol, `${label}: got ${got}, want ${want} (tol ${tol})`);

test('logGamma matches lgamma', () => {
  for (const c of ref.lgamma) close(S.logGamma(c.x), c.v, 1e-12, `lgamma(${c.x})`);
});
test('normal cdf and quantile match pnorm and qnorm', () => {
  for (const c of ref.pnorm) close(S.normCdf(c.z), c.p, 1e-14, `pnorm(${c.z})`);
  for (const c of ref.qnorm) close(S.normInv(c.p), c.z, 1e-12, `qnorm(${c.p})`);
});
test('t cdf and quantile match pt and qt', () => {
  for (const c of ref.pt) close(S.tCdf(c.t, c.nu), c.p, 1e-13, `pt(${c.t}, ${c.nu})`);
  for (const c of ref.qt) close(S.tQuantile(c.p, c.nu), c.q, 1e-10, `qt(${c.p}, ${c.nu})`);
});
test('chi-square and F quantiles match qchisq, qf, and pf', () => {
  for (const c of ref.qchisq) close(S.chi2Quantile(c.p, c.k), c.q, 1e-10, `qchisq(${c.p}, ${c.k})`);
  for (const c of ref.qf) close(S.fQuantile(c.p, c.d1, c.d2), c.q, 1e-10, `qf(${c.p}, ${c.d1}, ${c.d2})`);
  for (const c of ref.pf) close(S.fCdf(c.f, c.d1, c.d2), c.p, 1e-13, `pf(${c.f}, ${c.d1}, ${c.d2})`);
});
test('studentized range matches ptukey and qtukey', () => {
  for (const c of ref.ptukey) close(S.ptukey(c.q, c.k, c.nu), c.p, 2e-7, `ptukey(${c.q}, ${c.k}, ${c.nu})`);
  for (const c of ref.qtukey) close(S.qtukey(c.p, c.k, c.nu), c.q, 2e-6, `qtukey(${c.p}, ${c.k}, ${c.nu})`);
});
test('Dunnett critical values agree with a Monte Carlo of the max-|T| statistic', () => {
  for (const c of ref.dunnett) {
    const lambdas = c.ns.slice(1).map(n => Math.sqrt(n / c.ns[0]));
    close(S.qdunnett(0.95, lambdas, c.nu, true), c.two, 3 * c.twoSe + 1e-4, `two-sided ns=${c.ns}`);
    close(S.qdunnett(0.95, lambdas, c.nu, false), c.one, 3 * c.oneSe + 1e-4, `one-sided ns=${c.ns}`);
    close(S.pdunnett(S.qdunnett(0.95, lambdas, c.nu, true), lambdas, c.nu, true), 0.95, 1e-6, 'round trip');
  }
});
test("Rinott's constant matches Table A.12", () => {
  // Table A.12 of Banks, Carson, Nelson, and Nicol, Discrete-Event System
  // Simulation (5th ed.), rows [P*, n0, k, h], to the table's three decimals.
  const rows = [[0.90, 5, 2, 2.291], [0.90, 20, 10, 3.437], [0.95, 5, 10, 5.797],
                [0.95, 10, 2, 2.614], [0.95, 10, 8, 4.106], [0.95, 20, 10, 3.875],
                [0.95, 50, 2, 2.373], [0.975, 10, 8, 4.635]];
  for (const [p, n0, k, h] of rows) close(S.rinottH(n0, k, p), h, 3e-3, `h(${n0}, ${k}, ${p})`);
});
// On few degrees of freedom each quantile lies far out (past 20, the end of
// the old search) and the integrand over s = S/σ rises near s = 1/q. Expected
// values in reference/lowdf.json come from reference/lowdf.R: nested
// integrate() split at 1/q and 10/q, and uniroot(). R's own qtukey is not the
// reference here; it returns NaN below 2 degrees of freedom and misses
// q(0.99, 4, 2) by about 1%.
const low = JSON.parse(readFileSync(new URL('./reference/lowdf.json', import.meta.url), 'utf8'));
const rel = (got, want, tol, label) => close(got, want, tol * Math.abs(want), label);
test('studentized range quantiles on few degrees of freedom match nested integration', () => {
  for (const c of low.tukey) {
    rel(S.qtukey(c.p, c.k, c.nu), c.q, 1e-7, `qtukey(${c.p}, ${c.k}, ${c.nu})`);
    close(S.ptukey(c.q, c.k, c.nu), c.p, 1e-9, `ptukey at the reference q(${c.p}, ${c.k}, ${c.nu})`);
  }
});
test('the studentized range of two means is √2 times the two-sided t quantile', () => {
  for (const nu of [1, 1.5, 2, 3, 7.25]) for (const p of [0.9, 0.95, 0.99, 0.999]) {
    rel(S.qtukey(p, 2, nu), Math.SQRT2 * S.tQuantile((1 + p) / 2, nu), 1e-7, `qtukey(${p}, 2, ${nu})`);
  }
});
test('Dunnett critical values on few degrees of freedom match nested integration', () => {
  for (const c of low.dunnett) {
    const lambdas = c.ns.slice(1).map(n => Math.sqrt(n / c.ns[0]));
    rel(S.qdunnett(c.p, lambdas, c.nu, true), c.c, 1e-7, `qdunnett(${c.p}, ns=${c.ns}, ${c.nu})`);
  }
});
test("Dunnett's value for one comparison is the t quantile", () => {
  // One treatment: two-sided, the t quantile at (1 + p)/2 (63.657 at 0.99 on 1 df); one-sided, at p.
  for (const nu of [1, 1.5, 2, 5]) for (const p of [0.95, 0.99]) for (const l of [1, Math.sqrt(2)]) {
    rel(S.qdunnett(p, [l], nu, true), S.tQuantile((1 + p) / 2, nu), 1e-7, `two-sided ${p}, ${nu}, λ=${l}`);
    rel(S.qdunnett(p, [l], nu, false), S.tQuantile(p, nu), 1e-7, `one-sided ${p}, ${nu}, λ=${l}`);
  }
});
test("Rinott's constant on a first stage of two replications matches nested integration", () => {
  for (const c of low.rinott) rel(S.rinottH(c.n0, c.k, c.pstar), c.h, 1e-6, `h(${c.n0}, ${c.k}, ${c.pstar})`);
});
test('quadrature integrates a polynomial exactly', () => {
  close(S.quad(x => x * x * x - 2 * x + 1, -1, 2, 4, 8), (16 / 4 - 4 + 2) - (1 / 4 - 1 - 1), 1e-13, 'cubic');
});
