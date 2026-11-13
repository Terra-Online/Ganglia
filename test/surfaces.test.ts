import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Portal, Surface, Vec3 } from '#@/src/geometry.ts';
import {
  surfaceGraph,
  projectPoint,
  surfacePortals,
  createSurfacePortalBuilder,
} from '#@/src/v1/geo/surfaces.ts';
import { route } from '#@/src/v1/route/routes.ts';
import { expectStatus } from '#@/test/assertions.ts';

test('prepared coarse portal groups preserve ordered overlaps without retaining blocked refinements', () => {
  const floor = (id: string, x0: number, x1: number, z0: number, z1: number): Surface => ({
    id,
    vertices: [
      [x0, 0, z0],
      [x1, 0, z0],
      [x1, 0, z1],
      [x0, 0, z1],
    ],
  });
  const coarse = [
    floor('a', 0, 2, 0, 4),
    floor('b', 2, 4, 0, 4),
    floor('c', 4, 6, 0, 2),
    floor('d', 4, 6, 2, 4),
  ];
  const resolve = createSurfacePortalBuilder(coarse);
  const unchanged = surfacePortals(coarse);
  assert.ok(unchanged.some((portal) => portal.from === 'a' && portal.to === 'b'));
  const variants: Surface[][] = [
    [floor('fine', 2, 3, 0.5, 1.5)],
    [floor('fine', 6, 8, 0, 4)],
    [floor('fine', 2, 4, 0, 4)],
    [floor('fine', 6, 8, 0, 2), floor('next', 6, 8, 2, 4)],
    [floor('next', 6, 8, 2, 4), floor('fine', 6, 8, 0, 2)],
    [floor('fine', 6 + 2e-5, 8 + 2e-5, 0, 2)],
    [{ ...floor('fine', 6, 8, 0, 4), portals: [1, 2] }],
    [],
  ];
  for (const fine of [...variants, ...variants.slice().reverse()]) {
    const actual = resolve(fine),
      expected = surfacePortals([...coarse, ...fine]);
    assert.deepEqual(actual, expected);
    assert.deepEqual(
      surfaceGraph([...coarse, ...fine], { speed: 3 }, actual),
      surfaceGraph([...coarse, ...fine], { speed: 3 }, expected),
    );
  }
  assert.ok(!resolve(variants[0]).some((portal) => portal.from === 'a' && portal.to === 'b'));
  assert.deepEqual(resolve([]), unchanged);
  assert.throws(() => resolve([floor('a', 8, 10, 0, 2)]), /Invalid surface/);
});

test('prepared portal grouping retains first-owner coordinates at quantized keys across input orders', () => {
  for (const offset of [-10000, -0, 10000]) {
    const floor = (id: string, x0: number, x1: number, z0: number, z1: number): Surface => ({
      id,
      vertices: [
        [x0 + offset, -0, z0],
        [x1 + offset, -0, z0],
        [x1 + offset, -0, z1],
        [x0 + offset, -0, z1],
      ],
    });
    const coarse = [floor('coarse', 0, 2, 0, 2)];
    const resolve = createSurfacePortalBuilder(coarse);
    const near = floor('near', 2 + 2e-5, 4, 0, 2);
    const upper = floor('upper', 0, 2, 2, 4);
    for (const fine of [[near], [near, upper], [upper, near], [near]]) {
      const actual = resolve(fine);
      assert.deepEqual(actual, surfacePortals([...coarse, ...fine]));
      const shared = actual.find((portal) => portal.to === 'near');
      assert.ok(shared);
      assert.equal(shared.start[0], 2 + offset);
      assert.equal(shared.end[0], 2 + offset);
    }
  }
});

test('joins a shared 3D edge but never an overlapping upper floor', () => {
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  };
  const b: Surface = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ],
  };
  const upper: Surface = {
    id: 'upper',
    vertices: a.vertices.map(([x, y, z]: readonly number[]) => [x, y + 5, z]),
  };
  const graph = surfaceGraph([a, b, upper], { speed: 1 });
  assert.equal(route(graph, 'a', 'b').status, 'complete');
  assert.equal(route(graph, 'a', 'upper').status, 'no-verified-route');
  assert.deepEqual(expectStatus(route(graph, 'a', 'b'), 'complete').points[1], [1, 0, 0.5]);
});

test('projects on the correct stacked floor and refuses points over a gap', () => {
  const surfaces: Surface[] = [
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
  assert.equal(projectPoint(surfaces, [1, 5.2, 1], { maxVertical: 0.5 })!.surface, 'upper');
  assert.equal(projectPoint(surfaces, [1, 2, 1], { maxVertical: 0.5 }), null);
  assert.equal(projectPoint(surfaces, [3, 0, 1], { maxVertical: 0.5 }), null);
});

test('coincident geometry does not override an authored closed polygon boundary', () => {
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    portals: [],
  };
  const b: Surface = {
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
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 2],
      [0, 0, 2],
    ],
    portals: [1],
  };
  const b: Surface = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ],
    portals: [3],
  };
  const c: Surface = {
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
  assert.deepEqual(expectStatus(route(graph, 'a', 'b'), 'complete').points[1], [1, 0, 0.5]);
  assert.deepEqual(expectStatus(route(graph, 'a', 'c'), 'complete').points[1], [1, 0, 1.5]);
  assert.equal(
    route(
      surfaceGraph(
        [a, { ...b, vertices: b.vertices.map(([x, y, z]: readonly number[]) => [x, y + 0.01, z]) }],
        {
          speed: 1,
        },
      ),
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
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    portals: [],
  };
  const b: Surface = {
    id: 'b',
    vertices: [
      [1, 0.2, 0],
      [2, 0.2, 0],
      [2, 0.2, 1],
      [1, 0.2, 1],
    ],
    portals: [],
  };
  const portal: Portal = {
    from: 'a',
    to: 'b',
    points: [
      [1, 0, 0.5],
      [1, 0.2, 0.5],
    ],
  };
  const graph = surfaceGraph([a, b], { speed: 1, portals: [portal] });
  assert.deepEqual(expectStatus(route(graph, 'a', 'b'), 'complete').points, [
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
  const transform: (value: number[], index: number, array: number[][]) => number[] = ([
    x,
    y,
    z,
  ]: readonly number[]) => [(x - z) / Math.sqrt(2), y + x * 0.2 + z * 0.1, (x + z) / Math.sqrt(2)];
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 2],
      [0, 0, 2],
    ].map(transform) as Vec3[],
    portals: [1],
  };
  const b: Surface = {
    id: 'b',
    vertices: [
      [1, 0, 0],
      [2, 0, 0],
      [2, 0, 1],
      [1, 0, 1],
    ].map(transform) as Vec3[],
    portals: [3],
  };
  assert.equal(route(surfaceGraph([a, b], { speed: 1 }), 'a', 'b').status, 'complete');
  const separated: Surface = {
    ...b,
    vertices: b.vertices.map(([x, y, z]: readonly number[]) => [x + 0.001, y, z]),
  };
  assert.equal(
    route(surfaceGraph([a, separated], { speed: 1 }), 'a', 'b').status,
    'no-verified-route',
  );
});

test('rejects imported seam endpoints inside a polygon instead of on its boundary', () => {
  const a: Surface = {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
    portals: [],
  };
  const b: Surface = {
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
