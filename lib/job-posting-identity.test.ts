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

  it("keeps the ID-bearing route of a hash-routed job board", () => {
    // Kratos's official Pereless board serves every posting from one page and
    // routes by fragment. Dropping it gave all 329 jobs one URL identity, so a
    // single archived posting blocked the whole catalog from ingestion.
    const base = "https://apps3.pereless.com/templates/magnetolive/?cid=85347&int=0";
    expect(canonicalPostingUrl(`${base}#/jobDescription/101/Test-Engineer`))
      .not.toBe(canonicalPostingUrl(`${base}#/jobDescription/102/Test-Engineer`));
    expect(canonicalPostingUrl(`${base}#!/jobDescription/101/Test-Engineer`))
      .toBe(canonicalPostingUrl(`${base}#/jobDescription/101/Test-Engineer`));
  });

  it("still ignores in-page anchors", () => {
    expect(canonicalPostingUrl("https://careers.acme.example/jobs/42#apply"))
      .toBe(canonicalPostingUrl("https://careers.acme.example/jobs/42"));
    expect(canonicalPostingUrl("https://careers.acme.example/jobs/42#/"))
      .toBe(canonicalPostingUrl("https://careers.acme.example/jobs/42"));
  });

  it("retains meaningful ATS query parameters", () => {
    expect(canonicalPostingUrl("https://jobs.example/search?job=42&source=handshake"))
      .not.toBe(canonicalPostingUrl("https://jobs.example/search?job=43&source=handshake"));
  });
});
