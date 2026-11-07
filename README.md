# Ganglia

`@oem/ganglia` is an experimental ESM ground-routing package for OEM,
with TypeScript declarations. It runs in Node and browsers. Camera rules belong to
noclip; game asset decoding belongs to its extractor.

```js
import { planGroundRoute, sampleJourney } from '@oem/ganglia';
const result = planGroundRoute(surfaces, arrivals, target, {
  speed: 3, maxVertical: 0.5,
  profile: { radius: 0.4, height: 2 }, walls,
});
if (result.status === 'complete') {
  const { position, mode } = sampleJourney(result, elapsedSeconds);
}
```

Surfaces are convex, consistently wound, world-coordinate polygons selected for one
build, scene, state and movement profile. Importers must respect navigation area masks,
clearance, dynamic obstacles and detail heights. Optional `portals` lists the edge indices
that may connect; an empty list closes every edge. Matching 3D edges connect over
their shared intervals, including split collinear edges. Authored directed seam
transfers can connect height differences within the importer's verified step limits.
Ground stitching preserves the importer's verified edge and step constraints.
Optional movement discovery below uses a separately supplied physical model.

Walls may also carry `sphere: { center, radius }` for solid round exclusions.
Their AABB remains a broad-phase bound. Continuous capsule/sphere intersection
checks occupancy and swept travel while retaining empty space at box corners.
Sphere padding is uniform, and prepared queries snapshot the sphere coordinates.

Arrivals supply `{ id, position, cost, state }`. Costs are seconds; availability is
`available`, `locked` or `unknown`. Include the player at cost zero and unlocked teleport
platforms/base centres at their teleport overhead. The result identifies the selected
arrival and contains only the journey after arrival. Unknown or locked arrivals are excluded.
Projection is vertical, within `maxVertical`; it never snaps a point over a gap onto a
nearby island. A base centre's bounding-box height is only a seed: resolve its ground
height before planning. The target and starts retain their projected coordinates.

`route(graph, start, goal, constraints)` and `routeFrom(graph, arrivals, goal, constraints)`
are lower-level entry points for prebuilt directed corridor graphs. The latter takes
node-based arrivals `{ id, node, cost, state }`. A binary-heap multi-source search finds
the minimum cost on the supplied graph. Its admissible distance heuristic uses the
maximum speed of all usable edges; displaced zero-cost edges use Dijkstra. Unknown/closed edges are excluded. Polygon-centre
routes select conservative corridors. Ground visibility tracing removes unnecessary
turns and reconstructs support heights. This does not guarantee a globally shortest
continuous path over every possible corridor.

`blockedByWalls` applies player radius/height and optional wall padding. Unknown walls
block. Optional XZ `points` describe thin wall polylines; `polygon` describes a filled
ring extruded between the bounds' Y limits, including concave footprints. The two are
mutually exclusive. Both tests include vertical overlap and rounded horizontal clearance.
Without a footprint, bounds conservatively block. This covers vertical air walls and reset prisms,
not arbitrary collision meshes. Pass `{ walls, profile }` to graph queries; the high-level
planner requires them. Even stationary paths and endpoint connectors obey exclusions.

`createWallChecker(walls, profile)` snapshots and validates a fixed constraint set
once, then serves repeated segment checks through a 3D bounds index. It shares the
same precise polygon, polyline and body-clearance tests as `blockedByWalls`.
Prepared routes, straightening and traversal discovery reuse this path.

`surfaceGraph(surfaces, { speed })` and `projectPoint(surfaces, position, { maxVertical })`
are available for importers. `sampleRoute(points, meters)` samples arc length without
smoothing through corners. `unmapped` or `no-verified-route` means the inputs cannot prove
a route, not that the game destination is absolutely unreachable.

Run `npm pack` (which runs the tests) for an installable archive. The package includes modules,
declarations and the repository's AGPL-3.0 license, never game assets. Registry publication
is separate. Atlos consumes this archive as a package dependency. Runtime player-state
integration, complete player navigation coverage and in-game traversal validation remain
outstanding; this is an alpha implementation.

## Directed movement and playback

`GroundOptions.connections` accepts explicit `{ id, mode, points, times, state }`
connections. Modes are `rope`, `jump`, `drop` and `launch`; each connection grants
only its supplied direction. Availability uses `open`, `closed`, `unknown`. Both
endpoints must already lie on a supplied surface (1e-6 m numerical tolerance).
An importer can explicitly supply `endpointTolerance` for collision-supported feet
above the navigation plane. It is bounded by `maxVertical` and body radius. This
does not authorize joining different floors.
The importer must validate the entire trajectory, landing, body clearance and
movement state before marking a connection open. The planner also checks every
sample interval against air walls; it never exempts a rope or launch from them.
An authored device position alone is not a verified connection.

Connections may require `requiredGait: 'sprint'` at entry. The locomotion scheduler
retains only schedules that already paid for an active sprint before that segment.
If no schedule can meet the requirement, the result is `no-verified-route`. Ground
planners exclude gait-dependent connections when the caller omits locomotion policy.

Times start at zero, correspond one-to-one with points, and end at the segment's
travel cost in seconds. They preserve variable speed and pauses; non-walking
segments require a positive duration. Lower-level graph edges accept the same
`mode`, `times` and optional `connection` identifier. Walking edges without times
retain their existing constant-speed interpolation over the supplied corridor.

Complete routes retain `points` for spatial consumers such as camera selection,
and add timed `segments` plus `arrivalCost`. `sampleJourney(route, seconds)` returns
`{ position, mode, connection? }` after the chosen arrival, and `mode: 'complete'`
at the end. It interpolates supplied samples without fitting a new curve. Include
startup/exit time in the supplied trajectory when known. `sampleRoute` remains an
arc-length utility; do not use a single walking speed to animate mixed movement.

Acceleration buffs are not automatically applied to subsequent edges. Their
remaining duration and effect must be part of the importer's graph state; joining
all such states at the same location would incorrectly grant a permanent boost.
Game-specific trajectory generation and movement-state expansion are not yet
complete. Synthetic directed-connection tests do not establish game reachability.

`jumpConnection(start, end, options)` generates an explicit model-based jump/drop.
Its authored gravity, jump height, apex hold and terminal fall speed determine
vertical motion. Constant horizontal travel must fit the supplied speed cap.
Continuous capsule sweeps inflate every sampled chord by the bounded curve
deviation. `jumpDuration` exposes the same analytic vertical duration for discovery.
Intervals whose curvature envelope touches geometry are subdivided before rejection,
retaining full-body sweeps at every refinement. Optional explicit air acceleration
and deceleration enable bounded early, late and split horizontal control primitives.
These can brake over an opening before descending under an overhang. Their complete
three-dimensional acceleration bounds inflate every swept chord. Sprint entry uses
peak horizontal speed, including acceleration phases.

Discovery also considers supported walk-off drops. These follow bottom-sphere
support over a ledge before free fall, including rounded contact with triangle
edges and corners. Every approach chord checks body clearance and air walls.
With explicit air-control limits, directed ledge exits can continue into a curved
fall beneath an overhang. A constant-speed supported approach supplies the initial
air velocity. Cubic velocity controls bound speed and acceleration throughout the
fall, and every curved interval retains the same swept body and wall constraints.

`findJumpConnections(surfaces, collisionWorld, options)` searches separated directed
ground components, including intermediate platforms. Caller-supplied sampling and
search limits bound offline work. Standing feet require real collision support,
capsule clearance and acceptable slope. Each accepted arc also checks air walls.
The result includes explicit truncation diagnostics. Sampling can miss valid
links, and passing this model still requires in-game movement validation.
The search groups ground polygons by directed, wall-filtered connectivity. A
backward region search uses spatial bounds, height and horizontal distance to
order optimistic chains. It generates neighbouring region pairs on demand and
collision-checks only local transfers on proposed chains. Rejected transfers
trigger another chain search; accepted trajectories and standing checks are reused.
Arc validation runs in small scheduling batches. Difficult shortcuts are deferred
with their remaining candidates intact so a nearby multi-hop chain can be tried
before that shortcut consumes the entire query budget.
Local pairing lazily covers exposed takeoff ledges and queries continuous landing
positions on surface interiors as well as edges. Candidate ordering estimates approach, flight and departure
time; minimizing horizontal flight span alone can favour blocked vertical drops.
Nominally feasible samples precede those relying on navigation-height tolerance.
Exhausting generation work still permits validation of already retained candidates.
Seed-pair generation also runs in resumable batches, preserving its iterator and
queued refinements. One difficult transfer cannot consume all generation work before
an alternative multi-hop chain is explored. `maxCandidates` bounds local generation
and retained candidate batches. Seed, pair, contact and arc limits
are reported separately. Cached optimistic region adjacency remains available
after generation budgets run out.
These bounds and ordering costs never grant movement access or establish optimality.

Optional `interaction` uses the same standing-volume contract as ground planning.
All eligible target faces participate together, grouped by component; there is no
fixed face-count cutoff or repeated search for faces in the same region. Local
sampling visits body-scale launch regions, then diverse landings and fine offsets,
retaining narrow platforms and railing pullbacks. Work limits cover seed generation,
neighbour/pair checks, stationary contacts, arc attempts and retained links. They
remain shared across the complete query and are exposed in diagnostics. This
discovery seeks a feasible region chain; corridor and resource optimization remain
separate, and a region connection can still fail the final ground route or gait policy.

## Ground and jump action planning

`planJumpRoute(surfaces, collisionWorld, arrivals, target, options)` is the reusable
query entry point for ground, jump and jump-down/drop combinations. Supply the
ordinary ground options, an explicit `model`, `runAirSpeed`, interaction volume,
and discovery limits. It first retains a ground route when available. Unresolved
queries first propose region chains with broad, cheap boundary-pair generation and separately bounded
physical arc checks. This keeps narrow feasible transfers near the flight envelope
from being lost to early validation of poor nearby witnesses. Verified directed
frontiers then expand both from reachable ground and backward from
goal-connected surfaces. Search work is balanced between the two sides, allowing
a productive multi-hop chain to continue while the opposite side needs refinement.
Each accepted landing expands directed ground reachability before the next pass.
Static topology, standing support, ledge approaches and motion checks are reused
across frontier passes. Spatial hierarchies are built once. Eligibility views prune
branches for each frontier without sorting the same geometry again.
Supported continuous ground approaches can also join
overlapping patches without a shared navigation edge. Landing witnesses include
boundary pullbacks and surface intersections with the optimistic flight envelope.
Each witness still requires actual support, flight timing and swept-body checks.
Coarse spatial regions receive candidates before fine
body-scale refinements. Continuous ground transfers are reused while the target
remains fixed. Landing queries alternate source and destination heights,
so intermediate steps compete with lower floors near the goal. Motion variants
advance in rounds across candidate transfers, and each swept trajectory consumes
the shared arc budget. Frontier passes and shortcut search share the remaining
query work budget. The initial region proposal has separate bounded generation
and arc limits, with no fixed hop-depth limit. Both cases then search jump alternatives and compare
complete routes.

When the primary search fails, known actions also provide causal entry goals.
Supported directed transfers identify entries from which the actual goal can already
be reached. Upstream entries cover their downstream entries, with one representative
for mutual reachability. Each retained entry receives another `maxCandidates`
query. `device-entry-search` progress and `deviceApproaches` diagnostics report the
extra phases and budgets. The final query combines all validated transfers to the
original interaction goal. Completed primary routes return directly.

A successful walk no longer ends movement discovery. Takeoff streams cover each
exposed ledge before fine pullback refinement. Spatial landing queries include
surface interiors, so a large floor below a ledge needs no nearby boundary node.
Reachable ground transfers and isolated intermediate surfaces receive separate
sampling/retention shares. Dense, irrelevant geometry cannot consume the entire
share for already reachable surfaces. Lower bounds use horizontal distance and
maximum allowed speed, allowing vertical motion and multiple airborne legs.

All retained motion edges join the same directed graph. Supported continuous
visibility edges connect arrivals, takeoffs, landings and goal candidates without
forcing polygon-centre turns. The existing corridor search handles obstructed
ground legs. Candidate ground visibility eliminates locally slower airborne
transfers. Standing support, slope, capsule sweeps, swept-arc curvature and air
walls remain mandatory. The final gait policy checks sprint entry requirements.

The result contains `route`, retained `connections`, and diagnostics including
`baselineCost`, `selectedCost`, per-stage limits and `truncated`. A complete
incumbent is replaced only by a faster complete, resource-timed alternative.
Limits bound discovery and retained edges, not the number of successive jumps.
The search is optimal only on its selected graph costs. Bounded sampling,
centre-corridor estimates on obstructed legs, and subsequent resource scheduling
still prevent a claim of global continuous-time optimality. Game dynamics and
collision coverage require independent validation.

`findJumpShortcuts` exposes the alternative-link stage separately for callers
that already have a complete baseline and want to manage final comparison.

## Offline player navigation build

`@oem/ganglia/build` exports `buildGroundSurfaces(geometry, options)`. This separate
entry point uses Recast 0.44.0; the runtime root does not import WebAssembly or generators.
Supply indexed world-space collision triangles with outward normals, including ceilings,
buildings and solid obstacles. Importers select the active state and player collision
layers. Factory floors are eligible even when absent from the monster AI navigation mesh.
Missing collision coverage must be reported by the importer, not interpreted as a wall.

```js
import { buildGroundSurfaces } from '@oem/ganglia/build';
const surfaces = await buildGroundSurfaces({ positions, indices }, {
  profile, maxSlope: 46, stepUp: 0.4, stepDown: 0.6,
  cellSize: 0.1, cellHeight: 0.05,
  // Optional world XZ rectangle; retains the input's full vertical extent.
  bounds: { min: [0, 0], max: [64, 64] },
});
```

Movement values come from the build-bound exporter, not package defaults. The result
uses the existing `Surface[]` contract and contains detail triangles, preserving sampled
height changes. Keep the profile, resolution, source/state and exclusions with the
exported dataset; pass the same profile and current walls to `planGroundRoute`.
The build rounds clearance up and reserves one vertical voxel from the smaller step
limit. It admits no implicit jumps or large drops. Larger downward allowances require
validated **directed** transitions; they never authorize climbing the same height.

Ground support connects adjacent compact spans under the local step and shared-headroom
limits, followed by body-radius erosion at missing connections. Continuous stairs use
these successive support connections. The builder preserves them when the total height
range across several neighbors exceeds one step. Input triangle slopes still select
walkable support, and gaps, excessive local rises and low ceilings remain excluded.
Tiled builds export paired `Portal.entry` and `Portal.exit` intervals with direction and
height correspondence. Search, ground tracing and exposed-boundary discovery consume
the same passage authorization. Legacy point-only portals retain point crossings.

Voxelization is approximate, not a continuous collision proof. Detail heights differ
from collision floors because of rasterization and interpolation. Validate a small explicit projection tolerance;
do not snap across gaps or floors. This initial builder handles bounded regions (at most
8 million XZ cells and 8190 vertical cells). Dense geometry can exceed the native contour
vertex limit even within that budget; build errors retain the native diagnostic. Optional
`bounds` restricts voxelization in XZ without dropping intersecting actors or clipping
ceilings in Y. Include every collider intersecting the rectangle, regardless of its origin.
Region edges are clearance-eroded. Builds are not automatically stitched; provide
overlap/border ownership before attempting region stitching. It does not fill absent
physical geometry, decode game colliders, infer dynamic states or validate jump arcs.

[Recast Navigation JS](https://github.com/isaac-mason/recast-navigation-js) provides the
offline mesh. Queries still use Ganglia's complete-route graph search; a Detour partial
path is never presented as a completed route. The library tests synthetic floor, slope,
step, gap, narrow passage, headroom and air-wall scenarios. Real game collision placement
and complete factory coverage remain under investigation in noclip.

## Continuous triangle collision checks

`@oem/ganglia/collision` exports `createCollisionWorld({ positions, indices })`, which
copies world-space triangles and indexes them in a BVH. Its
`sweepCapsule(startFeet, endFeet, { radius, height, inflation? })` checks the entire
straight translation of an upright capsule. Thin walls between clear endpoints still
block. It computes distance from the swept axis parallelogram to triangle surfaces;
it does not approximate the sweep with isolated point samples. The result is either
`null` or `{ triangle, distance }` for any touched face, not a first-impact time.

An optional second argument `{ bounds: { min: [x, z], max: [x, z] } }` limits
indexed triangles to an inclusive XZ rectangle while retaining all heights.
Every source vertex and index is validated. Triangle IDs retain their original
identity. Queries whose full horizontal body footprint exceeds the indexed
rectangle throw, including curve inflation.

For a curved trajectory, bound the deviation of each curve interval from its chord
and pass that bound as `inflation`. This enlarges the capsule in every direction.
For constant acceleration, a bound is `|acceleration| * duration² / 8`. Split intervals
at velocity discontinuities. Touching counts as collision; takeoff/landing support and
contact handling remain the importer's responsibility.

These queries use double-sided thin triangles, not solid-volume containment. Start
from verified free space: being wholly inside a closed mesh is not a surface overlap.
The importer still owns complete active collision coverage, physical motion, landing
support, and hazard checks. A clear geometric sweep alone must not create a traversable
connection. This entry point has no WASM or renderer dependency.

`createGroundPlanner(surfaces, options)` prepares topology and a ground-support BVH
once for repeated arbitrary start/goal queries. `planGroundRoute` uses this same
pipeline for a single query. After corridor search, any-angle visibility tracing
removes centre/midpoint detours across open 3D portals, reconstructs ground heights,
and checks the supplied exclusion walls. Off-mesh takeoff/landing endpoints split
walking runs. Surfaces must already provide the selected body's clearance. Gaps,
closed portals and stacked floors cannot be repaired by smoothing.

Optional `locomotion: { speed, sprintSpeed, sprintAcceleration, stamina? }` retimes
continuous ground paths, carries velocity through straight spans, and exposes
`gait: 'run' | 'sprint'` on walking segments. `stamina` explicitly supplies capacity,
initial energy, activationCost, optional sprintDrain, recoveryRate, recoveryDelay and reserve.
Explicit flags permit recovery during sustained sprint or non-ground movement.
`sprintThrough` names authored movement modes that preserve the active gait. Resource values
are never inferred from a separate evasive dash mechanic. Without a stamina policy,
sustained sprint has no resource expenditure. The resource scheduler carries entry charges and recovery state across the whole
journey and compares sprinting with saving the activation for a later ground run.
Non-walking samples retain their authored timing. Recovery and gait continuation
follow the supplied policy.

This is a feasible continuous route within selected topology, with a conservative
gait schedule. Corridor selection and bounded any-angle simplification do not prove
a globally shortest continuous path, and the scheduler searches run-level sprint allocations, not every possible
interior activation time or waiting strategy. It retains up to 256 nondominated
labels and reports a truncated search if that limit is reached. Ground turns of at least 30 degrees reset
to running speed before sprint acceleration. Scene-state changes require rebuilding
the prepared planner. No all-pairs route cache is needed.

Imported navigation can supply directed `portals: [{from, to, points}]`. Each
endpoint must lie on its source polygon boundary and share the other endpoint's
XZ position within numeric tolerance. The importer authorizes the step from
source neighbour metadata and the player's upward/downward limits. This restores
stepped tile seams without adding arbitrary proximity links. Collinear split
edges also connect over their actual shared interval.

Prepared queries accept an explicit interaction goal through
`planner.plan(starts, target, {interaction: {radius, maxVertical?, facing?, halfAngle?}})`.
Ground candidates are selected inside the supplied volume instead of requiring
feet at the object's marker. Angles are degrees. These generic constraints have
no game-specific defaults. The caller must resolve effective instance parameters,
player-body overlap and interaction occlusion from its source data. One candidate
per eligible polygon is searched, so continuous goal-region entry is approximate.


`buildGroundTiles(geometry, {...buildOptions, bounds, tileCells})` builds padded
physical tiles on a global voxel grid, clips them to their core bounds and returns
step-limited directed seams. Geometry may include factory floors absent from AI
navigation. Empty geometry and native-confirmed empty polygon meshes remain empty.
A failed tile aborts the result. All selected collision/state/profile inputs must
cover the padded region, and hazard/device constraints remain caller-owned.
