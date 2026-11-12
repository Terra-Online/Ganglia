import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedRouteSolver, RouteQuery, RouteResult } from '../src/solver/contract.ts';

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

// Warm and measured passes submit the whole workload; neither pass drives solve().
export async function runBenchmark(
  prepare: () => Promise<PreparedRouteSolver>,
  cases: readonly { id: string; query: RouteQuery }[],
  onPhase?: (phase: 'prewarm' | 'batch') => void,
) {
  const solver = await prepare();
  const queries = cases.map((item) => item.query);
  try {
    onPhase?.('prewarm');
    let started = performance.now();
    const warm = await solver.solveBatch(queries);
    const prewarmMs = performance.now() - started;
    if (warm.length !== cases.length)
      throw new Error('Prewarm returned a different number of results');
    onPhase?.('batch');
    started = performance.now();
    const batch = await solver.solveBatch(queries);
    const wallMs = performance.now() - started;
    if (batch.length !== cases.length)
      throw new Error('Batch returned a different number of results');
    return {
      prewarmMs,
      batch: {
        wallMs,
        queriesPerSecond: cases.length / (wallMs / 1000),
        results: batch.map((result, i) => ({
          id: cases[i].id,
          ...summarize(result),
          sameOutcomeAsPrewarm: isDeepStrictEqual(outcome(result), outcome(warm[i])),
          sameTruncationAsPrewarm: result.diagnostics.truncated === warm[i].diagnostics.truncated,
        })),
      },
    };
  } finally {
    await solver.close();
  }
}
