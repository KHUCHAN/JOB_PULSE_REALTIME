import { env } from "cloudflare:workers";
import catalogSeed from "../../../db/seed/sources.json";
import type {
  ActivityEvent,
  CreateKeywordInput,
  JobState,
  KeywordRule,
  OverviewSnapshot,
  SourceRecord,
  TalentTarget,
} from "../../../lib/domain";
import { runDueCrawls } from "../../../lib/crawl-runner";
import { ensureCatalogSeeded, type CatalogSeed } from "../../../lib/catalog-bootstrap";
import { ftsQuery } from "../../../lib/job-search";
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

async function jobsFor(url: URL) {
  const clauses = ["j.status = 'open'"];
  const values: unknown[] = [];
  const q = url.searchParams.get("q")?.trim();
  const location = url.searchParams.get("location")?.trim();
  const arrangement = url.searchParams.get("arrangement");
  const reviewState = url.searchParams.get("status");
  const fullTextQuery = q ? ftsQuery(q) : "";
  if (fullTextQuery) {
    clauses.push("j.rowid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)");
    values.push(fullTextQuery);
  }
  if (location) {
    clauses.push("lower(coalesce(j.location, '')) LIKE ?");
    values.push(`%${location.toLowerCase()}%`);
  }
  if (["remote", "hybrid", "onsite"].includes(arrangement ?? "")) {
    clauses.push("j.arrangement = ?");
    values.push(arrangement);
  }
  if (["new", "saved", "hidden", "applied"].includes(reviewState ?? "")) {
    clauses.push("j.review_state = ?");
    values.push(reviewState);
  }
  const result = await db().prepare(`
    SELECT j.id, j.source_id, j.company, j.title, j.location, j.arrangement,
           substr(coalesce(j.summary, j.description), 1, 1200) AS summary,
           j.official_url, j.first_seen_at, j.last_seen_at, j.review_state
    FROM jobs j
    WHERE ${clauses.join(" AND ")}
    ORDER BY j.first_seen_at DESC, j.company ASC
    LIMIT 300
  `).bind(...values).all<JobViewRow>();
  return result.results.map(mapJob);
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
  const countRow = await db().prepare(`
    SELECT
      (SELECT count(*) FROM jobs WHERE status = 'open') AS open_jobs,
      (SELECT count(*) FROM sources WHERE enabled = 1 AND posting_url IS NOT NULL) AS active_sources,
      (SELECT count(*) FROM sources s WHERE (SELECT status FROM crawl_runs WHERE source_id=s.id ORDER BY coalesce(finished_at,started_at) DESC LIMIT 1) IN ('blocked','failed')) AS source_errors,
      (SELECT count(*) FROM keywords WHERE enabled = 1) AS unsent_alerts
  `).first<Counts>();
  const latest = await jobsFor(new URL("https://job-pulse.local/api/pulse?resource=jobs"));
  const activity = await activityFor(5);
  const talentCount = await db().prepare("SELECT count(*) AS count FROM talent_targets").first<{ count: number }>();
  return {
    newMatches: countRow?.open_jobs ?? 0,
    activeSources: countRow?.active_sources ?? 0,
    sourceErrors: countRow?.source_errors ?? 0,
    unsentAlerts: countRow?.unsent_alerts ?? 0,
    openTalentTasks: talentCount?.count ?? 0,
    latestJobs: latest.slice(0, 5),
    recentActivity: activity,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    await ensureCatalogSeeded(db(), catalogSeed as CatalogSeed);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    if (resource === "jobs") return json(await jobsFor(url));
    if (resource === "job") {
      const row = await db().prepare(`
        SELECT id, source_id, company, title, location, arrangement,
               substr(coalesce(summary, description), 1, 1200) AS summary,
               official_url, first_seen_at, last_seen_at, review_state
        FROM jobs WHERE id = ?
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
    if (body.action === "crawlBatch") {
      const requested = typeof body.limit === "number" ? body.limit : 8;
      const limit = Math.max(1, Math.min(16, requested));
      return json(await runDueCrawls(new D1CrawlStore(db()), fetch, new Date(), { concurrency: 4, limit }));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "D1 mutation failed." }, 500);
  }
}
