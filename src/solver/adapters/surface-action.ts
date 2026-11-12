import type { CollisionWorld } from '#@/src/geo/collision.ts';
import { createCollisionWorld } from '#@/src/geo/collision.ts';
import type { GroundPlanner } from '#@/src/route/ground.ts';
import { createGroundPlanner } from '#@/src/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/route/jump-planner.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SceneInput,
  SearchBudget,
} from '#@/src/solver/contract.ts';

export async function prepareSurfaceActionSolver(input: SceneInput): Promise<PreparedRouteSolver> {
  const options = {
    sampleSpacing: 1,
    maxCandidates: 512,
    maxLinks: 64,
    ...input.config.movement,
    ...input.config.search,
    walls: input.walls,
    connections: input.connections,
    portals: input.portals,
    boosts: input.boosts,
  };
  let prepared: {
    surfaces: SceneInput['surfaces'];
    world: CollisionWorld;
    planner: GroundPlanner;
    options: JumpRouteOptions;
  } | null = {
    surfaces: input.surfaces,
    world: createCollisionWorld(input.collision, input.collisionOptions),
    planner: createGroundPlanner(input.surfaces, options),
    options,
  };
  const solve = (query: RouteQuery): RouteResult => {
    if (!prepared) throw new Error('Route solver is closed');
    // Per-query overrides are search budgets; geometry and movement remain snapshot-bound.
    const budget = query.config?.search;
    const overrides: SearchBudget = {};
    for (const key of [
      'sampleSpacing',
      'maxCandidates',
      'maxShortcutCandidates',
      'maxLinks',
    ] as const) {
      if (Object.hasOwn(budget ?? {}, key)) Object.assign(overrides, { [key]: budget?.[key] });
    }
    return planJumpRoute(prepared.surfaces, prepared.world, query.starts, query.goal, {
      ...prepared.options,
      ...overrides,
      interaction: query.interaction,
      waypoints: query.waypoints,
      groundPlanner: prepared.planner,
    });
  };
  return {
    async solve(query, options) {
      options?.signal?.throwIfAborted();
      options?.onEvent?.({ type: 'progress', phase: 'search' });
      options?.signal?.throwIfAborted();
      const result = solve(query);
      if (result.route.status === 'complete')
        options?.onEvent?.({ type: 'candidate', result, optimizing: false });
      options?.signal?.throwIfAborted();
      return result;
    },
    async solveBatch(queries, options) {
      if (!prepared) throw new Error('Route solver is closed');
      // Serial execution belongs to this adapter, leaving replacements free to
      // schedule a whole batch without a caller-side loop.
      return queries.map((query) => {
        options?.signal?.throwIfAborted();
        return solve(query);
      });
    },
    async close() {
      prepared = null;
    },
  };
}
