import type { CollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route.ts';
import { condenseComponents } from '#@/src/v1/reach/connectivity.ts';
import { groundPreparation } from '#@/src/v1/route/ground.ts';
import type { JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

type Phase = 'disabled' | 'training' | 'frozen';
let phase: Phase = 'disabled';
const counts = {
  scopes: 0,
  scopeResets: 0,
  missingSupport: 0,
  frozenScopeMisses: 0,
  added: 0,
  duplicates: 0,
  evicted: 0,
  frozenCalls: 0,
  selections: 0,
  selectedEdges: 0,
  candidateChains: 0,
  rankedStates: 0,
  hits: 0,
  misses: 0,
};
export const setActionCatalogPhase = (next: Phase) => {
  phase = next;
};
export const isActionCatalogFrozen = () => phase === 'frozen';
export const actionCatalogStats = () => ({
  phase,
  ...counts,
  fallbacks: counts.frozenCalls - counts.hits,
});
export const noteActionCatalogResult = (complete: boolean) => {
  if (complete) counts.hits++;
  else counts.misses++;
};

const copy = (action: GroundConnection): GroundConnection => ({
  ...action,
  points: action.points.map((point): Vec3 => [...point]),
  times: [...action.times],
});
interface Scope {
  id: number;
  signature: string;
  portals: unknown;
  actions: Map<string, GroundConnection>;
  serial: number;
  graph?: {
    preparation: NonNullable<ReturnType<typeof groundPreparation>>;
    topology: ReturnType<typeof condenseComponents>;
    actions: Map<number, { to: number; action: GroundConnection }[]>;
    walking: Map<number, Set<number>>;
  };
}
const worlds = new WeakMap<CollisionWorld, WeakMap<Surface[], Scope>>();

function scopeFor(
  world: CollisionWorld,
  surfaces: Surface[],
  options: JumpRouteOptions,
): Scope | undefined {
  if (
    phase === 'disabled' ||
    options.activeBoost !== undefined ||
    options.boosts?.length ||
    options.interaction?.airborne ||
    options.connections?.some(
      (action) =>
        action.traversal ||
        action.requiredBoost ||
        action.terminal ||
        !['jump', 'drop'].includes(action.mode),
    )
  )
    return undefined;
  const prepared = groundPreparation(options.groundPlanner);
  if (!prepared || prepared.surfaces !== surfaces) {
    counts.missingSupport++;
    return undefined;
  }
  const signature = JSON.stringify([
    options.model,
    options.profile,
    options.walls,
    options.maxSlope,
    options.maxVertical,
    options.maxDrop,
    options.maxHorizontalDistance,
    options.runAirSpeed,
    options.speed,
    options.locomotion,
  ]);
  const portals =
    prepared.importedPortals === options.portals
      ? options.portals
      : JSON.stringify(options.portals);
  let supports = worlds.get(world);
  if (!supports) {
    supports = new WeakMap();
    worlds.set(world, supports);
  }
  let scope = supports.get(surfaces);
  if (!scope || scope.signature !== signature || scope.portals !== portals) {
    if (phase === 'frozen') {
      counts.frozenScopeMisses++;
      return undefined;
    }
    if (scope) counts.scopeResets++;
    scope = { id: counts.scopes++, signature, portals, actions: new Map(), serial: 0 };
    supports.set(surfaces, scope);
  }
  return scope;
}

/** Store motion proofs, including ones not used by a selected route. Training
 * runs the original discovery algorithm; frozen queries cannot add any edges.
 * Full support identity prevents goal-local refined IDs from crossing snapshots.
 */
export function rememberCatalogAction(
  world: CollisionWorld,
  surfaces: Surface[],
  options: JumpRouteOptions,
  action: GroundConnection,
) {
  if (
    phase !== 'training' ||
    action.state !== 'open' ||
    !['jump', 'drop'].includes(action.mode) ||
    action.terminal ||
    action.requiredBoost !== undefined ||
    action.traversal !== undefined ||
    action.fromSurface === undefined ||
    action.toSurface === undefined
  )
    return;
  const scope = scopeFor(world, surfaces, options);
  if (!scope) return;
  const { id: _id, ...motion } = action;
  const key = JSON.stringify(motion);
  if (scope.actions.has(key)) {
    counts.duplicates++;
    return;
  }
  if (scope.actions.size >= 2048) {
    scope.actions.delete(scope.actions.keys().next().value!);
    counts.evicted++;
  }
  const stored = copy({ ...action, id: `@catalog/${scope.id}/${scope.serial++}` });
  scope.actions.set(key, stored);
  scope.graph = undefined;
  counts.added++;
}

/** Select several positive chains by estimated travel time, retaining at most
 * sixteen actions. SCC walking ignores exact entry cost and resource state, so
 * only a fresh GroundPlanner solve may accept their combined action set.
 * A miss makes no reachability claim and leaves original discovery available.
 */
export function selectCatalogActions(
  world: CollisionWorld,
  surfaces: Surface[],
  starts: GroundArrival[],
  goal: Vec3,
  options: JumpRouteOptions,
): GroundConnection[] {
  if (phase !== 'frozen') return [];
  counts.frozenCalls++;
  const scope = scopeFor(world, surfaces, options);
  if (!scope?.actions.size) return [];
  const prepared = groundPreparation(options.groundPlanner)!;
  if (!scope.graph || scope.graph.preparation !== prepared) {
    const topology = condenseComponents(prepared.routeBase.topology);
    const actions = new Map<number, { to: number; action: GroundConnection }[]>();
    for (const action of scope.actions.values()) {
      const from = topology.components.get(action.fromSurface!),
        to = topology.components.get(action.toSurface!);
      if (from === undefined || to === undefined || from === to) continue;
      const edges = actions.get(from) ?? [];
      edges.push({ to, action });
      actions.set(from, edges);
    }
    scope.graph = { preparation: prepared, topology, actions, walking: new Map() };
  }
  const { topology, actions, walking } = scope.graph,
    planner = options.groundPlanner!;
  const reachable = (from: number): Set<number> => {
    let visited = walking.get(from);
    if (visited) return visited;
    visited = new Set([from]);
    const pending = [from];
    for (let index = 0; index < pending.length; index++)
      for (const to of topology.forward[pending[index]])
        if (!visited.has(to)) {
          visited.add(to);
          pending.push(to);
        }
    walking.set(from, visited);
    return visited;
  };
  const goals = new Set(
    planner
      .project(goal, {
        maxVertical: options.maxVertical,
        interaction: options.interaction,
      })
      .flatMap((hit) => {
        const component = topology.components.get(hit.surface);
        return component === undefined ? [] : [component];
      }),
  );
  const roots = starts
    .filter((start) => start.state === 'available')
    .flatMap((start) => {
      const hit = planner.project.closest(start.position, { maxVertical: options.maxVertical });
      const component = hit && topology.components.get(hit.surface);
      return component === undefined
        ? []
        : [{ component, position: start.position, elapsed: start.cost }];
    });
  if (!goals.size || !roots.length) return [];
  const reachesGoal = (component: number) =>
    [...goals].some((goal) => reachable(component).has(goal));
  // This ranking estimates walking by straight horizontal distance. It guides
  // candidate ordering only; the real planner checks corridors and resource state.
  const speed = options.locomotion?.sprintSpeed ?? options.speed;
  const walkTime = (from: Vec3, to: Vec3) => Math.hypot(from[0] - to[0], from[2] - to[2]) / speed;
  const finishTime = (from: Vec3) =>
    Math.max(
      0,
      Math.hypot(from[0] - goal[0], from[2] - goal[2]) - (options.interaction?.radius ?? 0),
    ) / speed;
  type State = {
    component: number;
    position: Vec3;
    elapsed: number;
    chain: GroundConnection[];
    cost: number;
  };
  const heap = createMinHeap<State>();
  const best = new Map<string, number>();
  const extend = (current: Omit<State, 'cost'>) => {
    if (current.chain.length >= 16) return;
    for (const component of reachable(current.component))
      for (const edge of actions.get(component) ?? []) {
        if (current.chain.some((action) => action.id === edge.action.id)) continue;
        const action = edge.action;
        const elapsed =
          current.elapsed +
          walkTime(current.position, action.points[0]) +
          action.times.at(-1)! -
          action.times[0];
        if (elapsed >= (best.get(action.id) ?? Infinity)) continue;
        best.set(action.id, elapsed);
        const position = action.points.at(-1)!;
        heap.push({
          component: edge.to,
          position,
          elapsed,
          chain: [...current.chain, action],
          cost: elapsed + finishTime(position),
        });
      }
  };
  for (const root of roots) extend({ ...root, chain: [] });
  const selected = new Map<string, GroundConnection>();
  let alternatives = 0;
  while (heap.size && selected.size < 16 && alternatives < 8) {
    const current = heap.pop()!;
    const action = current.chain.at(-1)!;
    if (current.elapsed !== best.get(action.id)) continue;
    counts.rankedStates++;
    if (reachesGoal(current.component)) {
      const additions = current.chain.filter((action) => !selected.has(action.id));
      if (additions.length && selected.size + additions.length <= 16) {
        for (const action of additions) selected.set(action.id, action);
        alternatives++;
      }
    }
    extend(current);
  }
  if (!selected.size) return [];
  counts.candidateChains += alternatives;
  counts.selections++;
  counts.selectedEdges += selected.size;
  return [...selected.values()].map(copy);
}
