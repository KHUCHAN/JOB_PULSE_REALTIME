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
    "Software Intern (High School) - Summer 2027 Onsite",
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

  it("classifies explicit AI and data tracks without treating them as direct software roles", () => {
    expect(classifyJobAreas({
      title: "2027 Technology, Data, and Operations Internship",
      description: "Participants will gain experience within Software Development, Cybersecurity, AI & Data.",
      skills: ["AI", "software development"],
    }).map((area) => area.areaKey)).toEqual(["ai-ml", "data-analytics"]);
  });

  it("does not classify an incidental corporate AI policy mention", () => {
    expect(classifyJobAreas({
      title: "Human Resources Intern",
      description: "Candidates must follow the corporate artificial intelligence usage policy.",
    })).toEqual([]);
  });

  it.each([
    {
      title: "Human Resources Intern",
      description: "Use AI tools for drafting assistance. We embrace the responsible use of artificial intelligence in recruiting.",
    },
    {
      title: "Intern, Process Management - Summer 2027",
      description: "We embrace the responsible use of artificial intelligence (AI) to enhance the candidate experience.",
    },
    {
      title: "Supply Chain Internship",
      description: "Data Analytics majors are preferred. Gather data for demand planning and process improvements.",
    },
    {
      title: "Product Designer, Internship - US Government",
      description: "Pair qualitative methods with quantitative information, like product and usage metrics. Deliver designs with engineers.",
    },
    {
      title: "Intern, Geology & Geophysics 2027",
      description: "Geological focus with strong analytical and quantitative skills. Builds effective solutions based on available information.",
    },
    {
      title: "Spring 2027 Business Operations Internship/Co-op",
      qualifications: "Experience in corporate and business functions such as data analysis, finance, human resources, IT, legal, and supply chain.",
    },
    {
      title: "Human Resources Intern",
      description: "Assist with building learning content and internal communications for the team. The company network uses cutting-edge artificial intelligence technologies.",
    },
    {
      title: "Human Resources Intern",
      description: "Organizes and tracks multiple small tasks across two functional areas Shows curiosity about applying AI tools to everyday work.",
    },
  ])("does not turn incidental body language into a job area: $title", (input) => {
    expect(classifyJobAreas(input)).toEqual([]);
  });

  it.each([
    {
      title: "Electrical Engineering Coop (Summer/Fall 2027)",
      skills: ["software engineering collaboration", "test engineering support"],
    },
    {
      title: "Systems Engineering Intern IV, Summer 2027",
      description: "Collaborate with software engineering teams and data analytics stakeholders.",
    },
  ])("requires a direct software role rather than adjacent software mentions: $title", (input) => {
    expect(classifyJobAreas(input)).toEqual([]);
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
