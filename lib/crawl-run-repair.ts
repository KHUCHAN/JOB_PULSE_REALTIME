export type StaleCrawlRunRepairResult = {
  cutoff: string;
  finalized: number;
  releasedSources: number;
  runIds: string[];
};

type StaleRunRow = {
  id: string;
  source_id: string;
};

export const finalizeStaleCrawlRuns = async (
  database: D1Database,
  now: string,
  maximumAgeSeconds = 60,
): Promise<StaleCrawlRunRepairResult> => {
  const boundedAgeSeconds = Math.max(60, Math.min(3_600, Math.trunc(maximumAgeSeconds)));
  const cutoff = new Date(Date.parse(now) - boundedAgeSeconds * 1_000).toISOString();
  const stale = await database.prepare(`
    SELECT id, source_id
    FROM crawl_runs
    WHERE status = 'running' AND started_at IS NOT NULL AND started_at <= ?
    ORDER BY started_at
    LIMIT 500
  `).bind(cutoff).all<StaleRunRow>();
  if (stale.results.length === 0) {
    return { cutoff, finalized: 0, releasedSources: 0, runIds: [] };
  }

  const ids = stale.results.map(({ id }) => id);
  const finalized = await database.prepare(`
    UPDATE crawl_runs
    SET status = 'failed',
        error = COALESCE(error, 'Timed out after the crawler client disconnected.'),
        finished_at = ?
    WHERE status = 'running' AND id IN (SELECT value FROM json_each(?))
    RETURNING id, source_id
  `).bind(now, JSON.stringify(ids)).all<StaleRunRow>();
  const sourceIds = [...new Set(finalized.results.map(({ source_id: sourceId }) => sourceId))];
  if (sourceIds.length > 0) {
    await database.prepare(`
      UPDATE sources
      SET next_crawl_at = CASE
            WHEN next_crawl_at IS NULL OR next_crawl_at > ? THEN ?
            ELSE next_crawl_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (SELECT value FROM json_each(?))
    `).bind(now, now, JSON.stringify(sourceIds)).run();
  }
  return {
    cutoff,
    finalized: finalized.results.length,
    releasedSources: sourceIds.length,
    runIds: finalized.results.map(({ id }) => id),
  };
};
