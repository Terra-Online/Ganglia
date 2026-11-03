import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jumpConnection, jumpDuration, runOffConnection } from '../src/jumps.mjs';
import { createCollisionWorld } from '../src/collision.mjs';

const profile = { radius: 0.35, height: 1.66 };
const options = {
  profile,
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 10,
  apexTime: 0.2,
  maxHorizontalSpeed: 7,
  mode: 'jump',
  sweep: () => null,
  walls: [],
};
const world = (triangles) =>
  createCollisionWorld({
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  });
const plane = (axis, position, min = -100, max = 100) => {
  const point = (a, b) => (axis === 0 ? [position, a, b] : [a, position, b]);
  return [
    [point(min, min), point(max, min), point(max, max)],
    [point(min, min), point(max, max), point(min, max)],
  ];
};

test('source height and horizontal speed bounds keep jump feasibility directed', () => {
  assert.equal(jumpConnection([0, 0, 0], [1, 2.01, 0], options), null);
  assert.equal(jumpConnection([0, 0, 0], [1, 1, 0], { ...options, mode: 'drop' }), null);
  assert.equal(jumpConnection([0, 0, 0], [100, 0, 0], options), null);
  const drop = jumpConnection([100, 69, 200], [105, 0, 201], { ...options, mode: 'drop' });
  assert.equal(drop.mode, 'drop');
  assert.equal(drop.motionValidation, 'model-based');
  assert.equal(drop.state, undefined);
  assert.deepEqual(drop.points[0], [100, 69, 200]);
  assert.deepEqual(drop.points.at(-1), [105, 0, 201]);
  assert.equal(jumpConnection([105, 0, 201], [100, 69, 200], options), null);
});

test('descent reaches terminal speed analytically and preserves phase boundaries', () => {
  const drop = jumpConnection([0, 69, 0], [0, 0, 0], { ...options, mode: 'drop' });
  assert.ok(Math.abs(drop.times.at(-1) - 7.4) < 1e-12);
  const terminal = drop.times.findIndex((time) => time === 1);
  assert.ok(terminal > 0);
  assert.equal(drop.points[terminal][1], 64);
  for (let i = 1; i < drop.times.length; i++) {
    const dt = drop.times[i] - drop.times[i - 1];
    assert.ok(dt > 0 && dt <= 0.025 + 1e-12);
    assert.ok((drop.points[i - 1][1] - drop.points[i][1]) / dt <= 10 + 1e-10);
  }
  const short = jumpConnection([0, 1, 0], [0, 0, 0], { ...options, mode: 'drop' });
  assert.ok(Math.abs(short.times.at(-1) - Math.sqrt(0.2)) < 1e-12);
  const jump = jumpConnection([0, 0, 0], [1, 0, 0], options);
  const apexStart = Math.sqrt(40) / 10;
  assert.ok(jump.times.some((time) => Math.abs(time - apexStart) < 1e-12));
  assert.ok(jump.times.some((time) => Math.abs(time - apexStart - 0.2) < 1e-12));
  assert.ok(jump.points.some((point) => Math.abs(point[1] - 2) < 1e-12));
});

test('continuous capsule sweeps catch a thin obstacle between clear sample endpoints', () => {
  const collision = world(plane(0, 0.03));
  const body = { radius: 0.001, height: 0.01 };
  const start = [0, 1, 0],
    end = [5, 1, 0];
  assert.equal(collision.sweepCapsule(start, start, body), null);
  assert.equal(collision.sweepCapsule(end, end, body), null);
  assert.equal(
    jumpConnection(start, end, { ...options, profile: body, sweep: collision.sweepCapsule }),
    null,
  );
});

test('curved intervals inflate the full body and include sphere, headroom and floor contacts', () => {
  const seen = [];
  assert.ok(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      sweep: (a, b, capsule) => {
        seen.push({ a, b, capsule });
        return null;
      },
    }),
  );
  assert.ok(seen.some(({ capsule }) => capsule.inflation > 0));
  assert.ok(
    seen.every(({ capsule }) => capsule.radius === profile.radius && capsule.height === profile.height),
  );
  const ceiling = world(plane(1, 1.7));
  assert.equal(jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, sweep: ceiling.sweepCapsule }), null);
  const floor = world(plane(1, 0));
  assert.equal(jumpConnection([0, 0, 0], [1, 0, 0], { ...options, sweep: floor.sweepCapsule }), null);
  assert.equal(jumpConnection([0, 0.02, 0], [1, 0, 0], { ...options, sweep: floor.sweepCapsule }), null);
  assert.ok(jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, sweep: floor.sweepCapsule }));
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, clearance: 0.03, sweep: floor.sweepCapsule }),
    null,
  );
  const sphere = world([
    [
      [0.5, 2.3, 0],
      [0.5, 2.3, 0],
      [0.5, 2.3, 0],
    ],
  ]);
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      profile: { radius: 0.35, height: 0.7 },
      sweep: sphere.sweepCapsule,
    }),
    null,
  );
});

test('quadratic deviation inflation catches an arc contact missed by every sample and uninflated chord', () => {
  const body = { radius: 0.00001, height: 0.00002 };
  const start = [0, 1, 0],
    end = [5, 1, 0];
  const arc = jumpConnection(start, end, { ...options, profile: body });
  const time = arc.times[1] / 2;
  const point = [(5 * time) / arc.times.at(-1), 1 + Math.sqrt(40) * time - 5 * time * time + body.radius, 0];
  const collision = world([[point, point, point]]);
  assert.ok(arc.points.every((position) => collision.sweepCapsule(position, position, body) === null));
  assert.equal(collision.sweepCapsule(arc.points[0], arc.points[1], body), null);
  assert.equal(
    jumpConnection(start, end, { ...options, profile: body, sweep: collision.sweepCapsule }),
    null,
  );
});

test('active and unresolved air walls block each curved segment with body clearance', () => {
  const wall = { min: [0.4, -10, -0.2], max: [0.6, 10, 0.2], state: 'unknown' };
  for (const state of ['active', 'unknown']) {
    assert.equal(
      jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, walls: [{ ...wall, state }] }),
      null,
    );
  }
  assert.ok(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, walls: [{ ...wall, state: 'inactive' }] }),
  );
});

test('invalid parameters and unsupported sweep budgets cannot create candidates', () => {
  for (const changed of [
    { gravity: 0 },
    { fallingGravity: -1 },
    { maxFallingSpeed: 0 },
    { apexTime: -1 },
    { maxJumpHeight: -1 },
    { maxHorizontalSpeed: -1 },
    { clearance: -1 },
    { mode: 'launch' },
    { profile: { radius: 1, height: 1 } },
    { sweep: null },
    { walls: [{}] },
  ])
    assert.throws(() => jumpConnection([0, 0, 0], [1, 0, 0], { ...options, ...changed }));
  assert.throws(() => jumpConnection([0, NaN, 0], [1, 0, 0], options));
  assert.throws(() => jumpConnection([0, 1e8, 0], [0, 0, 0], { ...options, mode: 'drop' }), /sweep budget/);
});

test('analytic duration reuses the complete jump and terminal-fall phase model', () => {
  for (const [startHeight, endHeight, mode] of [
    [0, 0, 'jump'],
    [69, 0, 'drop'],
    [0, 1, 'jump'],
  ]) {
    const model = { ...options, mode };
    const connection = jumpConnection([0, startHeight, 0], [0, endHeight, 0], model);
    assert.equal(jumpDuration(startHeight, endHeight, model), connection.times.at(-1));
  }
  assert.equal(jumpDuration(0, 3, { ...options, mode: 'jump' }), null);
  assert.throws(() => jumpDuration(0, 0, { ...options, gravity: 0 }), /Invalid jump model/);
});

test('walk-off drops preserve support before free fall under low headroom', () => {
  const rectangle = (left, right, height) => [
    [[left, height, -3], [right, height, 3], [right, height, -3]],
    [[left, height, -3], [left, height, 3], [right, height, 3]],
  ];
  for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
    const transform = ([x, y, z]) => [
      -1024.8 + x * Math.cos(angle) - z * Math.sin(angle), y,
      512.4 + x * Math.sin(angle) + z * Math.cos(angle),
    ];
    const collision = world([
      ...rectangle(0, 4, 5), ...rectangle(4.5, 10, 0), ...rectangle(0, 4, 7),
    ].map(triangle => triangle.map(transform)));
    const model = { ...options, gravity: 40, fallingGravity: 38, maxJumpHeight: 2.1,
      maxFallingSpeed: 80, apexTime: 0.1, maxHorizontalSpeed: 6.5,
      sweep: collision.sweepCapsule, world: collision, maxSlope: 46 };
    const start = transform([3.5, 5.005, 0]), end = transform([6, 0.005, 0]);
    assert.equal(jumpConnection(start, end, { ...model, mode: 'jump' }), null);
    assert.equal(jumpConnection(start, end, { ...model, mode: 'drop' }), null);
    const connection = runOffConnection(start, end, model);
    assert.ok(connection);
    assert.deepEqual(connection.points[0], start);
    assert.deepEqual(connection.points.at(-1), end);
    assert.ok(connection.points.filter(point => point[1] === start[1]).length > 2);
    for (let index = 1; index < connection.points.length; index++) {
      assert.ok(connection.times[index] > connection.times[index - 1]);
      assert.equal(collision.sweepCapsule(connection.points[index - 1], connection.points[index], profile), null);
    }
    const barrier = transform([3.8, 5, 0]);
    assert.equal(runOffConnection(start, end, { ...model,
      walls: [{ min: barrier.map(value => value - 0.05), max: barrier.map(value => value + 0.05), state: 'unknown' }],
    }), null);
  }
});

test('bounded air control clears an opening before descending under an overhang', () => {
  const rectangle = (left, right, height) => [
    [[left, height, -3], [right, height, 3], [right, height, -3]],
    [[left, height, -3], [left, height, 3], [right, height, 3]],
  ];
  const collision = world([
    ...rectangle(-2, 0.5, 20), ...rectangle(1.7, 5, 20), ...rectangle(0.6, 6, 0),
  ]);
  const model = { ...options, gravity: 40, fallingGravity: 38, maxJumpHeight: 2.1,
    maxFallingSpeed: 80, apexTime: 0.1, maxHorizontalSpeed: 6.5,
    airAcceleration: 60, airDeceleration: 10, sweep: collision.sweepCapsule };
  const start = [0, 20.005, 0], end = [2.5, 0.005, 0];
  assert.equal(jumpConnection(start, end, model), null);
  const arc = jumpConnection(start, end, { ...model, horizontalSplit: 0.5 });
  assert.ok(arc);
  assert.ok(arc.peakHorizontalSpeed <= model.maxHorizontalSpeed);
  assert.ok(arc.points.slice(1).some((point, index) => point[0] === arc.points[index][0]));
  for (let index = 1; index < arc.points.length; index++) {
    const speed = Math.abs(arc.points[index][0] - arc.points[index - 1][0]) /
      (arc.times[index] - arc.times[index - 1]);
    assert.ok(speed <= model.maxHorizontalSpeed + 1e-9);
    assert.equal(collision.sweepCapsule(arc.points[index - 1], arc.points[index], profile), null);
  }
  assert.equal(jumpConnection(start, end, { ...model, horizontalSplit: 0.5, airDeceleration: 0.1 }), null);
  assert.throws(() => jumpConnection(start, end, { ...model, horizontalSplit: -1 }), /horizontal jump/);
});
