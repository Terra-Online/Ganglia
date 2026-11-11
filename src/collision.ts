import { createCollisionWorld as createCollisionWorldImplementation } from './collision-implementation.ts';

export type * from './collision-types.ts';

export const createCollisionWorld: typeof import('./collision-types.ts').createCollisionWorld =
  createCollisionWorldImplementation;
