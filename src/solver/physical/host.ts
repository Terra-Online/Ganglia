import type { RouteQuery, RouteResult, SolverConfig } from '#@/src/solver/contract.ts';
import { snapshotGangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import { createPhysicalCache } from '#@/src/solver/physical/preparation.ts';
import { preparePhysicalSolver } from '#@/src/solver/physical/prepared.ts';
import type { PhysicalInput } from '#@/src/solver/physical/solve.ts';
import { physicalWorkPlan, type PhysicalWork } from '#@/src/solver/physical/work.ts';

export { physicalWork, physicalWorkPlan, readPhysicalWork } from '#@/src/solver/physical/work.ts';
export type { PhysicalWork } from '#@/src/solver/physical/work.ts';

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
        config: SolverConfig;
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
      const solver = await preparePhysicalSolver(input, snapshotGangliaV1Config(options.config), {
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

export {
  physicalTileSpan,
  physicalMargin,
  physicalCoverage,
} from '#@/src/solver/physical/coverage.ts';

export { validateWaypoints } from '#@/src/route/jump-planner.ts';
