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
  assert.ok(result.route.segments.some(segment => segment.mode === 'jump' || segment.mode === 'drop'));
});

test('discovers a multi-jump approach after a known launch without spending its improvement budget', () => {
  const surfaces = [floor('origin', 0, 4, 0), floor('landing', 100, 104, 0),
    floor('box', 107, 111, 1.5), floor('goal', 114, 118, 3)];
  const world = createCollisionWorld(geometry(surfaces)), starts = arrival([2, 0, 0]), goal = [116, 3, 0];
  const launch = { id: 'launch', mode: 'launch', state: 'open', points: [[2, 0, 0], [102, 0, 0]], times: [0, 1] };
  const settings = { ...options, connections: [launch], maxShortcutCandidates: 0 };
  const result = planJumpRoute(surfaces, world, starts, goal, settings);
  assert.equal(result.route.status, 'complete');
  assert.equal(result.route.segments.filter(segment => segment.mode === 'jump').length, 2);
  assert.ok(result.route.segments.some(segment => segment.connection === launch.id));
  assert.equal(result.diagnostics.searches[0].targetReached, true);
  const closed = planJumpRoute(surfaces, world, starts, goal,
    { ...settings, connections: [{ ...launch, state: 'closed' }] });
  assert.notEqual(closed.route.status, 'complete');
});

test('reaches floors beneath a platform using outward and returning air control', () => {
  for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
    const transform = ([x, y, z]) => [-512.8 + x * Math.cos(angle) - z * Math.sin(angle), y,
      1024.8 + x * Math.sin(angle) + z * Math.cos(angle)];
    const transformSurface = surface => ({ ...surface, vertices: surface.vertices.map(transform) });
    const surfaces = [floor('upper', 0.4, 3.6, 20, -1.6, 1.6),
      floor('lower', 0.4, 3.6, 0, -1.6, 1.6)].map(transformSurface);
    const collision = createCollisionWorld(geometry([floor('upper', 0, 4, 20), floor('ceiling', 0, 4, 21.8), floor('lower', 0, 4, 0)].map(transformSurface)));
    const settings = { ...options, maxDrop: 30, maxCandidates: 1000, profile: { radius: 0.35, height: 1.66 },
      model: { gravity: 40, fallingGravity: 38, maxJumpHeight: 2.1, maxFallingSpeed: 80,
        apexTime: 0.1, maxHorizontalSpeed: 6.5, airAcceleration: 60, airDeceleration: 10 } };
    const starts = arrival(transform([2, 20, 0])), goal = transform([2, 0, 0]);
    const result = planJumpRoute(surfaces, collision, starts, goal, settings);
    assert.equal(result.route.status, 'complete');
    const drop = result.route.segments.find(segment => segment.mode === 'drop');
    assert.ok(drop);
    assert.ok(drop.points.some(point => Math.hypot(point[0] - goal[0], point[2] - goal[2]) > 2));
    for (let index = 1; index < drop.points.length; index++) {
      assert.equal(collision.sweepCapsule(drop.points[index - 1], drop.points[index], settings.profile), null);
    }
    assert.ok(result.diagnostics.searches.some(search => search.accepted > 0));
    const original = { ...settings.model };
    delete original.airAcceleration; delete original.airDeceleration;
    assert.notEqual(planJumpRoute(surfaces, collision, starts, goal, { ...settings, model: original }).route.status, 'complete');
  }
});

test('searches distant openings before exhausting nearby tessellation refinements', () => {
  for (const count of [8, 80]) {
    const upper = Array.from({ length: count }, (_, index) =>
      floor(`upper/${index}`, 0.4 + index * 79.2 / count, 0.4 + (index + 1) * 79.2 / count, 20, -1.6, 1.6));
    const surfaces = [...upper, floor('lower', 0.4, 79.6, 0, -1.6, 1.6)];
    const wall = (id, x0, x1, z) => ({ id, vertices: [[x0, 20, z], [x1, 20, z], [x1, 28, z], [x0, 28, z]] });
    const collision = createCollisionWorld(geometry([
      floor('upper', 0, 80, 20), floor('lower', 0, 80, 0), floor('ceiling', 0, 80, 21.8),
      wall('front', 0, 70, -2), wall('front-end', 74, 80, -2), wall('back', 0, 80, 2),
      { id: 'left', vertices: [[0, 20, -2], [0, 28, -2], [0, 28, 2], [0, 20, 2]] },
      { id: 'right', vertices: [[80, 20, -2], [80, 28, -2], [80, 28, 2], [80, 20, 2]] },
    ]));
    const result = planJumpRoute(surfaces, collision, arrival([2, 20, 0]), [2, 0, 0], {
      ...options, maxDrop: 30, maxCandidates: 1000,
      model: { ...options.model, airAcceleration: 60, airDeceleration: 10 },
    });
    assert.equal(result.route.status, 'complete', `tessellation ${count}`);
    const drop = result.route.segments.find(segment => segment.mode === 'drop');
    assert.ok(drop);
    assert.ok(drop.points[0][0] >= 69 && drop.points[0][0] <= 75);
  }
});

test('uses continuous ground approaches across overlapping patches before jumping', () => {
  const surfaces = [floor('arrival', 0.4, 4.4, 20, -1.6, 1.6),
    floor('extension', 3.4, 7.6, 20, -1.6, 1.6), floor('goal', 8, 12, 0, -1.6, 1.6)];
  const collision = createCollisionWorld(geometry([floor('upper', 0, 8, 20), floor('lower', 8, 12, 0)]));
  const walls = [-2, 2].map(z => ({ min: [-1, 10, z - .05], max: [9, 30, z + .05], state: 'unknown' }));
  const result = planJumpRoute(surfaces, collision, arrival([2, 20, 0]), [10, 0, 0], {
    ...options, walls, maxDrop: 30, maxCandidates: 1500,
  });
  assert.equal(result.route.status, 'complete');
  const air = result.route.segments.find(segment => segment.mode !== 'walk');
  assert.ok(air);
  assert.ok(air.points[0][0] > 4.4);
});

test('reuses prepared walking topology while admitting connections added after preparation', () => {
  const surfaces = [floor('left', 0, 4, 0), floor('right', 14, 18, 0)];
  const starts = arrival([2, 0, 0]), goal = [16, 0, 0];
  const groundPlanner = createGroundPlanner(surfaces, options);
  assert.equal(groundPlanner.plan(starts, goal).status, 'no-verified-route');
  const connection = { id: 'rope', mode: 'rope', state: 'open', points: [[2, 0, 0], [16, 0, 0]], times: [0, 2] };
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(surfaces)), starts, goal,
    { ...options, groundPlanner, connections: [connection], maxCandidates: 0 });
  assert.equal(result.route.status, 'complete');
  assert.equal(result.route.cost, 2);
  assert.ok(result.route.segments.some(segment => segment.connection === 'rope'));
  assert.equal(groundPlanner.plan(starts, goal).status, 'no-verified-route');
});
