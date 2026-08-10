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
  it("discovers the Oracle API tenant behind a vanity careers domain", () => {
    const html = '<script src="https://eluq.fa.us2.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script>';
    expect(oracleCareerSite(html, "https://www.krogerfamilycareers.com/en/sites/CX_2001/jobs")).toEqual({
      apiOrigin: "https://eluq.fa.us2.oraclecloud.com",
      site: "CX_2001",
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
      if (url === "https://careers.acme.example/jobs") {
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

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

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
      const position = start === 0
        ? { id: 101, name: "Engineer", location: "Remote", ats_job_id: "REQ-101", canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/101", t_create: 1785888000 }
        : { id: 102, name: "Designer", location: "New York, NY", ats_job_id: "REQ-102", canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/102", t_create: 1785801600 };
      return new Response(JSON.stringify({
        count: 2,
        facets: { department: { Engineering: 2 }, skills: { Python: 1 }, seniority: { Senior: 1 } },
        positions: [{ ...position, department: "Engineering", business_unit: "Technology", type: "Full-time", job_description: "Build reliable systems." }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.eightfold.ai/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs[0]).toEqual(expect.objectContaining({ department: "Engineering", businessUnit: "Technology", employmentType: "Full-time", description: "Build reliable systems." }));
    expect(result.facets).toEqual(expect.arrayContaining([
      { key: "department", label: "Department", values: [{ key: "Engineering", label: "Engineering", count: 2 }] },
      { key: "skills", label: "Skills", values: [{ key: "Python", label: "Python", count: 1 }] },
    ]));
    expect(result.jobs.map((job) => job.externalId)).toEqual(["REQ-101", "REQ-102"]);
    expect(requests).toContain("https://acme.eightfold.ai/api/apply/v2/jobs?start=1&num=10&sort_by=relevance");
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
        employmentType: "FULL_TIME",
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
        geo: [{ id: "5", sites: [{ id: "US", cities: { Austin: ["77"] } }] }],
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
      completeListing: true,
      jobs: [expect.objectContaining({
        externalId: "JR-100",
        title: "Security Engineer",
        location: "Austin, TX",
        department: "Engineering",
        sourcePostedText: "Posted 2 Days Ago",
        publishedAt: "2026-08-06T12:30:00.000Z",
        officialUrl: "https://acme.wd5.myworkdayjobs.com/job/Austin-TX/Security-Engineer_JR-100",
      })],
      facets: [{ key: "jobFamilyGroup", label: "Job Category", values: [{ key: "eng", label: "Engineering", count: 1 }] }],
    }));
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

    expect(result.jobs[0].officialUrl).toBe("https://acme.wd5.myworkdayjobs.com/job/New-York/Risk-Analyst_R-42");
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

  it("extracts public Phenom jobs embedded in a careers search page", async () => {
    const fetcher: typeof fetch = async () => new Response(`
      <script>var phApp = phApp || {}; phApp.ddo = {"eagerLoadRefineSearch":{"data":{"totalHits":2,"jobs":[
        {"title":"AI Engineer","jobId":"R42","location":"Remote, United States","type":"Full time","descriptionTeaser":"Build useful AI.","applyUrl":"https://jobs.example/apply/R42","postedDate":"2026-08-08T00:00:00.000+0000"},
        {"title":"Incomplete"}
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
});
