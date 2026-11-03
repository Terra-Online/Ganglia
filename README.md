# Ganglia

`@oem/ganglia` is an experimental, dependency-free ESM ground-routing package for OEM,
with TypeScript declarations. It runs in Node and browsers. Camera rules belong to
noclip; game asset decoding belongs to its extractor.

```js
import { planGroundRoute, sampleRoute } from '@oem/ganglia';
const result = planGroundRoute(surfaces, arrivals, target, {
  speed: 3, maxVertical: 0.5,
  profile: { radius: 0.4, height: 2 }, walls,
});
if (result.status === 'complete') {
  const position = sampleRoute(result.points, elapsedSeconds * 3);
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
arrival and contains only its ground segment. Unknown or locked arrivals are excluded.
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

Run `npm test`, then `npm pack` for an installable archive. The package includes modules,
declarations and the repository's AGPL-3.0 license, never game assets. Registry publication
is separate. Atlos consumes this archive as a package dependency. Runtime player-state
integration, complete player navigation coverage and in-game traversal validation remain
outstanding; this is an alpha implementation.
