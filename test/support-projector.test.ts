import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSupportProjector } from '../src/support-projector.js';
import { projectPoint } from '../src/surfaces.js';

const floor = (id, y) => ({
  id,
  vertices: [
    [-2, y, -2],
    [2, y, -2],
    [2, y, 2],
    [-2, y, 2],
  ],
});

test('cached support projections preserve exact floor selection, tolerances and mutated endpoint coordinates', () => {
  const surfaces = [floor('lower', 0), floor('upper', 2)];
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const project = createSupportProjector(surfaces, byId);
  const position = [0, 0.2, 0];
  for (let repeat = 0; repeat < 2; repeat++)
    for (const y of [0.2, 1, 1.9, 4]) {
      position[1] = y;
      for (const tolerance of [0, 0.3, 2, 5])
        for (const surface of [undefined, 'lower', 'upper']) {
          assert.deepEqual(
            project(position, tolerance, surface),
            projectPoint(surface === undefined ? surfaces : [byId.get(surface)], position, {
              maxVertical: tolerance,
            }),
          );
        }
    }
  for (const x of [0, -0, 0])
    assert.deepEqual(project([x, 0, 0], 0), projectPoint(surfaces, [x, 0, 0], { maxVertical: 0 }));
  for (let index = 0; index < 2100; index++) {
    const point = [index / 10000, 0.2, 0];
    assert.deepEqual(project(point, 0.3), projectPoint(surfaces, point, { maxVertical: 0.3 }));
  }
  assert.deepEqual(
    project([0, 0.2, 0], 0.3),
    projectPoint(surfaces, [0, 0.2, 0], { maxVertical: 0.3 }),
  );
});
