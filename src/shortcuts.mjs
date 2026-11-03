import { surfaceGraph } from './surfaces.mjs';
import { createGoalProjector, closestOnSurface } from './goals.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createMinHeap } from './heap.mjs';
import { createWallChecker } from './walls.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { jumpConnection, jumpDuration } from './jumps.mjs';
import { exposedBoundaries, interleave, standingFoot, validateDiscovery } from './traversal.mjs';

const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

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
export function findJumpShortcuts(surfaces, world, options) {
  validateDiscovery(world, options);
  const { profile, portals = [], walls, from, to, interaction, maxVertical, maxSlope,
    maxDrop, maxHorizontalDistance, sampleSpacing, maxCandidates, maxLinks, model,
    baseline, speed, connections: existing = [] } = options;
  if (baseline?.status !== 'complete' || !Number.isFinite(baseline.cost) || baseline.cost < 0 ||
      !Number.isFinite(baseline.arrivalCost) || baseline.arrivalCost < 0 || !Number.isFinite(speed) || speed <= 0) {
    throw new Error('Invalid shortcut baseline or ground speed');
  }
  const diagnostics = { reason: 'searched', baselineCost: baseline.cost, boundaryEdges: 0,
    seedChecks: 0, candidatePairs: 0, neighbourChecks: 0, endpointChecks: 0,
    attempted: 0, accepted: 0, truncated: false, goalFaces: 0,
    rejected: { support: 0, projection: 0, clearance: 0, range: 0, motion: 0, groundDominated: 0 },
    limits: { seedChecks: maxCandidates * 16, neighbourChecks: maxCandidates * 64,
      endpointChecks: maxCandidates * 4, arcAttempts: maxCandidates * 2, maxLinks } };
  const connections = [], blocked = createWallChecker(walls, profile);
  const graph = surfaceGraph(surfaces, { speed: 1, portals });
  const centers = new Map(graph.nodes.map(node => [node.id, node.position]));
  const project = createGoalProjector(surfaces), source = project(from, { maxVertical })[0];
  const goals = project(to, { maxVertical, interaction });
  diagnostics.goalFaces = goals.length;
  if (!source || !goals.length) { diagnostics.reason = 'unmapped-endpoint'; return { connections, diagnostics }; }
  for (const connection of existing) {
    if (connection.state !== 'open') continue;
    const a = project(connection.points[0], { maxVertical })[0];
    const b = project(connection.points.at(-1), { maxVertical })[0];
    if (!a || !b) continue;
    graph.edges.push({ from: a.surface, to: b.surface, points: connection.points,
      cost: distance(centers.get(a.surface), a.position) + connection.times.at(-1) * speed +
        distance(b.position, centers.get(b.surface)) });
  }
  graph.edges = graph.edges.filter(edge => !edge.points.slice(1).some((point, index) => blocked(edge.points[index], point)));
  const approach = distanceField(graph, [{ id: source.surface,
    cost: distance(source.position, centers.get(source.surface)) }], false);
  const departure = distanceField(graph, goals.map(goal => ({ id: goal.surface,
    cost: distance(goal.position, centers.get(goal.surface)) })), true);
  const boundaries = exposedBoundaries(surfaces, portals);
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius), diversity = profile.radius * 2;
  const cellOf = position => position.map(value => Math.floor(value / diversity)).join('/');
  const durationLimit = baseline.cost - baseline.arrivalCost;
  let travelSpeed = Math.max(speed, model.maxHorizontalSpeed);
  for (const connection of existing) for (let index = 1; index < connection.points.length; index++) {
    const elapsed = connection.times[index] - connection.times[index - 1];
    if (elapsed > 0) travelSpeed = Math.max(travelSpeed,
      horizontal(connection.points[index - 1], connection.points[index]) / elapsed);
  }
  const lowerBound = (start, end, airTime) =>
    (horizontal(from, start) + Math.max(0, horizontal(end, to) - (interaction?.radius ?? 0))) /
      travelSpeed + airTime;
  const insets = [...new Set([0, profile.radius, 1, 2, 3, 0.5, 1.5, 2.5, profile.radius * 0.5])];
  const takeoffs = [], seen = new Set();
  // Ordering is a heuristic only. It must not exclude a jump because a polygon
  // centre corridor overestimates the continuous approach or departure distance.
  const nearLine = (a, b) => distance(from, a.midpoint) + distance(a.midpoint, to) - distance(from, b.midpoint) - distance(b.midpoint, to);
  const sourceEdges = boundaries.filter(boundary => approach.has(boundary.surface))
    .sort((a, b) => approach.get(a.surface) - approach.get(b.surface) || nearLine(a, b));
  const goalEdges = boundaries.filter(boundary => departure.has(boundary.surface))
    .sort((a, b) => departure.get(a.surface) - departure.get(b.surface) || nearLine(a, b));
  const otherEdges = boundaries.filter(boundary => !approach.has(boundary.surface) || !departure.has(boundary.surface)).sort(nearLine);
  const orderedEdges = interleave([sourceEdges, goalEdges, otherEdges].filter(edges => edges.length), boundaries.length * 3);
  const seedStream = function* (boundary) {
    const samples = Math.max(1, Math.ceil(boundary.length / sampleSpacing));
    const dx = boundary.b[0] - boundary.a[0], dz = boundary.b[2] - boundary.a[2];
    const nearest = reference => Math.max(0, Math.min(1,
      ((reference[0] - boundary.a[0]) * dx + (reference[2] - boundary.a[2]) * dz) / (dx * dx + dz * dz)));
    const fractions = new Set([nearest(to), nearest(from), 0.5]);
    const refinement = Math.min(samples, Math.floor(diagnostics.limits.seedChecks / insets.length));
    if (refinement < samples) diagnostics.truncated = true;
    for (let index = 0; index < refinement; index++) fractions.add((index + 0.5) / refinement);
    for (const fraction of fractions) for (const inset of insets) {
      const seed = boundary.a.map((value, axis) => value + fraction * (boundary.b[axis] - value));
      seed[0] += boundary.inward[0] * inset; seed[2] += boundary.inward[1] * inset;
      yield seed;
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
      const nav = project(next.value, { maxVertical })[0];
      if (!nav || lowerBound(nav.position, nav.position, 0) >= durationLimit) continue;
      const key = JSON.stringify(nav.position);
      if (seen.has(key)) continue;
      seen.add(key);
      takeoffs.push({ ...nav, walk: approach.has(nav.surface)
        ? approach.get(nav.surface) + distance(centers.get(nav.surface), nav.position) : distance(from, nav.position) });
    }
    streams = pending;
  }
  const landingSurfaces = surfaces.map(surface => ({ ...surface,
    min: [0, 1, 2].map(axis => Math.min(...surface.vertices.map(point => point[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...surface.vertices.map(point => point[axis]))) }));
  const landingQueries = [landingSurfaces.filter(surface => departure.has(surface.id)),
    landingSurfaces.filter(surface => !departure.has(surface.id))].filter(entries => entries.length).map(createBoundsIndex);
  const pairs = new Map();
  let active = takeoffs.flatMap(start => {
    const bounds = {
      min: [start.position[0] - maxHorizontalDistance, start.position[1] - maxDrop - 2 * endpointTolerance,
        start.position[2] - maxHorizontalDistance],
      max: [start.position[0] + maxHorizontalDistance, start.position[1] + model.maxJumpHeight + 2 * endpointTolerance,
        start.position[2] + maxHorizontalDistance],
    };
    const reference = [start.position[0], Math.min(bounds.max[1], Math.max(bounds.min[1], to[1])), start.position[2]];
    return landingQueries.map(query => ({ start, iterator: query.nearest(bounds, reference) }));
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
      if (surface.id === start.surface) continue;
      for (const reference of [start.position, to]) {
        const end = closestOnSurface(surface, reference);
        if (!end) continue;
        const span = horizontal(start.position, end.position), drop = start.position[1] - end.position[1];
        if (span > maxHorizontalDistance || drop > maxDrop + 2 * endpointTolerance) continue;
        const duration = jumpDuration(start.position[1] + endpointTolerance, end.position[1] - endpointTolerance,
          { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
        if (duration === null || span > duration * model.maxHorizontalSpeed ||
            lowerBound(start.position, end.position, span / Math.max(Number.EPSILON, model.maxHorizontalSpeed)) >= durationLimit) continue;
        const nominal = jumpDuration(start.position[1], end.position[1],
          { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
        const remaining = departure.has(surface.id)
          ? departure.get(surface.id) + distance(centers.get(surface.id), end.position) : distance(end.position, to);
        const score = (start.walk + remaining) / speed + (nominal ?? duration);
        const key = `${cellOf(start.position)}:${cellOf(end.position)}`;
        const group = pairs.get(key) ?? [];
        group.push({ start, end, score, connected: approach.has(start.surface) && departure.has(surface.id),
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
  const ordered = interleave([connected, intermediate].filter(groups => groups.length)
    .map(groups => interleave(groups.sort((a, b) => compare(a[0], b[0])), maxCandidates)), maxCandidates);
  diagnostics.candidatePairs = [...pairs.values()].reduce((sum, group) => sum + group.length, 0);
  if (ordered.length < diagnostics.candidatePairs) diagnostics.truncated = true;
  const visibility = createGroundStraightener(surfaces, { walls, profile });
  const cached = new Map(), accepted = new Set(), tried = new Set();
  const retained = [[], []];
  const capacity = connected.length && intermediate.length
    ? [Math.ceil(maxLinks / 2), Math.floor(maxLinks / 2)]
    : [connected.length ? maxLinks : 0, intermediate.length ? maxLinks : 0];
  let serial = 0;
  const ids = new Set(existing.map(connection => connection.id));
  const standing = seed => {
    const key = JSON.stringify(seed.position);
    if (cached.has(key)) return cached.get(key);
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) { diagnostics.truncated = true; return null; }
    diagnostics.endpointChecks++;
    const foot = standingFoot(seed, project, world, { profile, maxVertical, maxSlope, blocked });
    if (foot.reason) diagnostics.rejected[foot.reason]++;
    const value = foot.reason ? null : foot;
    cached.set(key, value);
    return value;
  };
  for (const candidate of ordered) {
    if (diagnostics.attempted >= diagnostics.limits.arcAttempts ||
        diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) { diagnostics.truncated = true; break; }
    const pool = candidate.connected ? 0 : 1, entries = retained[pool];
    if (!capacity[pool] || (entries.length >= capacity[pool] && candidate.score >= entries.at(-1).score)) continue;
    const cell = `${cellOf(candidate.start.position)}:${cellOf(candidate.end.position)}`;
    if (accepted.has(cell)) continue;
    const start = standing(candidate.start), end = standing(candidate.end);
    if (!start || !end || start.position[1] - end.position[1] > maxDrop) continue;
    const key = JSON.stringify([start.position, end.position]);
    if (tried.has(key)) continue;
    tried.add(key);
    const ground = visibility.trace(candidate.start.position, candidate.end.position);
    const groundTime = ground ? ground.slice(1).reduce((sum, point, index) => sum + distance(ground[index], point), 0) / speed : Infinity;
    for (const mode of ['drop', 'jump']) {
      if (mode === 'jump' && model.maxJumpHeight === 0) continue;
      const duration = jumpDuration(start.position[1], end.position[1], { ...model, mode });
      if (duration === null || horizontal(start.position, end.position) > duration * model.maxHorizontalSpeed ||
          lowerBound(start.position, end.position, duration) >= durationLimit) continue;
      if (groundTime <= duration) { diagnostics.rejected.groundDominated++; continue; }
      diagnostics.attempted++;
      const arc = jumpConnection(start.position, end.position, { ...model, profile, walls, mode,
        sweep: (from, to, body) => world.sweepCapsule(from, to, body) });
      if (!arc) { diagnostics.rejected.motion++; continue; }
      let id;
      do { id = `shortcut/${serial++}`; } while (ids.has(id));
      ids.add(id);
      entries.push({ score: candidate.score,
        connection: { id, ...arc, state: 'open', endpointTolerance } });
      entries.sort((a, b) => a.score - b.score);
      if (entries.length > capacity[pool]) entries.pop();
      accepted.add(cell);
      break;
    }
  }
  connections.push(...retained.flatMap(entries => entries.map(entry => entry.connection)));
  diagnostics.accepted = connections.length;
  return { connections, diagnostics };
}
