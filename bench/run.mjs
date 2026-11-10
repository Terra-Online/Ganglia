import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outcome = result => ({ route: result.route, connections: result.connections });
const summarize = result => ({ status: result.route.status, cost: result.route.cost ?? null,
  length: result.route.length ?? null,
  jumps: result.route.segments?.filter(segment => segment.mode === 'jump').length ?? 0,
  drops: result.route.segments?.filter(segment => segment.mode === 'drop').length ?? 0,
  truncated: result.diagnostics.truncated, outcomeSha256: digest(outcome(result)) });

/** The runner only knows the solver interface. In particular, it must submit
 * the batch once, leaving scheduling to the chosen adapter.
 * @param {() => Promise<import('../src/solver/index.d.ts').PreparedRouteSolver>} prepare
 * @param {{id: string, query: import('../src/solver/index.d.ts').RouteQuery}[]} cases */
export async function runBenchmark(prepare, cases) {
  const singles = [], results = [];
  const first = await prepare();
  try {
    for (const { id, query } of cases) {
      const started = performance.now();
      const result = await first.solve(query);
      const wallMs = performance.now() - started;
      results.push(result);
      singles.push({ id, wallMs, ...summarize(result) });
    }
  } finally { await first.close(); }

  // A separate prepared instance keeps single-query runs out of batch caches.
  const second = await prepare();
  let batch, wallMs;
  try {
    const started = performance.now();
    batch = await second.solveBatch(cases.map(item => item.query));
    wallMs = performance.now() - started;
  } finally { await second.close(); }
  if (batch.length !== cases.length) throw new Error('Batch returned a different number of results');
  const times = singles.map(row => row.wallMs).sort((a, b) => a - b);
  const percentile = p => times[Math.ceil(times.length * p) - 1] ?? null;
  const middle = Math.floor(times.length / 2);
  const medianMs = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[middle]) / 2 : null;
  return {
    single: { totalWallMs: singles.reduce((sum, row) => sum + row.wallMs, 0),
      medianMs, p95Ms: percentile(0.95), results: singles },
    batch: { wallMs, queriesPerSecond: cases.length / (wallMs / 1000),
      results: batch.map((result, i) => ({ id: cases[i].id, ...summarize(result),
        sameOutcomeAsSingle: isDeepStrictEqual(outcome(result), outcome(results[i])),
        sameTruncationAsSingle: result.diagnostics.truncated === results[i].diagnostics.truncated })) },
  };
}
