const overlaps = (node, bounds) => node.min.every((value, axis) => value <= bounds.max[axis] && node.max[axis] >= bounds.min[axis]);
const sphereTouches = (node, target, radius) => node.min.reduce((squared, value, axis) => {
  const distance = Math.max(value - target[axis], 0, target[axis] - node.max[axis]);
  return squared + distance * distance;
}, 0) <= radius * radius;

export const createBoundsIndex = surfaces => {
  const build = entries => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const entry of entries) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], entry.min[axis]);
      max[axis] = Math.max(max[axis], entry.max[axis]);
    }
    if (entries.length <= 8) return { min, max, entries };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    entries.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
    const middle = Math.floor(entries.length / 2);
    return { min, max, left: build(entries.slice(0, middle)), right: build(entries.slice(middle)) };
  };
  const root = surfaces.length ? build([...surfaces]) : null;
  const query = function* (bounds, target, radius) {
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!overlaps(node, bounds) || (radius !== undefined && !sphereTouches(node, target, radius))) continue;
      if (node.entries) {
        for (const entry of node.entries) {
          if (overlaps(entry, bounds) && (radius === undefined || sphereTouches(entry, target, radius))) yield entry;
        }
      } else {
        stack.push(node.left, node.right);
      }
    }
  };
  query.nearest = function* (bounds, target) {
    const pending = createMinHeap();
    const enqueue = (node, entry = false) => {
      if (!overlaps(node, bounds)) return;
      const cost = node.min.reduce((sum, value, axis) =>
        sum + Math.max(value - target[axis], 0, target[axis] - node.max[axis]) ** 2, 0);
      pending.push({ node, entry, cost });
    };
    if (root) enqueue(root);
    while (pending.size) {
      const { node, entry } = pending.pop();
      if (entry) { yield node; continue; }
      if (node.entries) for (const value of node.entries) enqueue(value, true);
      else { enqueue(node.left); enqueue(node.right); }
    }
  };
  return query;
};

import { createMinHeap } from './heap.mjs';
