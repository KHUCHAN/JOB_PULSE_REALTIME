import { describe, expect, it } from "vitest";
import { inferEmploymentTypeFromPrograms, isCoopEmploymentType, normalizeEmploymentType, workdayBulletFields } from "./employment-type";

describe("employment type normalization", () => {
  it.each([
    ["FULL_TIME", "Full-time"],
    ["Full-Time - Remote", "Full-time"],
    ["Full time Including Weekends", "Full-time"],
    ["PART_TIME", "Part-time"],
    ["INTERN", "Internship"],
    ["Co-Op (Fixed Term)", "Co-op"],
    ["Cooperative Education Student", "Co-op"],
    [["Internship", "Co-Op (Fixed Term)"], "Co-op"],
    ['["Part time","Part time"]', "Part-time"],
    [["Contract", "Contract"], "Contract"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  it.each(["R244285", "Bengaluru", "Division: Engineering", "ATS", "1", "Dematic"])(
    "rejects non-employment metadata: %s",
    (input) => expect(normalizeEmploymentType(input)).toBeNull(),
  );

  it("selects Workday employment type and department independently of bullet order", () => {
    expect(workdayBulletFields(["R2615860", "Data & AI", "Intern"]))
      .toEqual({ employmentType: "Internship", department: "Data & AI" });
  });

  it("treats explicit co-op metadata as authoritative over a generic internship label", () => {
    expect(isCoopEmploymentType("Co-Op (Fixed Term)")).toBe(true);
    expect(normalizeEmploymentType("Internship")).toBe("Internship");
    expect(inferEmploymentTypeFromPrograms(["internship", "coop"])).toBe("Co-op");
  });

  it("does not treat Workday promotion labels as a department", () => {
    expect(workdayBulletFields(["Spotlight Job", "JR0281513"]))
      .toEqual({ employmentType: null, department: null });
  });
});
