export type * from './collision-types.js';
import { createCollisionWorld as createCollisionWorldImplementation } from './collision-implementation.js';
export const createCollisionWorld: typeof import('./collision-types.js').createCollisionWorld =
  createCollisionWorldImplementation;
