import type { CollisionWorld } from '../../geo/collision.ts';
import { createCollisionWorld } from '../../geo/collision.ts';
import type { GroundPlanner } from '../../route/ground.ts';
import { createGroundPlanner } from '../../route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '../../route/jump-planner.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SceneInput,
  SearchBudget,
} from '../contract.ts';

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
