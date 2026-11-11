import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroundPlanner } from '../src/route/ground.mjs';
import { createCollisionWorld } from '../src/collision.mjs';
import { findJumpConnections } from '../src/search/traversal.mjs';
import { findJumpShortcuts, findJumpFrontier } from '../src/search/shortcuts.mjs';

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


test('resumes bounded frontier batches past blocked launches to reach an opening', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  for (const opening of [true, false]) {
    const settings = { ...options, maxCandidates: 4, from: [2, 0, 0], to: [9, 0, 0],
      walls: [{ min: [4.5, -1, -20], max: [6, 20, opening ? 1 : 20], state: 'active' }] };
    const cache = { standing: new Map(), motions: new Map(), exits: new Map(), approaches: new Map() };
    const first = findJumpFrontier(surfaces, world, settings, cache);
    assert.equal(first.connections.length, 0);
    let found = [];
    for (let batch = 0; batch < 16 && !found.length; batch++)
      found = findJumpFrontier(surfaces, world, settings, cache).connections;
    if (opening) {
      assert.ok(found.length > 0, 'later batches must reach the opening rather than retry the blocked prefix');
      const route = createGroundPlanner(surfaces, settings).plan(
        [{ id: 'player', position: settings.from, cost: 0, state: 'available' }], settings.to,
        { connections: found });
      assert.equal(route.status, 'complete');
    } else assert.deepEqual(found, []);
  }
});

test('continues a blocked frontier queue with a larger budget without regenerating its seeds', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, maxCandidates: 4, from: [2, 0, 0], to: [9, 0, 0],
    walls: [{ min: [4.5, -1, -20], max: [6, 20, 20], state: 'active' }] };
  const cache = {};
  const first = findJumpFrontier(surfaces, world, settings, cache);
  const second = findJumpFrontier(surfaces, world, { ...settings, maxCandidates: 8 }, cache);
  assert.equal(first.connections.length, 0);
  assert.equal(second.connections.length, 0);
  assert.equal(second.diagnostics.cursor.resumed, true);
  assert.equal(second.diagnostics.seedChecks, 0);
  assert.equal(second.diagnostics.neighbourChecks, 0);
  assert.ok(second.diagnostics.cursor.pending < first.diagnostics.cursor.pending);
  assert.equal(second.diagnostics.truncated, true);
});

test('a wider cost bound retries frontier candidates excluded by the earlier bound', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, maxCandidates: 1000, from: [2, 0, 0], to: [9, 0, 0], boundGoal: [9, 0, 0] };
  const cache = {};
  const tight = findJumpFrontier(surfaces, world, { ...settings, costBound: 0 }, cache);
  assert.deepEqual(tight.connections, []);
  assert.equal(tight.diagnostics.cursor.seedExhausted, true);
  const wider = findJumpFrontier(surfaces, world, { ...settings, costBound: 20 }, cache);
  const fresh = findJumpFrontier(surfaces, world, { ...settings, costBound: 20 }, {});
  assert.ok(fresh.connections.length > 0);
  assert.equal(wider.diagnostics.cursor.resumed, false);
  assert.deepEqual(wider.connections, fresh.connections);
});

test('invalidates frontier reachability when an existing action changes under the same id', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const connection = { id: 'transfer', state: 'closed', mode: 'jump',
    points: [[2, 0, 0], [9, 0, 0]], times: [0, 2] };
  const settings = { ...options, maxCandidates: 4, from: [2, 0, 0], to: [9, 0, 0], connections: [connection] };
  const cache = {};
  findJumpFrontier(surfaces, world, settings, cache);
  const repeated = findJumpFrontier(surfaces, world, settings, cache);
  assert.equal(repeated.diagnostics.cursor.resumed, true);
  const changed = findJumpFrontier(surfaces, world, {
    ...settings, connections: [{ ...connection, state: 'open' }],
  }, cache);
  assert.equal(changed.diagnostics.cursor.resumed, false);
  assert.deepEqual(changed.connections, []);
  assert.equal(changed.diagnostics.distanceFields.approach.reachableNodes, 2);
});

test('reverse frontiers constrain predecessors while forward frontiers retain intermediate relays', () => {
  const surfaces = [floor('start', 0, 2, 0, -1, 1), floor('relay', 5, 7, 0, -1, 1),
    floor('goal', 20, 22, 0, -1, 1)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, maxCandidates: 1000, maxHorizontalDistance: 10,
    from: [1, 0, 0], to: [21, 0, 0] };
  const cache = {};
  const reverse = findJumpFrontier(surfaces, world, settings, cache, true);
  assert.deepEqual(reverse.connections, []);
  assert.ok(reverse.diagnostics.rejected.range > 0);
  assert.equal(reverse.diagnostics.neighbourChecks, 0);
  const bounds = cache.reverseCursor.goalBounds;
  const resumed = findJumpFrontier(surfaces, world, settings, cache, true);
  assert.equal(resumed.diagnostics.cursor.resumed, true);
  assert.equal(cache.reverseCursor.goalBounds, bounds);
  const forward = findJumpFrontier(surfaces, world, settings, {});
  assert.ok(forward.connections.some(edge => edge.fromSurface === 'start' && edge.toSurface === 'relay'));
});

test('a larger link quota rebuilds frontier pools while a larger work budget resumes', () => {
  const surfaces = [floor('start', 0, 2, 0, -1, 1), floor('middle', 4, 6, 0, -1, 1),
    floor('goal', 9, 11, 0, -1, 1)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, maxCandidates: 10000, maxLinks: 1,
    walls: [{ min: [7, -1, -20], max: [8, 20, 20], state: 'active' }],
    from: [1, 0, 0], to: [10, 0, 0] };
  const cache = {};
  const first = findJumpFrontier(surfaces, world, settings, cache);
  assert.deepEqual(first.connections, []);
  const larger = findJumpFrontier(surfaces, world, { ...settings, maxLinks: 8 }, cache);
  assert.equal(larger.diagnostics.cursor.resumed, false);
  assert.ok(larger.connections.some(edge => edge.fromSurface === 'start' && edge.toSurface === 'middle'));
  const fresh = findJumpFrontier(surfaces, world, { ...settings, maxLinks: 8 }, {});
  assert.deepEqual(larger.connections, fresh.connections);
});

test('excludes costly seed regions before projection and retries after the bound widens', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, from: [2, 0, 0], to: [9, 0, 0] };
  const cache = {};
  const tight = findJumpFrontier(surfaces, world, { ...settings, costBound: .01 }, cache);
  assert.ok(tight.diagnostics.seedChecks > 0);
  assert.equal(tight.diagnostics.seedProjections, 0);
  assert.deepEqual(tight.connections, []);
  const wider = findJumpFrontier(surfaces, world, { ...settings, costBound: 10 }, cache);
  const fresh = findJumpFrontier(surfaces, world, { ...settings, costBound: 10 }, {});
  assert.ok(wider.connections.length > 0);
  assert.deepEqual(wider.connections, fresh.connections);
  assert.equal(wider.diagnostics.seedChecks, fresh.diagnostics.seedChecks);
  assert.equal(wider.diagnostics.truncated, fresh.diagnostics.truncated);
});
