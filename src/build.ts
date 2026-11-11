import { buildGroundSurfaces as buildGroundSurfacesImplementation } from './build-implementation.ts';
import { buildGroundTiles as buildGroundTilesImplementation } from './build-implementation.ts';

export type * from './build-types.ts';

export const buildGroundSurfaces: typeof import('./build-types.ts').buildGroundSurfaces =
  buildGroundSurfacesImplementation;

export const buildGroundTiles: typeof import('./build-types.ts').buildGroundTiles =
  buildGroundTilesImplementation;
