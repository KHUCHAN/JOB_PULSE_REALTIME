CREATE TABLE `match_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`keyword_id` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rule_version` text NOT NULL,
	`rules_json` text NOT NULL,
	`min_score` integer DEFAULT 60 NOT NULL,
	`activation_watermark` text,
	`next_digest_at` text,
	`evaluation_lease_owner` text,
	`evaluation_lease_expires_at` text,
	`dispatch_lease_owner` text,
	`dispatch_lease_expires_at` text,
	`gmail_state` text DEFAULT 'unconfigured' NOT NULL,
	`last_digest_at` text,
	`last_error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_profiles_keyword_unique` ON `match_profiles` (`keyword_id`);--> statement-breakpoint
CREATE INDEX `match_profiles_enabled_digest_idx` ON `match_profiles` (`enabled`,`next_digest_at`);--> statement-breakpoint
CREATE TABLE `notification_items` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`job_match_id` text NOT NULL,
	`recipient` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_match_id`) REFERENCES `job_matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_items_match_recipient_unique` ON `notification_items` (`job_match_id`,`recipient`);--> statement-breakpoint
CREATE INDEX `notification_items_notification_idx` ON `notification_items` (`notification_id`);--> statement-breakpoint
CREATE TABLE `profile_recipients` (
	`profile_id` text NOT NULL,
	`recipient` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`profile_id`, `recipient`),
	FOREIGN KEY (`profile_id`) REFERENCES `match_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `job_matches_job_keyword_unique`;--> statement-breakpoint
ALTER TABLE `job_matches` ADD `open_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_matches` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `job_matches` ADD `notification_eligible` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `job_matches_job_keyword_generation_unique` ON `job_matches` (`job_id`,`keyword_id`,`open_generation`);--> statement-breakpoint
CREATE INDEX `job_matches_keyword_active_score_idx` ON `job_matches` (`keyword_id`,`is_active`,`score`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `open_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `next_retry_at` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `lease_expires_at` text;--> statement-breakpoint
CREATE INDEX `notifications_retry_lease_idx` ON `notifications` (`status`,`next_retry_at`,`lease_expires_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `keywords` (
	`id`, `name`, `include_terms`, `exclude_terms`, `locations`, `enabled`, `delivery_mode`
) VALUES (
	'resume-keyword-chanyoung',
	'Chanyoung Resume Match',
	'[]',
	'[]',
	'["United States"]',
	1,
	'immediate'
);--> statement-breakpoint
INSERT OR IGNORE INTO `match_profiles` (
	`id`, `name`, `keyword_id`, `enabled`, `rule_version`, `rules_json`, `min_score`, `gmail_state`
) VALUES (
	'chanyoung-resume',
	'Chanyoung Resume Match',
	'resume-keyword-chanyoung',
	0,
	'resume-v1',
	'{"region":"us","programs":["internship","coop"],"graduation":"2027-12","deliveryMinutes":120}',
	60,
	'unconfigured'
);--> statement-breakpoint
INSERT OR IGNORE INTO `profile_recipients` (`profile_id`, `recipient`, `enabled`) VALUES
	('chanyoung-resume', 'kimchany@usc.edu', 1),
	('chanyoung-resume', 'lupeter@usc.edu', 1);
