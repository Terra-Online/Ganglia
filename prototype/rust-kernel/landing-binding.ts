import {
  startLandingDiagnostics,
  type LandingCounters,
} from '#@/prototype/rust-kernel/landing-diagnostics.ts';
import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { Bounds, BoundsNode } from '#@/src/v1/geo/bounds.ts';
import { flightReachSnapshot, type FlightReachSnapshot } from '#@/src/v1/reach/reachability.ts';
import type {
  LandingEnumerationFactory,
  LandingNearestQuery,
} from '#@/src/v1/search/landing-enumeration.ts';

interface NativeCursor {
  readBatch(limit: number): { ids: Uint32Array; done: boolean };
  close(): void;
}
interface NativeIndex {
  cursor(query: NativeQuery): NativeCursor;
}
interface NativeQuery {
  bounds: Float64Array;
  target: number[];
  anchor: number[];
  padding: number[];
  maxHorizontalDistance: number;
  rise: number;
  fall: number;
  tolerance: number;
  scale: number;
  cost?: {
    approachTime: number;
    inset: number;
    radius: number;
    airSpeed: number;
    boundSpeed: number;
    goal: number[];
    limit: number;
  };
}
const { LandingEnumerationIndex } = loadNativeLibrary() as {
  LandingEnumerationIndex: new (snapshot: {
    boxes: Float64Array;
    offsets: Uint32Array;
    children: Uint32Array;
    entryIds: Uint32Array;
    reachTable: Float64Array;
    minimumBin: number;
    gravity: number;
    fallingGravity: number;
    maxJumpHeight: number;
    maxFallingSpeed: number;
    apexTime: number;
    maxHorizontalSpeed: number;
    initial: number;
    deceleration?: number;
  }) => NativeIndex;
};
const none = 0xffffffff;
const diagnostics = startLandingDiagnostics(process.env.GANGLIA_RUST_LANDING_DIAGNOSTICS);
const encode = (
  root: BoundsNode<Bounds, unknown>,
  flight: FlightReachSnapshot,
  counts?: LandingCounters,
) => {
  const started = counts ? performance.now() : 0;
  const boxes: number[] = [],
    offsets = [0],
    children: number[] = [],
    entryIds: number[] = [];
  const entries: Bounds[] = [];
  // This is the filtered hierarchy itself. Retaining loose branch bounds and
  // child/leaf order is necessary for the nearest heap's equal-distance order.
  const pending: { box: Bounds; branch?: BoundsNode<Bounds, unknown> }[] = [
    { box: root, branch: root },
  ];
  for (let node = 0; node < pending.length; node++) {
    const { box: value, branch } = pending[node];
    boxes.push(...value.min, ...value.max);
    if (branch?.entries) {
      entryIds.push(none);
      for (const entry of branch.entries) {
        children.push(pending.length);
        pending.push({ box: entry });
      }
    } else if (branch) {
      entryIds.push(none);
      children.push(pending.length, pending.length + 1);
      pending.push(
        { box: branch.left, branch: branch.left },
        { box: branch.right, branch: branch.right },
      );
    } else {
      entryIds.push(entries.length);
      entries.push(value);
    }
    offsets.push(children.length);
  }
  const model = flight.model;
  const snapshot = {
    boxes: Float64Array.from(boxes),
    offsets: Uint32Array.from(offsets),
    children: Uint32Array.from(children),
    entryIds: Uint32Array.from(entryIds),
    reachTable: flight.table ?? new Float64Array(),
    minimumBin: flight.minimumBin,
    gravity: model.gravity,
    fallingGravity: model.fallingGravity,
    maxJumpHeight: model.maxJumpHeight,
    maxFallingSpeed: model.maxFallingSpeed,
    apexTime: model.apexTime,
    maxHorizontalSpeed: model.maxHorizontalSpeed,
    initial: Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed ?? 0),
    deceleration: model.airOverspeedDeceleration,
  };
  const encoded = counts ? performance.now() : 0;
  const index = new LandingEnumerationIndex(snapshot);
  const constructed = counts ? performance.now() : 0;
  if (counts) {
    counts.treesEncoded++;
    counts.encodedRows += pending.length;
    counts.encodedEntries += entries.length;
    counts.encodedBytes +=
      snapshot.boxes.byteLength +
      snapshot.offsets.byteLength +
      snapshot.children.byteLength +
      snapshot.entryIds.byteLength +
      snapshot.reachTable.byteLength;
    counts.encodeMs += encoded - started;
    counts.constructorMs += constructed - encoded;
  }
  return {
    entries,
    index,
  };
};

function* diagnosticEntries<T extends Bounds>(
  cursor: NativeCursor,
  entries: Bounds[],
  batchSize: number,
  counts: LandingCounters,
): Generator<T> {
  let buffered = 0;
  try {
    for (;;) {
      counts.batchCalls++;
      const batch = cursor.readBatch(batchSize);
      counts.idsReturned += batch.ids.length;
      buffered = batch.ids.length;
      for (const id of batch.ids) {
        buffered--;
        counts.idsYielded++;
        yield entries[id] as T;
      }
      if (batch.done) return;
    }
  } finally {
    counts.discardedBuffered += buffered;
    counts.streamsClosed++;
    cursor.close();
  }
}

export function createRustLandingEnumeration(batchSize = 32): LandingEnumerationFactory {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new Error('Invalid landing batch size');
  const trees = new WeakMap<object, ReturnType<typeof encode> & { flight: FlightReachSnapshot }>();
  return function <T extends Bounds, G>(root: BoundsNode<T, G>, query: LandingNearestQuery) {
    const { model, maxDrop, endpointTolerance = 0, padding = [0, 0, 0] } = query.envelope;
    const flight = flightReachSnapshot(model, maxDrop, endpointTolerance);
    // Capture the same flight snapshot as createJumpEnvelope at stream creation;
    // tree encoding remains lazy until this stream is actually consumed.
    return (function* () {
      const counts = diagnostics?.current();
      if (counts) counts.streamsStarted++;
      let compiled = trees.get(root);
      if (!compiled || compiled.flight !== flight) {
        compiled = { ...encode(root, flight, counts), flight };
        trees.set(root, compiled);
      } else if (counts) counts.treeCacheHits++;
      const { anchor } = query;
      const rise = flight.model.maxJumpHeight + 2 * endpointTolerance;
      const fall = maxDrop + 2 * endpointTolerance;
      const cursor = compiled.index.cursor({
        bounds: Float64Array.from([...query.bounds.min, ...query.bounds.max]),
        target: [...query.target],
        anchor: [...anchor],
        padding: [...padding],
        maxHorizontalDistance: query.envelope.maxHorizontalDistance,
        rise,
        fall,
        tolerance: endpointTolerance,
        scale: Math.max(
          1,
          Math.abs(anchor[0]),
          Math.abs(anchor[1]),
          Math.abs(anchor[2]),
          query.envelope.maxHorizontalDistance,
          rise,
          fall,
        ),
        ...(query.cost ? { cost: { ...query.cost, goal: [...query.cost.goal] } } : {}),
      });
      if (counts) return yield* diagnosticEntries<T>(cursor, compiled.entries, batchSize, counts);
      try {
        for (;;) {
          const batch = cursor.readBatch(batchSize);
          // Buffered IDs belong to this generator across frontier pauses. Native
          // prefetch never changes JS round-robin consumption or budget charges.
          for (const id of batch.ids) yield compiled.entries[id] as T;
          if (batch.done) return;
        }
      } finally {
        cursor.close();
      }
    })();
  };
}
