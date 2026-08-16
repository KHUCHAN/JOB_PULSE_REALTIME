import { describe, expect, it } from "vitest";
import { createD1ForSqlite } from "./resume-alert-test-helper";
import { listResumeReviewCandidates } from "./resume-review-feed";
import { DatabaseSync } from "node:sqlite";

const databaseWithCandidates = (): DatabaseSync => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE match_profiles (id TEXT PRIMARY KEY, keyword_id TEXT NOT NULL);
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, location TEXT,
      location_region TEXT, official_url TEXT NOT NULL, apply_url TEXT, summary TEXT,
      description TEXT, responsibilities TEXT, qualifications TEXT, skills TEXT,
      department TEXT, team TEXT, job_family TEXT, job_function TEXT,
      employment_type TEXT, education_requirements TEXT, experience_requirements TEXT,
      security_clearance TEXT, published_at TEXT, first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, status TEXT NOT NULL, open_generation INTEGER NOT NULL
    );
    CREATE TABLE job_matches (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, keyword_id TEXT NOT NULL, score INTEGER NOT NULL,
      matched_terms TEXT, open_generation INTEGER NOT NULL, is_active INTEGER NOT NULL,
      notification_eligible INTEGER NOT NULL
    );
    CREATE TABLE job_topics (job_id TEXT NOT NULL, topic_key TEXT NOT NULL);
    CREATE TABLE codex_reviews (
      job_match_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL DEFAULT 'chanyoung-resume'
    );
    INSERT INTO match_profiles VALUES ('chanyoung-resume', 'resume-keyword');
    INSERT INTO jobs VALUES
      ('job-new', 'Acme', 'Data Science Intern 2027', 'Los Angeles, CA', 'us',
       'https://careers.acme.example/jobs/new', NULL, 'summary', 'description', NULL, NULL,
       '["Python"]', 'Data', NULL, NULL, 'Data Science', 'Internship', NULL, NULL, NULL,
       '2026-08-13T20:00:00.000Z', '2026-08-13T20:00:00.000Z', '2026-08-13T20:00:00.000Z', 'open', 1),
      ('job-reviewed', 'Acme', 'Software Co-op', 'Boston, MA', 'us',
       'https://careers.acme.example/jobs/reviewed', NULL, NULL, NULL, NULL, NULL,
       '[]', NULL, NULL, NULL, NULL, 'Co-op', NULL, NULL, NULL,
       '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z', 'open', 1);
      INSERT INTO jobs VALUES
      ('job-coop-pending', 'Acme', 'Data Engineer Intern 2027', 'Dallas, TX', 'us',
       'https://careers.acme.example/jobs/coop-pending', NULL, NULL, NULL, NULL, NULL,
       '[]', NULL, NULL, NULL, NULL, 'Co-Op', NULL, NULL, NULL,
       '2026-08-14T20:00:00.000Z', '2026-08-14T20:00:00.000Z', '2026-08-14T20:00:00.000Z', 'open', 1);
    ALTER TABLE jobs ADD COLUMN reopened_at TEXT;
    ALTER TABLE jobs ADD COLUMN requisition_identity_key TEXT;
    ALTER TABLE jobs ADD COLUMN external_identity_key TEXT;
    ALTER TABLE jobs ADD COLUMN url_identity_key TEXT;
    ALTER TABLE jobs ADD COLUMN alert_discovered_after_baseline INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE match_profiles ADD COLUMN activation_watermark TEXT;
    CREATE TABLE notification_identity_history (
      profile_id TEXT NOT NULL, recipient TEXT NOT NULL, identity_key TEXT NOT NULL,
      first_sent_at TEXT NOT NULL, notification_id TEXT, job_match_id TEXT,
      PRIMARY KEY(profile_id, recipient, identity_key)
    );
    UPDATE jobs SET url_identity_key = 'url:' || lower(official_url);
    UPDATE match_profiles SET activation_watermark = '2026-08-13T00:00:00.000Z';
    INSERT INTO jobs VALUES
      ('job-old', 'Acme', 'Old Data Intern 2027', 'Los Angeles, CA', 'us',
       'https://careers.acme.example/jobs/old', NULL, NULL, NULL, NULL, NULL,
       '[]', NULL, NULL, NULL, NULL, 'Internship', NULL, NULL, NULL,
       '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z', 'open', 1,
       NULL, NULL, NULL, 'url:https://careers.acme.example/jobs/old', 0);
    INSERT INTO jobs VALUES
      ('job-clinical-extern', 'Hospital', 'Nurse Extern Renal PRN', 'Indianapolis, IN', 'us',
       'https://careers.hospital.example/jobs/extern', NULL, NULL, NULL, NULL, NULL,
       '[]', NULL, NULL, NULL, NULL, 'Internship', NULL, NULL, NULL,
       NULL, '2026-08-14T21:00:00.000Z', '2026-08-14T21:00:00.000Z', 'open', 1,
       NULL, NULL, NULL, 'url:https://careers.hospital.example/jobs/extern', 1);
    INSERT INTO job_matches VALUES
      ('match-new', 'job-new', 'resume-keyword', 80, '["role|Data"]', 1, 1, 0),
      ('match-reviewed', 'job-reviewed', 'resume-keyword', 90, '[]', 1, 1, 0);
      INSERT INTO job_matches VALUES
      ('match-coop-pending', 'job-coop-pending', 'resume-keyword', 95, '[]', 1, 1, 0);
    INSERT INTO job_matches VALUES
      ('match-old', 'job-old', 'resume-keyword', 70, '[]', 1, 1, 0);
    INSERT INTO job_matches VALUES
      ('match-clinical-extern', 'job-clinical-extern', 'resume-keyword', 95, '[]', 1, 1, 0);
    INSERT INTO job_topics VALUES
      ('job-new', 'program:internship'), ('job-new', 'year:2027'),
      ('job-reviewed', 'program:coop'),
      ('job-coop-pending', 'program:internship');
    INSERT INTO job_topics VALUES ('job-old', 'program:internship');
    INSERT INTO job_topics VALUES ('job-clinical-extern', 'program:internship');
    INSERT INTO codex_reviews (job_match_id) VALUES ('match-reviewed');
  `);
  return sqlite;
};

describe("resume review feed", () => {
  it("returns only current unreviewed internship/co-op matches", async () => {
    const candidates = await listResumeReviewCandidates(createD1ForSqlite(databaseWithCandidates()), 100);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      matchId: "match-new",
      jobId: "job-new",
      programKeys: ["internship"],
      recruitingYears: [2027],
      skills: ["Python"],
    });
  });

  it("bounds the feed to one hundred candidates", async () => {
    expect(await listResumeReviewCandidates(createD1ForSqlite(databaseWithCandidates()), 0)).toHaveLength(1);
    expect(await listResumeReviewCandidates(createD1ForSqlite(databaseWithCandidates()), 500)).toHaveLength(1);
  });

  it("does not review baseline inventory or an identity already delivered", async () => {
    const baseline = databaseWithCandidates();
    baseline.prepare("UPDATE jobs SET alert_discovered_after_baseline = 0 WHERE id = 'job-new'").run();
    expect(await listResumeReviewCandidates(createD1ForSqlite(baseline), 100)).toEqual([]);

    const sent = databaseWithCandidates();
    sent.prepare(`INSERT INTO notification_identity_history
      VALUES ('chanyoung-resume', 'kimchany@usc.edu', 'url:https://careers.acme.example/jobs/new',
              '2026-08-13T21:00:00.000Z', 'notification-1', 'match-old')`).run();
    expect(await listResumeReviewCandidates(createD1ForSqlite(sent), 100)).toEqual([]);
  });

  it("prioritizes likely US 2027 candidates ahead of a fresher global backlog", async () => {
    const sqlite = databaseWithCandidates();
    sqlite.exec(`
      INSERT INTO jobs VALUES
        ('job-global-newer', 'Global Co', 'Marketing Intern', NULL, 'unknown',
         'https://careers.global.example/jobs/newer', NULL, NULL, NULL, NULL, NULL,
         '[]', NULL, NULL, NULL, NULL, 'Internship', NULL, NULL, NULL,
         NULL, '2026-08-14T23:00:00.000Z', '2026-08-14T23:00:00.000Z', 'open', 1,
         NULL, NULL, NULL, 'url:https://careers.global.example/jobs/newer', 1);
      INSERT INTO job_matches VALUES
        ('match-global-newer', 'job-global-newer', 'resume-keyword', 99, '[]', 1, 1, 0);
      INSERT INTO job_topics VALUES ('job-global-newer', 'program:internship');
    `);

    const candidates = await listResumeReviewCandidates(createD1ForSqlite(sqlite), 1);
    expect(candidates.map((candidate) => candidate.jobId)).toEqual(["job-new"]);
  });

  it("does not let a fresher low-fit US 2027 backlog starve a stronger match", async () => {
    const sqlite = databaseWithCandidates();
    sqlite.exec(`
      INSERT INTO jobs VALUES
        ('job-us-newer-low-fit', 'Bulk Launch Co', 'Human Resources Intern 2027', 'New York, NY', 'us',
         'https://careers.bulk.example/jobs/newer', NULL, NULL, NULL, NULL, NULL,
         '[]', NULL, NULL, NULL, NULL, 'Internship', NULL, NULL, NULL,
         '2026-08-14T23:00:00.000Z', '2026-08-14T23:00:00.000Z', '2026-08-14T23:00:00.000Z', 'open', 1,
         NULL, NULL, NULL, 'url:https://careers.bulk.example/jobs/newer', 1);
      INSERT INTO job_matches VALUES
        ('match-us-newer-low-fit', 'job-us-newer-low-fit', 'resume-keyword', 0, '[]', 1, 1, 0);
      INSERT INTO job_topics VALUES
        ('job-us-newer-low-fit', 'program:internship'),
        ('job-us-newer-low-fit', 'year:2027');
    `);

    const candidates = await listResumeReviewCandidates(createD1ForSqlite(sqlite), 1);
    expect(candidates.map((candidate) => candidate.jobId)).toEqual(["job-new"]);
  });
});
