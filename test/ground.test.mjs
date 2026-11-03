import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGroundRoute, route } from '../src/index.mjs';
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
