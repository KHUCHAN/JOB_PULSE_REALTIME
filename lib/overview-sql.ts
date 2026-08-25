export const overviewCountsSql = `
  SELECT
    (SELECT count(*) FROM jobs WHERE status = 'open') AS open_jobs,
    (SELECT count(*) FROM sources WHERE enabled = 1 AND posting_url IS NOT NULL) AS active_sources,
    (SELECT count(*) FROM sources s
      WHERE s.enabled = 1
        AND (SELECT status FROM crawl_runs
          WHERE source_id = s.id
          ORDER BY scheduled_for DESC, id DESC
          LIMIT 1) IN ('blocked','failed')) AS source_errors,
    (SELECT count(*) FROM keywords WHERE enabled = 1) AS unsent_alerts
`;

export const overviewActivitySql = `
  SELECT cr.id, s.company, cr.status, cr.started_at, cr.finished_at,
         cr.jobs_seen, cr.jobs_created, cr.jobs_updated, cr.jobs_closed, cr.error
  FROM crawl_runs cr JOIN sources s ON s.id = cr.source_id
  WHERE cr.status <> 'running'
  ORDER BY cr.rowid DESC
  LIMIT ?
`;
