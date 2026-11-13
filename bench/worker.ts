import { prepareRouteSolver } from '@opendfieldmap/ganglia';

import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import { loadScene } from '#@/bench/scene.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { workerMemory, type WorkerRequest, type WorkerReply } from '#@/bench/workers.ts';

if (!process.send) throw new Error('Scene entry requires a child process IPC channel');
const send = (message: WorkerReply) => process.send!(message);
process.once('message', async (message: WorkerRequest) => {
  if (message.type !== 'setup') throw new Error('Scene worker requires setup');
  const setup = message.setup;
  const scene = await loadScene(
    setup.dataRoot,
    setup.extractor,
    1,
    setup.scene,
    setup.preparation
      ? async (request) => {
          const files = await exportPhysicalRegion(
            {
              dataRoot: setup.dataRoot,
              extractor: setup.extractor,
              ...setup.preparation!,
            },
            request,
          );
          send({ type: 'region', files });
          return files;
        }
      : undefined,
  );
  const solver = await prepareRouteSolver(setup.config, scene.input);
  process.on('message', async (message: WorkerRequest) => {
    if (message.type === 'close') {
      await solver.close();
      send({ type: 'closed' });
      process.disconnect();
      return;
    }
    if (message.type !== 'solve') throw new Error('Unexpected scene worker setup');
    const { id, query, events } = message;
    resetTimings(scene.timings);
    try {
      const result = await solver.solve(query, {
        onEvent: events ? (event) => send({ type: 'event', id, event }) : undefined,
      });
      scene.verifyInputs();
      send({
        type: 'result',
        id,
        result,
        timings: scene.timings,
        memory: workerMemory(),
        ...(setup.preparation ? { metadata: scene.metadata } : {}),
      });
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
});
