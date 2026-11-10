import { projectPoint } from './surfaces.js';
// Device endpoints recur throughout action discovery. This cache belongs to one
// immutable support mesh; all projection inputs, including an explicit support
// identity, remain part of the key. Retain a bounded number of local projections.
export const createSupportProjector = (surfaces: any, byId: any): any => {
  const projections = new Map<any, any>();
  return (position: any, maxVertical: any, surface?: any): any => {
    const key = JSON.stringify([
      position.map((value: any): any => (Object.is(value, -0) ? '-0' : value)),
      maxVertical,
      surface,
    ]);
    if (projections.has(key)) return projections.get(key);
    const result = projectPoint(surface === undefined ? surfaces : [byId.get(surface)], position, {
      maxVertical,
    });
    if (projections.size >= 2048) projections.delete(projections.keys().next().value);
    projections.set(key, result);
    return result;
  };
};
