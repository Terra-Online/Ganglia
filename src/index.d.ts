export type Vec3 = [number, number, number];
export interface Node { id: string; position: Vec3 }
export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';
export interface Segment { mode: MovementMode; points: Vec3[]; times: number[]; connection?: string; gait?: 'run' | 'sprint' }
export interface Edge { from: string; to: string; cost: number; state: 'open' | 'closed' | 'unknown'; points: Vec3[]; mode?: MovementMode; times?: number[]; connection?: string }
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
export interface Surface { id: string; vertices: Vec3[]; portals?: number[] }
export function surfaceGraph(surfaces: Surface[], options: { speed: number }): Graph;

export interface Arrival { id: string; node: string; cost: number; state: 'available' | 'locked' | 'unknown' }
export function routeFrom(graph: Graph, starts: Arrival[], goal: string, constraints?: { walls: Wall[]; profile: { radius: number; height: number } }): Route;
export function projectPoint(surfaces: Surface[], position: Vec3, options: { maxVertical: number }): { surface: string; position: Vec3 } | null;
export interface GroundArrival { id: string; position: Vec3; cost: number; state: Arrival['state'] }
export interface GroundConnection { id: string; mode: Exclude<MovementMode, 'walk'>; points: Vec3[]; times: number[]; state: 'open' | 'closed' | 'unknown' }
export interface GroundOptions { speed: number; maxVertical: number; walls: Wall[]; profile: { radius: number; height: number }; connections?: GroundConnection[]; locomotion?: LocomotionOptions }
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
  plan(starts: GroundArrival[], goal: Vec3): Route;
};

/** Apply an explicit resource-feasible gait schedule to an existing continuous path. */
export function retimeGroundRoute(route: Route, options: LocomotionOptions): Route;
