import type { CollisionWorld } from './collision.d.ts';
export type Vec3 = [number, number, number];
export interface Node { id: string; position: Vec3 }
export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';
export interface Segment { mode: MovementMode; points: Vec3[]; times: number[]; connection?: string; gait?: 'run' | 'sprint'; requiredGait?: 'sprint' }
export interface Edge { from: string; to: string; cost: number; state: 'open' | 'closed' | 'unknown'; points: Vec3[]; mode?: MovementMode; times?: number[]; connection?: string; requiredGait?: 'sprint' }
export interface Graph { nodes: Node[]; edges: Edge[] }
export type Route = { status: 'complete'; start: string; cost: number; arrivalCost: number; length: number; locomotion?: { initial: number; final: number; minimum: number; search?: { truncated: boolean; maxLabels: number } }; points: Vec3[]; segments: Segment[] } | { status: 'unmapped' | 'no-verified-route' };
export interface Wall {
  min: Vec3; max: Vec3; state: 'active' | 'inactive' | 'unknown'; padding?: number;
  /** Open, thin wall polyline. Mutually exclusive with polygon. */
  points?: [number, number][];
  /** Filled XZ ring extruded between min.y and max.y; closed implicitly. */
  polygon?: [number, number][];
}
export function route(graph: Graph, start: string, goal: string, constraints?: { walls: Wall[]; profile: { radius: number; height: number } }): Route;
export function sampleRoute(points: Vec3[], meters: number): Vec3;
/** Elapsed seconds after arrival; never includes a teleport flight. */
export function sampleJourney(route: Extract<Route, {status: 'complete'}>, seconds: number): { position: Vec3; mode: MovementMode | 'complete'; connection?: string };
export function blockedByWalls(start: Vec3, end: Vec3, walls: Wall[], profile: { radius: number; height: number }): boolean;
/** Snapshot all wall records and one body profile for repeated segment queries.
 * Later mutations require a new checker. Inactive records are validated too.
 */
export function createWallChecker(walls: Wall[], profile: { radius: number; height: number }): (start: Vec3, end: Vec3, inflation?: number) => boolean;
export interface Surface { id: string; vertices: Vec3[]; portals?: number[] }
export interface Portal {
  from: string; to: string; points: [Vec3, Vec3];
  /** Paired boundary intervals in matching XZ order. Omit both for a point transfer. */
  entry?: [Vec3, Vec3];
  exit?: [Vec3, Vec3];
}
export function surfaceGraph(surfaces: Surface[], options: { speed: number; portals?: Portal[] }): Graph;

export interface Arrival { id: string; node: string; cost: number; state: 'available' | 'locked' | 'unknown' }
export function routeFrom(graph: Graph, starts: Arrival[], goal: string | string[], constraints?: { walls: Wall[]; profile: { radius: number; height: number } }): Route;
export function projectPoint(surfaces: Surface[], position: Vec3, options: { maxVertical: number }): { surface: string; position: Vec3 } | null;
export interface GroundArrival { id: string; position: Vec3; cost: number; state: Arrival['state'] }
export interface GroundConnection {
  id: string; mode: Exclude<MovementMode, 'walk'>; points: Vec3[]; times: number[];
  state: 'open' | 'closed' | 'unknown';
  /** Explicit collision-support allowance, bounded by maxVertical and body radius. Defaults to 1e-6 m. */
  endpointTolerance?: number;
  /** Non-ground entry condition, checked against active gait by the locomotion scheduler.
   * Ground planners exclude this connection when no locomotion policy is supplied.
   */
  requiredGait?: 'sprint';
  /** Optional explicit support faces, validated at the authored endpoint tolerance. */
  fromSurface?: string;
  toSurface?: string;
}
export interface GroundOptions { speed: number; maxVertical: number; walls: Wall[]; profile: { radius: number; height: number }; connections?: GroundConnection[]; portals?: Portal[]; locomotion?: LocomotionOptions }
export function planGroundRoute(surfaces: Surface[], starts: GroundArrival[], goal: Vec3, options: GroundOptions): Route;

/** Explicit movement policy. No unverified game-specific energy defaults are inferred. */
export interface LocomotionOptions {
  speed: number;
  sprintSpeed: number;
  sprintAcceleration: number;
  /** Movement modes that preserve an already active sprint across their authored trajectory. */
  sprintThrough?: Exclude<MovementMode, 'walk'>[];
  stamina?: {
    capacity: number;
    initial: number;
    activationCost?: number;
    sprintDrain?: number;
    recoveryDuringSprint?: boolean;
    recoveryDuringNonWalk?: boolean;
    recoveryRate: number;
    recoveryDelay: number;
    reserve: number;
  };
}
/** Reuse one prepared scene/state for arbitrary start/goal queries. Rebuild after mutations.
 * Continuous paths are ground-traced within reachable topology; global continuous optimality
 * across alternative corridors is not guaranteed.
 */
export function createGroundPlanner(surfaces: Surface[], options: GroundOptions): {
  plan(starts: GroundArrival[], goal: Vec3, query?: { interaction?: InteractionGoal; connections?: GroundConnection[] }): Route;
};

/** Apply an explicit resource-feasible gait schedule to an existing continuous path.
 * Returns no-verified-route when a required non-ground entry gait cannot be established.
 */
export function retimeGroundRoute(route: Route, options: LocomotionOptions): Route;

/** Explicit source-derived interaction volume. No per-game defaults are supplied. */
export interface InteractionGoal { radius: number; maxVertical?: number; facing?: Vec3; halfAngle?: number }
export function createGoalProjector(surfaces: Surface[]): (target: Vec3, options: { maxVertical: number; interaction?: InteractionGoal }) => { surface: string; position: Vec3; distance: number }[];
export function projectGoal(surfaces: Surface[], target: Vec3, options: { maxVertical: number; interaction?: InteractionGoal }): { surface: string; position: Vec3; distance: number }[];

export interface JumpModel {
  gravity: number; fallingGravity: number; maxJumpHeight: number;
  maxFallingSpeed: number; apexTime: number; maxHorizontalSpeed: number;
  airAcceleration?: number; airDeceleration?: number;
}
export function jumpDuration(startHeight: number, endHeight: number,
  options: Omit<JumpModel, 'maxHorizontalSpeed'> & { mode: 'jump' | 'drop' }): number | null;
export function jumpConnection(start: Vec3, end: Vec3, options: JumpModel & {
  profile: { radius: number; height: number }; mode: 'jump' | 'drop';
  sweep: CollisionWorld['sweepCapsule']; walls: Wall[]; clearance?: number;
  /** Fraction of displacement completed early, followed by a stop and late completion.
   * Requires explicit airAcceleration and airDeceleration. Omit for constant speed.
   */
  horizontalSplit?: number;
  /** Optional XZ air waypoint, reached early before the late landing leg. */
  horizontalWaypoint?: [number, number];
  /** Optional prepared checker for the same immutable walls and body profile. */
  wallCheck?: ReturnType<typeof createWallChecker>;
}): { mode: 'jump' | 'drop'; points: Vec3[]; times: number[]; motionValidation: 'model-based'; peakHorizontalSpeed?: number } | null;
export interface DiscoveryOptions {
  profile: { radius: number; height: number }; portals?: Portal[]; walls: Wall[];
  from: Vec3; to: Vec3; interaction?: InteractionGoal; maxVertical: number; maxSlope: number; maxDrop: number;
  maxHorizontalDistance: number; sampleSpacing: number; maxCandidates: number; maxLinks: number;
  model: JumpModel;
  /** Existing validated directed actions participate in proposal reachability. */
  connections?: GroundConnection[];
  groundPlanner?: ReturnType<typeof createGroundPlanner>;
}
export interface DiscoveryDiagnostics {
  reason: string; components: number; boundaryEdges: number; endpointChecks: number;
  standingEndpoints: number; neighbourChecks: number; pairChecks: number; candidatePairs: number;
  attempted: number; accepted: number; truncated: boolean;
  limits: { maxCandidates: number; maxLinks: number; arcAttempts: number; endpointChecks: number; neighbourChecks: number; pairChecks: number; seedChecks: number };
  regionSearches: number; regionPairs: number; validatedPairs: number; pairBatches: number; deferredPairs: number; generationBatches: number; seedChecks: number;
  goalFaces: number; goalComponents: number;
  rejected: { projection: number; support: number; clearance: number; range: number; motion: number };
  sourceEndpoints?: number; targetEndpoints?: number; sourceComponent?: number; targetComponent?: number;
  sourceCandidates?: number; directCandidates?: number; targetReached?: boolean;
}
/** Bounded discovery of model-based directed links. Truncation can leave valid routes undiscovered. */
export function findJumpConnections(surfaces: Surface[], world: CollisionWorld, options: DiscoveryOptions): {
  connections: (GroundConnection & { fromSurface: string; toSurface: string; motionValidation: 'model-based' })[];
  diagnostics: DiscoveryDiagnostics;
};
/** Search collision-checked alternatives to an existing route, including same-component jumps and drops. */
export interface ShortcutDiagnostics { reason: string; baselineCost: number; boundaryEdges: number; seedChecks: number;
    candidatePairs: number; neighbourChecks: number; endpointChecks: number; attempted: number;
    accepted: number; truncated: boolean; goalFaces: number;
    rejected: { support: number; projection: number; clearance: number; range: number; motion: number; groundDominated: number };
    limits: { seedChecks: number; neighbourChecks: number; endpointChecks: number; arcAttempts: number; maxLinks: number };
}
interface FrontierDiagnostics extends Omit<ShortcutDiagnostics, 'baselineCost'> { baselineCost: null }
export function findJumpShortcuts(surfaces: Surface[], world: CollisionWorld,
  options: DiscoveryOptions & { baseline: Extract<Route, { status: 'complete' }>; speed: number; connections?: GroundConnection[] }): {
  connections: GroundConnection[];
  diagnostics: ShortcutDiagnostics;
};

export interface JumpRouteOptions extends GroundOptions {
  /** Optional prepared planner for these same immutable surfaces and ground options.
   * Query connections override its initial connection set. */
  groundPlanner?: ReturnType<typeof createGroundPlanner>;
  interaction?: InteractionGoal;
  model: JumpModel;
  runAirSpeed: number;
  maxSlope: number;
  maxDrop: number;
  maxHorizontalDistance: number;
  sampleSpacing: number;
  maxCandidates: number;
  /** Optional improvement budget after reachability succeeds. Zero keeps the first
   * feasible route; omitted uses the remaining discovery budget. */
  maxShortcutCandidates?: number;
  maxLinks: number;
}
/** Joint ground/jump/drop action selection with a monotone complete-route incumbent.
 * Sampling limits remain explicit; returned completion does not establish global optimality.
 */
export function planJumpRoute(surfaces: Surface[], world: CollisionWorld, starts: GroundArrival[],
  goal: Vec3, options: JumpRouteOptions): {
    route: Route;
    connections: GroundConnection[];
    diagnostics: { strategy: 'surface-action-graph'; groundStatus: Route['status']; baselineCost: number | null;
      selectedCost: number | null; truncated: boolean; searches: (DiscoveryDiagnostics | ShortcutDiagnostics | FrontierDiagnostics)[] };
  };
