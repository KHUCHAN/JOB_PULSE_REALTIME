import { describe, expect, it } from "vitest";
import { verifySourceSnapshot } from "./source-snapshot-verification";
import type { CrawledJob } from "./crawler";
const job = { title: "AI Intern", officialUrl: "https://example.com/job/123", company: "Example" } as CrawledJob;
describe("post-ingestion exact public DB verification", () => {
  it("deduplicates samples and uses exact source/URL lookup, not FTS", async () => {
    const fetcher = (async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("sourceId")).toBe("source-1");
      expect(url.searchParams.get("officialUrl")).toBe(job.officialUrl);
      expect(url.searchParams.has("q")).toBe(false);
      return Response.json({ sourceId: "source-1", officialUrl: job.officialUrl });
    }) as typeof fetch;
    expect(await verifySourceSnapshot("https://site.test", "source-1", [job], fetcher)).toBe(1);
  });
  it.each([null, { sourceId: "source-2", officialUrl: job.officialUrl }, { sourceId: "source-1", officialUrl: "https://example.com/job/456" }])("rejects missing or wrong identity: %j", async (row) => {
    await expect(verifySourceSnapshot("https://site.test", "source-1", [job],
      (async () => Response.json(row)) as typeof fetch)).rejects.toThrow("missing from open DB");
  });
  it("reports HTTP errors", async () => {
    await expect(verifySourceSnapshot("https://site.test", "source-1", [job],
      (async () => new Response("unavailable", { status: 503 })) as typeof fetch)).rejects.toThrow("HTTP 503");
  });
});
