import type { CrawlSource, CrawledJob, SourceCrawlResult } from "./crawler.ts";
import { createFifoLimiter } from "./fifo-limiter.ts";

const withRequestSlot = createFifoLimiter(1);
let lastRequestAt = 0;

type PublicRole = { public_id: string; name: string; event_mode: boolean; job_type: string };
type ApplicationDetail = {
  isDisabledRole: boolean; publicId: string; roleUuid: string; roleDescription: string;
  publicCompanyDetails: { name: string; url: string };
  overview: { name: string; jobType: string; employmentType: string; locationType: string;
    datePosted: string; deadline?: string; department?: { name: string } };
  roleLocationsList: { locations: { city: string }[] };
};

export function ripplematchCompanySlug(url: string): string | null {
  const parsed = new URL(url);
  return parsed.hostname === "app.ripplematch.com"
    ? parsed.pathname.match(/^\/(?:v2\/public\/)?company\/([a-z0-9-]+)\/?$/i)?.[1] ?? null : null;
}

export function ripplematchJob(detail: ApplicationDetail, role: PublicRole, source: CrawlSource): CrawledJob | null {
  // Catalog API HTTP 200 is NOT proof that applications are open (Plaid).
  if (detail.isDisabledRole === true) return null;
  if (detail.isDisabledRole !== false || detail.publicId !== role.public_id || !detail.overview?.name || !detail.roleDescription
    || detail.publicCompanyDetails?.url !== ripplematchCompanySlug(source.postingUrl)) {
    throw new Error("RippleMatch application state or company identity is unverifiable");
  }
  const locations = detail.roleLocationsList?.locations?.map(l => l.city).filter(Boolean) ?? [];
  const title = detail.overview.name.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  const posted = Date.parse(`${detail.overview.datePosted} UTC`);
  const deadline = Date.parse(detail.overview.deadline ?? "");
  return { externalId: role.public_id, company: source.company, title,
    officialUrl: `https://app.ripplematch.com/v2/public/job/${role.public_id}`,
    applyUrl: `https://app.ripplematch.com/v2/public/job/${role.public_id}`,
    // Use the application page's visible date, not catalog record creation or observation time.
    publishedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : null,
    sourcePostedText: detail.overview.datePosted || null,
    validThrough: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
    location: locations.join("; ") || null, secondaryLocations: locations,
    arrangement: /hybrid/i.test(detail.overview.locationType) ? "hybrid"
      : /remote/i.test(detail.overview.locationType) ? "remote" : "onsite",
    employmentType: /intern|co.?op/i.test(detail.overview.jobType)
      ? detail.overview.jobType : detail.overview.employmentType,
    department: detail.overview.department?.name ?? null,
    description: detail.roleDescription,
    summary: detail.roleDescription.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
    requisitionId: title.match(/\bREQ\s*#\s*(\d{4,})/i)?.[1]
      ?? title.match(/\b(R\d{4,})\b/)?.[1] ?? null,
  };
}

export async function crawlRipplematch(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const slug = ripplematchCompanySlug(source.postingUrl);
  if (!slug) throw new Error("Invalid RippleMatch company URL");
  const get = async (path: string) => {
    const r = await withRequestSlot(async () => {
      const delay = Math.max(0, lastRequestAt + 1050 - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequestAt = Date.now();
      return fetcher(`https://app.ripplematch.com${path}`, { headers: { accept: "application/json" } });
    });
    if (!r.ok) throw new Error(`RippleMatch HTTP ${r.status}; retry-after=${r.headers.get("retry-after") ?? "unspecified"}`);
    return r.json();
  };
  try {
    const page = await get(`/api/v2/company-branded-page/${slug}`) as { company?: { id: number; url: string }; overview?: { live: boolean } };
    if (!page.company?.id || page.company.url !== slug || page.overview?.live !== true) throw new Error("RippleMatch company page is not live");
    const payload = await get(`/api/v2/public/roles/${page.company.id}`) as PublicRole[];
    if (!Array.isArray(payload)) throw new Error("RippleMatch role catalog schema changed");
    const roles = [...new Map(payload.filter(r => r.event_mode === false && /^[a-f0-9]{8}$/i.test(r.public_id))
      .map(r => [r.public_id, r])).values()];
    const window = 4;
    const totalPages = Math.max(1, Math.ceil(roles.length / window));
    const cursor = Math.min(Math.max(1, source.crawlPageCursor ?? 1), totalPages);
    const jobs: CrawledJob[] = [];
    for (const role of roles.slice((cursor - 1) * window, cursor * window)) {
      const detail = await get(`/api/v2/direct-apply/${role.public_id}`) as ApplicationDetail;
      const job = ripplematchJob(detail, role, source);
      if (job) jobs.push(job);
    }
    return { status: "succeeded", responseStatus: 200, jobs, error: null,
      // Public recruiting profiles can hide roles; never close other inventory from this subset.
      completeListing: false,
      pagination: { nextPage: cursor >= totalPages ? 1 : cursor + 1, totalPages, cycleComplete: cursor >= totalPages } };
  } catch (e) {
    return { status: "failed", responseStatus: null, jobs: [], completeListing: false,
      error: e instanceof Error ? e.message : String(e) };
  }
}
