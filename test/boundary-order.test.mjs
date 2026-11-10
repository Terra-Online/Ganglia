import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryTree, boundaryOrder } from '../src/search/boundary-order.mjs';
import { interleave } from '../src/search/traversal.mjs';

// The reference is the original full-list ordering. New construction may avoid
// unconsumed suffixes, but every consumed item and tie must retain its place.
const reference = (entries, size, height, diversity) => {
  if (entries.length < 2 || size <= diversity) return entries;
  const regions = new Map();
  for (const entry of entries) {
    const p = entry.midpoint;
    const key = [Math.floor(p[0] / size), Math.floor(p[1] / height), Math.floor(p[2] / size)].join('/');
    const group = regions.get(key) ?? [];
    group.push(entry); regions.set(key, group);
  }
  return interleave([...regions.values()].map(group => reference(group, size / 2, height, diversity)), entries.length);
};

test('hierarchical boundary ordering preserves full-list prefixes, stable ties and filtered floors', () => {
  let seed = 129;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const entries = Array.from({ length: 1200 }, (_, index) => ({ index,
    midpoint: [Math.floor(random() * 80) - 40, Math.floor(random() * 12) - 6, Math.floor(random() * 80) - 40],
    score: Math.floor(random() * 30) }));
  for (const [size, height, diversity] of [[16, 2, 0.6], [4, 3, 0.7], [0.5, 2, 0.6]]) {
    const tree = boundaryTree(entries, size, height, diversity);
    for (const eligible of [() => true, entry => entry.index % 3 === 0,
      entry => entry.midpoint[1] >= 0, () => false]) {
      const compare = (a, b) => a.score - b.score || a.index - b.index;
      const expected = reference(entries.filter(eligible).sort(compare), size, height, diversity);
      for (const limit of [0, 1, 7, 128, 2048]) {
        assert.deepEqual(boundaryOrder(tree, eligible, compare, limit), expected.slice(0, limit));
      }
    }
  }
});


test('lazy prefix handles repeated entry references and uneven exhausted groups', () => {
  const a = {index:0,score:0,midpoint:[0,0,0]}, b = {index:1,score:0,midpoint:[20,0,0]};
  const entries = [a, a, b, ...Array.from({length:21},(_,index)=>({index:index+2,score:index%3,midpoint:[30+index,0,0]}))];
  const compare = (a,b) => a.score-b.score || a.index-b.index;
  const expected = reference([...entries].sort(compare),16,2,.6);
  const tree = boundaryTree(entries,16,2,.6);
  for(const count of [1,2,3,7,24,100]) assert.deepEqual(boundaryOrder(tree,()=>true,compare,count),expected.slice(0,count));
});
