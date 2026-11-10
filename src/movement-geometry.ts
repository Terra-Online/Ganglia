import type { BoundsIndex } from './bounds.js';
import type { GroundTopology } from './connectivity.js';
import { groundComponents } from './connectivity.js';
import { createGoalProjector } from './goals.js';
import { groundPreparation } from './ground.js';
import type { Surface, Vec3, DiscoveryOptions, Graph } from './index-types.js';
import { createSupportProjector } from './support-projector.js';
import { surfaceGraph, surfacePortals } from './surfaces.js';
import type { Region, Boundary } from './traversal.js';
import { exposedBoundaries } from './traversal.js';
import { createWallChecker } from './walls.js';

interface Geometry {
  graph: Graph;
  forward?: NonNullable<ReturnType<typeof groundPreparation>>['routeBase']['forward'];
  blocked: ReturnType<typeof createWallChecker>;
  portals: ReturnType<typeof surfacePortals>;
  byId: Map<string, Surface>;
  lengthScale: number;
  centers: Map<string, Vec3>;
  project: ReturnType<typeof createGoalProjector>;
  projectSupport: ReturnType<typeof createSupportProjector>;
  visibility?: NonNullable<ReturnType<typeof groundPreparation>>['straighten'];
  topology: GroundTopology;
  boundaries: Boundary[];
  regions?: { regions: Region[]; boundaries: Boundary[]; queryRegions: BoundsIndex<Region> };
}

const snapshots = new WeakMap<
  NonNullable<ReturnType<typeof groundPreparation>>,
  { signature: string; portals: DiscoveryOptions['portals']; value: Geometry }
>();
// Share only immutable ground geometry. Each discovery call owns its temporary
// action overlays, reachability, seeds and validation budgets.
export const movementGeometry = (
  surfaces: Surface[],
  options: Pick<DiscoveryOptions, 'walls' | 'profile' | 'portals' | 'groundPlanner'>,
): Geometry => {
  const candidate = groundPreparation(options.groundPlanner);
  const prepared = candidate?.surfaces === surfaces ? candidate : undefined;
  const signature = JSON.stringify([options.walls, options.profile]);
  const cached = prepared && snapshots.get(prepared);
  if (cached?.signature === signature && cached.portals === options.portals) return cached.value;
  const portals = prepared?.portals ?? surfacePortals(surfaces);
  const reused = prepared?.importedPortals === options.portals && prepared?.graph;
  const normalized =
    reused && prepared.constraintsSignature === signature ? prepared.routeBase : undefined;
  const blocked = normalized?.blocked ?? createWallChecker(options.walls, options.profile);
  const base = reused || surfaceGraph(surfaces, { speed: 1, portals: options.portals }, portals);
  const graph = normalized?.graph ?? {
    nodes: base.nodes,
    edges: base.edges.filter(
      (edge) => !edge.points.slice(1).some((point, index) => blocked(edge.points[index], point)),
    ),
  };
  const byId =
    prepared?.byId ?? new Map<string, Surface>(surfaces.map((surface) => [surface.id, surface]));
  let topology: GroundTopology | undefined, boundaries: Boundary[] | undefined;
  const value: Geometry = {
    graph,
    forward: normalized?.forward,
    blocked,
    portals,
    byId,
    lengthScale: reused ? prepared.searchSpeed : 1,
    centers:
      prepared?.centers ??
      new Map<string, Vec3>(graph.nodes.map((node) => [node.id, node.position])),
    project: prepared?.projectGoal ?? createGoalProjector(surfaces),
    projectSupport: prepared?.projectSupport ?? createSupportProjector(surfaces, byId),
    visibility: prepared?.straighten,
    get topology() {
      return normalized?.topology ?? (topology ??= groundComponents(graph));
    },
    get boundaries() {
      return (boundaries ??= exposedBoundaries(surfaces, options.portals ?? [], portals));
    },
  };
  if (prepared) snapshots.set(prepared, { signature, portals: options.portals, value });
  return value;
};
