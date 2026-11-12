import type { Vec3, Surface, Wall } from '#@/src/geometry.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival, GroundOptions, Route } from '#@/src/route.ts';
import type { RouteQuery, RouteResult, SolverConfig } from '#@/src/solver/contract.ts';
/** Serialized work selected by Ganglia's orchestration. Resource adapters pass it
 * through unchanged and use the plan only for resource loading and scheduling. */
export type PhysicalWork = { readonly version: 1; readonly step: 0 | 1 | 2 };
type Complete = Extract<Route, { status: 'complete' }>;

export interface WindowRequest {
  scene: string;
  source: unknown;
  arrival: GroundArrival & { groundRange?: [number, number] };
  target: Vec3;
  interaction?: InteractionGoal;
  walls: Wall[];
  waypoints?: Vec3[];
  solverConfig?: SolverConfig;
}

export interface WindowJob {
  status: 'queued' | 'building' | 'ready' | 'failed';
  message?: string;
}

export interface Corridor {
  kind: 'corridor-proposal';
  bounds: { min: [number, number]; max: [number, number] };
  tiles: { x: number; z: number }[];
  coarse: { regions: number; edges: number; path: Vec3[]; halo: number };
}

export interface WindowResources<Request extends WindowRequest, Job extends WindowJob> {
  query(
    scene: string,
    source: Request['source'],
    start: number[],
    target: number[],
    options: { startBuild: boolean; margin: number; corridor: Corridor },
  ): Promise<Job | null>;
  solve(job: Job, request: Request, start: boolean, work: PhysicalWork): Promise<Job | null>;
  key(job: Job): string;
  ground(job: Job): Promise<{ surfaces: Surface[]; options: GroundOptions }>;
  route(job: Job): { route?: Route; reason?: string; diagnostics?: unknown };
}

export type SceneProposal =
  | {
      status: 'candidate';
      arrival: GroundArrival;
      points: Vec3[];
      path: { index: number; key?: string; points: Vec3[]; unresolved: boolean }[];
    }
  | { status: 'unmapped' | 'no-candidate' | 'cancelled'; reason?: string };

/** The adapter supplies only assets validated against this scene and movement snapshot. */
export interface SceneTerminal {
  id: string;
  route: Complete;
  supportBoxes?: RouteResult['supportBoxes'];
}

export interface SceneResources<Source, Job extends WindowJob> extends WindowResources<
  WindowRequest & { source: Source },
  Job
> {
  plan(
    starts: GroundArrival[],
    goal: Vec3,
    excludedEdges: (number | string)[],
    signal?: AbortSignal,
  ): Promise<SceneProposal>;
  terminals?(query: RouteQuery): Promise<readonly SceneTerminal[]>;
  /** Wait for resource work to change, without requiring another client request. */
  wait(signal?: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}
