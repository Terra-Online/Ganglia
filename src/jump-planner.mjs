import { movementGeometry } from './movement-geometry.mjs';
import { createGroundPlanner, groundPreparation } from './ground.mjs';
import { findJumpFrontier, findJumpShortcuts } from './shortcuts.mjs';
import { findJumpConnections } from './traversal.mjs';
import { findRouteShortcuts } from './route-shortcuts.mjs';
import { createGoalProjector } from './goals.mjs';

/** Solve directed ground/jump/drop action combinations for arbitrary arrivals.
 * Geometry, collision, state, walls and body must belong to one immutable snapshot.
 * Discovery supplies supported, swept motion edges. The ground planner jointly
 * selects those edges and continuous ground transfers, then verifies its gait policy.
 * A feasible incumbent is retained unless a complete, timed alternative is faster.
 * Search limits constrain candidate coverage, not the number of actions in a route.
 */
function solveJumpRoute(surfaces, world, starts, goal, options, shared, stage, initial) {
  const { interaction, runAirSpeed, model } = options;
  if (!Number.isFinite(runAirSpeed) || runAirSpeed < 0 || runAirSpeed > model.maxHorizontalSpeed) {
    throw new Error('Invalid running air-speed limit');
  }
  if (options.maxShortcutCandidates !== undefined &&
      (!Number.isSafeInteger(options.maxShortcutCandidates) || options.maxShortcutCandidates < 0)) {
    throw new Error('Invalid shortcut candidate limit');
  }
  const planner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  const diagnostics = { strategy: 'surface-action-graph', groundStatus: 'unmapped',
    baselineCost: null, selectedCost: null, truncated: false, searches: [] };
  let best = initial ?? planner.plan(starts, goal, { interaction, connections: options.connections ?? [] }), bestConnections = options.connections ?? [];
  const partialConnections = [...bestConnections];
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
    let incumbent = starts.length === 1 ? best : planner.plan([arrival], goal, { interaction, connections: options.connections ?? [] });
    const discoveryOptions = { ...options, groundPlanner: planner, from: arrival.position, to: goal };
    let remaining = options.maxCandidates;
    // Cheap region-chain proposals cover simple transfers before broad frontiers.
    // The same bounded stage runs for every unresolved query.
    const proposalBudget = stage === 'direction' ? 0 : Math.min(128, Math.floor(remaining / 8));
    if (incumbent.status !== 'complete' && proposalBudget > 0) {
      const proposal = findJumpConnections(surfaces, world, discoveryOptions,
        { arcAttempts: proposalBudget * 2, regionSearches: proposalBudget });
      connections.push(...search(proposal));
      remaining -= proposalBudget;
      if (proposal.connections.length) incumbent = planner.plan([arrival], goal, { interaction, connections });
    }
    const batches = [Math.min(128, remaining), Math.min(128, remaining)], spent = [0, 0];
    const exhausted = new Set();
    const cache = { standing: shared.standing ?? new Map(), motions: shared.motions ?? new Map(),
      exits: shared.exits ?? new Map(), approaches: shared.approaches ?? new Map(),
      geometry: shared.geometry, visibility: shared.visibility, traces: shared.traces, distanceFields: shared.distanceFields };
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
    for (const key of ['standing', 'motions', 'exits', 'approaches', 'geometry', 'visibility', 'traces', 'distanceFields']) shared[key] = cache[key];
    if (incumbent.status !== 'complete') {
      partialConnections.push(...connections.slice(options.connections?.length ?? 0));
      continue;
    }
    if (best.status !== 'complete' || incumbent.cost < best.cost) {
      best = incumbent;
      bestConnections = connections;
    }
    const improvementBudget = Math.min(remaining, options.maxShortcutCandidates ?? remaining);
    if (improvementBudget <= 0) continue;
    const localBaseline = incumbent, localBaseConnections = connections;
    // Preserve the broad comparison's budget and incumbent. A new local heuristic
    // must not displace an alternative already covered by that established pass.
    const alternatives = search(findJumpShortcuts(surfaces, world, { ...discoveryOptions, connections,
      maxCandidates: improvementBudget, baseline: incumbent, speed: options.locomotion?.sprintSpeed ?? options.speed }, cache));
    if (alternatives.length) {
      connections = [...connections, ...alternatives];
      const candidate = planner.plan([arrival], goal, { interaction, connections });
      if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7) incumbent = candidate;
      if (incumbent.cost < best.cost - 1e-7) { best = incumbent; bestConnections = connections; }
    }
    const localBudget = Math.min(128, Math.floor(improvementBudget / 4), remaining - improvementBudget);
    if (localBudget > 0) {
      const local = findRouteShortcuts(surfaces, world, { ...discoveryOptions, connections,
        maxCandidates: localBudget, baseline: localBaseline, speed: options.locomotion?.sprintSpeed ?? options.speed }, cache);
      const additions = search(local);
      if (additions.length) {
        const localConnections = [...localBaseConnections, ...additions];
        const localRoute = planner.plan([arrival], goal, { interaction, connections: localConnections });
        if (localRoute.status === 'complete' && localRoute.cost < best.cost - 1e-7) {
          best = localRoute; bestConnections = localConnections;
        }
        connections = [...connections, ...additions];
        const candidate = planner.plan([arrival], goal, { interaction, connections });
        if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7) incumbent = candidate;
        if (incumbent.cost < best.cost - 1e-7) { best = incumbent; bestConnections = connections; }
      }
    }
  }
  if (best.status === 'complete') diagnostics.selectedCost = best.cost;
  return { route: best, connections: best.status === 'complete' ? bestConnections : partialConnections, diagnostics };
}

/** Coarse waypoints guide bounded action discovery; they never grant passage or
 * constrain the final route to visit those points. Only the accumulated physically
 * validated actions enter the final, jointly timed start-to-goal query.
 */
function planDirectedRoute(surfaces, world, starts, goal, options) {
  const { waypoints, onProgress, ...base } = options;
  if (waypoints !== undefined && (!Array.isArray(waypoints) || waypoints.length > 128 ||
      waypoints.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)))) {
    throw new Error('Invalid coarse waypoints');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('Invalid route progress callback');
  const shared = {};
  if (!waypoints?.length) return solveJumpRoute(surfaces, world, starts, goal, base, shared, 'final');
  const planner = base.groundPlanner ?? createGroundPlanner(surfaces, base);
  const initialConnections = base.connections ?? [];
  const initial = planner.plan(starts, goal, { interaction: base.interaction, connections: initialConnections });
  if (initial.status === 'complete') {
    return solveJumpRoute(surfaces, world, starts, goal, { ...base, groundPlanner: planner }, shared, 'final', initial);
  }
  const prepared = groundPreparation(planner);
  const project = prepared?.projectGoal ?? createGoalProjector(surfaces), searches = [];
  const topology = prepared && movementGeometry(surfaces, { ...base, groundPlanner: planner }).topology;
  const regions = new Set(), directions = [];
  for (const point of waypoints) {
    const witness = project(point, { maxVertical: base.maxVertical,
      interaction: { radius: base.maxHorizontalDistance, maxVertical: base.profile.height * 2 } })[0];
    if (!witness) {
      searches.push({ point: [...point], status: 'unmapped', added: 0 });
      continue;
    }
    // Several coarse cells can describe the same mutually ground-reachable region.
    // Spend discovery on its interface once, not once per arbitrary cell centre.
    // Only directed, wall-filtered ground connectivity authorizes this grouping;
    // spatial proximity and one-way drops must not merge floors.
    const region = topology ? topology.components[topology.ids.get(witness.surface)] : witness.surface;
    if (regions.has(region)) continue;
    regions.add(region);
    directions.push({ point, witness });
  }
  const budget = Math.floor(base.maxCandidates / (2 * Math.max(1, directions.length)));
  let connections = initialConnections, remaining = base.maxCandidates;
  let goalRoute = initial, goalConnections = connections;
  for (const [index, { point, witness }] of directions.entries()) {
    if (budget < 1) break;
    onProgress?.({ phase: 'direction-search', completed: index, total: directions.length });
    const previous = connections.length;
    const result = solveJumpRoute(surfaces, world, starts, witness.position, { ...base,
      groundPlanner: planner, interaction: undefined, connections, maxCandidates: budget, maxShortcutCandidates: 0 }, shared, 'direction');
    if (result.diagnostics.searches.length) remaining -= budget;
    connections = result.connections;
    searches.push({ point: [...point], support: witness.position, status: result.route.status,
      added: connections.length - previous, diagnostics: result.diagnostics });
    onProgress?.({ phase: 'direction-search', completed: index + 1, total: directions.length,
      status: result.route.status, connections: connections.length });
    if (connections.length - (base.connections?.length ?? 0) >= base.maxLinks) break;
    if (connections.length > previous) {
      goalRoute = planner.plan(starts, goal, { interaction: base.interaction, connections });
      goalConnections = connections;
      if (goalRoute.status === 'complete') break;
    }
  }
  // The final phase starts from the same goal probe whenever the action list is
  // unchanged. Carry that result through this call, without a route-result cache.
  const unchanged = goalConnections.length === connections.length &&
    goalConnections.every((connection, index) => connection === connections[index]);
  const result = solveJumpRoute(surfaces, world, starts, goal, { ...base,
    groundPlanner: planner, connections, maxCandidates: remaining }, shared, 'final', unchanged ? goalRoute : undefined);
  result.diagnostics.directions = { requestedGoals: waypoints.length, regions: directions.length,
    budgetPerGoal: budget, remaining, searches };
  return result;
}

/** Preserve completed searches, then resolve causal entry approaches when known
 * actions can reach the goal from a still-inaccessible region. Each retained entry
 * gets an explicit bounded query. Only a complete joint final-goal solve is returned.
 */
export function planJumpRoute(surfaces, world, starts, goal, options) {
  const result = planDirectedRoute(surfaces, world, starts, goal, options);
  if (result.route.status === 'complete' || !options.connections?.length) return result;
  const planner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  const known = options.connections;
  const probe = (position, target, interaction) => planner.plan([
    { id: '@device-entry', position, state: 'available', cost: 0 },
  ], target, { interaction, connections: known }).status === 'complete';
  const entries = known.filter(edge => edge.state === 'open' &&
    probe(edge.points[0], goal, options.interaction));
  // A reachable upstream entry already covers its downstream device entries.
  // Keep one representative for mutual reachability, preserving directed chains.
  const sources = entries.filter((edge, index) => !entries.some((other, j) => j !== index &&
    probe(other.points[0], edge.points[0]) && (!probe(edge.points[0], other.points[0]) || j < index)));
  if (!sources.length) return result;
  const attempts = { budgetPerGoal: options.maxCandidates, goals: sources.length, searches: [] };
  for (const [index, edge] of sources.entries()) {
    options.onProgress?.({ phase: 'device-entry-search', completed: index, total: sources.length });
    const trial = planDirectedRoute(surfaces, world, starts, edge.points[0], {
      ...options, groundPlanner: planner, interaction: undefined, waypoints: undefined, maxShortcutCandidates: 0,
    });
    const route = planner.plan(starts, goal, { interaction: options.interaction, connections: trial.connections });
    attempts.searches.push({ device: edge.id, status: route.status, discovery: trial.diagnostics });
    options.onProgress?.({ phase: 'device-entry-search', completed: index + 1, total: sources.length, status: route.status });
    if (route.status === 'complete') return { ...result, route, connections: trial.connections,
      diagnostics: { ...result.diagnostics, selectedCost: route.cost, deviceApproaches: attempts } };
  }
  result.diagnostics.deviceApproaches = attempts;
  return result;
}
