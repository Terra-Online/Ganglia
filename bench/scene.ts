import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import type { Surface, GroundOptions, Route } from '@opendfieldmap/ganglia';
import {
  type SceneResources,
  type RouteResult,
  type WindowRequest,
} from '@opendfieldmap/ganglia/solver';
import { createPhysicalPreparation, type PhysicalWork } from '@opendfieldmap/ganglia/solver/host';

type Source = { buildGuid: string; contentHash: string };
type Ground = {
  scene: string;
  source: Source;
  surfaces: Surface[];
  options: GroundOptions;
  build: { bounds: { min: [number, number]; max: [number, number] } };
};
type Report = {
  route?: Route;
  reason?: string;
  supportBoxes?: RouteResult['supportBoxes'];
  diagnostics?: unknown;
};
type Job = { status: 'ready'; result?: Report };
// The game adapter owns exporter validation and normalization; no frontend modules are loaded.
type GameAdapter = {
  preparePhysicalRoute(
    resources: { ground: string; collision: string; movement: string; devices?: string },
    request: WindowRequest,
    context: { cache: unknown },
  ): Promise<{ solve(options: { work: PhysicalWork }): Promise<Report> }>;
};

export async function loadScene(dataRoot: string, extractor: string, concurrency: number) {
  const loadingStarted = performance.now();
  const files: { ground: string; collision: string; movement: string; devices?: string } = {
    ground: resolve(dataRoot, 'scene-map02/ground.json'),
    collision: resolve(dataRoot, 'scene-map02/collision.json'),
    movement: resolve(dataRoot, 'routing/movement-settings-current.json'),
    devices: resolve(dataRoot, 'routing/map02-traversal-devices.json'),
  };
  const hashes: Record<string, string> = {};
  const inputs = new Map<string, unknown>();
  let inputBytes = 0;
  const read = async <T>(name: string): Promise<T> => {
    if (inputs.has(name)) return inputs.get(name) as T;
    const bytes = await readFile(name);
    inputBytes += bytes.byteLength;
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    const value: unknown = JSON.parse(bytes.toString());
    inputs.set(name, value);
    return value as T;
  };
  const ground = await read<Ground>(files.ground);
  const navigation = await read<Ground>(resolve(dataRoot, 'routing/map02-ground-all.json'));
  if (ground.scene !== navigation.scene || !isDeepStrictEqual(ground.source, navigation.source))
    throw new Error('Navigation and physics snapshot mismatch');
  // Hash all consumed input bytes, including resources decoded by the game adapter.
  for (const file of [files.collision, files.movement]) await read<unknown>(file);
  if (files.devices) {
    try {
      await read<unknown>(files.devices);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      files.devices = undefined;
    }
  }
  const entry = resolve(extractor, 'packages/extractor/src/game/physical-input.ts');
  const resolvedKernel = createRequire(entry).resolve('@opendfieldmap/ganglia/solver');
  const kernelRoot = resolve(dirname(resolvedKernel), '../..');
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const kernelDigest = async (base: string) => {
    const hash = createHash('sha256');
    for (const name of (await readdir(resolve(base, 'src'), { recursive: true })).sort()) {
      if (name.endsWith('.ts'))
        hash.update(name + '\0').update(await readFile(resolve(base, 'src', name)));
    }
    return hash.digest('hex');
  };
  const kernelSha256 = await kernelDigest(kernelRoot);
  if (kernelSha256 !== (await kernelDigest(sourceRoot)))
    throw new Error(
      'Game adapter resolves a different Ganglia source; refresh its pinned package before benchmarking',
    );
  const { preparePhysicalRoute } = (await import(
    pathToFileURL(resolve(extractor, 'packages/extractor/src/game/physical-input.ts')).href
  )) as GameAdapter;
  const movement = await read<{ sustainedSprint: GroundOptions['locomotion'] }>(files.movement);
  if (!movement.sustainedSprint) throw new Error('Missing locomotion settings');
  const adapterHash = createHash('sha256');
  for (const directory of ['packages/extractor/src', 'packages/formats/src']) {
    for (const name of (await readdir(resolve(extractor, directory), { recursive: true })).sort()) {
      if (name.endsWith('.ts'))
        adapterHash
          .update(`${directory}/${name}\0`)
          .update(await readFile(resolve(extractor, directory, name)));
    }
  }
  const gameAdapterSha256 = adapterHash.digest('hex');
  const locomotion = movement.sustainedSprint;
  const inputLoadMs = performance.now() - loadingStarted;
  const preparationStarted = performance.now();
  const binding = JSON.stringify(hashes);
  // Lane-local caches keep mutable preparation isolated across concurrent solves.
  // Timed input reads are served from the preloaded snapshot.
  const caches = Array.from({ length: concurrency }, () => {
    const preparation = createPhysicalPreparation();
    return {
      begin: async () => binding,
      read: async (_slot: string, path: string) => inputs.get(path),
      preparation,
      clear: preparation.clear,
    };
  });
  const idle = [...caches];
  const waiting: ((cache: (typeof caches)[number]) => void)[] = [];
  const acquire = () => {
    const cache = idle.pop();
    return cache
      ? Promise.resolve(cache)
      : new Promise<(typeof caches)[number]>((resolve) => waiting.push(resolve));
  };
  const timings = {
    preparationMs: performance.now() - preparationStarted,
    normalizationMs: 0,
    localSolveMs: 0,
  };
  const resources: SceneResources<Source, Job> = {
    query: async (_scene, _source, _start, _target, options) => {
      const bounds = options.corridor.bounds;
      if (
        [0, 1].some(
          (axis) =>
            bounds.min[axis] < ground.build.bounds.min[axis] ||
            bounds.max[axis] > ground.build.bounds.max[axis],
        )
      )
        throw new Error(
          `Missing physical coverage ${JSON.stringify(bounds)}; dataset ${JSON.stringify(ground.build.bounds)}`,
        );
      return { status: 'ready' };
    },
    solve: async (_job, request, _start, work) => {
      const cache = await acquire();
      try {
        let started = performance.now();
        const prepared = await preparePhysicalRoute(files, request, { cache });
        timings.normalizationMs += performance.now() - started;
        started = performance.now();
        const result = await prepared.solve({ work });
        timings.localSolveMs += performance.now() - started;
        return { status: 'ready', result };
      } finally {
        const next = waiting.shift();
        if (next) next(cache);
        else idle.push(cache);
      }
    },
    key: () => files.ground,
    ground: async () => ground,
    route: (job) => job.result ?? {},
    wait: async () => {},
    close: async () => {
      for (const cache of caches) cache.clear();
    },
  };
  return {
    input: {
      kind: 'scene' as const,
      scene: { scene: ground.scene, source: ground.source, walls: [], navigation },
      resources,
      locomotion,
    },
    inputLoadMs,
    timings,
    metadata: {
      scene: ground.scene,
      source: ground.source,
      hashes,
      gameAdapterSha256,
      kernelSha256,
      resolvedKernel,
      inputBytes,
    },
  };
}
