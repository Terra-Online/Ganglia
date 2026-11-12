import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareQuality,
  readReference,
  summarizeQuality,
  type QualityRow,
} from '#@/bench/quality.ts';

const row = (id: string, cost: number, partial = false): QualityRow => ({
  id,
  cost,
  partial,
  status: 'complete',
});
test('modeled time distinguishes quality without favoring missing or partial solutions', () => {
  const rows = [row('short', 2), row('long', 20)];
  assert.equal(summarizeQuality(rows).totalCostSeconds, 22);
  const incomplete = summarizeQuality([rows[0], row('long', 0.1, true)]);
  assert.equal(incomplete.totalCostSeconds, null);
  assert.equal(incomplete.completed, 1);
  assert.equal(incomplete.completionRate, 0.5);
  assert.throws(() => summarizeQuality([row('broken', NaN)]), /Invalid modeled route cost/);
});

test('reference comparison pairs by id, weighs queries equally and exposes individual regressions', () => {
  const comparison = compareQuality(
    [row('long', 50), row('short', 2)],
    [row('short', 1), row('long', 100)],
  );
  assert.equal(comparison.geometricMeanCostRatio, 1);
  assert.equal(comparison.worstCostRatio, 2);
  assert.deepEqual(
    comparison.pairs.map((r) => r.deltaSeconds),
    [-50, 1],
  );
  assert.deepEqual(comparison.lostSolutions, []);
  const lost = compareQuality(
    [row('short', 0.1), row('long', 1, true)],
    [row('short', 1), row('long', 100)],
  );
  assert.deepEqual(lost.lostSolutions, ['long']);
  assert.equal(lost.pairedCompleted, 1);
  assert.throws(() => compareQuality([row('other', 1)], [row('short', 1)]), /query ids/);
});

test('zero-time reference routes cannot silently disappear from cost comparisons', () => {
  const equal = compareQuality([row('already-there', 0)], [row('already-there', 0)]);
  assert.equal(equal.geometricMeanCostRatio, 1);
  const slower = compareQuality([row('already-there', 1)], [row('already-there', 0)]);
  assert.equal(slower.geometricMeanCostRatio, null);
  assert.equal(slower.unboundedCostRegressions, 1);
  assert.equal(slower.pairs[0].deltaSeconds, 1);
});

test('references bind the same problem and data while allowing algorithm/config changes and relocated files', () => {
  const binding = {
    scene: 'fixture',
    source: { build: 'game-build' },
    hashes: { '/current/ground.json': 'abc' },
    gameAdapterSha256: 'adapter',
    cases: [{ id: 'one', query: { starts: [], goal: [1, 0, 0] as [number, number, number] } }],
  };
  const reference = {
    ...binding,
    hashes: { '/old/ground.json': 'abc' },
    config: { algorithm: 'other' },
    batch: { results: [row('one', 2)] },
  };
  assert.deepEqual(readReference(reference, binding), [row('one', 2)]);
  assert.throws(
    () => readReference({ ...reference, hashes: { ground: 'changed' } }, binding),
    /do not match/,
  );
  assert.throws(() => readReference({ ...reference, cases: [] }, binding), /do not match/);
  assert.throws(
    () => readReference({ ...reference, batch: { results: [row('different', 2)] } }, binding),
    /result\/query mismatch/,
  );
});
