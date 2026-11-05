import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundTiles } from '../src/build.mjs';
import { planGroundRoute, projectPoint, surfaceGraph } from '../src/index.mjs';

const options = {
  profile: { radius: .35, height: 1.66 }, maxSlope: 46,
  stepUp: .4, stepDown: .6, cellSize: .1, cellHeight: .05,
  tileCells: 80, bounds: { min: [0, 0], max: [16, 8] },
};
const quad = (x0, x1, z0, z1, y0, y1 = y0) => [
  [x0, y0, z0], [x0, y0, z1], [x1, y1, z1],
  [x0, y0, z0], [x1, y1, z1], [x1, y1, z0],
];
const geometry = vertices => ({ positions: vertices.flat(), indices: vertices.map((_, index) => index) });
const plan = (data, start, goal) => planGroundRoute(data.surfaces,
  [{ id: 'player', position: start, cost: 0, state: 'available' }], goal,
  { profile: options.profile, walls: [], speed: 5, maxVertical: .15, portals: data.portals });

test('padded tiles retain continuous ground and detail heights across core seams', async () => {
  const data = await buildGroundTiles(geometry(quad(-2, 18, -2, 10, -.7, 1.3)), options);
  assert.equal(data.tiles.length, 2);
  assert.ok(data.tiles.every(tile => tile.surfaces > 0));
  assert.ok(data.portals.length > 0);
  assert.equal(new Set(data.surfaces.map(surface => surface.id)).size, data.surfaces.length);
  for (const surface of data.surfaces) {
    const tile = data.tiles.find(tile => surface.id.startsWith(`${tile.x},${tile.z}/`));
    assert.ok(surface.vertices.every(point => point[0] >= tile.bounds.min[0] && point[0] <= tile.bounds.max[0] &&
      point[2] >= tile.bounds.min[1] && point[2] <= tile.bounds.max[1]));
  }
  for (const z of [1, 4, 7]) {
    const route = plan(data, [1, -.4, z], [15, 1, z]);
    assert.equal(route.status, 'complete');
    assert.ok(route.points.every(point => Math.abs(point[1] - (-.5 + point[0] * .1)) < .15));
  }
});

test('large negative Float32 coordinates retain exact core planes on sloping detail triangles', async () => {
  const vertices = [];
  const point = (x, z) => [x, 160 + .05 * (x + 806.4) + .08 * Math.sin(z * 5), z];
  for (let i = 0; i < 80; i++) {
    for (let j = 0; j < 50; j++) {
      const x = -814 + i * .2, z = -8 + j * .2;
      vertices.push(point(x, z), point(x, z + .2), point(x + .2, z + .2),
        point(x, z), point(x + .2, z + .2), point(x + .2, z));
    }
  }
  const data = await buildGroundTiles(geometry(vertices), { ...options,
    tileCells: 64, bounds: { min: [-812.8, -6.4], max: [-800, 0] } });
  assert.ok(data.portals.length > 0);
  assert.doesNotThrow(() => surfaceGraph(data.surfaces, { speed: 5, portals: data.portals }));
  for (const surface of data.surfaces) {
    const tile = data.tiles.find(tile => surface.id.startsWith(`${tile.x},${tile.z}/`));
    for (const vertex of surface.vertices) {
      for (let axis = 0; axis < 2; axis++) {
        for (const boundary of [tile.bounds.min[axis], tile.bounds.max[axis]]) {
          const coordinate = vertex[axis === 0 ? 0 : 2];
          if (Math.abs(coordinate - boundary) <= 1e-4) assert.equal(coordinate, boundary);
        }
      }
    }
  }
});

test('an obstacle spanning a tile boundary remains impassable', async () => {
  const data = await buildGroundTiles(geometry([
    ...quad(-2, 18, -2, 10, 0),
    ...quad(7, 9, -2, 10, 1.4),
  ]), options);
  assert.ok(projectPoint(data.surfaces, [2, 0, 4], { maxVertical: .15 }));
  assert.ok(projectPoint(data.surfaces, [14, 0, 4], { maxVertical: .15 }));
  assert.equal(plan(data, [2, 0, 4], [14, 0, 4]).status, 'no-verified-route');
});

test('a hole at the shared boundary and excessive floor separation receive no bridge', async () => {
  for (const vertices of [
    [...quad(-2, 7, -2, 10, 0), ...quad(9, 18, -2, 10, 0)],
    [...quad(-2, 8, -2, 10, 0), ...quad(8, 18, -2, 10, 1)],
  ]) {
    const data = await buildGroundTiles(geometry(vertices), options);
    const goalY = vertices.at(-1)[1];
    assert.equal(plan(data, [2, 0, 4], [14, goalY, 4]).status, 'no-verified-route');
    assert.equal(data.portals.length, 0);
  }
});

test('global tile coordinates support negative bounds and report empty tiles', async () => {
  const data = await buildGroundTiles(geometry(quad(-7, -1, -7, -1, 0)),
    { ...options, bounds: { min: [-8, -8], max: [16, 8] } });
  assert.equal(data.tiles.length, 6);
  assert.ok(data.tiles.some(tile => tile.x === -1 && tile.z === -1 && tile.surfaces > 0));
  assert.ok(data.tiles.some(tile => tile.x === 1 && tile.z === 0 && tile.surfaces === 0));
  const empty = await buildGroundTiles(geometry([]), options);
  assert.deepEqual(empty.surfaces, []);
  assert.deepEqual(empty.portals, []);
  assert.ok(empty.tiles.every(tile => tile.surfaces === 0));
  const outside = geometry(quad(1000, 1010, 1000, 1010, 100000));
  const distant = await buildGroundTiles(outside, options);
  assert.deepEqual(distant, empty);
  outside.positions[0] = NaN;
  await assert.rejects(buildGroundTiles(outside, options), /Non-finite collision vertex/);
  const decimal = await buildGroundTiles(geometry(quad(-2, 2, -2, 2, 0)),
    { ...options, tileCells: 3, bounds: { min: [.3, -.3], max: [.9, .3] } });
  assert.deepEqual(decimal.tiles.map(tile => [tile.x, tile.z]), [[1, -1], [2, -1], [1, 0], [2, 0]]);
});

test('invalid bounds, tile budgets and failed tile builds reject the whole result', async () => {
  const floor = geometry(quad(-2, 18, -2, 10, 0));
  for (const bounds of [undefined, { min: [0, 0], max: [0, 8] }, { min: [NaN, 0], max: [16, 8] }]) {
    await assert.rejects(buildGroundTiles(floor, { ...options, bounds }), /bounds/);
  }
  await assert.rejects(buildGroundTiles(floor, { ...options, tileCells: 0 }), /tile cell/);
  await assert.rejects(buildGroundTiles(floor, { ...options, tileCells: 1 }), /512 tile/);
  await assert.rejects(buildGroundTiles(geometry([...quad(-2, 18, -2, 10, 0), ...quad(-2, 18, -2, 10, 1000)]), options),
    /Ground tile \(0, 0\) build failed:.*voxel limits/);
});

test('completed empty polygon meshes are reported empty without concealing a failed tile', async () => {
  const downward = quad(-2, 18, -2, 10, 0);
  for (let i = 0; i < downward.length; i += 3) [downward[i], downward[i + 1]] = [downward[i + 1], downward[i]];
  for (const vertices of [downward,
    [[8, 0, -2], [8, 0, 10], [8, 4, 10], [8, 0, -2], [8, 4, 10], [8, 4, -2]],
    quad(7.9, 8.1, -2, 10, 0),
  ]) {
    const data = await buildGroundTiles(geometry(vertices), options);
    assert.deepEqual(data.surfaces, []);
    assert.deepEqual(data.portals, []);
    assert.ok(data.tiles.every(tile => tile.surfaces === 0));
  }
});

test('builds sparse corridor tiles without granting access through unselected ground', async () => {
  const source = geometry(quad(-2, 34, -2, 10, 0));
  const selected = [{ x: 3, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }], before = structuredClone(selected), progress = [];
  const settings = { ...options, bounds: { min: [0, 0], max: [32, 8] }, tiles: selected,
    onTile: value => progress.push(value) };
  const data = await buildGroundTiles(source, settings);
  assert.deepEqual(selected, before);
  assert.deepEqual(data.tiles.map(tile => tile.x), [0, 1, 3]);
  assert.equal(progress.at(-1).completed, 3);
  assert.equal(plan(data, [2, 0, 4], [14, 0, 4]).status, 'complete');
  assert.notEqual(plan(data, [2, 0, 4], [26, 0, 4]).status, 'complete');
  assert.equal(projectPoint(data.surfaces, [20, 0, 4], { maxVertical: .15 }), null);
  await assert.rejects(buildGroundTiles(source, { ...settings, tiles: [{ x: 0, z: 0 }, { x: 0, z: 0 }] }), /selection/);
  await assert.rejects(buildGroundTiles(source, { ...settings, tiles: [{ x: -1, z: 0 }] }), /selection/);
});
