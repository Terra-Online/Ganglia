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

// Submit the batch once so scheduling remains the adapter's responsibility.
export async function runBenchmark(
  prepare: () => Promise<PreparedRouteSolver>,
  cases: readonly { id: string; query: RouteQuery }[],
  onSingle?: (completed: number, id: string, wallMs: number) => void,
) {
  const singles: (ReturnType<typeof summarize> & { id: string; wallMs: number })[] = [];
  const results: RouteResult[] = [];
  const first = await prepare();
  try {
    for (const { id, query } of cases) {
      const started = performance.now();
      const result = await first.solve(query);
      const wallMs = performance.now() - started;
      results.push(result);
      singles.push({ id, wallMs, ...summarize(result) });
      onSingle?.(singles.length, id, wallMs);
    }
  } finally {
    await first.close();
  }

  // Separate preparation keeps single-query runs out of batch caches.
  const second = await prepare();
  let batch: readonly RouteResult[], wallMs: number;
  try {
    const started = performance.now();
    batch = await second.solveBatch(cases.map((item) => item.query));
    wallMs = performance.now() - started;
  } finally {
    await second.close();
  }
  if (batch.length !== cases.length)
    throw new Error('Batch returned a different number of results');
  const times = singles.map((row) => row.wallMs).sort((a, b) => a - b);
  const percentile = (p: number) => times[Math.ceil(times.length * p) - 1] ?? null;
  const middle = Math.floor(times.length / 2);
  const medianMs = times.length
    ? (times[Math.floor((times.length - 1) / 2)] + times[middle]) / 2
    : null;
  return {
    single: {
      totalWallMs: singles.reduce((sum, row) => sum + row.wallMs, 0),
      medianMs,
      p95Ms: percentile(0.95),
      results: singles,
    },
    batch: {
      wallMs,
      queriesPerSecond: cases.length / (wallMs / 1000),
      results: batch.map((result, i) => ({
        id: cases[i].id,
        ...summarize(result),
        sameOutcomeAsSingle: isDeepStrictEqual(outcome(result), outcome(results[i])),
        sameTruncationAsSingle: result.diagnostics.truncated === results[i].diagnostics.truncated,
      })),
    },
  };
}
