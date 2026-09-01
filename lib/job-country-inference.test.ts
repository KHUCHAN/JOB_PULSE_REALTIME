import { describe, expect, it } from "vitest";
import { inferJobLocationCountry } from "./job-country-inference";

describe("inferJobLocationCountry", () => {
  it("canonicalizes the review countries from structured ATS fields", () => {
    expect(inferJobLocationCountry({ locationCountry: "US" })).toBe("United States");
    expect(inferJobLocationCountry({ locationCountry: "England" })).toBe("United Kingdom");
    expect(inferJobLocationCountry({ locationCountry: "SG" })).toBe("Singapore");
  });

  it("recovers Singapore from a multi-location Workday direct URL", () => {
    expect(inferJobLocationCountry({
      location: "4 Locations",
      officialUrl: "https://pimco.wd1.myworkdayjobs.com/pimco-careers/job/Singapore/Role_R106818-1",
    })).toBe("Singapore");
  });

  it("recovers London only when location and official Workday path agree", () => {
    expect(inferJobLocationCountry({
      location: "London",
      officialUrl: "https://capgroup.wd1.myworkdayjobs.com/capitalgroupcareers/job/London/Role_JR7201",
    })).toBe("United Kingdom");
    expect(inferJobLocationCountry({
      location: "London, ON",
      officialUrl: "https://example.wd1.myworkdayjobs.com/Careers/job/London/Role_1",
    })).toBeNull();
  });

  it("uses explicit location text before URL hints", () => {
    expect(inferJobLocationCountry({
      location: "Edinburgh, Scotland",
      officialUrl: "https://jobs.example.com/role",
    })).toBe("United Kingdom");
    expect(inferJobLocationCountry({
      location: "Singapore, Marina Bay",
      officialUrl: "https://jobs.example.com/role",
    })).toBe("Singapore");
  });
});
