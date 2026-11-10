# Prepared routing benchmarks

The two measured seams are `PreparedRouteSolver.solve(query)` and
`PreparedRouteSolver.solveBatch(queries)`, exported through
`@opendfieldmap/ganglia/solver`. The contract lives in `src/solver/index.d.ts`;
`src/solver/adapters/surface-action.mjs` connects it to the existing solver.

```js
import { prepareSurfaceActionSolver } from '@opendfieldmap/ganglia/solver';

const solver = await prepareSurfaceActionSolver({ surfaces, collision, options });
try {
  const one = await solver.solve({ starts, goal });
  const batch = await solver.solveBatch(queries);
} finally {
  await solver.close();
}
```

`collision` contains triangle positions and indices. `options` contains the
existing movement, body, wall, connection and search defaults. Scene inputs remain
immutable until closing. Request options can override interaction, waypoints,
connections and candidate/link budgets; they cannot change scene constraints.
Request inputs stay unchanged until their promise settles. Await submitted work
before closing; later submissions reject.

Every request starts a new action pool, cursor and incumbent. Immutable geometry
and geometry-dependent proofs may be reused; completed routes are not cached.
The existing adapter prepares the ground planner and collision index once.
Discovery-specific indices remain lazy, so the query first needing them pays
their cost. Failed and truncated routes remain normal results.

Batch submission is one call. Results match input order; scheduling and internal
completion order are implementation choices. Each request retains independent
budgets and resource state. The current adapter executes serially. A replacement
can implement parallel or joint offline solving without changing `bench/run.mjs`;
its preparation must finish before returning, including any eager worker setup.
Lazy scheduling, transfers and result assembly during `solveBatch` count toward
batch wall time. The runner does not synthesize a batch by looping over `solve`.

## Run the retained map02 workload

From the repository root:

```sh
npm run benchmark
npm run --silent benchmark -- --json > .local/research/solver-benchmark.json
```

Use a supported Node version (Node 26 was used for the initial measurement).
The benchmark needs these locally retained exports under `.local/data/`:

- `validation-map02/ground.json` and `collision.json`
- `validation-map02/walk-request.json` for the fixed scene wall state
- `routing/movement-settings-current.json`

Use `--data-root <directory>` for another location containing the same layout.
No game data is distributed or downloaded by this script. Missing inputs produce
a nonzero exit and a diagnostic on stderr. For clean JSON stdout through npm,
use `--silent`; direct `node bench/cli.mjs --json` also emits JSON only.

`bench/scenes/map02.mjs` defines ten fixed ground-to-ground pairs from retained
walking traces in the same map02_lv004 window, including reverse-direction
requests. Requests use 128 candidates, 64 links and no optional shortcut budget.
This is a small, bounded SDK workload; it does not reproduce the full Atlos
pipeline, devices, boosts, goal refinement, live-game execution or the historical
heavy-action acceptance corpus. Unavailable/truncated outcomes are reported.

The runner measures each query once on a prepared instance, then submits all ten
to a separate prepared instance. Input I/O, hashing, preparation, result comparison
and formatting are outside the measured calls. Both passes run in one process;
there is no explicit warmup, OS cache flush or JIT/GC control. This is an initial
observation, not a statistically controlled speedup comparison. The single-query
P95 is the nearest-rank statistic of ten different requests, not repeated samples
of one request. Batch reports whole-call time and requests/s, without inventing
per-request latency for parallel implementations.

JSON records exact cases, input/source hashes, revision, runtime, limits, excluded
preparation times, statuses, costs and truncation. Per-query outcome hashes cover
the complete route and connections. Batch rows compare those outcomes and
truncation against single-query results. Differences are reported for inspection;
an alternative algorithm may legitimately choose a different feasible route.
