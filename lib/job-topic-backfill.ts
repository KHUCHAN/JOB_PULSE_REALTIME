import { classifyAiDataJob } from "./job-topic-classifier";

type PendingJobRow = {
  id: string;
  title: string;
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: string | null;
  department: string | null;
  team: string | null;
  business_unit: string | null;
  job_family: string | null;
  job_function: string | null;
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

export async function backfillJobTopics(db: D1Database, requestedLimit: number): Promise<JobTopicBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit)));
  const selected = await db.prepare(`
    SELECT id, title, summary, description, responsibilities, qualifications, skills,
           department, team, business_unit, job_family, job_function
    FROM jobs
    WHERE status = 'open' AND topic_classified_at IS NULL
    ORDER BY id
    LIMIT ?
  `).bind(limit).all<PendingJobRow>();
  const classifiedAt = new Date().toISOString();
  const results = selected.results.map((job) => ({
    id: job.id,
    classification: classifyAiDataJob({
      title: job.title,
      summary: job.summary,
      description: job.description,
      responsibilities: job.responsibilities,
      qualifications: job.qualifications,
      skills: parseStringArray(job.skills),
      department: job.department,
      team: job.team,
      businessUnit: job.business_unit,
      jobFamily: job.job_family,
      jobFunction: job.job_function,
    }),
  }));

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
