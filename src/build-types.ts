import type { Surface } from './index-types.js';
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
 * Excessive vertical extent is split only at empty potential-support height gaps,
 * retaining overlapping collision for clearance and world-aligned voxel heights.
 * No ground seam is inferred across independently sampled height contours.
 * Throws for invalid inputs, excessive horizontal size, continuous support spanning
 * the vertical voxel limit, more than 512 height partitions or a failed native build.
 */
export declare function buildGroundSurfaces(
  geometry: CollisionGeometry,
  options: BuildOptions,
): Promise<Surface[]>;

/** Importer-owned cache of padded native support meshes. Keys must bind exact
 * ordered geometry, body, voxel/step settings, source and generator identity.
 * Store the supplied mesh before core clipping; do not cache cross-tile portals.
 */
export interface TileCache {
  load(geometry: CollisionGeometry, options: BuildOptions): Promise<Surface[] | null>;
  save(geometry: CollisionGeometry, options: BuildOptions, surfaces: Surface[]): Promise<void>;
}

/** Padded physical builds clipped to one global tile grid. All selected input geometry
 * must cover the requested region plus padding. Failed tiles abort the complete result.
 */
export declare function buildGroundTiles(
  geometry: CollisionGeometry,
  options: BuildOptions & {
    bounds: { min: [number, number]; max: [number, number] };
    tileCells: number;
    /** Optional sparse selection on the same global grid. Unselected tiles remain
     * unmapped, never blocked or granted access. At most 512 unique tiles. */
    tiles?: { x: number; z: number }[];
    cache?: TileCache;
    onTile?: (progress: {
      x: number;
      z: number;
      completed: number;
      total: number;
      surfaces: number;
      cached: boolean;
      elapsedMs: number;
    }) => void;
  },
): Promise<{
  surfaces: Surface[];
  portals: import('./index-types.js').Portal[];
  tiles: {
    x: number;
    z: number;
    bounds: { min: [number, number]; max: [number, number] };
    surfaces: number;
  }[];
}>;
