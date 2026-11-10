import { createMinHeap } from './heap.js';
import { createLocomotion } from './locomotion.js';
import { routeSegment } from './motion.js';
const distance = (a: any, b: any) =>
  Math.hypot(...a.map((value: any, axis: any) => value - b[axis]));
// Equal continuation states are substitutable under the existing deterministic
// scheduling policy. More energy alone is insufficient: automatic sprint restart
// may occur earlier and alter the entry gait at the next action.
const stateKey = (state: any) =>
  JSON.stringify([
    state.energy,
    state.delay,
    state.sprinting,
    state.hasActivated,
    state.velocity,
    state.previousDirection,
    state.dashCooldown,
    state.dashRemaining,
  ]);
/** Label-setting search over the finite retained graph and exact resource states.
 * Limits bound cyclic continuous-state graphs. Reaching either limit is exposed
 * on both successful and unresolved results; it never establishes unreachability.
 */
export function searchResources(
  { nodes, edges, blocked }: any,
  starts: any,
  goals: any,
  options: any,
): any {
  const locomotion = createLocomotion(options);
  const maxLabels = options.search?.maxLabels ?? 256;
  const maxExpanded = options.search?.maxExpanded ?? 100000;
  if (![maxLabels, maxExpanded].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid resource search limits');
  }
  const search = { truncated: false, expanded: 0, maxLabels, maxExpanded };
  const labels = new Map<any, any>(),
    heap = createMinHeap(),
    ids = new Set<any>();
  let best: any = null;
  const retain = (label: any) => {
    const key = stateKey(label.state);
    let atNode = labels.get(label.node);
    if (!atNode) {
      atNode = new Map<any, any>();
      labels.set(label.node, atNode);
    }
    const previous = atNode.get(key);
    if (previous && previous.cost <= label.cost) return;
    // Keep every complete candidate even if its node's label allowance is full.
    if (goals.has(label.node) && (!best || label.cost < best.cost)) best = label;
    if (!previous && atNode.size >= maxLabels) {
      search.truncated = true;
      return;
    }
    label.key = key;
    atNode.set(key, label);
    heap.push(label);
  };
  for (const start of starts) {
    if (
      typeof start.id !== 'string' ||
      ids.has(start.id) ||
      !Number.isFinite(start.cost) ||
      start.cost < 0 ||
      !['available', 'locked', 'unknown'].includes(start.state)
    )
      throw new Error('Invalid arrival');
    ids.add(start.id);
    if (start.state !== 'available' || !nodes.has(start.node)) continue;
    const point = nodes.get(start.node);
    if (blocked?.(point, point)) continue;
    retain({
      node: start.node,
      cost: start.cost,
      arrival: start,
      state: locomotion.initial(),
      previous: null,
      segments: [],
    });
  }
  if (!heap.size && !best) return { status: 'unmapped', search };
  while (heap.size) {
    const current = heap.pop();
    if (labels.get(current.node).get(current.key) !== current) continue;
    if (best && current.cost >= best.cost) break;
    if (search.expanded >= maxExpanded) {
      search.truncated = true;
      break;
    }
    search.expanded++;
    for (const edge of edges.get(current.node) ?? []) {
      for (const next of locomotion.advance(routeSegment(edge), current.state)) {
        retain({
          node: edge.to,
          cost: current.cost + next.duration,
          state: next.state,
          arrival: current.arrival,
          previous: current,
          segments: next.segments,
        });
      }
    }
  }
  if (!best) return { status: 'no-verified-route', search };
  const path = [];
  for (let label = best; label.previous; label = label.previous) path.push(label.segments);
  const segments = path.reverse().flat(),
    points = [[...nodes.get(best.arrival.node)]];
  for (const segment of segments)
    for (const point of segment.points.slice(1)) {
      if (distance(points.at(-1), point) > 1e-9) points.push([...point]);
    }
  const energy = options.stamina?.initial ?? 0;
  return {
    status: 'complete',
    start: best.arrival.id,
    arrivalCost: best.arrival.cost,
    cost: best.cost,
    segments,
    points,
    search,
    length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0),
    ...(options.stamina
      ? { locomotion: { initial: energy, final: best.state.energy, minimum: best.state.minimum } }
      : {}),
  };
}
