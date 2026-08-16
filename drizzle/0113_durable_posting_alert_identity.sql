ALTER TABLE `sources` ADD `alert_baseline_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `requisition_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `external_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `url_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `alert_discovered_after_baseline` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `jobs_requisition_identity_idx` ON `jobs` (`requisition_identity_key`);--> statement-breakpoint
CREATE INDEX `jobs_external_identity_idx` ON `jobs` (`external_identity_key`);--> statement-breakpoint
CREATE INDEX `jobs_url_identity_idx` ON `jobs` (`url_identity_key`);--> statement-breakpoint
CREATE TABLE `notification_identity_history` (
	`profile_id` text NOT NULL,
	`recipient` text NOT NULL,
	`identity_key` text NOT NULL,
	`first_sent_at` text NOT NULL,
	`notification_id` text,
	`job_match_id` text,
	PRIMARY KEY(`profile_id`, `recipient`, `identity_key`)
);--> statement-breakpoint

-- Every source and job already present at deployment is the new alert
-- baseline. Only a later insert from a completed source catalog can enter the
-- Codex review/email path.
UPDATE `sources`
SET `alert_baseline_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `alert_baseline_at` IS NULL;--> statement-breakpoint

UPDATE `jobs`
SET `requisition_identity_key` = CASE
      WHEN trim(COALESCE(`requisition_id`, '')) <> ''
        THEN 'req:' || lower(`source_id`) || ':' || lower(trim(`requisition_id`))
      ELSE NULL
    END,
    `external_identity_key` = CASE
      WHEN trim(COALESCE(`external_id`, '')) <> ''
        THEN 'ext:' || lower(`source_id`) || ':' || lower(trim(`external_id`))
      ELSE NULL
    END;--> statement-breakpoint

WITH stripped AS (
  SELECT id,
         lower(replace(
           CASE
             WHEN instr(trim(`official_url`), '#') > 0
               THEN substr(trim(`official_url`), 1, instr(trim(`official_url`), '#') - 1)
             ELSE trim(`official_url`)
           END,
           'https://search.jobs.barclays/en/job/',
           'https://search.jobs.barclays/job/'
         )) AS normalized_url
  FROM `jobs`
), trimmed AS (
  SELECT id, rtrim(normalized_url, '/') AS normalized_url
  FROM stripped
), canonical AS (
  SELECT id,
         CASE
           WHEN substr(normalized_url, -6) = '/apply'
             THEN rtrim(substr(normalized_url, 1, length(normalized_url) - 6), '/')
           ELSE normalized_url
         END AS normalized_url
  FROM trimmed
)
UPDATE `jobs`
SET `url_identity_key` = 'url:' || (
  SELECT canonical.normalized_url FROM canonical WHERE canonical.id = jobs.id
);--> statement-breakpoint

-- Preserve every successful historical delivery under all identities already
-- known for that posting. This makes the cutover safe immediately, including
-- jobs that were sent under an older open_generation.
INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient, j.requisition_identity_key,
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE j.requisition_identity_key IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient, j.external_identity_key,
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE j.external_identity_key IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient, j.url_identity_key,
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE j.url_identity_key IS NOT NULL;--> statement-breakpoint

-- Drop only unsent rollout/backfill envelopes. Sent records and their durable
-- identity history remain intact; new rows discovered after this migration are
-- the next eligible alert candidates.
DELETE FROM `notification_items`
WHERE notification_id IN (
  SELECT id FROM notifications
  WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = 'chanyoung-resume')
    AND status <> 'sent'
);--> statement-breakpoint
DELETE FROM `notifications`
WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = 'chanyoung-resume')
  AND status <> 'sent';--> statement-breakpoint
UPDATE `job_matches`
SET `notification_eligible` = 0
WHERE keyword_id = (SELECT keyword_id FROM match_profiles WHERE id = 'chanyoung-resume')
  AND notified_at IS NULL;--> statement-breakpoint
UPDATE `match_profiles`
SET `activation_watermark` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    `next_digest_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours'),
    `dispatch_lease_owner` = NULL,
    `dispatch_lease_expires_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP
WHERE id = 'chanyoung-resume';--> statement-breakpoint
PRAGMA optimize;
