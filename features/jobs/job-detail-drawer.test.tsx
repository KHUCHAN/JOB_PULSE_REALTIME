import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { RichJobPosting } from "../../lib/pulse-mappers";
import { JobDetailDrawer } from "./job-detail-drawer";

const job: RichJobPosting = {
  id: "job-1",
  sourceId: "source-1",
  company: "Acme",
  title: "Data Science Intern",
  location: "Remote",
  arrangement: "remote",
  summary: "Build models.",
  officialUrl: "https://careers.example/jobs/1",
  matchedTerms: [],
  matchScore: 0,
  firstSeenAt: "2026-08-10T00:00:00.000Z",
  lastConfirmedAt: "2026-08-10T00:00:00.000Z",
  status: "new",
  areaKeys: ["data-analytics"],
  locationRegion: "unknown",
  employmentType: "Internship",
  description: null,
  responsibilities: null,
  qualifications: null,
  skills: [],
  department: null,
  team: null,
  businessUnit: null,
  jobFamily: null,
  jobFunction: null,
  industry: null,
  office: null,
  secondaryLocations: [],
  locationCity: null,
  locationState: null,
  locationCountry: null,
  locationPostalCode: null,
  latitude: null,
  longitude: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryInterval: null,
  benefits: null,
  educationRequirements: null,
  experienceRequirements: null,
  experienceLevel: null,
  shiftSchedule: null,
  travelRequirements: null,
  securityClearance: null,
  languages: [],
  requisitionId: null,
  applyUrl: "https://careers.example/jobs/1/apply",
  sourcePostedText: null,
  sourceUpdatedAt: null,
  validThrough: null,
  publishedAt: null,
  resumeMatchScore: null,
  resumeMatchEvidence: [],
};

it("opens the stable official posting URL when an ATS apply URL is also present", () => {
  render(<JobDetailDrawer job={job} onClose={vi.fn()} onChangeState={vi.fn()} />);

  expect(screen.getByRole("link", { name: /Open official job page/ }))
    .toHaveAttribute("href", job.officialUrl);
});

it("explains a personal resume match without exposing raw rule codes", () => {
  render(<JobDetailDrawer job={{
    ...job,
    resumeMatchScore: 92,
    resumeMatchEvidence: ["AI or machine learning role", "Python or PySpark"],
  }} onClose={vi.fn()} onChangeState={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "Why this matches" })).toBeInTheDocument();
  expect(screen.getByText("92% Match")).toBeInTheDocument();
  expect(screen.getByText("Python or PySpark")).toBeInTheDocument();
});
