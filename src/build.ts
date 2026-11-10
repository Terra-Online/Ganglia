import { buildGroundSurfaces as buildGroundSurfacesImplementation } from './build-implementation.js';
import { buildGroundTiles as buildGroundTilesImplementation } from './build-implementation.js';

export type * from './build-types.js';

export const buildGroundSurfaces: typeof import('./build-types.js').buildGroundSurfaces =
  buildGroundSurfacesImplementation;

export const buildGroundTiles: typeof import('./build-types.js').buildGroundTiles =
  buildGroundTilesImplementation;
