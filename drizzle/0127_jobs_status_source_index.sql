-- Bound full source-monitoring inventory counts by scanning open jobs in
-- source order instead of sorting the status/first-seen index by source.
CREATE INDEX IF NOT EXISTS `jobs_status_source_idx` ON `jobs` (`status`,`source_id`);
