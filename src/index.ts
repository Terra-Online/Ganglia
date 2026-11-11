import { surfaceGraph as surfaceGraphImplementation } from './geo/surfaces.ts';
import { projectPoint as projectPointImplementation } from './geo/surfaces.ts';
import { blockedByWalls as blockedByWallsImplementation } from './geo/walls.ts';
import { createWallChecker as createWallCheckerImplementation } from './geo/walls.ts';
import { createGoalProjector as createGoalProjectorImplementation } from './motion/goals.ts';
import { projectGoal as projectGoalImplementation } from './motion/goals.ts';
import { jumpConnection as jumpConnectionImplementation } from './motion/jumps.ts';
import { jumpDuration as jumpDurationImplementation } from './motion/jumps.ts';
import { sampleJourney as sampleJourneyImplementation } from './motion/motion.ts';
import { retimeGroundRoute as retimeGroundRouteImplementation } from './resource/locomotion.ts';
import { pruneGroundDetours as pruneGroundDetoursImplementation } from './route/ground-detours.ts';
import { planGroundRoute as planGroundRouteImplementation } from './route/ground.ts';
import { createGroundPlanner as createGroundPlannerImplementation } from './route/ground.ts';
import { planJumpRoute as planJumpRouteImplementation } from './route/jump-planner.ts';
import { route as routeImplementation } from './route/routes.ts';
import { routeFrom as routeFromImplementation } from './route/routes.ts';
import { sampleRoute as sampleRouteImplementation } from './route/routes.ts';
import { createCandidatePlanner as createCandidatePlannerImplementation } from './search/candidate-planner.ts';
import { createLazyRoutePlanner as createLazyRoutePlannerImplementation } from './search/lazy-route.ts';
import { findJumpShortcuts as findJumpShortcutsImplementation } from './search/shortcuts.ts';
import { findJumpConnections as findJumpConnectionsImplementation } from './search/traversal.ts';

export type * from './index-types.ts';

export const route: typeof import('./index-types.ts').route = routeImplementation;

export const routeFrom: typeof import('./index-types.ts').routeFrom = routeFromImplementation;

export const sampleRoute: typeof import('./index-types.ts').sampleRoute = sampleRouteImplementation;

export const blockedByWalls: typeof import('./index-types.ts').blockedByWalls =
  blockedByWallsImplementation;

export const createWallChecker: typeof import('./index-types.ts').createWallChecker =
  createWallCheckerImplementation;

export const surfaceGraph: typeof import('./index-types.ts').surfaceGraph =
  surfaceGraphImplementation;

export const projectPoint: typeof import('./index-types.ts').projectPoint =
  projectPointImplementation;

export const planGroundRoute: typeof import('./index-types.ts').planGroundRoute =
  planGroundRouteImplementation;

export const createGroundPlanner: typeof import('./index-types.ts').createGroundPlanner =
  createGroundPlannerImplementation;

export const pruneGroundDetours: typeof import('./index-types.ts').pruneGroundDetours =
  pruneGroundDetoursImplementation;

export const sampleJourney: typeof import('./index-types.ts').sampleJourney =
  sampleJourneyImplementation;

export const retimeGroundRoute: typeof import('./index-types.ts').retimeGroundRoute =
  retimeGroundRouteImplementation;

export const createGoalProjector: typeof import('./index-types.ts').createGoalProjector =
  createGoalProjectorImplementation;

export const projectGoal: typeof import('./index-types.ts').projectGoal = projectGoalImplementation;

export const jumpConnection: typeof import('./index-types.ts').jumpConnection =
  jumpConnectionImplementation;

export const jumpDuration: typeof import('./index-types.ts').jumpDuration =
  jumpDurationImplementation;

export const findJumpConnections: typeof import('./index-types.ts').findJumpConnections =
  findJumpConnectionsImplementation;

export const findJumpShortcuts: typeof import('./index-types.ts').findJumpShortcuts =
  findJumpShortcutsImplementation;

export const planJumpRoute: typeof import('./index-types.ts').planJumpRoute =
  planJumpRouteImplementation;

export const createLazyRoutePlanner: typeof import('./index-types.ts').createLazyRoutePlanner =
  createLazyRoutePlannerImplementation;

export const createCandidatePlanner: typeof import('./index-types.ts').createCandidatePlanner =
  createCandidatePlannerImplementation;
