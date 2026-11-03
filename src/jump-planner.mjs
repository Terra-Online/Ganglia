import { createGroundPlanner } from './ground.mjs';
import { findJumpFrontier, findJumpShortcuts } from './shortcuts.mjs';

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
    let velocity = connection.peakHorizontalSpeed ?? 0;
    for (let index = 1; index < connection.points.length; index++) {
      const point = connection.points[index], previous = connection.points[index - 1];
      velocity = Math.max(velocity, Math.hypot(point[0] - previous[0], point[2] - previous[2]) /
        (connection.times[index] - connection.times[index - 1]));
    }
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
    let remaining = options.maxCandidates;
    const batches = [Math.min(128, remaining), Math.min(128, remaining)], spent = [0, 0];
    const exhausted = new Set();
    const cache = { standing: new Map(), motions: new Map(), exits: new Map(), approaches: new Map() };
    while (incumbent.status !== 'complete' && remaining > 0) {
      const maxLinks = options.maxLinks - connections.length + (options.connections?.length ?? 0);
      if (maxLinks <= 0) { diagnostics.truncated = true; break; }
      const side = exhausted.has(false) ? 1 : exhausted.has(true) ? 0 : Number(spent[1] < spent[0]);
      const reverse = side === 1;
      const discovery = findJumpFrontier(surfaces, world, { ...discoveryOptions, connections,
        maxCandidates: Math.min(batches[side], remaining), maxLinks,
        speed: options.locomotion?.sprintSpeed ?? options.speed }, cache, reverse);
      const additions = search(discovery);
      // Directed frontiers grow from both ends. Balance charged work, so repeated
      // failures on one side cannot starve a productive chain on the other.
      // One shared budget permits arbitrary hop counts without a depth cap.
      const work = discovery.diagnostics;
      const charged = Math.max(1, Math.ceil(work.attempted / 2), Math.ceil(work.seedChecks / 16),
        Math.ceil(work.neighbourChecks / 64), Math.ceil(work.endpointChecks / 4));
      remaining -= charged;
      spent[side] += charged;
      if (!additions.length) {
        if (work.reason === 'unmapped-endpoint') break;
        if (!work.truncated) {
          exhausted.add(reverse);
          if (exhausted.size === 2) break;
        }
        batches[side] = Math.min(options.maxCandidates, batches[side] * 2);
        continue;
      }
      exhausted.clear();
      batches[side] = Math.min(128, remaining);
      connections.push(...additions);
      incumbent = planner.plan([arrival], goal, { interaction, connections });
    }
    if (incumbent.status !== 'complete') continue;
    if (best.status !== 'complete' || incumbent.cost < best.cost) {
      best = incumbent;
      bestConnections = connections;
    }
    if (remaining <= 0) continue;
    const alternatives = search(findJumpShortcuts(surfaces, world, { ...discoveryOptions, connections,
      maxCandidates: remaining, baseline: incumbent, speed: options.locomotion?.sprintSpeed ?? options.speed }, cache));
    if (!alternatives.length) continue;
    connections = [...connections, ...alternatives];
    const candidate = planner.plan([arrival], goal, { interaction, connections });
    if (candidate.status === 'complete' && candidate.cost < best.cost - 1e-7) {
      best = candidate;
      bestConnections = connections;
    }
  }
  if (best.status === 'complete') diagnostics.selectedCost = best.cost;
  return { route: best, connections: bestConnections, diagnostics };
}
