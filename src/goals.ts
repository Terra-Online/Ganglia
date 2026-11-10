import { createBoundsIndex } from './bounds.js';
import { supportSnapshot } from './support-snapshot.js';
import { projectPoint } from './surfaces.js';
const finitePoint = (point: any) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distanceSquared = (a: any, b: any) => {
  let squared = 0;
  for (let axis = 0; axis < a.length; axis++) squared += (a[axis] - b[axis]) ** 2;
  return squared;
};
// Keep dot-product accumulation in the original coordinate order. Scalar
// intermediates avoid transient vectors during repeated landing projections.
const dot3 = (ax: any, ay: any, az: any, bx: any, by: any, bz: any) => {
  let sum = 0;
  sum += ax * bx;
  sum += ay * by;
  sum += az * bz;
  return sum;
};
const closestOnEdge = (target: any, a: any, b: any): any => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const lengthSquared = dot3(dx, dy, dz, dx, dy, dz);
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            dot3(target[0] - a[0], target[1] - a[1], target[2] - a[2], dx, dy, dz) / lengthSquared,
          ),
        );
  return [a[0] + fraction * dx, a[1] + fraction * dy, a[2] + fraction * dz];
};
const closestOnTriangle = (target: any, a: any, b: any, c: any): any => {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    abz = b[2] - a[2];
  const acx = c[0] - a[0],
    acy = c[1] - a[1],
    acz = c[2] - a[2];
  const atx = target[0] - a[0],
    aty = target[1] - a[1],
    atz = target[2] - a[2];
  const aa = dot3(abx, aby, abz, abx, aby, abz),
    bb = dot3(acx, acy, acz, acx, acy, acz);
  const cross = dot3(abx, aby, abz, acx, acy, acz);
  const determinant = aa * bb - cross * cross;
  if (determinant > 1e-20) {
    const atab = dot3(atx, aty, atz, abx, aby, abz),
      atac = dot3(atx, aty, atz, acx, acy, acz);
    const u = (bb * atab - cross * atac) / determinant;
    const v = (aa * atac - cross * atab) / determinant;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return [a[0] + u * abx + v * acx, a[1] + u * aby + v * acy, a[2] + u * abz + v * acz];
    }
  }
  let best = closestOnEdge(target, a, b),
    squared = distanceSquared(target, best);
  const second = closestOnEdge(target, b, c),
    secondSquared = distanceSquared(target, second);
  if (secondSquared < squared) {
    best = second;
    squared = secondSquared;
  }
  const third = closestOnEdge(target, c, a);
  if (distanceSquared(target, third) < squared) best = third;
  return best;
};
const clipPolygon = (vertices: any, signedDistance: any): any => {
  const output = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index],
      b = vertices[(index + 1) % vertices.length];
    const aDistance = signedDistance(a),
      bDistance = signedDistance(b);
    const aInside = aDistance >= 0,
      bInside = bDistance >= 0;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const fraction = aDistance / (aDistance - bDistance);
      output.push(a.map((value: any, axis: any): any => value + fraction * (b[axis] - value)));
    }
  }
  return output;
};
export const closestOnSurface = (surface: any, target: any, planes: any = []): any => {
  let best = null,
    shortest = Infinity;
  const a = surface.vertices[0];
  for (let fan = 1; fan + 1 < surface.vertices.length; fan++) {
    const b = surface.vertices[fan],
      c = surface.vertices[fan + 1];
    const areaXZ = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(areaXZ) < 1e-10) continue;
    if (!planes.length) {
      const point = closestOnTriangle(target, a, b, c);
      const squared = distanceSquared(target, point);
      if (squared < shortest) {
        best = point;
        shortest = squared;
      }
      continue;
    }
    let polygon = [a, b, c];
    for (const plane of planes) polygon = clipPolygon(polygon, plane);
    if (!polygon.length) continue;
    const candidates = [];
    if (polygon.length < 3) {
      candidates.push(closestOnEdge(target, polygon[0], polygon.at(-1)));
    } else {
      for (let index = 1; index + 1 < polygon.length; index++) {
        candidates.push(closestOnTriangle(target, polygon[0], polygon[index], polygon[index + 1]));
      }
    }
    for (const point of candidates) {
      const squared = distanceSquared(target, point);
      if (squared < shortest) {
        best = point;
        shortest = squared;
      }
    }
  }
  return best && { surface: surface.id, position: best, distance: Math.sqrt(shortest) };
};
/** Prepare repeated foot-position or interaction-region goal queries.
 * Surfaces must be selected convex ground polygons for one scene, state and body.
 * The index owns a snapshot. Rebuild it when the ground changes.
 *
 * Without interaction, maxVertical selects the same single vertical projection as
 * projectPoint. Interaction radius is an explicitly supplied 3D sphere around the
 * target. Optional interaction.maxVertical independently clips standing heights.
 * Explicit facing and halfAngle (degrees, 0 < halfAngle <= 90) restrict candidates
 * to the target's horizontal forward cone. These fields must be provided together.
 * Results contain one nearest feasible standing point per eligible surface, ordered
 * by target distance. This finite set does not solve continuous region-entry cost.
 * Callers must check reachability, wall state and interaction line of sight.
 */
export function createGoalProjector(surfaces: any): any {
  if (!Array.isArray(surfaces)) throw new Error('Invalid goal surfaces');
  const ids = new Set<any>();
  const snapshot = surfaces.map((surface, index): any => {
    const owned = supportSnapshot(surface);
    if (!owned || ids.has(owned.id)) throw new Error('Invalid goal surface');
    ids.add(owned.id);
    return { id: owned.id, vertices: owned.vertices, index, min: owned.min, max: owned.max };
  });
  const query = createBoundsIndex(snapshot);
  return (target: any, options: any): any => {
    if (!finitePoint(target) || !options) throw new Error('Invalid goal query');
    const { maxVertical, interaction } = options;
    if (interaction === undefined) {
      if (!Number.isFinite(maxVertical) || maxVertical < 0)
        throw new Error('Invalid goal projection height');
      const bounds = {
        min: [target[0], target[1] - maxVertical, target[2]],
        max: [target[0], target[1] + maxVertical, target[2]],
      };
      let best = null;
      for (const surface of [...query(bounds)].sort((a, b) => a.index - b.index)) {
        const projected = projectPoint([surface], target, { maxVertical });
        if (!projected) continue;
        const distance = Math.abs(projected.position[1] - target[1]);
        if (!best || distance < best.distance) best = { ...projected, distance };
      }
      return best ? [best] : [];
    }
    const planes: any = interactionPlanes(target, interaction);
    const radius = interaction.radius;
    const bounds = {
      min: target.map((value: any) => value - radius),
      max: target.map((value: any): any => value + radius),
    };
    if (interaction.maxVertical !== undefined) {
      bounds.min[1] = Math.max(bounds.min[1], target[1] - interaction.maxVertical);
      bounds.max[1] = Math.min(bounds.max[1], target[1] + interaction.maxVertical);
    }
    const candidates = [];
    for (const surface of query(bounds, target, radius)) {
      const candidate = closestOnSurface(surface, target, planes);
      if (candidate && candidate.distance <= radius)
        candidates.push({ ...candidate, index: surface.index });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
    return candidates.map(({ index, ...candidate }): any => candidate);
  };
}
/** Project a single goal. Reuse createGoalProjector for repeated queries. */
export function projectGoal(surfaces: any, target: any, options: any): any {
  return createGoalProjector(surfaces)(target, options);
}
function interactionPlanes(target: any, interaction: any): any {
  if (
    !interaction ||
    !Number.isFinite(interaction.radius) ||
    interaction.radius < 0 ||
    (interaction.maxVertical !== undefined &&
      (!Number.isFinite(interaction.maxVertical) || interaction.maxVertical < 0))
  ) {
    throw new Error('Invalid interaction goal range');
  }
  const planes = [];
  if (interaction.maxVertical !== undefined) {
    planes.push(
      (point: any): any => point[1] - target[1] + interaction.maxVertical,
      (point: any) => target[1] + interaction.maxVertical - point[1],
    );
  }
  if (interaction.facing !== undefined || interaction.halfAngle !== undefined) {
    if (
      !finitePoint(interaction.facing) ||
      Math.hypot(interaction.facing[0], interaction.facing[2]) === 0 ||
      !Number.isFinite(interaction.halfAngle) ||
      interaction.halfAngle <= 0 ||
      interaction.halfAngle > 90
    ) {
      throw new Error('Invalid interaction facing cone');
    }
    const length = Math.hypot(interaction.facing[0], interaction.facing[2]);
    const forwardX = interaction.facing[0] / length,
      forwardZ = interaction.facing[2] / length;
    const angle = (interaction.halfAngle * Math.PI) / 180;
    const sine = Math.sin(angle),
      cosine = interaction.halfAngle === 90 ? 0 : Math.cos(angle);
    const forward = (point: any) =>
      (point[0] - target[0]) * forwardX + (point[2] - target[2]) * forwardZ;
    const side = (point: any) =>
      (point[0] - target[0]) * forwardZ - (point[2] - target[2]) * forwardX;
    planes.push(
      (point: any) => forward(point) * sine + side(point) * cosine,
      (point: any) => forward(point) * sine - side(point) * cosine,
    );
  }
  return planes;
}
/** Locate a hit along a supplied piecewise-linear trajectory. The caller owns
 * collision validation and safe termination after the hit. */
export function findGoalHit(points: any, target: any, interaction: any): any {
  if (
    !finitePoint(target) ||
    !Array.isArray(points) ||
    !points.length ||
    !points.every(finitePoint)
  ) {
    throw new Error('Invalid goal trajectory');
  }
  const planes = interactionPlanes(target, interaction);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    let near = 0,
      far = 1;
    for (const plane of planes) {
      const first = plane(a),
        last = plane(b);
      if (first < 0 && last < 0) {
        far = -1;
        break;
      }
      if (first < 0) near = Math.max(near, first / (first - last));
      if (last < 0) far = Math.min(far, first / (first - last));
    }
    if (near > far) continue;
    const delta = b.map((value: any, axis: any) => value - a[axis]);
    const offset = a.map((value: any, axis: any) => value - target[axis]);
    const quadratic = delta.reduce((sum: any, value: any): any => sum + value * value, 0);
    const linear = delta.reduce(
      (sum: any, value: any, axis: any): any => sum + value * offset[axis],
      0,
    );
    const constant = distanceSquared(a, target) - interaction.radius ** 2;
    if (quadratic === 0) {
      if (constant <= 0) return { index, fraction: near, position: [...a] };
      continue;
    }
    const discriminant = linear * linear - quadratic * constant;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    let fraction = Math.max(near, (-linear - root) / quadratic);
    if (fraction > Math.min(far, (-linear + root) / quadratic) + 1e-9) continue;
    fraction = Math.min(far, fraction);
    const position = a.map((value: any, axis: any): any => value + fraction * delta[axis]);
    return { index, fraction, position };
  }
  return null;
}
// Interaction completion owns the terminal point of an airborne collection action.
export function trimGoalFlight(arc: any, target: any, interaction: any): any {
  if (!arc) return null;
  const hit = findGoalHit(arc.points, target, interaction);
  if (!hit) return null;
  const time =
    arc.times[hit.index - 1] + hit.fraction * (arc.times[hit.index] - arc.times[hit.index - 1]);
  if (time <= 0) return null;
  const points = arc.points.slice(0, hit.index),
    times = arc.times.slice(0, hit.index);
  if (time > times.at(-1)) {
    points.push(hit.position);
    times.push(time);
  }
  return { ...arc, points, times };
}
