import { describe, expect, it } from "vitest";
import { crawlSource, discoverAts, oracleCareerSite } from "./crawler";

describe("crawlSource", () => {
  it("discovers the Oracle API tenant behind a vanity careers domain", () => {
    const html = '<script src="https://eluq.fa.us2.oraclecloud.com:443/hcmUI/CandExpStatic/app.js"></script>';
    expect(oracleCareerSite(html, "https://www.krogerfamilycareers.com/en/sites/CX_2001/jobs")).toEqual({
      apiOrigin: "https://eluq.fa.us2.oraclecloud.com",
      site: "CX_2001",
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
        content: offset === "1" ? [{ id: "2", name: "Designer", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/2" }] : [{ id: "1", name: "Engineer", ref: "https://api.smartrecruiters.com/v1/companies/Acme/postings/1" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.example/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://jobs.smartrecruiters.com/Acme/1",
      "https://jobs.smartrecruiters.com/Acme/2",
    ]);
    expect(requests).toContain("https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=1");
    expect(result.completeListing).toBe(true);
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
      return new Response(JSON.stringify({ totalCount: 2, jobs }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://careers.acme.example/jobs", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://careers.acme.example/jobs/101?lang=en-us",
      "https://careers.acme.example/jobs/102?lang=en-us",
    ]);
    expect(requests).toContain("https://careers.acme.example/api/jobs?page=2&limit=100&sortBy=relevance&descending=false&internal=false");
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
      return new Response(JSON.stringify({ count: 2, positions: [position] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://acme.eightfold.ai/careers", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
    expect(result.jobs.map((job) => job.externalId)).toEqual(["REQ-101", "REQ-102"]);
    expect(requests).toContain("https://acme.eightfold.ai/api/apply/v2/jobs?start=1&num=10&sort_by=relevance");
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
        ? { clientRequisitionID: "101", publishedJobTitle: "Engineer", jobTitle: "Engineer", postingDate: "2026-08-08T12:00:00Z", workLevelCode: "Full-time", requisitionLocations: [{ address: { cityName: "Austin", countrySubdivisionLevel1: { longName: "Texas" }, country: { longName: "United States" } } }] }
        : { clientRequisitionID: "102", publishedJobTitle: "Designer", jobTitle: "Designer", postingDate: "2026-08-07T12:00:00Z", workLevelCode: "Full-time", requisitionLocations: [] };
      return new Response(JSON.stringify({ count: 2, jobRequisitions: [job] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await crawlSource({ id: "acme", company: "Acme", postingUrl: "https://myjobs.adp.com/acme", adapter: "custom" }, fetcher, new Date());

    expect(result.completeListing).toBe(true);
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
        employmentType: "Full-Time",
        officialUrl: "https://www.tesla.com/careers/search/job/software-engineer-277001",
      })],
    }));
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
});
