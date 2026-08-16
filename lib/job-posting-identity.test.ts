import { describe, expect, it } from "vitest";
import { canonicalPostingUrl, jobPostingIdentityKeys } from "./job-posting-identity";

describe("durable posting identity", () => {
  it("treats Barclays locale and apply routes as the same official posting", () => {
    const listing = "https://search.jobs.barclays/job/new-york/role/13015/99217260160";
    const apply = "https://search.jobs.barclays/en/job/new-york/role/13015/99217260160/apply#form";

    expect(canonicalPostingUrl(apply)).toBe(canonicalPostingUrl(listing));
  });

  it("scopes requisition and external identities to the source", () => {
    expect(jobPostingIdentityKeys({
      sourceId: "Acme-US",
      requisitionId: " REQ-42 ",
      externalId: "R42",
      officialUrl: "https://careers.acme.example/jobs/42",
    })).toEqual({
      requisitionIdentityKey: "req:acme-us:req-42",
      externalIdentityKey: "ext:acme-us:r42",
      urlIdentityKey: "url:https://careers.acme.example/jobs/42",
    });
  });

  it("retains meaningful ATS query parameters", () => {
    expect(canonicalPostingUrl("https://jobs.example/search?job=42&source=handshake"))
      .not.toBe(canonicalPostingUrl("https://jobs.example/search?job=43&source=handshake"));
  });
});
