import { createBoundsIndex } from './bounds.js';
const portalTolerance = 1e-4;
const vertexKey = (point: any): any =>
  point.map((value: any) => Math.round(value * 10000)).join(',');
const distance = (a: any, b: any) =>
  Math.hypot(...a.map((value: any, axis: any) => value - b[axis]));
const onSegment = (point: any, a: any, b: any) => {
  const direction = b.map((value: any, axis: any) => value - a[axis]);
  const lengthSquared = direction.reduce((sum: any, value: any): any => sum + value * value, 0);
  if (lengthSquared === 0) return distance(point, a) <= portalTolerance;
  const t =
    point.reduce(
      (sum: any, value: any, axis: any): any => sum + (value - a[axis]) * direction[axis],
      0,
    ) / lengthSquared;
  return (
    t >= -1e-8 &&
    t <= 1 + 1e-8 &&
    distance(
      point,
      a.map((value: any, axis: any): any => value + t * direction[axis]),
    ) <= portalTolerance
  );
};
const boundaryEdge = (surface: any, point: any, interval: any = [point]): any =>
  surface.vertices.findIndex((a: any, index: any) =>
    [point, ...interval].every((value) =>
      onSegment(value, a, surface.vertices[(index + 1) % surface.vertices.length]),
    ),
  );
/** Validate imported directed passages once under the same boundary contract used
 * by graph search, ground tracing and exposed-boundary discovery. Old point-only
 * transfers retain their exact crossing location.
 */
export function directedPortals(surfaces: any, portals: any = []): any {
  if (!Array.isArray(portals)) throw new Error('Invalid imported portals');
  const byId = new Map<any, any>(surfaces.map((surface: any): any => [surface.id, surface]));
  const horizontal = (a: any, b: any) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  return portals.map((portal): any => {
    const from = byId.get(portal.from),
      to = byId.get(portal.to),
      points = portal.points;
    const valid = (surface: any, point: any): any =>
      Array.isArray(point) &&
      point.length === 3 &&
      point.every(Number.isFinite) &&
      projectPoint([surface], point, { maxVertical: portalTolerance }) &&
      boundaryEdge(surface, point) >= 0;
    if (
      !from ||
      !to ||
      from === to ||
      !Array.isArray(points) ||
      points.length !== 2 ||
      !valid(from, points[0]) ||
      !valid(to, points[1]) ||
      horizontal(points[0], points[1]) > portalTolerance
    ) {
      throw new Error('Invalid imported portal');
    }
    const entry = portal.entry ?? [points[0], points[0]],
      exit = portal.exit ?? [points[1], points[1]];
    if (
      (portal.entry === undefined) !== (portal.exit === undefined) ||
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Array.isArray(exit) ||
      exit.length !== 2 ||
      entry.some((point) => !valid(from, point)) ||
      exit.some((point) => !valid(to, point)) ||
      entry.some((point, index) => horizontal(point, exit[index]) > portalTolerance) ||
      (portal.entry && horizontal(entry[0], entry[1]) <= portalTolerance)
    )
      throw new Error('Invalid imported portal interval');
    const fromEdge = boundaryEdge(from, points[0], entry),
      toEdge = boundaryEdge(to, points[1], exit);
    if (fromEdge < 0 || toEdge < 0) throw new Error('Invalid imported portal interval boundary');
    // Every interval and its representative must lie on one authored edge per side.
    for (const [surface, edge, interval, point] of [
      [from, fromEdge, entry, points[0]],
      [to, toEdge, exit, points[1]],
    ]) {
      const a = surface.vertices[edge],
        b = surface.vertices[(edge + 1) % surface.vertices.length];
      if (
        interval.some((value: any) => !onSegment(value, a, b)) ||
        !onSegment(point, interval[0], interval[1])
      ) {
        throw new Error('Invalid imported portal interval');
      }
    }
    return {
      from: portal.from,
      to: portal.to,
      points,
      fromEdge,
      toEdge,
      start: entry[0],
      end: entry[1],
      exitStart: exit[0],
      exitEnd: exit[1],
    };
  });
}
const portalIndex = (entries: any): any => {
  const query = createBoundsIndex(entries);
  return (bounds: any): any =>
    query({
      min: bounds.min.map((value: any) => value - portalTolerance),
      max: bounds.max.map((value: any): any => value + portalTolerance),
    });
};
const sharedInterval = (a: any, b: any): any => {
  const direction = a.b.map((value: any, axis: any) => value - a.a[axis]);
  const lengthSquared = direction.reduce((sum: any, value: any): any => sum + value * value, 0);
  const fraction = (point: any) =>
    point.reduce(
      (sum: any, value: any, axis: any): any => sum + (value - a.a[axis]) * direction[axis],
      0,
    ) / lengthSquared;
  const first = fraction(b.a),
    last = fraction(b.b);
  const onLine = (point: any, t: any) =>
    distance(
      point,
      a.a.map((value: any, axis: any): any => value + t * direction[axis]),
    ) <= portalTolerance;
  if (!onLine(b.a, first) || !onLine(b.b, last)) return null;
  const near = Math.max(0, Math.min(first, last)),
    far = Math.min(1, Math.max(first, last));
  if ((far - near) * Math.sqrt(lengthSquared) <= portalTolerance) return null;
  return {
    near,
    far,
    opposite: last < first,
    start: a.a.map((value: any, axis: any): any => value + near * direction[axis]),
    end: a.a.map((value: any, axis: any): any => value + far * direction[axis]),
  };
};
/** Internal shared portal construction for graph search and ground ray traversal.
 * Split boundaries connect only over their collinear 3D overlap. Author-supplied
 * portal masks remain authoritative, and point contacts or positive gaps do not join.
 */
export function surfacePortals(surfaces: any): any {
  const groups = new Map<any, any>(),
    ids = new Set<any>();
  for (const surface of surfaces) {
    if (
      typeof surface.id !== 'string' ||
      ids.has(surface.id) ||
      !Array.isArray(surface.vertices) ||
      surface.vertices.length < 3 ||
      surface.vertices.some(
        (point: any) =>
          !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite),
      )
    )
      throw new Error('Invalid surface');
    if (
      surface.portals !== undefined &&
      (!Array.isArray(surface.portals) ||
        surface.portals.some(
          (index: any) => !Number.isInteger(index) || index < 0 || index >= surface.vertices.length,
        ))
    )
      throw new Error('Invalid surface portals');
    ids.add(surface.id);
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      if (surface.portals && !surface.portals.includes(edge)) continue;
      const a = surface.vertices[edge],
        b = surface.vertices[(edge + 1) % surface.vertices.length];
      const from = vertexKey(a),
        to = vertexKey(b);
      if (from === to) throw new Error('Degenerate surface edge');
      const key = from < to ? from + '/' + to : to + '/' + from;
      let group = groups.get(key);
      if (!group) {
        group = {
          id: groups.size,
          a,
          b,
          owners: [],
          blocked: false,
          min: a.map((value: any, axis: any) => Math.min(value, b[axis])),
          max: a.map((value: any, axis: any) => Math.max(value, b[axis])),
        };
        groups.set(key, group);
      }
      group.owners.push({ surface: surface.id, edge, from, to });
    }
  }
  const entries = [...groups.values()],
    singles = entries.filter((group) => group.owners.length === 1);
  const candidates = [],
    intervals = new Map<any, any>();
  // Full shared edges already have exact partners. Only unmatched boundaries need
  // spatial queries, including checks against full edges for ambiguous overlap.
  if (singles.length) {
    const query = portalIndex(entries);
    for (const a of singles) {
      const overlaps = [];
      for (const b of query(a)) {
        if (a === b || a.owners[0].surface === b.owners[0].surface) continue;
        const interval = sharedInterval(a, b);
        if (!interval) continue;
        overlaps.push({ ...interval, other: b });
        if (b.owners.length > 1) {
          a.blocked = true;
          b.blocked = true;
        } else if (a.id < b.id && interval.opposite) {
          candidates.push({ a, b, ...interval });
        }
      }
      intervals.set(a.id, overlaps);
    }
    for (const a of singles) {
      const overlaps = intervals.get(a.id).sort((a: any, b: any) => a.near - b.near);
      const length = distance(a.a, a.b);
      for (let index = 1; index < overlaps.length; index++) {
        for (let previous = index - 1; previous >= 0; previous--) {
          if ((overlaps[previous].far - overlaps[index].near) * length <= portalTolerance) continue;
          // More than two polygons cover this boundary interval. Keeping the
          // original component is safer than choosing an overlapping state mesh.
          a.blocked = true;
          overlaps[index].other.blocked = true;
          overlaps[previous].other.blocked = true;
        }
      }
    }
  }
  const portals: any = [];
  const add = (a: any, b: any, start: any, end: any): any =>
    portals.push({ from: a.surface, fromEdge: a.edge, to: b.surface, toEdge: b.edge, start, end });
  for (const group of entries) {
    if (group.blocked || group.owners.length !== 2) continue;
    const [a, b] = group.owners;
    if (a.surface !== b.surface && a.from === b.to && a.to === b.from) add(a, b, group.a, group.b);
  }
  for (const candidate of candidates) {
    if (!candidate.a.blocked && !candidate.b.blocked) {
      add(candidate.a.owners[0], candidate.b.owners[0], candidate.start, candidate.end);
    }
  }
  return portals;
}
/** Build a conservative graph of convex navigation polygons selected for one scene,
 * state and agent. Full or split collinear 3D portals connect over their shared
 * interval. No gap, stair, off-mesh or proximity links are inferred.
 */
export function surfaceGraph(
  surfaces: any,
  { speed, portals: importedPortals = [] }: any,
  sharedPortals?: any,
): any {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid walking speed');
  const portals = sharedPortals ?? surfacePortals(surfaces);
  const nodes = surfaces.map((surface: any): any => ({
    id: surface.id,
    position: [0, 1, 2].map(
      (axis) =>
        surface.vertices.reduce((sum: any, point: any): any => sum + point[axis], 0) /
        surface.vertices.length,
    ),
  }));
  const positions = new Map<any, any>(nodes.map((node: any): any => [node.id, node.position]));
  const edges = [];
  for (const portal of portals) {
    const a = positions.get(portal.from),
      b = positions.get(portal.to);
    const midpoint = portal.start.map((value: any, axis: any) => (value + portal.end[axis]) / 2);
    const cost = (distance(a, midpoint) + distance(b, midpoint)) / speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: [a, midpoint, b] });
    edges.push({ from: portal.to, to: portal.from, cost, state: 'open', points: [b, midpoint, a] });
  }
  for (const portal of directedPortals(surfaces, importedPortals)) {
    const points = portal.points;
    // An imported transfer is directed. Its authoring/state and climb authorization
    // belong to the importer; the runtime never supplies the reverse step implicitly.
    const corridor = [
      positions.get(portal.from),
      ...points.map((point: any): any => [...point]),
      positions.get(portal.to),
    ];
    const cost =
      corridor
        .slice(1)
        .reduce((sum, point, index): any => sum + distance(corridor[index], point), 0) / speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: corridor });
  }
  return { nodes, edges };
}
/** Project vertically onto a convex polygon's triangulated surface, without crossing a gap
 * or choosing a floor outside maxVertical. Detail-height meshes are the importer's responsibility.
 */
export function projectPoint(surfaces: any, position: any, { maxVertical }: any): any {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(Number.isFinite) ||
    !Number.isFinite(maxVertical) ||
    maxVertical < 0
  )
    throw new Error('Invalid ground projection');
  let best = null,
    error = Infinity;
  for (const surface of surfaces) {
    const a = surface.vertices[0];
    for (let i = 1; i + 1 < surface.vertices.length; i++) {
      const b = surface.vertices[i],
        c = surface.vertices[i + 1];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-10) continue;
      const u = ((b[2] - c[2]) * (position[0] - c[0]) + (c[0] - b[0]) * (position[2] - c[2])) / det;
      const v = ((c[2] - a[2]) * (position[0] - c[0]) + (a[0] - c[0]) * (position[2] - c[2])) / det;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const y = u * a[1] + v * b[1] + (1 - u - v) * c[1],
        delta = Math.abs(y - position[1]);
      if (delta <= maxVertical && delta < error) {
        best = { surface: surface.id, position: [position[0], y, position[2]] };
        error = delta;
      }
    }
  }
  return best;
}
