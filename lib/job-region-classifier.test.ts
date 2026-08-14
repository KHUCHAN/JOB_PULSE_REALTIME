import { describe, expect, it } from "vitest";
import { classifyJobRegion } from "./job-region-classifier";

describe("classifyJobRegion", () => {
  it.each(["United States", "United States of America", "USA", "US"])(
    "classifies a structured U.S. country alias: %s",
    (locationCountry) => {
      expect(classifyJobRegion({ locationCountry, location: "Remote" })).toBe("us");
    },
  );

  it("classifies a structured non-U.S. country", () => {
    expect(classifyJobRegion({ locationCountry: "France", location: "Paris" })).toBe("non_us");
  });

  it.each([
    "Chicago, IL",
    "Charlotte, North Carolina",
    "New York, NY, United States",
    "East Syracuse, NY, 13057 USA",
  ])("recognizes a trustworthy U.S. raw location: %s", (location) => {
    expect(classifyJobRegion({ location })).toBe("us");
  });

  it.each([
    "Singapore, Marina Bay",
    "Hong Kong, Cheung Kong Center",
    "Toronto, Ontario, Canada",
    "Mississauga, Ontario",
    "Mississauga, ON",
    "Vancouver, BC V6B 1A1",
    "Paris, France",
  ])("recognizes a trustworthy non-U.S. raw location: %s", (location) => {
    expect(classifyJobRegion({ location })).toBe("non_us");
  });

  it.each(["Remote", "Flexible - Any Site", "21 Locations", "Location not specified", "CA"])(
    "keeps an ambiguous location unknown: %s",
    (location) => {
      expect(classifyJobRegion({ location })).toBe("unknown");
    },
  );

  it("classifies U.S. and non-U.S. secondary locations as mixed", () => {
    expect(classifyJobRegion({
      locationCountry: "United States",
      secondaryLocations: ["Toronto, Ontario, Canada"],
    })).toBe("mixed");
  });

  it("uses structured city and state when raw location is generic", () => {
    expect(classifyJobRegion({
      location: "Multiple locations",
      locationCity: "Austin",
      locationState: "TX",
    })).toBe("us");
  });

  it("does not let generic raw text override a structured country", () => {
    expect(classifyJobRegion({ locationCountry: "Canada", location: "Remote" })).toBe("non_us");
  });

  it("uses a narrow US source hint only when the feed omits location evidence", () => {
    expect(classifyJobRegion({
      location: "Location not specified",
      sourceCompany: "Wells Fargo",
      sourcePostingUrl: "https://www.wellsfargojobs.com/en/jobs/",
    })).toBe("us");
    expect(classifyJobRegion({
      location: "Location not specified",
      sourceCompany: "Delta Air Lines",
      sourcePostingUrl: "https://delta.avature.net/en_US/careers/SearchJobs/?jobOffset=0",
    })).toBe("us");
  });

  it("does not let a source hint override explicit non-US evidence", () => {
    expect(classifyJobRegion({
      location: "Dublin, Ireland",
      sourceCompany: "Wells Fargo",
      sourcePostingUrl: "https://www.wellsfargojobs.com/en/jobs/",
    })).toBe("non_us");
    expect(classifyJobRegion({
      location: "Bengaluru, Karnataka",
      sourceCompany: "Wells Fargo",
      sourcePostingUrl: "https://www.wellsfargojobs.com/en/jobs/",
    })).toBe("non_us");
  });

  it("does not infer US from an unrelated or non-US source URL", () => {
    expect(classifyJobRegion({
      location: "Location not specified",
      sourcePostingUrl: "https://careers.example.com/jobs",
    })).toBe("unknown");
    expect(classifyJobRegion({
      location: "Location not specified",
      sourcePostingUrl: "https://delta.avature.net/fr_FR/careers/SearchJobs",
    })).toBe("unknown");
  });
});
