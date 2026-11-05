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
  /** Optional XZ build rectangle in world metres. Full input height is retained.
   * Region edges are clearance-eroded; adjacent builds are not automatically stitched.
   * Supply complete intersecting collision geometry, including outside-origin actors.
   */
  bounds?: { min: [number, number]; max: [number, number] };
}
/** Offline voxel build from complete, state-selected collision geometry, including
 * obstacles and ceilings. No gap, jump or drop links are invented. Detail heights
 * are approximate within the voxel field. Callers retain build/profile bindings.
 * Throws for invalid inputs, excessive region size or a failed native build.
 */
export function buildGroundSurfaces(geometry: CollisionGeometry, options: BuildOptions): Promise<Surface[]>;

/** Padded physical builds clipped to one global tile grid. All selected input geometry
 * must cover the requested region plus padding. Failed tiles abort the complete result.
 */
export function buildGroundTiles(geometry: CollisionGeometry, options: BuildOptions & {
  bounds: { min: [number, number]; max: [number, number] };
  tileCells: number;
  /** Optional sparse selection on the same global grid. Unselected tiles remain
   * unmapped, never blocked or granted access. At most 512 unique tiles. */
  tiles?: { x: number; z: number }[];
  onTile?: (progress: { x: number; z: number; completed: number; total: number; surfaces: number }) => void;
}): Promise<{
  surfaces: Surface[];
  portals: import('./index.d.ts').Portal[];
  tiles: { x: number; z: number; bounds: { min: [number, number]; max: [number, number] }; surfaces: number }[];
}>;
