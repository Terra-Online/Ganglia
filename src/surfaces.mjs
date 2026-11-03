/** Build a conservative graph of convex navigation polygons. Surfaces must already be
 * selected for one scene/state and one agent. Only matching full 3D edges connect;
 * no gap, stair, off-mesh or proximity links are inferred. Coordinates are world metres.
 * Polygon-centre routes are corridor routes, not continuous shortest paths.
 */
export function surfaceGraph(surfaces, { speed }) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid walking speed');
  const nodes = [], edges = [], portals = new Map(), ids = new Set();
  const key = p => p.map(v => Math.round(v * 10000)).join(',');
  for (const surface of surfaces) {
    if (typeof surface.id !== 'string' || ids.has(surface.id) || !Array.isArray(surface.vertices) ||
        surface.vertices.length < 3 || surface.vertices.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Invalid surface');
    if (surface.portals !== undefined && (!Array.isArray(surface.portals) ||
        surface.portals.some(i => !Number.isInteger(i) || i < 0 || i >= surface.vertices.length))) throw new Error('Invalid surface portals');
    ids.add(surface.id);
    const center = [0, 1, 2].map(i => surface.vertices.reduce((s, p) => s + p[i], 0) / surface.vertices.length);
    nodes.push({ id: surface.id, position: center });
    for (let i = 0; i < surface.vertices.length; i++) {
      if (surface.portals && !surface.portals.includes(i)) continue;
      const a = surface.vertices[i], b = surface.vertices[(i + 1) % surface.vertices.length];
      const ka = key(a), kb = key(b);
      if (ka === kb) throw new Error('Degenerate surface edge');
      const edgeKey = ka < kb ? ka + '/' + kb : kb + '/' + ka;
      const list = portals.get(edgeKey) ?? [];
      list.push({ id: surface.id, center, a, b }); portals.set(edgeKey, list);
    }
  }
  for (const list of portals.values()) {
    // Overlapping state variants / non-manifold edges are not safe connections.
    if (list.length !== 2 || list[0].id === list[1].id) continue;
    const [a, b] = list;
    if (key(a.a) !== key(b.b) || key(a.b) !== key(b.a)) continue;
    const midpoint = a.a.map((v, i) => (v + a.b[i]) / 2);
    const cost = Math.hypot(...a.center.map((v, i) => v - midpoint[i])) + Math.hypot(...b.center.map((v, i) => v - midpoint[i]));
    edges.push({ from: a.id, to: b.id, cost: cost / speed, state: 'open', points: [a.center, midpoint, b.center] });
    edges.push({ from: b.id, to: a.id, cost: cost / speed, state: 'open', points: [b.center, midpoint, a.center] });
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
