CREATE TABLE `codex_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`job_match_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text NOT NULL,
	`verified_url` text NOT NULL,
	`source_file` text,
	`reviewer` text DEFAULT 'codex' NOT NULL,
	`reviewed_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`job_match_id`) REFERENCES `job_matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `match_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codex_reviews_job_match_unique` ON `codex_reviews` (`job_match_id`);--> statement-breakpoint
CREATE INDEX `codex_reviews_profile_decision_idx` ON `codex_reviews` (`profile_id`,`decision`,`reviewed_at`);--> statement-breakpoint
-- Existing crawler matches were produced before Codex review was introduced.
-- Keep them visible, but require an explicit review before any email dispatch.
UPDATE `job_matches`
SET `notification_eligible` = 0
WHERE `keyword_id` = (SELECT `keyword_id` FROM `match_profiles` WHERE `id` = 'chanyoung-resume');
--> statement-breakpoint
DELETE FROM `notification_items`
WHERE `notification_id` IN (
	SELECT `id` FROM `notifications`
	WHERE `status` <> 'sent'
	  AND `keyword_id` = (SELECT `keyword_id` FROM `match_profiles` WHERE `id` = 'chanyoung-resume')
);
--> statement-breakpoint
DELETE FROM `notifications`
WHERE `status` <> 'sent'
  AND `keyword_id` = (SELECT `keyword_id` FROM `match_profiles` WHERE `id` = 'chanyoung-resume')
  AND NOT EXISTS (SELECT 1 FROM `notification_items` WHERE `notification_id` = `notifications`.`id`);
