import { expect, it } from "vitest";
import { googleCareerDetail, type CrawledJob } from "./crawler";
const job = { title: "Software Engineering Intern, MS, Summer 2027", officialUrl: "https://www.google.com/about/careers/applications/jobs/results/94172495052972742-intern" } as CrawledJob;
const html = `<span class="r0wTof">Mumbai, India</span><div data-id="94172495052972742"><div><h2>${job.title}</h2><span class="r0wTof ">Mountain View, CA, USA</span><span class="r0wTof">Austin, TX, USA</span><h3>Minimum qualifications:</h3><ul><li>Master's degree</li></ul></div></div></c-wiz><span class="r0wTof">London, UK</span>`;
it("extracts only the exact Google's detail panel and never invents a date", () => {
  expect(googleCareerDetail(html, job)).toEqual({ requisitionId: "94172495052972742", location: "Mountain View, CA, USA", secondaryLocations: ["Austin, TX, USA"], description: expect.stringContaining("Master's degree") });
});
it("rejects a search page or mismatched title", () => {
  expect(googleCareerDetail('<span class="r0wTof">California, USA</span>', job)).toBeNull();
  expect(googleCareerDetail(html.replace(job.title, "Different Intern"), job)).toBeNull();
});
