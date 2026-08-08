import { describe, expect, it } from "vitest";
import { crawlSource, discoverAts } from "./crawler";

describe("crawlSource", () => {
  it("discovers a public Lever JSON feed from a careers page link", () => {
    expect(discoverAts(
      '<a href="https://jobs.lever.co/acme">Open jobs</a>',
      "https://acme.example/careers",
    )).toEqual({
      kind: "lever",
      endpoint: "https://api.lever.co/v0/postings/acme?mode=json",
    });
  });

  it("discovers a Greenhouse board behind a company careers page", () => {
    expect(discoverAts(
      '<a href="https://job-boards.greenhouse.io/acme">Open jobs</a>',
      "https://acme.example/careers",
    )).toEqual({
      kind: "greenhouse",
      endpoint: "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
    });
  });

  it("discovers a direct Workday search feed behind a company careers page", () => {
    expect(discoverAts(
      '<a href="https://acme.wd5.myworkdayjobs.com/Careers">Open jobs</a>',
      "https://acme.example/careers",
    )).toEqual({
      kind: "workday",
      endpoint: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
    });
  });

  it("uses the public Greenhouse board API and normalizes its open roles", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        jobs: [{
          id: 42,
          title: "Data Engineer",
          absolute_url: "https://job-boards.greenhouse.io/acme/jobs/42",
          updated_at: "2026-08-08T12:00:00Z",
          location: { name: "San Francisco, CA" },
          content: "<p>Build trusted data products.</p>",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "acme",
      company: "Acme",
      postingUrl: "https://job-boards.greenhouse.io/acme",
      adapter: "greenhouse",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"]);
    expect(result).toEqual({
      status: "succeeded",
      responseStatus: 200,
      completeListing: true,
      jobs: [{
        externalId: "42",
        title: "Data Engineer",
        company: "Acme",
        location: "San Francisco, CA",
        arrangement: "unknown",
        employmentType: null,
        summary: "Build trusted data products.",
        officialUrl: "https://job-boards.greenhouse.io/acme/jobs/42",
        publishedAt: "2026-08-08T12:00:00.000Z",
      }],
      error: null,
    });
  });

  it("reads JobPosting JSON-LD from an official careers page without treating the page as a complete listing", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"JobPosting","title":"Senior Fraud Analyst","url":"https://careers.example.com/jobs/fraud-7","datePosted":"2026-08-07","employmentType":"FULL_TIME","jobLocation":{"address":{"addressLocality":"New York","addressRegion":"NY"}},"description":"<p>Investigate <strong>fraud</strong> signals.</p>","identifier":{"value":"fraud-7"}}
        </script>
      </head></html>`, { status: 200, headers: { "content-type": "text/html" } });

    const result = await crawlSource({
      id: "example",
      company: "Example Co",
      postingUrl: "https://careers.example.com/jobs",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result).toEqual({
      status: "succeeded",
      responseStatus: 200,
      completeListing: false,
      jobs: [{
        externalId: "fraud-7",
        title: "Senior Fraud Analyst",
        company: "Example Co",
        location: "New York, NY",
        arrangement: "unknown",
        employmentType: "FULL_TIME",
        summary: "Investigate fraud signals.",
        officialUrl: "https://careers.example.com/jobs/fraud-7",
        publishedAt: "2026-08-07T00:00:00.000Z",
      }],
      error: null,
    });
  });

  it("follows a discovered Lever feed and treats its response as a complete listing", async () => {
    const requests: string[] = [];
    const responses = [
      new Response('<a href="https://jobs.lever.co/acme">Open roles</a>', { status: 200 }),
      new Response(JSON.stringify([{
        id: "lever-7",
        text: "Risk Analyst",
        hostedUrl: "https://jobs.lever.co/acme/lever-7",
        categories: { location: "Remote, US", commitment: "Full-time" },
        descriptionPlain: "Find material risk signals.",
      }]), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return responses.shift()!;
    };

    const result = await crawlSource({
      id: "acme",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual([
      "https://acme.example/careers",
      "https://api.lever.co/v0/postings/acme?mode=json",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "lever-7",
        title: "Risk Analyst",
        location: "Remote, US",
        employmentType: "Full-time",
        officialUrl: "https://jobs.lever.co/acme/lever-7",
      })],
    }));
  });

  it("uses Workday's public search endpoint for a direct Workday careers URL", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        total: 2,
        jobPostings: [{
          title: "Security Engineer",
          externalPath: "/job/Austin-TX/Security-Engineer_JR-100",
          locations: ["Austin, TX"],
          bulletFields: ["Engineering", "Full time"],
        }, { title: "Non-job card" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "acme-workday",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual([{
      url: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
      init: expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }),
        headers: expect.objectContaining({
          accept: "application/json",
          origin: "https://acme.wd5.myworkdayjobs.com",
          referer: "https://acme.wd5.myworkdayjobs.com/Careers",
          "user-agent": "JobPulseCrawler/1.0 (+https://job-pulse.local)",
        }),
      }),
    }]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      responseStatus: 200,
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "JR-100",
        title: "Security Engineer",
        location: "Austin, TX",
        officialUrl: "https://acme.wd5.myworkdayjobs.com/job/Austin-TX/Security-Engineer_JR-100",
      })],
    }));
  });
});
