import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandidatePlanner} from '../src/candidate-planner.mjs';
import { blockedByWalls } from '../src/walls.mjs';
const square=(id,x,z)=>({id,vertices:[[x,0,z],[x+2,0,z],[x+2,0,z+2],[x,0,z+2]]});
test('candidate rejection preserves alternative spatial entrances and never reports execution',()=>{
 const data={surfaces:[square('a',0,0),square('b',4,0),square('c',2,4)],options:{speed:5,maxVertical:1}};
 const planner=createCandidatePlanner(data,{radius:5});
 const starts=[{id:'start',position:[1,0,1],state:'available',cost:0}];
 const first=planner.plan(starts,[5,0,1]);
 assert.equal(first.status,'candidate');assert.ok(first.unresolved.length);assert.equal(first.cost,undefined);
 const excluded = planner.plan(starts,[5,0,1],{excludedEdges:first.path.map(e=>e.index)});
 assert.equal(excluded.status,'candidate');
 assert.ok(excluded.path.every(e=>!first.path.some(old=>old.index===e.index)));
 assert.deepEqual(planner.plan(starts,[5,0,1]).path,first.path);
 planner.reject(first.path.map(e=>e.index));
 const next=planner.plan(starts,[5,0,1]);
 assert.equal(next.status,'candidate');
 assert.ok(next.path.every(e=>!first.path.some(old=>old.index===e.index)));
});
test('unmapped endpoints retain their actual positions and use unresolved local access',()=>{
 const data={surfaces:[square('road',40,0)],options:{speed:5,maxVertical:1}};
 const planner=createCandidatePlanner(data,{endpointRadius:50});
 const start=[0,5,1],goal=[45,4,1];
 const result=planner.plan([{id:'factory',position:start,cost:0,state:'available'}],goal);
 assert.equal(result.status,'candidate');
 assert.deepEqual(result.points[0],start);
 assert.deepEqual(result.points.at(-1),goal);
 assert.equal(result.unresolved.length,2);
 assert.deepEqual(result.unresolved[0].points[0],start);
 assert.deepEqual(result.unresolved.at(-1).points.at(-1),goal);
});

test('failed transfer regions reject adjacent probes and endpoint bypasses without affecting other queries',()=>{
 const data={surfaces:[square('a',0,0),square('b',4,0),square('c',2,4)],options:{speed:5,maxVertical:1}};
 const planner=createCandidatePlanner(data,{radius:5});
 const starts=[{id:'start',position:[1,0,1],state:'available',cost:0}];
 const original=planner.plan(starts,[5,0,1]);
 const alternative=planner.plan(starts,[5,0,1],{excludedTransfers:[{from:'a',to:'b',min:[-1,-1,-1],max:[8,1,3]}]});
 assert.equal(alternative.status,'candidate');
 assert.ok(alternative.points.some(p=>p[2]>=4));
 assert.deepEqual(planner.plan(starts,[5,0,1]).path,original.path);
});

const startAt = position => [{id:'start',position,state:'available',cost:0}];
const length = points => points.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])), 0);
const rawPoints = result => [result.arrival.position, ...result.path.flatMap(edge => edge.points)];

test('the first candidate straightens alternating triangle centres into a supported direct route', () => {
  const surfaces = [];
  for (let x = 0; x < 12; x++) {
    const a = [x,0,0], b = [x+1,0,0], c = [x+1,0,2], d = [x,0,2];
    const triangles = x % 2 ? [[a,b,d],[b,c,d]] : [[a,b,c],[a,c,d]];
    triangles.forEach((vertices, index) => surfaces.push({id:`${x}/${index}`,vertices}));
  }
  const planner = createCandidatePlanner({surfaces,options:{speed:5,maxVertical:1}}, {endpointRadius:0.2});
  const start = [0.1,0,0.3], goal = [11.9,0,1.7];
  const result = planner.plan(startAt(start), goal);
  assert.equal(result.status, 'candidate');
  assert.equal(result.unresolved.length, 0);
  assert.ok(rawPoints(result).length > 40);
  assert.deepEqual(result.points, [start,goal]);
  assert.ok(length(result.points) < length(rawPoints(result)) * 0.9);
  assert.deepEqual(planner.plan(startAt(start), goal).path, result.path);
});

test('candidate ground shortcuts retain the missing inside of an L shaped corridor and wall clearance', () => {
  const surfaces = [square('a',0,0),square('b',2,0),square('c',4,0),square('d',4,2),square('e',4,4)];
  const walls = [{min:[3.8,-1,1.7],max:[4.3,3,2.3],state:'unknown'}];
  const profile = {radius:0.1,height:1.8};
  const planner = createCandidatePlanner({surfaces,options:{speed:5,maxVertical:1,walls,profile}}, {endpointRadius:0.2});
  const start = [1,0,1], goal = [5,0,5], result = planner.plan(startAt(start), goal);
  assert.equal(result.status, 'candidate');
  assert.equal(result.unresolved.length, 0);
  assert.ok(result.points.length > 2);
  assert.ok(length(result.points) < length(rawPoints(result)));
  for (let index = 1; index < result.points.length; index++) {
    const a = result.points[index-1], b = result.points[index];
    assert.equal(blockedByWalls(a,b,walls,profile), false);
    for (let step = 0; step <= 20; step++) {
      const p = a.map((value, axis) => value + step / 20 * (b[axis]-value));
      assert.ok(p[0] >= 4-1e-7 || p[2] <= 2+1e-7, 'shortcut crossed the missing floor');
    }
  }
});

test('candidate straightening preserves an unresolved device trajectory between ground runs', () => {
  const surfaces = [square('a',0,0),square('b',10,0)];
  const trajectory = [[2,0,1],[6,5,3],[10,0,1]];
  const planner = createCandidatePlanner({surfaces,options:{speed:5,maxVertical:1}}, {
    radius:1,endpointRadius:0.2,connections:[{from:'a',to:'b',points:trajectory,mode:'ride',device:'raft'}],
  });
  const start = [0.5,0,0.5], goal = [11.5,0,1.5], result = planner.plan(startAt(start), goal);
  assert.equal(result.status, 'candidate');
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(result.unresolved[0].points, trajectory);
  assert.equal(result.unresolved[0].device, 'raft');
  const first = result.points.findIndex(point => point.every((value, axis) => value === trajectory[0][axis]));
  assert.deepEqual(result.points.slice(first,first+trajectory.length), trajectory);
  assert.deepEqual(result.points[0], start);
  assert.deepEqual(result.points.at(-1), goal);
  assert.ok(length(result.points) < length(rawPoints(result)));
});

test('candidate straightening reconstructs directed height transitions and never opens the reverse route', () => {
  const surfaces = [
    {id:'lower',vertices:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
    {id:'upper',vertices:[[1,0.3,0],[2,0.3,0],[2,0.3,1],[1,0.3,1]]},
  ];
  const portals = [{from:'lower',to:'upper',points:[[1,0,0.5],[1,0.3,0.5]],
    entry:[[1,0,0],[1,0,1]],exit:[[1,0.3,0],[1,0.3,1]]}];
  const planner = createCandidatePlanner({surfaces,options:{speed:5,maxVertical:0.1,portals}}, {
    radius:0.2,verticalRange:0.1,endpointRadius:0.1,
  });
  const start = [0.25,0,0.25], goal = [1.75,0.3,0.75], result = planner.plan(startAt(start), goal);
  assert.equal(result.status, 'candidate');
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.points, [start,[1,0,0.5],[1,0.3,0.5],goal]);
  assert.equal(planner.plan(startAt(goal), start).status, 'no-candidate');
});

test('stable edge exclusions survive a different lazy expansion and endpoint history', () => {
  const data = {surfaces:[square('a',0,0),square('b',4,0),square('c',2,4)],options:{speed:5,maxVertical:1}};
  const options = {radius:5,endpointRadius:0.2};
  const first = createCandidatePlanner(data,options);
  const start = startAt([1,0,1]), goal = [5,0,1];
  const route = first.plan(start,goal);
  const keys = route.unresolved.map(edge => edge.key);
  assert.ok(keys.length);
  const second = createCandidatePlanner(data,options);
  second.plan(startAt([3,0,5]),[5,0,1]);
  const alternative = second.plan(start,goal,{excludedEdges:keys});
  assert.equal(alternative.status,'candidate');
  assert.ok(alternative.path.every(edge => !keys.includes(edge.key)));
  first.reject(keys);
  assert.deepEqual(first.plan(start,goal).points,alternative.points);
});

test('endpoint index retains a large face whose centre is outside the query sphere', () => {
  const data = {surfaces:[{id:'wide',vertices:[[-100,0,-100],[100,0,-100],[100,0,100],[-100,0,100]]}],
    options:{speed:5,maxVertical:1}};
  const planner = createCandidatePlanner(data,{endpointRadius:0.1});
  const result = planner.plan(startAt([-90,0,-90]),[-89,0,-89]);
  assert.equal(result.status,'candidate');
  assert.equal(result.unresolved.length,0);
});
