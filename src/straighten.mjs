import { blockedByWalls } from './walls.mjs';
import { surfacePortals } from './surfaces.mjs';

const pointKey = point => point.map(value => Math.round(value * 10000)).join(',');
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const tolerance = 1e-7;

const weightsAt = (triangle, point) => {
  const [a, b, c] = triangle.vertices;
  const x = point[0] - a[0], z = point[2] - a[2];
  const u = (x * (c[2] - a[2]) - z * (c[0] - a[0])) / triangle.determinant;
  const v = ((b[0] - a[0]) * z - (b[2] - a[2]) * x) / triangle.determinant;
  return [1 - u - v, u, v];
};
const heightAt = (triangle, point) => weightsAt(triangle, point)
  .reduce((height, weight, index) => height + weight * triangle.vertices[index][1], 0);

const clipTriangle = (triangle, start, end) => {
  const first = weightsAt(triangle, start), last = weightsAt(triangle, end);
  let near = 0, far = 1;
  for (let index = 0; index < 3; index++) {
    const delta = last[index] - first[index];
    if (Math.abs(delta) < 1e-14) {
      if (first[index] < -tolerance) return null;
      continue;
    }
    const crossing = -first[index] / delta;
    if (delta > 0) near = Math.max(near, crossing);
    else far = Math.min(far, crossing);
  }
  if (near > far + tolerance || far < 0 || near > 1) return null;
  return { near: Math.max(0, near), far: Math.min(1, far), first, last };
};

const simplifyCollinear = points => {
  const result = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1), point) < 1e-9) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      const lengthSquared = point.reduce((sum, value, axis) => sum + (value - a[axis]) ** 2, 0);
      if (lengthSquared === 0) break;
      const fraction = b.reduce((sum, value, axis) => sum + (value - a[axis]) * (point[axis] - a[axis]), 0) / lengthSquared;
      if (fraction < 0 || fraction > 1 ||
          distance(b, a.map((value, axis) => value + fraction * (point[axis] - value))) > 1e-7) break;
      result.pop();
    }
    result.push([...point]);
  }
  return result;
};

const makeIndex = triangles => {
  const build = entries => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const entry of entries) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], entry.min[axis]);
      max[axis] = Math.max(max[axis], entry.max[axis]);
    }
    if (entries.length <= 8) return { min, max, entries };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    entries.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
    const middle = Math.floor(entries.length / 2);
    return { min, max, left: build(entries.slice(0, middle)), right: build(entries.slice(middle)) };
  };
  const root = triangles.length ? build([...triangles]) : null;
  return point => {
    const result = [], stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (point.some((value, axis) => value < node.min[axis] - tolerance || value > node.max[axis] + tolerance)) continue;
      if (node.entries) {
        for (const triangle of node.entries) {
          if (weightsAt(triangle, point).every(weight => weight >= -tolerance) &&
              Math.abs(heightAt(triangle, point) - point[1]) <= tolerance) result.push(triangle);
        }
      } else {
        stack.push(node.left, node.right);
      }
    }
    return result;
  };
};

/** Prepare reusable ground visibility queries over convex, clearance-eroded surfaces.
 * Coordinates are world metres. Connectivity follows the same full, oppositely oriented
 * 3D portals as surfaceGraph. The caller must select one scene, state and body profile.
 * Input points must already form a verified, continuous walking run. Unsupported
 * shortcuts retain that input. Returned queries preserve the run's endpoints.
 * Height changes are reconstructed from triangulated support, never fitted as a spline.
 */
export function createGroundStraightener(surfaces, { walls, profile }) {
  const portals = surfacePortals(surfaces);
  const triangles = [], edgeOwners = new Map(), boundaryOwners = new Map(), ids = new Set();
  for (const surface of surfaces) {
    if (typeof surface.id !== 'string' || ids.has(surface.id) || !Array.isArray(surface.vertices) ||
        surface.vertices.length < 3 || !surface.vertices.every(finitePoint)) throw new Error('Invalid surface');
    if (surface.portals !== undefined && (!Array.isArray(surface.portals) || surface.portals.some(index =>
      !Number.isInteger(index) || index < 0 || index >= surface.vertices.length))) throw new Error('Invalid surface portals');
    ids.add(surface.id);
    const vertices = surface.vertices.map(point => [...point]);
    for (let fan = 1; fan + 1 < vertices.length; fan++) {
      const triangle = { id: triangles.length, vertices: [vertices[0], vertices[fan], vertices[fan + 1]], neighbours: [] };
      const [a, b, c] = triangle.vertices;
      triangle.determinant = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      // Vertical or degenerate triangles cannot support an ordinary ground shortcut.
      if (Math.abs(triangle.determinant) < 1e-12) continue;
      triangle.min = [0, 1, 2].map(axis => Math.min(...triangle.vertices.map(point => point[axis])));
      triangle.max = [0, 1, 2].map(axis => Math.max(...triangle.vertices.map(point => point[axis])));
      triangles.push(triangle);
      const polygonEdges = [fan === 1 ? 0 : null, fan, fan + 1 === vertices.length - 1 ? vertices.length - 1 : null];
      for (let edge = 0; edge < 3; edge++) {
        const polygonEdge = polygonEdges[edge];
        if (polygonEdge !== null) {
          boundaryOwners.set(JSON.stringify([surface.id, polygonEdge]), { triangle, edge });
          continue;
        }
        const from = pointKey(triangle.vertices[edge]), to = pointKey(triangle.vertices[(edge + 1) % 3]);
        if (from === to) continue;
        const edgeKey = from < to ? from + '/' + to : to + '/' + from;
        const key = polygonEdge === null ? JSON.stringify(surface.id) + ':' + edgeKey : edgeKey;
        const owners = edgeOwners.get(key) ?? [];
        owners.push({ triangle, edge, from, to });
        edgeOwners.set(key, owners);
      }
    }
  }
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    if (a.from !== b.to || a.to !== b.from || a.triangle === b.triangle) continue;
    a.triangle.neighbours.push({ triangle: b.triangle, opposite: (a.edge + 2) % 3 });
    b.triangle.neighbours.push({ triangle: a.triangle, opposite: (b.edge + 2) % 3 });
  }
  for (const portal of portals) {
    const a = boundaryOwners.get(JSON.stringify([portal.from, portal.fromEdge]));
    const b = boundaryOwners.get(JSON.stringify([portal.to, portal.toEdge]));
    if (!a || !b) continue;
    a.triangle.neighbours.push({ triangle: b.triangle, opposite: (a.edge + 2) % 3, portal });
    b.triangle.neighbours.push({ triangle: a.triangle, opposite: (b.edge + 2) % 3, portal });
  }
  const supporting = makeIndex(triangles);

  const trace = (start, end, supports) => {
    if (Math.hypot(end[0] - start[0], end[2] - start[2]) < 1e-10) {
      return distance(start, end) < tolerance ? [[...start], [...end]] : null;
    }
    const interpolate = fraction => start.map((value, axis) => value + fraction * (end[axis] - value));
    const clips = new Map();
    const clipped = triangle => {
      if (!clips.has(triangle.id)) clips.set(triangle.id, clipTriangle(triangle, start, end));
      return clips.get(triangle.id);
    };
    const reached = new Map(), queue = [];
    for (const triangle of supports) {
      const interval = clipped(triangle);
      if (interval && interval.near <= tolerance) {
        const entry = { triangle, fraction: 0, previous: null };
        reached.set(triangle.id, entry); queue.push(entry);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const entry = queue[head], triangle = entry.triangle, interval = clipped(triangle);
      if (reached.get(triangle.id) !== entry) continue;
      if (interval.far >= 1 - tolerance && Math.abs(heightAt(triangle, end) - end[1]) <= tolerance) {
        const crossings = [];
        for (let current = entry; current.previous; current = current.previous) {
          const point = interpolate(current.fraction);
          point[1] = heightAt(current.triangle, point);
          crossings.push(point);
        }
        const points = simplifyCollinear([[...start], ...crossings.reverse(), [...end]]);
        if (points.slice(1).some((point, index) => blockedByWalls(points[index], point, walls, profile))) return null;
        return points;
      }
      for (const neighbour of triangle.neighbours) {
        const next = clipped(neighbour.triangle);
        if (!next) continue;
        const first = interval.first[neighbour.opposite], delta = interval.last[neighbour.opposite] - first;
        let fraction;
        if (Math.abs(delta) < 1e-14) {
          if (Math.abs(first) > tolerance) continue;
          fraction = Math.max(entry.fraction, interval.near, next.near);
        } else {
          fraction = -first / delta;
        }
        if (fraction < entry.fraction - tolerance || fraction < next.near - tolerance ||
            fraction > Math.min(interval.far, next.far) + tolerance || fraction > 1) continue;
        fraction = Math.max(0, fraction);
        if (neighbour.portal) {
          const point = interpolate(fraction), { start, end } = neighbour.portal;
          const dx = end[0] - start[0], dz = end[2] - start[2], lengthSquared = dx * dx + dz * dz;
          if (lengthSquared < 1e-16) continue;
          const t = ((point[0] - start[0]) * dx + (point[2] - start[2]) * dz) / lengthSquared;
          if (t < -tolerance || t > 1 + tolerance ||
              Math.hypot(point[0] - start[0] - t * dx, point[2] - start[2] - t * dz) > 1e-4) continue;
        }
        const previous = reached.get(neighbour.triangle.id);
        if (previous && previous.fraction <= fraction + tolerance) continue;
        const reachedEntry = { triangle: neighbour.triangle, fraction, previous: entry };
        reached.set(neighbour.triangle.id, reachedEntry); queue.push(reachedEntry);
      }
    }
    return null;
  };

  return points => {
    if (!Array.isArray(points) || !points.length || !points.every(finitePoint)) throw new Error('Invalid ground path');
    const output = [[...points[0]]], supportCache = new Map(), lengths = [0];
    for (let index = 1; index < points.length; index++) lengths.push(lengths.at(-1) + distance(points[index - 1], points[index]));
    const supports = index => {
      if (!supportCache.has(index)) supportCache.set(index, supporting(points[index]));
      return supportCache.get(index);
    };
    let anchor = 0;
    while (anchor + 1 < points.length) {
      let chosen = anchor + 1, shortcut = null;
      // A distant goal is cheap on open ground. Bound subsequent lookahead on winding
      // paths so repeated arbitrary queries do not require quadratic visibility tests.
      const candidates = [points.length - 1];
      for (let end = Math.min(points.length - 2, anchor + 128); end > anchor + 1; end--) candidates.push(end);
      for (const candidate of candidates) {
        if (candidate <= anchor + 1) continue;
        const path = trace(points[anchor], points[candidate], supports(anchor));
        if (path) {
          const length = path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
          if (length > lengths[candidate] - lengths[anchor] + 1e-6) continue;
          chosen = candidate; shortcut = path; break;
        }
      }
      if (shortcut) output.push(...shortcut.slice(1));
      else output.push([...points[chosen]]);
      anchor = chosen;
    }
    return output;
  };
}
