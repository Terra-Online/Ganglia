import type { CollisionOptions } from '#@/src/geo/collision.ts';
import type { Vec3, Surface, CollisionGeometry } from '#@/src/geo/geometry.ts';
import type { Portal } from '#@/src/geo/geometry.ts';
import type { Wall } from '#@/src/geo/walls.ts';
import type { InteractionGoal } from '#@/src/motion/goals.ts';
import type { JumpModel } from '#@/src/motion/jumps.ts';
import type { LocomotionOptions } from '#@/src/resource/locomotion.ts';
import type { SpeedBoost } from '#@/src/route/boosted-route.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route/ground.ts';
import type { Route } from '#@/src/route/routes.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';

/** One immutable physical snapshot. Keep inputs unchanged until close(). */
export interface SceneInput {
  surfaces: Surface[];
  collision: CollisionGeometry;
  collisionOptions?: CollisionOptions;
  walls: Wall[];
  connections?: GroundConnection[];
  portals?: Portal[];
  boosts?: SpeedBoost[];
  movement: {
    activeBoost?: string;
    speed: number;
    maxVertical: number;
    profile: { radius: number; height: number };
    locomotion?: LocomotionOptions;
    model: JumpModel;
    runAirSpeed: number;
    maxSlope: number;
    maxDrop: number;
    maxHorizontalDistance: number;
  };
}

export type SolverConfig = GangliaV1Config;

export interface RouteQuery {
  starts: GroundArrival[];
  goal: Vec3;
  interaction?: InteractionGoal;
  waypoints?: Vec3[];
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
  readonly config: SolverConfig;
  /** Fresh search state; immutable preparation and geometry proofs may be reused.
   * No completed-route cache. Inputs remain unchanged until the promise settles. */
  solve(query: RouteQuery, options?: SolveOptions): Promise<RouteResult>;
  /** One whole-workload submission. Implementations choose scheduling and may
   * solve in parallel. Results correspond to input order, including unavailable
   * and truncated results. Each request has its own search budget and state. */
  solveBatch(
    queries: readonly RouteQuery[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly RouteResult[]>;
  /** Await submitted work before closing. Idempotent; later solves reject. */
  close(): Promise<void>;
}
