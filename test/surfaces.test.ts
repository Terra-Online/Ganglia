import assert from 'node:assert/strict';
import { test } from 'node:test';

import { surfaceGraph, projectPoint, route } from '../src/index.js';
test('joins a shared 3D edge but never an overlapping upper floor', () => {
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ],
  };
  const upper = { id: 'upper', vertices: a.vertices.map(([x, y, z]) => [x, y + 5, z]) };
  const graph = surfaceGraph([a, b, upper], { speed: 1 });
  assert.equal(route(graph, 'a', 'b').status, 'complete');
  assert.equal(route(graph, 'a', 'upper').status, 'no-verified-route');
  assert.deepEqual(route(graph, 'a', 'b').points[1], [1, 0, 0.5]);
});

test('projects on the correct stacked floor and refuses points over a gap', () => {
  const surfaces = [
    {
      id: 'lower',
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
        [0, 0, 2],
      ],
    },
    {
      id: 'upper',
      vertices: [
        [0, 5, 0],
        [2, 5, 0],
        [2, 5, 2],
        [0, 5, 2],
      ],
    },
  ];
  assert.equal(projectPoint(surfaces, [1, 5.2, 1], { maxVertical: 0.5 }).surface, 'upper');
  assert.equal(projectPoint(surfaces, [1, 2, 1], { maxVertical: 0.5 }), null);
  assert.equal(projectPoint(surfaces, [3, 0, 1], { maxVertical: 0.5 }), null);
});

test('coincident geometry does not override an authored closed polygon boundary', () => {
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    portals: [],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ],
    portals: [3],
  };
  assert.equal(route(surfaceGraph([a, b], { speed: 1 }), 'a', 'b').status, 'no-verified-route');
  assert.equal(
    route(surfaceGraph([{ ...a, portals: [1] }, b], { speed: 1 }), 'a', 'b').status,
    'complete',
  );
});

test('joins split collinear portals only over their positive shared interval', () => {
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 2],
      [0, 0, 2],
    ],
    portals: [1],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ],
    portals: [3],
  };
  const c = {
    id: 'c',
    vertices: [
      [1, 0, 1],
      [2, 0, 1],
      [2, 0, 2],
      [1, 0, 2],
    ],
    portals: [3],
  };
  const graph = surfaceGraph([a, b, c], { speed: 1 });
  assert.equal(route(graph, 'a', 'b').status, 'complete');
  assert.equal(route(graph, 'a', 'c').status, 'complete');
  assert.deepEqual(route(graph, 'a', 'b').points[1], [1, 0, 0.5]);
  assert.deepEqual(route(graph, 'a', 'c').points[1], [1, 0, 1.5]);
  assert.equal(
    route(
      surfaceGraph([a, { ...b, vertices: b.vertices.map(([x, y, z]) => [x, y + 0.01, z]) }], {
        speed: 1,
      }),
      'a',
      'b',
    ).status,
    'no-verified-route',
  );
  assert.equal(
    route(surfaceGraph([{ ...a, portals: [] }, b], { speed: 1 }), 'a', 'b').status,
    'no-verified-route',
  );
  assert.equal(
    route(surfaceGraph([a, b, { ...b, id: 'duplicate' }], { speed: 1 }), 'a', 'b').status,
    'no-verified-route',
  );
});

test('imported vertical seam transfers are directed and retain both ground heights', () => {
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    portals: [],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0.2, 0],
      [2, 0.2, 0],
      [2, 0.2, 1],
      [1, 0.2, 1],
    ],
    portals: [],
  };
  const portal = {
    from: 'a',
    to: 'b',
    points: [
      [1, 0, 0.5],
      [1, 0.2, 0.5],
    ],
  };
  const graph = surfaceGraph([a, b], { speed: 1, portals: [portal] });
  assert.deepEqual(route(graph, 'a', 'b').points, [
    [0.5, 0, 0.5],
    [1, 0, 0.5],
    [1, 0.2, 0.5],
    [1.5, 0.2, 0.5],
  ]);
  assert.equal(route(graph, 'b', 'a').status, 'no-verified-route');
  assert.throws(
    () =>
      surfaceGraph([a, b], {
        speed: 1,
        portals: [
          {
            ...portal,
            points: [
              [1, 0, 0.5],
              [1.01, 0.2, 0.5],
            ],
          },
        ],
      }),
    /Invalid imported portal/,
  );
  assert.throws(
    () =>
      surfaceGraph([a, b], {
        speed: 1,
        portals: [
          {
            ...portal,
            points: [
              [1, 0, 0.5],
              [1, 0.3, 0.5],
            ],
          },
        ],
      }),
    /Invalid imported portal/,
  );
});

test('joins rotated sloping split edges without inventing height or horizontal gaps', () => {
  const transform = ([x, y, z]) => [
    (x - z) / Math.sqrt(2),
    y + x * 0.2 + z * 0.1,
    (x + z) / Math.sqrt(2),
  ];
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 2],
      [0, 0, 2],
    ].map(transform),
    portals: [1],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ].map(transform),
    portals: [3],
  };
  assert.equal(route(surfaceGraph([a, b], { speed: 1 }), 'a', 'b').status, 'complete');
  const separated = { ...b, vertices: b.vertices.map(([x, y, z]) => [x + 0.001, y, z]) };
  assert.equal(
    route(surfaceGraph([a, separated], { speed: 1 }), 'a', 'b').status,
    'no-verified-route',
  );
});

test('rejects imported seam endpoints inside a polygon instead of on its boundary', () => {
  const a = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
    portals: [],
  };
  const b = {
    id: 'b',
    vertices: [
      [1, 0.2, 0],
      [3, 0.2, 0],
      [3, 0.2, 2],
      [1, 0.2, 2],
    ],
    portals: [],
  };
  assert.throws(
    () =>
      surfaceGraph([a, b], {
        speed: 1,
        portals: [
          {
            from: 'a',
            to: 'b',
            points: [
              [1, 0, 1],
              [1, 0.2, 1],
            ],
          },
        ],
      }),
    /Invalid imported portal/,
  );
});
