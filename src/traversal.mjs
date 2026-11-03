import { surfaceGraph, surfacePortals } from './surfaces.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createMinHeap } from './heap.mjs';
import { createGoalProjector } from './goals.mjs';
import { createWallChecker } from './walls.mjs';
import { jumpConnection, jumpDuration } from './jumps.mjs';

const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const boundaryKey = (surface, edge) => JSON.stringify([surface, edge]);

const groundComponents = (graph) => {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const forward = graph.nodes.map(() => []),
    reverse = graph.nodes.map(() => []);
  for (const edge of graph.edges) {
    if (edge.state !== 'open') continue;
    const from = ids.get(edge.from),
      to = ids.get(edge.to);
    forward[from].push(to);
    reverse[to].push(from);
  }
  const visited = new Uint8Array(graph.nodes.length),
    order = [];
  for (let start = 0; start < graph.nodes.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const stack = [{ node: start, next: 0 }];
    while (stack.length) {
      const current = stack.at(-1),
        neighbours = forward[current.node];
      if (current.next === neighbours.length) {
        order.push(current.node);
        stack.pop();
        continue;
      }
      const next = neighbours[current.next++];
      if (!visited[next]) {
        visited[next] = 1;
        stack.push({ node: next, next: 0 });
      }
    }
  }
  const components = new Int32Array(graph.nodes.length).fill(-1);
  let count = 0;
  for (const start of order.reverse()) {
    if (components[start] !== -1) continue;
    const stack = [start];
    components[start] = count;
    while (stack.length) {
      const node = stack.pop();
      for (const next of reverse[node])
        if (components[next] === -1) {
          components[next] = count;
          stack.push(next);
        }
    }
    count++;
  }
  return { ids, components, count, forward };
};

const canReach = (topology, start, target) => {
  const queue = [start],
    seen = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (node === target) return true;
    for (const next of topology.forward[node])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return false;
};

const onEdge = (point, a, b) => {
  const delta = b.map((value, axis) => value - a[axis]);
  const lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  if (!lengthSquared) return false;
  const t = point.reduce((sum, value, axis) => sum + (value - a[axis]) * delta[axis], 0) / lengthSquared;
  return (
    t >= 0 &&
    t <= 1 &&
    distance(
      point,
      a.map((value, axis) => value + t * delta[axis]),
    ) <= 1e-4
  );
};

const exposedBoundaries = (surfaces, portals) => {
  const covered = new Set();
  for (const portal of surfacePortals(surfaces)) {
    // Skipping the whole edge at a partial portal is conservative for discovery.
    covered.add(boundaryKey(portal.from, portal.fromEdge));
    covered.add(boundaryKey(portal.to, portal.toEdge));
  }
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  for (const portal of portals)
    for (const [id, point] of [
      [portal.from, portal.points[0]],
      [portal.to, portal.points[1]],
    ]) {
      const surface = byId.get(id);
      for (let edge = 0; edge < surface.vertices.length; edge++) {
        if (onEdge(point, surface.vertices[edge], surface.vertices[(edge + 1) % surface.vertices.length]))
          covered.add(boundaryKey(id, edge));
      }
    }
  const boundaries = [];
  for (const surface of surfaces) {
    const center = [0, 1, 2].map(
      (axis) => surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length,
    );
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      if (covered.has(boundaryKey(surface.id, edge))) continue;
      const a = surface.vertices[edge],
        b = surface.vertices[(edge + 1) % surface.vertices.length];
      const midpoint = a.map((value, axis) => (value + b[axis]) / 2);
      const length = horizontal(a, b),
        inwardLength = horizontal(midpoint, center);
      if (!length || !inwardLength) continue;
      const inward = [(center[0] - midpoint[0]) / inwardLength, (center[2] - midpoint[2]) / inwardLength];
      boundaries.push({
        surface: surface.id,
        edge,
        a,
        b,
        midpoint,
        length,
        inward,
      });
    }
  }
  return boundaries;
};

const horizontalGap = (a, b) => Math.hypot(...[0, 2].map(axis =>
  Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0)));

const boundsOf = vertices => ({
  min: [0, 1, 2].map(axis => Math.min(...vertices.map(point => point[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...vertices.map(point => point[axis]))),
});

const interleave = (lists, limit) => {
  const result = [];
  let active = lists.map(entries => ({ entries, cursor: 0 }));
  while (active.length && result.length < limit) {
    const pending = [];
    for (const group of active) {
      if (result.length >= limit) break;
      result.push(group.entries[group.cursor++]);
      if (group.cursor < group.entries.length) pending.push(group);
    }
    active = pending;
  }
  return result;
};

/** Discover directed jumps along optimistic region chains, validating local links lazily.
 * Ground, body, state and collision inputs must describe the same immutable snapshot.
 * Region bounds only order search. Every returned connection has supported feet,
 * stationary body clearance and a swept, wall-checked trajectory under the supplied model.
 * Optional interaction queries all eligible goal faces together and groups them by
 * directed ground component. Sampling limits remain explicit, so failure is inconclusive.
 */
export function findJumpConnections(surfaces, world, options) {
  const {
    profile, portals = [], walls, from, to, interaction, maxVertical, maxSlope, maxDrop,
    maxHorizontalDistance, sampleSpacing, maxCandidates, maxLinks, model,
  } = options ?? {};

  if (
    !profile ||
    !finitePoint(from) ||
    !finitePoint(to) ||
    !Array.isArray(walls) ||
    !model ||
    typeof world?.groundAt !== 'function' ||
    typeof world?.sweepCapsule !== 'function' ||
    ![
      profile.radius,
      profile.height,
      maxVertical,
      maxSlope,
      maxDrop,
      maxHorizontalDistance,
      sampleSpacing,
      maxCandidates,
      maxLinks,
      model.gravity,
      model.fallingGravity,
      model.maxJumpHeight,
      model.maxFallingSpeed,
      model.apexTime,
      model.maxHorizontalSpeed,
    ].every(Number.isFinite) ||
    profile.radius <= 0 ||
    profile.height < profile.radius * 2 ||
    maxVertical < 0 ||
    maxSlope <= 0 ||
    maxSlope >= 90 ||
    maxDrop < 0 ||
    maxHorizontalDistance <= 0 ||
    sampleSpacing <= 0 ||
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    !Number.isSafeInteger(maxLinks) ||
    maxLinks < 1 ||
    model.gravity <= 0 ||
    model.fallingGravity <= 0 ||
    model.maxJumpHeight < 0 ||
    model.maxFallingSpeed <= 0 ||
    model.apexTime < 0 ||
    model.maxHorizontalSpeed < 0
  ) {
    throw new Error('Invalid traversal discovery options');
  }
  const blocked = createWallChecker(walls, profile);
  const diagnostics = {
    reason: 'searched', components: 0, boundaryEdges: 0, endpointChecks: 0,
    standingEndpoints: 0, neighbourChecks: 0, pairChecks: 0, candidatePairs: 0,
    attempted: 0, accepted: 0, truncated: false, regionSearches: 0, regionPairs: 0,
    validatedPairs: 0, pairBatches: 0, deferredPairs: 0, generationBatches: 0, seedChecks: 0, goalFaces: 0, goalComponents: 0,
    sourceEndpoints: 0, targetEndpoints: 0, sourceCandidates: 0, directCandidates: 0,
    limits: {
      maxCandidates, maxLinks, arcAttempts: maxCandidates * 2,
      endpointChecks: maxCandidates * 32, neighbourChecks: maxCandidates * 512,
      pairChecks: maxCandidates * 64, seedChecks: maxCandidates * 64,
    },
    rejected: { projection: 0, support: 0, clearance: 0, range: 0, motion: 0 },
  };
  const connections = [];
  const graph = surfaceGraph(surfaces, { speed: 1, portals });
  graph.edges = graph.edges.filter(edge => !edge.points.slice(1).some((point, index) =>
    blocked(edge.points[index], point)));
  const topology = groundComponents(graph);
  diagnostics.components = topology.count;
  const componentOf = surface => topology.components[topology.ids.get(surface)];
  const project = createGoalProjector(surfaces);
  const source = project(from, { maxVertical })[0];
  const targets = project(to, { maxVertical, interaction }).filter(target =>
    !blocked(target.position, target.position));
  if (!source || !targets.length || blocked(source.position, source.position)) {
    diagnostics.reason = 'unmapped-endpoint';
    return { connections, diagnostics };
  }
  const sourceComponent = componentOf(source.surface);
  const targetComponents = new Set(targets.map(target => componentOf(target.surface)));
  diagnostics.sourceComponent = sourceComponent;
  diagnostics.targetComponent = componentOf(targets[0].surface);
  diagnostics.goalFaces = targets.length;
  diagnostics.goalComponents = targetComponents.size;
  if (targets.some(target => canReach(topology, topology.ids.get(source.surface), topology.ids.get(target.surface)))) {
    diagnostics.reason = 'ground-connected';
    diagnostics.targetReached = true;
    return { connections, diagnostics };
  }

  const regions = Array.from({ length: topology.count }, (_, component) => ({
    id: String(component), component, min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity], boundaries: [],
  }));
  for (const surface of surfaces) {
    const region = regions[componentOf(surface.id)];
    for (const point of surface.vertices) for (let axis = 0; axis < 3; axis++) {
      region.min[axis] = Math.min(region.min[axis], point[axis]);
      region.max[axis] = Math.max(region.max[axis], point[axis]);
    }
  }
  const boundaries = exposedBoundaries(surfaces, portals);
  for (const boundary of boundaries) {
    Object.assign(boundary, boundsOf([boundary.a, boundary.b]));
    regions[componentOf(boundary.surface)].boundaries.push(boundary);
  }
  diagnostics.boundaryEdges = boundaries.length;
  const queryRegions = createBoundsIndex(regions);
  const endpointTolerance = Math.min(maxVertical, profile.radius);
  const transfers = new Map(), groundIncoming = new Map();
  const transfer = (a, b, ground, reach) => {
    const key = `${a.id}/${b.id}`;
    if (transfers.has(key)) return transfers.get(key);
    const gap = horizontalGap(a, b);
    // This optimistic ordering favours short chains; it is never a travel-time
    // proof or a grant of access through the overlapping region bounds.
    const entry = { key, a, b, ground, reach, closed: false,
      cost: ground ? 0 : 1 + gap / Math.max(1, model.maxHorizontalSpeed) };
    transfers.set(key, entry);
    return entry;
  };
  for (const edge of graph.edges) {
    const a = regions[componentOf(edge.from)], b = regions[componentOf(edge.to)];
    if (a === b) continue;
    const entries = groundIncoming.get(b.id) ?? new Set();
    entries.add(transfer(a, b, true, 0));
    groundIncoming.set(b.id, entries);
  }
  const incoming = new Map(), preparedIncoming = new Map();
  const pairingAvailable = () => diagnostics.neighbourChecks < diagnostics.limits.neighbourChecks &&
    diagnostics.pairChecks < diagnostics.limits.pairChecks;
  const generationAvailable = () => diagnostics.seedChecks < diagnostics.limits.seedChecks && pairingAvailable();
  const neighbours = b => {
    if (!generationAvailable()) return [...(groundIncoming.get(b.id) ?? []), ...(preparedIncoming.get(b.id) ?? [])];
    if (incoming.has(b.id)) return incoming.get(b.id);
    const entries = [...(groundIncoming.get(b.id) ?? [])];
    const bounds = {
      min: [b.min[0] - maxHorizontalDistance, b.min[1] - model.maxJumpHeight - 2 * endpointTolerance, b.min[2] - maxHorizontalDistance],
      max: [b.max[0] + maxHorizontalDistance, b.max[1] + maxDrop + 2 * endpointTolerance, b.max[2] + maxHorizontalDistance],
    };
    for (const a of queryRegions(bounds)) {
      if (a === b || !a.boundaries.length || !b.boundaries.length) continue;
      const drop = Math.min(maxDrop, a.max[1] - b.min[1] + 2 * endpointTolerance);
      if (-drop > model.maxJumpHeight || a.min[1] - b.max[1] - 2 * endpointTolerance > maxDrop) continue;
      const duration = jumpDuration(drop, 0, { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
      const reach = duration === null ? 0 : Math.min(maxHorizontalDistance, duration * model.maxHorizontalSpeed);
      if (duration !== null && horizontalGap(a, b) <= reach) entries.push(transfer(a, b, false, reach));
    }
    incoming.set(b.id, entries);
    diagnostics.regionPairs = transfers.size;
    return entries;
  };

  const sourceRegion = regions[sourceComponent];
  const heuristic = region => Math.hypot(...[0, 1, 2].map(axis =>
    Math.max(region.min[axis] - from[axis], from[axis] - region.max[axis], 0))) /
      Math.max(1, model.maxHorizontalSpeed) +
    Math.max(0, region.min[1] - from[1]) / Math.max(1, model.maxJumpHeight);
  const findChain = () => {
    const pending = createMinHeap(), costs = new Map(), next = new Map();
    for (const component of targetComponents) {
      const region = regions[component];
      costs.set(region.id, 0);
      pending.push({ region, travelled: 0, cost: heuristic(region) });
    }
    while (pending.size) {
      const { region, travelled } = pending.pop();
      if (travelled !== costs.get(region.id)) continue;
      if (region === sourceRegion) {
        const chain = [];
        for (let entry = next.get(region.id); entry; entry = next.get(entry.b.id)) chain.push(entry);
        return chain;
      }
      for (const entry of neighbours(region)) {
        if (entry.closed) continue;
        const cost = travelled + entry.cost;
        if (cost >= (costs.get(entry.a.id) ?? Infinity)) continue;
        costs.set(entry.a.id, cost);
        next.set(entry.a.id, entry);
        pending.push({ region: entry.a, travelled: cost, cost: cost + heuristic(entry.a) });
      }
    }
    return null;
  };

  const cachedStanding = new Map();
  const standing = (seed, component) => {
    const key = JSON.stringify([component, seed]);
    if (cachedStanding.has(key)) return cachedStanding.get(key);
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
      diagnostics.truncated = true;
      return null;
    }
    diagnostics.endpointChecks++;
    let result = null;
    const nav = project(seed, { maxVertical })[0];
    if (!nav || componentOf(nav.surface) !== component) diagnostics.rejected.projection++;
    else {
      const support = world.groundAt(nav.position, { maxUp: profile.radius, maxDown: profile.radius, maxSlope });
      if (!support) diagnostics.rejected.support++;
      else {
        const feet = [...support.position];
        feet[1] += profile.radius * (1 / support.normal[1] - 1) + 0.005;
        const attachment = project(feet, { maxVertical: endpointTolerance })[0];
        if (!attachment || componentOf(attachment.surface) !== component) diagnostics.rejected.projection++;
        else if (blocked(feet, feet) || world.sweepCapsule(feet, feet, profile) !== null) diagnostics.rejected.clearance++;
        else {
          result = { position: feet, surface: attachment.surface };
          diagnostics.standingEndpoints++;
          if (component === sourceComponent) diagnostics.sourceEndpoints++;
          if (targetComponents.has(component)) diagnostics.targetEndpoints++;
        }
      }
    }
    cachedStanding.set(key, result);
    return result;
  };

  const insets = [...new Set([
    0, profile.radius * 0.25, profile.radius * 0.5, profile.radius, 0.5, 1, 1.5, 2, 2.5, 3,
  ])].sort((a, b) => a - b);
  const seedsFor = (region, other, takeoff, reach, limit) => {
    const seeds = [], seen = new Set();
    const center = other.min.map((value, axis) => (value + other.max[axis]) / 2);
    const edges = region.boundaries.filter(boundary =>
      horizontalGap(boundary, other) <= reach + insets.at(-1) &&
      (takeoff
        ? boundary.max[1] + model.maxJumpHeight + endpointTolerance >= other.min[1] &&
          boundary.min[1] - maxDrop - endpointTolerance <= other.max[1]
        : boundary.min[1] <= other.max[1] + model.maxJumpHeight + endpointTolerance &&
          boundary.max[1] >= other.min[1] - maxDrop - endpointTolerance))
      .sort((a, b) => horizontalGap(a, other) - horizontalGap(b, other) ||
        distance(a.midpoint, takeoff ? to : from) - distance(b.midpoint, takeoff ? to : from));
    let generated = 0;
    for (const boundary of edges) {
      const samples = Math.max(1, Math.ceil(boundary.length / sampleSpacing));
      const dx = boundary.b[0] - boundary.a[0], dz = boundary.b[2] - boundary.a[2];
      const nearest = Math.max(0, Math.min(1,
        ((center[0] - boundary.a[0]) * dx + (center[2] - boundary.a[2]) * dz) / (dx * dx + dz * dz)));
      // Always try the closest part of a long ledge before uniform refinement.
      const fractions = new Set([nearest, 0.5]);
      const refinement = Math.min(samples, Math.max(0, Math.floor((limit - generated) / insets.length)));
      if (refinement < samples) diagnostics.truncated = true;
      for (let sample = 0; sample < refinement; sample++) fractions.add((sample + 0.5) / refinement);
      for (const fraction of fractions) for (const inset of insets) {
        if (generated >= limit || diagnostics.seedChecks >= diagnostics.limits.seedChecks) {
          diagnostics.truncated = true;
          return seeds;
        }
        generated++;
        diagnostics.seedChecks++;
        const point = boundary.a.map((value, axis) => value + fraction * (boundary.b[axis] - value));
        point[0] += boundary.inward[0] * inset;
        point[2] += boundary.inward[1] * inset;
        const key = JSON.stringify(point);
        if (seen.has(key)) continue;
        seen.add(key);
        const nav = project(point, { maxVertical })[0];
        // Pullbacks can leave a thin platform. Reject those cheap navigation
        // misses before they consume landing diversity or physical sweep work.
        if (!nav || componentOf(nav.surface) !== region.component) continue;
        seeds.push(nav.position);
      }
    }
    return seeds;
  };

  const spreadSeeds = seeds => {
    const cells = new Map();
    for (const seed of seeds) {
      const key = seed.map(value => Math.floor(value / (profile.radius * 2))).join('/');
      const group = cells.get(key) ?? [];
      group.push(seed);
      cells.set(key, group);
    }
    return interleave([...cells.values()], seeds.length);
  };

  const pairsFor = function* ({ a, b, reach }) {
    if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) {
      diagnostics.truncated = true;
      return;
    }
    const available = diagnostics.limits.seedChecks - diagnostics.seedChecks;
    const takeoffs = spreadSeeds(seedsFor(a, b, true, reach, Math.floor(available / 2)));
    const landings = spreadSeeds(seedsFor(b, a, false, reach, diagnostics.limits.seedChecks - diagnostics.seedChecks));
    const queryLandings = createBoundsIndex(landings.map(point => ({ min: point, max: point, point })));

    let active = [];
    for (const start of takeoffs) {
      const duration = jumpDuration(start[1] + endpointTolerance,
        Math.max(b.min[1] - endpointTolerance, start[1] + endpointTolerance - maxDrop),
        { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
      if (duration === null) continue;
      const reach = Math.min(maxHorizontalDistance, duration * model.maxHorizontalSpeed);
      const bounds = {
        min: [start[0] - reach, start[1] - maxDrop - 2 * endpointTolerance, start[2] - reach],
        max: [start[0] + reach, start[1] + model.maxJumpHeight + 2 * endpointTolerance, start[2] + reach],
      };
      active.push({ start, landings: queryLandings.nearest(bounds, to) });
    }
    while (active.length) {
      const pending = [];
      for (const query of active) {
        let exhausted = false;
        for (let count = 0; count < 8; count++) {
          const landing = query.landings.next();
          if (landing.done) { exhausted = true; break; }
          yield { start: query.start, end: landing.value.point };
        }
        if (!exhausted) pending.push(query);
      }
      active = pending;
    }
  };

  const candidatesFor = entry => {
    const { a, b } = entry;
    const generation = entry.generation ??= { pairs: pairsFor(entry), pending: [], cursor: 0, done: false };
    const nextBatch = () => {
      const candidates = generation.pending.slice(generation.cursor, generation.cursor + maxCandidates);
      generation.cursor += candidates.length;
      diagnostics.candidatePairs += candidates.length;
      if (a.component === sourceComponent) {
        diagnostics.sourceCandidates += candidates.length;
        if (targetComponents.has(b.component)) diagnostics.directCandidates += candidates.length;
      }
      return candidates;
    };
    if (generation.cursor < generation.pending.length) return nextBatch();
    if (generation.done || !pairingAvailable()) return [];
    diagnostics.generationBatches++;
    const previousPairs = diagnostics.pairChecks, previousNeighbours = diagnostics.neighbourChecks;
    const buckets = new Map(), diversity = profile.radius * 2;
    const compare = (a, b) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score;
    while (pairingAvailable() && diagnostics.pairChecks - previousPairs < maxCandidates * 4 &&
        diagnostics.neighbourChecks - previousNeighbours < maxCandidates * 32) {
      const pair = generation.pairs.next();
      if (pair.done) { generation.done = true; break; }
      const { start, end } = pair.value;
      diagnostics.neighbourChecks++;
      const drop = start[1] - end[1], span = horizontal(start, end);
      if (-drop > model.maxJumpHeight + 2 * endpointTolerance || drop > maxDrop + 2 * endpointTolerance || span > maxHorizontalDistance) {
        diagnostics.rejected.range++;
        continue;
      }
      const duration = jumpDuration(start[1] + endpointTolerance, end[1] - endpointTolerance,
        { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
      if (duration === null || span > duration * model.maxHorizontalSpeed) {
        diagnostics.rejected.range++;
        continue;
      }
      diagnostics.pairChecks++;
      const launch = start.map(value => Math.floor(value / diversity)).join('/');
      const landingKey = end.map(value => Math.floor(value / diversity)).join('/');
      const destinations = buckets.get(launch) ?? new Map();
      const bucket = destinations.get(landingKey) ?? [];
      const nominal = jumpDuration(start[1], end[1], { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
      bucket.push({ start, end, uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed,
        score: (nominal ?? duration) +
        (distance(from, start) + distance(end, to)) / Math.max(1, model.maxHorizontalSpeed) });
      destinations.set(landingKey, bucket);
      buckets.set(launch, destinations);
    }
    // Visit each body-scale launch region before its second landing sample.
    // Within one launch region, retain spatially diverse landings and then fine
    // offsets. This includes railing pullbacks without losing narrow platforms.
    const launches = [...buckets.values()].map(destinations => {
      const lists = [...destinations.values()].map(list => list.sort(compare))
        .sort((a, b) => compare(a[0], b[0]));
      return interleave(lists, diagnostics.pairChecks - previousPairs);
    }).sort((a, b) => compare(a[0], b[0]));
    generation.pending = interleave(launches, diagnostics.pairChecks - previousPairs);
    generation.cursor = 0;
    if (!generation.done) diagnostics.truncated = true;
    return nextBatch();
  };

  const validate = entry => {
    const { a, b } = entry;
    if (!entry.search) {
      entry.search = { candidates: [], cursor: 0, tried: new Set() };
      const entries = preparedIncoming.get(b.id) ?? [];
      entries.push(entry);
      preparedIncoming.set(b.id, entries);
    }
    const search = entry.search, firstAttempt = diagnostics.attempted;
    if (search.cursor >= search.candidates.length) {
      search.candidates = candidatesFor(entry);
      search.cursor = 0;
    }
    while (search.cursor < search.candidates.length) {
      const candidate = search.candidates[search.cursor++];
      const start = standing(candidate.start, a.component), end = standing(candidate.end, b.component);
      if (!start || !end) continue;
      const key = JSON.stringify([start.position, end.position]);
      if (search.tried.has(key)) continue;
      search.tried.add(key);
      // Support correction may change heights enough to invalidate a raw pair.
      if (start.position[1] - end.position[1] > maxDrop || horizontal(start.position, end.position) > maxHorizontalDistance) continue;
      const duration = jumpDuration(start.position[1], end.position[1],
        { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' });
      if (duration === null || horizontal(start.position, end.position) > duration * model.maxHorizontalSpeed) {
        diagnostics.rejected.range++;
        continue;
      }
      for (const mode of ['jump', 'drop']) {
        if (mode === 'jump' && model.maxJumpHeight === 0) continue;
        if (mode === 'drop' && end.position[1] > start.position[1]) continue;
        if (diagnostics.attempted >= diagnostics.limits.arcAttempts) {
          diagnostics.truncated = true;
          return null;
        }
        diagnostics.attempted++;
        const arc = jumpConnection(start.position, end.position, { ...model, profile, walls, mode,
          sweep: (from, to, body) => world.sweepCapsule(from, to, body) });
        if (!arc) { diagnostics.rejected.motion++; continue; }
        return { id: `traversal/${a.id}/${b.id}`, ...arc, state: 'open', endpointTolerance,
          fromSurface: start.surface, toSurface: end.surface };
      }
      // A difficult optimistic shortcut must not exhaust the query before a
      // nearby multi-hop chain is tried. Deferred batches retain their cursor
      // and remain searchable; this is scheduling, not an extra coverage limit.
      if (diagnostics.attempted - firstAttempt >= 32 && search.cursor < search.candidates.length) {
        entry.cost += Math.max(1, heuristic(entry.b));
        diagnostics.deferredPairs++;
        return undefined;
      }
    }
    const generation = entry.generation;
    if (generation.cursor < generation.pending.length || (!generation.done && pairingAvailable())) {
      entry.cost += Math.max(1, heuristic(entry.b));
      diagnostics.deferredPairs++;
      return undefined;
    }
    return null;
  };

  const validated = new Set();
  while (connections.length < maxLinks) {
    diagnostics.regionSearches++;
    const chain = findChain();
    if (!chain) break;
    let complete = true;
    for (const entry of chain) {
      if (entry.ground || validated.has(entry.key)) continue;
      const connection = validate(entry);
      diagnostics.pairBatches++;
      if (!connection) {
        if (connection === null) {
          entry.closed = true;
          diagnostics.validatedPairs++;
        }
        complete = false;
        break;
      }
      diagnostics.validatedPairs++;
      validated.add(entry.key);
      connections.push(connection);
      diagnostics.accepted++;
      if (connections.length >= maxLinks) break;
    }
    if (complete && chain.every(entry => entry.ground || validated.has(entry.key))) {
      diagnostics.targetReached = true;
      break;
    }
    if (diagnostics.attempted >= diagnostics.limits.arcAttempts ||
        diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
      diagnostics.truncated = true;
      break;
    }
  }
  diagnostics.targetReached ??= false;
  if (connections.length >= maxLinks && !diagnostics.targetReached) diagnostics.truncated = true;
  return { connections, diagnostics };
}
