import { describe, expect, it, vi } from "vitest";
import type { CrawledJob, CrawlSource } from "../lib/crawler";
import { browserListingSource, browserResultClassification, nativeRunnerRecoveryEligible, persistenceSql, recoverNativeOutsideWorker, type BrowserFallbackResult } from "./browser-fallback-crawl";

describe("browser fallback Workday recovery", () => {
  it("uses the independent runner's official CXS access before browser rendering", async () => {
    const source = {
      id: "workday-source",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday" as const,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        total: 1,
        jobPostings: [{
          title: "Data Science Intern",
          externalPath: "/job/New-York/Data-Science-Intern_JR-10001",
          locationsText: "New York, NY",
          postedOn: "Posted Today",
          bulletFields: ["Intern", "JR-10001"],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await recoverNativeOutsideWorker(
      source,
      fetcher as typeof fetch,
      new Date("2026-08-15T12:00:00Z"),
    );

    expect(result).toMatchObject({
      status: 200,
      finalUrl: source.postingUrl,
      error: null,
      jobs: [{
        title: "Data Science Intern",
        externalId: "JR-10001",
        employmentType: "Internship",
        publishedAt: "2026-08-15T12:00:00.000Z",
      }],
    });
    expect(fetcher).toHaveBeenCalled();
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/wday/cxs/acme/Careers/jobs");
  });

  it("leaves non-Workday sources on the normal browser-recovery path", async () => {
    const fetcher = vi.fn();
    await expect(recoverNativeOutsideWorker({
      id: "custom-source",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher as typeof fetch)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("selects only known Worker-egress failures for the independent native pass", () => {
    expect(nativeRunnerRecoveryEligible({ adapter: "workday" })).toBe(true);
    expect(nativeRunnerRecoveryEligible({ adapter: "custom", health: "blocked", currentJobs: 0 })).toBe(true);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 24,
      lastError: "iCIMS returned an incomplete or unstable catalog page.",
    })).toBe(true);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 0,
      lastError: "No supported public job feed or job listings were discovered.",
    })).toBe(false);
    expect(nativeRunnerRecoveryEligible({
      adapter: "custom",
      health: "failed",
      currentJobs: 0,
      lastError: "empty_board",
    })).toBe(true);
  });

  it("records an independently verified authoritative empty Workday board as healthy", async () => {
    const source = {
      id: "empty-workday",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday" as const,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ total: 0, jobPostings: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await recoverNativeOutsideWorker(source, fetcher as typeof fetch);
    expect(result).toMatchObject({ authoritativeEmpty: true, jobs: [], status: 200 });
    expect(browserResultClassification(result!)).toEqual({ status: "succeeded", code: "empty_board" });
  });
});

describe("browser fallback source normalization", () => {
  it("starts Delta recovery on the official internship search instead of a stale catalog cursor", () => {
    expect(browserListingSource({
      id: "audit-row-342",
      company: "Delta Air Lines",
      postingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=40",
      adapter: "custom",
    }).postingUrl).toBe("https://delta.avature.net/en_US/careers/SearchJobs/?2884=75201&2884_format=3665&listFilterMode=1&jobOffset=0");
  });

  it("leaves unrelated sources unchanged", () => {
    const source: CrawlSource = {
      id: "source-1",
      company: "Acme",
      postingUrl: "https://jobs.example.com/?page=4",
      adapter: "custom",
    };
    expect(browserListingSource(source)).toBe(source);
  });
});

describe("browser fallback persistenceSql", () => {
  it("persists location region and replaces direct managed job areas", () => {
    const source: CrawlSource = {
      id: "source-1",
      company: "Acme",
      postingUrl: "https://jobs.example.com",
      adapter: "custom",
    };
    const job = {
      externalId: "swe-1",
      title: "Summer 2027 Software Engineering Internship",
      company: "Acme",
      location: "Austin, TX",
      locationCountry: "United States",
      arrangement: "onsite",
      employmentType: "Internship",
      summary: "Build software.",
      officialUrl: "https://jobs.example.com/swe-1",
      publishedAt: "2026-08-10T00:00:00.000Z",
    } satisfies CrawledJob;
    const result: BrowserFallbackResult = {
      source,
      status: 200,
      finalUrl: source.postingUrl,
      jobs: [job],
      error: null,
    };

    const sql = persistenceSql([result]);

    expect(sql).toContain("location_region");
    expect(sql).toContain("area_classified_at");
    expect(sql).toMatch(/v3:\d{4}-\d{2}-\d{2}T/);
    expect(sql).toContain("location_region=CASE WHEN excluded.location_region='unknown'");
    expect(sql).toContain("DELETE FROM job_topics WHERE topic_key LIKE 'area:%'");
    expect(sql).toContain("area:software-engineering");
  });
});

describe("browser fallback result classification", () => {
  it("keeps a 2xx page with no verified jobs retryable instead of healthy", () => {
    expect(browserResultClassification({
      source: {
        id: "source-empty",
        company: "Acme",
        postingUrl: "https://jobs.example.com",
        adapter: "custom",
      },
      status: 200,
      finalUrl: "https://jobs.example.com",
      jobs: [],
      error: null,
    })).toEqual({ status: "failed", code: "empty_board" });
  });
});
