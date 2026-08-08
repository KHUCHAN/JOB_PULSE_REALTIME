import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "./catalog-query";

describe("parseCatalogQuery", () => {
  it("bounds pagination and normalizes filters", () => {
    expect(parseCatalogQuery(new URL("https://job-pulse.test/api/catalog?limit=999&offset=-2&q=%20Data%20&talent=true"))).toEqual({
      limit: 100,
      offset: 0,
      query: "Data",
      talentOnly: true,
    });
  });

  it("uses safe defaults", () => {
    expect(parseCatalogQuery(new URL("https://job-pulse.test/api/catalog"))).toEqual({
      limit: 50,
      offset: 0,
      query: "",
      talentOnly: false,
    });
  });
});
