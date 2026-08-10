import { classifyAiDataJob } from "./job-topic-classifier";

type PendingJobBaseRow = {
  id: string;
  title: string;
  skills: string | null;
  department: string | null;
  team: string | null;
  business_unit: string | null;
  job_family: string | null;
  job_function: string | null;
};

type PendingJobBodyRow = {
  id: string;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
};

export type JobTopicBackfillResult = {
  processed: number;
  matched: number;
  remaining: number;
};

const parseStringArray = (value: string | null): string[] => {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const chunksOf = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const bodyCandidateTerms = [
  "artificial intelligence", "machine learning", "deep learning", "generative ai", "genai",
  "large language model", "large language models", "llm", "llms", "natural language processing",
  "nlp", "computer vision", "reinforcement learning", "recommendation system", "recommendation systems",
  "recommender system", "recommender systems", "data science", "data scientist", "data scientists",
  "decision scientist", "applied scientist", "research scientist", "data engineering", "data engineer",
  "analytics engineering", "analytics engineer", "data analysis", "data analyst", "data analytics",
  "business intelligence", "ml engineer", "mlops", "model infrastructure", "ai platform", "data platform",
  "predictive model", "feature engineering", "model training", "training models", "statistical modeling",
  "data pipeline",
] as const;

const bodyCandidateFtsQuery = bodyCandidateTerms
  .map((term) => `"${term.replaceAll('"', '""')}"`)
  .join(" OR ");

export async function backfillJobTopics(db: D1Database, requestedLimit: number): Promise<JobTopicBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit)));
  const selected = await db.prepare(`
    SELECT id, title, skills, department, team, business_unit, job_family, job_function
    FROM jobs
    WHERE status = 'open' AND topic_classified_at IS NULL
    ORDER BY id
    LIMIT ?
  `).bind(limit).all<PendingJobBaseRow>();
  const classifiedAt = new Date().toISOString();
  const baseClassifications = new Map(selected.results.map((job) => [job.id, classifyAiDataJob({
      title: job.title,
      skills: parseStringArray(job.skills),
      department: job.department,
      team: job.team,
      businessUnit: job.business_unit,
      jobFamily: job.job_family,
      jobFunction: job.job_function,
    })]));
  const bodyCandidateIds = selected.results
    .filter((job) => !baseClassifications.get(job.id)?.matched)
    .map((job) => job.id);
  const bodies = bodyCandidateIds.length > 0
    ? await db.prepare(`
      SELECT j.id, j.summary, j.description, j.responsibilities, j.qualifications
      FROM jobs j
      WHERE j.id IN (SELECT value FROM json_each(?))
        AND (
          j.rowid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)
          OR EXISTS (
            SELECT 1 FROM json_each(?) AS term
            WHERE instr(lower(coalesce(j.responsibilities, '') || ' ' || coalesce(j.qualifications, '')), term.value) > 0
          )
        )
    `).bind(
      JSON.stringify(bodyCandidateIds),
      bodyCandidateFtsQuery,
      JSON.stringify(bodyCandidateTerms),
    ).all<PendingJobBodyRow>()
    : { results: [] as PendingJobBodyRow[] };
  const bodyById = new Map(bodies.results.map((body) => [body.id, body]));
  const results = selected.results.map((job) => {
    const body = bodyById.get(job.id);
    return {
      id: job.id,
      classification: body ? classifyAiDataJob({
        title: job.title,
        summary: body.summary,
        description: body.description,
        responsibilities: body.responsibilities,
        qualifications: body.qualifications,
        skills: parseStringArray(job.skills),
        department: job.department,
        team: job.team,
        businessUnit: job.business_unit,
        jobFamily: job.job_family,
        jobFunction: job.job_function,
      }) : baseClassifications.get(job.id)!,
    };
  });

  const matches = results
    .filter((result) => result.classification.matched)
    .map((result) => ({
      jobId: result.id,
      score: result.classification.score,
      evidence: result.classification.evidence,
      classifiedAt,
    }));
  for (const chunk of chunksOf(matches, 100)) {
    await db.prepare(`
      INSERT INTO job_topics (job_id, topic_key, score, evidence, classified_at)
      SELECT json_extract(value, '$.jobId'), 'ai-data', json_extract(value, '$.score'),
             json_extract(value, '$.evidence'), json_extract(value, '$.classifiedAt')
      FROM json_each(?)
      WHERE true
      ON CONFLICT(job_id, topic_key) DO UPDATE SET
        score = excluded.score,
        evidence = excluded.evidence,
        classified_at = excluded.classified_at
    `).bind(JSON.stringify(chunk)).run();
  }

  const nonmatches = results
    .filter((result) => !result.classification.matched)
    .map((result) => result.id);
  for (const chunk of chunksOf(nonmatches, 100)) {
    await db.prepare(`
      DELETE FROM job_topics
      WHERE topic_key = 'ai-data' AND job_id IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(chunk)).run();
  }

  for (const chunk of chunksOf(results.map((result) => result.id), 100)) {
    await db.prepare(`
      UPDATE jobs SET topic_classified_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE topic_classified_at IS NULL AND id IN (SELECT value FROM json_each(?))
    `).bind(classifiedAt, JSON.stringify(chunk)).run();
  }

  const remaining = await db.prepare(`
    SELECT count(*) AS count FROM jobs WHERE status = 'open' AND topic_classified_at IS NULL
  `).first<{ count: number }>();
  return { processed: results.length, matched: matches.length, remaining: remaining?.count ?? 0 };
}
