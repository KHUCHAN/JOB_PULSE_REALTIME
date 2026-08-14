UPDATE `job_matches`
SET `is_active` = 0,
    `notification_eligible` = 0
WHERE `job_id` IN (
  SELECT `id`
  FROM `jobs`
  WHERE lower(rtrim(trim(`title`), '.')) IN (
    'events 2',
    'i am an employee',
    'sitemap',
    'skip to main content'
  )
);
--> statement-breakpoint
DELETE FROM `notification_items`
WHERE `job_match_id` IN (
  SELECT `job_matches`.`id`
  FROM `job_matches`
  JOIN `jobs` ON `jobs`.`id` = `job_matches`.`job_id`
  WHERE lower(rtrim(trim(`jobs`.`title`), '.')) IN (
    'events 2',
    'i am an employee',
    'sitemap',
    'skip to main content'
  )
)
  AND `notification_id` IN (SELECT `id` FROM `notifications` WHERE `status` <> 'sent');
--> statement-breakpoint
UPDATE `notifications`
SET `job_count` = (
  SELECT count(*) FROM `notification_items` WHERE `notification_id` = `notifications`.`id`
)
WHERE `status` <> 'sent';
--> statement-breakpoint
DELETE FROM `notifications`
WHERE `status` <> 'sent'
  AND NOT EXISTS (
    SELECT 1 FROM `notification_items` WHERE `notification_id` = `notifications`.`id`
  );
--> statement-breakpoint
UPDATE `jobs`
SET `status` = 'closed',
    `closed_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `status` = 'open'
  AND lower(rtrim(trim(`title`), '.')) IN (
    'events 2',
    'i am an employee',
    'sitemap',
    'skip to main content'
  );
