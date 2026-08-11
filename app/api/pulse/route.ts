import { env } from "cloudflare:workers";
import catalogSeed from "../../../db/seed/sources.json";
import type {
  ActivityEvent,
  CreateKeywordInput,
  JobFilters,
  JobSearchResult,
  JobState,
  KeywordRule,
  OverviewSnapshot,
  SourceRecord,
  TalentTarget,
} from "../../../lib/domain";
import { runDueCrawls, type PersistedSource } from "../../../lib/crawl-runner";
import { jobsFromTeslaState, type CrawledFacet, type CrawledJob, type TeslaState } from "../../../lib/crawler";
import { normalizeBrowserJobSnapshot } from "../../../lib/browser-crawl-ingest";
import { ensureCatalogSeeded, type CatalogSeed } from "../../../lib/catalog-bootstrap";
import { crawlBatchOptions, jobAreaRegionBackfillLimit, jobProgramBackfillLimit, jobTopicBackfillLimit, recrawlSourceIds } from "../../../lib/crawl-batch-options";
import { backfillJobAreasAndRegions } from "../../../lib/job-area-region-backfill";
import { parseJobFilterParams } from "../../../lib/job-filter-query";
import {
  InvalidJobFilterError,
  validateExplicitJobFilterValues,
} from "../../../lib/job-filter-validation";
import { bindJobSearchStatements } from "../../../lib/job-search-execution";
import {
  jobFilterOptionRefreshKeys,
  queryCachedJobFilterOptions,
  queryJobFilterOptions,
  refreshJobFilterOptions,
  rotatingJobFilterOptionKeys,
} from "../../../lib/job-filter-options";
import { buildJobSearchPlan, jobDetailProjection } from "../../../lib/job-search-sql";
import { overviewCountsSql } from "../../../lib/overview-sql";
import { backfillJobTopics } from "../../../lib/job-topic-backfill";
import { backfillJobPrograms } from "../../../lib/job-program-backfill";
import {
  mapCrawlActivity,
  mapJob,
  sourceHealth,
  type CrawlActivityRow,
  type JobViewRow,
} from "../../../lib/pulse-mappers";
import { D1CrawlStore } from "../../../worker/crawl-store";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

const db = (): D1Database => {
  if (!env.DB) throw new Error("D1 binding DB is unavailable.");
  return env.DB;
};

const parseJsonArray = (value: string | null): string[] => {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

let filterOptionsCache: { expiresAt: number; value: Awaited<ReturnType<typeof queryJobFilterOptions>> } | null = null;

type BrowserIngestSourceRow = {
  id: string;
  company: string;
  posting_url: string;
  adapter: PersistedSource["adapter"];
  next_crawl_at: string | null;
};

async function browserIngestSource(database: D1Database, sourceId: string): Promise<PersistedSource | null> {
  const row = await database.prepare(`
    SELECT id, company, posting_url, adapter, next_crawl_at
    FROM sources
    WHERE id = ? AND enabled = 1 AND posting_url IS NOT NULL
  `).bind(sourceId).first<BrowserIngestSourceRow>();
  return row ? {
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    adapter: row.adapter,
    nextCrawlAt: row.next_crawl_at,
  } : null;
}

async function persistBrowserSnapshot(
  database: D1Database,
  source: PersistedSource,
  jobs: CrawledJob[],
  facets?: CrawledFacet[],
): Promise<{ sourceId: string; jobs: number; created: number; updated: number; closed: number }> {
  const store = new D1CrawlStore(database);
  const now = new Date();
  const runId = await store.startRun(source, now.toISOString());
  try {
    const changes = await store.syncJobs(source.id, jobs, true, facets);
    await store.finishRun(runId, {
      status: "succeeded",
      responseStatus: 200,
      jobsSeen: jobs.length,
      jobsCreated: changes.created,
      jobsUpdated: changes.updated,
      jobsClosed: changes.closed,
      error: null,
      finishedAt: new Date().toISOString(),
    });
    await store.scheduleNext(source.id, new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString());
    filterOptionsCache = null;
    return { sourceId: source.id, jobs: jobs.length, ...changes };
  } catch (error) {
    await store.finishRun(runId, {
      status: "failed",
      responseStatus: null,
      jobsSeen: 0,
      jobsCreated: 0,
      jobsUpdated: 0,
      jobsClosed: 0,
      error: error instanceof Error ? error.message : "Browser snapshot ingestion failed.",
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function availableFilterOptions(): Promise<Awaited<ReturnType<typeof queryJobFilterOptions>>> {
  if (filterOptionsCache && filterOptionsCache.expiresAt > Date.now()) return filterOptionsCache.value;
  const database = db();
  const value = await queryCachedJobFilterOptions(database) ?? await queryJobFilterOptions(database);
  filterOptionsCache = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
  return value;
}

async function jobsFor(url: URL): Promise<JobSearchResult> {
  validateExplicitJobFilterValues(url.searchParams);
  const filters: JobFilters = parseJobFilterParams(url.searchParams);
  const plan = buildJobSearchPlan(filters);
  const database = db();
  const statements = bindJobSearchStatements(database.prepare.bind(database), plan);
  const [pageResult, countResult] = await Promise.all([
    statements.page.all<JobViewRow>(),
    statements.count.first<{ total: number }>(),
  ]);
  return {
    items: pageResult.results.map(mapJob),
    total: countResult?.total ?? 0,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 50,
  };
}

async function activityFor(limit = 200): Promise<ActivityEvent[]> {
  const result = await db().prepare(`
    SELECT cr.id, s.company, cr.status, cr.started_at, cr.finished_at,
           cr.jobs_seen, cr.jobs_created, cr.jobs_updated, cr.jobs_closed, cr.error
    FROM crawl_runs cr JOIN sources s ON s.id = cr.source_id
    WHERE cr.status <> 'running'
    ORDER BY coalesce(cr.finished_at, cr.started_at) DESC
    LIMIT ?
  `).bind(limit).all<CrawlActivityRow>();
  return result.results.map(mapCrawlActivity);
}

async function listSources(): Promise<SourceRecord[]> {
  type Row = {
    id: string; company: string; posting_url: string | null; talent_url: string | null;
    adapter: SourceRecord["adapter"]; enabled: number; checked_at: string; last_crawled_at: string | null;
    next_crawl_at: string | null; latest_status: string | null; response_status: number | null;
    current_jobs: number; last_changed_at: string | null;
  };
  const result = await db().prepare(`
    WITH latest AS (
      SELECT *, row_number() OVER (PARTITION BY source_id ORDER BY coalesce(finished_at, started_at) DESC) AS rn
      FROM crawl_runs
    ), counts AS (
      SELECT source_id, count(*) AS current_jobs FROM jobs WHERE status = 'open' GROUP BY source_id
    ), changed AS (
      SELECT source_id, max(finished_at) AS last_changed_at FROM crawl_runs
      WHERE jobs_created > 0 OR jobs_updated > 0 OR jobs_closed > 0 GROUP BY source_id
    )
    SELECT s.id, s.company, s.posting_url, s.talent_url, s.adapter, s.enabled,
           s.checked_at, s.last_crawled_at, s.next_crawl_at,
           l.status AS latest_status, l.response_status,
           coalesce(c.current_jobs, 0) AS current_jobs, ch.last_changed_at
    FROM sources s
    LEFT JOIN latest l ON l.source_id = s.id AND l.rn = 1
    LEFT JOIN counts c ON c.source_id = s.id
    LEFT JOIN changed ch ON ch.source_id = s.id
    ORDER BY s.company ASC
    LIMIT 2000
  `).all<Row>();
  return result.results.map((row) => ({
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    talentUrl: row.talent_url,
    adapter: row.adapter,
    health: sourceHealth(Boolean(row.enabled), row.latest_status),
    httpStatus: row.response_status,
    currentJobs: row.current_jobs,
    lastCheckedAt: row.last_crawled_at || row.checked_at,
    lastChangedAt: row.last_changed_at,
    nextRunAt: row.next_crawl_at || row.checked_at,
  }));
}

async function listKeywords(): Promise<KeywordRule[]> {
  type Row = { id: string; name: string; include_terms: string; exclude_terms: string; locations: string; enabled: number; delivery_mode: string; last_sent_at: string | null };
  const result = await db().prepare(`
    SELECT k.*, (SELECT max(notified_at) FROM job_matches WHERE keyword_id = k.id) AS last_sent_at
    FROM keywords k ORDER BY created_at DESC
  `).all<Row>();
  return result.results.map((row) => ({
    id: row.id, name: row.name, includeTerms: parseJsonArray(row.include_terms),
    excludeTerms: parseJsonArray(row.exclude_terms), locations: parseJsonArray(row.locations),
    enabled: Boolean(row.enabled), mode: row.delivery_mode === "daily_digest" ? "daily_digest" : "six_hour",
    lastSentAt: row.last_sent_at,
  }));
}

async function listTalent(): Promise<TalentTarget[]> {
  type Row = { id: string; company: string; adapter: string; official_url: string; resume_upload: TalentTarget["resumeUpload"]; job_alerts: TalentTarget["jobAlerts"]; registration_state: string };
  const result = await db().prepare(`
    SELECT tt.id, s.company, s.adapter, tt.official_url, tt.resume_upload, tt.job_alerts, tt.registration_state
    FROM talent_targets tt JOIN sources s ON s.id = tt.source_id
    ORDER BY s.company ASC LIMIT 2000
  `).all<Row>();
  return result.results.map((row) => ({
    id: row.id, company: row.company, ats: row.adapter, talentUrl: row.official_url,
    resumeUpload: row.resume_upload, jobAlerts: row.job_alerts,
    state: row.registration_state === "external" ? "completed" : "ready",
    blocker: null, lastAttemptAt: null,
  }));
}

async function overview(): Promise<OverviewSnapshot> {
  type Counts = { open_jobs: number; active_sources: number; source_errors: number; unsent_alerts: number };
  const countRow = await db().prepare(overviewCountsSql).first<Counts>();
  const latest = await jobsFor(new URL("https://job-pulse.local/api/pulse?resource=jobs&pageSize=5"));
  const activity = await activityFor(5);
  const talentCount = await db().prepare("SELECT count(*) AS count FROM talent_targets").first<{ count: number }>();
  return {
    newMatches: countRow?.open_jobs ?? 0,
    activeSources: countRow?.active_sources ?? 0,
    sourceErrors: countRow?.source_errors ?? 0,
    unsentAlerts: countRow?.unsent_alerts ?? 0,
    openTalentTasks: talentCount?.count ?? 0,
    latestJobs: latest.items,
    recentActivity: activity,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureCatalogSeeded(db(), catalogSeed as CatalogSeed);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    if (resource === "jobs") return json(await jobsFor(url));
    if (resource === "jobFilterOptions") return json(await availableFilterOptions());
    if (resource === "job") {
      const row = await db().prepare(`
        SELECT ${jobDetailProjection("j")}
        FROM jobs j WHERE j.id = ?
      `).bind(url.searchParams.get("id")).first<JobViewRow>();
      return json(row ? mapJob(row) : null, row ? 200 : 404);
    }
    if (resource === "sources") {
      const health = url.searchParams.get("health");
      const sources = await listSources();
      return json(health ? sources.filter((source) => source.health === health) : sources);
    }
    if (resource === "keywords") return json(await listKeywords());
    if (resource === "talent") return json(await listTalent());
    if (resource === "activity") {
      const events = await activityFor();
      const severity = url.searchParams.get("severity");
      const kind = url.searchParams.get("kind");
      return json(events.filter((event) => (!severity || event.severity === severity) && (!kind || event.kind === kind)));
    }
    if (resource === "overview") return json(await overview());
    return json({ error: "Unknown resource." }, 400);
  } catch (error) {
    if (error instanceof InvalidJobFilterError) return json({ error: error.message }, 400);
    return json({ error: error instanceof Error ? error.message : "D1 query failed." }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await ensureCatalogSeeded(db(), catalogSeed as CatalogSeed);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "updateJobState") {
      const state = body.state as JobState;
      if (!["new", "saved", "hidden", "applied"].includes(state)) return json({ error: "Invalid review state." }, 400);
      await db().prepare("UPDATE jobs SET review_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(state, body.jobId).run();
      const row = await db().prepare(`SELECT id, source_id, company, title, location, arrangement, substr(coalesce(summary,description),1,1200) AS summary, official_url, first_seen_at, last_seen_at, review_state FROM jobs WHERE id = ?`).bind(body.jobId).first<JobViewRow>();
      return json(row ? mapJob(row) : null, row ? 200 : 404);
    }
    if (body.action === "createKeyword") {
      const input = body.input as CreateKeywordInput;
      if (!input?.name?.trim() || !input.includeTerms?.length) return json({ error: "Name and include terms are required." }, 400);
      const id = crypto.randomUUID();
      await db().prepare(`INSERT INTO keywords (id,name,include_terms,exclude_terms,locations,enabled,delivery_mode) VALUES (?,?,?,?,?,1,?)`)
        .bind(id, input.name.trim(), JSON.stringify(input.includeTerms), JSON.stringify(input.excludeTerms ?? []), JSON.stringify(input.locations ?? []), input.mode).run();
      return json({ id, ...input, enabled: true, lastSentAt: null }, 201);
    }
    if (body.action === "setKeywordEnabled") {
      await db().prepare("UPDATE keywords SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.enabled ? 1 : 0, body.keywordId).run();
      const keywords = await listKeywords();
      return json(keywords.find((item) => item.id === body.keywordId) ?? null);
    }
    if (body.action === "updateTalentState") {
      const state = body.state === "completed" ? "external" : "not_started";
      await db().prepare("UPDATE talent_targets SET registration_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(state, body.targetId).run();
      const targets = await listTalent();
      return json(targets.find((item) => item.id === body.targetId) ?? null);
    }
    if (body.action === "ingestBrowserJobs") {
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      if (sourceId !== "p4-0214-alvarez-marsal") return json({ error: "This source does not accept browser job snapshots." }, 400);
      const database = db();
      const source = await browserIngestSource(database, sourceId);
      if (!source) return json({ error: "Browser crawl source is unavailable." }, 404);
      const snapshot = normalizeBrowserJobSnapshot(source, body.jobs);
      if (snapshot.jobs.length === 0) return json({ error: "Browser snapshot contained no valid jobs." }, 400);
      return json(await persistBrowserSnapshot(database, source, snapshot.jobs, snapshot.facets));
    }
    if (body.action === "ingestTeslaState") {
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      if (sourceId !== "p5-1077-tesla" || !body.state || typeof body.state !== "object") {
        return json({ error: "A valid Tesla browser state snapshot is required." }, 400);
      }
      const database = db();
      const source = await browserIngestSource(database, sourceId);
      if (!source) return json({ error: "Tesla crawl source is unavailable." }, 404);
      const jobs = jobsFromTeslaState(source, body.state as TeslaState);
      if (jobs.length === 0) return json({ error: "Tesla browser state contained no US jobs." }, 400);
      return json(await persistBrowserSnapshot(database, source, jobs));
    }
    if (body.action === "crawlBatch") {
      const requested = typeof body.limit === "number" ? body.limit : 4;
      const database = db();
      const result = await runDueCrawls(new D1CrawlStore(database), fetch, new Date(), crawlBatchOptions(requested));
      if (result.attempted === 0) {
        const refreshed = await refreshJobFilterOptions(database, {
          force: true,
          filterKeys: rotatingJobFilterOptionKeys(new Date()),
        });
        if (refreshed.refreshed) filterOptionsCache = null;
      }
      return json(result);
    }
    if (body.action === "backfillJobTopics") {
      const requested = typeof body.limit === "number" ? body.limit : undefined;
      return json(await backfillJobTopics(db(), jobTopicBackfillLimit(requested)));
    }
    if (body.action === "backfillJobPrograms") {
      const requested = typeof body.limit === "number" ? body.limit : undefined;
      return json(await backfillJobPrograms(db(), jobProgramBackfillLimit(requested)));
    }
    if (body.action === "backfillJobAreasAndRegions") {
      const requested = typeof body.limit === "number" ? body.limit : undefined;
      return json(await backfillJobAreasAndRegions(db(), jobAreaRegionBackfillLimit(requested)));
    }
    if (body.action === "refreshJobFilterOptions") {
      const result = await refreshJobFilterOptions(db(), {
        force: true,
        filterKeys: jobFilterOptionRefreshKeys(body.filterKeys),
      });
      filterOptionsCache = null;
      return json(result);
    }
    if (body.action === "recrawlSources") {
      const sourceIds = recrawlSourceIds(body.sourceIds);
      if (sourceIds.length === 0) return json({ error: "At least one source ID is required." }, 400);
      await db().prepare(`
        UPDATE sources
        SET next_crawl_at = '1970-01-01 00:00:00', updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT value FROM json_each(?))
      `).bind(JSON.stringify(sourceIds)).run();
      return json(await runDueCrawls(new D1CrawlStore(db()), fetch, new Date(), crawlBatchOptions(sourceIds.length)));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "D1 mutation failed." }, 500);
  }
}
