import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoalProjector, projectGoal } from '../src/goals.mjs';

const ground = (id, x0, x1, z0 = 0, z1 = 2, y = 0) => ({
  id, vertices: [[x0,y,z0], [x1,y,z0], [x1,y,z1], [x0,y,z1]],
});
const closePoint = (actual, expected) => actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-9));

test('preserves strict foot projection and requires an explicit interaction range', () => {
  const surfaces = [ground('floor', 0, 2)];
  assert.deepEqual(projectGoal(surfaces, [1,.1,1], {maxVertical:.5}),
    [{surface:'floor',position:[1,0,1],distance:.1}]);
  assert.deepEqual(projectGoal(surfaces, [1,1,1], {maxVertical:.5}), []);
  assert.throws(() => projectGoal(surfaces, [1,1,1], {interaction:{}}), /Invalid interaction goal range/);
});

test('allows interaction with an elevated item from nearby supported ground', () => {
  const surface = ground('lower', 1, 3);
  const target = [0,1,1];
  assert.deepEqual(projectGoal([surface], target, {maxVertical:.5}), []);
  const result = projectGoal([surface], target, {maxVertical:.5,interaction:{radius:1.5}});
  assert.equal(result.length, 1);
  closePoint(result[0].position, [1,0,1]);
  assert.ok(Math.abs(result[0].distance - Math.sqrt(2)) < 1e-9);
  assert.deepEqual(projectGoal([surface], target, {interaction:{radius:1.1}}), []);
});

test('never fills a hole or silently projects onto a distant stacked floor', () => {
  const surfaces = [ground('left', -3, -1), ground('right', 1, 3), ground('upper', -3, 3, 0, 2, 5)];
  const project = createGoalProjector(surfaces);
  assert.deepEqual(project([0,0,1], {maxVertical:.5}), []);
  assert.deepEqual(project([0,0,1], {interaction:{radius:.5}}), []);
  const near = project([0,0,1], {interaction:{radius:1.1}});
  assert.deepEqual(near.map(candidate => candidate.surface), ['left','right']);
  assert.ok(near.every(candidate => candidate.position[1] === 0 && candidate.distance === 1));
});

test('uses a strict 3D sphere and retains every eligible surface in distance order', () => {
  const surfaces = [ground('near', 0, 2), ground('upper', 0, 2, 0, 2, 2), ground('far', 0, 2, 0, 2, -2)];
  const candidates = projectGoal(surfaces, [1,.9,1], {interaction:{radius:1.2}});
  assert.deepEqual(candidates.map(candidate => candidate.surface), ['near','upper']);
  assert.deepEqual(projectGoal([ground('floor', 0, 2)], [1,1,1], {interaction:{radius:1}}),
    [{surface:'floor',position:[1,0,1],distance:1}]);
  assert.deepEqual(projectGoal([ground('floor', 0, 2)], [1,1,1], {interaction:{radius:.999}}), []);
});

test('clips a sloping standing surface to an independent vertical interaction limit', () => {
  const slope = {id:'slope',vertices:[[0,0,0],[3,3,0],[3,3,1],[0,0,1]]};
  const project = createGoalProjector([slope]);
  const unlimited = project([2,0,.5], {interaction:{radius:2}});
  closePoint(unlimited[0].position, [1,1,.5]);
  const limited = project([2,0,.5], {interaction:{radius:2,maxVertical:.5}});
  closePoint(limited[0].position, [.5,.5,.5]);
  const exactHeight = project([2,0,.5], {interaction:{radius:2,maxVertical:0}});
  closePoint(exactHeight[0].position, [0,0,.5]);
});

test('indexes a snapshot and serves independent repeated queries without mutation', () => {
  const surface = ground('floor', 0, 2), source = [1,.2,1];
  const project = createGoalProjector([surface]);
  surface.vertices.forEach(point => { point[1] = 100; });
  const first = project(source, {maxVertical:.5});
  assert.equal(first[0].position[1], 0);
  first[0].position[1] = 50;
  assert.equal(project(source, {maxVertical:.5})[0].position[1], 0);
  assert.deepEqual(source, [1,.2,1]);
});

test('rejects malformed inputs and ignores surfaces without standing area', () => {
  assert.throws(() => createGoalProjector([{id:'bad',vertices:[[0,0,0],[1,NaN,0],[0,0,1]]}]), /Invalid goal surface/);
  assert.throws(() => projectGoal([], [0,0,0], {maxVertical:-1}), /Invalid goal projection height/);
  assert.throws(() => projectGoal([], [0,0,0], {interaction:{radius:-1}}), /Invalid interaction goal range/);
  assert.throws(() => projectGoal([], [0,0,0], {interaction:{radius:1,maxVertical:NaN}}), /Invalid interaction goal range/);
  const vertical = {id:'wall',vertices:[[0,0,0],[0,1,0],[0,1,1]]};
  assert.deepEqual(projectGoal([vertical], [0,.5,.5], {interaction:{radius:1}}), []);
});

test('clips a shared front/back surface before selecting an interaction standing point', () => {
  const slope = {id:'slope',vertices:[[-1,.5,-1],[1,.5,-1],[1,2.5,1],[-1,2.5,1]]};
  const target = [0,0,0], project = createGoalProjector([slope]);
  const unrestricted = project(target, {interaction:{radius:2}});
  assert.ok(unrestricted[0].position[2] < 0);
  const front = project(target, {interaction:{radius:2,facing:[0,0,3],halfAngle:45}});
  assert.equal(front.length, 1);
  closePoint(front[0].position, [0,1.5,0]);
  const behind = ground('behind', -1, 1, -2, -.5);
  assert.deepEqual(projectGoal([behind], [0,1,0], {interaction:{radius:3,facing:[0,0,1],halfAngle:90}}), []);
});

test('uses an explicit horizontal cone angle and rejects incomplete facing rules', () => {
  const side = ground('side', 1, 2, .2, .5);
  assert.deepEqual(projectGoal([side], [0,0,0], {interaction:{radius:3,facing:[0,0,1],halfAngle:30}}), []);
  assert.equal(projectGoal([side], [0,0,0], {interaction:{radius:3,facing:[0,0,1],halfAngle:90}}).length, 1);
  for (const interaction of [{radius:1,facing:[0,0,1]}, {radius:1,halfAngle:45},
    {radius:1,facing:[0,1,0],halfAngle:45}, {radius:1,facing:[0,0,1],halfAngle:0}]) {
    assert.throws(() => projectGoal([], [0,0,0], {interaction}), /Invalid interaction facing cone/);
  }
});
