import type { Surface, Vec3, projectPoint as ProjectPoint } from './index-types.js';
import { projectPoint } from './surfaces.js';

type Projection = ReturnType<typeof ProjectPoint>;

// Device endpoints recur throughout action discovery. This cache belongs to one
// immutable support mesh; all projection inputs, including an explicit support
// identity, remain part of the key. Retain a bounded number of local projections.
export const createSupportProjector = (surfaces: Surface[], byId: Map<string, Surface>) => {
  const projections = new Map<string, Projection>();
  return (position: Vec3, maxVertical: number, surface?: string): Projection => {
    const key = JSON.stringify([
      position.map((value) => (Object.is(value, -0) ? '-0' : value)),
      maxVertical,
      surface,
    ]);
    if (projections.has(key)) return projections.get(key)!;
    const result = projectPoint(surface === undefined ? surfaces : [byId.get(surface)!], position, {
      maxVertical,
    });
    if (projections.size >= 2048) projections.delete(projections.keys().next().value!);
    projections.set(key, result);
    return result;
  };
};
