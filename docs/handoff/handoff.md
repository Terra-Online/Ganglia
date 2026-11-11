# Route solver handoff

This handoff describes Ganglia `0.1.0-alpha.76` at local commit `917dfcd` and its Atlos integration at `9311d063`, as inspected on 2026-11-10. The companion [history and testing record](history.md) owns the chronological experiments, complete measurement tables, regression corpus and validation procedures. The source layout was subsequently reorganized on 2026-11-11, starting from `c8cc213`. The subsystem and composition sections below describe that source refactor. The alpha.76 performance measurements remain bound to their historical implementations.

The current objective is to reduce comparable solver computation to **at most 20% of the original cost**, while preserving supported behavior, reachability and route quality. The latest heavy-query checkpoint remains above that target. The immediate implementation priority is to reduce the region state space, spatial candidate generation and repeated action queries. The older roadmap's resource-first P0 order has been superseded for this optimization task. Resource-state unification remains subsequent work.

## Repository ownership and entry points

Ganglia owns the geometry, directed passages, collision queries, movement candidates and search algorithms. Atlos owns the upstream adaptation, data exports, request scheduling, physical windows, cache policy and presentation. The separate `endfield-noclip` checkout supplies upstream source and local research evidence.

| Area | Owning source |
| --- | --- |
| Global corridor proposals | [`src/search/candidate-planner.mjs`](../../src/search/candidate-planner.mjs), [`src/search/candidate-transfers.mjs`](../../src/search/candidate-transfers.mjs) |
| Physical support generation | [`src/geo/build.mjs`](../../src/geo/build.mjs), [`src/geo/support-field.mjs`](../../src/geo/support-field.mjs) |
| Ground query and geometry preparation | [`src/route/ground.mjs`](../../src/route/ground.mjs), [`src/geo/surfaces.mjs`](../../src/geo/surfaces.mjs), [`src/route/straighten.mjs`](../../src/route/straighten.mjs), [`src/route/movement-geometry.mjs`](../../src/route/movement-geometry.mjs) |
| Movement search | [`src/route/jump-planner.mjs`](../../src/route/jump-planner.mjs), [`src/search/traversal.mjs`](../../src/search/traversal.mjs), [`src/search/shortcuts.mjs`](../../src/search/shortcuts.mjs), [`src/route/route-shortcuts.mjs`](../../src/route/route-shortcuts.mjs) |
| Dynamics and pruning | [`src/motion/jumps.mjs`](../../src/motion/jumps.mjs), [`src/reach/reachability.mjs`](../../src/reach/reachability.mjs), [`src/reach/motion-bounds.mjs`](../../src/reach/motion-bounds.mjs), [`src/motion/flight-steering.mjs`](../../src/motion/flight-steering.mjs), [`src/search/candidate-bounds.mjs`](../../src/search/candidate-bounds.mjs) |
| Airborne objectives and boosts | [`src/route/airborne-goal.mjs`](../../src/route/airborne-goal.mjs), [`src/route/boosted-route.mjs`](../../src/route/boosted-route.mjs), [`src/motion/goals.mjs`](../../src/motion/goals.mjs) |
| Collision and resources | [`src/geo/collision.mjs`](../../src/geo/collision.mjs), [`src/resource/locomotion.mjs`](../../src/resource/locomotion.mjs), [`src/resource/resource-search.mjs`](../../src/resource/resource-search.mjs) |
| Atlos ordinary request | [`dev-route-server.ts`](../../../Atlos/talos/apps/world/dev-route-server.ts), [`travel-arrivals.ts`](../../../Atlos/talos/apps/world/travel-arrivals.ts) |
| Atlos corridor worker | [`candidate-job.ts`](../../../Atlos/talos/apps/world/candidate-job.ts), [`candidate-worker.ts`](../../../Atlos/talos/apps/world/candidate-worker.ts) |
| Atlos physical scheduling | [`physical-route-builder.ts`](../../../Atlos/talos/apps/world/physical-route-builder.ts), [`route-worker.ts`](../../../Atlos/talos/apps/world/route-worker.ts), [`window-route.ts`](../../../Atlos/talos/apps/world/window-route.ts) |
| Atlos terminal assets | [`terminal-routes.ts`](../../../Atlos/talos/apps/world/terminal-routes.ts) |

The authoritative noclip adaptation lives in Atlos [`talos/integrations/noclip/`](../../../Atlos/talos/integrations/noclip/source.json), including `extractor.patch`, `format.patch`, `renderer.patch`, `documentation.patch` and `gpu-recovery.patch`. `Atlos/talos/.cache/noclip/` is generated source. Changes inspected there must be maintained through the integration patches. The retained upstream binding is `30f73f4609b24f033e3e2a48607d3270b01695a3`, with package protocol 98. Navigation/physical export revision 2 is a separate data binding.

## Six source subsystems

The 2026-11-11 source reorganization uses these ownership boundaries. The package
entry points remain `src/index.mjs`, `src/build.mjs` and `src/collision.mjs`, with
their existing declarations and export names. Internal consumers import the owning
module directly. Public build and collision entry points forward to `geo`.

| Directory | Responsibility and modules |
| --- | --- |
| `geo` | Scene representation and support construction. `surfaces`, `bounds`, `walls`, `collision`, `build`, `clip-surface`, `support-field`, `support-projector`, `support-snapshot` |
| `reach` | Directed connectivity and conservative reach information. `connectivity`, `distance-field`, `reachability`, `motion-bounds` |
| `motion` | Motion models, landing witnesses and interaction geometry. `jumps`, `flight-steering`, `landings`, `motion`, `goals` |
| `search` | Implicit successors, proposal search and discovery. `candidate-planner`, `candidate-transfers`, `candidate-bounds`, `lazy-route`, `shortcuts`, `traversal`, `boundary-order`, `heap` |
| `resource` | Continuation-state search and fixed-route scheduling. `resource-search`, `locomotion` |
| `route` | Route orchestration, prepared planning context and improvement. `routes`, `ground`, `jump-planner`, `airborne-goal`, `boosted-route`, `route-shortcuts`, `ground-detours`, `straighten`, `movement-geometry` |

These directories describe current responsibilities. Cross-subsystem dependencies
remain explicit. `route/movement-geometry` assembles geometry with ground-planner
preparation and discovery boundaries. It retains the existing runtime dependency
cycle with `search/traversal`. `traversal` also owns `standingFoot` and discovery
validation shared by motion callers. `motion/goals` combines support projection
with terminal flight clipping. The generic `search/heap` is used by distance and
resource searches. Future extraction of these mixed responsibilities must preserve
snapshot ownership and avoid a second implementation of support or goal semantics.

### Search-state ownership and composition contracts

| Owner | Meaning of its state | Composition boundary |
| --- | --- | --- |
| `reach/reachability` | Necessary geometric/dynamic envelope predicates | An envelope intersection permits further validation. Rejection requires a conservative bound for the specific control family, support correction and objective |
| `reach/distance-field` | Shortest labels over the supplied retained base graph and action overlay | Root costs and edge costs must use one unit. Ground costs are scaled with `lengthScale`, action costs already use that field unit. Missing labels describe this graph's coverage |
| `search/candidate-planner` | SCC proposals, transfer materialization and proposal scores | Unknown transfers guide physical coverage. Penalties rank proposals and provide no physical time bound |
| `search/lazy-route` | Optimistic graph plus validated edge replacements | Unknown costs must be lower bounds in seconds. Accepted replacement cost must be at least the optimistic cost. Validation failure and an interrupted validation have different persistence |
| `search/shortcuts` | Query-bound cursors, witnesses, action revisions and discovery caches | Geometry-only results can survive query changes under their binding. Reachability-dependent cursors must follow query and action revisions |
| `route/jump-planner` | Per-solve verified action pool, per-arrival discovery and complete incumbent | Every arrival sees reusable actions locally. New-link quotas count its discoveries. Incumbents are compared after complete resource scheduling |
| `resource/resource-search` | Cost labels for exact continuation-state keys | Labels include energy, recovery delay, sprint activation, velocity, direction and dash state. Resource feasibility is specific to the entry state and scheduling policy |

The following rules govern changes across these owners.

1. **Bind immutable inputs at the query boundary.** Geometry, directed portals,
   collision world, body, walls, movement model and device state belong to the same
   snapshot. Existing identity-based caches require replacement objects when these
   inputs change. In-place mutation violates their current contract. Persistent or
   cross-worker sharing will require an explicit source/model revision binding.
   A common runtime snapshot/version object across all six subsystems remains open.
2. **Keep three cost roles explicit.** Proposal ranking, admissible lower bounds
   and executable resource-timed costs have different contracts. Candidate penalties
   must never be fed directly into lazy-route unknown costs or incumbent pruning.
   `distance-field` labels are exact for their supplied graph, which can omit future
   actions. Using such labels as a lower bound on an expanded graph requires an
   additional conservative argument. The current discovery uses them for retained
   connectivity and ordering under its finite coverage rules.
3. **Separate physical evidence from discovery coverage.** A swept, supported
   action establishes a particular motion under its bound inputs. A failed witness
   establishes only that witness's failure. An exhausted quota or an ungenerated
   successor leaves unresolved coverage. Avoid caching a whole region pair as
   impossible from either event. Resource rejection belongs to the continuation
   state, and terminal-only collection actions cannot become ordinary transfers.
4. **Invalidate by actual dependencies.** Appended action edges can incrementally
   relax distance fields. Changed roots, base graph, weights, direction or scale
   restart them. Discovery action revisions include motion content under stable IDs.
   Changed query endpoints, interaction, speed, `costBound` or `boundGoal` clear the
   relevant cursors/fields. Increasing work resumes a cursor, while a larger retained
   link quota can require rebuilding discarded representatives. A wider prefix bound
   retries a prior tighter-bound failure. Transfer keys remain snapshot-scoped.
5. **Preserve uncertainty through validation.** `lazy-route` keeps an edge unknown
   after cancellation or a thrown validator and closes it only when validation
   returns `null`. Callers must reserve `null` for rejection under the fixed validator
   context. Changing physics or resource-entry context requires a fresh planner.
   Discovery truncation must remain visible when composing route results.
6. **Keep pruning proofs local to their domain.** Complete-flight bounds do not
   apply to an earlier terminal hit. Immediate ballistic launch bounds do not cover
   supported uphill run-off. New speed devices can invalidate a time lower bound.
   More stamina alone does not justify resource dominance with automatic sprint
   restart. Existing bounded scheduling and retained DP dominance still have the
   model limits recorded below.

This reorganization preserves the existing algorithms and cache implementations.
It establishes module ownership and review contracts. A shared action-evidence
registry, a common query revision object, consistent resource transitions and full
incremental graph repair remain follow-up implementation work. Existing targeted
regressions cover lazy validation, distance-field updates, cursor continuation,
bound widening and per-arrival action reuse. They establish their fixture scope.

## Current scene and movement assumptions

The working snapshot assumes completed tasks, enabled and powered facilities, and open doors. Geometry, body clearance, collision and applicable hazards still constrain passage. Factory region centres can serve as teleport arrivals under the fully traversable factory assumption. The fixed map02 snapshot uses daytime. Preserve these assumptions in result interpretation and source selection.

Moving rocks, lotus supports, conveyor boxes, elevators and seesaws use the user-approved phase-free model. Horizontal motion primarily supplies swept support. Vertical motion supplies directed transport connections. Periodic timing, boarding windows, waiting policies and selectable-floor control remain broader modeling work.

Following stepping boxes may be arranged within their authored activity region. The output records required placements. Activation, guidance and box-moving time are omitted from modeled travel cost. Current query success establishes the declared model and input coverage. Independent execution replay, perturbation tolerance and live-game timing remain separate acceptance work.

The default imported character snapshot uses a 9 m/s jump launch limit, 6.5 m/s sustained air-speed limit and 5 m/s² overspeed deceleration. These are source-bound model values. Read the selected movement file for a query's actual parameters.

The retained vortex interpretation comes from build `2954fa80-23c1-1579-2b22-4ecfd6d70418`. `InteractiveLogicAccelerateBuff.ReqAddBuff` forwards `accelerate_buff[0]` as the duration of `buff_common_speedup`. The authored `speed_multiplier` value 1.2 adds to the default speed scalar 1, capped at 2.2. The adapter uses a 2.2 multiplier. `ccs_duration` belongs to camera timing. The device's trigger volume and duration continue to come from exported data.

## Ordinary request flow

1. World resolves the marker, source-bound interaction rules and scene assumptions. `travelArrivals` creates eligible teleport/base arrivals, including source height ranges for centres requiring ground projection.
2. For matching airborne terminal assets, `selectTerminal` chooses a physically revalidated tail. The ordinary prefix then targets its grounded entry.
3. A serial candidate worker loads `${scene}-ground-all.json`, prepares the candidate planner and searches across eligible origins. Its points guide physical coverage selection.
4. `createWindowRoute` divides the corridor into bounded physical windows. Unknown/device transfer trajectories remain indivisible. Long straight ground spans receive intermediate coverage points.
5. `physicalRouteBuilder` obtains source-bound collision and ground inputs, constructs missing tiles, and schedules walking, known-device and full-action stages. Failures can widen coverage or shorten a window. Pending results retain explicit partial scope.
6. The patched extractor's `commands/player-route.ts::run` prepares ground, collision, devices, moving support and target refinement, then calls Ganglia. Following-box placement is a fallback when ordinary planning has no complete route.
7. Accepted physical pieces propagate their actual exits. Window joining, ground-detour comparisons and terminal joining preserve exact endpoints and retime the complete motion sequence. World publishes the route with coverage, assumptions, physical progress and resource/event evidence.

A single `player-route` duration covers one physical request. Whole-task latency additionally includes queueing, process startup, origins, coverage attempts, ground construction, polling and optional improvement. A verified prefix or independent target-side approach retains its partial status until the ordinary connection completes.

Terminal reuse binds scene, game source, geometry generator, solver package, movement hash, target and interaction volume. `joinTerminal` requires exact positional continuity, carries goal-event indices and boost clocks, and reschedules resources. Solver upgrades can invalidate retained terminal assets through this binding. A complete `02gcZm4` teleport-to-airborne-target connection was recorded with alpha.67, while its asset eligibility under subsequent versions must satisfy the current bindings. See the Atlos [connection record](../../../Atlos/talos/apps/world/docs/02gcZm4-connection-2026-11-10.md).

## Ground, support and collision contracts

Physical ground is generated from selected world-space collision triangles. Recast WASM performs slope classification, rasterization, low-height filtering, compact-span connectivity, body-radius erosion, regions, contours and detail meshes. Ordinary links use the smaller upward/downward step allowance with voxel margin. Larger drops and jumps require directed movement validation.

The support builder deliberately retains local climb/headroom semantics for stairs. The optional native ledge rule can erase stairs whose individual steps are legal. Existing staircase and seam evidence remains limited to its recorded fixtures and map samples. Padded tile builds share a world voxel grid, clip output to tile cores and reconstruct directed, step-limited seams. Missing tiles acquire no inferred connectivity. Excessive vertical ranges partition only at safe support-height gaps, with overlapping collision for clearance. Continuous support crossing an unsupported vertical partition fails explicitly.

The current `Surface` export consists of detail triangles. Native coarse polygon ownership has not been retained as a reusable hierarchy. Graph size therefore follows detail density. Adding a small local refinement can rebuild a much larger combined planner.

Local refinement is already implemented. The patched `game/ground-refinement.ts::refineGoalGround` selects inclusive collision-AABB candidates from the collision BVH, restores original triangle order and rebuilds bounded support at one third of the coarse cell size. Shared owned surface primitives avoid repeating some preparation, while global portals and graph relations are rebuilt for the combined support. These implemented local/native operations are part of the current pipeline. Persistent regional transfers and a complete coarse/detail ownership asset remain subsequent work.

Imported directed portal intervals remain authoritative through graph construction, exposed-boundary discovery and straightening. Point contacts, stacked surfaces and ambiguous overlaps do not establish passage. Ground straightening uses supported continuous traces, directed passages and wall checks. Same-height corner contraction and candidate-corridor straightening remove unnecessary tessellation turns under those constraints.

`createCollisionWorld` retains indexed source collision and broad-phase bounds. Ground support requires a suitable normal and permitted height correction. `standingFoot` verifies corrected foot support, stationary capsule clearance, wall state and reattachment to navigation support. A projected point alone provides insufficient action evidence.

Each accepted flight receives full-body capsule sweeps. Curved sample intervals are inflated to cover the quadratic deviation between chords, with interval refinement when conservative inflation contacts geometry. Collision indexing scope must cover the complete padded body and trajectory. Unknown walls and missing-cook bounds remain active conservative exclusions according to their exported state.

## Candidate graph and search

`createCandidatePlanner` builds known ground topology and SCC identities. It indexes endpoints spatially and restores original input order for stable support ties. `createTransferQuery` indexes source vertices once, then materializes unresolved transfers for expanded components. Duplicate coordinates share retrieval while original encounter ranks preserve bucket selection and ties. Candidate edges carry stable keys for Atlos failure exclusions.

Candidate penalties prioritize unresolved transfers and large ascents. They rank corridor proposals. Executable travel time is computed from the later physical solution. Corridor points retain exact endpoint positions and straighten known ground runs locally, preserving unknown/action boundaries. Transfer keys preserve identity across query, expansion and rejection histories within the same immutable input. Cross-scene/source/model reuse still requires the outer snapshot binding. The separate lazy planner can update validated edges without copying the entire proposal graph on each retry.

`planJumpRoute` compares the base route and available boost branches. `solveJumpRoute` retains known actions and a feasible incumbent, explores unresolved region proposals and alternating forward/reverse frontiers, then optionally searches broad and incumbent-local shortcuts. Accepted alternatives require complete resource-timed improvement. Directed coarse waypoints guide discovery and never grant physical passage.

Discovery budgets bound seeds, neighbour visits, endpoint checks, trajectory attempts and retained links. `maxShortcutCandidates` controls optional improvement. Reaching a computational limit leaves unresolved coverage and propagates `truncated`. Valid partial action evidence survives failed discovery. The retained finite candidate graph and control families define the current search scope.

Prepared movement geometry reuses immutable support, portals, graph, SCCs, projectors and spatial indices under matching wall/body conditions. Forward and reverse distance fields incrementally propagate appended action edges. Changed roots, base graphs, ordering or edge costs restart the affected field. These per-query fields and their reset/expansion diagnostics remain distinct from persistent physical assets.

Within one `solveJumpRoute` query, verified nonterminal actions remain available to later arrivals without consuming their discovery allowance again. This is a query-local pool, not a cross-goal or persistent global action cache. Origins retain their own link allowances, connection identities remain unique, and partial connections are deduplicated on unsuccessful multi-origin results. Failed prefix-cache entries record the cost bound under which they were searched and can be retried when that bound widens.

The patched extractor's `route-cache.ts` retains one physical input region, with a default 512 MiB serialized-input admission threshold and one entry per prepared slot. Input-file identity changes clear the generation. Replacing `ground` invalidates refinement, device and moving preparation, and moving replacement invalidates refinement. Ground, round-occupancy and refined variants can therefore displace each other. Source/content-bound tile caching and bounded endpoint projection reuse already exist, while multi-region prepared action assets remain open. `bounds.mjs` also already uses packed build columns and parallel nearest-heap columns, and `jumpDuration` avoids phase-object allocation during candidate retrieval.

## Dynamics, inverse constraints and candidate pruning

`jumpDuration` shares the vertical model with `jumpConnection`. The model contains authored ascent, apex hold, gravity, falling gravity and terminal-speed descent. `jumpTravel` integrates launch overspeed decay and optional speed expiry. Current controls include direct jump/drop, supported run-off, steering variants, horizontal split and waypoint motions. Each family retains its original physical validation.

`createJumpEnvelope` is a necessary candidate-domain predicate used during BVH traversal. It accounts for permitted height correction, maximum drop, horizontal range and launch-speed bounds. A shared 0.25 m relative-drop table rounds toward longer flight, providing an optimistic reach upper bound. Extreme ranges use the shared analytic fallback. Boundary inset and vertical-projection padding preserve witnesses outside a raw boundary box. This envelope covers the existing discovery prefilter contract. Arbitrary supported approaches beyond that contract still require a separate approach envelope.

`createJumpPredecessor` tests a source region against a target region before projection and spatial enumeration. It uses relative height intervals, optimistic maximum flight reach and minimum horizontal AABB separation. Its optional `.domain(sourceBox)` returns necessary nominal source/target heights, ballistic flight-time, horizontal-displacement and launch-speed intervals. Those intervals describe a necessary domain. A supported run-off can travel uphill before leaving support, so its complete duration requires the supported-prefix model.

The inverse region predicate currently applies to **reverse frontier** boundary streams whose landings must reach the goal-connected ground set. It also constrains projected reverse takeoffs. Excluded boundary seeds retain their original budget slots, preserving the budgeted seed prefix while avoiding projection and query work. Forward frontier can discover intermediate relay regions and therefore retains broader coverage. The full reverse control-domain API exists, while comprehensive region-pair/control-domain propagation remains open.

`createMotionBounds` supplies lower durations for complete supported transfers. The jump bound includes full ascent and apex hold and an inverse horizontal-travel bound. A terminal flight clipped by an airborne pickup has its own objective treatment. Supported run-off uses a weaker whole-motion horizontal bound until a verified approach supplies its actual launch and supported distance.

A completed outer airborne route can bound the cost of another prefix. `costBound` and `boundGoal` preserve the original bounded endpoint through direction/entry subqueries. Spatial tests combine optimistic approach, transfer and departure costs using the applicable speed bounds. A control-family bound can exclude jump variants that cannot improve that incumbent. Drop/run-off variants retain their applicable checks.

`flight-steering.mjs::mayReachGoal` solves an inverse horizontal hit-time interval for constant-horizontal direct jumps, then checks the vertical flight range over that interval before constructing a sampled arc. Chord-deviation and floating-point padding preserve the existing sampled-trajectory hit semantics. The caller also allows for the goal-refinement search radius. Drop, overspeed, split, waypoint and expiring-speed families conservatively retain their complete trajectory checks rather than using an unsupported inverse model.

Two alpha.76 optimizations apply specifically to **non-frontier improvement** enumeration.

- Stable top-K insertion admits competitive witnesses without sorting the full bucket after every insertion. Certain/uncertain ordering and ties retain their prior semantics.
- `createCandidateBounds` skips face witness construction only after every potentially occupied destination cell has a full, certain top-K bucket and a conservative score lower bound strictly exceeds each bucket tail. Floating-point padding protects cell boundaries and near ties. The face still consumes its original neighbour-budget slot. Large/unsafe cell ranges and uncertain tails retain ordinary enumeration.

Frontier enumeration keeps its original pair-coordinate and pool bookkeeping. Face/bucket pruning is deliberately excluded from frontier because discarded-witness history participates in later cursor batches; skipping that history could change resumed enumeration. The goal-projection cache and incremental bucket insertion were trialed on frontier, then withdrawn after direction measurements showed no stable benefit. `dominatedFaces` is a query diagnostic, distinct from resource-label dominance.

`landings.mjs` retains static face metadata and centre witnesses. A per-query `createLandingGoalCache` reuses only the goal-dependent face projection, returns fresh positions and bypasses reuse when goal coordinates change. Start-dependent projections and reach witnesses remain query-specific. Witness order remains start, goal, centre and reach-boundary intersections.

Frontier cursors retain boundary-seed streams, nearest streams, pending variants, rejected pairs and accepted representatives under the exact query/action binding. Changed geometry, collision world, constraints, model, endpoints, interaction, speed, `costBound`, `boundGoal` or action revision invalidates the corresponding state. Updating an authored action under the same ID still changes its revision. Enlarging the link quota rebuilds pools because an earlier smaller quota can discard representatives. Enlarging the work budget resumes. This cursor mechanism is frontier-specific. Repeated non-frontier searches for different airborne prefix endpoints still rebuild substantial candidate work.

## Subsequent conservative search experiments

The 2026-11-11 experiments start from `634ed45`. Their frozen source manifests,
request hashes and trials are under the local research directory
`algorithm-combinations-20261111/`. The package resolver points the maintained Atlos
measurement harness at an immutable source copy for each trial. Installed Atlos
alpha.76 and generated extractor source are unchanged by this experiment setup.
See [history.md](history.md) for the actual timing and acceptance scope.

The retained candidate implementation applies horizontal incumbent/prefix bounds
before seed projection. Conservative boundary-plus-inset boxes skip entire seed
regions using outward padding and strict cost slack. Each excluded sample consumes
its original seed slot. Remaining seeds receive the existing horizontal point tests
before support projection, which preserves XZ exactly. `seedProjections` counts
actual seed projection requests separately from charged `seedChecks`.

Four additional mechanisms were implemented experimentally and removed from the
final source after comparison. They include numeric vertical-model constants,
dependency-checked distance-field retention across goal changes, adjacent duplicate
face evaluation reuse, and geometry-owned numeric caching of boundary projections
at fractions 0, 0.5 and 1. Some combinations reduced helper work or projection
requests, but their end-to-end results did not establish a preferable retained
combination across the selected cases. The companion history preserves each trial,
including the faster heavy-only combination and its failed-window regression.

The selected bounds-only cold/warm totals were 89.654/88.752 s for heavy action
(control 93.855/93.787), 41.342/39.109 s for direction (44.804/43.405), and
23.468/21.612 s for the failed window (22.927/21.299). Exact case status, route and
connection arrays were retained. Failed-window time is slightly worse. The heavy
cold result still uses 56.6% of alpha.70's original command cost, above the 20%
target. These are individual sequential observations, with scope and instrumentation
bindings detailed in history. No uniform or map-wide speedup is established.

Across the heavy cold/warm pair, seed projection calls fell from a derived 3,584,000
to 102,856. Charged neighbors, bucket candidate counts and shortcut trajectory
attempts remained 14,336,000, 9,258,772 and 12,476 respectively. Projection calls
alone therefore do not explain the remaining cost or establish smaller spatial
node traversal. Source ownership, optimistic-edge interpretation and existing
cache invalidation behavior retain their earlier contracts.

This pruning preserves the existing finite discovery scope. A region-pair reachable
domain combined with search-directed implicit successors remains the main structural
candidate for reducing neighbor and witness generation. L-GLS-style repair and
validation-effort ordering would then address repeated edge work. Complete GCS
trajectory optimization, learned ranking and kinodynamic tree sampling still need
separate implementations and acceptance evidence.

## Further non-learning structural comparisons

The subsequent 2026-11-11 batch compared 11 structural heavy-query variants plus
regional-index and canonical-order query microbenchmarks. Every new prototype was
removed after failing to demonstrate a stable benefit. Runtime source remains
`66dbd52`, and Atlos still uses the previously installed alpha.76 artifact.
The [history](history.md) records the exact variants, source/input bindings, timings,
checks and retry premises. Raw local evidence is `structural-ablation-20261111/`.

The candidates included regional BVH views, tighter candidate-span and triangle
hull domains, canonical nearest ordering, exact-SCC-mask successor prefixes,
target-independent landing witnesses with global/local quotas, and jump/run-off
family cost domains. Candidate-span filtering measured 89.701/90.182 s cold/warm,
against the reused 89.654/88.752 s control. All 22 heavy physical outputs retained
the exact route and connection arrays. No cross-map benefit was established.

Every variant still charged 14,336,000 neighbors over its cold/warm pair.
Family-entry filtering reduced retained candidate representatives by 2.7% while
increasing uncached shortcut trajectory attempts by 4.8%. Shared geometric prefixes
lost goal-aware indexed pruning, and reuse did not repay sorting/filtering overhead.
These are measured local strategies, not a completed search-driven physical graph.

The main open structural work remains owned coarse/detail support regions and
route-search-directed physical successors. Support-aware run-off launch domains
and certified walking alternatives can distinguish useful transfers from reachable
but unhelpful local motions. Same-SCC membership alone permits detours and holes,
so it cannot serve as a walking-dominance certificate. Preserve the existing
snapshot, cost, uncertainty and finite-budget contracts when replacing generation.
The remaining-cost target of at most 20% is still open.

## Updated next-phase algorithm scope

After the non-learning ablation, the user broadened the next phase to include
reinforcement learning and evolutionary optimization. The previous round's exclusion
of learned methods applies to that historical batch. Further structural refactoring
is one option alongside algorithm changes. It is not a prerequisite for comparing
new candidate-generation policies against the current solver.

The proposed comparison uses the existing analytic model and physical verifier.
CMA-ES and iCEM can search continuous takeoff/landing and steering/run-off parameters
within proposed region/control families. A learned search policy can select region
pairs, control families and work allocation before detailed candidates are built.
A hybrid can combine learned proposals with continuous stochastic optimization.
Quality-diversity methods such as CMA-MAE are another candidate when retaining
multiple landing regions or motion families proves important. These are proposals;
no evolutionary optimizer, learned policy or new performance result is implemented.

Start with four comparable arms: the current solver, evolutionary/sampling-based
local generation, learned high-level selection with the current local generator,
and their combination. Use held-out regions/scenes and count all inference,
generation, physical validation and fallback time. Report training/precomputation
cost separately. Existing regression scenes supply environments and evaluation
inputs; decision-level traces still need to be collected for learning. A bounded
unsuccessful solve remains an unresolved episode, with no physical-impossibility
label inferred for untested actions.

Model proposals retain the existing support, wall, complete trajectory, goal-event
and resource checks. Predictive scores guide proposals and scheduling. Certified
lower bounds continue to govern safe pruning. Exploration and resumable fallback
remain part of the comparison, with their actual runtime included. Fixed-budget
coverage and route quality require independent validation; the 20% objective has
no demonstrated learning/evolutionary result yet.

## Action objectives and device coverage

Airborne collection uses the source-derived interaction volume. `findGoalFlights` samples supported takeoffs and nominal flight families. `planAirborneGoal` solves exact grounded approaches and clips the final flight at the first valid collection event. Prefix collision and boost validity remain required. World enables this behavior for `int_collection_coin*` rules. `sampleJourney` interpolates an existing timed route for playback. Independent forward propagation of fixed controls remains open.

The boost planner compares one reachable pickup and its accelerated tail. Ground speed, sustained air speed and launch speed scale with the imported multiplier. A final jump can cross expiry by re-solving its ordinary-speed continuation, sweeping the changed motion and rescheduling the joined route. Earlier expiry or failed validation rejects that candidate. Prefix solving starts from the current bounded planner conventions, so globally resource-optimal boost composition remains future work.

| Device family | Current model and remaining boundary |
| --- | --- |
| Fixed ropes/ziplines and bounce devices | Exported identities, directed endpoints, supported attachment and model-based swept motion. Authored state/timing still defines applicability. |
| Moving rocks, lotus supports, conveyor boxes and elevators | Phase-free swept support and directed vertical transport. Exact periodic phase, waiting and selectable-floor semantics remain open. |
| Seesaws | Exported moving support. Angular timing and phase remain open. |
| Forklifts | Actual lifting-rack subtree and endpoint control poses. Vehicle-body collision remains static. Retained export audit covers 18 map01 and 5 map02 objects. Real-point and visual acceptance remain limited. |
| Following stepping boxes | Placement sampling inside the authored activity sphere, supported/collision-checked placement, reconstructed box-top support and used-position output. Retained audit covers 23 map01 and 9 map02 boxes. |
| Steam and other hazards | Applicable exported exclusions participate in planning. Complete map-wide hazard coverage remains an audit item. |

Following-box search currently runs after ordinary planning fails, moves one source box per trial and retains other source collisions. It supports horizontal box tops and handled BoxCollider geometry, emits diagnostics for unsupported/missing ownership and spends a finite placement budget. Multi-box coordination, box shortcuts to an already complete route, continuous placement completeness and moving time remain open. Relevant patched modules are `game/following-route.ts`, `following-supports.ts`, `forklift-supports.ts`, `moving-ground.ts` and `commands/player-route.ts`.

The later traversal export audit also identified incomplete motion relationships for five `InteractiveMovingPlatform` objects, fifteen water-level-driven waterdrone platforms, one waterbody floating support and the separate box-game elevator controller. Existing static/current-pose collision remains useful, while complete transport semantics require the missing control bindings. Actual bridge geometry and bridge-end access are separate investigations. See the Atlos [traversal audit](../../../Atlos/talos/apps/world/docs/traversal-data-audit-2026-11-10.md).

## Resource planning and route quality boundaries

`retimeGroundRoute` runs a bounded label DP over the selected route's ground decision blocks. It carries stamina, recovery delay, sprint state, activation history, velocity, direction and dash state. Dash and sustained sprint share stamina. Pulses continue over collinear seams, terminate at turns/air entry, and preserve cooldown/recovery progression. Non-ground required-gait checks constrain departure state.

The current ground dash uses an approximate 3 m / 0.3 s scale and 0.8 s input interval. Input timing and stamina recovery have source evidence, while the ordinary animation-driven displacement curve remains unverified. `_dashSkillDistance` and `_dashDuration` provide the current approximation. Ground resource state resets at authored non-ground exits according to the existing scheduling policy. Actual airborne exit velocity needs an independent propagation contract.

`ground.mjs` selects a static fastest corridor, straightens and retimes it. When resource scheduling fails, it invokes bounded resource-state graph search to recover another feasible corridor. A feasible static choice currently avoids a complete resource-optimal comparison across all corridors. `searchResources` uses exact continuation-state keys and explicit label/expansion limits. Its defaults are 256 labels per node and 100,000 expansions.

Existing locomotion DP and graph-resource search provide reusable transitions. A unified forward dynamics kernel, complete augmented-state action graph, LGLS-style integration and universally justified Pareto dominance remain unfinished. In particular, more stamina can change automatic sprint restart and a later required entry gait. The retained DP energy/delay dominance rule still warrants review under those control semantics. This is a subsequent correctness/modeling work item, separate from the current region/action-query optimization priority.

Ground-detour pruning compares action excursions against supported walking under the same geometry and exclusions, then retimes the whole route. It preserves collection events and exact endpoints. Routes carrying boost evidence bypass that pass until replacement can propagate boost clocks correctly. Window joining can compare an excursion spanning the previous accepted fragment. These bounded improvements provide feasible alternatives, while global shortest-path and continuous-control optimality remain unresolved.

World renders separate movement modes and reports dash count, remaining stamina and route-local legend. The retained palette uses blue for running, yellow for sustained sprint, orange for dash, purple for jump/drop, green for ropes, pink for launch devices and cyan for moving support. New color visuals, moving-support rectangles and live motion timing retain their recorded acceptance scope.

## Performance checkpoint and unresolved work

The heavy action baseline under alpha.70 was 158.363 s total with 153.896 s in search. The earlier comparable alpha.67 baseline was 154.793 s. The retained `bounded-topk` checkpoint measured 102.562 s total and 98.042 s search with selected modeled cost `8.94138859157342` retained. This is approximately 64.8% of the alpha.70 total. The 20% thresholds are about 31.673 s against alpha.70 and 30.959 s against alpha.67. The performance objective remains unmet.

That heavy measurement belongs to the non-frontier pruning checkpoint. The final frontier-restoration change preserves the branch used by its fourteen non-frontier calls, but the record still has the checkpoint's source scope. A complete final-binary replay of every case has not been established by that observation.

The final retained direction replay after restoring frontier behavior measured **61.049 s total and 34.476 s search**, with modeled route cost `51.802466186195744` preserved. The preceding release76-direction run measured 49.142 s total and 28.078 s search. Both observations remain in the record. The final direction time is slower than the older 44.407 s alpha.70 sample. These single runs also vary in input, ground preparation and other stage timings, so causal attribution requires a controlled follow-up.

Raw evidence is in the local noclip research root, under `.research/stage123/action-search-20261110/`, particularly `bounded-topk/`, `release76-direction/` and `release76-frontier-restored/`. The companion [history](history.md) records other cases, rejected cache/cluster experiments and measurement caveats. Exact nearest-prefix caching and local-cube query experiments failed their measured benefit/acceptance goals and were removed from production use.

The read-only topology inventory of the heavy ground input contains 121,081 support faces and 61,264 exposed boundaries; prepared/refined discovery geometry can have different counts. Strict same-SCC, continuous collinear chains reduce this input's boundary count by only about 1.07%. Spatial 4 m XZ / 2 m height groups within SCCs yield 4,784 indexing clusters while retaining every original edge. Those counts identify a possible structure for batched region-pair work. A production dual-tree region/action search and its acceptance evidence remain to be implemented.

The next agent should concentrate on these outstanding boundaries.

1. Reduce repeated region state and action-query generation across airborne prefix targets. Share genuinely target-independent work while preserving required witness/control coverage and physical acceptance. When claiming equivalent bounded enumeration, preserve its budgets and tie behavior. An intentional strategy replacement needs explicit coverage, stopping and quality evidence under the companion testing standard.
2. Develop directed region/entry/exit assets and conservative region-pair/control-domain refinement. Preserve original surfaces, holes, one-way passages and internal witness coverage. A cluster centre provides insufficient passage evidence.
3. Separate first-feasible latency, optional improvement and whole-request retries. Ground, device/refinement preparation and renewed window budgets still contribute substantial work. A persistent worker alone leaves cache-slot replacement and planner rebuild costs.
4. After the spatial/action reduction work, address resource-state composition, dominance and exact prefix exit state, together with independent fixed-control forward replay and perturbation validation.
5. Complete moving-controller bindings, multi-box handling, source-bound map coverage, ordinary entry acceptance and the full south-to-north physical connection. Earlier base-collision prefixes and independent tails retain their original coverage scope.

Older [architecture](../architecture.md), [roadmap](../roadmap.md), [ground topology](../ground-topology.md), [solver performance](../solver-performance.md) and [prebuilt navigation](../prebuilt-navigation.md) documents retain useful assumptions and historical acceptance definitions. Their alpha.21/alpha.58 milestones and earlier ordering need to be read alongside this current handoff and [history](history.md). Persistent regional transfers, shared validated action assets, state-preserving contraction, complete release manifests, robust recommended-route evaluation and the original time-reduction goal remain open.
