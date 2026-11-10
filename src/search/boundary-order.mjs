// The static hierarchy owns group order and stable slots. Per-query ranks and
// eligibility live in compact arrays, without constructing another full tree.
export const boundaryTree = (entries, size, height, diversity) => {
  let serial = 0;
  const build = (items, scale) => {
    const slot = serial++;
    if (items.length < 2 || scale <= diversity) return { slot, entries: items };
    const groups = new Map();
    for (const edge of items) {
      const p = edge.midpoint;
      const key = `${Math.floor(p[0] / scale)}/${Math.floor(p[1] / height)}/${Math.floor(p[2] / scale)}`;
      const group = groups.get(key) ?? [];
      group.push(edge); groups.set(key, group);
    }
    return { slot, children: [...groups.values()].map(group => build(group, scale / 2)) };
  };
  const tree = build(entries, size);
  tree.count = serial;
  tree.entryCount = entries.length;
  tree.entrySlots = new Map(entries.map((entry, index) => [entry, index]));
  return tree;
};

export const boundaryOrder = (tree, eligible, compare, limit) => {
  if (limit <= 0) return [];
  const best = new Array(tree.count), included = new Uint8Array(tree.entryCount);
  const rank = node => {
    let first = null;
    if (node.entries) {
      for (const entry of node.entries) {
        if (!eligible(entry)) continue;
        included[tree.entrySlots.get(entry)] = 1;
        if (first === null || compare(entry, first) < 0) first = entry;
      }
    } else {
      for (const child of node.children) {
        const candidate = rank(child);
        if (candidate !== null && (first === null || compare(candidate, first) < 0)) first = candidate;
      }
    }
    best[node.slot] = first;
    return first;
  };
  // A region appears in a globally sorted list at its least-ranked eligible edge.
  // Only regions actually visited by the round-robin prefix need sorting/streams.
  const stream = function* (node) {
    if (node.entries) {
      yield* node.entries.filter(entry => included[tree.entrySlots.get(entry)]).sort(compare);
      return;
    }
    let active = node.children.filter(child => best[child.slot] !== null)
      .sort((a, b) => compare(best[a.slot], best[b.slot])).slice(0, limit).map(stream);
    while (active.length) {
      const pending = [];
      for (const iterator of active) {
        const next = iterator.next();
        if (!next.done) {
          yield next.value;
          pending.push(iterator);
        }
      }
      active = pending;
    }
  };
  if (rank(tree) === null) return [];
  const iterator = stream(tree), result = [];
  while (result.length < limit) {
    const next = iterator.next();
    if (next.done) break;
    result.push(next.value);
  }
  return result;
};
