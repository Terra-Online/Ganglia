import assert from 'node:assert/strict';
import { test } from 'node:test';

import { refineGoalGround } from '@opendfieldmap/ganglia/solver';

import { buildGroundSurfaces } from '#@/src/build.ts';
import { createCollisionWorld } from '#@/src/collision.ts';
import { createGoalProjector, type Surface, type Vec3 } from '#@/src/index.ts';

const floor = (id: string, left: number, right: number, height: number): Surface => ({
  id,
  vertices: [
    [left, height, -2],
    [left, height, 2],
    [right, height, 2],
    [right, height, -2],
  ],
});
const options = {
  profile: { radius: 0.35, height: 1.66 },
  maxSlope: 46,
  stepUp: 0.4,
  stepDown: 0.6,
  cellSize: 0.15,
  cellHeight: 0.05,
  bounds: { min: [-5, -3] as [number, number], max: [3, 3] as [number, number] },
};
const model = {
  gravity: 40,
  fallingGravity: 38,
  maxJumpHeight: 2.1,
  maxFallingSpeed: 80,
  apexTime: 0.1,
  maxHorizontalSpeed: 6.5,
};

test('recovers a body-width landing omitted by coarse erosion while preserving low headroom', async () => {
  for (const ceiling of [false, true]) {
    const faces = [floor('ground', -4, -1, 0), floor('narrow', 0, 0.8, 1.5)];
    if (ceiling) {
      faces.push({
        ...floor('ceiling', -0.5, 1.4, 2.8),
        vertices: floor('ceiling', -0.5, 1.4, 2.8).vertices.toReversed(),
      });
    }
    const triangles = faces.flatMap((surface) => [
      [surface.vertices[0], surface.vertices[1], surface.vertices[2]],
      [surface.vertices[0], surface.vertices[2], surface.vertices[3]],
    ]);
    const positions = triangles.flat(2);
    const geometry = {
      positions,
      indices: Array.from({ length: positions.length / 3 }, (_, index) => index),
    };
    const coarse = await buildGroundSurfaces(geometry, options);
    const before = structuredClone(coarse);
    const goal: Vec3 = [0.4, 1.5, 0];
    assert.equal(createGoalProjector(coarse)(goal, { maxVertical: 0.15 }).length, 0);
    const refined = await refineGoalGround(geometry, coarse, {
      build: options,
      goal,
      model,
    });
    const world = createCollisionWorld(geometry, { bounds: options.bounds });
    const indexed = await refineGoalGround(geometry, coarse, {
      build: options,
      goal,
      model,
      queryTriangles: world.trianglesInBounds?.bind(world),
    });
    assert.deepEqual(indexed, refined);
    const accessible = createGoalProjector([...coarse, ...refined.surfaces])(goal, {
      maxVertical: 0.15,
    });
    assert.equal(accessible.length > 0, !ceiling);
    assert.deepEqual(coarse, before);
  }
});
