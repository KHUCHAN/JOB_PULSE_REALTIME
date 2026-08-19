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
-- complete catalog. Stop the duplicate source and correct already collected
-- first-party Capital One postings without deleting their history.
UPDATE `sources`
SET `enabled` = 0,
    `next_crawl_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'p2-0098-discover';--> statement-breakpoint

UPDATE `jobs`
SET `company` = 'Capital One',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `source_id` = 'p2-0098-discover'
  AND lower(`official_url`) LIKE 'https://www.capitalonecareers.com/%';--> statement-breakpoint

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

PRAGMA optimize;
