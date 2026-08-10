import { describe, expect, it } from "vitest";
import { normalizeEmploymentType, workdayBulletFields } from "./employment-type";

describe("employment type normalization", () => {
  it.each([
    ["FULL_TIME", "Full-time"],
    ["Full-Time - Remote", "Full-time"],
    ["Full time Including Weekends", "Full-time"],
    ["PART_TIME", "Part-time"],
    ["INTERN", "Internship"],
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
});
