CREATE TABLE `crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`status` text NOT NULL,
	`response_status` integer,
	`jobs_seen` integer DEFAULT 0 NOT NULL,
	`jobs_created` integer DEFAULT 0 NOT NULL,
	`jobs_updated` integer DEFAULT 0 NOT NULL,
	`jobs_closed` integer DEFAULT 0 NOT NULL,
	`content_hash` text,
	`error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_source_scheduled_idx` ON `crawl_runs` (`source_id`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `crawl_runs_status_scheduled_idx` ON `crawl_runs` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`keyword_id` text NOT NULL,
	`score` integer NOT NULL,
	`matched_terms` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`notified_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_matches_job_keyword_unique` ON `job_matches` (`job_id`,`keyword_id`);--> statement-breakpoint
CREATE INDEX `job_matches_keyword_created_idx` ON `job_matches` (`keyword_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`location` text,
	`arrangement` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text,
	`summary` text,
	`description_hash` text,
	`official_url` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`published_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_url_unique` ON `jobs` (`source_id`,`official_url`);--> statement-breakpoint
CREATE INDEX `jobs_status_first_seen_idx` ON `jobs` (`status`,`first_seen_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`include_terms` text NOT NULL,
	`exclude_terms` text NOT NULL,
	`locations` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`delivery_mode` text DEFAULT 'six_hour' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text NOT NULL,
	`job_count` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`scheduled_at` text NOT NULL,
	`sent_at` text,
	`error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_status_scheduled_idx` ON `notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `registration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`talent_target_id` text NOT NULL,
	`status` text NOT NULL,
	`opened_at` text NOT NULL,
	`completed_at` text,
	`notes` text,
	FOREIGN KEY (`talent_target_id`) REFERENCES `talent_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `registration_runs_target_opened_idx` ON `registration_runs` (`talent_target_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`master_row` integer NOT NULL,
	`company` text NOT NULL,
	`posting_url` text,
	`talent_url` text,
	`channel` text NOT NULL,
	`adapter` text NOT NULL,
	`verification` text NOT NULL,
	`confidence` text NOT NULL,
	`resume_upload` text NOT NULL,
	`job_alerts` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`checked_at` text NOT NULL,
	`last_crawled_at` text,
	`next_crawl_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_master_row_unique` ON `sources` (`master_row`);--> statement-breakpoint
CREATE INDEX `sources_enabled_next_crawl_idx` ON `sources` (`enabled`,`next_crawl_at`);--> statement-breakpoint
CREATE INDEX `sources_company_idx` ON `sources` (`company`);--> statement-breakpoint
CREATE TABLE `talent_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`official_url` text NOT NULL,
	`resume_upload` text NOT NULL,
	`job_alerts` text NOT NULL,
	`registration_state` text DEFAULT 'not_started' NOT NULL,
	`checked_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `talent_targets_source_unique` ON `talent_targets` (`source_id`);