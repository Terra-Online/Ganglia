import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJumpEnvelope } from '../src/reachability.mjs';
import { jumpDuration, jumpTravel } from '../src/jumps.mjs';
import { createBoundsIndex } from '../src/bounds.mjs';

const model = { gravity: 10, fallingGravity: 10, maxJumpHeight: 2,
  maxFallingSpeed: 10, apexTime: 0.2, maxHorizontalSpeed: 3 };
const options = { model, maxDrop: 80, maxHorizontalDistance: 100, endpointTolerance: 0.25 };
const pointBox = point => ({ min: point, max: point });

test('directed envelopes retain terminal falls, launch impulses, boosts and boundary witnesses', () => {
  const forward = createJumpEnvelope([0, 0, 0], options);
  assert.equal(forward(pointBox([20, 0, 0])), false);
  assert.equal(forward(pointBox([20, -69, 0])), true);
  assert.equal(forward(pointBox([0, 3, 0])), false);
  assert.equal(createJumpEnvelope([20, -69, 0], { ...options, reverse: true })(pointBox([0, 0, 0])), true);
  assert.equal(createJumpEnvelope([0, 0, 0], { ...options, reverse: true })(pointBox([0, -69, 0])), false);
  assert.equal(createJumpEnvelope([0, 0, 0], { ...options,
    model: { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 1 } })(pointBox([10, 0, 0])), true);
  assert.equal(createJumpEnvelope([0, 0, 0], { ...options,
    model: { ...model, maxHorizontalSpeed: 9.9 } })(pointBox([10, 0, 0])), true);
  const padded = createJumpEnvelope([0, 0, 0], { ...options, padding: [0.5, 1, 0.5] });
  assert.equal(padded(pointBox([0, 3, 0])), true);
  assert.equal(forward({ min: [-100, -70, -100], max: [100, 10, 100] }), true);
});

test('forward and inverse node tests enclose all witnesses admitted by the existing optimistic prefilter', () => {
  for (const maxJumpHeight of [0, 2]) for (const impulse of [false, true]) {
    const movement = { ...model, maxJumpHeight,
      ...(impulse ? { startHorizontalSpeed: 9, airOverspeedDeceleration: 5, expireAfter: 0.3, expiredHorizontalSpeed: 1 } : {}) };
    const settings = { ...options, model: movement };
    for (const base of [[0, 0, 0], [1e7, 1e7, -1e7]]) {
      const forward = createJumpEnvelope(base, settings);
      for (const height of [-80.5, -69, -3, 0, 1, maxJumpHeight + 0.5]) {
        const duration = jumpDuration(base[1] + .25, base[1] + height - .25,
          { ...movement, mode: maxJumpHeight > 0 ? 'jump' : 'drop' });
        if (duration === null) continue;
        const reach = Math.min(options.maxHorizontalDistance, duration * movement.maxHorizontalSpeed);
        for (const fraction of [0, .3, 1]) {
          const landing = [base[0] + reach * fraction, base[1] + height, base[2]];
          assert.equal(forward(pointBox(landing)), true);
          assert.equal(createJumpEnvelope(landing, { ...settings, reverse: true })(pointBox(base)), true);
          const bounds = { min: [landing[0] - 2, landing[1] - 3, landing[2] - 4],
            max: [landing[0] + 2, landing[1] + 3, landing[2] + 4] };
          assert.equal(forward(bounds), true);
        }
        if (impulse) {
          const span = Math.min(options.maxHorizontalDistance, jumpTravel(9, duration, movement));
          assert.equal(forward(pointBox([base[0] + span, base[1] + height, base[2]])), true);
        }
      }
    }
  }
});

test('BVH node pruning retains eligible leaves for both range and ordered queries', () => {
  const anchor = [0, 0, 0];
  const entries = Array.from({ length: 257 }, (_, id) => ({ id,
    min: [id * .5, id % 3 ? 0 : -30, 0], max: [id * .5 + .1, id % 3 ? .1 : -29.9, .1] }));
  const index = createBoundsIndex(entries), envelope = createJumpEnvelope(anchor, options);
  const bounds = { min: [-200, -100, -200], max: [200, 100, 200] };
  const expected = entries.filter(envelope).map(entry => entry.id).sort((a, b) => a - b);
  assert.deepEqual([...index(bounds, undefined, undefined, envelope)].map(entry => entry.id).sort((a, b) => a - b), expected);
  assert.deepEqual([...index.nearest(bounds, anchor, envelope)].map(entry => entry.id).sort((a, b) => a - b), expected);
  let visited = 0;
  assert.deepEqual([...index.nearest(bounds, anchor, () => { visited++; return false; })], []);
  assert.equal(visited, 1);
});

test('rounded shared flight tables enclose analytic limits and track model changes without changing existing envelopes', () => {
  const movement = { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 5 };
  const settings = { ...options, model: movement };
  const anchor = [0, 0, 0], forward = createJumpEnvelope(anchor, settings);
  for (let index = 0; index < 180; index++) {
    const drop = -model.maxJumpHeight + index * .13;
    const duration = jumpDuration(.25, -drop - .25, { ...movement, mode: 'jump' });
    if (duration === null) continue;
    const span = Math.min(options.maxHorizontalDistance, jumpTravel(9, duration, movement));
    const landing = [span, -drop, 0];
    assert.equal(forward(pointBox(landing)), true);
    assert.equal(createJumpEnvelope(landing, { ...settings, reverse: true })(pointBox(anchor)), true);
  }
  const near = pointBox([5, 0, 0]);
  assert.equal(forward(near), true);
  movement.maxHorizontalSpeed = .1;
  movement.startHorizontalSpeed = .1;
  assert.equal(createJumpEnvelope(anchor, settings)(near), false);
  assert.equal(forward(near), true);
});
