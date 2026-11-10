import { groundComponents } from './connectivity.js';
import { createGoalProjector } from './goals.js';
import { groundPreparation } from './ground.js';
import { createSupportProjector } from './support-projector.js';
import { surfaceGraph, surfacePortals } from './surfaces.js';
import { exposedBoundaries } from './traversal.js';
import { createWallChecker } from './walls.js';
const snapshots = new WeakMap<any, any>();
// Share only immutable ground geometry. Each discovery call owns its temporary
// action overlays, reachability, seeds and validation budgets.
export const movementGeometry = (surfaces: any, options: any): any => {
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
      (edge: any) =>
        !edge.points
          .slice(1)
          .some((point: any, index: any): any => blocked(edge.points[index], point)),
    ),
  };
  const byId =
    prepared?.byId ?? new Map<any, any>(surfaces.map((surface: any): any => [surface.id, surface]));
  let topology, boundaries;
  const value = {
    graph,
    forward: normalized?.forward,
    blocked,
    portals,
    byId,
    lengthScale: reused ? prepared.searchSpeed : 1,
    centers:
      prepared?.centers ??
      new Map<any, any>(graph.nodes.map((node: any): any => [node.id, node.position])),
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
