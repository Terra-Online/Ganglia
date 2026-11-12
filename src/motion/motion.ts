import type { Vec3 } from '#@/src/geo/geometry.ts';
import type { Route, Edge } from '#@/src/route/routes.ts';

export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';

export interface BoostUse {
  id: string;
  multiplier: number;
  duration: number;
}

export interface Segment {
  /** Authored traversal semantics; connection identifiers remain opaque to renderers. */
  traversal?: 'moving-support';
  boostExpiry?: number;
  boost?: BoostUse;
  mode: MovementMode;
  points: Vec3[];
  times: number[];
  connection?: string;
  gait?: 'run' | 'sprint' | 'dash';
  requiredGait?: 'sprint';
}

const modes = new Set<string>(['walk', 'rope', 'jump', 'drop', 'launch']);
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
// Shared by graph and grounded-connection import. Sample times are measured from
// segment entry, not global time; they preserve acceleration and pauses in a path.
export function validateMotion({
  mode = 'walk',
  points,
  times,
  cost,
  connection,
  requiredGait,
  boost,
}: Pick<Edge, 'points' | 'cost' | 'mode' | 'times' | 'connection' | 'requiredGait'> & {
  boost?: BoostUse;
}) {
  if (
    boost !== undefined &&
    (!boost ||
      typeof boost.id !== 'string' ||
      !boost.id ||
      !Number.isFinite(boost.multiplier) ||
      boost.multiplier <= 1 ||
      !Number.isFinite(boost.duration) ||
      boost.duration <= 0)
  )
    throw new Error('Invalid speed boost segment');
  if (
    !modes.has(mode) ||
    (connection !== undefined && (typeof connection !== 'string' || !connection)) ||
    (requiredGait !== undefined && (requiredGait !== 'sprint' || mode === 'walk'))
  ) {
    throw new Error('Invalid movement segment');
  }
  if (times === undefined) {
    if (mode !== 'walk') throw new Error('Non-walking movement requires sample times');
    return;
  }
  if (
    !Array.isArray(times) ||
    times.length !== points.length ||
    times[0] !== 0 ||
    !times.every(Number.isFinite) ||
    Math.abs(times.at(-1)! - cost) > 1e-7 ||
    (mode !== 'walk' && cost <= 0) ||
    times.some((t, i) => t < 0 || (i > 0 && t < times[i - 1])) ||
    times.some((t, i) => i > 0 && t === times[i - 1] && distance(points[i], points[i - 1]) > 1e-9)
  ) {
    throw new Error('Invalid movement timing');
  }
}
export function routeSegment(edge: Edge): Segment {
  const times = edge.times ? [...edge.times] : [0];
  if (!edge.times) {
    let length = 0;
    for (let i = 1; i < edge.points.length; i++) {
      length += distance(edge.points[i - 1], edge.points[i]);
      times.push(length);
    }
    for (let i = 1; i < times.length; i++)
      times[i] = length ? (times[i] / length) * edge.cost : edge.cost;
  }
  return {
    mode: edge.mode ?? 'walk',
    ...(edge.traversal === undefined ? {} : { traversal: edge.traversal }),
    points: edge.points.map((p): Vec3 => [...p]),
    times,
    ...(edge.connection === undefined ? {} : { connection: edge.connection }),
    ...(edge.requiredGait === undefined ? {} : { requiredGait: edge.requiredGait }),
  };
}
/** Sample the timed movement after the selected arrival has completed. Entry/teleport
 * overhead stays in route.arrivalCost; no flight is drawn from the player's old position.
 * This interpolates supplied trajectory samples, not a newly fitted parabola or spline.
 */
export function sampleJourney(
  route: Extract<Route, { status: 'complete' }>,
  seconds: number,
): { position: Vec3; mode: MovementMode | 'complete'; connection?: string } {
  if (route.status !== 'complete' || !Number.isFinite(seconds))
    throw new Error('Invalid journey sample');
  let remaining = Math.max(0, seconds);
  for (const segment of route.segments) {
    const duration = segment.times.at(-1)!;
    if (remaining < duration) {
      for (let i = 1; i < segment.times.length; i++) {
        if (remaining < segment.times[i]) {
          const fraction =
            (remaining - segment.times[i - 1]) / (segment.times[i] - segment.times[i - 1]);
          return {
            mode: segment.mode,
            position: [
              segment.points[i - 1][0] +
                (segment.points[i][0] - segment.points[i - 1][0]) * fraction,
              segment.points[i - 1][1] +
                (segment.points[i][1] - segment.points[i - 1][1]) * fraction,
              segment.points[i - 1][2] +
                (segment.points[i][2] - segment.points[i - 1][2]) * fraction,
            ] satisfies Vec3,
            ...(segment.connection === undefined ? {} : { connection: segment.connection }),
          };
        }
      }
    }
    remaining -= duration;
  }
  return { mode: 'complete', position: [...route.points.at(-1)!] };
}
