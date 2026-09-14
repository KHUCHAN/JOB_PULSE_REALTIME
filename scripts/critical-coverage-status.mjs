// Historical DB health is not evidence that this owner's collection worked.
export function collectionEvidence(sourceId, recovery) {
  if (!recovery || !Array.isArray(recovery.summaries)
    || recovery.attempted !== recovery.summaries.length) {
    throw new Error('Missing or invalid current-run recovery evidence');
  }
  const rows = recovery.summaries.filter(row => row.sourceId === sourceId);
  if (!rows.length) return { collectionStatus: 'not-attempted', collectionError: 'Critical source absent from this run' };
  const failed = rows.find(row => row.status !== 'succeeded');
  return failed
    ? { collectionStatus: 'failed', collectionError: failed.error ?? 'Collection failed' }
    : { collectionStatus: 'succeeded', collectionError: null };
}
