import { surfaceGraph, projectPoint } from './surfaces.mjs';
import { routeFrom } from './routes.mjs';

/** Ground endpoints retain their projected positions. Each connector lies within its
 * convex source polygon; only the importer may select admissible surfaces/state.
 * Teleport entry costs are seconds, and unknown availability never grants access.
 */
export function planGroundRoute(surfaces, starts, goal, options) {
  const { speed, maxVertical, walls, profile } = options;
  const graph = surfaceGraph(surfaces, { speed });
  const target = projectPoint(surfaces, goal, { maxVertical });
  if (!target) return { status: 'unmapped' };
  const centers = new Map(graph.nodes.map(n => [n.id, n.position]));
  let serial = 0;
  const unique = () => {
    let id;
    do { id = `@endpoint/${serial++}`; } while (centers.has(id));
    return id;
  };
  const connect = (from, to, a, b) => graph.edges.push({ from, to, state: 'open',
    points: [a, b], cost: Math.hypot(...a.map((v, i) => v - b[i])) / speed });
  const targetId = unique();
  graph.nodes.push({ id: targetId, position: target.position });
  connect(target.surface, targetId, centers.get(target.surface), target.position);
  const arrivals = [], ids = new Set();
  for (const start of starts) {
    if (typeof start.id !== 'string' || ids.has(start.id) || !Number.isFinite(start.cost) || start.cost < 0 ||
        !['available', 'locked', 'unknown'].includes(start.state)) throw new Error('Invalid arrival');
    ids.add(start.id);
    const projected = projectPoint(surfaces, start.position, { maxVertical });
    if (!projected || start.state !== 'available') continue;
    const id = unique();
    graph.nodes.push({ id, position: projected.position });
    connect(id, projected.surface, projected.position, centers.get(projected.surface));
    // A direct path within the same convex polygon avoids an artificial centre detour.
    if (projected.surface === target.surface) connect(id, targetId, projected.position, target.position);
    arrivals.push({ id: start.id, node: id, cost: start.cost, state: start.state });
  }
  return routeFrom(graph, arrivals, targetId, { walls, profile });
}
