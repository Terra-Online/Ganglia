import type { Surface, Vec3 } from '#@/src/index.ts';

/** world-axis-aligned bounds enclosing all collider bodies at one sampled pose */
export interface PoseBounds {
  min: Vec3;
  max: Vec3;
}

/** source pose interval of one body contributing a support face or transfer */
export interface PoseSpan {
  fromPose: number;
  toPose: number;
  body: number;
}

/** query-independent phase-free support, scoped to one moving body's authored path */
export interface SweptSupport {
  id: string;
  family: 'platform' | 'conveyor' | 'seesaw' | 'water-floater' | 'forklift';
  level: string;
  model: string;
  /** local authored control, retained alongside the fully-enabled planning assumption */
  control?: {
    kind: 'forklift';
    logicType: 24;
    start: Vec3;
    end: Vec3;
    speed: number;
    initialState: number;
    initiallyOn: boolean;
    assumption: 'fully-enabled';
  };
  /** world-axis-aligned endpoint boxes for illustration; separate from navigation support */
  endpoints?: {
    initial: PoseBounds;
    terminal: PoseBounds;
  };
  /** sampled whole-support boxes; translation spans permit interpolation, seesaw states remain discrete */
  poses?: PoseBounds[];
  surfaces: Surface[];
  /** parallel to surfaces, retaining every pose interval contributing a deduplicated face */
  surfacePoses?: PoseSpan[][];
  /** rides connect supported poses without making other times into solid obstacles */
  transfers: {
    from: Vec3;
    to: Vec3;
    speed: number | null;
    fromPose?: number;
    toPose?: number;
    body?: number;
  }[];
  assumption: 'phase-free-swept-support';
}

/**
 * @param bodies solid collider vertices in one world-space pose
 * @returns a copied box enclosing every body
 * @throws for missing geometry or nonfinite vertices
 */
export const supportBounds = (bodies: readonly Vec3[][] | undefined): PoseBounds => {
  if (!bodies?.length || bodies.some((body) => !body.length)) {
    throw new Error('missing moving support endpoint geometry');
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const body of bodies) {
    for (const point of body) {
      if (point.length !== 3 || !point.every(Number.isFinite)) {
        throw new Error('invalid moving support endpoint vertex');
      }
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  return { min, max };
};

/**
 * @param poses solid collider vertices in world space, grouped by body at each authored pose
 * @returns copied world bounds at the first and last poses, including closed paths with coincident ends
 * @throws for missing endpoint geometry or nonfinite endpoint vertices
 */
export const supportEndpoints = (
  poses: readonly (readonly Vec3[][])[],
): NonNullable<SweptSupport['endpoints']> => ({
  initial: supportBounds(poses[0]),
  terminal: supportBounds(poses.at(-1)),
});

const cross = (a: Vec3, b: Vec3, c: Vec3) =>
  (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);

const half = (list: Vec3[]) => {
  const chain: Vec3[] = [];
  for (const p of list) {
    while (chain.length > 1 && cross(chain.at(-2)!, chain.at(-1)!, p) <= 0) {
      chain.pop();
    }
    chain.push(p);
  }
  return chain.slice(0, -1);
};

const center = (vertices: Vec3[]): Vec3 => {
  const sum: Vec3 = [0, 0, 0];
  for (const point of vertices) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  return [sum[0] / vertices.length, sum[1] / vertices.length, sum[2] / vertices.length];
};

// each segment gets its own hull, so an L-shaped route never fills the inside of the bend.
const roof = (points: readonly Vec3[]): Vec3[] => {
  const height = Math.max(...points.map((p) => p[1]));
  const sorted = points
    .map((p) => [p[0], height, p[2]] as Vec3)
    .toSorted((a, b) => a[0] - b[0] || a[2] - b[2]);
  const unique = sorted.filter(
    (p, i) => !i || p[0] !== sorted[i - 1][0] || p[2] !== sorted[i - 1][2],
  );

  return [...half(unique), ...half(unique.toReversed())].toReversed();
};

/**
 * @param id stable source identity
 * @param bodies solid collider vertices at each sampled fixed-orientation translation pose, with identical
 *   body ordering
 * @param speed positive ride speed in metres per second, or null when timing is unresolved
 * @returns sweep roofs, endpoint caps and transfers with their source pose spans, without phase expansion
 * @throws for nonfinite geometry, unequal pose body counts or invalid speed
 */
export const sweepSupports = (id: string, bodies: Vec3[][][], speed: number | null) => {
  if (
    !bodies.length ||
    bodies.some(
      (pose) =>
        pose.length !== bodies[0].length ||
        pose.some(
          (body) =>
            body.length < 3 || body.some((p) => p.length !== 3 || !p.every(Number.isFinite)),
        ),
    ) ||
    (speed !== null && (!Number.isFinite(speed) || speed <= 0))
  ) {
    throw new Error('invalid moving support poses');
  }
  const surfaces: Surface[] = [];
  const surfacePoses: PoseSpan[][] = [];
  const transfers: SweptSupport['transfers'] = [];
  const poses = bodies[0].length ? bodies.map(supportBounds) : [];
  const seen = new Map<string, number>();
  const add = (vertices: Vec3[], span: PoseSpan) => {
    const key = JSON.stringify(vertices);
    if (vertices.length < 3) {
      return;
    }
    const index = seen.get(key);
    if (index !== undefined) {
      const previous = surfacePoses[index];
      if (
        !previous.some(
          (entry) =>
            entry.fromPose === span.fromPose &&
            entry.toPose === span.toPose &&
            entry.body === span.body,
        )
      ) {
        previous.push(span);
      }
      return;
    }
    seen.set(key, surfaces.length);
    surfaces.push({ id: `moving/${id}/${surfaces.length}`, vertices });
    surfacePoses.push([span]);
  };

  for (let body = 0; body < bodies[0].length; body++) {
    add(roof(bodies[0][body]), { body, fromPose: 0, toPose: 0 });
    for (let pose = 1; pose < bodies.length; pose++) {
      const a = roof(bodies[pose - 1][body]),
        b = roof(bodies[pose][body]);
      const from = center(a),
        to = center(b);
      add(a, { body, fromPose: pose - 1, toPose: pose - 1 });
      add(b, { body, fromPose: pose, toPose: pose });
      if (Math.hypot(...from.map((value, axis) => value - to[axis])) > 1e-9) {
        transfers.push({ from, to, speed, body, fromPose: pose - 1, toPose: pose });
      }
      // a purely vertical trip has caps and a ride, without a fictitious shaft wall.
      if (Math.hypot(from[0] - to[0], from[2] - to[2]) > 1e-9) {
        add(roof([...bodies[pose - 1][body], ...bodies[pose][body]]), {
          body,
          fromPose: pose - 1,
          toPose: pose,
        });
      }
    }
  }
  return { surfaces, surfacePoses, poses, transfers };
};

/** One movable support with an authored activity range, independent of its transport choreography. */
export interface FollowingSupport {
  id: string;
  level: string;
  model: string;
  spawn: Vec3;
  bodies: Vec3[][];
  geometryKind: 'box' | 'convex';
  /** Three-dimensional distance from the restored spawn, not an arbitrary endpoint. */
  maxDistance: number;
  initialState: number;
  assumption: 'placement-within-activity-range';
}
