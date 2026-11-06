import { surfaceGraph, surfacePortals, directedPortals, projectPoint } from './surfaces.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createMinHeap } from './heap.mjs';
import { createGoalProjector } from './goals.mjs';
import { landingCandidates } from './landings.mjs';
import { createWallChecker } from './walls.mjs';
import { jumpConnection, jumpDuration } from './jumps.mjs';
import { groundPreparation } from './ground.mjs';

const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const boundaryKey = (surface, edge) => JSON.stringify([surface, edge]);

export const groundComponents = (graph) => {
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

export const exposedBoundaries = (surfaces, portals, sharedPortals) => {
  const covered = new Map();
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const cover = (id, edge, start, end) => {
    const surface = byId.get(id), a = surface.vertices[edge], b = surface.vertices[(edge + 1) % surface.vertices.length];
    const direction = b.map((value, axis) => value - a[axis]);
    const squared = direction.reduce((sum, value) => sum + value * value, 0);
    const fraction = point => point.reduce((sum, value, axis) => sum + (value - a[axis]) * direction[axis], 0) / squared;
    const first = fraction(start), last = fraction(end), key = boundaryKey(id, edge);
    const ranges = covered.get(key) ?? [];
    ranges.push([Math.max(0, Math.min(first, last)), Math.min(1, Math.max(first, last))]);
    covered.set(key, ranges);
  };
  for (const portal of sharedPortals ?? surfacePortals(surfaces)) {
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
    cover(portal.to, portal.toEdge, portal.start, portal.end);
  }
  for (const portal of directedPortals(surfaces, portals)) {
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
  }
  const boundaries = [];
  for (const surface of surfaces) {
    const center = [0, 1, 2].map(
      (axis) => surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length,
    );
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      const from = surface.vertices[edge], to = surface.vertices[(edge + 1) % surface.vertices.length];
      const ranges = (covered.get(boundaryKey(surface.id, edge)) ?? []).sort((a, b) => a[0] - b[0]);
      const gaps = [];
      let cursor = 0;
      for (const [near, far] of ranges) {
        if (near > cursor) gaps.push([cursor, near]);
        cursor = Math.max(cursor, far);
      }
      if (cursor < 1) gaps.push([cursor, 1]);
      for (const [near, far] of gaps) {
        const a = from.map((value, axis) => value + near * (to[axis] - value));
        const b = from.map((value, axis) => value + far * (to[axis] - value));
        const midpoint = a.map((value, axis) => (value + b[axis]) / 2);
        const length = horizontal(a, b);
        if (length <= 1e-4) continue;
        const inward = [-(b[2] - a[2]) / length, (b[0] - a[0]) / length];
        if (inward[0] * (center[0] - midpoint[0]) + inward[1] * (center[2] - midpoint[2]) < 0) {
          inward[0] *= -1; inward[1] *= -1;
        }
        const interiorX = center[0] - midpoint[0], interiorZ = center[2] - midpoint[2];
        const interiorLength = Math.hypot(interiorX, interiorZ);
        boundaries.push({
          surface: surface.id,
          edge,
          a,
          b,
          midpoint,
          length,
          inward,
          // The centroid direction also samples diagonal pullbacks on narrow
          // triangles. The perpendicular normal remains the physical exit axis.
          interior: [interiorX / interiorLength, interiorZ / interiorLength],
        });
      }
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

export const interleave = (lists, limit) => {
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

export const validateDiscovery = (world, options) => {
  const { profile, walls, from, to, maxVertical, maxSlope, maxDrop, maxHorizontalDistance,
    sampleSpacing, maxCandidates, maxLinks, model } = options ?? {};
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
    model.maxHorizontalSpeed < 0 ||
    ((model.airAcceleration !== undefined || model.airDeceleration !== undefined) &&
      (![model.airAcceleration, model.airDeceleration].every(Number.isFinite) ||
        model.airAcceleration <= 0 || model.airDeceleration <= 0))
  ) {
    throw new Error('Invalid traversal discovery options');
  }
};

export const standingFoot = (nav, world, { profile, maxVertical, maxSlope, blocked, project }) => {
  const support = world.groundAt(nav.position, { maxUp: profile.radius, maxDown: profile.radius, maxSlope });
  if (!support) return { reason: 'support' };
  const position = [...support.position];
  position[1] += profile.radius * (1 / support.normal[1] - 1) + 0.005;
  // Real support corrects voxel and slope height. Bind the corrected foot to the
  // closest eligible navigation support, matching subsequent ground queries.
  if (Math.abs(position[1] - nav.position[1]) > Math.min(maxVertical, profile.radius)) return { reason: 'projection' };
  if (blocked(position, position) || world.sweepCapsule(position, position, profile) !== null) return { reason: 'clearance' };
  const mapped = project(position, { maxVertical: Math.min(maxVertical, profile.radius) })[0];
  if (!mapped) return { reason: 'projection' };
  return { position, surface: mapped.surface };
};

/** Discover directed jumps along optimistic region chains, validating local links lazily.
 * Ground, body, state and collision inputs must describe the same immutable snapshot.
 * Region bounds only order search. Every returned connection has supported feet,
 * stationary body clearance and a swept, wall-checked trajectory under the supplied model.
 * Optional interaction queries all eligible goal faces together and groups them by
 * directed ground component. Sampling limits remain explicit, so failure is inconclusive.
 */
export function findJumpConnections(surfaces, world, options, workLimits) {
  const {
    profile, portals = [], walls, from, to, interaction, maxVertical, maxSlope, maxDrop,
    maxHorizontalDistance, sampleSpacing, maxCandidates, maxLinks, model,
  } = options ?? {};

  validateDiscovery(world, options);
  const blocked = createWallChecker(walls, profile);
  const diagnostics = {
    reason: 'searched', components: 0, boundaryEdges: 0, endpointChecks: 0,
    standingEndpoints: 0, neighbourChecks: 0, pairChecks: 0, candidatePairs: 0,
    attempted: 0, accepted: 0, truncated: false, regionSearches: 0, regionPairs: 0,
    validatedPairs: 0, pairBatches: 0, deferredPairs: 0, generationBatches: 0, seedChecks: 0, goalFaces: 0, goalComponents: 0,
    sourceEndpoints: 0, targetEndpoints: 0, sourceCandidates: 0, directCandidates: 0,
    limits: {
      maxCandidates, maxLinks, arcAttempts: Math.min(maxCandidates * 2, workLimits?.arcAttempts ?? Infinity),
      endpointChecks: maxCandidates * 32, neighbourChecks: maxCandidates * 512,
      pairChecks: maxCandidates * 64, seedChecks: maxCandidates * 64,
    },
    rejected: { projection: 0, support: 0, clearance: 0, range: 0, motion: 0 },
  };
  const connections = [];
  const candidate = groundPreparation(options.groundPlanner);
  const prepared = candidate?.surfaces === surfaces ? candidate : undefined;
  const sharedPortals = prepared?.portals ?? surfacePortals(surfaces);
  const base = prepared?.importedPortals === options.portals && prepared?.graph ||
    surfaceGraph(surfaces, { speed: 1, portals }, sharedPortals);
  const graph = { nodes: base.nodes, edges: base.edges };
  graph.edges = graph.edges.filter(edge => !edge.points.slice(1).some((point, index) =>
    blocked(edge.points[index], point)));
  const topology = groundComponents(graph);
  diagnostics.components = topology.count;
  const componentOf = surface => topology.components[topology.ids.get(surface)];
  const project = prepared?.projectGoal ?? createGoalProjector(surfaces);
  const source = project(from, { maxVertical })[0];
  const targets = project(to, { maxVertical, interaction }).filter(target =>
    !blocked(target.position, target.position));
  if (!source || !targets.length || blocked(source.position, source.position)) {
    diagnostics.reason = 'unmapped-endpoint';
    return { connections, diagnostics };
  }
  const sourceComponent = componentOf(source.surface);
  const targetComponents = new Set(targets.map(target => componentOf(target.surface)));
  const byId = prepared?.byId ?? new Map(surfaces.map(surface => [surface.id, surface]));
  for (const connection of options.connections ?? []) {
    if (connection.state !== 'open') continue;
    const a = connection.fromSurface === undefined ? surfaces : [byId.get(connection.fromSurface)];
    const b = connection.toSurface === undefined ? surfaces : [byId.get(connection.toSurface)];
    if (!a[0] || !b[0]) throw new Error('Invalid movement support surface');
    const from = projectPoint(a, connection.points[0], { maxVertical });
    const to = projectPoint(b, connection.points.at(-1), { maxVertical });
    if (!from || !to || connection.points.slice(1).some((point, index) =>
      blocked(connection.points[index], point))) continue;
    topology.forward[topology.ids.get(from.surface)].push(topology.ids.get(to.surface));
  }
  // Proposals start anywhere already reachable without a new airborne action.
  // Ground transfers have zero proposal cost, so distance to the original arrival
  // is not an admissible heuristic: directed stairs can put a reachable floor far
  // from that arrival, starving a short box chain behind an unrelated cliff.
  const reachable = new Set([topology.ids.get(source.surface)]), queue = [...reachable];
  for (let head = 0; head < queue.length; head++) for (const next of topology.forward[queue[head]]) {
    if (reachable.has(next)) continue;
    reachable.add(next); queue.push(next);
  }
  const sourceComponents = new Set([...reachable].map(index => topology.components[index]));
  diagnostics.sourceComponent = sourceComponent;
  diagnostics.targetComponent = componentOf(targets[0].surface);
  diagnostics.goalFaces = targets.length;
  diagnostics.goalComponents = targetComponents.size;
  if (targets.some(target => reachable.has(topology.ids.get(target.surface)))) {
    diagnostics.reason = options.connections?.length ? 'known-connected' : 'ground-connected';
    diagnostics.targetReached = true;
    return { connections, diagnostics };
  }

  const regions = Array.from({ length: topology.count }, (_, component) => ({
    id: String(component), component, min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity], boundaries: [], surfaces: [],
  }));
  for (const surface of surfaces) {
    const region = regions[componentOf(surface.id)];
    region.surfaces.push(surface);
    for (const point of surface.vertices) for (let axis = 0; axis < 3; axis++) {
      region.min[axis] = Math.min(region.min[axis], point[axis]);
      region.max[axis] = Math.max(region.max[axis], point[axis]);
    }
  }
  const boundaries = exposedBoundaries(surfaces, portals, sharedPortals);
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

  const findChain = () => {
    const pending = createMinHeap(), costs = new Map(), next = new Map();
    for (const component of targetComponents) {
      const region = regions[component];
      costs.set(region.id, 0);
      pending.push({ region, travelled: 0, cost: 0 });
    }
    while (pending.size) {
      const { region, travelled } = pending.pop();
      if (travelled !== costs.get(region.id)) continue;
      if (sourceComponents.has(region.component)) {
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
        pending.push({ region: entry.a, travelled: cost, cost });
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
      const sampled = standingFoot(nav, world, { profile, maxVertical, maxSlope, blocked, project });
      if (sampled.reason) diagnostics.rejected[sampled.reason]++;
      else if (componentOf(sampled.surface) !== component) diagnostics.rejected.projection++;
      else {
        result = sampled;
        diagnostics.standingEndpoints++;
        if (component === sourceComponent) diagnostics.sourceEndpoints++;
        if (targetComponents.has(component)) diagnostics.targetEndpoints++;
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
        point[0] += boundary.interior[0] * inset;
        point[2] += boundary.interior[1] * inset;
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

    const queryFaces = createBoundsIndex(b.surfaces.map(surface => ({ surface, ...boundsOf(surface.vertices) })));
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
      active.push({ start, boundary: true, landings: queryLandings.nearest(bounds, to) },
        { start, boundary: false, landings: queryFaces.nearest(bounds, to) });
    }
    while (active.length) {
      const pending = [];
      for (const query of active) {
        let exhausted = false;
        for (let count = 0; count < 8; count++) {
          const landing = query.landings.next();
          if (landing.done) { exhausted = true; break; }
          if (query.boundary) yield { start: query.start, end: landing.value.point, boundary: true };
          else for (const point of landingCandidates(landing.value.surface, query.start, to, model, profile.radius)) {
            yield { start: query.start, end: point.position, boundary: false };
          }
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
    const compare = (a, b) => Number(b.boundary) - Number(a.boundary) || Number(a.uncertain) - Number(b.uncertain) || a.score - b.score;
    while (pairingAvailable() && diagnostics.pairChecks - previousPairs < maxCandidates * 4 &&
        diagnostics.neighbourChecks - previousNeighbours < maxCandidates * 32) {
      const pair = generation.pairs.next();
      if (pair.done) { generation.done = true; break; }
      const { start, end, boundary } = pair.value;
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
      bucket.push({ start, end, boundary, uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed,
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
        entry.cost += 1;
        diagnostics.deferredPairs++;
        return undefined;
      }
    }
    const generation = entry.generation;
    if (generation.cursor < generation.pending.length || (!generation.done && pairingAvailable())) {
      entry.cost += 1;
      diagnostics.deferredPairs++;
      return undefined;
    }
    return null;
  };

  const validated = new Set();
  while (connections.length < maxLinks && diagnostics.regionSearches < (workLimits?.regionSearches ?? maxCandidates)) {
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
  if (diagnostics.regionSearches >= (workLimits?.regionSearches ?? maxCandidates) && !diagnostics.targetReached) diagnostics.truncated = true;
  diagnostics.targetReached ??= false;
  if (connections.length >= maxLinks && !diagnostics.targetReached) diagnostics.truncated = true;
  return { connections, diagnostics };
}
