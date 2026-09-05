-- Recover the interrupted Sites rollout without rewriting migrations 0140-0142.
-- D1 can finish an index build before a deployment retry observes its result.
CREATE TABLE IF NOT EXISTS `expired_job_archive` (
  `job_id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `official_url` text NOT NULL,
  `requisition_identity_key` text,
  `external_identity_key` text,
  `url_identity_key` text,
  `published_at` text NOT NULL,
  `archived_at` text NOT NULL,
  `audit` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `expired_job_archive_source_url_idx` ON `expired_job_archive` (`source_id`,`official_url`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `expired_job_archive_req_idx` ON `expired_job_archive` (`requisition_identity_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `expired_job_archive_ext_idx` ON `expired_job_archive` (`external_identity_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `expired_job_archive_url_idx` ON `expired_job_archive` (`url_identity_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_retention_published_idx` ON `jobs` (julianday("published_at"),`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_requisition_id_nocase_idx` ON `jobs` ("requisition_id" COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_external_id_nocase_idx` ON `jobs` ("external_id" COLLATE NOCASE);
