import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '../src/collision.js';
import { planJumpRoute } from '../src/jump-planner.js';
import { prepareSurfaceActionSolver } from '../src/solver/index.js';

const surfaces = [0, 7, 14].map((x, i) => ({
  id: `floor/${i}`,
  vertices: [
    [x, 0, -2],
    [x + 4, 0, -2],
    [x + 4, 0, 2],
    [x, 0, 2],
  ],
}));
const triangles = surfaces.flatMap(({ vertices: v }) => [
  [v[0], v[2], v[1]],
  [v[0], v[3], v[2]],
]);
const collision = {
  positions: triangles.flat(2),
  indices: Array.from({ length: triangles.length * 3 }, (_, i) => i),
};
const options = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 7,
  runAirSpeed: 6.5,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 600,
  maxShortcutCandidates: 0,
  maxLinks: 32,
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 6.5,
  },
};
const query = {
  starts: [{ id: 'player', position: [2, 0, 0], state: 'available', cost: 0 }],
  goal: [16, 0, 0],
};

test('a new prepared query preserves the existing solver result across intervening goals', async () => {
  const solver = await prepareSurfaceActionSolver({ surfaces, collision, options });
  try {
    const expected = planJumpRoute(
      surfaces,
      createCollisionWorld(collision),
      query.starts,
      query.goal,
      options,
    );
    assert.equal(expected.route.status, 'complete');
    assert.equal(expected.route.segments.filter((s) => s.mode === 'jump').length, 2);
    assert.deepEqual(await solver.solve(query), expected);
    await solver.solve({ ...query, goal: [102, 0, 0] });
    assert.deepEqual(await solver.solve(query), expected);
  } finally {
    await solver.close();
  }
});

test('a same-scene batch preserves order, budgets and independent search state', async () => {
  const queries = [
    query,
    { ...query, options: { maxCandidates: 0 } },
    { starts: [{ ...query.starts[0], position: query.goal }], goal: query.starts[0].position },
    { ...query, goal: [102, 0, 0] },
    query,
  ];
  const expected = [];
  for (const item of queries) {
    const isolated = await prepareSurfaceActionSolver({ surfaces, collision, options });
    try {
      expected.push(await isolated.solve(item));
    } finally {
      await isolated.close();
    }
  }
  assert.deepEqual(
    expected.map((r) => r.route.status),
    ['complete', 'no-verified-route', 'complete', 'unmapped', 'complete'],
  );
  const solver = await prepareSurfaceActionSolver({ surfaces, collision, options });
  try {
    assert.deepEqual(await solver.solveBatch(queries), expected);
    assert.deepEqual(await solver.solveBatch([]), []);
    assert.deepEqual(await solver.solve(query), expected[0]);
  } finally {
    await solver.close();
  }
  await solver.close();
  await assert.rejects(solver.solve(query), /closed/);
  await assert.rejects(solver.solveBatch(queries), /closed/);
});
