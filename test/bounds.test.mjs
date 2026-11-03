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
