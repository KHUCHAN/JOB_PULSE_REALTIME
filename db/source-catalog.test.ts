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

const expectedOfficialBoards = { ...previousOfficialBoards, ...currentOfficialBoards };

describe("verified official source catalog", () => {
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
  });
});
