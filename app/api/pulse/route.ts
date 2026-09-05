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
import { runDueCrawls, runSpecificCrawls, type PersistedSource } from "../../../lib/crawl-runner";
import {
  jobsFromTeslaState,
  LARGE_CATALOG_US_SCOPE_POLICY_REQUEUE_SOURCE_IDS,
  LARGE_CATALOG_US_SCOPE_POLICY_VERSION,
  type CrawledFacet,
  type CrawledJob,
  type TeslaState,
} from "../../../lib/crawler";
import { normalizeBrowserJobSnapshot } from "../../../lib/browser-crawl-ingest";
import { browserResultError, shouldRecordBrowserResult } from "../../../lib/browser-fallback-selection";
import { ensureCatalogSeeded, type CatalogSeed } from "../../../lib/catalog-bootstrap";
import { crawlBatchOptions, jobAreaRegionBackfillLimit, jobProgramBackfillLimit, jobTopicBackfillLimit, recrawlSourceIds } from "../../../lib/crawl-batch-options";
import { finalizeStaleCrawlRuns } from "../../../lib/crawl-run-repair";
import { findArchivedJob, purgeExpiredJobs } from "../../../lib/job-retention";
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
import { normalizeDeadJobUrls, normalizeJobUrlRepairs } from "../../../lib/job-url-repair";
import { overviewActivitySql, overviewCountsSql, overviewLatestJobsSql } from "../../../lib/overview-sql";
import { backfillJobTopics } from "../../../lib/job-topic-backfill";
import { backfillJobPrograms } from "../../../lib/job-program-backfill";
import {
  mapCrawlActivity,
  mapJob,
  sourceHealth,
  utcTimestamp,
  type CrawlActivityRow,
  type JobViewRow,
} from "../../../lib/pulse-mappers";
import { D1CrawlStore } from "../../../worker/crawl-store";
import { backfillResumeMatches } from "../../../lib/resume-match-store";
import { listResumeReviewCandidates } from "../../../lib/resume-review-feed";
import { applyCodexReviews, type CodexReviewInput } from "../../../lib/codex-review-store";
import {
  clearResumeAlertBacklog,
  getResumeAlertStatus,
  retryResumeAlerts,
  setResumeAlertEnabled,
} from "../../../lib/resume-alert-store";
import {
  processDueResumeAlerts,
  resumeAlertHttpStatus,
  sendResumeTestEmail,
  type GmailRuntimeConfig,
} from "../../../lib/resume-alert-service";
import { verifyGithubActionsOidc } from "../../../lib/github-actions-oidc";
import { detectUrlAdapter, isSafeCareerListingUrl } from "../../../lib/url-remediation";
import { normalizeBarclaysJobIdentityRepair } from "../../../lib/verified-job-identity";
import { normalizeVerifiedJobMetadataRepair } from "../../../lib/verified-job-metadata";

export const dynamic = "force-dynamic";

const largeCatalogCrawlPolicy = {
  version: LARGE_CATALOG_US_SCOPE_POLICY_VERSION,
  sourceIds: LARGE_CATALOG_US_SCOPE_POLICY_REQUEUE_SOURCE_IDS,
} as const;

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

const db = (): D1Database => {
  if (!env.DB) throw new Error("D1 binding DB is unavailable.");
  return env.DB;
};

type GmailEnvironment = {
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_SENDER?: string;
  CRAWL_INGEST_SECRET?: string;
  JOB_PULSE_WEBHOOK_SECRET?: string;
  CODEX_REVIEW_TOKEN?: string;
};

const browserIngestAuthorized = async (request: Request): Promise<boolean> => {
  const values = env as typeof env & GmailEnvironment;
  const authorization = request.headers.get("authorization");
  const secrets = [values.CRAWL_INGEST_SECRET, values.JOB_PULSE_WEBHOOK_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return secrets.some((secret) => authorization === `Bearer ${secret}`)
    || verifyGithubActionsOidc(authorization);
};

const codexReviewAuthorized = (request: Request): boolean => {
  const values = env as typeof env & GmailEnvironment;
  const secret = values.CODEX_REVIEW_TOKEN?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
};

// The scheduled Codex repair runner may submit only the same bounded,
// official-origin snapshot accepted from browser/GitHub recovery. Keep this
// narrower than browserIngestAuthorized so the Codex token does not gain
// access to browser-result or other crawler-control actions.
const jobSnapshotIngestAuthorized = async (request: Request): Promise<boolean> => (
  codexReviewAuthorized(request) || browserIngestAuthorized(request)
);

const gmailRuntimeConfig = (): GmailRuntimeConfig | null => {
  const values = env as typeof env & GmailEnvironment;
  const clientId = values.GMAIL_CLIENT_ID?.trim();
  const clientSecret = values.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = values.GMAIL_REFRESH_TOKEN?.trim();
  const sender = values.GMAIL_SENDER?.trim();
  if (!clientId || !clientSecret || !refreshToken || !sender) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    sender,
    siteUrl: "https://job-pulse-realtime.autodev61.chatgpt.site/jobs?resumeMatch=chanyoung-resume",
  };
};

const resumeStatus = async () => {
  const config = gmailRuntimeConfig();
  return getResumeAlertStatus(db(), "chanyoung-resume", Boolean(config), config?.sender ?? "");
};

const runResumeAlerts = async (database: D1Database, exactJobIds: string[] | null = null) => {
  let alerts: Awaited<ReturnType<typeof processDueResumeAlerts>> | { error: string };
  try {
    alerts = await processDueResumeAlerts(database, gmailRuntimeConfig(), new Date(), fetch, exactJobIds);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Unknown resume alert failure.";
    alerts = { error: `Resume alert processing failed: ${detail}` };
  }
  return alerts;
};

const runCrawlBatch = async (requested: number | undefined) => {
  const database = db();
  const result = await runDueCrawls(new D1CrawlStore(database), fetch, new Date(), crawlBatchOptions(requested));
  if (result.attempted === 0) {
    const refreshed = await refreshJobFilterOptions(database, {
      force: true,
      filterKeys: rotatingJobFilterOptionKeys(new Date()),
    });
    if (refreshed.refreshed) filterOptionsCache = null;
  }
  return result;
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

type UrlRepairSourceRow = BrowserIngestSourceRow;

async function browserIngestSource(database: D1Database, sourceId: string): Promise<PersistedSource | null> {
  const row = await database.prepare(`
    SELECT id, company, COALESCE(posting_url, talent_url) AS posting_url, adapter, next_crawl_at
    FROM sources
    WHERE id = ? AND (posting_url IS NOT NULL OR talent_url IS NOT NULL)
  `).bind(sourceId).first<BrowserIngestSourceRow>();
  return row ? {
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    adapter: row.adapter,
    nextCrawlAt: row.next_crawl_at,
  } : null;
}

type BrowserCrawlStatus = "succeeded" | "failed" | "blocked";
type BrowserCrawlCode =
  | "jobs_recovered"
  | "empty_board"
  | "http_error"
  | "blocked_challenge"
  | "navigation_timeout"
  | "navigation_error"
  | "unsafe_listing"
  | "ingest_error";

const browserCrawlBackoffHours = (status: BrowserCrawlStatus): number => (
  status === "succeeded" ? 2 : status === "failed" ? 6 : 24
);

async function recordBrowserCrawlResult(
  database: D1Database,
  sourceId: string,
  status: BrowserCrawlStatus,
  responseStatus: number | null,
  jobsSeen: number,
  code: BrowserCrawlCode,
): Promise<{ sourceId: string; status: BrowserCrawlStatus; jobsSeen: number; nextCrawlAt: string }> {
  const source = await browserIngestSource(database, sourceId);
  if (!source) throw new Error("Browser crawl source is unavailable.");
  const now = new Date();
  const startedAt = now.toISOString();
  const nextCrawlAt = new Date(now.getTime() + browserCrawlBackoffHours(status) * 60 * 60 * 1_000).toISOString();
  const store = new D1CrawlStore(database);
  const previous = await database.prepare(`
    SELECT status, jobs_seen
    FROM crawl_runs
    WHERE source_id = ? AND status <> 'running'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).bind(sourceId).first<{ status: "succeeded" | "failed" | "blocked"; jobs_seen: number }>();
  if (!shouldRecordBrowserResult(previous?.status ?? null, status)) {
    // A weaker browser shell failure must not overwrite a successful native
    // observation or stretch its healthy two-hour schedule to six/24 hours.
    // The browser priority queue has its own rotation and can retry later.
    const preservedNextCrawlAt = source.nextCrawlAt ?? new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString();
    if (!source.nextCrawlAt) await store.scheduleNext(source.id, preservedNextCrawlAt);
    return {
      sourceId,
      status: previous!.status,
      jobsSeen: previous!.jobs_seen,
      nextCrawlAt: preservedNextCrawlAt,
    };
  }
  const runId = await store.startRun(source, startedAt);
  await store.finishRun(runId, {
    status,
    responseStatus,
    jobsSeen,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsClosed: 0,
    // Only fixed, low-cardinality codes are persisted for failures. A
    // positively verified empty catalog is a successful observation and must
    // not leave a stale-looking error on an otherwise healthy source.
    error: browserResultError(status, code),
    finishedAt: new Date().toISOString(),
  });
  await store.scheduleNext(source.id, nextCrawlAt);
  return { sourceId, status, jobsSeen, nextCrawlAt };
}

async function persistBrowserSnapshot(
  database: D1Database,
  source: PersistedSource,
  jobs: CrawledJob[],
  facets?: CrawledFacet[],
  completeListing = false,
  listingUrl?: string,
  snapshotStartedAt?: string | null,
): Promise<{ sourceId: string; jobs: number; created: number; updated: number; closed: number }> {
  const store = new D1CrawlStore(database);
  const now = new Date();
  const runId = await store.startRun(source, now.toISOString());
  try {
    // Chunked transports persist every part non-authoritatively, then close
    // only rows not touched since the shared snapshot watermark. If an early
    // chunk fails, the final close never runs and existing open jobs remain.
    const watermarkFinalization = completeListing && Boolean(snapshotStartedAt);
    const changes = await store.syncJobs(
      source.id,
      jobs,
      watermarkFinalization ? false : completeListing,
      facets,
    );
    if (watermarkFinalization) {
      changes.closed += await store.closeStaleJobsAfterWatermark(source.id, snapshotStartedAt!);
    }
    if (listingUrl && listingUrl !== source.postingUrl && isSafeCareerListingUrl(source.company, source.postingUrl, listingUrl)) {
      const original = await database.prepare("SELECT posting_url FROM sources WHERE id = ?").bind(source.id).first<{ posting_url: string | null }>();
      if (original?.posting_url === null) {
        await database.prepare(`
          UPDATE sources
          SET posting_url = ?, adapter = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND posting_url IS NULL
        `).bind(listingUrl, detectUrlAdapter(listingUrl), source.id).run();
      } else {
        await store.updateResolvedListing(source.id, source.postingUrl, listingUrl, detectUrlAdapter(listingUrl));
      }
    }
    // A disabled source is allowed through browser verification so an
    // official board found by Chrome can be promoted back to the active queue.
    if (jobs.length > 0) {
      await database.prepare("UPDATE sources SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(source.id).run();
    }
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
  const snapshotAt = filters.snapshotAt || new Date().toISOString();
  filters.snapshotAt = snapshotAt;
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
    snapshotAt,
  };
}

async function activityFor(limit = 200): Promise<ActivityEvent[]> {
  const result = await db().prepare(`
    SELECT cr.id, s.company, cr.status, cr.started_at, cr.finished_at,
           cr.jobs_seen, cr.jobs_created, cr.jobs_updated, cr.jobs_closed, cr.error
    FROM crawl_runs cr JOIN sources s ON s.id = cr.source_id
    WHERE cr.status <> 'running'
    ORDER BY cr.rowid DESC
    LIMIT ?
  `).bind(limit).all<CrawlActivityRow>();
  return result.results.map(mapCrawlActivity);
}

async function runStatusFor(): Promise<{
  checkedAt: string;
  running: number;
  staleRunning: number;
  recent: Array<{
    id: string;
    sourceId: string;
    company: string;
    status: string;
    scheduledFor: string;
    startedAt: string | null;
    finishedAt: string | null;
    jobsSeen: number;
    jobsCreated: number;
    jobsUpdated: number;
    jobsClosed: number;
    error: string | null;
  }>;
}> {
  type Row = {
    id: string;
    source_id: string;
    company: string;
    status: string;
    scheduled_for: string;
    started_at: string | null;
    finished_at: string | null;
    jobs_seen: number;
    jobs_created: number;
    jobs_updated: number;
    jobs_closed: number;
    error: string | null;
  };
  const result = await db().prepare(`
    SELECT cr.id, cr.source_id, s.company, cr.status, cr.scheduled_for,
           cr.started_at, cr.finished_at, cr.jobs_seen, cr.jobs_created,
           cr.jobs_updated, cr.jobs_closed, cr.error
    FROM crawl_runs cr
    JOIN sources s ON s.id = cr.source_id
    ORDER BY cr.rowid DESC
    LIMIT 100
  `).all<Row>();
  const now = Date.now();
  const running = result.results.filter((row) => row.status === "running");
  return {
    checkedAt: new Date(now).toISOString(),
    running: running.length,
    staleRunning: running.filter((row) => row.started_at && now - Date.parse(row.started_at) > 120_000).length,
    recent: result.results.slice(0, 50).map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      company: row.company,
      status: row.status,
      scheduledFor: row.scheduled_for,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      jobsSeen: row.jobs_seen,
      jobsCreated: row.jobs_created,
      jobsUpdated: row.jobs_updated,
      jobsClosed: row.jobs_closed,
      error: row.error,
    })),
  };
}

async function listSources(sourceIds: string[] = []): Promise<SourceRecord[]> {
  type SourceRow = {
    id: string; company: string; posting_url: string | null; talent_url: string | null;
    adapter: SourceRecord["adapter"]; enabled: number; checked_at: string;
    last_crawled_at: string | null; next_crawl_at: string | null;
  };
  type LatestRow = {
    source_id: string; status: string | null; response_status: number | null;
    error: string | null; jobs_created: number | null; jobs_updated: number | null;
    jobs_closed: number | null; finished_at: string | null;
  };
  type CountRow = { source_id: string; current_jobs: number };
  const selectedFilter = sourceIds.length > 0
    ? "WHERE id IN (SELECT value FROM json_each(?))"
    : "";
  const selectedArgument = JSON.stringify(sourceIds);
  const database = db();
  // Keep the inventory query planner out of a 1,455-row nest of correlated
  // job-count and latest-run lookups. D1 can execute these independent,
  // indexed projections concurrently and the worker joins the small maps in
  // memory. This keeps the complete monitoring feed bounded as history grows.
  const sourcesStatement = database.prepare(`
    SELECT id, company, posting_url, talent_url, adapter, enabled,
           checked_at, last_crawled_at, next_crawl_at
    FROM sources ${selectedFilter}
    ORDER BY company ASC
    LIMIT 2000
  `);
  const latestStatement = database.prepare(`
    WITH selected_sources AS (
      SELECT id FROM sources ${selectedFilter}
    )
    SELECT l.source_id, l.status, l.response_status, l.error,
           l.jobs_created, l.jobs_updated, l.jobs_closed, l.finished_at
    FROM selected_sources s
    JOIN crawl_runs l ON l.id = (
      SELECT latest.id
      FROM crawl_runs latest INDEXED BY crawl_runs_source_scheduled_idx
      WHERE latest.source_id = s.id
      ORDER BY latest.scheduled_for DESC
      LIMIT 1
    )
  `);
  const countsStatement = database.prepare(`
    SELECT source_id, count(*) AS current_jobs
    FROM jobs INDEXED BY jobs_status_source_idx
    WHERE ${sourceIds.length > 0 ? "source_id IN (SELECT value FROM json_each(?)) AND" : ""} status = 'open'
    GROUP BY source_id
  `);
  const [sourceResult, latestResult, countsResult] = await Promise.all([
    sourceIds.length > 0 ? sourcesStatement.bind(selectedArgument).all<SourceRow>() : sourcesStatement.all<SourceRow>(),
    sourceIds.length > 0 ? latestStatement.bind(selectedArgument).all<LatestRow>() : latestStatement.all<LatestRow>(),
    sourceIds.length > 0 ? countsStatement.bind(selectedArgument).all<CountRow>() : countsStatement.all<CountRow>(),
  ]);
  const latestBySource = new Map(latestResult.results.map((row) => [row.source_id, row]));
  const countsBySource = new Map(countsResult.results.map((row) => [row.source_id, row.current_jobs]));
  return sourceResult.results.map((row) => {
    const latest = latestBySource.get(row.id);
    return ({
    id: row.id,
    company: row.company,
    postingUrl: row.posting_url,
    talentUrl: row.talent_url,
    adapter: row.adapter,
    health: sourceHealth(
      Boolean(row.enabled),
      latest?.status ?? null,
      row.last_crawled_at || row.checked_at,
      countsBySource.get(row.id) ?? 0,
    ),
    httpStatus: latest?.response_status ?? null,
    lastError: latest?.error ?? null,
    currentJobs: countsBySource.get(row.id) ?? 0,
    lastCheckedAt: utcTimestamp(row.last_crawled_at || row.checked_at) ?? row.checked_at,
    lastChangedAt: latest && (Number(latest.jobs_created ?? 0) > 0
      || Number(latest.jobs_updated ?? 0) > 0
      || Number(latest.jobs_closed ?? 0) > 0)
      ? utcTimestamp(latest.finished_at) : null,
    nextRunAt: row.enabled ? utcTimestamp(row.next_crawl_at || row.checked_at) : null,
    });
  });
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
  const database = db();
  const [countRow, latestResult, activityResult, talentCount] = await Promise.all([
    database.prepare(overviewCountsSql).first<Counts>(),
    database.prepare(overviewLatestJobsSql).bind(5).all<JobViewRow>(),
    database.prepare(overviewActivitySql).bind(5).all<CrawlActivityRow>(),
    database.prepare("SELECT count(*) AS count FROM talent_targets").first<{ count: number }>(),
  ]);
  return {
    newMatches: countRow?.open_jobs ?? 0,
    activeSources: countRow?.active_sources ?? 0,
    sourceErrors: countRow?.source_errors ?? 0,
    unsentAlerts: countRow?.unsent_alerts ?? 0,
    openTalentTasks: talentCount?.count ?? 0,
    latestJobs: latestResult.results.map(mapJob),
    recentActivity: activityResult.results.map(mapCrawlActivity),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureCatalogSeeded(db(), catalogSeed as CatalogSeed, largeCatalogCrawlPolicy);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    if (resource === "jobs") return json(await jobsFor(url));
    if (resource === "jobFilterOptions") return json(await availableFilterOptions());
    if (resource === "job") {
      const sourceId = url.searchParams.get("sourceId");
      const officialUrl = url.searchParams.get("officialUrl");
      if (!url.searchParams.get("id") && sourceId && officialUrl) {
        // Exact indexed identity lookup for post-ingestion verification. Do
        // not use FTS: it can omit recently changed titles and is expensive
        // for generic job-title terms across the complete catalog.
        const row = await db().prepare(`
          SELECT ${jobDetailProjection("j")}
          FROM jobs j WHERE j.source_id = ? AND j.official_url = ? AND j.status = 'open'
        `).bind(sourceId, officialUrl).first<JobViewRow>();
        if (!row) {
          const archived = await findArchivedJob(db(), { sourceId, officialUrl,
            requisitionId: url.searchParams.get("requisitionId"), externalId: url.searchParams.get("externalId") });
          if (archived) return json({ reason: "expired_posting_retention", sourceId, officialUrl }, 410);
        }
        return json(row ? mapJob(row) : null, row ? 200 : 404);
      }
      const row = await db().prepare(`
        SELECT ${jobDetailProjection("j")}
        FROM jobs j WHERE j.id = ?
      `).bind(url.searchParams.get("id")).first<JobViewRow>();
      return json(row ? mapJob(row) : null, row ? 200 : 404);
    }
    if (resource === "sources") {
      const health = url.searchParams.get("health");
      const sourceIds = [...new Set((url.searchParams.get("ids") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean))]
        // The independent priority runner reads one bounded inventory for the
        // critical-employer lane. Sixty-four IDs stays far below D1 limits
        // while avoiding partial inventories once that lane exceeds 20 firms.
        .slice(0, 64);
      const sources = await listSources(sourceIds);
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
    if (resource === "runStatus") return json(await runStatusFor());
    if (resource === "overview") return json(await overview());
    if (resource === "resumeAlert") return json(await resumeStatus());
    if (resource === "resumeReviewCandidates") {
      if (!codexReviewAuthorized(request)) return json({ error: "Codex review authorization is required." }, 401);
      const requested = Number(url.searchParams.get("limit"));
      return json(await listResumeReviewCandidates(db(), Number.isFinite(requested) ? requested : undefined));
    }
    return json({ error: "Unknown resource." }, 400);
  } catch (error) {
    if (error instanceof InvalidJobFilterError) return json({ error: error.message }, 400);
    return json({ error: error instanceof Error ? error.message : "D1 query failed." }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    // Maintenance must not seed/rewrite the catalog, especially on dry runs
    // or unauthorized requests.
    if (body.action === "purgeExpiredJobs") {
      if (!codexReviewAuthorized(request) && !await verifyGithubActionsOidc(request.headers.get("authorization"))) {
        return json({ error: "Crawler maintenance authorization is required." }, 401);
      }
      // Fixed server-owned 30 days and 100 rows; callers cannot broaden deletion.
      const result = await purgeExpiredJobs(db(), new Date().toISOString(), body.dryRun === true);
      filterOptionsCache = null;
      return json(result);
    }
    await ensureCatalogSeeded(db(), catalogSeed as CatalogSeed, largeCatalogCrawlPolicy);
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
      if (!await jobSnapshotIngestAuthorized(request)) return json({ error: "Official-origin crawler snapshot authorization is required." }, 401);
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      const database = db();
      const source = await browserIngestSource(database, sourceId);
      if (!source) return json({ error: "Browser crawl source is unavailable." }, 404);
      const listingUrl = typeof body.listingUrl === "string" ? body.listingUrl : "";
      if (!isSafeCareerListingUrl(source.company, source.postingUrl, listingUrl)) {
        return json({ error: "Browser snapshot listing URL did not match the source company." }, 400);
      }
      const allowedOrigins = Array.isArray(body.allowedOrigins)
        ? body.allowedOrigins.filter((value): value is string => typeof value === "string").slice(0, 5)
        : [];
      const snapshot = normalizeBrowserJobSnapshot(source, body.jobs, allowedOrigins);
      if (snapshot.jobs.length === 0) return json({ error: "Browser snapshot contained no valid jobs." }, 400);
      const requestedWatermark = typeof body.snapshotStartedAt === "string"
        ? body.snapshotStartedAt.trim()
        : "";
      const watermarkTime = Date.parse(requestedWatermark);
      const snapshotStartedAt = Number.isFinite(watermarkTime)
        && watermarkTime >= Date.now() - 2 * 60 * 60 * 1_000
        && watermarkTime <= Date.now() + 5 * 60 * 1_000
        ? new Date(watermarkTime).toISOString()
        : null;
      const finalizeSnapshot = body.finalizeSnapshot === true;
      if (finalizeSnapshot && !snapshotStartedAt) {
        return json({ error: "Snapshot watermark is outside the bounded ingest window." }, 400);
      }
      return json(await persistBrowserSnapshot(
        database,
        source,
        snapshot.jobs,
        body.replaceFacets === false ? undefined : snapshot.facets,
        body.completeListing === true || finalizeSnapshot,
        listingUrl,
        snapshotStartedAt,
      ));
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
    if (body.action === "recordBrowserCrawlResult") {
      if (!await browserIngestAuthorized(request)) return json({ error: "Browser crawl authorization is required." }, 401);
      const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
      const status = body.status;
      const code = body.code;
      const responseStatus = body.responseStatus === null || body.responseStatus === undefined
        ? null
        : Number.isInteger(body.responseStatus) && Number(body.responseStatus) >= 100 && Number(body.responseStatus) <= 599
          ? Number(body.responseStatus) : null;
      const jobsSeen = Number.isInteger(body.jobsSeen) && Number(body.jobsSeen) >= 0 && Number(body.jobsSeen) <= 10_000
        ? Number(body.jobsSeen) : null;
      const allowedStatuses = new Set<BrowserCrawlStatus>(["succeeded", "failed", "blocked"]);
      const allowedCodes = new Set<BrowserCrawlCode>([
        "jobs_recovered", "empty_board", "http_error", "blocked_challenge", "navigation_timeout",
        "navigation_error", "unsafe_listing", "ingest_error",
      ]);
      if (!sourceId || !allowedStatuses.has(status as BrowserCrawlStatus)
        || !allowedCodes.has(code as BrowserCrawlCode) || jobsSeen === null) {
        return json({ error: "A bounded browser crawl result is required." }, 400);
      }
      return json(await recordBrowserCrawlResult(
        db(), sourceId, status as BrowserCrawlStatus, responseStatus, jobsSeen, code as BrowserCrawlCode,
      ));
    }
    if (body.action === "crawlBatch") {
      const requested = typeof body.limit === "number" ? body.limit : 4;
      return json(await runCrawlBatch(requested));
    }
    if (body.action === "scheduledCrawlBatch") {
      const authorized = await verifyGithubActionsOidc(request.headers.get("authorization"));
      if (!authorized) return json({ error: "Scheduled crawl authorization is required." }, 401);
      const requested = typeof body.limit === "number" ? body.limit : 1;
      return json(await runCrawlBatch(requested));
    }
    if (body.action === "finalizeStaleCrawlRuns") {
      const authorized = codexReviewAuthorized(request) ||
        await verifyGithubActionsOidc(request.headers.get("authorization"));
      if (!authorized) return json({ error: "Crawler maintenance authorization is required." }, 401);
      const requested = typeof body.maximumAgeSeconds === "number" ? body.maximumAgeSeconds : 60;
      return json(await finalizeStaleCrawlRuns(db(), new Date().toISOString(), requested));
    }
    if (body.action === "backfillResumeMatches") {
      const requested = typeof body.limit === "number" ? body.limit : 500;
      const limit = Math.max(1, Math.min(500, Math.trunc(requested)));
      const afterId = typeof body.afterId === "string" && body.afterId.trim()
        ? body.afterId.trim().slice(0, 200)
        : null;
      return json(await backfillResumeMatches(db(), { afterId, limit }));
    }
    if (body.action === "submitCodexReview") {
      if (!codexReviewAuthorized(request)) return json({ error: "Codex review authorization is required." }, 401);
      const rawReviews = Array.isArray(body.reviews) ? body.reviews : [body];
      if (rawReviews.length > 100) {
        return json({ error: "Codex review batches are limited to 100 rows; submit additional chunks separately." }, 413);
      }
      const reviews = rawReviews.filter((value): value is CodexReviewInput => (
        Boolean(value && typeof value === "object")
      )).map((value) => ({
        jobId: typeof value.jobId === "string" ? value.jobId : undefined,
        officialUrl: typeof value.officialUrl === "string" ? value.officialUrl : undefined,
        decision: value.decision,
        rationale: value.rationale,
        verifiedUrl: value.verifiedUrl,
        sourceFile: typeof value.sourceFile === "string" ? value.sourceFile : undefined,
      }));
      if (reviews.length === 0) return json({ error: "At least one Codex review is required." }, 400);
      const result = await applyCodexReviews(db(), reviews);
      return json({ ...result, alerts: null });
    }
    if (body.action === "dispatchCodexReviewBatch") {
      if (!codexReviewAuthorized(request)) return json({ error: "Codex review authorization is required." }, 401);
      const exactJobIds = Array.isArray(body.jobIds)
        ? [...new Set(body.jobIds.filter((value): value is string => typeof value === "string")
          .map((value) => value.trim()).filter(Boolean))]
        : [];
      if (exactJobIds.length > 500) {
        return json({ error: "A single Codex Gmail batch is limited to 500 exact job IDs." }, 413);
      }
      if (exactJobIds.length === 0) {
        return json({ error: "dispatchCodexReviewBatch requires the exact approved job IDs." }, 400);
      }
      const alerts = await runResumeAlerts(db(), exactJobIds);
      return json({ alerts }, resumeAlertHttpStatus(alerts));
    }
    if (body.action === "repairBarclaysJobIdentity") {
      if (!codexReviewAuthorized(request)) return json({ error: "Codex review authorization is required." }, 401);
      const repair = normalizeBarclaysJobIdentityRepair(body);
      if (!repair) return json({ error: "A verified Barclays job identity is required." }, 400);
      const updated = await db().prepare(`
        UPDATE jobs
        SET requisition_id = ?,
            requisition_identity_key = 'req:p4-0225-barclays-us:' || lower(trim(?)),
            apply_url = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND source_id = 'p4-0225-barclays-us'
          AND official_url = ? AND status = 'open'
        RETURNING id
      `).bind(repair.requisitionId, repair.requisitionId, repair.applyUrl, repair.jobId, repair.officialUrl).first<{ id: string }>();
      if (!updated) return json({ error: "The current Barclays posting was not found." }, 404);
      const row = await db().prepare(`
        SELECT ${jobDetailProjection("j")}
        FROM jobs j WHERE j.id = ?
      `).bind(updated.id).first<JobViewRow>();
      return json(row ? mapJob(row) : null, row ? 200 : 404);
    }
    if (body.action === "repairVerifiedJobMetadata") {
      if (!codexReviewAuthorized(request)) return json({ error: "Codex review authorization is required." }, 401);
      const repair = normalizeVerifiedJobMetadataRepair(body);
      if (!repair) return json({ error: "A guarded verified job metadata repair is required." }, 400);
      const updated = await db().prepare(`
        UPDATE jobs
        SET title = ?,
            requisition_id = COALESCE(?, requisition_id),
            requisition_identity_key = CASE
              WHEN ? IS NOT NULL THEN 'req:' || source_id || ':' || lower(trim(?))
              ELSE requisition_identity_key
            END,
            source_updated_at = COALESCE(?, source_updated_at),
            published_at = COALESCE(?, published_at),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND official_url = ? AND title = ? AND status = 'open'
        RETURNING id
      `).bind(
        repair.verifiedTitle,
        repair.requisitionId,
        repair.requisitionId,
        repair.requisitionId,
        repair.sourceUpdatedAt,
        repair.publishedAt,
        repair.jobId,
        repair.officialUrl,
        repair.currentTitle,
      ).first<{ id: string }>();
      if (!updated) return json({ error: "The guarded current posting metadata no longer matches." }, 409);
      if (repair.season) {
        await db().batch([
          db().prepare("DELETE FROM job_topics WHERE job_id = ? AND topic_key LIKE 'season:%'").bind(repair.jobId),
          db().prepare("INSERT OR IGNORE INTO job_topics (job_id, topic_key) VALUES (?, ?)")
            .bind(repair.jobId, `season:${repair.season}`),
        ]);
      }
      const row = await db().prepare(`
        SELECT ${jobDetailProjection("j")}
        FROM jobs j WHERE j.id = ?
      `).bind(repair.jobId).first<JobViewRow>();
      return json({ repaired: true, job: row ? mapJob(row) : null });
    }
    if (body.action === "setResumeAlertEnabled") {
      const config = gmailRuntimeConfig();
      const enabled = body.enabled === true;
      if (enabled && !config) return json({ error: "Gmail must be connected before alerts can be enabled." }, 409);
      await setResumeAlertEnabled(db(), enabled, new Date().toISOString());
      return json(await resumeStatus());
    }
    if (body.action === "clearResumeAlertBacklog") {
      await clearResumeAlertBacklog(db(), "chanyoung-resume");
      return json(await resumeStatus());
    }
    if (body.action === "sendResumeTestEmail") {
      const config = gmailRuntimeConfig();
      if (!config) return json({ error: "Gmail is not configured." }, 409);
      const status = await resumeStatus();
      const result = await sendResumeTestEmail(config, status.recipients);
      await db().prepare(`
        UPDATE match_profiles
        SET gmail_state = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 'chanyoung-resume'
      `).bind(
        result.authBlocked > 0 ? "blocked" : "connected",
        result.failed === 0 ? null : result.authBlocked > 0
          ? "Gmail authorization is blocked."
          : "One or more Gmail connection tests failed temporarily.",
      ).run();
      return json(result, result.failed === 0 ? 200 : 502);
    }
    if (body.action === "retryResumeAlert") {
      if (!gmailRuntimeConfig()) return json({ error: "Gmail is not configured." }, 409);
      await retryResumeAlerts(db(), new Date().toISOString());
      return json(await resumeStatus());
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
      const afterId = typeof body.afterId === "string" && body.afterId.trim()
        ? body.afterId.trim().slice(0, 200)
        : null;
      return json(await backfillJobAreasAndRegions(db(), jobAreaRegionBackfillLimit(requested), afterId));
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
      const now = new Date();
      const store = new D1CrawlStore(db());
      const sources = await store.sourcesByIds(sourceIds, now.toISOString());
      return json(await runSpecificCrawls(store, sources, fetch, now, crawlBatchOptions(sources.length)));
    }
    if (body.action === "repairBrokenJobUrls") {
      const afterSourceId = typeof body.afterSourceId === "string"
        ? body.afterSourceId.trim().slice(0, 200)
        : "";
      const database = db();
      const selected = await database.prepare(`
        SELECT s.id, s.company, s.posting_url, s.adapter, s.next_crawl_at
        FROM sources s
        WHERE s.enabled = 1
          AND s.posting_url IS NOT NULL
          AND s.id > ?
          AND EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.source_id = s.id AND j.status = 'open'
              AND (
                j.official_url GLOB 'https://*.myworkdayjobs.com/job/*'
                OR j.official_url LIKE '%oraclecloud.com/en/sites/%/job/%/%'
                OR instr(j.official_url, '//jobs/') > 8
              )
          )
        ORDER BY s.id
        LIMIT 4
      `).bind(afterSourceId).all<UrlRepairSourceRow>();
      const sources = selected.results.map((row) => ({
        id: row.id,
        company: row.company,
        postingUrl: row.posting_url,
        adapter: row.adapter,
        nextCrawlAt: row.next_crawl_at,
      }));
      const result = await runSpecificCrawls(new D1CrawlStore(database), sources, fetch, new Date(), { concurrency: 2 });
      filterOptionsCache = null;
      return json({
        ...result,
        sourceIds: sources.map((source) => source.id),
        nextAfterSourceId: sources.at(-1)?.id ?? null,
      });
    }
    if (body.action === "repairCanonicalJobUrls") {
      const repairs = normalizeJobUrlRepairs(body.repairs);
      if (repairs.length === 0) return json({ error: "At least one valid same-origin URL repair is required." }, 400);
      const result = await db().prepare(`
        UPDATE jobs
        SET official_url = (
              SELECT json_extract(value, '$.officialUrl')
              FROM json_each(?1)
              WHERE json_extract(value, '$.id') = jobs.id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE status = 'open'
          AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
          AND official_url = (
            SELECT json_extract(value, '$.currentUrl')
            FROM json_each(?1)
            WHERE json_extract(value, '$.id') = jobs.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs target
            WHERE target.source_id = jobs.source_id
              AND target.official_url = (
                SELECT json_extract(value, '$.officialUrl')
                FROM json_each(?1)
                WHERE json_extract(value, '$.id') = jobs.id
              )
          )
        RETURNING id
      `).bind(JSON.stringify(repairs)).all<{ id: string }>();
      return json({ requested: repairs.length, updated: result.results.length, ids: result.results.map((row) => row.id) });
    }
    if (body.action === "closeDeadJobUrls") {
      const deadJobs = normalizeDeadJobUrls(body.jobs);
      if (deadJobs.length === 0) return json({ error: "At least one valid dead job URL is required." }, 400);
      const database = db();
      const closed = await database.prepare(`
        UPDATE jobs
        SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE status = 'open'
          AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
          AND official_url = (
            SELECT json_extract(value, '$.currentUrl')
            FROM json_each(?1)
            WHERE json_extract(value, '$.id') = jobs.id
          )
        RETURNING id
      `).bind(JSON.stringify(deadJobs)).all<{ id: string }>();
      if (closed.results.length > 0) {
        await database.prepare(`
          UPDATE job_matches
          SET is_active = 0
          WHERE job_id IN (SELECT value FROM json_each(?))
        `).bind(JSON.stringify(closed.results.map((row) => row.id))).run();
      }
      filterOptionsCache = null;
      return json({ requested: deadJobs.length, closed: closed.results.length, ids: closed.results.map((row) => row.id) });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "D1 mutation failed." }, 500);
  }
}
