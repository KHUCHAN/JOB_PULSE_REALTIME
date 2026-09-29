import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { jobDetailProjection } from "./job-search-sql";

it("bounds detail audit lookups to the exact job/profile/generation without losing delivery identity", () => {
  const db = new DatabaseSync(":memory:");
  const projection = jobDetailProjection("j");
  const columns = [...new Set([...projection.matchAll(/\bj\.([a-z_]+)/g)].map(m => m[1]))];
  db.exec(`CREATE TABLE jobs (${columns.map(c => `${c} ${c === "open_generation" ? "INTEGER" : "TEXT"}${c === "id" ? " PRIMARY KEY" : ""}`).join(",")});
    CREATE TABLE job_topics(job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id,topic_key));
    CREATE TABLE match_profiles(id TEXT PRIMARY KEY, keyword_id TEXT);
    CREATE TABLE job_matches(id TEXT PRIMARY KEY,job_id TEXT,keyword_id TEXT,open_generation INTEGER,is_active INTEGER,score INTEGER,matched_terms TEXT,notified_at TEXT);
    CREATE UNIQUE INDEX job_matches_job_keyword_generation_unique ON job_matches(job_id,keyword_id,open_generation);
    CREATE INDEX job_matches_keyword_active_score_idx ON job_matches(keyword_id,is_active,score);
    CREATE TABLE codex_reviews(job_match_id TEXT,decision TEXT);
    CREATE UNIQUE INDEX codex_reviews_job_match_unique ON codex_reviews(job_match_id);
    CREATE TABLE notification_identity_history(profile_id TEXT,identity_key TEXT);
    CREATE INDEX notification_identity_history_profile_identity_idx ON notification_identity_history(profile_id,identity_key);
    INSERT INTO jobs(id,open_generation,url_identity_key,requisition_identity_key) VALUES ('current',2,'url:current','req:current'),('unmatched',1,'url:unmatched',NULL);
    INSERT INTO match_profiles VALUES('chanyoung-resume','resume'),('other','other');
    INSERT INTO job_matches VALUES ('old','current','resume',1,0,99,'["old"]','old-date'),('new','current','resume',2,1,5,'["Python"]','sent-date'),('other','current','other',2,1,100,'["other"]',NULL);
    INSERT INTO codex_reviews VALUES ('old','reject'),('new','approve'),('other','reject');
    INSERT INTO notification_identity_history VALUES('chanyoung-resume','req:current');
    INSERT INTO job_topics VALUES('current','area:ai-ml');`);
  const sql = `SELECT ${projection} FROM jobs j WHERE j.id = ?`;
  expect(db.prepare(sql).get("current")).toMatchObject({
    resume_match_score: 5, resume_match_evidence: '["Python"]', resume_notified_at: "sent-date",
    resume_review_decision: "approve", resume_identity_already_notified: 1, area_keys: '["ai-ml"]',
  });
  expect(db.prepare(sql).get("unmatched")).toMatchObject({
    resume_match_score: null, resume_notified_at: null, resume_review_decision: null, resume_identity_already_notified: 0,
  });
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("current").map(r => r.detail).join("\n");
  expect(plan).toContain("job_matches_job_keyword_generation_unique (job_id=? AND keyword_id=? AND open_generation=?)");
  expect(plan).toContain("codex_reviews_job_match_unique (job_match_id=?)");
  expect(plan).not.toMatch(/SCAN (detail_match|detail_review)/);
  db.close();
});
