import { surfaceGraph, surfacePortals, projectPoint } from './surfaces.mjs';
import { createRoutePlanner } from './routes.mjs';
import { validateMotion } from './motion.mjs';
import { createGoalProjector } from './goals.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { retimeGroundRoute } from './locomotion.mjs';
import { createWallChecker } from './walls.mjs';

const preparations = new WeakMap();
/** Internal immutable preparation shared with action discovery for the same planner. */
export const groundPreparation = planner => preparations.get(planner);

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
  // Compare action times at the fastest permitted ground gait. The existing
  // resource scheduler verifies the complete selected motion sequence afterwards.
  const searchSpeed = options.locomotion?.sprintSpeed ?? speed;
  const portals = surfacePortals(surfaces);
  const base = surfaceGraph(surfaces, { speed: searchSpeed, portals: options.portals }, portals);
  const routeBase = createRoutePlanner(base, { walls, profile });
  const blocked = createWallChecker(walls, profile);
  let supportRoute;
  const baseCenters = new Map(base.nodes.map(node => [node.id, node.position]));
  const byId = new Map(surfaces.map(surface => [surface.id, surface]));
  const straighten = createGroundStraightener(surfaces, options, portals);
  const projectGoal = createGoalProjector(surfaces);
  let targetKey;
  const visibility = new Map();
  const planner = { project: projectGoal, plan(starts, goal, query = {}) {
    // Action discovery extends one goal query repeatedly. Retain its continuous
    // transfers while dropping them when the target changes, bounding cross-query storage.
    const key = JSON.stringify([goal, query.interaction]);
    if (key !== targetKey) { visibility.clear(); targetKey = key; }
    const graph = { nodes: [], edges: [] };
    const targets = projectGoal(goal, { maxVertical, interaction: query.interaction });
    if (!targets.length) return { status: 'unmapped' };
    const centers = baseCenters;
    const endpoints = new Map();
    let serial = 0;
    const unique = () => {
      let id;
      do { id = `@endpoint/${serial++}`; } while (centers.has(id));
      return id;
    };
    const connect = (from, to, a, b) => graph.edges.push({ from, to, state: 'open',
      points: [a, b], cost: Math.hypot(...a.map((v, i) => v - b[i])) / searchSpeed });
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
      peers.push({ id, position: projected.position, support: projected.support ?? projected.position });
      endpoints.set(projected.surface, peers);
      return id;
    };
    const targetIds = targets.map(endpoint);
    const goals = new Set(targetIds);
    const arrivals = [], ids = new Set();
    for (const start of starts) {
      if (typeof start.id !== 'string' || ids.has(start.id) || !Number.isFinite(start.cost) || start.cost < 0 ||
          !['available', 'locked', 'unknown'].includes(start.state)) throw new Error('Invalid arrival');
      ids.add(start.id);
      const projected = projectGoal(start.position, { maxVertical })[0];
      if (!projected || start.state !== 'available') continue;
      arrivals.push({ id: start.id, node: endpoint(projected), cost: start.cost, state: start.state });
    }
    const connectionIds = new Set();
    for (const connection of query.connections ?? connections) {
      const { id, mode, points, times, state, requiredGait } = connection;
      if (typeof id !== 'string' || !id || connectionIds.has(id) || mode === undefined || mode === 'walk' ||
          !['open', 'closed', 'unknown'].includes(state) || !Array.isArray(points) || points.length < 2 ||
          points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) || !Array.isArray(times)) {
        throw new Error('Invalid ground connection');
      }
      connectionIds.add(id);
      const cost = times.at(-1);
      validateMotion({ mode, points, times, cost, connection: id, requiredGait });
      if (state !== 'open') continue;
      // Gait-dependent trajectories need an explicit resource policy to prove
      // their entry condition. Other supplied connections remain usable.
      if (requiredGait !== undefined && !options.locomotion) continue;
      // Endpoints default to exact support. Any explicit collision-support allowance
      // stays within body radius and the caller's floor-projection limit.
      const tolerance = connection.endpointTolerance ?? 1e-6;
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > Math.max(1e-6, Math.min(maxVertical, profile.radius))) {
        throw new Error('Invalid movement endpoint tolerance');
      }
      for (const surface of [connection.fromSurface, connection.toSurface]) {
        if (surface !== undefined && !byId.has(surface)) throw new Error('Invalid movement support surface');
      }
      const fromProjection = projectPoint(connection.fromSurface === undefined ? surfaces : [byId.get(connection.fromSurface)],
        points[0], { maxVertical: tolerance });
      const toProjection = projectPoint(connection.toSurface === undefined ? surfaces : [byId.get(connection.toSurface)],
        points.at(-1), { maxVertical: tolerance });
      // Explicit collision-validated standing feet may sit above the navigation
      // support plane (rounded capsule support on slopes, or voxel-height error).
      const from = fromProjection && { ...fromProjection, position: points[0], support: fromProjection.position };
      const to = toProjection && { ...toProjection, position: points.at(-1), support: toProjection.position };
      if (!from || !to) continue;
      const fromId = endpoint(from), toId = endpoint(to);
      graph.edges.push({ from: fromId, to: toId, state, cost, mode, points, times, connection: id,
        ...(requiredGait === undefined ? {} : { requiredGait }) });
    }
    // Action decisions use continuous, supported ground transfers whenever the
    // endpoints see each other. Dense triangulation must not make an otherwise
    // cheap walk to a takeoff appear longer than a different jump sequence.
    const groups = [...endpoints.values()];
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      for (const left of groups[a]) for (const right of groups[b]) {
        for (const [from, to] of [[left, right], [right, left]]) {
          if (goals.has(from.id) && goals.has(to.id)) continue;
          const key = JSON.stringify([from.support, to.support]);
          if (!visibility.has(key)) visibility.set(key, straighten.trace(from.support, to.support));
          const traced = visibility.get(key);
          if (!traced) continue;
          const points = [from.position, ...traced.slice(1, -1), to.position];
          const cost = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0) / searchSpeed;
          graph.edges.push({ from: from.id, to: to.id, points, cost, state: 'open' });
        }
      }
    }
    // Compare actual continuous lengths and movement times for each available origin.
    // Centre-corridor costs alone can rank nearby teleport arrivals incorrectly.
    let best = null;
    for (const arrival of arrivals) {
      if (best && arrival.cost >= best.cost) continue;
      let candidate = routeBase(graph, [arrival], targetIds);
      if (candidate.status !== 'complete' && walls.some(wall => wall.state !== 'inactive')) {
        // A blocked polygon centre can disconnect the representative graph even
        // when its support corridor admits a clear continuous path. Try that
        // corridor, then validate every reconstructed segment against all walls.
        supportRoute ??= createRoutePlanner(base, { walls: [], profile });
        candidate = supportRoute(graph, [arrival], targetIds);
      }
      if (candidate.status !== 'complete') continue;
      const continuous = straightenRoute(candidate, straighten, speed);
      if (blocked(continuous.points[0], continuous.points[0]) ||
          continuous.points.slice(1).some((point, index) => blocked(continuous.points[index], point))) continue;
      const timed = options.locomotion ? retimeGroundRoute(continuous, options.locomotion) : continuous;
      if (timed.status !== 'complete') continue;
      if (!best || timed.cost < best.cost) best = timed;
    }
    return best ?? { status: arrivals.length ? 'no-verified-route' : 'unmapped' };
  } };
  preparations.set(planner, { surfaces, portals, straighten, projectGoal, byId, centers: baseCenters,
    graph: base, searchSpeed, importedPortals: options.portals });
  return planner;
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
