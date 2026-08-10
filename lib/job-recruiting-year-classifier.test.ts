import { describe, expect, it } from "vitest";
import { classifyRecruitingYears } from "./job-recruiting-year-classifier";

describe("classifyRecruitingYears", () => {
  it("does not turn a graduation window into extra recruiting cycles", () => {
    expect(classifyRecruitingYears({
      title: "Intern, Information Technology 2027",
      description: "Expected graduation date: Fall 2027 through Spring/Fall 2030. Available for internship start mid-late May 2027.",
      location: "Bartlesville, OK",
      locationCountry: "United States",
      publishedAt: "2026-08-01T00:00:00.000Z",
      programKeys: ["internship"],
    })).toEqual({
      years: [2027],
      evidence: { 2027: "title:explicit-year" },
    });
  });

  it("does not infer a US cycle for a non-program role", () => {
    expect(classifyRecruitingYears({
      title: "Software Engineer",
      location: "Chicago, IL",
      publishedAt: "2026-08-07T00:00:00.000Z",
      programKeys: [],
    })).toEqual({ years: [], evidence: {} });
  });
});
