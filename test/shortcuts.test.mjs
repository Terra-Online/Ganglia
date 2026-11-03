import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroundPlanner } from '../src/ground.mjs';
import { createCollisionWorld } from '../src/collision.mjs';
import { findJumpConnections } from '../src/traversal.mjs';
import { findJumpShortcuts } from '../src/shortcuts.mjs';

const floor = (id, x0, x1, y, z0, z1) => ({ id, vertices: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]] });
const geometry = surfaces => {
  const triangles = surfaces.flatMap(surface => [[surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]]]);
  return { positions: triangles.flat(2), indices: Array.from({ length: triangles.length * 3 }, (_, index) => index) };
};
const profile = { radius: 0.3, height: 1.7 };
const movement = { gravity: 10, fallingGravity: 10, maxJumpHeight: 2,
  maxFallingSpeed: 20, apexTime: 0.2, maxHorizontalSpeed: 6.5 };
const options = { profile, walls: [], speed: 7, maxVertical: 0.5, maxSlope: 46,
  maxDrop: 10, maxHorizontalDistance: 15, sampleSpacing: 1, maxCandidates: 300, maxLinks: 8, model: movement };

test('finds a shorter drop across a gap even when a long ground ramp connects both sides', () => {
  const surfaces = [floor('upper', 0, 4, 4, -2, 2),
    { id: 'ramp', vertices: [[0, 4, 2], [4, 4, 2], [4, 0, 20], [0, 0, 20]] },
    floor('back', 0, 15, 0, 20, 24), floor('lower', 7, 15, 0, -2, 20)];
  const from = [2, 4, 0], to = [10, 0, 0], world = createCollisionWorld(geometry(surfaces));
  const arrivals = [{ id: 'player', position: from, cost: 0, state: 'available' }];
  const baseline = createGroundPlanner(surfaces, options).plan(arrivals, to);
  assert.equal(baseline.status, 'complete');
  assert.equal(findJumpConnections(surfaces, world, { ...options, from, to }).diagnostics.reason, 'ground-connected');
  const result = findJumpShortcuts(surfaces, world, { ...options, from, to, baseline });
  assert.ok(result.connections.length > 0);
  const route = createGroundPlanner(surfaces, { ...options, connections: result.connections }).plan(arrivals, to);
  assert.equal(route.status, 'complete');
  assert.ok(route.cost < baseline.cost / 2, `${route.cost} must improve ${baseline.cost}`);
  assert.ok(route.segments.some(segment => segment.mode === 'drop' || segment.mode === 'jump'));
});

test('keeps straight ground travel when its maximum speed already beats air movement', () => {
  const surfaces = [floor('flat', 0, 20, 0, -3, 3)], from = [1, 0, 0], to = [19, 0, 0];
  const baseline = createGroundPlanner(surfaces, options).plan([{ id: 'player', position: from, cost: 0, state: 'available' }], to);
  assert.equal(baseline.status, 'complete');
  const result = findJumpShortcuts(surfaces, createCollisionWorld(geometry(surfaces)), { ...options, from, to, baseline });
  assert.deepEqual(result.connections, []);
  assert.throws(() => findJumpShortcuts(surfaces, createCollisionWorld(geometry(surfaces)),
    { ...options, from, to, baseline: { status: 'unmapped' } }), /baseline/);
});
