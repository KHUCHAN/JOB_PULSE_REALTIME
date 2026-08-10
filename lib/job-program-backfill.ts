import { classifyJobPrograms } from "./job-program-classifier.ts";
import { normalizeEmploymentType } from "./employment-type.ts";

type PendingJobRow = { id: string; title: string; employment_type: string | null };

export type JobProgramBackfillResult = {
  processed: number;
  matchedJobs: number;
  memberships: number;
  remaining: number;
};

const chunksOf = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

export async function backfillJobPrograms(db: D1Database, requestedLimit: number): Promise<JobProgramBackfillResult> {
  const limit = Math.max(1, Math.min(5_000, Math.trunc(requestedLimit)));
  const selected = await db.prepare(`
    SELECT id, title, employment_type
    FROM jobs
    WHERE status = 'open'
      AND id > coalesce((SELECT value FROM catalog_state WHERE key = 'job_program_backfill_cursor'), '')
    ORDER BY id
    LIMIT ?
  `).bind(limit).all<PendingJobRow>();
  const classifiedAt = new Date().toISOString();
  const classified = selected.results.map((job) => ({ job, result: classifyJobPrograms(job.title) }));
  const ids = selected.results.map((job) => job.id);

  for (const chunk of chunksOf(ids, 1_000)) {
    await db.prepare(`
      DELETE FROM job_programs WHERE job_id IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(chunk)).run();
  }

  const memberships = classified.flatMap(({ job, result }) => result.keys.map((programKey) => ({
    jobId: job.id,
    programKey,
    evidence: result.evidence[programKey] ?? `title:${programKey}`,
    classifiedAt,
  })));
  for (const chunk of chunksOf(memberships, 500)) {
    await db.prepare(`
      INSERT INTO job_programs (job_id, program_key, evidence, classified_at)
      SELECT json_extract(value, '$.jobId'), json_extract(value, '$.programKey'),
             json_extract(value, '$.evidence'), json_extract(value, '$.classifiedAt')
      FROM json_each(?)
      WHERE true
      ON CONFLICT(job_id, program_key) DO UPDATE SET
        evidence = excluded.evidence,
        classified_at = excluded.classified_at
    `).bind(JSON.stringify(chunk)).run();
  }

  const normalizedJobs = selected.results.map((job) => ({
    id: job.id,
    employmentType: normalizeEmploymentType(job.employment_type),
  }));
  for (const chunk of chunksOf(normalizedJobs, 1_000)) {
    await db.prepare(`
      UPDATE jobs
      SET employment_type = json_extract(value, '$.employmentType'),
          updated_at = CURRENT_TIMESTAMP
      FROM json_each(?) AS value
      WHERE jobs.id = json_extract(value, '$.id')
    `).bind(JSON.stringify(chunk)).run();
  }

  const lastId = selected.results.at(-1)?.id;
  if (lastId) {
    await db.prepare(`
      INSERT INTO catalog_state (key, value, updated_at)
      VALUES ('job_program_backfill_cursor', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).bind(lastId).run();
  }
  const remaining = lastId ? await db.prepare(`
    SELECT EXISTS(
      SELECT 1 FROM jobs
      WHERE status = 'open' AND id > ?
      LIMIT 1
    ) AS count
  `).bind(lastId).first<{ count: number }>() : { count: 0 };
  return {
    processed: selected.results.length,
    matchedJobs: classified.filter(({ result }) => result.keys.length > 0).length,
    memberships: memberships.length,
    remaining: remaining?.count ?? 0,
  };
}
