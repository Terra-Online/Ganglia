import { surfaceGraph, surfacePortals } from './surfaces.mjs';
import { createWallChecker } from './walls.mjs';
import { groundComponents } from './connectivity.mjs';
import { groundPreparation } from './ground.mjs';
import { createGoalProjector } from './goals.mjs';
import { createSupportProjector } from './support-projector.mjs';
import { exposedBoundaries } from './traversal.mjs';

const snapshots = new WeakMap();

// Share only immutable ground geometry. Each discovery call owns its temporary
// action overlays, reachability, seeds and validation budgets.
export const movementGeometry = (surfaces, options) => {
  const candidate = groundPreparation(options.groundPlanner);
  const prepared = candidate?.surfaces === surfaces ? candidate : undefined;
  const signature = JSON.stringify([options.walls, options.profile]);
  const cached = prepared && snapshots.get(prepared);
  if (cached?.signature === signature && cached.portals === options.portals) return cached.value;
  const blocked = createWallChecker(options.walls, options.profile);
  const portals = prepared?.portals ?? surfacePortals(surfaces);
  const reused = prepared?.importedPortals === options.portals && prepared?.graph;
  const base = reused || surfaceGraph(surfaces, { speed: 1, portals: options.portals }, portals);
  const graph = { nodes: base.nodes, edges: base.edges.filter(edge => !edge.points.slice(1)
    .some((point, index) => blocked(edge.points[index], point))) };
  const byId = prepared?.byId ?? new Map(surfaces.map(surface => [surface.id, surface]));
  let topology, boundaries;
  const value = { graph, blocked, portals, byId, lengthScale: reused ? prepared.searchSpeed : 1,
    centers: prepared?.centers ?? new Map(graph.nodes.map(node => [node.id, node.position])),
    project: prepared?.projectGoal ?? createGoalProjector(surfaces),
    projectSupport: prepared?.projectSupport ?? createSupportProjector(surfaces, byId),
    visibility: prepared?.straighten,
    get topology() { return topology ??= groundComponents(graph); },
    get boundaries() { return boundaries ??= exposedBoundaries(surfaces, options.portals ?? [], portals); },
  };
  if (prepared) snapshots.set(prepared, { signature, portals: options.portals, value });
  return value;
};
