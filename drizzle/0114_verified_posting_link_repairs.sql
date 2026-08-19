-- American Express' branded Oracle reverse proxy returns an HTTP-200 error
-- page for the generic CandidateExperience path. Move every persisted link to
-- the verified public vanity route and keep its durable alert identity aligned.
UPDATE `jobs`
SET `official_url` = replace(
      `official_url`,
      'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/',
      'https://careers.americanexpress.com/en/sites/'
    ),
    `apply_url` = CASE
      WHEN `apply_url` LIKE 'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/%'
      THEN replace(
        `apply_url`,
        'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/',
        'https://careers.americanexpress.com/en/sites/'
      )
      ELSE `apply_url`
    END,
    `url_identity_key` = 'url:' || lower(rtrim(replace(
      `official_url`,
      'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/',
      'https://careers.americanexpress.com/en/sites/'
    ), '/')),
    `updated_at` = CURRENT_TIMESTAMP
WHERE `source_id` = 'p2-0024-american-express'
  AND `official_url` LIKE 'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/%';--> statement-breakpoint

-- Discover's source was redirected after the acquisition to Capital One's
-- complete catalog. Stop the duplicate source and close its duplicate rows;
-- the dedicated Capital One source remains authoritative and open.
UPDATE `sources`
SET `enabled` = 0,
    `next_crawl_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'p2-0098-discover';--> statement-breakpoint

UPDATE `jobs`
SET `company` = 'Capital One',
    `status` = 'closed',
    `closed_at` = COALESCE(`closed_at`, CURRENT_TIMESTAMP),
    `updated_at` = CURRENT_TIMESTAMP
WHERE `source_id` = 'p2-0098-discover'
  AND lower(`official_url`) LIKE 'https://www.capitalonecareers.com/%';--> statement-breakpoint

UPDATE `job_matches`
SET `is_active` = 0
WHERE `job_id` IN (
  SELECT `id`
  FROM `jobs`
  WHERE `source_id` = 'p2-0098-discover'
);--> statement-breakpoint

-- These two NOMAD requisitions no longer appear in Sandia's authoritative
-- catalog, and their old PeopleSoft deep links now resolve to the login-error
-- page. Close only the verified stale identities.
UPDATE `jobs`
SET `status` = 'closed',
    `closed_at` = COALESCE(`closed_at`, CURRENT_TIMESTAMP),
    `updated_at` = CURRENT_TIMESTAMP
WHERE `source_id` = 'p5-1051-sandia-national-labs'
  AND (
    `external_id` IN ('698616', '698617')
    OR `requisition_id` IN ('698616', '698617')
    OR `official_url` LIKE '%JobOpeningId=698616%'
    OR `official_url` LIKE '%JobOpeningId=698617%'
  );--> statement-breakpoint

-- Databricks reuses a long-lived Greenhouse requisition for successive intern
-- cohorts. Its 2027 content was updated on 2026-08-18, but the authoritative
-- Greenhouse first_published value remains 2023-08-17. Keep "recent posting"
-- filters anchored to the original publication instead of the content update.
UPDATE `jobs`
SET `published_at` = '2023-08-17T21:27:27.000Z',
    `source_updated_at` = '2026-08-18T17:17:06.000Z',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `source_id` = 'p4-0256-databricks'
  AND `external_id` = '6883068002'
  AND `official_url` LIKE 'https://databricks.com/%';--> statement-breakpoint

PRAGMA optimize;
