import type { CollisionWorld } from './collision.d.ts';
export type Vec3 = [number, number, number];
export interface Node { id: string; position: Vec3 }
export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';
export interface BoostUse { id: string; multiplier: number; duration: number }
export interface SpeedBoost extends BoostUse { position: Vec3; interaction: InteractionGoal }
export interface Segment { boostExpiry?: number; boost?: BoostUse; mode: MovementMode; points: Vec3[]; times: number[]; connection?: string; gait?: 'run' | 'sprint' | 'dash'; requiredGait?: 'sprint' }
export interface Edge { from: string; to: string; cost: number; state: 'open' | 'closed' | 'unknown'; points: Vec3[]; mode?: MovementMode; times?: number[]; connection?: string; requiredGait?: 'sprint' }
export interface Graph { nodes: Node[]; edges: Edge[] }
export interface ResourceSearch { truncated: boolean; expanded: number; maxLabels: number; maxExpanded: number }
export type Route = { status: 'complete'; boosts?: (BoostUse & { position: Vec3; elapsed: number })[]; start: string; cost: number; arrivalCost: number; length: number; search?: ResourceSearch; goalHit?: { segment: number; time: number; position: Vec3 }; locomotion?: { initial: number; final: number; minimum: number; dashes?: number; dash?: { speed: number; duration: number; cooldown: number; cost: number }; search?: { truncated: boolean; maxLabels: number } }; points: Vec3[]; segments: Segment[] } | { status: 'unmapped' | 'no-verified-route'; search?: ResourceSearch };
export interface Wall {
  min: Vec3; max: Vec3; state: 'active' | 'inactive' | 'unknown'; padding?: number;
  /** Solid sphere, mutually exclusive with points and polygon. Bounds remain a
   * broad-phase enclosure. Padding expands the sphere uniformly. */
  sphere?: { center: Vec3; radius: number };
  /** Open, thin wall polyline. Mutually exclusive with polygon. */
  points?: [number, number][];
  /** Filled XZ ring extruded between min.y and max.y; closed implicitly. */
  polygon?: [number, number][];
}
export function route(graph: Graph, start: string, goal: string, constraints?: { walls: Wall[]; profile: { radius: number; height: number }; locomotion?: LocomotionOptions }): Route;
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
export function routeFrom(graph: Graph, starts: Arrival[], goal: string | string[], constraints?: { walls: Wall[]; profile: { radius: number; height: number }; locomotion?: LocomotionOptions }): Route;
export function projectPoint(surfaces: Surface[], position: Vec3, options: { maxVertical: number }): { surface: string; position: Vec3 } | null;
export interface GroundArrival { id: string; position: Vec3; cost: number; state: Arrival['state'] }
export interface GroundConnection {
  /** A collection action ends in flight and cannot be used as a transfer. */
  terminal?: true;
  /** Conditional trajectories are unavailable without the matching active boost. */
  requiredBoost?: string;
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
export interface GroundOptions { activeBoost?: string; speed: number; maxVertical: number; walls: Wall[]; profile: { radius: number; height: number }; connections?: GroundConnection[]; portals?: Portal[]; locomotion?: LocomotionOptions }
export function planGroundRoute(surfaces: Surface[], starts: GroundArrival[], goal: Vec3, options: GroundOptions): Route;

/** Explicit movement policy. No unverified game-specific energy defaults are inferred. */
export interface LocomotionOptions {
  /** Explicit limits for resource-state fallback search. */
  search?: { maxLabels?: number; maxExpanded?: number };
  speed: number;
  sprintSpeed: number;
  sprintAcceleration: number;
  /** Optional ground dash pulse, sharing the stamina pool and cooldown across actions. */
  dash?: { speed: number; duration: number; cooldown: number; cost: number };
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
  /** Reuse this snapshot's floor/interaction projector. Projection alone does not
   * establish body clearance, wall state or reachability. */
  project: ReturnType<typeof createGoalProjector>;
  plan(starts: GroundArrival[], goal: Vec3, query?: { interaction?: InteractionGoal; endpointTolerance?: number; connections?: GroundConnection[] }): Route;
};

/** Apply an explicit resource-feasible gait schedule to an existing continuous path.
 * Returns no-verified-route when a required non-ground entry gait cannot be established.
 */
export function retimeGroundRoute(route: Route, options: LocomotionOptions): Route;

/** Explicit source-derived interaction volume. No per-game defaults are supplied. */
/** Airborne collection goals finish at the first in-flight hit. */
export interface InteractionGoal { airborne?: boolean; radius: number; maxVertical?: number; facing?: Vec3; halfAngle?: number }
export function createGoalProjector(surfaces: Surface[]): (target: Vec3, options: { maxVertical: number; interaction?: InteractionGoal }) => { surface: string; position: Vec3; distance: number }[];
export function projectGoal(surfaces: Surface[], target: Vec3, options: { maxVertical: number; interaction?: InteractionGoal }): { surface: string; position: Vec3; distance: number }[];

export interface JumpModel {
  gravity: number; fallingGravity: number; maxJumpHeight: number;
  maxFallingSpeed: number; apexTime: number; maxHorizontalSpeed: number;
  airAcceleration?: number; airDeceleration?: number;
  /** Optional jump impulse ceiling and decay of speed above the sustained air limit. */
  startHorizontalSpeed?: number; airOverspeedDeceleration?: number;
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
  /** Final jump continuation after a speed boost expires. */
  expireAfter?: number; expiredHorizontalSpeed?: number;
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
interface FieldWork {
  /** True when roots, the base graph or existing actions required a full restart. */
  reset: boolean;
  expanded: number;
  /** Outgoing edges visited from expanded labels. */
  edgeChecks: number;
  relaxed: number;
  /** Current reachable labels; a complete distance-field pass visits this many nodes. */
  reachableNodes: number;
}
/** Search collision-checked alternatives to an existing route, including same-component jumps and drops. */
export interface ShortcutDiagnostics { reason: string; baselineCost: number; boundaryEdges: number; seedChecks: number;
    candidatePairs: number; neighbourChecks: number; endpointChecks: number; attempted: number;
    accepted: number; truncated: boolean; goalFaces: number;
    rejected: { support: number; projection: number; clearance: number; range: number; motion: number; groundDominated: number };
    limits: { seedChecks: number; neighbourChecks: number; endpointChecks: number; arcAttempts: number; maxLinks: number };
    distanceFields?: { approach: FieldWork; departure: FieldWork };
}
interface FrontierDiagnostics extends Omit<ShortcutDiagnostics, 'baselineCost'> { baselineCost: null }
export function findJumpShortcuts(surfaces: Surface[], world: CollisionWorld,
  options: DiscoveryOptions & { baseline: Extract<Route, { status: 'complete' }>; speed: number; connections?: GroundConnection[] }): {
  connections: GroundConnection[];
  diagnostics: ShortcutDiagnostics;
};

export interface JumpRouteOptions extends GroundOptions {
  boosts?: SpeedBoost[];
  /** Optimistic coarse direction samples. At most 128 finite positions. These only
   * guide action discovery; the final route need not visit them. */
  waypoints?: Vec3[];
  onProgress?: (progress: { phase: 'direction-search' | 'device-entry-search'; completed: number; total: number;
    status?: Route['status']; connections?: number }) => void;
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
  /** Optional broad improvement budget after reachability succeeds. Zero keeps the first
   * feasible route; omitted uses the remaining discovery budget. An incumbent-local
   * comparison may use up to 128 additional candidates from the overall remaining budget. */
  maxShortcutCandidates?: number;
  maxLinks: number;
}
/** Joint ground/jump/drop action selection with a monotone complete-route incumbent.
 * After primary failure, each topologically distinct known-action entry can receive
 * an additional maxCandidates query. Progress and diagnostics expose those phases.
 * Sampling limits remain explicit; returned completion does not establish global optimality.
 */
interface FlightDiagnostics { attempted: number; nominalHits: number; hits: number; approaches: number; truncated: boolean }
export interface JumpDiagnostics {
  boosts?: { id: string; status: string; duration: number; multiplier: number; elapsed?: number; truncated?: boolean }[];
  airborne?: FlightDiagnostics;
  strategy: 'surface-action-graph'; groundStatus: Route['status']; baselineCost: number | null;
  selectedCost: number | null; truncated: boolean;
  searches: (DiscoveryDiagnostics | ShortcutDiagnostics | FrontierDiagnostics)[];
  /** Additional bounded entry queries after primary feasibility fails. */
  deviceApproaches?: { budgetPerGoal: number; goals: number; searches: {
    device: string; status: Route['status']; discovery: JumpDiagnostics;
  }[] };
  directions?: { requestedGoals: number; regions: number; budgetPerGoal: number; remaining: number; searches: {
    point: Vec3; support?: Vec3; status: Route['status']; added: number; diagnostics?: JumpDiagnostics;
  }[] };
}
export function planJumpRoute(surfaces: Surface[], world: CollisionWorld, starts: GroundArrival[],
  goal: Vec3, options: JumpRouteOptions): {
    route: Route;
    connections: GroundConnection[];
    diagnostics: JumpDiagnostics;
  };

/** Unknown edge costs are optimistic lower bounds in seconds. The planner
 * retains validation results for later calls. Input nodes and edges must remain
 * immutable. Concurrent calls are rejected. */
export function createLazyRoutePlanner(graph: Graph): {
  plan(starts: Arrival[], goal: string | string[], options: {
    validate: (edge: Edge, index: number) => Promise<Edge | null>;
    maxValidations?: number;
    signal?: AbortSignal;
  }): Promise<{
    status: 'complete' | 'incomplete' | 'unmapped' | 'no-verified-route';
    reason?: 'aborted' | 'validation-budget';
    route?: Extract<Route, { status: 'complete' }>;
    validation: { attempted: number; pending: number };
  }>;
};

export interface CandidateEdge {
  mode?: string;
  device?: string;
  index: number;
  from: string;
  to: string;
  points: Vec3[];
  unresolved: boolean;
}
/** Produces navigation proposals requiring physical verification at every segment.
 * score ranks discovery effort and must never be displayed as travel time. */
export function createCandidatePlanner(data: {
  surfaces: Surface[];
  options: Pick<GroundOptions, 'speed' | 'maxVertical' | 'portals'>;
}, options?: {
  radius?: number;
  verticalRange?: number;
  transferPenalty?: number;
  ascentPenalty?: number;
  endpointRadius?: number;
  connections?: { from: string; to: string; points: Vec3[]; mode?: string; device?: string }[];
}): {
  reject(indices: number[]): void;
  plan(arrivals: GroundArrival[], goal: Vec3, query?: { excludedEdges?: number[] }): {
    status: 'candidate';
    arrival: GroundArrival;
    points: Vec3[];
    path: CandidateEdge[];
    unresolved: CandidateEdge[];
    score: number;
  } | { status: 'unmapped' | 'no-candidate' };
};
