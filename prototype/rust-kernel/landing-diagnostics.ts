import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface LandingCounters {
  treesEncoded: number;
  treeCacheHits: number;
  encodedRows: number;
  encodedEntries: number;
  encodedBytes: number;
  encodeMs: number;
  constructorMs: number;
  flightOwnersBuilt: number;
  flightOwnerBytes: number;
  flightOwnerMs: number;
  streamsStarted: number;
  streamsClosed: number;
  batchCalls: number;
  idsReturned: number;
  idsYielded: number;
  discardedBuffered: number;
}
const empty = (): LandingCounters => ({
  treesEncoded: 0,
  treeCacheHits: 0,
  encodedRows: 0,
  encodedEntries: 0,
  encodedBytes: 0,
  encodeMs: 0,
  constructorMs: 0,
  flightOwnersBuilt: 0,
  flightOwnerBytes: 0,
  flightOwnerMs: 0,
  streamsStarted: 0,
  streamsClosed: 0,
  batchCalls: 0,
  idsReturned: 0,
  idsYielded: 0,
  discardedBuffered: 0,
});

/** Diagnostic runs only. No console hook, clocks or output file exist when disabled. */
export function startLandingDiagnostics(filename?: string) {
  if (!filename) return;
  const output = resolve(
    filename === '1'
      ? `.local/research/rust-landing-prefetch/diagnostics-${process.pid}.json`
      : filename,
  );
  const phases: Record<string, LandingCounters> = {};
  let phase = process.env.GANGLIA_TAIL_PHASE ?? 'setup';
  const original = console.error;
  console.error = (...args: unknown[]) => {
    original(...args);
    if (typeof args[0] !== 'string' || !args[0].startsWith('{')) return;
    try {
      const event: { phase?: string } = JSON.parse(args[0]);
      if (
        event.phase &&
        [
          'catalog-training',
          'training',
          'prewarm',
          'batch',
          'selected-prewarm',
          'selected-solve',
        ].includes(event.phase)
      )
        phase = event.phase;
    } catch {
      /* Non-JSON stderr does not change the benchmark phase. */
    }
  };
  process.once('beforeExit', () => {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        {
          diagnostic: true,
          formalPerformance: false,
          batchSize: Number(process.env.GANGLIA_RUST_LANDING_BATCH ?? 32),
          attribution:
            'Stream counters belong to the phase of first consumption. treesEncoded/encodedBytes count geometry rows and copied geometry-column payload only; flightOwnersBuilt/flightOwnerBytes count separate flight owners and their copied reach-table payload. These exclude object/scalar overhead and do not measure retained RSS. bufferedAtSnapshot includes streams not explicitly closed and is not a leak measurement.',
          phases: Object.fromEntries(
            Object.entries(phases).map(([name, values]) => [
              name,
              {
                ...values,
                bufferedAtSnapshot:
                  values.idsReturned - values.idsYielded - values.discardedBuffered,
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  });
  return { current: () => (phases[phase] ??= empty()) };
}
