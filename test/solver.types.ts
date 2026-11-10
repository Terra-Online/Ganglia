import type { RouteQuery, RouteResult, SceneInput } from '@opendfieldmap/ganglia/solver';
import { prepareSurfaceActionSolver } from '@opendfieldmap/ganglia/solver';

async function checkSolverContract(input: SceneInput, query: RouteQuery) {
  const solver = await prepareSurfaceActionSolver(input);
  const single: RouteResult = await solver.solve(query);
  const batch: readonly RouteResult[] = await solver.solveBatch([query]);

  // @ts-expect-error Body constraints belong to the scene, not to a request.
  await solver.solve({ ...query, options: { profile: { radius: 0.3, height: 1.7 } } });
  // @ts-expect-error A batch accepts requests rather than bare target positions.
  await solver.solveBatch([query.goal]);
  // @ts-expect-error Candidate budgets must be numeric.
  await solver.solve({ ...query, options: { maxCandidates: '512' } });

  await solver.close();
  return { single, batch };
}

void checkSolverContract;
