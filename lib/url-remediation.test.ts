import { describe, expect, it } from "vitest";
import { careerCandidates, detectUrlAdapter, isPublicAtsCatalogUrl, isSafeCareerListingUrl, isSafeCareerRecommendation, rankCareerLink, unwrapSearchResultUrl } from "./url-remediation";

describe("career URL remediation", () => {
  it("prefers a public ATS job board over talent-only and social links", () => {
    const links = [
      { href: "https://linkedin.com/company/acme", text: "LinkedIn" },
      { href: "https://jobs.acme.com/us/en/jointalentcommunity", text: "Join talent community" },
      { href: "https://jobs.acme.com/us/en/search-results", text: "Search jobs" },
    ];
    expect(careerCandidates(links, "https://acme.com/careers")[0].href).toBe("https://jobs.acme.com/us/en/search-results");
  });

  it("ranks official ATS links highly", () => {
    expect(rankCareerLink({ href: "https://jobs.lever.co/acme", text: "Open roles" }, "https://acme.com/careers")).toBeGreaterThan(100);
  });

  it("recognizes opaque public ATS catalogs linked from an official careers page", () => {
    expect(isPublicAtsCatalogUrl("https://career8.successfactors.com/career?company=amkor")).toBe(true);
    expect(isPublicAtsCatalogUrl("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=tenant")).toBe(true);
    expect(isPublicAtsCatalogUrl("https://employee-alaskaair.icims.com/jobs/login")).toBe(false);
    expect(isPublicAtsCatalogUrl("https://silenteight.teamtailor.com/jobs")).toBe(true);
    expect(isPublicAtsCatalogUrl("https://jobs.gusto.com/boards/closedloop-board-id")).toBe(true);
  });

  it("recognizes a company-branded .jobs catalog even when the CTA text is generic", () => {
    const links = [{ href: "https://aecom.jobs/", text: "Apply now" }];
    expect(careerCandidates(links, "https://aecom.com/careers")).toEqual(links);
    expect(isSafeCareerRecommendation("AECOM", "https://aecom.com/careers", links[0].href)).toBe(true);
  });

  it("prefers an all-jobs search over a single department landing page", () => {
    const links = [
      { href: "https://jobs.acme.com/sales-jobs", text: "See all sales jobs" },
      { href: "https://jobs.acme.com/search-jobs", text: "Search all jobs" },
    ];
    expect(careerCandidates(links, "https://jobs.acme.com/")[0].href).toBe("https://jobs.acme.com/search-jobs");
  });

  it("detects Phenom from loaded resources", () => {
    expect(detectUrlAdapter("https://careers.acme.com/search-results", ["https://cdn.phenompeople.com/app.js"])).toBe("phenom");
  });

  it("detects Ashby boards as API-backed sources", () => {
    expect(detectUrlAdapter("https://jobs.ashbyhq.com/cerebras")).toBe("ashby");
  });

  it("detects Dayforce boards as API-backed sources", () => {
    expect(detectUrlAdapter("https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL")).toBe("dayforce");
  });

  it("detects SmartRecruiters boards as API-backed sources", () => {
    expect(detectUrlAdapter("https://careers.smartrecruiters.com/Acme")).toBe("smartrecruiters");
  });

  it("rejects individual job detail pages as catalog URLs", () => {
    const detail = { href: "https://careers.example/jobs/staff-engineer-123", text: "Staff Engineer" };
    expect(careerCandidates([detail], "https://careers.example/jobs/search")).toEqual([]);
  });

  it("accepts company-related official career domains and rejects unrelated articles", () => {
    expect(isSafeCareerRecommendation("RTX", "https://rtx.com/careers", "https://careers.rtx.com/global/en")).toBe(true);
    expect(isSafeCareerRecommendation("Live Nation", "https://livenationentertainment.com/careers", "https://rankings.newsweek.com/job-starters")).toBe(false);
  });

  it("rejects career-area and job-cart pages", () => {
    expect(isSafeCareerRecommendation("Caterpillar", "https://caterpillar.com/careers", "https://careers.caterpillar.com/en/career-areas/")).toBe(false);
    expect(isSafeCareerRecommendation("Ascension", "https://jobs.ascension.org", "https://jobs.ascension.org/us/en/jobcart")).toBe(false);
  });

  it("accepts same-root career subdomains and company-branded career domains", () => {
    expect(isSafeCareerRecommendation("Illinois Tool Works", "https://jobs.itw.com/", "https://careers.itw.com/us/en")).toBe(true);
    expect(isSafeCareerRecommendation("MetLife", "https://metlife.com/careers", "https://metlifecareers.com/en_US/ml")).toBe(true);
  });

  it("decodes Bing redirect targets before validating search results", () => {
    const target = "https://jobs.centene.com/us/en/jobs/";
    const encoded = Buffer.from(target).toString("base64url");
    expect(unwrapSearchResultUrl(`https://www.bing.com/ck/a?u=a1${encoded}&ntb=1`)).toBe(target);
  });

  it("rejects third-party job aggregators even when the company appears in the path", () => {
    expect(isSafeCareerRecommendation("Tesla", "https://tesla.com/careers", "https://ev.careers/tesla-jobs")).toBe(false);
    expect(isSafeCareerRecommendation("Devon Energy", "https://devonenergy.com/careers", "https://gotocareer.io/companies/devon-energy")).toBe(false);
  });

  it("rejects vendor, support, talent-only, parent-company, and global aggregator recovery pages", () => {
    expect(isSafeCareerListingUrl("Rain AI", "https://www.rain.ai/careers", "https://www.ashbyhq.com/")).toBe(false);
    expect(isSafeCareerListingUrl("Graylog", "https://graylog.org/careers", "https://www.lever.co/job-seeker-support")).toBe(false);
    expect(isSafeCareerListingUrl("NBCUniversal", "https://www.nbcunicareers.com/talent-community", "https://www.nbcunicareers.com/talent-community")).toBe(false);
    expect(isSafeCareerListingUrl("Replicate", "https://replicate.com/careers", "https://www.cloudflare.com/careers/")).toBe(false);
    expect(isSafeCareerListingUrl("Pixley AI", "https://www.ycombinator.com/companies/pixley/jobs", "https://www.ycombinator.com/jobs")).toBe(false);
  });

  it("accepts the company's exact ATS catalog and branded cross-domain board", () => {
    expect(isSafeCareerListingUrl("Bitstamp", "https://apply.workable.com/bitstamp/", "https://apply.workable.com/bitstamp/")).toBe(true);
    expect(isSafeCareerListingUrl("Oportun", "https://www.oportun.com/careers", "https://job-boards.greenhouse.io/oportun")).toBe(true);
  });

  it("admits only LinkedIn's own exact company-jobs catalog", () => {
    const listing = "https://www.linkedin.com/company/linkedin/jobs/";
    expect(isSafeCareerListingUrl("LinkedIn (Microsoft)", listing, listing)).toBe(true);
    expect(isSafeCareerListingUrl("Another Company", listing, listing)).toBe(false);
    expect(isSafeCareerListingUrl("LinkedIn (Microsoft)", listing, "https://www.linkedin.com/jobs/linkedin-jobs")).toBe(false);
  });

  it("admits FedEx's exact filtered US catalog without treating page one as a job detail", () => {
    const catalog = "https://careers.fedex.com/jobs/page/1?page_size=100&filter%5Bcountry%5D=United+States&sort_by=update_date";
    expect(isSafeCareerListingUrl("FedEx", catalog, catalog)).toBe(true);
    expect(isSafeCareerListingUrl("FedEx", catalog, "https://careers.fedex.com/jobs/page/1?page_size=100&sort_by=update_date")).toBe(false);
  });

  it("accepts exact verified opaque catalogs and canonical listing redirects", () => {
    expect(isSafeCareerListingUrl("Honor", "https://www.honorcare.com/honor-careers/", "https://www.honorcare.com/honor-careers/")).toBe(true);
    expect(isSafeCareerListingUrl("Kratos Defense", "https://kratosdefense.submit4jobs.com/", "https://kratosdefense.submit4jobs.com/")).toBe(true);
    expect(isSafeCareerListingUrl("ibis.ai", "https://ibis.ai/jobs.html", "https://ibis.ai/jobs.html")).toBe(true);
    expect(isSafeCareerListingUrl("Cathay Bank", "https://cathaygbcp.rec.pro.ukg.net/CAT1503CATB/JobBoard/tenant/", "https://cathaygbcp.rec.pro.ukg.net/CAT1503CATB/JobBoard/tenant/")).toBe(true);
    expect(isSafeCareerListingUrl("LoanDepot", "https://jobs.jobvite.com/loandepot/jobAlerts", "https://jobs.jobvite.com/loandepot/jobs/positions")).toBe(true);
    expect(isSafeCareerListingUrl("State Attorneys General", "https://www.calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx#depid=148", "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx#depid=148")).toBe(true);
  });

  it("does not let exact-source admission turn a job detail or aggregator into a catalog", () => {
    expect(isSafeCareerListingUrl("Acme", "https://careers.acme.com/jobs/staff-engineer-123", "https://careers.acme.com/jobs/staff-engineer-123")).toBe(false);
    expect(isSafeCareerListingUrl("Acme", "https://indeed.com/jobs?q=acme", "https://indeed.com/jobs?q=acme")).toBe(false);
  });

  it("admits only CGI's exact official Njoyn US tenant", () => {
    const listing = "https://cgi.njoyn.com/CORP/xweb/xweb.asp?CLID=21001&page=JobListing&lang=1&CountryID=US";
    expect(isSafeCareerListingUrl("CGI", "https://www.cgi.com/en/careers", listing)).toBe(true);
    expect(isSafeCareerListingUrl("CGI", listing, listing)).toBe(true);
    expect(isSafeCareerListingUrl("CGI", "https://www.cgi.com/en/careers", listing.replace("21001", "99999"))).toBe(false);
    expect(isSafeCareerListingUrl("CGI", listing.replace("21001", "99999"), listing)).toBe(false);
    expect(isSafeCareerListingUrl("Another Company", "https://example.com/careers", listing)).toBe(false);
  });
});
