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
  diagnostics: { truncated: boolean; candidateAttempts?: number };
  reason?: string;
  /** A verified target approach that does not yet connect to a requested start. */
  partial?: boolean;
  arrival?: GroundArrival;
  groundedTarget?: Vec3;
  supportBoxes?: {
    min: Vec3;
    max: Vec3;
    device: string;
    family: string;
    role: 'board' | 'leave' | 'use';
  }[];
}

export type RouteEvent =
  | {
      type: 'progress';
      phase: 'prepare' | 'search' | 'refine' | 'validate';
      completed?: number;
      total?: number;
    }
  | { type: 'candidate'; result: RouteResult; optimizing: boolean };
export interface SolveOptions {
  /** Cancellation is cooperative at preparation, search-progress and candidate checkpoints. */
  signal?: AbortSignal;
  onEvent?: (event: RouteEvent) => void;
}

export interface PreparedRouteSolver {
  /** Fresh search state; immutable preparation and geometry proofs may be reused.
   * No completed-route cache. Inputs remain unchanged until the promise settles. */
  solve(query: RouteQuery, options?: SolveOptions): Promise<RouteResult>;
  /** One whole-workload submission. Implementations choose scheduling and may
   * solve in parallel. Results correspond to input order, including unavailable
   * and truncated results. Each request has its own search budget and state. */
  solveBatch(
    queries: readonly RouteQuery[],
    options?: Pick<SolveOptions, 'signal'>,
  ): Promise<readonly RouteResult[]>;
  /** Await submitted work before closing. Idempotent; later solves reject. */
  close(): Promise<void>;
}
