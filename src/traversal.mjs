import { surfaceGraph, surfacePortals } from './surfaces.mjs';
import { createGoalProjector } from './goals.mjs';
import { blockedByWalls } from './walls.mjs';
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

const exposedBoundaries = (surfaces, portals, from, to) => {
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
        score: Math.min(distance(from, midpoint), distance(to, midpoint)),
      });
    }
  }
  return boundaries.sort((a, b) => a.score - b.score);
};

const interleaveGroups = (entries, componentOf, preferred, batchSize) => {
  const groups = new Map();
  for (const entry of entries) {
    const component = componentOf(entry),
      group = groups.get(component) ?? [];
    group.push(entry);
    groups.set(component, group);
  }
  const components = [...groups.keys()].sort(
    (a, b) => (preferred.includes(a) ? 0 : 1) - (preferred.includes(b) ? 0 : 1),
  );
  let active = components.map((component) => ({
    entries: groups.get(component),
    cursor: 0,
    batch: preferred.includes(component) ? batchSize : 1,
  }));
  const result = [];
  while (active.length) {
    const pending = [];
    for (const group of active) {
      const end = Math.min(group.entries.length, group.cursor + group.batch);
      for (let index = group.cursor; index < end; index++) result.push(group.entries[index]);
      group.cursor = end;
      if (end < group.entries.length) pending.push(group);
    }
    // Drained groups leave the queue immediately. An imbalanced component must
    // not revisit thousands of exhausted groups before endpoint budgets apply.
    active = pending;
  }
  return result;
};

const candidatePool = (limit, diagnostics) => {
  const pairs = new Map();
  let count = 0;
  const worst = (list) =>
    list.reduce((current, candidate) => (candidate.score > current.score ? candidate : current));
  const remove = (key, candidate) => {
    const list = pairs.get(key);
    list.splice(list.indexOf(candidate), 1);
    count--;
    if (!list.length) pairs.delete(key);
  };
  return {
    add(candidate) {
      const key = `${candidate.from.component}/${candidate.to.component}`;
      const list = pairs.get(key) ?? [];
      const duplicate = list.find((previous) => previous.spatial === candidate.spatial);
      if (duplicate) {
        diagnostics.truncated = true;
        if (candidate.score >= duplicate.score) return;
        remove(key, duplicate);
      }
      const pairLimit = Math.min(96, limit);
      if (list.length >= pairLimit) {
        diagnostics.truncated = true;
        const previous = worst(list);
        if (candidate.score >= previous.score) return;
        remove(key, previous);
      }
      if (count >= limit) {
        diagnostics.truncated = true;
        const all = [...pairs].flatMap(([pair, values]) => values.map((value) => ({ pair, value })));
        const counts = [0, 0, 0];
        for (const previous of all) counts[previous.value.priority]++;
        const reserve = [Math.ceil(limit / 4), Math.ceil(limit / 2), 0];
        let eligible = all.filter(
          (previous) =>
            previous.value.priority >= candidate.priority ||
            counts[previous.value.priority] > reserve[previous.value.priority],
        );
        if (!eligible.length) return;
        const diverse = eligible.filter((previous) => pairs.get(previous.pair).length > 1 || list.length > 0);
        if (diverse.length) eligible = diverse;
        const previous = eligible.reduce((a, b) =>
          a.value.priority > b.value.priority ||
          (a.value.priority === b.value.priority && a.value.score > b.value.score)
            ? a
            : b,
        );
        if (
          list.length &&
          candidate.priority === previous.value.priority &&
          candidate.score >= previous.value.score
        )
          return;
        remove(previous.pair, previous.value);
      }
      const retained = pairs.get(key) ?? [];
      retained.push(candidate);
      pairs.set(key, retained);
      count++;
    },
    ordered() {
      const lists = [...pairs.values()].map((list) => list.sort((a, b) => a.score - b.score));
      const output = [];
      for (let round = 0; output.length < count; round++) {
        const next = lists
          .flatMap((list) => (list[round] ? [list[round]] : []))
          .sort((a, b) => a.score - b.score);
        output.push(...next);
      }
      return output;
    },
  };
};

/** Discover directed model-based jumps between separated ground components.
 * Every limit, body and motion parameter is caller supplied. Candidate endpoints
 * retain actual collision support and pass a stationary capsule contact sweep.
 * Thin-surface queries do not prove occupancy outside closed solids. Callers retain
 * the selected ground/body-clearance and initial-volume-occupancy assumptions.
 * Graph-open results mean
 * the supplied model passed, with motionValidation explicitly model-based.
 * Intermediate components participate, allowing paths that require several jumps.
 * Sampling and budgets can miss traversals; diagnostics report any truncation.
 */
export function findJumpConnections(surfaces, world, options) {
  const {
    profile,
    portals = [],
    walls,
    from,
    to,
    maxVertical,
    maxSlope,
    maxDrop,
    maxHorizontalDistance,
    sampleSpacing,
    maxCandidates,
    maxLinks,
    model,
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
  const diagnostics = {
    reason: 'searched',
    components: 0,
    boundaryEdges: 0,
    endpointChecks: 0,
    standingEndpoints: 0,
    neighbourChecks: 0,
    pairChecks: 0,
    candidatePairs: 0,
    attempted: 0,
    accepted: 0,
    truncated: false,
    limits: {
      maxCandidates,
      maxLinks,
      arcAttempts: maxCandidates * 2,
      endpointChecks: maxCandidates * 32,
      neighbourChecks: maxCandidates * 512,
      pairChecks: maxCandidates * 64,
    },
    rejected: { projection: 0, support: 0, clearance: 0, range: 0, motion: 0 },
  };
  const connections = [];
  const graph = surfaceGraph(surfaces, { speed: 1, portals }),
    topology = groundComponents(graph);
  diagnostics.components = topology.count;
  const project = createGoalProjector(surfaces);
  const source = project(from, { maxVertical })[0],
    target = project(to, { maxVertical })[0];
  if (!source || !target) {
    diagnostics.reason = 'unmapped-endpoint';
    return { connections, diagnostics };
  }
  const componentOf = (surface) => topology.components[topology.ids.get(surface)];
  if (canReach(topology, topology.ids.get(source.surface), topology.ids.get(target.surface))) {
    diagnostics.reason = 'ground-connected';
    return { connections, diagnostics };
  }
  const sourceComponent = componentOf(source.surface),
    targetComponent = componentOf(target.surface);
  const boundaries = exposedBoundaries(surfaces, portals, from, to);
  // Keep local coverage tied to the body, rather than the query's distant reach
  // bound or sample density. Otherwise a large world extent merges useful local
  // endpoints, while finer sampling spends the budget repeatedly in one place.
  const diversityCell = profile.radius * 12;
  for (const boundary of boundaries) {
    const component = componentOf(boundary.surface);
    boundary.score =
      component === sourceComponent
        ? horizontal(boundary.midpoint, to)
        : component === targetComponent
          ? horizontal(boundary.midpoint, from)
          : horizontal(from, boundary.midpoint) + horizontal(boundary.midpoint, to);
  }
  boundaries.sort((a, b) => a.score - b.score);
  const spreadBoundaries = interleaveGroups(
    boundaries,
    (boundary) =>
      JSON.stringify([
        componentOf(boundary.surface),
        Math.floor(boundary.midpoint[0] / diversityCell),
        Math.floor(boundary.midpoint[2] / diversityCell),
      ]),
    [],
    1,
  );
  const orderedBoundaries = interleaveGroups(
    spreadBoundaries,
    (boundary) => componentOf(boundary.surface),
    [sourceComponent, targetComponent],
    16,
  );
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius),
    cachedStanding = new Map();
  const standing = (seed, component) => {
    const key = JSON.stringify([component, seed]);
    if (cachedStanding.has(key)) return cachedStanding.get(key);
    let result = null;
    const nav = project(seed, { maxVertical })[0];
    if (!nav || componentOf(nav.surface) !== component) diagnostics.rejected.projection++;
    else {
      const support = world.groundAt(nav.position, {
        maxUp: profile.radius,
        maxDown: profile.radius,
        maxSlope,
      });
      if (!support) diagnostics.rejected.support++;
      else {
        const feet = [...support.position];
        feet[1] += profile.radius * (1 / support.normal[1] - 1) + 0.005;
        const attachment = project(feet, { maxVertical: endpointTolerance })[0];
        if (!attachment || componentOf(attachment.surface) !== component) diagnostics.rejected.projection++;
        else if (
          blockedByWalls(feet, feet, walls, profile) ||
          world.sweepCapsule(feet, feet, profile) !== null
        )
          diagnostics.rejected.clearance++;
        else result = { position: feet, surface: attachment.surface, component };
      }
    }
    cachedStanding.set(key, result);
    return result;
  };
  const takeoffs = [],
    landings = [],
    uniqueTakeoffs = new Set(),
    uniqueLandings = new Set();
  const add = (list, seen, endpoint) => {
    const key = JSON.stringify(endpoint.position);
    if (!seen.has(key)) {
      seen.add(key);
      list.push(endpoint);
    }
  };
  sampling: for (const boundary of orderedBoundaries) {
    const component = componentOf(boundary.surface),
      samples = Math.max(1, Math.ceil(boundary.length / sampleSpacing));
    for (let sample = 0; sample < samples; sample++) {
      const fraction = (sample + 0.5) / samples;
      const edgePoint = boundary.a.map((value, axis) => value + fraction * (boundary.b[axis] - value));
      for (const inset of [0.5, 1, 1.5, 2, 2.5, 3]) {
        if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
          diagnostics.truncated = true;
          break sampling;
        }
        diagnostics.endpointChecks++;
        const seed = [
          edgePoint[0] + boundary.inward[0] * inset,
          edgePoint[1],
          edgePoint[2] + boundary.inward[1] * inset,
        ];
        const endpoint = standing(seed, component);
        if (!endpoint) continue;
        add(takeoffs, uniqueTakeoffs, { ...endpoint, inset });
        if (inset <= 1) add(landings, uniqueLandings, endpoint);
      }
    }
  }
  diagnostics.standingEndpoints = takeoffs.length;
  diagnostics.sourceEndpoints = takeoffs.filter((endpoint) => endpoint.component === sourceComponent).length;
  diagnostics.targetEndpoints = takeoffs.filter((endpoint) => endpoint.component === targetComponent).length;
  const cellSize = maxHorizontalDistance,
    grid = new Map();
  const cell = (position) => [Math.floor(position[0] / cellSize), Math.floor(position[2] / cellSize)];
  for (const landing of landings) {
    const key = cell(landing.position).join('/'),
      list = grid.get(key) ?? [];
    list.push(landing);
    grid.set(key, list);
  }
  const pool = candidatePool(maxCandidates, diagnostics);
  takeoffs.sort((a, b) => horizontal(a.position, to) - horizontal(b.position, to));
  const orderedTakeoffs = interleaveGroups(takeoffs, (endpoint) => endpoint.component, [sourceComponent], 8);
  pairing: for (const takeoff of orderedTakeoffs) {
    const [x, z] = cell(takeoff.position),
      neighbours = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (const landing of grid.get(`${x + dx}/${z + dz}`) ?? []) {
          if (takeoff.component === landing.component) continue;
          if (diagnostics.neighbourChecks >= diagnostics.limits.neighbourChecks) {
            diagnostics.truncated = true;
            break;
          }
          diagnostics.neighbourChecks++;
          const span = horizontal(takeoff.position, landing.position),
            drop = takeoff.position[1] - landing.position[1];
          if (span > maxHorizontalDistance || drop > maxDrop || -drop > model.maxJumpHeight) {
            diagnostics.rejected.range++;
            continue;
          }
          const duration = jumpDuration(takeoff.position[1], landing.position[1], {
            ...model,
            mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
          });
          if (duration === null || span > duration * model.maxHorizontalSpeed) {
            diagnostics.rejected.range++;
            continue;
          }
          const spatial = JSON.stringify([
            Math.floor(takeoff.position[0] / diversityCell),
            Math.floor(takeoff.position[2] / diversityCell),
            Math.floor(landing.position[0] / diversityCell),
            Math.floor(landing.position[2] / diversityCell),
            takeoff.inset,
          ]);
          const priority =
            takeoff.component === sourceComponent && landing.component === targetComponent
              ? 0
              : takeoff.component === sourceComponent || landing.component === targetComponent
                ? 1
                : 2;
          neighbours.push({
            from: takeoff,
            to: landing,
            spatial,
            priority,
            score: distance(from, takeoff.position) + span + distance(landing.position, to),
          });
        }
      }
    neighbours.sort(
      (a, b) =>
        (a.to.component === targetComponent ? 0 : 1) - (b.to.component === targetComponent ? 0 : 1) ||
        a.score - b.score,
    );
    const distinct = new Map();
    for (const candidate of neighbours) {
      const key = `${candidate.to.component}/${candidate.spatial}`;
      if (!distinct.has(key)) distinct.set(key, candidate);
    }
    for (const candidate of [...distinct.values()].slice(0, 32)) {
      if (diagnostics.pairChecks >= diagnostics.limits.pairChecks) {
        diagnostics.truncated = true;
        break pairing;
      }
      diagnostics.pairChecks++;
      pool.add(candidate);
    }
    if (distinct.size > 32) diagnostics.truncated = true;
    if (diagnostics.neighbourChecks >= diagnostics.limits.neighbourChecks) {
      diagnostics.truncated = true;
      break;
    }
  }

  const candidates = pool.ordered(),
    tried = new Set();
  diagnostics.candidatePairs = candidates.length;
  diagnostics.sourceComponent = sourceComponent;
  diagnostics.targetComponent = targetComponent;
  diagnostics.sourceCandidates = candidates.filter(
    (candidate) => candidate.from.component === sourceComponent,
  ).length;
  diagnostics.directCandidates = candidates.filter(
    (candidate) => candidate.from.component === sourceComponent && candidate.to.component === targetComponent,
  ).length;
  const componentEdges = new Map();
  for (const edge of graph.edges) {
    const a = componentOf(edge.from),
      b = componentOf(edge.to);
    if (a === b) continue;
    const neighbours = componentEdges.get(a) ?? new Set();
    neighbours.add(b);
    componentEdges.set(a, neighbours);
  }
  const reachable = new Set([sourceComponent]);
  const expand = () => {
    const queue = [...reachable];
    for (let head = 0; head < queue.length; head++)
      for (const next of componentEdges.get(queue[head]) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
  };
  expand();
  let advanced = true;
  while (advanced && connections.length < maxLinks && !reachable.has(targetComponent)) {
    advanced = false;
    const frontier = candidates
      .filter(
        (candidate) =>
          !tried.has(candidate) &&
          reachable.has(candidate.from.component) &&
          !reachable.has(candidate.to.component),
      )
      .sort(
        (a, b) =>
          (a.to.component === targetComponent ? 0 : 1) - (b.to.component === targetComponent ? 0 : 1) ||
          a.score - b.score,
      );
    for (const candidate of frontier) {
      tried.add(candidate);
      for (const mode of ['jump', 'drop']) {
        if (mode === 'jump' && model.maxJumpHeight === 0) continue;
        const arc = jumpConnection(candidate.from.position, candidate.to.position, {
          ...model,
          profile,
          walls,
          mode,
          sweep: (start, end, body) => world.sweepCapsule(start, end, body),
        });
        diagnostics.attempted++;
        if (!arc) {
          diagnostics.rejected.motion++;
          continue;
        }
        connections.push({
          id: `traversal/${candidate.from.component}/${candidate.to.component}/${connections.length}`,
          ...arc,
          state: 'open',
          endpointTolerance,
          fromSurface: candidate.from.surface,
          toSurface: candidate.to.surface,
        });
        diagnostics.accepted++;
        reachable.add(candidate.to.component);
        expand();
        advanced = true;
        break;
      }
      if (advanced) break;
    }
  }
  diagnostics.targetReached = reachable.has(targetComponent);
  if (connections.length >= maxLinks && !diagnostics.targetReached) diagnostics.truncated = true;

  return { connections, diagnostics };
}
