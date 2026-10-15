// Tests for the dataset list in js/state.js: two datasets never share a name,
// because every data file and script is named from the dataset's name and the
// all-datasets observations file tells its datasets apart by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../js/state.js';
import { makeDataset } from '../js/data/model.js';

const ds = name => makeDataset({ name, kind: 'reps', reps: [{ id: 1, t: null, v: [1] }, { id: 2, t: null, v: [2] }] });

test('a dataset added under a name in use takes the next number, and a rename to one is refused', () => {
  const a = state.add(ds('Days'));
  const b = state.add(ds('Days'));
  const c = state.add(ds('Days'));
  assert.deepEqual([a.name, b.name, c.name], ['Days', 'Days (2)', 'Days (3)']);
  // Replacing a dataset by its id keeps its own name.
  assert.equal(state.add(Object.assign(ds('Days (2)'), { id: b.id })).name, 'Days (2)');
  assert.equal(state.rename(c.id, 'Days'), false);
  assert.equal(state.get(c.id).name, 'Days (3)');
  assert.equal(state.rename(c.id, 'Nights'), true);
  assert.equal(state.get(c.id).name, 'Nights');
  // A dataset may keep its own name.
  assert.equal(state.rename(c.id, 'Nights'), true);
  for (const d of [a, b, c]) state.remove(d.id);
});
