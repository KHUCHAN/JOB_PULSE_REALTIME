import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionEvidence } from './critical-coverage-status.mjs';
test('a current failure overrides historical success and duplicate success', () => {
  const result = collectionEvidence('netflix', { attempted: 2, summaries: [
    { sourceId: 'netflix', status: 'succeeded' },
    { sourceId: 'netflix', status: 'failed', error: 'HTTP 429' },
  ] });
  assert.deepEqual(result, { collectionStatus: 'failed', collectionError: 'HTTP 429' });
});
test('missing critical sources are not healthy', () => {
  assert.equal(collectionEvidence('meta', { attempted: 0, summaries: [] }).collectionStatus, 'not-attempted');
  assert.throws(() => collectionEvidence('meta', { attempted: 1, summaries: [] }));
});
test('zero-job successful collection is not a fabricated failure', () => {
  assert.equal(collectionEvidence('meta', { attempted: 1, summaries: [{ sourceId: 'meta', status: 'succeeded', jobs: 0 }] }).collectionStatus, 'succeeded');
});
