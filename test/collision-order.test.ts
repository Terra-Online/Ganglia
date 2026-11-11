import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '../src/collision.ts';
import type { CollisionWorld } from '../src/geo/collision.ts';
import type { Vec3 } from '../src/geo/geometry.ts';

interface Entry {
  id: number;
  box: number[];
  world: CollisionWorld;
}
type Tree = { box: number[] } & (
  | { entries: Entry[]; left?: never; right?: never }
  | { entries?: never; left: Tree; right: Tree }
);

const overlaps = (a: number[], b: number[]) =>
  a.every((value, axis) => axis >= 3 || (value <= b[axis + 3] && a[axis + 3] >= b[axis]));
const faceBounds = (face: number[][]) =>
  [0, 1, 2]
    .map((axis) => Math.min(...face.map((point) => point[axis])))
    .concat([0, 1, 2].map((axis) => Math.max(...face.map((point) => point[axis]))));

// Full sorting is the reference contract: ties retain the original triangle ID,
// right nodes are queried first, and a leaf keeps its parent's ordered entries.
const sortedReference = (entries: { id: number; box: number[]; world: CollisionWorld }[]) => {
  const build = (entries: Entry[]): Tree => {
    const box = [0, 1, 2]
      .map((axis) => Math.min(...entries.map((entry) => entry.box[axis])))
      .concat([0, 1, 2].map((axis) => Math.max(...entries.map((entry) => entry.box[axis + 3]))));
    if (entries.length <= 8) return { box, entries };
    let axis = 0;
    for (let candidate = 1; candidate < 3; candidate++) {
      if (box[candidate + 3] - box[candidate] > box[axis + 3] - box[axis]) axis = candidate;
    }
    const sorted = entries.toSorted(
      (a, b) => a.box[axis] + a.box[axis + 3] - (b.box[axis] + b.box[axis + 3]) || a.id - b.id,
    );
    const middle = sorted.length >>> 1;
    return { box, left: build(sorted.slice(0, middle)), right: build(sorted.slice(middle)) };
  };
  const root = entries.length ? build(entries) : null;
  return function* (box: number[]) {
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop()!;
      if (!overlaps(box, node.box)) continue;
      if (node.entries) {
        for (const entry of node.entries) if (overlaps(box, entry.box)) yield entry;
      } else stack.push(node.left, node.right);
    }
  };
};

const geometry = (faces: number[][][]) => ({
  positions: faces.flat(2),
  indices: Array.from({ length: faces.length * 3 }, (_, id) => id),
});

const groundReference = (
  entries: (box: number[]) => Generator<Entry>,
  position: Vec3,
  options: { maxUp: number; maxDown: number; maxSlope: number; radius: number },
) => {
  const { maxUp, maxDown, radius = 0 } = options;
  const box = [
    position[0] - radius,
    position[1] - maxDown - radius,
    position[2] - radius,
    position[0] + radius,
    position[1] + maxUp + radius,
    position[2] + radius,
  ];
  let best: ReturnType<CollisionWorld['groundAt']> = null,
    bestOffset = Infinity;
  for (const entry of entries(box)) {
    const hit = entry.world.groundAt(position, options);
    if (!hit) continue;
    const height = hit.position[1],
      offset = Math.abs(height - position[1]);
    if (
      radius > 0
        ? !best || height > best!.position[1]
        : offset < bestOffset || (offset === bestOffset && height > best!.position[1])
    ) {
      best = { ...hit, triangle: entry.id };
      bestOffset = offset;
    }
  }
  return best;
};
const sweepReference = (
  entries: (box: number[]) => Generator<Entry>,
  start: Vec3,
  end: Vec3,
  profile: { radius: number; height: number; inflation: number },
) => {
  const { radius, height, inflation = 0 } = profile,
    r = radius + inflation;
  const box = [
    Math.min(start[0], end[0]) - r,
    Math.min(start[1], end[1]) - inflation,
    Math.min(start[2], end[2]) - r,
    Math.max(start[0], end[0]) + r,
    Math.max(start[1], end[1]) + height + inflation,
    Math.max(start[2], end[2]) + r,
  ];
  for (const entry of entries(box)) {
    const hit = entry.world.sweepCapsule(start, end, profile);
    if (hit) return { ...hit, triangle: entry.id };
  }
  return null;
};

test('median preparation preserves sorted-BVH first contacts and tied support identity', () => {
  let seed = 91;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const all = Array.from({ length: 257 }, (_, id) => {
    const x = Math.round(next() * 12) - 6,
      y = Math.round(next() * 6) - 3,
      z = Math.round(next() * 12) - 6;
    const size = 1 + Math.round(next() * 5);
    if (id % 5 === 0)
      return [
        [x, y - size, z - size],
        [x, y + size, z - size],
        [x, y, z + size],
      ];
    if (id % 7 === 0)
      return [
        [x, y, z],
        [x, y, z],
        [x, y, z],
      ];
    return [
      [x - size, y, z - size],
      [x, y, z + size],
      [x + size, y, z - size],
    ];
  });
  // Equal centres, sorted/reversed source order and irregular child sizes expose
  // changes that a boolean collision check or a triangle-set assertion would miss.
  for (let id = 13; id < all.length; id += 13) all[id] = all[id - 1].map((point) => [...point]);
  const cases = [0, 1, 8, 9, 15, 16, 17, 31, 32, 33, 64, 129, 257].map((count) =>
    all.slice(0, count),
  );
  cases.push(
    all.toReversed(),
    all.toSorted((a, b) => a[0][0] - b[0][0]),
  );
  cases.push(
    Array.from({ length: 67 }, () => [
      [-3, 0, -3],
      [0, 0, 3],
      [3, 0, -3],
    ]),
  );
  for (const faces of cases)
    for (const scoped of [false, true]) {
      const scope: { min: [number, number]; max: [number, number] } | undefined = scoped
        ? { min: [-5, -5], max: [5, 5] }
        : undefined;
      const world = createCollisionWorld(geometry(faces), scope && { bounds: scope });
      const entries = faces
        .map((face, id) => ({
          id,
          box: faceBounds(face),
          world: createCollisionWorld(geometry([face])),
        }))
        .filter(
          (entry) =>
            !scope ||
            (entry.box[0] <= scope.max[0] &&
              entry.box[3] >= scope.min[0] &&
              entry.box[2] <= scope.max[1] &&
              entry.box[5] >= scope.min[1]),
        );
      const query = sortedReference(entries);
      for (let sample = 0; sample < 12; sample++) {
        const start: Vec3 = [
          Math.round(next() * 6) - 3,
          Math.round(next() * 4) - 2,
          Math.round(next() * 6) - 3,
        ];
        const end: Vec3 = [
          Math.round(next() * 6) - 3,
          Math.round(next() * 4) - 2,
          Math.round(next() * 6) - 3,
        ];
        const profile = { radius: 0.35, height: 1.66, inflation: sample % 3 === 0 ? 0.05 : 0 };
        const options = { maxUp: 3, maxDown: 3, maxSlope: 46, radius: sample % 2 === 0 ? 0.35 : 0 };
        assert.deepEqual(world.groundAt(start, options), groundReference(query, start, options));
        assert.deepEqual(
          world.sweepCapsule(start, end, profile),
          sweepReference(query, start, end, profile),
        );
      }
    }
});
