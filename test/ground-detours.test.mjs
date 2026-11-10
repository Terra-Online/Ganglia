import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedByWalls, createGroundPlanner, pruneGroundDetours, retimeGroundRoute } from '../src/index.mjs';

const locomotion = { speed: 2, sprintSpeed: 4, sprintAcceleration: 2 };
const options = { speed: 2, maxVertical: 0.1, profile: { radius: 0.1, height: 1.8 }, walls: [], locomotion };
const floor = (id, x0, x1) => ({ id, vertices: [[x0,0,0],[x1,0,0],[x1,0,4],[x0,0,4]] });
const segment = (mode, points, seconds) => ({ mode, points, times: points.map((_, i) => seconds * i / (points.length - 1)),
  ...(mode !== 'walk' ? { connection: 'device' } : {}) });
const routeOf = segments => {
  const points = [segments[0].points[0], ...segments.flatMap(s => s.points.slice(1))];
  return { status: 'complete', start: 'player', arrivalCost: 0, cost: segments.reduce((s, v) => s + v.times.at(-1), 0),
    length: points.slice(1).reduce((s, p, i) => s + Math.hypot(...p.map((v, a) => v - points[i][a])), 0), points, segments };
};
const excursion = () => routeOf([
  segment('walk', [[0.5,0,0.5],[1,0,0.5]], 0.5),
  segment('launch', [[1,0,0.5],[1,4,2.5],[5,0,0.5]], 5),
  segment('walk', [[5,0,0.5],[6,0,0.5]], 1),
]);

test('a supported cheaper walk removes an unnecessary device and preserves exact endpoints', () => {
  const original = excursion();
  const planner = createGroundPlanner([floor('road',0,8)], options);
  const result = pruneGroundDetours(original, planner, locomotion);
  assert.ok(result.replacements > 0);
  assert.ok(result.route.cost < retimeGroundRoute(original, locomotion).cost);
  assert.deepEqual(result.route.points[0], original.points[0]);
  assert.deepEqual(result.route.points.at(-1), original.points.at(-1));
  assert.ok(result.route.segments.every(s => s.mode === 'walk'));
  assert.deepEqual(original, excursion(), 'caller-owned route was mutated');
});

test('ground replacement cannot cross missing support or a blocking wall, even with a device in the planner', () => {
  const original = excursion();
  for (const planner of [
    createGroundPlanner([floor('near',0,2),floor('far',4,8)], { ...options,
      connections: [{ id:'device',mode:'launch',state:'open',points:[[1,0,0.5],[5,0,0.5]],times:[0,1] }] }),
    createGroundPlanner([floor('road',0,8)], { ...options,
      walls: [{ min:[2,-1,-1],max:[3,6,5],state:'unknown' }] }),
  ]) {
    const result = pruneGroundDetours(original, planner, locomotion);
    assert.equal(result.replacements, 0);
    assert.deepEqual(result.route, original);
  }
});

test('useful faster devices and airborne collection events survive the necessity comparison', () => {
  const planner = createGroundPlanner([floor('road',0,8)], options);
  const faster = excursion(); faster.segments[1].times = [0,0.05,0.1];
  assert.equal(pruneGroundDetours(faster, planner, locomotion).replacements, 0);
  const collection = { ...excursion(), goalHit: { segment:1,time:1,position:[1,4,2.5] } };
  assert.equal(pruneGroundDetours(collection, planner, locomotion).replacements, 0);
});

test('the complete resource schedule and a later collection event survive a preceding replacement', () => {
  const original = excursion();
  original.segments.push(segment('jump', [[6,0,0.5],[7,2,0.5],[8,0,0.5]], 2));
  const withEvent = { ...routeOf(original.segments), goalHit: { segment:3,time:1,position:[7,2,0.5] } };
  const resource = { ...locomotion, stamina: { capacity:3,initial:3,sprintDrain:1,recoveryRate:1,recoveryDelay:0.5,reserve:0 } };
  const planner = createGroundPlanner([floor('road',0,8)], { ...options, locomotion: resource });
  const result = pruneGroundDetours(withEvent, planner, resource);
  assert.ok(result.replacements > 0);
  assert.equal(result.route.segments[result.route.goalHit.segment].mode, 'jump');
  assert.deepEqual(result.route.goalHit.position, [7,2,0.5]);
  assert.ok(result.route.locomotion.final >= 0);
});

test('a closed excursion may simplify to a stationary route', () => {
  const origin = [1,0,1];
  const original = routeOf([
    segment('walk', [origin,[2,0,1]], 1),
    segment('launch', [[2,0,1],[2,4,1],[3,0,1]], 3),
    segment('walk', [[3,0,1],origin], 2),
  ]);
  const result = pruneGroundDetours(original, createGroundPlanner([floor('road',0,8)], options), locomotion);
  assert.equal(result.replacements, 1);
  assert.deepEqual(result.route.points, [origin]);
  assert.equal(result.route.cost, 0);
});

test('unreachable cross-floor comparisons cannot hide a useful replacement under a small budget', () => {
  const upper = floor('upper',0,200); upper.vertices = upper.vertices.map(([x,y,z]) => [x,y+5,z]);
  const original = routeOf([
    segment('walk', [[0.5,0,0.5],[1,0,0.5]], 0.5),
    segment('launch', [[1,0,0.5],[1,5,0.5]], 5),
    segment('walk', [[1,5,0.5],[2,5,0.5]], 1),
    segment('drop', [[2,5,0.5],[5,0,0.5]], 5),
    segment('walk', [[5,0,0.5],[6,0,0.5]], 1),
    segment('launch', [[6,0,0.5],[7,5,0.5]], 5),
    segment('walk', [[7,5,0.5],[190,5,0.5]], 183),
  ]);
  const result = pruneGroundDetours(original, createGroundPlanner([floor('road',0,200),upper], options), locomotion, {maxQueries:1});
  assert.equal(result.queries, 1);
  assert.equal(result.replacements, 1);
  assert.ok(result.route.segments.filter(s => s.mode !== 'walk').length < 3);
  assert.deepEqual(result.route.points.at(-1), original.points.at(-1));
});

test('pure walking seams remove a flat-ground loop and an unnecessary sharp entry into a straight run', () => {
  const original = routeOf([
    segment('walk', [[0.5,0,0.5],[8,0,1]], 4),
    segment('walk', [[8,0,1],[7,0,2],[19,0,2]], 7),
  ]);
  const result = pruneGroundDetours(original, createGroundPlanner([floor('road',0,20)], options), locomotion);
  assert.ok(result.replacements > 0);
  assert.equal(result.queries, 0, 'an all-ground run needs support tracing, not action comparisons');
  assert.ok(result.route.cost < retimeGroundRoute(original, locomotion).cost);
  const start = original.points[0], end = original.points.at(-1);
  assert.deepEqual(result.route.points[0], start);
  assert.deepEqual(result.route.points.at(-1), end);
  assert.ok(Math.abs(result.route.length - Math.hypot(...end.map((value,axis) => value-start[axis]))) < 1e-7);
});

test('an action may reconnect inside a long walking polyline under partial local coverage', () => {
  // The original suffix was verified by its own window. Only its nearby return
  // is inside this planner; the landing and final endpoint are outside it.
  const original = routeOf([
    segment('walk', [[0.5,0,0.5],[1,0,0.5]], 0.5),
    segment('launch', [[1,0,0.5],[10,5,0.5],[20,0,0.5]], 20),
    segment('walk', [[20,0,0.5],[2,0,0.5],[20,0,1.5]], 18),
  ]);
  const result = pruneGroundDetours(original, createGroundPlanner([floor('local',0,8)], options), locomotion, {maxQueries:8});
  assert.ok(result.replacements > 0);
  assert.ok(result.queries > 0 && result.queries <= 8);
  assert.ok(result.route.segments.every(part => part.mode === 'walk'));
  assert.deepEqual(result.route.points[0], original.points[0]);
  assert.deepEqual(result.route.points.at(-1), original.points.at(-1));
  assert.ok(result.route.cost < retimeGroundRoute(original, locomotion).cost);
});

test('pure walking straightening retains a necessary wall detour', () => {
  const original = routeOf([
    segment('walk', [[0.5,0,0.5],[0.5,0,3.5],[7.5,0,3.5],[7.5,0,0.5]], 10),
  ]);
  const walls = [{min:[3,-1,0],max:[5,4,3],state:'unknown'}];
  const planner = createGroundPlanner([floor('road',0,8)], {...options,walls});
  const result = pruneGroundDetours(original, planner, locomotion);
  assert.ok(result.route.length > 7);
  for (let i = 1; i < result.route.points.length; i++) {
    assert.equal(blockedByWalls(result.route.points[i-1],result.route.points[i],walls,options.profile), false);
  }
});
