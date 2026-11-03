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
that may connect; an empty list closes every edge. Only matching full 3D edges connect.
No proximity bridge, jump, climb, floor snap or off-mesh connection is invented.

Arrivals supply `{ id, position, cost, state }`. Costs are seconds; availability is
`available`, `locked` or `unknown`. Include the player at cost zero and unlocked teleport
platforms/base centres at their teleport overhead. The result identifies the selected
arrival and contains only the journey after arrival. Unknown or locked arrivals are excluded.
Projection is vertical, within `maxVertical`; it never snaps a point over a gap onto a
nearby island. A base centre's bounding-box height is only a seed: resolve its ground
height before planning. The target and starts retain their projected coordinates.

`route(graph, start, goal, constraints)` and `routeFrom(graph, arrivals, goal, constraints)`
are lower-level entry points for prebuilt directed corridor graphs. The latter takes
node-based arrivals `{ id, node, cost, state }`. Binary-heap multi-source Dijkstra finds
the minimum cost on the supplied graph. Unknown/closed edges are excluded. Polygon-centre
routes are conservative corridor paths, **not continuous shortest paths**. Partial portal
matching, funnel shortening and detail-height reconstruction are not implemented.

`blockedByWalls` applies player radius/height and optional wall padding. Unknown walls
block. Optional XZ wall polylines narrow the bounding-volume test, including vertical
overlap. Without polylines, bounds conservatively block. This covers vertical air walls,
not arbitrary collision meshes. Pass `{ walls, profile }` to graph queries; the high-level
planner requires them. Even stationary paths and endpoint connectors obey exclusions.

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
The importer must validate the entire trajectory, landing, body clearance and
movement state before marking a connection open. The planner also checks every
sample interval against air walls; it never exempts a rope or launch from them.
An authored device position alone is not a verified connection.

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
implemented. Synthetic directed-connection tests do not establish game reachability.

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
