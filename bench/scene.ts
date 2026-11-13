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

import { createTimings } from '#@/bench/timings.ts';
import { actionCatalogStats } from '#@/src/v1/route/action-catalog.ts';

type Source = { buildGuid: string; contentHash: string };
type Ground = {
  scene: string;
  source: Source;
  surfaces: Surface[];
  options: GroundOptions;
  build: { bounds: { min: [number, number]; max: [number, number] } };
};
type Report = {
  status?: 'candidate' | 'unavailable';
  optimizing?: boolean;
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

export const sceneIdentity = (metadata: {
  hashes: Record<string, string>;
  gameAdapterSha256: string;
  kernelSha256: string;
}) => JSON.stringify([metadata.hashes, metadata.gameAdapterSha256, metadata.kernelSha256]);

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
  let processRssSampledPeakBytes = process.memoryUsage().rss;
  let mainHeapUsedSampledPeakBytes = process.memoryUsage().heapUsed;
  const sampleMemory = () => {
    const memory = process.memoryUsage();
    processRssSampledPeakBytes = Math.max(processRssSampledPeakBytes, memory.rss);
    mainHeapUsedSampledPeakBytes = Math.max(mainHeapUsedSampledPeakBytes, memory.heapUsed);
  };
  const preparationStarted = performance.now();
  const binding = JSON.stringify(hashes);
  const physicalBinding = JSON.stringify([hashes, gameAdapterSha256]);
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
  const timings = createTimings(performance.now() - preparationStarted);
  const observe = (report: Report) => {
    timings.physical.calls++;
    const diagnostics = report.diagnostics;
    if (!diagnostics || typeof diagnostics !== 'object') return;
    // Count final physical reports once; provisional candidate emissions share
    // the same mutable diagnostics and would otherwise multiply these totals.
    if (
      'timingMs' in diagnostics &&
      diagnostics.timingMs &&
      typeof diagnostics.timingMs === 'object'
    )
      for (const [stage, milliseconds] of Object.entries(diagnostics.timingMs))
        if (typeof milliseconds === 'number')
          timings.physical.stagesMs[stage] = (timings.physical.stagesMs[stage] ?? 0) + milliseconds;
    if (
      'prepareReuse' in diagnostics &&
      diagnostics.prepareReuse &&
      typeof diagnostics.prepareReuse === 'object'
    )
      for (const [slot, reused] of Object.entries(diagnostics.prepareReuse)) {
        if (typeof reused !== 'boolean') continue;
        const count = (timings.physical.preparation[slot] ??= { hits: 0, misses: 0 });
        if (reused) count.hits++;
        else count.misses++;
      }
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
        observe(result);
        return { status: 'ready', result };
      } finally {
        sampleMemory();
        const next = waiting.shift();
        if (next) next(cache);
        else idle.push(cache);
      }
    },
    key: () => files.ground,
    physicalRevision: () => {
      const bank = actionCatalogStats();
      // Training changes physical evidence. Frozen/disabled banks and all loaded
      // file contents are fixed; include bank changes rather than trusting ground alone.
      return bank.phase === 'training' || concurrency !== 1
        ? undefined
        : JSON.stringify([
            physicalBinding,
            bank.phase,
            bank.added,
            bank.evicted,
            bank.scopeResets,
            bank.scopes,
          ]);
    },
    ground: async () => ground,
    route: (job) => {
      const result = job.result ?? {};
      // The adapter's final unavailable report omits its failed Route. Preserve
      // that explicit outcome without treating empty/provisional jobs as failures.
      return !result.route &&
        result.status === 'unavailable' &&
        result.optimizing === false &&
        result.reason === 'no-verified-route'
        ? { ...result, route: { status: 'no-verified-route' } }
        : result;
    },
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
      execution: {
        mode: 'inline',
        workers: 0,
        lanes: concurrency,
        get memory() {
          sampleMemory();
          return { processRssSampledPeakBytes, mainHeapUsedSampledPeakBytes };
        },
      },
    },
  };
}

export type SceneMetadata = Awaited<ReturnType<typeof loadScene>>['metadata'];
