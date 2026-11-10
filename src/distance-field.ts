import { createMinHeap } from './heap.js';
const sameEdge = (a: any, b: any) =>
  a.from === b.from && a.to === b.to && Object.is(a.cost, b.cost);
const sameRoots = (a: any, b: any): any =>
  a.length === b.length &&
  a.every(
    (root: any, index: any) => root.id === b[index].id && Object.is(root.cost, b[index].cost),
  );
// One direction's current shortest-distance field, owned by this route query.
// Added actions can only improve labels: seed their relaxed endpoints instead of
// traversing the unchanged ground graph again. A removed/changed action, root or
// base graph restarts the original Dijkstra. No previous query's field is retained.
export function advanceDistanceField(
  base: any,
  edges: any,
  roots: any,
  reverse: any,
  previous: any,
  lengthScale = 1,
): any {
  const incremental =
    previous?.base === base &&
    previous.reverse === reverse &&
    previous.lengthScale === lengthScale &&
    sameRoots(previous.roots, roots) &&
    previous.edges.length <= edges.length &&
    previous.edges.every((edge: any, index: any) => sameEdge(edge, edges[index]));
  const state = incremental
    ? previous
    : {
        base,
        reverse,
        lengthScale,
        roots: roots.map((root: any): any => ({ ...root })),
        edges: [],
        costs: new Map<any, any>(),
      };
  const work = { reset: !incremental, expanded: 0, edgeChecks: 0, relaxed: 0 };
  state.work = work;
  if (incremental && previous.edges.length === edges.length) return state;
  const extra = new Map<any, any>(),
    pending = createMinHeap();
  for (const edge of edges) {
    const from = reverse ? edge.to : edge.from;
    const outgoing = extra.get(from) ?? [];
    outgoing.push(edge);
    extra.set(from, outgoing);
  }
  const relax = (id: any, cost: any) => {
    if (cost >= (state.costs.get(id) ?? Infinity)) return;
    state.costs.set(id, cost);
    pending.push({ id, cost });
    work.relaxed++;
  };
  const visit = (entries: any, cost: any, scale: any) => {
    if (!entries) return;
    for (const edge of entries) {
      work.edgeChecks++;
      relax(reverse ? edge.from : edge.to, cost + edge.cost * scale);
    }
  };
  if (incremental) {
    for (let index = previous.edges.length; index < edges.length; index++) {
      const edge = edges[index],
        from = reverse ? edge.to : edge.from;
      const cost = state.costs.get(from);
      if (cost !== undefined) relax(reverse ? edge.from : edge.to, cost + edge.cost);
    }
  } else {
    for (const root of roots) relax(root.id, root.cost);
  }
  while (pending.size) {
    const current = pending.pop();
    if (current.cost !== state.costs.get(current.id)) continue;
    work.expanded++;
    // Scale the immutable original weights in place of cloning every graph edge
    // into metres. Extra action weights already use the field's length unit.
    visit(base.get(current.id), current.cost, lengthScale);
    visit(extra.get(current.id), current.cost, 1);
  }
  state.edges = edges.map(({ from, to, cost }: any): any => ({ from, to, cost }));
  return state;
}
