import assert from 'node:assert/strict';
import test from 'node:test';

import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import type { Surface } from '#@/src/geometry.ts';
import type { GroundTopology } from '#@/src/v1/reach/connectivity.ts';
import { createTypeScriptTransferQuery } from '#@/src/v1/search/candidate-transfers.ts';

const check = (surfaces: Surface[], components: number[], radius: number, vertical: number) => {
  const topology: GroundTopology = {
    ids: new Map(surfaces.map((surface, i) => [surface.id, i])),
    components: Int32Array.from(components),
    count: Math.max(-1, ...components) + 1,
    forward: surfaces.map(() => []),
  };
  const js = createTypeScriptTransferQuery(surfaces, topology, radius, vertical),
    rust = createRustTransferQuery(surfaces, topology, radius, vertical);
  for (const component of new Set([...components, topology.count + 10])) {
    assert.deepEqual(rust(component), js(component), `component ${component}`);
    assert.deepEqual(rust(component), js(component), 'repeat query must preserve ordering');
  }
};

test('native transfer witnesses preserve duplicate ownership, retention and encounter ties', () => {
  check(
    [
      {
        id: 'a',
        vertices: [
          [-0, 0, 0],
          [0.0005, 0, 0],
          [1, 0, 1],
        ],
      },
      {
        id: 'b',
        vertices: [
          [2, 0, 0],
          [2, 0, 2],
          [1, 0, -1],
        ],
      },
      {
        id: 'repeat-a',
        vertices: [
          [0, 0, 0],
          [1, 0, 1],
        ],
      },
      {
        id: 'c',
        vertices: [
          [-2, 1, -2],
          [-1, 1, -1],
          [-2, 1, -1],
        ],
      },
      {
        id: 'd',
        vertices: [
          [0, 2, 0],
          [0, 2.000000000001, 1],
          [0, -2, 0],
        ],
      },
    ],
    [0, 1, 0, 2, 3],
    2,
    2,
  );
  check([], [], 1, 1);
});

test('seeded fractional, boundary and near-duplicate geometry matches TypeScript exactly', () => {
  let seed = 48271;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 35; trial++) {
    const radius = [0.5, 2, 7.5, 96][trial % 4];
    const surfaces: Surface[] = Array.from({ length: 20 }, (_, i) => ({
      id: `surface-${i}`,
      vertices: Array.from({ length: 8 }, () => {
        const x = Math.floor(random() * 6 - 3) * radius,
          y = random() * 8 - 4,
          z = Math.floor(random() * 6 - 3) * radius;
        return random() < 0.3 ? [x, 0, z] : [x + random() * 0.002, y, z + random() * radius];
      }),
    }));
    check(
      surfaces,
      surfaces.map((_, i) => i % 5),
      radius,
      4,
    );
  }
});

import { createRustCollisionWorld } from '#@/prototype/rust-kernel/collision-world.ts';
import { createTypeScriptCollisionWorld } from '#@/src/v1/geo/collision.ts';

test('native BVH queries preserve TypeScript hits and numeric results on seeded mixed geometry', () => {
  let state = 63827;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 100; i++) {
    const x = random() * 20 - 10,
      y = random() * 8 - 4,
      z = random() * 20 - 10;
    positions.push(x, y, z, x + random() * 4, y + random(), z, x, y, z + random() * 4);
    indices.push(i * 3, i * 3 + 2, i * 3 + 1);
  }
  const geometry = { positions, indices };
  for (const options of [
    undefined,
    { bounds: { min: [-20, -20] as [number, number], max: [20, 20] as [number, number] } },
  ]) {
    const js = createTypeScriptCollisionWorld(geometry, options),
      native = createRustCollisionWorld(geometry, options);
    for (let i = 0; i < 1000; i++) {
      const point = (): [number, number, number] => [
        random() * 20 - 10,
        random() * 10 - 5,
        random() * 20 - 10,
      ];
      const start = point(),
        end = point(),
        profile = { radius: random() * 0.8, height: 2, inflation: random() * 0.2 };
      assert.deepEqual(
        native.sweepCapsule(start, end, profile),
        js.sweepCapsule(start, end, profile),
      );
      const settings = {
        maxUp: random() * 3,
        maxDown: random() * 3,
        maxSlope: 45,
        radius: i % 2 ? 0 : random() * 0.5,
      };
      assert.deepEqual(native.groundAt(start, settings), js.groundAt(start, settings));
    }
    assert.deepEqual(
      native.trianglesInBounds?.({ min: [-2, -2], max: [2, 2] }),
      js.trianglesInBounds?.({ min: [-2, -2], max: [2, 2] }),
    );
  }
});
