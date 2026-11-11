export { surfaceGraph, projectPoint } from './geo/surfaces.ts';
export { blockedByWalls, createWallChecker } from './geo/walls.ts';
export { createGoalProjector, projectGoal } from './motion/goals.ts';
export { jumpConnection, jumpDuration } from './motion/jumps.ts';
export { sampleJourney } from './motion/motion.ts';
export { retimeGroundRoute } from './resource/locomotion.ts';
export { pruneGroundDetours } from './route/ground-detours.ts';
export { planGroundRoute, createGroundPlanner } from './route/ground.ts';
export { planJumpRoute } from './route/jump-planner.ts';
export { route, routeFrom, sampleRoute } from './route/routes.ts';
export { createCandidatePlanner } from './search/candidate-planner.ts';
export { createLazyRoutePlanner } from './search/lazy-route.ts';
export { findJumpShortcuts } from './search/shortcuts.ts';
export { findJumpConnections } from './search/traversal.ts';
export type { Vec3, Surface, Portal } from './geo/geometry.ts';
export type { Wall } from './geo/walls.ts';
export type { Node, Edge, Graph, Arrival, Route, ResourceSearch } from './route/routes.ts';
export type { MovementMode, BoostUse, Segment } from './motion/motion.ts';
export type { SpeedBoost } from './route/boosted-route.ts';
export type {
  GroundArrival,
  GroundConnection,
  GroundOptions,
  GroundPlanner,
  GroundQueryOptions,
} from './route/ground.ts';
export type { LocomotionOptions } from './resource/locomotion.ts';
export type {
  InteractionGoal,
  GoalProjector,
  GoalProjectionOptions,
  GoalProjection,
} from './motion/goals.ts';
export type { JumpModel, JumpOptions, Arc } from './motion/jumps.ts';
export type { DiscoveryOptions, DiscoveryDiagnostics } from './search/traversal.ts';
export type { ShortcutDiagnostics } from './search/shortcuts.ts';
export type { JumpRouteOptions, JumpDiagnostics } from './route/jump-planner.ts';
export type {
  CandidateEdge,
  CandidatePlannerInput,
  CandidatePlannerOptions,
  CandidateQueryOptions,
  CandidatePlanResult,
} from './search/candidate-planner.ts';
export type { RouteConstraints } from './route/routes.ts';
export type { LazyPlanOptions, LazyPlanResult } from './search/lazy-route.ts';
