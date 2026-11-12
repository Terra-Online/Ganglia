export { prepareRouteSolver } from '#@/src/solver/prepare.ts';
export type { SolverInput } from '#@/src/solver/prepare.ts';
export { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';
export type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
export type {
  SceneInput,
  SolverConfig,
  RouteQuery,
  RouteResult,
  PreparedRouteSolver,
  SolveOptions,
  RouteEvent,
} from '#@/src/solver/contract.ts';
export { composeRoutes } from '#@/src/solver/route-result.ts';
export { createWindowRoute } from '#@/src/solver/window-route.ts';
export type {
  WindowConfig,
  WindowResources,
  WindowRequest,
  WindowJob,
  Corridor,
} from '#@/src/solver/window-route.ts';
export { refineGoalGround } from '#@/src/solver/ground-refinement.ts';
export type { PhysicalInput, PhysicalMovement } from '#@/src/solver/physical/solve.ts';
export { createDeviceConnections } from '#@/src/solver/physical/devices.ts';
export type { DeviceFacts } from '#@/src/solver/physical/devices.ts';
export type {
  SweptSupport,
  FollowingSupport,
  PoseBounds,
  PoseSpan,
} from '#@/src/solver/physical/supports.ts';
export { sweepSupports, supportBounds, supportEndpoints } from '#@/src/solver/physical/supports.ts';
export type { SceneResources, SceneProposal, SceneTerminal } from '#@/src/solver/scene/prepared.ts';
