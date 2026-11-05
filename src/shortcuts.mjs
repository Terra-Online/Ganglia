import { surfaceGraph, surfacePortals, projectPoint } from './surfaces.mjs';
import { createGoalProjector } from './goals.mjs';
import { landingCandidates, boundaryLanding } from './landings.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createMinHeap } from './heap.mjs';
import { createWallChecker } from './walls.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { groundPreparation } from './ground.mjs';
import { jumpConnection, jumpDuration, runOffConnection, createMotionVariants } from './jumps.mjs';
import { exposedBoundaries, interleave, standingFoot, validateDiscovery } from './traversal.mjs';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function prepareGeometry(surfaces, options) {
  const { walls, profile, portals } = options;
  const blocked = createWallChecker(walls, profile);
  const candidate = groundPreparation(options.groundPlanner);
  const reused = candidate?.surfaces === surfaces ? candidate : undefined;
  const sharedPortals = reused?.portals ?? surfacePortals(surfaces);
  const graph = surfaceGraph(surfaces, { speed: 1, portals }, sharedPortals);
  graph.edges = graph.edges.filter(edge => !edge.points.slice(1).some((point, index) => blocked(edge.points[index], point)));
  const boundaries = exposedBoundaries(surfaces, portals ?? [], sharedPortals).map(boundary => ({ ...boundary,
    min: [0, 1, 2].map(axis => Math.min(boundary.a[axis], boundary.b[axis])),
    max: [0, 1, 2].map(axis => Math.max(boundary.a[axis], boundary.b[axis])) }));
  const landingSurfaces = surfaces.map(surface => ({ ...surface,
    min: [0, 1, 2].map(axis => Math.min(...surface.vertices.map(point => point[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...surface.vertices.map(point => point[axis]))) }));
  return { graph, blocked, boundaries, landingSurfaces,
    boundaryIndex: createBoundsIndex(boundaries), landingIndex: createBoundsIndex(landingSurfaces),
    byId: reused?.byId ?? new Map(surfaces.map(surface => [surface.id, surface])),
    centers: reused?.centers ?? new Map(graph.nodes.map(node => [node.id, node.position])),
    project: reused?.projectGoal ?? createGoalProjector(surfaces),
    visibility: reused?.straighten,
  };
}

const distanceField = (graph, roots, reverse) => {
  const adjacency = new Map(), costs = new Map(), pending = createMinHeap();
  for (const edge of graph.edges) {
    const from = reverse ? edge.to : edge.from, to = reverse ? edge.from : edge.to;
    const edges = adjacency.get(from) ?? [];
    edges.push({ to, cost: edge.cost });
    adjacency.set(from, edges);
  }
  for (const root of roots) {
    if (root.cost >= (costs.get(root.id) ?? Infinity)) continue;
    costs.set(root.id, root.cost);
    pending.push(root);
  }
  while (pending.size) {
    const current = pending.pop();
    if (current.cost !== costs.get(current.id)) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const cost = current.cost + edge.cost;
      if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost);
      pending.push({ id: edge.to, cost });
    }
  }
  return costs;
};

/** Find collision-checked jump/drop alternatives to a complete route.
 * Existing connections participate in reachability and candidate ordering, so a
 * shortcut can precede or follow another jump. Boundaries seed takeoffs; landings
 * are continuous points on nearby surface interiors, including floors below a ledge.
 * The caller must compare final grounded, resource-timed routes. Sampling is bounded
 * and does not establish a globally time-optimal route.
 */
export function findJumpShortcuts(surfaces, world, options, cache) {
  return findConnections(surfaces, world, options, false, cache);
}

/** Expand verified actions from currently reachable ground into new surfaces. */
export function findJumpFrontier(surfaces, world, options, cache, reverse = false) {
  return findConnections(surfaces, world, options, true, cache, reverse);
}

function findConnections(surfaces, world, options, frontier, cache, reverse = false) {
  validateDiscovery(world, options);
  const { profile, walls, from, to, interaction, maxVertical, maxSlope,
    maxDrop, maxHorizontalDistance, sampleSpacing, maxCandidates, maxLinks, model,
    baseline, speed, connections: existing = [] } = options;
  if ((!frontier && (baseline?.status !== 'complete' || !Number.isFinite(baseline.cost) || baseline.cost < 0 ||
      !Number.isFinite(baseline.arrivalCost) || baseline.arrivalCost < 0)) || !Number.isFinite(speed) || speed <= 0) {
    throw new Error('Invalid shortcut baseline or ground speed');
  }
  const diagnostics = { reason: frontier ? (reverse ? 'goal-frontier' : 'reachable-frontier') : 'searched', baselineCost: baseline?.cost ?? null, boundaryEdges: 0,
    seedChecks: 0, candidatePairs: 0, neighbourChecks: 0, endpointChecks: 0,
    attempted: 0, accepted: 0, truncated: false, goalFaces: 0,
    rejected: { support: 0, projection: 0, clearance: 0, range: 0, motion: 0, groundDominated: 0 },
    limits: { seedChecks: maxCandidates * 16, neighbourChecks: maxCandidates * 64,
      endpointChecks: maxCandidates * 4, arcAttempts: maxCandidates * 2, maxLinks } };
  const prepared = cache?.geometry ?? prepareGeometry(surfaces, options);
  if (cache) cache.geometry = prepared;
  const { blocked, byId, centers, project, boundaries } = prepared;
  const connections = [];
  let visibility = cache?.visibility ?? prepared.visibility;
  const traces = cache?.traces ?? new Map();
  if (cache) cache.traces = traces;
  const groundTrace = (start, end) => {
    const key = JSON.stringify([start, end]);
    if (!traces.has(key)) {
      visibility ??= createGroundStraightener(surfaces, { walls, profile });
      if (cache) cache.visibility = visibility;
      traces.set(key, visibility.trace(start, end));
    }
    return traces.get(key);
  };
  const approaches = cache?.approaches ?? new Map();
  const motionVariants = createMotionVariants(model, world, profile, cache?.exits, approaches);
  const graph = { nodes: prepared.graph.nodes, edges: [...prepared.graph.edges] };
  const source = cache?.source ?? project(from, { maxVertical })[0];
  const goals = cache?.goals ?? project(to, { maxVertical, interaction });
  if (cache) { cache.source = source; cache.goals = goals; }
  diagnostics.goalFaces = goals.length;
  if (!source || !goals.length) { diagnostics.reason = 'unmapped-endpoint'; return { connections, diagnostics }; }
  for (const connection of existing) {
    if (connection.state !== 'open') continue;
    const fromFaces = connection.fromSurface === undefined ? surfaces : [byId.get(connection.fromSurface)];
    const toFaces = connection.toSurface === undefined ? surfaces : [byId.get(connection.toSurface)];
    if (!fromFaces[0] || !toFaces[0]) throw new Error('Invalid movement support surface');
    const a = projectPoint(fromFaces, connection.points[0], { maxVertical });
    const b = projectPoint(toFaces, connection.points.at(-1), { maxVertical });
    if (!a || !b) continue;
    if (connection.points.slice(1).some((point, index) => blocked(connection.points[index], point))) continue;
    const approach = groundTrace(source.position, a.position);
    if (approach) graph.edges.push({ from: source.surface, to: a.surface,
      cost: approach.slice(1).reduce((sum, point, index) => sum + distance(approach[index], point), 0) });
    graph.edges.push({ from: a.surface, to: b.surface, points: connection.points,
      cost: distance(centers.get(a.surface), a.position) + connection.times.at(-1) * speed +
        distance(b.position, centers.get(b.surface)) });
  }
  const approach = distanceField(graph, [{ id: source.surface,
    cost: distance(source.position, centers.get(source.surface)) }], false);
  const departure = distanceField(graph, goals.map(goal => ({ id: goal.surface,
    cost: distance(goal.position, centers.get(goal.surface)) })), true);
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius), diversity = profile.radius * 2;
  const cellOf = position => position.map(value => Math.floor(value / diversity)).join('/');
  const durationLimit = frontier ? Infinity : baseline.cost - baseline.arrivalCost;
  let travelSpeed = Math.max(speed, model.maxHorizontalSpeed);
  for (const connection of existing) for (let index = 1; index < connection.points.length; index++) {
    const elapsed = connection.times[index] - connection.times[index - 1];
    if (elapsed > 0) travelSpeed = Math.max(travelSpeed,
      horizontal(connection.points[index - 1], connection.points[index]) / elapsed);
  }
  const lowerBound = (start, end, airTime) =>
    (horizontal(from, start) + Math.max(0, horizontal(end, to) - (interaction?.radius ?? 0))) /
      travelSpeed + airTime;
  const insets = [...new Set([0, profile.radius, 1, 2, 3, 0.5, 1.5, 2.5, profile.radius * 0.5, profile.radius * 0.25])];
  const takeoffs = [], seen = new Set();
  // Ordering is a heuristic only. It must not exclude a jump because a polygon
  // centre corridor overestimates the continuous approach or departure distance.
  const ordering = cache?.ordering ?? (() => {
    const scores = new Map(boundaries.map(edge => {
      const source = distance(from, edge.midpoint), target = distance(edge.midpoint, to);
      return [edge, { source, target, line: source + target }];
    }));
    return { scores, source: [...boundaries].sort((a, b) => scores.get(a).source - scores.get(b).source), target: [...boundaries].sort((a, b) => scores.get(a).target - scores.get(b).target),
      line: [...boundaries].sort((a, b) => scores.get(a).line - scores.get(b).line) };
  })();
  if (cache) cache.ordering = ordering;
  const nearLine = (a, b) => ordering.scores.get(a).line - ordering.scores.get(b).line;
  const goalBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const surface of prepared.landingSurfaces) if (departure.has(surface.id)) {
    for (let axis = 0; axis < 3; axis++) {
      goalBounds.min[axis] = Math.min(goalBounds.min[axis], surface.min[axis]);
      goalBounds.max[axis] = Math.max(goalBounds.max[axis], surface.max[axis]);
    }
  }
  const goalCenter = goalBounds.min.map((value, axis) => (value + goalBounds.max[axis]) / 2);
  const regionSize = Math.max(sampleSpacing, diversity, maxHorizontalDistance / 2);
  const regionOf = (position, size = regionSize) => [Math.floor(position[0] / size),
    Math.floor(position[1] / Math.max(profile.height, model.maxJumpHeight)),
    Math.floor(position[2] / size)].join('/');
  const spread = (entries, position, size = regionSize) => {
    if (entries.length < 2 || size <= diversity) return entries;
    const regions = new Map();
    for (const entry of entries) {
      const key = regionOf(position(entry), size), group = regions.get(key) ?? [];
      group.push(entry); regions.set(key, group);
    }
    return interleave([...regions.values()].map(group => spread(group, position, size / 2)), entries.length);
  };
  // Visit coarse spatial regions before refining body-scale offsets. A distant
  // opening must compete with nearby ledges even on a densely triangulated floor.
  const sourceEdges = spread(reverse ? ordering.target.filter(boundary => !departure.has(boundary.surface))
    : boundaries.filter(boundary => approach.has(boundary.surface))
      .sort((a, b) => approach.get(a.surface) - approach.get(b.surface) || nearLine(a, b)), edge => edge.midpoint);
  const goalEdges = frontier ? [] : spread(boundaries.filter(boundary => departure.has(boundary.surface))
    .sort((a, b) => departure.get(a.surface) - departure.get(b.surface) || nearLine(a, b)), edge => edge.midpoint);
  const otherEdges = frontier ? [] : spread(ordering.line.filter(boundary => !approach.has(boundary.surface) ||
    !departure.has(boundary.surface)), edge => edge.midpoint);
  // Overlapping ground patches can be continuously connected without a shared
  // polygon edge. Give their ledges bounded work and prove the approach lazily.
  const visibleEdges = frontier && !reverse
    ? spread(ordering.source.filter(boundary => !approach.has(boundary.surface)), edge => edge.midpoint) : [];
  const orderedEdges = frontier ? interleave([sourceEdges, visibleEdges].filter(edges => edges.length), boundaries.length) :
    interleave([sourceEdges, goalEdges, otherEdges].filter(edges => edges.length), boundaries.length * 3);
  const seedStream = function* (boundary) {
    const samples = Math.max(1, Math.ceil(boundary.length / Math.min(sampleSpacing, profile.radius / 4)));
    const dx = boundary.b[0] - boundary.a[0], dz = boundary.b[2] - boundary.a[2];
    const nearest = reference => Math.max(0, Math.min(1,
      ((reference[0] - boundary.a[0]) * dx + (reference[2] - boundary.a[2]) * dz) / (dx * dx + dz * dz)));
    const fractions = new Set([nearest(to), nearest(goalCenter), nearest(from), 0.5]);
    const refinement = Math.min(samples, Math.floor(diagnostics.limits.seedChecks / insets.length));
    if (refinement < samples) diagnostics.truncated = true;
    for (let index = 0; index < refinement; index++) fractions.add((index + 0.5) / refinement);
    for (const inset of insets) for (const fraction of fractions) {
      const seed = boundary.a.map((value, axis) => value + fraction * (boundary.b[axis] - value));
      seed[0] += boundary.inward[0] * inset; seed[2] += boundary.inward[1] * inset;
      yield { seed, exit: [seed[0] - boundary.inward[0] * (inset + profile.radius * 3),
        seed[2] - boundary.inward[1] * (inset + profile.radius * 3)] };
    }
  };
  // Cover every ledge before spending the budget on finer pullbacks at one
  // densely triangulated obstacle. Each stream retains its remaining offsets.
  let streams = [...new Set(orderedEdges)].map(seedStream);
  sampling: while (streams.length) {
    const pending = [];
    for (const stream of streams) {
      if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) { diagnostics.truncated = true; break sampling; }
      const next = stream.next();
      if (next.done) continue;
      pending.push(stream);
      diagnostics.seedChecks++;
      const nav = project(next.value.seed, { maxVertical })[0];
      if (!nav || lowerBound(nav.position, nav.position, 0) >= durationLimit) continue;
      const key = JSON.stringify(nav.position);
      if (seen.has(key)) continue;
      seen.add(key);
      takeoffs.push({ ...nav, exit: next.value.exit, walk: approach.has(nav.surface)
        ? approach.get(nav.surface) + distance(centers.get(nav.surface), nav.position) : distance(from, nav.position) });
    }
    streams = pending;
  }
  const eligible = id => !frontier || (reverse ? departure.has(id) : !approach.has(id));
  const landingQueries = [
    ...(frontier ? [true, false].map(connected => ({ boundary: true,
      query: prepared.boundaryIndex.filter(edge => eligible(edge.surface) &&
        departure.has(edge.surface) === connected) })) : []),
    ...[true, false].map(connected => ({ boundary: false,
      query: prepared.landingIndex.filter(surface => eligible(surface.id) &&
        departure.has(surface.id) === connected) })),
  ];
  const pairs = new Map();
  let active = takeoffs.flatMap(start => {
    const bounds = {
      min: [start.position[0] - maxHorizontalDistance, start.position[1] - maxDrop - 2 * endpointTolerance,
        start.position[2] - maxHorizontalDistance],
      max: [start.position[0] + maxHorizontalDistance, start.position[1] + model.maxJumpHeight + 2 * endpointTolerance,
        start.position[2] + maxHorizontalDistance],
    };
    const heights = new Set([start.position[1], Math.min(bounds.max[1], Math.max(bounds.min[1], to[1]))]);
    return [...heights].flatMap(height => landingQueries.map(({ query, boundary }) => ({ start, boundary,
      iterator: query.nearest(bounds, [start.position[0], height, start.position[2]]) })));
  });
  pairing: while (active.length) {
    const pending = [];
    for (const query of active) {
      if (diagnostics.neighbourChecks >= diagnostics.limits.neighbourChecks) { diagnostics.truncated = true; break pairing; }
      const next = query.iterator.next();
      if (next.done) continue;
      pending.push(query);
      diagnostics.neighbourChecks++;
      const start = query.start, surface = next.value;
      const ends = query.boundary
        ? project(boundaryLanding(surface, start.position, profile.radius / 2), { maxVertical })
        : landingCandidates(surface, start.position, to, model, profile.radius);
      for (const end of ends) {
        if (!end || end.surface === start.surface) continue;
        const span = horizontal(start.position, end.position), drop = start.position[1] - end.position[1];
        if (span > maxHorizontalDistance || drop > maxDrop + 2 * endpointTolerance) continue;
        const duration = jumpDuration(start.position[1] + endpointTolerance, end.position[1] - endpointTolerance,
          { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
        if (duration === null || span > duration * model.maxHorizontalSpeed ||
            lowerBound(start.position, end.position, span / Math.max(Number.EPSILON, model.maxHorizontalSpeed)) >= durationLimit) continue;
        const nominal = jumpDuration(start.position[1], end.position[1],
          { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
        const remaining = departure.has(end.surface)
          ? departure.get(end.surface) + distance(centers.get(end.surface), end.position) : distance(end.position, to);
        const score = (start.walk + remaining) / speed + (nominal ?? duration);
        const key = `${cellOf(start.position)}:${cellOf(end.position)}`;
        const group = pairs.get(key) ?? [];
        group.push({ start, end, score, connected: approach.has(start.surface) && departure.has(end.surface),
          uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed });
        group.sort((a, b) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score);
        // Retain fine pullbacks for railings without letting one dense triangle
        // patch displace transfers elsewhere in the scene.
        if (group.length > insets.length) group.pop();
        pairs.set(key, group);
      }
    }
    active = pending;
  }
  const compare = (a, b) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score;
  const connected = [], intermediate = [];
  for (const group of pairs.values()) (group[0].connected ? connected : intermediate).push(group);
  const orderLaunches = groups => {
    const launches = new Map();
    for (const group of groups) {
      const key = cellOf(group[0].start.position), destinations = launches.get(key) ?? [];
      destinations.push(group); launches.set(key, destinations);
    }
    const batches = [...launches.values()].map(destinations =>
      interleave(destinations.sort((a, b) => compare(a[0], b[0])), maxCandidates));
    return interleave(spread(batches.sort((a, b) => compare(a[0], b[0])),
      batch => batch[0].start.position), maxCandidates);
  };
  const ordered = interleave([connected, intermediate].filter(groups => groups.length)
    .map(orderLaunches), maxCandidates);
  diagnostics.candidatePairs = [...pairs.values()].reduce((sum, group) => sum + group.length, 0);
  if (ordered.length < diagnostics.candidatePairs) diagnostics.truncated = true;
  const cached = cache?.standing ?? new Map(), motions = cache?.motions ?? new Map();
  const accepted = new Set(), tried = new Set();
  const retained = [[], []];
  const capacity = connected.length && intermediate.length
    ? [Math.ceil(maxLinks / 2), Math.floor(maxLinks / 2)]
    : [connected.length ? maxLinks : 0, intermediate.length ? maxLinks : 0];
  let serial = 0;
  const ids = new Set(existing.map(connection => connection.id));
  const standing = seed => {
    const key = JSON.stringify([seed.position, seed.surface]);
    if (cached.has(key)) return cached.get(key);
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) { diagnostics.truncated = true; return null; }
    diagnostics.endpointChecks++;
    const foot = standingFoot(seed, world, { profile, maxVertical, maxSlope, blocked, project });
    if (foot.reason) diagnostics.rejected[foot.reason]++;
    const value = foot.reason ? null : foot;
    cached.set(key, value);
    return value;
  };
  let candidates = ordered.map(candidate => ({ candidate }));
  validation: while (candidates.length) {
    const pending = [];
    for (const entry of candidates) {
      if (diagnostics.attempted >= diagnostics.limits.arcAttempts ||
          diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) { diagnostics.truncated = true; break validation; }
      const { candidate } = entry;
      const pool = candidate.connected ? 0 : 1, entries = retained[pool];
      if (!capacity[pool] || (entries.length >= capacity[pool] && (frontier || candidate.score >= entries.at(-1).score))) continue;
      const cell = `${cellOf(candidate.start.position)}:${cellOf(candidate.end.position)}`;
      if (accepted.has(cell)) continue;
      if (!entry.variants) {
        const start = standing(candidate.start);
        if (!start) continue;
        if (frontier && !reverse && !approach.has(start.surface) &&
            !groundTrace(source.position, candidate.start.position)) continue;
        const end = standing(candidate.end);
        if (!end || start.position[1] - end.position[1] > maxDrop) continue;
        if (frontier && (reverse
          ? departure.has(start.surface) || !departure.has(end.surface)
          : approach.has(end.surface))) continue;
        const key = JSON.stringify([start.position, end.position, candidate.start.exit]);
        if (tried.has(key)) continue;
        tried.add(key);
        const ground = frontier ? null : groundTrace(candidate.start.position, candidate.end.position);
        Object.assign(entry, { start, end,
          groundTime: ground ? ground.slice(1).reduce((sum, point, index) => sum + distance(ground[index], point), 0) / speed : Infinity,
          variants: motionVariants(start.position, end.position, candidate.start.exit) });
      }
      const next = entry.variants.next();
      if (next.done) continue;
      pending.push(entry);
      const { start, end, groundTime } = entry, variant = next.value, { mode } = variant;
      if (mode === 'jump' && model.maxJumpHeight === 0) continue;
      const duration = jumpDuration(start.position[1], end.position[1], { ...model, mode });
      if (duration === null || horizontal(start.position, end.position) > duration * model.maxHorizontalSpeed ||
          lowerBound(start.position, end.position, duration) >= durationLimit) continue;
      if (groundTime <= duration) { diagnostics.rejected.groundDominated++; continue; }
      const motion = { ...model, profile, walls, wallCheck: blocked, ...variant,
        sweep: (from, to, body) => world.sweepCapsule(from, to, body) };
      const motionKey = JSON.stringify([start.position, end.position, variant]);
      let arc = motions.get(motionKey);
      if (arc === undefined) {
        diagnostics.attempted++;
        arc = mode === 'drop'
          ? runOffConnection(start.position, end.position, { ...motion, world, maxSlope }, approaches)
          : jumpConnection(start.position, end.position, motion);
        motions.set(motionKey, arc);
      }
      if (!arc) { diagnostics.rejected.motion++; continue; }
      let id;
      do { id = `shortcut/${serial++}`; } while (ids.has(id));
      ids.add(id);
      entries.push({ score: candidate.score,
        connection: { id, ...arc, state: 'open', endpointTolerance,
          fromSurface: start.surface, toSurface: end.surface } });
      entries.sort((a, b) => a.score - b.score);
      if (entries.length > capacity[pool]) entries.pop();
      accepted.add(cell);
      pending.pop();
      if (frontier) break validation;
    }
    candidates = pending;
  }
  connections.push(...retained.flatMap(entries => entries.map(entry => entry.connection)));
  diagnostics.accepted = connections.length;
  return { connections, diagnostics };
}
