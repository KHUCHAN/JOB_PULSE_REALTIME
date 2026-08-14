import { describe, expect, it } from "vitest";
import * as crawlerModule from "./crawler";
import { crawlBudgetedFetcher, crawlSource, discoverAts, oracleCareerSite } from "./crawler";

describe("source crawl budget", () => {
  it("stops issuing requests after the per-source request ceiling", async () => {
    const fetcher = crawlBudgetedFetcher(async () => new Response("ok"), { maxRequests: 2, deadlineMs: 1_000 });
    await expect(fetcher("https://example.com/1")).resolves.toBeInstanceOf(Response);
    await expect(fetcher("https://example.com/2")).resolves.toBeInstanceOf(Response);
    await expect(fetcher("https://example.com/3")).rejects.toThrow("2 request source crawl budget exhausted");
  });

  it("aborts an active request at the per-source wall-clock deadline", async () => {
    const hangingFetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    const fetcher = crawlBudgetedFetcher(hangingFetcher, { maxRequests: 2, deadlineMs: 20 });
    await expect(fetcher("https://example.com/slow")).rejects.toThrow("source crawl deadline exceeded");
  });
});

describe("large catalog content", () => {
  it("keeps a bounded search summary without retaining every full description in memory", () => {
    const compactJibeContent = (crawlerModule as Record<string, unknown>).compactJibeContent;
    expect(compactJibeContent).toBeTypeOf("function");
    expect((compactJibeContent as (value: string, compact: boolean) => unknown)("x".repeat(5_000), true)).toEqual({ summary: "x".repeat(100) });
    expect((compactJibeContent as (value: string, compact: boolean) => unknown)("Full description", false)).toEqual({ summary: "Full description", description: "Full description" });
  });
});

describe("crawlSource", () => {
  it("reads every server-rendered Okta job with its location and stable requisition id", async () => {
    const html = `
      <div class="views-row even"><div class="views-field views-field-title"><span class="field-content">
        <a href="/company/careers/engineering/software-engineer-ai-8007071/" hreflang="en">Software Engineer &amp; AI</a>
      </span></div><div class="views-field views-field-field-job-location"><div class="field-content">Bellevue, Washington; San Francisco, California</div></div></div>
      <div class="views-row odd"><div class="views-field views-field-title"><span class="field-content">
        <a href="/company/careers/engineering/summer-intern-8100000/" hreflang="en">Summer Intern</a>
      </span></div><div class="views-field views-field-field-job-location"><div class="field-content">US Remote</div></div></div>`;
    const fetcher: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    const result = await crawlSource({
      id: "p4-0469-okta",
      company: "Okta",
      postingUrl: "https://www.okta.com/company/careers/job-listing/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T21:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, responseStatus: 200 }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "8007071",
        title: "Software Engineer & AI",
        location: "Bellevue, Washington; San Francisco, California",
        officialUrl: "https://www.okta.com/company/careers/engineering/software-engineer-ai-8007071/",
      }),
      expect.objectContaining({
        externalId: "8100000",
        title: "Summer Intern",
        location: "US Remote",
        locationCountry: "US",
        employmentType: "Internship",
      }),
    ]);
  });

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

  it("uses a branded Oracle Candidate Experience host as its own API origin", () => {
    expect(oracleCareerSite(
      "<title>Dell Careers</title>",
      "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/jobs",
    )).toEqual({
      apiOrigin: "https://enterpriseplatform.dell.com",
      site: "careers",
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

  it("discovers a Greenhouse board API embedded by a JavaScript careers app", () => {
    expect(discoverAts(
      '<script>const endpoint = "https://boards-api.greenhouse.io/v1/boards/adyen/jobs";</script>',
      "https://careers.adyen.com/vacancies",
    )).toEqual({
      kind: "greenhouse",
      endpoint: "https://boards-api.greenhouse.io/v1/boards/adyen/jobs?content=true",
    });
  });

  it("discovers a legacy Greenhouse embed board slug", () => {
    expect(discoverAts(
      '<script src="https://boards.greenhouse.io/embed/job_board/js?for=adaptivebiotechnologies"></script>',
      "https://www.adaptivebiotech.com/career-listings/",
    )).toEqual({
      kind: "greenhouse",
      endpoint: "https://boards-api.greenhouse.io/v1/boards/adaptivebiotechnologies/jobs?content=true",
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

  it("discovers an escaped Workday URL embedded in application state", () => {
    expect(discoverAts(
      String.raw`<script>{"careers":"https:\/\/acme.wd5.myworkdayjobs.com\/Careers"}</script>`,
      "https://acme.example/careers",
    )).toEqual({
      kind: "workday",
      endpoint: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/jobs",
    });
    expect(discoverAts(
      "[Apply](https://acme.wd5.myworkdayjobs.com/External)",
      "https://acme.example/careers",
    )).toEqual({
      kind: "workday",
      endpoint: "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    });
  });

  it("discovers Workable and BambooHR boards embedded by official careers pages", () => {
    expect(discoverAts(
      '<script src="https://apply.workable.com/api/v1/widget/accounts/fenergo"></script>',
      "https://www.fenergo.com/careers",
    )).toEqual({ kind: "workable", endpoint: "https://apply.workable.com/fenergo/" });
    expect(discoverAts(
      '<script src="https://berkshiregrey.bamboohr.com/js/jobs2.php"></script>',
      "https://www.berkshiregrey.com/careers",
    )).toEqual({ kind: "bamboohr", endpoint: "https://berkshiregrey.bamboohr.com/careers" });
    expect(discoverAts(
      '<a href="https://napier.pinpointhq.com/">Open roles</a>',
      "https://www.napier.ai/careers",
    )).toEqual({ kind: "pinpoint", endpoint: "https://napier.pinpointhq.com/" });
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

  it("follows an official job-search link before declaring a careers landing page undiscovered", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://acme.example/careers") {
        return new Response('<a href="https://careers.acme.example/search-jobs">Search jobs</a>', { status: 200 });
      }
      if (url === "https://careers.acme.example/search-jobs") {
        return new Response('<script>widget({"company_code":"Acme"})</script>', { status: 200 });
      }
      if (url === "https://api.smartrecruiters.com/v1/companies/Acme/postings") {
        return new Response(JSON.stringify({
          totalFound: 1,
          content: [{ id: "job-1", name: "Software Engineer", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/job-1" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({
      id: "acme",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T23:00:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      resolvedListingUrl: "https://careers.acme.example/search-jobs",
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "job-1",
      title: "Software Engineer",
      officialUrl: "https://jobs.smartrecruiters.com/Acme/job-1",
    })]);
    expect(requests.slice(0, 3)).toEqual([
      "https://acme.example/careers",
      "https://careers.acme.example/search-jobs",
      "https://api.smartrecruiters.com/v1/companies/Acme/postings",
    ]);
  });

  it("extracts every server-rendered Deel job reached from an official careers page", async () => {
    const postings = [{
      id: "5d3636f8-0712-4fe2-a1f4-84358440d272",
      jobId: "internal-1",
      title: "Data Scientist",
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-11T12:00:00.000Z",
      job: {
        jobEmploymentTypes: [{ employmentType: { name: "Full-time" } }],
        jobLocations: [{ location: { name: "New York" } }, { location: { name: "Stockholm" } }],
        currentCompensation: { currencyIsoCode: "USD", minAmount: 150000, maxAmount: 190000 },
        jobTeams: [{ team: { name: "Analytics" } }],
        jobDepartments: [{ department: { name: "Engineering" } }],
      },
      jobPostingPublications: [{ currentState: { stateSlug: "published_basic", createdAt: "2026-08-10T13:00:00.000Z" } }],
    }];
    const detailUrl = "https://jobs.deel.com/klarna/job-details/5d3636f8-0712-4fe2-a1f4-84358440d272/overview";
    const flight = JSON.stringify({ jobPostings: postings, orgSlug: "klarna" });
    const deelHtml = [
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: [{ "@type": "ListItem", position: 1, url: detailUrl }],
      })}</script>`,
      `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script>`,
    ].join("");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://www.klarna.com/careers/") {
        return new Response('<a href="https://jobs.deel.com/job-boards/klarna">All open positions</a>', { status: 200 });
      }
      if (url === "https://jobs.deel.com/job-boards/klarna") return new Response(deelHtml, { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({
      id: "p2-0124-klarna",
      company: "Klarna",
      postingUrl: "https://www.klarna.com/careers/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T23:00:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      resolvedListingUrl: "https://jobs.deel.com/job-boards/klarna",
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "5d3636f8-0712-4fe2-a1f4-84358440d272",
      title: "Data Scientist",
      location: "New York; Stockholm",
      secondaryLocations: ["Stockholm"],
      employmentType: "Full-time",
      department: "Engineering",
      team: "Analytics",
      salaryMin: 150000,
      salaryMax: 190000,
      salaryCurrency: "USD",
      officialUrl: detailUrl,
      publishedAt: "2026-08-10T13:00:00.000Z",
    })]);
  });

  it("paginates an official UKG job board discovered from a careers landing page", async () => {
    const board = "https://recruiting.ultipro.com/KIN1009KINMA/JobBoard/board-id/?q=&o=postedDateDesc";
    const loadUrl = "https://recruiting.ultipro.com/KIN1009KINMA/JobBoard/board-id/JobBoardView/LoadSearchResults";
    const detailUrl = "https://recruiting.ultipro.com/KIN1009KINMA/JobBoard/board-id/OpportunityDetail?opportunityId=00000000-0000-0000-0000-000000000000";
    const requests: Array<{ url: string; body: { opportunitySearch?: { Skip?: number } } | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, body });
      if (url === "https://kinsale.example/careers") {
        return new Response(`<a href="${board}">View current openings</a>`, { status: 200 });
      }
      if (url === board) {
        return new Response(`<script>
          var opportunityModel = new US.Opportunity.OpportunitiesViewModel({
            pageSize: 2,
            loadUrl: "/KIN1009KINMA/JobBoard/board-id/JobBoardView/LoadSearchResults",
            opportunityLinkUrl: "/KIN1009KINMA/JobBoard/board-id/OpportunityDetail?opportunityId=00000000-0000-0000-0000-000000000000"
          });
        </script>`, { status: 200 });
      }
      if (url === loadUrl) {
        const skip = body?.opportunitySearch?.Skip ?? 0;
        const opportunities = skip === 0 ? [{
          Id: "job-1",
          Title: "Data Scientist Intern",
          RequisitionNumber: "REQ-1",
          FullTime: true,
          JobCategoryName: "Data & Analytics",
          PostedDate: "2026-08-11T12:00:00.000Z",
          BriefDescription: "Build applied machine learning systems.",
          JobLocationType: "Hybrid",
          Locations: [{
            LocalizedName: "Corporate Office",
            Address: { City: "Richmond", State: { Code: "VA" }, Country: { Code: "USA" } },
          }],
        }, {
          Id: "job-2",
          Title: "Software Engineering Intern",
          RequisitionNumber: "REQ-2",
          FullTime: false,
          PostedDate: "2026-08-10T12:00:00.000Z",
          Locations: [],
        }] : [{
          Id: "job-3",
          Title: "AI Engineer",
          RequisitionNumber: "REQ-3",
          FullTime: true,
          PostedDate: "2026-08-09T12:00:00.000Z",
          Locations: [],
        }];
        return Response.json({ opportunities, totalCount: 3, locations: [] });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({
      id: "kinsale",
      company: "Kinsale Capital",
      postingUrl: "https://kinsale.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      resolvedListingUrl: board,
    }));
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "job-1",
      title: "Data Scientist Intern",
      location: "Richmond, VA, USA",
      locationCity: "Richmond",
      locationState: "VA",
      locationCountry: "USA",
      arrangement: "hybrid",
      employmentType: "Full-time",
      department: "Data & Analytics",
      requisitionId: "REQ-1",
      officialUrl: detailUrl.replace("00000000-0000-0000-0000-000000000000", "job-1"),
      publishedAt: "2026-08-11T12:00:00.000Z",
    }));
    expect(requests.filter(({ url }) => url === loadUrl).map(({ body }) => body?.opportunitySearch?.Skip)).toEqual([0, 2]);
  });

  it("keeps a repeated UKG page incomplete instead of closing unseen jobs", async () => {
    const board = "https://recruiting.ultipro.com/TEST/JobBoard/board-id/";
    const loadUrl = "https://recruiting.ultipro.com/TEST/JobBoard/board-id/JobBoardView/LoadSearchResults";
    const repeated = [{ Id: "job-1", Title: "Engineer", Locations: [] }, { Id: "job-2", Title: "Analyst", Locations: [] }];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === board) return new Response(`<script>new US.Opportunity.OpportunitiesViewModel({pageSize: 2, loadUrl: "/TEST/JobBoard/board-id/JobBoardView/LoadSearchResults", opportunityLinkUrl: "/TEST/JobBoard/board-id/OpportunityDetail?opportunityId=00000000-0000-0000-0000-000000000000"})</script>`);
      if (url === loadUrl) return Response.json({ opportunities: repeated, totalCount: 4 });
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({ id: "ukg", company: "Test", postingUrl: board, adapter: "custom" }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false }));
    expect(result.jobs).toHaveLength(2);
  });

  it("does not leave a company-scoped board for a multi-company jobs portal", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.ycombinator.com/companies/pixley-ai/jobs") {
        return new Response('<a href="https://www.ycombinator.com/jobs">See all startup jobs</a>', { status: 200 });
      }
      if (url === "https://www.ycombinator.com/jobs") {
        return new Response('<a href="https://www.ycombinator.com/companies/another-startup/jobs/engineer">Software Engineer</a>', { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({
      id: "pixley",
      company: "Pixley AI",
      postingUrl: "https://www.ycombinator.com/companies/pixley-ai/jobs",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T23:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "failed", jobs: [] }));
    expect(requests).not.toContain("https://www.ycombinator.com/jobs");
  });

  it("does not relabel a parent company's entire board as a subsidiary", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("join-our-talent-community")) {
        return new Response('<a href="https://careers.unitedhealthgroup.com/search-jobs">Search jobs</a>', { status: 200 });
      }
      if (url === "https://careers.unitedhealthgroup.com/search-jobs") {
        return new Response('<a href="/job/minnetonka/software-engineer/123/456">Software Engineer</a>', { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await crawlSource({
      id: "optumrx",
      company: "OptumRx (UnitedHealth)",
      postingUrl: "https://www.unitedhealthgroup.com/careers/en/job-seeker-resources/join-our-talent-community.html",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T23:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "failed", jobs: [] }));
    expect(requests).not.toContain("https://careers.unitedhealthgroup.com/search-jobs");
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

  it("uses a verified Jibe endpoint without refetching a client-rendered landing page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return new Response(JSON.stringify({ totalCount: 0, jobs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({
      id: "p5-0869-costco",
      company: "Costco",
      postingUrl: "https://careers.costco.com/jobs",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(requests).toEqual([
      "https://careers.costco.com/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false",
    ]);
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

  it("promotes a SuccessFactors landing page to its complete search catalog", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.acme.example/") return new Response([
        '<link href="https://rmkcdn.successfactors.com/theme.css">',
        '<a href="/go/Engineering/100/">Engineering jobs</a>',
      ].join(""));
      return new Response([
        '<link href="https://rmkcdn.successfactors.com/theme.css">',
        '<span class="paginationLabel">Results <b>1 – 1</b> of <b>1</b></span>',
        '<a class="jobTitle-link" href="/job/Software-Intern/101/">Software Intern</a>',
      ].join(""));
    };

    const result = await crawlSource({
      id: "successfactors-landing",
      company: "Acme",
      postingUrl: "https://careers.acme.example/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://careers.acme.example/",
      "https://careers.acme.example/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://careers.acme.example/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc",
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Software Intern"]);
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

  it("repairs a blocked Avature listing to offset zero and paginates the reader copy with locations", async () => {
    const requests: string[] = [];
    const page = (offset: number) => {
      const start = offset + 1;
      const end = offset + 10;
      const jobs = Array.from({ length: 10 }, (_, index) => {
        const number = start + index;
        return `* [Co-op Data Analyst ${number}](https://delta.avature.net/en_US/careers/JobDetail/Co-op-Data-Analyst-${number}/${10_000 + number}?jobId=${10_000 + number}) United States, Georgia, Atlanta.Ref #${10_000 + number}`;
      }).join("\n");
      return `1-${end} of 20 results\n${jobs}\n* [Sponsored role](https://job-boards.greenhouse.io/forter/jobs/8622108002)`;
    };
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://delta.avature.net/")) return new Response("", { status: 202 });
      const match = url.match(/jobOffset=(\d+)/);
      return new Response(page(Number(match?.[1] ?? 0)), { status: 200 });
    };

    const result = await crawlSource({
      id: "delta-avature-reader",
      company: "Delta Air Lines",
      postingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=40",
      adapter: "custom",
    }, fetcher, new Date("2026-08-13T16:00:00Z"));

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=0",
    }));
    expect(result.jobs).toHaveLength(20);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Co-op Data Analyst 1",
      location: "United States, Georgia, Atlanta",
      externalId: "10001",
    }));
    expect(requests).toContain("https://r.jina.ai/https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=0");
    expect(requests).toContain("https://r.jina.ai/https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=10");
  });

  it("falls back to Delta's keyword path when the query listing is empty from a Worker", async () => {
    const requests: string[] = [];
    const markdown = [
      "1-1 of 1 results",
      "* [Data Science Intern](https://delta.avature.net/en_US/careers/JobDetail/Data-Science-Intern/7001) United States, Georgia, Atlanta.Ref #7001",
    ].join("\n");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://delta.avature.net/")) return new Response("", { status: 202 });
      if (url.includes("r.jina.ai/http://r.jina.ai/") && /SearchJobs\/intern\?jobOffset=0/.test(url)) {
        return new Response(markdown, { status: 200 });
      }
      return new Response("", { status: 503 });
    };

    const result = await crawlSource({
      id: "audit-row-342",
      company: "Delta Air Lines",
      postingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=40",
      adapter: "custom",
    }, fetcher, new Date("2026-08-13T16:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ title: "Data Science Intern", externalId: "7001" }));
    expect(requests.some((url) => url.includes("r.jina.ai/http://r.jina.ai/https://delta.avature.net/en_US/careers/SearchJobs/intern?jobOffset=0"))).toBe(true);
  });

  it("recovers Wells Fargo's 2027 internship slice from the reader without closing the full catalog", async () => {
    const wellsUrl = "https://www.wellsfargojobs.com/en/jobs/?search=internship";
    const markdown = [
      "Showing **1** to **2** of **2** matching jobs",
      "## [2027 Data Science Summer Internship – Early Careers](https://www.wellsfargojobs.com/en/jobs/r-1/2027-data-science-summer-internship/)",
      "* CHARLOTTE, North Carolina",
      "## [2027 Software Engineering Internship – Early Careers](https://www.wellsfargojobs.com/en/jobs/r-2/2027-software-engineering-internship/)",
      "* SAN FRANCISCO, California",
    ].join("\n");
    const fetcher: typeof fetch = async (input) => String(input) === `https://r.jina.ai/${wellsUrl}`
      ? new Response(markdown, { status: 200 })
      : new Response("blocked", { status: 403 });

    const result = await crawlSource({
      id: "p2-0067-wells-fargo",
      company: "Wells Fargo",
      postingUrl: "https://www.wellsfargojobs.com/en/jobs/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-13T16:00:00Z"));

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false, resolvedListingUrl: wellsUrl }));
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "2027 Data Science Summer Internship – Early Careers",
      location: "CHARLOTTE, North Carolina",
    }));
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

  it("checkpoints large Jibe catalogs before the per-source request budget", async () => {
    const requestedPages: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://careers.acme.example/jobs") {
        return new Response('<script src="https://app.jibecdn.com/prod/search/app.js"></script>', { status: 200 });
      }
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      const start = (page - 1) * 100;
      const jobs = Array.from({ length: 100 }, (_, index) => ({
        data: {
          slug: String(page === 2 && index === 0 ? 99 : start + index),
          req_id: String(page === 2 && index === 0 ? 99 : start + index),
          title: `Role ${page === 2 && index === 0 ? 99 : start + index}`,
        },
      }));
      return new Response(JSON.stringify({ totalCount: page === 1 ? 19_253 : 19_254, jobs }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({
      id: "large-jibe",
      company: "Acme",
      postingUrl: "https://careers.acme.example/jobs",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs).toHaveLength(1_499);
    expect(result.completeListing).toBe(false);
    expect(result.pagination).toEqual({ nextPage: 15, cycleComplete: false, totalPages: 100 });
    expect(requestedPages).toHaveLength(15);
    expect(Math.max(...requestedPages)).toBe(15);
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

  it("routes PayPal's corporate careers home to its official Eightfold job feed", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      return Response.json({ data: {
        count: 1,
        positions: [{
          id: 42,
          name: "Software Engineering Intern",
          locations: ["San Jose, CA"],
          atsJobId: "R0123456",
          positionUrl: "/careers/job/42",
          creationTs: 1785888000,
          type: "Internship",
        }],
      } });
    };

    const result = await crawlSource({
      id: "p4-0327-paypal",
      company: "PayPal",
      postingUrl: "https://careers.pypl.com/home/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests[0]).toBe("https://paypal.eightfold.ai/api/pcsx/search?domain=paypal.com&query=&location=&start=0");
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "R0123456",
        title: "Software Engineering Intern",
        officialUrl: "https://paypal.eightfold.ai/careers/job/42",
      })],
    }));
  });

  it("collects Walmart jobs through the official hybrid search API instead of navigation links", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url: url.href, body: JSON.parse(String(init?.body ?? "null")) });
      const body = JSON.parse(String(init?.body ?? "null")) as { query?: string };
      if (body.query !== "*") return Response.json({ totalJobs: 0, jobSearchSucceeded: true, jobs: [] });
      return Response.json({
        totalJobs: 2,
        jobSearchSucceeded: true,
        jobs: [{
          id: "R-100-External",
          text: "Job Posting Description: Build reliable systems.",
          metadata: {
            jobId: "R-100",
            title: "Software Engineering Intern",
            primaryLocationCity: "BENTONVILLE",
            primaryLocationState: "AR",
            primaryLocationCountry: "US",
            jobPostingStartDate: 1785888000000,
            employmentTypes: ["Full time"],
            categories: ["Software Engineering and Architecture"],
            brand: "Walmart",
            minPay: 30,
            maxPay: 40,
            currencyCode: "USD",
            payFrequency: "Hourly",
          },
        }, {
          id: "R-101-External",
          text: "Job Posting Description: Analyze business performance.",
          metadata: { jobId: "R-101", title: "Data Analyst", primaryLocationCountry: "US" },
        }],
      });
    };

    const result = await crawlSource({
      id: "p5-0763-walmart",
      company: "Walmart (Global Tech)",
      postingUrl: "https://careers.walmart.com/us/en/home",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests[0]).toEqual({ url: "https://careers.walmart.com/api/ai/search-ai/api/v1/combined/hybrid-search?page=0&size=1000&locale=en_US", body: {
      query: "*", basicSearch: true, filter: "", locale: "en_US",
    } });
    expect(requests.map(({ body }) => (body as { query: string }).query)).toEqual(["*", "intern", "co-op", "coop", "co op"]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "R-100",
        title: "Software Engineering Intern",
        location: "BENTONVILLE, AR, US",
        employmentType: "Internship",
        department: "Software Engineering and Architecture",
        salaryMin: 30,
        salaryMax: 40,
        salaryCurrency: "USD",
        salaryInterval: "Hourly",
        officialUrl: "https://careers.walmart.com/us/en/jobs/R-100",
        publishedAt: "2026-08-05T00:00:00.000Z",
      }), expect.objectContaining({ externalId: "R-101", title: "Data Analyst" })],
    }));
  });

  it("paginates Google's public job results instead of indexing careers navigation", async () => {
    const requests: string[] = [];
    const page = (start: number, count: number) => Array.from({ length: count }, (_, index) => {
      const id = start + index;
      return `<a href="/about/careers/applications/jobs/results/${id}-role-${id}" aria-label="Learn more about Role ${id}"></a>`;
    }).join("");
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      const number = Number(url.searchParams.get("page") ?? 1);
      return new Response(number === 1
        ? `<span class="SWhIm">21</span> jobs matched ${page(100, 20)}<a href="?page=2" aria-label="Go to next page"></a>`
        : `<span class="SWhIm">21</span> jobs matched ${page(120, 1)}`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p4-0285-google",
      company: "Google / Alphabet",
      postingUrl: "https://www.google.com/about/careers/applications/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://www.google.com/about/careers/applications/jobs/results/",
      "https://www.google.com/about/careers/applications/jobs/results/?page=2",
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toHaveLength(21);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "100",
      title: "Role 100",
      officialUrl: "https://www.google.com/about/careers/applications/jobs/results/100-role-100",
    }));
  });

  it("streams Google result bodies instead of materializing every full HTML page", async () => {
    const encoder = new TextEncoder();
    const html = `<span class="SWhIm">1</span> jobs matched
      <a href="jobs/results/100-streamed-role?page=1" aria-label="Learn more about Streamed Role"></a>`;
    const fetcher: typeof fetch = async () => {
      const response = new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(html.slice(0, 67)));
          controller.enqueue(encoder.encode(html.slice(67)));
          controller.close();
        },
      }), { status: 200 });
      response.text = async () => { throw new Error("Google pages must be parsed from the response stream."); };
      return response;
    };

    const result = await crawlSource({
      id: "p4-0285-google",
      company: "Google / Alphabet",
      postingUrl: "https://www.google.com/about/careers/applications/jobs/results/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "100",
        title: "Streamed Role",
        officialUrl: "https://www.google.com/about/careers/applications/jobs/results/100-streamed-role",
      })],
    }));
  });

  it("checkpoints oversized Google catalogs across bounded crawl invocations", async () => {
    const requests: number[] = [];
    const page = (start: number, count: number) => Array.from({ length: count }, (_, index) => {
      const id = start + index;
      return `<a href="/about/careers/applications/jobs/results/${id}-role-${id}" aria-label="Learn more about Role ${id}"></a>`;
    }).join("");
    const fetcher: typeof fetch = async (input) => {
      const pageNumber = Number(new URL(String(input)).searchParams.get("page") ?? 1);
      requests.push(pageNumber);
      const count = pageNumber === 22 ? 1 : 20;
      return new Response(`<span class="SWhIm">421</span> jobs matched ${page(pageNumber * 100, count)}`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p4-0285-google",
      company: "Google / Alphabet",
      postingUrl: "https://www.google.com/about/careers/applications/jobs/results/",
      adapter: "custom",
      crawlPageCursor: 21,
    }, fetcher, new Date());

    expect(requests).toEqual([1, 21, 22]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 22 },
    }));
    expect(result.jobs).toHaveLength(41);
  });

  it("retries the first failed Google page instead of completing an incomplete crawl cycle", async () => {
    const requests: number[] = [];
    const page = (start: number) => Array.from({ length: 20 }, (_, index) => {
      const id = start + index;
      return `<a href="/about/careers/applications/jobs/results/${id}-role-${id}" aria-label="Learn more about Role ${id}"></a>`;
    }).join("");
    const fetcher: typeof fetch = async (input) => {
      const pageNumber = Number(new URL(String(input)).searchParams.get("page") ?? 1);
      requests.push(pageNumber);
      if (pageNumber === 22) return new Response("temporary failure", { status: 503 });
      return new Response(`<span class="SWhIm">421</span> jobs matched ${page(pageNumber * 100)}`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p4-0285-google",
      company: "Google / Alphabet",
      postingUrl: "https://www.google.com/about/careers/applications/jobs/results/",
      adapter: "custom",
      crawlPageCursor: 21,
    }, fetcher, new Date());

    expect(requests).toEqual([1, 21, 22]);
    expect(result).toEqual(expect.objectContaining({
      completeListing: false,
      pagination: { nextPage: 22, cycleComplete: false, totalPages: 22 },
    }));
  });

  it("keeps Google DeepMind's official company filter on every careers page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      return new Response(`<span class="SWhIm">1</span> jobs matched
        <a href="/about/careers/applications/jobs/results/123-research-engineer" aria-label="Learn more about Research Engineer"></a>`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p5-0610-google-deepmind",
      company: "Google DeepMind",
      postingUrl: "https://www.google.com/about/careers/applications/jobs/results?company=DeepMind&utm_source=deepmind",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://www.google.com/about/careers/applications/jobs/results/?company=DeepMind",
    ]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([expect.objectContaining({ company: "Google DeepMind", title: "Research Engineer" })]);
  });

  it("extracts Block's complete embedded job catalog instead of the first rendered slice", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <script>data:{jobs:{currentPage:[
        {id:5225220008,internalId:4477122008,requisitionId:"R0006497",title:"Compliance Technology Program Lead",bu:"block",employeeType:"Regular",jobFunction:"Analytics & Data Science",isRemote:true,location:"New York, NY, US",publicationDate:"2026-08-10"},
        {id:5243440008,internalId:4485001008,requisitionId:"R0006600",title:"Senior Machine Learning Engineer, Applied AI Quality",bu:"block",employeeType:"Regular",jobFunction:"Artificial Intelligence",isRemote:true,location:"Bay Area, CA, US",publicationDate:null}
      ],total:2}}</script>
    `, { status: 200 });

    const result = await crawlSource({
      id: "p2-0028-block", company: "Block",
      postingUrl: "https://block.xyz/careers/jobs", adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "5225220008", requisitionId: "R0006497",
        title: "Compliance Technology Program Lead", department: "Analytics & Data Science",
        businessUnit: "block", arrangement: "remote", location: "New York, NY, US",
        officialUrl: "https://block.xyz/careers/jobs/5225220008",
        publishedAt: "2026-08-10T00:00:00.000Z",
      }),
      expect.objectContaining({ externalId: "5243440008", title: "Senior Machine Learning Engineer, Applied AI Quality" }),
    ]);
  });

  it("loads the remaining Block catalog pages from the same official API", async () => {
    const requests: string[] = [];
    const embedded = Array.from({ length: 50 }, (_, index) =>
      `{id:${1000 + index},internalId:${2000 + index},requisitionId:"R${index}",title:"Role ${index}",bu:"block",employeeType:"Regular",jobFunction:"Engineering",isRemote:false,location:"City ${index}, US",publicationDate:null}`
    ).join(",");
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.pathname === "/api/careers/jobs") return Response.json({
        currentPage: [{
          id: 1050, internalId: 2050, requisitionId: "R50", title: "Role 50", bu: "block",
          employeeType: "Regular", jobFunction: "Engineering", isRemote: false, location: "City 50, US", publicationDate: null,
        }],
        total: 51,
      });
      return new Response(`<script>jobs:{currentPage:[${embedded}],total:51}</script>`);
    };

    const result = await crawlSource({
      id: "p2-0028-block", company: "Block",
      postingUrl: "https://block.xyz/careers/jobs", adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://block.xyz/careers/jobs",
      "https://block.xyz/api/careers/jobs?page=2&pageLimit=50",
    ]);
    expect(result.jobs).toHaveLength(51);
    expect(result.completeListing).toBe(true);
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

  it("bootstraps Eightfold session cookies before retrying a rate-limited public feed", async () => {
    const requests: Array<{ url: string; cookie: string | null }> = [];
    let apiCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const cookie = new Headers(init?.headers).get("cookie");
      requests.push({ url: url.href, cookie });
      if (url.pathname === "/careers") {
        const headers = new Headers({ "content-type": "text/html" });
        headers.append("set-cookie", "_vs=session-one; Path=/; Secure; HttpOnly");
        headers.append("set-cookie", "_vscid=1; Path=/; Secure; HttpOnly");
        return new Response("<main>Microsoft Careers</main>", { status: 200, headers });
      }
      apiCalls += 1;
      if (apiCalls === 1) return new Response("Please try again later", { status: 429 });
      expect(cookie).toContain("_vs=session-one");
      expect(cookie).toContain("_vscid=1");
      return Response.json({ data: {
        count: 1,
        positions: [{ id: 99, name: "Data Science Intern", atsJobId: "200099", positionUrl: "/careers/job/99" }],
      } });
    };

    const result = await crawlSource({
      id: "p4-0309-microsoft",
      company: "Microsoft",
      postingUrl: "https://apply.careers.microsoft.com/careers?domain=microsoft.com",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs[0]).toEqual(expect.objectContaining({ externalId: "200099", title: "Data Science Intern" }));
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/api/pcsx/search", "/careers", "/api/pcsx/search",
    ]);
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

  it("uses Meta's official API GraphQL endpoint and collects the complete job list", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.metacareers.com/jobsearch/") {
        return new Response([
          '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
          '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
        ].join(""), { headers: { "set-cookie": "datr=meta-session; Path=/; Secure; HttpOnly" } });
      }
      expect(url).toBe("https://www.metacareers.com/api/graphql/");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("origin")).toBe("https://www.metacareers.com");
      expect(new Headers(init?.headers).get("cookie")).toBe("datr=meta-session");
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
      officialUrl: "https://www.metacareers.com/profile/job_details/2916726525182155/",
    })]);
    expect(result.facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "department" }),
      expect.objectContaining({ key: "team" }),
    ]));
    expect(requests).toEqual([
      "https://www.metacareers.com/jobsearch/",
      "https://www.metacareers.com/api/graphql/",
    ]);
  });

  it("uses Meta's last-known public search operation without fetching static scripts", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") {
        return new Response([
          '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
          '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
        ].join(""));
      }
      expect(url).toBe("https://www.metacareers.com/api/graphql/");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("doc_id")).toBe("27129360303422352");
      return Response.json({
        data: {
          job_search_with_featured_jobs_v2: {
            all_jobs: [{ id: "meta-1", title: "Software Engineer", locations: ["Menlo Park, CA"] }],
          },
        },
      });
    };

    const result = await crawlSource({
      id: "meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs).toEqual([expect.objectContaining({ externalId: "meta-1" })]);
  });

  it("tries Meta's alternate official GraphQL endpoint when the API path throws", async () => {
    const endpoints: string[] = [];
    const operationIds: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response([
        '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
        '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
      ].join(""));
      endpoints.push(url);
      if (url === "https://www.metacareers.com/api/graphql/") throw new Error("API edge reset");
      const body = new URLSearchParams(String(init?.body));
      operationIds.push(body.get("doc_id") ?? "");
      return Response.json({
        data: {
          job_search_with_featured_jobs_v2: {
            all_jobs: [{ id: "meta-2", title: "Machine Learning Engineer", locations: ["New York, NY"] }],
          },
        },
      });
    };

    const result = await crawlSource({
      id: "meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(endpoints).toEqual([
      "https://www.metacareers.com/api/graphql/",
      "https://www.metacareers.com/graphql/",
    ]);
    expect(operationIds).toEqual(["27129360303422352"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", jobs: [expect.objectContaining({ externalId: "meta-2" })] }));
  });

  it("retries Meta's official GraphQL paths with browser request metadata after edge HTML", async () => {
    const attempts: Array<{ url: string; userAgent: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") {
        return new Response('<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>');
      }
      const userAgent = new Headers(init?.headers).get("user-agent");
      attempts.push({ url, userAgent });
      if (!userAgent || url === "https://www.metacareers.com/graphql/") {
        return new Response("<!DOCTYPE html><title>Edge response</title>");
      }
      return Response.json({
        data: {
          job_search_with_featured_jobs_v2: {
            all_jobs: [{ id: "meta-ua-1", title: "Data Engineer", locations: ["Menlo Park, CA"] }],
          },
        },
      });
    };

    const result = await crawlSource({
      id: "meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(attempts.map(({ url }) => url)).toEqual([
      "https://www.metacareers.com/api/graphql/",
      "https://www.metacareers.com/graphql/",
      "https://www.metacareers.com/api/graphql/",
    ]);
    expect(attempts[2]?.userAgent).toContain("Mozilla/5.0");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", jobs: [expect.objectContaining({ externalId: "meta-ua-1" })] }));
  });

  it("never treats empty or malformed Meta GraphQL arrays as an authoritative catalog", async () => {
    for (const allJobs of [[], [{ id: "meta-3" }]]) {
      const operationIds: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url === "https://www.metacareers.com/jobsearch/") return new Response([
          '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
          '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
        ].join(""));
        if (url.includes("sitemap.xml")) return new Response("temporary", { status: 503 });
        operationIds.push(new URLSearchParams(String(init?.body)).get("doc_id") ?? "");
        return Response.json({ data: { job_search_with_featured_jobs_v2: { all_jobs: allJobs } } });
      };

      const result = await crawlSource({
        id: "meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
      }, fetcher, new Date());

      expect(operationIds).toEqual(Array(4).fill("27129360303422352"));
      expect(result).toEqual(expect.objectContaining({ status: "failed", completeListing: false, jobs: [] }));
    }
  });

  it("falls back to Meta's official sitemap and structured job pages when GraphQL is edge-blocked", async () => {
    const requests: string[] = [];
    const detail = (title: string) => `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title,
      description: "Build production machine learning systems.",
      datePosted: "2026-08-11T09:00:00-07:00",
      employmentType: "Full-time",
      jobLocation: [{
        "@type": "Place",
        name: "Menlo Park, CA",
        address: { "@type": "PostalAddress", addressLocality: "Menlo Park", addressRegion: "CA", addressCountry: "US" },
      }],
    })}</script>`;
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response([
        '<script src="https://static.xx.fbcdn.net/meta-careers.js"></script>',
        '<script type="application/json">["LSD",[],{"token":"fresh-lsd-token"}]</script>',
      ].join(""));
      if (url === "https://www.metacareers.com/api/graphql/" || url === "https://www.metacareers.com/graphql/") {
        return new Response("<!DOCTYPE html><title>Blocked</title>");
      }
      if (url === "https://www.metacareers.com/jobs/sitemap.xml") return new Response([
        '<?xml version="1.0"?><urlset>',
        '<url><loc>https://www.metacareers.com/profile/job_details/101/</loc><lastmod>2026-08-11</lastmod></url>',
        '<url><loc>https://www.metacareers.com/profile/job_details/101/</loc><lastmod>2026-08-11</lastmod></url>',
        '<url><loc>https://www.metacareers.com/profile/job_details/102/</loc><lastmod>2026-08-11</lastmod></url>',
        '<url><loc>http://www.metacareers.com/profile/job_details/103/</loc></url>',
        '<url><loc>https://www.metacareers.com/profile/job_details/104/?source=test</loc></url>',
        '<url><loc>https://www.metacareers.com:444/profile/job_details/105/</loc></url>',
        '</urlset>',
      ].join(""));
      if (url.endsWith("/101/")) return new Response(detail("Machine Learning Engineer"));
      if (url.endsWith("/102/")) return new Response(detail("Data Scientist"));
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(requests.filter((url) => url === "https://www.metacareers.com/api/graphql/")).toHaveLength(2);
    expect(requests.filter((url) => url === "https://www.metacareers.com/graphql/")).toHaveLength(2);
    expect(requests).toContain("https://www.metacareers.com/jobs/sitemap.xml");
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 1 },
    }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "101", title: "Machine Learning Engineer", location: "Menlo Park, CA, US",
        officialUrl: "https://www.metacareers.com/profile/job_details/101/",
      }),
      expect.objectContaining({ externalId: "102", title: "Data Scientist" }),
    ]);
  });

  it("uses stable ordered overlapping segments for Meta's changing sitemap", async () => {
    const detailRequests: string[] = [];
    const urls = Array.from({ length: 81 }, (_, index) => 1_081 - index)
      .map((id) => `<url><loc>https://www.metacareers.com/profile/job_details/${id}/</loc></url>`)
      .join("");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://www.metacareers.com/jobs/sitemap.xml") return new Response(`<urlset>${urls}</urlset>`);
      detailRequests.push(url);
      const id = url.match(/\/(\d+)\/$/)?.[1] ?? "";
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: `Role ${id}`, description: "Description", identifier: { value: id },
      })}</script>`);
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
      crawlPageCursor: 2,
    }, fetcher, new Date());

    expect(detailRequests).toHaveLength(40);
    expect(detailRequests[0]).toBe("https://www.metacareers.com/profile/job_details/1040/");
    expect(detailRequests.at(-1)).toBe("https://www.metacareers.com/profile/job_details/1079/");
    expect(result.pagination).toEqual({ nextPage: 3, cycleComplete: false, totalPages: 3 });
  });

  it("rejects a Meta detail page whose structured identity conflicts with its sitemap URL", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://www.metacareers.com/jobs/sitemap.xml") {
        return new Response('<urlset><url><loc>https://www.metacareers.com/profile/job_details/101/</loc></url></urlset>');
      }
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: "Conflicting role", url: "https://www.metacareers.com/profile/job_details/999/",
        identifier: { value: "999" },
      })}</script>`);
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({ status: "failed", completeListing: false, jobs: [] }));
  });

  it("uses the reader copy of Meta's official sitemap when both direct sitemap paths return HTML", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://www.metacareers.com/jobs/sitemap.xml" || url === "https://www.metacareers.com/jobsearch/sitemap.xml") {
        return new Response("<!DOCTYPE html><title>Blocked</title>");
      }
      if (url === "https://r.jina.ai/https://www.metacareers.com/jobs/sitemap.xml") {
        return new Response([
          "Title: Sitemap",
          "[https://www.metacareers.com/profile/job_details/201/](https://www.metacareers.com/profile/job_details/201/)",
        ].join("\n"));
      }
      if (url === "https://r.jina.ai/http://www.metacareers.com/jobs/sitemap.xml") {
        return new Response("[https://www.metacareers.com/profile/job_details/201/](https://www.metacareers.com/profile/job_details/201/)");
      }
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: "Research Scientist", identifier: { value: "201" },
      })}</script>`);
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://www.metacareers.com/jobsearch/",
      "https://www.metacareers.com/jobs/sitemap.xml",
      "https://www.metacareers.com/jobsearch/sitemap.xml",
      "https://r.jina.ai/https://www.metacareers.com/jobs/sitemap.xml",
      "https://r.jina.ai/http://www.metacareers.com/jobs/sitemap.xml",
      "https://www.metacareers.com/profile/job_details/201/",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      jobs: [expect.objectContaining({ externalId: "201", title: "Research Scientist" })],
      pagination: { nextPage: 1_000_001, cycleComplete: false, totalPages: 1 },
    }));
  });

  it("continues to the next Meta sitemap candidate after a direct request throws", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://www.metacareers.com/jobs/sitemap.xml") return {
        ok: true,
        status: 200,
        text: async () => { throw new Error("body stream reset"); },
      } as unknown as Response;
      if (url === "https://www.metacareers.com/jobsearch/sitemap.xml") {
        return new Response('<urlset><url><loc>https://www.metacareers.com/profile/job_details/301/</loc></url></urlset>');
      }
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: "Software Engineer", identifier: { value: "301" },
      })}</script>`);
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toContain("https://www.metacareers.com/jobsearch/sitemap.xml");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", jobs: [expect.objectContaining({ externalId: "301" })] }));
  });

  it("rejects disagreeing reader copies of Meta's official sitemap", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://r.jina.ai/https://www.metacareers.com/jobs/sitemap.xml") {
        return new Response("https://www.metacareers.com/profile/job_details/401/");
      }
      if (url === "https://r.jina.ai/http://www.metacareers.com/jobs/sitemap.xml") {
        return new Response("https://www.metacareers.com/profile/job_details/402/");
      }
      return new Response("<!DOCTYPE html>");
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({ status: "failed", completeListing: false, jobs: [] }));
  });

  it("restarts authoritative Meta pagination at page one after a reader checkpoint", async () => {
    const detailRequests: string[] = [];
    const urls = Array.from({ length: 81 }, (_, index) => 1_001 + index)
      .map((id) => `<url><loc>https://www.metacareers.com/profile/job_details/${id}/</loc></url>`)
      .join("");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://www.metacareers.com/jobsearch/") return new Response("<main>no token</main>");
      if (url === "https://www.metacareers.com/jobs/sitemap.xml") return new Response(`<urlset>${urls}</urlset>`);
      detailRequests.push(url);
      const id = url.match(/\/(\d+)\/$/)?.[1] ?? "";
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", title: `Role ${id}`, identifier: { value: id },
      })}</script>`);
    };

    const result = await crawlSource({
      id: "p4-0308-meta", company: "Meta", postingUrl: "https://www.metacareers.com/jobsearch/", adapter: "custom",
      crawlPageCursor: 1_000_005,
    }, fetcher, new Date());

    expect(detailRequests[0]).toBe("https://www.metacareers.com/profile/job_details/1001/");
    expect(result.pagination).toEqual({ nextPage: 2, cycleComplete: false, totalPages: 3 });
  });

  it("reads Databricks' complete official Gatsby Greenhouse catalog", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://www.databricks.com/careers-assets/page-data/company/careers/open-positions/page-data.json");
      return Response.json({
        result: { pageContext: { data: { allGreenhouseJob: { nodes: [{
          id: "Greenhouse__Job__6918763002",
          gh_Id: 6918763002,
          internal_job_id: 555,
          title: "Machine Learning Engineer Intern",
          absolute_url: "https://databricks.com/company/careers/open-positions/job?gh_jid=6918763002",
          updated_at: "2026-08-11T14:54:39-04:00",
          content: "&lt;p&gt;Build production ML systems.&lt;/p&gt;",
          location: { name: "San Francisco, California" },
          offices: [{ name: "San Francisco" }],
          departments: [{ name: "Engineering" }],
          metadata: [{ value: ["Machine Learning"], filterDept: "Engineering" }],
        }] } } } },
      });
    };

    const result = await crawlSource({
      id: "p4-0256-databricks", company: "Databricks",
      postingUrl: "https://www.databricks.com/company/careers/open-positions", adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "6918763002",
      title: "Machine Learning Engineer Intern",
      employmentType: "Internship",
      location: "San Francisco, California",
      department: "Engineering",
      office: "San Francisco",
      description: "Build production ML systems.",
      officialUrl: "https://databricks.com/company/careers/open-positions/job?gh_jid=6918763002",
      publishedAt: "2026-08-11T18:54:39.000Z",
    })]);
  });

  it("paginates IBM's official search API and retains searchable job facets", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://www-api.ibm.com/search/api/v2");
      const body = JSON.parse(String(init?.body)) as { from?: number; size: number };
      offsets.push(body.from ?? 0);
      const count = (body.from ?? 0) === 30 ? 1 : 30;
      return Response.json({
        hits: {
          total: { value: 31 },
          hits: Array.from({ length: count }, (_, index) => {
            const id = (body.from ?? 0) + index + 1;
            return {
              _id: `hash-${id}`,
              _source: {
                title: id === 1 ? "AI Developer Intern" : `IBM Role ${id}`,
                url: `https://careers.ibm.com/careers/JobDetail?jobId=${id}&source=WEB_Search_NA`,
                description: "Build hybrid cloud and AI products.",
                field_keyword_08: "Software Engineering",
                field_keyword_17: "Hybrid",
                field_keyword_18: "Entry Level",
                field_keyword_19: "SAN JOSE, US",
              },
            };
          }),
        },
      });
    };

    const result = await crawlSource({
      id: "p5-0624-ibm", company: "IBM",
      postingUrl: "https://www.ibm.com/careers/search", adapter: "custom",
    }, fetcher, new Date());

    expect(offsets).toEqual([0, 30]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toHaveLength(31);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "hash-1",
      title: "AI Developer Intern",
      employmentType: "Internship",
      location: "SAN JOSE, US",
      arrangement: "hybrid",
      department: "Software Engineering",
      experienceLevel: "Entry Level",
      officialUrl: "https://careers.ibm.com/en_US/careers/JobDetail?jobId=1",
    }));
  });

  it("reads IBM 2027 detail metadata so co-op roles are not labeled internships", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://www-api.ibm.com/search/api/v2") {
        const body = JSON.parse(String(init?.body)) as { from?: number };
        if ((body.from ?? 0) > 0) return Response.json({ hits: { total: { value: 1 }, hits: [] } });
        return Response.json({ hits: {
          total: { value: 1 },
          hits: [{ _id: "hash-128639", _source: {
            title: "Data Engineer Intern 2027",
            url: "https://careers.ibm.com/en_US/careers/JobDetail?jobId=128639",
            description: "Build data pipelines.",
            field_keyword_19: "Dallas, US",
          } }],
        } });
      }
      expect(url).toBe("https://r.jina.ai/https://careers.ibm.com/en_US/careers/JobDetail?jobId=128639");
      return new Response("Job Title\n\nData Engineer Intern 2027\n\nEmployment type\n\nCo-Op (Fixed Term)\n");
    };

    const result = await crawlSource({
      id: "p5-0624-ibm", company: "IBM",
      postingUrl: "https://www.ibm.com/careers/search", adapter: "custom",
    }, fetcher, new Date());

    expect(result.jobs).toEqual([expect.objectContaining({
      title: "Data Engineer Intern 2027",
      employmentType: "Co-op",
    })]);
  });

  it("checkpoints IBM catalogs that exceed the Worker request budget", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { from?: number };
      const from = body.from ?? 0;
      offsets.push(from);
      return Response.json({ hits: {
        total: { value: 1_230 },
        hits: Array.from({ length: 30 }, (_, index) => {
          const id = from + index + 1;
          return { _id: `hash-${id}`, _source: {
            title: `IBM Role ${id}`,
            url: `https://careers.ibm.com/careers/JobDetail?jobId=${id}`,
          } };
        }),
      } });
    };

    const result = await crawlSource({
      id: "p5-0624-ibm", company: "IBM",
      postingUrl: "https://www.ibm.com/careers/search", adapter: "custom",
      crawlPageCursor: 23,
    }, fetcher, new Date());

    expect(offsets).toEqual([0, ...Array.from({ length: 19 }, (_, index) => 660 + index * 30)]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 41 },
    }));
    expect(result.jobs).toHaveLength(600);
  });

  it("does not advance IBM when a full page partially overlaps or contains unusable jobs", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { from?: number };
      const from = body.from ?? 0;
      return Response.json({ hits: {
        total: { value: 1_230 },
        hits: Array.from({ length: 30 }, (_, index) => {
          const id = from === 660 && index === 0 ? 1 : from + index + 1;
          return { _id: `hash-${id}`, _source: {
            title: from === 660 && index === 1 ? undefined : `IBM Role ${id}`,
            url: `https://careers.ibm.com/careers/JobDetail?jobId=${id}`,
          } };
        }),
      } });
    };
    const result = await crawlSource({
      id: "p5-0624-ibm", company: "IBM",
      postingUrl: "https://www.ibm.com/careers/search", adapter: "custom", crawlPageCursor: 23,
    }, fetcher, new Date());
    expect(result.pagination).toEqual({ nextPage: 23, cycleComplete: false, totalPages: 41 });
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

  it("recognizes rendered ASML, Eightfold, and SuccessFactors job detail routes", async () => {
    const fetcher: typeof fetch = async (input) => String(input).startsWith("https://r.jina.ai/")
      ? new Response([
          "[Machine Learning Intern](https://careers.acme.example/en/careers/find-your-job/machine-learning-intern-j00349553)",
          "[Software Engineer](https://careers.acme.example/careers/job/563121776085295)",
          "[Data Analytics Director](https://careers.acme.example/default/job/Data-Analytics-Director/12804-en_US)",
        ].join("\n"), { status: 200 })
      : new Response("<main>Rendered job search</main>", { status: 200 });

    const result = await crawlSource({
      id: "rendered-detail-routes",
      company: "Acme",
      postingUrl: "https://careers.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Machine Learning Intern",
      "Software Engineer",
      "Data Analytics Director",
    ]);
  });

  it("recognizes rendered DirectEmployers job detail routes", async () => {
    const fetcher: typeof fetch = async (input) => String(input).startsWith("https://r.jina.ai/")
      ? new Response("[Senior Data Engineer](https://aecom.jobs/brisbane-aus/senior-data-engineer/5771DC0FBDBA47DFB2B7099C488139C7/job/)", { status: 200 })
      : new Response("<main>Rendered job search</main>", { status: 200 });

    const result = await crawlSource({
      id: "direct-employers-rendered",
      company: "AECOM",
      postingUrl: "https://aecom.jobs/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Senior Data Engineer"]);
  });

  it("uses the reader on a vetted rendered search page discovered from a careers landing page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.acme.example/careers") {
        return new Response('<a href="/en/careers/find-your-job">Search jobs</a>', { status: 200 });
      }
      if (url === "https://www.acme.example/en/careers/find-your-job") {
        return new Response("<main>Client-rendered results</main>", { status: 200 });
      }
      if (url === "https://r.jina.ai/https://www.acme.example/en/careers/find-your-job") {
        return new Response("[Applied AI Intern](https://www.acme.example/en/careers/find-your-job/applied-ai-intern-j00349553)", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "rendered-search-candidate",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs.map((job) => job.title)).toEqual(["Applied AI Intern"]);
    expect(result.resolvedListingUrl).toBe("https://www.acme.example/en/careers/find-your-job");
    expect(requests).toContain("https://r.jina.ai/https://www.acme.example/en/careers/find-your-job");
  });

  it("follows a vetted all-jobs link discovered from a blocked landing-page reader", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://www.acme.example/careers") return new Response("blocked", { status: 403 });
      if (url === "https://r.jina.ai/https://www.acme.example/careers") {
        return new Response("[View Open Positions](https://jobs.acme.example/jobs/)", { status: 200 });
      }
      if (url === "https://jobs.acme.example/jobs/") return new Response("<main>Rendered jobs</main>", { status: 200 });
      if (url === "https://r.jina.ai/https://jobs.acme.example/jobs/") {
        return new Response("[Applied AI Intern](https://jobs.acme.example/jobs/18099108-applied-ai-intern)", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "blocked-reader-navigation",
      company: "Acme",
      postingUrl: "https://www.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs.map((job) => job.title)).toEqual(["Applied AI Intern"]);
    expect(result.resolvedListingUrl).toBe("https://jobs.acme.example/jobs/");
    expect(requests).toContain("https://r.jina.ai/https://jobs.acme.example/jobs/");
  });

  it("paginates every Northwestern Mutual corporate career page without authorizing stale closure", async () => {
    const requests: string[] = [];
    const page = (pageNumber: number, first: number, last: number, rows: Array<[string, string]>) => [
      `Displaying ${first} to ${last} of 3 matching jobs`,
      ...rows.map(([id, title]) => `[${title}](https://careers.northwesternmutual.com/corporate-careers/${id}/${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}/)`),
      ...(pageNumber === 1 ? ["[2](https://careers.northwesternmutual.com/corporate-careers/?page=2#results)"] : []),
    ].join("\n");
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://r.jina.ai/https://careers.northwesternmutual.com/corporate-careers/") {
        return new Response(page(1, 1, 2, [["jr-45666", "Sr Analytics Engineer"], ["jr-45468", "Investment Accounting Internship"]]), { status: 200 });
      }
      if (url === "https://r.jina.ai/https://careers.northwesternmutual.com/corporate-careers/?page=2") {
        return new Response(page(2, 3, 3, [["jr-45571", "Software Engineer II"]]), { status: 200 });
      }
      return new Response("blocked", { status: 403 });
    };

    const result = await crawlSource({
      id: "northwestern-mutual-reader",
      company: "Northwestern Mutual",
      postingUrl: "https://careers.northwesternmutual.com/corporate-careers/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://r.jina.ai/https://careers.northwesternmutual.com/corporate-careers/",
      "https://r.jina.ai/https://careers.northwesternmutual.com/corporate-careers/?page=2",
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Sr Analytics Engineer",
      "Investment Accounting Internship",
      "Software Engineer II",
    ]);
  });

  it("loads the complete ASML catalog with rich fields from its official search API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://discover-euc1.sitecorecloud.io/discover/v2/126200477") {
        return Response.json({ widgets: [{
          total_item: 2,
          limit: 100,
          offset: 0,
          facet: [{ name: "job_type", label: "Job Type", value: [{ text: "Internship", count: 1 }] }],
          content: [
            {
              id: "J-00349553", job_id: "J-00349553", name: "Applied AI Intern",
              job_location: "San Jose, CA, US", job_city: "San Jose", job_state: "CA", job_country: "US",
              job_type: "Internship", job_teams: ["Data and Analytics"], job_technical_fields: ["Software"],
              job_degrees: ["Master"], job_experience_levels: ["Student"], description: "<p>Build AI systems.</p>",
              job_date_posted: "2026-08-12T00:00:00", url: "https://www.asml.com/en/careers/find-your-job/applied-ai-intern-j00349553",
            },
            {
              id: "J-00349554", job_id: "J-00349554", name: "Software Engineer",
              job_location: "Veldhoven, Netherlands", job_city: "Veldhoven", job_country: "Netherlands",
              job_type: "Fix", job_date_posted: "2026-08-11T00:00:00",
              url: "https://www.asml.com/en/careers/find-your-job/software-engineer-j00349554",
            },
          ],
        }] });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "p5-0550-asml",
      company: "ASML",
      postingUrl: "https://www.asml.com/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual(["https://discover-euc1.sitecorecloud.io/discover/v2/126200477"]);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "J-00349553", title: "Applied AI Intern", employmentType: "Internship",
        location: "San Jose, CA, US", locationCity: "San Jose", locationState: "CA", locationCountry: "US",
        department: "Data and Analytics", jobFunction: "Software", educationRequirements: "Master",
        experienceLevel: "Student", description: "Build AI systems.", publishedAt: "2026-08-12T00:00:00.000Z",
      }),
      expect.objectContaining({ externalId: "J-00349554", title: "Software Engineer", publishedAt: "2026-08-11T00:00:00.000Z" }),
    ]);
    expect(result.facets).toEqual([{ key: "job_type", label: "Job Type", values: [{ key: "Internship", label: "Internship", count: 1 }] }]);
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

  it("supports Talemetry catalogs whose public route is jobs/search", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (!url.startsWith("https://r.jina.ai/")) return new Response("blocked", { status: 403 });
      return new Response(JSON.stringify({
        current_page: 1,
        per_page: 100,
        total_entries: 1,
        entries: [{ id: "101", talemetry_job_id: "101", permalink: "data-intern", title: "Data Intern" }],
      }), { status: 200 });
    };

    const result = await crawlSource({
      id: "talemetry-reversed-route",
      company: "CareFirst",
      postingUrl: "https://carefirstcareers.ttcportals.com/jobs/search/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Intern"]);
    expect(requests).toContain("https://r.jina.ai/https://carefirstcareers.ttcportals.com/jobs/search.json?per_page=100&page=1");
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
        requisitionId: "fraud-7",
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

  it("uses Atlassian's complete public listings endpoint instead of navigation links", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url !== "https://www.atlassian.com/endpoint/careers/listings") {
        return new Response("unexpected", { status: 500 });
      }
      return new Response(JSON.stringify([
        {
          id: 26357,
          title: "Senior Manager, Agentic AI Integrations",
          locations: ["Mountain View or Remote"],
          category: "Engineering",
          overview: "<p>Build integrations.</p>",
          responsibilities: "<p>Lead delivery.</p>",
          qualifications: "<p>AI experience.</p>",
          applyUrl: "https://globalcareers-atlassian.icims.com/jobs/26357/job?mode=apply",
          portalJobPost: {
            portalUrl: "https://globalcareers-atlassian.icims.com/jobs/26357/senior-manager-agentic-ai-integrations/job",
            updatedDate: "2026-08-10 11:37 PM",
          },
        },
        {
          id: 26265,
          title: "Software Engineer",
          locations: ["San Francisco or Remote"],
          category: "Engineering",
          portalJobPost: {
            portalUrl: "https://globalcareers-atlassian.icims.com/jobs/26265/software-engineer/job",
          },
        },
      ]), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "atlassian",
      company: "Atlassian",
      postingUrl: "https://www.atlassian.com/company/careers/all-jobs",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual(["https://www.atlassian.com/endpoint/careers/listings"]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [
        expect.objectContaining({
          externalId: "26357",
          title: "Senior Manager, Agentic AI Integrations",
          location: "Mountain View or Remote",
          department: "Engineering",
          description: "Build integrations.",
          responsibilities: "Lead delivery.",
          qualifications: "AI experience.",
          applyUrl: "https://globalcareers-atlassian.icims.com/jobs/26357/job?mode=apply",
          officialUrl: "https://globalcareers-atlassian.icims.com/jobs/26357/senior-manager-agentic-ai-integrations/job",
          publishedAt: "2026-08-10T23:37:00.000Z",
        }),
        expect.objectContaining({ externalId: "26265", title: "Software Engineer" }),
      ],
    }));
  });

  it("paginates Amazon's public search JSON and retains structured posting fields", async () => {
    const requests: string[] = [];
    const firstJobs = Array.from({ length: 100 }, (_, index) => ({
      id_icims: String(10_000 + index),
      title: `Engineer ${index}`,
      job_path: `/en/jobs/${10_000 + index}/engineer-${index}`,
      location: "US, WA, Seattle",
      normalized_location: "Seattle, Washington, USA",
      city: "Seattle",
      state: "WA",
      country_code: "USA",
      job_schedule_type: "full-time",
      job_category: "Software Development",
      description: "<p>Build systems.</p>",
      basic_qualifications: "<p>Programming experience.</p>",
      url_next_step: `https://account.amazon.jobs/jobs/${10_000 + index}/apply`,
      posted_date: "August 11, 2026",
    }));
    const finalJob = {
      id_icims: "10100",
      title: "Machine Learning Intern",
      job_path: "/en/jobs/10100/machine-learning-intern",
      location: "US, CA, East Palo Alto",
      normalized_location: "East Palo Alto, California, USA",
      city: "East Palo Alto",
      state: "CA",
      country_code: "USA",
      job_schedule_type: "full-time",
      job_category: "Machine Learning Science",
      is_intern: true,
      description_short: "Train models.",
      posted_date: "August 10, 2026",
    };
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return new Response(JSON.stringify({ hits: 101, jobs: offset === 0 ? firstJobs : [finalJob] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await crawlSource({
      id: "amazon-ml",
      company: "Amazon",
      postingUrl: "https://www.amazon.jobs/en/teams/machine-learning",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toHaveLength(2);
    expect(requests.every((url) => url.startsWith("https://www.amazon.jobs/en/search.json?"))).toBe(true);
    expect(requests.every((url) => new URL(url).searchParams.get("base_query") === "machine learning")).toBe(true);
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toHaveLength(101);
    expect(result.jobs.at(-1)).toEqual(expect.objectContaining({
      externalId: "10100",
      title: "Machine Learning Intern",
      employmentType: "Internship",
      department: "Machine Learning Science",
      locationCity: "East Palo Alto",
      locationState: "CA",
      locationCountry: "USA",
      officialUrl: "https://www.amazon.jobs/en/jobs/10100/machine-learning-intern",
      publishedAt: "2026-08-10T00:00:00.000Z",
    }));
  });

  it("checkpoints Amazon's large global catalog instead of retaining every rich page", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset") ?? 0);
      offsets.push(offset);
      const count = offset === 2_200 ? 30 : 100;
      return Response.json({
        hits: 2_230,
        jobs: Array.from({ length: count }, (_, index) => ({
          id_icims: String(offset + index),
          title: `Amazon Role ${offset + index}`,
          job_path: `/en/jobs/${offset + index}/amazon-role-${offset + index}`,
        })),
      });
    };

    const result = await crawlSource({
      id: "p4-0394-amazon",
      company: "Amazon / AWS",
      postingUrl: "https://www.amazon.jobs/en/",
      adapter: "custom",
      crawlPageCursor: 21,
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(offsets).toEqual([0, 2_000, 2_100, 2_200]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 23 },
    }));
    expect(result.jobs).toHaveLength(330);
  });

  it("does not advance Amazon's checkpoint when the search endpoint repeats a page", async () => {
    const jobs = Array.from({ length: 100 }, (_, index) => ({
      id_icims: String(index + 1), title: `Amazon Role ${index + 1}`,
      job_path: `/en/jobs/${index + 1}/amazon-role-${index + 1}`,
    }));
    const fetcher: typeof fetch = async () => Response.json({ hits: 2_230, jobs });
    const result = await crawlSource({
      id: "p4-0394-amazon", company: "Amazon / AWS",
      postingUrl: "https://www.amazon.jobs/en/", adapter: "custom", crawlPageCursor: 21,
    }, fetcher, new Date());
    expect(result.pagination).toEqual({ nextPage: 21, cycleComplete: false, totalPages: 23 });
    expect(result.jobs).toHaveLength(100);
  });

  it("checkpoints TikTok's official catalog and retains role, program, location, and apply fields", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(url).toBe("https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("website-path")).toBe("tiktok");
      const request = JSON.parse(String(init?.body)) as { offset: number };
      offsets.push(request.offset);
      const count = request.offset === 500 ? 30 : 100;
      return Response.json({
        code: 0,
        data: {
          count: 530,
          job_post_list: Array.from({ length: count }, (_, index) => {
            const id = String(request.offset + index + 1);
            return {
              id,
              code: `A${id}`,
              title: index === 0 ? "Machine Learning Engineer Intern" : `TikTok Role ${id}`,
              description: "Build recommendation models.",
              requirement: "Python and SQL.",
              recruit_type: { en_name: index === 0 ? "Intern" : "Regular" },
              job_category: { en_name: "R&D" },
              city_info: {
                en_name: "San Jose",
                parent: { en_name: "California", parent: { code: "CN_6", en_name: "United States of America" } },
              },
              job_post_info: { min_salary: 35, max_salary: 45, currency: "USD" },
            };
          }),
        },
      });
    };

    const result = await crawlSource({
      id: "p5-0752-tiktok",
      company: "TikTok / ByteDance",
      postingUrl: "https://lifeattiktok.com/search",
      adapter: "custom",
      crawlPageCursor: 4,
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(offsets).toEqual([0, 300, 400, 500]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 6 },
    }));
    expect(result.jobs).toHaveLength(330);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "1",
      title: "Machine Learning Engineer Intern",
      employmentType: "Internship",
      department: "R&D",
      location: "San Jose, California, United States of America",
      locationCity: "San Jose",
      locationState: "California",
      locationCountry: "United States of America",
      salaryMin: 35,
      salaryMax: 45,
      salaryCurrency: "USD",
      requisitionId: "A1",
      applyUrl: "https://careers.tiktok.com/resume/1/apply",
      officialUrl: "https://lifeattiktok.com/search/1",
    }));
  });

  it("does not advance TikTok's checkpoint when its public API repeats a page", async () => {
    const jobs = Array.from({ length: 100 }, (_, index) => ({
      id: String(index + 1), code: `A${index + 1}`, title: `TikTok Role ${index + 1}`,
    }));
    const fetcher: typeof fetch = async () => Response.json({ code: 0, data: { count: 530, job_post_list: jobs } });
    const result = await crawlSource({
      id: "p5-0752-tiktok", company: "TikTok / ByteDance",
      postingUrl: "https://lifeattiktok.com/search", adapter: "custom", crawlPageCursor: 4,
    }, fetcher, new Date());
    expect(result.pagination).toEqual({ nextPage: 4, cycleComplete: false, totalPages: 6 });
    expect(result.jobs).toHaveLength(100);
  });

  it("paginates ServiceNow reader pages when the request surface is blocked", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.servicenow.com/sitemap.xml") return new Response("missing", { status: 404 });
      if (url === "https://careers.servicenow.com/jobs/") return new Response("blocked", { status: 403 });
      if (url === "https://r.jina.ai/https://careers.servicenow.com/jobs/") return new Response(`
        [Senior Software Engineer](https://careers.servicenow.com/jobs/744000142970949/senior-software-engineer/)
        [Data Scientist](https://careers.servicenow.com/jobs/744000142970950/data-scientist/)
        [2](https://careers.servicenow.com/jobs/?page=2#results)
      `, { status: 200 });
      if (url === "https://r.jina.ai/https://careers.servicenow.com/jobs/?page=2") return new Response(`
        [Machine Learning Engineer](https://careers.servicenow.com/jobs/744000142970951/machine-learning-engineer/)
      `, { status: 200 });
      return new Response("unexpected", { status: 500 });
    };

    const result = await crawlSource({
      id: "servicenow",
      company: "ServiceNow",
      postingUrl: "https://careers.servicenow.com/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual([
      "https://careers.servicenow.com/sitemap.xml",
      "https://careers.servicenow.com/jobs/",
      "https://r.jina.ai/https://careers.servicenow.com/jobs/",
      "https://r.jina.ai/https://careers.servicenow.com/jobs/?page=2",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
    }));
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Senior Software Engineer",
      "Data Scientist",
      "Machine Learning Engineer",
    ]);
  });

  it("uses ServiceNow's complete public sitemap before its Cloudflare-protected page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(`<?xml version="1.0"?><urlset>
        <url><loc>https://careers.servicenow.com/jobs/744000137509420/forward-deployed-solution-engineer-applied-ai-fde/</loc><lastmod>2026-08-10T07:17:06.149Z</lastmod></url>
        <url><loc>https://careers.servicenow.com/jobs/744000136060020/solution-architect-ai-data/</loc><lastmod>2026-08-09T07:17:06.149Z</lastmod></url>
      </urlset>`, { status: 200, headers: { "content-type": "application/xml" } });
    };

    const result = await crawlSource({
      id: "servicenow",
      company: "ServiceNow",
      postingUrl: "https://careers.servicenow.com/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual(["https://careers.servicenow.com/sitemap.xml"]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "744000137509420",
        title: "Forward Deployed Solution Engineer Applied AI FDE",
        officialUrl: "https://careers.servicenow.com/jobs/744000137509420/forward-deployed-solution-engineer-applied-ai-fde/",
        publishedAt: "2026-08-10T07:17:06.149Z",
      }),
      expect.objectContaining({ externalId: "744000136060020", title: "Solution Architect AI Data" }),
    ]);
  });

  it("uses Verizon's public job sitemap instead of its Cloudflare-protected page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(`<?xml version="1.0"?><urlset>
        <url><loc>https://mycareer.verizon.com/jobs/r-1097588/business-sales-account-manager/</loc><lastModified>2026-08-10T07:17:06.149Z</lastModified></url>
        <url><loc>https://mycareer.verizon.com/jobs/r-1083830/software-engineering-intern/</loc><lastModified>2026-08-11T07:17:06.050Z</lastModified></url>
      </urlset>`, { status: 200, headers: { "content-type": "application/xml" } });
    };

    const result = await crawlSource({
      id: "verizon",
      company: "Verizon",
      postingUrl: "https://mycareer.verizon.com/jobs/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual(["https://mycareer.verizon.com/en/jobs/sitemap.xml"]);
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({ externalId: "r-1097588", title: "Business Sales Account Manager" }),
      expect.objectContaining({
        externalId: "r-1083830",
        title: "Software Engineering Intern",
        employmentType: "Internship",
        publishedAt: "2026-08-11T07:17:06.050Z",
      }),
    ]);
  });

  it("uses Nutanix's localized public sitemap instead of its protected jobs page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return new Response(`<urlset>
        <url><loc>https://careers.nutanix.com/en/jobs/30320/staff-engineer-linux-kernel-developer/</loc><lastmod>2026-08-11</lastmod></url>
        <url><loc>https://careers.nutanix.com/en/jobs/31130/machine-learning-intern/</loc><lastmod>2026-08-12</lastmod></url>
      </urlset>`, { status: 200 });
    };

    const result = await crawlSource({
      id: "nutanix-sitemap",
      company: "Nutanix",
      postingUrl: "https://careers.nutanix.com/en/jobs/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual(["https://careers.nutanix.com/sitemap.xml"]);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([
      expect.objectContaining({ externalId: "30320", title: "Staff Engineer Linux Kernel Developer" }),
      expect.objectContaining({ externalId: "31130", title: "Machine Learning Intern", employmentType: "Internship" }),
    ]);
  });

  it("redirects a Phenom talent-community source to its public search results", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(`<script>phApp.ddo = ${JSON.stringify({
        eagerLoadRefineSearch: {
          hits: 1,
          totalHits: 1,
          data: { jobs: [{ jobId: "123", title: "Data Science Intern", applyUrl: "https://jobs.cvshealth.com/us/en/job/123/data-science-intern" }] },
        },
      })};</script>`, { status: 200 });
    };

    const result = await crawlSource({
      id: "cvs",
      company: "Aetna / CVS Health",
      postingUrl: "https://jobs.cvshealth.com/us/en/jointalentcommunity",
      adapter: "phenom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual(["https://jobs.cvshealth.com/us/en/search-results"]);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Science Intern"]);
  });

  it("redirects a Phenom careers root to its public search results", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(`<script>phApp.ddo = ${JSON.stringify({
        eagerLoadRefineSearch: {
          hits: 1,
          totalHits: 1,
          data: { jobs: [{ jobId: "snow-1", title: "Data Engineer", applyUrl: "https://careers.snowflake.com/us/en/job/snow-1/data-engineer" }] },
        },
      })};</script>`, { status: 200 });
    };

    const result = await crawlSource({
      id: "snowflake",
      company: "Snowflake",
      postingUrl: "https://careers.snowflake.com/us/en",
      adapter: "phenom",
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(requests).toEqual(["https://careers.snowflake.com/us/en/search-results"]);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Engineer"]);
  });

  it("recognizes a Phenom landing page even when the catalog adapter is stale", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.acme.example/us/en") {
        return new Response('<script src="https://assets.phenompeople.com/app.js"></script>', { status: 200 });
      }
      if (url === "https://careers.acme.example/us/en/search-results") {
        return new Response(`<script>phApp.ddo = ${JSON.stringify({
          eagerLoadRefineSearch: {
            hits: 1,
            totalHits: 1,
            data: { jobs: [{ jobId: "acme-1", title: "AI Intern", applyUrl: "https://careers.acme.example/us/en/job/acme-1/ai-intern" }] },
          },
        })};</script>`, { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "stale-phenom-adapter",
      company: "Acme",
      postingUrl: "https://careers.acme.example/us/en",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T12:00:00Z"));

    expect(requests.slice(0, 2)).toEqual([
      "https://careers.acme.example/us/en",
      "https://careers.acme.example/us/en/search-results",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      resolvedListingUrl: "https://careers.acme.example/us/en/search-results",
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["AI Intern"]);
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

  it("checkpoints very large Oracle catalogs within the 50-request source budget", async () => {
    const total = 2_334;
    const run = async (crawlPageCursor?: number) => {
      const offsets: number[] = [];
      const fetcher: typeof fetch = async (input) => {
        const url = String(input);
        if (url === "https://careers.acme.example/en/sites/CX/jobs") {
          return new Response('<script src="https://acme.fa.us2.oraclecloud.com/hcmUI/app.js"></script>', { status: 200 });
        }
        const finder = new URL(url).searchParams.get("finder") ?? "";
        const offset = Number(finder.match(/offset=(\d+)/)?.[1] ?? 0);
        offsets.push(offset);
        const requisitionList = Array.from({ length: Math.min(25, total - offset) }, (_, index) => ({
          Id: offset + index + 1,
          Title: `Role ${offset + index + 1}`,
        }));
        return Response.json({ items: [{ TotalJobsCount: total, requisitionList }] });
      };
      const result = await crawlSource({
        id: "oracle-huge", company: "Acme", postingUrl: "https://careers.acme.example/en/sites/CX/jobs",
        adapter: "custom", ...(crawlPageCursor ? { crawlPageCursor } : {}),
      }, fetcher, new Date());
      return { result, offsets };
    };

    const first = await run();
    expect(first.offsets).toHaveLength(49);
    expect(first.offsets.at(0)).toBe(0);
    expect(first.offsets.at(-1)).toBe(1_200);
    expect(first.result).toEqual(expect.objectContaining({
      status: "succeeded", completeListing: false,
      pagination: { nextPage: 50, cycleComplete: false, totalPages: 94 },
    }));
    expect(first.result.jobs).toHaveLength(1_225);

    const second = await run(50);
    expect(second.offsets).toHaveLength(45);
    expect(second.offsets.at(0)).toBe(1_225);
    expect(second.offsets.at(-1)).toBe(2_325);
    expect(second.result).toEqual(expect.objectContaining({
      status: "succeeded", completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 94 },
    }));
    expect(second.result.jobs).toHaveLength(1_109);
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

  it("combines Houlihan Lokey's three official Workday catalogs", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const board = url.match(/\/wday\/cxs\/hl\/([^/]+)\/jobs/)?.[1];
      return Response.json({
        total: 1,
        jobPostings: [{
          title: `${board} Analyst`,
          externalPath: `/job/New-York/${board}-Analyst_${board}-1`,
          locationsText: "New York, NY",
        }],
      });
    };

    const result = await crawlSource({
      id: "p4-0291-houlihan-lokey",
      company: "Houlihan Lokey",
      postingUrl: "https://hl.com/careers/",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(requests.sort()).toEqual([
      "https://hl.wd1.myworkdayjobs.com/wday/cxs/hl/Campus/jobs",
      "https://hl.wd1.myworkdayjobs.com/wday/cxs/hl/Corporate/jobs",
      "https://hl.wd1.myworkdayjobs.com/wday/cxs/hl/Lateral/jobs",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
    }));
    expect(result.jobs.map((job) => job.title).sort()).toEqual([
      "Campus Analyst",
      "Corporate Analyst",
      "Lateral Analyst",
    ]);
  });

  it("checkpoints Infosys' official USA catalog and parses exact listing-card fields", async () => {
    const requestedPages: number[] = [];
    const total = 525;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? 1);
      requestedPages.push(page);
      const start = (page - 1) * 25;
      const count = Math.min(25, total - start);
      const cards = Array.from({ length: count }, (_, index) => {
        const id = `${start + index + 1}BR`;
        return `<a href="https://digitalcareers.infosys.com/global-careers/company-job/description/reqid/${id}" class="job"><div class="job-title" data-title="Data Engineer ${id}">Data Engineer ${id}</div><div class="job-location"><div class="location-inline">Austin, TX</div><div class="location-inline">-</div><div class="location-inline">USA</div></div><div class="job-description js-job-reqid"><div class="location-inline">${id}</div></div></a>`;
      }).join("");
      return new Response(`<p>Showing ${start + 1} to ${start + count} of ${total} matching jobs</p>${cards}`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p4-0296-infosys-consulting",
      company: "Infosys Consulting",
      postingUrl: "https://digitalcareers.infosys.com/infosys/global-careers?location=USA",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(requestedPages.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 20, cycleComplete: false, totalPages: 21 },
    }));
    expect(result.jobs).toHaveLength(500);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "1BR",
      title: "Data Engineer 1BR",
      location: "Austin, TX",
      locationCountry: "United States",
      requisitionId: "1BR",
    }));
  });

  it("uses HubSpot's official GraphQL catalog instead of careers blog articles", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json({ data: { jobs: [
        { id: 1001, title: "Software Engineer Intern", department: { name: "Product, UX & Engineering" }, office: { location: "Remote - USA" }, location: { name: "Remote - USA" } },
        { id: 1002, title: "Account Executive", department: { name: "Sales" }, office: { location: "Dublin, Ireland" }, location: { name: "Dublin, Ireland" } },
      ] } });
    };

    const result = await crawlSource({
      id: "p4-0443-hubspot",
      company: "HubSpot",
      postingUrl: "https://www.hubspot.com/careers/jobs/all",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://wtcfns.hubspot.com/careers/graphql");
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [
        expect.objectContaining({
          externalId: "1001",
          title: "Software Engineer Intern",
          employmentType: "Internship",
          locationCountry: "United States",
          officialUrl: "https://www.hubspot.com/careers/jobs/1001",
        }),
        expect.objectContaining({ externalId: "1002", title: "Account Executive" }),
      ],
    }));
  });

  it("checkpoints Performance Food Group's full official BrassRing catalog", async () => {
    const total = 1_051;
    const pages: number[] = [];
    const job = (index: number) => ({ Questions: [
      { QuestionName: "reqid", Value: String(900_000 + index) },
      { QuestionName: "jobtitle", Value: `Warehouse Engineer ${index}` },
      { QuestionName: "formtext5", Value: "Richmond, Virginia (VA)" },
      { QuestionName: "formtext6", Value: "Performance Foodservice" },
      { QuestionName: "lastupdated", Value: "12-Aug-2026" },
      { QuestionName: "jobdescription", Value: `<p>Official job description ${index}</p>` },
    ] });
    const payload = (page: number) => ({
      JobsCount: total,
      Jobs: { Job: Array.from({ length: Math.min(50, total - (page - 1) * 50) }, (_, offset) => job((page - 1) * 50 + offset + 1)) },
    });
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/Home")) {
        pages.push(0);
        return new Response(`<input id="CookieValue" value="encrypted"><input name="__RequestVerificationToken" value="token">`, {
          status: 200,
          headers: { "set-cookie": "session=abc; Path=/; HttpOnly" },
        });
      }
      if (url.pathname.endsWith("/CBMatchedJobs")) {
        pages.push(1);
        return Response.json(payload(1));
      }
      const page = Number((JSON.parse(String(init?.body)) as { pageNumber: number }).pageNumber);
      pages.push(page);
      return Response.json(payload(page));
    };

    const result = await crawlSource({
      id: "legacy-row-849",
      company: "Performance Food Group",
      postingUrl: "https://sjobs.brassring.com/TGnewUI/Search/Home/Home?partnerid=26350&siteid=6930",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(pages).toEqual([0, 1, ...Array.from({ length: 18 }, (_, index) => index + 1)]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 18, cycleComplete: false, totalPages: 22 },
    }));
    expect(result.jobs).toHaveLength(900);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "900001",
      title: "Warehouse Engineer 1",
      location: "Richmond, Virginia (VA)",
      businessUnit: "Performance Foodservice",
      publishedAt: "2026-08-12T07:00:00.000Z",
    }));
  });

  it("preserves a direct Workday URL search query when crawling a subsidiary catalog", async () => {
    const requestBodies: Array<{ searchText?: string }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { searchText?: string });
      return Response.json({
        total: 1,
        jobPostings: [{
          title: "Verafin - Cloud Security Developer",
          externalPath: "/job/St-Johns/Verafin---Cloud-Security-Developer_R-100",
          locationsText: "St. John's, NL",
        }],
      });
    };

    const result = await crawlSource({
      id: "verafin",
      company: "Verafin",
      postingUrl: "https://nasdaq.wd1.myworkdayjobs.com/Global_External_Site?q=verafin",
      adapter: "workday",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(requestBodies).toEqual([{ appliedFacets: {}, limit: 20, offset: 0, searchText: "verafin" }]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      jobs: [expect.objectContaining({ title: "Verafin - Cloud Security Developer" })],
    }));
  });

  it("checkpoints any large Workday catalog within twenty public API requests", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const { offset } = JSON.parse(String(init?.body)) as { offset: number };
      offsets.push(offset);
      const count = Math.min(20, 1_109 - offset);
      return Response.json({
        total: 1_109,
        jobPostings: Array.from({ length: count }, (_, index) => ({
          title: `Medtronic Role ${offset + index}`,
          externalPath: `/job/Minneapolis-MN/Medtronic-Role-${offset + index}_R-${offset + index}`,
          locationsText: "Minneapolis, MN",
        })),
      });
    };

    const result = await crawlSource({
      id: "p5-0665-medtronic",
      company: "Medtronic",
      postingUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers",
      adapter: "workday",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(offsets).toEqual(Array.from({ length: 20 }, (_, index) => index * 20));
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 20, cycleComplete: false, totalPages: 56 },
    }));
    expect(result.jobs).toHaveLength(400);
  });

  it("uses Cisco's official Workday catalog and checkpoints it within the request budget", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://cisco.wd5.myworkdayjobs.com/wday/cxs/cisco/Cisco_Careers/jobs");
      const body = JSON.parse(String(init?.body)) as { offset: number };
      offsets.push(body.offset);
      const count = Math.min(20, 1_142 - body.offset);
      return Response.json({
        total: 1_142,
        jobPostings: Array.from({ length: count }, (_, index) => {
          const id = body.offset + index;
          return {
            title: `Cisco Role ${id}`,
            externalPath: `/job/San-Jose-California-US/Cisco-Role-${id}_${id}`,
            locationsText: "San Jose, California, US",
            postedOn: "Posted Today",
          };
        }),
      });
    };

    const result = await crawlSource({
      id: "p4-0245-cisco",
      company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results",
      adapter: "phenom",
      crawlPageCursor: 41,
    }, fetcher, new Date("2026-08-11T12:00:00Z"));

    expect(offsets).toEqual([0, ...Array.from({ length: 18 }, (_, index) => 800 + index * 20)]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 58 },
    }));
    expect(result.jobs).toHaveLength(362);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Cisco Role 0",
      officialUrl: "https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/San-Jose-California-US/Cisco-Role-0_0",
    }));
  });

  it("never treats an empty Cisco Workday response as an authoritative zero-job catalog", async () => {
    const result = await crawlSource({
      id: "p4-0245-cisco",
      company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results",
      adapter: "phenom",
    }, async () => Response.json({ total: 0, jobPostings: [] }), new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      responseStatus: 200,
      completeListing: false,
      jobs: [],
    }));
    expect(result.pagination).toBeUndefined();
  });

  it("does not advance Cisco when a Workday page contains unusable cards", async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      const { offset } = JSON.parse(String(init?.body)) as { offset: number };
      const count = Math.min(20, 1_142 - offset);
      return Response.json({
        total: 1_142,
        jobPostings: Array.from({ length: count }, (_, index) => ({
          ...(offset === 800 && index === 0 ? {} : { title: `Cisco Role ${offset + index}` }),
          externalPath: `/job/Cisco-Role-${offset + index}_${offset + index}`,
        })),
      });
    };

    const result = await crawlSource({
      id: "p4-0245-cisco", company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results", adapter: "phenom",
      crawlPageCursor: 41,
    }, fetcher, new Date());

    expect(result.pagination).toEqual({ nextPage: 41, cycleComplete: false, totalPages: 58 });
  });

  it("keeps Cisco within the request budget by disabling per-page automatic retries", async () => {
    let calls = 0;
    const result = await crawlSource({
      id: "p4-0245-cisco", company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results", adapter: "phenom",
    }, async () => {
      calls += 1;
      return new Response("temporary", { status: 503 });
    }, new Date());

    expect(calls).toBe(1);
    expect(result).toEqual(expect.objectContaining({ status: "failed", responseStatus: 503 }));
  });

  it("bounds the Aetna source to Aetna matches instead of crawling every CVS retail role", async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({
        total: 1,
        jobPostings: [{
          title: "Data Science Analyst, Aetna",
          externalPath: "/job/Hartford-CT/Data-Science-Analyst_R100",
          locationsText: "Hartford, CT",
          postedOn: "Posted Today",
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({
      id: "p5-0532-aetna",
      company: "Aetna / CVS Health",
      postingUrl: "https://cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers",
      adapter: "workday",
    }, fetcher, new Date("2026-08-11T21:00:00Z"));

    expect(bodies).toEqual([JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Aetna" })]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs[0]).toEqual(expect.objectContaining({ title: "Data Science Analyst, Aetna" }));
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
        {"title":"Data Science Intern","jobId":"R43","jobSeqNo":"ACME43EXTERNALENUS","location":"New York, United States","workplaceType":"Hybrid","postedDate":"2026-08-09T00:00:00.000+0000"},
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
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "R42",
        title: "AI Engineer",
        arrangement: "remote",
        officialUrl: "https://jobs.example/apply/R42",
      }), expect.objectContaining({
        externalId: "R43",
        title: "Data Science Intern",
        arrangement: "hybrid",
        officialUrl: "https://careers.example/job/R43/data-science-intern",
      })],
    }));
  });

  it("enriches program-like Phenom listings from their official Workday detail endpoint", async () => {
    const calls: string[] = [];
    const officialUrl = "https://motorolasolutions.wd5.myworkdayjobs.com/Careers/job/Chicago-IL/Supply-Chain-Applied-AI-Engineering-Intern_R67461/apply";
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
    expect(calls.some((url) => url.includes("/wday/cxs/") && url.endsWith("/apply"))).toBe(false);
  });

  it("enriches a program job from a first-party vanity detail page without replacing its canonical URL", async () => {
    const jobUrl = "https://jobs.citi.com/job/new-york/services-summer-analyst-program-new-york-city-us-2027/287/93724104768";
    const workdayApply = "https://citi.wd5.myworkdayjobs.com/2/job/New-York-New-York-United-States/Services---Summer-Analyst-Program--New-York-City---US--2027_26945311/apply";
    const title = "Services - Summer Analyst Program, New York City - US, 2027";
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === jobUrl) {
        return new Response(`
          <script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org", "@type": "JobPosting", title,
            url: jobUrl, identifier: "26945311", datePosted: "2026-04-08",
            employmentType: "Apprentice", description: "A".repeat(500),
            jobLocation: { address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
          })}</script>
          <a href="${workdayApply}">Apply now</a>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { data: { totalHits: 1, jobs: [{
        title, jobId: "26945311", applyUrl: jobUrl,
      }] } } })};</script>`, { status: 200 });
    };

    const result = await crawlSource({
      id: "p2-0032-citi", company: "Citi",
      postingUrl: "https://jobs.citi.com/search-jobs", adapter: "custom",
    }, fetcher, new Date("2026-08-14T08:00:00Z"));

    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "26945311",
      officialUrl: jobUrl,
      applyUrl: workdayApply,
      requisitionId: "26945311",
      location: "New York, NY, US",
      locationCity: "New York",
      locationState: "NY",
      locationCountry: "US",
      employmentType: "Internship; Apprenticeship",
      publishedAt: "2026-04-08T00:00:00.000Z",
      description: "A".repeat(500),
    })]);
  });

  it("rotates a bounded Workday detail enrichment window instead of blocking the listing crawl", async () => {
    const detailCalls: string[] = [];
    const jobs = Array.from({ length: 20 }, (_, index) => ({
      title: `Applied AI Engineering Intern ${index}`,
      jobId: `R${index}`,
      location: "Chicago, IL",
      type: "Internship",
      applyUrl: `https://acme.wd5.myworkdayjobs.com/Careers/job/Chicago-IL/Applied-AI-Engineering-Intern-${index}_R${index}`,
    }));
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/wday/cxs/")) {
        detailCalls.push(url);
        return Response.json({ jobPostingInfo: { timeType: "Full time", jobDescription: "Build AI systems." } });
      }
      return new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { data: { totalHits: jobs.length, jobs } } })};</script>`);
    };

    const result = await crawlSource({
      id: "bounded-workday-details",
      company: "Acme",
      postingUrl: "https://careers.example/search-results",
      adapter: "phenom",
    }, fetcher, new Date("2026-08-12T12:00:00Z"));

    expect(result.status).toBe("succeeded");
    expect(result.jobs).toHaveLength(20);
    expect(detailCalls).toHaveLength(8);
    expect(result.jobs.filter((job) => job.description === "Build AI systems.")).toHaveLength(8);
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

  it("checkpoints Phenom catalogs that exceed the Worker request budget", async () => {
    const offsets: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const from = Number(new URL(String(input)).searchParams.get("from") ?? 0);
      offsets.push(from);
      const count = from === 540 ? 10 : 10;
      const jobs = Array.from({ length: count }, (_, index) => ({
        title: `Cisco Role ${from + index}`,
        jobId: `R${from + index}`,
        applyUrl: `https://jobs.example/R${from + index}`,
      }));
      return new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: {
        hits: jobs.length, totalHits: 550, data: { jobs },
      } })};</script>`);
    };

    const result = await crawlSource({
      id: "checkpointed-phenom",
      company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results",
      adapter: "phenom",
      crawlPageCursor: 41,
    }, fetcher, new Date());

    expect(offsets).toEqual([0, ...Array.from({ length: 15 }, (_, index) => 400 + index * 10)]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 55 },
    }));
    expect(result.jobs).toHaveLength(160);
  });

  it("does not advance a checkpointed Phenom cycle when the first or later page repeats", async () => {
    const jobs = Array.from({ length: 10 }, (_, index) => ({
      title: `Repeated Role ${index}`, jobId: `R${index}`, applyUrl: `https://jobs.example/R${index}`,
    }));
    const fetcher: typeof fetch = async () => new Response(
      `<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { hits: 10, totalHits: 550, data: { jobs } } })};</script>`,
    );

    const result = await crawlSource({
      id: "checkpointed-phenom", company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results", adapter: "phenom",
      crawlPageCursor: 41,
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      completeListing: false,
      pagination: { nextPage: 41, cycleComplete: false, totalPages: 55 },
    }));
    expect(result.jobs).toHaveLength(10);
  });

  it("keeps a checkpointed Phenom cycle at page one when the first page is malformed", async () => {
    const fetcher: typeof fetch = async (input) => {
      const from = Number(new URL(String(input)).searchParams.get("from") ?? 0);
      const count = from === 0 ? 9 : 10;
      const jobs = Array.from({ length: count }, (_, index) => ({
        title: `Role ${from + index}`, jobId: `R${from + index}`, applyUrl: `https://jobs.example/R${from + index}`,
      }));
      return new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: {
        hits: 10, totalHits: 550, data: { jobs },
      } })};</script>`);
    };
    const result = await crawlSource({
      id: "checkpointed-phenom", company: "Cisco",
      postingUrl: "https://careers.cisco.com/global/en/search-results", adapter: "phenom",
      crawlPageCursor: 41,
    }, fetcher, new Date());
    expect(result.pagination).toEqual({ nextPage: 1, cycleComplete: false, totalPages: 55 });
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

  it("checkpoints large Eightfold tenants without exceeding the Worker request budget", async () => {
    const starts: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/pcsx/search");
      const start = Number(url.searchParams.get("start") ?? 0);
      starts.push(start);
      const count = start === 1_880 ? 4 : 10;
      return Response.json({ data: {
        count: 1_884,
        positions: Array.from({ length: count }, (_, index) => ({
          id: start + index + 1,
          name: `Qualcomm Role ${start + index + 1}`,
          location: "San Diego, California",
          displayJobId: `REQ-${start + index + 1}`,
          positionUrl: `/careers/job/${start + index + 1}`,
        })),
      } });
    };

    const result = await crawlSource({
      id: "p5-0709-qualcomm",
      company: "Qualcomm",
      postingUrl: "https://careers.qualcomm.com/careers?domain=qualcomm.com",
      adapter: "custom",
      crawlPageCursor: 171,
    }, fetcher, new Date());

    expect(starts).toEqual([0, ...Array.from({ length: 19 }, (_, index) => 1_700 + index * 10)]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 189 },
    }));
    expect(result.jobs).toHaveLength(194);
  });

  it("does not advance a checkpointed Eightfold cycle when full pages repeat", async () => {
    const fetcher: typeof fetch = async (input) => {
      const start = Number(new URL(String(input)).searchParams.get("start") ?? 0);
      return Response.json({ data: {
        count: 410,
        positions: Array.from({ length: 10 }, (_, index) => {
          const id = start === 220 && index === 0 ? 1 : start + index + 1;
          return { id, name: `Role ${id}`, positionUrl: `/careers/job/${id}` };
        }),
      } });
    };

    const result = await crawlSource({
      id: "p5-0709-qualcomm", company: "Qualcomm",
      postingUrl: "https://careers.qualcomm.com/careers?domain=qualcomm.com", adapter: "custom",
      crawlPageCursor: 23,
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      completeListing: false,
      pagination: { nextPage: 23, cycleComplete: false, totalPages: 41 },
    }));
    expect(result.jobs.length).toBeGreaterThan(10);
  });

  it("keeps a checkpointed Eightfold cycle at page one when its first page is malformed", async () => {
    const fetcher: typeof fetch = async (input) => {
      const start = Number(new URL(String(input)).searchParams.get("start") ?? 0);
      return Response.json({ data: {
        count: 410,
        positions: Array.from({ length: 10 }, (_, index) => ({
          id: start + index + 1,
          name: start === 0 && index === 9 ? undefined : `Role ${start + index + 1}`,
          positionUrl: `/careers/job/${start + index + 1}`,
        })),
      } });
    };
    const result = await crawlSource({
      id: "p5-0709-qualcomm", company: "Qualcomm",
      postingUrl: "https://careers.qualcomm.com/careers?domain=qualcomm.com", adapter: "custom",
      crawlPageCursor: 23,
    }, fetcher, new Date());
    expect(result.pagination).toEqual({ nextPage: 1, cycleComplete: false, totalPages: 41 });
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

  it("loads a Workable board through its public jobs API", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({
        total: 1,
        results: [{
          id: 101,
          shortcode: "ABC123",
          title: "Applied AI Intern",
          remote: true,
          location: { city: "New York", region: "New York", country: "United States", countryCode: "US" },
          locations: [{ city: "New York", region: "New York", country: "United States", countryCode: "US" }],
          published: "2026-08-12T00:00:00.000Z",
          type: "intern",
          department: ["Engineering"],
          workplace: "remote",
        }],
      });
    };

    const result = await crawlSource({
      id: "workable-public",
      company: "Acme",
      postingUrl: "https://apply.workable.com/acme/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([{ url: "https://apply.workable.com/api/v3/accounts/acme/jobs", body: {} }]);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "101", title: "Applied AI Intern", location: "New York, New York, United States",
      locationCity: "New York", locationState: "New York", locationCountry: "United States",
      arrangement: "remote", employmentType: "Internship", department: "Engineering",
      officialUrl: "https://apply.workable.com/acme/j/ABC123/", publishedAt: "2026-08-12T00:00:00.000Z",
    })]);
  });

  it("follows an official careers redirect to a Workable board", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://huggingface.co/careers") {
        const response = new Response("<main>Workable</main>", { status: 200 });
        Object.defineProperty(response, "url", { value: "https://apply.workable.com/huggingface/" });
        return response;
      }
      if (url === "https://apply.workable.com/api/v3/accounts/huggingface/jobs") {
        expect(init?.method).toBe("POST");
        return Response.json({ total: 1, results: [{
          id: 101,
          shortcode: "ABC123",
          title: "Machine Learning Engineer",
          url: "https://apply.workable.com/huggingface/j/ABC123/",
          location: { location_str: "Remote" },
        }] });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "workable-redirect",
      company: "Hugging Face",
      postingUrl: "https://huggingface.co/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["Machine Learning Engineer"]);
    expect(result.resolvedListingUrl).toBe("https://apply.workable.com/huggingface/");
  });

  it("loads every BambooHR job from the tenant JSON catalog discovered on a careers page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://acme.example/careers") {
        return new Response('<script src="https://acme.bamboohr.com/js/embed.js"></script>', { status: 200 });
      }
      if (url === "https://acme.bamboohr.com/careers/list") {
        return Response.json({
          meta: { totalCount: 1 },
          result: [{
            id: "42",
            jobOpeningName: "Applied AI Intern",
            departmentLabel: "Software",
            employmentStatusLabel: "Intern-Regular",
            atsLocation: { city: "Boston", state: "Massachusetts", country: "United States" },
            isRemote: false,
          }],
        });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "bamboo-public",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T00:00:00Z"));

    expect(requests).toEqual([
      "https://acme.example/careers",
      "https://acme.bamboohr.com/careers/list",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://acme.bamboohr.com/careers",
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "42",
      title: "Applied AI Intern",
      location: "Boston, Massachusetts, United States",
      locationCity: "Boston",
      locationState: "Massachusetts",
      locationCountry: "United States",
      employmentType: "Internship",
      department: "Software",
      officialUrl: "https://acme.bamboohr.com/careers/42",
    })]);
  });

  it("loads a complete Pinpoint tenant catalog discovered from an official careers page", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://acme.example/careers") {
        return new Response('<a href="https://acme.pinpointhq.com/">Open jobs</a>');
      }
      if (url === "https://acme.pinpointhq.com/postings.json") {
        return Response.json({ data: [{
          id: "posting-1",
          title: "Machine Learning Intern",
          url: "https://acme.pinpointhq.com/en/postings/posting-1",
          description: "Build production models.",
          key_responsibilities: "Train and evaluate systems.",
          skills_knowledge_expertise: "Python and SQL.",
          employment_type_text: "Internship",
          workplace_type_text: "Hybrid",
          location: { city: "London", province: "United Kingdom", postal_code: "E14" },
          job: { id: "job-1", requisition_id: "REQ-1", department: { name: "Data" } },
        }] });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "pinpoint-public",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://acme.pinpointhq.com/",
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "REQ-1",
      title: "Machine Learning Intern",
      location: "London, United Kingdom",
      arrangement: "hybrid",
      employmentType: "Internship",
      department: "Data",
      requisitionId: "REQ-1",
    })]);
  });

  it("loads a complete Hirebridge catalog from the public company API", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      return Response.json(JSON.stringify([{
        joblistid: 6709001,
        jobtitle: "Software Engineering Intern",
        joblocname: "Remote - United States",
        jobloccity: "Chicago",
        joblocstatename: "Illinois",
        jobloccountryname: "United States",
        jobdeptname: "Engineering",
        jobtypename: "Internship",
        jobindeedremotetypename: "Remote",
        description: "Build reliable software.",
        url: "https://recruit.hirebridge.com/v3/Jobs/JobDetails.aspx?cid=6709&jid=6709001",
        applyurl: "http://recruit.hirebridge.com/v3/Jobs/Apply.aspx?cid=6709&jid=6709001",
        publicdate: "2026-08-12T08:00:00Z",
      }]));
    };

    const result = await crawlSource({
      id: "hirebridge-public",
      company: "Acme",
      postingUrl: "https://recruit.hirebridge.com/v3/CareerCenter/v2/?cid=6709",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual(["https://hbapi.hirebridge.com/careercenter/v2/GetJobListings?cid=6709&language=en-US"]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://recruit.hirebridge.com/v3/CareerCenter/v2/?cid=6709",
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "6709001",
      title: "Software Engineering Intern",
      arrangement: "remote",
      employmentType: "Internship",
      department: "Engineering",
      locationCountry: "United States",
      applyUrl: "https://recruit.hirebridge.com/v3/Jobs/Apply.aspx?cid=6709&jid=6709001",
    })]);
  });

  it("pages a Taleo v2 catalog until the authoritative final page", async () => {
    const requests: string[] = [];
    const taleoRow = (id: string, title: string) => `
      <h4 class="oracletaleocwsv2-head-title"><a href="viewRequisition?org=NVRINC&cws=52&rid=${id}">${title}</a></h4>
      <div tabindex="0">Technology</div><div tabindex="0">Reston, Virginia</div>`;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      expect(init?.method).toBe("POST");
      return new Response(url.includes("rowFrom=0")
        ? `${taleoRow("101", "Software Engineering Intern")}<a class="jscroll-next">Next</a>`
        : taleoRow("102", "Data Scientist"));
    };

    const result = await crawlSource({
      id: "taleo-v2",
      company: "NVR",
      postingUrl: "https://nvrinc.taleo.net/careersection/2/ats/careers/v2/jobSearch?org=NVRINC&cws=52",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://nvrinc.taleo.net/careersection/2/ats/careers/v2/searchResults?org=NVRINC&cws=52&rowFrom=0",
      "https://nvrinc.taleo.net/careersection/2/ats/careers/v2/searchResults?org=NVRINC&cws=52&rowFrom=10",
    ]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs.map((job) => job.externalId)).toEqual(["101", "102"]);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Software Engineering Intern",
      employmentType: "Internship",
      department: "Technology",
      location: "Reston, Virginia",
    }));
  });

  it("reads an embedded Rippling catalog with duplicate location variants", async () => {
    const html = `
      <div class="card_card"><span class="open-jobs_date">Engineering</span><span class="open-jobs_title">AI Software Intern</span><span class="open-jobs_place">Remote (United States)</span><a href="https://ats.rippling.com/acme/jobs/6bc9d718-770b-48da-b9ea-d86b70705d39">APPLY</a></div>
      <div class="card_card"><span class="open-jobs_date">Engineering</span><span class="open-jobs_title">AI Software Intern</span><span class="open-jobs_place">Canada</span><a href="https://ats.rippling.com/acme/jobs/6bc9d718-770b-48da-b9ea-d86b70705d39">APPLY</a></div>`;
    const result = await crawlSource({
      id: "rippling-embedded",
      company: "Acme",
      postingUrl: "https://acme.example/careers",
      adapter: "custom",
    }, async () => new Response(html), new Date());

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: "6bc9d718-770b-48da-b9ea-d86b70705d39",
      title: "AI Software Intern",
      department: "Engineering",
      location: "Remote (United States)",
      secondaryLocations: ["Canada"],
      employmentType: "Internship",
    })]);
  });

  it("checkpoints the SuccessFactors unified jobs API without skipping a page", async () => {
    const requests: Array<{ url: string; pageNumber: number | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://careers.acme.example/search/?locale=en_US") {
        return new Response('<script>j2w.SearchResultsUnify.removeResultContent()</script><meta content="rmk-jobs-search">');
      }
      const body = JSON.parse(String(init?.body)) as { pageNumber: number };
      requests.push({ url, pageNumber: body.pageNumber });
      const start = body.pageNumber * 10;
      const count = body.pageNumber === 0 ? 10 : 1;
      return Response.json({
        totalJobs: 11,
        jobSearchResult: Array.from({ length: count }, (_, index) => ({ response: {
          id: String(start + index + 1),
          unifiedStandardTitle: index === 0 && body.pageNumber === 0 ? "Software Engineering Intern" : `Engineer ${start + index + 1}`,
          unifiedUrlTitle: `Engineer-${start + index + 1}`,
          custprimecity: "Austin",
          custCountryRegion: ["United States"],
          unifiedStandardStart: "8/12/26",
        } })),
      });
    };

    const result = await crawlSource({
      id: "successfactors-unified",
      company: "Acme",
      postingUrl: "https://careers.acme.example/search/?locale=en_US",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      { url: "https://careers.acme.example/services/recruiting/v1/jobs", pageNumber: 0 },
      { url: "https://careers.acme.example/services/recruiting/v1/jobs", pageNumber: 1 },
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 2 },
      resolvedListingUrl: "https://careers.acme.example/search/?locale=en_US",
    }));
    expect(result.jobs).toHaveLength(11);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Software Engineering Intern",
      location: "Austin, United States",
      locationCountry: "United States",
      employmentType: "Internship",
      officialUrl: "https://careers.acme.example/job/Engineer-1/1-en_US",
    }));
  });

  it("loads a complete Cornerstone career-site catalog through its public API", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const context = {
      corp: "acme",
      cultureID: 1,
      cultureName: "en-US",
      endpoints: { cloud: "https://us.api.csod.com/" },
      token: "short-lived-public-token",
    };
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://acme.csod.com/")) {
        return new Response(`<script>if(!csod.context) csod.context=${JSON.stringify(context)};</script>`);
      }
      const headers = new Headers(init?.headers);
      requests.push({ url, authorization: headers.get("authorization") });
      return Response.json({ status: "Success", data: { totalCount: 2, requisitions: [{
        requisitionId: 3540,
        postingEffectiveDate: "8/11/2026",
        postingExpirationDate: "9/1/2026",
        displayJobTitle: "AI Software Engineering Intern",
        externalDescription: "Build production inference systems.",
        jobCategory: "Engineering",
        locations: [{ city: "Lowell", state: "MA", country: "US" }, { city: "Remote", country: "US" }],
      }, {
        requisitionId: 3541,
        postingEffectiveDate: "8/12/2026",
        displayJobTitle: "Data Scientist",
        locations: [{ city: "Austin", state: "TX", country: "US" }],
      }] } });
    };

    const result = await crawlSource({
      id: "cornerstone",
      company: "Acme",
      postingUrl: "https://acme.csod.com/ux/ats/careersite/4/home?c=acme",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([{
      url: "https://us.api.csod.com/rec-job-search/external/jobs",
      authorization: "Bearer short-lived-public-token",
    }]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "3540",
        title: "AI Software Engineering Intern",
        location: "Lowell, MA, US",
        secondaryLocations: ["Remote, US"],
        employmentType: "Internship",
        department: "Engineering",
        officialUrl: "https://acme.csod.com/ux/ats/careersite/4/home/requisition/3540?c=acme",
        publishedAt: "2026-08-11T00:00:00.000Z",
      }),
      expect.objectContaining({ externalId: "3541", title: "Data Scientist" }),
    ]);
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

  it("retries a Workday vanity-host tenant with its underscored CXS identity", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/wday/cxs/sallie-mae/")) return new Response("", { status: 422 });
      return Response.json({
        total: 1,
        jobPostings: [{
          title: "Data Science Intern",
          externalPath: "/job/Newark-DE/Data-Science-Intern_R-2027",
          postedOn: "Posted Today",
        }],
      });
    };

    const result = await crawlSource({
      id: "workday-vanity-tenant",
      company: "Acme",
      postingUrl: "https://sallie-mae.wd5.myworkdayjobs.com/Careers",
      adapter: "workday",
    }, fetcher, new Date("2026-08-12T12:00:00Z"));

    expect(requests.slice(0, 2)).toEqual([
      "https://sallie-mae.wd5.myworkdayjobs.com/wday/cxs/sallie-mae/Careers/jobs",
      "https://sallie-mae.wd5.myworkdayjobs.com/wday/cxs/sallie_mae/Careers/jobs",
    ]);
    expect(requests.some((url) => url.includes("/wday/cxs/sallie_mae/Careers/job/"))).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Science Intern"]);
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

  it("discovers Eightfold PCSX configuration on a branded careers domain", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.href === "https://apply.acme.example/careers") {
        return new Response('<div id="pcsx"></div><code>{&#34;domain&#34;: &#34;acme.com&#34;}</code>');
      }
      if (url.pathname === "/api/pcsx/search") {
        expect(url.searchParams.get("domain")).toBe("acme.com");
        return Response.json({ data: { count: 1, positions: [{ id: 101, name: "Applied AI Intern" }] } });
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "branded-eightfold",
      company: "Acme",
      postingUrl: "https://apply.acme.example/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://apply.acme.example/careers",
      "https://apply.acme.example/api/pcsx/search?domain=acme.com&query=&location=&start=0",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://apply.acme.example/careers?domain=acme.com",
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Applied AI Intern"]);
  });

  it("uses the final redirected locale path before deriving a Phenom search URL", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://careers.acme.example/") {
        const response = new Response("redirected", { status: 200 });
        Object.defineProperty(response, "url", { value: "https://careers.acme.example/global/en" });
        return response;
      }
      if (url === "https://careers.acme.example/global/en") {
        return new Response('<script src="https://assets.phenompeople.com/app.js"></script>');
      }
      if (url === "https://careers.acme.example/global/en/search-results") {
        return new Response(`<script>phApp.ddo = ${JSON.stringify({
          eagerLoadRefineSearch: {
            hits: 1,
            totalHits: 1,
            data: { jobs: [{ jobId: "1", title: "Data Intern", applyUrl: "https://careers.acme.example/global/en/job/1/data-intern" }] },
          },
        })};</script>`);
      }
      return new Response("missing", { status: 404 });
    };

    const result = await crawlSource({
      id: "redirected-phenom",
      company: "Acme",
      postingUrl: "https://careers.acme.example/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests.slice(0, 3)).toEqual([
      "https://careers.acme.example/",
      "https://careers.acme.example/global/en",
      "https://careers.acme.example/global/en/search-results",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      resolvedListingUrl: "https://careers.acme.example/global/en/search-results",
    }));
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

  it("uses a verified Greenhouse feed without waiting on the rendered company landing page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      expect(url).toBe("https://boards-api.greenhouse.io/v1/boards/affirm/jobs?content=true");
      return Response.json({ jobs: [{
        id: 101,
        title: "Machine Learning Intern",
        absolute_url: "https://job-boards.greenhouse.io/affirm/jobs/101",
      }] });
    };

    const result = await crawlSource({
      id: "p2-0070-affirm",
      company: "Affirm",
      postingUrl: "https://www.affirm.com/careers",
      adapter: "greenhouse",
    }, fetcher, new Date());

    expect(requests).toHaveLength(1);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://job-boards.greenhouse.io/affirm",
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Machine Learning Intern"]);
  });

  it("does not re-enter an ID-pinned feed while following its canonical catalog link", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (requests.length === 1) {
        const response = new Response("", { status: 200, headers: { "content-type": "text/html" } });
        Object.defineProperty(response, "url", { value: "https://jobs.dayforcehcm.com/trinetx1/CANDIDATEPORTAL" });
        return response;
      }
      return new Response(`<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "AI Engineering Intern",
        url: "https://jobs.dayforcehcm.com/trinetx1/CANDIDATEPORTAL/jobs/101",
      })}</script>`, { status: 200, headers: { "content-type": "text/html" } });
    };

    const result = await crawlSource({
      id: "p5-1082-trinetx",
      company: "TriNetX",
      postingUrl: "https://www.trinetx.com/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual([
      "https://globaleur241.dayforcehcm.com/CandidatePortal/en-US/trinetx1",
      "https://jobs.dayforcehcm.com/trinetx1/CANDIDATEPORTAL",
    ]);
    expect(result.status).toBe("succeeded");
    expect(result.jobs.map((job) => job.title)).toEqual(["AI Engineering Intern"]);
  });

  it.each([
    {
      id: "legacy-row-847",
      company: "PBF Energy",
      postingUrl: "https://www.pbfenergy.com/careers/",
      endpoint: "https://pbfenergy.wd1.myworkdayjobs.com/wday/cxs/pbfenergy/PBF/jobs",
      listingUrl: "https://pbfenergy.wd1.myworkdayjobs.com/PBF",
    },
    {
      id: "p5-1094-vanderbilt-health",
      company: "Vanderbilt Health",
      postingUrl: "https://www.vumc.org/careers/",
      endpoint: "https://vumc.wd1.myworkdayjobs.com/wday/cxs/vumc/vumccareers/jobs",
      listingUrl: "https://vumc.wd1.myworkdayjobs.com/vumccareers",
    },
    {
      id: "p5-1096-vantor",
      company: "Vantor (ex-Maxar Intelligence)",
      postingUrl: "https://vantor.com/careers/",
      endpoint: "https://maxar.wd1.myworkdayjobs.com/wday/cxs/maxar/Vantor/jobs",
      listingUrl: "https://maxar.wd1.myworkdayjobs.com/Vantor",
    },
  ])("uses the verified Workday feed for $company without probing its landing page", async ({
    id, company, postingUrl, endpoint, listingUrl,
  }) => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json({
        total: 1,
        jobPostings: [{
          title: "Operations Analyst",
          externalPath: "/job/New-York/Operations-Analyst_R100",
          locationsText: "New York, NY",
          postedOn: "Posted Today",
        }],
      });
    };

    const result = await crawlSource({ id, company, postingUrl, adapter: "custom" }, fetcher, new Date("2026-08-12T12:00:00Z"));

    expect(requests).toEqual([endpoint]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: listingUrl,
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Operations Analyst"]);
  });

  it("uses Vanta's official embedded Ashby feed instead of scraping the rendered careers page", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json({ jobs: [{
        id: "vanta-1", title: "Applied AI Intern", department: "Engineering", employmentType: "Internship",
        location: "Remote U.S.", isListed: true, isRemote: true, workplaceType: "Remote",
        jobUrl: "https://jobs.ashbyhq.com/vanta/vanta-1", applyUrl: "https://jobs.ashbyhq.com/vanta/vanta-1/application",
        publishedAt: "2026-08-12T00:00:00Z", descriptionPlain: "Build trustworthy AI products.",
      }] });
    };

    const result = await crawlSource({
      id: "p4-0510-vanta", company: "Vanta", postingUrl: "https://www.vanta.com/careers", adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual(["https://api.ashbyhq.com/posting-api/job-board/vanta"]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded", completeListing: true, resolvedListingUrl: "https://jobs.ashbyhq.com/vanta",
    }));
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Applied AI Intern", arrangement: "remote", employmentType: "Internship", department: "Engineering",
    }));
  });

  it.each([
    ["p2-0146-oportun", "Oportun", "https://www.oportun.com/careers", "https://boards-api.greenhouse.io/v1/boards/oportun/jobs?content=true", "https://job-boards.greenhouse.io/oportun"],
    ["p4-0430-fastly", "Fastly", "https://www.fastly.com/careers", "https://boards-api.greenhouse.io/v1/boards/fastly/jobs?content=true", "https://job-boards.greenhouse.io/fastly"],
    ["p4-0492-scale-ai", "Scale AI", "https://scale.com/careers", "https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true", "https://job-boards.greenhouse.io/scaleai"],
    ["p5-0944-instacart", "Instacart", "https://www.instacart.careers/current-openings", "https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true", "https://job-boards.greenhouse.io/instacart"],
    ["p5-1011-oscar-health", "Oscar Health", "https://www.hioscar.com/careers/search", "https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=true", "https://job-boards.greenhouse.io/oscar"],
    ["p5-1022-planet-labs", "Planet Labs", "https://www.planet.com/company/careers/", "https://boards-api.greenhouse.io/v1/boards/planetlabs/jobs?content=true", "https://job-boards.greenhouse.io/planetlabs"],
  ])("uses the browser-verified Greenhouse feed for %s", async (id, company, postingUrl, endpoint, listingUrl) => {
    const requests: string[] = [];
    const result = await crawlSource({ id, company, postingUrl, adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return Response.json({ jobs: [{ id: 101, title: "AI Intern", absolute_url: `${listingUrl}/jobs/101` }] });
    }, new Date());
    expect(requests).toEqual([endpoint]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, resolvedListingUrl: listingUrl }));
  });

  it.each([
    ["p5-0657-machina-labs", "Machina Labs", "https://machinalabs.ai/careers", "https://api.lever.co/v0/postings/MachinaLabs?mode=json", "https://jobs.lever.co/MachinaLabs"],
    ["p5-0739-stardog", "Stardog", "https://www.stardog.com/company/careers/", "https://api.lever.co/v0/postings/stardog?mode=json", "https://jobs.lever.co/stardog"],
    ["p5-1116-zoox", "Zoox", "https://zoox.com/careers", "https://api.lever.co/v0/postings/zoox?mode=json", "https://jobs.lever.co/zoox"],
  ])("uses the browser-verified Lever feed for %s", async (id, company, postingUrl, endpoint, listingUrl) => {
    const requests: string[] = [];
    const result = await crawlSource({ id, company, postingUrl, adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return Response.json([{ id: "job-1", text: "Software Intern", hostedUrl: `${listingUrl}/job-1`, categories: { location: "United States", commitment: "Internship" } }]);
    }, new Date());
    expect(requests).toEqual([endpoint]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, resolvedListingUrl: listingUrl }));
  });

  it.each([
    {
      id: "p4-0513-verint",
      company: "Verint",
      postingUrl: "https://www.verint.com/careers",
      listingUrl: "https://fa-epcb-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX",
      apiOrigin: "https://fa-epcb-saasfaprod1.fa.ocs.oraclecloud.com",
      site: "CX",
    },
    {
      id: "legacy-row-878",
      company: "Vertiv Holdings",
      postingUrl: "https://www.vertiv.com/en-us/about/career-center/",
      listingUrl: "https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
      apiOrigin: "https://egup.fa.us2.oraclecloud.com",
      site: "CX",
    },
    {
      id: "legacy-row-881",
      company: "Vulcan Materials",
      postingUrl: "https://jobs.vulcanmaterials.com/",
      listingUrl: "https://careers.vulcanmaterials.com/hcmUI/CandidateExperience/en/sites/careers/jobs",
      apiOrigin: "https://careers.vulcanmaterials.com",
      site: "careers",
    },
  ])("uses $company's official Oracle Recruiting board instead of its corporate careers landing page", async ({
    id, company, postingUrl, listingUrl, apiOrigin, site,
  }) => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === listingUrl) return new Response(`<!doctype html><title>${company} careers</title>`);
      const endpoint = new URL(url);
      expect(endpoint.origin + endpoint.pathname).toBe(
        `${apiOrigin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`,
      );
      expect(endpoint.searchParams.get("finder")).toContain(`siteNumber=${site}`);
      return Response.json({ items: [{
        TotalJobsCount: 1,
        requisitionList: [{
          Id: `${id}-101`,
          Title: "Applied AI Software Engineering Intern",
          PrimaryLocation: "United States",
          JobSchedule: "Internship",
          ShortDescriptionStr: "Build production AI software.",
          PostedDate: "2026-08-12T00:00:00Z",
        }],
      }] });
    };

    const result = await crawlSource({
      id, company, postingUrl, adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toHaveLength(2);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded", completeListing: true, resolvedListingUrl: listingUrl,
    }));
    expect(result.jobs).toEqual([expect.objectContaining({
      externalId: `${id}-101`, title: "Applied AI Software Engineering Intern", employmentType: "Internship",
      officialUrl: `${new URL(listingUrl).origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}-101`,
    })]);
  });

  it("paginates Vanguard's official M-Cloud API with rich filter fields and exact closure checks", async () => {
    const offsets: number[] = [];
    const total = 25;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://jobsapi-google.m-cloud.io/api/job/search");
      expect(url.searchParams.get("companyName")).toBe("companies/fbd5ce04-22d1-4aae-90dc-0282e45ee06f");
      expect(url.searchParams.get("customAttributeFilter")).toBe('is_internal="External"');
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      return Response.json({
        totalHits: total,
        searchResults: Array.from({ length: Math.min(10, total - offset) }, (_, index) => {
          const id = offset + index + 1;
          return { job: {
            id, ref: `REQ-${id}`, title: id === 1 ? "2027 Data Science Intern" : `Application Engineer ${id}`,
            description: `<p>Build software and data products ${id}.</p>`, primary_category: "Technology",
            primary_city: "Malvern", primary_state: "PA", primary_country: "US",
            addtnl_locations: [{ addtnl_city: "Charlotte", addtnl_state: "NC", addtnl_country: "US" }],
            department: "Application Engineering", employment_type: "Full Time", level: "Early career",
            compliment: id === 1 ? "Work from home" : "Hybrid", open_date: "2026-08-12T00:00:00",
            url: `http://www.vanguardjobs.com/job/${id}/application-engineer-${id}-malvern-pa/`,
            seo_url: `https://vanguard.wd5.myworkdayjobs.com/vanguard_external/job/Malvern-PA/Application-Engineer-${id}_REQ-${id}/apply`,
          } };
        }),
      });
    };

    const result = await crawlSource({
      id: "p5-1095-vanguard", company: "Vanguard",
      postingUrl: "https://www.vanguardjobs.com/job-search-results/", adapter: "custom",
    }, fetcher, new Date());

    expect(offsets.sort((a, b) => a - b)).toEqual([0, 10, 20]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded", completeListing: true, resolvedListingUrl: "https://www.vanguardjobs.com/job-search-results/",
    }));
    expect(result.jobs).toHaveLength(total);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "2027 Data Science Intern", employmentType: "Internship", arrangement: "remote",
      location: "Malvern, PA, US", locationCity: "Malvern", locationState: "PA", locationCountry: "US",
      secondaryLocations: ["Charlotte, NC, US"], department: "Application Engineering", jobFamily: "Technology",
      experienceLevel: "Early career", requisitionId: "REQ-1", officialUrl: "https://www.vanguardjobs.com/job/1/application-engineer-1-malvern-pa/",
    }));
  });

  it("caps a Vanguard catalog above 500 jobs without falsely closing unseen jobs", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async (input) => {
      requests += 1;
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return Response.json({ totalHits: 501, searchResults: Array.from({ length: 10 }, (_, index) => ({ job: {
        id: offset + index, title: `Role ${offset + index}`, url: `https://www.vanguardjobs.com/job/${offset + index}/role/`,
      } })) });
    };

    const result = await crawlSource({
      id: "p5-1095-vanguard", company: "Vanguard",
      postingUrl: "https://www.vanguardjobs.com/job-search-results/", adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toBe(50);
    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs).toHaveLength(500);
  });

  it("routes Graybar to its official Jobsyn API and checkpoints the large catalog", async () => {
    const requests: URL[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      expect(url.origin + url.pathname).toBe("https://prod-search-api.jobsyn.org/api/v1/solr/search");
      expect(new Headers(init?.headers).get("x-origin")).toBe("graybar.jobs");
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        jobs: Array.from({ length: 10 }, (_, index) => ({
          guid: `graybar-${page}-${index}`,
          reqid: `R-${page}-${index}`,
          title_exact: index === 0 ? "AI Engineering Intern" : "Quotations Specialist",
          title_slug: index === 0 ? "ai-engineering-intern" : "quotations-specialist",
          location_exact: "Reno, NV",
          city_exact: "Reno",
          state_short: "NV",
          country_exact: "United States",
          date_added: "2026-08-12T22:00:00Z",
          date_new: "2026-08-10T08:00:00Z",
          date_updated: "2026-08-11T08:00:00Z",
          description: "Build production systems.",
        })),
        pagination: { page, page_size: 10, total: 210, total_pages: 21, has_more_pages: page < 21 },
      });
    };

    const result = await crawlSource({
      id: "audit-row-364",
      company: "Graybar Electric",
      postingUrl: "https://www.graybar.com/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toHaveLength(20);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 20, cycleComplete: false, totalPages: 21 },
      resolvedListingUrl: "https://graybar.jobs/jobs/",
    }));
    expect(result.jobs).toHaveLength(200);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "AI Engineering Intern",
      employmentType: "Internship",
      locationCity: "Reno",
      locationState: "NV",
      locationCountry: "United States",
      publishedAt: "2026-08-10T08:00:00.000Z",
      officialUrl: "https://graybar.jobs/reno-nv/ai-engineering-intern/graybar-1-0/job/",
    }));
  });

  it("falls back to Graybar's official sitemap when the search API blocks Worker requests", async () => {
    const requests: string[] = [];
    const result = await crawlSource({
      id: "audit-row-364",
      company: "Graybar Electric",
      postingUrl: "https://www.graybar.com/careers",
      adapter: "custom",
    }, async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://prod-search-api.jobsyn.org/")) {
        return new Response("Forbidden", { status: 403 });
      }
      if (url === "https://graybar.jobs/sitemaps/jobs_1.xml") {
        return new Response("Forbidden", { status: 403 });
      }
      if (url === "https://production--graybar-jobs.microsites.devpc.us/sitemaps/jobs_1.xml") {
        return new Response("Unavailable", { status: 503 });
      }
      expect(url).toBe("https://r.jina.ai/https://graybar.jobs/sitemaps/jobs_1.xml");
      return new Response(`Title: Sitemap

[https://graybar.jobs/reno-nv/ai-engineering-intern/A75C2F7E874C4D2789CD964116421D74/job/](https://graybar.jobs/reno-nv/ai-engineering-intern/A75C2F7E874C4D2789CD964116421D74/job/)

2026-08-12

[https://graybar.jobs/tulsa-ok/outside-sales-representative/0C1502475D8A4C91AAF08340C1106309/job/](https://graybar.jobs/tulsa-ok/outside-sales-representative/0C1502475D8A4C91AAF08340C1106309/job/)

2026-08-10`);
    }, new Date());

    expect(requests).toEqual([
      "https://prod-search-api.jobsyn.org/api/v1/solr/search?page=1",
      "https://graybar.jobs/sitemaps/jobs_1.xml",
      "https://production--graybar-jobs.microsites.devpc.us/sitemaps/jobs_1.xml",
      "https://r.jina.ai/https://graybar.jobs/sitemaps/jobs_1.xml",
    ]);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      responseStatus: 200,
      resolvedListingUrl: "https://graybar.jobs/jobs/",
    }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        title: "AI Engineering Intern",
        employmentType: "Internship",
        location: "Reno, NV",
        locationCountry: "United States",
      }),
      expect.objectContaining({ title: "Outside Sales Representative", location: "Tulsa, OK" }),
    ]);
  });

  it("loads EOG's full server-rendered job search in one request", async () => {
    const requests: string[] = [];
    const result = await crawlSource({
      id: "audit-row-354",
      company: "EOG Resources",
      postingUrl: "https://careers.eogresources.com/",
      adapter: "custom",
    }, async (input) => {
      requests.push(String(input));
      return new Response(`
        <div class="list-group-item"><a href="jobdetails.asp?jo_num=11228&apply=yes&" class="btn">Job Details</a><div class="row"><a class="coloredlink bold" href="jobdetails.asp?jo_num=11228&apply=yes&">Accountant III</a><div class="col-md-12 thinrow">Houston, TX</div><div class="col-md-12 thinrow">Posted&nbsp;5/5/2026</div></div></div>
        <div class="list-group-item"><a class="coloredlink bold" href="jobdetails.asp?jo_num=11300&apply=yes&">Software Engineering Intern</a><div class="col-md-12 thinrow">Denver, CO</div><div class="col-md-12 thinrow">Posted&nbsp;8/12/2026</div></div>
      `);
    }, new Date());

    expect(requests).toEqual(["https://careers.eogresources.com/Process_jobsearch.asp"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, resolvedListingUrl: requests[0] }));
    expect(result.jobs).toEqual([
      expect.objectContaining({ externalId: "11228", title: "Accountant III", location: "Houston, TX", publishedAt: "2026-05-05T00:00:00.000Z" }),
      expect.objectContaining({ externalId: "11300", employmentType: "Internship", locationState: "CO" }),
    ]);
  });

  it("loads Ameriprise's complete official job sitemap in one request", async () => {
    const requests: string[] = [];
    const result = await crawlSource({
      id: "p2-0076-ameriprise-financial",
      company: "Ameriprise Financial",
      postingUrl: "https://www.ameriprise.com/careers",
      adapter: "custom",
    }, async (input, init) => {
      const url = new URL(String(input));
      requests.push(url.href);
      expect(new Headers(init?.headers).get("user-agent")).toContain("Mozilla/5.0");
      return new Response(`<?xml version="1.0"?><urlset>
        <url><loc>https://careers.ameriprise.com/</loc><lastmod>2026-01-01</lastmod></url>
        <url><loc>https://careers.ameriprise.com/search-jobs/r26_1/data-engineer/</loc><lastmod>2026-08-11T10:00:00Z</lastmod></url>
        <url><loc>https://careers.ameriprise.com/search-jobs/r26_2/ai-intern/</loc><lastmod>2026-08-12T10:00:00Z</lastmod></url>
      </urlset>`);
    }, new Date());

    expect(requests).toEqual(["https://careers.ameriprise.com/sitemap.xml"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, resolvedListingUrl: "https://careers.ameriprise.com/search-jobs/" }));
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[1]).toEqual(expect.objectContaining({ title: "AI Intern", employmentType: "Internship", publishedAt: "2026-08-12T10:00:00.000Z" }));
  });

  it("loads Cardinal Health's complete JSON catalog with structured filter fields", async () => {
    const requests: string[] = [];
    const record = (index: number) => ({
      ID: `uuid-${index}`,
      PostedDateRaw: "2026-08-12T10:00:00",
      IsRemote: index === 0,
      TrackingObject: {
        ReferenceNumberJson: `20${index}`,
        TitleJson: index === 0 ? "Data Science Intern - AI" : `Warehouse Engineer ${index}`,
        TypeNameJson: index === 0 ? "Intern" : "Full time",
        LocationNamesJson: ["Cardinal Office"],
        ZipCodesJson: ["43215"],
        CityNamesJson: ["Columbus"],
        StateNamesJson: ["Ohio"],
        CityStatesDataAbbrevJson: ["Columbus, OH"],
        CountryNamesJson: ["United States"],
        ActivateCategoryNamesJson: ["Data & Analytics"],
        AtsCategoryNamesJson: ["Data & Analytics"],
      },
    });
    const result = await crawlSource({
      id: "p5-0566-cardinal-health",
      company: "Cardinal Health",
      postingUrl: "https://jobs.cardinalhealth.com/search/searchjobs",
      adapter: "custom",
    }, async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      const offset = Number(url.searchParams.get("jtStartIndex"));
      expect(offset).toBe(0);
      const records = Array.from({ length: 501 }, (_, index) => record(index));
      return Response.json(JSON.stringify({ Result: "OK", Records: records, TotalRecordCount: 501 }));
    }, new Date());

    expect(requests).toHaveLength(1);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true, resolvedListingUrl: "https://jobs.cardinalhealth.com/search-jobs" }));
    expect(result.jobs).toHaveLength(501);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      title: "Data Science Intern - AI",
      employmentType: "Internship",
      arrangement: "remote",
      department: "Data & Analytics",
      locationCountry: "United States",
      officialUrl: "https://jobs.cardinalhealth.com/search/jobdetails/data-science-intern---ai/uuid-0",
    }));
  });

  it("loads a complete Activate job-search catalog from an official listing page", async () => {
    const requests: string[] = [];
    const result = await crawlSource({
      id: "audit-row-420",
      company: "Ross Stores",
      postingUrl: "https://jobs.rossstores.com/search/searchjobs",
      adapter: "custom",
    }, async (input) => {
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.pathname !== "/Search/SearchResults") {
        return new Response('<script src="/Views/ReusableComponents/JobSearchResultsTable/SearchResultsManager.js"></script>');
      }
      expect(url.searchParams.get("jtPageSize")).toBe("10000");
      return Response.json(JSON.stringify({
        Result: "OK",
        TotalRecordCount: 2,
        Records: [{
          ID: "8cd45af3-ef52-4c64-bb4c-8c6ceba42c3a",
          ReferenceNumber: "R12345",
          Title: "2027 Software Engineering Intern",
          CityName: "Dublin",
          StateName: "CA",
          CityStateDataAbbrev: "Dublin, CA",
          CountryName: "United States",
          PostedDateRaw: "2026-08-12T10:00:00",
          TypeName: "Internship",
          TrackingObject: {
            ReferenceNumberJson: "R12345",
            TitleJson: "2027 Software Engineering Intern",
            CityNamesJson: ["Dublin"],
            StateNamesJson: ["CA"],
            CityStatesDataAbbrevJson: ["Dublin, CA"],
            CountryNamesJson: ["United States"],
            ActivateCategoryNamesJson: ["Technology"],
            ActivateFamilyNamesJson: ["Engineering"],
          },
        }, {
          ID: "4599625f-4f72-4077-a8d2-2310e884c298",
          Title: "Store Manager",
          CityStateDataAbbrev: "Austin, TX",
          CountryName: "United States",
        }],
      }));
    }, new Date());

    expect(requests).toHaveLength(2);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "8cd45af3-ef52-4c64-bb4c-8c6ceba42c3a",
      requisitionId: "R12345",
      employmentType: "Internship",
      jobFamily: "Engineering",
      locationCountry: "United States",
      officialUrl: "https://jobs.rossstores.com/search/jobdetails/2027-software-engineering-intern/8cd45af3-ef52-4c64-bb4c-8c6ceba42c3a",
    }));
  });

  it("reads every HRMDirect row even when its source HTML omits closing anchor tags", async () => {
    const html = `<table>
      <tr class="reqitem" data-req-id="3750384">
        <td class="departments reqitem">Accounting &amp; Finance</td>
        <td class="posTitle reqitem"><a href="job-opening.php?req=3750384&req_loc=1375571&&amp;#job">Accounts Payable Specialist</td>
        <td class="cities reqitem">Sugar Land</td><td class="state reqitem">TX</td>
      </tr>
      <tr class="reqitem1" data-req-id="3750428">
        <td class="departments reqitem1">Engineering</td>
        <td class="posTitle reqitem1"><a href="job-opening.php?req=3750428&req_loc=1375620&&amp;#job">AI Engineering Intern</td>
        <td class="cities reqitem1">Houston</td><td class="state reqitem1">TX</td>
      </tr>
    </table>`;
    const result = await crawlSource({
      id: "p5-0799-applied-optoelectronics",
      company: "Applied Optoelectronics (AOI)",
      postingUrl: "https://ao-inc.hrmdirect.com/employment/job-openings.php?search=true&",
      adapter: "custom",
    }, async () => new Response(html), new Date());

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "3750384",
        title: "Accounts Payable Specialist",
        department: "Accounting & Finance",
        location: "Sugar Land, TX",
      }),
      expect.objectContaining({
        externalId: "3750428",
        title: "AI Engineering Intern",
        employmentType: "Internship",
        officialUrl: "https://ao-inc.hrmdirect.com/employment/job-opening.php?req=3750428&req_loc=1375620#job",
      }),
    ]);
  });

  it("keeps an Activate response non-authoritative when record identities repeat", async () => {
    const result = await crawlSource({
      id: "p2-0086-cadence-bank",
      company: "Huntington Bank",
      postingUrl: "https://huntington-careers.com/search/searchjobs",
      adapter: "custom",
    }, async (input) => new URL(String(input)).pathname === "/Search/SearchResults"
      ? Response.json({
          Result: "OK",
          TotalRecordCount: 2,
          Records: [
            { ID: "duplicate", Title: "Data Engineer" },
            { ID: "duplicate", Title: "Data Engineer" },
          ],
        })
      : new Response("ReusableComponents/JobSearchResultsTable"), new Date());

    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false }));
    expect(result.jobs).toHaveLength(1);
  });

  it("does not advance a Jobsyn cycle past an incomplete page", async () => {
    const result = await crawlSource({
      id: "jobsyn-incomplete",
      company: "Acme",
      postingUrl: "https://acme.jobs/jobs/",
      adapter: "custom",
    }, async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "acme.jobs") {
        return new Response('<script>const api="https://prod-search-api.jobsyn.org/api/"; const source="solr";</script>');
      }
      expect(new Headers(init?.headers).get("x-origin")).toBe("acme.jobs");
      const page = Number(url.searchParams.get("page"));
      const count = page === 2 ? 9 : 10;
      return Response.json({
        jobs: Array.from({ length: count }, (_, index) => ({
          guid: `job-${page}-${index}`,
          title_exact: "Engineer",
          title_slug: "engineer",
          location_exact: "Austin, TX",
        })),
        pagination: { page, page_size: 10, total: 30, total_pages: 3, has_more_pages: page < 3 },
      });
    }, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 2, cycleComplete: false, totalPages: 3 },
    }));
    expect(result.jobs).toHaveLength(10);
  });

  it("routes verified PSI CRO, OpenAI, NBCUniversal, and Wabtec sources straight to their public APIs", async () => {
    const psiRequests: string[] = [];
    const psi = await crawlSource({
      id: "p5-1029-psi-cro",
      company: "PSI CRO",
      postingUrl: "https://www.psi-cro.com/careers/",
      adapter: "custom",
    }, async (input) => {
      psiRequests.push(String(input));
      return Response.json({ totalFound: 1, content: [{ id: "sr-1", name: "Data Analyst" }] });
    }, new Date());

    const openAiRequests: string[] = [];
    const openAi = await crawlSource({
      id: "p5-0692-openai",
      company: "OpenAI",
      postingUrl: "https://openai.com/careers/search/?action=apply",
      adapter: "custom",
    }, async (input) => {
      openAiRequests.push(String(input));
      return Response.json({ jobs: [{
        id: "ashby-1",
        title: "Software Engineer",
        jobUrl: "https://jobs.ashbyhq.com/openai/ashby-1",
        isListed: true,
      }] });
    }, new Date());

    const smartRecruitersRequests: string[] = [];
    const smartRecruitersFetcher: typeof fetch = async (input) => {
      const url = String(input);
      smartRecruitersRequests.push(url);
      return Response.json({ totalFound: 1, content: [{ id: url.includes("NBCUniversal3") ? "nbc-1" : "wabtec-1", name: "Data Science Intern" }] });
    };
    const nbc = await crawlSource({
      id: "p4-0313-nbcuniversal", company: "NBCUniversal", postingUrl: "https://www.nbcunicareers.com/talent-community", adapter: "custom",
    }, smartRecruitersFetcher, new Date());
    const wabtec = await crawlSource({
      id: "legacy-row-128", company: "Westinghouse Air Brake", postingUrl: "https://careers.wabtec.com/jobs", adapter: "custom",
    }, smartRecruitersFetcher, new Date());

    expect(psiRequests).toEqual(["https://api.smartrecruiters.com/v1/companies/PSICRO/postings"]);
    expect(psi.jobs).toHaveLength(1);
    expect(openAiRequests).toEqual(["https://api.ashbyhq.com/posting-api/job-board/openai"]);
    expect(openAi.jobs).toHaveLength(1);
    expect(smartRecruitersRequests).toEqual([
      "https://api.smartrecruiters.com/v1/companies/NBCUniversal3/postings",
      "https://api.smartrecruiters.com/v1/companies/Wabtec/postings",
    ]);
    expect(nbc.jobs).toHaveLength(1);
    expect(wabtec.jobs).toHaveLength(1);
  });

  it("loads News Corp's complete official job sitemap without opening protected pages", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(`<urlset>
        <url><loc>https://careers.newscorp.com/virtual-usa/data-science-intern/6E4B8B0E7316466F87C815824802986B/job/</loc><lastmod>2026-08-12</lastmod></url>
        <url><loc>https://careers.newscorp.com/new-york-ny/software-engineer/125953384BF94E769A717894A28032FC/job/</loc><lastmod>2026-08-11</lastmod></url>
      </urlset>`, { headers: { "content-type": "application/xml" } });
    };

    const result = await crawlSource({
      id: "legacy-row-840",
      company: "News Corp",
      postingUrl: "https://careers.newscorp.com/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toEqual(["https://careers.newscorp.com/sitemaps/jobs_1.xml"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([
      expect.objectContaining({ title: "Data Science Intern", location: "Virtual USA", arrangement: "remote", employmentType: "Internship" }),
      expect.objectContaining({ title: "Software Engineer", location: "New York NY" }),
    ]);
  });

  it("uses Olympus' paged SuccessFactors search instead of its corporate landing page", async () => {
    const requests: string[] = [];
    const result = await crawlSource({
      id: "p5-1005-olympus-medical-systems",
      company: "Olympus Medical Systems",
      postingUrl: "https://www.olympusamerica.com/careers",
      adapter: "custom",
    }, async (input) => {
      requests.push(String(input));
      return new Response(`<span class="paginationLabel">Results <b>1 – 2</b> of <b>2</b></span>
        <tr class="data-row"><span class="jobFacility">REQ-1</span><a class="jobTitle-link" href="/job/Center-Valley-Data-Science-Intern-PA/1400046400/">Data Science Intern</a><span class="jobLocation">Center Valley, PA, US</span></tr>
        <tr class="data-row"><span class="jobFacility">REQ-2</span><a class="jobTitle-link" href="/job/Redmond-Software-Engineer-WA/1408854700/">Software Engineer</a><span class="jobLocation">Redmond, WA, US</span></tr>`);
    }, new Date());

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("careers.olympusamerica.com/search/");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Data Science Intern", "Software Engineer"]);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ location: "Center Valley, PA, US", requisitionId: "REQ-1" }));
  });

  it("uses Abrigo's public Jobvite board as a complete one-request catalog", async () => {
    const requests: string[] = [];
    const result = await crawlSource({ id: "p2-0068-abrigo", company: "Abrigo", postingUrl: "https://www.abrigo.com/careers/", adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return new Response(`<table class="jv-job-list"><tr><td class="jv-job-list-name"><a href="/bankerstoolbox/job/oPAxAfwg">Support Analyst</a></td><td class="jv-job-list-location">3 Locations</td></tr></table>`);
    }, new Date());

    expect(requests).toEqual(["https://jobs.jobvite.com/bankerstoolbox"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs[0]).toEqual(expect.objectContaining({ title: "Support Analyst", location: "3 Locations" }));
  });

  it("stores only real LogRhythm Jobvite rows and closes navigation false positives", async () => {
    const requests: string[] = [];
    const result = await crawlSource({ id: "p4-0455-logrhythm", company: "LogRhythm", postingUrl: "https://jobs.jobvite.com/exabeam/#openings", adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return new Response(`
        <nav><a href="/exabeam/jobs/">Careers Home</a><a href="/exabeam/jobs#openings">Search Openings</a></nav>
        <div class="jv-job-list"><ul>
          <li class="row"><a href="/exabeam/job/oEgCAfwQ"><div class="jv-job-list-name">Country Manager</div><div class="jv-job-list-location">Minato City, Tokyo</div></a></li>
          <li class="row"><a href="/exabeam/job/oPRBAfwB"><div class="jv-job-list-name">Senior Sales Engineer</div><div class="jv-job-list-location">Minato City, Tokyo</div></a></li>
        </ul></div>
        <section><div>General Application</div><a href="/exabeam/jobAlerts">Job Alerts</a></section>
        <footer><a href="/cdn-cgi/l/email-protection">[email protected]</a></footer>
      `);
    }, new Date());

    expect(requests).toEqual(["https://jobs.jobvite.com/exabeam/"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs).toEqual([
      expect.objectContaining({ externalId: "oEgCAfwQ", title: "Country Manager", location: "Minato City, Tokyo" }),
      expect.objectContaining({ externalId: "oPRBAfwB", title: "Senior Sales Engineer", location: "Minato City, Tokyo" }),
    ]);
  });

  it("checkpoints Ace Hardware's official JSON-backed pages without loading job details", async () => {
    const requests: string[] = [];
    const block = (id: string, title: string, location: string) => `<div class="search--item"><label>${id}</label><p><a href="/posting/${title.toLocaleLowerCase().replaceAll(" ", "-")}/${id}">${title}</a></p><label>Location</label><p>${location}</p><label>Category</label><p>Corporate</p></div>`;
    const result = await crawlSource({ id: "legacy-row-777", company: "Ace Hardware", postingUrl: "https://careers.acehardware.com/", adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return Response.json({ showing: "Showing 2 of 2 Results", postings: { jobs: `${block("REQ-123456", "Data Intern", "Oak Brook, Illinois")}${block("a1b2c3d4", "Developer", "Remote")}` } });
    }, new Date());

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("get-jobs.php");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: false, pagination: { nextPage: 1, cycleComplete: true, totalPages: 1 } }));
    expect(result.jobs).toHaveLength(2);
  });

  it("loads every Astronics posting and description from its linked RSS feed", async () => {
    const requests: string[] = [];
    const result = await crawlSource({ id: "p5-0808-astronics", company: "ASTRONICS", postingUrl: "https://www.astronics.com/us-jobs", adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return new Response(`<rss><channel><item><title><![CDATA[Software Intern   (WA, Kirkland)]]></title><description><![CDATA[<p>Build software.</p>]]></description><link>https://www.appone.com/MainInfoReq.asp?R_ID=7202300&amp;B_ID=83</link><pubDate>Wed, 12 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`);
    }, new Date());

    expect(requests).toEqual(["https://client.hrservicesinc.com/downloads/rss/portals/2110.xml"]);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs[0]).toEqual(expect.objectContaining({ title: "Software Intern", location: "Kirkland, WA", employmentType: "Internship", description: "Build software." }));
  });

  it("uses Graphic Packaging's self-described JSON job API", async () => {
    const requests: string[] = [];
    const result = await crawlSource({ id: "legacy-row-820", company: "Graphic Packaging Holding", postingUrl: "https://careers.graphicpkg.com/", adapter: "custom" }, async (input) => {
      requests.push(String(input));
      return Response.json({ totalCount: 1, results: [{ requisitionId: "15533", title: "Data Intern", department: "Technology", location: "Atlanta, GA, USA", employmentType: "Internship", datePosted: "2026-08-11", applyUrl: "https://career55.sapsf.eu/careers?career_job_req_id=15533", description: "Analyze data." }] });
    }, new Date());

    expect(requests[0]).toContain("careers.graphicpkg.com/api/mcp/jobs");
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", completeListing: true }));
    expect(result.jobs[0]).toEqual(expect.objectContaining({ title: "Data Intern", department: "Technology", publishedAt: "2026-08-11T00:00:00.000Z" }));
  });

  it("crawls every Dow job through the official Coveo search API", async () => {
    const requests: string[] = [];
    const makeResult = (index: number) => ({
      title: index === 0 ? "2027 Data Science Co-op" : `Research Engineer ${index}`,
      printableUri: `https://dow.wd1.myworkdayjobs.com/ExternalCareers/job/Midland-MI-USA/Role-${index}_R${1000 + index}`,
      excerpt: "Build production systems.",
      raw: {
        dow_jobreqid: `R${1000 + index}`,
        dow_jobtitle: index === 0 ? "2027 Data Science Co-op" : `Research Engineer ${index}`,
        dow_joburl: `https://dow.wd1.myworkdayjobs.com/ExternalCareers/job/Midland-MI-USA/Role-${index}_R${1000 + index}`,
        dow_jobapplyurl: `https://dow.wd1.myworkdayjobs.com/ExternalCareers/job/Midland-MI-USA/Role-${index}_R${1000 + index}/apply`,
        dow_jobsitenames: ["Midland (MI, USA)"],
        dow_jobcities: ["U.S. & Canada//United States of America//Michigan//Midland"],
        dow_jobcountries: ["U.S. & Canada//United States of America"],
        dow_remotetype: "Hybrid",
        dow_jobreqtimetype: "Full time",
        dow_jobdescription: "<p>Build models.</p>",
        dow_jobstartdate: 1786492800000,
      },
    });
    const allResults = Array.from({ length: 101 }, (_, index) => makeResult(index));
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.includes(".dow.search.token.servlet.json")) {
        return Response.json({ org: "dow-production", token: "a-valid-ephemeral-token-value" });
      }
      if (url !== "https://dow-production.org.coveo.com/rest/search/v2") return new Response("missing detail", { status: 404 });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer a-valid-ephemeral-token-value");
      const body = JSON.parse(String(init?.body)) as { firstResult: number };
      return Response.json({ totalCount: 101, results: allResults.slice(body.firstResult, body.firstResult + 100) });
    };

    const result = await crawlSource({
      id: "legacy-row-803",
      company: "Dow",
      postingUrl: "https://corporate.dow.com/en-us/careers/jobs.html",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests.filter((url) => url === "https://dow-production.org.coveo.com/rest/search/v2")).toHaveLength(2);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://corporate.dow.com/en-us/careers/jobs.html",
    }));
    expect(result.jobs).toHaveLength(101);
    expect(result.jobs[0]).toEqual(expect.objectContaining({
      externalId: "R1000",
      title: "2027 Data Science Co-op",
      employmentType: "Internship",
      arrangement: "hybrid",
      locationCity: "Midland",
      locationState: "Michigan",
      locationCountry: "United States of America",
    }));
  });

  it("fails closed when Dow returns malformed job identities", async () => {
    const fetcher: typeof fetch = async (input) => String(input).includes(".dow.search.token.servlet.json")
      ? Response.json({ org: "dow-production", token: "a-valid-ephemeral-token-value" })
      : Response.json({ totalCount: 1, results: [{ title: "Missing official URL", raw: {} }] });

    const result = await crawlSource({
      id: "legacy-row-803",
      company: "Dow",
      postingUrl: "https://corporate.dow.com/en-us/careers/jobs.html",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result.status).toBe("succeeded");
    expect(result.completeListing).toBe(false);
    expect(result.jobs).toEqual([]);
  });

  it("crawls a Jobsyn-backed listing in bounded pages with stable official URLs", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url.href);
      if (url.hostname === "aecom.jobs") {
        return new Response('<script>const api="https://prod-search-api.jobsyn.org/api/"; const source="solr";</script>');
      }
      expect(new Headers(init?.headers).get("x-origin")).toBe("aecom.jobs");
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        jobs: [{
          guid: `guid-${page}`,
          title_exact: page === 1 ? "AI Intern" : "Data Scientist",
          title_slug: page === 1 ? "ai-intern" : "data-scientist",
          location_exact: "Los Angeles, CA",
          date_added: "2026-08-12T12:00:00Z",
          description: "Build production models.",
          job_type: page === 1 ? "Internship" : "Hybrid",
        }],
        pagination: { page, page_size: 1, total: 2, total_pages: 2, has_more_pages: page < 2 },
      });
    };

    const result = await crawlSource({
      id: "jobsyn-direct",
      company: "AECOM",
      postingUrl: "https://aecom.jobs/jobs/",
      adapter: "custom",
    }, fetcher, new Date());

    expect(requests).toHaveLength(3);
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      pagination: { nextPage: 1, cycleComplete: true, totalPages: 2 },
    }));
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "guid-1",
        title: "AI Intern",
        officialUrl: "https://aecom.jobs/los-angeles-ca/ai-intern/guid-1/job/",
      }),
      expect.objectContaining({ externalId: "guid-2", title: "Data Scientist", arrangement: "hybrid" }),
    ]);
  });

  it("uses a verified Workday tenant and promotes the canonical listing URL", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url !== "https://aes.wd1.myworkdayjobs.com/wday/cxs/aes/AES_US/jobs") {
        return new Response("missing detail", { status: 404 });
      }
      return Response.json({ total: 1, jobPostings: [{
        title: "Data Science Intern",
        externalPath: "/job/Arlington/Data-Science-Intern_R-101",
        locationsText: "Arlington, VA",
        postedOn: "Posted Today",
      }] });
    };

    const result = await crawlSource({
      id: "legacy-row-65",
      company: "AES",
      postingUrl: "https://www.aes.com/about-us/careers",
      adapter: "custom",
    }, fetcher, new Date("2026-08-12T12:00:00Z"));

    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]).toBe("https://aes.wd1.myworkdayjobs.com/wday/cxs/aes/AES_US/jobs");
    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: true,
      resolvedListingUrl: "https://aes.wd1.myworkdayjobs.com/AES_US",
    }));
  });

  it("uses a verified server-rendered listing when the company landing page hides it", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://ats.rippling.com/embed/carbon-health/jobs");
      return new Response(`<a href="https://ats.rippling.com/en-US/carbon-health/jobs/17d7e6a9-9f70-4f59-9db5-999d6a9f7a51">Applied AI Intern</a>`);
    };

    const result = await crawlSource({
      id: "p5-0841-carbon-health",
      company: "Carbon Health",
      postingUrl: "https://carbonhealth.com/careers",
      adapter: "custom",
    }, fetcher, new Date());

    expect(result).toEqual(expect.objectContaining({
      status: "succeeded",
      completeListing: false,
      resolvedListingUrl: "https://ats.rippling.com/embed/carbon-health/jobs",
    }));
    expect(result.jobs.map((job) => job.title)).toEqual(["Applied AI Intern"]);
  });

  it("uses first-party JSON endpoints for browser-only company catalogs", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://jobs.whatnot.com/api/jobs") return Response.json({ results: [{
        id: "whatnot-1", title: "AI Intern", externalLink: "https://jobs.whatnot.com/job/whatnot-1",
        locationExternalName: "San Francisco, CA", isListed: true, status: "Open",
      }] });
      if (url === "https://aurora.tech/api/jobs-index") return Response.json({ jobs: [{
        id: "aurora-1", title: "Software Engineering Intern", applyLink: "https://aurora.tech/job/aurora-1",
        locations: ["Pittsburgh, PA"], searchText: "Build autonomy software.",
      }] });
      if (url === "https://www.janestreet.com/jobs/main.json") return Response.json([{
        id: 101, position: "Data Science Intern", city: "New York", overview: "Research models.", min_salary: 100,
      }]);
      if (url === "https://guardanthealth.com/careers/jobs/") {
        return new Response('<script>var workdayApi={"ajax_url":"/wp-admin/admin-ajax.php","nonce":"nonce-1"};</script>');
      }
      if (url === "https://guardanthealth.com/wp-admin/admin-ajax.php") return Response.json({ success: true, data: { data: [{
        id: "guardant-1", title: "Machine Learning Intern", url: "https://guardant.wd5.myworkdayjobs.com/job/guardant-1",
        primaryLocation: { descriptor: "Palo Alto, CA" }, jobDescription: "Build clinical models.",
      }] } });
      if (url.startsWith("https://cg-jobstream-api.azurewebsites.net/api/job-search")) return Response.json({ total: 1, data: [{
        id: "cap-1", title: "Data Engineer Intern", apply_job_url: "https://www.capgemini.com/jobs/cap-1",
        location: "Chicago, IL", description: "Build data platforms.",
      }] });
      return new Response("missing", { status: 404 });
    };

    const sources = [
      { id: "p4-0386-whatnot", company: "Whatnot", postingUrl: "https://careers.whatnot.com/home", adapter: "custom" as const },
      { id: "p5-0812-aurora-innovation", company: "Aurora Innovation", postingUrl: "https://aurora.tech/careers", adapter: "custom" as const },
      { id: "p5-0950-jane-street", company: "Jane Street", postingUrl: "https://www.janestreet.com/join-jane-street/open-roles/", adapter: "custom" as const },
      { id: "p5-0921-guardant-health", company: "Guardant Health", postingUrl: "https://guardanthealth.com/careers/jobs/", adapter: "custom" as const },
      { id: "p4-0234-capgemini", company: "Capgemini", postingUrl: "https://www.capgemini.com/us-en/careers/career-paths/", adapter: "custom" as const },
    ];
    const results = await Promise.all(sources.map((source) => crawlSource(source, fetcher, new Date())));

    expect(results.map((result) => [result.status, result.completeListing, result.jobs.length])).toEqual([
      ["succeeded", true, 1], ["succeeded", true, 1], ["succeeded", true, 1], ["succeeded", true, 1], ["succeeded", true, 1],
    ]);
    expect(results.map((result) => result.jobs[0].title)).toEqual([
      "AI Intern", "Software Engineering Intern", "Data Science Intern", "Machine Learning Intern", "Data Engineer Intern",
    ]);
  });
});
