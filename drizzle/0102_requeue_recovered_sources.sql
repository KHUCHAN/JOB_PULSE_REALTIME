-- These sources were still in failure backoff when their verified official
-- endpoints and crawler strategies were deployed. Make them eligible for the
-- next server-owned batch without triggering a second crawl from deployment.
UPDATE `sources`
SET `next_crawl_at` = CURRENT_TIMESTAMP,
    `updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
  'p2-0076-ameriprise-financial',
  'audit-row-536',
  'p2-0103-fbi',
  'p4-0268-fbi-los-angeles-field-office',
  'p5-0722-saic',
  'p5-0728-siemens-healthineers',
  'p5-1039-revolut'
);
