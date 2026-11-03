import { surfaceGraph, projectPoint } from './surfaces.mjs';
import { routeFrom } from './routes.mjs';
import { validateMotion } from './motion.mjs';

/** Ground endpoints retain their projected positions. Each connector lies within its
 * convex source polygon; only the importer may select admissible surfaces/state.
 * Directed connections must already have grounded endpoints and validated trajectories.
 * Teleport entry costs are seconds, and unknown availability never grants access.
 */
export function planGroundRoute(surfaces, starts, goal, options) {
  const { speed, maxVertical, walls, profile, connections = [] } = options;
  const graph = surfaceGraph(surfaces, { speed });
  const target = projectPoint(surfaces, goal, { maxVertical });
  if (!target) return { status: 'unmapped' };
  const centers = new Map(graph.nodes.map(n => [n.id, n.position]));
  const endpoints = new Map();
  let serial = 0;
  const unique = () => {
    let id;
    do { id = `@endpoint/${serial++}`; } while (centers.has(id));
    return id;
  };
  const connect = (from, to, a, b) => graph.edges.push({ from, to, state: 'open',
    points: [a, b], cost: Math.hypot(...a.map((v, i) => v - b[i])) / speed });
  const endpoint = projected => {
    const id = unique();
    graph.nodes.push({ id, position: projected.position });
    const center = centers.get(projected.surface);
    connect(projected.surface, id, center, projected.position);
    connect(id, projected.surface, projected.position, center);
    // Same-face transfers must not detour through the polygon centre, including
    // walking from an arrival to a rope or between two movement devices.
    const peers = endpoints.get(projected.surface) ?? [];
    for (const peer of peers) {
      connect(id, peer.id, projected.position, peer.position);
      connect(peer.id, id, peer.position, projected.position);
    }
    peers.push({ id, position: projected.position }); endpoints.set(projected.surface, peers);
    return id;
  };
  const targetId = endpoint(target);
  const arrivals = [], ids = new Set();
  for (const start of starts) {
    if (typeof start.id !== 'string' || ids.has(start.id) || !Number.isFinite(start.cost) || start.cost < 0 ||
        !['available', 'locked', 'unknown'].includes(start.state)) throw new Error('Invalid arrival');
    ids.add(start.id);
    const projected = projectPoint(surfaces, start.position, { maxVertical });
    if (!projected || start.state !== 'available') continue;
    arrivals.push({ id: start.id, node: endpoint(projected), cost: start.cost, state: start.state });
  }
  const connectionIds = new Set();
  for (const connection of connections) {
    const { id, mode, points, times, state } = connection;
    if (typeof id !== 'string' || !id || connectionIds.has(id) || mode === undefined || mode === 'walk' ||
        !['open', 'closed', 'unknown'].includes(state) || !Array.isArray(points) || points.length < 2 ||
        points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) || !Array.isArray(times)) {
      throw new Error('Invalid ground connection');
    }
    connectionIds.add(id);
    const cost = times.at(-1);
    validateMotion({ mode, points, times, cost, connection: id });
    if (state !== 'open') continue;
    // Never add a vertical endpoint connector to repair a trajectory: that could
    // attach to another floor or silently change the landing/launch conditions.
    const from = projectPoint(surfaces, points[0], { maxVertical: 1e-6 });
    const to = projectPoint(surfaces, points.at(-1), { maxVertical: 1e-6 });
    if (!from || !to) continue;
    const fromId = endpoint(from), toId = endpoint(to);
    graph.edges.push({ from: fromId, to: toId, state, cost, mode, points, times, connection: id });
  }
  return routeFrom(graph, arrivals, targetId, { walls, profile });
}
