import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { prepareRouteSolver, gangliaV1Defaults, type SolverConfig } from '@opendfieldmap/ganglia';

import { benchmarkMarkdown } from '#@/bench/markdown.ts';
import { compareQuality, qualityGate, readReference } from '#@/bench/quality.ts';
import { runBenchmark } from '#@/bench/run.ts';
import { loadScene } from '#@/bench/scene.ts';
import { cases } from '#@/bench/scenes/map02.ts';
import { sourceHash } from '#@/bench/source.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { setActionCatalogPhase, actionCatalogStats } from '#@/src/v1/route/action-catalog.ts';

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
    offset: { type: 'string' },
    'catalog-train': { type: 'string' },
    workload: { type: 'string' },
    'max-mean-cost-ratio': { type: 'string', default: '1.01' },
    'max-worst-cost-ratio': { type: 'string', default: '1.05' },
  },
});
if (values.help)
  console.log(
    'Usage: pnpm benchmark:full [--json | --markdown] [--data-root <path>] [--extractor <path>] [--workload <query-cases.json>] [--offset <index>] [--catalog-train <count; opt-in approximate static-action algorithm>] [--limit <count>] [--concurrency <scene-lanes>] [--workers <scene-workers; 1=inline>] [--config <json-file>] [--reference <benchmark-json>] [--max-mean-cost-ratio <ratio; default 1.01>] [--max-worst-cost-ratio <ratio; default 1.05>]. Reference comparisons reject lost solutions or excess modeled route cost; all runs require prewarm stability.',
  );
else {
  try {
    if (values.json && values.markdown) throw new Error('Choose --json or --markdown');
    const limits = {
      geometricMeanCostRatio: Number(values['max-mean-cost-ratio']),
      worstCostRatio: Number(values['max-worst-cost-ratio']),
    };
    qualityGate([], undefined, limits);
    const sourceSha256 = await sourceHash(root, ['src', 'bench']);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      cwd: root,
    }).trim();
    const workingTreeDirty = Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8',
        cwd: root,
      }).trim(),
    );
    const workload: typeof cases = values.workload
      ? JSON.parse(await readFile(values.workload, 'utf8'))
      : cases;
    const offset = Number(values.offset ?? 0),
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
    const trainingCount =
      values['catalog-train'] === undefined ? 0 : Number(values['catalog-train']);
    if (
      !Number.isSafeInteger(trainingCount) ||
      trainingCount < 0 ||
      (values['catalog-train'] !== undefined &&
        (trainingCount === 0 || values.offset === undefined || offset < trainingCount))
    )
      throw new Error(
        'Catalog training requires a positive count and explicit holdout offset at least that count',
      );
    const training = workload.slice(0, trainingCount);
    const selected = workload.slice(offset, offset + count);
    if (trainingCount) {
      const trainingStarts = new Set(
        training.flatMap((item) =>
          item.query.starts.map((start) => JSON.stringify(start.position)),
        ),
      );
      if (
        selected.some((item) =>
          item.query.starts.some((start) => trainingStarts.has(JSON.stringify(start.position))),
        )
      )
        throw new Error('Catalog holdout starts must be absent from training');
    }
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
    if (trainingCount && (workers !== 1 || concurrency !== 1))
      throw new Error('Catalog experiment requires workers=1 and concurrency=1');
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
      let catalogTraining;
      if (trainingCount) {
        console.error(JSON.stringify({ phase: 'catalog-training', queries: training.length }));
        setActionCatalogPhase('training');
        const trainingStarted = performance.now();
        const results = await solver.solveBatch(training.map((item) => item.query));
        setActionCatalogPhase('frozen');
        catalogTraining = {
          algorithm: 'approximate-static-actions' as const,
          ids: training.map((item) => item.id),
          wallMs: performance.now() - trainingStarted,
          completed: results.filter((result) => result.route.status === 'complete').length,
          stats: actionCatalogStats(),
        };
      }
      const report = await runBenchmark(solver, selected, (phase) => {
        console.error(JSON.stringify({ phase, queries: selected.length }));
        if (phase === 'batch') resetTimings(timings);
      });
      if (catalogTraining && actionCatalogStats().added !== catalogTraining.stats.added)
        throw new Error('Frozen catalog changed during holdout');
      if ((await sourceHash(root, ['src', 'bench'])) !== sourceSha256)
        throw new Error('Benchmark source changed during measurement; discard this run');
      const output = {
        schemaVersion: 6,
        adapter: 'scene-files',
        node: process.version,
        execArgv: process.execArgv,
        revision,
        sourceSha256,
        workingTreeDirty,
        ...metadata,
        concurrency,
        cases: selected,
        inputLoadMs,
        setupMs,
        timings,
        ...(catalogTraining ? { catalogTraining, catalogAfterHoldout: actionCatalogStats() } : {}),
        policy:
          (catalogTraining
            ? 'Approximate static-action algorithm: the reported training queries record nonterminal static ordinary motion proofs using original discovery. Training time is excluded from measured holdout and reported separately. The catalog freezes before fresh-start holdout prewarm. Up to eight travel-time-ranked candidate chains, with at most sixteen unique actions, are jointly checked by the real planner and runs a broad comparison of at most 128 candidates and one incumbent-local pass of at most 128 candidates before returning, without recursive refinement. Failed candidates retain original discovery budgets. '
            : '') +
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
      const gate = qualityGate(report.batch.results, output.comparison, limits);
      const validated = { ...output, qualityGate: gate };
      if (values.json) console.log(JSON.stringify(validated, null, 2));
      else if (values.markdown) console.log(benchmarkMarkdown(validated));
      else {
        console.log(
          `${metadata.scene}: ${selected.length} full-scene queries; local files, no Atlos server`,
        );
        console.table(report.batch.results);
        if (catalogTraining)
          console.log(
            `Approximate static-action training: ${catalogTraining.ids.length} queries, ${(catalogTraining.wallMs / 1000).toFixed(2)} s excluded, ${catalogTraining.stats.added} actions`,
          );
        console.log(`Prewarm: ${(report.prewarmMs / 1000).toFixed(2)} s; excluded`);
        console.log(
          `Batch: ${report.batch.queriesPerSecond.toFixed(3)} queries/s; ${report.batch.results.filter((r) => r.sameOutcomeAsPrewarm && r.sameTruncationAsPrewarm).length}/${selected.length} outcomes match prewarm`,
        );
        if (report.batch.meanSerialQueryMs !== undefined)
          console.log(
            `Mean serial query wall time: ${report.batch.meanSerialQueryMs.toFixed(3)} ms (batch / queries)`,
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
      if (!gate.passed) {
        console.error(`Benchmark quality gate failed: ${gate.failures.join('; ')}`);
        process.exitCode = 1;
      }
    } finally {
      await solver.close();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
