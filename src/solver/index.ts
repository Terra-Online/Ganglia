export { prepareSurfaceActionSolver } from './adapters/surface-action.ts';
export type {
  SceneInput,
  SolverConfig,
  SearchBudget,
  RouteQuery,
  RouteResult,
  PreparedRouteSolver,
  SolveOptions,
  RouteEvent,
} from './contract.ts';
export { composeRoutes } from './route-result.ts';
export { createWindowRoute } from './window-route.ts';
export type {
  WindowConfig,
  WindowResources,
  WindowRequest,
  WindowJob,
  Corridor,
} from './window-route.ts';
export { refineGoalGround } from './ground-refinement.ts';
export type { PhysicalInput, PhysicalConfig } from './physical/solve.ts';
export { createDeviceConnections } from './physical/devices.ts';
export type { DeviceFacts } from './physical/devices.ts';
export type { SweptSupport, FollowingSupport, PoseBounds, PoseSpan } from './physical/supports.ts';
export { sweepSupports, supportBounds, supportEndpoints } from './physical/supports.ts';
export { preparePhysicalRouteSolver } from './physical/prepared.ts';
export { prepareSceneRouteSolver } from './scene/prepared.ts';
export type {
  SceneResources,
  SceneConfig,
  SceneProposal,
  SceneTerminal,
} from './scene/prepared.ts';
