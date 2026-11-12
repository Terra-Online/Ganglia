import { Worker } from 'node:worker_threads';

import type {
  PreparedRouteSolver,
  RouteEvent,
  RouteQuery,
  RouteResult,
  SolveOptions,
  SolverConfig,
} from '@opendfieldmap/ganglia';

import { sceneIdentity, type SceneMetadata } from '#@/bench/scene.ts';
import { createTimings, mergeTimings, type Timings } from '#@/bench/timings.ts';

export const workerMemory = () => {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
};
type Memory = ReturnType<typeof workerMemory>;

export interface WorkerSetup {
  config: SolverConfig;
  dataRoot: string;
  extractor: string;
  index: number;
}
export type WorkerRequest =
  | { type: 'solve'; id: number; query: RouteQuery; cancel?: SharedArrayBuffer; events: boolean }
  | { type: 'close' };
export type WorkerReply =
  | {
      type: 'ready';
      config: SolverConfig;
      metadata: SceneMetadata;
      inputLoadMs: number;
      preparationMs: number;
      memory: Memory;
    }
  | { type: 'result'; id: number; result: RouteResult; timings: Timings; memory: Memory }
  | { type: 'event'; id: number; event: RouteEvent }
  | { type: 'error'; id: number; error: string }
  | { type: 'closed' };

type Task = {
  message: Extract<WorkerRequest, { type: 'solve' }>;
  resolve: (result: RouteResult) => void;
  reject: (error: unknown) => void;
  options: SolveOptions;
  cleanup: () => void;
  callbackError?: { cause: unknown };
};
type Slot = {
  worker: Worker;
  active?: Task;
  ready: boolean;
  heapUsedSampledPeakBytes: number;
  shutdown?: () => void;
};

/** Entire queries stay inside one prepared isolate: planner, windows, physical
 * preparation and caches never cross the seam. Threads share no mutable solver
 * state, and only queries, optional events and final results are transported. */
export async function prepareWorkerSolver(options: {
  count: number;
  config: SolverConfig;
  dataRoot: string;
  extractor: string;
  entry?: URL;
}) {
  const startup = performance.now();
  const config = { ...options.config };
  let inputLoadMs = 0;
  const timings = createTimings();
  const queued: Task[] = [];
  const slots: Slot[] = [];
  let first: Extract<WorkerReply, { type: 'ready' }> | undefined;
  let processRssSampledPeakBytes = process.memoryUsage().rss;
  let serial = 0,
    nextSlot = 0;
  let closed = false;
  let failure: Error | undefined;
  let closing: Promise<void> | undefined;
  let notifyDrained: (() => void) | undefined;
  const drained = () => {
    if (!queued.length && slots.every((slot) => !slot.active)) notifyDrained?.();
  };
  const fail = (error: Error) => {
    failure ??= error;
    for (const task of queued.splice(0)) {
      task.cleanup();
      task.reject(failure);
    }
    for (const slot of slots) {
      slot.active?.cleanup();
      slot.active?.reject(failure);
      slot.active = undefined;
      slot.shutdown?.();
      void slot.worker.terminate();
    }
    drained();
  };
  const dispatch = () => {
    if (failure) return;
    let active = slots.filter((slot) => slot.active).length;
    for (
      let checked = 0;
      checked < slots.length && queued.length && active < config.batchConcurrency;
      checked++
    ) {
      const slot = slots[nextSlot];
      nextSlot = (nextSlot + 1) % slots.length;
      if (!slot.ready || slot.active) continue;
      const task = queued.shift();
      if (!task) break;
      slot.active = task;
      active++;
      try {
        slot.worker.postMessage(task.message);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
    drained();
  };
  try {
    await Promise.all(
      Array.from(
        { length: options.count },
        (_, index) =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(options.entry ?? new URL('./worker.ts', import.meta.url), {
              workerData: {
                config,
                dataRoot: options.dataRoot,
                extractor: options.extractor,
                index,
              } satisfies WorkerSetup,
            });
            const slot: Slot = { worker, ready: false, heapUsedSampledPeakBytes: 0 };
            slots.push(slot);
            worker.on('message', (message: WorkerReply) => {
              if (message.type === 'ready' || message.type === 'result') {
                // RSS covers the process, while heapUsed belongs to this V8 isolate.
                processRssSampledPeakBytes = Math.max(
                  processRssSampledPeakBytes,
                  message.memory.rssBytes,
                );
                slot.heapUsedSampledPeakBytes = Math.max(
                  slot.heapUsedSampledPeakBytes,
                  message.memory.heapUsedBytes,
                );
              }
              if (message.type === 'ready') {
                if (first && sceneIdentity(first.metadata) !== sceneIdentity(message.metadata)) {
                  const error = new Error('Scene worker input/source identity mismatch');
                  reject(error);
                  fail(error);
                  return;
                }
                first ??= message;
                inputLoadMs = Math.max(inputLoadMs, message.inputLoadMs);
                timings.preparationMs += message.preparationMs;
                slot.ready = true;
                resolve();
                dispatch();
                return;
              }
              if (message.type === 'closed') {
                slot.shutdown?.();
                return;
              }
              const task = slot.active;
              if (!task || task.message.id !== message.id) {
                fail(new Error('Unexpected scene worker response'));
                return;
              }
              if (message.type === 'event') {
                try {
                  task.options.onEvent?.(message.event);
                } catch (error) {
                  task.callbackError = { cause: error };
                  if (task.message.cancel) Atomics.store(new Int32Array(task.message.cancel), 0, 1);
                }
                return;
              }
              slot.active = undefined;
              task.cleanup();
              if (message.type === 'error') task.reject(new Error(message.error));
              else {
                mergeTimings(timings, message.timings);
                if (task.callbackError !== undefined) task.reject(task.callbackError.cause);
                else task.resolve(message.result);
              }
              dispatch();
            });
            worker.on('error', (error) => {
              reject(error);
              fail(error);
            });
            worker.on('exit', (code) => {
              if (!closing || slot.active || queued.length || !slot.ready) {
                const error = new Error(`Scene worker exited unexpectedly (${code})`);
                reject(error);
                fail(error);
              }
              slot.shutdown?.();
            });
          }),
      ),
    );
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    await Promise.all(slots.map((slot) => slot.worker.terminate()));
    throw error;
  }
  if (!first) throw new Error('No scene workers prepared');
  timings.workerStartupMs = performance.now() - startup;
  const prepared = first;
  const submit = (query: RouteQuery, solveOptions: SolveOptions = {}) => {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error('Scene worker solver is closed'));
    return new Promise<RouteResult>((resolve, reject) => {
      // An atomic flag is visible during synchronous CPU work; abort messages
      // alone cannot be handled until a worker yields its event loop.
      const cancel =
        solveOptions.signal || solveOptions.onEvent ? new SharedArrayBuffer(4) : undefined;
      const abort = () => {
        if (cancel) Atomics.store(new Int32Array(cancel), 0, 1);
      };
      if (solveOptions.signal?.aborted) abort();
      else solveOptions.signal?.addEventListener('abort', abort, { once: true });
      queued.push({
        message: {
          type: 'solve',
          id: ++serial,
          query,
          cancel,
          events: Boolean(solveOptions.onEvent),
        },
        resolve,
        reject,
        options: solveOptions,
        cleanup: () => solveOptions.signal?.removeEventListener('abort', abort),
      });
      dispatch();
    });
  };
  const solver: PreparedRouteSolver = {
    config: Object.freeze(prepared.config),
    solve: submit,
    solveBatch(queries, batchOptions) {
      if (failure) return Promise.reject(failure);
      if (closed) return Promise.reject(new Error('Scene worker solver is closed'));
      return Promise.all(queries.map((query) => submit(query, batchOptions)));
    },
    close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          if (queued.length || slots.some((slot) => slot.active))
            await new Promise<void>((resolve) => {
              notifyDrained = resolve;
            });
          if (!failure)
            await Promise.all(
              slots.map(
                (slot) =>
                  new Promise<void>((resolve) => {
                    slot.shutdown = resolve;
                    try {
                      slot.worker.postMessage({ type: 'close' } satisfies WorkerRequest);
                    } catch (error) {
                      fail(error instanceof Error ? error : new Error(String(error)));
                    }
                  }),
              ),
            );
          await Promise.all(slots.map((slot) => slot.worker.terminate()));
        })();
      }
      return closing;
    },
  };
  return {
    solver,
    inputLoadMs,
    timings,
    metadata: {
      ...prepared.metadata,
      execution: {
        mode: 'worker-threads',
        workers: slots.length,
        lanes: Math.min(slots.length, config.batchConcurrency),
        get memory() {
          return {
            processRssSampledPeakBytes,
            workerHeapUsedSampledPeakBytes: slots.map((slot) => slot.heapUsedSampledPeakBytes),
          };
        },
      },
    },
  };
}
