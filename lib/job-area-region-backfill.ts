import {
  classifyJobAreas,
  hasCurrentJobAreaClassification,
  jobAreaClassificationMarker,
} from "./job-area-classifier";
import { classifyJobRegion } from "./job-region-classifier";

type PendingJobRow = {
  id: string;
  title: string;
  skills: string | null;
  department: string | null;
  team: string | null;
  business_unit: string | null;
  job_family: string | null;
  job_function: string | null;
  location: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  secondary_locations: string | null;
  location_region: string | null;
  area_classified_at: string | null;
};

type PendingJobBodyRow = {
  id: string;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
};

export type JobAreaRegionBackfillResult = {
  processed: number;
  areaMatched: number;
  regionResolved: number;
  remaining: number;
  nextCursor: string | null;
};

const bodyCandidateTerms = [
  "artificial intelligence", "machine learning", "deep learning", "generative ai", "genai",
  "large language model", "llm", "natural language processing", "nlp", "computer vision",
  "reinforcement learning", "applied scientist", "research scientist", "pytorch", "tensorflow",
  "scikit-learn", "data science", "data scientist", "data engineer", "data analytics",
  "data analysis", "data analyst", "analytics", "quantitative", "quant", "informatics",
  "business intelligence", "statistics", "statistical", "operations research", "decision science",
  "software engineer", "software developer", "software development", "application developer",
  "frontend engineer", "frontend developer", "backend engineer", "backend developer",
  "full-stack engineer", "full stack engineer", "mobile engineer", "firmware engineer",
] as const;

const chunksOf = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const parseStringArray = (value: string | null): string[] => {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const classificationInput = (job: PendingJobRow, body?: PendingJobBodyRow) => ({
  title: job.title,
  summary: body?.summary,
  description: body?.description,
  responsibilities: body?.responsibilities,
  qualifications: body?.qualifications,
  skills: parseStringArray(job.skills),
  department: job.department,
  team: job.team,
  businessUnit: job.business_unit,
  jobFamily: job.job_family,
  jobFunction: job.job_function,
});

export async function backfillJobAreasAndRegions(
  db: D1Database,
  requestedLimit: number,
  afterId: string | null = null,
): Promise<JobAreaRegionBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit)));
  const selectedStatement = db.prepare(`
    SELECT id, title, skills, department, team, business_unit, job_family, job_function,
           location, location_city, location_state, location_country, secondary_locations,
           location_region, area_classified_at
    FROM jobs
    WHERE status = 'open'
      AND (area_classified_at IS NULL OR area_classified_at NOT LIKE 'v2:%' OR location_region IS NULL)
      ${afterId ? "AND id > ?" : ""}
    ORDER BY id
    LIMIT ?
  `);
  const selected = afterId
    ? await selectedStatement.bind(afterId, limit).all<PendingJobRow>()
    : await selectedStatement.bind(limit).all<PendingJobRow>();
  if (selected.results.length === 0) {
    return { processed: 0, areaMatched: 0, regionResolved: 0, remaining: 0, nextCursor: null };
  }

  const areaPendingIds = selected.results
    .filter((job) => !hasCurrentJobAreaClassification(job.area_classified_at))
    .map((job) => job.id);
  const bodies: PendingJobBodyRow[] = [];
  for (const idChunk of chunksOf(areaPendingIds, 25)) {
    const result = await db.prepare(`
      SELECT id,
             substr(summary, 1, 10000) AS summary,
             substr(description, 1, 30000) AS description,
             substr(responsibilities, 1, 10000) AS responsibilities,
             substr(qualifications, 1, 10000) AS qualifications
      FROM jobs
      WHERE id IN (SELECT value FROM json_each(?))
        AND EXISTS (
          SELECT 1 FROM json_each(?) AS term
          WHERE instr(lower(
            coalesce(summary, '') || ' ' || coalesce(description, '') || ' ' ||
            coalesce(responsibilities, '') || ' ' || coalesce(qualifications, '')
          ), term.value) > 0
        )
    `).bind(JSON.stringify(idChunk), JSON.stringify(bodyCandidateTerms)).all<PendingJobBodyRow>();
    bodies.push(...result.results);
  }

  const bodyById = new Map(bodies.map((body) => [body.id, body]));
  const classifiedAt = new Date().toISOString();
  const areaClassifiedAt = jobAreaClassificationMarker(classifiedAt);
  const records = selected.results.map((job) => {
    const areas = !hasCurrentJobAreaClassification(job.area_classified_at)
      ? classifyJobAreas(classificationInput(job, bodyById.get(job.id)))
      : [];
    const locationRegion = classifyJobRegion({
      location: job.location,
      locationCity: job.location_city,
      locationState: job.location_state,
      locationCountry: job.location_country,
      secondaryLocations: parseStringArray(job.secondary_locations),
    });
    return { job, areas, locationRegion };
  });

  for (const idChunk of chunksOf(areaPendingIds, 100)) {
    await db.prepare(`
      DELETE FROM job_topics
      WHERE topic_key LIKE 'area:%' AND job_id IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(idChunk)).run();
  }

  const memberships = records.flatMap(({ job, areas }) => areas.map((area) => ({
    jobId: job.id,
    areaKey: area.areaKey,
    score: area.score,
    evidence: area.evidence,
    classifiedAt,
  })));
  for (const membershipChunk of chunksOf(memberships, 100)) {
    await db.prepare(`
      INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
      SELECT json_extract(value, '$.jobId'), 'area:' || json_extract(value, '$.areaKey'),
             json_extract(value, '$.score'), json_extract(value, '$.evidence'),
             json_extract(value, '$.classifiedAt')
      FROM json_each(?)
      WHERE true
      ON CONFLICT(job_id, topic_key) DO UPDATE SET
        score = excluded.score,
        evidence = excluded.evidence,
        classified_at = excluded.classified_at
    `).bind(JSON.stringify(membershipChunk)).run();
  }

  const updates = records.map(({ job, locationRegion }) => ({
    id: job.id,
    locationRegion,
    areaClassifiedAt: hasCurrentJobAreaClassification(job.area_classified_at)
      ? job.area_classified_at
      : areaClassifiedAt,
  }));
  for (const updateChunk of chunksOf(updates, 100)) {
    await db.prepare(`
      UPDATE jobs
      SET location_region = json_extract(value, '$.locationRegion'),
          area_classified_at = json_extract(value, '$.areaClassifiedAt'),
          updated_at = CURRENT_TIMESTAMP
      FROM json_each(?) AS value
      WHERE jobs.id = json_extract(value, '$.id')
    `).bind(JSON.stringify(updateChunk)).run();
  }

  return {
    processed: records.length,
    areaMatched: records.filter(({ job, areas }) => !hasCurrentJobAreaClassification(job.area_classified_at) && areas.length > 0).length,
    regionResolved: records.filter(({ locationRegion }) => locationRegion !== "unknown").length,
    // A full checkpoint deliberately avoids a global COUNT over the jobs table.
    // The caller continues until the first short/empty checkpoint proves completion.
    remaining: records.length < limit ? 0 : -1,
    nextCursor: records.at(-1)?.job.id ?? null,
  };
}
