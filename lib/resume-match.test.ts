import { describe, expect, it } from "vitest";
import { evaluateResumeMatch } from "./resume-match";

const base = {
  id: "job-1",
  title: "Machine Learning Intern",
  company: "Acme",
  locationRegion: "us" as const,
  programKeys: ["internship"] as const,
  summary: "",
  description: "",
  responsibilities: "",
  qualifications: "",
  skills: ["Python", "SQL"],
  jobFamily: null,
  jobFunction: null,
  educationRequirements: null,
  experienceRequirements: null,
  securityClearance: null,
  recruitingYears: [2027],
  publishedAt: "2026-08-10T00:00:00.000Z",
  firstSeenAt: "2026-08-10T00:00:00.000Z",
};

describe("Chanyoung resume matcher", () => {
  it.each([
    ["LLM Evaluation Intern", ["Python", "NLP"], "role:llm-nlp"],
    ["Data Engineering Co-op", ["SQL", "PySpark"], "role:data-engineering"],
    ["Software Developer Intern", ["JavaScript"], "role:software-engineering"],
    ["Fraud Analytics Internship", ["Python", "SQL"], "domain:aml-risk"],
  ])("matches %s with stable evidence", (title, skills, evidence) => {
    const result = evaluateResumeMatch({ ...base, title, skills });

    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.evidence.map((item) => item.code)).toContain(evidence);
  });

  it.each([
    ["Internal Audit Analyst", "us", ["internship"]],
    ["AI Recruiting Intern", "us", ["internship"]],
    ["Machine Learning Intern", "non_us", ["internship"]],
    ["Machine Learning Engineer", "us", ["regular"]],
    ["PhD Research Scientist Intern", "us", ["internship"]],
    ["High School Software Intern", "us", ["internship"]],
  ] as const)("rejects ineligible %s", (title, locationRegion, programKeys) => {
    expect(evaluateResumeMatch({ ...base, title, locationRegion, programKeys }).eligible).toBe(false);
  });

  it.each(["internal", "international", "internet"])("does not tokenize %s as intern", (word) => {
    expect(evaluateResumeMatch({ ...base, title: `${word} audit analyst` }).eligible).toBe(false);
  });

  it.each([
    "Must be a U.S. citizen",
    "Active Secret clearance required",
  ])("rejects explicit authorization gate: %s", (qualifications) => {
    expect(evaluateResumeMatch({ ...base, qualifications }).eligible).toBe(false);
  });

  it("does not reject a generic no-sponsorship statement", () => {
    const result = evaluateResumeMatch({
      ...base,
      qualifications: "Sponsorship is not available for this position.",
    });

    expect(result.eligible).toBe(true);
  });

  it("treats 2027 as a positive signal instead of a hard gate", () => {
    const result = evaluateResumeMatch({ ...base, recruitingYears: [] });

    expect(result.eligible).toBe(true);
    expect(result.evidence.map((item) => item.code)).not.toContain("year:2027");
  });

  it("trusts the indexed internship program for summer analyst titles", () => {
    const result = evaluateResumeMatch({
      ...base,
      title: "2027 Summer Analyst - Data & Analytics",
      programKeys: ["internship"],
      skills: ["Python", "SQL"],
    });

    expect(result.eligible).toBe(true);
    expect(result.exclusion).toBeNull();
  });

  it("uses bounded description evidence for broad IT internship titles", () => {
    const result = evaluateResumeMatch({
      ...base,
      title: "Intern, Information Technology 2027",
      description: "Assignments include Artificial Intelligence, Data & Analytics, cloud engineering, and emerging digital technologies. Candidates pursue a bachelor's degree in computer science.",
      skills: ["Python", "SQL"],
    });

    expect(result.eligible).toBe(true);
    expect(result.evidence.map((item) => item.code)).toContain("role:ai-ml");
  });

  it("does not approve a direct role from gate points alone", () => {
    const result = evaluateResumeMatch({
      ...base,
      skills: [],
      recruitingYears: [],
      publishedAt: null,
    });

    expect(result.eligible).toBe(false);
    expect(result.score).toBeLessThan(60);
  });
});
