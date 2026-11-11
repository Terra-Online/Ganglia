import type { RouteQuery, RouteResult } from '../contract.ts';
import { createPhysicalCache } from './preparation.ts';
import { preparePhysicalSolver } from './prepared.ts';
import type { PhysicalInput } from './solve.ts';
import { physicalWorkPlan, type PhysicalWork } from './work.ts';

export { physicalWork, physicalWorkPlan, readPhysicalWork } from './work.ts';
export type { PhysicalWork } from './work.ts';

/** Resource hosts retain this preparation with their immutable input region.
 * Cache slots and dependent invalidation stay private to the solver. */
export function createPhysicalPreparation() {
  const cache = createPhysicalCache();
  return {
    clear: () => cache.clear(),
    async solve(
      input: PhysicalInput,
      query: RouteQuery,
      options: {
        binding: string;
        work?: PhysicalWork;
        signal?: AbortSignal;
        onProgress?: (progress: { phase: string; completed?: number; total?: number }) => void;
        onResult?: (
          result: RouteResult,
          optimizing: boolean,
          diagnostics: unknown,
        ) => void | Promise<void>;
      },
    ): Promise<RouteResult> {
      physicalWorkPlan(options.work);
      const solver = await preparePhysicalSolver(input, {
        cache,
        generation: options.binding,
        effort: options.work?.step === 0 ? 'walking' : options.work?.step === 1 ? 'devices' : 'all',
        progress(progress) {
          if (typeof progress.phase === 'string')
            options.onProgress?.({ ...progress, phase: progress.phase });
        },
        observe: options.onResult,
      });
      try {
        return await solver.solve(query, { signal: options.signal });
      } finally {
        await solver.close();
      }
    },
  };
}

export { physicalTileSpan, physicalMargin, physicalCoverage } from './coverage.ts';

export { validateWaypoints } from '../../route/jump-planner.ts';
