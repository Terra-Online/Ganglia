export { prepareSurfaceActionSolver } from '#@/src/solver/adapters/surface-action.ts';
export type {
  SceneInput,
  SolverConfig,
  SearchBudget,
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
export type { PhysicalInput, PhysicalConfig } from '#@/src/solver/physical/solve.ts';
export { createDeviceConnections } from '#@/src/solver/physical/devices.ts';
export type { DeviceFacts } from '#@/src/solver/physical/devices.ts';
export type {
  SweptSupport,
  FollowingSupport,
  PoseBounds,
  PoseSpan,
} from '#@/src/solver/physical/supports.ts';
export { sweepSupports, supportBounds, supportEndpoints } from '#@/src/solver/physical/supports.ts';
export { preparePhysicalRouteSolver } from '#@/src/solver/physical/prepared.ts';
export { prepareSceneRouteSolver } from '#@/src/solver/scene/prepared.ts';
export type {
  SceneResources,
  SceneConfig,
  SceneProposal,
  SceneTerminal,
} from '#@/src/solver/scene/prepared.ts';
