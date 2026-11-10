import { createCollisionWorld as createCollisionWorldImplementation } from './collision-implementation.js';

export type * from './collision-types.js';

export const createCollisionWorld: typeof import('./collision-types.js').createCollisionWorld =
  createCollisionWorldImplementation;
