# Solver reuse and performance

2026-11-06, alpha.31. This records implementation progress against
[architecture](architecture.md) and [ground topology](ground-topology.md), separately
from their alpha.21 modeling baseline.

## Current boundary

G0–G2 have directed ground passages, stair-family validation and bounded local
refinement; see [stairs validation](stairs-validation.md) for its measured coverage.
G3 regional entry/exit transfer assets and state-preserving contraction remain open.
Atlos implements parts of G4: shared physical tiles, retained task logs, feasible
incumbents and interleaved origin/coverage attempts. The full I0 resource-state and
forward-replay reference is incomplete; I1 currently has terrain assets rather
than shared regional action assets. Static device macros do not complete I2.

## Reuse without changing candidate coverage

CPU sampling of the successful rear-approach query found about 12 seconds under
the base graph search, including about 9 seconds in repeated goal-distance
estimation. This is inclusive sampled CPU attribution, not an independent sum of
stage durations. The query has multiple standing targets within its interaction
volume, and action discovery repeatedly searches with newly added connections.

The prepared route planner now retains exact minimum Euclidean distances for its
current target-position set. Repeated node relaxations and successive searches
reuse those distances. Time estimates still divide by the current graph's speed
bound, including new fast devices and zero-cost transfers. Changing target
positions resets the cache even when temporary endpoint IDs are reused. Weak keys
avoid retaining discarded query endpoint positions, and only one target set is
retained. Three-dimensional distance evaluation no longer allocates a temporary
array for every target comparison.

No candidates, budgets, ordering rules, movement costs or collision requirements
are removed or relaxed. This is a preparation/search optimization, not regional
contraction or cross-process reuse. It does not change route-result feasibility
or optimality claims.

## Validation method

Replay identical retained physical inputs with the alpha.30 implementation and
the candidate in separate processes. Compare complete route and connection data,
not only success and duration. Record input, ground, collision, devices, refinement,
search and total command times separately. Do not treat a finished-route cache hit
as new-goal reuse or a single command as total multi-origin task latency.

The SDK regression suite also checks reused estimates against fresh graph searches
when a faster or zero-cost remote action is added and removed, target sets change,
or an endpoint ID is rebound to a different position.

## Fixed-input results

Separate-process alpha.30/alpha.31 replays with existing physical input files:

| Query | Search before / after (s) | Command total before / after (s) | Model route (s) |
| --- | --- | --- | --- |
| `10YLgUg` | 4.67 / 4.52 | 10.96 / 10.32 | 8.198852 |
| `17nac6U` | 10.78 / 8.98 | 23.35 / 20.64 | 22.633835 |
| `0bzZEM3` | 44.03 / 35.82 | 63.55 / 54.57 | 50.811684 |
| `0nQJhsI` | 13.39 / 9.15 | 30.63 / 24.18 | 32.513703 |
| `0ahvvCZ` | 41.91 / 33.11 | 65.62 / 54.60 | 56.819418 |

All five complete route objects and connection arrays were identical, not merely
within a duration tolerance. The 155 SDK tests passed. These are paired local
measurements, not population percentiles; the small change for `10YLgUg` is not
strong evidence of a material speedup. A separate sampled rear-query run measured
45.00 / 35.46 seconds of search and returned identical route data as well.

The second target initially used the box query's narrower terrain: both versions
were unavailable with identical connection arrays (61.08 / 46.65 seconds search).
The successful row above uses its original 349,112-surface terrain. Keep this
coverage failure separate from the five successful regressions.

Local raw evidence is retained in noclip's `.research/profiles/reuse-comparison.json`,
`reuse-wide-comparison.json`, paired result files and `rear-reuse-before.cpuprofile`.
No noclip source, dependency or submodule upgrade is part of this milestone while
its upstream synchronization is in progress. Alpha.31 is packaged in Ganglia and
is not yet enabled in the World preview.

## Next acceptance gates

1. Aggregate all attempts, queueing and preparation under one query ledger, keeping
   first-feasible latency separate from optional improvement.
2. Reuse prepared region geometry and collision indices across tasks under explicit
   source, state, body and model dependencies, with bounded memory and incremental
   loading. Keep target-specific refinement separate.
3. Implement G3 local directed entry/exit transfers and compare compressed searches
   against an uncompressed reference on stairs, stacked floors, one-way drops and
   device shortcuts before enabling them for arbitrary points.
4. Share unresolved interface work across targets. Budget exhaustion preserves
   unknown status and verified actions; it is not evidence of physical impossibility.

Every stage must preserve the fixed query corpus's reachability and route quality.
Measure cold preparation, same-region new goals and expanded coverage separately.
