CREATE TABLE `expired_job_archive` (
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
CREATE INDEX `expired_job_archive_source_url_idx` ON `expired_job_archive` (`source_id`,`official_url`);--> statement-breakpoint
CREATE INDEX `expired_job_archive_req_idx` ON `expired_job_archive` (`requisition_identity_key`);--> statement-breakpoint
CREATE INDEX `expired_job_archive_ext_idx` ON `expired_job_archive` (`external_identity_key`);--> statement-breakpoint
CREATE INDEX `expired_job_archive_url_idx` ON `expired_job_archive` (`url_identity_key`);