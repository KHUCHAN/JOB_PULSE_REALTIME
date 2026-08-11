import { describe, expect, it } from "vitest";
import * as crawlerModule from "./crawler";
import { crawlSource, discoverAts, oracleCareerSite } from "./crawler";

describe("large catalog content", () => {
  it("keeps a bounded search summary without retaining every full description in memory", () => {
    const compactJibeContent = (crawlerModule as Record<string, unknown>).compactJibeContent;
    expect(compactJibeContent).toBeTypeOf("function");
    expect((compactJibeContent as (value: string, compact: boolean) => unknown)("x".repeat(5_000), true)).toEqual({ summary: "x".repeat(100) });
    expect((compactJibeContent as (value: string, compact: boolean) => unknown)("Full description", false)).toEqual({ summary: "Full description", description: "Full description" });
  });
});

describe("crawlSource", () => {
  it("crawls Citadel jobs from its public career sitemap when the listing page is edge-blocked", async () => {
    const jobUrl = "https://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/";
    const sitemapUrls = [jobUrl, ...Array.from({ length: 9 }, (_, index) => `https://www.citadel.com/careers/details/example-role-${index + 1}/`)];
    const requests: Array<{ url: string; returnFormat: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, returnFormat: headers.get("x-return-format") });
      if (url === "https://www.citadel.com/career-sitemap.xml") {
        return new Response(`<?xml version="1.0"?><urlset>${sitemapUrls.map((sitemapUrl) =>
          `<url><loc>${sitemapUrl}</loc><lastmod>2026-08-11T14:14:26+00:00</lastmod></url>`).join("")}</urlset>`,
        { status: 200, headers: { "content-type": "application/xml" } });
      }
      if (url === "https://r.jina.ai/http://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/") {
        return new Response(`<script type="application/ld+json">{
          "@context":"https://schema.org", "@type":"JobPosting",
          "title":"Sector Data Scientist - 2027 Intern (US)",
          "description":"Analyze large, unstructured data sets with Python and SQL.",
          "datePosted":"2026-08-11", "employmentType":"internship",
          "identifier":{"value":"sector-data-scientist-2027-intern-us"},
          "mainEntityOfPage":{"@type":"WebPage","url":"${jobUrl}"},
          "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"New York","addressRegion":"NY","addressCountry":"US"}}
        }</script>`, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await crawlSource({
      id: "p5-0575-citadel",
      company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false, responseStatus: 200 }));
    expect(result.jobs).toHaveLength(10);
    expect(result.jobs.find((job) => job.officialUrl === jobUrl)).toEqual(expect.objectContaining({
      externalId: "sector-data-scientist-2027-intern-us",
      title: "Sector Data Scientist - 2027 Intern (US)",
      employmentType: "Internship",
      location: "New York, NY, US",
      locationCity: "New York",
      locationState: "NY",
      locationCountry: "US",
      officialUrl: jobUrl,
      publishedAt: "2026-08-11T00:00:00.000Z",
    }));
    expect(requests[0]).toEqual({ url: "https://www.citadel.com/career-sitemap.xml", returnFormat: null });
    expect(requests).toContainEqual({
      url: "https://r.jina.ai/http://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/",
      returnFormat: "html",
    });
  });

  it("still detects every Citadel sitemap job when a detail reader receives a challenge page", async () => {
    const jobUrl = "https://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/";
    const sitemapUrls = [jobUrl, ...Array.from({ length: 9 }, (_, index) => `https://www.citadel.com/careers/details/example-role-${index + 1}/`)];
    const fetcher: typeof fetch = async (input) => String(input).endsWith("career-sitemap.xml")
      ? new Response(`<urlset>${sitemapUrls.map((sitemapUrl) =>
        `<url><loc>${sitemapUrl}</loc><lastmod>2026-08-11T14:14:26+00:00</lastmod></url>`).join("")}</urlset>`, { status: 200 })
      : new Response("<html><title>Just a moment...</title></html>", { status: 200 });

    const result = await crawlSource({
      id: "p5-0575-citadel",
      company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false }));
    expect(result.jobs).toHaveLength(10);
    expect(result.jobs.find((job) => job.officialUrl === jobUrl)).toEqual(expect.objectContaining({
      externalId: "sector-data-scientist-2027-intern-us",
      title: "Sector Data Scientist - 2027 Intern (US)",
      employmentType: "Internship",
      location: "United States",
      locationCountry: "US",
      officialUrl: jobUrl,
      publishedAt: null,
      sourceUpdatedAt: "2026-08-11T14:14:26.000Z",
    }));
  });

  it("preserves Citadel sitemap classifications when detail JSON-LD is partial", async () => {
    const jobUrl = "https://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/";
    const sitemapUrls = [jobUrl, ...Array.from({ length: 9 }, (_, index) => `https://www.citadel.com/careers/details/example-role-${index + 1}/`)];
    const fetcher: typeof fetch = async (input) => String(input).endsWith("career-sitemap.xml")
      ? new Response(`<urlset>${sitemapUrls.map((sitemapUrl) => `<url><loc>${sitemapUrl}</loc></url>`).join("")}</urlset>`, { status: 200 })
      : String(input).includes("sector-data-scientist-2027-intern-us")
        ? new Response(`<script type="application/ld+json">{
          "@type":"JobPosting", "title":"Sector Data Scientist - 2027 Intern (US)",
          "mainEntityOfPage":{"url":"${jobUrl}"}
        }</script>`, { status: 200 })
        : new Response("challenge", { status: 403 });

    const result = await crawlSource({
      id: "p5-0575-citadel", company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/", adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));
    const target = result.jobs.find((job) => job.officialUrl === jobUrl);

    expect(result.completeListing).toBe(false);
    expect(target).toEqual(expect.objectContaining({
      externalId: "sector-data-scientist-2027-intern-us",
      employmentType: "Internship",
      location: "United States",
      locationCountry: "US",
    }));
  });

  it("enriches a Citadel internship from reader markdown when HTML returns a challenge", async () => {
    const jobUrl = "https://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/";
    const sitemapUrls = [jobUrl, ...Array.from({ length: 9 }, (_, index) => `https://www.citadel.com/careers/details/example-role-${index + 1}/`)];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("career-sitemap.xml")) {
        return new Response(`<urlset>${sitemapUrls.map((sitemapUrl) => `<url><loc>${sitemapUrl}</loc></url>`).join("")}</urlset>`, { status: 200 });
      }
      if (!url.includes("sector-data-scientist-2027-intern-us")) return new Response("challenge", { status: 403 });
      const headers = new Headers(init?.headers);
      if (headers.get("x-return-format") === "html") return new Response("blocked", { status: 403 });
      return new Response(`Title: Sector Data Scientist - 2027 Intern (US) - Citadel

URL Source: http://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/

# Sector Data Scientist – 2027 Intern (US)

New York

## Job Description

Analyze large unstructured data sets. Experience with Python, SQL, and Excel. Pursuing a bachelor's in computer science.

## About Citadel`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p5-0575-citadel", company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/", adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));
    const target = result.jobs.find((job) => job.officialUrl === jobUrl);

    expect(target).toEqual(expect.objectContaining({
      title: "Sector Data Scientist – 2027 Intern (US)",
      location: "New York",
      locationCity: "New York",
      locationCountry: "US",
      employmentType: "Internship",
      summary: "Analyze large unstructured data sets. Experience with Python, SQL, and Excel. Pursuing a bachelor's in computer science.",
      description: "Analyze large unstructured data sets. Experience with Python, SQL, and Excel. Pursuing a bachelor's in computer science.",
    }));
  });

  it("rejects Citadel reader markdown sourced from a different job URL", async () => {
    const jobUrl = "https://www.citadel.com/careers/details/sector-data-scientist-2027-intern-us/";
    const sitemapUrls = [jobUrl, ...Array.from({ length: 9 }, (_, index) => `https://www.citadel.com/careers/details/example-role-${index + 1}/`)];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("career-sitemap.xml")) {
        return new Response(`<urlset>${sitemapUrls.map((sitemapUrl) => `<url><loc>${sitemapUrl}</loc></url>`).join("")}</urlset>`, { status: 200 });
      }
      if (!url.includes("sector-data-scientist-2027-intern-us")) return new Response("challenge", { status: 403 });
      const headers = new Headers(init?.headers);
      if (headers.get("x-return-format") === "html") return new Response(`<script type="application/ld+json">{
        "@type":"JobPosting", "title":"Wrong HTML Role", "url":"https://www.citadel.com/careers/details/different-role/",
        "description":"Wrong HTML description.",
        "jobLocation":{"address":{"addressLocality":"London","addressCountry":"GB"}}
      }</script>`, { status: 200 });
      return new Response(`Title: Wrong Role - Citadel
URL Source: http://www.citadel.com/careers/details/different-role/
# Wrong Role
London
## Job Description
Wrong description.
## About Citadel`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p5-0575-citadel", company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/", adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));
    const target = result.jobs.find((job) => job.officialUrl === jobUrl);

    expect(target).toEqual(expect.objectContaining({
      title: "Sector Data Scientist - 2027 Intern (US)",
      location: "United States",
      employmentType: "Internship",
      summary: null,
    }));
  });

  it("does not authorize Citadel closures from a truncated sitemap", async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      `<url><loc>https://www.citadel.com/careers/details/example-role-${index + 1}/</loc></url>`).join("");
    const fetcher: typeof fetch = async (input) => String(input).endsWith("career-sitemap.xml")
      ? new Response(`<urlset>${rows}`, { status: 200 })
      : new Response("challenge", { status: 403 });

    const result = await crawlSource({
      id: "p5-0575-citadel", company: "Citadel / Citadel Securities",
      postingUrl: "https://www.citadel.com/careers/open-opportunities/", adapter: "custom",
    }, fetcher, new Date("2026-08-11T15:00:00Z"));

    expect(result.jobs).toHaveLength(10);
    expect(result.completeListing).toBe(false);
  });

  it("discovers the Oracle API tenant behind a vanity careers domain", () => {
    const html = '<script src="https://eluq.fa.us2.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script>';
    expect(oracleCareerSite(html, "https://www.krogerfamilycareers.com/en/sites/CX_2001/jobs")).toEqual({
      apiOrigin: "https://eluq.fa.us2.oraclecloud.com",
      site: "CX_2001",
    });
  });

  it("accepts Oracle's default CX site identifier", () => {
    const html = '<script src="https://egcu.fa.us6.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script>';
    expect(oracleCareerSite(html, "https://egcu.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/")).toEqual({
      apiOrigin: "https://egcu.fa.us6.oraclecloud.com",
      site: "CX",
    });
  });

  it("discovers the Oracle API site number when the public slug is not the CX identifier", () => {
    const html = [
      '<script src="https://eeho.fa.us2.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script>',
      '<link href="/theme.css?siteNumber=CX_45001&size=16x16">',
    ].join("");
    expect(oracleCareerSite(html, "https://careers.oracle.com/en/sites/jobsearch/")).toEqual({
      apiOrigin: "https://eeho.fa.us2.oraclecloud.com",
      site: "CX_45001",
    });
  });

  it("discovers a public Lever JSON feed from a careers page link", () => {
    expect(discoverAts(
      '<a href="https://jobs.lever.co/acme">Open jobs</a>',
      "https://acme.example/careers",
    )).toEqual({
      kind: "lever",
      endpoint: "https://api.lever.co/v0/postings/acme?mode=json",
    });
  });

  it("discovers a public Ashby feed from a careers page link", () => {
    expect(discoverAts(
      '<a href="https://jobs.ashbyhq.com/acme">Open jobs</a>',
      "https://acme.example/careers",
    )).toEqual({
      kind: "ashby",
      endpoint: "https://api.ashbyhq.com/posting-api/job-board/acme",
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

  it("discovers a SmartRecruiters widget from its company code", () => {
    expect(discoverAts(
      '<script class="job_widget">widget({"company_code":"Expeditors"})</script>',
      "https://www.expeditors.com/careers/jobs/",
    )).toEqual({
      kind: "smartrecruiters",
      endpoint: "https://api.smartrecruiters.com/v1/companies/Expeditors/postings",
    });
  });

  it("discovers the Jibe API from the current CMS asset host", () => {
    expect(discoverAts(
      '<script src="https://cms.jibecdn.com/prod/stonex/app.js"></script>',
      "https://join.stonex.com/jobs",
    )).toEqual({
      kind: "jibe",
      endpoint: "https://join.stonex.com/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false",
    });
  });

  it("paginates a discovered SmartRecruiters feed and emits public job URLs", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://acme.example/careers") {
        return new Response('<script>widget({"company_code":"Acme"})</script>', { status: 200 });
      }
      const offset = new URL(url).searchParams.get("offset");
      return new Response(JSON.stringify({
        totalFound: 2,
        content: offset === "1" ? [{ id: "2", name: "Designer", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/2" }] : [{
          id: "1", name: "Engineer", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/1", refNumber: "REQ-1",
          department: { label: "Platform" }, function: { label: "Engineering" }, industry: { label: "Software" },
          experienceLevel: { label: "Mid-Senior" }, releasedDate: "2026-08-01T00:00:00Z",
          location: { city: "Austin", region: "Texas", country: "us", remote: true, hybrid: false, latitude: 30.27, longitude: -97.74 },
          typeOfEmployment: { label: "Full-time" }, language: { code: "en", label: "English" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.example/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://jobs.smartrecruiters.com/Acme/1",
      "https://jobs.smartrecruiters.com/Acme/2",
    ]);
    expect(requests).toContain("https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=1");
    expect(result.completeListing).toBe(true);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      requisitionId: "REQ-1", department: "Platform", jobFunction: "Engineering", industry: "Software",
      experienceLevel: "Mid-Senior", arrangement: "remote", locationCity: "Austin", locationState: "Texas",
      locationCountry: "us", latitude: 30.27, longitude: -97.74, languages: ["English"],
      publishedAt: "2026-08-01T00:00:00.000Z",
    }));
  });

  it("discovers and fully paginates a Jibe careers API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.acme.example/") {
        return new Response('<script src="https://app.jibecdn.com/prod/search/app.js"></script>', { status: 200 });
      }
      const page = Number(new URL(url).searchParams.get("page"));
      const jobs = page === 1
        ? [{ data: { slug: "101", req_id: "REQ-101", title: "Engineer", language: "en-us", full_location: "Remote", employment_type: "FULL_TIME", posted_date: "2026-08-08T12:00:00+0000" } }]
        : [{ data: { slug: "102", req_id: "REQ-102", title: "Designer", language: "en-us", full_location: "New York, NY", employment_type: "FULL_TIME", posted_date: "2026-08-07T12:00:00+0000" } }];
      return new Response(JSON.stringify({
        totalCount: 2,
        filter: { categories: { all: [{ category: "Engineering", numJobs: 2 }] }, facetList: { state: [{ term: "New York", count: 1 }] } },
        jobs: jobs.map((job) => ({ ...job, data: { ...job.data, category: "Engineering", responsibilities: "Build systems.", qualifications: "SQL required.", city: "New York", state: "NY", country: "United States", country_code: "US" } })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://careers.acme.example/", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      jobFamily: "Engineering", responsibilities: "Build systems.", qualifications: "SQL required.",
      locationCity: "New York", locationState: "NY", locationCountry: "United States",
    }));
    expect(result.facets).toEqual(expect.arrayContaining([
      { key: "category", label: "Category", values: [{ key: "Engineering", label: "Engineering", count: 2 }] },
      { key: "state", label: "State", values: [{ key: "New York", label: "New York", count: 1 }] },
    ]));
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://careers.acme.example/jobs/101?lang=en-us",
      "https://careers.acme.example/jobs/102?lang=en-us",
    ]);
    expect(requests).toContain("https://careers.acme.example/api/jobs?page=2&limit=100&sortBy=relevance&descending=false&internal=false");
  });

  it("fully paginates a Radancy TalentBrew job search", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let pageAttempts = 0;
    const first = [
      '<script src="https://tbcdn.talentbrew.com/js/client/search.js"></script>',
      '<section id="search-results" data-total-results="2" data-total-pages="2" data-current-page="1" data-records-per-page="1" data-ajax-post-url="/search-jobs/resultspost" data-search-results-module-name="Search Results" data-sort-criteria="5" data-sort-direction="1" data-search-type="5">',
      '<a href="/job/analyst/1/1">Analyst</a>',
      '</section>',
    ].join("");
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      if (url === "https://jobs.acme.example/search-jobs") return new Response(first, { status: 200 });
      pageAttempts += 1;
      if (pageAttempts === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ results: '<a href="/job/designer/1/2">Designer</a>' }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({ id: "radancy", company: "Acme", postingUrl: "https://jobs.acme.example/search-jobs", adapter: "custom" }, fetcher, new Date());

    expect(requests).toContainEqual({ url: "https://jobs.acme.example/search-jobs/resultspost", method: "POST" });
    expect(pageAttempts).toBe(2);
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://jobs.acme.example/job/analyst/1/1",
      "https://jobs.acme.example/job/designer/1/2",
    ]);
  });

  it("fully paginates a SuccessFactors HTML job search", async () => {
    const requests: string[] = [];
    const page = (start: number) => [
      '<script src="https://hcm41.sapsf.com/platform/js/search/search.js"></script>',
      `<span class="paginationLabel">Results <b>${start + 1} – ${start + 1}</b> of <b>2</b></span>`,
      start === 0 ? '<a href="?q=&startrow=1" title="Page 2">2</a>' : "",
      `<a class="jobTitle-link" href="/job/Role-${start + 1}/${100 + start}/">Role ${start + 1}</a>`,
    ].join("");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const start = Number(new URL(url).searchParams.get("startrow") ?? 0);
      return new Response(page(start), { status: 200 });
    };

    const result = await crawlSource({ id: "successfactors", company: "Acme", postingUrl: "https://careers.acme.example/search/", adapter: "custom" }, fetcher, new Date());

    expect(requests).toEqual([
      "https://careers.acme.example/search/",
      "https://careers.acme.example/search/?q=&startrow=1",
    ]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Role 1", "Role 2"]);
  });

  it("fully paginates a TalentHub job search", async () => {
    const requests: string[] = [];
    const page = (current: number) => [
      `<p>Showing <span> ${current}</span> to <span>${current}</span> of <span>2</span> results</p>`,
      current === 1 ? '<a rel="next" href="/en/jobs?page=2">2</a>' : "",
      `<a href="/en/jobs/role-${current}-en-p1-${100 + current}-1">Role ${current}</a>`,
    ].join("");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return new Response(page(Number(new URL(url).searchParams.get("page") ?? 1)), { status: 200 });
    };

    const result = await crawlSource({ id: "talenthub", company: "Acme", postingUrl: "https://acme.talenthub.jobs/en/jobs", adapter: "custom" }, fetcher, new Date());

    expect(requests).toEqual([
      "https://acme.talenthub.jobs/en/jobs",
      "https://acme.talenthub.jobs/en/jobs?page=2",
    ]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Role 1", "Role 2"]);
  });

  it("fully paginates an Avature HTML job search", async () => {
    const requests: string[] = [];
    const page = (offset: number) => [
      '<meta name="avature.portal.page" content="SearchCareer"/>',
      `<div>${offset + 1}-${offset + 1} of 2 results</div>`,
      `<a href="/en_US/careers/JobDetail/Role-${offset + 1}/${100 + offset}">Role ${offset + 1}</a>`,
      offset === 0 ? '<a href="/en_US/careers/SearchCareer/?jobRecordsPerPage=1&amp;jobOffset=1">2</a>' : "",
    ].join("");
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      return new Response(page(Number(url.searchParams.get("jobOffset") ?? 0)), { status: 200 });
    };

    const result = await crawlSource({
      id: "avature",
      company: "Acme",
      postingUrl: "https://careers.acme.example/en_US/careers/SearchCareer/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://careers.acme.example/en_US/careers/SearchCareer/",
      "https://careers.acme.example/en_US/careers/SearchCareer/?jobRecordsPerPage=1&jobOffset=1",
    ]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Role 1", "Role 2"]);
  });

  it("paginates Avature's open-ended 999+ result count until the first empty page", async () => {
    const requestedOffsets: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("jobOffset") ?? 0);
      requestedOffsets.push(offset);
      return new Response([
        '<meta name="avature.portal.page" content="SearchCareer"/>',
        '<div>1-1 of 999+ results</div>',
        offset < 2 ? `<a href="/en_US/careers/JobDetail/Role-${offset + 1}/${100 + offset}">Role ${offset + 1}</a>` : "",
        offset === 0 ? '<a href="?jobRecordsPerPage=1&amp;jobOffset=1">2</a>' : "",
        '<a href="/en_US/careers/ApplicationMethods?jobId=100">Apply</a>',
      ].join(""), { status: 200 });
    };

    const result = await crawlSource({
      id: "large-avature",
      company: "Acme",
      postingUrl: "https://careers.acme.example/en_US/careers/SearchCareer/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requestedOffsets).toContain(2);
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Role 1", "Role 2"]);
  });

  it("fetches large Jibe page ranges concurrently instead of serializing every request", async () => {
    let active = 0;
    let maxActive = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://careers.acme.example/jobs") return new Response('<script src="https://app.jibecdn.com/prod/search/app.js"></script>', { status: 200 });
      const page = Number(new URL(url).searchParams.get("page"));
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const start = (page - 1) * 100;
      const length = page < 4 ? 100 : 1;
      const jobs = Array.from({ length }, (_, index) => ({ data: { slug: String(start + index), req_id: String(start + index), title: `Role ${start + index}` } }));
      return new Response(JSON.stringify({ totalCount: 301, jobs }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.jobs).toHaveLength(301);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("caps oversized Jibe catalogs without claiming the partial listing is complete", async () => {
    let maxPage = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://careers.acme.example/jobs") {
        return new Response('<script src="https://app.jibecdn.com/prod/search/app.js"></script>', { status: 200 });
      }
      const page = Number(new URL(url).searchParams.get("page"));
      maxPage = Math.max(maxPage, page);
      const start = (page - 1) * 1_000;
      const jobs = Array.from({ length: 1_000 }, (_, index) => ({
        data: { slug: String(start + index), req_id: String(start + index), title: `Role ${start + index}` },
      }));
      return new Response(JSON.stringify({ totalCount: 10_001, jobs }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.jobs).toHaveLength(10_000);
    expect(result.completeListing).toBe(false);
    expect(maxPage).toBe(10);
  });

  it("fully paginates an Eightfold public jobs API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      const start = Number(url.searchParams.get("start"));
      const positions = start === 0
        ? Array.from({ length: 10 }, (_, index) => ({ id: 101 + index, name: index === 0 ? "Engineer" : `Engineer ${index + 1}`, locations: ["Remote"], atsJobId: `REQ-${101 + index}`, positionUrl: `/careers/job/${101 + index}`, creationTs: 1785888000, workLocationOption: "remote", department: "Engineering", businessUnit: "Technology", type: "Full-time", jobDescription: "Build reliable systems." }))
        : [{ id: 111, name: "Designer", locations: ["New York, NY"], atsJobId: "REQ-111", positionUrl: "/careers/job/111", creationTs: 1785801600, workLocationOption: "onsite", department: "Design" }];
      return new Response(JSON.stringify({
        data: {
          count: 11,
          filterDef: { facets: { department: { Engineering: 10, Design: 1 }, skills: { Python: 10 }, seniority: { Senior: 10 } } },
          positions,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.eightfold.ai/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ department: "Engineering", businessUnit: "Technology", employmentType: "Full-time", description: "Build reliable systems." }));
    expect(result.facets).toEqual(expect.arrayContaining([
      { key: "department", label: "Department", values: [{ key: "Engineering", label: "Engineering", count: 10 }, { key: "Design", label: "Design", count: 1 }] },
      { key: "skills", label: "Skills", values: [{ key: "Python", label: "Python", count: 10 }] },
    ]));
    expect(result.jobs).toHaveLength(11);
    expect(result.jobs[0].externalId).toBe("REQ-101");
    expect(result.jobs.at(-1)?.externalId).toBe("REQ-111");
    expect(requests).toContain("https://acme.eightfold.ai/api/pcsx/search?domain=acme.com&query=&location=&start=10");
  });

  it("falls back to Eightfold's legacy public API when the PCSX search route is unavailable", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.pathname === "/api/pcsx/search") return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({
        count: 1,
        positions: [{ id: 101, name: "Engineer", location: "Remote", ats_job_id: "REQ-101", canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/101" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "legacy-eightfold", company: "Acme", postingUrl: "https://acme.eightfold.ai/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.externalId)).toEqual(["REQ-101"]);
    expect(requests.some((url) => url.includes("/api/apply/v2/jobs"))).toBe(true);
  });

  it("collects every MediaTek page through its public jobs API", async () => {
    const pages: number[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/trpc/job.getJobs");
      const request = JSON.parse(url.searchParams.get("input") ?? "{}") as { "0": { json: { page: number } } };
      const page = request["0"].json.page;
      pages.push(page);
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe("NEXT_LOCALE=en");
      const jobs = page === 1 ? [
        { id: "MTK-1", title: "AI Intern", description: "Build models", publishedDate: "2026-08-09T16:00:00.000Z", properties: { category: { code: "AI", label: "Algorithm" }, location: { code: "San Jose", label: "US" }, workExperience: { code: "No experience", label: "0" }, jobEducationInfos: [{ educationDegree: "Bachelor", educationMajor: "Computer Science" }] } },
        { id: "MTK-2", title: "Data Engineer", description: "Build pipelines", properties: { location: { code: "HsinChu", label: "TW" } } },
      ] : [{ id: "MTK-3", title: "RF Engineer", description: "Build radios", properties: { location: { code: "Taipei", label: "TW" } } }];
      return Response.json([{ result: { data: { json: { jobs, pagination: { current_page: page, total_pages: 2, total_items: 3 } } } } }]);
    };

    const result = await crawlSource({ id: "mediatek", company: "MediaTek", postingUrl: "https://careers.mediatek.com/en", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(pages).toEqual([1, 2]);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "MTK-1",
      title: "AI Intern",
      location: "San Jose",
      department: "Algorithm",
      educationRequirements: "Bachelor: Computer Science",
      officialUrl: "https://careers.mediatek.com/en/jobs/MTK-1",
    }));
  });

  it("discovers Meta's current public GraphQL operation and collects the complete job list", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.metacareers.com/jobsearch/") {
        return new Response([
          '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
          '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
        ].join(""));
      }
      if (url === "https://static.xx.fbcdn.net/meta-careers.js") {
        return new Response('__d("CareersJobSearchResultsV2DataQuery_candidate_portalRelayOperation",[],function(){exports="27129360303422352"})');
      }
      expect(url).toBe("https://www.metacareers.com/graphql");
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("doc_id")).toBe("27129360303422352");
      expect(body.get("lsd")).toBe("fresh-lsd-token");
      return Response.json({
        data: {
          job_search_with_featured_jobs_v2: {
            all_jobs: [{
              id: "2916726525182155",
              title: "Research Scientist Intern, Generative AI (PhD)",
              locations: ["Bellevue, WA", "Menlo Park, CA"],
              teams: ["AI Research", "Internship - PhD"],
              sub_teams: ["Machine Learning", "Research"],
            }],
          },
        },
      });
    };

    const result = await crawlSource({
      id: "meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "2916726525182155",
      title: "Research Scientist Intern, Generative AI (PhD)",
      location: "Bellevue, WA",
      secondaryLocations: ["Menlo Park, CA"],
      employmentType: "Internship",
      department: "AI Research; Internship - PhD",
      team: "Machine Learning; Research",
      officialUrl: "https://www.metacareers.com/jobs/2916726525182155/",
    })]);
    expect(result.facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "department" }),
      expect.objectContaining({ key: "team" }),
    ]));
    expect(requests).toEqual([
      "https://www.metacareers.com/jobsearch/",
      "https://static.xx.fbcdn.net/meta-careers.js",
      "https://www.metacareers.com/graphql",
    ]);
  });

  it("collects every EPAM page from its public Next.js job payload", async () => {
    const calls: string[] = [];
    const html = (jobs: unknown[], total = 3) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { jobs: { total, jobs, facets: { seniority: [{ key: "Senior", doc_count: 2 }], malformed: [{ key: { unexpected: true }, doc_count: 1 }] } } } },
    })}</script>`;
    const first = [{
      uid: "blt-1", name: "AI Engineer", vacancy_type: "Hybrid", posting_type: "Standard",
      city: [{ name: "New York", state: { name: "New York" }, country: { id: "country-1", name: "USA" } }],
      country: [{ id: "country-1", name: "USA" }],
      skills: ["Python"], seniority: "Senior", description: "<p>Build AI systems.</p>",
      category: { responsibilities: ["Ship models"], requirements: ["Python"] },
      job_specialization: ["Developer"], seo: { url: "/en/vacancy/ai-engineer-blt-1_en" },
      created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z",
    }, {
      uid: "blt-2", name: "Data Scientist", vacancy_type: "Remote",
      country: [{ name: "USA" }], seo: { url: "/en/vacancy/data-scientist-blt-2_en" },
    }];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return url.includes("/api/jobs/v2/search/")
        ? new Response(JSON.stringify({ data: { total: 3, jobs: [{ uid: "blt-3", name: "ML Engineer", vacancy_type: "Office", seo: { url: "/en/vacancy/ml-engineer-blt-3_en" } }], facets: {} } }))
        : new Response(html(first));
    };

    const result = await crawlSource({
      id: "epam", company: "EPAM Systems", postingUrl: "https://careers.epam.com/en/jobs/united_states_of_america", adapter: "custom",
    }, fetcher, new Date());

    expect(calls).toEqual([
      "https://careers.epam.com/en/jobs/united_states_of_america",
      "https://careers.epam.com/api/jobs/v2/search/careers-i18n?lang=en&sortBy=relevance%3Brelocation%3Dasc&size=2&from=2&facets=country%3Dcountry-1&websiteLocale=en-us",
    ]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "AI Engineer", arrangement: "hybrid", location: "New York, New York, USA",
      skills: ["Python"], responsibilities: "Ship models", qualifications: "Python",
      jobFamily: "Developer", experienceLevel: "Senior",
      officialUrl: "https://careers.epam.com/en/vacancy/ai-engineer-blt-1_en",
    }));
    expect(result.facets).toEqual([expect.objectContaining({
      key: "seniority", values: [{ key: "Senior", label: "Senior", count: 2 }],
    })]);
  });

  it("classifies an Eightfold access-control response as blocked instead of failed", async () => {
    const fetcher: typeof fetch = async () => new Response('{"message":"Not authorized for PCSX"}', { status: 403 });

    const result = await crawlSource({ id: "blocked-eightfold", company: "Acme", postingUrl: "https://acme.eightfold.ai/careers", adapter: "custom" }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "blocked",
      responseStatus: 403,
      completeListing: false,
      jobs: [],
    }));
  });

  it("classifies upstream edge failures as blocked instead of an internal crawl failure", async () => {
    const fetcher: typeof fetch = async () => new Response("upstream connection error", { status: 520 });

    const result = await crawlSource({ id: "edge-blocked", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "blocked",
      responseStatus: 520,
      completeListing: false,
      jobs: [],
    }));
  });

  it("uses browser-compatible headers for WAF-sensitive public careers pages", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      return /^Mozilla\/5\.0/.test(headers.get("user-agent") ?? "")
        && headers.get("accept-language")?.startsWith("en-US")
        ? new Response('<a href="/jobs/101">Engineer</a>', { status: 200 })
        : new Response("blocked", { status: 520 });
    };

    const result = await crawlSource({ id: "waf-sensitive", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Engineer"]);
  });

  it("retries a transient upstream response before classifying the source as blocked", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
        : new Response('<a href="/jobs/101">Engineer</a>', { status: 200 });
    };

    const result = await crawlSource({ id: "transient", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(attempts).toBe(2);
    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Engineer"]);
  });

  it("retries a transient network failure once", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return new Response('<a href="/jobs/101">Engineer</a>', { status: 200 });
    };

    const result = await crawlSource({ id: "network-transient", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(attempts).toBe(2);
    expect(result.status).toBe("succeeded");
  });

  it("recovers official job links through the read-only reader when the careers edge blocks requests", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("accept-language")).toBeNull();
        expect(headers.get("x-no-cache")).toBeNull();
        expect(headers.get("x-retain-links")).toBe("all");
        expect(headers.get("x-with-links-summary")).toBe("all");
        return new Response([
          "# Job Search Results",
          "[Skip to content](https://careers.acme.example/search/jobs#main)",
          "[Data Science Intern](https://careers.acme.example/jobs/18099108-data-science-intern)",
          "[Software Engineer](https://careers.acme.example/careers/details/software-engineer/)",
          "[Page 2](https://careers.acme.example/search/jobs?page=2)",
        ].join("\n"), { status: 200 });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await crawlSource({ id: "edge-blocked", company: "Acme", postingUrl: "https://careers.acme.example/search/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Science Intern", "Software Engineer"]);
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://careers.acme.example/jobs/18099108-data-science-intern",
      "https://careers.acme.example/careers/details/software-engineer/",
    ]);
    expect(requests).toContain("https://r.jina.ai/https://careers.acme.example/search/jobs");
  });

  it("fully paginates a Talemetry JSON feed through the reader when the careers edge blocks requests", async () => {
    const requests: string[] = [];
    const feed = (page: number) => ({
      current_page: page,
      per_page: 1,
      total_entries: 2,
      entries: page === 1 ? [{
        id: "18099108",
        talemetry_job_id: "18099108",
        permalink: "data-science-intern",
        title: "Data Science Intern",
        location: { locality: "Mayfield", region_abbr: "OH", country: "United States", postal_code: "44143", name: "OH | Mayfield" },
      }] : [{
        id: "18099109",
        talemetry_job_id: "18099109",
        permalink: "software-engineer",
        title: "Software Engineer",
        location: { locality: null, region_abbr: null, country: "United States", postal_code: null, name: "US | Remote" },
      }],
    });
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (!url.startsWith("https://r.jina.ai/")) return new Response("blocked", { status: 403 });
      const page = Number(new URL(url.slice("https://r.jina.ai/".length)).searchParams.get("page") ?? 1);
      return new Response(`Title:\n\nMarkdown Content:\n${JSON.stringify(feed(page))}`, { status: 200 });
    };

    const result = await crawlSource({ id: "talemetry-blocked", company: "Acme", postingUrl: "https://careers.acme.example/search/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "18099108", title: "Data Science Intern", location: "OH | Mayfield",
        locationCity: "Mayfield", locationState: "OH", locationCountry: "United States", locationPostalCode: "44143",
        officialUrl: "https://careers.acme.example/jobs/18099108-data-science-intern",
      }),
      expect.objectContaining({
        externalId: "18099109", title: "Software Engineer", arrangement: "remote",
        officialUrl: "https://careers.acme.example/jobs/18099109-software-engineer",
      }),
    ]);
    expect(requests).toContain("https://r.jina.ai/https://careers.acme.example/search/jobs.json?per_page=100&page=1");
    expect(requests).toContain("https://r.jina.ai/https://careers.acme.example/search/jobs.json?per_page=100&page=2");
  });

  it("bypasses a stale reader challenge snapshot when the cached response has no jobs", async () => {
    let readerRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (!String(input).startsWith("https://r.jina.ai/")) return new Response("blocked", { status: 403 });
      if (String(input).includes("/search/jobs.json")) return new Response("not found", { status: 404 });
      readerRequests += 1;
      const headers = new Headers(init?.headers);
      if (readerRequests === 1) {
        expect(headers.get("x-no-cache")).toBeNull();
        return new Response("Enable JavaScript and cookies to continue", { status: 200 });
      }
      expect(headers.get("x-no-cache")).toBe("true");
      return new Response([
        "Links/Buttons:",
        "- [Data Science Intern](https://careers.acme.example/jobs/18099108-data-science-intern)",
      ].join("\n"), { status: 200 });
    };

    const result = await crawlSource({ id: "stale-reader", company: "Acme", postingUrl: "https://careers.acme.example/search/jobs", adapter: "custom" }, fetcher, new Date());

    expect(readerRequests).toBe(2);
    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Science Intern"]);
  });

  it("preserves the direct blocked result when the reader exposes no official job details", async () => {
    const fetcher: typeof fetch = async (input) => String(input).startsWith("https://r.jina.ai/")
      ? new Response("[Careers](https://careers.acme.example/careers)", { status: 200 })
      : new Response("blocked", { status: 403 });

    const result = await crawlSource({ id: "still-blocked", company: "Acme", postingUrl: "https://careers.acme.example/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("blocked");
    expect(result.jobs).toEqual([]);
    expect(result.responseStatus).toBe(403);
  });

  it("extracts official static ASE openings that do not have separate detail links", async () => {
    const fetcher: typeof fetch = async (input) => String(input).startsWith("https://r.jina.ai/")
      ? new Response([
          "## Career Opportunities in the U.S.",
          "### ![Image 1](https://ase.aseglobal.com/icon.svg) ACCOUNT MANAGER/SR. ACCOUNT MANAGER #500",
          "JOB ID #500",
          "### ![Image 2](https://ase.aseglobal.com/icon.svg) DIRECTOR, ENGINEERING & TECHNICAL MARKETING #499",
          "JOB ID #499",
        ].join("\n"), { status: 200 })
      : new Response("blocked", { status: 403 });

    const result = await crawlSource({ id: "p5-0806-ase-group", company: "ASE Group", postingUrl: "https://ase.aseglobal.com/careers-us/", adapter: "custom" }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs).toEqual([
      expect.objectContaining({ externalId: "500", title: "ACCOUNT MANAGER/SR. ACCOUNT MANAGER", officialUrl: "https://ase.aseglobal.com/careers-us/#job-500" }),
      expect.objectContaining({ externalId: "499", title: "DIRECTOR, ENGINEERING & TECHNICAL MARKETING", officialUrl: "https://ase.aseglobal.com/careers-us/#job-499" }),
    ]);
  });

  it("extracts every Paylocity job from its embedded public page data", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <html><script>
        window.ATSJobDetailsBaseUrl = '/Recruiting/Jobs/Details/';
        window.pageData = {"ModuleTitle":"Premier America Credit Union","Jobs":[
          {"JobId":4352550,"JobTitle":"Personal Banker IV - Reseda","LocationName":"Reseda","PublishedDate":"2026-08-07T18:49:34-05:00","Description":"Serve members.","HiringDepartment":"Retail Banking","JobLocation":{"City":"Reseda","State":"CA","Zip":"91335","Country":"USA"},"IsRemote":false,"IndeedRemoteType":2},
          {"JobId":4403763,"JobTitle":"Director - EPMO","LocationName":"Chatsworth","PublishedDate":"2026-08-07T17:35:32-05:00","Description":"Lead programs.","HiringDepartment":null,"JobLocation":{"City":"Chatsworth","State":"CA","Zip":"91311","Country":"USA"},"IsRemote":true,"IndeedRemoteType":1}
        ]};
      </script></html>
    `, { status: 200, headers: { "content-type": "text/html" } });

    const result = await crawlSource({
      id: "paylocity",
      company: "Premier America Credit Union",
      postingUrl: "https://recruiting.paylocity.com/recruiting/jobs/All/tenant/Premier-America-Credit-Union",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "4352550",
        title: "Personal Banker IV - Reseda",
        locationCity: "Reseda",
        locationState: "CA",
        department: "Retail Banking",
        officialUrl: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4352550",
      }),
      expect.objectContaining({
        externalId: "4403763",
        title: "Director - EPMO",
        arrangement: "remote",
        officialUrl: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4403763",
      }),
    ]);
  });

  it("uses McKinsey's public job API instead of the edge-blocked careers HTML", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      const start = Number(url.searchParams.get("start"));
      const jobID = start === 0 ? "101" : "102";
      return new Response(JSON.stringify({
        numFound: 2,
        start,
        docs: [{
          jobID,
          title: start === 0 ? "Data Engineer - QuantumBlack" : "Data Scientist - QuantumBlack",
          cities: start === 0 ? ["New York", "Boston"] : ["London"],
          countries: start === 0 ? ["United States"] : ["United Kingdom"],
          interest: "Tech & AI",
          functions: ["Technology"],
          whatYouWillDo: "<p>Build reliable AI systems.</p>",
          yourBackground: "<ul><li>Python</li><li>SQL</li></ul>",
          linkedInSeniorityLevel: ["Associate"],
          linkedInIndustry: ["Information Technology"],
          jobApplyURL: `https://mckinsey.avature.net/careers/ApplicationMethods?folderId=${jobID}`,
          friendlyURL: `quantumblack-role-${jobID}`,
          postedToLinkedInDate: "2026-08-01",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "quantumblack",
      company: "McKinsey & Company — QuantumBlack",
      postingUrl: "https://www.mckinsey.com/careers/search-jobs?query=QuantumBlack",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests[0]).toBe("https://gateway.mckinsey.com/apigw-x0cceuow60/v1/api/jobs/search?pageSize=100&start=0&lang=en&q=QuantumBlack");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "101",
      location: "New York; Boston, United States",
      department: "Tech & AI",
      jobFunction: "Technology",
      experienceLevel: "Associate",
      industry: "Information Technology",
      responsibilities: "Build reliable AI systems.",
      qualifications: "Python SQL",
      applyUrl: "https://mckinsey.avature.net/careers/ApplicationMethods?folderId=101",
      officialUrl: "https://www.mckinsey.com/careers/search-jobs/jobs/quantumblack-role-101",
      publishedAt: "2026-08-01T00:00:00.000Z",
    }));
  });

  it("fully paginates an ADP MyJobs public careers API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://myjobs.adp.com/public/staffing/v1/career-site/acme") {
        return new Response(JSON.stringify({ myJobsToken: "public-token" }), { status: 200 });
      }
      const skip = Number(new URL(url).searchParams.get("$skip") ?? 0);
      const job = skip === 0
        ? { clientRequisitionID: "101", publishedJobTitle: "Engineer", jobTitle: "Engineer", jobDescription: "Build products.", jobQualifications: "SQL and Python.", postingDate: "2026-08-08T12:00:00Z", workLevelCode: "Full-time", requisitionLocations: [{ address: { cityName: "Austin", countrySubdivisionLevel1: { longName: "Texas" }, country: { longName: "United States" } } }] }
        : { clientRequisitionID: "102", publishedJobTitle: "Designer", jobTitle: "Designer", postingDate: "2026-08-07T12:00:00Z", workLevelCode: "Full-time", requisitionLocations: [] };
      return new Response(JSON.stringify({ count: 2, jobRequisitions: [job] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://myjobs.adp.com/acme", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ description: "Build products.", qualifications: "SQL and Python.", requisitionId: "101", locationCity: "Austin", locationState: "Texas", locationCountry: "United States" }));
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://myjobs.adp.com/acme/cx/job-details?reqId=101",
      "https://myjobs.adp.com/acme/cx/job-details?reqId=102",
    ]);
    expect(requests.some((url) => url.includes("%24skip=1"))).toBe(true);
  });

  it("collects ADP Workforce Now public jobs and their descriptions", async () => {
    const requests: string[] = [];
    const listJob = {
      itemID: "9201331335969_1",
      requisitionTitle: "Manufacturing Process Engineer",
      clientRequisitionID: "5096",
      postDate: "2026-07-12T05:34:00.000-04:00",
      workLevelCode: { shortName: "Regular Full-Time" },
      requisitionLocations: [{ nameCode: { shortName: "UK - Greenock, GB" }, address: { cityName: "Greenock", countrySubdivisionLevel1: { codeValue: "Scotland" }, countryCode: "GB" } }],
      customFieldGroup: { stringFields: [{ stringValue: "591974", nameCode: { codeValue: "ExternalJobID" } }] },
    };
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (/job-requisitions\/9201331335969_1/.test(url)) {
        return new Response(JSON.stringify({ ...listJob, requisitionDescription: "<p>Improve manufacturing processes.</p>" }));
      }
      return new Response(JSON.stringify({ jobRequisitions: [listJob], meta: { totalNumber: 1 } }));
    };

    const result = await crawlSource({
      id: "diodes", company: "Diodes Inc.",
      postingUrl: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=d72519df-1ce1-4f1d-b01b-50a082de06d5&ccId=9201183304503_2&lang=en_US",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "591974", title: "Manufacturing Process Engineer",
      location: "UK - Greenock, GB", employmentType: "Regular Full-Time",
      description: "Improve manufacturing processes.", requisitionId: "5096",
      locationCity: "Greenock", locationState: "Scotland", locationCountry: "GB",
      officialUrl: expect.stringContaining("jobId=591974"),
    })]);
    expect(requests).toHaveLength(2);
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
        description: "Build trusted data products.",
        officialUrl: "https://job-boards.greenhouse.io/acme/jobs/42",
        publishedAt: "2026-08-08T12:00:00.000Z",
      }],
      error: null,
    });
  });

  it("attaches Intel's authoritative Workday internship and time-type facets to each job", async () => {
    const requests: Array<Record<string, string[]>> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { appliedFacets: Record<string, string[]> };
      requests.push(body.appliedFacets);
      const facetKey = Object.keys(body.appliedFacets)[0];
      const facetValue = facetKey ? body.appliedFacets[facetKey][0] : null;
      const jobs = facetValue === "student"
        ? [{ title: "AI Product Analyst student", externalPath: "/job/AI-Product-Analyst-student_JR0001" }]
        : facetValue === "contract"
          ? []
          : facetValue === "part"
            ? [{ title: "AI Product Analyst student", externalPath: "/job/AI-Product-Analyst-student_JR0001" }]
            : [{
              title: "AI Product Analyst student",
              externalPath: "/job/AI-Product-Analyst-student_JR0001",
              bulletFields: ["JR0001"],
            }, {
              title: "Silicon Engineer",
              externalPath: "/job/Silicon-Engineer_JR0002",
              bulletFields: ["Spotlight Job", "JR0002"],
            }];
      return new Response(JSON.stringify({
        total: jobs.length,
        jobPostings: jobs,
        ...(!facetKey ? { facets: [{
          descriptor: "Job Type",
          facetParameter: "workerSubType",
          values: [
            { descriptor: "Regular", id: "regular", count: 1 },
            { descriptor: "Intel Contract Employee (Fixed Term)", id: "contract", count: 0 },
            { descriptor: "Student / Intern (Fixed Term)", id: "student", count: 1 },
          ],
        }, {
          descriptor: "Time Type",
          facetParameter: "timeType",
          values: [
            { descriptor: "Full time", id: "full", count: 1 },
            { descriptor: "Part time", id: "part", count: 1 },
          ],
        }] } : {}),
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "p5-0947-intel",
      company: "Intel",
      postingUrl: "https://intel.wd1.myworkdayjobs.com/External",
      adapter: "workday",
    }, fetcher, new Date("2026-08-10T00:00:00Z"));

    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        title: "AI Product Analyst student",
        employmentType: "Internship; Part-time",
        department: null,
      }),
      expect.objectContaining({
        title: "Silicon Engineer",
        employmentType: "Full-time",
        department: null,
      }),
    ]);
    expect(requests).toEqual(expect.arrayContaining([
      {},
      { workerSubType: ["student"] },
      { timeType: ["part"] },
    ]));
  });

  it("uses Ashby's public job-board API and normalizes every open role", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        jobs: [{
          id: "ashby-42",
          title: "Machine Learning Engineer",
          jobUrl: "https://jobs.ashbyhq.com/acme/ashby-42",
          location: "Remote, US",
          workplaceType: "Remote",
          employmentType: "FullTime",
          descriptionPlain: "Build reliable models.",
          publishedAt: "2026-08-08T12:00:00Z",
          isListed: true,
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "acme-ashby",
      company: "Acme",
      postingUrl: "https://jobs.ashbyhq.com/acme",
      adapter: "ashby",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual(["https://api.ashbyhq.com/posting-api/job-board/acme"]);
    expect(result).toEqual({
      status: "succeeded",
      responseStatus: 200,
      completeListing: true,
      jobs: [{
        externalId: "ashby-42",
        title: "Machine Learning Engineer",
        company: "Acme",
        location: "Remote, US",
        arrangement: "remote",
        employmentType: "FullTime",
        summary: "Build reliable models.",
        description: "Build reliable models.",
        officialUrl: "https://jobs.ashbyhq.com/acme/ashby-42",
        publishedAt: "2026-08-08T12:00:00.000Z",
      }],
      error: null,
    });
  });

  it("recovers the public Greenhouse board from a talent-alert sign-in URL", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    };

    const result = await crawlSource({
      id: "armis",
      company: "Armis",
      postingUrl: "https://my.greenhouse.io/users/sign_in?job_board=armissecurity&source=job_alert_board",
      adapter: "greenhouse",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual(["https://boards-api.greenhouse.io/v1/boards/armissecurity/jobs?content=true"]);
    expect(result.status).toBe("succeeded");
  });

  it("reads JobPosting JSON-LD from an official careers page without treating the page as a complete listing", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <html><head>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"JobPosting","title":"Senior Fraud Analyst","url":"https://careers.example.com/jobs/fraud-7","datePosted":"2026-08-07","validThrough":"2026-09-01","employmentType":"FULL_TIME","jobLocation":{"address":{"addressLocality":"New York","addressRegion":"NY","addressCountry":"US"}},"description":"<p>Investigate <strong>fraud</strong> signals.</p>","qualifications":"SQL required","responsibilities":"Investigate alerts","skills":"SQL, Python","experienceRequirements":"3 years","educationRequirements":"Bachelor degree","baseSalary":{"currency":"USD","value":{"minValue":100000,"maxValue":140000,"unitText":"YEAR"}},"identifier":{"value":"fraud-7"}}
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
        location: "New York, NY, US",
        arrangement: "unknown",
        employmentType: "Full-time",
        summary: "Investigate fraud signals.",
        description: "Investigate fraud signals.",
        responsibilities: "Investigate alerts",
        qualifications: "SQL required",
        skills: ["SQL", "Python"],
        educationRequirements: "Bachelor degree",
        experienceRequirements: "3 years",
        locationCity: "New York",
        locationState: "NY",
        locationCountry: "US",
        salaryMin: 100000,
        salaryMax: 140000,
        salaryCurrency: "USD",
        salaryInterval: "YEAR",
        validThrough: "2026-09-01T00:00:00.000Z",
        officialUrl: "https://careers.example.com/jobs/fraud-7",
        publishedAt: "2026-08-07T00:00:00.000Z",
      }],
      error: null,
    });
  });

  it("does not turn listing-page JSON-LD without a job URL into a fake job detail", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","title":"Browse current roles"}
      </script>
    `, { status: 200 });

    const result = await crawlSource({
      id: "listing-only",
      company: "Listing Only",
      postingUrl: "https://careers.example.com/jobs/search",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result.jobs).toEqual([]);
  });

  it("extracts official job detail anchors when a careers page has no structured job data", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <html><body>
        <a href="/job/Wayne-Senior-Quality-Engineer/1316150900/">Senior Quality Engineer</a>
        <a href="/search/?q=quality">Search jobs</a>
      </body></html>
    `, { status: 200, headers: { "content-type": "text/html" } });

    const result = await crawlSource({
      id: "teleflex",
      company: "Teleflex",
      postingUrl: "https://careers.teleflex.com/search/?q=&locationsearch=",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      jobs: [expect.objectContaining({
        title: "Senior Quality Engineer",
        officialUrl: "https://careers.teleflex.com/job/Wayne-Senior-Quality-Engineer/1316150900/",
      })],
    }));
  });

  it("extracts a public embedded JOB_ITEMS collection", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <script>const JOB_ITEMS = [{
        "date":"06 Aug 2026",
        "title":"Sales Enablement Coordinator",
        "href":"https://careers.example.com/careers/sales-enablement-coordinator",
        "location":"Elk Grove Village, IL",
        "schedule":"Full-time",
        "description":"Support the sales organization."
      }];</script>
    `, { status: 200 });

    const result = await crawlSource({
      id: "embedded",
      company: "Example Co",
      postingUrl: "https://careers.example.com/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result.jobs).toEqual([expect.objectContaining({
      title: "Sales Enablement Coordinator",
      location: "Elk Grove Village, IL",
      employmentType: "Full-time",
      summary: "Support the sales organization.",
      officialUrl: "https://careers.example.com/careers/sales-enablement-coordinator",
    })]);
  });

  it("uses Tesla's official careers state endpoint and keeps US listings", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        lookup: {
          locations: { "77": "Austin, Texas", "88": "Berlin, Germany" },
          departments: { "8": "Engineering" },
          types: { "1": "Full-Time" },
        },
        geo: [{
          id: "5",
          sites: [{
            id: "US",
            states: [{ id: "TX", name: "Texas", cities: { Austin: ["77"] } }],
          }],
        }],
        listings: [
          { id: "277001", t: "Software Engineer", dp: "8", l: "77", y: 1 },
          { id: "277002", t: "European Engineer", dp: "8", l: "88", y: 1 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "tesla",
      company: "Tesla",
      postingUrl: "https://www.tesla.com/careers/search/?site=US",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(requests).toEqual(["https://www.tesla.com/cua-api/apps/careers/state"]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "277001",
        title: "Software Engineer",
        location: "Austin, Texas",
        department: "Engineering",
        employmentType: "Full-Time",
        officialUrl: "https://www.tesla.com/careers/search/job/software-engineer-277001",
      })],
    }));
  });

  it("preserves Oracle Recruiting workplace, description, and schedule fields", async () => {
    const responses = [
      new Response('<script src="https://acme.fa.us2.oraclecloud.com/hcmUI/app.js"></script>', { status: 200 }),
      new Response(JSON.stringify({ items: [{ TotalJobsCount: 1, requisitionList: [{
        Id: 42, Title: "Risk Analyst", PostedDate: "2026-08-01", PrimaryLocation: "New York, NY",
        WorkplaceType: "Hybrid", JobSchedule: "Full time", ShortDescriptionStr: "Investigate risk signals.",
      }] }] }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    const result = await crawlSource({
      id: "oracle-acme", company: "Acme", postingUrl: "https://careers.acme.example/en/sites/CX_1001/jobs", adapter: "custom",
    }, fetcher, new Date());

    expect(result.jobs[0]).toEqual(expect.objectContaining({
      arrangement: "hybrid", employmentType: "Full time", description: "Investigate risk signals.",
      publishedAt: "2026-08-01T00:00:00.000Z",
      officialUrl: "https://careers.acme.example/hcmUI/CandidateExperience/en/sites/CX_1001/job/42",
    }));
  });

  it("does not truncate Oracle Recruiting catalogs above 500 jobs", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://careers.acme.example/en/sites/CX_1001/jobs") {
        return new Response('<script src="https://acme.fa.us2.oraclecloud.com/hcmUI/app.js"></script>', { status: 200 });
      }
      const finder = new URL(url).searchParams.get("finder") ?? "";
      const offset = Number(finder.match(/offset=(\d+)/)?.[1] ?? 0);
      offsets.push(offset);
      const requisitionList = Array.from({ length: Math.min(25, 525 - offset) }, (_, index) => ({
        Id: offset + index + 1,
        Title: `Role ${offset + index + 1}`,
      }));
      return new Response(JSON.stringify({ items: [{ TotalJobsCount: 525, requisitionList }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({
      id: "oracle-large", company: "Acme", postingUrl: "https://careers.acme.example/en/sites/CX_1001/jobs", adapter: "custom",
    }, fetcher, new Date());

    expect(offsets).toContain(500);
    expect(result.jobs).toHaveLength(525);
    expect(result.completeListing).toBe(true);
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
        facets: [{ descriptor: "Job Category", facetParameter: "jobFamilyGroup", values: [{ descriptor: "Engineering", id: "eng", count: 1 }] }],
        jobPostings: [{
          title: "Security Engineer",
          externalPath: "/job/Austin-TX/Security-Engineer_JR-100",
          locationsText: "Austin, TX",
          bulletFields: ["Engineering", "Full time"],
          postedOn: "Posted 2 Days Ago",
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
          "user-agent": expect.stringMatching(/^Mozilla\/5\.0 /),
        }),
      }),
    }]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      responseStatus: 200,
      completeListing: false,
      jobs: [expect.objectContaining({
        externalId: "JR-100",
        title: "Security Engineer",
        location: "Austin, TX",
        department: "Engineering",
        sourcePostedText: "Posted 2 Days Ago",
        publishedAt: "2026-08-06T12:30:00.000Z",
        officialUrl: "https://acme.wd5.myworkdayjobs.com/Careers/job/Austin-TX/Security-Engineer_JR-100",
      })],
      facets: [{ key: "jobFamilyGroup", label: "Job Category", values: [{ key: "eng", label: "Engineering", count: 1 }] }],
    }));
  });

  it("does not mistake Workday requisition IDs for employment types", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      total: 2,
      jobPostings: [{
        title: "Data Science Intern",
        externalPath: "/job/Data-Science-Intern_R244285",
        bulletFields: ["Data & AI", "R244285"],
      }, {
        title: "Machine Learning Co-op",
        externalPath: "/job/Machine-Learning-Co-op_R2615860",
        bulletFields: ["R2615860", "Data & AI", "Intern"],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await crawlSource({
      id: "workday-employment",
      company: "Acme",
      postingUrl: "https://acme.wd5.myworkdayjobs.com/Careers",
      adapter: "workday",
    }, fetcher, new Date("2026-08-10T00:00:00Z"));

    expect(result.jobs).toEqual([
      expect.objectContaining({ employmentType: null, department: "Data & AI" }),
      expect.objectContaining({ employmentType: "Internship", department: "Data & AI" }),
    ]);
  });

  it("preserves Greenhouse department, office, requisition, and first-published fields", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ jobs: [{
      id: 42,
      title: "Data Engineer",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/42",
      updated_at: "2026-08-08T12:00:00Z",
      first_published: "2026-08-01T09:00:00Z",
      requisition_id: "REQ-42",
      departments: [{ id: 7, name: "Data Platform" }],
      offices: [{ id: 3, name: "San Francisco", location: "California, United States" }],
      location: { name: "San Francisco, CA" },
      content: "<p>Build trusted data products.</p>",
    }] }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://job-boards.greenhouse.io/acme", adapter: "greenhouse" }, fetcher, new Date());

    expect(result.jobs[0]).toEqual(expect.objectContaining({
      description: "Build trusted data products.",
      department: "Data Platform",
      office: "San Francisco",
      requisitionId: "REQ-42",
      publishedAt: "2026-08-01T09:00:00.000Z",
      sourceUpdatedAt: "2026-08-08T12:00:00.000Z",
    }));
  });

  it("preserves Lever team, workplace, salary, and content sections", async () => {
    const responses = [
      new Response('<a href="https://jobs.lever.co/acme">Open roles</a>', { status: 200 }),
      new Response(JSON.stringify([{
        id: "lever-7",
        text: "Risk Analyst",
        hostedUrl: "https://jobs.lever.co/acme/lever-7",
        createdAt: 1785542400000,
        categories: { location: "Remote, US", commitment: "Full-time", department: "Risk", team: "Trust", allLocations: ["Remote, US", "New York, NY"] },
        workplaceType: "remote",
        descriptionPlain: "Find material risk signals.",
        lists: [{ text: "Requirements", content: "<li>SQL</li><li>Python</li>" }],
        salaryRange: { min: 120000, max: 160000, currency: "USD", interval: "year" },
      }]), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.example/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.jobs[0]).toEqual(expect.objectContaining({
      department: "Risk",
      team: "Trust",
      secondaryLocations: ["New York, NY"],
      arrangement: "remote",
      description: "Find material risk signals.",
      qualifications: "Requirements SQL Python",
      salaryMin: 120000,
      salaryMax: 160000,
      salaryCurrency: "USD",
      salaryInterval: "year",
      publishedAt: "2026-08-01T00:00:00.000Z",
    }));
  });

  it("keeps the discovered Workday host for job detail URLs behind a corporate careers page", async () => {
    const responses = [
      new Response('<a href="https://acme.wd5.myworkdayjobs.com/External">View opportunities</a>', { status: 200 }),
      new Response(JSON.stringify({
        total: 1,
        jobPostings: [{ title: "Risk Analyst", externalPath: "/job/New-York/Risk-Analyst_R-42" }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const fetcher: typeof fetch = async () => responses.shift()!;

    const result = await crawlSource({
      id: "acme",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result.jobs[0].officialUrl).toBe("https://acme.wd5.myworkdayjobs.com/External/job/New-York/Risk-Analyst_R-42");
  });

  it("falls back to the original page when a discovered Workday link is stale", async () => {
    const fetcher: typeof fetch = async (input) => {
      if (String(input) === "https://acme.example/careers") {
        return new Response(`
          <a href="https://acme.wd5.myworkdayjobs.com/en-US/OldBoard">Jobs</a>
          <script type="application/ld+json">{
            "@type":"JobPosting", "title":"Data Analyst", "url":"https://acme.example/jobs/data-analyst"
          }</script>
        `, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "acme",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      jobs: [expect.objectContaining({ title: "Data Analyst" })],
    }));
  });

  it("extracts public Phenom jobs and rejects malformed non-string titles", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <script>var phApp = phApp || {}; phApp.ddo = {"eagerLoadRefineSearch":{"data":{"totalHits":2,"jobs":[
        {"title":"AI Engineer","jobId":"R42","location":"Remote, United States","type":"Full time","descriptionTeaser":"Build useful AI.","applyUrl":"https://jobs.example/apply/R42","postedDate":"2026-08-08T00:00:00.000+0000"},
        {"title":{"en":"Malformed"},"applyUrl":"https://jobs.example/apply/broken"}
      ]}}};</script>
    `, { status: 200 });

    const result = await crawlSource({
      id: "phenom-acme",
      company: "Acme",
      postingUrl: "https://careers.example/search-results",
      adapter: "phenom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      jobs: [expect.objectContaining({
        externalId: "R42",
        title: "AI Engineer",
        arrangement: "remote",
        officialUrl: "https://jobs.example/apply/R42",
      })],
    }));
  });

  it("enriches program-like Phenom listings from their official Workday detail endpoint", async () => {
    const calls: string[] = [];
    const officialUrl = "https://motorolasolutions.wd5.myworkdayjobs.com/Careers/job/Chicago-IL/Supply-Chain-Applied-AI-Engineering-Intern_R67461";
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/wday/cxs/")) {
        return new Response(JSON.stringify({
          jobPostingInfo: {
            title: "Supply Chain Applied AI Engineering Intern",
            jobReqId: "R67461",
            startDate: "2026-08-07",
            timeType: "Full time",
            location: "Chicago, IL",
            jobDescription: "Build conversational AI and autonomous AI agents using Python, SQL, AI/ML, and NLP.",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(`
        <script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { data: { totalHits: 1, jobs: [{
          title: "Supply Chain Applied AI Engineering Intern", jobId: "R67461",
          location: "Chicago, IL", type: "Internship", applyUrl: officialUrl,
        }] } } })};</script>
      `, { status: 200 });
    };

    const result = await crawlSource({
      id: "legacy-row-839", company: "Motorola Solutions",
      postingUrl: "https://www.motorolasolutions.com/en_us/about/careers.html", adapter: "phenom",
    }, fetcher, new Date("2026-08-10T00:00:00Z"));

    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "R67461",
      employmentType: "Internship; Full time",
      description: expect.stringContaining("autonomous AI agents"),
      requisitionId: "R67461",
      publishedAt: "2026-08-07T00:00:00.000Z",
    })]);
    expect(calls.some((url) => url.includes("/wday/cxs/motorolasolutions/Careers/job/"))).toBe(true);
  });

  it("paginates Phenom search results and keeps native facets and filter fields", async () => {
    const calls: string[] = [];
    const phenomPage = (from: number) => {
      const jobs = from === 0 ? [
        { title: "Engine Engineer", jobId: "R1", reqId: "R1", location: "Irvine, California, United States", city: "Irvine", state: "California", country: "United States", checkRemote: "Hybrid", type: "Regular", category: "Engineering", externalTeamName: "Diablo", ml_skills: ["C++", "Python"], latitude: "33.6", longitude: "-117.8", multi_location: ["Irvine, California, United States"], applyUrl: "https://jobs.example/R1", postedDate: "2026-08-01" },
        { title: "Producer", jobId: "R2", location: "Remote", checkRemote: "Remote", type: "Regular", category: "Production", externalTeamName: "Overwatch", applyUrl: "https://jobs.example/R2", postedDate: "2026-08-02" },
      ] : [
        { title: "Analyst", jobId: "R3", location: "Chicago, Illinois, United States", type: "Contractor", category: "Analytics", applyUrl: "https://jobs.example/R3", postedDate: "2026-08-03" },
      ];
      const aggregations = [{ field: "category", value: { Engineering: 1, Production: 1, Analytics: 1 } }];
      return `<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { status: 200, hits: jobs.length, totalHits: 3, data: { jobs, aggregations } } })};</script>`;
    };
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response(phenomPage(Number(new URL(url).searchParams.get("from") ?? 0)), { status: 200 });
    };

    const result = await crawlSource({
      id: "phenom-paged",
      company: "Acme",
      postingUrl: "https://careers.example/search-results",
      adapter: "phenom",
    }, fetcher, new Date("2026-08-08T12:30:00Z"));

    expect(calls).toEqual([
      "https://careers.example/search-results",
      "https://careers.example/search-results?from=2&s=1",
    ]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      requisitionId: "R1", department: "Engineering", team: "Diablo", skills: ["C++", "Python"],
      arrangement: "hybrid", locationCity: "Irvine", locationState: "California", locationCountry: "United States",
      latitude: 33.6, longitude: -117.8,
    }));
    expect(result.facets).toEqual([expect.objectContaining({
      key: "category",
      values: expect.arrayContaining([expect.objectContaining({ key: "Engineering", count: 1 })]),
    })]);
  });

  it("bounds concurrent Phenom page requests for large catalogs", async () => {
    let active = 0;
    let maxActive = 0;
    const fetcher: typeof fetch = async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const from = Number(new URL(String(input)).searchParams.get("from") ?? 0);
      const jobs = Array.from({ length: Math.min(2, 25 - from) }, (_, index) => ({
        title: `Role ${from + index}`, jobId: `R${from + index}`, applyUrl: `https://jobs.example/R${from + index}`,
      }));
      active -= 1;
      return new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { hits: jobs.length, totalHits: 25, data: { jobs } } })};</script>`);
    };

    const result = await crawlSource({ id: "large-phenom", company: "Acme", postingUrl: "https://careers.example/search-results", adapter: "phenom" }, fetcher, new Date());

    expect(result.jobs).toHaveLength(25);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(10);
  });

  it("keeps Phenom listings incomplete when pagination repeats the same jobs", async () => {
    const jobs = [
      { title: "Role 1", jobId: "R1", applyUrl: "https://jobs.example/R1" },
      { title: "Role 2", jobId: "R2", applyUrl: "https://jobs.example/R2" },
    ];
    const fetcher: typeof fetch = async () => new Response(
      `<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { hits: 2, totalHits: 6, data: { jobs } } })};</script>`,
    );

    const result = await crawlSource({ id: "repeating-phenom", company: "Acme", postingUrl: "https://careers.example/search-results", adapter: "phenom" }, fetcher, new Date());

    expect(result.jobs).toHaveLength(2);
    expect(result.completeListing).toBe(false);
  });

  it("falls back to Eightfold's legacy API when PCSX is forbidden for the public tenant", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.pathname === "/api/pcsx/search") {
        return Response.json({ message: "PCSX is not enabled for this user." }, { status: 403 });
      }
      return Response.json({
        count: 1,
        positions: [{
          id: 101,
          name: "Data Science Intern",
          ats_job_id: "REQ-101",
          canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/101",
        }],
      });
    };

    const result = await crawlSource({
      id: "legacy-forbidden-eightfold",
      company: "Acme",
      postingUrl: "https://acme.eightfold.ai/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.externalId)).toEqual(["REQ-101"]);
    expect(requests.some((url) => url.includes("/api/apply/v2/jobs"))).toBe(true);
  });

  it("discovers a cross-domain public ATS feed through the reader when the corporate site is blocked", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.acme.example/jobs") return new Response("blocked", { status: 403 });
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response("[View every opening](https://jobs.lever.co/acme)", { status: 200 });
      }
      if (url === "https://api.lever.co/v0/postings/acme?mode=json") {
        return Response.json([{
          id: "lever-101",
          text: "Software Engineering Intern",
          hostedUrl: "https://jobs.lever.co/acme/lever-101",
        }]);
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "reader-ats",
      company: "Acme",
      postingUrl: "https://careers.acme.example/jobs",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Software Engineering Intern"]);
    expect(requests).toContain("https://api.lever.co/v0/postings/acme?mode=json");
  });

  it("routes a direct SmartRecruiters careers URL to its authoritative public API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return Response.json({
        totalFound: 1,
        content: [{ id: "sr-101", name: "Machine Learning Intern" }],
      });
    };

    const result = await crawlSource({
      id: "smartrecruiters-direct",
      company: "Acme",
      postingUrl: "https://careers.smartrecruiters.com/Acme",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests[0]).toBe("https://api.smartrecruiters.com/v1/companies/Acme/postings");
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Machine Learning Intern"]);
  });

  it("supports Workday recruiting URLs hosted on myworkdaysite.com", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return Response.json({
        total: 1,
        jobPostings: [{
          title: "Applied AI Intern",
          externalPath: "/job/Chicago/Applied-AI-Intern_R-101",
          postedOn: "Posted Today",
        }],
      });
    };

    const result = await crawlSource({
      id: "workday-site-direct",
      company: "Acme",
      postingUrl: "https://wd1.myworkdaysite.com/recruiting/acme/External",
      adapter: "workday",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests[0]).toBe("https://wd1.myworkdaysite.com/wday/cxs/acme/External/jobs");
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Applied AI Intern"]);
  });

  it("reports an unsupported generic careers landing page instead of hiding it as healthy with zero jobs", async () => {
    const fetcher: typeof fetch = async () => new Response(
      "<html><title>Careers</title><main>Build your future with us.</main></html>",
      { status: 200 },
    );

    const result = await crawlSource({
      id: "unsupported-careers-page",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      responseStatus: 200,
      completeListing: false,
      jobs: [],
      error: expect.stringMatching(/supported feed|job listings/i),
    }));
  });

  it("retries a rate-limited Talemetry reader feed before marking the source blocked", async () => {
    let readerFeedAttempts = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://careers.acme.example/search/jobs") return new Response("blocked", { status: 403 });
      if (url === "https://careers.acme.example/search/jobs.json?per_page=100&page=1") {
        return new Response("blocked", { status: 403 });
      }
      if (url === "https://r.jina.ai/https://careers.acme.example/search/jobs.json?per_page=100&page=1") {
        readerFeedAttempts += 1;
        if (readerFeedAttempts === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
        return new Response(JSON.stringify({
          current_page: 1,
          per_page: 100,
          total_entries: 1,
          entries: [{ id: "101", talemetry_job_id: "101", permalink: "data-intern", title: "Data Intern" }],
        }), { status: 200 });
      }
      return new Response("challenge", { status: 200 });
    };

    const result = await crawlSource({
      id: "talemetry-rate-limited",
      company: "Acme",
      postingUrl: "https://careers.acme.example/search/jobs",
      adapter: "custom",
    }, fetcher, new Date());

    expect(readerFeedAttempts).toBe(2);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Intern"]);
  });

  it("uses the reader to discover a rendered ATS link after a generic careers page returns 200", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.acme.example/careers") return new Response("<main>Explore careers</main>", { status: 200 });
      if (url === "https://r.jina.ai/https://www.acme.example/careers") {
        return new Response("[Search current openings](https://job-boards.greenhouse.io/acme)", { status: 200 });
      }
      if (url === "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true") {
        return Response.json({ jobs: [{ id: 101, title: "AI Intern", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/101" }] });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "rendered-ats",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["AI Intern"]);
    expect(requests).toContain("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
  });

  it("routes an Eightfold custom careers domain through its public API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      expect(url.pathname).toBe("/api/pcsx/search");
      expect(url.searchParams.get("domain")).toBe("acme.com");
      return Response.json({ data: { count: 1, positions: [{ id: 101, name: "Software Intern" }] } });
    };

    const result = await crawlSource({
      id: "eightfold-custom-domain",
      company: "Acme",
      postingUrl: "https://careers.acme.com/careers?domain=acme.com",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests[0]).toContain("/api/pcsx/search?");
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Software Intern"]);
  });

  it("extracts the complete server-rendered Kula job catalog", async () => {
    const flight = `0:{"jobs":[{"id":47740,"title":"Applied AI Intern","listed":true,"ats_job":{"workplace":"hybrid","employment_type":"internship","ats_department":{"name":"Engineering"},"offices":[{"location":"Pleasanton, California, United States","country":"United States","state":"California","city":"Pleasanton","workplace":"hybrid"}],"compensation":{"base_salary":{"currency":"USD","interval":"hourly","min_amount":"35","max_amount":"45"}}}}]}`;
    const fetcher: typeof fetch = async () => new Response(
      `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );

    const result = await crawlSource({
      id: "kula-acme",
      company: "Acme",
      postingUrl: "https://careers.kula.ai/acme?domain=acme.com",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "47740",
      title: "Applied AI Intern",
      employmentType: "Internship",
      arrangement: "hybrid",
      department: "Engineering",
      location: "Pleasanton, California, United States",
      locationCity: "Pleasanton",
      locationState: "California",
      locationCountry: "United States",
      salaryMin: 35,
      salaryMax: 45,
      salaryCurrency: "USD",
      salaryInterval: "hourly",
      officialUrl: "https://careers.kula.ai/acme/47740/?domain=acme.com",
    })]);
  });
});
