import { createCollisionWorld } from '../../collision.mjs';
import { createGroundPlanner } from '../../ground.mjs';
import { planJumpRoute } from '../../jump-planner.mjs';

/** @param {import('../index.d.ts').SceneInput} input
 * @returns {Promise<import('../index.d.ts').PreparedRouteSolver>} */
export async function prepareSurfaceActionSolver(input) {
  let prepared = {
    surfaces: input.surfaces,
    world: createCollisionWorld(input.collision, input.collisionOptions),
    planner: createGroundPlanner(input.surfaces, input.options),
    options: input.options,
  };

  const solve = query => {
    if (!prepared) throw new Error('Route solver is closed');
    // Geometry/model constraints belong to the snapshot, never to a request.
    const overrides = {};
    for (const key of ['interaction', 'waypoints', 'connections', 'maxCandidates', 'maxShortcutCandidates', 'maxLinks']) {
      if (Object.hasOwn(query.options ?? {}, key)) overrides[key] = query.options[key];
    }
    return planJumpRoute(prepared.surfaces, prepared.world, query.starts, query.goal,
      { ...prepared.options, ...overrides, groundPlanner: prepared.planner });
  };

  return {
    async solve(query) { return solve(query); },
    async solveBatch(queries) {
      if (!prepared) throw new Error('Route solver is closed');
      // Serial execution is specific to this adapter. The batch interface lets
      // a replacement own scheduling instead of requiring a caller-side loop.
      return queries.map(solve);
    },
    async close() { prepared = null; },
  };
}
