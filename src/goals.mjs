import { createBoundsIndex } from './bounds.mjs';
import { projectPoint } from './surfaces.mjs';

const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distanceSquared = (a, b) => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

const closestOnEdge = (target, a, b) => {
  const direction = b.map((value, axis) => value - a[axis]);
  const lengthSquared = dot(direction, direction);
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    dot(target.map((value, axis) => value - a[axis]), direction) / lengthSquared));
  return a.map((value, axis) => value + fraction * direction[axis]);
};

const closestOnTriangle = (target, a, b, c) => {
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const at = target.map((value, axis) => value - a[axis]);
  const aa = dot(ab, ab), bb = dot(ac, ac), cross = dot(ab, ac);
  const determinant = aa * bb - cross * cross;
  if (determinant > 1e-20) {
    const u = (bb * dot(at, ab) - cross * dot(at, ac)) / determinant;
    const v = (aa * dot(at, ac) - cross * dot(at, ab)) / determinant;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return a.map((value, axis) => value + u * ab[axis] + v * ac[axis]);
    }
  }
  const candidates = [closestOnEdge(target, a, b), closestOnEdge(target, b, c), closestOnEdge(target, c, a)];
  return candidates.reduce((best, point) => distanceSquared(target, point) < distanceSquared(target, best) ? point : best);
};

const clipPolygon = (vertices, signedDistance) => {
  const output = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    const aDistance = signedDistance(a), bDistance = signedDistance(b);
    const aInside = aDistance >= 0, bInside = bDistance >= 0;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const fraction = aDistance / (aDistance - bDistance);
      output.push(a.map((value, axis) => value + fraction * (b[axis] - value)));
    }
  }
  return output;
};

const closestOnSurface = (surface, target, planes) => {
  let best = null, shortest = Infinity;
  const a = surface.vertices[0];
  for (let fan = 1; fan + 1 < surface.vertices.length; fan++) {
    const b = surface.vertices[fan], c = surface.vertices[fan + 1];
    const areaXZ = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(areaXZ) < 1e-10) continue;
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
      if (squared < shortest) { best = point; shortest = squared; }
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
export function createGoalProjector(surfaces) {
  if (!Array.isArray(surfaces)) throw new Error('Invalid goal surfaces');
  const ids = new Set();
  const snapshot = surfaces.map((surface, index) => {
    if (typeof surface.id !== 'string' || ids.has(surface.id) || !Array.isArray(surface.vertices) ||
        surface.vertices.length < 3 || !surface.vertices.every(finitePoint)) throw new Error('Invalid goal surface');
    ids.add(surface.id);
    const vertices = surface.vertices.map(point => [...point]);
    return { id: surface.id, vertices, index,
      min: [0, 1, 2].map(axis => Math.min(...vertices.map(point => point[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...vertices.map(point => point[axis]))) };
  });
  const query = createBoundsIndex(snapshot);
  return (target, options) => {
    if (!finitePoint(target) || !options) throw new Error('Invalid goal query');
    const { maxVertical, interaction } = options;
    if (interaction === undefined) {
      if (!Number.isFinite(maxVertical) || maxVertical < 0) throw new Error('Invalid goal projection height');
      const bounds = { min: [target[0], target[1] - maxVertical, target[2]], max: [target[0], target[1] + maxVertical, target[2]] };
      let best = null;
      for (const surface of [...query(bounds)].sort((a, b) => a.index - b.index)) {
        const projected = projectPoint([surface], target, { maxVertical });
        if (!projected) continue;
        const distance = Math.abs(projected.position[1] - target[1]);
        if (!best || distance < best.distance) best = { ...projected, distance };
      }
      return best ? [best] : [];
    }
    if (!interaction || !Number.isFinite(interaction.radius) || interaction.radius < 0 ||
        (interaction.maxVertical !== undefined && (!Number.isFinite(interaction.maxVertical) || interaction.maxVertical < 0))) {
      throw new Error('Invalid interaction goal range');
    }
    const planes = [];
    if (interaction.maxVertical !== undefined) {
      planes.push(point => point[1] - target[1] + interaction.maxVertical,
        point => target[1] + interaction.maxVertical - point[1]);
    }
    if (interaction.facing !== undefined || interaction.halfAngle !== undefined) {
      if (!finitePoint(interaction.facing) || Math.hypot(interaction.facing[0], interaction.facing[2]) === 0 ||
          !Number.isFinite(interaction.halfAngle) || interaction.halfAngle <= 0 || interaction.halfAngle > 90) {
        throw new Error('Invalid interaction facing cone');
      }
      const length = Math.hypot(interaction.facing[0], interaction.facing[2]);
      const forwardX = interaction.facing[0] / length, forwardZ = interaction.facing[2] / length;
      const angle = interaction.halfAngle * Math.PI / 180;
      const sine = Math.sin(angle), cosine = interaction.halfAngle === 90 ? 0 : Math.cos(angle);
      const forward = point => (point[0] - target[0]) * forwardX + (point[2] - target[2]) * forwardZ;
      const side = point => (point[0] - target[0]) * forwardZ - (point[2] - target[2]) * forwardX;
      planes.push(point => forward(point) * sine + side(point) * cosine,
        point => forward(point) * sine - side(point) * cosine);
    }
    const radius = interaction.radius;
    const bounds = { min: target.map(value => value - radius), max: target.map(value => value + radius) };
    if (interaction.maxVertical !== undefined) {
      bounds.min[1] = Math.max(bounds.min[1], target[1] - interaction.maxVertical);
      bounds.max[1] = Math.min(bounds.max[1], target[1] + interaction.maxVertical);
    }
    const candidates = [];
    for (const surface of query(bounds, target, radius)) {
      const candidate = closestOnSurface(surface, target, planes);
      if (candidate && candidate.distance <= radius) candidates.push({ ...candidate, index: surface.index });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
    return candidates.map(({ index, ...candidate }) => candidate);
  };
}

/** Project a single goal. Reuse createGoalProjector for repeated queries. */
export function projectGoal(surfaces, target, options) {
  return createGoalProjector(surfaces)(target, options);
}
