export const groundComponents = (graph: any): any => {
  const ids = new Map<any, any>(graph.nodes.map((node: any, index: any): any => [node.id, index]));
  const forward = graph.nodes.map((): any => []),
    reverse = graph.nodes.map((): any => []);
  for (const edge of graph.edges) {
    if (edge.state !== 'open') continue;
    const from = ids.get(edge.from),
      to = ids.get(edge.to);
    forward[from].push(to);
    reverse[to].push(from);
  }
  return componentsOf(ids, forward, reverse);
};
const componentsOf = (ids: any, forward: any, reverse: any): any => {
  const visited = new Uint8Array(forward.length),
    order = [];
  for (let start = 0; start < forward.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    const stack = [{ node: start, next: 0 }];
    while (stack.length) {
      const current: any = stack.at(-1),
        neighbours = forward[current.node];
      if (current.next === neighbours.length) {
        order.push(current.node);
        stack.pop();
        continue;
      }
      const next = neighbours[current.next++];
      if (!visited[next]) {
        visited[next] = 1;
        stack.push({ node: next, next: 0 });
      }
    }
  }
  const components = new Int32Array(forward.length).fill(-1);
  let count = 0;
  for (const start of order.reverse()) {
    if (components[start] !== -1) continue;
    const stack = [start];
    components[start] = count;
    while (stack.length) {
      const node = stack.pop();
      for (const next of reverse[node])
        if (components[next] === -1) {
          components[next] = count;
          stack.push(next);
        }
    }
    count++;
  }
  return { ids, components, count, forward };
};
// Condense the immutable, already-filtered base graph. A component permits every
// internal transfer in either direction; inter-component passage direction stays
// explicit in the DAG. Temporary query endpoints are kept separate below.
export const directedComponents = (nodeIds: any, adjacency: any): any => {
  const ids = new Map<any, any>(nodeIds.map((id: any, index: any): any => [id, index]));
  const forward = nodeIds.map((): any => []),
    reverse = nodeIds.map((): any => []);
  for (const id of nodeIds)
    for (const edge of adjacency.get(id) ?? []) {
      const from = ids.get(edge.from),
        to = ids.get(edge.to);
      forward[from].push(to);
      reverse[to].push(from);
    }
  return condenseComponents(componentsOf(ids, forward, reverse));
};
// Both action proposals and exact graph rejection use the same SCC numbering.
// Condensation adds only the directed inter-component adjacency, not another DFS.
export const condenseComponents = (topology: any): any => {
  const dag = Array.from({ length: topology.count }, (): any => new Set<any>());
  for (let node = 0; node < topology.forward.length; node++) {
    const from = topology.components[node];
    for (const next of topology.forward[node]) {
      const to = topology.components[next];
      if (from !== to) dag[from].add(to);
    }
  }
  const components = new Map<any, any>();
  for (const [id, index] of topology.ids) components.set(id, topology.components[index]);
  return { components, forward: dag };
};
export const canReach = (base: any, links: any, sources: any, goals: any) => {
  const component = (id: any): any => base.components.get(id) ?? id;
  const targets = new Set<any>([...goals].map(component));
  const pending = [...new Set<any>(sources.map(component))];
  if (pending.some((id) => targets.has(id))) return true;
  const extra = new Map<any, any>();
  for (const edge of links) {
    const from = component(edge.from),
      to = component(edge.to);
    const entries = extra.get(from) ?? [];
    entries.push(to);
    extra.set(from, entries);
  }
  const visited = new Set<any>(pending);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    for (const entries of [typeof id === 'number' ? base.forward[id] : [], extra.get(id) ?? []]) {
      for (const next of entries) {
        if (targets.has(next)) return true;
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return false;
};
