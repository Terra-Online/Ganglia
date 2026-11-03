import type { Vec3 } from './index.d.ts';
import type { CollisionGeometry } from './build.d.ts';
export interface Capsule { radius: number; height: number; inflation?: number }
export interface CollisionWorld {
  /** Exact vertical triangle support, with unchanged XZ coordinates. Height limits
   * are metres and maxSlope is degrees (greater than 0 and less than 90). Only
   * upward-facing triangles within the slope limit qualify. The closest height is
   * selected; equal distances prefer the higher surface. Capsule clearance, surface
   * state, initial occupancy and complete collision coverage remain caller checks.
   */
  groundAt(position: Vec3, options: { maxUp: number; maxDown: number; maxSlope: number }):
    { position: Vec3; triangle: number; normal: Vec3 } | null;
  /** Feet positions; upright capsule translated continuously along a straight segment.
   * Inflation enlarges the capsule in every direction, e.g. for a bounded curve deviation.
   * Any touching triangle is returned, not necessarily the earliest impact. Distance is
   * from the swept axis to that triangle. Null does not establish landing support, motion
   * feasibility, initial occupancy inside solids, active state or complete world coverage.
   */
  sweepCapsule(start: Vec3, end: Vec3, profile: Capsule): { triangle: number; distance: number } | null;
}
/** Snapshot and index double-sided thin triangle surfaces, without a WASM dependency.
 * Callers select active collision layers and start in verified free space.
 * Throws on malformed geometry or queries; does not mutate caller-owned arrays.
 */
export function createCollisionWorld(geometry: CollisionGeometry): CollisionWorld;
