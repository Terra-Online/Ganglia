import type { CollisionGeometry } from '../build-types.js';
import type { CollisionOptions } from '../collision-types.js';
import type {
  Surface,
  GroundArrival,
  Vec3,
  JumpRouteOptions,
  Route,
  GroundConnection,
  JumpDiagnostics,
} from '../index-types.js';

/** One immutable physical snapshot. Keep inputs unchanged until close(). */
export interface SceneInput {
  surfaces: Surface[];
  collision: CollisionGeometry;
  collisionOptions?: CollisionOptions;
  options: Omit<JumpRouteOptions, 'groundPlanner' | 'interaction' | 'waypoints' | 'onProgress'>;
}

export interface RouteQuery {
  starts: GroundArrival[];
  goal: Vec3;
  options?: Partial<
    Pick<
      JumpRouteOptions,
      | 'interaction'
      | 'waypoints'
      | 'connections'
      | 'maxCandidates'
      | 'maxShortcutCandidates'
      | 'maxLinks'
    >
  >;
}

export interface RouteResult {
  route: Route;
  connections: GroundConnection[];
  diagnostics: JumpDiagnostics;
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

export declare function prepareSurfaceActionSolver(input: SceneInput): Promise<PreparedRouteSolver>;
