import type { CollisionOptions } from '../geo/collision.ts';
import type { Vec3, Surface, CollisionGeometry } from '../geo/geometry.ts';
import type { GroundArrival, GroundConnection } from '../route/ground.ts';
import type { JumpRouteOptions } from '../route/jump-planner.ts';
import type { Route } from '../route/routes.ts';

/** One immutable physical snapshot. Keep inputs unchanged until close(). */
export interface SceneInput {
  surfaces: Surface[];
  collision: CollisionGeometry;
  collisionOptions?: CollisionOptions;
  walls: JumpRouteOptions['walls'];
  connections?: JumpRouteOptions['connections'];
  portals?: JumpRouteOptions['portals'];
  boosts?: JumpRouteOptions['boosts'];
  config: SolverConfig;
}

export interface SolverConfig {
  movement: Pick<
    JumpRouteOptions,
    | 'activeBoost'
    | 'speed'
    | 'maxVertical'
    | 'profile'
    | 'locomotion'
    | 'model'
    | 'runAirSpeed'
    | 'maxSlope'
    | 'maxDrop'
    | 'maxHorizontalDistance'
  >;
  search?: SearchBudget;
}

export type SearchBudget = Partial<
  Pick<JumpRouteOptions, 'sampleSpacing' | 'maxCandidates' | 'maxShortcutCandidates' | 'maxLinks'>
>;

export interface RouteQuery {
  starts: GroundArrival[];
  goal: Vec3;
  interaction?: JumpRouteOptions['interaction'];
  waypoints?: Vec3[];
  config?: { search?: SearchBudget };
}

export interface RouteResult {
  route: Route;
  connections: GroundConnection[];
  diagnostics: { truncated: boolean };
}

export interface PreparedRouteSolver {
  /** Fresh search state; immutable preparation and geometry proofs may be reused.
   * No completed-route cache. Inputs remain unchanged until the promise settles. */
  solve(query: RouteQuery): Promise<RouteResult>;
  /** One whole-workload submission. Implementations choose scheduling and may
   * solve in parallel. Results correspond to input order, including unavailable
   * and truncated results. Each request has its own search budget and state. */
  solveBatch(queries: readonly RouteQuery[]): Promise<readonly RouteResult[]>;
  /** Await submitted work before closing. Idempotent; later solves reject. */
  close(): Promise<void>;
}
