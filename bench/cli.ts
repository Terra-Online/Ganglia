import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { prepareRouteSolver, gangliaV1Defaults, type SolverConfig } from '@opendfieldmap/ganglia';

import { benchmarkMarkdown } from '#@/bench/markdown.ts';
import { compareQuality, readReference } from '#@/bench/quality.ts';
import { runBenchmark } from '#@/bench/run.ts';
import { loadScene } from '#@/bench/scene.ts';
import { cases } from '#@/bench/scenes/map02.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    markdown: { type: 'boolean' },
    help: { type: 'boolean' },
    'data-root': { type: 'string', default: resolve(root, '.local/data') },
    extractor: { type: 'string', default: resolve(root, '.local/repos/Atlos/talos/.cache/noclip') },
    concurrency: { type: 'string' },
    workers: { type: 'string', default: '1' },
    config: { type: 'string' },
    reference: { type: 'string' },
    limit: { type: 'string' },
    offset: { type: 'string', default: '0' },
    workload: { type: 'string' },
  },
});
if (values.help)
  console.log(
    'Usage: pnpm benchmark:full [--json | --markdown] [--data-root <path>] [--extractor <path>] [--workload <query-cases.json>] [--offset <index>] [--limit <count>] [--concurrency <scene-lanes>] [--workers <scene-workers; 1=inline>] [--config <json-file>] [--reference <benchmark-json>]',
  );
else {
  try {
    if (values.json && values.markdown) throw new Error('Choose --json or --markdown');
    const workload: typeof cases = values.workload
      ? JSON.parse(await readFile(values.workload, 'utf8'))
      : cases;
    const offset = Number(values.offset),
      count = Number(values.limit ?? workload.length);
    if (
      !Array.isArray(workload) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      offset + count > workload.length
    )
      throw new Error('Invalid workload, offset or query limit');
    const selected = workload.slice(offset, offset + count);
    if (new Set(selected.map((item) => item.id)).size !== selected.length)
      throw new Error('Duplicate workload query id');
    const config: SolverConfig = values.config
      ? JSON.parse(await readFile(values.config, 'utf8'))
      : { ...gangliaV1Defaults };
    const workers = Number(values.workers);
    if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('Invalid worker count');
    const concurrency =
      values.concurrency === undefined
        ? values.config
          ? config.batchConcurrency
          : Math.max(config.batchConcurrency, workers)
        : Number(values.concurrency);
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
      throw new Error('Invalid concurrency');
    const fixed = { ...config, batchConcurrency: concurrency };
    const started = performance.now();
    let prepared;
    if (workers > 1) {
      prepared = await prepareWorkerSolver({
        count: workers,
        config: fixed,
        dataRoot: values['data-root'],
        extractor: values.extractor,
      });
    } else {
      const scene = await loadScene(values['data-root'], values.extractor, concurrency);
      try {
        prepared = {
          solver: await prepareRouteSolver(fixed, scene.input),
          inputLoadMs: scene.inputLoadMs,
          timings: scene.timings,
          metadata: scene.metadata,
        };
      } catch (error) {
        await scene.input.resources.close?.();
        throw error;
      }
    }
    const { solver, inputLoadMs, timings, metadata } = prepared;
    try {
      const referenceBytes = values.reference ? await readFile(values.reference) : undefined;
      const referenceReport: { batch: { wallMs: number } } | undefined = referenceBytes
        ? JSON.parse(referenceBytes.toString())
        : undefined;
      const reference = referenceBytes
        ? readReference(JSON.parse(referenceBytes.toString()), { ...metadata, cases: selected })
        : undefined;
      // Reject incompatible references before spending time on prewarm and search.
      const setupMs = performance.now() - started;
      const report = await runBenchmark(solver, selected, (phase) => {
        console.error(JSON.stringify({ phase, queries: selected.length }));
        if (phase === 'batch') resetTimings(timings);
      });
      const hash = createHash('sha256');
      for (const directory of ['src', 'bench'])
        for (const name of (await readdir(resolve(root, directory), { recursive: true })).sort()) {
          if (name.endsWith('.ts'))
            hash
              .update(`${directory}/${name}\0`)
              .update(await readFile(resolve(root, directory, name)));
        }
      const output = {
        schemaVersion: 6,
        adapter: 'scene-files',
        node: process.version,
        execArgv: process.execArgv,
        revision: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
          cwd: root,
        }).trim(),
        sourceSha256: hash.digest('hex'),
        workingTreeDirty: Boolean(
          execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
            encoding: 'utf8',
            cwd: root,
          }).trim(),
        ),
        ...metadata,
        concurrency,
        cases: selected,
        inputLoadMs,
        setupMs,
        timings,
        policy:
          'All dataset file reads, JSON decoding, source verification, hashing, scene-worker startup and solver preparation finish before prewarm. One full unmeasured batch prewarms the same prepared solver and worker-local scene and physical caches. The measured batch recomputes queries without completed-route caching and reads inputs from memory only. It includes scene-worker dispatch/queueing/IPC, normalization, remaining lazy computation, candidate search, target approach, physical windows and retries. Inclusive phase timers describe measured work only and may overlap across scene workers. OS scheduling/JIT/GC uncontrolled.',
        ...report,
        ...(reference && referenceBytes
          ? {
              comparison: {
                referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
                ...(referenceReport &&
                Number.isFinite(referenceReport.batch.wallMs) &&
                referenceReport.batch.wallMs > 0
                  ? { speedup: referenceReport.batch.wallMs / report.batch.wallMs }
                  : {}),
                ...compareQuality(report.batch.results, reference),
              },
            }
          : {}),
      };
      if (values.json) console.log(JSON.stringify(output, null, 2));
      else if (values.markdown) console.log(benchmarkMarkdown(output));
      else {
        console.log(
          `${metadata.scene}: ${selected.length} full-scene queries; local files, no Atlos server`,
        );
        console.table(report.batch.results);
        console.log(`Prewarm: ${(report.prewarmMs / 1000).toFixed(2)} s; excluded`);
        console.log(
          `Batch: ${report.batch.queriesPerSecond.toFixed(3)} queries/s; ${report.batch.results.filter((r) => r.sameOutcomeAsPrewarm && r.sameTruncationAsPrewarm).length}/${selected.length} outcomes match prewarm`,
        );
        console.log(
          `Quality: ${report.batch.quality.completed}/${selected.length} complete; total modeled travel time: ${report.batch.quality.totalCostSeconds ?? 'incomplete'} s`,
        );
        if (output.comparison) {
          console.log(
            `Reference: ${output.comparison.pairedCompleted} paired completions; lost ${output.comparison.lostSolutions.length}; gained ${output.comparison.gainedSolutions.length}; geometric mean cost ratio ${output.comparison.geometricMeanCostRatio ?? 'unavailable'}; worst ${output.comparison.worstCostRatio ?? 'unavailable'} (lower is better)`,
          );
          console.table(output.comparison.pairs);
        }
        console.log(output.policy);
      }
    } finally {
      await solver.close();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
