# Route solver history and validation evidence

Updated 2026-11-10. Read this with [the current handoff](handoff.md) before changing the solver. This file records what was implemented, measured, rejected or only proposed; the companion file owns the current architecture, model and next actions. Update both when a change alters their conclusions. Historical test passes and timings below apply to their named versions and inputs, not to a future checkout.

The current objective is to reduce candidate-space and action-search cost to **at most 20% of the original cost**, while preserving feasibility and route quality. It is **not achieved**. For the retained heavy-action alpha.70 baseline, the latest bounded-top-K trial leaves 64.8% of command time and 63.7% of search time. The final installed direction replay is slower than its baseline. No map-wide speedup, continuous-space optimum or complete independent forward-replay acceptance is established.

## Evidence and provenance

The durable history is [solver-performance.md](../solver-performance.md), [the per-point table](../per-point-performance.md), its [CSV](../per-point-performance.csv), [stairs validation](../stairs-validation.md) and [prebuilt navigation](../prebuilt-navigation.md). This file also migrates the still-relevant history from the retired `docs/Handoff01.md`, whose last recorded revision was `9b75ecc9278f670cecde52be3fb1c05833b8f6f7`. Its historical text can be recovered with `git show 9b75ecc:docs/Handoff01.md`.

Raw local evidence is under `/Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/`. That repository ignores `.research`; these artifacts are not delivered by an ordinary clone. Preserve or explicitly archive the inputs and results needed for any future comparison. Useful entry points are:

| Local evidence | What it establishes |
| --- | --- |
| [jump-space-alpha70/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/jump-space-alpha70/comparison.json>) and its `summary.md`, `candidate-check.mjs`, `route-check.mjs` | Alpha.70 checkpoint, candidate preparation/search split, warm result and memory readings; physical control runs |
| [action-clusters/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/action-clusters/comparison.json>) and each experiment's `timing.json`, `result.json`, `query-work.json` | Exact-reuse, cost-bound, mixed dynamic/global-pool experiments and alpha.71–73 comparisons |
| [action-search-20261110/comparison.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/action-search-20261110/comparison.json>) and its experiment subdirectories | Local-cluster prototype, bounded top-K trials and the later final installed direction replay |
| [detailed-profile-20261110/profile-analysis-final.md](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/detailed-profile-20261110/profile-analysis-final.md>), matching JSON, `all-stages.md`, ledgers, per-run stages/CPU profiles and search-attempt tables | Earlier instrumented cold/warm attribution and instrumentation controls, bound to alpha.67-era inputs |
| [complex-regression-alpha67/reviewed-summary.json](</Users/canvas/_Code/EF Repos/endfield-noclip/.research/stage123/complex-regression-alpha67/reviewed-summary.json>) and `diagnosis-20261110.md/json` | Historical 113-request regression classifications and diagnosis, not an alpha.76 full-corpus certification |

The source hashes and input manifests in the raw records take precedence over directory names or package version labels. The final source checkpoints for this work are Ganglia `066dc1d` (alpha.70), `3edbe40` (alpha.73), and `917dfcd` (alpha.76). Atlos adopted alpha.76 in `9311d063`. These identify the recorded checkpoints, not a promise that later working trees remain unchanged.

## Earlier implementation and acceptance history

The older architecture/roadmap described an alpha.21 modeling baseline. Later features did not complete every phase in those documents. Preserve the following distinctions when using that history.

| Checkpoint | Implemented strategy and evidence | Limit that remains relevant |
| --- | --- | --- |
| Alpha.22 ground work | Compact-span stair connectivity, paired directed entry/exit intervals and step checks; 24 directed synthetic stair queries completed by walking, and 31/31 recorded real positives included 13 stair profiles | These are the tested parameter families and samples, not arbitrary staircase or whole-map acceptance |
| Alpha.30–31 reuse | Reused exact goal-distance estimates while accounting for faster and zero-cost actions; five retained physical requests had identical complete routes and connection arrays; 155 SDK tests passed | A narrower terrain binding made a separate query unavailable in both versions; coverage failure was kept separate from the five successes |
| Alpha.39 cold preparation | Exact median collision/support BVH work, indexed refinement with original triangle order, owned support primitives, shared static wall-filtered topology and consumed boundary-order prefixes | Cross-planner portal graphs were still rebuilt; no regional contraction or cross-process reuse was established. Derived edge-string retention and a lazy-straightener experiment were excluded after lacking useful total-time gains |
| Alpha.47 graph work | Reused the validated topology; resumed query-owned forward/reverse distance fields when actions were appended; restarted on changed roots, graph or action weights; reduced repeated tracing allocations | A face kinematic prefilter and an in-place field-reset experiment were excluded. Fewer expansions did not establish smaller peak RSS |
| Alpha.53 lookup | Packed build columns, allocation-light nearest heaps, analytic duration without phase-object allocation, unchanged goal-probe handoff | Candidate prefixes, tie order and physical checks were preserved. A combined serial worker experiment had no useful consistent gain and was removed |
| Alpha.56 moving-support integration | Rejected endpoint comparisons across different weak ground components, retained successful traces, avoided retaining failed serialized pairs | A fresh device preflight was 61.06 s before / 55.04 s after, both unavailable. Heap was about 3.716 / 3.744 GB; this was not route reachability or memory-reduction evidence |
| Alpha.57–58 action chains | Alpha.57 let coarse action chains change primary search coverage early, worsening one model route by 0.630 s. Alpha.58 retained the original main search and added verified-action/coarse-chain continuation only after failure | Alpha.58 restored the 38-point selected-cost baseline. This is a precedent against allowing a new heuristic to consume or reorder the established main search silently |
| Alpha.61 capability work | Resource-infeasible corridors received a bounded multi-label alternative search; airborne collection ended at the first target-volume hit; one boost pickup and a tail were compared, including a revalidated final-jump expiry continuation; ground corners were shortened under support/collision checks | 215 SDK tests passed, with specific packaged Atlos examples. This did not complete global resource-optimal routing, independent control replay, regional action assets or whole-map acceptance |
| Alpha.62 dash/display | Added bounded dash allocation in fixed-route resource DP, shared stamina/cooldown progression and preservation of airborne event indexing; exposed gait, dash count and resource output in World | 220 SDK, 26 extractor and 44 World tests passed, with World type/build and headless GPU checks. Real-map color inspection and the actual animation-driven dash displacement curve remained unverified |
| Alpha.63 entry search | Retained valid fixed-device endpoint traces, invalidated moved/removed endpoints, screened entries lazily and divided discovery across directed ground regions | Local successful jumps and a roof/boost tail did not prove the missing earlier teleport-to-street connection |
| Alpha.64 candidate/windows | Added reusable candidate planning, query-local exclusions, lazy edge replacement, terminal navigation assets and bounded physical windows carrying actual exits through whole-route retiming | 228 SDK tests plus an exclusion check passed. South-to-north terminal-physics acceptance remained open; earlier base-streaming prefix/tail evidence could not be relabeled as terminal-physics acceptance |

The 38-request cold-replay series used retained pre-v74 success inputs, with 36 distinct physical input bindings. Fourteen requests had original CLI logs; 24 had explicitly frozen recovered selections. Alpha.39/47/53 each preserved all 38 complete route, connection and limit objects against alpha.31. The respective recorded SDK counts were 180, 188 and 190.

| Historical batch | Command total (s) | Search total (s) | Interpretation |
| --- | ---: | ---: | --- |
| Alpha.31 | 554.891 | 202.690 | Integrated frozen baseline |
| Alpha.39 | 452.624 | 152.695 | Same frozen population |
| Alpha.47 | 417.453 | 140.154 | Same frozen population; incremental fields expanded 1,960,025 nodes versus 5,953,562 reachable nodes across corresponding complete passes |
| Alpha.53 | 398.647 | 129.342 | Separate full replay; eight requests were 12–475 ms slower than alpha.47 |
| Alpha.55 / .56 / .58 | 467.518 / 457.298 / 463.199 | See per-point CSV | Separate moving-support integration batches; not interleaved or load-isolated |

Alpha.58 retained 38/38 complete results at the frozen selected cost, with 37 identical route objects and 36 identical full action sets. Ten frozen routes still had shorter historical alternatives. Preserving a frozen baseline did not close those historical quality gaps. The alpha.55/.56/.58 totals are distinct batches, as the [per-point integration record](../per-point-performance.md) documents; they are not conflicting estimates of one run. Original mesh construction, HTTP scheduling and other origin attempts were outside those command totals.

### Historical cases and device assumptions worth retaining

These are dated observations migrated from the old handoff. The companion handoff owns the current model and current verification status.

| Historical case | Recorded evidence | What it did not prove |
| --- | --- | --- |
| `10YLgUg`, alpha.58 | 9.975 s command, 8.199 s model trip; older retained trip 6.154 s | Historical best quality was not recovered |
| `17nac6U`, alpha.58 | 19.262 s command, 22.634 s model trip; older retained trip 15.238 s | Same quality gap distinction |
| `0bzZEM3` / `0nQJhsI`, alpha.58 | 35.092 / 20.122 s command and 50.812 / 32.514 s model trips | Current-data first-task latency was not measured by these old successes |
| `0DUKUgc`, audit through 11-05 | 17 retained results were unavailable; six complete-search commands were truncated, taking 46.526–165.917 s | Bounded failure was not physical impossibility or a statement about a later version |
| `02lUaTb`, map02_lv009 | 51.90 s command, 55.686 s model trip, 184.83 m anchor distance, two ropes and seven jumps | It did not use moving swept support, so success was not proof that moving devices were necessary |
| Arbitrary target at a lily-pad end | 25.12 s command, 33.170 s model trip; 74/583 walking samples supported only by moving surfaces | This supplied local swept-support evidence, not full map02_lv009/010 coverage |
| `0YnbG6f` | Small-domain run 52.51 s, including 12.61 s device preparation, unavailable; larger domains exposed native height and JSON limits | No current reachability result followed from that audit |
| `02gcZm4` local tail | Packaged alpha.63 reproduced the lower-rope-to-north-roof/boost/airborne tail at 8.068946 s; 15 local jump collision checks succeeded | The TP30005-to-street prefix was still missing then; a later full HTTP route used another origin and a different complete path |
| `0kkQ3em` / `19Nzh29`, alpha.61 | Packaged airborne-goal and teleport/boost/collection examples were exercised | Later event-contract checks still had to evaluate precise geometry and timing |
| `0DPyejn`, `0T264e6`, `0mmXi4a` | Listed user problem cases, not remeasured in that handoff | Their then-current reachability, required devices and anchor quality remained unestablished |

The 2026-11-09 snapshot used Ganglia alpha.59 / `a9507ae`, Atlos `c7a28dca`, noclip upstream `30f73f46`, AKEDataMining `ae33f49ff` and noclip integration packageVersion 98. Its branch/remote observations were local tracking-reference observations, not a new fetch. Atlos `fef4898c` had added forklift/range-limited box modeling and `c7a28dca` restored preview/routing entry. These are historical markers only.

That snapshot explicitly assumed completed tasks, powered facilities/open doors, and phase-free moving support. Horizontal movers supplied swept support, vertical movers supplied transport; angular seesaw timing, waiting and platform phase were not completed. Following boxes were arranged within authored activity bounds, with placement output but no activation/guidance or carrying time. Only one source box moved per trial; other boxes retained their collision. Box fallback ran after failure, so box shortcuts improving an already complete route and coordinated multi-box placement remained open. Unsupported collider ownership/geometry was diagnosed. Finite defaults of 8,000 candidates / 64 links did not cover continuous placement completely.

The export audit recorded 65 synthetic tests, moving-support counts 87→105 on map01 and 139→144 on map02, preserving the prior 226 objects and other catalogue fields. It added 23 forklift sources (18/5) and 32 following-box sources (23/9). Real-point forklift/box routing, end-to-end latency and GPU support-rectangle display were still pending. The temporary `/tmp/placement-final-tests.log` and `/tmp/placement-export-audit.json` were local evidence; the durable summary is [Atlos route inspection](../../../Atlos/talos/apps/world/docs/route-inspection.md).

The historical movement source used build `2954fa80-23c1-1579-2b22-4ecfd6d70418`: boost duration came from `ReqAddBuff`, the 1.2 increment yielded the modeled 2.2 multiplier, and `ccs_duration` was camera time. The recorded ordinary launch/sustained air speeds were 9 / 6.5 m/s with 5 m/s² overspeed deceleration. Dash used an approximate 3 m / 0.3 s displacement and 0.8 s input interval; animation displacement remained unverified. These source-derived/approximate distinctions must survive future model updates.

G3 state-preserving regional entry/exit contraction, persistent action assets, full resource-optimal routing, independent control propagation and complete-map acceptance remained open. The native detail-triangle/polygon ownership was not preserved, so graph scale followed detail density. Prebuilt experiments measured a `0bzZEM3` local payload of 60.10 MiB raw / 16.70 MiB gzip, without a complete manifest, collision BVH and action evidence. A C/WASM BVH kernel prototype measured 151.8→86.1 ms, but 138.2 ms including setup/packing/JS rebuilding; it was not integrated route acceptance. See [prebuilt navigation](../prebuilt-navigation.md) for those component experiments rather than treating their kernel gains as command speedups.

## Regression and profiling before the current optimization baseline

The historical alpha.67 review finished 113 retained requests: 63 passed, 33 improved, 14 regressed, two failed the event-evidence contract and one baseline was invalid. Those classifications include older baseline/model/search-budget differences. They are a backlog and provenance record, not proof that the later alpha.76 optimization regressed 14 requests.

The `0kkQ3em` old event was approximately 75.874 mm outside the trigger and 9.145 ms early; an invalid old event must not be the quality target. The two `missing-goal-event` cases (`035-06IsDPb`, `047-0cauQ22`) had valid grounded endpoints inside their goal volumes in both old and new results, but lacked the explicit event evidence required by the reviewed contract. Keep feasibility and event-contract failure as separate dimensions; they were not new reachability failures. Earlier `17nac6U` / `10YLgUg` quality differences also involved substantially different discovery budgets. Do not relabel these as isolated regressions from a later performance patch.

The detailed profiling series contained 26 cold/warm trials. It instrumented stages/functions and sampled V8 CPU stacks. Cold heavy action took 173.348 s with insertion hooks versus 154.793 s in its uninstrumented control; the latter still had CPU sampling enabled. The recorded inclusive hierarchy contained about 167.031 s in airborne-goal planning, 154.675 s in the boosted branch, 149.755 s in 21 entry-approach calls and 143.974 s in 14 shortcut searches. These nested times cannot be added. Disjoint deepest-frame categories attributed 55.282 sampled seconds to bounds and 40.421 to shortcuts, with 24.740 to GC. They indicated where to investigate, not isolated speedup potential.

Ground-detail profiling was 18.148 / 3.984 s cold/warm versus 16.395 / 3.936 s control, including I/O/JSON in the revised harness. Candidate profiling was 103.178 / 1.556 s. A high-frequency `scheduleBlock` hook had 3,853,372 calls and was removed from the low-overhead detour harness. That harness measured 65.509 / 60.528 s against 61.459 / 57.692 s control, with equal routes/connections. Sequential single trials cannot isolate the amount saved by removing one hook, and profiler overhead itself was not independently quantified.

A separate ordinary HTTP check used a fresh Vite server/worker on an isolated port, existing disk/input/terminal assets and uncontrolled OS caches. It completed in 97.689 s excluding server setup; an identical warm request was 7.610 ms and returned the same route. That warm result was reuse of a completed task, not fresh action-search performance. Its complete trip cost was 96.075256 s from `TpForMap_ent_22800030004`, distinct from the earlier local 8.068946 s roof tail.

## Alpha.70: retained envelopes, resumable frontiers and lazy candidate transfers

**Implemented and retained:** `066dc1d` introduced conservative reachability predicates in spatial queries, reverse-frontier predecessor constraints, resumable seed/landing/control queues, indexed candidate endpoint matching and lazy unresolved transfers for expanded ground components. Stable transfer keys reached query-local exclusion handling. The envelope retained the existing finite control/candidate coverage; it did not solve an unrestricted supported-run-off reachable set.

| Alpha.70 candidate experiment | Before | After | Scope |
| --- | ---: | ---: | --- |
| Preparation | 65.673 s | 8.480 s | Work moved out of eager graph construction |
| Search | 9.040 s | 38.425 s | Lazy generation moved substantial work into the query |
| Cold total | 74.713 s | 46.905 s | 37.2% lower; candidate points and score matched |
| Same-planner warm query | 1.342 s | 1.313 s | Near the existing warm baseline |
| End-of-experiment RSS | 1.93 GB | 3.23 GB | Higher, not a demonstrated memory improvement |

The heap-used readings also rose, about 2.293→3.072 GB. These were end readings with unreclaimed objects and V8 heap capacity effects, not isolated retained-index memory or process peaks. Candidate route equality alone did not prove physical feasibility.

The three physical controls were 154.793→158.363 s (action), 23.012→23.190 s (failed window), and 43.431→44.407 s (direction). Final routes matched; only the action case also retained identical complete connections. Alpha.70 therefore established a candidate-cold benefit, not an action-search benefit. Its recorded checks were 249 SDK tests at the initial package checkpoint, then 45 focused and five Atlos entry checks after fixes. World type checking at that checkpoint failed on the recorded TypeScript/noclip viewer API types; that historical failure is not a claim about the current checkout.

For subsequent physical optimization comparisons, use **alpha.70's new retained baseline**, not alpha.67's instrumented or differently configured results: action 158.363 s, failed window 23.190 s, direction 44.407 s. Alpha.70 is a checkpoint after prior optimization, not the earliest unoptimized implementation. The candidate's pre-`066dc1d` 74.713 s control is another measurement family. The 173.348 s instrumented profile must not replace the lower-overhead physical denominator. A fresh alpha.70 device-entry control was 17.452 s with trip cost 14.88124591890099. The earlier profile's 14.316685 device trip is a different historical baseline and must not be presented as a regression caused by this round. The ≤20% target remains unmet under both the 158.363 s and earlier 154.793 s heavy-action controls.

## Later attempts and decisions

The table separates implementation status from a promising name or a one-off timing. Experiment combinations were not a controlled ablation study.

| Attempt | Classification and disposition | Recorded outcome / reason |
| --- | --- | --- |
| Exact cross-prefix nearest-result/witness reuse, canonical component views and serialized keys | **Implemented experimentally, then removed** | `exact-reuse`: 184.803 s total / 180.491 s search versus alpha.70's 158.363 / 153.896 s, same selected trip cost 8.94138859157342. Key, admission and retention overhead outweighed reuse. Do not restore the discarded general nearest/witness factory on cache-hit counts alone |
| Global verified-action pool shared across different approach goals | **Implemented experimentally, then restricted back to one solve query** | `alpha71/action`: 134.488 s / 129.733 s, trip cost changed to 8.919162661604151; direction was 51.003 s / 27.588 s, above the alpha.70 control. A faster or lower-cost sample did not establish a uniform benefit or preserve the established finite-search comparison. Pool contents changed later discovery/ordering. Current local pooling is narrower |
| Incumbent prefix cost bound | **Implemented and retained as part of `3edbe40`** | `cost-bound`: 130.577 / 126.304 s, original trip cost retained. It bounds each approach by incumbent total minus the fixed terminal-flight duration; the relative discovery budget subtracts the actual arrival cost once, and direction subqueries retain the real final bound goal |
| Motion domains, reverse predecessor bounds and terminal-flight steering | **Implemented and retained in `3edbe40`; mixed trial attribution only** | `dynamic-steering`: 136.757 / 132.308 s, trip cost 8.919162661604151. This trial also contained action-pool/bound changes; neither its difference from 130.577 s nor its gain from baseline isolates steering or a single formula |
| Per-solve canonical action deduplication | **Implemented and retained after global-pool rollback** | Later arrivals merge the current solve's actions and recompute their incumbent; IDs remain unique, failed partial sets are deduplicated, and inherited actions do not consume another arrival's new-link quota. Alpha.72 action: 121.101 / 116.645 s, original exact route restored |
| Shared local spatial-tree prototype | **Implemented, measured, then removed** | `clustered`: 125.974 / 121.221 s, exact original route, slower than the preceding 121.101 s total. Almost every local iterator still started global traversal, so the extra structure did not remove the expensive fallback |
| Exact collinear boundary merging | **Investigated/count experiment, not adopted** | 61,264→60,610 boundaries, only 1.07% fewer. No end-to-end speedup claim; no approximate face merge was enabled |
| Larger spatial/kinodynamic clusters and physical blocked-region certificates | **Investigated, not implemented** | A certificate would need actual collision-triangle coverage and a conservative reachable section; a navmesh seam or apparent floor interior is insufficient. Supported uphill run-off prevents treating every seed as an immediate ballistic launch |
| Conservative face/top-K bound, one-goal projection cache, stable bounded insertion and cell reuse | **Implemented and retained in `917dfcd`, restricted to improvement discovery** | The heavy bounded-top-K trial was 102.562 / 98.042 s with the exact original selected route; final frontier processing retained its prior witness generation and sort/pop behavior. Details below |

The removed exact-reuse prototype is archived under `action-clusters/exact-reuse/`; the removed local-tree prototype is under `action-search-20261110/clustered/`. The initially measured local-tree prototype could change equal-distance ordering despite preserving distance order and the complete candidate multiset. A later helper revision falls back to the original global iterator before emitting ties; sequence/prefix tests passed, but that revision was not the source of the 125.974 s timing. The archived helper includes that later revision. These archives are experimental code, not maintained production modules. Static landing metadata and the later one-goal projection cache are narrower retained mechanisms, not evidence that the failed broad cache was re-enabled.

Review during the cost-bound/pool work found real correctness hazards: a second cheaper arrival could lose a globally deduplicated edge absent from its local connection set (6.4663396 s selected instead of 1.4663396 s in a two-floor reproduction), and widening a cost bound could reuse an exhausted tighter-bound cursor and miss a fresh-cache success. Focused regressions now protect local action availability, duplicate IDs and cost-bound/`boundGoal` cursor invalidation. Do not remove those distinctions when attempting wider sharing.

## Alpha.76 measurements and remaining target

These are fresh-process retained-input command measurements on Node v26.13.0 with a 4 GiB heap limit. Values are **command elapsed / extractor search stage**, in seconds; search is included in total. The named heavy and failed-window artifacts were collected before the final frontier-restoration replay. Preserve those trial identities rather than treating the table as a synchronized whole-release benchmark.

| Case and trial | Alpha.70 baseline | Previous retained comparison | Latest recorded trial | Result |
| --- | ---: | ---: | ---: | --- |
| Heavy action, `bounded-topk` | 158.363 / 153.896 | Alpha.72: 121.101 / 116.645 | 102.562 / 98.042 | Exact original selected route, cost 8.94138859157342 |
| Failed window, pre-restoration `bounded-topk-failed` | 23.190 / 16.019 | Alpha.73: 24.977 / 17.101 | 24.396 / 16.657 | Same unavailable outcome; slower than original, not physical-impossibility proof |
| Direction, final installed `release76-frontier-restored` | 44.407 / 24.379 | Alpha.73: 48.129 / 24.627 | **61.049 / 34.476** | Exact original route, but this final measured run was worse |
| Device entry, alpha.73 checkpoint only | 17.452 / 11.709 | — | 16.739 / 11.227 | Exact alpha.70 route, trip cost 14.88124591890099; not a fresh alpha.76 result |

Earlier direction trials were 47.992 / 26.177 s and 49.142 / 28.078 s. The later 61.049 / 34.476 s must not be replaced by the best earlier trial or hidden behind the heavy-action improvement. These sequential single observations have uncontrolled JIT/GC/load variation; they establish no direction benefit and do not isolate a causal regression factor.

The heavy search still charged fourteen full improvement batches: 1,792,000 seed slots and 7,168,000 neighbor slots. It skipped landing generation for 708,159 faces, 9.88% of charged neighbors, retained 4,629,386 bucket candidates across queries and made 6,238 uncached shortcut trajectory attempts. These counts exclude airborne-terminal trajectory attempts. They do not show fewer spatial-node visits, all witness generation costs, or a new full function profile.

Against alpha.70, heavy total/search remaining fractions are 64.8% / 63.7%, not ≤20%. Against the preceding retained algorithm they are 84.7% / 84.1%. The alpha.70 heavy targets would be about 31.673 s total and 30.779 s search. Candidate generation and repeated approach queries remain structural work; the existing measurements cannot predict whether a future regional or implicit-action algorithm will reach those targets.

## Investigated or proposed directions that are not completed implementations

The user's pasted roadmap (local attachment ID `d0f295e0-6175-4592-9d6e-b0ab913b377e`) and [the roadmap](../roadmap.md) supplied the following directions. This is a project-status record, not a new literature review or a transfer of external correctness/speed guarantees.

| Direction | Status at handoff |
| --- | --- |
| Reachability-informed kinodynamic sampling, including the Ding et al. jumping-robot reference | Analytic conservative envelopes and restricted inverse steering were implemented using the existing character motion model. A precomputed robot reachability map, kinodynamic RRT sampler and contact-dynamics optimizer were not implemented |
| L-GLS / incremental lazy validation and search repair | Proposed; no complete L-GLS engine or acceptance result |
| Full RCSP/label setting, Pareto state dominance, unified resource-transition kernel and reusable DP prefixes | Source investigation/planning only for the proposed cross-layer redesign. Existing bounded resource-alternative search and fixed-route DP predate it and do not establish the complete redesign |
| Nonmonotonic stamina counterexample | The attached source investigation reported that more energy can cause an earlier automatic sprint and leave a later required-sprint entry infeasible. Its 1.25-versus-1-energy example motivated safer dominance conditions. This is not a fresh alpha.76 reproduction, a general monotonicity theorem or a completed kernel fix |
| AIT*/EIT*-inspired ordering by route cost versus validation effort | Proposed as separate ordering signals; no production implementation or measured benefit |
| Search-directed implicit physical-action graph / IxG-inspired successors and local trajectory optimization | Proposed; alpha.70 lazy unresolved candidate transfers implement only a narrower piece. There is no complete graph-of-convex-sets cover or associated local optimization engine |
| Learned ranking/validation-budget allocation | Proposed; no trained model, independent holdout result or enabled learned pruning |
| Kinodynamic RRT-Connect / HyRRT-Connect, or direct replacement with SST / RRT* | Proposed alternatives; no implemented production solver, verified reverse dynamics or project benchmark. A planner-family replacement has not been shown to remove this project's expensive successor-generation cost |
| State-preserving regional action assets and complete independent forward replay | Open structural work, not completed by caches, conservative local bounds or a few successful windows |

The attachment originally placed resource work at P0, requested five interleaved cold/warm groups for every representative family, and used “at least 20% improvement.” Later user instructions superseded that order and acceptance regime: prioritize candidate-space/action retrieval, target **remaining cost ≤20%**, and use bounded, relevant validation. Do not revive the earlier priority or launch every expensive replay on each iteration by treating the old attachment as current authorization.

## Finite validation standard for the next change

1. **Bind the comparison before measuring.** Record request/input hashes, geometry and game build, movement/body/wall/device settings, search limits, selected origin/coverage, source commit, package and actually resolved installed source, Node/heap settings, instrumentation and cache state. Use the alpha.70 physical controls above for this optimization lineage unless an explicitly reviewed new baseline is established. Keep input changes, invalid historical goals and earlier resource/model changes separate.
2. **Validate the claimed candidate contract.** For an optimization claiming equivalent finite enumeration, compare old and new retained representatives under unchanged seed/neighbor/endpoint/trajectory budgets. Preserve stable ties, uncertainty ordering, source/intermediate fairness, insertion order and truncation; the current dominated-face optimization still consumes its original neighbor slot. An intentional replacement of the generation/search strategy must instead state its coverage, fairness, stopping and budget semantics, and validate feasibility and route quality against the established controls. Do not silently call reordered or reduced sampling equivalent, or obtain a speedup solely by weakening the quality/coverage requirement. Unknown controls or unsupported/numerically unsafe bounds retain a conservative fallback.
3. **Exercise cache/cursor changes where relevant.** Larger work budgets resume; changed endpoints, final bound goal, cost bound, geometry/world/body/model/walls or action revision invalidate the dependent state. Increasing a representative/link quota rebuilds when needed. An earlier incomplete solve under a tighter bound cannot block a later wider-bound search. Reusable geometry failures and changed reachability are different dependencies. Check new/removed/faster/zero-cost actions, moved endpoints and multiple arrivals without duplicate IDs or lost local edges.
4. **Retain complete physical acceptance.** Candidate scores and polygon-center heuristics organize a finite search; they do not prove executable route optimality. Accepted motions still need real support, body clearance, walls, complete trajectory sweeps, directed device conditions, whole-route resource scheduling, boost expiry and the required terminal goal event. Supported run-off may walk uphill before actual takeoff. Terminal collection edges cannot become ordinary intermediate transfers. Preserve far/away-from-goal, interior/narrow landings and multi-hop alternatives in the affected fixtures.
5. **Check feasibility and quality independently.** A route that remains complete can still be slower or use a changed finite candidate set. Compare selected origin, points, segments, times, gait, resources, goal event, boost annotations and connection identities where equality is promised. If differences are intentional, explain and validate them rather than silently moving the baseline. A bounded unavailable result remains inconclusive about physical impossibility; existing contract failures remain visible.
6. **Use a finite verification pass.** Once edits stabilize, run directly affected tests and the established checks required for that change, then only the representative solver/HTTP cases needed to resolve its actual risk. Add a focused regression for a real failure, not a mirror of internal structure. Broaden or repeat after a new failure/change or unresolved concern; stop when sufficient evidence exists. Neither indefinite profiling nor a full cold/warm corpus on every small edit is required. A cross-map or release-wide claim still needs evidence covering that claim.
7. **Keep timing meanings separate.** Process/application cold does not mean flushed OS pages; warm prepared planning differs from finished-route cache reuse. Exact instrumented inclusive/self timers, sampled deepest-frame attribution, CPU usage and stage progress intervals have different meanings. Nested function/stage durations overlap. Original phase timestamps may mark completion, not start; use paired attempt start/end events for per-attempt durations. Record profiler/hook overhead and use an appropriate low-overhead control before claiming elapsed-time gains. Report regressions and memory costs as well as wins.

At the alpha.76 checkpoint, **271 SDK tests and 10 Atlos route worker/server tests were recorded as passing**, and checkout, tarball and installed SDK source files matched byte for byte. This history migration ran no new solver or tests. Those old passes do not certify a subsequent edit, package or environment.

Local repeated repacking of the same file tarball had allowed pnpm to resolve stale source despite the apparent version/lock entry. Final verification used the frozen offline forced installation and compared actual resolved source bytes. Prefer a new immutable version/artifact next time, verify the resolved installed code, and review precise package-entry lock changes; broad multiline regular-expression edits had risked consuming unrelated entries. A matching version string alone is insufficient provenance.

The next report should state what changed, its implementation/experiment status, the finite tests and cases actually completed, exact input/version/timing bindings, route-quality differences, remaining uncertainty and whether the ≤20% target was reached. Keep [handoff.md](handoff.md) consistent with that record; do not infer completion from a successful package build, a cache hit or a proposal name.

### Maintained measurement entry point

Use Atlos's versioned [profile-route-stages.mjs](../../../Atlos/talos/scripts/profile-route-stages.mjs) and its loader rather than treating `/tmp` trial scripts/hooks as maintained tools. The [noclip integration README](../../../Atlos/talos/integrations/noclip/README.md) requires Node 26. With Node 26 selected, an existing parent output directory, and a **new, nonexistent** run directory, the minimal low-overhead template from the Atlos root is:

```sh
node --max-old-space-size=4096 talos/scripts/profile-route-stages.mjs \
  --command player-route \
  --args /absolute/path/to/retained-args.json \
  --extractor talos/.cache/noclip \
  --output /absolute/path/to/existing-parent/new-run \
  --baseline
```

`retained-args.json` is the original extractor CLI argument array of strings. The harness redirects result outputs and records input identities. It **always executes cold then warm in the same process**; `player-route` shares its `RouteCache` between those two trials. `--baseline` disables function insertion hooks. CPU sampling is off unless `--cpu` is added; use that option for attribution and label its overhead. Module import/parse/transform setup is reported separately. The script also supports `player-ground` and `candidate-worker`, with different argument/cache semantics visible in its source. Do not launch the template as an automatic prerequisite for every documentation or small implementation change.

## Prepared-query benchmark entry (2026-11-11)

Implemented the additive prepared solver interface, existing surface-action adapter
and a replaceable-adapter benchmark runner. No candidate generation, search budget
accounting or physical validation algorithm was changed. The current adapter is
serial; batch scheduling is not prescribed by the interface.

Initial retained-input measurement: base revision `c8cc213cdf261274c0b3fd43009c158e49193582`, Node
`v26.13.0`, source/workload digest `a3ef83220ba35c69194e193bc66af98993ca70715a29cf6a20d6b618ffd1830b`.
Exact input hashes, fixed requests, limits, runtime arguments, route/connection
hashes and individual outcomes are retained locally in
`.local/research/solver-benchmark.json`. The source digest binds actual `src/` and
`bench/` implementation/type bytes, including uncommitted additions at measurement
time. Documentation and tests are outside that digest.

| Measurement | Initial observation |
| --- | ---: |
| Preparation before single queries, excluded | 921.937 ms |
| Sum of ten new-query calls | 1319.617 ms |
| Nearest-rank P50 / P95 across different requests | 2.184 / 804.569 ms |
| Preparation before batch, excluded | 761.436 ms |
| One ten-request batch call | 1191.981 ms |
| Batch throughput, including unavailable outcomes | 8.389 requests/s |

Eight ground requests completed. Two airborne requests were unmapped and truncated
under 128 candidates, 64 links and zero optional shortcut budget. No devices, boosts,
goal refinement or Atlos scheduling were included. All ten batch outcomes (complete
route and connections) and truncation flags matched singles. The two passes used
separate prepared instances in the same process, singles first, with no explicit
warmup. Lazy discovery preparation is inside the first affected query. These are
single observations, not a controlled speedup comparison, latency distribution for
one repeated request, or evidence toward the historical heavy-query 20% target.

Focused seam tests cover two-jump adapter equivalence, intervening goals, per-request
budget isolation, mixed outcomes in input order, closing, whole-batch submission
with asynchronous completion, and cleanup on failure. The companion handoff has
been checked against this additive scope; existing model and optimization status
remain unchanged.

Validation for this addition: all 275 SDK/benchmark tests passed on Node v26.13.0;
the new declarations passed strict TypeScript 5.8.3 checking. The package's solver
entry resolved successfully, the npm benchmark command exposed its help, and the
actual ten-request run emitted parseable JSON. No Atlos tests or historical heavy
action corpus were rerun because the adapter leaves their algorithm unchanged.

Final command-path verification used `npm run --silent benchmark -- --json` on
Node `v24.22.0` after correcting even-sample median calculation (the initial
record above used nearest-rank P50). Source digest:
`321bacce5d4175cd8cfa2d3298b66facd0d23625168f4b7b831c5aa290cc2cb7`.
The separate `.local/research/solver-benchmark-final.json` preserves this run.
Ten single calls totaled 1283.843 ms (median
3.429 ms, P95 759.826 ms); batch took
1236.064 ms, 8.090 requests/s.
Excluded preparations were 966.137 and 883.459 ms.
The same eight complete / two unmapped-truncated outcomes and all ten outcome/
truncation comparisons were retained. This different-runtime observation is not
a performance comparison with the initial Node 26 run. The two benchmark tests
passed again after the statistics correction; no solver implementation changed.
Standards and specification reviews found no blocking issues in the addition.
