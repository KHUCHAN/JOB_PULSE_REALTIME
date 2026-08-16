export interface CatalogSourceSeed {
  id: string;
  masterRow: number;
  company: string;
  postingUrl: string | null;
  talentUrl: string | null;
  channel: string;
  adapter: string;
  verification: string;
  confidence: string;
  resumeUpload: string;
  jobAlerts: string;
  checkedAt: string;
  enabled: boolean;
}

export interface CatalogTalentSeed {
  id: string;
  sourceId: string;
  officialUrl: string;
  resumeUpload: string;
  jobAlerts: string;
  checkedAt: string;
}

export interface CatalogSeed {
  generatedAt: string | null;
  version: string;
  sources: CatalogSourceSeed[];
  talentTargets: CatalogTalentSeed[];
}

interface CatalogStatement {
  bind(...values: unknown[]): { run(): Promise<unknown>; first(): Promise<unknown> };
  first(): Promise<unknown>;
}

interface CatalogDb {
  prepare(sql: string): CatalogStatement;
}

export interface CatalogCrawlPolicy {
  version: string;
  sourceIds: readonly string[];
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

export async function ensureCatalogSeeded(
  database: CatalogDb,
  seed: CatalogSeed,
  crawlPolicy?: CatalogCrawlPolicy,
): Promise<{ seeded: boolean; sources: number; talentTargets: number }> {
  const existing = await database.prepare(`
    SELECT
      (SELECT count(*) FROM sources) AS count,
      (SELECT value FROM catalog_state WHERE key = 'sources') AS version,
      (SELECT value FROM catalog_state WHERE key = 'crawler_scope_policy') AS crawl_policy_version
  `).first() as { count: number; version: string | null; crawl_policy_version: string | null } | null;
  const seedIsCurrent = existing?.version === seed.version;

  for (const batch of seedIsCurrent ? [] : chunks(seed.sources, 500)) {
    // A persisted page cursor belongs to one exact listing URL and adapter.
    // Drop it before changing either value so the new catalog always starts at
    // page one. Deleting first is deliberately fail-safe: if the following
    // upsert is interrupted, the old feed is merely re-read from its start.
    await database.prepare(`
      DELETE FROM catalog_state
      WHERE key IN (
        SELECT 'crawl_page_checkpoint:' || json_extract(incoming.value, '$.id')
        FROM json_each(?) AS incoming
        JOIN sources ON sources.id = json_extract(incoming.value, '$.id')
        WHERE sources.posting_url IS NOT json_extract(incoming.value, '$.postingUrl')
           OR sources.adapter IS NOT json_extract(incoming.value, '$.adapter')
      )
    `).bind(JSON.stringify(batch)).run();
    await database.prepare(`
      INSERT INTO sources (
        id, master_row, company, posting_url, talent_url, channel, adapter,
        verification, confidence, resume_upload, job_alerts, enabled, checked_at
      )
      SELECT
        json_extract(value, '$.id'), json_extract(value, '$.masterRow'),
        json_extract(value, '$.company'), json_extract(value, '$.postingUrl'),
        json_extract(value, '$.talentUrl'), json_extract(value, '$.channel'),
        json_extract(value, '$.adapter'), json_extract(value, '$.verification'),
        json_extract(value, '$.confidence'), json_extract(value, '$.resumeUpload'),
        json_extract(value, '$.jobAlerts'), json_extract(value, '$.enabled'),
        json_extract(value, '$.checkedAt')
      FROM json_each(?)
      WHERE true
      ON CONFLICT(id) DO UPDATE SET
        master_row=excluded.master_row, company=excluded.company,
        next_crawl_at=CASE
          WHEN sources.posting_url IS NOT excluded.posting_url OR sources.adapter IS NOT excluded.adapter
          THEN CURRENT_TIMESTAMP
          ELSE sources.next_crawl_at
        END,
        posting_url=excluded.posting_url, talent_url=excluded.talent_url,
        channel=excluded.channel, adapter=excluded.adapter,
        verification=excluded.verification, confidence=excluded.confidence,
        resume_upload=excluded.resume_upload, job_alerts=excluded.job_alerts,
        enabled=excluded.enabled, checked_at=excluded.checked_at,
        updated_at=CURRENT_TIMESTAMP
    `).bind(JSON.stringify(batch)).run();
  }

  for (const batch of seedIsCurrent ? [] : chunks(seed.talentTargets, 500)) {
    await database.prepare(`
      INSERT INTO talent_targets (
        id, source_id, official_url, resume_upload, job_alerts, checked_at
      )
      SELECT
        json_extract(value, '$.id'), json_extract(value, '$.sourceId'),
        json_extract(value, '$.officialUrl'), json_extract(value, '$.resumeUpload'),
        json_extract(value, '$.jobAlerts'), json_extract(value, '$.checkedAt')
      FROM json_each(?)
      WHERE true
      ON CONFLICT(id) DO UPDATE SET
        source_id=excluded.source_id, official_url=excluded.official_url,
        resume_upload=excluded.resume_upload, job_alerts=excluded.job_alerts,
        checked_at=excluded.checked_at, updated_at=CURRENT_TIMESTAMP
    `).bind(JSON.stringify(batch)).run();
  }

  if (!seedIsCurrent) {
    await database.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
    `).bind("sources", seed.version).run();
  }

  if (crawlPolicy && existing?.crawl_policy_version !== crawlPolicy.version) {
    for (const batch of chunks([...new Set(crawlPolicy.sourceIds)], 400)) {
      // A policy change is a listing-identity change even when the public URL
      // stays the same. Restart each affected catalog at page one so a global
      // cursor can never skip the beginning of its new US-scoped cycle.
      await database.prepare(`
        DELETE FROM catalog_state
        WHERE key IN (
          SELECT 'crawl_page_checkpoint:' || value FROM json_each(?)
        )
      `).bind(JSON.stringify(batch)).run();
      await database.prepare(`
        UPDATE sources
        SET next_crawl_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT value FROM json_each(?))
      `).bind(JSON.stringify(batch)).run();
      // Scope-policy changes are authoritative catalog changes, not ordinary
      // incomplete crawl segments. Jobs that an older global policy admitted
      // cannot be rediscovered by the new US-only policy, so close only rows
      // already classified as positively non-US. Unknown and mixed rows stay
      // open, which keeps ambiguous US opportunities fail-safe.
      await database.prepare(`
        UPDATE jobs
        SET status = 'closed',
            closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE source_id IN (SELECT value FROM json_each(?))
          AND status = 'open'
          AND location_region = 'non_us'
      `).bind(JSON.stringify(batch)).run();
    }
    // Publish the marker last. If a request is interrupted above, the next
    // request sees the old version and retries the idempotent reset.
    await database.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
    `).bind("crawler_scope_policy", crawlPolicy.version).run();
  }

  return seedIsCurrent
    ? { seeded: false, sources: existing?.count ?? 0, talentTargets: 0 }
    : { seeded: true, sources: seed.sources.length, talentTargets: seed.talentTargets.length };
}
