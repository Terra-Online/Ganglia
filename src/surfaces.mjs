const portalTolerance = 1e-4;
const vertexKey = point => point.map(value => Math.round(value * 10000)).join(',');
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

const onBoundary = (surface, point) => surface.vertices.some((a, index) => {
  const b = surface.vertices[(index + 1) % surface.vertices.length];
  const direction = b.map((value, axis) => value - a[axis]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  if (lengthSquared === 0) return false;
  const t = point.reduce((sum, value, axis) => sum + (value - a[axis]) * direction[axis], 0) / lengthSquared;
  return t >= 0 && t <= 1 && distance(point, a.map((value, axis) => value + t * direction[axis])) <= portalTolerance;
});

const overlapsBounds = (a, b) => a.min.every((value, axis) => value <= b.max[axis] + portalTolerance &&
  a.max[axis] >= b.min[axis] - portalTolerance);

const portalIndex = entries => {
  const build = items => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const item of items) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], item.min[axis]);
      max[axis] = Math.max(max[axis], item.max[axis]);
    }
    if (items.length <= 8) return { min, max, items };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    items.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
    const middle = Math.floor(items.length / 2);
    return { min, max, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
  };
  const root = entries.length ? build([...entries]) : null;
  return function* (bounds) {
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!overlapsBounds(bounds, node)) continue;
      if (node.items) {
        for (const item of node.items) if (overlapsBounds(bounds, item)) yield item;
      } else {
        stack.push(node.left, node.right);
      }
    }
  };
};

const sharedInterval = (a, b) => {
  const direction = a.b.map((value, axis) => value - a.a[axis]);
  const lengthSquared = direction.reduce((sum, value) => sum + value * value, 0);
  const fraction = point => point.reduce((sum, value, axis) => sum + (value - a.a[axis]) * direction[axis], 0) / lengthSquared;
  const first = fraction(b.a), last = fraction(b.b);
  const onLine = (point, t) => distance(point, a.a.map((value, axis) => value + t * direction[axis])) <= portalTolerance;
  if (!onLine(b.a, first) || !onLine(b.b, last)) return null;
  const near = Math.max(0, Math.min(first, last)), far = Math.min(1, Math.max(first, last));
  if ((far - near) * Math.sqrt(lengthSquared) <= portalTolerance) return null;
  return {
    near, far, opposite: last < first,
    start: a.a.map((value, axis) => value + near * direction[axis]),
    end: a.a.map((value, axis) => value + far * direction[axis]),
  };
};

/** Internal shared portal construction for graph search and ground ray traversal.
 * Split boundaries connect only over their collinear 3D overlap. Author-supplied
 * portal masks remain authoritative, and point contacts or positive gaps do not join.
 */
export function surfacePortals(surfaces) {
  const groups = new Map(), ids = new Set();
  for (const surface of surfaces) {
    if (typeof surface.id !== 'string' || ids.has(surface.id) || !Array.isArray(surface.vertices) ||
        surface.vertices.length < 3 || surface.vertices.some(point => !Array.isArray(point) ||
          point.length !== 3 || !point.every(Number.isFinite))) throw new Error('Invalid surface');
    if (surface.portals !== undefined && (!Array.isArray(surface.portals) || surface.portals.some(index =>
      !Number.isInteger(index) || index < 0 || index >= surface.vertices.length))) throw new Error('Invalid surface portals');
    ids.add(surface.id);
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      if (surface.portals && !surface.portals.includes(edge)) continue;
      const a = surface.vertices[edge], b = surface.vertices[(edge + 1) % surface.vertices.length];
      const from = vertexKey(a), to = vertexKey(b);
      if (from === to) throw new Error('Degenerate surface edge');
      const key = from < to ? from + '/' + to : to + '/' + from;
      let group = groups.get(key);
      if (!group) {
        group = { id: groups.size, a, b, owners: [], blocked: false,
          min: a.map((value, axis) => Math.min(value, b[axis])),
          max: a.map((value, axis) => Math.max(value, b[axis])) };
        groups.set(key, group);
      }
      group.owners.push({ surface: surface.id, edge, from, to });
    }
  }
  const entries = [...groups.values()], singles = entries.filter(group => group.owners.length === 1);
  const candidates = [], intervals = new Map();
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
          a.blocked = true; b.blocked = true;
        } else if (a.id < b.id && interval.opposite) {
          candidates.push({ a, b, ...interval });
        }
      }
      intervals.set(a.id, overlaps);
    }
    for (const a of singles) {
      const overlaps = intervals.get(a.id).sort((a, b) => a.near - b.near);
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
  const portals = [];
  const add = (a, b, start, end) => portals.push({ from: a.surface, fromEdge: a.edge,
    to: b.surface, toEdge: b.edge, start, end });
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
export function surfaceGraph(surfaces, { speed, portals: importedPortals = [] }) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid walking speed');
  const portals = surfacePortals(surfaces);
  const nodes = surfaces.map(surface => ({ id: surface.id,
    position: [0, 1, 2].map(axis => surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length) }));
  const positions = new Map(nodes.map(node => [node.id, node.position]));
  const edges = [];
  for (const portal of portals) {
    const a = positions.get(portal.from), b = positions.get(portal.to);
    const midpoint = portal.start.map((value, axis) => (value + portal.end[axis]) / 2);
    const cost = (distance(a, midpoint) + distance(b, midpoint)) / speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: [a, midpoint, b] });
    edges.push({ from: portal.to, to: portal.from, cost, state: 'open', points: [b, midpoint, a] });
  }
  if (!Array.isArray(importedPortals)) throw new Error('Invalid imported portals');
  const byId = new Map(surfaces.map(surface => [surface.id, surface]));
  for (const portal of importedPortals) {
    const from = byId.get(portal.from), to = byId.get(portal.to), points = portal.points;
    if (!from || !to || from === to || !Array.isArray(points) || points.length !== 2 ||
        points.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) ||
        Math.hypot(points[0][0] - points[1][0], points[0][2] - points[1][2]) > portalTolerance ||
        !projectPoint([from], points[0], { maxVertical: portalTolerance }) ||
        !projectPoint([to], points[1], { maxVertical: portalTolerance }) ||
        !onBoundary(from, points[0]) || !onBoundary(to, points[1])) throw new Error('Invalid imported portal');
    // An imported transfer is directed. Its authoring/state and climb authorization
    // belong to the importer; the runtime never supplies the reverse step implicitly.
    const corridor = [positions.get(portal.from), ...points.map(point => [...point]), positions.get(portal.to)];
    const cost = corridor.slice(1).reduce((sum, point, index) => sum + distance(corridor[index], point), 0) / speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: corridor });
  }
  return { nodes, edges };
}

/** Project vertically onto a convex polygon's triangulated surface, without crossing a gap
 * or choosing a floor outside maxVertical. Detail-height meshes are the importer's responsibility.
 */
export function projectPoint(surfaces, position, { maxVertical }) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) ||
      !Number.isFinite(maxVertical) || maxVertical < 0) throw new Error('Invalid ground projection');
  let best = null, error = Infinity;
  for (const surface of surfaces) {
    const a = surface.vertices[0];
    for (let i = 1; i + 1 < surface.vertices.length; i++) {
      const b = surface.vertices[i], c = surface.vertices[i + 1];
      const det = (b[2]-c[2])*(a[0]-c[0]) + (c[0]-b[0])*(a[2]-c[2]);
      if (Math.abs(det) < 1e-10) continue;
      const u = ((b[2]-c[2])*(position[0]-c[0]) + (c[0]-b[0])*(position[2]-c[2])) / det;
      const v = ((c[2]-a[2])*(position[0]-c[0]) + (a[0]-c[0])*(position[2]-c[2])) / det;
      if (u < -1e-8 || v < -1e-8 || u+v > 1+1e-8) continue;
      const y = u*a[1] + v*b[1] + (1-u-v)*c[1], delta = Math.abs(y-position[1]);
      if (delta <= maxVertical && delta < error) {
        best = { surface: surface.id, position: [position[0], y, position[2]] }; error = delta;
      }
    }
  }
  return best;
}
