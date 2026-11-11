import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Arrival, Edge, Graph, Node, Vec3 } from '../src/index-types.ts';
import { routeFrom } from '../src/index.ts';
import { expectStatus } from './assertions.ts';
test('selects by walking cost plus teleport overhead, excluding locked and disconnected arrivals', () => {
  const nodes: Node[] = ['near', 'far', 'goal', 'locked', 'island'].map((id, i) => ({
    id,
    position: [i, 0, 0],
  }));
  const edge = (from: string, cost: number): Edge => ({
    from,
    to: 'goal',
    cost,
    state: 'open',
    points: [nodes.find((n) => n.id === from)!.position, nodes[2].position] as Vec3[],
  });
  const graph: Graph = { nodes, edges: [edge('near', 100), edge('far', 10), edge('locked', 1)] };
  const starts: Arrival[] = [
    { id: 'tp-near', node: 'near', state: 'available', cost: 5 },
    { id: 'base-centre', node: 'far', state: 'available', cost: 5 },
    { id: 'locked', node: 'locked', state: 'locked', cost: 0 },
    { id: 'island', node: 'island', state: 'available', cost: 0 },
  ];
  const result = routeFrom(graph, starts, 'goal');
  assert.ok(result.status === 'complete');
  assert.equal(result.start, 'base-centre');
  assert.equal(result.cost, 15);
  assert.deepEqual(result.points[0], nodes[1].position);
  assert.equal(
    expectStatus(
      routeFrom(
        graph,
        [...starts, { id: 'walk', node: 'far', state: 'available', cost: 0 }],
        'goal',
      ),
      'complete',
    ).start,
    'walk',
  );
});
