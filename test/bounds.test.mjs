import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundsIndex } from '../src/bounds.mjs';

test('nearest bounds traversal orders in 3D and retains rectangle exclusions', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    id: index, min: [index % 5, Math.floor(index / 5), 0], max: [index % 5, Math.floor(index / 5), 0],
  }));
  const query = createBoundsIndex(entries), target = [1, 3.2, 0];
  const bounds = { min: [0, 1, -1], max: [3, 6, 1] };
  const expected = [...query(bounds)].map(entry => entry.id).sort((a, b) => a - b);
  const nearest = [...query.nearest(bounds, target)];
  assert.deepEqual(nearest.map(entry => entry.id).sort((a, b) => a - b), expected);
  const distances = nearest.map(entry => Math.hypot(...entry.min.map((value, axis) => value - target[axis])));
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  assert.equal(nearest[0].id, 16);
});


test('filtered spatial views preserve range and nearest coverage without changing the base', () => {
  const entries = Array.from({ length: 80 }, (_, id) => ({ id,
    min: [id % 9, id / 7, -id / 13], max: [id % 9 + .5, id / 7 + 1, -id / 13 + .25] }));
  const base = createBoundsIndex(entries), selected = base.filter(entry => entry.id % 3 === 0);
  const bounds = { min: [-100, -100, -100], max: [100, 100, 100] }, target = [3, 2, -1];
  const distance = entry => entry.min.reduce((sum, value, axis) =>
    sum + Math.max(value - target[axis], 0, target[axis] - entry.max[axis]) ** 2, 0);
  const expected = entries.filter(entry => entry.id % 3 === 0);
  assert.deepEqual([...selected(bounds)].map(entry => entry.id).sort((a, b) => a - b), expected.map(entry => entry.id));
  assert.deepEqual([...selected.nearest(bounds, target)].map(distance), expected.map(distance).sort((a, b) => a - b));
  assert.equal([...base(bounds)].length, entries.length);
  assert.equal([...selected.filter(entry => entry.id % 2 === 0)(bounds)].length, 14);
  assert.deepEqual([...base.filter(() => false).nearest(bounds, target)], []);
  assert.equal([...selected(bounds)].length, expected.length);
});
