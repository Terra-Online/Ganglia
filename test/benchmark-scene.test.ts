import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Corridor, WindowRequest } from '@opendfieldmap/ganglia/solver';

import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import { loadSceneData } from '#@/bench/scene-data.ts';
import { prepareSceneResources, type GameAdapter } from '#@/bench/scene.ts';

const source = { buildGuid: 'build', contentHash: 'content' };
const profile = { radius: 0.35, height: 1.8 };
const bounds = { min: [0, 0], max: [96, 64] };
const tiles = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 2, z: 0 },
];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-'));
  const json = async (file: string, value: unknown) => {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), JSON.stringify(value));
  };
  const snapshot = { scene: 'testscene', source, selection: { area: 0, sceneState: 0 } };
  const ground = (selected = tiles) => ({
    ...snapshot,
    surfaces: [],
    options: { profile, speed: 5, maxVertical: 0.5 },
    build: { bounds, cellSize: 0.15, tileCells: 256 },
    tiles: selected,
  });
  await json('routing/testscene-ground-all.json', ground());
  await json('routing/movement-settings-current.json', {
    source,
    defaultProfile: profile,
    sustainedSprint: { speed: 5 },
  });
  const region = async (prefix: string, selected = tiles) => {
    await json(`${prefix}.ground.json`, ground(selected));
    await json(`${prefix}.collision.json`, {
      ...snapshot,
      options: { profile, bounds, tiles: selected },
    });
  };
  return { root, json, region, ground, snapshot };
};
const approach = (
  selected = tiles,
): { startBuild: boolean; margin: number; corridor: Corridor } => ({
  startBuild: true,
  margin: 24,
  corridor: {
    kind: 'corridor-proposal',
    bounds: { min: [1, 1], max: [90, 30] },
    tiles: selected,
    coarse: { regions: 1, edges: 0, path: [], halo: 0 },
  },
});
const request: WindowRequest & { source: typeof source } = {
  scene: 'testscene',
  source,
  arrival: { id: 'start', state: 'available', position: [1, 0, 1], cost: 0 },
  target: [90, 0, 30],
  walls: [],
};

test('scene regions reject tile holes, bind each job independently and solve freshly from preloaded data', async () => {
  const f = await fixture();
  try {
    await f.region('scene-testscene/regions/a-sparse', [tiles[0], tiles[2]]);
    await f.region('scene-testscene/regions/b-full');
    const data = await loadSceneData(f.root, 'testscene');
    let preparations = 0,
      solves = 0;
    const generations: string[] = [];
    const prepare: GameAdapter['preparePhysicalRoute'] = async (files, _request, { cache }) => {
      preparations++;
      const lane = cache as {
        begin(files: unknown): Promise<string>;
        read(slot: string, path: string): Promise<unknown>;
      };
      generations.push(await lane.begin(files));
      assert.equal(await lane.read('ground', files.ground), data.inputs.get(files.ground));
      return {
        solve: async () => {
          solves++;
          return {
            route: {
              status: 'complete',
              start: 'start',
              arrivalCost: 0,
              cost: solves,
              length: 1,
              points: [
                [1, 0, 1],
                [90, 0, 30],
              ],
              segments: [],
            },
            reason: `fresh-${solves}`,
          };
        },
      };
    };
    const { resources } = prepareSceneResources(data, prepare, 1, 'adapter');
    // Neither queries nor adapter reads may fall back to the filesystem after setup.
    await rm(f.root, { recursive: true, force: true });
    const sparse = await resources.query(
      'testscene',
      source,
      [1, 0, 1],
      request.target,
      approach([tiles[0]]),
    );
    const full = await resources.query('testscene', source, [1, 0, 1], request.target, approach());
    assert.ok(sparse && full);
    assert.match(resources.key(sparse), /a-sparse/);
    assert.match(resources.key(full), /b-full/);
    assert.notEqual(resources.physicalRevision?.(sparse), resources.physicalRevision?.(full));
    assert.equal(await resources.ground(sparse), data.regions[0].ground);
    assert.equal(await resources.ground(full), data.regions[1].ground);
    const first = await resources.solve(sparse, request, true, { version: 1, step: 2 });
    await resources.solve(full, request, true, { version: 1, step: 2 });
    const repeated = await resources.solve(sparse, request, true, { version: 1, step: 2 });
    assert.ok(first && repeated);
    assert.equal(preparations, 3);
    assert.equal(solves, 3);
    assert.notEqual(resources.route(first).reason, resources.route(repeated).reason);
    assert.equal(generations[0], generations[2]);
    assert.notEqual(generations[0], generations[1]);
    await assert.rejects(
      resources.query('testscene', source, [1, 0, 1], request.target, approach([{ x: 1, z: 1 }])),
      /Missing physical coverage/,
    );
    await resources.close?.();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('legacy single-window files retain coverage and reject rounded bounds outside the dataset', async () => {
  const f = await fixture();
  try {
    await f.json('scene-testscene/ground.json', f.ground());
    await f.json('scene-testscene/collision.json', { ...f.snapshot, options: { profile, bounds } });
    const data = await loadSceneData(f.root, 'testscene');
    assert.equal(data.regions.length, 1);
    assert.ok(data.select([1, 0, 1], request.target, approach()));
    const outside = approach();
    outside.corridor.bounds.max[0] = 97;
    assert.equal(data.select([1, 0, 1], request.target, outside), undefined);
    await f.json('scene-testscene/collision.json', {
      ...f.snapshot,
      source: { ...source, contentHash: 'other' },
      options: { profile, bounds },
    });
    await assert.rejects(loadSceneData(f.root, 'testscene'), /snapshot mismatch/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('only preparation can export missing regions, which are decoded once and reused as input snapshots', async () => {
  const f = await fixture();
  try {
    const extractor = join(f.root, 'extractor');
    const config = join(f.root, 'exporter-config.json');
    const devices = join(f.root, 'routing/testscene-traversal-devices.json');
    await f.json('exporter-config.json', {});
    await f.json('routing/testscene-traversal-devices.json', {});
    const script = join(extractor, 'packages/extractor/src/cli.ts');
    await mkdir(join(script, '..'), { recursive: true });
    await writeFile(
      script,
      `
      import assert from 'node:assert/strict';
      import { writeFile } from 'node:fs/promises';
      const args = process.argv.slice(2);
      const value = name => args[args.indexOf(name) + 1];
      assert.equal(args[0], 'player-ground');
      assert.equal(args[1], 'testscene');
      assert.ok(args.includes('--terminal-scene'));
      assert.equal(value('--scene-state'), '0');
      assert.equal(value('--area'), '0');
      assert.equal(value('--static-supports'), ${JSON.stringify(devices)});
      assert.equal(value('--config'), ${JSON.stringify(config)});
      const tiles = value('--tiles').split(';').map(tile => {
        const [x,z] = tile.split(',').map(Number); return { x,z };
      });
      assert.deepEqual(tiles, ${JSON.stringify(tiles)});
      await writeFile(value('--output'), JSON.stringify(${JSON.stringify(f.ground())}));
      await writeFile(value('--collision-output'), JSON.stringify(${JSON.stringify({ ...f.snapshot, options: { profile, bounds, tiles } })}));
    `,
    );
    let builds = 0;
    const data = await loadSceneData(f.root, 'testscene', async (request) => {
      builds++;
      return exportPhysicalRegion({ dataRoot: f.root, extractor, config, devices }, request);
    });
    const noBuild = { ...approach(), startBuild: false };
    assert.equal(await data.query([1, 0, 1], request.target, noBuild), undefined);
    assert.equal(builds, 0);
    const region = await data.query([1, 0, 1], request.target, approach());
    assert.ok(region);
    assert.equal(data.regions.length, 1);
    assert.ok(data.hashes[region.files.ground]);
    assert.ok(data.hashes[region.files.collision]);
    assert.equal(await data.query([1, 0, 1], request.target, approach()), region);
    assert.equal(builds, 1);
    const reloaded = await loadSceneData(f.root, 'testscene');
    assert.ok(reloaded.select([1, 0, 1], request.target, approach()));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
