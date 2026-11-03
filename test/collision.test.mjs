import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCollisionWorld} from '../src/collision.mjs';
const profile={radius:.35,height:1.66};
const world=(faces)=>createCollisionWorld({positions:faces.flat(2),indices:Array.from({length:faces.length*3},(_,i)=>i)});
const wall=[[[0,-10,-10],[0,10,-10],[0,10,10]],[[0,-10,-10],[0,10,10],[0,-10,10]]];

test('continuous sweep catches a thin wall between clear endpoints in either direction',()=>{
  const query=world(wall);
  assert.equal(query.sweepCapsule([-20,0,0],[-20,0,0],profile),null);
  assert.equal(query.sweepCapsule([20,0,0],[20,0,0],profile),null);
  assert.ok(query.sweepCapsule([-20,0,0],[20,0,0],profile));
  assert.ok(query.sweepCapsule([20,0,0],[-20,0,0],profile));
  assert.equal(query.sweepCapsule([.36,0,-5],[.36,0,5],profile),null);
  assert.ok(query.sweepCapsule([.34,0,-5],[.34,0,5],profile));
});

test('vertical and oblique sweeps include body height, endpoints and degenerate faces',()=>{
  const floor=world([[[-10,0,-10],[10,0,-10],[0,0,10]]]);
  assert.ok(floor.sweepCapsule([0,5,0],[0,-5,0],profile));
  assert.ok(floor.sweepCapsule([0,-3,0],[0,-1,0],profile));
  assert.equal(floor.sweepCapsule([0,2,0],[0,3,0],profile),null);
  const point=world([[[0,1,0],[0,1,0],[0,1,0]]]);
  assert.ok(point.sweepCapsule([-1,0,-1],[1,0,1],profile));
  assert.equal(point.sweepCapsule([-1,0,1],[1,0,2],profile),null);
  const line=world([[[0,0,0],[0,2,0],[0,1,0]]]);
  assert.ok(line.sweepCapsule([-1,0,0],[1,0,0],profile));
});

test('capsule rounding is retained and curve inflation bounds the full body',()=>{
  const obstacle=world([[[.3,1.6,0],[.3,1.6,0],[.3,1.6,0]]]);
  assert.equal(obstacle.sweepCapsule([0,0,0],[0,0,0],profile),null);
  assert.ok(obstacle.sweepCapsule([0,0,0],[0,0,0],{...profile,inflation:.1}));
  const above=world([[[-5,2,-5],[5,2,-5],[0,2,5]]]);
  assert.equal(above.sweepCapsule([-1,0,0],[1,0,0],profile),null);
  assert.ok(above.sweepCapsule([-1,0,0],[1,0,0],{...profile,inflation:.4}));
});

test('BVH retains distant thin faces, input snapshots and original triangle identity',()=>{
  const faces=Array.from({length:80},(_,i)=>[[i*5,-2,-2],[i*5,3,-2],[i*5,3,2]]);
  const geometry={positions:faces.flat(2),indices:Array.from({length:240},(_,i)=>i)};
  const query=createCollisionWorld(geometry);
  geometry.positions.fill(999);geometry.indices.fill(0);
  assert.equal(query.sweepCapsule([394,0,0],[396,0,0],profile).triangle,79);
  assert.equal(query.sweepCapsule([396,0,0],[399,0,0],profile),null);
});

test('invalid data cannot yield a clear collision query',()=>{
  assert.throws(()=>createCollisionWorld({positions:[NaN,0,0],indices:[0,0,0]}),/finite/);
  assert.throws(()=>createCollisionWorld({positions:[0,0,0],indices:[0,1,0]}),/index/);
  const query=world(wall);
  assert.throws(()=>query.sweepCapsule([0,NaN,0],[0,0,0],profile),/sweep/);
  assert.throws(()=>query.sweepCapsule([0,0,0],[0,0,0],{radius:1,height:1}),/sweep/);
  assert.throws(()=>query.sweepCapsule([0,0,0],[0,0,0],{...profile,inflation:-1}),/sweep/);
});

test('small coplanar faces inside the swept axis sheet collide between capsule end spheres',()=>{
  const query=world([[[0,.7,-.05],[0,.9,-.05],[0,.8,.05]]]);
  assert.ok(query.sweepCapsule([-2,0,0],[2,0,0],profile));
  const sphere=world([[[0,.3,0],[0,.3,0],[0,.3,0]]]);
  assert.ok(sphere.sweepCapsule([-2,0,0],[2,0,0],{radius:.35,height:.7}));
});

test('swept capsule agrees with analytic distance to an axis-aligned swept rectangle',()=>{
  let seed=7;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<120;i++){
    const p=[next()*6-3,next()*3-.5,next()*2-1];
    const dx=Math.max(0,-1-p[0],p[0]-1),dy=Math.max(0,.35-p[1],p[1]-1.31);
    const expected=dx*dx+dy*dy+p[2]*p[2]<=.35**2;
    assert.equal(world([[p,p,p]]).sweepCapsule([-1,0,0],[1,0,0],profile)!==null,expected);
  }
});
