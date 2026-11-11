import type { CollisionWorld } from '../../geo/collision.ts';
import { createCollisionWorld } from '../../geo/collision.ts';
import type { GroundPlanner } from '../../route/ground.ts';
import { createGroundPlanner } from '../../route/ground.ts';
import { planJumpRoute } from '../../route/jump-planner.ts';
import type { PreparedRouteSolver, RouteQuery, RouteResult, SceneInput } from '../contract.ts';

export async function prepareSurfaceActionSolver(input: SceneInput): Promise<PreparedRouteSolver> {
  let prepared: {
    surfaces: SceneInput['surfaces'];
    world: CollisionWorld;
    planner: GroundPlanner;
    options: SceneInput['options'];
  } | null = {
    surfaces: input.surfaces,
    world: createCollisionWorld(input.collision, input.collisionOptions),
    planner: createGroundPlanner(input.surfaces, input.options),
    options: input.options,
  };
  const solve = (query: RouteQuery): RouteResult => {
    if (!prepared) throw new Error('Route solver is closed');
    // Geometry/model constraints belong to the snapshot, never to a request.
    const overrides: NonNullable<RouteQuery['options']> = {};
    for (const key of [
      'interaction',
      'waypoints',
      'connections',
      'maxCandidates',
      'maxShortcutCandidates',
      'maxLinks',
    ] as const) {
      if (Object.hasOwn(query.options ?? {}, key))
        Object.assign(overrides, { [key]: query.options?.[key] });
    }
    return planJumpRoute(prepared.surfaces, prepared.world, query.starts, query.goal, {
      ...prepared.options,
      ...overrides,
      groundPlanner: prepared.planner,
    });
  };
  return {
    async solve(query) {
      return solve(query);
    },
    async solveBatch(queries) {
      if (!prepared) throw new Error('Route solver is closed');
      // Serial execution belongs to this adapter, leaving replacements free to
      // schedule a whole batch without a caller-side loop.
      return queries.map(solve);
    },
    async close() {
      prepared = null;
    },
  };
}
