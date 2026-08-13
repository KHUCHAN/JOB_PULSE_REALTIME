import type { CrawlStore, PersistedSource } from "../lib/crawl-runner";
import type { CrawledFacet, CrawledJob } from "../lib/crawler";
import { classifyJobAreas, jobAreaClassificationMarker } from "../lib/job-area-classifier";
import { classifyJobRegion } from "../lib/job-region-classifier";
import { classifyAiDataJob } from "../lib/job-topic-classifier";
import { classifyJobPrograms } from "../lib/job-program-classifier";
import { classifyRecruitingYears } from "../lib/job-recruiting-year-classifier";
import { normalizeEmploymentType } from "../lib/employment-type";
import { syncResumeMatchesForUrls } from "../lib/resume-match-store";

type SourceRow = {
  id: string;
  company: string;
  posting_url: string;
  adapter: PersistedSource["adapter"];
  next_crawl_at: string | null;
};

type ExistingJobRow = {
  id: string;
  external_id: string | null;
  title: string;
  official_url: string;
  status: "open" | "closed";
  resume_match_hash: string | null;
};

type PagedCrawlState = {
  nextPage: number;
  cycleStartedAt: string;
  previousCycleStartedAt?: string | null;
};

const pagedCrawlStateKey = (sourceId: string): string => `crawl_page_checkpoint:${sourceId}`;

const isNavigationArtifact = (job: ExistingJobRow): boolean => {
  const title = job.title.replace(/\s+/g, " ").trim();
  if (/\.(?:pdf|docx?)(?:[?#]|$)/i.test(job.official_url)) return true;
  return /^(?:home|sites|university|university overview|recruitment fraud|saved jobs(?:\s*0)?|go to saved jobs(?:\s*0)?|know your rights|job listing|students and graduates)$/i.test(title);
};

export const chunksOf = <T>(values: T[], size: number): T[][] => {
  if (!Number.isInteger(size) || size < 1) throw new Error("Chunk size must be a positive integer.");
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

export const chunksByJsonBytes = <T>(values: T[], maxBytes: number, maxSingleBytes = maxBytes): T[][] => {
  if (!Number.isInteger(maxBytes) || maxBytes < 3) throw new Error("JSON chunk size must be at least 3 bytes.");
  if (!Number.isInteger(maxSingleBytes) || maxSingleBytes < maxBytes) throw new Error("Single-record limit must be at least the chunk limit.");
  const encoder = new TextEncoder();
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let chunkBytes = 2;

  for (const value of values) {
    const valueBytes = encoder.encode(JSON.stringify(value)).byteLength;
    const candidateBytes = chunkBytes + valueBytes + (chunk.length > 0 ? 1 : 0);
    if (candidateBytes > maxBytes) {
      if (chunk.length > 0) chunks.push(chunk);
      const singletonBytes = valueBytes + 2;
      if (singletonBytes > maxSingleBytes) {
        throw new Error("A single job exceeds the D1 JSON payload limit.");
      }
      if (singletonBytes > maxBytes) {
        chunks.push([value]);
        chunk = [];
        chunkBytes = 2;
      } else {
        chunk = [value];
        chunkBytes = singletonBytes;
      }
    } else {
      chunk.push(value);
      chunkBytes = candidateBytes;
    }
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
};

export const compactRecord = (record: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
);

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const boundedJobRecord = (record: Record<string, unknown>, maxBytes = 1_499_800): Record<string, unknown> => {
  const bounded = compactRecord(record);
  const fits = (): boolean => jsonBytes([bounded]) <= maxBytes;
  if (fits()) return bounded;

  delete bounded.rawPayload;
  if (fits()) return bounded;

  const textFields = [
    "description", "responsibilities", "qualifications", "benefits", "educationRequirements",
    "experienceRequirements", "summary", "sourcePostedText",
  ];
  const arrayFields = ["skills", "secondaryLocations", "languages"];
  for (const limit of [100_000, 20_000, 2_000]) {
    for (const key of textFields) {
      const value = bounded[key];
      if (typeof value === "string" && value.length > limit) bounded[key] = value.slice(0, limit);
    }
    for (const key of arrayFields) {
      const value = bounded[key];
      if (Array.isArray(value) && value.length > 100) bounded[key] = value.slice(0, 100);
    }
    if (fits()) return bounded;
  }

  for (const key of textFields) delete bounded[key];
  for (const key of ["department", "team", "businessUnit", "jobFamily", "jobFunction", "industry", "office"]) delete bounded[key];
  if (fits()) return bounded;
  throw new Error("A single job's required fields exceed the D1 JSON payload limit.");
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const derivedFacets = (jobs: CrawledJob[]): CrawledFacet[] => {
  const definitions: Array<{ key: string; label: string; values: (job: CrawledJob) => string[] }> = [
    { key: "department", label: "Department", values: (job) => job.department ? [job.department] : [] },
    { key: "team", label: "Team", values: (job) => job.team ? [job.team] : [] },
    { key: "businessUnit", label: "Business Unit", values: (job) => job.businessUnit ? [job.businessUnit] : [] },
    { key: "jobFamily", label: "Job Family", values: (job) => job.jobFamily ? [job.jobFamily] : [] },
    { key: "jobFunction", label: "Job Function", values: (job) => job.jobFunction ? [job.jobFunction] : [] },
    { key: "industry", label: "Industry", values: (job) => job.industry ? [job.industry] : [] },
    { key: "employmentType", label: "Employment Type", values: (job) => {
      const employmentType = normalizeEmploymentType(job.employmentType)
        ?? (classifyJobPrograms(job.title).keys.length > 0 ? "Internship" : null);
      return employmentType ? [employmentType] : [];
    } },
    { key: "arrangement", label: "Workplace Type", values: (job) => job.arrangement !== "unknown" ? [job.arrangement] : [] },
    { key: "city", label: "City", values: (job) => job.locationCity ? [job.locationCity] : [] },
    { key: "state", label: "State", values: (job) => job.locationState ? [job.locationState] : [] },
    { key: "country", label: "Country", values: (job) => job.locationCountry ? [job.locationCountry] : [] },
    { key: "experienceLevel", label: "Experience Level", values: (job) => job.experienceLevel ? [job.experienceLevel] : [] },
    { key: "skills", label: "Skills", values: (job) => job.skills ?? [] },
  ];
  return definitions.flatMap((definition) => {
    const counts = new Map<string, number>();
    for (const job of jobs) for (const value of definition.values(job)) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts.size > 0 ? [{
      key: definition.key,
      label: definition.label,
      values: [...counts].map(([value, count]) => ({ key: value, label: value, count })),
    }] : [];
  });
};

const mergedFacets = (nativeFacets: CrawledFacet[] | undefined, jobs: CrawledJob[]): CrawledFacet[] => {
  const merged = new Map<string, { label: string; values: Map<string, { label: string; count: number | null }> }>();
  for (const facet of [...(nativeFacets ?? []), ...derivedFacets(jobs)]) {
    const target = merged.get(facet.key) ?? { label: facet.label, values: new Map() };
    for (const value of facet.values) if (!target.values.has(value.key)) target.values.set(value.key, { label: value.label, count: value.count });
    merged.set(facet.key, target);
  }
  return [...merged].map(([key, facet]) => ({
    key,
    label: facet.label,
    values: [...facet.values].map(([valueKey, value]) => ({ key: valueKey, ...value })),
  }));
};

export class D1CrawlStore implements CrawlStore {
  constructor(private readonly db: D1Database) {}

  private async hydratePagedCrawlState(sources: PersistedSource[]): Promise<PersistedSource[]> {
    if (sources.length === 0) return sources;
    const checkpointKeys = sources.map((source) => pagedCrawlStateKey(source.id));
    const checkpointResult = await this.db.prepare(`
      SELECT key, value FROM catalog_state
      WHERE key IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(checkpointKeys)).all<{ key: string; value: string }>();
    const checkpoints = new Map(checkpointResult.results.map((row) => [row.key, row.value]));
    for (const source of sources) {
      const value = checkpoints.get(pagedCrawlStateKey(source.id));
      if (!value) continue;
      try {
        const checkpoint = JSON.parse(value) as Partial<PagedCrawlState>;
        if (Number.isInteger(checkpoint.nextPage) && Number(checkpoint.nextPage) > 0 && typeof checkpoint.cycleStartedAt === "string") {
          source.crawlPageCursor = Number(checkpoint.nextPage);
          source.crawlCycleStartedAt = checkpoint.cycleStartedAt;
          source.crawlPreviousCycleStartedAt = typeof checkpoint.previousCycleStartedAt === "string"
            ? checkpoint.previousCycleStartedAt
            : null;
        }
      } catch {
        // Ignore a malformed checkpoint and restart from page one safely.
      }
    }
    return sources;
  }

  async dueSources(now: string, limit: number): Promise<PersistedSource[]> {
    const leaseUntil = new Date(new Date(now).getTime() + 10 * 60 * 1000).toISOString();
    const result = await this.db.prepare(`
      UPDATE sources
      SET next_crawl_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM sources
        WHERE enabled = 1
          AND posting_url IS NOT NULL
          AND (next_crawl_at IS NULL OR next_crawl_at <= ?)
        ORDER BY COALESCE(next_crawl_at, '') ASC, company ASC
        LIMIT ?
      )
      RETURNING id, company, posting_url, adapter, next_crawl_at
    `).bind(leaseUntil, now, limit).all<SourceRow>();

    const sources: PersistedSource[] = result.results.map((row) => ({
      id: row.id,
      company: row.company,
      postingUrl: row.posting_url,
      adapter: row.adapter,
      nextCrawlAt: row.next_crawl_at,
    }));
    return this.hydratePagedCrawlState(sources);
  }

  async sourcesByIds(sourceIds: string[], now: string): Promise<PersistedSource[]> {
    if (sourceIds.length === 0) return [];
    const leaseUntil = new Date(new Date(now).getTime() + 10 * 60 * 1000).toISOString();
    const result = await this.db.prepare(`
      UPDATE sources
      SET next_crawl_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE enabled = 1
        AND posting_url IS NOT NULL
        AND id IN (SELECT value FROM json_each(?))
      RETURNING id, company, posting_url, adapter, next_crawl_at
    `).bind(leaseUntil, JSON.stringify(sourceIds)).all<SourceRow>();
    const sources: PersistedSource[] = result.results.map((row) => ({
      id: row.id,
      company: row.company,
      postingUrl: row.posting_url,
      adapter: row.adapter,
      nextCrawlAt: row.next_crawl_at,
    }));
    return this.hydratePagedCrawlState(sources);
  }

  async updateResolvedListing(
    sourceId: string,
    previousUrl: string,
    postingUrl: string,
    adapter: PersistedSource["adapter"],
  ): Promise<void> {
    await this.db.prepare(`
      UPDATE sources
      SET posting_url = ?, adapter = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND posting_url = ?
    `).bind(postingUrl, adapter, sourceId, previousUrl).run();
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

  async advancePagedCrawl(
    sourceId: string,
    pagination: { nextPage: number; cycleComplete: boolean; totalPages: number },
    cycleStartedAt: string,
    previousCycleStartedAt: string | null,
  ): Promise<{ closed: number }> {
    const key = pagedCrawlStateKey(sourceId);
    if (!pagination.cycleComplete) {
      await this.db.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).bind(key, JSON.stringify({ nextPage: pagination.nextPage, cycleStartedAt, previousCycleStartedAt })).run();
      return { closed: 0 };
    }

    const now = new Date().toISOString();
    let closedCount = 0;
    if (previousCycleStartedAt) {
      const closed = await this.db.prepare(`
        UPDATE jobs
        SET status = 'closed', closed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND status = 'open' AND last_seen_at < ?
      `).bind(now, sourceId, previousCycleStartedAt).run();
      closedCount = Number(closed.meta?.changes ?? 0);
    }
    await this.db.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(key, JSON.stringify({
      nextPage: 1,
      cycleStartedAt: now,
      previousCycleStartedAt: cycleStartedAt,
    })).run();
    return { closed: closedCount };
  }

  async syncJobs(
    sourceId: string,
    jobs: CrawledJob[],
    completeListing: boolean,
    facets?: CrawledFacet[],
    options: { suppressNotifications?: boolean } = {},
  ): Promise<{ created: number; updated: number; closed: number }> {
    const now = new Date().toISOString();
    const sourceResult = await this.db.prepare(`
      SELECT company, posting_url FROM sources WHERE id = ? LIMIT 1
    `).bind(sourceId).all<{ company: string; posting_url: string }>();
    const source = sourceResult.results[0] ?? { company: null, posting_url: null };
    const existingResult = await this.db.prepare(`
      SELECT id, external_id, title, official_url, status, resume_match_hash FROM jobs WHERE source_id = ?
    `).bind(sourceId).all<ExistingJobRow>();
    const existingByUrl = new Map(existingResult.results.map((row) => [row.official_url, row]));
    const existingByExternalId = new Map(existingResult.results.flatMap((row) =>
      row.external_id ? [[row.external_id, row] as const] : [],
    ));
    const existingUrls = new Set(existingResult.results
      .filter((row) => row.status === "open")
      .map((row) => row.official_url));
    const visibleUrls = new Set(jobs.map((job) => job.officialUrl));
    const resumeTouchedUrls = new Set<string>();
    const notificationEligibleUrls = new Set<string>();
    // A source with no real catalog rows is being initialized. Its first
    // complete feed is a baseline, not a set of newly published jobs.
    const hasPriorCatalogRows = existingResult.results.some((row) => !isNavigationArtifact(row));
    const allowNewJobNotifications = !options.suppressNotifications && hasPriorCatalogRows;
    const recordFor = async (job: CrawledJob): Promise<Record<string, unknown>> => {
      const aiData = classifyAiDataJob(job);
      const areaMemberships = classifyJobAreas(job).map((area) => ({
        topicKey: `area:${area.areaKey}`,
        score: area.score,
        evidence: area.evidence,
      }));
      const locationRegion = classifyJobRegion({
        ...job,
        sourceCompany: source.company,
        sourcePostingUrl: source.posting_url,
      });
      const titlePrograms = classifyJobPrograms(job.title);
      const employmentType = normalizeEmploymentType(job.employmentType)
        ?? (titlePrograms.keys.length > 0 ? "Internship" : null);
      const programKeys = [...titlePrograms.keys];
      const programEvidence = { ...titlePrograms.evidence };
      if (employmentType?.split(" / ").includes("Internship") && !programKeys.includes("internship")) {
        programKeys.push("internship");
        programEvidence.internship = "employment_type:internship";
      }
      const recruitingYears = classifyRecruitingYears({
        title: job.title,
        summary: job.summary,
        description: job.description,
        location: job.location,
        locationCountry: job.locationCountry,
        publishedAt: job.publishedAt,
        programKeys,
      });
      const record = boundedJobRecord({
        id: crypto.randomUUID(), sourceId, externalId: job.externalId, title: job.title,
        company: job.company, location: job.location, arrangement: job.arrangement,
        employmentType, summary: job.summary, description: job.description ?? null,
        responsibilities: job.responsibilities ?? null, qualifications: job.qualifications ?? null,
        skills: job.skills ?? [], department: job.department ?? null, team: job.team ?? null,
        businessUnit: job.businessUnit ?? null, jobFamily: job.jobFamily ?? null,
        jobFunction: job.jobFunction ?? null, industry: job.industry ?? null, office: job.office ?? null,
        secondaryLocations: job.secondaryLocations ?? [], locationCity: job.locationCity ?? null,
        locationState: job.locationState ?? null, locationCountry: job.locationCountry ?? null,
        locationRegion,
        locationPostalCode: job.locationPostalCode ?? null, latitude: job.latitude ?? null, longitude: job.longitude ?? null,
        salaryMin: job.salaryMin ?? null, salaryMax: job.salaryMax ?? null,
        salaryCurrency: job.salaryCurrency ?? null, salaryInterval: job.salaryInterval ?? null,
        benefits: job.benefits ?? null, educationRequirements: job.educationRequirements ?? null,
        experienceRequirements: job.experienceRequirements ?? null, experienceLevel: job.experienceLevel ?? null,
        shiftSchedule: job.shiftSchedule ?? null, travelRequirements: job.travelRequirements ?? null,
        securityClearance: job.securityClearance ?? null, languages: job.languages ?? [],
        requisitionId: job.requisitionId ?? null, applyUrl: job.applyUrl ?? null,
        sourcePostedText: job.sourcePostedText ?? null, sourceUpdatedAt: job.sourceUpdatedAt ?? null,
        validThrough: job.validThrough ?? null, rawPayload: job.rawPayload ?? null,
        officialUrl: job.officialUrl, publishedAt: job.publishedAt, firstSeenAt: now, lastSeenAt: now,
        topicClassifiedAt: now, aiDataMatched: aiData.matched, aiDataScore: aiData.score,
        aiDataEvidence: aiData.evidence,
        areaClassifiedAt: jobAreaClassificationMarker(now), areaMemberships,
        programKeys, programEvidence,
        recruitingYears: recruitingYears.years,
        recruitingYearEvidence: recruitingYears.evidence,
      });
      const descriptionValue = typeof record.description === "string"
        ? record.description
        : typeof record.summary === "string" ? record.summary : null;
      if (descriptionValue) record.descriptionHash = await sha256(descriptionValue);
      record.resumeMatchHash = await sha256(JSON.stringify({
        title: record.title,
        company: record.company,
        locationRegion: record.locationRegion,
        summary: record.summary,
        description: record.description,
        responsibilities: record.responsibilities,
        qualifications: record.qualifications,
        skills: record.skills,
        jobFamily: record.jobFamily,
        jobFunction: record.jobFunction,
        educationRequirements: record.educationRequirements,
        experienceRequirements: record.experienceRequirements,
        securityClearance: record.securityClearance,
        publishedAt: record.publishedAt,
        programKeys: record.programKeys,
        recruitingYears: record.recruitingYears,
      }));
      return record;
    };

    // Bound JSON parameters below D1's 2 MB row/string limit while packing enough
    // jobs per query to stay inside the free-tier 50-query invocation budget.
    for (const jobsChunk of chunksOf(jobs, 2_500)) {
      const records = await Promise.all(jobsChunk.map(recordFor));
      const urlRepairs = records.flatMap((record) => {
        const externalId = typeof record.externalId === "string" ? record.externalId : null;
        const officialUrl = String(record.officialUrl);
        const existing = externalId ? existingByExternalId.get(externalId) : null;
        return existing && existing.official_url !== officialUrl && !existingByUrl.has(officialUrl)
          ? [{ id: existing.id, officialUrl }]
          : [];
      });
      for (const repairChunk of chunksByJsonBytes(urlRepairs, 1_500_000)) {
        await this.db.prepare(`
          UPDATE jobs
          SET official_url = (
                SELECT json_extract(value, '$.officialUrl')
                FROM json_each(?1)
                WHERE json_extract(value, '$.id') = jobs.id
              ),
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
        `).bind(JSON.stringify(repairChunk)).run();
        for (const repair of repairChunk) {
          const existing = existingResult.results.find((row) => row.id === repair.id);
          if (!existing) continue;
          existingByUrl.delete(existing.official_url);
          if (existingUrls.delete(existing.official_url)) existingUrls.add(repair.officialUrl);
          existing.official_url = repair.officialUrl;
          existingByUrl.set(repair.officialUrl, existing);
        }
      }
      for (const record of records) {
        const officialUrl = String(record.officialUrl);
        const previous = existingByUrl.get(officialUrl);
        if (!previous && allowNewJobNotifications) notificationEligibleUrls.add(officialUrl);
        if (previous && allowNewJobNotifications && previous.resume_match_hash !== record.resumeMatchHash
          && record.locationRegion === "us"
          && (record.programKeys as string[]).some((key) => key === "internship" || key === "coop")
          && (record.recruitingYears as number[]).includes(2027)) {
          // Recovery path: a previously seen posting can become newly
          // eligible after a crawler fixes missing region/program metadata.
          notificationEligibleUrls.add(officialUrl);
        }
        if (!previous || previous.status === "closed" || previous.resume_match_hash !== record.resumeMatchHash) {
          resumeTouchedUrls.add(officialUrl);
        }
      }
      for (const recordsChunk of chunksByJsonBytes(records, 1_500_000)) {
        await this.db.prepare(`
        INSERT INTO jobs (
          id, source_id, external_id, title, company, location, arrangement,
          employment_type, summary, description_hash, official_url, status,
          description, responsibilities, qualifications, skills, department, team, business_unit,
          job_family, job_function, industry, office, secondary_locations, location_city, location_state,
          location_country, location_region, location_postal_code, latitude, longitude, salary_min, salary_max,
          salary_currency, salary_interval, benefits, education_requirements, experience_requirements,
          experience_level, shift_schedule, travel_requirements, security_clearance, languages,
          requisition_id, apply_url, source_posted_text, source_updated_at, valid_through, raw_payload,
          published_at, first_seen_at, last_seen_at, closed_at, topic_classified_at, area_classified_at,
          open_generation, reopened_at, resume_match_hash
        )
        SELECT
          json_extract(value, '$.id'), json_extract(value, '$.sourceId'),
          json_extract(value, '$.externalId'), json_extract(value, '$.title'),
          json_extract(value, '$.company'), json_extract(value, '$.location'),
          json_extract(value, '$.arrangement'), json_extract(value, '$.employmentType'),
          json_extract(value, '$.summary'), json_extract(value, '$.descriptionHash'),
          json_extract(value, '$.officialUrl'), 'open', json_extract(value, '$.description'),
          json_extract(value, '$.responsibilities'), json_extract(value, '$.qualifications'), json_extract(value, '$.skills'),
          json_extract(value, '$.department'), json_extract(value, '$.team'), json_extract(value, '$.businessUnit'),
          json_extract(value, '$.jobFamily'), json_extract(value, '$.jobFunction'), json_extract(value, '$.industry'),
          json_extract(value, '$.office'), json_extract(value, '$.secondaryLocations'), json_extract(value, '$.locationCity'),
          json_extract(value, '$.locationState'), json_extract(value, '$.locationCountry'), json_extract(value, '$.locationRegion'),
          json_extract(value, '$.locationPostalCode'),
          json_extract(value, '$.latitude'), json_extract(value, '$.longitude'), json_extract(value, '$.salaryMin'),
          json_extract(value, '$.salaryMax'), json_extract(value, '$.salaryCurrency'), json_extract(value, '$.salaryInterval'),
          json_extract(value, '$.benefits'), json_extract(value, '$.educationRequirements'), json_extract(value, '$.experienceRequirements'),
          json_extract(value, '$.experienceLevel'), json_extract(value, '$.shiftSchedule'), json_extract(value, '$.travelRequirements'),
          json_extract(value, '$.securityClearance'), json_extract(value, '$.languages'), json_extract(value, '$.requisitionId'),
          json_extract(value, '$.applyUrl'), json_extract(value, '$.sourcePostedText'), json_extract(value, '$.sourceUpdatedAt'),
          json_extract(value, '$.validThrough'), json_extract(value, '$.rawPayload'), json_extract(value, '$.publishedAt'),
          json_extract(value, '$.firstSeenAt'), json_extract(value, '$.lastSeenAt'), NULL,
          json_extract(value, '$.topicClassifiedAt'), json_extract(value, '$.areaClassifiedAt'), 1, NULL,
          json_extract(value, '$.resumeMatchHash')
        FROM json_each(?)
        WHERE true
        ON CONFLICT(source_id, official_url) DO UPDATE SET
          external_id = COALESCE(excluded.external_id, jobs.external_id),
          title = excluded.title,
          company = excluded.company,
          location = COALESCE(excluded.location, jobs.location),
          arrangement = CASE WHEN excluded.arrangement = 'unknown' THEN jobs.arrangement ELSE excluded.arrangement END,
          employment_type = COALESCE(excluded.employment_type, jobs.employment_type),
          summary = COALESCE(excluded.summary, jobs.summary),
          description = COALESCE(excluded.description, jobs.description),
          responsibilities = COALESCE(excluded.responsibilities, jobs.responsibilities),
          qualifications = COALESCE(excluded.qualifications, jobs.qualifications),
          skills = CASE WHEN excluded.skills <> '[]' THEN excluded.skills ELSE jobs.skills END,
          department = COALESCE(excluded.department, jobs.department),
          team = COALESCE(excluded.team, jobs.team),
          business_unit = COALESCE(excluded.business_unit, jobs.business_unit),
          job_family = COALESCE(excluded.job_family, jobs.job_family),
          job_function = COALESCE(excluded.job_function, jobs.job_function),
          industry = COALESCE(excluded.industry, jobs.industry),
          office = COALESCE(excluded.office, jobs.office),
          secondary_locations = CASE WHEN excluded.secondary_locations <> '[]' THEN excluded.secondary_locations ELSE jobs.secondary_locations END,
          location_city = COALESCE(excluded.location_city, jobs.location_city),
          location_state = COALESCE(excluded.location_state, jobs.location_state),
          location_country = COALESCE(excluded.location_country, jobs.location_country),
          location_region = CASE WHEN excluded.location_region = 'unknown' AND jobs.location_region IS NOT NULL
            THEN jobs.location_region ELSE excluded.location_region END,
          location_postal_code = COALESCE(excluded.location_postal_code, jobs.location_postal_code),
          latitude = COALESCE(excluded.latitude, jobs.latitude),
          longitude = COALESCE(excluded.longitude, jobs.longitude),
          salary_min = COALESCE(excluded.salary_min, jobs.salary_min),
          salary_max = COALESCE(excluded.salary_max, jobs.salary_max),
          salary_currency = COALESCE(excluded.salary_currency, jobs.salary_currency),
          salary_interval = COALESCE(excluded.salary_interval, jobs.salary_interval),
          benefits = COALESCE(excluded.benefits, jobs.benefits),
          education_requirements = COALESCE(excluded.education_requirements, jobs.education_requirements),
          experience_requirements = COALESCE(excluded.experience_requirements, jobs.experience_requirements),
          experience_level = COALESCE(excluded.experience_level, jobs.experience_level),
          shift_schedule = COALESCE(excluded.shift_schedule, jobs.shift_schedule),
          travel_requirements = COALESCE(excluded.travel_requirements, jobs.travel_requirements),
          security_clearance = COALESCE(excluded.security_clearance, jobs.security_clearance),
          languages = CASE WHEN excluded.languages <> '[]' THEN excluded.languages ELSE jobs.languages END,
          requisition_id = COALESCE(excluded.requisition_id, jobs.requisition_id),
          apply_url = COALESCE(excluded.apply_url, jobs.apply_url),
          source_posted_text = COALESCE(excluded.source_posted_text, jobs.source_posted_text),
          source_updated_at = COALESCE(excluded.source_updated_at, jobs.source_updated_at),
          valid_through = COALESCE(excluded.valid_through, jobs.valid_through),
          raw_payload = COALESCE(excluded.raw_payload, jobs.raw_payload),
          description_hash = COALESCE(excluded.description_hash, jobs.description_hash),
          open_generation = CASE
            WHEN jobs.status = 'closed' THEN jobs.open_generation + 1
            ELSE jobs.open_generation
          END,
          reopened_at = CASE
            WHEN jobs.status = 'closed' THEN excluded.last_seen_at
            ELSE jobs.reopened_at
          END,
          resume_match_hash = excluded.resume_match_hash,
          status = 'open',
          published_at = COALESCE(excluded.published_at, jobs.published_at),
          last_seen_at = excluded.last_seen_at,
          topic_classified_at = excluded.topic_classified_at,
          area_classified_at = excluded.area_classified_at,
          closed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        `).bind(JSON.stringify(recordsChunk)).run();

        const topicMatches = recordsChunk
          .filter((record) => record.aiDataMatched === true)
          .map((record) => ({
            sourceId: record.sourceId,
            officialUrl: record.officialUrl,
            score: record.aiDataScore,
            evidence: record.aiDataEvidence,
            classifiedAt: record.topicClassifiedAt,
          }));
        if (topicMatches.length > 0) {
          await this.db.prepare(`
            INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
            SELECT jobs.id, 'ai-data', json_extract(value, '$.score'),
                   json_extract(value, '$.evidence'), json_extract(value, '$.classifiedAt')
            FROM json_each(?)
            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                     AND jobs.official_url = json_extract(value, '$.officialUrl')
            WHERE true
            ON CONFLICT(job_id, topic_key) DO UPDATE SET
              score = excluded.score,
              evidence = excluded.evidence,
              classified_at = excluded.classified_at
          `).bind(JSON.stringify(topicMatches)).run();
        }

        const topicNonmatches = recordsChunk
          .filter((record) => record.aiDataMatched !== true)
          .map((record) => ({ sourceId: record.sourceId, officialUrl: record.officialUrl }));
        if (topicNonmatches.length > 0) {
          await this.db.prepare(`
            DELETE FROM job_topics
            WHERE topic_key = 'ai-data'
              AND job_id IN (
                SELECT jobs.id
                FROM json_each(?)
                JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                         AND jobs.official_url = json_extract(value, '$.officialUrl')
              )
          `).bind(JSON.stringify(topicNonmatches)).run();
        }

        const processedAreas = recordsChunk.map((record) => ({
          sourceId: record.sourceId,
          officialUrl: record.officialUrl,
        }));
        await this.db.prepare(`
          DELETE FROM job_topics
          WHERE topic_key LIKE 'area:%' AND job_id IN (
            SELECT jobs.id
            FROM json_each(?)
            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                     AND jobs.official_url = json_extract(value, '$.officialUrl')
          )
        `).bind(JSON.stringify(processedAreas)).run();
        const areaMemberships = recordsChunk.flatMap((record) =>
          (record.areaMemberships as Array<{ topicKey: string; score: number; evidence: string[] }>).map((area) => ({
            sourceId: record.sourceId,
            officialUrl: record.officialUrl,
            areaKey: area.topicKey.slice("area:".length),
            score: area.score,
            evidence: area.evidence,
            classifiedAt: record.areaClassifiedAt,
          })),
        );
        for (const membershipChunk of chunksByJsonBytes(areaMemberships, 1_500_000)) {
          await this.db.prepare(`
            INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
            SELECT jobs.id, 'area:' || json_extract(value, '$.areaKey'),
                   json_extract(value, '$.score'), json_extract(value, '$.evidence'),
                   json_extract(value, '$.classifiedAt')
            FROM json_each(?)
            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                     AND jobs.official_url = json_extract(value, '$.officialUrl')
            WHERE true
            ON CONFLICT(job_id, topic_key) DO UPDATE SET
              score = excluded.score,
              evidence = excluded.evidence,
              classified_at = excluded.classified_at
          `).bind(JSON.stringify(membershipChunk)).run();
        }
      }

      const processedPrograms = records.map((record) => ({
        sourceId: record.sourceId,
        officialUrl: record.officialUrl,
      }));
      for (const chunk of chunksByJsonBytes(processedPrograms, 1_500_000)) {
        await this.db.prepare(`
          DELETE FROM job_topics
          WHERE topic_key LIKE 'program:%' AND job_id IN (
            SELECT jobs.id
            FROM json_each(?)
            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                     AND jobs.official_url = json_extract(value, '$.officialUrl')
          )
        `).bind(JSON.stringify(chunk)).run();
      }
      const programMemberships = records.flatMap((record) =>
        (record.programKeys as string[]).map((programKey) => ({
          sourceId: record.sourceId,
          officialUrl: record.officialUrl,
          programKey,
          evidence: (record.programEvidence as Record<string, string>)[programKey],
          classifiedAt: record.lastSeenAt,
        }))
      );
      for (const chunk of chunksByJsonBytes(programMemberships, 1_500_000)) {
        await this.db.prepare(`
          INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
          SELECT jobs.id, 'program:' || json_extract(value, '$.programKey'), 1,
                 json_array(json_extract(value, '$.evidence')), json_extract(value, '$.classifiedAt')
          FROM json_each(?)
          JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                   AND jobs.official_url = json_extract(value, '$.officialUrl')
          WHERE true
          ON CONFLICT(job_id, topic_key) DO UPDATE SET
            score = excluded.score,
            evidence = excluded.evidence,
            classified_at = excluded.classified_at
        `).bind(JSON.stringify(chunk)).run();
      }

      const processedYears = records.map((record) => ({
        sourceId: record.sourceId,
        officialUrl: record.officialUrl,
      }));
      for (const chunk of chunksByJsonBytes(processedYears, 1_500_000)) {
        await this.db.prepare(`
          DELETE FROM job_topics
          WHERE topic_key LIKE 'year:%' AND job_id IN (
            SELECT jobs.id
            FROM json_each(?)
            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                     AND jobs.official_url = json_extract(value, '$.officialUrl')
          )
        `).bind(JSON.stringify(chunk)).run();
      }
      const yearMemberships = records.flatMap((record) =>
        (record.recruitingYears as number[]).map((year) => ({
          sourceId: record.sourceId,
          officialUrl: record.officialUrl,
          year,
          evidence: (record.recruitingYearEvidence as Record<string, string>)[year],
          classifiedAt: record.lastSeenAt,
        }))
      );
      for (const chunk of chunksByJsonBytes(yearMemberships, 1_500_000)) {
        await this.db.prepare(`
          INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
          SELECT jobs.id, 'year:' || json_extract(value, '$.year'), 1,
                 json_array(json_extract(value, '$.evidence')), json_extract(value, '$.classifiedAt')
          FROM json_each(?)
          JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')
                   AND jobs.official_url = json_extract(value, '$.officialUrl')
          WHERE true
          ON CONFLICT(job_id, topic_key) DO UPDATE SET
            score = excluded.score,
            evidence = excluded.evidence,
            classified_at = excluded.classified_at
        `).bind(JSON.stringify(chunk)).run();
      }
    }

    await syncResumeMatchesForUrls(
      this.db,
      sourceId,
      [...resumeTouchedUrls],
      now,
      [...notificationEligibleUrls],
    );

    if (options.suppressNotifications) {
      // Remove any queued items created by an earlier page of this same
      // initial catalog walk. Sent mail is intentionally preserved; only
      // unsent inventory is reclassified as baseline.
      await this.db.batch([
        this.db.prepare(`
          DELETE FROM notification_items
          WHERE job_match_id IN (
            SELECT jm.id
            FROM job_matches jm
            JOIN jobs j ON j.id = jm.job_id
            JOIN notification_items ni ON ni.job_match_id = jm.id
            JOIN notifications n ON n.id = ni.notification_id
            WHERE j.source_id = ? AND jm.notified_at IS NULL AND n.status <> 'sent'
          )
        `).bind(sourceId),
        this.db.prepare(`
          DELETE FROM notifications
          WHERE status <> 'sent' AND NOT EXISTS (
            SELECT 1 FROM notification_items WHERE notification_id = notifications.id
          )
        `),
        this.db.prepare(`
          UPDATE job_matches
          SET notification_eligible = 0
          WHERE notified_at IS NULL
            AND job_id IN (SELECT id FROM jobs WHERE source_id = ?)
        `).bind(sourceId),
      ]);
    }

    const shouldReplaceFacets = completeListing || facets !== undefined;
    const effectiveFacets = completeListing ? mergedFacets(facets, jobs) : facets ?? [];
    if (shouldReplaceFacets) {
      const facetGeneration = crypto.randomUUID();
      await this.db.prepare(`
        UPDATE sources SET facet_sync_generation = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(facetGeneration, sourceId).run();
      const facetRecords = effectiveFacets.flatMap((facet) => facet.values.map((value) => ({
        id: crypto.randomUUID(), sourceId, facetKey: facet.key, facetLabel: facet.label,
        valueKey: value.key, valueLabel: value.label, jobCount: value.count, observedAt: now,
      })));
      for (const facetChunk of chunksByJsonBytes(facetRecords, 1_500_000)) {
        await this.db.prepare(`
          INSERT INTO source_facets (id, source_id, facet_key, facet_label, value_key, value_label, job_count, observed_at)
          SELECT json_extract(value, '$.id'), json_extract(value, '$.sourceId'), json_extract(value, '$.facetKey'),
                 json_extract(value, '$.facetLabel'), json_extract(value, '$.valueKey'), json_extract(value, '$.valueLabel'),
                 json_extract(value, '$.jobCount'), json_extract(value, '$.observedAt')
          FROM json_each(?)
          WHERE (SELECT facet_sync_generation FROM sources WHERE id = ?) = ?
          ON CONFLICT(source_id, facet_key, value_key) DO UPDATE SET
            facet_label = excluded.facet_label,
            value_label = excluded.value_label,
            job_count = excluded.job_count,
            observed_at = excluded.observed_at,
            updated_at = CURRENT_TIMESTAMP
        `).bind(JSON.stringify(facetChunk), sourceId, facetGeneration).run();
      }
      await this.db.prepare(`
        DELETE FROM source_facets
        WHERE source_id = ? AND observed_at <> ?
          AND (SELECT facet_sync_generation FROM sources WHERE id = ?) = ?
      `).bind(sourceId, now, sourceId, facetGeneration).run();
    }

    const artifactUrls = existingResult.results
      .filter((row) => row.status === "open" && isNavigationArtifact(row) && !visibleUrls.has(row.official_url))
      .map((row) => row.official_url);
    const closedUrls = [...new Set(completeListing
      ? [...existingUrls].filter((url) => !visibleUrls.has(url))
      : artifactUrls)];
    for (const urlsChunk of chunksByJsonBytes(closedUrls, 1_500_000)) {
      await this.db.prepare(`
        UPDATE jobs
        SET status = 'closed', closed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND official_url IN (SELECT value FROM json_each(?)) AND status = 'open'
      `).bind(now, sourceId, JSON.stringify(urlsChunk)).run();
    }

    const created = jobs.filter((job) => !existingByUrl.has(job.officialUrl)).length;
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
