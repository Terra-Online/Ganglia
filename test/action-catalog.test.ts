import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundArrival } from '#@/src/route.ts';
import {
  actionCatalogStats,
  setActionCatalogPhase,
  selectCatalogActions,
} from '#@/src/v1/route/action-catalog.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';

const floor = (id: string, x0: number, x1: number, y: number, z0 = -2, z1 = 2): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const geometry = (surfaces: Surface[]) => {
  const triangles = surfaces.flatMap((surface) => [
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]],
  ]);
  return {
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  };
};
const options: JumpRouteOptions = {
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
const arrival = (position: Vec3): GroundArrival[] => [
  { id: 'player', position, state: 'available', cost: 0 },
];

test('training stores motion proofs and frozen fresh starts solve through a small validated chain', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('step', 7, 11, 0), floor('goal', 14, 18, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, groundPlanner: createGroundPlanner(surfaces, options) };
  const goal: Vec3 = [16, 0, 0];
  try {
    setActionCatalogPhase('training');
    const trained = planJumpRoute(surfaces, world, arrival([2, 0, 0]), goal, settings);
    assert.equal(trained.route.status, 'complete');
    assert.ok(actionCatalogStats().added > 0);
    const before = actionCatalogStats().added;
    setActionCatalogPhase('frozen');
    const starts = arrival([1, 0, 0]);
    starts[0].id = 'fresh';
    starts[0].cost = 3;
    const selected = selectCatalogActions(world, surfaces, starts, goal, settings);
    assert.ok(selected.length > 0 && selected.length <= 16);
    assert.ok(selected.every((action) => action.id.startsWith('@catalog/') && !action.terminal));
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, { ...settings, connections: selected }),
      selected,
    );
    const proof = settings.groundPlanner.plan(starts, goal, { connections: selected });
    assert.equal(proof.status, 'complete');
    const result = planJumpRoute(surfaces, world, starts, goal, settings);
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.cost <= proof.cost);
    assert.deepEqual(
      result.route,
      settings.groundPlanner.plan(starts, goal, { connections: result.connections }),
    );
    assert.equal(result.route.start, 'fresh');
    assert.ok(actionCatalogStats().hits > 0);
    selected[0].points[0][0] = 123456;
    const again = selectCatalogActions(world, surfaces, starts, goal, settings);
    assert.notEqual(again[0].points[0][0], 123456);
    assert.equal(actionCatalogStats().added, before);
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, { ...settings, activeBoost: 'speed' }),
      [],
    );
    assert.deepEqual(
      selectCatalogActions(
        createCollisionWorld(geometry(surfaces)),
        surfaces,
        starts,
        goal,
        settings,
      ),
      [],
    );
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, {
        ...settings,
        profile: { ...options.profile, radius: 0.4 },
      }),
      [],
    );
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('a frozen catalog miss retains original physical discovery', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('goal', 7, 11, 0)];
  const settings = { ...options, groundPlanner: createGroundPlanner(surfaces, options) };
  try {
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const result = planJumpRoute(
      surfaces,
      createCollisionWorld(geometry(surfaces)),
      arrival([2, 0, 0]),
      [9, 0, 0],
      settings,
    );
    assert.equal(result.route.status, 'complete');
    assert.ok(result.diagnostics.searches.length > 0);
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('fresh starts discover cheaper actions away from the trained route without growing the frozen bank', () => {
  const surfaces = [floor('start', 0, 4, 0, -10, 10), floor('goal', 7, 11, 0, -10, 10)];
  const world = createCollisionWorld(geometry(surfaces));
  const planner = createGroundPlanner(surfaces, options);
  const settings = { ...options, groundPlanner: planner };
  try {
    setActionCatalogPhase('training');
    const training = planJumpRoute(surfaces, world, arrival([2, 0, -8]), [9, 0, -8], {
      ...settings,
      maxCandidates: 16,
      maxShortcutCandidates: 0,
    });
    assert.equal(training.route.status, 'complete');
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const starts = arrival([2, 0, 8]),
      goal: Vec3 = [9, 0, 8];
    const selected = selectCatalogActions(world, surfaces, starts, goal, settings);
    const incumbent = planner.plan(starts, goal, { connections: selected });
    assert.equal(incumbent.status, 'complete');
    const plan = planner.plan;
    const overlays: string[] = [];
    planner.plan = (...args) => {
      overlays.push(JSON.stringify(args[2]?.connections?.map((connection) => connection.id)));
      return plan(...args);
    };
    const result = planJumpRoute(surfaces, world, starts, goal, settings);
    planner.plan = plan;
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.cost < incumbent.cost - 1);
    assert.ok(overlays.length > 1);
    assert.equal(new Set(overlays).size, overlays.length);
    assert.deepEqual(result.route, planner.plan(starts, goal, { connections: result.connections }));
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});
