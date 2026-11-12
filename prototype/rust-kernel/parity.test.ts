import assert from 'node:assert/strict';
import test from 'node:test';

import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
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

import { createRustGroundTracer } from '#@/prototype/rust-kernel/ground-trace-binding.ts';
import {
  createGroundStraightener,
  installGroundTracePrototype,
} from '#@/src/v1/route/straighten.ts';

test('native ground traces preserve supported crossings and wall rejection across repeated queries', () => {
  let seed = 7653;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const slope of [0, 0.2]) {
    const point = (x: number, z: number): Vec3 => [x, slope * x + (slope / 2) * z, z];
    const surfaces: Surface[] = [];
    for (let x = 0; x < 6; x++)
      for (let z = 0; z < 6; z++) {
        if (x === 2 && z > 0 && z < 4) continue;
        surfaces.push({
          id: `${x}/${z}`,
          vertices: [point(x, z), point(x, z + 1), point(x + 1, z + 1), point(x + 1, z)],
        });
      }
    for (const walls of [
      [],
      [{ min: [3, -5, 0] as Vec3, max: [3.1, 10, 3] as Vec3, state: 'active' as const }],
    ]) {
      const options = { walls, profile: { radius: 0.3, height: 1.8 } };
      installGroundTracePrototype(undefined);
      const js = createGroundStraightener(surfaces, options);
      installGroundTracePrototype(createRustGroundTracer);
      const native = createGroundStraightener(surfaces, options);
      for (let i = 0; i < 1000; i++) {
        const a = point(random() * 8 - 1, random() * 8 - 1),
          b = point(random() * 8 - 1, random() * 8 - 1);
        const expected = js.trace(a, b),
          actual = native.trace(a, b);
        assert.deepEqual(actual, expected);
        if (actual) actual[0][0] += 100;
        assert.deepEqual(native.trace(a, b), expected);
        assert.deepEqual(native.trace(b, a), js.trace(b, a));
      }
      const path = [point(0.5, 0.5), point(1.5, 0.5), point(1.5, 4.5), point(4.5, 4.5)];
      assert.deepEqual(native(path), js(path));
    }
  }
});

import { createRustGoalGeometry } from '#@/prototype/rust-kernel/goal-binding.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';
import { type GoalClip, closestOnSurface } from '#@/src/v1/motion/goals.ts';

test('native goal geometry preserves seeded clipping witnesses and surface ties across scales', () => {
  let seed = 0x746ad1ff;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const scale of [1e-4, 0.1, 1, 100, 1e6]) {
    const surfaces: Surface[] = Array.from({ length: 8 }, (_, id) => {
      const x = id ? (random() - 0.5) * 8 * scale : 0;
      const z = id ? (random() - 0.5) * 8 * scale : 0;
      const y = id ? (random() - 0.5) * 2 * scale : 0;
      const radius = (2 + random() * 3) * scale;
      const count = 3 + Math.floor(random() * 5);
      const vertices = Array.from({ length: count }, (_, index): Vec3 => {
        const angle = (index * 2 * Math.PI) / count;
        const dx = Math.cos(angle) * radius,
          dz = Math.sin(angle) * radius;
        return [x + dx, y + dx * 0.2 - dz * 0.1, z + dz];
      });
      if (id === 2) vertices[1] = [...vertices[0]];
      return { id: `surface/${id}`, vertices };
    });
    surfaces.push({ id: 'tie', vertices: structuredClone(surfaces[0].vertices) });
    const native = createRustGoalGeometry(surfaces);
    const clips: GoalClip[] = [
      {},
      { maxVertical: 0 },
      { maxVertical: scale / 3 },
      { facing: { forwardX: 1, forwardZ: 0, sine: 1, cosine: 0 } },
      {
        maxVertical: scale,
        facing: {
          forwardX: 0.6,
          forwardZ: 0.8,
          sine: Math.sin(Math.PI / 6),
          cosine: Math.cos(Math.PI / 6),
        },
      },
    ];
    for (let query = 0; query < 8; query++) {
      const target: Vec3 = query
        ? [
            (random() - 0.5) * 10 * scale,
            (random() - 0.5) * 6 * scale,
            (random() - 0.5) * 10 * scale,
          ]
        : [-0, 0, -0];
      const candidates = surfaces.map((_, index) => index);
      if (query % 2) candidates.reverse();
      // These two TS geometry functions never dispatch through prototype hooks.
      const projected = projectPoint(
        candidates.map((id) => surfaces[id]),
        target,
        { maxVertical: 2 * scale },
      );
      assert.deepEqual(
        native.projectPoint(target, 2 * scale, candidates),
        projected ? { ...projected, distance: Math.abs(projected.position[1] - target[1]) } : null,
        `vertical scale=${scale} query=${query}`,
      );
      for (const clip of clips) {
        const planes: ((point: Vec3) => number)[] = [];
        if (clip.maxVertical !== undefined)
          planes.push(
            (point) => point[1] - target[1] + clip.maxVertical!,
            (point) => target[1] + clip.maxVertical! - point[1],
          );
        if (clip.facing) {
          const { forwardX, forwardZ, sine, cosine } = clip.facing;
          const forward = (point: Vec3) =>
            (point[0] - target[0]) * forwardX + (point[2] - target[2]) * forwardZ;
          const side = (point: Vec3) =>
            (point[0] - target[0]) * forwardZ - (point[2] - target[2]) * forwardX;
          planes.push(
            (point) => forward(point) * sine + side(point) * cosine,
            (point) => forward(point) * sine - side(point) * cosine,
          );
        }
        const expected = candidates.flatMap((index) => {
          const candidate = closestOnSurface(surfaces[index], target, planes);
          return candidate ? [{ ...candidate, index }] : [];
        });
        assert.deepEqual(
          native.closestSurfaces(target, candidates, clip),
          expected,
          `interaction scale=${scale} query=${query} clip=${JSON.stringify(clip)}`,
        );
      }
    }
  }
});
