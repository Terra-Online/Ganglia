import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retimeGroundRoute } from '../src/resource/locomotion.mjs';
import { sampleJourney } from '../src/motion/motion.mjs';

const options = { speed: 5, sprintSpeed: 7, sprintAcceleration: 2 };
const stamina = { capacity: 10, initial: 10, sprintDrain: 2, recoveryRate: 1, recoveryDelay: 2, reserve: 2 };
const walk = points => ({ mode: 'walk', points, times: points.map((_, index) => index) });
const route = segments => ({
  status: 'complete', start: 'player', arrivalCost: 3, cost: 999, length: 999,
  points: segments.length ? segments.flatMap(segment => segment.points) : [[0, 0, 0]], segments,
});
const line = length => route([walk([[0, 0, 0], [length, 0, 0]])]);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('sprint timing integrates acceleration and supplies matching playback samples', () => {
  const result = retimeGroundRoute(line(13), options);
  // The first second covers 6 metres, followed by 7 metres at sprint speed.
  near(result.cost, 5);
  near(result.length, 13);
  assert.equal(result.segments[0].gait, 'sprint');
  near(sampleJourney(result, .5).position[0], 2.75);
  near(sampleJourney(result, 1.5).position[0], 9.5);
  assert.deepEqual(result.points.at(-1), [13, 0, 0]);
  const short = retimeGroundRoute(line(2.75), options);
  near(short.cost - short.arrivalCost, .5);
});

test('stamina exhaustion preserves reserve and runs through the recovery delay', () => {
  const result = retimeGroundRoute(line(60), { ...options, stamina: { ...stamina, recoveryRate: 0 } });
  const sprint = result.segments.find(segment => segment.gait === 'sprint');
  const run = result.segments.find(segment => segment.gait === 'run');
  near(sprint.times.at(-1), 4);
  near(sprint.points.at(-1)[0], 27);
  near(run.times.at(-1), 33 / 5);
  near(result.cost, 3 + 4 + 33 / 5);
  assert.deepEqual(result.locomotion, { initial: 10, final: 2, minimum: 2 });
});

test('a long route resumes sprinting only after delay plus one second of recovered budget', () => {
  const result = retimeGroundRoute(line(100), { ...options, stamina });
  assert.deepEqual(result.segments.slice(0, 3).map(segment => segment.gait), ['sprint', 'run', 'sprint']);
  near(result.segments[1].times.at(-1), 4);
  near(result.segments[1].points.at(-1)[0], 47);
  near(result.segments[2].times.at(-1), 1);
  assert.ok(result.locomotion.minimum >= stamina.reserve);
  assert.ok(result.locomotion.final <= stamina.capacity);
  assert.ok(result.segments.every(segment => segment.times.every((time, index) => index === 0 || time > segment.times[index - 1])));
});

test('zero drain supports sprinting with no resource expenditure', () => {
  const result = retimeGroundRoute(line(1000), { ...options, stamina: { ...stamina, initial: 0, sprintDrain: 0 } });
  assert.ok(result.segments.every(segment => segment.gait === 'sprint'));
  assert.deepEqual(result.locomotion, { initial: 0, final: 0, minimum: 0 });
  near(result.cost, 3 + 1 + (1000 - 6) / 7);
});

test('energy and velocity persist across straight ground segments and reset at a corner', () => {
  const straight = retimeGroundRoute(route([walk([[0, 0, 0], [6, 0, 0]]), walk([[6, 0, 0], [13, 0, 0]])]), { ...options, stamina });
  near(straight.cost, 5);
  near(straight.locomotion.final, 6);
  const corner = retimeGroundRoute(route([walk([[0, 0, 0], [6, 0, 0]]), walk([[6, 0, 0], [6, 0, 6]])]), options);
  near(corner.cost, 5);
});

test('authored jump samples and timing remain intact, and input data stays owned by its caller', () => {
  const jump = { mode: 'jump', connection: 'jump-a', points: [[6, 0, 0], [6, 4, 0], [6, -3, 0]], times: [0, .5, 2] };
  const input = route([walk([[0, 0, 0], [6, 0, 0]]), jump, walk([[6, -3, 0], [12, -3, 0]])]);
  const original = structuredClone(input);
  const result = retimeGroundRoute(input, { ...options, stamina });
  assert.deepEqual(result.segments[1], jump);
  near(result.cost, 7);
  near(result.locomotion.final, 6);
  assert.deepEqual(input, original);
  result.segments[1].points[1][1] = 99;
  result.segments[1].times[1] = 99;
  assert.deepEqual(input, original);
  assert.deepEqual(retimeGroundRoute({ status: 'unmapped' }, options), { status: 'unmapped' });
});

test('invalid profiles, out-of-range energy and discontinuous motion fail explicitly', () => {
  for (const change of [{ speed: 0 }, { sprintSpeed: 4 }, { sprintAcceleration: 0 }, { sprintSpeed: Infinity }]) {
    assert.throws(() => retimeGroundRoute(line(10), { ...options, ...change }), /speeds/);
  }
  for (const change of [{ capacity: 0 }, { initial: 11 }, { sprintDrain: -1 }, { recoveryDelay: -1 }, { reserve: 11 }]) {
    assert.throws(() => retimeGroundRoute(line(10), { ...options, stamina: { ...stamina, ...change } }), /stamina/);
  }
  assert.throws(() => retimeGroundRoute(route([walk([[0, 0, 0], [1, 0, 0]]), walk([[2, 0, 0], [3, 0, 0]])]), options), /Discontinuous/);
});

const activationProfile = {
  capacity: 10, initial: 10, activationCost: 3, recoveryRate: 1, recoveryDelay: 2, reserve: 0,
};

test('activation energy is charged once across straight segments and a ground corner', () => {
  const input = route([
    walk([[0, 0, 0], [6, 0, 0]]),
    walk([[6, 0, 0], [13, 0, 0]]),
    walk([[13, 0, 0], [13, 0, 6]]),
  ]);
  const result = retimeGroundRoute(input, { ...options, stamina: activationProfile });
  assert.ok(result.segments.every(segment => segment.gait === 'sprint'));
  assert.deepEqual(result.locomotion, { initial: 10, final: 7, minimum: 7 });
  near(result.cost - result.arrivalCost, 3);
});

test('a sprint activation waits for sufficient running recovery and pays its reserve', () => {
  const result = retimeGroundRoute(line(30), {
    ...options, stamina: { ...activationProfile, initial: 0, reserve: 1 },
  });
  assert.equal(result.segments[0].gait, 'run');
  near(result.segments[0].times.at(-1), 4);
  near(result.segments[0].points.at(-1)[0], 20);
  assert.equal(result.segments[1].gait, 'sprint');
  near(result.locomotion.final, 1);
  near(result.locomotion.minimum, 0);
});

test('recovery can continue during a sustained sprint after the configured delay', () => {
  const result = retimeGroundRoute(line(27), {
    ...options, stamina: { ...activationProfile, recoveryDuringSprint: true },
  });
  near(result.cost - result.arrivalCost, 4);
  near(result.locomotion.minimum, 7);
  near(result.locomotion.final, 9);
  assert.ok(result.segments.every(segment => segment.gait === 'sprint'));
});

test('a jump ends the sustained sprint and the next ground segment pays another activation', () => {
  const jump = { mode: 'jump', points: [[6, 0, 0], [6, 5, 0], [6, -3, 0]], times: [0, .5, 2] };
  const input = route([walk([[0, 0, 0], [6, 0, 0]]), jump, walk([[6, -3, 0], [12, -3, 0]])]);
  const result = retimeGroundRoute(input, { ...options, stamina: activationProfile });
  assert.deepEqual(result.segments[1], jump);
  assert.deepEqual(result.locomotion, { initial: 10, final: 4, minimum: 4 });
  near(result.cost - result.arrivalCost, 4);
});

test('non-ground recovery advances elapsed delay only when enabled', () => {
  const jump = { mode: 'jump', points: [[6, 0, 0], [6, -3, 0]], times: [0, 4] };
  const input = route([walk([[0, 0, 0], [6, 0, 0]]), jump, walk([[6, -3, 0], [12, -3, 0]])]);
  const result = retimeGroundRoute(input, {
    ...options, stamina: { ...activationProfile, recoveryDuringNonWalk: true },
  });
  // First activation leaves 7. Ground sprint advances one second of delay,
  // then the jump advances the remaining second and recovers three units.
  // The next activation costs another 3, leaving 7.
  assert.deepEqual(result.locomotion, { initial: 10, final: 7, minimum: 7 });
  assert.deepEqual(result.segments[1], jump);
});

test('insufficient capacity never grants a sprint activation', () => {
  const result = retimeGroundRoute(line(100), {
    ...options, stamina: { ...activationProfile, capacity: 2, initial: 0 },
  });
  assert.ok(result.segments.every(segment => segment.gait === 'run'));
  near(result.cost - result.arrivalCost, 20);
  assert.deepEqual(result.locomotion, { initial: 0, final: 2, minimum: 0 });
  for (const change of [{ activationCost: -1 }, { recoveryDuringSprint: 1 }, { recoveryDuringNonWalk: null }]) {
    assert.throws(() => retimeGroundRoute(line(10), { ...options, stamina: { ...activationProfile, ...change } }), /stamina/);
  }
});

test('allocation saves the only activation for a long ground run after a short approach and jump', () => {
  const jump = { mode: 'jump', points: [[.5, 0, 0], [.5, -3, 0]], times: [0, 1] };
  const input = route([walk([[0, 0, 0], [.5, 0, 0]]), jump, walk([[.5, -3, 0], [100.5, -3, 0]])]);
  const result = retimeGroundRoute(input, {
    ...options, stamina: { capacity: 1, initial: 1, activationCost: 1, recoveryRate: 0, recoveryDelay: 0, reserve: 0 },
  });
  assert.equal(result.segments[0].gait, 'run');
  assert.deepEqual(result.segments[1], jump);
  assert.equal(result.segments[2].gait, 'sprint');
  near(result.cost - result.arrivalCost, .1 + 1 + 1 + 94 / 7);
  assert.deepEqual(result.locomotion, { initial: 1, final: 0, minimum: 0 });
});

test('explicit sprint-through preserves the activation across a drop while keeping its trajectory', () => {
  const drop = { mode: 'drop', points: [[6, 0, 0], [6, -1, 0], [6, -3, 0]], times: [0, .4, 1] };
  const input = route([walk([[0, 0, 0], [6, 0, 0]]), drop, walk([[6, -3, 0], [12, -3, 0]])]);
  const profile = { ...options, stamina: { capacity: 1, initial: 1, activationCost: 1, recoveryRate: 0, recoveryDelay: 0, reserve: 0 } };
  const through = retimeGroundRoute(input, { ...profile, sprintThrough: ['drop'] });
  assert.deepEqual(through.segments[1], drop);
  assert.deepEqual(through.segments.filter(segment => segment.mode === 'walk').map(segment => segment.gait), ['sprint', 'sprint']);
  near(through.cost - through.arrivalCost, 3);
  near(through.locomotion.final, 0);
  const interrupted = retimeGroundRoute(input, profile);
  assert.ok(interrupted.cost > through.cost);
  assert.throws(() => retimeGroundRoute(input, { ...profile, sprintThrough: ['walk'] }), /sprint-through/);
});

test('run allocation keeps continuous faces in one decision block', () => {
  const first = walk([[0, 0, 0], [3, 0, 0]]);
  const second = walk([[3, 0, 0], [6, 0, 0]]);
  const result = retimeGroundRoute(route([first, second]), {
    ...options, stamina: { capacity: 1, initial: 1, activationCost: 1, recoveryRate: 0, recoveryDelay: 0, reserve: 0 },
  });
  near(result.cost - result.arrivalCost, 1);
  near(result.locomotion.final, 0);
  assert.ok(result.segments.every(segment => segment.gait === 'sprint'));
});

test('sprint-required air motion cannot borrow activation energy from a later ground run', () => {
  const jump = { mode: 'jump', requiredGait: 'sprint', points: [[.5, 0, 0], [7, 0, 0]], times: [0, 1] };
  const input = route([walk([[0, 0, 0], [.5, 0, 0]]), jump, walk([[7, 0, 0], [107, 0, 0]])]);
  const policy = { ...options, stamina: {
    capacity: 1, initial: 1, activationCost: 1, recoveryRate: 0, recoveryDelay: 0, reserve: 0,
  } };
  for (const change of [{ initial: 0 }, { capacity: .5, initial: .5 }]) {
    assert.deepEqual(retimeGroundRoute(input, { ...policy, stamina: { ...policy.stamina, ...change } }),
      { status: 'no-verified-route' });
  }
  const original = structuredClone(input), result = retimeGroundRoute(input, policy);
  assert.equal(result.status, 'complete');
  assert.equal(result.segments[0].gait, 'sprint');
  assert.deepEqual(result.segments[1], jump);
  assert.ok(result.segments.slice(2).every(segment => segment.gait === 'run'));
  assert.deepEqual(result.locomotion, { initial: 1, final: 0, minimum: 0 });
  assert.deepEqual(input, original);
  assert.deepEqual(retimeGroundRoute(route([jump]), policy), { status: 'no-verified-route' });
});

test('consecutive sprint-required jumps need held gait or enough natural recovery for another activation', () => {
  const first = { mode: 'jump', requiredGait: 'sprint', points: [[.5, 0, 0], [7, 0, 0]], times: [0, .2] };
  const second = { ...first, points: [[7.5, 0, 0], [14, 0, 0]] };
  const input = route([walk([[0, 0, 0], [.5, 0, 0]]), first, walk([[7, 0, 0], [7.5, 0, 0]]), second]);
  const policy = { ...options, stamina: {
    capacity: 1, initial: 1, activationCost: 1, recoveryRate: 1, recoveryDelay: .9,
    recoveryDuringNonWalk: true, reserve: 0,
  } };
  assert.deepEqual(retimeGroundRoute(input, policy), { status: 'no-verified-route' });
  const held = retimeGroundRoute(input, { ...policy, sprintThrough: ['jump'] });
  assert.equal(held.status, 'complete');
  assert.equal(held.segments.filter(segment => segment.requiredGait === 'sprint').length, 2);
  near(held.locomotion.final, 0);
  const recovered = structuredClone(input);
  recovered.segments[1].times = [0, 2];
  const result = retimeGroundRoute(recovered, policy);
  assert.equal(result.status, 'complete');
  assert.equal(result.segments.filter(segment => segment.requiredGait === 'sprint').length, 2);
  assert.equal(result.locomotion.minimum, 0);
});

const dashPolicy = { ...options, dash: { speed: 10, duration: .3, cooldown: .8, cost: 1 },
  stamina: { capacity: 8, initial: 8, activationCost: 1, recoveryRate: 1 / 1.7,
    recoveryDelay: .9, reserve: 0, recoveryDuringSprint: true, recoveryDuringNonWalk: true } };

test('dash allocation repeats pulses and beats sustained sprint with the same resource pool', () => {
  const input = line(80);
  const baseline = retimeGroundRoute(input, { ...dashPolicy, dash: undefined });
  const result = retimeGroundRoute(input, dashPolicy);
  assert.ok(result.cost < baseline.cost);
  assert.ok(result.locomotion.dashes > 1);
  assert.ok(result.locomotion.final < baseline.locomotion.final);
  assert.ok(result.locomotion.minimum >= 0);
  assert.ok(result.segments.some(segment => segment.gait === 'dash'));
  assert.ok(result.segments.some(segment => segment.gait === 'sprint'));
  assert.deepEqual(result.points.at(-1), input.points.at(-1));
});

test('dash pulses cross tessellation seams without resetting cooldown or charging again', () => {
  const input = line(20);
  const split = route(Array.from({length: 40}, (_, index) => walk([[index / 2,0,0],[(index+1)/2,0,0]])));
  const whole = retimeGroundRoute(input, dashPolicy);
  const tiled = retimeGroundRoute(split, dashPolicy);
  near(whole.cost, tiled.cost);
  near(whole.locomotion.final, tiled.locomotion.final);
  assert.equal(whole.locomotion.dashes, tiled.locomotion.dashes);
});

test('dash cooldown and energy continue over a jump without changing its motion', () => {
  const jump = {mode:'jump',points:[[3,0,0],[3,0,1]],times:[0,.1]};
  const result = retimeGroundRoute(route([walk([[0,0,0],[3,0,0]]),jump,walk([[3,0,1],[6,0,1]])]),
    {...dashPolicy, stamina: {...dashPolicy.stamina, recoveryRate:0,initial:1}});
  assert.equal(result.locomotion.dashes,1);
  assert.deepEqual(result.segments.find(segment => segment.mode === 'jump'),jump);
  near(result.locomotion.final,0);
  assert.throws(() => retimeGroundRoute(line(10), {...dashPolicy,dash:{...dashPolicy.dash,cooldown:.1}}),/dash policy/);
});

test('interior allocation saves a charge past a short approach and sharp turn', () => {
  const input = route([walk([[0,0,0],[.1,0,0],[.1,0,30]])]);
  const result = retimeGroundRoute(input, {...dashPolicy,
    stamina:{...dashPolicy.stamina,initial:1,capacity:1,recoveryRate:0,activationCost:0}});
  assert.equal(result.locomotion.dashes,1);
  const pulse = result.segments.find(segment => segment.gait === 'dash');
  assert.ok(pulse.points[0][2] > 0);
  assert.ok(pulse.points.at(-1)[2] - pulse.points[0][2] > 2.9);
  near(result.locomotion.final,0);
  assert.deepEqual(result.locomotion.dash,dashPolicy.dash);
});

test('retiming keeps terminal airborne goal evidence attached to its shifted segment', () => {
  const jump = {mode:'jump',points:[[20,0,0],[24,2,0]],times:[0,.7]};
  const input = route([walk([[0,0,0],[20,0,0]]),jump]);
  input.goalHit = {segment:1,time:.7,position:[24,2,0]};
  const original = structuredClone(input);
  const result = retimeGroundRoute(input,dashPolicy);
  assert.ok(result.goalHit.segment > input.goalHit.segment);
  assert.deepEqual(result.segments[result.goalHit.segment],jump);
  assert.equal(result.goalHit.segment,result.segments.length - 1);
  assert.equal(result.goalHit.time,.7);
  assert.deepEqual(result.goalHit.position,[24,2,0]);
  assert.deepEqual(input,original);
});
