import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type SeedSource = { id: string; postingUrl: string | null; adapter: string; enabled: boolean };

const previousOfficialBoards: Record<string, [string, string]> = {
  "audit-row-369": ["https://fa-evlf-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", "custom"],
  "p1-0007-kroll": ["https://hcxs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", "custom"],
  "p2-0116-hancock-whitney": ["https://hancockwhitney.wd5.myworkdayjobs.com/Careers", "workday"],
  "p2-0181-voya-financial": ["https://godirect.wd5.myworkdayjobs.com/voya_jobs", "workday"],
  "p4-0334-quantexa": ["https://jobs.ashbyhq.com/quantexa", "ashby"],
  "p4-0360-t-rowe-price": ["https://troweprice.wd5.myworkdayjobs.com/TRowePrice", "workday"],
  "p4-0495-securonix": ["https://securonix.bamboohr.com/careers", "custom"],
  "p4-0506-tiger-analytics": ["https://apply.workable.com/tiger-analytics/", "custom"],
  "p4-0515-wiz": ["https://job-boards.greenhouse.io/wizinc", "greenhouse"],
  "p4-0521-zscaler": ["https://job-boards.greenhouse.io/zscaler", "greenhouse"],
  "p5-0745-take-two-interactive": ["https://job-boards.greenhouse.io/taketwo", "greenhouse"],
  "p5-0750-thales-us": ["https://thales.wd3.myworkdayjobs.com/Careers", "workday"],
  "p5-1015-pathai": ["https://job-boards.greenhouse.io/pathai", "greenhouse"],
  "p5-1050-samsung-semiconductor": ["https://sec.wd3.myworkdayjobs.com/Samsung_Careers", "workday"],
  "p5-1107-welldoc": ["https://welldoc.bamboohr.com/careers", "custom"],
};

const currentOfficialBoards: Record<string, [string, string]> = {
  "audit-row-342": ["https://delta.avature.net/en_US/careers/SearchJobs", "custom"],
  "p2-0067-wells-fargo": ["https://www.wellsfargojobs.com/en/jobs/", "custom"],
  "p4-0450-jfrog": ["https://join.jfrog.com/positions", "custom"],
  "p4-0451-k2-integrity": ["https://k2integrity.careers.hibob.com/jobs", "custom"],
  "p5-1041-rippling": ["https://www.rippling.com/careers/open-roles", "custom"],
};

const repairedOfficialBoards: Record<string, [string, string]> = {
  "legacy-row-126": ["https://www.jobs-ups.com/us/en/search-results", "phenom"],
  "p2-0179-us-attorney-s-office": ["https://www.justice.gov/usao/career-center/job-openings/attorneys", "custom"],
};

const latestRepairedOfficialBoards: Record<string, [string, string]> = {
  "p2-0183-webster-bank": ["https://websteronline.wd12.myworkdayjobs.com/WebsterExternalCareerSite", "workday"],
  "p4-0369-tigerconnect": ["https://tigerconnect.wd1.myworkdayjobs.com/TC", "workday"],
  "audit-row-3447": ["https://td.wd3.myworkdayjobs.com/TD_Bank_Careers", "workday"],
  "audit-row-3448": ["https://careers-springswindowfashions.icims.com/jobs/search?ss=1&in_iframe=1", "icims"],
};

const expectedOfficialBoards = {
  ...previousOfficialBoards,
  ...currentOfficialBoards,
  ...repairedOfficialBoards,
  ...latestRepairedOfficialBoards,
};

describe("verified official source catalog", () => {
  it("preserves incremental catalog synchronization for this repair", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as {
      generatedAt: string;
      incrementalSourceIdsByPreviousVersion: Record<string, string[]>;
    };
    expect(seed.generatedAt).toBe("2026-09-01");
    expect(seed.incrementalSourceIdsByPreviousVersion[
      "v2:sha256:835306aa88bf670a9266a8abb509471bf5ac9d7170dcabdee2ff62f70cf66e25"
    ]).toEqual([
      "audit-row-342",
      "legacy-row-84",
      "p5-0842-carefirst-bluecross-blueshield",
      "p4-0285-google",
      "p4-0369-tigerconnect",
      "audit-row-3447",
      "audit-row-3448",
    ]);
  });

  it("uses the first-party ATS boards instead of stale corporate landing pages", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const byId = new Map(seed.sources.map((source) => [source.id, source]));

    for (const [id, [postingUrl, adapter]] of Object.entries(expectedOfficialBoards)) {
      expect(byId.get(id)).toEqual(expect.objectContaining({ postingUrl, adapter }));
    }
  });

  it("keeps the acquired Discover catalog inactive instead of duplicating Capital One jobs", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const discover = seed.sources.find((source) => source.id === "p2-0098-discover");

    expect(discover).toEqual(expect.objectContaining({
      postingUrl: null,
      enabled: false,
    }));
  });

  it("keeps the acquired Cadence catalog inactive instead of duplicating Huntington jobs", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const cadence = seed.sources.find((source) => source.id === "p2-0086-cadence-bank");
    const huntington = seed.sources.find((source) => source.id === "p2-0118-huntington-bancshares");

    expect(cadence).toEqual(expect.objectContaining({
      postingUrl: null,
      enabled: false,
    }));
    expect(huntington).toEqual(expect.objectContaining({
      postingUrl: "https://huntington-careers.com/search/searchjobs",
      enabled: true,
    }));
  });

  it("keeps retired Bitstamp inactive while retaining Robinhood's authoritative catalog", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const byId = new Map(seed.sources.map((source) => [source.id, source]));

    expect(byId.get("p4-0230-bitstamp")).toEqual(expect.objectContaining({
      postingUrl: null,
      enabled: false,
    }));
    expect(byId.get("p2-0057-robinhood")).toEqual(expect.objectContaining({
      postingUrl: "https://job-boards.greenhouse.io/robinhood",
      adapter: "greenhouse",
      enabled: true,
    }));
  });

  it("disables duplicate acquired feeds while retaining each authoritative catalog", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const byId = new Map(seed.sources.map((source) => [source.id, source]));

    for (const id of ["p4-0331-progressive", "p4-0455-logrhythm", "p5-0601-galileo-ai"]) {
      expect(byId.get(id)).toEqual(expect.objectContaining({ enabled: false }));
    }
    for (const id of ["p5-1028-progressive-insurance", "p4-0426-exabeam", "p4-0285-google"]) {
      expect(byId.get(id)).toEqual(expect.objectContaining({ enabled: true }));
    }
  });

  it("pins Enphase and Jacobs to the canonical boards used by their native crawlers", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const byId = new Map(seed.sources.map((source) => [source.id, source]));

    expect(byId.get("legacy-row-102")).toEqual(expect.objectContaining({
      postingUrl: "https://jacobs.jobs/jobs/",
      adapter: "custom",
      enabled: true,
    }));
    expect(byId.get("p5-0891-enphase-energy")).toEqual(expect.objectContaining({
      postingUrl: "https://jobs.jobvite.com/enphase-energy/",
      adapter: "custom",
      enabled: true,
    }));
  });

  it("pins Bumble to its populated Lever board instead of the retired locale route", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const bumble = seed.sources.find((source) => source.id === "p4-0405-bumble");

    expect(bumble).toEqual(expect.objectContaining({
      postingUrl: "https://jobs.lever.co/bumbleinc",
      adapter: "lever",
      enabled: true,
    }));
  });

  it("requeues every repaired source in the immutable catalog migration", () => {
    const previousMigration = readFileSync(join(process.cwd(), "drizzle/0087_refresh_sources_20260814215641.sql"), "utf8");
    for (const id of Object.keys(previousOfficialBoards)) expect(previousMigration).toContain(`'${id}'`);
    expect(previousMigration).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");

    const currentMigrationName = readdirSync(join(process.cwd(), "drizzle"))
      .find((name) => /^0088_refresh_sources_\d+\.sql$/.test(name));
    expect(currentMigrationName).toBeTruthy();
    const currentMigration = readFileSync(join(process.cwd(), "drizzle", currentMigrationName!), "utf8");
    for (const id of Object.keys(currentOfficialBoards)) expect(currentMigration).toContain(`'${id}'`);
    expect(currentMigration).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");

    const repairedMigration = readFileSync(join(process.cwd(), "drizzle/0133_refresh_sources_20260831192633.sql"), "utf8");
    for (const id of Object.keys(repairedOfficialBoards)) expect(repairedMigration).toContain(`'${id}'`);
    expect(repairedMigration).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");

    const latestMigrationName = readdirSync(join(process.cwd(), "drizzle"))
      .find((name) => /^0138_refresh_sources_\d+\.sql$/.test(name));
    expect(latestMigrationName).toBeTruthy();
    const latestMigration = readFileSync(join(process.cwd(), "drizzle", latestMigrationName!), "utf8");
    for (const id of Object.keys(latestRepairedOfficialBoards)) expect(latestMigration).toContain(`'${id}'`);
    expect(latestMigration).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");
  });
});
