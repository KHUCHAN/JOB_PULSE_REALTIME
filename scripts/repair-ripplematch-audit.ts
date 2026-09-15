import { readFile, writeFile } from "node:fs/promises";
import { ripplematchJob } from "../lib/ripplematch-crawler.ts";
import { isExpiredPosting } from "../lib/job-retention.ts";
import { ingestJobSnapshotInChunks } from "../lib/job-snapshot-transport.ts";
import { sameRipplematchIdentity } from "../lib/ripplematch-dedup.ts";
import type { CrawledJob, CrawlSource } from "../lib/crawler.ts";

const auditPath = process.argv[2];
if (!auditPath) throw new Error("Pass the saved RippleMatch audit path");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const seed = JSON.parse(await readFile("db/seed/sources.json", "utf8"));
const apply = process.argv.includes("--apply");
const endpoint = "https://job-pulse-realtime.autodev61.chatgpt.site/api/pulse";
const grouped = new Map<string, { source: CrawlSource; jobs: CrawledJob[] }>();
const results: any[] = [];
for (const card of audit.cards) {
  const slug = card.detail.applicationState.company.url;
  const source = seed.sources.find((s: CrawlSource) => s.id === `ripplematch-${slug}`);
  if (!source) { results.push({ id: card.id, result: "existing-primary-or-outside-repair-scope" }); continue; }
  await new Promise(resolve => setTimeout(resolve, 1100));
  const r = await fetch(`https://app.ripplematch.com/api/v2/direct-apply/${card.id}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Application verification HTTP ${r.status}: ${card.id}`);
  const detail = await r.json() as any;
  const job = ripplematchJob(detail, { public_id: card.id, name: card.title, event_mode: false, job_type: detail.overview?.jobType }, source);
  if (!job) { results.push({ id: card.id, result: "closed" }); continue; }
  if (isExpiredPosting(job.publishedAt, new Date().toISOString())) { results.push({ id: card.id, result: "older-than-30-day-retention" }); continue; }
  const inventory = audit.inventories[card.company];
  if (!inventory || inventory.complete === false) throw new Error(`Incomplete employer inventory: ${card.company}`);
  if (inventory.rows.some((row: any) => sameRipplematchIdentity(job, row))) {
    results.push({ id: card.id, result: "already-in-primary-db" }); continue;
  }
  if (!grouped.has(source.id)) grouped.set(source.id, { source, jobs: [] });
  grouped.get(source.id)!.jobs.push(job);
}
// No crawl or Gmail action: persist only the exact observed, live missing rows.
const token = apply ? (await readFile(process.env.CODEX_REVIEW_TOKEN_PATH ?? "../../review-inbox/.codex-review-token", "utf8")).trim() : "";
for (const { source, jobs } of grouped.values()) {
  if (apply) {
    const persisted = await ingestJobSnapshotInChunks({ endpoint, sourceId: source.id,
      listingUrl: source.postingUrl, jobs, completeListing: false,
      allowedOrigins: ["https://app.ripplematch.com"], authorization: async () => token });
    if (persisted.jobs !== jobs.length || persisted.closed !== 0) throw new Error(`Persistence count mismatch: ${source.id}`);
    for (const job of jobs) {
      const url = `${endpoint}?${new URLSearchParams({ resource: "job", sourceId: source.id, officialUrl: job.officialUrl })}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const row = await r.json() as any;
      if (!r.ok || row?.officialUrl !== job.officialUrl) throw new Error(`Read-after-write failed: ${job.officialUrl}`);
    }
    results.push({ sourceId: source.id, result: "persisted-and-verified", ...persisted });
  } else results.push({ sourceId: source.id, result: "planned", jobs: jobs.map(j => ({ title: j.title, officialUrl: j.officialUrl, publishedAt: j.publishedAt })) });
  console.log(source.company, jobs.length, apply ? "verified in DB" : "planned");
}
await writeFile(`${auditPath}.${apply ? "repair" : "plan"}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
