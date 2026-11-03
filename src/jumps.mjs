import { blockedByWalls } from './walls.mjs';

const maximumStep = 0.025;
const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

const jumpPhases = (startHeight, endHeight, options) => {
  const { gravity, fallingGravity, maxJumpHeight, maxFallingSpeed, apexTime, mode } = options ?? {};
  if (
    ![startHeight, endHeight, gravity, fallingGravity, maxJumpHeight, maxFallingSpeed, apexTime].every(
      Number.isFinite,
    ) ||
    gravity <= 0 ||
    fallingGravity <= 0 ||
    maxJumpHeight < 0 ||
    maxFallingSpeed <= 0 ||
    apexTime < 0 ||
    !['jump', 'drop'].includes(mode) ||
    (mode === 'jump' && maxJumpHeight === 0)
  )
    throw new Error('Invalid jump model');
  const peak = startHeight + (mode === 'jump' ? maxJumpHeight : 0);
  if (!Number.isFinite(peak)) throw new Error('Non-finite jump model');
  if (endHeight > peak) return null;
  const phases = [];
  if (mode === 'jump') {
    const velocity = Math.sqrt(2 * gravity * maxJumpHeight);
    phases.push({ y: startHeight, velocity, acceleration: -gravity, duration: velocity / gravity });
    if (apexTime > 0) phases.push({ y: peak, velocity: 0, acceleration: 0, duration: apexTime });
  }
  const fallDistance = peak - endHeight;
  const terminalTime = maxFallingSpeed / fallingGravity;
  const terminalDistance = (maxFallingSpeed * terminalTime) / 2;
  if (fallDistance > 0) {
    if (fallDistance <= terminalDistance) {
      phases.push({
        y: peak,
        velocity: 0,
        acceleration: -fallingGravity,
        duration: Math.sqrt((2 * fallDistance) / fallingGravity),
      });
    } else {
      phases.push({ y: peak, velocity: 0, acceleration: -fallingGravity, duration: terminalTime });
      phases.push({
        y: peak - terminalDistance,
        velocity: -maxFallingSpeed,
        acceleration: 0,
        duration: (fallDistance - terminalDistance) / maxFallingSpeed,
      });
    }
  }
  const duration = phases.reduce((sum, phase) => sum + phase.duration, 0);
  if (!Number.isFinite(duration)) throw new Error('Non-finite jump model');
  if (duration <= 0) return null;
  return { phases, duration };
};

/** Analytic duration under the same explicit vertical model as jumpConnection.
 * Null means that the destination height cannot be reached by the selected mode.
 * This does not check horizontal reach, collision, state or landing support.
 */
export function jumpDuration(startHeight, endHeight, options) {
  return jumpPhases(startHeight, endHeight, options)?.duration ?? null;
}

/** Construct one directed, model-based jump or drop between caller-supported feet.
 * Gravity values are positive magnitudes. A jump uses the full authored height,
 * followed by an explicit vertical apex hold and terminal-speed-limited descent.
 * Horizontal motion is constant between the endpoints, subject to the speed cap.
 *
 * Each chord receives a continuous full-body capsule sweep. Its inflation bounds
 * the complete quadratic arc between samples, including optional extra clearance.
 * Feet must already have real collision clearance at takeoff and landing. No
 * floor contact or initial overlap is ignored, and endpoints are never lifted.
 * Passing this model does not establish the game's live air-control behaviour.
 */
export function jumpConnection(start, end, options) {
  const {
    profile,
    gravity,
    fallingGravity,
    maxJumpHeight,
    maxFallingSpeed,
    apexTime,
    maxHorizontalSpeed,
    mode,
    sweep,
    walls,
    clearance = 0,
  } = options ?? {};
  if (
    !finitePoint(start) ||
    !finitePoint(end) ||
    !profile ||
    ![
      profile.radius,
      profile.height,
      gravity,
      fallingGravity,
      maxJumpHeight,
      maxFallingSpeed,
      apexTime,
      maxHorizontalSpeed,
      clearance,
    ].every(Number.isFinite) ||
    profile.radius < 0 ||
    profile.height <= 0 ||
    profile.height < 2 * profile.radius ||
    gravity <= 0 ||
    fallingGravity <= 0 ||
    maxJumpHeight < 0 ||
    maxFallingSpeed <= 0 ||
    apexTime < 0 ||
    maxHorizontalSpeed < 0 ||
    clearance < 0 ||
    !['jump', 'drop'].includes(mode) ||
    (mode === 'jump' && maxJumpHeight === 0) ||
    typeof sweep !== 'function' ||
    !Array.isArray(walls)
  )
    throw new Error('Invalid jump model');
  // Validate all wall records even when endpoint heights make the model impossible.
  if (blockedByWalls(start, start, walls, profile)) return null;

  const trajectory = jumpPhases(start[1], end[1], options);
  if (!trajectory) return null;
  const { phases, duration } = trajectory;
  // Avoid an unbounded allocation for inputs outside any practical scene extent.
  if (duration / maximumStep > 100000) throw new Error('Jump model exceeds the sweep budget');
  const horizontalDistance = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (horizontalDistance / duration > maxHorizontalSpeed) return null;

  const points = [[...start]],
    times = [0];
  let elapsed = 0;
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
    const phase = phases[phaseIndex],
      count = Math.ceil(phase.duration / maximumStep);
    let previousTime = 0;
    for (let step = 1; step <= count; step++) {
      const localTime = (phase.duration * step) / count,
        time = elapsed + localTime;
      const last = phaseIndex === phases.length - 1 && step === count;
      const point = last
        ? [...end]
        : [
            start[0] + ((end[0] - start[0]) * time) / duration,
            phase.y + phase.velocity * localTime + (phase.acceleration * localTime * localTime) / 2,
            start[2] + ((end[2] - start[2]) * time) / duration,
          ];
      const delta = localTime - previousTime;
      const inflation = clearance + (Math.abs(phase.acceleration) * delta * delta) / 8;
      const previous = points.at(-1);
      // Wall queries use feet plus height, so expand below and above the chord.
      const wallStart = [previous[0], previous[1] - inflation, previous[2]];
      const wallEnd = [point[0], point[1] - inflation, point[2]];
      if (
        blockedByWalls(wallStart, wallEnd, walls, {
          radius: profile.radius + inflation,
          height: profile.height + inflation * 2,
        }) ||
        sweep(previous, point, { ...profile, inflation }) !== null
      )
        return null;
      points.push(point);
      times.push(time);
      previousTime = localTime;
    }
    elapsed += phase.duration;
  }
  return { mode, points, times, motionValidation: 'model-based' };
}
