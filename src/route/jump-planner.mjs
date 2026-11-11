import { planBoostedRoute } from './boosted-route.mjs';
import { planAirborneGoal } from './airborne-goal.mjs';
import { movementGeometry } from './movement-geometry.mjs';
import { createGroundPlanner, groundPreparation } from './ground.mjs';
import { findJumpFrontier, findJumpShortcuts } from '../search/shortcuts.mjs';
import { findJumpConnections } from '../search/traversal.mjs';
import { findRouteShortcuts } from './route-shortcuts.mjs';
import { createGoalProjector, findGoalHit, markTerminalGoal } from '../motion/goals.mjs';

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
  let best = initial ?? planner.plan(starts, goal, { interaction, endpointTolerance: options.endpointTolerance, connections: options.connections ?? [] }), bestConnections = options.connections ?? [];
  const partialConnections = new Map(bestConnections.map(edge => [edge.id, edge]));
  diagnostics.groundStatus = best.status;
  if (best.status === 'complete') diagnostics.baselineCost = best.cost;
  const ids = new Set(bestConnections.map(connection => connection.id));
  let serial = 0;
  let unspent = options.maxCandidates;
  const actions = new Map();
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
    const additions = [];
    for (const connection of discovery.connections) {
      const { id, ...motion } = withGait(connection);
      const key = JSON.stringify(motion);
      if (actions.has(key)) continue;
      const action = { id, ...motion };
      actions.set(key, action);
      additions.push(action);
    }
    return additions;
  };
  for (const arrival of starts) {
    if (arrival.state !== 'available' || (best.status === 'complete' && arrival.cost >= best.cost)) continue;
    const known = new Map((options.connections ?? []).map(edge => [edge.id, edge]));
    for (const action of actions.values()) known.set(action.id, action);
    let connections = [...known.values()];
    const initialConnections = connections.length;
    for (const connection of connections) ids.add(connection.id);
    let incumbent = starts.length === 1 && connections.length === (options.connections?.length ?? 0)
      ? best : planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections });
    const discoveryOptions = { ...options, groundPlanner: planner, from: arrival.position, to: goal,
      ...(Number.isFinite(options.costBound) ? { costBound: options.costBound - arrival.cost } : {}) };
    let remaining = options.maxCandidates;
    // Cheap region-chain proposals cover simple transfers before broad frontiers.
    // The same bounded stage runs for every unresolved query.
    const proposalBudget = stage === 'relations' ? remaining : Math.min(128, Math.floor(remaining / 8));
    if (incumbent.status !== 'complete' && proposalBudget > 0) {
      const proposal = findJumpConnections(surfaces, world, discoveryOptions,
        { arcAttempts: proposalBudget * 2, regionSearches: proposalBudget });
      connections.push(...search(proposal));
      remaining = stage === 'relations' ? 0 : remaining - proposalBudget;
      if (proposal.connections.length) incumbent = planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections });
    }
    const batches = [Math.min(128, remaining), Math.min(128, remaining)], spent = [0, 0];
    const exhausted = new Set();
    // The cache owns one current endpoint/model binding. Sharing the owner also
    // preserves cursor invalidations when nested direction or entry queries change it.
    const cache = shared;
    cache.standing ??= new Map();
    cache.motions ??= new Map();
    cache.exits ??= new Map();
    cache.approaches ??= new Map();
    while (incumbent.status !== 'complete' && remaining > 0) {
      const maxLinks = options.maxLinks - connections.length + initialConnections;
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
      incumbent = planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections });
    }
    if (incumbent.status !== 'complete') {
      unspent = 0;
      for (const connection of connections) partialConnections.set(connection.id, connection);
      continue;
    }
    if (best.status !== 'complete' || incumbent.cost < best.cost) {
      best = incumbent;
      bestConnections = connections;
    }
    const improvementBudget = Math.min(remaining, options.maxShortcutCandidates ?? remaining);
    if (improvementBudget <= 0) {
      unspent = Math.min(unspent, Math.max(0, remaining));
      continue;
    }
    const localBaseline = incumbent;
    const localBaseConnections = connections;
    const localBudget = Math.min(128, Math.floor(improvementBudget / 4), remaining - improvementBudget);
    const refinementBudget = Math.min(localBudget, remaining - improvementBudget - localBudget);
    unspent = Math.min(unspent, Math.max(0, remaining - improvementBudget - localBudget - refinementBudget));
    // Keep the broad comparison's budget, then refine its current verified
    // incumbent so local candidates follow the route that can actually improve.
    const alternatives = search(findJumpShortcuts(surfaces, world, { ...discoveryOptions, connections,
      maxCandidates: improvementBudget, baseline: incumbent, speed: options.locomotion?.sprintSpeed ?? options.speed }, cache));
    if (alternatives.length) {
      connections = [...connections, ...alternatives];
      const candidate = planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections });
      if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7) incumbent = candidate;
      if (incumbent.cost < best.cost - 1e-7) { best = incumbent; bestConnections = connections; }
    }
    for (const [baseline, baseConnections, budget] of [
      [localBaseline, localBaseConnections, localBudget],
      [incumbent, connections, incumbent === localBaseline ? 0 : refinementBudget],
    ]) {
      if (budget <= 0) continue;
      const local = findRouteShortcuts(surfaces, world, { ...discoveryOptions, connections,
        maxCandidates: budget, baseline, speed: options.locomotion?.sprintSpeed ?? options.speed }, cache);
      const additions = search(local);
      if (additions.length) {
        const localConnections = [...baseConnections, ...additions];
        const localRoute = planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections: localConnections });
        if (localRoute.status === 'complete' && localRoute.cost < best.cost - 1e-7) {
          best = localRoute; bestConnections = localConnections;
        }
        connections = [...connections, ...additions];
        const candidate = planner.plan([arrival], goal, { interaction, endpointTolerance: options.endpointTolerance, connections });
        if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7) incumbent = candidate;
        if (incumbent.cost < best.cost - 1e-7) { best = incumbent; bestConnections = connections; }
      }
    }
  }
  diagnostics.unusedCandidates = unspent;
  if (best.status === 'complete') diagnostics.selectedCost = best.cost;
  return { route: best, connections: best.status === 'complete' ? bestConnections : [...partialConnections.values()], diagnostics };
}

/** Coarse waypoints guide bounded action discovery; they never grant passage or
 * constrain the final route to visit those points. Only the accumulated physically
 * validated actions enter the final, jointly timed start-to-goal query.
 */
function planDirectedRoute(surfaces, world, starts, goal, options, shared, stage) {
  const { waypoints, onProgress, ...base } = options;
  if (waypoints !== undefined && (!Array.isArray(waypoints) || waypoints.length > 128 ||
      waypoints.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)))) {
    throw new Error('Invalid coarse waypoints');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('Invalid route progress callback');
  if (!waypoints?.length) return solveJumpRoute(surfaces, world, starts, goal, base, shared, stage);
  const planner = base.groundPlanner ?? createGroundPlanner(surfaces, base);
  const initialConnections = base.connections ?? [];
  const initial = planner.plan(starts, goal, { interaction: base.interaction, endpointTolerance: base.endpointTolerance, connections: initialConnections });
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
      goalRoute = planner.plan(starts, goal, { interaction: base.interaction, endpointTolerance: base.endpointTolerance, connections });
      goalConnections = connections;
      if (goalRoute.status === 'complete') break;
    }
  }
  // The final phase starts from the same goal probe whenever the action list is
  // unchanged. Carry that result through this call, without a route-result cache.
  const unchanged = goalConnections.length === connections.length &&
    goalConnections.every((connection, index) => connection === connections[index]);
  const result = solveJumpRoute(surfaces, world, starts, goal, { ...base,
      groundPlanner: planner, connections, maxCandidates: remaining }, shared, stage, unchanged ? goalRoute : undefined);
  result.diagnostics.directions = { requestedGoals: waypoints.length, regions: directions.length,
    budgetPerGoal: budget, remaining, searches };
  return result;
}

/** Preserve completed searches, then resolve causal entry approaches when known
 * actions can reach the goal from a still-inaccessible region. Each retained entry
 * gets an explicit bounded query. Only a complete joint final-goal solve is returned.
 */
function planBaseRoute(surfaces, world, starts, goal, options) {
  const shared = {};
  const goalPlanner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  const airborneOnly = options.interaction?.airborne &&
    !goalPlanner.project(goal, { maxVertical: options.maxVertical, interaction: options.interaction }).length;
  // An airborne event has no ground node. Discover its complete flight first,
  // then search the supported departure using the ordinary entry machinery.
  const result = airborneOnly
    ? { route: { status: 'unmapped' }, connections: options.connections ?? [], diagnostics: {
      strategy: 'surface-action-graph', groundStatus: 'unmapped', baselineCost: null,
      selectedCost: null, truncated: false, searches: [],
    } }
    : planDirectedRoute(surfaces, world, starts, goal, { ...options, groundPlanner: goalPlanner }, shared, 'final');
  if (options.interaction?.airborne && result.route.status !== 'complete') {
    const planner = goalPlanner;
    const airborne = planAirborneGoal(surfaces, world, starts, goal, { ...options, groundPlanner: planner }, (position, maxCost) =>
      planDirectedRoute(surfaces, world, starts, position, { ...options, groundPlanner: planner,
        interaction: undefined, endpointTolerance: Math.min(options.maxVertical, options.profile.radius),
        connections: result.connections, maxShortcutCandidates: options.activeBoost ? options.maxCandidates : 0,
        ...(Number.isFinite(maxCost) ? { costBound: maxCost, boundGoal: position } : {}) }, shared, 'entry'));
    result.diagnostics.airborne = airborne.diagnostics;
    result.diagnostics.truncated ||= airborne.diagnostics.truncated;
    if (airborne.route.status === 'complete') return { ...result, route: airborne.route, connections: airborne.connections,
      diagnostics: { ...result.diagnostics, selectedCost: airborne.route.cost } };
  }
  if (result.route.status === 'complete' || !options.connections?.length) return result;
  const planner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  // Failed discovery still contains physically validated actions. Entry searches
  // continue that pool and its geometry preparation within this immutable query.
  let known = result.connections;
  const probe = (position, target, interaction) => planner.plan([
    { id: '@device-entry', position, state: 'available', cost: 0 },
  ], target, { interaction, endpointTolerance: options.endpointTolerance, connections: known }).status === 'complete';
  // Screen entries lazily so an early complete route can be published without
  // first solving every pair of device approaches. Exact-coordinate duplicates
  // share the same fresh entry state; distinct positions retain their own trial.
  const sources = [...new Map(known.filter(edge => edge.state === 'open' && !edge.terminal)
    .map(edge => [JSON.stringify(edge.points[0]), edge])).values()];
  let eligible = false;
  const geometry = movementGeometry(surfaces, { ...options, groundPlanner: planner });
  const regions = new Map(sources.map(edge => {
    const support = geometry.projectSupport(edge.points[0], edge.endpointTolerance ?? 1e-6, edge.fromSurface);
    const component = support && geometry.topology.components[geometry.topology.ids.get(support.surface)];
    return [edge, component ?? edge.id];
  }));
  // More discovered entries must not shrink every approach below a useful
  // search quota. Rank regions by geometric approach cost, then give each trial
  // a fixed share of one fallback budget. This score orders coverage only.
  const arrivals = starts.filter(start => start.state === 'available');
  const scores = new Map(sources.map(edge => [edge, Math.min(...arrivals.map(start =>
    start.cost + Math.hypot(...edge.points[0].map((value, axis) => value - start.position[axis])) / options.speed))]));
  sources.sort((a, b) => scores.get(a) - scores.get(b));
  const entryBudget = Math.min(options.maxCandidates, Math.max(128, Math.floor(options.maxCandidates / 8)));
  let entryRemaining = options.maxCandidates;
  const attempts = { budgetPerGoal: entryBudget, goals: sources.length, searches: [] };
  const searchedRegions = new Set();
  for (const [index, edge] of sources.entries()) {
    const region = regions.get(edge);
    // One entry discovery covers a mutually walk-reachable ground region. This
    // reuses the existing directed ground proof without solving every entry pair.
    if (region !== undefined && region !== null && searchedRegions.has(region)) continue;
    options.onProgress?.({ phase: 'device-entry-search', completed: index, total: sources.length });
    if (!probe(edge.points[0], goal, options.interaction)) {
      options.onProgress?.({ phase: 'device-entry-search', completed: index + 1,
        total: sources.length, status: 'no-verified-route' });
      continue;
    }
    if (entryRemaining <= 0) {
      result.diagnostics.truncated = true;
      break;
    }
    eligible = true;
    if (region !== undefined && region !== null) searchedRegions.add(region);
    const budget = Math.min(entryBudget, entryRemaining);
    const trial = planDirectedRoute(surfaces, world, starts, edge.points[0], {
      ...options, groundPlanner: planner, connections: known,
      interaction: undefined, waypoints: undefined, maxShortcutCandidates: 0, maxCandidates: budget,
    }, shared, 'entry');
    entryRemaining -= budget;
    result.diagnostics.truncated ||= trial.diagnostics.truncated;
    known = trial.connections;
    const route = planner.plan(starts, goal, { interaction: options.interaction, connections: trial.connections });
    attempts.searches.push({ device: edge.id, budget, status: route.status, discovery: trial.diagnostics });
    options.onProgress?.({ phase: 'device-entry-search', completed: index + 1, total: sources.length, status: route.status });
    if (route.status === 'complete') {
      const improvement = solveJumpRoute(surfaces, world, starts, goal, { ...options,
        groundPlanner: planner, connections: trial.connections,
        maxCandidates: trial.diagnostics.unusedCandidates }, shared, 'final', route);
      return { ...result, route: improvement.route, connections: improvement.connections,
        diagnostics: { ...result.diagnostics, selectedCost: improvement.route.cost,
          deviceApproaches: attempts, deviceImprovement: improvement.diagnostics } };
    }
  }
  if (!eligible) {
    // New action chains supplement an unresolved primary query. Earlier feasible
    // searches keep their original discovery and shortcut budgets.
    const continuation = solveJumpRoute(surfaces, world, starts, goal, { ...options,
      groundPlanner: planner, connections: known, maxCandidates: Math.min(128, options.maxCandidates),
      maxShortcutCandidates: 0 }, shared, 'relations');
    return { ...continuation, diagnostics: { ...result.diagnostics,
      selectedCost: continuation.diagnostics.selectedCost, knownActionChains: continuation.diagnostics } };
  }
  result.connections = known;
  result.diagnostics.deviceApproaches = attempts;
  return result;
}

export function planJumpRoute(surfaces, world, starts, goal, options) {
  const result = planBaseRoute(surfaces, world, starts, goal, options);
  const best = options.boosts?.length
    ? planBoostedRoute(surfaces, world, starts, goal, options, result, planBaseRoute)
    : result;
  if (options.interaction?.airborne && best.route.status === 'complete' && !best.route.goalHit) {
    const point = best.route.points.at(-1);
    if (findGoalHit([point, point], goal, options.interaction)) best.route = markTerminalGoal(best.route);
  }
  return best;
}
