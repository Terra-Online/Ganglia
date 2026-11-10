import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeFrom } from '../src/index.js';
test('selects by walking cost plus teleport overhead, excluding locked and disconnected arrivals', () => {
  const nodes = ['near', 'far', 'goal', 'locked', 'island'].map((id, i) => ({
    id,
    position: [i, 0, 0],
  }));
  const edge = (from, cost) => ({
    from,
    to: 'goal',
    cost,
    state: 'open',
    points: [nodes.find((n) => n.id === from).position, nodes[2].position],
  });
  const graph = { nodes, edges: [edge('near', 100), edge('far', 10), edge('locked', 1)] };
  const starts = [
    { id: 'tp-near', node: 'near', state: 'available', cost: 5 },
    { id: 'base-centre', node: 'far', state: 'available', cost: 5 },
    { id: 'locked', node: 'locked', state: 'locked', cost: 0 },
    { id: 'island', node: 'island', state: 'available', cost: 0 },
  ];
  const result = routeFrom(graph, starts, 'goal');
  assert.equal(result.start, 'base-centre');
  assert.equal(result.cost, 15);
  assert.deepEqual(result.points[0], nodes[1].position);
  assert.equal(
    routeFrom(graph, [...starts, { id: 'walk', node: 'far', state: 'available', cost: 0 }], 'goal')
      .start,
    'walk',
  );
});
