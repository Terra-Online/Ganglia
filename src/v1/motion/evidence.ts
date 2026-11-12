import type { CollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { Approach, Arc } from '#@/src/v1/motion/jumps.ts';

const copyPoints = (points: Vec3[]) => points.map((point): Vec3 => [...point]);
const copyArc = (arc: Arc | null): Arc | null =>
  arc && { ...arc, points: copyPoints(arc.points), times: [...arc.times] };
const copyApproach = (approach: Approach | null): Approach | null =>
  approach && {
    launch: [...approach.launch],
    points: copyPoints(approach.points),
    distances: [...approach.distances],
  };

function createEvidence() {
  const motions = new Map<string, Arc | null>();
  const approaches = new Map<string, Approach | null>();
  const traces = new Map<string, Vec3[] | null>();
  return {
    approach(key: string, compute: () => Approach | null): Approach | null {
      if (!approaches.has(key)) {
        if (approaches.size >= 1024) approaches.delete(approaches.keys().next().value!);
        approaches.set(key, copyApproach(compute()));
      }
      return copyApproach(approaches.get(key)!);
    },
    arc(key: string, compute: () => Arc | null): Arc | null {
      if (!motions.has(key)) {
        if (motions.size >= 1024) motions.delete(motions.keys().next().value!);
        motions.set(key, copyArc(compute()));
      }
      return copyArc(motions.get(key)!);
    },
    trace(key: string, compute: () => Vec3[] | null): Vec3[] | null {
      if (!traces.has(key)) {
        if (traces.size >= 4096) traces.delete(traces.keys().next().value!);
        const points = compute();
        traces.set(key, points && copyPoints(points));
      }
      const points = traces.get(key)!;
      return points && copyPoints(points);
    },
  };
}

const worlds = new WeakMap<
  CollisionWorld,
  WeakMap<
    Surface[],
    {
      signature: string;
      portalBinding: object | string | undefined;
      evidence: ReturnType<typeof createEvidence>;
    }
  >
>();

// Evidence belongs to immutable collision/support snapshots. Query-local caches
// still own search state and logical budget charges; these maps only avoid work
// at an execution site. Copies keep returned route arrays outside the cache.
export function motionEvidence(
  world: CollisionWorld,
  surfaces: Surface[],
  signature: string,
  portalBinding?: object | string,
) {
  let snapshots = worlds.get(world);
  if (!snapshots) {
    snapshots = new WeakMap();
    worlds.set(world, snapshots);
  }
  let scope = snapshots.get(surfaces);
  if (scope?.signature !== signature || scope.portalBinding !== portalBinding) {
    scope = { signature, portalBinding, evidence: createEvidence() };
    snapshots.set(surfaces, scope);
  }
  return scope.evidence;
}
