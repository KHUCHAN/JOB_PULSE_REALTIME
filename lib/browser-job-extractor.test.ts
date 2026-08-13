import { describe, expect, it } from "vitest";
import { jobsFromBrowserAnchors } from "./browser-job-extractor";

const source = { id: "acme", company: "Acme", postingUrl: "https://acme.com/careers", adapter: "custom" as const };

describe("jobsFromBrowserAnchors", () => {
  it("keeps official job details and supported ATS details", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/jobs/risk-analyst", text: "Senior Risk Analyst" },
      { href: "https://jobs.lever.co/acme/abc-123", text: "Remote Data Engineer" },
      { href: "https://evil.example/jobs/acme", text: "Copied Acme role" },
    ], source);
    expect(jobs.map((job) => job.title)).toEqual(["Senior Risk Analyst", "Remote Data Engineer"]);
    expect(jobs[1].arrangement).toBe("remote");
  });

  it("accepts only exact Jobvite detail paths and keeps their requisition id", () => {
    const jobvite = { ...source, company: "LogRhythm", postingUrl: "https://jobs.jobvite.com/exabeam/#openings" };
    const jobs = jobsFromBrowserAnchors([
      { href: "/exabeam/job/oEgCAfwQ", text: "Country Manager" },
      { href: "/exabeam/jobs/", text: "Careers Home" },
      { href: "/exabeam/jobs#openings", text: "Search Openings" },
      { href: "/exabeam/apply", text: "General Application" },
      { href: "/cdn-cgi/l/email-protection", text: "[email protected]" },
    ], jobvite);

    expect(jobs).toEqual([expect.objectContaining({
      externalId: "oEgCAfwQ",
      title: "Country Manager",
      officialUrl: "https://jobs.jobvite.com/exabeam/job/oEgCAfwQ",
    })]);
  });

  it("keeps Rippling job details linked by an official company careers page", () => {
    const jobs = jobsFromBrowserAnchors([{
      href: "https://ats.rippling.com/positron/jobs/6bc9d718-770b-48da-b9ea-d86b70705d39",
      text: "Software Engineer",
    }], { ...source, company: "Positron" });

    expect(jobs).toEqual([expect.objectContaining({
      externalId: "6bc9d718-770b-48da-b9ea-d86b70705d39",
      title: "Software Engineer",
    })]);
  });

  it("keeps server-rendered job.html detail links with a stable id", () => {
    const jobs = jobsFromBrowserAnchors([{
      href: "/job.html?id=2026-36450&category=Engineering",
      text: "Software Engineering Intern",
    }], { ...source, postingUrl: "https://www.group1careers.com/results", company: "Group 1 Automotive" });

    expect(jobs).toEqual([expect.objectContaining({
      externalId: "2026-36450",
      title: "Software Engineering Intern",
      officialUrl: "https://www.group1careers.com/job.html?id=2026-36450&category=Engineering",
    })]);
  });

  it("keeps Sonic and HRMDirect query-based job details", () => {
    const sonic = jobsFromBrowserAnchors([{
      href: "/job-detail?job=744000143190129&post_date=2026-08-12",
      text: "Automotive Service Technician",
    }], { ...source, postingUrl: "https://jobs.sonicautomotive.com/search", company: "Sonic Automotive" });
    const hrmDirect = jobsFromBrowserAnchors([{
      href: "/employment/job-opening.php?req=3750384&req_loc=12345",
      text: "Senior Process Engineer",
    }], { ...source, postingUrl: "https://ao-inc.hrmdirect.com/employment/job-openings.php?search=true", company: "Applied Optoelectronics" });

    expect(sonic).toEqual([expect.objectContaining({
      externalId: "744000143190129",
      title: "Automotive Service Technician",
    })]);
    expect(hrmDirect).toEqual([expect.objectContaining({
      externalId: "3750384",
      title: "Senior Process Engineer",
    })]);
  });

  it("derives the role title from an official career application query", () => {
    const jobs = jobsFromBrowserAnchors([{
      href: "/career-application/?jobtitle=Field+Service+Engineer+-+Phoenix%2C+AZ",
      text: "Apply Now",
    }], { ...source, postingUrl: "https://www.acm-usa.com/careers/", company: "ACM Research" });

    expect(jobs).toEqual([expect.objectContaining({
      title: "Field Service Engineer - Phoenix, AZ",
      officialUrl: "https://www.acm-usa.com/career-application/?jobtitle=Field+Service+Engineer+-+Phoenix%2C+AZ",
    })]);
  });

  it("keeps provider-specific job details and case-insensitive query identities", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "/index.php?m=cpcareers&a=show&joborderid=1327234", text: "AI Security Engineer" },
      { href: "/careersmarketplace/PipelineDetail/Clinical-Transformation/16097", text: "Project Manager - Clinical Transformation" },
      { href: "/Search/JobDetail/R50033163/director-systems-engineering", text: "Director, Systems Engineering" },
      { href: "/careersmarketplace/JobDetail?jobId=2929", text: "Software Engineering Director" },
    ], { ...source, postingUrl: "https://careers.acme.com/search" });

    expect(jobs).toEqual([
      expect.objectContaining({ externalId: "1327234", title: "AI Security Engineer" }),
      expect.objectContaining({ title: "Project Manager - Clinical Transformation" }),
      expect.objectContaining({ title: "Director, Systems Engineering" }),
      expect.objectContaining({ externalId: "2929", title: "Software Engineering Director" }),
    ]);
  });

  it("keeps role-titled career slugs and anchored single-page openings", () => {
    const careerJobs = jobsFromBrowserAnchors([
      { href: "/careers/account-executive", text: "Account Executive (Founding)" },
      { href: "/company/careers/b0570329-6c45-4446-9314-146c9dead90b", text: "Director, Legal Engineering" },
    ], source);
    const anchoredJobs = jobsFromBrowserAnchors([
      { href: "/jobs#senior-backend-developer", text: "Senior backend developer" },
    ], { ...source, postingUrl: "https://acme.com/jobs" });

    expect(careerJobs).toHaveLength(2);
    expect(anchoredJobs).toEqual([expect.objectContaining({
      externalId: "senior-backend-developer",
      officialUrl: "https://acme.com/jobs#senior-backend-developer",
    })]);
  });

  it("rejects same-path sorting and facet links without a job identity", () => {
    expect(jobsFromBrowserAnchors([
      { href: "/us/career/jobs/career-jobboard_251573.html", text: "Region" },
      { href: "/us/career/jobs/career-jobboard_251573.html?sort=region", text: "Region" },
      { href: "/us/career/jobs/career-jobboard_251573.html?showFavorites=1", text: "Show all favorites" },
      { href: "/us/career/jobs/career-jobboard_251573.html?term=engineering", text: "Functional area" },
    ], { ...source, postingUrl: "https://acme.com/us/career/jobs/career-jobboard_251573.html" })).toEqual([]);
  });

  it("does not mistake editorial career articles for role-titled career children", () => {
    expect(jobsFromBrowserAnchors([{
      href: "/en/article/careers/aditya-day-life-data-engineer",
      text: "Article Aditya: A day in the life of a data engineer",
    }], { ...source, postingUrl: "https://acme.com/en/careers" })).toEqual([]);
  });

  it("trims Infosys listing-card prose down to the official role title", () => {
    const jobs = jobsFromBrowserAnchors([{
      href: "/global-careers/company-job/description/reqid/152164BR",
      text: "Process Specialist Austin, TX &nbsp;- USA 152164BR Job Description: lengthy preview Apply",
    }], { ...source, postingUrl: "https://digitalcareers.infosys.com/infosys/global-careers?location=USA" });

    expect(jobs).toEqual([expect.objectContaining({
      title: "Process Specialist",
      officialUrl: "https://digitalcareers.infosys.com/global-careers/company-job/description/reqid/152164BR",
    })]);
  });

  it("rejects listing links and generic navigation", () => {
    expect(jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/search-jobs", text: "Search jobs" },
      { href: "https://acme.com/careers/jobs/123", text: "Apply now" },
      { href: "https://acme.com/careers/open-positions", text: "Your Privacy Choices" },
      { href: "https://acme.com/company/careers/culture", text: "Culture" },
      { href: "https://acme.com/company/careers/benefits", text: "Benefits" },
      { href: "https://acme.com/careers/view-jobs.html", text: "View Open Roles" },
      { href: "https://acme.com/careers/jobs", text: "Find your future" },
      { href: "https://acme.com/company/careers/teams-people.html", text: "Teams & People" },
      { href: "https://acme.com/company/careers/early-career/edge-student-programs.html", text: "Student Programs" },
      { href: "https://acme.com/jobs/search?page=3", text: "Skip to jobs search results" },
      { href: "https://acme.com/careers/positions/filter?location=Denver", text: "View Jobs" },
      { href: "https://acme.com/jobs/search?pr=2", text: "Page 3 of 4" },
      { href: "https://acme.com/jobs/search", text: "Chinese (Simplified)" },
      { href: "https://acme.com/jobs/search", text: "Your Privacy Choices" },
      { href: "https://acme.com/jobs/search", text: "View Finance Opportunities" },
      { href: "https://acme.com/jobs/skip", text: "Skip to main content" },
      { href: "https://acme.com/jobs/open", text: "Search Open Jobs" },
      { href: "https://acme.com/jobs/all", text: "View All Roles" },
      { href: "https://acme.com/jobs/help", text: "Click Here" },
      { href: "https://acme.com/jobs/states", text: "Search All California Jobs" },
      { href: "https://acme.com/careers/programs/explore", text: "Explore Opportunities" },
      { href: "https://acme.com/careers/talent/join", text: "Join Our Talent Community" },
      { href: "https://acme.com/careers/company/benefits", text: "Benefits" },
      { href: "https://login-acme.icims.com/jobs/login?loginOnly=1", text: "here." },
      { href: "https://acme.com/join/talentcommunity/form", text: "Form" },
    ], source)).toEqual([]);
  });

  it("rejects malformed encoded-quote and backslash URLs", () => {
    expect(jobsFromBrowserAnchors([
      { href: "https://jobs.acme.com/%22/jobs/%22", text: "Internal jobs" },
      { href: "https://jobs.acme.com/jobs\\engineering", text: "Engineering jobs" },
    ], { ...source, postingUrl: "https://jobs.acme.com" })).toEqual([]);
  });

  it("rejects unresolved client-side URL templates", () => {
    expect(jobsFromBrowserAnchors([
      { href: "https://jobs.acme.com/jobs/{{assessmentUrl}}", text: "Assessment" },
    ], { ...source, postingUrl: "https://jobs.acme.com" })).toEqual([]);
  });

  it("rejects deep navigation, self anchors, and ATS document links that masquerade as jobs", () => {
    expect(jobsFromBrowserAnchors([
      { href: "#main-content", text: "Skip to main content" },
      { href: "/company/careers/resources/interviewing/recruitment-fraud", text: "here" },
      { href: "https://cdn.phenompeople.com/resources/eeo-statement.pdf", text: "Know Your Rights" },
    ], {
      ...source,
      postingUrl: "https://acme.com/company/careers/all-jobs",
    })).toEqual([]);
  });

  it("keeps a corporate career detail whose slug carries a requisition id", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/company/careers/engineering/staff-engineer-8487325002", text: "Staff Engineer" },
    ], source);

    expect(jobs.map((job) => job.officialUrl)).toEqual([
      "https://acme.com/company/careers/engineering/staff-engineer-8487325002",
    ]);
  });

  it("keeps an Ultipro opportunity detail identified by opportunityId", () => {
    const ultipro = { ...source, postingUrl: "https://recruiting.ultipro.com/PEN1024/JobBoard/board" };
    const jobs = jobsFromBrowserAnchors([{
      href: "https://recruiting.ultipro.com/PEN1024/JobBoard/board/OpportunityDetail?opportunityId=1f447539-e5ba-45b5-a973-4b9d59c802d3",
      text: "Financial Coordinator - Tickets",
    }], ultipro);

    expect(jobs).toEqual([expect.objectContaining({
      externalId: "1f447539-e5ba-45b5-a973-4b9d59c802d3",
      title: "Financial Coordinator - Tickets",
    })]);
  });

  it("keeps EPAM-style vacancy detail links", () => {
    const epam = { ...source, postingUrl: "https://careers.epam.com/en/jobs/united_states_of_america" };
    const jobs = jobsFromBrowserAnchors([{
      href: "https://careers.epam.com/en/vacancy/kdb-developer-blt00a7c484be80494c_en",
      text: "KDB Developer",
    }], epam);

    expect(jobs).toEqual([expect.objectContaining({
      title: "KDB Developer",
      officialUrl: "https://careers.epam.com/en/vacancy/kdb-developer-blt00a7c484be80494c_en",
    })]);
  });

  it("keeps DirectEmployers detail links with a stable requisition identity", () => {
    const directEmployers = { ...source, postingUrl: "https://aecom.jobs/" };
    const jobs = jobsFromBrowserAnchors([{
      href: "https://aecom.jobs/brisbane-aus/senior-data-engineer/5771DC0FBDBA47DFB2B7099C488139C7/job/",
      text: "Senior Data Engineer",
    }], directEmployers);

    expect(jobs).toEqual([expect.objectContaining({
      title: "Senior Data Engineer",
      officialUrl: "https://aecom.jobs/brisbane-aus/senior-data-engineer/5771DC0FBDBA47DFB2B7099C488139C7/job/",
    })]);
  });

  it("derives a real title from a detail URL when the anchor is a generic CTA", () => {
    const jobs = jobsFromBrowserAnchors([
      { href: "https://acme.com/careers/openings/data/senior-data-scientist-network-value/", text: "See role" },
      { href: "https://acme.com/about-us/careers/senior-accountant-financial-reporting", text: "View job details" },
      { href: "https://acme.com/jobs/3014/rf-ms-ic-design-engineer/job", text: "View Listing" },
    ], source);

    expect(jobs.map((job) => job.title)).toEqual([
      "Senior Data Scientist Network Value",
      "Senior Accountant Financial Reporting",
      "Rf Ms Ic Design Engineer",
    ]);
  });

  it("never treats careers blog profiles as live job postings", () => {
    expect(jobsFromBrowserAnchors([{
      href: "https://www.hubspot.com/careers-blog/meet-elizabeth-premium-customer-support-specialist",
      text: "Meet Elizabeth: Premium Customer Support Specialist",
    }], {
      ...source,
      company: "HubSpot",
      postingUrl: "https://www.hubspot.com/careers-blog",
    })).toEqual([]);
  });
});
