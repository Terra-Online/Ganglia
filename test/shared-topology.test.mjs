import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundComponents, condenseComponents, directedComponents } from '../src/connectivity.mjs';
import { createGroundPlanner, groundPreparation } from '../src/ground.mjs';
import { movementGeometry } from '../src/movement-geometry.mjs';
import { prepareRoutePlanner, routeFrom } from '../src/routes.mjs';
import { createWallChecker } from '../src/walls.mjs';

const empty = { nodes: [], edges: [] };

test('one normalized graph retains accepted global edge order and serves unchanged directed searches', () => {
  let seed = 447;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const constraints = { profile: { radius: .1, height: 1 },
    walls: [{ min: [3,-2,2], max: [3.1,3,3], state: 'unknown' }] };
  const blocked = createWallChecker(constraints.walls, constraints.profile);
  for (let trial = 0; trial < 12; trial++) {
    const nodes = Array.from({ length: 10 }, (_, id) => ({ id: String(id), position: [id, id % 3, id % 2] }));
    const edge = () => {
      const from = nodes[Math.floor(random() * 9)], to = nodes[Math.floor(random() * 9)];
      return { from: from.id, to: to.id, cost: Math.floor(random() * 4),
        state: ['open', 'open', 'closed', 'unknown'][Math.floor(random() * 4)],
        points: [from.position, to.position] };
    };
    const graph = { nodes, edges: Array.from({ length: 25 }, edge) };
    const normalized = prepareRoutePlanner(graph, constraints);
    const accepted = graph.edges.filter(edge => edge.state === 'open' && !blocked(...edge.points));
    assert.deepEqual(normalized.graph, { nodes, edges: accepted });
    for (let index = 0; index < accepted.length; index++) assert.equal(normalized.graph.edges[index], accepted[index]);
    const topology = groundComponents({ nodes, edges: accepted });
    assert.deepEqual(normalized.topology, topology);
    const adjacency = new Map(nodes.map(node => [node.id, accepted.filter(edge => edge.from === node.id)]));
    assert.deepEqual(condenseComponents(normalized.topology), directedComponents(nodes.map(node => node.id), adjacency));
    const starts = [{ id: 'tp', node: '0', cost: .5, state: 'available' }];
    assert.equal(normalized.plan(empty, starts, '9').status, 'no-verified-route');
    for (let size = 0; size < 9; size++) {
      const extra = { nodes: [], edges: Array.from({ length: size }, edge) };
      assert.deepEqual(normalized.plan(extra, starts, [String(size), '9']),
        routeFrom({ nodes, edges: [...graph.edges, ...extra.edges] }, starts, [String(size), '9'], constraints));
    }
    assert.deepEqual(normalized.graph.edges, accepted);
    assert.deepEqual(normalized.topology, topology);
  }
});

const rectangle = (id, left, right) => ({ id, vertices: [[left,0,0],[right,0,0],[right,0,2],[left,0,2]] });

test('movement shares the exact filtered preparation only for matching constraints and portals', () => {
  const surfaces = [rectangle('a', 0, 2), rectangle('b', 2, 4), rectangle('c', 4, 6), rectangle('island', 9, 11)];
  const options = { speed: 5, maxVertical: .1, walls: [], profile: { radius: .35, height: 1.66 } };
  const planner = createGroundPlanner(surfaces, options);
  const prepared = groundPreparation(planner);
  const query = { ...options, groundPlanner: planner };
  const shared = movementGeometry(surfaces, query);
  assert.equal(shared.graph, prepared.routeBase.graph);
  assert.equal(shared.forward, prepared.routeBase.forward);
  assert.equal(shared.blocked, prepared.routeBase.blocked);
  assert.equal(shared.topology, prepared.routeBase.topology);
  assert.deepEqual(shared.topology, groundComponents(prepared.graph));
  for (const changed of [
    { walls: [{ min: [1.8,-1,-1], max: [2.2,3,3], state: 'unknown' }] },
    { profile: { radius: .5, height: 2 } },
    { portals: [] },
  ]) {
    const selected = { ...query, ...changed };
    const geometry = movementGeometry(surfaces, selected);
    assert.notEqual(geometry.graph, prepared.routeBase.graph);
    assert.notEqual(geometry.topology, prepared.routeBase.topology);
    const blocked = createWallChecker(selected.walls, selected.profile);
    const expected = { nodes: prepared.graph.nodes, edges: prepared.graph.edges.filter(edge =>
      !edge.points.slice(1).some((point, index) => blocked(edge.points[index], point))) };
    assert.deepEqual(geometry.topology, groundComponents(expected));
  }
  const returned = movementGeometry(surfaces, query);
  assert.equal(returned.graph, prepared.routeBase.graph);
  assert.equal(returned.topology, prepared.routeBase.topology);
});
