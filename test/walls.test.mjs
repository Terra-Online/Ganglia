import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockedByWalls, route} from '../src/index.mjs';
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
