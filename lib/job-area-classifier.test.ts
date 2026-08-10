import { describe, expect, it } from "vitest";
import { classifyJobAreas } from "./job-area-classifier";

const keysFor = (title: string) => classifyJobAreas({ title }).map((area) => area.areaKey);

describe("classifyJobAreas", () => {
  it("classifies a role into every directly supported area", () => {
    expect(keysFor("Machine Learning Software Engineer Intern")).toEqual([
      "ai-ml",
      "software-engineering",
    ]);
  });

  it.each([
    "Summer 2027 Quantitative Research Internship",
    "Feasibility Informatics Internship/Co-Op Spring 2027",
    "2027 Strategy & Analytics Internship",
    "Business Intelligence Intern",
    "Operations Research Summer Analyst",
  ])("classifies a direct data, analytics, or quant role: %s", (title) => {
    expect(keysFor(title)).toEqual(["data-analytics"]);
  });

  it.each([
    "Spring 2027 Software Engineering Internship/Co-op",
    "Backend Developer Intern",
    "Full-Stack Engineer Internship",
    "iOS Software Developer Intern",
    "Firmware Engineer Co-op",
  ])("classifies a direct software engineering role: %s", (title) => {
    expect(keysFor(title)).toEqual(["software-engineering"]);
  });

  it.each([
    "2027 Auditor Development Program (Intern Conversion)",
    "Intern, Sustainable Development 2027",
    "2027 Product Development Internship",
    "Human Resources Leadership Development Program Intern",
    "Cloud Engineering Intern",
    "Security Engineer Intern",
    "Systems Engineering Co-op",
    "Hardware Engineer Intern",
    "Actuarial Internship (Summer 2027)",
  ])("does not broaden direct software or data scope: %s", (title) => {
    expect(keysFor(title)).toEqual([]);
  });

  it("classifies a generic IT internship from independent AI and data body evidence", () => {
    expect(classifyJobAreas({
      title: "Intern, Information Technology 2027",
      description: "Assignments include Artificial Intelligence and Data &amp; Analytics.",
    }).map((area) => area.areaKey)).toEqual(["ai-ml", "data-analytics"]);
  });

  it("does not classify an incidental corporate AI policy mention", () => {
    expect(classifyJobAreas({
      title: "Human Resources Intern",
      description: "Candidates must follow the corporate artificial intelligence usage policy.",
    })).toEqual([]);
  });

  it("uses direct skill evidence for a generic title", () => {
    expect(classifyJobAreas({
      title: "Research Intern",
      skills: ["PyTorch", "Machine Learning"],
    }).map((area) => area.areaKey)).toEqual(["ai-ml"]);
  });

  it("returns deterministic, deduplicated evidence", () => {
    const result = classifyJobAreas({
      title: "Data Science and Machine Learning Intern",
      skills: ["PyTorch", "PyTorch"],
    });

    expect(result).toEqual(classifyJobAreas({
      title: "Data Science and Machine Learning Intern",
      skills: ["PyTorch", "PyTorch"],
    }));
    for (const area of result) expect(new Set(area.evidence).size).toBe(area.evidence.length);
  });
});
