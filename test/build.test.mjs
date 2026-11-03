import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundSurfaces } from '../src/build.mjs';
import { planGroundRoute, projectPoint } from '../src/index.mjs';
const options = { profile: { radius: 0.35, height: 1.66 }, maxSlope: 46,
  stepUp: 0.4, stepDown: 0.6, cellSize: 0.1, cellHeight: 0.05 };
const quad = (x0,x1,z0,z1,y0,y1=y0) => [[x0,y0,z0],[x0,y0,z1],[x1,y1,z1],[x0,y0,z0],[x1,y1,z1],[x1,y1,z0]];
const build = (vertices, config = options) => buildGroundSurfaces({positions: vertices.flat(), indices: vertices.map((_, i) => i)}, config);
const route = (surfaces, start, end, walls=[]) => planGroundRoute(surfaces,
  [{id:'player', position:start, cost:0, state:'available'}], end,
  {profile:options.profile, speed:5, maxVertical:0.15, walls});

test('builds from physical floor without an AI navigation mask and preserves detail heights', async () => {
  const surfaces = await buildGroundSurfaces({positions:new Float32Array([0,0,0, 0,0,8, 10,4,8, 10,4,0]),
    indices:new Uint16Array([0,1,2, 0,2,3])}, options);
  const result = route(surfaces,[1,0.4,4],[9,3.6,4]);
  assert.equal(result.status,'complete');
  assert.ok(Math.abs(result.points[0][1]-0.4)<0.15);
  assert.ok(Math.abs(result.points.at(-1)[1]-3.6)<0.15);
  assert.equal(route(surfaces,[1,0.4,4],[9,3.6,4],
    [{min:[4,-1,0],max:[6,10,8],state:'unknown'}]).status,'no-verified-route');
});

test('gap and low ceiling do not become successful partial routes', async () => {
  for (const vertices of [
    [...quad(0,4,0,8,0),...quad(6,10,0,8,0)],
    [...quad(0,10,0,8,0),...quad(4,6,0,8,1.4)],
  ]) {
    const surfaces = await build(vertices);
    assert.ok(projectPoint(surfaces,[1,0,4],{maxVertical:.15}));
    assert.ok(projectPoint(surfaces,[9,0,4],{maxVertical:.15}));
    assert.equal(route(surfaces,[1,0,4],[9,0,4]).status,'no-verified-route');
  }
  const floor = await build(quad(0,10,0,8,0));
  assert.equal(projectPoint(floor,[0.1,0,4],{maxVertical:.15}),null);
  const narrow = await build([...quad(0,4,0,8,0),...quad(4,6,3.75,4.25,0),...quad(6,10,0,8,0)]);
  assert.equal(route(narrow,[1,0,4],[9,0,4]).status,'no-verified-route');
});

test('separates ordinary steps from larger directional drops and excessive slopes', async () => {
  const small = await build([...quad(0,5,0,8,0),...quad(5,10,0,8,0.3)]);
  assert.equal(route(small,[1,0,4],[9,0.3,4]).status,'complete');
  const larger = await build([...quad(0,5,0,8,0),...quad(5,10,0,8,0.5)]);
  assert.equal(route(larger,[1,0,4],[9,0.5,4]).status,'no-verified-route');
  assert.equal(route(larger,[9,0.5,4],[1,0,4]).status,'no-verified-route');
  // A high downward allowance must never grant the same upward step.
  const slope = await build([...quad(0,4,0,8,0),...quad(4,6,0,8,0,3),...quad(6,10,0,8,3)]);
  assert.equal(route(slope,[1,0,4],[9,3,4]).status,'no-verified-route');
});

test('rejects invalid geometry and unsafe voxel budgets before native allocation', async () => {
  const geometry = {positions:quad(0,10,0,8,0).flat(), indices:[0,1,2]};
  await assert.rejects(buildGroundSurfaces({...geometry,indices:[0,1,99]},options),/index/);
  await assert.rejects(buildGroundSurfaces({...geometry,positions:[NaN,...geometry.positions.slice(1)]},options),/finite/);
  await assert.rejects(buildGroundSurfaces(geometry,{...options,cellHeight:1}),/voxel profile/);
  await assert.rejects(build(quad(0,10000,0,10000,0)),/voxel limits/);
});

test('bounds restrict extended actors without dropping intersecting floor or headroom', async () => {
  const config = {...options, bounds:{min:[0,0],max:[10,8]}};
  // Large source actors remain available to rasterization; only the build rectangle is clipped.
  const geometry = [...quad(-1000,1000,-1000,1000,0), ...quad(4,6,-1000,1000,1.4)];
  const surfaces = await build(geometry,config);
  assert.ok(projectPoint(surfaces,[1,0,4],{maxVertical:.15}));
  assert.ok(projectPoint(surfaces,[9,0,4],{maxVertical:.15}));
  assert.equal(projectPoint(surfaces,[-1,0,4],{maxVertical:.15}),null);
  assert.equal(route(surfaces,[1,0,4],[9,0,4]).status,'no-verified-route');
  const floor = await build(quad(-1000,1000,-1000,1000,0),config);
  assert.equal(route(floor,[1,0,4],[9,0,4]).status,'complete');
  for (const bounds of [{min:[0,0],max:[0,8]}, {min:[NaN,0],max:[10,8]}, {min:[0],max:[10,8]}]) {
    await assert.rejects(build(geometry,{...options,bounds}),/bounds/);
  }
});
