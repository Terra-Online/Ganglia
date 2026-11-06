import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, routeFrom, createRoutePlanner, sampleRoute } from '../src/routes.mjs';
const nodes = [
  { id: 'a', position: [0, 0, 0] }, { id: 'b', position: [0, 0, 5] },
  { id: 'c', position: [5, 0, 5] }, { id: 'upper', position: [0, 8, 0] },
];
const edge = (from, to, cost, state = 'open') => ({ from, to, cost, state,
  points: [nodes.find(n => n.id === from).position, nodes.find(n => n.id === to).position] });
test('blocked shortcut uses directed verified corridors; overlapping floor stays disconnected', () => {
  const graph = { nodes, edges: [edge('a', 'c', 1, 'unknown'), edge('a', 'b', 3), edge('b', 'c', 2)] };
  const result = route(graph, 'a', 'c');
  assert.equal(result.status, 'complete'); assert.equal(result.cost, 5); assert.equal(result.length, 10);
  assert.deepEqual(sampleRoute(result.points, 6), [1, 0, 5]);
  assert.equal(route(graph, 'c', 'a').status, 'no-verified-route');
  assert.equal(route(graph, 'a', 'upper').status, 'no-verified-route');
  assert.equal(route(graph, 'missing', 'c').status, 'unmapped');
  assert.equal(route({ ...graph, edges: [...graph.edges, edge('a', 'c', 1)] }, 'a', 'c').cost, 1);
});
test('rejects invalid costs and discontinuous edge geometry', () => {
  assert.throws(() => route({ nodes, edges: [edge('a', 'c', -1)] }, 'a', 'c'));
  assert.throws(() => route({ nodes, edges: [{ ...edge('a', 'c', 1), points: [[1, 0, 0], [5, 0, 5]] }] }, 'a', 'c'));
});
test('animation handles duplicate points and clamps endpoints without cutting corners', () => {
  const points = [[0, 0, 0], [0, 0, 0], [0, 0, 5], [5, 0, 5]];
  assert.deepEqual(sampleRoute(points, -1), points[0]);
  assert.deepEqual(sampleRoute(points, 5), [0, 0, 5]);
  assert.deepEqual(sampleRoute(points, 99), points.at(-1));
});

test('keeps least-cost remote actions with fast and zero-cost authored transfers', () => {
  const positions = { start: [0, 0, 0], goal: [10, 0, 0], remote: [1000, 0, 0] };
  for (const cost of [0, 0.001]) {
    const graph = {
      nodes: Object.entries(positions).map(([id, position]) => ({ id, position })),
      edges: [['start', 'goal', 10], ['start', 'remote', cost], ['remote', 'goal', 1]]
        .map(([from, to, cost]) => ({ from, to, cost, state: 'open', points: [positions[from], positions[to]] })),
    };
    const result = route(graph, 'start', 'goal');
    assert.equal(result.status, 'complete');
    assert.equal(result.cost, cost + 1);
    assert.deepEqual(result.points, [positions.start, positions.remote, positions.goal]);
  }
});

test('reused geometric estimates preserve routes when actions, goals and endpoint positions change', () => {
  const positions = { start: [0, 0, 0], near: [10, 0, 0], remote: [1000, 0, 0] };
  const base = { nodes: Object.entries(positions).map(([id, position]) => ({ id, position })),
    edges: [{ from: 'start', to: 'near', cost: 10, state: 'open', points: [positions.start, positions.near] }] };
  const plan = createRoutePlanner(base);
  const starts = [{ id: 'origin', node: 'start', cost: 0, state: 'available' }];
  const empty = { nodes: [], edges: [] };
  const compare = (extra, goals) => assert.deepEqual(plan(extra, starts, goals),
    routeFrom({ nodes: [...base.nodes, ...extra.nodes], edges: [...base.edges, ...extra.edges] }, starts, goals));
  compare(empty, 'near');
  // Reusing time estimates would incorrectly prune the newly added remote route.
  for (const cost of [0.001, 0]) {
    const extra = { nodes: [], edges: [['start', 'remote', cost], ['remote', 'near', 1]]
      .map(([from, to, cost]) => ({ from, to, cost, state: 'open', points: [positions[from], positions[to]] })) };
    compare(extra, 'near');
    assert.equal(plan(extra, starts, 'near').cost, cost + 1);
    compare(empty, 'near');
  }
  for (const position of [[11, 0, 0], [1001, 0, 0], [11, 0, 0]]) {
    const extra = { nodes: [{ id: 'endpoint', position }], edges: [
      { from: 'near', to: 'endpoint', cost: 2, state: 'open', points: [positions.near, position] },
    ] };
    compare(extra, ['remote', 'endpoint']);
    compare(extra, 'endpoint');
    compare(empty, 'remote');
  }
});
