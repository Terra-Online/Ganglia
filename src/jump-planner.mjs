import { createGroundPlanner } from './ground.mjs';
import { findJumpConnections } from './traversal.mjs';
import { findJumpShortcuts } from './shortcuts.mjs';

/** Solve directed ground/jump/drop action combinations for arbitrary arrivals.
 * Geometry, collision, state, walls and body must belong to one immutable snapshot.
 * Discovery supplies supported, swept motion edges. The ground planner jointly
 * selects those edges and continuous ground transfers, then verifies its gait policy.
 * A feasible incumbent is retained unless a complete, timed alternative is faster.
 * Search limits constrain candidate coverage, not the number of actions in a route.
 */
export function planJumpRoute(surfaces, world, starts, goal, options) {
  const { interaction, runAirSpeed, model } = options;
  if (!Number.isFinite(runAirSpeed) || runAirSpeed < 0 || runAirSpeed > model.maxHorizontalSpeed) {
    throw new Error('Invalid running air-speed limit');
  }
  const planner = createGroundPlanner(surfaces, options);
  const diagnostics = { strategy: 'surface-action-graph', groundStatus: 'unmapped',
    baselineCost: null, selectedCost: null, truncated: false, searches: [] };
  let best = planner.plan(starts, goal, { interaction }), bestConnections = options.connections ?? [];
  diagnostics.groundStatus = best.status;
  if (best.status === 'complete') diagnostics.baselineCost = best.cost;
  const ids = new Set(bestConnections.map(connection => connection.id));
  let serial = 0;
  const withGait = connection => {
    const from = connection.points[0], to = connection.points.at(-1);
    const velocity = Math.hypot(to[0] - from[0], to[2] - from[2]) / connection.times.at(-1);
    let id = connection.id;
    while (ids.has(id)) id = `jump-plan/${serial++}`;
    ids.add(id);
    return { ...connection, id, ...(velocity > runAirSpeed + 1e-7 ? { requiredGait: 'sprint' } : {}) };
  };
  const search = discovery => {
    diagnostics.searches.push(discovery.diagnostics);
    diagnostics.truncated ||= discovery.diagnostics.truncated;
    return discovery.connections.map(withGait);
  };
  for (const arrival of starts) {
    if (arrival.state !== 'available' || (best.status === 'complete' && arrival.cost >= best.cost)) continue;
    let connections = [...(options.connections ?? [])];
    let incumbent = starts.length === 1 ? best : planner.plan([arrival], goal, { interaction });
    const discoveryOptions = { ...options, from: arrival.position, to: goal };
    if (incumbent.status !== 'complete') {
      connections.push(...search(findJumpConnections(surfaces, world, discoveryOptions)));
      incumbent = createGroundPlanner(surfaces, { ...options, connections }).plan([arrival], goal, { interaction });
    }
    if (incumbent.status !== 'complete') continue;
    if (best.status !== 'complete' || incumbent.cost < best.cost) {
      best = incumbent;
      bestConnections = connections;
    }
    const alternatives = search(findJumpShortcuts(surfaces, world, { ...discoveryOptions, connections,
      baseline: incumbent, speed: options.locomotion?.sprintSpeed ?? options.speed }));
    if (!alternatives.length) continue;
    connections = [...connections, ...alternatives];
    const candidate = createGroundPlanner(surfaces, { ...options, connections }).plan([arrival], goal, { interaction });
    if (candidate.status === 'complete' && candidate.cost < best.cost - 1e-7) {
      best = candidate;
      bestConnections = connections;
    }
  }
  if (best.status === 'complete') diagnostics.selectedCost = best.cost;
  return { route: best, connections: bestConnections, diagnostics };
}
