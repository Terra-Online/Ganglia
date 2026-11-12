import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boundaryOrder, boundaryTree } from '#@/src/search/boundary-order.ts';

test('bounded discovery covers separate regions before exhausting nearby entries', () => {
  const entries = [
    ...Array.from({ length: 20 }, (_, id) => ({ id, midpoint: [0, 0, 0], score: id })),
    { id: 20, midpoint: [32, 0, 0], score: 20 },
    { id: 21, midpoint: [0, 4, 0], score: 21 },
  ];
  const tree = boundaryTree(entries, 16, 2, 0.6);
  const compare = (a: (typeof entries)[number], b: (typeof entries)[number]) => a.score - b.score;
  const all = boundaryOrder(tree, () => true, compare, entries.length);
  assert.deepEqual(
    all.slice(0, 3).map((entry) => entry.id),
    [0, 20, 21],
  );
  assert.deepEqual(
    all.map((entry) => entry.id).sort((a, b) => a - b),
    entries.map((entry) => entry.id),
  );
  for (const limit of [0, 1, 3, 9, 100])
    assert.deepEqual(
      boundaryOrder(tree, () => true, compare, limit),
      all.slice(0, limit),
    );
  const selected = boundaryOrder(tree, (entry) => entry.midpoint[1] === 0, compare, 100);
  assert.equal(selected.length, 21);
  assert.ok(selected.every((entry) => entry.id !== 21));
  assert.deepEqual(
    boundaryOrder(tree, () => false, compare, 10),
    [],
  );
  assert.deepEqual(
    boundaryOrder(tree, () => true, compare, entries.length),
    all,
  );
});
