import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockedByWalls, createWallChecker, route} from '../src/index.mjs';
const wall={min:[0,0,-2], max:[0.2,3,2], state:'unknown'};
const profile={radius:0.4,height:2};
test('unknown walls reject crossing and radius grazing; inactive walls allow crossing',()=>{
 assert.equal(blockedByWalls([-1,0,0],[1,0,0],[wall],profile),true);
 assert.equal(blockedByWalls([-1,0,2.3],[1,0,2.3],[wall],profile),true);
 assert.equal(blockedByWalls([-1,0,0],[1,0,0],[{...wall,state:'inactive'}],profile),false);
 assert.equal(blockedByWalls([-2,0,-1],[-2,0,1],[{...wall,padding:3}],profile),true);
 assert.equal(blockedByWalls([-1,4,0],[1,4,0],[wall],profile),false);
 assert.equal(blockedByWalls([-1,-1,0],[1,-1,0],[wall],profile),true);
});

test('routing cannot bypass the wall test with an explicitly open edge',()=>{
 const a=[-1,0,0], b=[1,0,0];
 const graph={nodes:[{id:'a',position:a},{id:'b',position:b}],edges:[{from:'a',to:'b',cost:1,state:'open',points:[a,b]}]};
 assert.equal(route(graph,'a','b',{walls:[wall],profile}).status,'no-verified-route');
});

test('bent wall polylines do not fill their whole bounding box or bridge stacked floors',()=>{
 const bent={min:[0,0,0],max:[5,3,5],state:'unknown',points:[[0,0],[0,5],[5,5]]};
 assert.equal(blockedByWalls([2,0,1],[4,0,1],[bent],profile),false);
 assert.equal(blockedByWalls([-1,0,1],[1,0,1],[bent],profile),true);
 assert.equal(blockedByWalls([-1,4,1],[1,4,1],[bent],profile),false);
 assert.equal(blockedByWalls([0,4,1],[4,0,1],[bent],profile),false);
 assert.equal(blockedByWalls([1,0,1],[1,0,4.8],[bent],profile),true);
});

test('filled hazard prisms preserve concavities, interior exclusion and rounded clearance',()=>{
  const zone={min:[0,0,0],max:[4,4,4],state:'unknown',polygon:[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]};
  const profile={radius:.2,height:1.6};
  assert.equal(blockedByWalls([2,1,2],[3,1,3],[zone],profile),false);
  assert.equal(blockedByWalls([2,1,.5],[3,1,.5],[zone],profile),true);
  assert.equal(blockedByWalls([-.5,1,2],[.5,1,2],[zone],profile),true);
  assert.equal(blockedByWalls([1.1,1,2],[1.1,1,3],[zone],profile),true);
  assert.equal(blockedByWalls([.5,5,2],[.5,5,3],[zone],profile),false);
  assert.equal(blockedByWalls([.5,-1,2],[.5,-1,3],[zone],profile),true);
  assert.equal(blockedByWalls([.5,1,2],[.5,1,3],[{...zone,state:'inactive'}],profile),false);
  assert.throws(()=>blockedByWalls([0,0,0],[1,0,1],[{...zone,points:[[0,0],[1,1]]}],profile),/polygon/);
});

test('prepared exclusions own their bounds, rings, active states and body profile', () => {
  const zone = { min: [0,0,0], max: [4,4,4], state: 'unknown',
    polygon: [[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]] };
  const body = { radius: .2, height: 2 }, check = createWallChecker([zone], body);
  assert.equal(check([.5,-1,2],[.5,-1,3]), true);
  assert.equal(check([2,1,2],[3,1,3]), false);
  zone.state = 'inactive';
  zone.min.fill(100); zone.max.fill(101);
  zone.polygon.forEach(point => point.fill(100));
  body.radius = 0; body.height = .1;
  assert.equal(check([.5,-1,2],[.5,-1,3]), true);
  assert.equal(createWallChecker([zone], body)([.5,-1,2],[.5,-1,3]), false);
});

test('all records are validated before early hits, including inactive and distant walls', () => {
  const start = [-1,0,0], end = [1,0,0];
  const invalid = { ...wall, min: [100,NaN,100], max: [101,2,101] };
  assert.throws(() => createWallChecker([wall,invalid],profile), /Invalid wall/);
  assert.throws(() => blockedByWalls(start,end,[wall,invalid],profile), /Invalid wall/);
  assert.throws(() => createWallChecker([wall,{...wall,state:'inactive',polygon:[[0,0],[1,NaN],[1,1]]}],profile), /polygon/);
  for (const body of [{radius:-1,height:2},{radius:0,height:0},{radius:NaN,height:2}]) {
    assert.throws(() => createWallChecker([],body), /wall query/);
  }
  assert.throws(() => createWallChecker([],profile)([0,NaN,0],[1,0,0]), /wall query/);
});

test('broad-phase bounds retain tall bodies, padding and ring vertices outside declared bounds', () => {
  const zone = { min: [100,1,100], max: [101,2,101], state: 'active', padding: .3,
    polygon: [[0,0],[4,0],[4,4],[0,4]] };
  const tall = createWallChecker([zone],{radius:.2,height:2});
  assert.equal(tall([4.5,0,1],[4.5,0,3]), true);
  assert.equal(tall([4.51,0,1],[4.51,0,3]), false);
  assert.equal(tall([1,3,1],[3,3,1]), false);
  assert.equal(createWallChecker([zone],{radius:.2,height:.5})([1,0,1],[3,0,1]), false);
});

test('indexed queries match the single-query checker for deterministic mixed wall geometry', () => {
  let seed = 19;
  const next = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32; };
  const walls = Array.from({length:40}, (_,index) => {
    const x = next()*50-25, z = next()*50-25, y = next()*10-5, size = 1+next()*4;
    const shape = index%3;
    return { min:[x,y,z], max:[x+size,y+1+next()*3,z+size], padding:next()*.5,
      state:['active','unknown','inactive'][index%3],
      ...(shape===0 ? {polygon:[[x,z],[x+size,z],[x+size,z+.4],[x+.4,z+.4],[x+.4,z+size],[x,z+size]]}
        : shape===1 ? {points:[[x,z],[x,z+size],[x+size,z+size]]} : {}) };
  });
  for (const body of [{radius:0,height:.1},{radius:.35,height:1.66},{radius:1,height:4}]) {
    const check = createWallChecker(walls,body);
    for (let index=0; index<300; index++) {
      const a = [next()*70-35,next()*20-10,next()*70-35];
      const b = [next()*70-35,next()*20-10,next()*70-35];
      assert.equal(check(a,b),blockedByWalls(a,b,walls,body));
    }
  }
});
