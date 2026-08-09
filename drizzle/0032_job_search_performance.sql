CREATE INDEX `jobs_status_url_seen_company_id_idx` ON `jobs` (`status`,`official_url`,`first_seen_at`,`company`,`id`);--> statement-breakpoint
PRAGMA optimize;
