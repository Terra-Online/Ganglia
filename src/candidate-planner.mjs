import { surfaceGraph } from './surfaces.mjs';
import { closestOnSurface } from './goals.mjs';
import { groundComponents } from './connectivity.mjs';
import { createMinHeap } from './heap.mjs';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Navigation proposals for local physical planning. Every returned segment still
 * requires physical validation. Scores prioritize fewer unresolved transfers and
 * are deliberately separate from travel time. Input geometry is immutable. */
export function createCandidatePlanner(data, { radius = 16, verticalRange = 50,
  transferPenalty = 10000, ascentPenalty = 1000000, endpointRadius = 96, connections = [] } = {}) {
  if (![radius, verticalRange, transferPenalty, ascentPenalty, endpointRadius].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('Invalid candidate search options');
  }
  const graph = surfaceGraph(data.surfaces, data.options);
  const topology = groundComponents(graph);
  const ids = topology.ids;
  const adjacency = graph.nodes.map(() => []);
  const edges = graph.edges;
  for (let index = 0; index < edges.length; index++) adjacency[ids.get(edges[index].from)].push(index);
  const grid = new Map(), proposals = new Map();
  const key = (x, z) => `${x},${z}`;
  for (const surface of data.surfaces) {
    const node = ids.get(surface.id), component = topology.components[node];
    for (const position of surface.vertices) {
      const x = Math.floor(position[0] / radius), z = Math.floor(position[2] / radius);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const other of grid.get(key(x + dx, z + dz)) ?? []) {
          if (component === other.component || Math.abs(position[1] - other.position[1]) > verticalRange ||
              Math.hypot(position[0] - other.position[0], position[2] - other.position[2]) > radius) continue;
          const pair = [Math.min(component, other.component), Math.max(component, other.component),
            ...position.map(Math.floor)].join('/');
          const length = distance(position, other.position);
          if ((proposals.get(pair)?.length ?? Infinity) <= length) continue;
          proposals.set(pair, { from: surface.id, to: graph.nodes[other.node].id,
            points: [position, other.position], length, unresolved: true });
        }
      }
      const cell = key(x, z), entries = grid.get(cell) ?? [];
      if (!entries.some(other => other.component === component && distance(position, other.position) < 0.001)) {
        entries.push({ node, component, position });
        grid.set(cell, entries);
      }
    }
  }
  for (const proposal of proposals.values()) for (const edge of [proposal,
    { ...proposal, from: proposal.to, to: proposal.from, points: [...proposal.points].reverse() }]) {
    adjacency[ids.get(edge.from)].push(edges.length);
    edges.push(edge);
  }
  for (const connection of connections) {
    if (!ids.has(connection.from) || !ids.has(connection.to) || !Array.isArray(connection.points) || connection.points.length < 2) {
      throw new Error('Invalid candidate connection');
    }
    adjacency[ids.get(connection.from)].push(edges.length);
    edges.push({ ...connection, unresolved: true,
      length: connection.points.slice(1).reduce((sum, point, index) => sum + distance(connection.points[index], point), 0) });
  }
  const endpoints = new Map();
  const endpoint = (position, direction) => {
    const key = `${direction}/${JSON.stringify(position)}`;
    if (endpoints.has(key)) return endpoints.get(key);
    const supports = new Map();
    for (const surface of data.surfaces) {
      // Bounds rejection also works when a polygon spans the whole local window.
      if ([0, 1, 2].some(axis => Math.min(...surface.vertices.map(p => p[axis])) > position[axis] + endpointRadius ||
          Math.max(...surface.vertices.map(p => p[axis])) < position[axis] - endpointRadius)) continue;
      const support = closestOnSurface(surface, position);
      if (!support || support.distance > endpointRadius) continue;
      const node = ids.get(surface.id), component = topology.components[node];
      const cell = [component, ...support.position.map(v => Math.floor(v / radius))].join('/');
      if ((supports.get(cell)?.distance ?? Infinity) > support.distance) supports.set(cell, support);
    }
    const node = graph.nodes.length, id = `@candidate-endpoint/${node}`;
    graph.nodes.push({ id, position }); ids.set(id, node); adjacency.push([]);
    for (const support of supports.values()) {
      const other = ids.get(support.surface);
      const points = [position, support.position, graph.nodes[other].position];
      const from = direction === 'start' ? node : other, to = direction === 'start' ? other : node;
      adjacency[from].push(edges.length);
      edges.push({ from: graph.nodes[from].id, to: graph.nodes[to].id,
        points: direction === 'start' ? points : points.reverse(), unresolved: true,
        length: support.distance + distance(support.position, graph.nodes[other].position) });
    }
    endpoints.set(key, node);
    return node;
  };
  const rejected = new Set();
  return {
    reject(indices) {
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= edges.length) throw new Error('Invalid candidate edge');
        rejected.add(index);
      }
    },
    plan(arrivals, goal, { excludedEdges = [] } = {}) {
      const excluded = new Set(excludedEdges);
      const end = endpoint(goal, 'goal');
      const starts = arrivals.filter(arrival => arrival.state === 'available').map(arrival => ({ arrival, node: endpoint(arrival.position, 'start') }));
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
        for (const index of adjacency[current.node]) {
          if (rejected.has(index) || excluded.has(index)) continue;
          const edge = edges[index], to = ids.get(edge.to);
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
        path.push({ index, from: edge.from, to: edge.to, points: edge.points,
          unresolved: Boolean(edge.unresolved),
          ...(edge.mode ? { mode: edge.mode } : {}), ...(edge.device ? { device: edge.device } : {}) });
        node = ids.get(edge.from);
      }
      path.reverse();
      const arrival = origins.get(end), points = [arrival.position];
      for (const edge of path) for (const point of edge.points) {
        if (distance(points.at(-1), point) > 1e-6) points.push(point);
      }
      if (distance(points.at(-1), goal) > 1e-6) points.push(goal);
      return { status: 'candidate', arrival, points, path,
        unresolved: path.filter(edge => edge.unresolved), score: scores[end] };
    },
  };
}
