import assert from 'node:assert/strict';
import { test } from 'node:test';

import { preparePhysicalRouteSolver, type PhysicalInput } from '../src/solver/index.ts';

const input: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
          [10, 0, 0],
        ],
      },
    ],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
  },
  collision: { positions: [0, 0, 0, 0, 0, 10, 10, 0, 10], indices: [0, 1, 2] },
  config: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 1,
      maxFallingSpeed: 10,
      apexTime: 0,
      maxHorizontalSpeed: 2,
      startHorizontalSpeed: 2,
      airOverspeedDeceleration: 5,
      airAcceleration: 60,
      airDeceleration: 10,
    },
    maxSlope: 45,
    runAirSpeed: 1,
    stepUp: 0.4,
    stepDown: 0.6,
  },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
};
test('physical solver returns fresh single and batch routes through the prepared seam', async () => {
  const solver = await preparePhysicalRouteSolver(input, { effort: 'walking' });
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 0,
        position: [1, 0, 1] as [number, number, number],
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
  };
  const single = await solver.solve(query);
  assert.equal(single.route.status, 'complete');
  const batch = await solver.solveBatch([query, query]);
  assert.deepEqual(batch[0], single);
  assert.deepEqual(batch[1], single);
  assert.notEqual(batch[0].route, batch[1].route);
  await solver.close();
  await assert.rejects(solver.solve(query), /closed/);
});

test('physical solver distinguishes mapped but disconnected ground from unmapped endpoints', async () => {
  const solver = await preparePhysicalRouteSolver(
    {
      ...input,
      ground: {
        ...input.ground,
        surfaces: [
          ...input.ground.surfaces,
          {
            id: 'island',
            vertices: [
              [20, 0, 0],
              [20, 0, 10],
              [30, 0, 10],
              [30, 0, 0],
            ],
          },
        ],
      },
    },
    { effort: 'walking' },
  );
  const result = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [25, 0, 1],
  });
  assert.equal(result.route.status, 'no-verified-route');
  await solver.close();
});
