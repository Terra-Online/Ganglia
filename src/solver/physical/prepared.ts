import type { PreparedRouteSolver, RouteQuery, RouteResult } from '../contract.ts';
import {
  solvePhysicalRoute,
  type PhysicalCache,
  type PhysicalContext,
  type PhysicalInput,
} from './solve.ts';

/** One cache slot holds values produced by the same physical preparation site.
 * Slot/key changes invalidate dependants before a different preparation is stored. */
function preparationCache(): PhysicalCache {
  const slots = new Map<string, { key: string; value: unknown }>();
  return {
    release(slot) {
      slots.delete(slot);
    },
    async memo<T>(slot: string, key: string, create: () => T | Promise<T>) {
      const found = slots.get(slot);
      if (found?.key === key) return { value: found.value as T, reused: true };
      slots.delete(slot);
      if (slot === 'ground')
        for (const dependent of ['devices', 'moving', 'refinement']) slots.delete(dependent);
      if (slot === 'moving') slots.delete('refinement');
      const value = await create();
      slots.set(slot, { key, value });
      return { value, reused: false };
    },
  };
}

export async function preparePhysicalRouteSolver(
  input: PhysicalInput,
  context: Omit<PhysicalContext, 'emit'> & { emit?: PhysicalContext['emit'] } = {},
): Promise<PreparedRouteSolver> {
  let scene: PhysicalInput | null = input;
  let cache: PhysicalCache | null = context.cache ?? preparationCache();
  const solve = async (query: RouteQuery): Promise<RouteResult> => {
    if (!scene || !cache) throw new Error('Route solver is closed');
    const fixed = scene;
    const preparation = cache;
    let best: RouteResult = {
      route: { status: 'unmapped' },
      connections: [],
      diagnostics: { truncated: false },
    };
    let truncated = false;
    for (const arrival of query.starts) {
      await solvePhysicalRoute(
        fixed,
        {
          arrival,
          target: query.goal,
          interaction: query.interaction,
          walls: [],
          waypoints: query.waypoints,
        },
        {
          ...context,
          cache: preparation,
          async emit(result, optimizing, diagnostics) {
            truncated ||= diagnostics.truncated === true;
            const route = result.route;
            if (best.route.status !== 'complete' && result.reason === 'no-verified-route')
              best = {
                route: { status: 'no-verified-route' },
                connections: result.connections ?? [],
                diagnostics: { truncated },
              };
            if (
              route?.status === 'complete' &&
              (best.route.status !== 'complete' || route.cost < best.route.cost)
            )
              best = { route, connections: result.connections ?? [], diagnostics: { truncated } };
            await context.emit?.(result, optimizing, diagnostics);
          },
        },
        query.config?.search,
      );
    }
    return { ...best, diagnostics: { truncated } };
  };
  return {
    solve,
    async solveBatch(queries) {
      if (!scene) throw new Error('Route solver is closed');
      const results: RouteResult[] = [];
      // Scheduling belongs to this adapter; callers submit the whole workload.
      for (const query of queries) results.push(await solve(query));
      return results;
    },
    async close() {
      scene = null;
      cache = null;
    },
  };
}
