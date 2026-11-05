const overlaps = (node, bounds) => node.min.every((value, axis) => value <= bounds.max[axis] && node.max[axis] >= bounds.min[axis]);
const sphereTouches = (node, target, radius) => node.min.reduce((squared, value, axis) => {
  const distance = Math.max(value - target[axis], 0, target[axis] - node.max[axis]);
  return squared + distance * distance;
}, 0) <= radius * radius;

export const createBoundsIndex = surfaces => {
  const entries = [...surfaces];
  // Median partitioning avoids sorting every subtree. Equal centres form one
  // partition, so coincident or elongated bounds still terminate in balanced leaves.
  const select = (start, end, middle, axis) => {
    const center = index => entries[index].min[axis] + entries[index].max[axis];
    while (end - start > 1) {
      const first = center(start), last = center(end - 1), mid = center(Math.floor((start + end) / 2));
      const pivot = Math.max(Math.min(first, last), Math.min(Math.max(first, last), mid));
      let lower = start, current = start, upper = end;
      while (current < upper) {
        const value = center(current);
        if (value < pivot) {
          [entries[lower], entries[current]] = [entries[current], entries[lower]];
          lower++; current++;
        } else if (value > pivot) {
          upper--;
          [entries[upper], entries[current]] = [entries[current], entries[upper]];
        } else current++;
      }
      if (middle < lower) end = lower;
      else if (middle >= upper) start = upper;
      else return;
    }
  };
  const build = (start, end) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let index = start; index < end; index++) for (let axis = 0; axis < 3; axis++) {
      const entry = entries[index];
      min[axis] = Math.min(min[axis], entry.min[axis]);
      max[axis] = Math.max(max[axis], entry.max[axis]);
    }
    if (end - start <= 8) return { min, max, entries: entries.slice(start, end) };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const middle = Math.floor((start + end) / 2);
    select(start, end, middle, axis);
    return { min, max, left: build(start, middle), right: build(middle, end) };
  };
  return fromRoot(entries.length ? build(0, entries.length) : null);
};

// Filtered views reuse the immutable hierarchy. Repeated movement frontiers
// change eligibility, without requiring another spatial sort of the same faces.
const filterNode = (node, eligible) => {
  if (!node) return null;
  if (node.entries) {
    const entries = node.entries.filter(eligible);
    if (!entries.length) return null;
    return entries.length === node.entries.length ? node : { ...node, entries };
  }
  const left = filterNode(node.left, eligible), right = filterNode(node.right, eligible);
  if (!left) return right;
  if (!right) return left;
  return left === node.left && right === node.right ? node : { ...node, left, right };
};

const fromRoot = root => {
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
  query.filter = eligible => fromRoot(filterNode(root, eligible));
  return query;
};

import { createMinHeap } from './heap.mjs';
