-- These sources were in exponential failure backoff before the official
-- Dayforce search adapter shipped. Make only the verified boards eligible for
-- the next server-owned crawl; this migration does not start a crawl itself.
UPDATE `sources`
SET `next_crawl_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
  'p2-0117-hanover-insurance',
  'p5-1082-trinetx',
  'legacy-row-787',
  'legacy-row-826',
  'p2-0113-golden-1-credit-union'
);
