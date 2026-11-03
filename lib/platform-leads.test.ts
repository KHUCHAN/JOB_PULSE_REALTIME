import { describe, expect, it } from "vitest";
import { MAX_PLATFORM_LEADS, normalizePlatformLeads } from "./platform-leads";

const lead = { platform: "LinkedIn", company: "Acme", title: "ML Intern", location: "Austin, TX", firstSeen: "2026-11-03", url: "https://www.linkedin.com/jobs/view/1" };

describe("normalizePlatformLeads", () => {
  it("keeps valid rows from both platforms", () => {
    expect(normalizePlatformLeads([lead, { ...lead, platform: "Handshake", url: "https://usc.joinhandshake.com/job-search/1" }])).toHaveLength(2);
  });
  it("drops rows whose link is not on the named platform or not https", () => {
    for (const url of ["https://evil.example/1", "http://www.linkedin.com/jobs/view/1", "https://linkedin.com.evil.example/1", "not a url"]) {
      expect(normalizePlatformLeads([{ ...lead, url }])).toEqual([]);
    }
    expect(normalizePlatformLeads([{ ...lead, url: "https://usc.joinhandshake.com/job-search/1" }])).toEqual([]);
  });
  it("drops rows missing a name, platform or date", () => {
    for (const patch of [{ company: "" }, { title: " " }, { platform: "Indeed" }, { firstSeen: "New" }]) {
      expect(normalizePlatformLeads([{ ...lead, ...patch }])).toEqual([]);
    }
  });
  it("caps the batch and ignores anything but an array", () => {
    expect(normalizePlatformLeads(Array.from({ length: 30 }, () => lead))).toHaveLength(MAX_PLATFORM_LEADS);
    expect(normalizePlatformLeads("x")).toEqual([]);
    expect(normalizePlatformLeads(undefined)).toEqual([]);
  });
});
