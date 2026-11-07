# Solver reuse and performance

2026-11-07, alpha.39. This records implementation progress against
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
Those alpha.31 measurements preceded its integration into the v69 World preview.
The cold-start work below starts from that integrated alpha.31 baseline.

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

## Reusing boundary preparation without reducing search coverage

Discovery now builds an immutable spatial hierarchy of exposed boundaries. The
previous ordering first sorted every eligible boundary, then grouped it into
successively smaller spatial cells and interleaved those groups. In that ordering,
a region first appears at its least-ranked eligible boundary. Ranking child
regions by those minima, retaining the original boundary index as the stable tie
breaker, therefore produces the same sequence. Only the prefix that the seed
budget can consume is materialized. Each boundary stream yields at least one seed,
so later distinct streams cannot be visited once that many streams have already
consumed the complete seed budget. This removes unconsumed allocation and sorting
work; candidate limits and their charging remain unchanged.

A prepared ground planner can also retain its static discovery adjacency, boundary
and landing indices across queries with identical support surfaces, imported
portal identity and wall/body values. It retains one constraints variant and one
spatial subdivision variant. Per-query goal projections, rankings, motion checks,
rejected pairs and reachability decisions remain separate. Changing collision
worlds does not reuse any standing or swept-motion proof.

Repeated device and action endpoint projections use a bounded support cache owned
by the immutable ground planner. Every coordinate, height tolerance and explicit
support identity participates in the key. The underlying projection remains the
original polygon scan, retaining its numerical edge tolerance and floor-selection
rules. The cache bounds retained entries and preserves signed-zero coordinates.

An independent full-list ordering reference covers filtered stacked floors,
negative coordinates, ties and multiple prefix budgets. Projection comparisons
cover changing floors, height tolerances, mutable input coordinates and cache
replacement. Repeated-query checks compare reused and fresh planners while
changing goals and collision worlds. These verify equivalence and isolation; they
do not establish a tenfold reduction in cold-query time.

## Cold-start preparation and search

The primary acceptance regime is a fresh Node process solving its first query
from retained physical input files. It has no previously prepared planner,
collision BVH, goal refinement or completed route. This is process-cold execution,
not a claim that operating-system file pages were flushed. Same-region new-goal
and repeated-input workers are auxiliary measurements, reported separately.

Alpha.39 reduces work within that first invocation:

- Collision BVH construction selects exact median partitions instead of sorting
  every complete subtree. Total tie-breaking and the parent's leaf order remain
  identical, preserving support selection and the first reported collision.
- Support bounds precompute centres in temporary typed columns while retaining
  the previous three-way partition sequence and complete tree/leaf order.
- Local goal refinement queries the already built collision BVH for inclusive
  XZ triangle candidates at every height, then restores original input order.
  Native mesh construction receives the same triangle sequence as the full scan.
- Coarse and refined planners share content-checked owned surface primitives.
  Each planner still rebuilds its global portals, triangle IDs and neighbours;
  far-away added geometry can change global traversal order, so concatenating
  independently built portal graphs is not equivalent.
- Static wall-filtered movement topology and spatial indices are prepared once
  per matching planner. Action overlays and reachability remain per-query.
  After a full failed A* search, a directed component DAG can reject later
  disconnected overlays before repeating A*, without authorizing any passage.
- Boundary discovery materializes only the consumed ordering prefix, and landing
  projection avoids temporary fixed-size vectors with unchanged arithmetic order.

Exact collision-query memoization is opt-in and defaults to disabled. It is not
used to obtain the cold figures. Derived edge-string retention increased the
rear-query total in a focused comparison and was rejected. A separate lazy
straightener experiment did not establish a material total-time improvement and
was also excluded. No candidate budget or physical check was reduced.

The fixed replay population contains 38 alpha.31 successes, using 36 distinct
physical input bindings. Fourteen requests have their original CLI logs; the
other 24 have explicitly frozen recovered input selections. The gate compares
complete route objects, all discovered connections and candidate limits, not just
reachability or a cost tolerance. Historical best-route differences remain a
separate quality backlog: ten current alpha.31 baselines have worse historical
costs, including differences reproduced on alpha.30 with the same retained inputs.
The performance gate does not redefine those historical routes as solved.

Focused three-request measurements before the final extractor release-lifetime
adjustment were 95.44 s for alpha.31 and 66.02 s for alpha.39. The rear-approach
request was 53.20 / 34.72 s, the box request 28.46 / 19.85 s and a third request
13.78 / 11.44 s. All route, connection and limit objects matched exactly. These
single-run samples support continued cold preparation work; they do not establish
the requested 90 percent total-time reduction.

The final frozen 38-request replay, after restoring the one-shot extractor's coarse
planner release, passed 38/38 exact route/connection/limit comparisons:

| Stage | Alpha.31 total (s) | Alpha.39 total (s) |
| --- | ---: | ---: |
| Input | 18.448 | 17.740 |
| Ground | 118.491 | 106.332 |
| Collision | 38.407 | 23.326 |
| Devices | 7.103 | 6.393 |
| Refinement | 168.900 | 145.287 |
| Search | 202.690 | 152.695 |
| Command total | 554.891 | 452.624 |

The command reduction is 18.4 percent; search alone is 24.7 percent lower. The
rear query was 53.197 / 32.983 s, the box query 28.463 / 19.042 s and the third
focused query 13.783 / 11.144 s. No candidate run became slower in this replay,
though near-equal single-run times should not be interpreted as reliable speedups.
The 180 SDK tests passed. This remains well above the requested ten-percent
remaining-time target. Further work must reduce repeated topology analysis,
frontier generation and graph search; retaining more results in memory alone
cannot satisfy that gate.

A fresh-process alpha.31 control replay after the candidate corpus took 95.301 s
for the same three focused requests, against 95.443 s in the frozen record.
Its complete route, connection and limit objects also matched. This checks that
the focused improvement is not explained by a large overall machine-speed change.
