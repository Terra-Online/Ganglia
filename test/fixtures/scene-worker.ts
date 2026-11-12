import { parentPort, threadId, workerData } from 'node:worker_threads';

import type { RouteResult } from '@opendfieldmap/ganglia';

import { createTimings } from '#@/bench/timings.ts';
import {
  workerMemory,
  type WorkerRequest,
  type WorkerReply,
  type WorkerSetup,
} from '#@/bench/workers.ts';

if (!parentPort) throw new Error('Fixture requires a worker thread');
const port = parentPort;
const setup = workerData as WorkerSetup;
const send = (message: WorkerReply) => port.postMessage(message);
port.on('message', async (message: WorkerRequest) => {
  if (message.type === 'close') {
    send({ type: 'closed' });
    port.close();
    return;
  }
  const { id, query, cancel, events } = message;
  if (query.goal[1] === 1) process.exit(2);
  if (query.goal[1] === 2) {
    send({ type: 'error', id, error: 'fixture failure' });
    return;
  }
  if (events) send({ type: 'event', id, event: { type: 'progress', phase: 'search' } });
  if (query.goal[1] === 3) {
    const end = performance.now() + query.goal[0];
    while (performance.now() < end) {}
  } else await new Promise((resolve) => setTimeout(resolve, query.goal[0]));
  const result: RouteResult =
    cancel && Atomics.load(new Int32Array(cancel), 0)
      ? {
          route: { status: 'no-verified-route' },
          connections: [],
          diagnostics: { truncated: true },
          reason: 'aborted',
        }
      : {
          route: {
            status: 'complete',
            start: query.starts[0].id,
            arrivalCost: 0,
            cost: 1,
            length: 1,
            points: [query.goal],
            segments: [],
          },
          connections: [],
          diagnostics: { truncated: false },
          reason: String(threadId),
        };
  const timings = createTimings();
  timings.normalizationMs = 2;
  timings.localSolveMs = 3;
  timings.physical.calls = 1;
  timings.physical.stagesMs.ground = 3;
  timings.physical.preparation.ground = { hits: 1, misses: 0 };
  send({ type: 'result', id, result, timings, memory: workerMemory() });
});
send({
  type: 'ready',
  config: setup.config,
  inputLoadMs: 1,
  preparationMs: 2,
  memory: workerMemory(),
  metadata: {
    scene: 'fixture',
    source: { buildGuid: 'fixture', contentHash: 'fixture' },
    hashes: { ground: setup.dataRoot === 'mismatch' ? String(setup.index) : 'ground' },
    gameAdapterSha256: 'adapter',
    kernelSha256: 'kernel',
    resolvedKernel: 'fixture',
    inputBytes: 1,
    execution: {
      mode: 'inline',
      workers: 0,
      lanes: 1,
      memory: { processRssSampledPeakBytes: 0, mainHeapUsedSampledPeakBytes: 0 },
    },
  },
});
