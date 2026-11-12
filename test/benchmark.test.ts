import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runBenchmark } from '#@/bench/run.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/index.ts';

test('prewarm and measurement submit whole batches on one solver with ordered results', async () => {
  const cases: readonly { id: string; query: RouteQuery }[] = [1, 2, 3].map((id) => ({
    id: String(id),
    query: { starts: [], goal: [id, 0, 0] },
  }));
  let preparations = 0,
    closes = 0,
    batches = 0;
  const phases: string[] = [];
  const report = await runBenchmark(
    async () => {
      preparations++;
      return {
        config: gangliaV1Defaults,
        async solve() {
          throw new Error('Benchmark must submit whole batches');
        },
        async solveBatch(queries) {
          batches++;
          const result: RouteResult[] = await Promise.all(
            [...queries].reverse().map(async (query) => {
              await new Promise((resolve) => setImmediate(resolve));
              return {
                route: {
                  status: 'complete' as const,
                  cost: query.goal[0],
                  start: 'player',
                  arrivalCost: 0,
                  length: 0,
                  points: [query.goal],
                  segments: [],
                },
                connections: [],
                diagnostics: { truncated: false },
              };
            }),
          );
          return result.reverse();
        },
        async close() {
          closes++;
        },
      };
    },
    cases,
    (phase) => phases.push(phase),
  );
  assert.equal(preparations, 1);
  assert.equal(batches, 2);
  assert.equal(closes, 1);
  assert.deepEqual(phases, ['prewarm', 'batch']);
  assert.deepEqual(
    report.batch.results.map((row) => row.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    report.batch.results.map((row) => row.cost),
    [1, 2, 3],
  );
  assert.ok(report.batch.results.every((row) => row.sameOutcomeAsPrewarm));
});

test('the benchmark closes the adapter after a failed batch', async () => {
  let closed = false;
  await assert.rejects(
    runBenchmark(
      async () => ({
        config: gangliaV1Defaults,
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

test('partial geometry from prewarm cannot count as a complete measured outcome', async () => {
  const result: RouteResult = {
    route: {
      status: 'complete',
      start: 'a',
      cost: 1,
      arrivalCost: 0,
      length: 1,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      segments: [],
    },
    connections: [],
    diagnostics: { truncated: false },
  };
  let batch = 0;
  const report = await runBenchmark(
    async () => ({
      config: gangliaV1Defaults,
      solve: async () => {
        throw new Error('Unexpected single solve');
      },
      solveBatch: async () => [{ ...result, partial: ++batch === 1 }],
      close: async () => {},
    }),
    [{ id: 'same-geometry', query: { starts: [], goal: [1, 0, 0] } }],
  );
  assert.equal(report.batch.results[0].partial, false);
  assert.equal(report.batch.results[0].sameOutcomeAsPrewarm, false);
});
