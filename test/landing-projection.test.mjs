import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closestOnSurface } from '../src/motion/goals.mjs';

// Original vector formulation is an independent numeric oracle for the scalar path.
const distanceSquared = (a, b) => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

const closestOnEdge = (target, a, b) => {
  const direction = b.map((value, axis) => value - a[axis]);
  const lengthSquared = dot(direction, direction);
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    dot(target.map((value, axis) => value - a[axis]), direction) / lengthSquared));
  return a.map((value, axis) => value + fraction * direction[axis]);
};

const closestOnTriangle = (target, a, b, c) => {
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const at = target.map((value, axis) => value - a[axis]);
  const aa = dot(ab, ab), bb = dot(ac, ac), cross = dot(ab, ac);
  const determinant = aa * bb - cross * cross;
  if (determinant > 1e-20) {
    const u = (bb * dot(at, ab) - cross * dot(at, ac)) / determinant;
    const v = (aa * dot(at, ac) - cross * dot(at, ab)) / determinant;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return a.map((value, axis) => value + u * ab[axis] + v * ac[axis]);
    }
  }
  const candidates = [closestOnEdge(target, a, b), closestOnEdge(target, b, c), closestOnEdge(target, c, a)];
  return candidates.reduce((best, point) => distanceSquared(target, point) < distanceSquared(target, best) ? point : best);
};



test('landing projections retain the original numerical order on varied triangle families', () => {
  let seed = 37;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const scale of [0.001, 1, 1e5]) for (let index = 0; index < 1500; index++) {
    const vertices = Array.from({length:3},()=>Array.from({length:3},()=> (random()-.5)*scale));
    if(index%19===0) vertices[1]=[...vertices[0]];
    if(index%23===0) vertices[0]=[-0,0,-0];
    const target=Array.from({length:3},()=> (random()-.5)*scale);
    const [a,b,c]=vertices;
    const area=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
    let expected=null;
    if(Math.abs(area)>=1e-10) {
      const position=closestOnTriangle(target,a,b,c);
      expected={surface:'s',position,distance:Math.sqrt(distanceSquared(target,position))};
    }
    assert.deepEqual(closestOnSurface({id:'s',vertices},target),expected);
  }
});
