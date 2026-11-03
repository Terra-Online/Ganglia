import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingCandidates } from '../src/landings.mjs';
import { jumpConnection } from '../src/jumps.mjs';
import { createCollisionWorld } from '../src/collision.mjs';

test('finds feasible landing interiors when nearest, goal and centre witnesses fail', () => {
  const surface = { id: 'landing', vertices: [[5, 0, 0], [12, 0, -4], [12, 0, 4]] };
  const triangles = [
    [[-2, 4, -2], [.5, 4, 2], [.5, 4, -2]],
    [[-2, 4, -2], [-2, 4, 2], [.5, 4, 2]],
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
  ];
  const world = createCollisionWorld({ positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index) });
  const model = { gravity: 10, fallingGravity: 10, maxJumpHeight: 2,
    maxFallingSpeed: 20, apexTime: .1, maxHorizontalSpeed: 4 };
  const profile = { radius: .25, height: 1.7 }, start = [0, 4.005, 0];
  const walls = [{ min: [4.5, -.1, -.6], max: [5.5, 2, .6], state: 'unknown' }];
  const candidates = [...landingCandidates(surface, start, [12, 0, 0], model, profile.radius)];
  const arcs = candidates.map(({ position }) => jumpConnection(start,
    [position[0], position[1] + .005, position[2]], { ...model, mode: 'jump',
      profile, walls, sweep: world.sweepCapsule }));
  assert.ok(arcs.slice(0, 3).every(arc => arc === null));
  assert.ok(arcs.slice(3).some(arc => arc !== null));
});
