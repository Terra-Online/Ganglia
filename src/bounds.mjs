const overlaps = (node, bounds) => {
  for (let axis = 0; axis < node.min.length; axis++) {
    if (!(node.min[axis] <= bounds.max[axis] && node.max[axis] >= bounds.min[axis])) return false;
  }
  return true;
};
const sphereTouches = (node, target, radius) => {
  let squared = 0;
  for (let axis = 0; axis < node.min.length; axis++) {
    const distance = Math.max(node.min[axis] - target[axis], 0, target[axis] - node.max[axis]);
    squared += distance * distance;
  }
  return squared <= radius * radius;
};

export const createBoundsTree = surfaces => {
  const entries = [...surfaces];
  // Keep the original three-way partition order, but read each centre once. The
  // ordinal and centre columns are build-only scratch; leaves retain entry refs.
  const order = new Uint32Array(entries.length);
  const centers = Array.from({ length: 3 }, () => new Float64Array(entries.length));
  for (let index = 0; index < entries.length; index++) {
    order[index] = index;
    const entry = entries[index];
    for (let axis = 0; axis < 3; axis++) centers[axis][index] = entry.min[axis] + entry.max[axis];
  }
  // Median partitioning avoids sorting every subtree. Equal centres form one
  // partition, so coincident or elongated bounds still terminate in balanced leaves.
  const select = (start, end, middle, axis) => {
    const values = centers[axis] ?? [];
    const center = index => values[order[index]];
    while (end - start > 1) {
      const first = center(start), last = center(end - 1), mid = center(Math.floor((start + end) / 2));
      const pivot = Math.max(Math.min(first, last), Math.min(Math.max(first, last), mid));
      let lower = start, current = start, upper = end;
      while (current < upper) {
        const value = center(current);
        if (value < pivot) {
          const other = order[lower]; order[lower] = order[current]; order[current] = other;
          lower++; current++;
        } else if (value > pivot) {
          upper--;
          const other = order[upper]; order[upper] = order[current]; order[current] = other;
        } else current++;
      }
      if (middle < lower) end = lower;
      else if (middle >= upper) start = upper;
      else return;
    }
  };
  const build = (start, end) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let index = start; index < end; index++) {
      const entry = entries[order[index]];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], entry.min[axis]);
        max[axis] = Math.max(max[axis], entry.max[axis]);
      }
    }
    if (end - start <= 8) return { min, max, entries: Array.from(order.subarray(start, end), index => entries[index]) };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const middle = Math.floor((start + end) / 2);
    select(start, end, middle, axis);
    return { min, max, left: build(start, middle), right: build(middle, end) };
  };
  return entries.length ? build(0, entries.length) : null;
};

export const createBoundsIndex = (surfaces, groupOf) => {
  const root = createBoundsTree(surfaces);
  // Uniform subtrees can be accepted or excluded without visiting every leaf.
  // Their grouping is immutable; callers explicitly filter group IDs, not entries.
  const annotate = node => {
    if (!node) return;
    if (node.entries) {
      node.group = groupOf(node.entries[0]);
      node.uniform = node.entries.every(entry => groupOf(entry) === node.group);
    } else {
      annotate(node.left); annotate(node.right);
      node.group = node.left.group;
      node.uniform = node.left.uniform && node.right.uniform && node.left.group === node.right.group;
    }
  };
  if (groupOf) annotate(root);
  return fromRoot(root, groupOf);
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

const filterGroups = (node, eligible, groupOf) => {
  if (!node) return null;
  if (node.uniform) return eligible(node.group) ? node : null;
  if (node.entries) {
    const entries = node.entries.filter(entry => eligible(groupOf(entry)));
    if (!entries.length) return null;
    return entries.length === node.entries.length ? node : { ...node, entries };
  }
  const left = filterGroups(node.left, eligible, groupOf), right = filterGroups(node.right, eligible, groupOf);
  if (!left) return right;
  if (!right) return left;
  return left === node.left && right === node.right ? node : { ...node, left, right };
};

const fromRoot = (root, groupOf) => {
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
      let cost = 0;
      for (let axis = 0; axis < node.min.length; axis++) {
        cost += Math.max(node.min[axis] - target[axis], 0, target[axis] - node.max[axis]) ** 2;
      }
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
  query.filter = eligible => fromRoot(filterNode(root, eligible), groupOf);
  query.filterGroups = eligible => {
    if (!groupOf) throw new Error('Bounds index has no immutable groups');
    return fromRoot(filterGroups(root, eligible, groupOf), groupOf);
  };
  return query;
};

import { createMinHeap } from './heap.mjs';
