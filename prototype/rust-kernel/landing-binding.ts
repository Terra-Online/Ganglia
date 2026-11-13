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
  cursor(query: NativeQuery, flight: object): NativeCursor;
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
const { LandingEnumerationIndex, LandingFlight } = loadNativeLibrary() as {
  LandingEnumerationIndex: new (snapshot: {
    boxes: Float64Array;
    offsets: Uint32Array;
    children: Uint32Array;
    entryIds: Uint32Array;
  }) => NativeIndex;
  LandingFlight: new (snapshot: {
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
  }) => object;
};
const none = 0xffffffff;
const diagnostics = startLandingDiagnostics(process.env.GANGLIA_RUST_LANDING_DIAGNOSTICS);
const encode = (root: BoundsNode<Bounds, unknown>, counts?: LandingCounters) => {
  const started = counts ? performance.now() : 0;
  let rows = 0,
    edges = 0,
    entryCount = 0;
  const measure = (node: BoundsNode<Bounds, unknown>): void => {
    rows++;
    if (node.entries) {
      rows += node.entries.length;
      edges += node.entries.length;
      entryCount += node.entries.length;
    } else {
      edges += 2;
      measure(node.left);
      measure(node.right);
    }
  };
  measure(root);
  const boxes = new Float64Array(rows * 6),
    offsets = new Uint32Array(rows + 1),
    children = new Uint32Array(edges),
    entryIds = new Uint32Array(rows);
  const entries = new Array<Bounds>(entryCount);
  let row = 0,
    edge = 0,
    entry = 0;
  const writeBounds = (id: number, value: Bounds) => {
    const offset = id * 6;
    boxes[offset] = value.min[0];
    boxes[offset + 1] = value.min[1];
    boxes[offset + 2] = value.min[2];
    boxes[offset + 3] = value.max[0];
    boxes[offset + 4] = value.max[1];
    boxes[offset + 5] = value.max[2];
  };
  // This is the filtered hierarchy itself. Retaining loose branch bounds and
  // child/leaf order is necessary for the nearest heap's equal-distance order.
  // Row IDs do not break heap ties, so depth-first numbering avoids a second
  // per-row work queue. Reserve each row's child slots before descending.
  const write = (node: BoundsNode<Bounds, unknown>): number => {
    const id = row++;
    writeBounds(id, node);
    entryIds[id] = none;
    offsets[id] = edge;
    const first = edge;
    if (node.entries) {
      edge += node.entries.length;
      for (let index = 0; index < node.entries.length; index++) {
        const value = node.entries[index],
          child = row++;
        children[first + index] = child;
        offsets[child] = edge;
        entryIds[child] = entry;
        entries[entry++] = value;
        writeBounds(child, value);
      }
    } else {
      edge += 2;
      children[first] = write(node.left);
      children[first + 1] = write(node.right);
    }
    return id;
  };
  write(root);
  offsets[rows] = edges;
  const snapshot = { boxes, offsets, children, entryIds };
  const encoded = counts ? performance.now() : 0;
  const index = new LandingEnumerationIndex(snapshot);
  const constructed = counts ? performance.now() : 0;
  if (counts) {
    counts.treesEncoded++;
    counts.encodedRows += rows;
    counts.encodedEntries += entries.length;
    counts.encodedBytes +=
      snapshot.boxes.byteLength +
      snapshot.offsets.byteLength +
      snapshot.children.byteLength +
      snapshot.entryIds.byteLength;
    counts.encodeMs += encoded - started;
    counts.constructorMs += constructed - encoded;
  }
  return {
    entries,
    index,
  };
};

const createFlightOwner = (flight: FlightReachSnapshot, counts?: LandingCounters) => {
  const started = counts ? performance.now() : 0;
  const model = flight.model;
  const table = flight.table ?? new Float64Array();
  const owner = new LandingFlight({
    reachTable: table,
    minimumBin: flight.minimumBin,
    gravity: model.gravity,
    fallingGravity: model.fallingGravity,
    maxJumpHeight: model.maxJumpHeight,
    maxFallingSpeed: model.maxFallingSpeed,
    apexTime: model.apexTime,
    maxHorizontalSpeed: model.maxHorizontalSpeed,
    initial: Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed ?? 0),
    deceleration: model.airOverspeedDeceleration,
  });
  if (counts) {
    counts.flightOwnersBuilt++;
    counts.flightOwnerBytes += table.byteLength;
    counts.flightOwnerMs += performance.now() - started;
  }
  return owner;
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
  const trees = new WeakMap<object, ReturnType<typeof encode>>();
  const flights = new WeakMap<FlightReachSnapshot, object>();
  return function <T extends Bounds, G>(root: BoundsNode<T, G>, query: LandingNearestQuery) {
    const { model, maxDrop, endpointTolerance = 0, padding = [0, 0, 0] } = query.envelope;
    const flight = flightReachSnapshot(model, maxDrop, endpointTolerance);
    // Capture the same flight snapshot as createJumpEnvelope at stream creation;
    // tree encoding remains lazy until this stream is actually consumed.
    return (function* () {
      const counts = diagnostics?.current();
      if (counts) counts.streamsStarted++;
      let compiled = trees.get(root);
      if (!compiled) {
        compiled = encode(root, counts);
        trees.set(root, compiled);
      } else if (counts) counts.treeCacheHits++;
      // Geometry identity and validated flight-snapshot identity are independent.
      // A fresh model object needs only a small owner; existing cursors retain
      // their old tree and flight through separate native Arc references.
      let flightOwner = flights.get(flight);
      if (!flightOwner) {
        flightOwner = createFlightOwner(flight, counts);
        flights.set(flight, flightOwner);
      }
      const { anchor } = query;
      const rise = flight.model.maxJumpHeight + 2 * endpointTolerance;
      const fall = maxDrop + 2 * endpointTolerance;
      const cursor = compiled.index.cursor(
        {
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
        },
        flightOwner,
      );
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
