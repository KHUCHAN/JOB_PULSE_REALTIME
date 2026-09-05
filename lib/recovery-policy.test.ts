import { describe, expect, it } from "vitest";
import { deferRecovery, failedRecoveryIds, workdayMaintenance } from "./recovery-policy";
import { crawlSource, coastCentralJobsFromHtml } from "./crawler";
import { recoverCheckpointedCatalog } from "./request-fallback-recovery";

describe("bounded provider recovery", () => {
  it("distinguishes official maintenance from a challenge", () => {
    expect(workdayMaintenance("https://community.workday.com/maintenance-page", "")).toBe(true);
    expect(workdayMaintenance("https://www.myworkday.com/wday/drs/outage?t=kla", "")).toBe(true);
    expect(workdayMaintenance("", "<title>Workday is currently unavailable.</title>")).toBe(true);
    expect(workdayMaintenance("https://evil.example/maintenance-page", "<title>Challenge</title>")).toBe(false);
    expect(deferRecovery("HTTP 429")).toBe(true);
    expect(deferRecovery("HTTP 503")).toBe(false);
  });
  it("hands off every failed source without replaying successes", () => {
    expect(failedRecoveryIds({ attempted: 3, summaries: [
      { sourceId: "a", status: "failed" }, { sourceId: "b", status: "succeeded" }, { sourceId: "a", status: "failed" },
    ] })).toEqual(["a"]);
    expect(() => failedRecoveryIds({ attempted: 1, summaries: [] })).toThrow();
    expect(() => failedRecoveryIds({ attempted: 1, summaries: [{ sourceId: "a", status: "unknown" }] })).toThrow();
  });
  it("does not repeat maintenance inside checkpoint recovery", async () => {
    let calls = 0;
    const source = { id: "acme", company: "Acme", postingUrl: "https://acme.wd1.myworkdayjobs.com/Careers", adapter: "workday" as const };
    const fetcher: typeof fetch = async () => { calls++; return new Response("<title>Workday is currently unavailable.</title>"); };
    const result = await crawlSource(source, fetcher, new Date());
    expect(result).toMatchObject({ status: "failed", completeListing: false, jobs: [] });
    expect(result.error).toContain("upstream maintenance");
    calls = 0;
    await expect(recoverCheckpointedCatalog(source, fetcher, crawlSource, { maxStalls: 2 })).rejects.toThrow("upstream maintenance");
    expect(calls).toBe(1);
  });
  it("uses the verified KLA board without crawling a corporate landing page", async () => {
    const urls: string[] = [];
    await crawlSource({ id: "p5-0643-kla-corporation", company: "KLA", postingUrl: "https://www.kla.com/careers", adapter: "custom" }, async input => {
      urls.push(String(input)); return new Response(JSON.stringify({ total: 0, jobPostings: [] }));
    }, new Date());
    expect(urls).toEqual(["https://kla.wd1.myworkdayjobs.com/wday/cxs/kla/Search/jobs"]);
  });
  it("retains unknown Coast Central offices without inventing their location", () => {
    const html = `<meta property="article:modified_time" content="2026-09-05T00:00:00Z">
      <a href="https://www.coastccu.org/speed-bump/?url=https%3A%2F%2Fcopilot.formstack.com%2Fstart-workflow%2F21b99460-89d4-402b-96cb-61323a3cd8d3&prev=https%3A%2F%2Fwww.coastccu.org%2Fcommunity%2Fcareers%2F">Apply Now</a>
      <h2>Current Openings</h2><section><div class="co-accordion"><button class="co-accordion--trigger"><span>Mortgage Processor</span></button>
      <div class="co-accordion--content"><p>Work from our Harrison offices.</p><a href="https://www.coastccu.org/wp-content/uploads/2026/09/Mortgage-Processor.pdf">Mortgage Processor Full Job Description</a></div></div></section>`;
    const jobs = coastCentralJobsFromHtml(html, { id: "p2-0034-coast-central-cu", company: "Coast Central", postingUrl: "https://www.coastccu.org/community/careers/", adapter: "custom" });
    expect(jobs).toHaveLength(1);
    expect(jobs![0].location).toContain("verify office");
    expect(jobs![0].locationCountry).toBeUndefined();
  });
  it("reduces Amazon repeated head reads without losing catalog identities", async () => {
    const source = { id: "p4-0394-amazon", company: "Amazon / AWS", postingUrl: "https://www.amazon.jobs/en/", adapter: "custom" as const };
    const run = async (window?: number) => {
      let calls = 0, active = 0, peak = 0;
      const fetcher: typeof fetch = async input => {
        const offset = Number(new URL(String(input)).searchParams.get("offset") ?? 0);
        calls++; active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 1)); active--;
        return Response.json({ hits: 2230, jobs: Array.from({ length: Math.min(100, 2230 - offset) }, (_, i) => ({
          id_icims: String(offset + i), title: `Role ${offset + i}`, job_path: `/en/jobs/${offset + i}/role`,
        })) });
      };
      const result = await recoverCheckpointedCatalog({ ...source, requestPageWindow: window }, fetcher, crawlSource);
      return { result, calls, peak };
    };
    const before = await run(), after = await run(12);
    expect(after.result.jobs.map(job => job.externalId).sort()).toEqual(before.result.jobs.map(job => job.externalId).sort());
    expect(after.result.jobs).toHaveLength(2230);
    expect(after.result.completeListing).toBe(false);
    expect(after.calls).toBeLessThan(before.calls);
    expect(after.peak).toBe(3);
  });
});
