import {
  boundsRoot,
  type Bounds,
  type BoundsIndex,
  type BoundsNode,
} from '#@/src/v1/geo/bounds.ts';
import type { JumpEnvelopeOptions } from '#@/src/v1/reach/reachability.ts';

export interface LandingNearestQuery {
  bounds: Bounds;
  target: readonly number[];
  anchor: readonly number[];
  envelope: JumpEnvelopeOptions;
  cost?: {
    approachTime: number;
    inset: number;
    radius: number;
    airSpeed: number;
    boundSpeed: number;
    goal: readonly number[];
    limit: number;
  };
}
export interface LandingEnumerationFactory {
  <T extends Bounds, G>(tree: BoundsNode<T, G>, query: LandingNearestQuery): Generator<T>;
}
let prototypeEnumeration: LandingEnumerationFactory | undefined;
export function installLandingEnumerationPrototype(factory?: LandingEnumerationFactory) {
  const previous = prototypeEnumeration;
  prototypeEnumeration = factory;
  return previous;
}

/** One landing stream; witness generation and logical budget charges stay in discovery. */
export function nearestLanding<T extends Bounds, G>(
  index: BoundsIndex<T, G>,
  query: LandingNearestQuery,
  intersects: (box: Bounds) => boolean,
): Generator<T> {
  const root = prototypeEnumeration && boundsRoot(index);
  return root
    ? prototypeEnumeration!(root, query)
    : index.nearest(query.bounds, query.target, intersects);
}
