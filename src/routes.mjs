import { createMinHeap } from './heap.mjs';
import { createWallChecker } from './walls.mjs';
import { validateMotion, routeSegment } from './motion.mjs';
// Edges are directed, clearance-checked corridors supplied by the navigation importer.
// This module never connects points by proximity or projects between floors.
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
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
  return search(prepareGraph(graph, constraints), starts, goal);
}

// The ground planner owns its immutable base graph. Only query endpoints and
// newly validated actions need corridor checks on each successive planning pass.
export function createRoutePlanner(graph, constraints) {
  const base = prepareGraph(graph, constraints);
  return (extra, starts, goal) => search(prepareGraph(extra, null, base), starts, goal);
}

function prepareGraph(graph, constraints, base) {
  const blocked = base?.blocked ?? (constraints ? createWallChecker(constraints.walls, constraints.profile) : null);
  const nodes = new Map(base?.nodes);
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || nodes.has(node.id) || !finitePoint(node.position)) throw new Error('Invalid node');
    nodes.set(node.id, node.position);
  }
  const edges = new Map(base?.edges);
  const copied = new Set();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || !Number.isFinite(edge.cost) || edge.cost < 0 ||
        !['open', 'closed', 'unknown'].includes(edge.state) || !Array.isArray(edge.points) ||
        edge.points.length < 2 || !edge.points.every(finitePoint) ||
        distance(edge.points[0], nodes.get(edge.from)) > 1e-6 ||
        distance(edge.points.at(-1), nodes.get(edge.to)) > 1e-6) throw new Error('Invalid corridor');
    validateMotion(edge);
    if (edge.state === 'open' && (!blocked || !edge.points.slice(1).some((p, i) => blocked(edge.points[i], p)))) {
      if (!copied.has(edge.from)) {
        edges.set(edge.from, [...(edges.get(edge.from) ?? [])]);
        copied.add(edge.from);
      }
      edges.get(edge.from).push(edge);
    }
  }
  return { nodes, edges, blocked };
}

function search({ nodes, edges, blocked }, starts, goal) {
  const requested = Array.isArray(goal) ? goal : [goal];
  const mapped = requested.filter(id => nodes.has(id));
  if (!mapped.length) return { status: 'unmapped' };
  const goals = new Set(mapped.filter(id => !blocked || !blocked(nodes.get(id), nodes.get(id))));
  if (!goals.size) return { status: 'no-verified-route' };
  // Dijkstra: arbitrary authored travel times need not admit a Euclidean heuristic.
  const costs = new Map(), previous = new Map(), origins = new Map(), heap = createMinHeap();
  const { push, pop } = heap;
  const sourceIds = new Set();
  for (const start of starts) {
    if (typeof start.id !== 'string' || sourceIds.has(start.id) || !Number.isFinite(start.cost) || start.cost < 0 ||
        !['available','locked','unknown'].includes(start.state)) throw new Error('Invalid arrival');
    sourceIds.add(start.id);
    if (start.state !== 'available' || !nodes.has(start.node)) continue;
    if (blocked && blocked(nodes.get(start.node), nodes.get(start.node))) continue;
    if (start.cost < (costs.get(start.node) ?? Infinity)) {
      costs.set(start.node, start.cost); origins.set(start.node, start.id);
      push({ id: start.node, cost: start.cost });
    }
  }
  if (!heap.size) return { status: 'unmapped' };
  while (heap.size) {
    const entry = pop(), current = entry.id;
    if (entry.cost !== costs.get(current)) continue;
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
        costs.set(edge.to, cost); previous.set(edge.to, edge); origins.set(edge.to, origins.get(current)); push({ id: edge.to, cost });
      }
    }
  }
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
