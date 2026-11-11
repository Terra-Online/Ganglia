export type Vec3 = [number, number, number];

export interface Surface {
  id: string;
  vertices: Vec3[];
  portals?: number[];
}

export interface Portal {
  from: string;
  to: string;
  points: [Vec3, Vec3];
  /** Paired boundary intervals in matching XZ order. Omit both for a point transfer. */
  entry?: [Vec3, Vec3];
  exit?: [Vec3, Vec3];
}

export interface CollisionGeometry {
  /** World-space triangle positions, xyz packed; outward normals, metres. */
  positions: number[] | Float32Array | Float64Array;
  indices: number[] | Uint16Array | Uint32Array;
}
