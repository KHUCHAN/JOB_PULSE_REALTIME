import { describe, expect, it } from "vitest";
import { classifyAiDataJob } from "./job-topic-classifier";

describe("classifyAiDataJob", () => {
  it.each([
    "Senior Machine Learning Engineer",
    "Data Scientist, Product Analytics",
    "Data Engineer",
    "MLOps Platform Engineer",
    "Computer Vision Research Scientist",
    "Business Intelligence Analyst",
  ])("classifies a strong AI/data role title: %s", (title) => {
    expect(classifyAiDataJob({ title })).toMatchObject({
      topicKey: "ai-data",
      matched: true,
    });
  });

  it("classifies strong organization and skill evidence even when the title is generic", () => {
    expect(classifyAiDataJob({
      title: "Software Engineer II",
      team: "Generative AI",
      skills: ["PyTorch"],
    })).toMatchObject({ matched: true });
  });

  it("classifies two independent supporting signals in body text", () => {
    const result = classifyAiDataJob({
      title: "Platform Engineer",
      description: "Build predictive models and productionize ML workflows with feature engineering.",
    });

    expect(result.matched).toBe(true);
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("does not classify a single incidental AI mention", () => {
    expect(classifyAiDataJob({
      title: "Account Executive",
      description: "Use AI tools to take meeting notes.",
    })).toMatchObject({ matched: false });
  });

  it("does not double-count duplicated summary and description boilerplate", () => {
    expect(classifyAiDataJob({
      title: "Financial Reporting Analyst",
      summary: "Our company invests in artificial intelligence (AI).",
      description: "Our company invests in artificial intelligence (AI).",
      qualifications: "Follow the corporate AI policy.",
    })).toMatchObject({ matched: false });
  });

  it("classifies generic titles only when body evidence has multiple distinct domain signals", () => {
    expect(classifyAiDataJob({
      title: "Software Engineer",
      description: "Build machine learning systems powered by large language models.",
    })).toMatchObject({ matched: true });
  });

  it.each([
    "Paid Media Manager",
    "Retail Training Manager",
    "Email Marketing Lead",
  ])("does not match short AI or ML tokens inside unrelated words: %s", (title) => {
    expect(classifyAiDataJob({ title })).toMatchObject({ matched: false });
  });

  it("returns deterministic deduplicated evidence", () => {
    const input = {
      title: "Machine Learning Engineer",
      summary: "Machine learning systems",
      skills: ["PyTorch", "PyTorch"],
    };

    expect(classifyAiDataJob(input)).toEqual(classifyAiDataJob(input));
    const evidence = classifyAiDataJob(input).evidence;
    expect(new Set(evidence).size).toBe(evidence.length);
  });

  it("ignores non-string ATS metadata instead of failing the crawl persistence step", () => {
    expect(() => classifyAiDataJob({
      title: "Software Engineer",
      department: { label: "Engineering" } as unknown as string,
      skills: [42 as unknown as string, "PyTorch"],
    })).not.toThrow();
    expect(classifyAiDataJob({
      title: "Software Engineer",
      department: { label: "Engineering" } as unknown as string,
      skills: [42 as unknown as string, "PyTorch"],
    })).toMatchObject({ matched: true });
  });
});
