import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sitesSchemaMigrationFiles } from "../build/sites-vite-plugin";

const migration = readFileSync("drizzle/0144_job_fts_changed_content.sql", "utf8");
const fixture = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, title TEXT, company TEXT,
    location TEXT, summary TEXT, description TEXT, last_seen_at TEXT, status TEXT);`);
  db.exec(readFileSync("drizzle/0030_job_search_fts.sql", "utf8"));
  db.exec("INSERT INTO jobs VALUES ('a', 'engineer', 'acme', 'Austin', NULL, 'python', 'old', 'open')");
  db.exec(migration);
  return db;
};

describe("change-only FTS trigger", () => {
  it("ships the bounded migration without rebuilding the index", () => {
    expect(sitesSchemaMigrationFiles).toContain("0144_job_fts_changed_content.sql");
    expect(migration).not.toContain("'rebuild'");
  });
  it("does no FTS writes for an unchanged crawl while still confirming freshness", () => {
    const db = fixture();
    try {
      const before = Number(db.prepare("SELECT total_changes() AS n").get()!.n);
      db.exec(`UPDATE jobs SET title=title, company=company, location=location,
        summary=COALESCE(NULL, summary), description=description, last_seen_at='new'`);
      expect(Number(db.prepare("SELECT total_changes() AS n").get()!.n) - before).toBe(1);
      expect(db.prepare("SELECT last_seen_at FROM jobs").get()!.last_seen_at).toBe("new");
      expect(db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'python'").all()).toHaveLength(1);
    } finally { db.close(); }
  });
  it.each(["title", "company", "location", "summary", "description"])("indexes real %s changes including NULL transitions", column => {
    const db = fixture();
    try {
      db.exec(`UPDATE jobs SET ${column}='uniqueterm'`);
      expect(db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'uniqueterm'").all()).toHaveLength(1);
      db.exec(`UPDATE jobs SET ${column}=NULL`);
      expect(db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'uniqueterm'").all()).toHaveLength(0);
      db.exec("INSERT INTO jobs_fts(jobs_fts, rank) VALUES ('integrity-check', 1)");
    } finally { db.close(); }
  });
  it("retains insert/delete behavior and tolerates migration replay", () => {
    const db = fixture();
    try {
      db.exec(migration);
      db.exec("INSERT INTO jobs(id,title) VALUES ('b','newposting')");
      expect(db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'newposting'").all()).toHaveLength(1);
      db.exec("DELETE FROM jobs WHERE id='b'");
      expect(db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'newposting'").all()).toHaveLength(0);
      db.exec("INSERT INTO jobs_fts(jobs_fts, rank) VALUES ('integrity-check', 1)");
    } finally { db.close(); }
  });
});
