# Ground routes, teleports and point previews

These notes record the alpha.3 integration snapshot and its early extensions. See the
[README](../README.md) for current SDK behavior.

Ganglia handled projection, ground-route search, multi-source cost comparison, invisible-wall
filtering, and sampling by segment time or arc length. noclip decoded the installed game data
and generated camera candidates. Atlos called Ganglia through the packed dependency.

## Implemented at that stage

- Multi-source Dijkstra search with a binary heap minimized travel cost on the supplied graph.
  Sources could include the player, unlocked teleport platforms and industrial-base centers.
  Costs combined teleport overhead and ground travel time, with reachability evaluated along
  the supplied corridors.
- Convex polygons connected through shared 3D edges and an explicit imported portal allowlist.
  Projected start and goal positions were retained, with direct travel within one convex face.
  Connections across floors and gaps required explicit topology.
- Invisible walls used height intervals, XZ polylines, player radius and height, and additional
  clearance. Unknown states blocked travel. Stationary checks and endpoint connectors used
  the same exclusions.
- Route playback sampled the 3D polyline by arc length to preserve its checked geometry.
  Teleport overhead was represented separately from the movement polyline.
- The ESM package included TypeScript declarations and the existing AGPL license. It could be
  installed from npm pack output. Registry publication was still pending.

## Initial data investigation and limitations

noclip exported 1,085 navigation assets containing 499,357 polygons for map01, together with
504 invisible walls across both regions. A navigation-obstacle flag alone was insufficient to
establish player access. Eleven map02 invisible walls had that flag disabled and still needed
to participate in player-route exclusions.

The export contained 131 mappable teleport arrivals and six industrial-base center seeds.
The user-confirmed locations were Cardiac Remediation Station, Xiranflow Cloudseeder Station
and Sky King Flats Construction Site in Wuling, and Refugee Camp, Infra-Station and
Reconstruction HQ in Valley IV. Base centers required valid ground projection. All three
Valley IV centers missed vertical projection in the selected ordinary-area, base-state
assets, leaving their use as route arrivals unresolved.

An early 263 m route for point 3500030763 crossed area 3, whose player-traversal semantics
had not been established. Its earlier reliability claim was withdrawn. Restricting selection
to area 0 produced a nearby local corridor of about 13 m. Connectivity to distant roads or
teleports, and therefore the overall arrival direction, remained unresolved. An early
133.7-degree yaw result demonstrated camera-candidate generation. In-scene acceptance
remained pending.

Open issues at that stage included complete player-area masks, dynamic navigation-state
selection, some portal connections, detail-surface heights, continuous route shortening,
and runtime wall, door and bridge states. Optimality was limited to the supplied graph.
Player-world coverage from the AI NavMesh and in-game walking and browser-composition
validation remained unresolved.

## Camera candidates and caches

The noclip exporter used the final 24 m of the approach to generate far-side camera
candidates at left and right offsets of 30 and 45 degrees. Existing geometry checks covered
target visibility, camera clearance and sampled visibility along the final approach. Door
and destructible-object constraints also applied. The existing fallback was retained when
all candidates failed. Camera positions could extend beyond cliffs, while player routes
required ground support.

`walk-routes` bound the selected assets, areas, states and player body to its output, producing
Ganglia routes and data consumable by Atlos. `oem-views --arrival-routes ... --rebuild` could
rebuild the existing precomputed camera cache. Input hashes and camera-algorithm versions
isolated checkpoints. Full route-constrained rebaking and online data updates remained
pending at that stage.

Empty method bodies in public dumps were insufficient to establish the game's complete
pathfinding algorithm or its internal nearest-teleport ordering. The investigation also
consulted Unity's navigation internals and the Detour query interface.
[Unity navigation internals](https://docs.unity.cn/2022.2/Documentation/Manual/nav-InnerWorkings.html),
[Detour query interface](https://github.com/recastnavigation/recastnavigation/blob/main/Detour/Include/DetourNavMeshQuery.h).

## Early player-collision ground builder

The separate offline `@oem/ganglia/build` entry point generated `Surface[]` with detail
heights from explicitly selected world-space collision triangles through Recast. The runtime
entry point kept the generator and WASM in the offline build dependency.

Factory floors could participate directly, independently of AI factory-exclusion areas.
Buildings, ceilings and physical obstacles remained part of the collision input. Ordinary
connections used the smaller upward and downward step allowance, with one vertical voxel
of margin. Larger drops and jumps required separate directed links and trajectory and
landing validation.

The early builder passed 16 library tests covering small steps, slopes, broken corridors,
low ceilings, narrow passages and unknown invisible walls. These tests used synthetic
geometry. Real-level collision placement, complete factory coverage and jump validation
remained pending at that stage. The common player body exported by noclip supplied the
default profile, with explicit overrides and version-bound data.

## Directed movement segments

The ground entry point accepted verified rope, jump, drop and launch connections. Each
connection supplied a directed trajectory, sample times and state. Unknown states blocked
movement. Endpoint attachment required validated support, and invisible-wall checks covered
the complete trajectory. Routes retained their spatial polyline for camera calculations and
segment times for playback. Teleport overhead was separate from movement after arrival.

Acceleration effects required a state graph covering trigger conditions, remaining duration
and the actual speed effect. A local edge-speed change alone could not establish how long
a boost persisted. The initial implementation accepted verified trajectories, leaving
device-template reachability inference for subsequent work.

The noclip importer now supplies fixed vertical-rope and bounce-device connections
through this same interface. They retain source device identities, stationary
startup samples, supported endpoints and collision-checked timed trajectories.
Device-specific launch height and target replace the ordinary jump-height rule.
The action planner composes these connections with ground and discovered airborne
actions. The normal Atlos query for point 3500070545 selects a launch and a small
jump, taking 22.16 model seconds against a 27.64-second physical walking baseline.
A real rope case from 300020256 to 300020282 returns walk/rope/walk in 5.93 model
seconds. These validate the planning pipeline. In-game device state, precise
animation timing and operation remain separate checks.

Alpha.23 reuses a prepared ground planner across walking, device admission and
action search through `JumpRouteOptions.groundPlanner`. The supplied planner must
belong to the same immutable surfaces, exclusions, body and ground options.
Per-query connections override its original connection set. Ground tracing,
projection and normalized surface portals are also reused by action discovery.
Spatial bounds use median partitioning instead of recursively sorting each
subtree. Portal candidate queries retain the same tolerance and geometry tests.

A profiled, identical physical input for point 3500070545 takes 23.76 seconds
against 58.39 seconds before these changes. Action search takes 11.22 seconds
against 33.18 seconds, with the same 512-candidate budget, 64-link limit and
22.39-second returned route. These are single-run cached-ground command timings,
including profiling overhead. The 145 SDK tests pass, including coincident bounds,
prepared-planner connection updates and existing stair/collision regressions.

Alpha.24 seeds region-chain proposals from all supports reachable by ordinary
passages and previously validated movement devices. A distance heuristic to the
original arrival was inconsistent with zero-cost ground transfers in this
proposal graph, and could starve a short elevated approach. Proposal search now
uses its accumulated nonnegative transfer costs. Proposed airborne connections
still require supported feet and swept collision checks, and the complete route
is selected and retimed by the ground planner.

`JumpRouteOptions.maxShortcutCandidates` optionally separates improvement work
from unresolved reachability discovery. Zero retains the first feasible route;
absence preserves the previous shared-budget behavior. This controls computation,
not physical action durations. Existing stairs, drops and device timing remain
covered by the 146 SDK tests. Bounded sampling does not establish a global optimum.

The region-chain stage is a coarse proposal search over an already loaded detail
mesh. It does not yet provide a small independently loadable topology manifest or
load detail only along candidate corridors. Large detail snapshots can therefore
exhaust a process heap before directional search. Separating support topology,
local height detail and collision payloads remains necessary for that next stage.

Alpha.25 adds sparse physical tile construction to `buildGroundTiles`. An explicit
`tiles` selection retains the global grid, padded collision and directed seam
rules while leaving all other tiles unmapped. Source triangles outside every
selected tile's padding are rejected before object allocation. `onTile` reports
completed builds without changing geometry or route eligibility. The 147 SDK
tests include adjacent selected seams and a deliberately unselected gap.

This is the fine-construction part of a hierarchical pipeline: a cheap region
proposal selects a corridor, physical tiles validate it, and unsuccessful bounded
proposals can be replaced or widened. A coarse proposal is not a route certificate;
its scores are not player travel times. Collision selection must still cover the
entire declared world rectangle, including airborne motion outside ground tiles.
