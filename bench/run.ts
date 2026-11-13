import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedRouteSolver, RouteQuery, RouteResult } from '@opendfieldmap/ganglia';

import { summarizeQuality } from '#@/bench/quality.ts';

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outcome = (result: RouteResult) => ({
  route: result.route,
  connections: result.connections,
  ...(result.partial ? { partial: true } : {}),
});
const summarize = (result: RouteResult) => {
  const complete = result.route.status === 'complete' ? result.route : null;
  return {
    status: result.route.status,
    partial: result.partial === true,
    reason: result.reason ?? null,
    cost: complete?.cost ?? null,
    length: complete?.length ?? null,
    jumps: complete?.segments?.filter((segment) => segment.mode === 'jump').length ?? 0,
    drops: complete?.segments?.filter((segment) => segment.mode === 'drop').length ?? 0,
    truncated: result.diagnostics.truncated,
    outcomeSha256: digest(outcome(result)),
  };
};

// Takes ownership of the prepared solver and closes it even if a batch fails.
// Warm and measured passes submit the whole workload; neither pass drives solve().
export async function runBenchmark(
  solver: PreparedRouteSolver,
  cases: readonly { id: string; query: RouteQuery }[],
  onPhase?: (phase: 'prewarm' | 'batch') => void,
  rounds = 1,
) {
  const queries = cases.map((item) => item.query);
  try {
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    onPhase?.('prewarm');
    let started = performance.now();
    const warm = await solver.solveBatch(queries);
    const prewarmMs = performance.now() - started;
    if (warm.length !== cases.length)
      throw new Error('Prewarm returned a different number of results');
    onPhase?.('batch');
    const wallSamplesMs: number[] = [];
    const stable = cases.map(() => ({ outcome: true, truncation: true }));
    let batch: readonly RouteResult[] = [];
    for (let round = 0; round < rounds; round++) {
      started = performance.now();
      batch = await solver.solveBatch(queries);
      wallSamplesMs.push(performance.now() - started);
      if (batch.length !== cases.length)
        throw new Error('Batch returned a different number of results');
      batch.forEach((result, i) => {
        stable[i].outcome =
          isDeepStrictEqual(outcome(result), outcome(warm[i])) && stable[i].outcome;
        stable[i].truncation =
          result.diagnostics.truncated === warm[i].diagnostics.truncated && stable[i].truncation;
      });
    }
    const results = batch.map((result, i) => ({
      id: cases[i].id,
      ...summarize(result),
      sameOutcomeAsPrewarm: stable[i].outcome,
      sameTruncationAsPrewarm: stable[i].truncation,
    }));
    const totalWallMs = wallSamplesMs.reduce((sum, sample) => sum + sample, 0);
    // Keep the reference metric comparable to a single complete workload batch.
    const wallMs = totalWallMs / rounds;
    return {
      config: solver.config,
      prewarmMs,
      batch: {
        rounds,
        wallSamplesMs,
        totalWallMs,
        wallMs,
        queriesPerSecond: (rounds * cases.length) / (totalWallMs / 1000),
        ...(solver.config.batchConcurrency === 1
          ? { meanSerialQueryMs: wallMs / cases.length }
          : {}),
        quality: summarizeQuality(results),
        results,
      },
    };
  } finally {
    await solver.close();
  }
}
