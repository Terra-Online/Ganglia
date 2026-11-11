import type { Surface, Vec3 } from '../geo/geometry.ts';
import type { Wall } from '../geo/walls.ts';
import { createGoalProjector } from '../motion/goals.ts';
import type { InteractionGoal } from '../motion/goals.ts';
import type { LocomotionOptions } from '../resource/locomotion.ts';
import { pruneGroundDetours } from '../route/ground-detours.ts';
import { createGroundPlanner, type GroundOptions, type GroundArrival } from '../route/ground.ts';
import type { Route } from '../route/routes.ts';
import { physicalWork, type PhysicalWork } from './physical/work.ts';
import { composeRoutes } from './route-result.ts';
type Complete = Extract<Route, { status: 'complete' }>;
export interface WindowRequest {
  scene: string;
  source: unknown;
  arrival: GroundArrival & { groundRange?: [number, number] };
  target: Vec3;
  interaction?: InteractionGoal;
  walls: Wall[];
  waypoints?: Vec3[];
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
  route(job: Job): { route?: Route; reason?: string };
}
export type WindowConfig = {
  tileSpan: number;
  gridSpan: number;
  maxTiles: number;
  margin: number;
  locomotion: LocomotionOptions;
  /** Vertical candidate projection allowance. Horizontal deviation stays within 0.5 m. */
  maxTargetError?: number;
  /** Unknown/action trajectories are indivisible; only ground guide spans may be split. */
  transfers?: Vec3[][];
};
const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Poll one bounded region at a time. Candidate points only select windows;
 * completion requires physical routes and one continuous resource schedule. */
export function createWindowRoute<Request extends WindowRequest, Job extends WindowJob>(
  builder: WindowResources<Request, Job>,
  request: Request,
  points: Vec3[],
  settings: WindowConfig,
) {
  const physicalTileSpan = settings.tileSpan;
  const gridSpan = settings.gridSpan;
  const tiles = (a: Vec3, b: Vec3, margin: number) =>
    [0, 2].reduce(
      (count, axis) =>
        count *
        (Math.ceil(
          (Math.ceil((Math.max(a[axis], b[axis]) + margin) / gridSpan) * gridSpan) /
            physicalTileSpan,
        ) -
          Math.floor(
            (Math.floor((Math.min(a[axis], b[axis]) - margin) / gridSpan) * gridSpan) /
              physicalTileSpan,
          )),
      1,
    );
  if (
    !Number.isFinite(settings.tileSpan) ||
    settings.tileSpan <= 0 ||
    !Number.isFinite(settings.gridSpan) ||
    settings.gridSpan <= 0 ||
    !points.length ||
    points.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
    !Number.isInteger(settings.maxTiles) ||
    settings.maxTiles < 1 ||
    settings.maxTiles > 512 ||
    !Number.isFinite(settings.margin) ||
    settings.margin <= 0
  )
    throw new Error('Invalid route window settings');
  const protectedEdges = new Set(
    (settings.transfers ?? []).flatMap((path) =>
      path.slice(1).map((p, i) => JSON.stringify([path[i], p])),
    ),
  );
  const candidates: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i],
      previous = points[i - 1];
    // Ground straightening can leave a kilometre-long guide edge. Window
    // boundaries must not depend on the original polygon-centre density.
    const steps =
      previous && !protectedEdges.has(JSON.stringify([previous, point]))
        ? Math.max(
            1,
            Math.ceil(
              Math.hypot(point[0] - previous[0], point[2] - previous[2]) / (physicalTileSpan / 2),
            ),
          )
        : 1;
    if (previous)
      for (let step = 1; step < steps; step++)
        candidates.push(interpolate(previous, point, step / steps));
    candidates.push([...point]);
  }
  if (distance(candidates.at(-1)!, request.target) > 1e-6) candidates.push([...request.target]);
  const pieces: Complete[] = [];
  const evidence: unknown[] = [];
  const failures = new Map<string, string>();
  let projectionData: { key: string; surfaces: Surface[]; options: GroundOptions } | undefined;
  let cursor = 0,
    end = -1,
    stage = 0,
    expansion = 0,
    running = false;
  let position = request.arrival.position;
  const windowBounds = (last: number) => {
    const min: Vec3 = [...position],
      max: Vec3 = [...position];
    for (let i = cursor; i <= last; i++)
      for (const axis of [0, 2]) {
        min[axis] = Math.min(min[axis], candidates[i][axis]);
        max[axis] = Math.max(max[axis], candidates[i][axis]);
      }
    return { min, max };
  };
  const stages = ['walking', 'devices', 'all'] as const;
  const progress = (status: 'pending' | 'incomplete', reason?: string) => ({
    status,
    reason,
    completedWindows: evidence.length,
    cursor,
    position,
    pieces: [...pieces],
    evidence: [...evidence],
    failures: [...failures],
    window: {
      firstPoint: cursor,
      lastPoint: end,
      points: candidates.slice(cursor, end + 1),
      stage: stages[stage],
      start: position,
      target: candidates[end],
      margin: settings.margin * (expansion + 1),
    },
  });
  let tail: ReturnType<typeof createWindowRoute<Request, Job>> | undefined;
  return {
    async advanceTail(): Promise<
      | ReturnType<typeof progress>
      | { status: 'incomplete'; reason: string }
      | { status: 'partial'; route: Complete; start: Vec3; end: Vec3; evidence: unknown[] }
    > {
      if (!tail) {
        let first = candidates.length - 1;
        const target = candidates.at(-1)!;
        const min: Vec3 = [...target],
          max: Vec3 = [...target];
        while (first > 0) {
          const point = candidates[first - 1];
          for (const axis of [0, 2]) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
          }
          if (tiles(min, max, settings.margin) > settings.maxTiles) break;
          first--;
        }
        if (first === candidates.length - 1)
          return { status: 'incomplete' as const, reason: 'tail-coverage-budget' };
        tail = createWindowRoute(
          builder,
          {
            ...request,
            arrival: {
              id: 'target-approach',
              position: candidates[first],
              cost: 0,
              state: 'available',
            },
          },
          candidates.slice(first + 1),
          settings,
        );
      }
      const result = await tail.advance();
      return result.status === 'complete'
        ? {
            status: 'partial' as const,
            route: result.route,
            start: result.route.points[0],
            end: result.route.points.at(-1)!,
            evidence: result.evidence,
          }
        : result;
    },
    async advance({
      maxWindows = Infinity,
      signal,
    }: { maxWindows?: number; signal?: AbortSignal } = {}): Promise<
      | ReturnType<typeof progress>
      | { status: 'complete'; route: Complete; pieces: Complete[]; evidence: unknown[] }
    > {
      if (running) throw new Error('Window query already running');
      running = true;
      try {
        if (signal?.aborted) return progress('incomplete', 'aborted');
        while (cursor < candidates.length - 1 && distance(position, candidates[cursor]) <= 1e-6)
          cursor++;
        if (cursor >= candidates.length) {
          const route = composeRoutes(pieces, settings.locomotion);
          return route.status === 'complete'
            ? { status: 'complete' as const, route, pieces: [...pieces], evidence: [...evidence] }
            : progress('incomplete', 'resource-schedule');
        }
        if (evidence.length >= maxWindows) return progress('incomplete', 'window-budget');
        const margin = settings.margin * (expansion + 1);
        if (end < cursor) {
          end = cursor;
          const bounds = windowBounds(end);
          while (end + 1 < candidates.length) {
            const next = candidates[end + 1];
            for (const axis of [0, 2]) {
              bounds.min[axis] = Math.min(bounds.min[axis], next[axis]);
              bounds.max[axis] = Math.max(bounds.max[axis], next[axis]);
            }
            if (tiles(bounds.min, bounds.max, margin) > settings.maxTiles) break;
            end++;
          }
        }
        const target = candidates[end];
        const bounds = windowBounds(end);
        if (tiles(bounds.min, bounds.max, margin) > settings.maxTiles)
          return progress('incomplete', 'coverage-budget');
        const key = JSON.stringify([position, target, margin, stage]);
        if (failures.has(key)) return progress('incomplete', failures.get(key));
        const lower = (axis: number) =>
          Math.floor((bounds.min[axis] - margin) / gridSpan) * gridSpan;
        const min: [number, number] = [lower(0), lower(2)];
        const upper = (axis: number) =>
          Math.ceil((bounds.max[axis] + margin) / gridSpan) * gridSpan;
        const max: [number, number] = [upper(0), upper(2)];
        const cells: Corridor['tiles'] = [];
        for (
          let x = Math.floor(min[0] / physicalTileSpan);
          x < Math.ceil(max[0] / physicalTileSpan);
          x++
        )
          for (
            let z = Math.floor(min[1] / physicalTileSpan);
            z < Math.ceil(max[1] / physicalTileSpan);
            z++
          )
            cells.push({ x, z });
        const corridor: Corridor = {
          kind: 'corridor-proposal',
          bounds: { min, max },
          tiles: cells,
          coarse: {
            regions: 0,
            edges: 0,
            path: [position, ...candidates.slice(cursor, end + 1)],
            halo: margin,
          },
        };
        const ground = await builder.query(request.scene, request.source, position, target, {
          startBuild: true,
          margin,
          corridor,
        });
        if (!ground) return progress('incomplete', 'builder-unavailable');
        if (ground.status === 'failed') return progress('incomplete', ground.message);
        if (ground.status !== 'ready') return progress('pending');
        const final = end === candidates.length - 1;
        let supportedTarget = target;
        if (!final || !request.interaction) {
          if (projectionData?.key !== builder.key(ground)) {
            const data = await builder.ground(ground);
            projectionData = {
              key: builder.key(ground),
              surfaces: data.surfaces,
              options: data.options,
            };
          }
          const vertical = settings.maxTargetError ?? 3;
          const supports = createGoalProjector(projectionData.surfaces)(target, {
            maxVertical: vertical,
            interaction: { radius: Math.hypot(vertical, 0.5), maxVertical: vertical },
          });
          const support = supports.find(
            (hit) => Math.hypot(hit.position[0] - target[0], hit.position[2] - target[2]) <= 0.5,
          );
          if (support) supportedTarget = support.position;
        }
        const local: Request = {
          ...request,
          arrival: {
            ...request.arrival,
            position,
            cost: pieces.length ? 0 : request.arrival.cost,
            ...(pieces.length ? { groundRange: undefined } : {}),
          },
          target: supportedTarget,
          interaction: final ? request.interaction : undefined,
          waypoints: coarseWaypoints([corridor]),
        };
        const job = await builder.solve(
          ground,
          local,
          true,
          physicalWork(([0, 1, 2] as const)[stage]),
        );
        if (!job) return progress('incomplete', 'solver-unavailable');
        if (job.status === 'failed') return progress('incomplete', job.message);
        if (job.status !== 'ready') return progress('pending');
        if (signal?.aborted) return progress('incomplete', 'aborted');
        const result = builder.route(job);
        const route = result?.route;
        if (route?.status === 'complete') {
          const exit = route.points.at(-1)!;
          if (pieces.length && distance(position, route.points[0]) > 1e-4)
            return progress('incomplete', 'entry-discontinuity');
          if (
            !(final && request.interaction) &&
            (Math.abs(exit[1] - target[1]) > (settings.maxTargetError ?? 3) ||
              Math.hypot(exit[0] - target[0], exit[2] - target[2]) > 0.5)
          ) {
            failures.set(key, 'target-projection-error');
          } else {
            // A device excursion can start in the preceding window and
            // return to its ground corridor in this one. Compare that
            // whole excursion before accepting the new route fragment.
            const previous = pieces.at(-1);
            const segments = [...(previous?.segments ?? []), ...route.segments];
            let accepted = route;
            let detours: { replacements: number; queries: number } | undefined;
            const length = (previous?.length ?? 0) + route.length;
            const direct = distance(previous?.points[0] ?? route.points[0], exit);
            if (
              projectionData?.options &&
              (segments.some((s) => s.mode !== 'walk') ||
                length > direct + 2 * projectionData.options.profile.radius)
            ) {
              const joined: Complete = {
                ...route,
                start: previous?.start ?? route.start,
                arrivalCost: previous?.arrivalCost ?? route.arrivalCost,
                cost: (previous?.cost ?? 0) + route.cost,
                length: (previous?.length ?? 0) + route.length,
                points: previous ? [...previous.points, ...route.points.slice(1)] : route.points,
                segments,
                boosts: [...(previous?.boosts ?? []), ...(route.boosts ?? [])],
                ...(route.goalHit
                  ? {
                      goalHit: {
                        ...route.goalHit,
                        segment: (previous?.segments.length ?? 0) + route.goalHit.segment,
                      },
                    }
                  : {}),
              };
              const planner = createGroundPlanner(projectionData.surfaces, {
                ...projectionData.options,
                walls: [...projectionData.options.walls, ...request.walls],
                locomotion: settings.locomotion,
              });
              const pruned = pruneGroundDetours(joined, planner, settings.locomotion);
              detours = { replacements: pruned.replacements, queries: pruned.queries };
              if (pruned.replacements && pruned.route.status === 'complete') {
                if (previous) pieces.pop();
                accepted = pruned.route;
              }
            }
            pieces.push(accepted);
            evidence.push({ ...result, ...(detours ? { detours } : {}) });
            projectionData = undefined;
            position = exit;
            cursor = end + 1;
            end = -1;
            stage = 0;
            expansion = 0;
            return progress('pending');
          }
        } else failures.set(key, result?.reason ?? 'no-verified-route');
        if (stage < stages.length - 1) {
          stage++;
          return progress('pending');
        }
        if (expansion === 0) {
          expansion++;
          stage = 0;
          end = -1;
          return progress('pending');
        }
        // A long window can hide several independent action interfaces.
        // Resolve the nearer half before rejecting the whole corridor.
        if (end > cursor) {
          end = Math.floor((cursor + end) / 2);
          stage = 0;
          return progress('pending');
        }
        return progress('incomplete', failures.get(key));
      } finally {
        running = false;
      }
    },
  };
}

const coarseWaypoints = (corridors: Corridor[]): Vec3[] => {
  const paths = corridors.map((entry) => entry.coarse.path.slice(1, -1));
  const points: Vec3[] = [],
    seen = new Set<string>();
  for (let index = 0; index < Math.max(0, ...paths.map((path) => path.length)); index++) {
    for (const path of paths) {
      const point = path[index];
      if (!point) continue;
      const key = JSON.stringify(point);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push([...point]);
    }
  }
  if (points.length <= 128) return points;
  return Array.from(
    { length: 128 },
    (_, index) => points[Math.round((index * (points.length - 1)) / 127)],
  );
};
