import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("verified posting link repairs migration", () => {
  it("repairs Amex links, disables the duplicate Discover catalog, and closes stale Sandia jobs", () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, next_crawl_at TEXT, updated_at TEXT
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, external_id TEXT, requisition_id TEXT,
        company TEXT NOT NULL, official_url TEXT NOT NULL, apply_url TEXT,
        url_identity_key TEXT, status TEXT NOT NULL, closed_at TEXT, updated_at TEXT
      );
      INSERT INTO sources VALUES
        ('p2-0098-discover', 1, '2099-01-01', NULL),
        ('p2-0024-american-express', 1, '2099-01-01', NULL),
        ('p5-1051-sandia-national-labs', 1, '2099-01-01', NULL);
      INSERT INTO jobs VALUES
        ('amex', 'p2-0024-american-express', '26011991', NULL, 'American Express',
          'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26011991',
          'https://careers.americanexpress.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26011991/apply',
          'url:https://careers.americanexpress.com/hcmui/candidateexperience/en/sites/cx_1/job/26011991',
          'open', NULL, NULL),
        ('capital-one', 'p2-0098-discover', '99343885232', NULL, 'Discover',
          'https://www.capitalonecareers.com/job/mclean/strategy-consulting-intern-summer-2027/31238/99343885232',
          NULL, NULL, 'open', NULL, NULL),
        ('databricks', 'p4-0256-databricks', '6883068002', 'P-982', 'Databricks',
          'https://databricks.com/company/careers/open-positions/job?gh_jid=6883068002',
          NULL, NULL, 'open', NULL, NULL),
        ('sandia', 'p5-1051-sandia-national-labs', '698616', '698616', 'Sandia National Labs',
          'https://cg.sandia.gov/job?JobOpeningId=698616', NULL, NULL, 'open', NULL, NULL);
      ALTER TABLE jobs ADD COLUMN published_at TEXT;
      ALTER TABLE jobs ADD COLUMN source_updated_at TEXT;
    `);

    sqlite.exec(readFileSync(resolve("drizzle/0114_verified_posting_link_repairs.sql"), "utf8"));

    expect(sqlite.prepare(`SELECT official_url, apply_url, url_identity_key FROM jobs WHERE id='amex'`).get()).toEqual({
      official_url: "https://careers.americanexpress.com/en/sites/CX_1/job/26011991",
      apply_url: "https://careers.americanexpress.com/en/sites/CX_1/job/26011991/apply",
      url_identity_key: "url:https://careers.americanexpress.com/en/sites/cx_1/job/26011991",
    });
    expect(sqlite.prepare(`SELECT enabled, next_crawl_at FROM sources WHERE id='p2-0098-discover'`).get()).toEqual({
      enabled: 0,
      next_crawl_at: null,
    });
    expect(sqlite.prepare(`SELECT company FROM jobs WHERE id='capital-one'`).get()).toEqual({ company: "Capital One" });
    expect(sqlite.prepare(`SELECT published_at, source_updated_at FROM jobs WHERE id='databricks'`).get()).toEqual({
      published_at: "2023-08-17T21:27:27.000Z",
      source_updated_at: "2026-08-18T17:17:06.000Z",
    });
    expect(sqlite.prepare(`SELECT status, closed_at IS NOT NULL AS closed FROM jobs WHERE id='sandia'`).get()).toEqual({
      status: "closed",
      closed: 1,
    });
  });
});
