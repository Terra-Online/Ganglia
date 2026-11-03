import type { Surface } from './index.d.ts';
export interface CollisionGeometry {
  /** World-space triangle positions, xyz packed; outward normals, metres. */
  positions: number[] | Float32Array | Float64Array;
  indices: number[] | Uint16Array | Uint32Array;
}
export interface BuildOptions {
  profile: { radius: number; height: number };
  /** Degrees, greater than 0 and less than 90. */
  maxSlope: number;
  /** Metres. Ordinary bidirectional links use the smaller limit. */
  stepUp: number;
  stepDown: number;
  /** Horizontal and vertical voxel dimensions in metres. */
  cellSize: number;
  cellHeight: number;
}
/** Offline voxel build from complete, state-selected collision geometry, including
 * obstacles and ceilings. No gap, jump or drop links are invented. Detail heights
 * are approximate within the voxel field. Callers retain build/profile bindings.
 * Throws for invalid inputs, excessive region size or a failed native build.
 */
export function buildGroundSurfaces(geometry: CollisionGeometry, options: BuildOptions): Promise<Surface[]>;
