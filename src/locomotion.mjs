import { validateMotion } from './motion.mjs';

const epsilon = 1e-9;
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const interpolate = (a, b, fraction) => a.map((value, axis) => value + (b[axis] - value) * fraction);

function validateOptions(options) {
  const { speed, sprintSpeed, sprintAcceleration, stamina } = options;
  if (![speed, sprintSpeed, sprintAcceleration].every(value => Number.isFinite(value) && value > 0) ||
      sprintSpeed < speed) throw new Error('Invalid locomotion speeds');
  if (options.sprintThrough !== undefined && (!Array.isArray(options.sprintThrough) ||
      options.sprintThrough.some(mode => !['jump', 'drop', 'rope', 'launch'].includes(mode)))) {
    throw new Error('Invalid sprint-through modes');
  }
  if (stamina === undefined) return;
  if (!stamina || typeof stamina !== 'object') throw new Error('Invalid locomotion stamina');
  const { capacity, initial, sprintDrain = 0, activationCost = 0, recoveryRate, recoveryDelay, reserve,
    recoveryDuringSprint = false, recoveryDuringNonWalk = false } = stamina;
  if (![capacity, initial, sprintDrain, activationCost, recoveryRate, recoveryDelay, reserve].every(Number.isFinite) ||
      capacity <= 0 || initial < 0 || initial > capacity || sprintDrain < 0 || activationCost < 0 || recoveryRate < 0 ||
      typeof recoveryDuringSprint !== 'boolean' || typeof recoveryDuringNonWalk !== 'boolean' ||
      recoveryDelay < 0 || reserve < 0 || reserve > capacity) throw new Error('Invalid locomotion stamina');
}

function sprintTime(length, speed, cap, acceleration) {
  const accelerationTime = Math.max(0, (cap - speed) / acceleration);
  const accelerationDistance = (speed + cap) * accelerationTime / 2;
  if (length <= accelerationDistance) {
    // This form avoids cancellation for very short spans at nonzero speed.
    return 2 * length / (Math.sqrt(speed * speed + 2 * acceleration * length) + speed);
  }
  return accelerationTime + (length - accelerationDistance) / cap;
}

function sprintDistance(seconds, speed, cap, acceleration) {
  const accelerated = Math.min(seconds, Math.max(0, (cap - speed) / acceleration));
  return speed * accelerated + acceleration * accelerated * accelerated / 2 + cap * (seconds - accelerated);
}

function scheduleBlock(block, options, state, allowSprint) {
  const { speed, sprintSpeed, sprintAcceleration, stamina } = options;
  const drain = stamina?.sprintDrain ?? 0;
  const draining = drain > 0;
  const activationCost = stamina?.activationCost ?? 0;
  const recoveryRate = stamina?.recoveryRate ?? 0;
  const reserve = stamina?.reserve ?? 0;
  let { energy, minimum, delay, sprinting, hasActivated, velocity, previousDirection } = state;
  if (!allowSprint) {
    if (sprinting && draining) delay = stamina.recoveryDelay;
    sprinting = false;
    velocity = speed;
  }
  const segments = [];

  for (const segment of block) {
    if (segment.mode !== 'walk') {
      segments.push({ ...segment, points: segment.points.map(point => [...point]), times: [...segment.times] });
      if (stamina?.recoveryDuringNonWalk) {
        const duration = segment.times.at(-1);
        const recovering = Math.max(0, duration - delay);
        delay = Math.max(0, delay - duration);
        energy = Math.min(stamina.capacity, energy + recovering * recoveryRate);
      }
      sprinting = sprinting && (options.sprintThrough?.includes(segment.mode) ?? false);
      velocity = speed;
      previousDirection = null;
      continue;
    }
    let output = null;
    const append = (gait, point, elapsed, start) => {
      if (!output || output.gait !== gait) {
        output = { ...segment, gait, points: [[...start]], times: [0] };
        segments.push(output);
      }
      output.points.push([...point]);
      output.times.push(output.times.at(-1) + elapsed);
    };
    for (let index = 1; index < segment.points.length; index++) {
      const a = segment.points[index - 1];
      const b = segment.points[index];
      const length = distance(a, b);
      if (length <= epsilon) continue;
      const direction = b.map((value, axis) => (value - a[axis]) / length);
      if (previousDirection && direction.reduce((sum, value, axis) => sum + value * previousDirection[axis], 0) < Math.cos(Math.PI / 6)) {
        velocity = speed;
      }
      previousDirection = direction;
      let travelled = 0;
      while (length - travelled > epsilon) {
        const recoveringSprint = stamina?.recoveryDuringSprint && delay <= epsilon;
        const netDrain = drain - (recoveringSprint ? recoveryRate : 0);
        if (netDrain > 0 && sprinting && energy - reserve <= epsilon) {
          sprinting = false;
          delay = stamina.recoveryDelay;
          velocity = speed;
        }
        if (!sprinting) {
          const required = draining || activationCost > 0 ? reserve + activationCost + (hasActivated ? drain : 0) : 0;
          const enoughEnergy = energy + epsilon >= required && (!draining || energy - reserve - activationCost > epsilon);
          if (allowSprint && sprintSpeed > speed && enoughEnergy) {
            energy = Math.max(0, energy - activationCost);
            minimum = Math.min(minimum, energy);
            sprinting = true;
            hasActivated = true;
            delay = stamina?.recoveryDelay ?? 0;
            continue;
          }
          const remainingTime = (length - travelled) / speed;
          let duration = remainingTime;
          // Recharge one second of drain even before the first activation to avoid
          // entering an infinitesimal sprint when starting at the reserve.
          const restartEnergy = reserve + activationCost + drain;
          const canResume = allowSprint && stamina && sprintSpeed > speed && restartEnergy <= stamina.capacity && recoveryRate > 0;
          if (canResume) {
            const rechargeTime = delay + Math.max(0, restartEnergy - energy) / recoveryRate;
            duration = Math.min(duration, rechargeTime);
          }
          const start = interpolate(a, b, travelled / length);
          travelled = Math.min(length, travelled + speed * duration);
          append('run', interpolate(a, b, travelled / length), duration, start);
          if (stamina) {
            const recovering = Math.max(0, duration - delay);
            delay = Math.max(0, delay - duration);
            energy = Math.min(stamina.capacity, energy + recovering * recoveryRate);
          }
          velocity = speed;
          continue;
        }
        const availableTime = netDrain > 0 ? Math.max(0, (energy - reserve) / netDrain) : Infinity;
        const recoveryBoundary = stamina?.recoveryDuringSprint && delay > epsilon ? delay : Infinity;
        const duration = Math.min(sprintTime(length - travelled, velocity, sprintSpeed, sprintAcceleration), availableTime, recoveryBoundary);
        const accelerationTime = Math.min(duration, (sprintSpeed - velocity) / sprintAcceleration);
        const samples = [];
        const count = Math.ceil(accelerationTime / .1);
        for (let sample = 1; sample <= count; sample++) samples.push(accelerationTime * sample / count);
        if (!samples.length || duration - samples.at(-1) > epsilon) samples.push(duration);
        const initialDistance = travelled;
        let previousTime = 0;
        for (const sample of samples) {
          const start = interpolate(a, b, travelled / length);
          travelled = Math.min(length, initialDistance + sprintDistance(sample, velocity, sprintSpeed, sprintAcceleration));
          append('sprint', interpolate(a, b, travelled / length), sample - previousTime, start);
          previousTime = sample;
        }
        velocity = Math.min(sprintSpeed, velocity + sprintAcceleration * duration);
        if (stamina) {
          const recovering = stamina.recoveryDuringSprint ? Math.max(0, duration - delay) : 0;
          delay = Math.max(0, delay - duration);
          energy = Math.min(stamina.capacity, Math.max(0, energy - duration * drain + recovering * recoveryRate));
          minimum = Math.min(minimum, energy);
        }
      }
    }
  }
  return {
    segments,
    state: { energy, minimum, delay, sprinting, hasActivated, velocity, previousDirection },
    duration: segments.reduce((sum, segment) => sum + segment.times.at(-1), 0),
  };
}

const sameContinuation = (a, b) => {
  if (a.sprinting !== b.sprinting || a.hasActivated !== b.hasActivated || Math.abs(a.velocity - b.velocity) > epsilon) return false;
  if (!a.previousDirection || !b.previousDirection) return a.previousDirection === b.previousDirection;
  return a.previousDirection.every((value, axis) => Math.abs(value - b.previousDirection[axis]) <= epsilon);
};

const dominates = (a, b) => sameContinuation(a.state, b.state) && a.duration <= b.duration + epsilon &&
  a.state.energy >= b.state.energy - epsilon && a.state.delay <= b.state.delay + epsilon;

/** Retime a continuous path while allocating sprint activations across ground runs.
 * Each run offers running or the feasible sprint/recovery schedule. Labels carry exact
 * energy, recovery delay, gait and velocity across movement boundaries. Dominance pruning
 * compares time and resources only for equivalent continuation states. At most 256 labels
 * are retained; a reached limit is reported in locomotion.search.truncated.
 * This optimizes these run-level choices, not every possible interior activation time.
 * Explicit sprintThrough modes retain the active gait across supplied non-ground motion.
 * Their trajectory/timing stays authored and ground speed resets on landing. No movement
 * resource cost is inferred. Recovery during sprint/non-ground motion requires flags.
 * Ground turns of 30 degrees reset speed without paying another activation. Acceleration
 * uses samples at no more than 0.1-second intervals for linear trajectory playback.
 */
export function retimeGroundRoute(route, options) {
  validateOptions(options);
  if (route.status !== 'complete') return { ...route };
  const { speed, stamina } = options;
  if (!Number.isFinite(route.arrivalCost) || route.arrivalCost < 0 || !Array.isArray(route.points) ||
      !route.points.length || !route.points.every(finitePoint) || !Array.isArray(route.segments)) {
    throw new Error('Invalid locomotion route');
  }
  for (const segment of route.segments) {
    if (!Array.isArray(segment.points) || segment.points.length < 2 || !segment.points.every(finitePoint)) {
      throw new Error('Invalid locomotion segment');
    }
    validateMotion({ ...segment, cost: segment.times?.at(-1) });
  }

  let endpoint = route.points[0];
  const blocks = [];
  for (const segment of route.segments) {
    if (distance(endpoint, segment.points[0]) > 1e-6) throw new Error('Discontinuous locomotion route');
    endpoint = segment.points.at(-1);
    const last = blocks.at(-1);
    if (segment.mode === 'walk' && last?.[0].mode === 'walk') last.push(segment);
    else blocks.push([segment]);
  }
  if (distance(endpoint, route.points.at(-1)) > 1e-6) throw new Error('Inconsistent locomotion endpoint');
  const initialEnergy = stamina?.initial ?? 0;
  let labels = [{ duration: 0, previous: null, segments: [], state: {
    energy: initialEnergy, minimum: initialEnergy, delay: 0, sprinting: false,
    hasActivated: false, velocity: speed, previousDirection: null,
  } }];
  const maxLabels = 256;
  let truncated = false;
  for (const block of blocks) {
    const next = [];
    const choices = block[0].mode === 'walk' ? [true, false] : [true];
    for (const label of labels) for (const allowSprint of choices) {
      const scheduled = scheduleBlock(block, options, label.state, allowSprint);
      const candidate = { ...scheduled, duration: label.duration + scheduled.duration, previous: label };
      if (next.some(other => dominates(other, candidate))) continue;
      for (let index = next.length - 1; index >= 0; index--) {
        if (dominates(candidate, next[index])) next.splice(index, 1);
      }
      next.push(candidate);
    }
    if (next.length > maxLabels) {
      // Retain diverse high-energy states alongside faster partial journeys.
      next.sort((a, b) => a.duration - b.duration);
      const fastest = next.slice(0, maxLabels / 2);
      const remainder = next.slice(maxLabels / 2).sort((a, b) => b.state.energy - a.state.energy || a.duration - b.duration);
      labels = [...fastest, ...remainder.slice(0, maxLabels / 2)];
      truncated = true;
    } else labels = next;
  }
  const best = labels.reduce((chosen, label) => label.duration < chosen.duration ? label : chosen);
  const path = [];
  for (let current = best; current.previous; current = current.previous) path.push(current.segments);
  const segments = path.reverse().flat();
  const points = [[...route.points[0]]];
  for (const segment of segments) for (const point of segment.points.slice(1)) {
    if (distance(points.at(-1), point) > epsilon) points.push([...point]);
  }
  return {
    ...route, segments, points,
    cost: route.arrivalCost + best.duration,
    length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0),
    ...(stamina ? { locomotion: { initial: initialEnergy, final: best.state.energy, minimum: best.state.minimum,
      ...(truncated ? { search: { truncated: true, maxLabels } } : {}),
    } } : {}),
  };
}
