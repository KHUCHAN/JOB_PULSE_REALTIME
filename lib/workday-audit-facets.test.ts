import { expect, it } from "vitest";
import { auditWorkdayFacets } from "./workday-audit-facets";
it("uses nested official US locations when no country facet exists", () => {
  expect(auditWorkdayFacets([{ facetParameter: "group", values: [{ facetParameter: "locations", values: [
    { id: "a", descriptor: "US, Arizona, Phoenix" }, { id: "b", descriptor: "USA-CA-San Jose" },
    { id: "c", descriptor: "Boise, ID - Main Site" }, { id: "d", descriptor: "Albany, NY" },
    { id: "foreign", descriptor: "Toronto, ON" }, { id: "vague", descriptor: "Remote" },
  ] }] }, { facetParameter: "workerSubType", values: [{ id: "intern", descriptor: "Student / Intern (Fixed Term)" }, { id: "regular", descriptor: "Regular" }] }]))
    .toEqual({ locations: ["a", "b", "c", "d"], workerSubType: ["intern"] });
});
it("prefers authoritative country facet and rejects non-location facets", () => {
  expect(auditWorkdayFacets([{ facetParameter: "Country", values: [{ id: "us", descriptor: "United States of America" }] }])).toEqual({ Country: ["us"] });
  expect(auditWorkdayFacets([{ facetParameter: "jobFamilyGroup", values: [{ id: "not-country", descriptor: "United States" }] }])).toBeNull();
});
