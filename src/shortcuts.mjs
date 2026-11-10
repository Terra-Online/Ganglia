import { movementGeometry } from './movement-geometry.mjs';
import { createJumpEnvelope } from './reachability.mjs';
import { advanceDistanceField } from './distance-field.mjs';
import { boundaryTree, boundaryOrder } from './boundary-order.mjs';
import { landingCandidates, boundaryLanding } from './landings.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { jumpConnection, jumpDuration, runOffConnection, createMotionVariants } from './jumps.mjs';
import { interleave, standingFoot, validateDiscovery } from './traversal.mjs';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

const geometries = new WeakMap();

const adjacency = (edges, sharedForward) => {
  const forward = sharedForward ?? new Map(), reverse = new Map();
  for (const edge of edges) {
    if (!sharedForward) {
      const entries = forward.get(edge.from) ?? [];
      entries.push(edge); forward.set(edge.from, entries);
    }
    const entries = reverse.get(edge.to) ?? [];
    entries.push(edge); reverse.set(edge.to, entries);
  }
  return { forward, reverse };
};

function prepareGeometry(surfaces, options) {
  const shared = movementGeometry(surfaces, options);
  const cached = geometries.get(shared);
  if (cached) return cached;
  const { blocked, byId, centers, project, projectSupport, visibility, topology } = shared;
  const graph = { nodes: shared.graph.nodes, edges: shared.graph.edges };
  const representatives = [];
  const componentOf = id => topology.components[topology.ids.get(id)];
  for (const node of graph.nodes) representatives[componentOf(node.id)] ??= node.id;
  const boundaries = shared.boundaries.map((boundary, ordinal) => ({ ...boundary, ordinal,
    min: [0, 1, 2].map(axis => Math.min(boundary.a[axis], boundary.b[axis])),
    max: [0, 1, 2].map(axis => Math.max(boundary.a[axis], boundary.b[axis])) }));
  const landingSurfaces = surfaces.map(surface => ({ ...surface,
    min: [0, 1, 2].map(axis => Math.min(...surface.vertices.map(point => point[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...surface.vertices.map(point => point[axis]))) }));

  const geometry = { ...adjacency(graph.edges, shared.forward), lengthScale: shared.lengthScale, blocked, boundaries, landingSurfaces,
    boundaryIndex: createBoundsIndex(boundaries, edge => componentOf(edge.surface)),
    landingIndex: createBoundsIndex(landingSurfaces, surface => componentOf(surface.id)), representatives,
    byId, projectSupport,
    centers,
    project,
    visibility,
  };
  geometries.set(shared, geometry);
  return geometry;
}

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
  if (cache) {
    const signature = JSON.stringify([options.profile, options.walls, options.portals, options.model,
      options.maxVertical, options.maxSlope, options.maxDrop, options.maxHorizontalDistance, options.sampleSpacing, options.activeBoost]);
    const binding = cache.binding;
    if (binding && (binding.surfaces !== surfaces || binding.world !== world || binding.signature !== signature)) {
      for (const key of Object.keys(cache)) delete cache[key];
    }
    cache.binding = { surfaces, world, signature };
    const query = JSON.stringify([options.from, options.to, options.interaction, options.speed]);
    if (cache.query !== query) {
      for (const key of ['source', 'goals', 'ordering', 'distanceFields', 'forwardCursor', 'reverseCursor']) delete cache[key];
      cache.query = query;
    }
  }
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
  const { blocked, byId, centers, project, projectSupport, boundaries } = prepared;
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
  const approaches = cache?.approaches ?? new Map(), exits = cache?.exits ?? new Map();
  if (cache) { cache.approaches = approaches; cache.exits = exits; }
  const motionVariants = createMotionVariants(model, world, profile, exits, approaches);
  const edges = [];
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
    const a = projectSupport(connection.points[0], maxVertical, connection.fromSurface);
    const b = projectSupport(connection.points.at(-1), maxVertical, connection.toSurface);
    if (!a || !b) continue;
    if (connection.points.slice(1).some((point, index) => blocked(connection.points[index], point))) continue;
    const approach = groundTrace(source.position, a.position);
    if (approach) edges.push({ from: source.surface, to: a.surface,
      cost: approach.slice(1).reduce((sum, point, index) => sum + distance(approach[index], point), 0) });
    edges.push({ from: a.surface, to: b.surface, points: connection.points,
      cost: distance(centers.get(a.surface), a.position) + connection.times.at(-1) * speed +
        distance(b.position, centers.get(b.surface)) });
  }
  const fields = cache?.distanceFields ?? {};
  if (cache) cache.distanceFields = fields;
  fields.approach = advanceDistanceField(prepared.forward, edges, [{ id: source.surface,
    cost: distance(source.position, centers.get(source.surface)) }], false, fields.approach, prepared.lengthScale);
  fields.departure = advanceDistanceField(prepared.reverse, edges, goals.map(goal => ({ id: goal.surface,
    cost: distance(goal.position, centers.get(goal.surface)) })), true, fields.departure, prepared.lengthScale);
  const approach = fields.approach.costs, departure = fields.departure.costs;
  diagnostics.distanceFields = {
    approach: { ...fields.approach.work, reachableNodes: approach.size },
    departure: { ...fields.departure.work, reachableNodes: departure.size },
  };
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
  const regionSize = Math.max(sampleSpacing, diversity, maxHorizontalDistance / 2);
  const regionOf = (position, size = regionSize) => [Math.floor(position[0] / size),
    Math.floor(position[1] / Math.max(profile.height, model.maxJumpHeight)),
    Math.floor(position[2] / size)].join('/');
  const spread = (entries, position, size = regionSize, limit = entries.length) => {
    if (entries.length < 2 || size <= diversity) return entries.slice(0, limit);
    const regions = new Map();
    for (const entry of entries) {
      const key = regionOf(position(entry), size), group = regions.get(key) ?? [];
      group.push(entry); regions.set(key, group);
    }
    return interleave([...regions.values()].slice(0, limit)
      .map(group => spread(group, position, size / 2, limit)), limit);
  };
  const cursorKey = reverse ? 'reverseCursor' : 'forwardCursor';
  // Reachability changes when any authored action changes, including an update
  // that keeps its id. Geometry failures remain in the query's independent caches.
  const revision = JSON.stringify(existing.map(edge => [edge.id, edge.state, edge.fromSurface, edge.toSurface,
    edge.points, edge.times, edge.requiredGait, edge.requiredBoost, edge.endpointTolerance, edge.terminal, edge.boostExpiry]));
  const previous = frontier && cache?.[cursorKey];
  // A smaller link quota can discard pool representatives during validation.
  // Growing it requires fresh enumeration, while a larger work budget resumes.
  let cursor = previous?.revision === revision && maxLinks <= previous.maxLinks ? previous : null;
  const resumed = Boolean(cursor);
  const takeoffs = [];
  let goalBounds = cursor?.goalBounds;
  let seedIterator;
  if (!cursor) {
    // Ordering is a heuristic only. It must not exclude a jump because a polygon
    // centre corridor overestimates the continuous approach or departure distance.
    const ordering = cache?.ordering ?? (() => {
      const source = new Float64Array(boundaries.length), target = new Float64Array(boundaries.length),
        line = new Float64Array(boundaries.length);
      for (const edge of boundaries) {
        const index = edge.ordinal;
        source[index] = distance(from, edge.midpoint);
        target[index] = distance(edge.midpoint, to);
        line[index] = source[index] + target[index];
      }
      return { source, target, line };
    })();
    if (cache) cache.ordering = ordering;
    const nearLine = (a, b) => ordering.line[a.ordinal] - ordering.line[b.ordinal];
    const stable = compare => (a, b) => compare(a, b) || a.ordinal - b.ordinal;
    goalBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const surface of prepared.landingSurfaces) if (departure.has(surface.id)) {
      for (let axis = 0; axis < 3; axis++) {
        goalBounds.min[axis] = Math.min(goalBounds.min[axis], surface.min[axis]);
        goalBounds.max[axis] = Math.max(goalBounds.max[axis], surface.max[axis]);
      }
    }
    const goalCenter = goalBounds.min.map((value, axis) => (value + goalBounds.max[axis]) / 2);
    // Visit coarse spatial regions before refining body-scale offsets. A distant
    // opening must compete with nearby ledges even on a densely triangulated floor.
    const seedLimit = diagnostics.limits.seedChecks;
    const treeKey = JSON.stringify([regionSize, Math.max(profile.height, model.maxJumpHeight), diversity]);
    if (prepared.boundaryOrder?.key !== treeKey) prepared.boundaryOrder = { key: treeKey,
      tree: boundaryTree(boundaries, regionSize, Math.max(profile.height, model.maxJumpHeight), diversity) };
    const order = (eligible, compare) => boundaryOrder(prepared.boundaryOrder.tree, eligible, stable(compare), frontier ? boundaries.length : seedLimit);
    const sourceEdges = reverse
      ? order(boundary => !departure.has(boundary.surface), (a, b) => ordering.target[a.ordinal] - ordering.target[b.ordinal])
      : order(boundary => approach.has(boundary.surface),
        (a, b) => approach.get(a.surface) - approach.get(b.surface) || nearLine(a, b));
    const goalEdges = frontier ? [] : order(boundary => departure.has(boundary.surface),
      (a, b) => departure.get(a.surface) - departure.get(b.surface) || nearLine(a, b));
    const otherEdges = frontier ? [] : order(boundary => !approach.has(boundary.surface) || !departure.has(boundary.surface), nearLine);
    const visibleEdges = frontier && !reverse
      ? order(boundary => !approach.has(boundary.surface), (a, b) => ordering.source[a.ordinal] - ordering.source[b.ordinal]) : [];
    const orderedEdges = frontier ? interleave([sourceEdges, visibleEdges].filter(edges => edges.length), boundaries.length) :
      interleave([sourceEdges, goalEdges, otherEdges].filter(edges => edges.length), boundaries.length * 3);
    const seedStream = function* (boundary) {
      const samples = Math.max(1, Math.ceil(boundary.length / Math.min(sampleSpacing, profile.radius / 4)));
      const dx = boundary.b[0] - boundary.a[0], dz = boundary.b[2] - boundary.a[2];
      const nearest = reference => Math.max(0, Math.min(1,
        ((reference[0] - boundary.a[0]) * dx + (reference[2] - boundary.a[2]) * dz) / (dx * dx + dz * dz)));
      const emitted = new Set();
      const levels = frontier ? [...new Set([Math.min(4, samples), Math.min(16, samples), samples])]
        : [Math.min(samples, Math.floor(diagnostics.limits.seedChecks / insets.length))];
      if (levels.at(-1) < samples) diagnostics.truncated = true;
      for (const refinement of levels) {
        const fractions = new Set([nearest(to), nearest(goalCenter), nearest(from), 0.5]);
        for (let index = 0; index < refinement; index++) fractions.add((index + 0.5) / refinement);
        const fresh = [...fractions].filter(fraction => !emitted.has(fraction));
        for (const fraction of fresh) emitted.add(fraction);
        for (const inset of insets) for (const fraction of fresh) {
          const seed = boundary.a.map((value, axis) => value + fraction * (boundary.b[axis] - value));
          seed[0] += boundary.inward[0] * inset; seed[2] += boundary.inward[1] * inset;
          yield { seed, exit: [seed[0] - boundary.inward[0] * (inset + profile.radius * 3),
            seed[2] - boundary.inward[1] * (inset + profile.radius * 3)] };
        }
      }
    };
    // Boundary streams retain their offsets. Activate new ledges before revisiting
    // a dense patch, then round-robin the remaining offsets across all ledges.
    seedIterator = (function* () {
      let streams = [];
      for (const boundary of new Set(orderedEdges)) {
        const stream = seedStream(boundary), next = stream.next();
        if (!next.done) { streams.push(stream); yield next.value; }
      }
      while (streams.length) {
        const pending = [];
        for (const stream of streams) {
          const next = stream.next();
          if (next.done) continue;
          pending.push(stream);
          yield next.value;
        }
        streams = pending;
      }
    })();
  }
  if (frontier && !cursor) {
    cursor = { revision, maxLinks, goalBounds, seeds: seedIterator, seen: new Set(), seedDone: false,
      active: [], pairs: new Map(), pairSeen: new Set(), pending: [], ready: [], rejected: new Set(), accepted: new Set(), serial: 0, representativeLimited: false };
    if (cache) cache[cursorKey] = cursor;
  }
  if (cursor) cursor.maxLinks = maxLinks;
  const refill = !cursor || cursor.pending.length + cursor.ready.length < maxCandidates;
  const seen = cursor?.seen ?? new Set();
  seedIterator = cursor?.seeds ?? seedIterator;
  while (refill && diagnostics.seedChecks < diagnostics.limits.seedChecks && !cursor?.seedDone) {
    const next = seedIterator.next();
    if (next.done) { if (cursor) cursor.seedDone = true; break; }
    diagnostics.seedChecks++;
    const nav = project(next.value.seed, { maxVertical })[0];
    if (!nav || lowerBound(nav.position, nav.position, 0) >= durationLimit) continue;
    const key = JSON.stringify(nav.position);
    if (seen.has(key)) continue;
    seen.add(key);
    // Reverse frontiers can land only in the goal-reachable ground set. Its
    // union box is an optimistic predecessor constraint, including boundary
    // inset/projection witnesses. Forward discovery still explores relay regions.
    if (frontier && reverse && !createJumpEnvelope(nav.position, {
      model, maxDrop, maxHorizontalDistance, endpointTolerance,
      padding: [profile.radius / 2, maxVertical, profile.radius / 2],
    })(goalBounds)) {
      diagnostics.rejected.range++;
      continue;
    }
    takeoffs.push({ ...nav, exit: next.value.exit, walk: approach.has(nav.surface)
      ? approach.get(nav.surface) + distance(centers.get(nav.surface), nav.position) : distance(from, nav.position) });
  }
  const eligible = id => !frontier || (reverse ? departure.has(id) : !approach.has(id));
  const landingQueries = cursor?.landingQueries ?? [
    ...(frontier ? [true, false].map(connected => ({ boundary: true,
      query: prepared.boundaryIndex.filterGroups(group => eligible(prepared.representatives[group]) &&
        departure.has(prepared.representatives[group]) === connected) })) : []),
    ...[true, false].map(connected => ({ boundary: false,
      query: prepared.landingIndex.filterGroups(group => eligible(prepared.representatives[group]) &&
        departure.has(prepared.representatives[group]) === connected) })),
  ].filter(({ query }) => !query.empty);
  if (cursor) cursor.landingQueries = landingQueries;
  const rejectedPairs = cursor?.rejected ?? new Set();
  const pairKey = (start, end) => JSON.stringify([start.surface, start.position, start.exit, end.surface, end.position]);
  const pairs = cursor?.pairs ?? new Map();
  const active = cursor?.active ?? [];
  for (const start of takeoffs) {
    const bounds = {
      min: [start.position[0] - maxHorizontalDistance, start.position[1] - maxDrop - 2 * endpointTolerance,
        start.position[2] - maxHorizontalDistance],
      max: [start.position[0] + maxHorizontalDistance, start.position[1] + model.maxJumpHeight + 2 * endpointTolerance,
        start.position[2] + maxHorizontalDistance],
    };
    const heights = new Set([start.position[1], Math.min(bounds.max[1], Math.max(bounds.min[1], to[1]))]);
    for (const height of heights) for (const { query, boundary } of landingQueries) {
      active.push({ start, boundary,
        iterator: query.nearest(bounds, [start.position[0], height, start.position[2]],
          createJumpEnvelope(start.position, { model, maxDrop, maxHorizontalDistance, endpointTolerance,
            padding: boundary ? [profile.radius / 2, maxVertical, profile.radius / 2] : [0, 0, 0] })) });
    }
  }
  let queryIndex = 0, activeQueries = active.length;
  while (refill && activeQueries && diagnostics.neighbourChecks < diagnostics.limits.neighbourChecks) {
    const index = queryIndex++ % active.length, query = active[index];
    if (!query) continue;
    const next = query.iterator.next();
    if (next.done) { active[index] = null; activeQueries--; continue; }
    diagnostics.neighbourChecks++;

    const start = query.start, surface = next.value;
    const ends = query.boundary
      ? project(boundaryLanding(surface, start.position, profile.radius / 2), { maxVertical })
      : landingCandidates(surface, start.position, to, model, profile.radius);
    for (const end of ends) {
      if (!end || end.surface === start.surface) continue;
      const identity = cursor ? pairKey(start, end) : null;
      if (cursor && (rejectedPairs.has(identity) || cursor.pairSeen.has(identity))) continue;

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
      cursor?.pairSeen.add(identity);
      group.push({ start, end, score, connected: approach.has(start.surface) && departure.has(end.surface),
        uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed });
      group.sort((a, b) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score);
      // Retain fine pullbacks for railings without letting one dense triangle
      // patch displace transfers elsewhere in the scene.
      if (group.length > insets.length) {
        group.pop();
        if (cursor) cursor.representativeLimited = true;
      }
      pairs.set(key, group);
    }
  }
  if (cursor) {
    const next = queryIndex % Math.max(1, active.length);
    cursor.active = [...active.slice(next), ...active.slice(0, next)].filter(Boolean);
  } else if (activeQueries) diagnostics.truncated = true;
  const candidateLimit = cursor ? [...pairs.values()].reduce((sum, group) => sum + group.length, 0) : maxCandidates;
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
      interleave(destinations.sort((a, b) => compare(a[0], b[0])), candidateLimit));
    return interleave(spread(batches.sort((a, b) => compare(a[0], b[0])),
      batch => batch[0].start.position), candidateLimit);
  };
  const ordered = interleave([connected, intermediate].filter(groups => groups.length)
    .map(orderLaunches), candidateLimit);
  diagnostics.candidatePairs = [...pairs.values()].reduce((sum, group) => sum + group.length, 0) +
    (cursor?.pending.length ?? 0) + (cursor?.ready.length ?? 0);
  if (ordered.length < diagnostics.candidatePairs) diagnostics.truncated = true;
  if (cursor) {
    for (const candidate of ordered) cursor.ready.push(candidate);
    pairs.clear();
  }
  const cached = cache?.standing ?? new Map(), motions = cache?.motions ?? new Map();
  if (cache) { cache.standing = cached; cache.motions = motions; }
  const accepted = cursor?.accepted ?? new Set(), tried = new Set();
  const retained = [[], []];
  const hasConnected = connected.length > 0 || Boolean(cursor?.pending.some(entry => entry.candidate.connected)) || Boolean(cursor?.ready.some(entry => entry.connected));
  const hasIntermediate = intermediate.length > 0 || Boolean(cursor?.pending.some(entry => !entry.candidate.connected)) || Boolean(cursor?.ready.some(entry => !entry.connected));
  const capacity = hasConnected && hasIntermediate
    ? [Math.ceil(maxLinks / 2), Math.floor(maxLinks / 2)]
    : [hasConnected ? maxLinks : 0, hasIntermediate ? maxLinks : 0];
  let serial = cursor?.serial ?? 0;
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
  let candidates = cursor?.pending ?? [];
  const ready = cursor ? cursor.ready.splice(0, Math.max(0, maxCandidates - candidates.length)) : ordered;
  for (const candidate of ready) candidates.push({ candidate });

  validation: while (candidates.length) {
    const pending = [];
    for (const [index, entry] of candidates.entries()) {
      if (diagnostics.attempted >= diagnostics.limits.arcAttempts ||
          diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
        diagnostics.truncated = true;
        for (let remaining = index; remaining < candidates.length; remaining++) pending.push(candidates[remaining]);
        candidates = pending;
        break validation;
      }
      const { candidate } = entry;
      const pool = candidate.connected ? 0 : 1, entries = retained[pool];
      if (!capacity[pool] || (entries.length >= capacity[pool] && (frontier || candidate.score >= entries.at(-1).score))) continue;
      const cell = `${cellOf(candidate.start.position)}:${cellOf(candidate.end.position)}`;
      if (accepted.has(cell)) continue;
      if (!entry.variants) {
        const start = standing(candidate.start);
        if (!start) {
          if (cached.has(JSON.stringify([candidate.start.position, candidate.start.surface])))
            rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        if (frontier && !reverse && !approach.has(start.surface) &&
            !groundTrace(source.position, candidate.start.position)) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end)); continue;
        }
        const end = standing(candidate.end);
        if (!end) {
          if (cached.has(JSON.stringify([candidate.end.position, candidate.end.surface])))
            rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        if (start.position[1] - end.position[1] > maxDrop) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end)); continue;
        }
        if (frontier && (reverse
          ? departure.has(start.surface) || !departure.has(end.surface)
          : approach.has(end.surface))) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end)); continue;
        }
        const key = JSON.stringify([start.position, end.position, candidate.start.exit]);
        if (tried.has(key)) continue;
        tried.add(key);
        const ground = frontier ? null : groundTrace(candidate.start.position, candidate.end.position);
        Object.assign(entry, { start, end,
          groundTime: ground ? ground.slice(1).reduce((sum, point, index) => sum + distance(ground[index], point), 0) / speed : Infinity,
          variants: motionVariants(start.position, end.position, candidate.start.exit) });
      }
      const next = entry.variants.next();
      if (next.done) { rejectedPairs.add(pairKey(candidate.start, candidate.end)); continue; }
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
      if (frontier) {
        for (let remaining = index + 1; remaining < candidates.length; remaining++) pending.push(candidates[remaining]);
        candidates = pending;
        break validation;
      }
    }
    candidates = pending;
  }
  if (cursor) {
    cursor.pending = candidates;
    cursor.serial = serial;
    diagnostics.cursor = { resumed, pending: cursor.pending.length + cursor.ready.length,
      seedExhausted: cursor.seedDone, landingQueries: cursor.active.length };
    diagnostics.truncated ||= cursor.representativeLimited || !cursor.seedDone || cursor.active.length > 0 || pairs.size > 0 || candidates.length > 0 || cursor.ready.length > 0;
  } else if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) diagnostics.truncated = true;
  for (const entries of retained) for (const entry of entries) connections.push(entry.connection);
  diagnostics.accepted = connections.length;
  return { connections, diagnostics };
}
