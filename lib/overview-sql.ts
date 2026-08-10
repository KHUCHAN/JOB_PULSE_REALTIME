export const overviewCountsSql = `
  SELECT
    (SELECT count(*) FROM jobs WHERE status = 'open') AS open_jobs,
    (SELECT count(*) FROM sources WHERE enabled = 1 AND posting_url IS NOT NULL) AS active_sources,
    (SELECT count(*) FROM sources s
      WHERE s.enabled = 1
        AND (SELECT status FROM crawl_runs WHERE source_id=s.id ORDER BY coalesce(finished_at,started_at) DESC LIMIT 1) IN ('blocked','failed')) AS source_errors,
    (SELECT count(*) FROM keywords WHERE enabled = 1) AS unsent_alerts
`;
