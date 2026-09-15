import { expect, it } from "vitest";
import { crawlRipplematch, ripplematchCompanySlug, ripplematchJob } from "./ripplematch-crawler";
const source = { id: "ripplematch-amway", company: "Amway", postingUrl: "https://app.ripplematch.com/v2/public/company/amway", adapter: "custom" as const };
const role = { public_id: "15177b55", name: "Data Analytics Intern", event_mode: false, job_type: "Internship" };
const detail = { publicId: role.public_id, roleUuid: "uuid", isDisabledRole: false,
  roleDescription: "<p>Analyze data using Python and SQL.</p>", publicCompanyDetails: { name: "Amway", url: "amway" },
  overview: { name: "Data Analytics Intern, Summer 2027 (REQ#43460)", jobType: "Internship", employmentType: "Full Time", locationType: "In-Person", datePosted: "Sep 10, 2026" },
  roleLocationsList: { locations: [{ city: "Ada Township, MI, USA" }] } };
it("keeps employer identity, application-page date and internship type", () => {
  expect(ripplematchJob(detail, role, source)).toMatchObject({ requisitionId: "43460", publishedAt: "2026-09-10T00:00:00.000Z", employmentType: "Internship", location: "Ada Township, MI, USA", officialUrl: "https://app.ripplematch.com/v2/public/job/15177b55" });
});
it("does not confuse catalog HTTP 200 with an open application", () => {
  expect(ripplematchJob({ ...detail, isDisabledRole: true }, role, source)).toBeNull();
  expect(() => ripplematchJob({ ...detail, isDisabledRole: undefined as any }, role, source)).toThrow();
  expect(() => ripplematchJob({ ...detail, publicCompanyDetails: { name: "Other", url: "other" } }, role, source)).toThrow();
});
it("never invents a posting date", () => {
  expect(ripplematchJob({ ...detail, overview: { ...detail.overview, datePosted: "" } }, role, source)?.publishedAt).toBeNull();
});
it("accepts only scoped public company URLs", () => {
  expect(ripplematchCompanySlug(source.postingUrl)).toBe("amway");
  expect(ripplematchCompanySlug("https://evil.app.ripplematch.com/v2/public/company/amway")).toBeNull();
  expect(ripplematchCompanySlug("https://app.ripplematch.com/v2/public/job/15177b55")).toBeNull();
});
it("filters events and duplicates and never marks a partial public profile as complete", async () => {
  const result = await crawlRipplematch(source, async input => {
    if (String(input).includes("company-branded-page")) return Response.json({ company: { id: 1115, url: "amway" }, overview: { live: true } });
    if (String(input).includes("public/roles")) return Response.json([role, role, { ...role, public_id: "1234abcd", event_mode: true }]);
    return Response.json(detail);
  });
  expect(result.jobs).toHaveLength(1);
  expect(result.completeListing).toBe(false);
  expect(result.pagination?.cycleComplete).toBe(true);
});
it("fails visibly on rate limits without retry storms or healthy-empty fallback", async () => {
  const result = await crawlRipplematch(source, async () => new Response("", { status: 429, headers: { "retry-after": "60" } }));
  expect(result.status).toBe("failed");
  expect(result.error).toContain("429");
});
