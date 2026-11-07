# Solver reuse and performance

2026-11-07, alpha.47. This records implementation progress against
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

## Reducing repeated graph work

The next implementation removes duplicate topology and distance searches rather
than increasing retained cross-query state:

- Ground routing exposes its already validated, wall-filtered graph and forward
  adjacency to movement discovery. Original edge weights are scaled on relaxation,
  avoiding a full copied edge graph just for unit conversion. They share its SCC
  computation and derive the directed rejection DAG from those same components. The standalone public graph planner still
  retains only its condensation, without keeping the full numeric topology.
- Each physical query owns only its current forward/reverse distance labels.
  When actions extend an unchanged graph, Dijkstra resumes from newly improved
  endpoints. An unchanged field expands no nodes. Deleted/reordered/changed
  action weights, changed roots or a changed base graph restart the full search.
  These fields are released with the query; worker preparation does not retain
  them for another target. Candidate ordering continues to use the same final
  shortest-distance labels.
- Ground tracing indexes polygon boundaries by surface ID and integer edge
  ordinal. Fan diagonals are grouped only within their owning polygon, so they
  do not require global serialized keys. Neighbour and portal insertion order
  remains unchanged. Empty diagonal maps are not allocated for triangle faces.

The query diagnostics expose distance-field resets, node expansions, outgoing-edge
visits and reachable-node counts. The last count records how much a full field
pass would traverse, making the avoided graph work visible independently of
wall-clock variance. No candidate budgets, grounded support checks or swept
collision validations are weakened. A face-level kinematic prefilter was tested
but excluded because its small rejection rate did not improve total work time.

### Alpha.47 fixed-input validation

All 38 requests again passed exact route, discovered-connection and candidate-limit
comparisons with alpha.31. Each request ran in a new process; neither prepared
worker state nor completed route results participated. The packed runtime matches
the frozen benchmark source. The 188 SDK tests passed.

| Stage | Alpha.31 (s) | Alpha.39 (s) | Alpha.47 (s) |
| --- | ---: | ---: | ---: |
| Input | 18.448 | 17.740 | 17.555 |
| Ground | 118.491 | 106.332 | 93.067 |
| Collision | 38.407 | 23.326 | 23.155 |
| Devices | 7.103 | 6.393 | 6.199 |
| Refinement | 168.900 | 145.287 | 136.351 |
| Search | 202.690 | 152.695 | 140.154 |
| Command total | 554.891 | 452.624 | 417.453 |

Alpha.47 reduces the fixed population's command time by 24.8 percent and search
time by 30.9 percent relative to alpha.31. No case became slower in this replay;
these remain local measurements rather than latency percentiles. The rear query
was 53.197 / 29.731 s, the box query 28.463 / 18.089 s, and the third focused query
13.783 / 10.552 s.

Across 192 distance-field calls, 76 required no expansion. Incremental propagation
expanded 1,960,025 nodes, versus 5,953,562 reachable nodes across corresponding
complete field passes: 67.1 percent fewer expansions. The rear query alone visited
125,646 versus 1,363,499 nodes in these fields. These are distance-field counts,
not a claim of a 90 percent total-command reduction.

Separate three-request resource runs measured peak RSS around 1.7–2.9 GiB for
alpha.47, against about 1.9–2.8 GiB for the alpha.31 control. The rear query reached
3.1 GiB in the complete corpus run. Peak RSS did not uniformly decrease; fewer
edge copies do not by themselves establish a smaller process peak. An additional
in-place distance-field-reset experiment showed no stable wall-time/RSS gain and
was excluded from this release.

The requested ten-percent remaining-time target is not reached. Ground preparation
and goal refinement still consume about 55 percent of the current command total.
Further improvement must avoid constructing and traversing unnecessary global
fine support structures, while preserving directed passages, overlapping supports,
physical checks and the complete-route incumbent. More retained query results
cannot substitute for that algorithmic work.
