import assert from 'node:assert/strict';
import { test } from 'node:test';

import { supportSnapshot, supportTriangles } from '../src/support-snapshot.js';

test('reuses owned geometric primitives after a content check without retaining caller vertices', () => {
  const surface = {
    id: 'floor',
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
  };
  const snapshot = supportSnapshot(surface),
    triangles = supportTriangles(snapshot);
  assert.equal(supportSnapshot(surface), snapshot);
  assert.equal(supportTriangles(supportSnapshot(surface)), triangles);
  assert.notEqual(snapshot.vertices, surface.vertices);
  assert.notEqual(snapshot.vertices[0], surface.vertices[0]);
  assert.equal(triangles.length, 2);
  surface.vertices[0][0] = -0;
  const signed = supportSnapshot(surface);
  assert.notEqual(signed, snapshot);
  assert.ok(Object.is(signed.vertices[0][0], -0));
  assert.ok(Object.is(snapshot.vertices[0][0], 0));
  surface.vertices[1][1] = Infinity;
  assert.equal(supportSnapshot(surface), null);
  assert.equal(snapshot.vertices[1][1], 0);
});
