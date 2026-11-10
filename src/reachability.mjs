import { jumpDuration, jumpTravel } from './jumps.mjs';

const flightTables = new WeakMap();
const modelFields = ['gravity', 'fallingGravity', 'maxJumpHeight', 'maxFallingSpeed',
  'apexTime', 'maxHorizontalSpeed', 'startHorizontalSpeed', 'airOverspeedDeceleration'];
const heightResolution = 0.25;

function flightEnvelope(model, maxDrop, endpointTolerance) {
  const previous = flightTables.get(model);
  if (previous?.maxDrop === maxDrop && previous.endpointTolerance === endpointTolerance &&
      modelFields.every(key => Object.is(previous.model[key], model[key]))) return previous;
  const snapshot = Object.fromEntries(modelFields.map(key => [key, model[key]]));
  // Validate the shared vertical model, including the zero-jump-height case.
  jumpDuration(0, 0, { ...snapshot, mode: 'drop' });
  const vertical = { ...snapshot, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' };
  const initial = Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed ?? 0);
  const analyticReach = drop => {
    const duration = jumpDuration(0, -drop, vertical);
    if (duration === null) return 0;
    return Number.isFinite(snapshot.airOverspeedDeceleration) && snapshot.airOverspeedDeceleration > 0
      ? jumpTravel(initial, duration, snapshot)
      : initial * duration;
  };
  const minimumBin = Math.floor(-model.maxJumpHeight / heightResolution);
  const maximumBin = Math.ceil((maxDrop + 4 * endpointTolerance + heightResolution) / heightResolution);
  const count = maximumBin - minimumBin + 1;
  // A higher drop has a longer flight. Rounding up by a quarter metre gives a
  // conservative reach lookup and avoids sqrt/terminal-fall work at every node.
  // Keep extreme parameter ranges bounded and use the shared analytic fallback.
  const table = Number.isSafeInteger(count) && count > 0 && count <= 4096
    ? Float64Array.from({ length: count }, (_, index) => analyticReach((minimumBin + index) * heightResolution))
    : null;
  const result = { model: snapshot, maxDrop, endpointTolerance,
    reach(drop) {
      const index = Math.ceil(drop / heightResolution) - minimumBin;
      return table && index >= 0 && index < table.length ? table[index] : analyticReach(drop);
    } };
  flightTables.set(model, result);
  return result;
}

/** Optimistic envelope for the existing jump-discovery candidate contract.
 * The anchor is a nominal takeoff, or a nominal landing when reverse is true.
 * Actual supported feet may differ in height by endpointTolerance. Padding
 * additionally encloses witnesses generated outside an indexed boundary, such
 * as inward boundary offsets followed by vertical navigation projection.
 *
 * This is a necessary candidate test, with no support/collision guarantee.
 * Discovery already bounds total seed-to-landing span and uses its optimistic
 * vertical duration before trying jump, split, waypoint and supported run-off
 * controls. Arbitrary supported approaches outside that contract need their own
 * approach envelope. Model speed expiry is ignored here to retain an upper bound.
 */
export function createJumpEnvelope(anchor, { model, maxDrop, maxHorizontalDistance,
  endpointTolerance = 0, reverse = false, padding = [0, 0, 0] }) {
  if (!Array.isArray(anchor) || anchor.length !== 3 || !anchor.every(Number.isFinite) ||
      !Array.isArray(padding) || padding.length !== 3 || !padding.every(value => Number.isFinite(value) && value >= 0) ||
      ![maxDrop, maxHorizontalDistance, endpointTolerance, model?.maxHorizontalSpeed].every(Number.isFinite) ||
      maxDrop < 0 || maxHorizontalDistance <= 0 || endpointTolerance < 0 || model.maxHorizontalSpeed < 0 ||
      (model.startHorizontalSpeed !== undefined && (!Number.isFinite(model.startHorizontalSpeed) || model.startHorizontalSpeed < 0))) {
    throw new Error('Invalid jump candidate envelope');
  }
  const flight = flightEnvelope(model, maxDrop, endpointTolerance);
  const [x, y, z] = anchor;
  const [paddingX, paddingY, paddingZ] = padding;
  const rise = model.maxJumpHeight + 2 * endpointTolerance;
  const fall = maxDrop + 2 * endpointTolerance;
  const scale = Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z), maxHorizontalDistance, rise, fall);
  return box => {
    const minX = box.min[0] - paddingX, maxX = box.max[0] + paddingX;
    const minY = box.min[1] - paddingY, maxY = box.max[1] + paddingY;
    const minZ = box.min[2] - paddingZ, maxZ = box.max[2] + paddingZ;
    // Outward roundoff slack keeps exact-height, tangential and large-coordinate
    // boundary witnesses eligible. Non-finite arithmetic cannot justify pruning.
    const epsilon = 32 * Number.EPSILON * Math.max(scale,
      Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY), Math.abs(minZ), Math.abs(maxZ));
    if (!Number.isFinite(epsilon)) return true;
    const dx = Math.max(minX - x, 0, x - maxX), dz = Math.max(minZ - z, 0, z - maxZ);
    const span = Math.hypot(dx, dz);
    if (span > maxHorizontalDistance + epsilon) return false;
    if (reverse ? maxY < y - rise - epsilon || minY > y + fall + epsilon
      : maxY < y - fall - epsilon || minY > y + rise + epsilon) return false;
    // Flight time increases with source height and decreases with landing height.
    // Clip the optimistic pair to the declared drop allowance before taking the
    // longest possible flight, and use relative heights to retain local precision.
    const source = reverse ? Math.min(maxY, y + fall) : y;
    const landing = reverse ? y : Math.max(minY, y - fall);
    const drop = source - landing + 2 * endpointTolerance + epsilon;
    if (!Number.isFinite(drop)) return true;
    const reach = flight.reach(drop);
    return !Number.isFinite(reach) || span <= reach + epsilon;
  };
}
