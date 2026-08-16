ALTER TABLE `sources` ADD `alert_baseline_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `requisition_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `external_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `url_identity_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `alert_discovered_after_baseline` integer DEFAULT false NOT NULL;--> statement-breakpoint
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

-- Preserve every successful historical delivery under all identities already
-- known for that posting. This makes the cutover safe immediately, including
-- jobs that were sent under an older open_generation.
INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient,
       'req:' || lower(j.source_id) || ':' || lower(trim(j.requisition_id)),
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE trim(COALESCE(j.requisition_id, '')) <> '';--> statement-breakpoint

INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient,
       'ext:' || lower(j.source_id) || ':' || lower(trim(j.external_id)),
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE trim(COALESCE(j.external_id, '')) <> '';--> statement-breakpoint

INSERT OR IGNORE INTO `notification_identity_history` (
  `profile_id`, `recipient`, `identity_key`, `first_sent_at`, `notification_id`, `job_match_id`
)
SELECT mp.id, ni.recipient, 'url:' || (
         CASE
           WHEN substr(rtrim(lower(replace(
             CASE
               WHEN instr(trim(j.official_url), '#') > 0
                 THEN substr(trim(j.official_url), 1, instr(trim(j.official_url), '#') - 1)
               ELSE trim(j.official_url)
             END,
             'https://search.jobs.barclays/en/job/',
             'https://search.jobs.barclays/job/'
           )), '/'), -6) = '/apply'
             THEN rtrim(substr(rtrim(lower(replace(
               CASE
                 WHEN instr(trim(j.official_url), '#') > 0
                   THEN substr(trim(j.official_url), 1, instr(trim(j.official_url), '#') - 1)
                 ELSE trim(j.official_url)
               END,
               'https://search.jobs.barclays/en/job/',
               'https://search.jobs.barclays/job/'
             )), '/'), 1, length(rtrim(lower(replace(
               CASE
                 WHEN instr(trim(j.official_url), '#') > 0
                   THEN substr(trim(j.official_url), 1, instr(trim(j.official_url), '#') - 1)
                 ELSE trim(j.official_url)
               END,
               'https://search.jobs.barclays/en/job/',
               'https://search.jobs.barclays/job/'
             )), '/')) - 6), '/')
           ELSE rtrim(lower(replace(
             CASE
               WHEN instr(trim(j.official_url), '#') > 0
                 THEN substr(trim(j.official_url), 1, instr(trim(j.official_url), '#') - 1)
               ELSE trim(j.official_url)
             END,
             'https://search.jobs.barclays/en/job/',
             'https://search.jobs.barclays/job/'
           )), '/')
         END
       ),
       COALESCE(n.sent_at, n.scheduled_at, CURRENT_TIMESTAMP), n.id, jm.id
FROM notification_items ni
JOIN notifications n ON n.id = ni.notification_id AND n.status = 'sent'
JOIN job_matches jm ON jm.id = ni.job_match_id
JOIN jobs j ON j.id = jm.job_id
JOIN match_profiles mp ON mp.keyword_id = jm.keyword_id
WHERE trim(COALESCE(j.official_url, '')) <> '';--> statement-breakpoint

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
UPDATE `match_profiles`
SET `activation_watermark` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    `next_digest_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 hours'),
    `dispatch_lease_owner` = NULL,
    `dispatch_lease_expires_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP
WHERE id = 'chanyoung-resume';--> statement-breakpoint
PRAGMA optimize;
