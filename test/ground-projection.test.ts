import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GoalProjectionOptions } from '#@/src/v1/motion/goals.ts';
import {
  createGroundPlanner,
  extendGroundPlanner,
  groundPreparation,
} from '#@/src/v1/route/ground.ts';

const floor = (id: string, x0: number, x1: number, y = 0): Surface => ({
  id,
  vertices: [
    [x0, y, 0],
    [x1, y, 0],
    [x1, y, 2],
    [x0, y, 2],
  ],
});
const options = { speed: 7, maxVertical: 0.5, walls: [], profile: { radius: 0.3, height: 1.7 } };

test('coarse and appended projection witnesses retain combined ordering, heights and named supports', () => {
  const coarse = [floor('base', 0, 2), floor('upper', 0, 2, 2), floor('side', 6, 8)];
  const fine = [
    floor('equal', 0, 2),
    floor('closer', 0, 2, 0.25),
    floor('lower', 0, 2, -2),
    floor('new', 3, 4),
  ];
  const parent = createGroundPlanner(coarse, options);
  const extended = extendGroundPlanner(parent, fine, options);
  const full = createGroundPlanner(extended.surfaces, options);
  const queries: { target: Vec3; options: GoalProjectionOptions }[] = [
    { target: [1, 0, 1], options: { maxVertical: 3 } },
    { target: [1, 0.2, 1], options: { maxVertical: 3 } },
    { target: [1, 1.75, 1], options: { maxVertical: 3 } },
    { target: [3.5, 0.1, 1], options: { maxVertical: 0.5 } },
    { target: [-0, -0, -0], options: { maxVertical: 0.5 } },
    { target: [100, 0, 0], options: { maxVertical: 0.5 } },
    { target: [1, 0.125, 1], options: { interaction: { radius: 3 } } },
    { target: [1, 1, 1], options: { interaction: { radius: 1, maxVertical: 0.75 } } },
    {
      target: [2, 0, 1],
      options: { interaction: { radius: 2, facing: [1, 0, 0], halfAngle: 45 } },
    },
  ];
  assert.equal(extended.planner.project([1, 0, 1], { maxVertical: 3 })[0].surface, 'base');
  assert.equal(extended.planner.project([1, 0.2, 1], { maxVertical: 3 })[0].surface, 'closer');
  for (const query of queries) {
    assert.deepEqual(
      extended.planner.project(query.target, query.options),
      full.project(query.target, query.options),
    );
    assert.deepEqual(
      extended.planner.project.closest(query.target, query.options),
      full.project.closest(query.target, query.options),
    );
    for (const name of [undefined, ...extended.surfaces.map((face) => face.id)])
      assert.deepEqual(
        groundPreparation(extended.planner)!.projectSupport(query.target, 3, name),
        groundPreparation(full)!.projectSupport(query.target, 3, name),
      );
  }
  const projected = extended.planner.project([1, 0.125, 1], { interaction: { radius: 3 } });
  projected[0].position[0] = 999;
  assert.deepEqual(
    extended.planner.project([1, 0.125, 1], { interaction: { radius: 3 } }),
    full.project([1, 0.125, 1], { interaction: { radius: 3 } }),
  );
  assert.equal(parent.project([3.5, 0, 1], { maxVertical: 0.5 }).length, 0);
});

test('appended planners rebuild final portals instead of inheriting coarse walking connectivity', () => {
  const starts = [
    { id: 'player', position: [1, 0, 1] as Vec3, state: 'available' as const, cost: 2 },
  ];
  for (const [coarse, fine, goal] of [
    [[floor('left', 0, 2), floor('right', 4, 6)], [floor('bridge', 2, 4)], [5, 0, 1]],
    [[floor('left', 0, 2), floor('right', 2, 4)], [floor('third-owner', 2, 4)], [3, 0, 1]],
  ] as [Surface[], Surface[], Vec3][]) {
    const parent = createGroundPlanner(coarse, options);
    const extended = extendGroundPlanner(parent, fine, options);
    const full = createGroundPlanner(extended.surfaces, options);
    assert.deepEqual(extended.planner.plan(starts, goal), full.plan(starts, goal));
    assert.deepEqual(
      groundPreparation(extended.planner)!.portals,
      groundPreparation(full)!.portals,
    );
    if (fine[0].id === 'bridge')
      assert.equal(extended.planner.plan(starts, goal).status, 'complete');
  }
});
