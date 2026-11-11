import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runBenchmark } from '../bench/run.ts';
import type { RouteQuery, RouteResult } from '../src/solver/contract.ts';

test('the benchmark submits a whole batch and accepts asynchronous out-of-order execution', async () => {
  const cases: readonly { id: string; query: RouteQuery }[] = [1, 2, 3].map((id) => ({
    id: String(id),
    query: { starts: [], goal: [id, 0, 0] },
  }));
  const result = (query: RouteQuery): RouteResult | PromiseLike<RouteResult> => ({
    route: {
      status: 'complete',
      cost: query.goal[0],
      start: 'player',
      arrivalCost: 0,
      length: 0,
      points: [query.goal],
      segments: [],
    },
    connections: [],
    diagnostics: {
      truncated: false,
    },
  });
  let preparations = 0,
    closes = 0,
    batchCalls = 0;
  const report = await runBenchmark(async () => {
    const instance = ++preparations;
    return {
      async solve(query) {
        assert.equal(instance, 1, 'batch instance must be driven through solveBatch');
        return result(query);
      },
      async solveBatch(queries) {
        batchCalls++;
        assert.equal(instance, 2);
        // Complete the final input first, while preserving result correspondence.
        const outputs = await Promise.all(
          [...queries].reverse().map(async (query) => {
            await new Promise((resolve) => setImmediate(resolve));
            return result(query);
          }),
        );
        return outputs.reverse();
      },
      async close() {
        closes++;
      },
    };
  }, cases);
  assert.equal(batchCalls, 1);
  assert.equal(closes, 2);
  assert.deepEqual(
    report.batch.results.map((row) => row.id),
    ['1', '2', '3'],
  );
  assert.ok(report.batch.results.every((row) => row.sameOutcomeAsSingle));
});

test('the benchmark closes the adapter after a failed solve', async () => {
  let closed = false;
  await assert.rejects(
    runBenchmark(
      async () => ({
        async solve() {
          throw new Error('worker failed');
        },
        async solveBatch() {
          throw new Error('worker failed');
        },
        async close() {
          closed = true;
        },
      }),
      [{ id: 'failure', query: { starts: [], goal: [0, 0, 0] } }],
    ),
    /worker failed/,
  );
  assert.equal(closed, true);
});
