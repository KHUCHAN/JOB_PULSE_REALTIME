import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CrawledJob } from "./crawler";
import { expiredJobsPredicate, isExpiredPosting, purgeExpiredJobs, retainIncomingJobs, retentionCutoff } from "./job-retention";
import { drainExpiredJobs } from "./job-retention-drain";

const NOW = "2026-09-05T01:23:45.678Z";
const CUTOFF = "2026-08-06T01:23:45.678Z";
const fixture = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, source_id TEXT, official_url TEXT, company TEXT, title TEXT,
      location TEXT, summary TEXT, description TEXT, review_state TEXT DEFAULT 'new',
      requisition_identity_key TEXT, external_identity_key TEXT, url_identity_key TEXT, published_at TEXT, status TEXT);
    CREATE TABLE job_matches (id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      keyword_id TEXT, notified_at TEXT, open_generation INTEGER);
    CREATE TABLE codex_reviews (id TEXT PRIMARY KEY, job_match_id TEXT REFERENCES job_matches(id) ON DELETE CASCADE,
      profile_id TEXT, decision TEXT, rationale TEXT, verified_url TEXT, source_file TEXT, reviewer TEXT, reviewed_at TEXT);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, status TEXT, sent_at TEXT);
    CREATE TABLE notification_items (id TEXT PRIMARY KEY, notification_id TEXT REFERENCES notifications(id),
      job_match_id TEXT REFERENCES job_matches(id) ON DELETE CASCADE, recipient TEXT, created_at TEXT);
    CREATE TABLE match_profiles (id TEXT PRIMARY KEY, keyword_id TEXT);
    CREATE TABLE notification_identity_history (profile_id TEXT, recipient TEXT, identity_key TEXT,
      first_sent_at TEXT, notification_id TEXT, job_match_id TEXT, PRIMARY KEY(profile_id, recipient, identity_key));
    CREATE TABLE job_filter_options_cache (id TEXT);
    INSERT INTO job_filter_options_cache VALUES ('cached');
    CREATE TABLE job_topics (job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE, topic_key TEXT);
  `);
  for (const name of ["0140_job_retention_archive.sql", "0141_job_retention_index.sql", "0030_job_search_fts.sql"]) {
    sqlite.exec(readFileSync(`drizzle/${name}`, "utf8"));
  }
  const prepare = (sql: string) => {
    const bound = (values: unknown[]) => ({
      all: async () => ({ results: sqlite.prepare(sql).all(...values as never[]) }),
      first: async () => sqlite.prepare(sql).get(...values as never[]) ?? null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values as never[]).changes) } }),
      execute: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values as never[]).changes) } }),
    });
    return { ...bound([]), bind: (...values: unknown[]) => bound(values) };
  };
  const db = {
    prepare,
    batch: async (statements: Array<{ execute: () => unknown }>) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  const add = (id: string, date: string | null, status = "open") => sqlite.prepare(`INSERT INTO jobs
    (id, source_id, official_url, company, title, description, requisition_identity_key, external_identity_key,
     url_identity_key, published_at, status) VALUES (?, 's', ?, 'Example', ?, 'large body', ?, ?, ?, ?, ?)`)
    .run(id, `https://example.com/${id}`, id, `req:s:${id}`, `ext:s:${id}`, `url:https://example.com/${id}`, date, status);
  return { sqlite, db, add };
};

describe("30-day job retention", () => {
  it("uses the exact 30-day UTC boundary", () => {
    expect(retentionCutoff(NOW)).toBe(CUTOFF);
    expect(isExpiredPosting(CUTOFF, NOW)).toBe(true);
    expect(isExpiredPosting("2026-08-06T01:23:45.679Z", NOW)).toBe(false);
    expect(isExpiredPosting("2026-08-05T18:23:45.678-07:00", NOW)).toBe(true);
    expect(isExpiredPosting("2026-08-06 01:23:45.678", NOW)).toBe(true);
    expect(() => retentionCutoff("bad clock")).toThrow();
  });
  it.each([null, undefined, "", "yesterday", "42", "not a date", "2099-01-01"])("does not expire unknown/invalid/future %j", (date) => {
    expect(isExpiredPosting(date, NOW)).toBe(false);
  });
  it("deletes all statuses by publication date, preserving newer, missing and invalid dates", async () => {
    const { db, sqlite, add } = fixture();
    add("old", "2020-01-01"); add("closed", CUTOFF, "closed"); add("boundary", CUTOFF);
    add("new", "2026-08-06T01:23:45.679Z"); add("unknown", null); add("invalid", "42"); add("future", "2099-01-01");
    expect(await purgeExpiredJobs(db, NOW)).toMatchObject({ deleted: 3, hasMore: false });
    expect(sqlite.prepare("SELECT id FROM jobs ORDER BY id").all().map((row) => row.id)).toEqual(["future", "invalid", "new", "unknown"]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM expired_job_archive").get()?.n).toBe(3);
    expect(sqlite.prepare("SELECT count(*) AS n FROM job_filter_options_cache").get()?.n).toBe(0);
    expect(await purgeExpiredJobs(db, NOW)).toMatchObject({ deleted: 0, hasMore: false });
    sqlite.close();
  });
  it("dry run is non-mutating and chunk size is strictly bounded", async () => {
    const { db, sqlite, add } = fixture();
    for (let i = 0; i < 105; i++) add(`old${i}`, "2020-01-01");
    expect(await purgeExpiredJobs(db, NOW, true)).toMatchObject({ selected: 100, deleted: 0, hasMore: true });
    expect(sqlite.prepare("SELECT count(*) AS n FROM jobs").get()?.n).toBe(105);
    expect(await purgeExpiredJobs(db, NOW)).toMatchObject({ deleted: 100, hasMore: true });
    expect(await purgeExpiredJobs(db, NOW)).toMatchObject({ deleted: 5, hasMore: false });
    await expect(purgeExpiredJobs(db, NOW, false, 101)).rejects.toThrow();
    sqlite.close();
  });
  it("archives review and delivery audit, retains sent identities and updates FTS/cascades", async () => {
    const { db, sqlite, add } = fixture();
    add("expiredtoken", "2020-01-01");
    sqlite.exec(`INSERT INTO job_matches VALUES ('m','expiredtoken','k','2026-07-01',1);
      INSERT INTO codex_reviews VALUES ('r','m','p','approve','United States; manually reviewed','https://example.com/expiredtoken',NULL,'codex','2026-07-01');
      INSERT INTO notifications VALUES ('n','sent','2026-07-01');
      INSERT INTO notification_items VALUES ('ni','n','m','kimchany@usc.edu','2026-07-01');
      INSERT INTO match_profiles VALUES ('p','k'); INSERT INTO job_topics VALUES ('expiredtoken','ai-data');`);
    await purgeExpiredJobs(db, NOW);
    const audit = JSON.parse(String(sqlite.prepare("SELECT audit FROM expired_job_archive").get()?.audit));
    expect(audit.reviews[0]).toMatchObject({ decision: "approve", rationale: "United States; manually reviewed" });
    expect(audit.notificationItems[0].notificationId).toBe("n");
    expect(audit.matches[0].notifiedAt).toBe("2026-07-01");
    expect(audit.description).toBeUndefined();
    expect(sqlite.prepare("SELECT count(*) AS n FROM notification_identity_history").get()?.n).toBe(3);
    expect(sqlite.prepare("SELECT status FROM notifications").get()?.status).toBe("sent");
    for (const table of ["job_matches", "codex_reviews", "notification_items", "job_topics"]) {
      expect(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(sqlite.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'expiredtoken'").all()).toEqual([]);
    sqlite.close();
  });
  it("rolls back the audit and deletion together on failure", async () => {
    const { db, sqlite, add } = fixture(); add("old", "2020-01-01");
    sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    await expect(purgeExpiredJobs(db, NOW)).rejects.toThrow("test failure");
    expect(sqlite.prepare("SELECT count(*) AS n FROM jobs").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) AS n FROM expired_job_archive").get()?.n).toBe(0);
    sqlite.close();
  });
  it("rechecks the publication date after selection to protect a concurrent refresh", async () => {
    const { db, sqlite, add } = fixture(); add("old", "2020-01-01");
    const concurrent = { ...db, batch: async (statements: D1PreparedStatement[]) => {
      sqlite.prepare("UPDATE jobs SET published_at = ? WHERE id = 'old'").run(NOW);
      return db.batch(statements);
    } } as D1Database;
    expect(await purgeExpiredJobs(concurrent, NOW)).toMatchObject({ deleted: 0, hasMore: false });
    expect(sqlite.prepare("SELECT count(*) AS n FROM jobs").get()?.n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) AS n FROM expired_job_archive").get()?.n).toBe(0);
    sqlite.close();
  });
  it("uses an index for the bounded retention scan", () => {
    const { sqlite } = fixture();
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id FROM jobs WHERE ${expiredJobsPredicate} ORDER BY julianday(published_at), id LIMIT 100`).all(CUTOFF);
    expect(JSON.stringify(plan)).toContain("jobs_retention_published_idx");
    expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
    sqlite.close();
  });
  it("does not reinsert old postings or archived identity variants even when a feed loses its date", async () => {
    const { db, sqlite, add } = fixture(); add("old", "2020-01-01"); await purgeExpiredJobs(db, NOW);
    const job = (officialUrl: string, publishedAt: string | null, extra = {}) => ({ officialUrl, publishedAt, title: "Role", company: "Example", ...extra }) as CrawledJob;
    const incoming = [job("https://example.com/old", null), job("https://example.com/tracking?x=1", null, { requisitionId: "OLD" }),
      job("https://example.com/old/apply", null), job("https://example.com/other", "2020-01-01"),
      job("https://example.com/fresh", NOW), job("https://example.com/unknown", null)];
    expect((await retainIncomingJobs(db, "s", incoming, NOW)).map((j) => j.officialUrl)).toEqual(["https://example.com/fresh", "https://example.com/unknown"]);
    sqlite.close();
  });
});

describe("owner workflow retention drain", () => {
  it("drains sequentially until empty", async () => {
    let calls = 0;
    expect(await drainExpiredJobs(async () => ({ deleted: ++calls === 1 ? 100 : 2, hasMore: calls === 1 }), () => 0))
      .toEqual({ deleted: 102, batches: 2, hasMore: false });
  });
  it("reports backlog at the bounded deadline", async () => {
    let time = 0;
    expect(await drainExpiredJobs(async () => { time += 60_000; return { deleted: 100, hasMore: true }; }, () => time))
      .toEqual({ deleted: 200, batches: 2, hasMore: true });
  });
  it("fails on invalid, failed, or non-progressing persistence", async () => {
    await expect(drainExpiredJobs(async () => ({ deleted: 0, hasMore: true }), () => 0)).rejects.toThrow("no progress");
    await expect(drainExpiredJobs(async () => ({ deleted: 101, hasMore: false }), () => 0)).rejects.toThrow("Invalid");
    await expect(drainExpiredJobs(async () => { throw new Error("HTTP 500"); }, () => 0)).rejects.toThrow("HTTP 500");
  });
  it("reports committed progress even if a later chunk fails", async () => {
    const progress: Array<{ deleted: number; batches: number; hasMore: boolean }> = [];
    let calls = 0;
    await expect(drainExpiredJobs(async () => {
      if (++calls === 2) throw new Error("HTTP 500");
      return { deleted: 100, hasMore: true };
    }, () => 0, 120_000, (value) => progress.push(value))).rejects.toThrow("HTTP 500");
    expect(progress).toEqual([{ deleted: 100, batches: 1, hasMore: true }]);
  });
});
