import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Bounds, BoundsNode } from '../src/geo/bounds.ts';
import { createBoundsIndex, createBoundsTree } from '../src/geo/bounds.ts';
import type { Vec3 } from '../src/index-types.ts';
import { createMinHeap } from '../src/search/heap.ts';

type Entry = { min: number[]; max: number[]; id: number };
type Tree = BoundsNode<Entry, unknown>;

test('nearest bounds traversal orders in 3D and retains rectangle exclusions', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    id: index,
    min: [index % 5, Math.floor(index / 5), 0],
    max: [index % 5, Math.floor(index / 5), 0],
  }));
  const query = createBoundsIndex(entries),
    target = [1, 3.2, 0];
  const bounds = { min: [0, 1, -1], max: [3, 6, 1] };
  const expected = [...query(bounds)].map((entry) => entry.id).sort((a, b) => a - b);
  const nearest = [...query.nearest(bounds, target)];
  assert.deepEqual(
    nearest.map((entry) => entry.id).sort((a, b) => a - b),
    expected,
  );
  // The heap orders squared lower bounds. hypot can differ by one ulp for
  // equal squared bounds, so it cannot establish their ordering independently.
  const distances = nearest.map((entry) =>
    entry.min.reduce((sum, value, axis) => sum + (value - target[axis]) ** 2, 0),
  );
  assert.deepEqual(
    distances,
    [...distances].sort((a, b) => a - b),
  );
  assert.equal(nearest[0].id, 16);
});

const referenceNearest = (
  root: Tree | null,
  bounds: { min: number[]; max: number[] },
  target: Vec3,
) => {
  const pending = createMinHeap<{ node: Tree | Entry; entry: boolean; cost: number }>(),
    result = [];
  const enqueue = (node: Tree | Entry, entry = false) => {
    if (
      !node.min.every(
        (value, axis) => value <= bounds.max[axis] && node.max[axis] >= bounds.min[axis],
      )
    )
      return;
    let cost = 0;
    for (let axis = 0; axis < node.min.length; axis++) {
      cost += Math.max(node.min[axis] - target[axis], 0, target[axis] - node.max[axis]) ** 2;
    }
    pending.push({ node, entry, cost });
  };
  if (root) enqueue(root);
  while (pending.size) {
    const { node, entry } = pending.pop()!;
    if (entry) result.push(node);
    else if ('entries' in node && node.entries)
      for (const value of node.entries) enqueue(value, true);
    else {
      enqueue((node as Tree).left!);
      enqueue((node as Tree).right!);
    }
  }
  return result;
};

test('nearest heap columns preserve the original complete sequence and tied budget prefixes', () => {
  for (const length of [0, 1, 8, 9, 65, 257])
    for (const shape of [0, 1, 2]) {
      const entries: Entry[] = Array.from({ length }, (_, id) => ({
        id,
        min: [shape ? (id % 7) - 3 : -0, shape === 2 ? id % 13 : 0, shape ? -id % 5 : 0],
        max: [
          shape ? (id % 7) - 2.5 : 0,
          shape === 2 ? (id % 13) + 1 : 0,
          shape ? (-id % 5) + 1 : 0,
        ],
      }));
      if (length > 2) entries[1] = entries[0];
      const root = referenceTree(entries),
        index = createBoundsIndex(entries);
      for (const bounds of [
        { min: [-100, -100, -100], max: [100, 100, 100] },
        { min: [-2, 0, -3], max: [2, 3, 0] },
      ])
        for (const target of [
          [0, 0, 0],
          [-0, 0, 0],
          [2.5, 3, -1],
        ] satisfies Vec3[]) {
          const expected = referenceNearest(root, bounds, target),
            actual = [...index.nearest(bounds, target)];
          assert.deepEqual(actual, expected);
          for (const limit of [0, 1, 7, 8, 9, 31])
            assert.deepEqual(actual.slice(0, limit), expected.slice(0, limit));
        }
    }
});

test('filtered spatial views preserve range and nearest coverage without changing the base', () => {
  const entries = Array.from({ length: 80 }, (_, id) => ({
    id,
    min: [id % 9, id / 7, -id / 13],
    max: [(id % 9) + 0.5, id / 7 + 1, -id / 13 + 0.25],
  }));
  const base = createBoundsIndex(entries),
    selected = base.filter((entry) => entry.id % 3 === 0);
  const bounds = { min: [-100, -100, -100], max: [100, 100, 100] },
    target = [3, 2, -1];
  const distance = (entry: Bounds) =>
    entry.min.reduce(
      (sum, value, axis) =>
        sum + Math.max(value - target[axis], 0, target[axis] - entry.max[axis]) ** 2,
      0,
    );
  const expected = entries.filter((entry) => entry.id % 3 === 0);
  assert.deepEqual(
    [...selected(bounds)].map((entry) => entry.id).sort((a, b) => a - b),
    expected.map((entry) => entry.id),
  );
  assert.deepEqual(
    [...selected.nearest(bounds, target)].map(distance),
    expected.map(distance).sort((a, b) => a - b),
  );
  assert.equal([...base(bounds)].length, entries.length);
  assert.equal([...selected.filter((entry) => entry.id % 2 === 0)(bounds)].length, 14);
  assert.deepEqual([...base.filter(() => false).nearest(bounds, target)], []);
  assert.equal([...selected(bounds)].length, expected.length);
});

test('median partitions preserve overlapping, coincident and elongated bounds without mutating entries', () => {
  const entries = Array.from({ length: 257 }, (_, id) => ({
    id,
    min: [id % 3 === 0 ? -500 : (id * 37) % 101, id % 7, id % 3 === 0 ? -500 : -id % 11],
    max: [
      id % 3 === 0 ? 500 : ((id * 37) % 101) + 2,
      (id % 7) + 1,
      id % 3 === 0 ? 500 : (-id % 11) + 2,
    ],
  }));
  const original = structuredClone(entries),
    query = createBoundsIndex(entries);
  for (let i = 0; i < 31; i++) {
    const bounds = {
      min: [i * 3 - 1, i % 7, -i % 11],
      max: [i * 3 + 5, (i % 7) + 2, (-i % 11) + 3],
    };
    const expected = entries
      .filter((entry) =>
        entry.min.every(
          (value, axis) => value <= bounds.max[axis] && entry.max[axis] >= bounds.min[axis],
        ),
      )
      .map((entry) => entry.id);
    assert.deepEqual(
      [...query(bounds)].map((entry) => entry.id).sort((a, b) => a - b),
      expected,
    );
  }
  assert.deepEqual(entries, original);
});

test('group filtering preserves exact traversal prefixes including tied nearest bounds', () => {
  for (const pattern of [0, 1, 2]) {
    const entries = Array.from({ length: 193 }, (_, id) => ({
      id,
      group: pattern === 0 ? Math.floor(id / 32) : pattern === 1 ? id % 7 : 0,
      min: [id % 3, id % 5, -id % 11],
      max: [(id % 3) + 0.5, (id % 5) + 1, (-id % 11) + 2],
    }));
    const base = createBoundsIndex(entries),
      grouped = createBoundsIndex(entries, (entry) => entry.group);
    for (let mask = 0; mask < 16; mask++) {
      const eligible = (group: number) => ((mask >> (group % 4)) & 1) !== 0;
      const expected = base.filter((entry) => eligible(entry.group));
      const actual = grouped.filterGroups(eligible);
      for (const bounds of [
        { min: [-100, -100, -100], max: [100, 100, 100] },
        { min: [0, 2, -5], max: [2, 4, 0] },
      ]) {
        assert.deepEqual([...actual(bounds)], [...expected(bounds)]);
        for (const target of [
          [0, 0, 0],
          [2, 3, -1],
          [1, 1, 1],
        ] satisfies Vec3[]) {
          const a = [...actual.nearest(bounds, target)],
            b = [...expected.nearest(bounds, target)];
          assert.deepEqual(a, b);
          assert.deepEqual(a.slice(0, 9), b.slice(0, 9));
        }
        assert.deepEqual(
          [...actual.filter((entry) => entry.id % 2 === 0)(bounds)],
          [...expected.filter((entry) => entry.id % 2 === 0)(bounds)],
        );
        assert.deepEqual(
          [...actual.filterGroups((group) => group % 2 === 0)(bounds)],
          [...expected.filter((entry) => entry.group % 2 === 0)(bounds)],
        );
      }
    }
  }
});

// The original object-swapping partition is an independent ordering reference.
const referenceTree = (surfaces: Entry[]) => {
  const entries = [...surfaces];
  // Median partitioning avoids sorting every subtree. Equal centres form one
  // partition, so coincident or elongated bounds still terminate in balanced leaves.
  const select = (start: number, end: number, middle: number, axis: number) => {
    const center = (index: number) => entries[index].min[axis] + entries[index].max[axis];
    while (end - start > 1) {
      const first = center(start),
        last = center(end - 1),
        mid = center(Math.floor((start + end) / 2));
      const pivot = Math.max(Math.min(first, last), Math.min(Math.max(first, last), mid));
      let lower = start,
        current = start,
        upper = end;
      while (current < upper) {
        const value = center(current);
        if (value < pivot) {
          [entries[lower], entries[current]] = [entries[current], entries[lower]];
          lower++;
          current++;
        } else if (value > pivot) {
          upper--;
          [entries[upper], entries[current]] = [entries[current], entries[upper]];
        } else current++;
      }
      if (middle < lower) end = lower;
      else if (middle >= upper) start = upper;
      else return;
    }
  };
  const build = (start: number, end: number): Tree => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let index = start; index < end; index++)
      for (let axis = 0; axis < 3; axis++) {
        const entry = entries[index];
        min[axis] = Math.min(min[axis], entry.min[axis]);
        max[axis] = Math.max(max[axis], entry.max[axis]);
      }
    if (end - start <= 8) return { min, max, entries: entries.slice(start, end) };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const middle = Math.floor((start + end) / 2);
    select(start, end, middle, axis);
    return { min, max, left: build(start, middle), right: build(middle, end) };
  };
  return entries.length ? build(0, entries.length) : null;
};

test('packed build columns preserve the complete original tree and leaf references', () => {
  let seed = 17;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const check = (
    actual: BoundsNode<{ id: number; min: number[]; max: number[] }, unknown> | null,
    expected: Tree | null,
  ) => {
    assert.deepEqual(actual, expected);
    if (!actual) return;
    if (actual.entries) {
      for (let index = 0; index < actual.entries.length; index++) {
        assert.equal(actual.entries[index], expected!.entries![index]);
      }
    } else {
      check(actual.left, expected!.left!);
      check(actual.right, expected!.right!);
    }
  };
  for (const length of [0, 1, 8, 9, 16, 17, 65, 257, 1025])
    for (let shape = 0; shape < 5; shape++) {
      const entries: Entry[] = Array.from({ length }, (_, id) => {
        const min = Array.from({ length: 3 }, () =>
          shape === 0 ? -0 : Math.floor(random() * 30) - 15,
        );
        const max = min.map((value, axis) =>
          shape === 0
            ? id % 2
              ? -0
              : 0
            : shape === 1
              ? -value
              : value + (shape === 2 ? axis * 3 : random() * 10),
        );
        for (let axis = 0; axis < 3; axis++)
          if (min[axis] > max[axis]) [min[axis], max[axis]] = [max[axis], min[axis]];
        return { id, min, max };
      });
      if (length > 2 && shape === 3) entries[1] = entries[0];
      const before = structuredClone(entries);
      check(createBoundsTree(entries), referenceTree(entries));
      assert.deepEqual(entries, before);
    }
  const extreme: Entry[] = Array.from({ length: 17 }, (_, id) => ({
    id,
    min: [Number.MAX_VALUE, -0, -Number.MAX_VALUE],
    max: [Number.MAX_VALUE, -0, Number.MAX_VALUE],
  }));
  check(createBoundsTree(extreme), referenceTree(extreme));
  extreme[0].min[1] = NaN;
  check(createBoundsTree(extreme), referenceTree(extreme));
});
