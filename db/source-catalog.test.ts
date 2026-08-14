import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type SeedSource = { id: string; postingUrl: string | null; adapter: string };

const expectedOfficialBoards: Record<string, [string, string]> = {
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

describe("verified official source catalog", () => {
  it("uses the first-party ATS boards instead of stale corporate landing pages", () => {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "db/seed/sources.json"), "utf8")) as { sources: SeedSource[] };
    const byId = new Map(seed.sources.map((source) => [source.id, source]));

    for (const [id, [postingUrl, adapter]] of Object.entries(expectedOfficialBoards)) {
      expect(byId.get(id)).toEqual(expect.objectContaining({ postingUrl, adapter }));
    }
  });

  it("requeues every repaired source in the immutable catalog migration", () => {
    const migration = readFileSync(join(process.cwd(), "drizzle/0087_refresh_sources_20260814215641.sql"), "utf8");
    for (const id of Object.keys(expectedOfficialBoards)) expect(migration).toContain(`'${id}'`);
    expect(migration).toContain("SET `next_crawl_at` = CURRENT_TIMESTAMP");
  });
});
