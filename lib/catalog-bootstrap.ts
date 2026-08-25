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

type CatalogSeedResult = { seeded: boolean; sources: number; talentTargets: number };

type CatalogStatus = {
  count: number;
  version: string | null;
  crawl_policy_version: string | null;
  lock_owner: string | null;
};

export interface CatalogCrawlPolicy {
  version: string;
  sourceIds: readonly string[];
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

const CATALOG_SYNC_LOCK_KEY = "sources_sync_lock_v1";
const catalogSyncs = new WeakMap<object, Promise<CatalogSeedResult>>();
const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const catalogStatus = async (database: CatalogDb): Promise<CatalogStatus> => (
  await database.prepare(`
    SELECT
      (SELECT count(*) FROM sources) AS count,
      (SELECT value FROM catalog_state WHERE key = 'sources') AS version,
      (SELECT value FROM catalog_state WHERE key = 'crawler_scope_policy') AS crawl_policy_version,
      (SELECT value FROM catalog_state WHERE key = '${CATALOG_SYNC_LOCK_KEY}') AS lock_owner
  `).first() as CatalogStatus | null
) ?? { count: 0, version: null, crawl_policy_version: null, lock_owner: null };

async function ensureCatalogSeededOnce(
  database: CatalogDb,
  seed: CatalogSeed,
  crawlPolicy?: CatalogCrawlPolicy,
): Promise<CatalogSeedResult> {
  let existing = await catalogStatus(database);
  const alreadyCurrent = (): boolean => existing.version === seed.version
    && (!crawlPolicy || existing.crawl_policy_version === crawlPolicy.version);
  if (alreadyCurrent()) return { seeded: false, sources: existing.count, talentTargets: 0 };

  // A Sites deployment can receive several public reads and crawler POSTs at
  // the same instant. Without a database-visible lock, every isolate sees the
  // old catalog marker and rewrites the full 1,400+ source seed concurrently,
  // which can overload D1 before any request publishes the new marker.
  const lockOwner = crypto.randomUUID();
  const lockDeadline = Date.now() + 45_000;
  while (true) {
    await database.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=CURRENT_TIMESTAMP
      WHERE datetime(catalog_state.updated_at) < datetime('now', '-2 minutes')
    `).bind(CATALOG_SYNC_LOCK_KEY, lockOwner).run();
    existing = await catalogStatus(database);
    if (alreadyCurrent()) return { seeded: false, sources: existing.count, talentTargets: 0 };
    if (existing.lock_owner === lockOwner) break;
    if (Date.now() >= lockDeadline) throw new Error("Catalog synchronization is still in progress.");
    await delay(500);
  }

  const seedIsCurrent = existing.version === seed.version;
  try {

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
          WHEN excluded.enabled = 0 THEN NULL
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
    // The bundled catalog is authoritative for retirement state. A source
    // that becomes inactive must not retain a runnable schedule, stale page
    // cursor, open jobs, active matches, or a removed Talent target. Doing
    // this in runtime synchronization is required on Sites, where the large
    // catalog migrations are intentionally replaced by bounded seed sync.
    await database.prepare(`
      DELETE FROM catalog_state
      WHERE key IN (
        SELECT 'crawl_page_checkpoint:' || json_extract(value, '$.id')
        FROM json_each(?)
        WHERE json_extract(value, '$.enabled') = 0
      )
    `).bind(JSON.stringify(batch)).run();
    await database.prepare(`
      DELETE FROM talent_targets
      WHERE source_id IN (
        SELECT json_extract(value, '$.id')
        FROM json_each(?)
        WHERE json_extract(value, '$.talentUrl') IS NULL
      )
    `).bind(JSON.stringify(batch)).run();
    await database.prepare(`
      UPDATE jobs
      SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE status = 'open' AND source_id IN (
        SELECT json_extract(value, '$.id')
        FROM json_each(?)
        WHERE json_extract(value, '$.enabled') = 0
      )
    `).bind(JSON.stringify(batch)).run();
    await database.prepare(`
      UPDATE job_matches
      SET is_active = 0
      WHERE is_active = 1 AND job_id IN (
        SELECT jobs.id
        FROM jobs
        WHERE jobs.source_id IN (
          SELECT json_extract(value, '$.id')
          FROM json_each(?)
          WHERE json_extract(value, '$.enabled') = 0
        )
      )
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
    // Sites replaces the large catalog migrations with this bounded runtime
    // sync. Apply one-time data-quality cleanup before publishing the new
    // marker so an interrupted request safely retries it.
    await database.prepare(`
      UPDATE jobs
      SET published_at = CASE
            WHEN published_at IS NOT NULL
             AND datetime(published_at) > datetime('now', '+5 minutes')
            THEN NULL ELSE published_at END,
          source_updated_at = CASE
            WHEN source_updated_at IS NOT NULL
             AND datetime(source_updated_at) > datetime('now', '+5 minutes')
            THEN NULL ELSE source_updated_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE (published_at IS NOT NULL AND datetime(published_at) > datetime('now', '+5 minutes'))
         OR (source_updated_at IS NOT NULL AND datetime(source_updated_at) > datetime('now', '+5 minutes'))
    `).bind().run();
    await database.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
    `).bind("sources", seed.version).run();
  }

  if (crawlPolicy && existing.crawl_policy_version !== crawlPolicy.version) {
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
      ? { seeded: false, sources: existing.count, talentTargets: 0 }
      : { seeded: true, sources: seed.sources.length, talentTargets: seed.talentTargets.length };
  } finally {
    await database.prepare(`
      DELETE FROM catalog_state WHERE key = ? AND value = ?
    `).bind(CATALOG_SYNC_LOCK_KEY, lockOwner).run();
  }
}

export function ensureCatalogSeeded(
  database: CatalogDb,
  seed: CatalogSeed,
  crawlPolicy?: CatalogCrawlPolicy,
): Promise<CatalogSeedResult> {
  const key = database as object;
  const active = catalogSyncs.get(key);
  if (active) return active;
  const sync = ensureCatalogSeededOnce(database, seed, crawlPolicy).finally(() => {
    if (catalogSyncs.get(key) === sync) catalogSyncs.delete(key);
  });
  catalogSyncs.set(key, sync);
  return sync;
}
