import { groundComponents, condenseComponents, directedComponents, canReach } from './connectivity.mjs';
import { createMinHeap } from './heap.mjs';
import { createWallChecker } from './walls.mjs';
import { validateMotion, routeSegment } from './motion.mjs';
import { searchResources } from './resource-search.mjs';
// Edges are directed, clearance-checked corridors supplied by the navigation importer.
// This module never connects points by proximity or projects between floors.
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

/** Find the least-cost route on a verified graph. Unknown/closed edges are excluded.
 * Endpoint IDs must come from a floor-aware projection by the caller.
 * Cost is supplied in seconds; optimality is on this graph, not continuous space.
 */
export function route(graph, start, goal, constraints) {
  return routeFrom(graph, [{ id: start, node: start, cost: 0, state: 'available' }], goal, constraints);
}

/** Compare walking and available teleport arrivals in one multi-source search.
 * Entry costs and corridor costs use the same units. Unknown/locked arrivals are excluded.
 */
export function routeFrom(graph, starts, goal, constraints) {
  return search(prepareGraph(graph, constraints), starts, goal, {}, undefined, constraints?.locomotion);
}

// The ground planner owns its immutable base graph. Only query endpoints and
// newly validated actions need corridor checks on each successive planning pass.
export function createRoutePlanner(graph, constraints) {
  const base = prepareGraph(graph, constraints);
  const ids = graph.nodes.map(node => node.id);
  return preparedSearch(base, () => directedComponents(ids, base.edges));
}

// Ground and movement already need the full numeric topology. Own it once in
// their shared preparation, without retaining it for standalone graph searches.
export function prepareRoutePlanner(graph, constraints) {
  const accepted = [];
  const base = prepareGraph(graph, constraints, undefined, accepted);
  const graphSnapshot = { nodes: graph.nodes, edges: accepted.length === graph.edges.length ? graph.edges : accepted };
  let topology;
  const preparedBase = {
    graph: graphSnapshot,
    forward: base.edges,
    blocked: base.blocked,
    get topology() { return topology ??= groundComponents(graphSnapshot); },
    plan: preparedSearch(base, () => condenseComponents(preparedBase.topology)),
  };
  return preparedBase;
}

const preparedSearch = (base, getComponents) => {
  const estimates = {};
  let disconnected = false, components;
  return (extra, starts, goal, locomotion) => {
    const prepared = prepareGraph(extra, null, base);
    // Successful queries avoid all component work. Only after a complete failed
    // search do refinements condense the planner's immutable accepted base graph.
    components ??= disconnected ? getComponents() : undefined;
    return search(prepared, starts, goal, estimates, { components, links: prepared.links,
      exhausted: () => { disconnected = true; } }, locomotion);
  };
};

const overlay = base => {
  const own = new Map();
  return { has: key => own.has(key) || (base?.has(key) ?? false),
    get: key => own.has(key) ? own.get(key) : base?.get(key),
    set: (key, value) => own.set(key, value) };
};

function prepareGraph(graph, constraints, base, accepted) {
  const blocked = base?.blocked ?? (constraints ? createWallChecker(constraints.walls, constraints.profile) : null);
  // Query endpoints and actions overlay the immutable scene. Copying million-node
  // maps on every refinement pass costs memory without changing their contents.
  const nodes = base ? overlay(base.nodes) : new Map();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || nodes.has(node.id) || !finitePoint(node.position)) throw new Error('Invalid node');
    nodes.set(node.id, node.position);
  }
  const edges = base ? overlay(base.edges) : new Map();
  let maxSpeed = base?.maxSpeed ?? 0;
  const copied = base ? new Set() : null, links = base ? [] : undefined;
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || !Number.isFinite(edge.cost) || edge.cost < 0 ||
        !['open', 'closed', 'unknown'].includes(edge.state) || !Array.isArray(edge.points) ||
        edge.points.length < 2 || !edge.points.every(finitePoint) ||
        distance(edge.points[0], nodes.get(edge.from)) > 1e-6 ||
        distance(edge.points.at(-1), nodes.get(edge.to)) > 1e-6) throw new Error('Invalid corridor');
    validateMotion(edge);
    if (edge.state === 'open' && (!blocked || !edge.points.slice(1).some((p, i) => blocked(edge.points[i], p)))) {
      const span = distance(nodes.get(edge.from), nodes.get(edge.to));
      if (span > 0) maxSpeed = Math.max(maxSpeed, edge.cost === 0 ? Infinity : span / edge.cost);
      let outgoing = edges.get(edge.from);
      if (base && !copied.has(edge.from)) {
        outgoing = outgoing ? [...outgoing] : [];
        edges.set(edge.from, outgoing);
        copied.add(edge.from);
      } else if (!outgoing) {
        outgoing = [];
        edges.set(edge.from, outgoing);
      }
      outgoing.push(edge);
      links?.push(edge);
      accepted?.push(edge);
    }
  }
  return { nodes, edges, blocked, maxSpeed, links };
}

function search({ nodes, edges, blocked, maxSpeed }, starts, goal, estimates = {}, connectivity, locomotion) {
  const requested = Array.isArray(goal) ? goal : [goal];
  const mapped = requested.filter(id => nodes.has(id));
  if (!mapped.length) return { status: 'unmapped' };
  const goals = new Set(mapped.filter(id => !blocked || !blocked(nodes.get(id), nodes.get(id))));
  if (!goals.size) return { status: 'no-verified-route' };
  if (locomotion) return searchResources({ nodes, edges, blocked }, starts, goals, locomotion);
  // Derive the speed bound from all usable edges, including fast authored actions.
  // Triangle inequality makes distance / this bound admissible and consistent.
  // A displaced zero-cost edge correctly falls back to Dijkstra.
  const targets = [...goals].map(id => nodes.get(id));
  // Action discovery repeatedly searches the same goal with additional edges.
  // Only geometric distance is reusable: new actions can change the speed bound.
  // Key by target positions, not transient endpoint IDs, and retain just one goal.
  const targetKey = JSON.stringify(targets);
  if (estimates.targetKey !== targetKey) {
    estimates.targetKey = targetKey;
    estimates.distances = new WeakMap();
  }
  const distances = estimates.distances;
  const estimate = Number.isFinite(maxSpeed) && maxSpeed > 0
    ? id => {
      const position = nodes.get(id);
      let best = distances.get(position);
      if (best === undefined) {
        best = Infinity;
        for (const target of targets) best = Math.min(best, distance(position, target));
        distances.set(position, best);
      }
      return best / (maxSpeed * (1 + 1e-12));
    }
    : () => 0;
  const costs = new Map(), previous = new Map(), origins = new Map(), heap = createMinHeap();
  const { push, pop } = heap;
  const sourceIds = new Set(), sourceNodes = [];
  for (const start of starts) {
    if (typeof start.id !== 'string' || sourceIds.has(start.id) || !Number.isFinite(start.cost) || start.cost < 0 ||
        !['available','locked','unknown'].includes(start.state)) throw new Error('Invalid arrival');
    sourceIds.add(start.id);
    if (start.state !== 'available' || !nodes.has(start.node)) continue;
    if (blocked && blocked(nodes.get(start.node), nodes.get(start.node))) continue;
    if (start.cost < (costs.get(start.node) ?? Infinity)) {
      sourceNodes.push(start.node);
      costs.set(start.node, start.cost); origins.set(start.node, start.id);
      push({ id: start.node, travelled: start.cost, cost: start.cost + estimate(start.node) });
    }
  }
  if (!heap.size) return { status: 'unmapped' };
  // Starts, goals and every extra edge have already passed the original guards.
  // A failed optimistic check saves the exhaustive fine-graph search only; a
  // passing check continues through the exact same A* and tie-breaking below.
  if (connectivity?.components && !canReach(connectivity.components, connectivity.links, sourceNodes, goals)) {
    return { status: 'no-verified-route' };
  }
  while (heap.size) {
    const entry = pop(), current = entry.id;
    if (entry.travelled !== costs.get(current)) continue;
    if (goals.has(current)) {
      const goal = current;
      const path = [];
      let root = goal;
      for (let id = goal; previous.has(id);) {
        const edge = previous.get(id);
        path.push(edge); id = edge.from; root = id;
      }
      path.reverse();
      const points = [[...nodes.get(root)]];
      for (const edge of path) for (const point of edge.points.slice(1)) {
        if (distance(points.at(-1), point) > 1e-9) points.push([...point]);
      }
      return { status: 'complete', start: origins.get(goal), cost: costs.get(goal), points,
        arrivalCost: costs.get(root), segments: path.map(routeSegment),
        length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) };
    }
    for (const edge of edges.get(current) ?? []) {
      const cost = costs.get(current) + edge.cost;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost); previous.set(edge.to, edge); origins.set(edge.to, origins.get(current));
        push({ id: edge.to, travelled: cost, cost: cost + estimate(edge.to) });
      }
    }
  }
  connectivity?.exhausted();
  return { status: 'no-verified-route' };
}

/** Arc-length animation stays on the verified polyline; it never rounds through walls. */
export function sampleRoute(points, meters) {
  if (!points.length || !points.every(finitePoint) || !Number.isFinite(meters)) throw new Error('Invalid route sample');
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (length > 0 && remaining < length) return points[i - 1].map((v, axis) => v + (points[i][axis] - v) * remaining / length);
    remaining -= length;
  }
  return [...points.at(-1)];
}
