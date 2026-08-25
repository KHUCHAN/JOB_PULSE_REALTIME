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

// The dashboard only needs a small recency sample, not the full canonical
// search/count plan used by the jobs explorer. Keep this on the composite
// status/published_at index so it remains responsive while crawl writes are
// active. The explorer still performs full duplicate suppression.
export const overviewLatestJobsSql = `
  SELECT j.id, j.source_id, j.company, j.title, j.location, j.arrangement,
         substr(coalesce(j.summary, j.description), 1, 1200) AS summary,
         j.official_url, j.first_seen_at, j.last_seen_at, j.review_state,
         j.employment_type, j.published_at, j.location_region,
         '[]' AS area_keys,
         NULL AS resume_match_score,
         NULL AS resume_match_evidence
  FROM jobs j INDEXED BY jobs_status_published_at_idx
  WHERE j.status = 'open'
    AND j.published_at IS NOT NULL
    AND j.published_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes')
    AND (j.valid_through IS NULL OR j.valid_through >= date('now'))
  ORDER BY j.published_at DESC
  LIMIT ?
`;
