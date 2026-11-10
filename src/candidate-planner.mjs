import { surfaceGraph, surfacePortals } from './surfaces.mjs';
import { closestOnSurface } from './goals.mjs';
import { groundComponents } from './connectivity.mjs';
import { createMinHeap } from './heap.mjs';
import { createGroundStraightener } from './straighten.mjs';
import { createBoundsIndex } from './bounds.mjs';
import { createTransferQuery } from './candidate-transfers.mjs';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Navigation proposals for local physical planning. Every returned segment still
 * requires physical validation. Scores prioritize fewer unresolved transfers and
 * are deliberately separate from travel time. Input geometry is immutable. */
export function createCandidatePlanner(data, { radius = 16, verticalRange = 50,
  transferPenalty = 10000, ascentPenalty = 1000000, endpointRadius = 96, connections = [] } = {}) {
  if (![radius, verticalRange, transferPenalty, ascentPenalty, endpointRadius].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('Invalid candidate search options');
  }
  const portals = surfacePortals(data.surfaces);
  const graph = surfaceGraph(data.surfaces, data.options, portals);
  const topology = groundComponents(graph);
  const ids = topology.ids;
  const adjacency = graph.nodes.map(() => []);
  const edges = graph.edges;
  const groundEdgeCount = edges.length;
  for (let index = 0; index < edges.length; index++) adjacency[ids.get(edges[index].from)].push(index);
  const transfers = createTransferQuery(data.surfaces, topology, radius, verticalRange);
  const expanded = new Set(), materialized = new Set(), dirty = new Set();
  const expand = component => {
    if (component === undefined || expanded.has(component)) return;
    expanded.add(component);
    for (const proposal of transfers(component)) {
      if (materialized.has(proposal.key)) continue;
      materialized.add(proposal.key);
      const { key, rank, first, ...forward } = proposal;
      for (const edge of [forward,
        { ...forward, from: forward.to, to: forward.from, points: [...forward.points].reverse() }]) {
        adjacency[ids.get(edge.from)].push(edges.length);
        dirty.add(ids.get(edge.from));
        edges.push({ ...edge, order: first, reverse: edge !== forward,
          key: JSON.stringify(['transfer', key, edge.from, edge.to]) });
      }
    }
  };
  for (const [connectionIndex, connection] of connections.entries()) {
    if (!ids.has(connection.from) || !ids.has(connection.to) || !Array.isArray(connection.points) || connection.points.length < 2) {
      throw new Error('Invalid candidate connection');
    }
    adjacency[ids.get(connection.from)].push(edges.length);
    edges.push({ ...connection, connectionIndex, key: JSON.stringify(['connection', connectionIndex, connection]), unresolved: true,
      length: connection.points.slice(1).reduce((sum, point, index) => sum + distance(connection.points[index], point), 0) });
  }
  const surfaceBounds = data.surfaces.map((surface, order) => ({ surface, order,
    min: [0, 1, 2].map(axis => Math.min(...surface.vertices.map(point => point[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...surface.vertices.map(point => point[axis]))),
  }));
  const endpointIndex = createBoundsIndex(surfaceBounds);
  const endpoints = new Map(), endpointComponents = new Map();
  const componentOf = node => topology.components[node] ?? endpointComponents.get(node);
  const endpoint = (position, direction) => {
    const key = `${direction}/${JSON.stringify(position)}`;
    if (endpoints.has(key)) return endpoints.get(key);
    const supports = new Map();
    const bounds = { min: position.map(value => value - endpointRadius), max: position.map(value => value + endpointRadius) };
    // Restore input order so ties retain their established support witness.
    const nearby = [...endpointIndex(bounds, position, endpointRadius)].sort((a, b) => a.order - b.order);
    for (const { surface } of nearby) {
      const support = closestOnSurface(surface, position);
      if (!support || support.distance > endpointRadius) continue;
      const node = ids.get(surface.id), component = topology.components[node];
      const cell = [component, ...support.position.map(v => Math.floor(v / radius))].join('/');
      if ((supports.get(cell)?.distance ?? Infinity) > support.distance) supports.set(cell, support);
    }
    const node = graph.nodes.length, id = `@candidate-endpoint/${node}`;
    graph.nodes.push({ id, position }); ids.set(id, node); adjacency.push([]);
    const nearest = [...supports.values()].sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= data.options.maxVertical) {
      endpointComponents.set(node, topology.components[ids.get(nearest.surface)]);
    }
    for (const support of supports.values()) {
      const other = ids.get(support.surface);
      const points = [position, support.position, graph.nodes[other].position];
      const from = direction === 'start' ? node : other, to = direction === 'start' ? other : node;
      adjacency[from].push(edges.length); dirty.add(from);
      edges.push({ key: JSON.stringify(['endpoint', direction, position, support.surface, support.position]),
        from: graph.nodes[from].id, to: graph.nodes[to].id,
        points: direction === 'start' ? points : points.reverse(),
        unresolved: Math.hypot(position[0] - support.position[0], position[2] - support.position[2]) > 1e-6 ||
          Math.abs(position[1] - support.position[1]) > data.options.maxVertical,
        length: support.distance + distance(support.position, graph.nodes[other].position) });
    }
    endpoints.set(key, node);
    return node;
  };
  const append = (points, point) => {
    if (!points.length || distance(points.at(-1), point) > 1e-6) points.push(point);
  };
  const groundPoints = (arrival, path, goal) => {
    const points = [], run = [], selected = new Set();
    const include = id => {
      const node = ids.get(id);
      if (node < data.surfaces.length) selected.add(node);
    };
    const flush = () => {
      if (!run.length) return;
      let output = run;
      if (run.length > 2 && selected.size) {
        // Prepare only the selected corridor and one ring of known neighbours.
        // The global portals remain authoritative: recomputing a subset could
        // reopen a boundary that was ambiguous in the complete scene.
        const local = new Set(selected);
        for (const node of selected) for (const index of adjacency[node]) {
          if (index < groundEdgeCount) local.add(ids.get(edges[index].to));
        }
        const surfaces = [...local].map(node => data.surfaces[node]);
        const shared = portals.filter(portal => local.has(ids.get(portal.from)) && local.has(ids.get(portal.to)));
        const imported = (data.options.portals ?? []).filter(portal =>
          local.has(ids.get(portal.from)) && local.has(ids.get(portal.to)));
        const straighten = createGroundStraightener(surfaces, {
          walls: data.options.walls ?? [], profile: data.options.profile ?? { radius: 0, height: 1 }, portals: imported,
        }, shared);
        output = straighten(run);
      }
      for (const point of output) append(points, point);
      run.length = 0; selected.clear();
    };
    append(run, arrival.position);
    for (const edge of path) {
      include(edge.from);
      if (edge.unresolved || edge.mode || edge.device) {
        // The in-face approach can straighten, but the transfer itself is a
        // hard boundary. Its authored trajectory and endpoints stay intact.
        append(run, edge.points[0]); flush();
        for (const point of edge.points) append(points, point);
        append(run, edge.points.at(-1)); include(edge.to);
      } else {
        include(edge.to);
        for (const point of edge.points) append(run, point);
      }
    }
    append(run, goal); flush();
    // Projection roundoff must not replace the caller's actual destination.
    if (points.length === 1 && distance(points[0], goal) > 0) points.push(goal);
    else points[points.length - 1] = goal;
    return points;
  };
  // Lazy materialization must not let an earlier query reorder equal-cost choices.
  const compareEdges = (a, b) => {
    const left = edges[a], right = edges[b];
    const category = (edge, index) => index < groundEdgeCount ? 0 : edge.order ? 1 : edge.connectionIndex !== undefined ? 2 : 3;
    const difference = category(left, a) - category(right, b);
    if (difference) return difference;
    if (left.order && right.order) {
      for (let axis = 0; axis < left.order.length; axis++) {
        const delta = left.order[axis] - right.order[axis];
        if (delta) return delta;
      }
      return Number(left.reverse) - Number(right.reverse);
    }
    return a - b;
  };
  const edgeKey = (edge, index) => edge.key ?? JSON.stringify(['ground', index]);
  const rejected = new Set();
  return {
    reject(indices) {
      for (const index of indices) {
        if (typeof index !== 'string' && (!Number.isInteger(index) || index < 0 || index >= edges.length)) throw new Error('Invalid candidate edge');
        rejected.add(index);
      }
    },
    plan(arrivals, goal, { excludedEdges = [], excludedTransfers = [] } = {}) {
      const excluded = new Set(excludedEdges);
      const hasKeys = [...excluded, ...rejected].some(value => typeof value === 'string');
      const end = endpoint(goal, 'goal');
      const starts = arrivals.filter(arrival => arrival.state === 'available').map(arrival => ({ arrival, node: endpoint(arrival.position, 'start') }));
      const regions = excludedTransfers.map(region => {
        if (!ids.has(region.from) || !ids.has(region.to) || !Array.isArray(region.min) || !Array.isArray(region.max) ||
            region.min.length !== 3 || region.max.length !== 3 || region.min.some((value, axis) =>
              !Number.isFinite(value) || !Number.isFinite(region.max[axis]) || value > region.max[axis])) {
          throw new Error('Invalid excluded transfer region');
        }
        return { ...region, fromComponent: componentOf(ids.get(region.from)), toComponent: componentOf(ids.get(region.to)) };
      });
      const scores = new Float64Array(graph.nodes.length).fill(Infinity);
      const previous = new Int32Array(graph.nodes.length).fill(-1), origins = new Map(), heap = createMinHeap();
      for (const { arrival, node } of starts) {
        const score = arrival.cost ?? 0;
        if (score >= scores[node]) continue;
        scores[node] = score; origins.set(node, arrival); heap.push({ node, cost: score });
      }
      while (heap.size) {
        const current = heap.pop();
        if (current.cost !== scores[current.node]) continue;
        if (current.node === end) break;
        expand(topology.components[current.node]);
        if (dirty.delete(current.node)) adjacency[current.node].sort(compareEdges);
        for (const index of adjacency[current.node]) {
          const edge = edges[index], to = ids.get(edge.to);
          if (rejected.has(index) || excluded.has(index) ||
              hasKeys && (rejected.has(edgeKey(edge, index)) || excluded.has(edgeKey(edge, index)))) continue;
          if (edge.unresolved && regions.some(region =>
              region.fromComponent === componentOf(current.node) &&
              region.toComponent === componentOf(to) &&
              edge.points.every(point => point.every((value, axis) => value >= region.min[axis] && value <= region.max[axis])))) continue;
          const ascent = edge.points.at(-1)[1] - edge.points[0][1];
          const penalty = edge.unresolved ? (ascent > 2.1 && !edge.mode ? ascentPenalty : transferPenalty) : 0;
          const score = current.cost + penalty + (edge.length ?? edge.cost);
          if (score >= scores[to]) continue;
          scores[to] = score; previous[to] = index;
          origins.set(to, origins.get(current.node)); heap.push({ node: to, cost: score });
        }
      }
      if (!Number.isFinite(scores[end])) return { status: 'no-candidate' };
      const path = [];
      for (let node = end; previous[node] !== -1;) {
        const index = previous[node], edge = edges[index];
        path.push({ index, key: edgeKey(edge, index), from: edge.from, to: edge.to, points: edge.points,
          unresolved: Boolean(edge.unresolved),
          ...(edge.mode ? { mode: edge.mode } : {}), ...(edge.device ? { device: edge.device } : {}) });
        node = ids.get(edge.from);
      }
      path.reverse();
      const arrival = origins.get(end), points = groundPoints(arrival, path, goal);
      return { status: 'candidate', arrival, points, path,
        unresolved: path.filter(edge => edge.unresolved), score: scores[end] };
    },
  };
}
