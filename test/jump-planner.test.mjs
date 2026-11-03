import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planJumpRoute, createGroundPlanner, findJumpConnections } from '../src/index.mjs';
import { createCollisionWorld } from '../src/collision.mjs';

const floor = (id, x0, x1, y, z0 = -2, z1 = 2) =>
  ({ id, vertices: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]] });
const geometry = surfaces => {
  const triangles = surfaces.flatMap(surface => [[surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]]]);
  return { positions: triangles.flat(2), indices: Array.from({ length: triangles.length * 3 }, (_, index) => index) };
};
const options = { profile: { radius: 0.3, height: 1.7 }, walls: [], speed: 7, runAirSpeed: 6.5,
  maxVertical: 0.5, maxSlope: 46, maxDrop: 10, maxHorizontalDistance: 15,
  sampleSpacing: 1, maxCandidates: 600, maxLinks: 32,
  model: { gravity: 10, fallingGravity: 10, maxJumpHeight: 2, maxFallingSpeed: 20, apexTime: 0.2, maxHorizontalSpeed: 6.5 } };
const arrival = position => [{ id: 'player', position, state: 'available', cost: 0 }];

test('jointly selects multiple jumps through surfaces missing from the ground-only route', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('step', 7, 11, 0), floor('goal', 14, 18, 0)];
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)), arrival([2, 0, 0]), [16, 0, 0], options);
  assert.equal(result.route.status, 'complete');
  assert.equal(result.route.segments.filter(segment => segment.mode === 'jump').length, 2);
  assert.equal(result.diagnostics.strategy, 'surface-action-graph');
  assert.equal(result.diagnostics.groundStatus, 'no-verified-route');
});

test('optimizes a successful ground route by combining jumps across an isolated intermediate top', () => {
  const surfaces = [floor('left', 0, 4, 0), floor('middle', 7, 11, 0), floor('right', 14, 18, 0),
    floor('left-detour', 0, 4, 0, 2, 24), floor('back', 4, 14, 0, 20, 24),
    floor('right-detour', 14, 18, 0, 2, 24)];
  const starts = arrival([2, 0, 0]), goal = [16, 0, 0];
  const baseline = createGroundPlanner(surfaces, options).plan(starts, goal);
  assert.equal(baseline.status, 'complete');
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)), starts, goal, options);
  assert.equal(result.route.status, 'complete');
  assert.equal(result.route.segments.filter(segment => segment.mode === 'jump').length, 2);
  assert.ok(result.route.cost < baseline.cost / 2);
});

test('lands inside a lower surface and preserves a feasible incumbent under air-wall constraints', () => {
  const surfaces = [floor('upper', 0, 4, 4),
    { id: 'ramp', vertices: [[0, 4, 2], [4, 4, 2], [4, 0, 20], [0, 0, 20]] },
    floor('lower', -20, 20, 0, -20, 20)];
  const starts = arrival([2, 4, 0]), goal = [10, 0, 0], world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, portals: [{ from: 'ramp', to: 'lower', points: [[2, 0, 20], [2, 0, 20]] }] };
  const result = planJumpRoute(surfaces, world, starts, goal, settings);
  assert.equal(result.route.status, 'complete');
  assert.ok(result.route.cost < result.diagnostics.baselineCost / 2);
  const air = result.route.segments.find(segment => segment.mode !== 'walk');
  assert.ok(air);
  assert.ok(air.points.at(-1)[0] > -19 && air.points.at(-1)[0] < 19);
  const blocked = planJumpRoute(surfaces, world, starts, goal, { ...settings,
    walls: [{ min: [4.5, 3, -20], max: [5, 20, 19], state: 'unknown' }] });
  assert.equal(blocked.route.status, 'complete');
  assert.ok(blocked.route.cost <= blocked.diagnostics.baselineCost + 1e-7);
});

test('does not replace a direct walk with a slower jump and handles unavailable arrivals', () => {
  const surfaces = [floor('flat', 0, 20, 0, -4, 4)], starts = arrival([2, 0, 0]), goal = [18, 0, 0];
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)), starts, goal, options);
  assert.equal(result.route.status, 'complete');
  assert.ok(result.route.segments.every(segment => segment.mode === 'walk'));
  assert.equal(result.route.cost, result.diagnostics.baselineCost);
  const locked = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)),
    [{ ...starts[0], state: 'unknown' }], goal, options);
  assert.equal(locked.route.status, 'unmapped');
  assert.deepEqual(locked.diagnostics.searches, []);
});

test('combines previously discovered partial connections without colliding with their identifiers', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('middle', 7, 11, 0), floor('goal', 14, 18, 0)];
  const world = createCollisionWorld(geometry(surfaces)), starts = arrival([2, 0, 0]), goal = [16, 0, 0];
  const existing = findJumpConnections(surfaces, world, { ...options, from: starts[0].position, to: goal }).connections.slice(0, 1);
  assert.equal(existing.length, 1);
  const result = planJumpRoute(surfaces, world, starts, goal, { ...options, connections: existing });
  assert.equal(result.route.status, 'complete');
  assert.equal(result.route.segments.filter(segment => segment.mode === 'jump').length, 2);
  assert.equal(new Set(result.connections.map(connection => connection.id)).size, result.connections.length);
});

test('keeps shortcut bounds valid when an existing movement edge is faster than running', () => {
  const surfaces = [floor('origin', 0, 4, 4), floor('upper', 100, 104, 4),
    { id: 'ramp', vertices: [[100, 4, 2], [104, 4, 2], [104, 0, 20], [100, 0, 20]] },
    floor('back', 100, 115, 0, 20, 24), floor('lower', 107, 115, 0, -2, 20)];
  const connection = { id: 'authored', mode: 'launch', state: 'open', points: [[2, 4, 0], [102, 4, 0]], times: [0, 1] };
  const settings = { ...options, connections: [connection] }, starts = arrival([2, 4, 0]), goal = [110, 0, 0];
  const baseline = createGroundPlanner(surfaces, settings).plan(starts, goal);
  assert.equal(baseline.status, 'complete');
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)), starts, goal, settings);
  assert.equal(result.route.status, 'complete');
  assert.ok(result.route.cost < baseline.cost);
  assert.ok(result.route.segments.some(segment => segment.mode === 'launch'));
  assert.ok(result.route.segments.some(segment => segment.mode === 'jump'));
});
