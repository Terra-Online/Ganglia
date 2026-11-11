import { createCollisionWorld as createCollisionWorldImplementation } from './geo/collision.ts';

export type * from './collision-types.ts';

export const createCollisionWorld: typeof import('./collision-types.ts').createCollisionWorld =
  createCollisionWorldImplementation;
