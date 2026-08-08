import type { CrawlStore, PersistedSource } from "../lib/crawl-runner";
import type { CrawledJob } from "../lib/crawler";

type SourceRow = {
  id: string;
  company: string;
  posting_url: string;
  adapter: PersistedSource["adapter"];
  next_crawl_at: string | null;
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export class D1CrawlStore implements CrawlStore {
  constructor(private readonly db: D1Database) {}

  async dueSources(now: string, limit: number): Promise<PersistedSource[]> {
    const result = await this.db.prepare(`
      SELECT id, company, posting_url, adapter, next_crawl_at
      FROM sources
      WHERE enabled = 1
        AND posting_url IS NOT NULL
        AND (next_crawl_at IS NULL OR next_crawl_at <= ?)
      ORDER BY COALESCE(next_crawl_at, '') ASC, company ASC
      LIMIT ?
    `).bind(now, limit).all<SourceRow>();

    return result.results.map((row) => ({
      id: row.id,
      company: row.company,
      postingUrl: row.posting_url,
      adapter: row.adapter,
      nextCrawlAt: row.next_crawl_at,
    }));
  }

  async startRun(source: PersistedSource, scheduledFor: string): Promise<string> {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await this.db.prepare(`
      UPDATE crawl_runs
      SET status = 'failed', error = 'Superseded by a later crawl attempt.', finished_at = ?
      WHERE source_id = ? AND status = 'running'
    `).bind(startedAt, source.id).run();
    await this.db.prepare(`
      INSERT INTO crawl_runs (id, source_id, scheduled_for, started_at, status)
      VALUES (?, ?, ?, ?, 'running')
    `).bind(id, source.id, scheduledFor, startedAt).run();
    return id;
  }

  async syncJobs(sourceId: string, jobs: CrawledJob[], completeListing: boolean): Promise<{ created: number; updated: number; closed: number }> {
    const now = new Date().toISOString();
    const existingResult = await this.db.prepare(`
      SELECT official_url FROM jobs WHERE source_id = ? AND status = 'open'
    `).bind(sourceId).all<{ official_url: string }>();
    const existingUrls = new Set(existingResult.results.map((row) => row.official_url));
    const visibleUrls = new Set(jobs.map((job) => job.officialUrl));
    const statements: D1PreparedStatement[] = [];

    for (const job of jobs) {
      const descriptionHash = job.summary ? await sha256(job.summary) : null;
      statements.push(this.db.prepare(`
        INSERT INTO jobs (
          id, source_id, external_id, title, company, location, arrangement,
          employment_type, summary, description_hash, official_url, status,
          published_at, first_seen_at, last_seen_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL)
        ON CONFLICT(source_id, official_url) DO UPDATE SET
          external_id = excluded.external_id,
          title = excluded.title,
          company = excluded.company,
          location = excluded.location,
          arrangement = excluded.arrangement,
          employment_type = excluded.employment_type,
          summary = excluded.summary,
          description_hash = excluded.description_hash,
          status = 'open',
          published_at = excluded.published_at,
          last_seen_at = excluded.last_seen_at,
          closed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        crypto.randomUUID(), sourceId, job.externalId, job.title, job.company, job.location,
        job.arrangement, job.employmentType, job.summary, descriptionHash, job.officialUrl,
        job.publishedAt, now, now,
      ));
    }

    const closedUrls = completeListing
      ? [...existingUrls].filter((url) => !visibleUrls.has(url))
      : [];
    for (const officialUrl of closedUrls) {
      statements.push(this.db.prepare(`
        UPDATE jobs
        SET status = 'closed', closed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND official_url = ? AND status = 'open'
      `).bind(now, sourceId, officialUrl));
    }
    if (statements.length > 0) await this.db.batch(statements);

    const created = jobs.filter((job) => !existingUrls.has(job.officialUrl)).length;
    return { created, updated: jobs.length - created, closed: closedUrls.length };
  }

  async finishRun(runId: string, values: Record<string, unknown>): Promise<void> {
    await this.db.prepare(`
      UPDATE crawl_runs
      SET status = ?, response_status = ?, jobs_seen = ?, jobs_created = ?, jobs_updated = ?, jobs_closed = ?, error = ?, finished_at = ?
      WHERE id = ?
    `).bind(
      values.status,
      values.responseStatus,
      values.jobsSeen,
      values.jobsCreated,
      values.jobsUpdated,
      values.jobsClosed,
      values.error,
      values.finishedAt,
      runId,
    ).run();
  }

  async scheduleNext(sourceId: string, nextCrawlAt: string): Promise<void> {
    await this.db.prepare(`
      UPDATE sources
      SET last_crawled_at = ?, next_crawl_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(new Date().toISOString(), nextCrawlAt, sourceId).run();
  }
}
