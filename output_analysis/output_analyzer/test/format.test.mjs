// Tests for js/ui/format.js. These are formatting rules, not statistics:
// every expected string follows from the rule each function documents
// (significant digits, decimals, separators), worked by hand from the
// decimal value, and so no R reference is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { num, fixed, pct, pValue, plural, intl, dash, esc } from '../js/ui/format.js';

test('dash is the en dash', () => {
  assert.equal(dash, '–');
});

test('num: significant digits with trailing zeros trimmed', () => {
  assert.equal(num(3.14159), '3.142');
  assert.equal(num(3.14159, 2), '3.1');
  assert.equal(num(2.5), '2.5');
  assert.equal(num(-2.5), '-2.5');
  assert.equal(num(0.1 + 0.2), '0.3');
  assert.equal(num(1200), '1200');
  assert.equal(num(123456), '123456');
  assert.equal(num(0.012345, 3), '0.0123');
  assert.equal(num(0), '0');
  assert.equal(num(-0), '0');
  assert.equal(num(-0.00001234, 3), '-1.23e-5');
  assert.equal(num(2e20, 3), '2e20');
});

test('num: a value that rounds up a decade', () => {
  // 9.99996 to 4 significant digits is 10.000, trimmed to 10.
  assert.equal(num(9.99996), '10');
  assert.equal(num(99999.6), '100000');
});

test('num, fixed, pct, pValue: non-finite values print as the en dash', () => {
  for (const v of [NaN, Infinity, -Infinity, null, undefined]) {
    assert.equal(num(v), dash);
    assert.equal(fixed(v, 2), dash);
    assert.equal(pct(v), dash);
    assert.equal(pValue(v), dash);
    assert.equal(intl(v), dash);
  }
});

test('fixed: exact decimals, no negative zero', () => {
  assert.equal(fixed(3.14159, 2), '3.14');
  assert.equal(fixed(2, 3), '2.000');
  assert.equal(fixed(-0.0001, 2), '0.00');
  assert.equal(fixed(-1.25, 1), '-1.3');
});

test('pct', () => {
  assert.equal(pct(0.953), '95.3%');
  assert.equal(pct(0.95, 0), '95%');
  assert.equal(pct(0.0412, 2), '4.12%');
});

test('pValue: below 0.001 as an inequality, three decimals otherwise', () => {
  assert.equal(pValue(0.0004), '< 0.001');
  assert.equal(pValue(0.001), '0.001');
  assert.equal(pValue(0.0123), '0.012');
  assert.equal(pValue(0.5), '0.500');
  assert.equal(pValue(1), '1.000');
});

test('intl: thousands separators on the integer part', () => {
  assert.equal(intl(3842), '3,842');
  assert.equal(intl(999), '999');
  assert.equal(intl(1000), '1,000');
  assert.equal(intl(1234567.5), '1,234,567.5');
  assert.equal(intl(-1234), '-1,234');
});

test('plural: the count with its noun', () => {
  assert.equal(plural(1, 'replication'), '1 replication');
  assert.equal(plural(20, 'replication'), '20 replications');
  assert.equal(plural(0, 'batch', 'batches'), '0 batches');
  assert.equal(plural(3842, 'observation'), '3,842 observations');
});

test('esc', () => {
  assert.equal(esc('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});
