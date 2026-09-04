// Read-only independent spot-check: does not call crawlSource or ingest jobs.
// Workday cards / Eightfold search responses come directly from the official
// site, then exact canonical identities are reconciled to the public DB view.
import { readFile } from "node:fs/promises";
import { verifySourceSnapshot } from "../lib/source-snapshot-verification.ts";
import type { CrawledJob } from "../lib/crawler.ts";

type Facet = { facetParameter?: string; descriptor?: string; id?: string; values?: Facet[] };
type WorkdayResponse = { total: number; facets?: Facet[]; jobPostings?: Array<{ title: string; externalPath: string }> };
const usFacet = (facets: Facet[]): { key: string; id: string } | null => {
  for (const facet of facets) {
    const us = facet.values?.find(v => /^United States(?: of America)?$/i.test(v.descriptor ?? ""));
    if (facet.facetParameter && us?.id) return { key: facet.facetParameter, id: us.id };
    const nested = usFacet(facet.values ?? []);
    if (nested) return nested;
  }
  return null;
};

// Compatibility audit before deploying the new exact-identity endpoint.
// This reads a frozen company inventory without FTS; it never triggers a crawl.
const verifyInventory = async (company: string, jobs: CrawledJob[]) => {
  const expected = new Set(jobs.map(j => j.officialUrl));
  let snapshot = "";
  for (let page = 1; page <= 100 && expected.size; page++) {
    const params = new URLSearchParams({ resource: "jobs", company, pageSize: "100", page: String(page) });
    if (snapshot) params.set("snapshotAt", snapshot);
    const response = await fetch(`${site}/api/pulse?${params}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`DB company inventory HTTP ${response.status}`);
    const data = await response.json() as { items: Array<{ officialUrl: string }>; snapshotAt: string; total: number };
    snapshot ||= data.snapshotAt;
    for (const job of data.items) expected.delete(job.officialUrl);
    if (page * 100 >= data.total) break;
    if (!snapshot) throw new Error("Company inventory omitted snapshotAt");
  }
  if (expected.size) throw new Error(`Official samples absent from bounded DB inventory: ${[...expected].join(", ")}`);
  return jobs.length;
};

const site = "https://job-pulse-realtime.autodev61.chatgpt.site";
const workflow = await readFile(new URL("../.github/workflows/production-crawl.yml", import.meta.url), "utf8");
const ids = new Set(workflow.match(/REQUEST_FALLBACK_FORCE_SOURCE_IDS: ([^\n]+)/)?.[1].trim().split(",") ?? []);
const sources = await (await fetch(`${site}/api/pulse?resource=sources`)).json() as Array<{
  id: string; company: string; postingUrl: string; adapter: string; currentJobs: number; health: string;
}>;
const eligible = sources.filter((s) => ids.has(s.id) && (s.adapter === "workday" || /microsoft|qualcomm/.test(s.postingUrl)));
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < eligible.length) {
    const source = eligible[cursor++];
    try {
      const url = new URL(source.postingUrl);
      let jobs: CrawledJob[];
      let officialTotal: number;
      if (source.adapter === "workday") {
        const tenant = url.hostname.split(".")[0];
        const board = url.pathname.split("/").filter(Boolean).at(-1)!;
        const endpoint = `${url.origin}/wday/cxs/${tenant}/${board}/jobs`;
        const request = async (appliedFacets: Record<string, string[]>) => {
          const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(20_000),
            headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20, offset: 0, searchText: "intern", appliedFacets }) });
          if (!response.ok) throw new Error(`Official Workday HTTP ${response.status}`);
          return response.json() as Promise<WorkdayResponse>;
        };
        let data = await request({});
        const us = usFacet(data.facets ?? []);
        if (!us) throw new Error("Official query did not expose a verifiable United States facet; no coverage claim made.");
        data = await request({ [us.key]: [us.id] });
        officialTotal = data.total;
        jobs = (data.jobPostings ?? []).filter((j: { title: string }) => /\bintern(?:ship)?\b|\bco[ -]?op\b/i.test(j.title)).slice(0, 3)
          .map((j) => ({ title: j.title, company: source.company, officialUrl: `${url.origin}/${board}${j.externalPath}` } as CrawledJob));
      } else {
        const endpoint = new URL("/api/pcsx/search", url.origin);
        endpoint.search = new URLSearchParams({ domain: url.searchParams.get("domain")!, query: "intern", location: "United States", start: "0" }).toString();
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`Official Eightfold HTTP ${response.status}`);
        type Eightfold = { count?: number; total?: number; positions?: Array<{ name: string; positionUrl: string }> };
        const raw = await response.json() as Eightfold & { data?: Eightfold };
        const data = raw.data ?? raw;
        officialTotal = data.count ?? data.total ?? data.positions?.length ?? 0;
        jobs = (data.positions ?? []).filter(j => /\bintern(?:ship)?\b|\bco[ -]?op\b/i.test(j.name)).slice(0, 3).map((j) => ({ title: j.name, company: source.company, officialUrl: new URL(j.positionUrl, url.origin).href } as CrawledJob));
      }
      const verified = jobs.length ? process.env.PRIORITY_VERIFY_COMPANY_SCAN === "1"
        ? await verifyInventory(source.company, jobs)
        : await verifySourceSnapshot(site, source.id, jobs) : 0;
      console.log(JSON.stringify({ company: source.company, officialQueryTotal: officialTotal, dbOpenTotal: source.currentJobs,
        status: verified ? "verified-sample" : "no-program-sample", verified, samples: jobs.map(j => ({ title: j.title, url: j.officialUrl })) }));
    } catch (error) {
      console.log(JSON.stringify({ company: source.company, status: "unverified", error: String(error) }));
      process.exitCode = 1;
    }
  }
}));
