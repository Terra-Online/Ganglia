export type * from './build-types.js';
import { buildGroundSurfaces as buildGroundSurfacesImplementation } from './build-implementation.js';
export const buildGroundSurfaces: typeof import('./build-types.js').buildGroundSurfaces =
  buildGroundSurfacesImplementation;
import { buildGroundTiles as buildGroundTilesImplementation } from './build-implementation.js';
export const buildGroundTiles: typeof import('./build-types.js').buildGroundTiles =
  buildGroundTilesImplementation;
