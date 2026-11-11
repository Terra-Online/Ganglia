import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '../src/collision.ts';
import type { JumpModel, Surface, Vec3, Wall } from '../src/index-types.ts';
import { jumpConnection } from '../src/motion/jumps.ts';
import { landingCandidates, createLandingGoalCache } from '../src/motion/landings.ts';

test('finds feasible landing interiors when nearest, goal and centre witnesses fail', () => {
  const surface: Surface = {
    id: 'landing',
    vertices: [
      [5, 0, 0],
      [12, 0, -4],
      [12, 0, 4],
    ],
  };
  const triangles = [
    [
      [-2, 4, -2],
      [0.5, 4, 2],
      [0.5, 4, -2],
    ],
    [
      [-2, 4, -2],
      [-2, 4, 2],
      [0.5, 4, 2],
    ],
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
  ];
  const world = createCollisionWorld({
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  });
  const model: JumpModel = {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.1,
    maxHorizontalSpeed: 4,
  };
  const profile = { radius: 0.25, height: 1.7 },
    start: Vec3 = [0, 4.005, 0];
  const walls: Wall[] = [{ min: [4.5, -0.1, -0.6], max: [5.5, 2, 0.6], state: 'unknown' }];
  const candidates = [...landingCandidates(surface, start, [12, 0, 0], model, profile.radius)];
  const arcs = candidates.map(({ position }) =>
    jumpConnection(start, [position[0], position[1] + 0.005, position[2]], {
      ...model,
      mode: 'jump',
      profile,
      walls,
      sweep: world.sweepCapsule,
    }),
  );
  assert.ok(arcs.slice(0, 3).every((arc) => arc === null));
  assert.ok(arcs.slice(3).some((arc) => arc !== null));
});

test('static landing metadata preserves witness order and fresh output as the goal changes', () => {
  const surface: Surface = {
    id: 'floor',
    vertices: [
      [-2, 0, -2],
      [2, 0, -2],
      [2, 0, 2],
      [-2, 0, 2],
    ],
  };
  const model = {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 3,
  };
  const start: Vec3 = [-4, 0, 0];
  const query = (surface: Surface, start: Vec3, goal: Vec3) =>
    landingCandidates(surface, start, goal, model, 0.3);
  const expected = [
    { surface: 'floor', position: [-2, 0, 0], distance: 2 },
    { surface: 'floor', position: [2, 0, 1], distance: 2 },
    { surface: 'floor', position: [0, 0, 0], distance: 0 },
    { surface: 'floor', position: [-0.15568513614953483, 0, -1.925244022804756] },
    { surface: 'floor', position: [-0.21909860045131624, 0, -1.8510398591663662] },
    { surface: 'floor', position: [-0.15568513614953505, 0, 1.925244022804756] },
    { surface: 'floor', position: [-0.21909860045131624, 0, 1.8510398591663662] },
  ];
  assert.deepEqual([...landingCandidates(surface, start, [4, 0, 1], model, 0.3)], expected);
  assert.deepEqual([...query(surface, start, [4, 0, 1])], expected);
  const changed = expected.map((witness, index) =>
    index === 1 ? { surface: 'floor', position: [0, 0, 2], distance: Math.sqrt(2) } : witness,
  );
  assert.deepEqual([...query(surface, start, [0, 1, 3])], changed);
  assert.deepEqual([...query(surface, start, [4, 0, 1])], expected);
  const first = [...query(surface, start, [4, 0, 1])];
  first[0].position[0] = -100;
  first[2].position[1] = -100;
  first.at(-1)!.surface = 'changed';
  assert.deepEqual([...query(surface, start, [4, 0, 1])], expected);
});

test('query goal witnesses cache each face projection and return fresh output without binding changed goals', () => {
  const vertices: Vec3[] = [
    [-2, 0, -2],
    [2, 0, -2],
    [2, 0, 2],
    [-2, 0, 2],
  ];
  let reads = 0;
  const surface: Surface = {
    id: 'floor',
    get vertices() {
      reads++;
      return vertices;
    },
  };
  const goal: Vec3 | undefined = [4, 0, 1],
    cached = createLandingGoalCache(goal);
  const first = cached(surface, goal),
    initialReads = reads;
  assert.ok(first);
  assert.ok(initialReads > 0);
  first.position[0] = 100;
  first.surface = 'changed';
  assert.deepEqual(cached(surface, [...goal]), {
    surface: 'floor',
    position: [2, 0, 1],
    distance: 2,
  });
  assert.equal(reads, initialReads);
  goal[0] = 0;
  goal[1] = 1;
  goal[2] = 3;
  assert.deepEqual(cached(surface, goal), {
    surface: 'floor',
    position: [0, 0, 2],
    distance: Math.sqrt(2),
  });
  assert.ok(reads > initialReads);
  const degenerate: Surface = {
    id: 'empty',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
  };
  assert.equal(cached(degenerate, [4, 0, 1]), null);
  assert.equal(cached(degenerate, [4, 0, 1]), null);
});

test('optional goal cache preserves every landing witness in order while start-dependent witnesses change', () => {
  const surface: Surface = {
    id: 'floor',
    vertices: [
      [-2, 0, -2],
      [2, 0, -2],
      [2, 0, 2],
      [-2, 0, 2],
    ],
  };
  const goal: Vec3 = [4, 0, 1],
    cache = createLandingGoalCache(goal);
  const model = {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 3,
  };
  for (const start of [
    [-4, 0, 0],
    [0, 3, -4],
    [-4, 0, 0],
  ] satisfies Vec3[]) {
    const expected = [...landingCandidates(surface, start, goal, model, 0.3)];
    const actual = [...landingCandidates(surface, start, goal, model, 0.3, cache)];
    assert.deepEqual(actual, expected);
    for (const witness of actual) witness.position.fill(100);
    assert.deepEqual([...landingCandidates(surface, start, goal, model, 0.3, cache)], expected);
  }
});
