import { boundaryTree, boundaryOrder } from './boundary-order.js';
import { createBoundsIndex } from './bounds.js';
import { createCandidateBounds } from './candidate-bounds.js';
import { advanceDistanceField } from './distance-field.js';
import { jumpConnection, jumpDuration, runOffConnection, createMotionVariants } from './jumps.js';
import { landingCandidates, boundaryLanding, createLandingGoalCache } from './landings.js';
import { createMotionBounds } from './motion-bounds.js';
import { movementGeometry } from './movement-geometry.js';
import { createJumpEnvelope, createJumpPredecessor } from './reachability.js';
import { createGroundStraightener } from './straighten.js';
import { interleave, standingFoot, validateDiscovery } from './traversal.js';
const distance = (a: any, b: any) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontal = (a: any, b: any) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const geometries = new WeakMap<any, any>();
const adjacency = (edges: any, sharedForward: any): any => {
  const forward = sharedForward ?? new Map<any, any>(),
    reverse = new Map<any, any>();
  for (const edge of edges) {
    if (!sharedForward) {
      const entries = forward.get(edge.from) ?? [];
      entries.push(edge);
      forward.set(edge.from, entries);
    }
    const entries = reverse.get(edge.to) ?? [];
    entries.push(edge);
    reverse.set(edge.to, entries);
  }
  return { forward, reverse };
};
function prepareGeometry(surfaces: any, options: any): any {
  const shared = movementGeometry(surfaces, options);
  const cached = geometries.get(shared);
  if (cached) return cached;
  const { blocked, byId, centers, project, projectSupport, visibility, topology } = shared;
  const graph = { nodes: shared.graph.nodes, edges: shared.graph.edges };
  const representatives: any = [];
  const componentOf = (id: any): any => topology.components[topology.ids.get(id)];
  for (const node of graph.nodes) representatives[componentOf(node.id)] ??= node.id;
  const boundaries = shared.boundaries.map((boundary: any, ordinal: any): any => ({
    ...boundary,
    ordinal,
    min: [0, 1, 2].map((axis) => Math.min(boundary.a[axis], boundary.b[axis])),
    max: [0, 1, 2].map((axis) => Math.max(boundary.a[axis], boundary.b[axis])),
  }));
  const landingSurfaces = surfaces.map((surface: any): any => ({
    ...surface,
    min: [0, 1, 2].map((axis) =>
      Math.min(...surface.vertices.map((point: any): any => point[axis])),
    ),
    max: [0, 1, 2].map((axis) =>
      Math.max(...surface.vertices.map((point: any): any => point[axis])),
    ),
  }));
  const geometry = {
    ...adjacency(graph.edges, shared.forward),
    lengthScale: shared.lengthScale,
    blocked,
    boundaries,
    landingSurfaces,
    boundaryIndex: createBoundsIndex(boundaries, (edge: any): any => componentOf(edge.surface)),
    landingIndex: createBoundsIndex(landingSurfaces, (surface: any): any =>
      componentOf(surface.id),
    ),
    representatives,
    byId,
    projectSupport,
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
export function findJumpShortcuts(surfaces: any, world: any, options: any, cache?: any): any {
  return findConnections(surfaces, world, options, false, cache);
}
/** Expand verified actions from currently reachable ground into new surfaces. */
export function findJumpFrontier(
  surfaces: any,
  world: any,
  options: any,
  cache: any,
  reverse = false,
): any {
  return findConnections(surfaces, world, options, true, cache, reverse);
}
function findConnections(
  surfaces: any,
  world: any,
  options: any,
  frontier: any,
  cache: any,
  reverse = false,
): any {
  validateDiscovery(world, options);
  if (cache) {
    const signature = JSON.stringify([
      options.profile,
      options.walls,
      options.portals,
      options.model,
      options.maxVertical,
      options.maxSlope,
      options.maxDrop,
      options.maxHorizontalDistance,
      options.sampleSpacing,
      options.activeBoost,
    ]);
    const binding = cache.binding;
    if (
      binding &&
      (binding.surfaces !== surfaces || binding.world !== world || binding.signature !== signature)
    ) {
      for (const key of Object.keys(cache)) delete cache[key];
    }
    cache.binding = { surfaces, world, signature };
    const query = JSON.stringify([
      options.from,
      options.to,
      options.interaction,
      options.speed,
      options.costBound,
      options.boundGoal,
    ]);
    if (cache.query !== query) {
      for (const key of [
        'source',
        'goals',
        'ordering',
        'distanceFields',
        'forwardCursor',
        'reverseCursor',
      ])
        delete cache[key];
      cache.query = query;
    }
  }
  const {
    profile,
    walls,
    from,
    to,
    interaction,
    maxVertical,
    maxSlope,
    maxDrop,
    maxHorizontalDistance,
    sampleSpacing,
    maxCandidates,
    maxLinks,
    model,
    baseline,
    speed,
    connections: existing = [],
  } = options;
  if (
    (!frontier &&
      (baseline?.status !== 'complete' ||
        !Number.isFinite(baseline.cost) ||
        baseline.cost < 0 ||
        !Number.isFinite(baseline.arrivalCost) ||
        baseline.arrivalCost < 0)) ||
    !Number.isFinite(speed) ||
    speed <= 0
  ) {
    throw new Error('Invalid shortcut baseline or ground speed');
  }
  const diagnostics: any = {
    reason: frontier ? (reverse ? 'goal-frontier' : 'reachable-frontier') : 'searched',
    baselineCost: baseline?.cost ?? null,
    boundaryEdges: 0,
    seedChecks: 0,
    candidatePairs: 0,
    neighbourChecks: 0,
    dominatedFaces: 0,
    endpointChecks: 0,
    attempted: 0,
    accepted: 0,
    truncated: false,
    goalFaces: 0,
    rejected: { support: 0, projection: 0, clearance: 0, range: 0, motion: 0, groundDominated: 0 },
    limits: {
      seedChecks: maxCandidates * 16,
      neighbourChecks: maxCandidates * 64,
      endpointChecks: maxCandidates * 4,
      arcAttempts: maxCandidates * 2,
      maxLinks,
    },
  };
  const prepared = cache?.geometry ?? prepareGeometry(surfaces, options);
  if (cache) cache.geometry = prepared;
  const { blocked, byId, centers, project, projectSupport, boundaries } = prepared;
  const connections: any = [];
  let visibility = cache?.visibility ?? prepared.visibility;
  const traces = cache?.traces ?? new Map<any, any>();
  if (cache) cache.traces = traces;
  const groundTrace = (start: any, end: any): any => {
    const key = JSON.stringify([start, end]);
    if (!traces.has(key)) {
      visibility ??= createGroundStraightener(surfaces, { walls, profile });
      if (cache) cache.visibility = visibility;
      traces.set(key, visibility.trace(start, end));
    }
    return traces.get(key);
  };
  const approaches = cache?.approaches ?? new Map<any, any>(),
    exits = cache?.exits ?? new Map<any, any>();
  if (cache) {
    cache.approaches = approaches;
    cache.exits = exits;
  }
  const motionBounds = Number.isFinite(options.costBound) ? createMotionBounds(model) : null;
  const motionVariants = createMotionVariants(
    model,
    world,
    profile,
    exits,
    approaches,
    motionBounds
      ? (start: any, end: any) =>
          withinCostBound(
            start,
            end,
            motionBounds.jump({ min: start, max: start }, { min: end, max: end }),
          )
      : undefined,
  );
  const edges = [];
  const source = cache?.source ?? project(from, { maxVertical })[0];
  const goals = cache?.goals ?? project(to, { maxVertical, interaction });
  if (cache) {
    cache.source = source;
    cache.goals = goals;
  }
  diagnostics.goalFaces = goals.length;
  if (!source || !goals.length) {
    diagnostics.reason = 'unmapped-endpoint';
    return { connections, diagnostics };
  }
  for (const connection of existing) {
    if (connection.state !== 'open') continue;
    const fromFaces =
      connection.fromSurface === undefined ? surfaces : [byId.get(connection.fromSurface)];
    const toFaces =
      connection.toSurface === undefined ? surfaces : [byId.get(connection.toSurface)];
    if (!fromFaces[0] || !toFaces[0]) throw new Error('Invalid movement support surface');
    const a = projectSupport(connection.points[0], maxVertical, connection.fromSurface);
    const b = projectSupport(connection.points.at(-1), maxVertical, connection.toSurface);
    if (!a || !b) continue;
    if (
      connection.points
        .slice(1)
        .some((point: any, index: any): any => blocked(connection.points[index], point))
    )
      continue;
    const approach = groundTrace(source.position, a.position);
    if (approach)
      edges.push({
        from: source.surface,
        to: a.surface,
        cost: approach
          .slice(1)
          .reduce(
            (sum: any, point: any, index: any): any => sum + distance(approach[index], point),
            0,
          ),
      });
    edges.push({
      from: a.surface,
      to: b.surface,
      points: connection.points,
      cost:
        distance(centers.get(a.surface), a.position) +
        connection.times.at(-1) * speed +
        distance(b.position, centers.get(b.surface)),
    });
  }
  const fields = cache?.distanceFields ?? {};
  if (cache) cache.distanceFields = fields;
  fields.approach = advanceDistanceField(
    prepared.forward,
    edges,
    [{ id: source.surface, cost: distance(source.position, centers.get(source.surface)) }],
    false,
    fields.approach,
    prepared.lengthScale,
  );
  fields.departure = advanceDistanceField(
    prepared.reverse,
    edges,
    goals.map((goal: any): any => ({
      id: goal.surface,
      cost: distance(goal.position, centers.get(goal.surface)),
    })),
    true,
    fields.departure,
    prepared.lengthScale,
  );
  const approach = fields.approach.costs,
    departure = fields.departure.costs;
  diagnostics.distanceFields = {
    approach: { ...fields.approach.work, reachableNodes: approach.size },
    departure: { ...fields.departure.work, reachableNodes: departure.size },
  };
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius),
    diversity = profile.radius * 2;
  const cellOf = (position: any): any =>
    position.map((value: any) => Math.floor(value / diversity)).join('/');
  const durationLimit = frontier ? Infinity : baseline.cost - baseline.arrivalCost;
  let travelSpeed = Math.max(speed, model.maxHorizontalSpeed);
  for (const connection of existing)
    for (let index = 1; index < connection.points.length; index++) {
      const elapsed = connection.times[index] - connection.times[index - 1];
      if (elapsed > 0)
        travelSpeed = Math.max(
          travelSpeed,
          horizontal(connection.points[index - 1], connection.points[index]) / elapsed,
        );
    }
  const lowerBound = (start: any, end: any, airTime: any): any =>
    (horizontal(from, start) + Math.max(0, horizontal(end, to) - (interaction?.radius ?? 0))) /
      travelSpeed +
    airTime;
  // A completed outer route bounds the useful prefix even when this local
  // ground corridor is much slower. Retain its actual endpoint through waypoint
  // and entry subqueries, which are only discovery guides.
  const costGoal = options.boundGoal ?? to;
  const costLimit = options.costBound ?? Infinity;
  const boundSpeed = Math.max(
    travelSpeed,
    model.startHorizontalSpeed ?? 0,
    options.locomotion?.dash?.speed ?? 0,
  );
  const airSpeed = Math.max(
    model.maxHorizontalSpeed,
    model.startHorizontalSpeed ?? 0,
    Number.EPSILON,
  );
  const withinCostBound = (start: any, end: any, airTime: any) =>
    !Number.isFinite(costLimit) ||
    (Math.max(0, horizontal(from, start) - profile.radius) +
      Math.max(0, horizontal(end, costGoal) - profile.radius)) /
      boundSpeed +
      airTime <=
      costLimit + 1e-9;
  const insets = [
    ...new Set<any>([
      0,
      profile.radius,
      1,
      2,
      3,
      0.5,
      1.5,
      2.5,
      profile.radius * 0.5,
      profile.radius * 0.25,
    ]),
  ];
  const regionSize = Math.max(sampleSpacing, diversity, maxHorizontalDistance / 2);
  const regionOf = (position: any, size = regionSize) =>
    [
      Math.floor(position[0] / size),
      Math.floor(position[1] / Math.max(profile.height, model.maxJumpHeight)),
      Math.floor(position[2] / size),
    ].join('/');
  const spread = (entries: any, position: any, size = regionSize, limit = entries.length): any => {
    if (entries.length < 2 || size <= diversity) return entries.slice(0, limit);
    const regions = new Map<any, any>();
    for (const entry of entries) {
      const key = regionOf(position(entry), size),
        group = regions.get(key) ?? [];
      group.push(entry);
      regions.set(key, group);
    }
    return interleave(
      [...regions.values()]
        .slice(0, limit)
        .map((group): any => spread(group, position, size / 2, limit)),
      limit,
    );
  };
  const cursorKey = reverse ? 'reverseCursor' : 'forwardCursor';
  // Reachability changes when any authored action changes, including an update
  // that keeps its id. Geometry failures remain in the query's independent caches.
  const revision = JSON.stringify(
    existing.map((edge: any): any => [
      edge.id,
      edge.state,
      edge.fromSurface,
      edge.toSurface,
      edge.points,
      edge.times,
      edge.requiredGait,
      edge.requiredBoost,
      edge.endpointTolerance,
      edge.terminal,
      edge.boostExpiry,
    ]),
  );
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
    const ordering =
      cache?.ordering ??
      ((): any => {
        const source = new Float64Array(boundaries.length),
          target = new Float64Array(boundaries.length),
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
    const nearLine = (a: any, b: any) => ordering.line[a.ordinal] - ordering.line[b.ordinal];
    const stable =
      (compare: any): any =>
      (a: any, b: any): any =>
        compare(a, b) || a.ordinal - b.ordinal;
    goalBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const surface of prepared.landingSurfaces)
      if (departure.has(surface.id)) {
        for (let axis = 0; axis < 3; axis++) {
          goalBounds.min[axis] = Math.min(goalBounds.min[axis], surface.min[axis]);
          goalBounds.max[axis] = Math.max(goalBounds.max[axis], surface.max[axis]);
        }
      }
    const goalCenter = goalBounds.min.map(
      (value: any, axis: any) => (value + goalBounds.max[axis]) / 2,
    );
    const predecessor =
      frontier && reverse
        ? createJumpPredecessor(goalBounds, {
            model,
            maxDrop,
            maxHorizontalDistance,
            endpointTolerance,
            sourcePadding: [
              Math.max(...insets) + profile.radius / 2,
              maxVertical,
              Math.max(...insets) + profile.radius / 2,
            ],
            targetPadding: [profile.radius / 2, maxVertical, profile.radius / 2],
          })
        : null;
    // Visit coarse spatial regions before refining body-scale offsets. A distant
    // opening must compete with nearby ledges even on a densely triangulated floor.
    const seedLimit = diagnostics.limits.seedChecks;
    const treeKey = JSON.stringify([
      regionSize,
      Math.max(profile.height, model.maxJumpHeight),
      diversity,
    ]);
    if (prepared.boundaryOrder?.key !== treeKey)
      prepared.boundaryOrder = {
        key: treeKey,
        tree: boundaryTree(
          boundaries,
          regionSize,
          Math.max(profile.height, model.maxJumpHeight),
          diversity,
        ),
      };
    const order = (eligible: any, compare: any): any =>
      boundaryOrder(
        prepared.boundaryOrder.tree,
        eligible,
        stable(compare),
        frontier ? boundaries.length : seedLimit,
      );
    const sourceEdges = reverse
      ? order(
          (boundary: any) => !departure.has(boundary.surface),
          (a: any, b: any) => ordering.target[a.ordinal] - ordering.target[b.ordinal],
        )
      : order(
          (boundary: any): any => approach.has(boundary.surface),
          (a: any, b: any) => approach.get(a.surface) - approach.get(b.surface) || nearLine(a, b),
        );
    const goalEdges = frontier
      ? []
      : order(
          (boundary: any): any => departure.has(boundary.surface),
          (a: any, b: any) => departure.get(a.surface) - departure.get(b.surface) || nearLine(a, b),
        );
    const otherEdges = frontier
      ? []
      : order(
          (boundary: any) => !approach.has(boundary.surface) || !departure.has(boundary.surface),
          nearLine,
        );
    const visibleEdges =
      frontier && !reverse
        ? order(
            (boundary: any) => !approach.has(boundary.surface),
            (a: any, b: any) => ordering.source[a.ordinal] - ordering.source[b.ordinal],
          )
        : [];
    const orderedEdges = frontier
      ? interleave(
          [sourceEdges, visibleEdges].filter((edges): any => edges.length),
          boundaries.length,
        )
      : interleave(
          [sourceEdges, goalEdges, otherEdges].filter((edges): any => edges.length),
          boundaries.length * 3,
        );
    const seedStream = function* (boundary: any): any {
      // Preserve the original budgeted seed prefix. Proven empty regions still
      // consume their old slots, without projection or spatial-query work.
      const excluded = predecessor && !predecessor(boundary);
      const samples = Math.max(
        1,
        Math.ceil(boundary.length / Math.min(sampleSpacing, profile.radius / 4)),
      );
      const dx = boundary.b[0] - boundary.a[0],
        dz = boundary.b[2] - boundary.a[2];
      const nearest = (reference: any) =>
        Math.max(
          0,
          Math.min(
            1,
            ((reference[0] - boundary.a[0]) * dx + (reference[2] - boundary.a[2]) * dz) /
              (dx * dx + dz * dz),
          ),
        );
      const emitted = new Set<any>();
      const levels = frontier
        ? [...new Set<any>([Math.min(4, samples), Math.min(16, samples), samples])]
        : [Math.min(samples, Math.floor(diagnostics.limits.seedChecks / insets.length))];
      if (levels.at(-1) < samples) diagnostics.truncated = true;
      for (const refinement of levels) {
        const fractions = new Set<any>([nearest(to), nearest(goalCenter), nearest(from), 0.5]);
        for (let index = 0; index < refinement; index++) fractions.add((index + 0.5) / refinement);
        const fresh = [...fractions].filter((fraction) => !emitted.has(fraction));
        for (const fraction of fresh) emitted.add(fraction);
        for (const inset of insets)
          for (const fraction of fresh) {
            if (excluded) {
              yield { excluded: true };
              continue;
            }
            const seed = boundary.a.map(
              (value: any, axis: any): any => value + fraction * (boundary.b[axis] - value),
            );
            seed[0] += boundary.inward[0] * inset;
            seed[2] += boundary.inward[1] * inset;
            yield {
              seed,
              exit: [
                seed[0] - boundary.inward[0] * (inset + profile.radius * 3),
                seed[2] - boundary.inward[1] * (inset + profile.radius * 3),
              ],
            };
          }
      }
    };
    // Boundary streams retain their offsets. Activate new ledges before revisiting
    // a dense patch, then round-robin the remaining offsets across all ledges.
    seedIterator = (function* (): any {
      let streams = [];
      for (const boundary of new Set<any>(orderedEdges)) {
        const stream = seedStream(boundary),
          next = stream.next();
        if (!next.done) {
          streams.push(stream);
          yield next.value;
        }
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
    cursor = {
      revision,
      maxLinks,
      goalBounds,
      seeds: seedIterator,
      seen: new Set<any>(),
      seedDone: false,
      active: [],
      pairs: new Map<any, any>(),
      pairSeen: new Set<any>(),
      pending: [],
      ready: [],
      rejected: new Set<any>(),
      accepted: new Set<any>(),
      serial: 0,
      representativeLimited: false,
    };
    if (cache) cache[cursorKey] = cursor;
  }
  if (cursor) cursor.maxLinks = maxLinks;
  const refill = !cursor || cursor.pending.length + cursor.ready.length < maxCandidates;
  const seen = cursor?.seen ?? new Set<any>();
  seedIterator = cursor?.seeds ?? seedIterator;
  while (refill && diagnostics.seedChecks < diagnostics.limits.seedChecks && !cursor?.seedDone) {
    const next = seedIterator.next();
    if (next.done) {
      if (cursor) cursor.seedDone = true;
      break;
    }
    diagnostics.seedChecks++;
    if (next.value.excluded) continue;
    const nav = project(next.value.seed, { maxVertical })[0];
    if (
      !nav ||
      lowerBound(nav.position, nav.position, 0) >= durationLimit ||
      !withinCostBound(nav.position, nav.position, 0)
    )
      continue;
    const key = JSON.stringify(nav.position);
    if (seen.has(key)) continue;
    seen.add(key);
    // Reverse frontiers can land only in the goal-reachable ground set. Its
    // union box is an optimistic predecessor constraint, including boundary
    // inset/projection witnesses. Forward discovery still explores relay regions.
    if (
      frontier &&
      reverse &&
      !createJumpEnvelope(nav.position, {
        model,
        maxDrop,
        maxHorizontalDistance,
        endpointTolerance,
        padding: [profile.radius / 2, maxVertical, profile.radius / 2],
      })(goalBounds)
    ) {
      diagnostics.rejected.range++;
      continue;
    }
    takeoffs.push({
      ...nav,
      cell: cellOf(nav.position),
      exit: next.value.exit,
      walk: approach.has(nav.surface)
        ? approach.get(nav.surface) + distance(centers.get(nav.surface), nav.position)
        : distance(from, nav.position),
    });
  }
  const eligible = (id: any): any => !frontier || (reverse ? departure.has(id) : !approach.has(id));
  const landingQueries =
    cursor?.landingQueries ??
    [
      ...(frontier
        ? [true, false].map((connected): any => ({
            boundary: true,
            query: prepared.boundaryIndex.filterGroups(
              (group: any): any =>
                eligible(prepared.representatives[group]) &&
                departure.has(prepared.representatives[group]) === connected,
            ),
          }))
        : []),
      ...[true, false].map((connected): any => ({
        boundary: false,
        query: prepared.landingIndex.filterGroups(
          (group: any): any =>
            eligible(prepared.representatives[group]) &&
            departure.has(prepared.representatives[group]) === connected,
        ),
      })),
    ].filter(({ query }) => !query.empty);
  if (cursor) cursor.landingQueries = landingQueries;
  const rejectedPairs = cursor?.rejected ?? new Set<any>();
  const pairKey = (start: any, end: any) =>
    JSON.stringify([start.surface, start.position, start.exit, end.surface, end.position]);
  const pairs = cursor?.pairs ?? new Map<any, any>();
  const fullSources = new Set<any>();
  const dominated = frontier
    ? null
    : createCandidateBounds({
        model,
        endpointTolerance,
        diversity,
        speed,
        to,
        centers,
        departure,
        pairs,
        limit: insets.length,
      });
  const goalWitness = frontier ? undefined : createLandingGoalCache(to);
  const active = cursor?.active ?? [];
  for (const start of takeoffs) {
    const bounds = {
      min: [
        start.position[0] - maxHorizontalDistance,
        start.position[1] - maxDrop - 2 * endpointTolerance,
        start.position[2] - maxHorizontalDistance,
      ],
      max: [
        start.position[0] + maxHorizontalDistance,
        start.position[1] + model.maxJumpHeight + 2 * endpointTolerance,
        start.position[2] + maxHorizontalDistance,
      ],
    };
    const heights = new Set<any>([
      start.position[1],
      Math.min(bounds.max[1], Math.max(bounds.min[1], to[1])),
    ]);
    for (const { query, boundary } of landingQueries) {
      const envelope = createJumpEnvelope(start.position, {
        model,
        maxDrop,
        maxHorizontalDistance,
        endpointTolerance,
        padding: boundary ? [profile.radius / 2, maxVertical, profile.radius / 2] : [0, 0, 0],
      });
      const approachTime =
        Math.max(0, horizontal(from, start.position) - profile.radius) / boundSpeed;
      const inset = boundary ? profile.radius / 2 : 0;
      const intersects = Number.isFinite(costLimit)
        ? (box: any): any => {
            const dx = Math.max(
              box.min[0] - inset - start.position[0],
              0,
              start.position[0] - box.max[0] - inset,
            );
            const dz = Math.max(
              box.min[2] - inset - start.position[2],
              0,
              start.position[2] - box.max[2] - inset,
            );
            const gx = Math.max(
              box.min[0] - inset - costGoal[0],
              0,
              costGoal[0] - box.max[0] - inset,
            );
            const gz = Math.max(
              box.min[2] - inset - costGoal[2],
              0,
              costGoal[2] - box.max[2] - inset,
            );
            return (
              approachTime +
                Math.max(0, Math.hypot(dx, dz) - 2 * profile.radius) / airSpeed +
                Math.max(0, Math.hypot(gx, gz) - profile.radius) / boundSpeed <=
                costLimit + 1e-9 && envelope(box)
            );
          }
        : envelope;
      for (const height of heights)
        active.push({
          start,
          boundary,
          iterator: query.nearest(
            bounds,
            [start.position[0], height, start.position[2]],
            intersects,
          ),
        });
    }
  }
  let queryIndex = 0,
    activeQueries = active.length;
  while (
    refill &&
    activeQueries &&
    diagnostics.neighbourChecks < diagnostics.limits.neighbourChecks
  ) {
    const index = queryIndex++ % active.length,
      query = active[index];
    if (!query) continue;
    const next = query.iterator.next();
    if (next.done) {
      active[index] = null;
      activeQueries--;
      continue;
    }
    diagnostics.neighbourChecks++;
    const start = query.start,
      surface = next.value;
    if (dominated && !query.boundary && fullSources.has(start.cell) && dominated(start, surface)) {
      diagnostics.dominatedFaces++;
      continue;
    }
    const ends = query.boundary
      ? project(boundaryLanding(surface, start.position, profile.radius / 2), { maxVertical })
      : landingCandidates(surface, start.position, to, model, profile.radius, goalWitness);
    for (const end of ends) {
      if (!end || end.surface === start.surface) continue;
      const identity = cursor ? pairKey(start, end) : null;
      if (cursor && (rejectedPairs.has(identity) || cursor.pairSeen.has(identity))) continue;
      const span = horizontal(start.position, end.position),
        drop = start.position[1] - end.position[1];
      if (span > maxHorizontalDistance || drop > maxDrop + 2 * endpointTolerance) continue;
      const duration = jumpDuration(
        start.position[1] + endpointTolerance,
        end.position[1] - endpointTolerance,
        { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' },
      );
      if (
        duration === null ||
        span > duration * model.maxHorizontalSpeed ||
        !withinCostBound(
          start.position,
          end.position,
          Math.max(0, span - 2 * profile.radius) / airSpeed,
        ) ||
        lowerBound(
          start.position,
          end.position,
          span / Math.max(Number.EPSILON, model.maxHorizontalSpeed),
        ) >= durationLimit
      )
        continue;
      const nominal = jumpDuration(start.position[1], end.position[1], {
        ...model,
        mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
      });
      const remaining = departure.has(end.surface)
        ? departure.get(end.surface) + distance(centers.get(end.surface), end.position)
        : distance(end.position, to);
      const score = (start.walk + remaining) / speed + (nominal ?? duration);
      const key = `${start.cell}:${cellOf(end.position)}`;
      const group = pairs.get(key) ?? [];
      cursor?.pairSeen.add(identity);
      const uncertain = nominal === null || span > nominal * model.maxHorizontalSpeed;
      const compare = (entry: any) =>
        Number(uncertain) - Number(entry.uncertain) || score - entry.score || 0;
      // Retain fine pullbacks for railings without letting one dense triangle
      // patch displace transfers elsewhere in the scene. Admit only competitive
      // witnesses, preserving stable ties without sorting the whole bucket again.
      if (!frontier && group.length === insets.length) {
        if (compare(group.at(-1)) >= 0) continue;
        group.pop();
      }
      const candidate = {
        start,
        end,
        cell: key,
        score,
        connected: approach.has(start.surface) && departure.has(end.surface),
        uncertain,
      };
      if (frontier) {
        group.push(candidate);
        group.sort(
          (a: any, b: any) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score,
        );
        if (group.length > insets.length) {
          group.pop();
          cursor.representativeLimited = true;
        }
      } else {
        let index = group.length;
        group.push(candidate);
        while (index > 0 && compare(group[index - 1]) < 0) {
          group[index] = group[index - 1];
          index--;
        }
        group[index] = candidate;
      }
      pairs.set(key, group);
      if (dominated && group.length === insets.length && !group.at(-1).uncertain)
        fullSources.add(start.cell);
    }
  }
  if (cursor) {
    const next = queryIndex % Math.max(1, active.length);
    cursor.active = [...active.slice(next), ...active.slice(0, next)].filter(Boolean);
  } else if (activeQueries) diagnostics.truncated = true;
  const candidateLimit = cursor
    ? [...pairs.values()].reduce((sum, group): any => sum + group.length, 0)
    : maxCandidates;
  const compare = (a: any, b: any) =>
    Number(a.uncertain) - Number(b.uncertain) || a.score - b.score;
  const connected: any = [],
    intermediate: any = [];
  for (const group of pairs.values()) (group[0].connected ? connected : intermediate).push(group);
  const orderLaunches = (groups: any): any => {
    const launches = new Map<any, any>();
    for (const group of groups) {
      const key = group[0].start.cell,
        destinations = launches.get(key) ?? [];
      destinations.push(group);
      launches.set(key, destinations);
    }
    const batches = [...launches.values()].map((destinations): any =>
      interleave(
        destinations.sort((a: any, b: any) => compare(a[0], b[0])),
        candidateLimit,
      ),
    );
    return interleave(
      spread(
        batches.sort((a, b) => compare(a[0], b[0])),
        (batch: any): any => batch[0].start.position,
      ),
      candidateLimit,
    );
  };
  const ordered = interleave(
    [connected, intermediate].filter((groups): any => groups.length).map(orderLaunches),
    candidateLimit,
  );
  diagnostics.candidatePairs =
    [...pairs.values()].reduce((sum, group): any => sum + group.length, 0) +
    (cursor?.pending.length ?? 0) +
    (cursor?.ready.length ?? 0);
  if (ordered.length < diagnostics.candidatePairs) diagnostics.truncated = true;
  if (cursor) {
    for (const candidate of ordered) cursor.ready.push(candidate);
    pairs.clear();
  }
  const cached = cache?.standing ?? new Map<any, any>(),
    motions = cache?.motions ?? new Map<any, any>();
  if (cache) {
    cache.standing = cached;
    cache.motions = motions;
  }
  const accepted = cursor?.accepted ?? new Set<any>(),
    tried = new Set<any>();
  const retained: { score: number; connection: any }[][] = [[], []];
  const hasConnected =
    connected.length > 0 ||
    Boolean(cursor?.pending.some((entry: any): any => entry.candidate.connected)) ||
    Boolean(cursor?.ready.some((entry: any): any => entry.connected));
  const hasIntermediate =
    intermediate.length > 0 ||
    Boolean(cursor?.pending.some((entry: any) => !entry.candidate.connected)) ||
    Boolean(cursor?.ready.some((entry: any) => !entry.connected));
  const capacity =
    hasConnected && hasIntermediate
      ? [Math.ceil(maxLinks / 2), Math.floor(maxLinks / 2)]
      : [hasConnected ? maxLinks : 0, hasIntermediate ? maxLinks : 0];
  let serial = cursor?.serial ?? 0;
  const ids = new Set<any>(existing.map((connection: any): any => connection.id));
  const standing = (seed: any): any => {
    const key = JSON.stringify([seed.position, seed.surface]);
    if (cached.has(key)) return cached.get(key);
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
      diagnostics.truncated = true;
      return null;
    }
    diagnostics.endpointChecks++;
    const foot = standingFoot(seed, world, { profile, maxVertical, maxSlope, blocked, project });
    if (foot.reason) diagnostics.rejected[foot.reason]++;
    const value = foot.reason ? null : foot;
    cached.set(key, value);
    return value;
  };
  let candidates = cursor?.pending ?? [];
  const ready = cursor
    ? cursor.ready.splice(0, Math.max(0, maxCandidates - candidates.length))
    : ordered;
  for (const candidate of ready) candidates.push({ candidate });
  validation: while (candidates.length) {
    const pending = [];
    for (const [index, entry] of candidates.entries()) {
      if (
        diagnostics.attempted >= diagnostics.limits.arcAttempts ||
        diagnostics.endpointChecks >= diagnostics.limits.endpointChecks
      ) {
        diagnostics.truncated = true;
        for (let remaining = index; remaining < candidates.length; remaining++)
          pending.push(candidates[remaining]);
        candidates = pending;
        break validation;
      }
      const { candidate } = entry;
      const pool = candidate.connected ? 0 : 1,
        entries = retained[pool];
      if (
        !capacity[pool] ||
        (entries.length >= capacity[pool] && (frontier || candidate.score >= entries.at(-1)!.score))
      )
        continue;
      const cell = candidate.cell;
      if (accepted.has(cell)) continue;
      if (!entry.variants) {
        const start = standing(candidate.start);
        if (!start) {
          if (cached.has(JSON.stringify([candidate.start.position, candidate.start.surface])))
            rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        if (
          frontier &&
          !reverse &&
          !approach.has(start.surface) &&
          !groundTrace(source.position, candidate.start.position)
        ) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        const end = standing(candidate.end);
        if (!end) {
          if (cached.has(JSON.stringify([candidate.end.position, candidate.end.surface])))
            rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        if (start.position[1] - end.position[1] > maxDrop) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        if (
          frontier &&
          (reverse
            ? departure.has(start.surface) || !departure.has(end.surface)
            : approach.has(end.surface))
        ) {
          rejectedPairs.add(pairKey(candidate.start, candidate.end));
          continue;
        }
        const key = JSON.stringify([start.position, end.position, candidate.start.exit]);
        if (tried.has(key)) continue;
        tried.add(key);
        const ground = frontier
          ? null
          : groundTrace(candidate.start.position, candidate.end.position);
        Object.assign(entry, {
          start,
          end,
          groundTime: ground
            ? ground
                .slice(1)
                .reduce(
                  (sum: any, point: any, index: any): any => sum + distance(ground[index], point),
                  0,
                ) / speed
            : Infinity,
          variants: motionVariants(start.position, end.position, candidate.start.exit),
        });
      }
      const next = entry.variants.next();
      if (next.done) {
        rejectedPairs.add(pairKey(candidate.start, candidate.end));
        continue;
      }
      pending.push(entry);
      const { start, end, groundTime } = entry,
        variant = next.value,
        { mode } = variant;
      if (mode === 'jump' && model.maxJumpHeight === 0) continue;
      const duration = jumpDuration(start.position[1], end.position[1], { ...model, mode });
      if (
        duration === null ||
        horizontal(start.position, end.position) > duration * model.maxHorizontalSpeed ||
        lowerBound(start.position, end.position, duration) >= durationLimit
      )
        continue;
      if (groundTime <= duration) {
        diagnostics.rejected.groundDominated++;
        continue;
      }
      if (mode === 'drop' && motionBounds) {
        const prefix = variant.exit
          ? approaches.get(JSON.stringify([start.position, variant.exit]))
          : undefined;
        const minimum = motionBounds.runOff(
          { min: start.position, max: start.position },
          { min: end.position, max: end.position },
          prefix
            ? {
                launch: prefix.launch,
                distance: prefix.distances.at(-1),
              }
            : undefined,
        );
        if (!withinCostBound(start.position, end.position, minimum)) continue;
      }
      const motion = {
        ...model,
        profile,
        walls,
        wallCheck: blocked,
        ...variant,
        sweep: (from: any, to: any, body: any): any => world.sweepCapsule(from, to, body),
      };
      const motionKey = JSON.stringify([start.position, end.position, variant]);
      let arc = motions.get(motionKey);
      if (arc === undefined) {
        diagnostics.attempted++;
        arc =
          mode === 'drop'
            ? runOffConnection(
                start.position,
                end.position,
                { ...motion, world, maxSlope },
                approaches,
              )
            : jumpConnection(start.position, end.position, motion);
        motions.set(motionKey, arc);
      }
      if (!arc) {
        diagnostics.rejected.motion++;
        continue;
      }
      if (!withinCostBound(start.position, end.position, arc.times.at(-1))) continue;
      let id;
      do {
        id = `shortcut/${serial++}`;
      } while (ids.has(id));
      ids.add(id);
      entries.push({
        score: candidate.score,
        connection: {
          id,
          ...arc,
          state: 'open',
          endpointTolerance,
          fromSurface: start.surface,
          toSurface: end.surface,
        },
      });
      entries.sort((a, b) => a.score - b.score);
      if (entries.length > capacity[pool]) entries.pop();
      accepted.add(cell);
      pending.pop();
      if (frontier) {
        for (let remaining = index + 1; remaining < candidates.length; remaining++)
          pending.push(candidates[remaining]);
        candidates = pending;
        break validation;
      }
    }
    candidates = pending;
  }
  if (cursor) {
    cursor.pending = candidates;
    cursor.serial = serial;
    diagnostics.cursor = {
      resumed,
      pending: cursor.pending.length + cursor.ready.length,
      seedExhausted: cursor.seedDone,
      landingQueries: cursor.active.length,
    };
    diagnostics.truncated ||=
      cursor.representativeLimited ||
      !cursor.seedDone ||
      cursor.active.length > 0 ||
      pairs.size > 0 ||
      candidates.length > 0 ||
      cursor.ready.length > 0;
  } else if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) diagnostics.truncated = true;
  for (const entries of retained) for (const entry of entries) connections.push(entry.connection);
  diagnostics.accepted = connections.length;
  return { connections, diagnostics };
}
