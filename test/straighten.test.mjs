import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroundStraightener } from '../src/straighten.mjs';

const options = { walls: [], profile: { radius: 0.3, height: 1.7 } };
const rectangle = (id, x, z, width = 1, depth = 1, height = () => 0) => ({
  id,
  vertices: [[x, height(x, z), z], [x + width, height(x + width, z), z],
    [x + width, height(x + width, z + depth), z + depth], [x, height(x, z + depth), z + depth]],
});
const closePoint = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));

test('removes centre and portal zigzags across an arbitrary planar strip', () => {
  const surfaces = Array.from({ length: 12 }, (_, i) => rectangle(String(i), i, 0));
  const points = [[0.1, 0, 0.2]];
  for (let i = 0; i < 11; i++) points.push([i + .5, 0, .5], [i + 1, 0, .5]);
  points.push([11.9, 0, .8]);
  const original = structuredClone(points);
  const straighten = createGroundStraightener(surfaces, options);
  assert.deepEqual(straighten(points), [points[0], points.at(-1)]);
  assert.deepEqual(points, original);
  assert.deepEqual(straighten([...points].reverse()), [points.at(-1), points[0]]);
});

test('retains required corners around an unsupported inside corner', () => {
  const surfaces = [rectangle('a', 0, 0), rectangle('b', 1, 0), rectangle('c', 2, 0),
    rectangle('d', 2, 1), rectangle('e', 2, 2)];
  const input = [[.1, 0, .5], [.5, 0, .5], [1, 0, .5], [1.5, 0, .5], [2, 0, .5],
    [2.5, 0, .5], [2.5, 0, 1], [2.5, 0, 1.5], [2.5, 0, 2.9]];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.length > 2 && result.length < input.length);
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
  for (let i = 1; i < result.length; i++) {
    for (let step = 0; step <= 20; step++) {
      const t = step / 20, point = result[i - 1].map((value, axis) => value + t * (result[i][axis] - value));
      assert.ok(point[2] <= 1 + 1e-7 || point[0] >= 2 - 1e-7);
    }
  }
});

test('preserves a closed portal and a gap even where endpoints share a height', () => {
  const closed = rectangle('a', 0, 0);
  closed.portals = [0, 2, 3];
  const surfaces = [closed, rectangle('b', 1, 0), rectangle('far', 2.1, 0)];
  const input = [[.2, 0, .2], [.5, 0, .7], [1.5, 0, .7], [2.8, 0, .2]];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.some(point => point[0] === .5));
  assert.ok(result.some(point => point[0] === 1.5));
});

test('never projects a ground shortcut onto a stacked floor', () => {
  const surfaces = [rectangle('lower', 0, 0, 4, 1), rectangle('upper', 0, 0, 4, 1, () => 3)];
  const input = [[.2, 0, .2], [1.2, 0, .8], [1.2, 3, .8], [3.8, 3, .2]];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.length >= 4);
  assert.deepEqual(result[1], input[1]);
  assert.deepEqual(result[2], input[2]);
});

test('reconstructs changes in ground slope but collapses coplanar crossings', () => {
  const surfaces = [rectangle('a', 0, 0, 1, 1, x => x),
    rectangle('b', 1, 0, 1, 1, () => 1), rectangle('c', 2, 0, 1, 1, () => 1)];
  const input = [[.1, .1, .2], [.5, .5, .5], [1, 1, .5], [1.5, 1, .5], [2, 1, .5], [2.9, 1, .8]];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.equal(result.length, 3);
  closePoint(result[1], [1, 1, .2 + .6 * .9 / 2.8]);
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
});

test('keeps a wall-avoiding bend and checks body clearance', () => {
  const surface = rectangle('floor', 0, 0, 4, 4);
  const wall = { min: [1.8, -1, 1.2], max: [2.2, 3, 2.8], state: 'unknown' };
  const input = [[.5, 0, 2], [1, 0, 3.5], [3, 0, 3.5], [3.5, 0, 2]];
  const result = createGroundStraightener([surface], { ...options, walls: [wall] })(input);
  assert.ok(result.length > 2);
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
});

test('rejects malformed inputs and preserves stationary paths', () => {
  const straighten = createGroundStraightener([rectangle('floor', 0, 0)], options);
  assert.deepEqual(straighten([[.2, 0, .2]]), [[.2, 0, .2]]);
  assert.throws(() => straighten([]), /Invalid ground path/);
  assert.throws(() => straighten([[NaN, 0, 0]]), /Invalid ground path/);
  assert.throws(() => createGroundStraightener([rectangle('a', 0, 0), rectangle('a', 1, 0)], options), /Invalid surface/);
});

test('does not pass through a vertex shared by disconnected polygons', () => {
  const surfaces = [rectangle('a', 0, 0), rectangle('b', 1, 1)];
  const input = [[.2, 0, .2], [.2, 0, .8], [1.8, 0, 1.8]];
  assert.deepEqual(createGroundStraightener(surfaces, options)(input), input);
});

test('traverses connected triangle fans at a shared vertex', () => {
  const surfaces = [rectangle('a', 0, 0), rectangle('b', 1, 0), rectangle('c', 0, 1), rectangle('d', 1, 1)];
  const input = [[.2, 0, .2], [.5, 0, .5], [1, 0, .5], [1.5, 0, .5], [1.5, 0, 1], [1.8, 0, 1.8]];
  assert.deepEqual(createGroundStraightener(surfaces, options)(input), [input[0], input.at(-1)]);
});

test('straightens through split portals and stays inside their overlap', () => {
  const a = rectangle('a', 0, 0, 1, 2);
  const b = rectangle('b', 1, 0), c = rectangle('c', 1, 1);
  const input = [[.2, 0, .3], [.5, 0, 1], [1, 0, .5], [1.8, 0, .3]];
  assert.deepEqual(createGroundStraightener([a,b,c], options)(input), [input[0], input.at(-1)]);
});
