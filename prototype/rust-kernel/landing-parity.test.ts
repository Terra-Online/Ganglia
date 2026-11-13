import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createRustLandingEnumeration } from '#@/prototype/rust-kernel/landing-binding.ts';
import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { boundsRoot, createBoundsIndex, type Bounds } from '#@/src/v1/geo/bounds.ts';
import { createJumpEnvelope } from '#@/src/v1/reach/reachability.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import {
  installLandingEnumerationPrototype,
  type LandingNearestQuery,
} from '#@/src/v1/search/landing-enumeration.ts';
import {
  findJumpFrontier,
  findJumpShortcuts,
  type ShortcutCache,
  type ShortcutOptions,
} from '#@/src/v1/search/shortcuts.ts';

const model: JumpModel = {
  gravity: 10,
  fallingGravity: 13,
  maxJumpHeight: 2,
  maxFallingSpeed: 12,
  apexTime: 0.2,
  maxHorizontalSpeed: 6.5,
};
// Oracle is the current nearest callback, including its original subtraction and
// left-associated cost additions. Witness generation remains outside this seam.
const predicate = (query: LandingNearestQuery) => {
  const envelope = createJumpEnvelope(query.anchor, query.envelope);
  const cost = query.cost;
  if (!cost) return envelope;
  return (box: Bounds) => {
    const dx = Math.max(
      box.min[0] - cost.inset - query.anchor[0],
      0,
      query.anchor[0] - box.max[0] - cost.inset,
    );
    const dz = Math.max(
      box.min[2] - cost.inset - query.anchor[2],
      0,
      query.anchor[2] - box.max[2] - cost.inset,
    );
    const gx = Math.max(
      box.min[0] - cost.inset - cost.goal[0],
      0,
      cost.goal[0] - box.max[0] - cost.inset,
    );
    const gz = Math.max(
      box.min[2] - cost.inset - cost.goal[2],
      0,
      cost.goal[2] - box.max[2] - cost.inset,
    );
    return (
      cost.approachTime +
        Math.max(0, Math.hypot(dx, dz) - 2 * cost.radius) / cost.airSpeed +
        Math.max(0, Math.hypot(gx, gz) - cost.radius) / cost.boundSpeed <=
        cost.limit + 1e-9 && envelope(box)
    );
  };
};

test('landing batches preserve filtered hierarchy ties, pruning and every paused prefix', () => {
  let seed = 0x71de49a;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const factories = [1, 4, 7, 32].map(createRustLandingEnumeration);
  let total = 0;
  for (let trial = 0; trial < 60; trial++) {
    const base = [0, 1e7, 1e18][trial % 3];
    const entries = Array.from({ length: 97 }, (_, id) => {
      const x = base + (id % 4 ? Math.floor(random() * 40 - 20) : 0);
      const y = base + Math.floor(random() * 60 - 40);
      const z = -base + (id % 4 ? Math.floor(random() * 40 - 20) : 0);
      return { id, group: id % 7, min: [x, y, z], max: [x + (id % 3), y + (id % 2), z + (id % 5)] };
    });
    const full = createBoundsIndex(entries, (entry) => entry.group);
    const view =
      trial % 4 === 0
        ? full.filter((entry) => entry.id < 2)
        : full.filterGroups((group) => group !== trial % 7 && group !== (trial + 1) % 7);
    const query: LandingNearestQuery = {
      bounds: {
        min: [base - 1000, base - 1000, -base - 1000],
        max: [base + 1000, base + 1000, -base + 1000],
      },
      target: [base, base - (trial % 4) * 0.25, -base],
      anchor: [base, base, -base],
      envelope: {
        model: {
          ...model,
          maxJumpHeight: trial % 5 ? 2 : 0,
          ...(trial % 2 ? { startHorizontalSpeed: 9, airOverspeedDeceleration: 1.7 } : {}),
        },
        maxDrop: trial % 6 === 0 ? 2000 : 80,
        maxHorizontalDistance: 200,
        endpointTolerance: trial % 2 ? 0.25 : 0,
        padding: trial % 3 ? [0.15, 0.5, 0.15] : [0, 0, 0],
      },
      ...(trial % 2
        ? {
            cost: {
              approachTime: 0.125,
              inset: 0.15,
              radius: 0.3,
              airSpeed: 6.5,
              boundSpeed: 9,
              goal: [base + 15, base - 5, -base],
              limit: trial % 4 ? 20 : 2,
            },
          }
        : {}),
    };
    const expected = [...view.nearest(query.bounds, query.target, predicate(query))];
    const beforeMutation = factories[1](boundsRoot(view)!, query);
    const paused = factories[0](boundsRoot(view)!, query);
    const pausedFirst = paused.next();
    total += expected.length;
    for (const factory of factories) {
      const actual = factory(boundsRoot(view)!, query);
      const prefix = [];
      for (const entry of expected) {
        const next = actual.next();
        assert.equal(next.done, false);
        assert.strictEqual(next.value, entry, `trial=${trial} prefix=${prefix.length}`);
        prefix.push(next.value);
      }
      assert.equal(actual.next().done, true);
      assert.deepEqual(prefix, expected);
      const cancelled = factory(boundsRoot(view)!, query);
      cancelled.next();
      cancelled.return(undefined);
      assert.equal(cancelled.next().done, true);
    }
    // A changed model on the same view replaces its reach snapshot without
    // changing an already-created cursor's immutable model or buffered entries.
    query.envelope.model.maxJumpHeight = 1;
    assert.deepEqual(
      [...beforeMutation],
      expected,
      'an unstarted stream retains its original flight snapshot',
    );
    const changed = [...view.nearest(query.bounds, query.target, predicate(query))];
    assert.deepEqual([...factories[1](boundsRoot(view)!, query)], changed);
    if (expected.length) {
      assert.strictEqual(pausedFirst.value, expected[0]);
      assert.deepEqual(
        [...paused],
        expected.slice(1),
        'a paused cursor retains its old flight owner',
      );
    } else assert.equal(pausedFirst.done, true);
  }
  assert.ok(total > 300, 'fixture must exercise actual emitted candidates');
});

test('landing enumeration retains tangencies, analytic reach fallback and overflowing heap costs', () => {
  for (const base of [-0, 1e18, 1e155]) {
    const entries = Array.from({ length: 24 }, (_, id) => ({
      id,
      min: [base + id, 0, id % 2 ? base : -base],
      max: [base + id, 0, id % 2 ? base : -base],
    }));
    const index = createBoundsIndex(entries);
    const query: LandingNearestQuery = {
      bounds: { min: [-1e200, -1e200, -1e200], max: [1e200, 1e200, 1e200] },
      target: [-base, -0, base],
      anchor: [base, 0, base],
      envelope: { model, maxDrop: 2000, maxHorizontalDistance: 1e200, endpointTolerance: 0.25 },
    };
    const expected = [...index.nearest(query.bounds, query.target, predicate(query))];
    assert.deepEqual([...createRustLandingEnumeration(3)(boundsRoot(index)!, query)], expected);
  }
});

const floor = (id: string, x0: number, x1: number, y: number, z0: number, z1: number): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const collisionGeometry = (surfaces: Surface[]) => {
  const triangles = surfaces.flatMap((surface) => [
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]],
  ]);
  return {
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  };
};
const settings = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 7,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 12,
  maxLinks: 8,
  model,
};

test('native landing batches preserve complete frontier resume, action revisions and shortcut diagnostics', () => {
  const surfaces = [
    floor('start', 0, 4, 4, -2, 2),
    floor('middle', 7, 11, 2, -2, 2),
    floor('goal', 14, 18, 0, -2, 2),
  ];
  const world = createCollisionWorld(collisionGeometry(surfaces));
  const previous = installLandingEnumerationPrototype();
  try {
    for (const reverse of [false, true]) {
      const jsCache: ShortcutCache = {},
        nativeCache: ShortcutCache = {};
      let existing: NonNullable<ShortcutOptions['connections']> = [];
      for (const [step, budget] of [4, 16, 48, 48].entries()) {
        const query: ShortcutOptions = {
          ...settings,
          from: [2, 4, 0],
          to: [16, 0, 0],
          maxCandidates: budget,
          connections: existing,
          ...(step === 3 ? { to: [16, 0, 1], costBound: 10, boundGoal: [16, 0, 1] as Vec3 } : {}),
        };
        installLandingEnumerationPrototype(undefined);
        const expected = findJumpFrontier(surfaces, world, query, jsCache, reverse);
        installLandingEnumerationPrototype(createRustLandingEnumeration(7));
        const actual = findJumpFrontier(surfaces, world, query, nativeCache, reverse);
        assert.deepEqual(actual, expected, `reverse=${reverse} step=${step}`);
        if (step === 1) existing = expected.connections;
      }
    }
    const ramped = [
      floor('upper', 0, 4, 4, -2, 2),
      {
        id: 'ramp',
        vertices: [
          [0, 4, 2],
          [4, 4, 2],
          [4, 0, 20],
          [0, 0, 20],
        ] as Vec3[],
      },
      floor('back', 0, 15, 0, 20, 24),
      floor('lower', 7, 15, 0, -2, 20),
    ];
    const planner = createGroundPlanner(ramped, settings);
    const from: Vec3 = [2, 4, 0],
      to: Vec3 = [10, 0, 0];
    const baseline = planner.plan(
      [{ id: 'start', position: from, cost: 0, state: 'available' }],
      to,
    );
    assert.equal(baseline.status, 'complete');
    if (baseline.status !== 'complete') return;
    const query = {
      ...settings,
      from,
      to,
      baseline,
      maxCandidates: 80,
      costBound: baseline.cost,
      boundGoal: to,
    };
    const rampWorld = createCollisionWorld(collisionGeometry(ramped));
    installLandingEnumerationPrototype(undefined);
    const expected = findJumpShortcuts(ramped, rampWorld, query, {});
    assert.ok(expected.diagnostics.neighbourChecks > 0);
    for (const size of [1, 7, 32]) {
      installLandingEnumerationPrototype(createRustLandingEnumeration(size));
      assert.deepEqual(findJumpShortcuts(ramped, rampWorld, query, {}), expected);
    }
  } finally {
    installLandingEnumerationPrototype(previous);
  }
});

test('opt-in landing counters distinguish encoded trees, reused views and discarded prefetch by phase', () => {
  const cache = resolve('.local/cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(resolve(cache, 'landing-diagnostics-test-'));
  const output = resolve(directory, 'counts.json');
  const binding = new URL('./landing-binding.ts', import.meta.url).href;
  const bounds = new URL('../../src/v1/geo/bounds.ts', import.meta.url).href;
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { createRustLandingEnumeration } from ${JSON.stringify(binding)};
      import { createBoundsIndex, boundsRoot } from ${JSON.stringify(bounds)};
      const entries = Array.from({length:8},(_,id)=>({id,min:[0,0,0],max:[0,0,0]}));
      const index = createBoundsIndex(entries), root = boundsRoot(index);
      const query = { bounds:{min:[-10,-10,-10],max:[10,10,10]},target:[0,0,0],anchor:[0,0,0],
        envelope:{model:${JSON.stringify(model)},maxDrop:10,maxHorizontalDistance:10,endpointTolerance:0.25}};
      const factory = createRustLandingEnumeration(4);
      console.error(JSON.stringify({phase:'catalog-training',queries:1}));
      const first = factory(root,query);first.next();first.return();
      console.error(JSON.stringify({phase:'prewarm',queries:1}));
      const freshModel = {...query,envelope:{...query.envelope,model:{...query.envelope.model,maxJumpHeight:1}}};
      const fresh = factory(root,freshModel);fresh.next();fresh.return();
      console.error(JSON.stringify({phase:'batch',queries:1}));
      const second = factory(root,query);second.next();second.next();second.return();
    `,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GANGLIA_RUST_LANDING_DIAGNOSTICS: output,
          GANGLIA_RUST_LANDING_BATCH: '4',
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.formalPerformance, false);
    assert.equal(report.batchSize, 4);
    const training = report.phases['catalog-training'],
      prewarm = report.phases.prewarm,
      batch = report.phases.batch;
    assert.equal(training.treesEncoded, 1);
    assert.equal(training.encodedRows, 9);
    assert.equal(training.encodedEntries, 8);
    assert.equal(training.encodedBytes, 9 * 60);
    assert.equal(training.flightOwnersBuilt, 1);
    assert.ok(training.flightOwnerBytes > 0);
    assert.equal(training.idsReturned, 4);
    assert.equal(training.idsYielded, 1);
    assert.equal(training.discardedBuffered, 3);
    assert.equal(training.bufferedAtSnapshot, 0);
    assert.equal(prewarm.treesEncoded, 0);
    assert.equal(prewarm.encodedBytes, 0);
    assert.equal(prewarm.treeCacheHits, 1);
    assert.equal(prewarm.flightOwnersBuilt, 1);
    assert.ok(prewarm.flightOwnerBytes > 0);
    assert.equal(batch.treesEncoded, 0);
    assert.equal(batch.treeCacheHits, 1);
    assert.equal(batch.flightOwnersBuilt, 0);
    assert.equal(batch.flightOwnerBytes, 0);
    assert.equal(batch.batchCalls, 1);
    assert.equal(batch.streamsStarted, 1);
    assert.equal(batch.streamsClosed, 1);
    assert.equal(batch.idsReturned, 4);
    assert.equal(batch.idsYielded, 2);
    assert.equal(batch.discardedBuffered, 2);
    assert.equal(batch.bufferedAtSnapshot, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
