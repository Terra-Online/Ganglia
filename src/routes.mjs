// Edges are directed, clearance-checked corridors supplied by the navigation importer.
// This module never connects points by proximity or projects between floors.
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

/** Find the least-cost route on a verified graph. Unknown/closed edges are excluded.
 * Endpoint IDs must come from a floor-aware projection by the caller.
 * Cost is supplied in seconds; optimality is on this graph, not continuous space.
 */
export function route(graph, start, goal) {
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (nodes.has(node.id) || !finitePoint(node.position)) throw new Error('Invalid node');
    nodes.set(node.id, node.position);
  }
  const edges = new Map();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || !Number.isFinite(edge.cost) || edge.cost < 0 ||
        !['open', 'closed', 'unknown'].includes(edge.state) || !Array.isArray(edge.points) ||
        edge.points.length < 2 || !edge.points.every(finitePoint) ||
        distance(edge.points[0], nodes.get(edge.from)) > 1e-6 ||
        distance(edge.points.at(-1), nodes.get(edge.to)) > 1e-6) throw new Error('Invalid corridor');
    if (edge.state === 'open') {
      if (!edges.has(edge.from)) edges.set(edge.from, []);
      edges.get(edge.from).push(edge);
    }
  }
  if (!nodes.has(start) || !nodes.has(goal)) return { status: 'unmapped' };
  // Dijkstra: arbitrary authored travel times need not admit a Euclidean heuristic.
  const costs = new Map([[start, 0]]), previous = new Map(), pending = new Set([start]);
  while (pending.size) {
    let current;
    for (const id of pending) if (current === undefined || costs.get(id) < costs.get(current)) current = id;
    pending.delete(current);
    if (current === goal) {
      const path = [];
      for (let id = goal; id !== start;) {
        const edge = previous.get(id);
        path.push(edge); id = edge.from;
      }
      path.reverse();
      const points = [[...nodes.get(start)]];
      for (const edge of path) for (const point of edge.points.slice(1)) {
        if (distance(points.at(-1), point) > 1e-9) points.push([...point]);
      }
      return { status: 'complete', cost: costs.get(goal), points,
        length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) };
    }
    for (const edge of edges.get(current) ?? []) {
      const cost = costs.get(current) + edge.cost;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost); previous.set(edge.to, edge); pending.add(edge.to);
      }
    }
  }
  return { status: 'no-verified-route' };
}

/** Arc-length animation stays on the verified polyline; it never rounds through walls. */
export function sampleRoute(points, meters) {
  if (!points.length || !points.every(finitePoint) || !Number.isFinite(meters)) throw new Error('Invalid route sample');
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (length > 0 && remaining < length) return points[i - 1].map((v, axis) => v + (points[i][axis] - v) * remaining / length);
    remaining -= length;
  }
  return [...points.at(-1)];
}

/** Camera candidates beyond the goal, looking obliquely back along the arrival route.
 * Output still requires renderer visibility, clearance and route-in-frame checks.
 * Arrival is measured over a lookback distance rather than one tiny final edge.
 */
export function arrivalViews(points, { lookback = 12, distance: back = 16, height = 8 } = {}) {
  if (points.length < 2 || !points.every(finitePoint) || ![lookback, back, height].every(Number.isFinite) ||
      lookback <= 0 || back <= 0 || height < 0) return [];
  const target = points.at(-1);
  const before = sampleRoute([...points].reverse(), lookback);
  const dx = target[0] - before[0], dz = target[2] - before[2], length = Math.hypot(dx, dz);
  if (length < 0.1) return [];
  const ux = dx / length, uz = dz / length;
  return [-45, -30, 30, 45].map(degrees => {
    const angle = degrees * Math.PI / 180;
    const x = back * (ux * Math.cos(angle) - uz * Math.sin(angle));
    const z = back * (ux * Math.sin(angle) + uz * Math.cos(angle));
    return { position: [target[0] + x, target[1] + height, target[2] + z],
      yaw: Math.atan2(-x, -z), pitch: -Math.atan2(height, back) };
  });
}
