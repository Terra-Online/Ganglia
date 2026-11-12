import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface } from '#@/src/geometry.ts';
import type { Route } from '#@/src/route.ts';
import type { WindowResources, WindowRequest, WindowJob } from '#@/src/solver/resources.ts';
import { setActionCatalogPhase } from '#@/src/v1/route/action-catalog.ts';
import {
  createWindowGroundCache,
  createWindowRoute,
  type WindowConfig,
} from '#@/src/v1/solver/window-route.ts';

type Job = WindowJob & {
  output: string;
  collision: string;
  result?: { route?: Route; reason?: string };
};
type Resources = WindowResources<WindowRequest, Job>;
const groundPath = 'fixture';
const surfaces: Surface[] = [
  {
    id: 'floor',
    vertices: [
      [0, 0, -1],
      [201, 0, -1],
      [201, 0, 1],
      [0, 0, 1],
    ],
  },
];
const resources = (builder: Omit<Resources, 'key' | 'ground' | 'route'>): Resources => ({
  ...builder,
  key: (job) => job.output,
  ground: async () => ({
    surfaces,
    options: { speed: 5, maxVertical: 0.1, walls: [], profile: { radius: 0.1, height: 1.8 } },
  }),
  route: (job) => job.result ?? {},
});
const request: WindowRequest = {
  scene: 'map02',
  source: { buildGuid: 'b', contentHash: 'c' },
  arrival: { id: 'a', position: [0, 0, 0], cost: 0, state: 'available' },
  target: [200, 0, 0],
  walls: [],
};
const settings: WindowConfig = {
  tileSpan: 256 * 0.15,
  gridSpan: 32,
  maxTiles: 8,
  margin: 4,
  locomotion: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 },
};

test('shared ground preparation supports concurrent queries and target-side validation', async () => {
  let loads = 0;
  const builder = resources({
    query: async () => ({ status: 'ready', output: groundPath, collision: 'collision' }),
    solve: async (ground, local) => {
      const start = local.arrival.position,
        end = local.target;
      const from: [number, number, number] = [start[0] + 1, 0, 0],
        to: [number, number, number] = [end[0] - 1, 0, 0];
      return {
        ...ground,
        result: {
          route: {
            status: 'complete',
            start: local.arrival.id,
            arrivalCost: 0,
            cost: 102,
            length: end[0] - start[0],
            points: [start, from, to, end],
            segments: [
              { mode: 'walk', points: [start, from], times: [0, 1] },
              { mode: 'launch', points: [from, to], times: [0, 100], connection: 'launcher' },
              { mode: 'walk', points: [to, end], times: [0, 1] },
            ],
          },
        },
      };
    },
  });
  const load = builder.ground;
  builder.ground = async (job) => {
    loads++;
    return load(job);
  };
  const cache = createWindowGroundCache();
  const search = (x: number) =>
    createWindowRoute(
      builder,
      { ...request, target: [x, 0, 0] },
      [
        [0, 0, 0],
        [x, 0, 0],
      ],
      settings,
      cache,
    );
  const finish = async (window: ReturnType<typeof search>) => {
    let result = await window.advance();
    for (let attempt = 0; attempt < 12 && result.status === 'pending'; attempt++)
      result = await window.advance();
    assert.equal(result.status, 'complete');
    if (result.status === 'complete') {
      assert.ok(result.route.segments.every((segment) => segment.mode === 'walk'));
      assert.ok(Math.abs(result.route.cost - result.route.length / 5) < 1e-8);
    }
    return result;
  };
  await Promise.all([finish(search(20)), finish(search(30))]);
  const tail = search(40);
  let result = await tail.advanceTail();
  for (let attempt = 0; attempt < 12 && result.status === 'pending'; attempt++)
    result = await tail.advanceTail();
  assert.equal(result.status, 'partial');
  await finish(tail);
  assert.equal(loads, 1);
});

test('windows retain true exits, enforce tile budget and retime the whole trajectory', async () => {
  const starts: number[][] = [];
  const builder: Omit<Resources, 'key' | 'ground' | 'route'> = {
    query: async (_scene, _source, _start, _target, options) => {
      assert.ok(options.corridor.tiles.length <= 8);
      return { status: 'ready', message: '', output: groundPath, collision: 'collision' };
    },
    solve: async (_ground, local) => {
      starts.push(local.arrival.position);
      const exit = [...local.target] as [number, number, number];
      if (exit[0] !== 200) exit[0] -= 0.1;
      return {
        status: 'ready',
        message: '',
        output: 'route',
        collision: 'collision',
        result: {
          route: {
            status: 'complete',
            start: 'a',
            arrivalCost: 0,
            cost: 1,
            length: exit[0] - local.arrival.position[0],
            points: [local.arrival.position, exit],
            segments: [{ mode: 'walk', points: [local.arrival.position, exit], times: [0, 1] }],
          },
        },
      };
    },
  };
  const search = createWindowRoute(
    resources(builder),
    request,
    [
      [40, 0, 0],
      [80, 0, 0],
      [120, 0, 0],
      [160, 0, 0],
      [200, 0, 0],
    ],
    settings,
  );
  let result = await search.advance();
  for (let i = 0; i < 20 && result.status === 'pending'; i++) result = await search.advance();
  assert.equal(result.status, 'complete');
  assert.ok(starts.length > 1);
  assert.ok(Math.abs((starts[1][0] % 40) - 39.9) < 1e-8);
  if (result.status === 'complete') assert.ok(Math.abs(result.route.cost - 40) < 1e-8);
});
test('target-side validation publishes only a partial route without validating the prefix', async () => {
  const starts: number[] = [];
  const builder: Omit<Resources, 'key' | 'ground' | 'route'> = {
    query: async () => ({
      status: 'ready',
      message: '',
      output: groundPath,
      collision: 'collision',
    }),
    solve: async (_ground, local) => {
      starts.push(local.arrival.position[0]);
      return {
        status: 'ready',
        message: '',
        output: 'route',
        collision: 'collision',
        result: {
          route: {
            status: 'complete',
            start: local.arrival.id,
            arrivalCost: 0,
            cost: 1,
            length: local.target[0] - local.arrival.position[0],
            points: [local.arrival.position, local.target],
            segments: [
              { mode: 'walk', points: [local.arrival.position, local.target], times: [0, 1] },
            ],
          },
        },
      };
    },
  };
  const search = createWindowRoute(
    resources(builder),
    request,
    [
      [40, 0, 0],
      [80, 0, 0],
      [120, 0, 0],
      [160, 0, 0],
      [200, 0, 0],
    ],
    settings,
  );
  let result = await search.advanceTail();
  for (let i = 0; i < 10 && result.status === 'pending'; i++) result = await search.advanceTail();
  assert.equal(result.status, 'partial');
  assert.ok(starts[0] > 0);
  const prefix = await search.advance({ maxWindows: 0 });
  assert.equal(prefix.status, 'incomplete');
  if (prefix.status === 'incomplete') assert.equal(prefix.completedWindows, 0);
});

test('sparse straight ground guides split into bounded windows without depending on polygon density', async () => {
  const targets: number[] = [];
  const builder: Omit<Resources, 'key' | 'ground' | 'route'> = {
    query: async (_scene, _source, _start, _target, options) => {
      assert.ok(options.corridor.tiles.length <= 8);
      return { status: 'ready', message: '', output: groundPath, collision: 'c' };
    },
    solve: async (_ground, local) => {
      targets.push(local.target[0]);
      return {
        status: 'ready',
        message: '',
        output: 'r',
        collision: 'c',
        result: {
          route: {
            status: 'complete',
            start: local.arrival.id,
            arrivalCost: 0,
            cost: 1,
            length: Math.abs(local.target[0] - local.arrival.position[0]),
            points: [local.arrival.position, local.target],
            segments: [
              { mode: 'walk', points: [local.arrival.position, local.target], times: [0, 1] },
            ],
          },
        },
      };
    },
  };
  const search = createWindowRoute(
    resources(builder),
    request,
    [
      [0, 0, 0],
      [200, 0, 0],
    ],
    settings,
  );
  let result = await search.advance();
  for (let i = 0; i < 20 && result.status === 'pending'; i++) result = await search.advance();
  assert.equal(result.status, 'complete');
  assert.ok(targets.some((x) => x > 0 && x < 200));
  assert.equal(targets.at(-1), 200);
});

test('unknown airborne transfers cannot become invented grounded intermediate destinations', async () => {
  const builder: Omit<Resources, 'key' | 'ground' | 'route'> = {
    query: async () => {
      throw new Error('An oversized action must not be grounded halfway');
    },
    solve: async () => null,
  };
  const trajectory: [number, number, number][] = [
    [0, 0, 0],
    [200, 0, 0],
  ];
  const search = createWindowRoute(resources(builder), request, trajectory, {
    ...settings,
    transfers: [trajectory],
  });
  const result = await search.advance();
  assert.equal(result.status, 'incomplete');
  if (result.status === 'incomplete') assert.equal(result.reason, 'coverage-budget');
});

for (const phase of ['disabled', 'frozen'] as const)
  test(`walking replaces a device excursion across two windows with catalog ${phase}`, async (t) => {
    setActionCatalogPhase(phase);
    t.after(() => setActionCatalogPhase('disabled'));
    const builder: Omit<Resources, 'key' | 'ground' | 'route'> = {
      query: async () => ({
        status: 'ready',
        message: '',
        output: groundPath,
        collision: 'collision',
      }),
      solve: async (_ground, local, _start, stage) => {
        if (stage.step === 0)
          return {
            status: 'ready',
            message: '',
            output: 'r',
            collision: 'c',
            result: { reason: 'no-verified-route' },
          };
        const start = local.arrival.position,
          exit = local.target;
        const a = [start[0] + 1, start[1], 0] as [number, number, number];
        const b = [exit[0] - 1, exit[1], 0] as [number, number, number];
        return {
          status: 'ready',
          message: '',
          output: 'r',
          collision: 'c',
          result: {
            route: {
              status: 'complete',
              start: local.arrival.id,
              arrivalCost: 0,
              cost: 102,
              length: 120,
              points: [start, a, b, exit],
              segments: [
                { mode: 'walk', points: [start, a], times: [0, 1] },
                { mode: 'launch', points: [a, b], times: [0, 100], connection: 'launcher' },
                { mode: 'walk', points: [b, exit], times: [0, 1] },
              ],
            },
          },
        };
      },
    };
    const search = createWindowRoute(
      resources(builder),
      { ...request, target: [120, 0, 0] },
      [
        [80, 5, 0],
        [120, 0, 0],
      ],
      { ...settings, maxTiles: 8 },
    );
    let result = await search.advance();
    for (let i = 0; i < 12 && result.status === 'pending'; i++) result = await search.advance();
    assert.equal(result.status, 'complete');
    if (result.status === 'complete') {
      assert.equal(result.evidence.length, 2);
      assert.deepEqual(result.route.points[0], [0, 0, 0]);
      assert.deepEqual(result.route.points.at(-1), [120, 0, 0]);
      const evidence = result.evidence as { detours?: { replacements: number } }[];
      if (phase === 'frozen') assert.equal(evidence[0].detours, undefined);
      else assert.ok(evidence[0].detours);
      assert.ok(evidence[1].detours!.replacements > 0);
      assert.ok(result.route.segments.every((s) => s.mode === 'walk'));
      assert.ok(Math.abs(result.route.cost - 24) < 1e-8);
    }
  });

const floor = (id: string, from: number, to: number, height = 0): Surface => ({
  id,
  vertices: [
    [from, height, -1],
    [to, height, -1],
    [to, height, 1],
    [from, height, 1],
  ],
});

for (const scenario of [
  {
    name: 'a replacement mesh projects onto its own floor',
    surfaces: [floor('raised', 0, 201, 1)],
    height: 1,
    interaction: undefined,
  },
  {
    name: 'a replacement mesh cannot prune a transfer across its gap',
    surfaces: [floor('left', 0, 90), floor('right', 100, 201)],
    height: 0,
    interaction: undefined,
  },
  {
    name: 'a final interaction cannot reuse an earlier window mesh for pruning',
    surfaces: [floor('left', 0, 90), floor('right', 100, 201)],
    height: 0,
    interaction: { radius: 1 },
  },
]) {
  test(scenario.name, async () => {
    const builder = resources({
      query: async (_scene, _source, start) => ({
        status: 'ready',
        output: start[0] === 0 ? 'first' : 'second',
        collision: 'collision',
      }),
      solve: async (ground, local, _start, work) => {
        if (work.step === 0) return { ...ground, result: { reason: 'requires-launch' } };
        const start = local.arrival.position,
          exit = local.target;
        const from: [number, number, number] = [start[0] + 1, start[1], 0];
        const to: [number, number, number] = [exit[0] - 1, exit[1], 0];
        return {
          ...ground,
          result: {
            route: {
              status: 'complete',
              start: local.arrival.id,
              arrivalCost: 0,
              cost: 102,
              length: 120,
              points: [start, from, to, exit],
              segments: [
                { mode: 'walk', points: [start, from], times: [0, 1] },
                { mode: 'launch', points: [from, to], times: [0, 100], connection: 'launcher' },
                { mode: 'walk', points: [to, exit], times: [0, 1] },
              ],
              ...(local.interaction ? { goalHit: { segment: 2, time: 1, position: exit } } : {}),
            },
          },
        };
      },
    });
    builder.ground = async (job) => ({
      surfaces: job.output === 'first' ? surfaces : scenario.surfaces,
      options: { speed: 5, maxVertical: 0.1, walls: [], profile: { radius: 0.1, height: 1.8 } },
    });
    const search = createWindowRoute(
      builder,
      { ...request, target: [120, 0, 0], interaction: scenario.interaction },
      [
        [80, 0, 0],
        [120, 0, 0],
      ],
      settings,
    );
    let result = await search.advance();
    for (let attempt = 0; attempt < 12 && result.status === 'pending'; attempt++)
      result = await search.advance();
    assert.equal(result.status, 'complete');
    if (result.status === 'complete') {
      assert.equal(result.evidence.length, 2);
      assert.deepEqual(result.route.points.at(-1), [120, scenario.height, 0]);
      assert.ok(result.route.segments.some((segment) => segment.mode === 'launch'));
      assert.ok(result.route.cost > 24);
      if (scenario.interaction) assert.deepEqual(result.route.goalHit?.position, [120, 0, 0]);
    }
  });
}
