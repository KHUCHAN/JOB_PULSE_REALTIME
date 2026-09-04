import { expect, it } from "vitest";
import { crawlSource } from "./crawler";
it.each([{}, { listings: [] }, { listings: [{ id: "1", t: "Engineer", l: "77" }] }])("does not close Tesla inventory on empty or changed state %j", async payload => {
  const result = await crawlSource({ id: "tesla", company: "Tesla", postingUrl: "https://www.tesla.com/careers/search/?site=US", adapter: "custom" }, (async () => Response.json(payload)) as typeof fetch, new Date("2026-09-04T00:00:00Z"));
  expect(result.status).toBe("failed");
  expect(result.completeListing).toBe(false);
  expect(result.jobs).toEqual([]);
});
