import { parentPort, workerData } from 'node:worker_threads';

import { prepareRouteSolver } from '@opendfieldmap/ganglia';

import { loadScene } from '#@/bench/scene.ts';
import { resetTimings } from '#@/bench/timings.ts';
import {
  workerMemory,
  type WorkerSetup,
  type WorkerRequest,
  type WorkerReply,
} from '#@/bench/workers.ts';

if (!parentPort) throw new Error('Scene entry requires a worker thread');
const port = parentPort;
const setup = workerData as WorkerSetup;
const scene = await loadScene(setup.dataRoot, setup.extractor, 1);
const solver = await prepareRouteSolver(setup.config, scene.input);
const send = (message: WorkerReply) => port.postMessage(message);
port.on('message', async (message: WorkerRequest) => {
  if (message.type === 'close') {
    await solver.close();
    send({ type: 'closed' });
    port.close();
    return;
  }
  const { id, query, cancel, events } = message;
  resetTimings(scene.timings);
  const controller = cancel ? new AbortController() : undefined;
  const checkCancellation = () => {
    if (cancel && Atomics.load(new Int32Array(cancel), 0)) controller?.abort();
  };
  checkCancellation();
  try {
    const result = await solver.solve(query, {
      signal: controller?.signal,
      onEvent:
        cancel || events
          ? (event) => {
              checkCancellation();
              if (events) send({ type: 'event', id, event });
            }
          : undefined,
    });
    send({ type: 'result', id, result, timings: scene.timings, memory: workerMemory() });
  } catch (error) {
    send({ type: 'error', id, error: error instanceof Error ? error.message : String(error) });
  }
});
send({
  type: 'ready',
  config: solver.config,
  metadata: scene.metadata,
  inputLoadMs: scene.inputLoadMs,
  preparationMs: scene.timings.preparationMs,
  memory: workerMemory(),
});
