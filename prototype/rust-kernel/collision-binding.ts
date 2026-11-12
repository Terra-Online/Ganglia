import { createRequire } from 'node:module';

export interface NativeCollisionIndex {
  /** Empty result or [original triangle ID, distance from the swept axis]. */
  sweepCapsule(
    start: Float64Array,
    end: Float64Array,
    radius: number,
    height: number,
    inflation: number,
  ): Float64Array;
  /** Empty result or [original triangle ID, support height, normal X, normal Y, normal Z]. */
  groundAt(
    position: Float64Array,
    maxUp: number,
    maxDown: number,
    maxSlope: number,
    radius: number,
    minimumUp: number,
  ): Float64Array;
  /** Rectangle is [min X, min Z, max X, max Z]; IDs retain source input order. */
  trianglesInBounds(rectangle: Float64Array): Uint32Array;
}

export const { CollisionIndex } = createRequire(import.meta.url)(
  '../../.local/cache/rust-transfers/transfer.node',
) as {
  CollisionIndex: new (
    positions: Float64Array,
    indices: Uint32Array,
    /** Empty for unbounded, otherwise [min X, min Z, max X, max Z]. */
    bounds: Float64Array,
  ) => NativeCollisionIndex;
};
