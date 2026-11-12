import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { motionEvidence } from '#@/src/v1/motion/evidence.ts';

test('trace evidence owns its arrays and follows immutable world, surfaces and constraint scopes', () => {
  const world = createCollisionWorld({ positions: [], indices: [] });
  const surfaces: Surface[] = [];
  const evidence = motionEvidence(world, surfaces, 'constraints');
  let computed = 0;
  const source: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
  ];
  const compute = () => {
    computed++;
    return source;
  };
  const first = evidence.trace('walk', compute)!;
  source[0][0] = 10;
  first[1][0] = 20;
  assert.deepEqual(evidence.trace('walk', compute), [
    [0, 0, 0],
    [1, 0, 0],
  ]);
  assert.equal(computed, 1);
  assert.equal(motionEvidence(world, surfaces, 'constraints'), evidence);
  assert.notEqual(motionEvidence(world, [], 'constraints'), evidence);
  assert.notEqual(
    motionEvidence(createCollisionWorld({ positions: [], indices: [] }), surfaces, 'constraints'),
    evidence,
  );
  const changed = motionEvidence(world, surfaces, 'changed walls');
  assert.notEqual(changed, evidence);
  assert.notEqual(motionEvidence(world, surfaces, 'constraints'), evidence);

  // Null proofs also consume capacity. FIFO eviction permits later computation
  // without retaining an unbounded history of traversed coordinates.
  for (let index = 0; index < 4096; index++) evidence.trace(String(index), () => null);
  evidence.trace('walk', compute);
  assert.equal(computed, 2);
});
