import { surfaceGraph, projectPoint } from './surfaces.mjs';
import { routeFrom } from './routes.mjs';
import { validateMotion } from './motion.mjs';
import { createGoalProjector } from './goals.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { retimeGroundRoute } from './locomotion.mjs';

/** Ground endpoints retain their projected positions. Each connector lies within its
 * convex source polygon; only the importer may select admissible surfaces/state.
 * Directed connections must already have grounded endpoints and validated trajectories.
 * Teleport entry costs are seconds, and unknown availability never grants access.
 */
export function planGroundRoute(surfaces, starts, goal, options) {
  return createGroundPlanner(surfaces, options).plan(starts, goal);
}

/** Prepare shared topology and ground visibility once for repeated, independent queries.
 * A caller must rebuild the planner when scene state, geometry or constraints change.
 * Search selects a corridor; continuous ground tracing removes unnecessary graph turns.
 * This does not establish a globally shortest path across every possible corridor.
 */
export function createGroundPlanner(surfaces, options) {
  const { speed, maxVertical, walls, profile, connections = [] } = options;
  const base = surfaceGraph(surfaces, { speed, portals: options.portals });
  const straighten = createGroundStraightener(surfaces, options);
  const projectGoal = createGoalProjector(surfaces);
  return { plan(starts, goal, query = {}) {
    const graph = { nodes: [...base.nodes], edges: [...base.edges] };
    const targets = projectGoal(goal, { maxVertical, interaction: query.interaction });
    if (!targets.length) return { status: 'unmapped' };
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
    const targetIds = targets.map(endpoint);
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
    // Compare actual continuous lengths and movement times for each available origin.
    // Centre-corridor costs alone can rank nearby teleport arrivals incorrectly.
    let best = null;
    for (const arrival of arrivals) {
      if (best && arrival.cost >= best.cost) continue;
      const candidate = routeFrom(graph, [arrival], targetIds, { walls, profile });
      if (candidate.status !== 'complete') continue;
      const continuous = straightenRoute(candidate, straighten, speed);
      const timed = options.locomotion ? retimeGroundRoute(continuous, options.locomotion) : continuous;
      if (!best || timed.cost < best.cost) best = timed;
    }
    return best ?? { status: arrivals.length ? 'no-verified-route' : 'unmapped' };
  } };
}

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

function straightenRoute(route, straighten, speed) {
  const segments = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const points = straighten(pending);
    pending = [];
    if (points.length < 2) return;
    const times = [0];
    for (let i = 1; i < points.length; i++) times.push(times[i - 1] + distance(points[i - 1], points[i]) / speed);
    segments.push({ mode: 'walk', points, times });
  };
  for (const segment of route.segments) {
    if (segment.mode !== 'walk') {
      flush(); segments.push(segment); continue;
    }
    if (!pending.length) pending.push(segment.points[0]);
    for (const point of segment.points.slice(1)) {
      if (distance(pending.at(-1), point) > 1e-9) pending.push(point);
    }
  }
  flush();
  const points = [[...route.points[0]]];
  for (const segment of segments) for (const point of segment.points.slice(1)) {
    if (distance(points.at(-1), point) > 1e-9) points.push([...point]);
  }
  return { ...route, points, segments,
    cost: route.arrivalCost + segments.reduce((sum, segment) => sum + segment.times.at(-1), 0),
    length: points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0),
  };
}
