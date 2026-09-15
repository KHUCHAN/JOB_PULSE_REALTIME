import { expect, it } from "vitest";
import { sameRipplematchIdentity } from "./ripplematch-dedup";
const job = { title: "Data Analyst Intern", location: "Charlotte, NC, USA", officialUrl: "https://app.ripplematch.com/v2/public/job/123456ab", requisitionId: "R20783" };
it("matches exact requisitions across ATS URL variants", () => {
  expect(sameRipplematchIdentity(job, { ...job, title: "Other display title", officialUrl: "https://official.example/job/R20783" })).toBe(true);
});
it("requires location overlap for exact normalized titles", () => {
  const noReq = { ...job, requisitionId: null };
  expect(sameRipplematchIdentity(noReq, { ...noReq, officialUrl: "other", location: "Charlotte, NC, United States" })).toBe(true);
  expect(sameRipplematchIdentity(noReq, { ...noReq, officialUrl: "other", location: "London, UK" })).toBe(false);
  expect(sameRipplematchIdentity(noReq, { ...noReq, officialUrl: "other", location: null })).toBe(false);
});
