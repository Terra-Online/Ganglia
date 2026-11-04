import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundSurfaces, buildGroundTiles } from '../src/build.mjs';
import { planGroundRoute, surfaceGraph } from '../src/index.mjs';
import { createGroundStraightener } from '../src/straighten.mjs';
import { exposedBoundaries } from '../src/traversal.mjs';

const options = { profile: { radius: .35, height: 1.66 }, maxSlope: 46,
  stepUp: .4, stepDown: .6, cellSize: .15, cellHeight: .05 };
const quad = (x0, x1, z0, z1, y) => [[x0,y,z0],[x0,y,z1],[x1,y,z1],
  [x0,y,z0],[x1,y,z1],[x1,y,z0]];
const staircase = (depth, rise = .2) => {
  const points = quad(0, 3, 0, 2, 0);
  for (let i = 0; i < 12; i++) {
    const x = 3 + i * depth, y = (i + 1) * rise;
    points.push(...quad(x, x + depth, 0, 2, y),
      [x,y-rise,0],[x,y-rise,2],[x,y,2],[x,y-rise,0],[x,y,2],[x,y,0]);
  }
  points.push(...quad(3 + 12 * depth, 6 + 12 * depth, 0, 2, 12 * rise));
  return points;
};
const geometry = points => ({ positions: points.flat(), indices: points.map((_, i) => i) });
const plan = (surfaces, start, end, portals = []) => planGroundRoute(surfaces,
  [{ id: 'player', position: start, cost: 0, state: 'available' }], end,
  { profile: options.profile, speed: 5, maxVertical: .15, walls: [], portals });

test('continuous local steps remain walkable across tread depths, rotation and grid offsets', async () => {
  for (const depth of [.2, .25, .3, .45]) for (const angle of [0, Math.PI / 8, Math.PI / 4]) {
    const transform = ([x,y,z]) => [x * Math.cos(angle) - z * Math.sin(angle) - 4.13,
      y, x * Math.sin(angle) + z * Math.cos(angle) + .07];
    const surfaces = await buildGroundSurfaces(geometry(staircase(depth).map(transform)), options);
    const ends = [transform([1,0,1]), transform([5 + 12 * depth,2.4,1])];
    for (const [start, end] of [ends, [...ends].reverse()]) {
      const route = plan(surfaces, start, end);
      assert.equal(route.status, 'complete', `depth ${depth}, angle ${angle}, start ${start}`);
      assert.ok(route.segments.every(segment => segment.mode === 'walk'));
    }
  }
});

test('stair topology preserves tile crossings and rejects excessive rise and low headroom', async () => {
  const data = await buildGroundTiles(geometry(staircase(.3)), { ...options,
    tileCells: 32, bounds: { min: [0,0], max: [9.6,2.4] } });
  assert.equal(plan(data.surfaces, [1,0,1], [8,2.4,1], data.portals).status, 'complete');
  for (const [points, goalHeight] of [[staircase(.3, .5), 6], [[...staircase(.3), ...quad(4,5,0,2,2.1)], 2.4]]) {
    const surfaces = await buildGroundSurfaces(geometry(points), options);
    assert.equal(plan(surfaces, [1,0,1], [8,goalHeight,1]).status, 'no-verified-route');
  }
});

test('directed passage intervals are shared by tracing, search and exposed boundaries', () => {
  const surfaces = [
    { id: 'lower', vertices: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], portals: [] },
    { id: 'upper', vertices: [[1,.2,0],[2,.2,0],[2,.2,1],[1,.2,1]], portals: [] },
  ];
  const portal = { from: 'lower', to: 'upper', points: [[1,0,.5],[1,.2,.5]],
    entry: [[1,0,.25],[1,0,.75]], exit: [[1,.2,.25],[1,.2,.75]] };
  const trace = createGroundStraightener(surfaces, { profile: options.profile, walls: [], portals: [portal] });
  assert.deepEqual(trace.trace([.5,0,.5], [1.5,.2,.5]), [[.5,0,.5],[1,0,.5],[1,.2,.5],[1.5,.2,.5]]);
  assert.equal(trace.trace([1.5,.2,.5], [.5,0,.5]), null);
  assert.equal(trace.trace([.5,0,.9], [1.5,.2,.9]), null);
  assert.equal(plan(surfaces, [1.5,.2,.5], [.5,0,.5], [portal]).status, 'no-verified-route');
  const edges = exposedBoundaries(surfaces, [portal]);
  const lower = edges.filter(edge => edge.surface === 'lower' && edge.edge === 1);
  assert.deepEqual(lower.map(edge => [edge.a[2], edge.b[2]]), [[0,.25],[.75,1]]);
  assert.equal(edges.filter(edge => edge.surface === 'upper' && edge.edge === 3).length, 1);
  // A short interval near a corner must select the edge containing its full width.
  const corner = { ...portal, points: [[1,0,.000075],[1,.2,.000075]],
    entry: [[1,0,0],[1,0,.00015]], exit: [[1,.2,0],[1,.2,.00015]] };
  assert.doesNotThrow(() => surfaceGraph(surfaces, { speed: 1, portals: [corner] }));
});
