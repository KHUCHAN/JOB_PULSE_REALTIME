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

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

export async function ensureCatalogSeeded(
  database: CatalogDb,
  seed: CatalogSeed,
): Promise<{ seeded: boolean; sources: number; talentTargets: number }> {
  const existing = await database.prepare(`
    SELECT
      (SELECT count(*) FROM sources) AS count,
      (SELECT value FROM catalog_state WHERE key = 'sources') AS version
  `).first() as { count: number; version: string | null } | null;
  if (existing?.version === seed.version) {
    return { seeded: false, sources: existing?.count ?? 0, talentTargets: 0 };
  }

  for (const batch of chunks(seed.sources, 500)) {
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
        posting_url=excluded.posting_url, talent_url=excluded.talent_url,
        channel=excluded.channel, adapter=excluded.adapter,
        verification=excluded.verification, confidence=excluded.confidence,
        resume_upload=excluded.resume_upload, job_alerts=excluded.job_alerts,
        enabled=excluded.enabled, checked_at=excluded.checked_at,
        updated_at=CURRENT_TIMESTAMP
    `).bind(JSON.stringify(batch)).run();
  }

  for (const batch of chunks(seed.talentTargets, 500)) {
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

  await database.prepare(`
    INSERT INTO catalog_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).bind("sources", seed.version).run();

  return { seeded: true, sources: seed.sources.length, talentTargets: seed.talentTargets.length };
}
