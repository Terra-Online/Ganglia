import type { Wall } from '#@/src/geo/walls.ts';
import type { LocomotionOptions } from '#@/src/resource/locomotion.ts';
import { prepareSurfaceActionSolver } from '#@/src/solver/adapters/surface-action.ts';
import type { PreparedRouteSolver, SceneInput, SolverConfig } from '#@/src/solver/contract.ts';
import { snapshotGangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import { preparePhysicalSolver } from '#@/src/solver/physical/prepared.ts';
import type { PhysicalInput } from '#@/src/solver/physical/solve.ts';
import { prepareSceneRouteSolver, type SceneResources } from '#@/src/solver/scene/prepared.ts';
import type { WindowJob } from '#@/src/solver/window-route.ts';

export type SolverInput<Source, Job extends WindowJob> =
  | { kind: 'surfaces'; input: SceneInput }
  | { kind: 'physical'; input: PhysicalInput }
  | {
      kind: 'scene';
      scene: { scene: string; source: Source; walls: Wall[] };
      resources: SceneResources<Source, Job>;
      locomotion: LocomotionOptions;
    };

/** Select the algorithm once. All queries and batch lanes use the same frozen policy. */
export async function prepareRouteSolver<Source, Job extends WindowJob>(
  config: SolverConfig,
  input: SolverInput<Source, Job>,
): Promise<PreparedRouteSolver> {
  switch (config.algorithm) {
    case 'ganglia-v1': {
      const fixed = snapshotGangliaV1Config(config);
      switch (input.kind) {
        case 'surfaces':
          return prepareSurfaceActionSolver(input.input, fixed);
        case 'physical':
          return preparePhysicalSolver(input.input, fixed);
        case 'scene':
          return prepareSceneRouteSolver(input.scene, input.resources, fixed, input.locomotion);
      }
    }
    default:
      throw new Error('Unsupported solver algorithm');
  }
}
