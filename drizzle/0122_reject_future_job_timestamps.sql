UPDATE jobs
SET published_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE published_at IS NOT NULL
  AND datetime(published_at) > datetime('now', '+5 minutes');

UPDATE jobs
SET source_updated_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE source_updated_at IS NOT NULL
  AND datetime(source_updated_at) > datetime('now', '+5 minutes');
