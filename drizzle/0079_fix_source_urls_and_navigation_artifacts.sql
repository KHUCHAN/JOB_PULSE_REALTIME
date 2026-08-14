UPDATE `sources`
SET `posting_url` = 'https://www.occ.gov/about/careers/index-careers.html',
    `adapter` = 'custom',
    `checked_at` = '2026-08-14',
    `next_crawl_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'p2-0143-occ';
--> statement-breakpoint
UPDATE `sources`
SET `posting_url` = 'https://careers.unitedhealthgroup.com/search-jobs',
    `adapter` = 'custom',
    `checked_at` = '2026-08-14',
    `next_crawl_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'p2-0064-unitedhealth-group';
--> statement-breakpoint
UPDATE `sources`
SET `posting_url` = 'https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs',
    `adapter` = 'custom',
    `checked_at` = '2026-08-14',
    `next_crawl_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'p4-0209-aci-worldwide';
--> statement-breakpoint
UPDATE `job_matches`
SET `is_active` = 0,
    `notification_eligible` = 0
WHERE `job_id` IN (
  SELECT `id`
  FROM `jobs`
  WHERE (
    `source_id` IN ('p4-0231-bny-mellon', 'p4-0325-oracle')
    AND lower(trim(`title`)) IN ('events 2', 'sitemap', 'i am an employee', 'skip to main content', 'skip to main content.')
  ) OR lower(`official_url`) LIKE '%/hcmui/candidateexperience/sitemaps/%'
     OR lower(`official_url`) LIKE '%/sites/%/events%'
     OR (lower(`official_url`) LIKE '%/fscmui/faces/deeplink%' AND lower(`official_url`) LIKE '%ice_job_search_resp%')
);
--> statement-breakpoint
DELETE FROM `notification_items`
WHERE `job_match_id` IN (
  SELECT `job_matches`.`id`
  FROM `job_matches`
  JOIN `jobs` ON `jobs`.`id` = `job_matches`.`job_id`
  WHERE (
    `jobs`.`source_id` IN ('p4-0231-bny-mellon', 'p4-0325-oracle')
    AND lower(trim(`jobs`.`title`)) IN ('events 2', 'sitemap', 'i am an employee', 'skip to main content', 'skip to main content.')
  ) OR lower(`jobs`.`official_url`) LIKE '%/hcmui/candidateexperience/sitemaps/%'
     OR lower(`jobs`.`official_url`) LIKE '%/sites/%/events%'
     OR (lower(`jobs`.`official_url`) LIKE '%/fscmui/faces/deeplink%' AND lower(`jobs`.`official_url`) LIKE '%ice_job_search_resp%')
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
  AND ((
    `source_id` IN ('p4-0231-bny-mellon', 'p4-0325-oracle')
    AND lower(trim(`title`)) IN ('events 2', 'sitemap', 'i am an employee', 'skip to main content', 'skip to main content.')
  ) OR lower(`official_url`) LIKE '%/hcmui/candidateexperience/sitemaps/%'
     OR lower(`official_url`) LIKE '%/sites/%/events%'
     OR (lower(`official_url`) LIKE '%/fscmui/faces/deeplink%' AND lower(`official_url`) LIKE '%ice_job_search_resp%'));
