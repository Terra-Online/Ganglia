import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGroundRoute, route, createGroundPlanner } from '../src/index.mjs';
const surfaces = [{ id: 'a', vertices: [[0,0,0],[2,0,0],[2,0,2],[0,0,2]] },
  { id: 'b', vertices: [[2,0,0],[4,0,0],[4,0,2],[2,0,2]] },
  { id: 'island', vertices: [[5,0,0],[6,0,0],[6,0,2],[5,0,2]] }];
const options = { speed: 1, maxVertical: 0.5, walls: [], profile: { radius: 0.4, height: 2 } };
test('compares grounded teleport arrivals and preserves the actual endpoints', () => {
  const result = planGroundRoute(surfaces, [
    { id: 'near-island', position: [5.1,0,1], cost: 0, state: 'available' },
    { id: 'locked', position: [3.5,0,1], cost: 0, state: 'locked' },
    { id: 'base', position: [0.2,0.1,1], cost: 2, state: 'available' },
  ], [3.8,0.1,1], options);
  assert.equal(result.status, 'complete');
  assert.equal(result.start, 'base');
  assert.deepEqual(result.points[0], [0.2,0,1]);
  assert.deepEqual(result.points.at(-1), [3.8,0,1]);
  assert.ok(Math.abs(result.cost - 5.6) < 1e-8);
  assert.equal(planGroundRoute(surfaces, [], [4.5,0,1], options).status, 'unmapped');
});
test('same-polygon shortcuts and stationary paths still obey wall exclusions', () => {
  const wall = { min: [0.9,-1,0], max: [1.1,3,2], state: 'unknown' };
  const start = { id: 'player', position: [0.2,0,1], cost: 0, state: 'available' };
  const result = planGroundRoute(surfaces, [start], [1.8,0,1], options);
  assert.deepEqual(result.points, [[0.2,0,1],[1.8,0,1]]);
  assert.equal(planGroundRoute(surfaces, [start], [1.8,0,1], {...options, walls:[wall]}).status, 'no-verified-route');
  assert.equal(route({nodes:[{id:'a',position:[1,0,1]}],edges:[]}, 'a', 'a', {walls:[wall],profile:options.profile}).status, 'no-verified-route');
});

test('continuous support corridors can bypass blocked graph centres while retaining exclusions', () => {
  const rectangle = (id, left, right, near, far) => ({ id,
    vertices: [[left,0,near],[right,0,near],[right,0,far],[left,0,far]] });
  const ground = [rectangle('entry', 0, 4, 0, 2), rectangle('turn', 4, 6, 0, 2),
    rectangle('exit', 4, 6, 2, 6)];
  const starts = [{ id: 'player', position: [.5,0,.5], cost: 0, state: 'available' }];
  const constraints = { ...options, profile: { radius: .1, height: 2 },
    walls: [{ min: [1.8,-1,.9], max: [2.2,3,1.1], state: 'unknown' }] };
  const result = planGroundRoute(ground, starts, [5.5,0,5.5], constraints);
  assert.equal(result.status, 'complete');
  assert.ok(result.points.some(point => point[0] >= 4 && point[2] <= 2));
  assert.equal(planGroundRoute(ground, starts, [5.5,0,5.5], { ...constraints,
    walls: [{ min: [1.8,-1,-1], max: [2.2,3,3], state: 'unknown' }],
  }).status, 'no-verified-route');
});

test('prepared action queries preserve explicit support faces across overlapping navigation', () => {
  const floor = (id, left, right, height, portals) => ({ id, portals,
    vertices: [[left, height, 0], [right, height, 0], [right, height, 2], [left, height, 2]] });
  const scene = [floor('shadow', 2, 4, 0.3, []), floor('source', 0, 4, 0), floor('target', 7, 11, 4)];
  const planner = createGroundPlanner(scene, options);
  const starts = [{ id: 'player', position: [1, 0, 1], state: 'available', cost: 0 }];
  const connection = { id: 'jump', mode: 'jump', state: 'open',
    points: [[3, 0.305, 1], [8, 4, 1]], times: [0, 1], endpointTolerance: 0.35, fromSurface: 'source', toSurface: 'target' };
  assert.equal(planner.plan(starts, [10, 4, 1], { connections: [connection] }).status, 'complete');
  assert.notEqual(planner.plan(starts, [10, 4, 1], { connections: [] }).status, 'complete');
  const { fromSurface, toSurface, ...unbound } = connection;
  assert.notEqual(planner.plan(starts, [10, 4, 1], { connections: [unbound] }).status, 'complete');
  assert.throws(() => planner.plan(starts, [10, 4, 1], {
    connections: [{ ...connection, toSurface: 'missing' }],
  }), /support surface/);
});

test('prepared queries straighten arbitrary endpoints and apply continuous sprint timing', async () => {
  const { createGroundPlanner } = await import('../src/index.mjs');
  const planner = createGroundPlanner(surfaces, { ...options,
    locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 4 },
  });
  for (const z of [.2, .7, 1.5]) {
    const start = { id: 'player', position: [.2,0,z], cost: 0, state: 'available' };
    const result = planner.plan([start], [3.8,0,z]);
    assert.equal(result.status, 'complete');
    assert.ok(result.points.every(p => Math.abs(p[2] - z) < 1e-7));
    assert.ok(Math.abs(result.length - 3.6) < 1e-7);
    assert.ok(result.cost < 3.6);
    assert.equal(result.segments[0].gait, 'sprint');
    const stationary = planner.plan([start], start.position);
    assert.equal(stationary.status, 'complete');
    assert.equal(stationary.cost, 0);
    assert.deepEqual(stationary.points, [start.position]);
  }
});

test('interaction queries end on reachable standing ground within an explicit volume', async () => {
  const { createGroundPlanner } = await import('../src/index.mjs');
  const planner = createGroundPlanner([
    { id: 'floor', vertices: [[0,0,0],[4,0,0],[4,0,4],[0,0,4]] },
    { id: 'platform', vertices: [[1,1,1],[2,1,1],[2,1,2],[1,1,2]] },
  ], options);
  const starts = [{ id: 'player', position: [.5,0,.5], cost: 0, state: 'available' }];
  assert.equal(planner.plan(starts, [1.5,1,1.5]).status, 'no-verified-route');
  const result = planner.plan(starts, [1.5,1,1.5], { interaction: { radius: 1.5 } });
  assert.equal(result.status, 'complete');
  assert.equal(result.points.at(-1)[1], 0);
  assert.ok(Math.hypot(...result.points.at(-1).map((v,i) => v - [1.5,1,1.5][i])) <= 1.5);
});

test('an initially unmapped query still permits later tracing on overlapping supports', () => {
  const rectangle = (id, left, right, near, far) => ({ id,
    vertices: [[left,0,near],[right,0,near],[right,0,far],[left,0,far]] });
  const planner = createGroundPlanner([
    rectangle('small', 0, 2, -.5, .5), rectangle('large', -1, 10, -2, 2),
  ], { ...options, speed: 5 });
  const starts = [{ id: 'player', position: [1,0,0], cost: 0, state: 'available' }];
  assert.equal(planner.plan(starts, [9,10,0]).status, 'unmapped');
  const result = planner.plan(starts, [9,0,0]);
  assert.equal(result.status, 'complete');
  assert.equal(result.cost, 1.6);
  assert.deepEqual(result.points, [[1,0,0],[9,0,0]]);
});
