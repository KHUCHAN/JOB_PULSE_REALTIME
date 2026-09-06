// Read-only source benchmark; synthetic in-memory DB, never contacts production.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE job_matches(job_id TEXT, keyword_id TEXT, open_generation INTEGER, is_active INTEGER);
CREATE UNIQUE INDEX job_matches_job_keyword_generation_unique ON job_matches(job_id, keyword_id, open_generation);
WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<29999)
INSERT INTO job_matches SELECT 'job-'||x, 'resume', 1, 1 FROM n;`);
const input = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ jobId: `job-${i}`, keywordId: 'resume', openGeneration: 1 })));
const before = `UPDATE job_matches SET is_active=0 WHERE EXISTS (
SELECT 1 FROM json_each(?) record WHERE job_matches.job_id=json_extract(record.value,'$.jobId')
AND job_matches.keyword_id=json_extract(record.value,'$.keywordId')
AND job_matches.open_generation=json_extract(record.value,'$.openGeneration'))`;
const source = readFileSync(new URL('../lib/resume-match-store.ts', import.meta.url), 'utf8');
const after = source.match(/UPDATE job_matches\s+SET is_active = 0[\s\S]*?\n    `/)?.[0].slice(0, -1);
if (!after) throw new Error('Production deactivation SQL not found');
for (const [label, sql] of [['before', before], ['after', after]]) {
  sqlite.exec('UPDATE job_matches SET is_active=1');
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(input);
  const started = performance.now();
  const result = sqlite.prepare(sql).run(input);
  console.log(JSON.stringify({ label, rows: 30000, input: 500, milliseconds: performance.now()-started, changed: result.changes, plan }));
}
sqlite.close();
