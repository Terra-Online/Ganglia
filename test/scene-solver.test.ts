import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Route } from '../src/route/routes.ts';
import type { RouteEvent } from '../src/solver/contract.ts';
import { prepareSceneRouteSolver, type SceneResources } from '../src/solver/scene/prepared.ts';

type Job = { status: 'ready'; route?: Route };
function fixture() {
  const starts = [
    {
      id: 'blocked',
      position: [0, 0, 0] as [number, number, number],
      state: 'available' as const,
      cost: 0,
    },
    {
      id: 'open',
      position: [10, 0, 0] as [number, number, number],
      state: 'available' as const,
      cost: 0,
    },
  ];
  const resources: SceneResources<null, Job> = {
    plan: async (arrivals, goal) => ({
      status: 'candidate',
      arrival: arrivals[0],
      points: [arrivals[0].position, goal],
      path: [],
    }),
    query: async () => ({ status: 'ready' }),
    solve: async (_job, request) => ({
      status: 'ready',
      route:
        request.arrival.id === 'blocked'
          ? { status: 'no-verified-route' }
          : {
              status: 'complete',
              start: request.arrival.id,
              arrivalCost: 0,
              cost: 1,
              length: 20 - request.arrival.position[0],
              points: [request.arrival.position, request.target],
              segments: [
                { mode: 'walk', points: [request.arrival.position, request.target], times: [0, 1] },
              ],
            },
    }),
    key: () => 'floor',
    ground: async () => ({
      surfaces: [
        {
          id: 'floor',
          vertices: [
            [-1, 0, -1],
            [21, 0, -1],
            [21, 0, 1],
            [-1, 0, 1],
          ],
        },
      ],
      options: { speed: 5, maxVertical: 0.1, walls: [], profile: { radius: 0.1, height: 1.8 } },
    }),
    route: (job) => ({ route: job.route }),
    wait: async () => {},
  };
  const scene = { scene: 'fixture', source: null, walls: [] };
  const config = {
    tileSpan: 38.4,
    gridSpan: 32,
    maxTiles: 16,
    margin: 4,
    locomotion: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 },
  };
  return { starts, resources, scene, config };
}
test('a failed anchor does not discard a verified target approach or poison later queries', async () => {
  const { starts, resources, scene, config } = fixture();
  const solver = prepareSceneRouteSolver(scene, resources, config);
  const events: RouteEvent[] = [];
  const query = { starts, goal: [20, 0, 0] as [number, number, number] };
  try {
    const result = await solver.solve(query, { onEvent: (event) => events.push(event) });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') assert.equal(result.route.start, 'open');
    assert.ok(events.some((event) => event.type === 'candidate' && event.result.partial));
    const repeated = await solver.solve(query);
    assert.deepEqual(repeated, result);
  } finally {
    await solver.close();
  }
});

test('batch lanes overlap and close drains every accepted query in input order', async () => {
  const { starts, resources, scene, config } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = 0,
    peak = 0;
  const plan = resources.plan;
  resources.plan = async (...args) => {
    running++;
    peak = Math.max(peak, running);
    await gate;
    try {
      return await plan(...args);
    } finally {
      running--;
    }
  };
  const solver = prepareSceneRouteSolver(scene, resources, { ...config, batchConcurrency: 2 });
  const queries = [18, 19, 20].map((x) => ({
    starts: [starts[1]],
    goal: [x, 0, 0] as [number, number, number],
  }));
  const batch = solver.solveBatch(queries);
  const closing = solver.close();
  const alsoClosing = solver.close();
  assert.equal(alsoClosing, closing);
  release();
  const results = await batch;
  await closing;
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((r) => (r.route.status === 'complete' ? r.route.points.at(-1)?.[0] : null)),
    [18, 19, 20],
  );
  await assert.rejects(solver.solve(queries[0]), /closed/);
});
test('exhausting the retry budget retains partial evidence and reports truncation', async () => {
  const { starts, resources, scene, config } = fixture();
  const solver = prepareSceneRouteSolver(scene, resources, { ...config, maxAttempts: 1 });
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] });
    assert.equal(result.partial, true);
    assert.equal(result.route.status, 'complete');
    assert.equal(result.diagnostics.truncated, true);
    assert.equal(result.diagnostics.candidateAttempts, 1);
  } finally {
    await solver.close();
  }
});
test('cancellation after candidate preparation stops before physical work', async () => {
  const { starts, resources, scene, config } = fixture();
  const controller = new AbortController();
  const plan = resources.plan;
  resources.plan = async (...args) => {
    controller.abort();
    return plan(...args);
  };
  resources.query = async () => {
    throw new Error('Cancelled query must not load physics');
  };
  const solver = prepareSceneRouteSolver(scene, resources, config);
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] }, { signal: controller.signal });
    assert.equal(result.reason, 'aborted');
    assert.equal(result.diagnostics.truncated, true);
  } finally {
    await solver.close();
  }
});

test('a rejected transfer is scoped to its query while another candidate can complete', async () => {
  const { starts, resources, scene, config } = fixture();
  resources.plan = async (arrivals, goal, rejected) => {
    const blocked = arrivals.find((a) => a.id === 'blocked');
    if (!blocked) throw new Error('A failed transfer must not discard its arrival');
    const arrival = rejected.includes('bridge') ? arrivals.find((a) => a.id === 'open')! : blocked;
    return {
      status: 'candidate',
      arrival,
      points: [arrival.position, goal],
      path: [{ index: 1, key: 'bridge', unresolved: true, points: [blocked.position, goal] }],
    };
  };
  const solver = prepareSceneRouteSolver(scene, resources, config);
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') assert.equal(result.route.start, 'open');
    assert.equal(result.diagnostics.candidateAttempts, 2);
  } finally {
    await solver.close();
  }
});
test('terminal assets are ranked by complete approach cost and joined at their proven entry', async () => {
  const { starts, resources, scene, config } = fixture();
  const tail = (entry: number, cost: number) => ({
    status: 'complete' as const,
    start: 'entry',
    arrivalCost: 0,
    cost,
    length: 20 - entry,
    points: [
      [entry, 0, 0],
      [20, 0, 0],
    ] as [number, number, number][],
    segments: [
      {
        mode: 'walk' as const,
        points: [
          [entry, 0, 0],
          [20, 0, 0],
        ] as [number, number, number][],
        times: [0, cost],
      },
    ],
    goalHit: { segment: 0, time: cost, position: [20, 0, 0] as [number, number, number] },
  });
  resources.terminals = async () => [
    { id: 'expensive', route: tail(15, 100) },
    { id: 'cheap', route: tail(18, 1) },
  ];
  const solver = prepareSceneRouteSolver(scene, resources, config);
  try {
    const result = await solver.solve({
      starts: [starts[1]],
      goal: [20, 0, 0],
      interaction: { radius: 1, airborne: true },
    });
    assert.equal(result.partial, false);
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') {
      assert.deepEqual(result.route.goalHit?.position, [20, 0, 0]);
      assert.ok(result.route.points.some((p) => p[0] === 18));
      assert.ok(result.route.cost < 10);
    }
  } finally {
    await solver.close();
  }
});

test('local discovery truncation survives retained partial output and arrival exhaustion', async () => {
  const { starts, resources, scene, config } = fixture();
  resources.route = (job) => ({ route: job.route, diagnostics: { truncated: true } });
  const solver = prepareSceneRouteSolver(scene, resources, config);
  try {
    const result = await solver.solve({ starts: [starts[0]], goal: [20, 0, 0] });
    assert.equal(result.partial, true);
    assert.equal(result.diagnostics.truncated, true);
  } finally {
    await solver.close();
  }
});
