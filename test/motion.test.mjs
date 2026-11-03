import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGroundRoute, routeFrom, sampleJourney} from '../src/index.mjs';
const floor = y => ({id:String(y),vertices:[[-2,y,-2],[2,y,-2],[2,y,2],[-2,y,2]]});
const surfaces = [floor(0),floor(8)];
const options = {speed:1,maxVertical:.1,profile:{radius:.35,height:1.66},walls:[]};
const player = position => [{id:'player',position,cost:0,state:'available'}];
const rope = {id:'rope-up',mode:'rope',state:'open',points:[[0,0,0],[0,8,0]],times:[0,4]};

test('grounded rope links connect floors in the authored direction and participate in arrival costs',()=>{
 const result=planGroundRoute(surfaces,player([0,0,0]),[1,8,0],{...options,connections:[rope]});
 assert.equal(result.status,'complete');
 assert.equal(result.cost,5);
 assert.equal(result.arrivalCost,0);
 assert.equal(result.segments.find(s=>s.mode==='rope').connection,'rope-up');
 assert.deepEqual(sampleJourney(result,2),{mode:'rope',position:[0,4,0],connection:'rope-up'});
 assert.deepEqual(sampleJourney(result,4.5),{mode:'walk',position:[.5,8,0]});
 assert.equal(planGroundRoute(surfaces,player([0,8,0]),[0,0,0],{...options,connections:[rope]}).status,'no-verified-route');
 const teleported=planGroundRoute(surfaces,[...player([0,0,0]),
  {id:'camp',position:[1,8,0],cost:2,state:'available'}],[1,8,0],{...options,connections:[rope]});
 assert.equal(teleported.start,'camp');assert.equal(teleported.cost,2);assert.equal(teleported.arrivalCost,2);
 assert.deepEqual(sampleJourney(teleported,0),{mode:'complete',position:[1,8,0]});
});

test('unknown devices, unsupported endpoints and air walls cannot grant cross-floor access',()=>{
 for(const connection of [{...rope,state:'unknown'}, {...rope,points:[[0,-.5,0],[0,8,0]]}]) {
  assert.equal(planGroundRoute(surfaces,player([0,0,0]),[0,8,0],{...options,connections:[connection]}).status,'no-verified-route');
 }
 assert.equal(planGroundRoute(surfaces,player([0,0,0]),[0,8,0],{...options,connections:[rope],
  walls:[{min:[-.5,4,-.5],max:[.5,5,.5],state:'unknown'}]}).status,'no-verified-route');
 assert.throws(()=>planGroundRoute(surfaces,player([0,0,0]),[0,8,0],{...options,connections:[{...rope,times:[1,4]}]}),/timing/);
});

test('variable-speed drop samples preserve timing and do not create the reverse jump',()=>{
 const points=[[1,8,0],[1,6,0],[1,0,0]],times=[0,.5,1];
 const graph={nodes:[{id:'top',position:points[0]},{id:'bottom',position:points.at(-1)}],
  edges:[{from:'top',to:'bottom',mode:'drop',points,times,cost:1,state:'open',connection:'drop-down'}]};
 const result=routeFrom(graph,[{id:'camp',node:'top',cost:3,state:'available'}],'bottom');
 assert.equal(result.cost,4);assert.equal(result.arrivalCost,3);
 assert.deepEqual(sampleJourney(result,.75),{mode:'drop',position:[1,3,0],connection:'drop-down'});
 assert.deepEqual(sampleJourney(result,2),{mode:'complete',position:[1,0,0]});
 assert.equal(routeFrom(graph,[{id:'player',node:'bottom',cost:0,state:'available'}],'top').status,'no-verified-route');
 times[1]=.1;points[1][1]=99;
 assert.deepEqual(sampleJourney(result,.75).position,[1,3,0]);
});

test('explicit collision support tolerance preserves feet without joining different floors', () => {
 const raised = { ...rope, points: [[0,.02,0],[0,8.02,0]] };
 assert.equal(planGroundRoute(surfaces,player([0,0,0]),[0,8,0],
  {...options,connections:[raised]}).status,'no-verified-route');
 const result = planGroundRoute(surfaces,player([0,0,0]),[0,8,0],
  {...options,connections:[{...raised,endpointTolerance:.03}]});
 assert.equal(result.status,'complete');
 assert.deepEqual(result.segments.find(segment=>segment.mode==='rope').points,raised.points);
 assert.throws(()=>planGroundRoute(surfaces,player([0,0,0]),[0,8,0],
  {...options,connections:[{...raised,endpointTolerance:.2}]}),/endpoint tolerance/);
 assert.equal(planGroundRoute(surfaces,player([0,0,0]),[0,8,0],
  {...options,connections:[{...raised,points:[[0,.2,0],[0,8.02,0]],endpointTolerance:.03}]}).status,
  'no-verified-route');
 const exact = planGroundRoute(surfaces,player([0,0,0]),[0,8,0],
  {...options,maxVertical:0,profile:{radius:0,height:1.66},connections:[rope]});
 assert.equal(exact.status,'complete');
});

test('required gait survives graph and ground planning and excludes unproved air links', () => {
 const jump = { id: 'sprint-air', mode: 'jump', state: 'open', requiredGait: 'sprint',
  points: [[0,0,0],[6.5,0,0]], times: [0,1] };
 const graph = { nodes: [{ id: 'a', position: jump.points[0] }, { id: 'b', position: jump.points[1] }],
  edges: [{ ...jump, from: 'a', to: 'b', cost: 1, connection: jump.id }] };
 const result = routeFrom(graph, [{ id: 'p', node: 'a', cost: 0, state: 'available' }], 'b');
 assert.equal(result.segments[0].requiredGait, 'sprint');
 for (const requiredGait of ['run', 'fly', null]) {
  assert.throws(() => routeFrom({ ...graph, edges: [{ ...graph.edges[0], requiredGait }] },
   [{ id: 'p', node: 'a', cost: 0, state: 'available' }], 'b'), /movement segment/);
 }
 assert.throws(() => routeFrom({ ...graph, edges: [{ ...graph.edges[0], mode: 'walk' }] },
  [{ id: 'p', node: 'a', cost: 0, state: 'available' }], 'b'), /movement segment/);
 const platforms = [
  { id: 'a', vertices: [[-3,0,-2],[2,0,-2],[2,0,2],[-3,0,2]] },
  { id: 'b', vertices: [[5,0,-2],[10,0,-2],[10,0,2],[5,0,2]] },
 ];
 assert.equal(planGroundRoute(platforms, player([-2,0,0]), [9,0,0],
  { ...options, connections: [jump] }).status, 'no-verified-route');
 const locomotion = { speed: 5, sprintSpeed: 7, sprintAcceleration: 60,
  stamina: { capacity: 1, initial: 1, activationCost: 1, recoveryRate: 0, recoveryDelay: 0, reserve: 0 } };
 const paid = planGroundRoute(platforms, [
  { id: 'no-approach', position: [0,0,0], cost: 0, state: 'available' },
  { id: 'approach', position: [-2,0,0], cost: 0, state: 'available' },
 ], [9,0,0], { ...options, speed: 5, connections: [jump], locomotion });
 assert.equal(paid.status, 'complete');
 assert.equal(paid.start, 'approach');
 assert.equal(paid.segments.find(segment => segment.mode === 'jump').requiredGait, 'sprint');
 assert.equal(planGroundRoute(platforms, player([-2,0,0]), [9,0,0], {
  ...options, speed: 5, connections: [jump], locomotion: {
   ...locomotion, stamina: { ...locomotion.stamina, initial: 0 },
  },
 }).status, 'no-verified-route');
});
