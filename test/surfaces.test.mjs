import {test} from 'node:test';
import assert from 'node:assert/strict';
import {surfaceGraph,projectPoint,route} from '../src/index.mjs';
test('joins a shared 3D edge but never an overlapping upper floor',()=>{
 const a={id:'a',vertices:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]};
 const b={id:'b',vertices:[[1,0,0],[2,0,0],[2,0,1],[1,0,1]]};
 const upper={id:'upper',vertices:a.vertices.map(([x,y,z])=>[x,y+5,z])};
 const graph=surfaceGraph([a,b,upper], {speed: 1});
 assert.equal(route(graph,'a','b').status,'complete');
 assert.equal(route(graph,'a','upper').status,'no-verified-route');
 assert.deepEqual(route(graph,'a','b').points[1],[1,0,0.5]);
});

test('projects on the correct stacked floor and refuses points over a gap',()=>{
 const surfaces=[{id:'lower',vertices:[[0,0,0],[2,0,0],[2,0,2],[0,0,2]]},
 {id:'upper',vertices:[[0,5,0],[2,5,0],[2,5,2],[0,5,2]]}];
 assert.equal(projectPoint(surfaces,[1,5.2,1],{maxVertical:0.5}).surface,'upper');
 assert.equal(projectPoint(surfaces,[1,2,1],{maxVertical:0.5}),null);
 assert.equal(projectPoint(surfaces,[3,0,1],{maxVertical:0.5}),null);
});

test('coincident geometry does not override an authored closed polygon boundary',()=>{
 const a={id:'a',vertices:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],portals:[]};
 const b={id:'b',vertices:[[1,0,0],[2,0,0],[2,0,1],[1,0,1]],portals:[3]};
 assert.equal(route(surfaceGraph([a,b],{speed:1}),'a','b').status,'no-verified-route');
 assert.equal(route(surfaceGraph([{...a,portals:[1]},b],{speed:1}),'a','b').status,'complete');
});
