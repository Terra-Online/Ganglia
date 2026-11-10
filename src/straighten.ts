import { createBoundsTree } from './bounds.js';
import { supportSnapshot, supportTriangles } from './support-snapshot.js';
import { surfacePortals, directedPortals } from './surfaces.js';
import { createWallChecker } from './walls.js';
const pointKey = (point: any): any =>
  point.map((value: any) => Math.round(value * 10000)).join(',');
const distance = (a: any, b: any) =>
  Math.hypot(...a.map((value: any, axis: any) => value - b[axis]));
const finitePoint = (point: any) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const tolerance = 1e-7;
const weightsAt = (triangle: any, point: any): any => {
  const [a, b, c] = triangle.vertices;
  const x = point[0] - a[0],
    z = point[2] - a[2];
  const u = (x * (c[2] - a[2]) - z * (c[0] - a[0])) / triangle.determinant;
  const v = ((b[0] - a[0]) * z - (b[2] - a[2]) * x) / triangle.determinant;
  return [1 - u - v, u, v];
};
const heightAt = (triangle: any, point: any): any =>
  weightsAt(triangle, point).reduce(
    (height: any, weight: any, index: any): any => height + weight * triangle.vertices[index][1],
    0,
  );
const clipTriangle = (triangle: any, start: any, end: any): any => {
  const first = weightsAt(triangle, start),
    last = weightsAt(triangle, end);
  let near = 0,
    far = 1;
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
const simplifyCollinear = (points: any): any => {
  const result = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1), point) < 1e-9) continue;
    while (result.length > 1) {
      const a: any = result.at(-2),
        b: any = result.at(-1);
      const lengthSquared = point.reduce(
        (sum: any, value: any, axis: any): any => sum + (value - a[axis]) ** 2,
        0,
      );
      if (lengthSquared === 0) break;
      const fraction =
        b.reduce(
          (sum: any, value: any, axis: any): any =>
            sum + (value - a[axis]) * (point[axis] - a[axis]),
          0,
        ) / lengthSquared;
      if (
        fraction < 0 ||
        fraction > 1 ||
        distance(
          b,
          a.map((value: any, axis: any): any => value + fraction * (point[axis] - value)),
        ) > 1e-7
      )
        break;
      result.pop();
    }
    result.push([...point]);
  }
  return result;
};
const makeIndex = (triangles: any): any => {
  const root = createBoundsTree(triangles);
  return (point: any): any => {
    const result = [],
      stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (
        point.some(
          (value: any, axis: any) =>
            value < node.min[axis] - tolerance || value > node.max[axis] + tolerance,
        )
      )
        continue;
      if (node.entries) {
        for (const triangle of node.entries) {
          if (
            weightsAt(triangle, point).every((weight: any) => weight >= -tolerance) &&
            Math.abs(heightAt(triangle, point) - point[1]) <= tolerance
          )
            result.push(triangle);
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
export function createGroundStraightener(
  surfaces: any,
  { walls, profile, portals: imported = [] }: any,
  sharedPortals?: any,
): any {
  const blocked = createWallChecker(walls, profile);
  const portals = sharedPortals ?? surfacePortals(surfaces);
  const triangles: any = [],
    boundaryOwners = new Map<any, any>();
  for (const surface of surfaces) {
    const owned = supportSnapshot(surface);
    if (!owned || boundaryOwners.has(owned.id)) throw new Error('Invalid surface');
    if (
      surface.portals !== undefined &&
      (!Array.isArray(surface.portals) ||
        surface.portals.some(
          (index: any) => !Number.isInteger(index) || index < 0 || index >= owned.vertices.length,
        ))
    )
      throw new Error('Invalid surface portals');
    // Polygon boundary edges already have integer ordinals. Avoid a serialized
    // [surface, edge] key per triangle edge; internal fan edges never join faces.
    const boundary: any = [];
    let edgeOwners;
    boundaryOwners.set(owned.id, boundary);
    for (const primitive of supportTriangles(owned)) {
      const triangle: any = {
        id: triangles.length,
        vertices: primitive.vertices,
        neighbours: [],
        determinant: primitive.determinant,
        min: primitive.min,
        max: primitive.max,
      };
      triangles.push(triangle);
      const polygonEdges = primitive.polygonEdges;
      for (let edge = 0; edge < 3; edge++) {
        const polygonEdge = polygonEdges[edge];
        if (polygonEdge !== null) {
          boundary[polygonEdge] = { triangle, edge };
          continue;
        }
        const from = pointKey(triangle.vertices[edge]),
          to = pointKey(triangle.vertices[(edge + 1) % 3]);
        if (from === to) continue;
        const edgeKey = from < to ? from + '/' + to : to + '/' + from;
        const owners = edgeOwners?.get(edgeKey) ?? [];
        owners.push({ triangle, edge, from, to });
        (edgeOwners ??= new Map<any, any>()).set(edgeKey, owners);
      }
    }
    if (edgeOwners)
      for (const owners of edgeOwners.values()) {
        if (owners.length !== 2) continue;
        const [a, b] = owners;
        if (a.from !== b.to || a.to !== b.from || a.triangle === b.triangle) continue;
        a.triangle.neighbours.push({ triangle: b.triangle, opposite: (a.edge + 2) % 3 });
        b.triangle.neighbours.push({ triangle: a.triangle, opposite: (b.edge + 2) % 3 });
      }
  }
  for (const portal of portals) {
    const a = boundaryOwners.get(portal.from)?.[portal.fromEdge];
    const b = boundaryOwners.get(portal.to)?.[portal.toEdge];
    if (!a || !b) continue;
    a.triangle.neighbours.push({ triangle: b.triangle, opposite: (a.edge + 2) % 3, portal });
    b.triangle.neighbours.push({ triangle: a.triangle, opposite: (b.edge + 2) % 3, portal });
  }
  for (const portal of directedPortals(surfaces, imported)) {
    const a = boundaryOwners.get(portal.from)?.[portal.fromEdge];
    const b = boundaryOwners.get(portal.to)?.[portal.toEdge];
    if (a && b)
      a.triangle.neighbours.push({ triangle: b.triangle, opposite: (a.edge + 2) % 3, portal });
  }
  const supporting = makeIndex(triangles);
  let components: any;
  const endpointComponents = new WeakMap<any, any>();
  const componentRoot = (index: any): any => {
    while (components[index] !== index) {
      components[index] = components[components[index]];
      index = components[index];
    }
    return index;
  };
  const groupsAt = (point: any): any => {
    if (!components) {
      components = Int32Array.from(triangles, (triangle: any): any => triangle.id);
      for (const triangle of triangles)
        for (const neighbour of triangle.neighbours) {
          components[componentRoot(neighbour.triangle.id)] = componentRoot(triangle.id);
        }
    }
    const previous = endpointComponents.get(point);
    if (previous && previous.position.every((value: any, axis: any) => value === point[axis]))
      return previous.groups;
    // A point may lie on several overlapping supports. Keep every component
    // accepted by the same locator that trace uses, including masked faces.
    const groups = new Set<any>(
      supporting(point).map((triangle: any): any => componentRoot(triangle.id)),
    );
    endpointComponents.set(point, { position: [...point], groups });
    return groups;
  };
  const trace = (start: any, end: any, supports: any): any => {
    if (Math.hypot(end[0] - start[0], end[2] - start[2]) < 1e-10) {
      return distance(start, end) < tolerance ? [[...start], [...end]] : null;
    }
    const interpolate = (fraction: any): any =>
      start.map((value: any, axis: any): any => value + fraction * (end[axis] - value));
    const clips = new Map<any, any>();
    const clipped = (triangle: any): any => {
      if (!clips.has(triangle.id)) clips.set(triangle.id, clipTriangle(triangle, start, end));
      return clips.get(triangle.id);
    };
    const reached = new Map<any, any>(),
      queue = [];
    for (const triangle of supports) {
      const interval = clipped(triangle);
      if (interval && interval.near <= tolerance) {
        const entry = { triangle, fraction: 0, previous: null };
        reached.set(triangle.id, entry);
        queue.push(entry);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const entry: any = queue[head],
        triangle: any = entry.triangle,
        interval = clipped(triangle);
      if (reached.get(triangle.id) !== entry) continue;
      if (
        interval.far >= 1 - tolerance &&
        Math.abs(heightAt(triangle, end) - end[1]) <= tolerance
      ) {
        const crossings = [];
        for (let current = entry; current.previous; current = current.previous) {
          const point = interpolate(current.fraction);
          crossings.push(
            [point[0], heightAt(current.triangle, point), point[2]],
            [point[0], heightAt(current.previous.triangle, point), point[2]],
          );
        }
        const points = simplifyCollinear([[...start], ...crossings.reverse(), [...end]]);
        if (points.slice(1).some((point: any, index: any): any => blocked(points[index], point)))
          return null;
        return points;
      }
      for (const neighbour of triangle.neighbours) {
        const next = clipped(neighbour.triangle);
        if (!next) continue;
        const first = interval.first[neighbour.opposite],
          delta = interval.last[neighbour.opposite] - first;
        let fraction;
        if (Math.abs(delta) < 1e-14) {
          if (Math.abs(first) > tolerance) continue;
          fraction = Math.max(entry.fraction, interval.near, next.near);
        } else {
          fraction = -first / delta;
        }
        if (
          fraction < entry.fraction - tolerance ||
          fraction < next.near - tolerance ||
          fraction > Math.min(interval.far, next.far) + tolerance ||
          fraction > 1
        )
          continue;
        fraction = Math.max(0, fraction);
        if (neighbour.portal) {
          const point = interpolate(fraction),
            { start, end } = neighbour.portal;
          const dx = end[0] - start[0],
            dz = end[2] - start[2],
            lengthSquared = dx * dx + dz * dz;
          const t =
            lengthSquared < 1e-16
              ? 0
              : ((point[0] - start[0]) * dx + (point[2] - start[2]) * dz) / lengthSquared;
          if (
            t < -tolerance ||
            t > 1 + tolerance ||
            Math.hypot(point[0] - start[0] - t * dx, point[2] - start[2] - t * dz) > 1e-4
          )
            continue;
        }
        const previous = reached.get(neighbour.triangle.id);
        if (previous && previous.fraction <= fraction + tolerance) continue;
        const reachedEntry: any = { triangle: neighbour.triangle, fraction, previous: entry };
        reached.set(neighbour.triangle.id, reachedEntry);
        queue.push(reachedEntry);
      }
    }
    return null;
  };
  const straighten = (points: any): any => {
    if (!Array.isArray(points) || !points.length || !points.every(finitePoint))
      throw new Error('Invalid ground path');
    const output = [[...points[0]]],
      supportCache = new Map<any, any>(),
      lengths = [0];
    for (let index = 1; index < points.length; index++)
      lengths.push(lengths.at(-1)! + distance(points[index - 1], points[index]));
    const supports = (index: any): any => {
      if (!supportCache.has(index)) supportCache.set(index, supporting(points[index]));
      return supportCache.get(index);
    };
    let anchor = 0;
    while (anchor + 1 < points.length) {
      let chosen = anchor + 1,
        shortcut = null;
      // Search the whole remaining corridor. A detail-dense mesh can place a
      // visible turn beyond 128 vertices even when it is only a few metres away.
      const candidates = [points.length - 1];
      for (let end = points.length - 2; end > anchor + 1; end--) candidates.push(end);
      for (const candidate of candidates) {
        if (candidate <= anchor + 1) continue;
        const path = trace(points[anchor], points[candidate], supports(anchor));
        if (path) {
          const length = path
            .slice(1)
            .reduce(
              (sum: any, point: any, index: any): any => sum + distance(path[index], point),
              0,
            );
          if (length > lengths[candidate] - lengths[anchor] + 1e-6) continue;
          chosen = candidate;
          shortcut = path;
          break;
        }
      }
      if (shortcut) output.push(...shortcut.slice(1));
      else output.push([...points[chosen]]);
      anchor = chosen;
    }
    // Centre-based corridors leave corners away from the actual obstacle. Move
    // each planar bend toward its chord while checking both complete supported
    // legs. Height changes and disconnected input legs retain their old geometry.
    for (let pass = 0; pass < 2; pass++)
      for (let index = 1; index + 1 < output.length; index++) {
        const a = output[index - 1],
          corner = output[index],
          b = output[index + 1];
        if (Math.abs(a[1] - corner[1]) > tolerance || Math.abs(b[1] - corner[1]) > tolerance)
          continue;
        if (!trace(a, corner, supporting(a)) || !trace(corner, b, supporting(corner))) continue;
        const middle = a.map((value, axis) => (value + b[axis]) / 2);
        let low = 0,
          high = 1,
          chosen = corner;
        for (let step = 0; step < 10; step++) {
          const fraction = (low + high) / 2;
          const point = corner.map((value, axis): any => value + fraction * (middle[axis] - value));
          const left = trace(a, point, supporting(a)),
            right = trace(point, b, supporting(point));
          // A height excursion needs its reconstructed samples and cannot be
          // represented by replacing only this one planar vertex.
          if (left?.length === 2 && right?.length === 2) {
            low = fraction;
            chosen = point;
          } else high = fraction;
        }
        output[index] = chosen;
      }
    return simplifyCollinear(output);
  };
  // Unlike straightening an already verified run, a visibility query can reject
  // its endpoints. The same support and portal tracing serves both contracts.
  straighten.trace = (start: any, end: any): any => {
    if (!finitePoint(start) || !finitePoint(end))
      throw new Error('Invalid ground visibility endpoints');
    return trace(start, end, supporting(start));
  };
  // Weak connectivity only rules out impossible traces. Passage direction and
  // complete wall clearance are still checked by trace itself.
  straighten.mayConnect = (start: any, end: any) => {
    if (!finitePoint(start) || !finitePoint(end))
      throw new Error('Invalid ground visibility endpoints');
    const from = groupsAt(start),
      to = groupsAt(end);
    for (const group of from) if (to.has(group)) return true;
    return false;
  };
  return straighten;
}
