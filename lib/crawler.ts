export type CrawlSource = {
  id: string;
  company: string;
  postingUrl: string;
  adapter: "greenhouse" | "lever" | "workday" | "icims" | "phenom" | "custom";
};

export type CrawledJob = {
  externalId: string | null;
  title: string;
  company: string;
  location: string | null;
  arrangement: "onsite" | "hybrid" | "remote" | "unknown";
  employmentType: string | null;
  summary: string | null;
  officialUrl: string;
  publishedAt: string | null;
};

export type SourceCrawlResult = {
  status: "succeeded" | "failed" | "blocked";
  responseStatus: number | null;
  completeListing: boolean;
  jobs: CrawledJob[];
  error: string | null;
};

export type DiscoveredAts =
  | { kind: "greenhouse"; endpoint: string }
  | { kind: "workday"; endpoint: string }
  | { kind: "lever"; endpoint: string }
  | { kind: "smartrecruiters"; endpoint: string };

type GreenhouseJob = {
  id: number | string;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string | null };
  content?: string | null;
};

type WorkdayJob = {
  title: string;
  externalPath: string;
  locations?: string[];
  bulletFields?: string[];
  postedOn?: string;
};

type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string;
};

const plainText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
};

const greenhouseBoard = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!url.hostname.endsWith("greenhouse.io")) return null;
  const board = url.pathname.split("/").filter(Boolean).at(0);
  return board || null;
};

export function discoverAts(html: string, _pageUrl: string): DiscoveredAts | null {
  void _pageUrl;
  const greenhouse = html.match(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i);
  if (greenhouse) return { kind: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${greenhouse[1]}/jobs?content=true` };

  const workday = html.match(/https?:\/\/[^\s"'<>]+\.myworkdayjobs\.com\/[^\s"'<>?#]+/i);
  const workdayEndpoint = workday ? workdayFeed(workday[0]) : null;
  if (workdayEndpoint) return { kind: "workday", endpoint: workdayEndpoint };

  const lever = html.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9-]+)/i);
  if (lever) return { kind: "lever", endpoint: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };

  const smartRecruiters = html.match(/https?:\/\/jobs\.smartrecruiters\.com\/([a-z0-9-]+)/i);
  if (smartRecruiters) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruiters[1]}/postings` };

  return null;
}

async function crawlDiscoveredFeed(source: CrawlSource, discovered: DiscoveredAts, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  try {
    const response = await fetcher(discovered.endpoint);
    if (!response.ok) return {
      status: [401, 403, 429].includes(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `${discovered.kind} returned HTTP ${response.status}.`,
    };

    if (discovered.kind === "lever") {
      const payload = await response.json() as LeverJob[];
      return {
        status: "succeeded",
        responseStatus: response.status,
        completeListing: true,
        jobs: payload.map((job) => ({
          externalId: job.id,
          title: job.text,
          company: source.company,
          location: job.categories?.location ?? null,
          arrangement: job.categories?.location?.toLowerCase().includes("remote") ? "remote" : "unknown",
          employmentType: job.categories?.commitment ?? null,
          summary: plainText(job.descriptionPlain),
          officialUrl: job.hostedUrl,
          publishedAt: null,
        })),
        error: null,
      };
    }

    if (discovered.kind === "greenhouse") {
      const payload = await response.json() as { jobs?: GreenhouseJob[] };
      return {
        status: "succeeded",
        responseStatus: response.status,
        completeListing: true,
        jobs: (payload.jobs ?? []).map((job) => ({
          externalId: String(job.id),
          title: job.title,
          company: source.company,
          location: job.location?.name ?? null,
          arrangement: "unknown",
          employmentType: null,
          summary: plainText(job.content),
          officialUrl: job.absolute_url,
          publishedAt: job.updated_at ? new Date(job.updated_at).toISOString() : null,
        })),
        error: null,
      };
    }

    const payload = await response.json() as { content?: Array<{ id: string; name: string; ref: string; location?: { city?: string; region?: string }; typeOfEmployment?: { label?: string } }> };
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: (payload.content ?? []).map((job) => ({
        externalId: job.id,
        title: job.name,
        company: source.company,
        location: [job.location?.city, job.location?.region].filter(Boolean).join(", ") || null,
        arrangement: "unknown",
        employmentType: job.typeOfEmployment?.label ?? null,
        summary: null,
        officialUrl: job.ref,
        publishedAt: null,
      })),
      error: null,
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown crawler error." };
  }
}

const workdayFeed = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!url.hostname.includes(".myworkdayjobs.com")) return null;
  const tenant = url.hostname.split(".")[0];
  const site = url.pathname.split("/").filter(Boolean).at(0);
  if (!tenant || !site) return null;
  return `${url.origin}/wday/cxs/${tenant}/${site}/jobs`;
};

type JsonLdValue = Record<string, unknown>;

const jsonLdScripts = (html: string): JsonLdValue[] => {
  const values: JsonLdValue[] = [];
  const pattern = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      if (Array.isArray(parsed)) values.push(...parsed.filter((value): value is JsonLdValue => Boolean(value) && typeof value === "object"));
      else if (parsed && typeof parsed === "object") values.push(parsed as JsonLdValue);
    } catch {
      // One malformed structured-data block should not discard valid job data from the page.
    }
  }
  return values;
};

const jobPostingNodes = (value: JsonLdValue): JsonLdValue[] => {
  const nodes = [value, ...(Array.isArray(value["@graph"]) ? value["@graph"] : [])]
    .filter((node): node is JsonLdValue => Boolean(node) && typeof node === "object");
  return nodes.filter((node) => {
    const type = node["@type"];
    return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  });
};

const asText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

const normalizedDate = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const jobLocation = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  const location = value as JsonLdValue;
  const address = location.address;
  if (!address || typeof address !== "object") return null;
  const normalizedAddress = address as JsonLdValue;
  return [asText(normalizedAddress.addressLocality), asText(normalizedAddress.addressRegion), asText(normalizedAddress.addressCountry)]
    .filter(Boolean)
    .join(", ") || null;
};

const jsonLdJob = (value: JsonLdValue, source: CrawlSource): CrawledJob | null => {
  const title = asText(value.title);
  const officialUrl = asText(value.url) ?? source.postingUrl;
  if (!title || !officialUrl) return null;
  const identifier = value.identifier;
  const externalId = typeof identifier === "object" && identifier
    ? asText((identifier as JsonLdValue).value) ?? asText((identifier as JsonLdValue)["@id"])
    : asText(identifier);
  const description = asText(value.description);

  return {
    externalId,
    title,
    company: source.company,
    location: jobLocation(value.jobLocation),
    arrangement: value.jobLocationType === "TELECOMMUTE" ? "remote" : "unknown",
    employmentType: Array.isArray(value.employmentType)
      ? value.employmentType.map(asText).filter(Boolean).join(", ") || null
      : asText(value.employmentType),
    summary: plainText(description),
    officialUrl,
    publishedAt: normalizedDate(value.datePosted),
  };
};

async function crawlJsonLd(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  try {
    const response = await fetcher(source.postingUrl);
    if (!response.ok) {
      return {
        status: [401, 403, 429].includes(response.status) ? "blocked" : "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: `Career site returned HTTP ${response.status}.`,
      };
    }
    const html = await response.text();
    const discovered = discoverAts(html, source.postingUrl);
    if (discovered?.kind === "workday") return crawlWorkday(source, discovered.endpoint, fetcher);
    if (discovered) return crawlDiscoveredFeed(source, discovered, fetcher);
    const nodes = jsonLdScripts(html).flatMap(jobPostingNodes);
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: false,
      jobs: nodes.map((node) => jsonLdJob(node, source)).filter((job): job is CrawledJob => job !== null),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown crawler error.",
    };
  }
}

async function crawlWorkday(source: CrawlSource, endpoint: string, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  try {
    const endpointUrl = new URL(endpoint);
    const site = endpointUrl.pathname.split("/").at(-2);
    const referer = site ? `${endpointUrl.origin}/${site}` : endpointUrl.origin;
    const jobs: CrawledJob[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let responseStatus = 200;

    while (offset < total && offset < 2_000) {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: endpointUrl.origin,
          referer,
          "user-agent": "JobPulseCrawler/1.0 (+https://job-pulse.local)",
        },
        // Workday's public CXS endpoint rejects page sizes above 20.
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }),
      });
      responseStatus = response.status;
      if (!response.ok) {
        return {
          status: [401, 403, 429].includes(response.status) ? "blocked" : "failed",
          responseStatus: response.status,
          completeListing: false,
          jobs: [],
          error: `Workday returned HTTP ${response.status}.`,
        };
      }

      const payload = await response.json() as { total?: number; jobPostings?: WorkdayJob[] };
      const page = payload.jobPostings ?? [];
      // Some Workday tenants report a window-relative `total` on subsequent
      // pages. The first page is the only reliable total for pagination.
      if (!Number.isFinite(total)) total = payload.total ?? page.length;
      jobs.push(...page.map((job) => {
        const externalId = job.externalPath.split("_").at(-1) ?? null;
        return {
          externalId,
          title: job.title,
          company: source.company,
          location: job.locations?.join(", ") ?? null,
          arrangement: "unknown" as const,
          employmentType: job.bulletFields?.at(-1) ?? null,
          summary: job.bulletFields?.join(" · ") ?? null,
          officialUrl: new URL(job.externalPath, source.postingUrl).href,
          publishedAt: null,
        };
      }));
      if (page.length === 0) break;
      offset += page.length;
    }

    return { status: "succeeded", responseStatus, completeListing: offset >= total, jobs, error: null };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown crawler error.",
    };
  }
}

export async function crawlSource(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  void now;
  const board = source.adapter === "greenhouse" ? greenhouseBoard(source.postingUrl) : null;
  const workday = source.adapter === "workday" ? workdayFeed(source.postingUrl) : null;
  if (workday) return crawlWorkday(source, workday, fetcher);
  if (!board) {
    return crawlJsonLd(source, fetcher);
  }

  try {
    const response = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    if (!response.ok) {
      return {
        status: [401, 403, 429].includes(response.status) ? "blocked" : "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: `Greenhouse returned HTTP ${response.status}.`,
      };
    }

    const payload = await response.json() as { jobs?: GreenhouseJob[] };
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: (payload.jobs ?? []).map((job) => ({
        externalId: String(job.id),
        title: job.title,
        company: source.company,
        location: job.location?.name ?? null,
        arrangement: "unknown",
        employmentType: null,
        summary: plainText(job.content),
        officialUrl: job.absolute_url,
        publishedAt: job.updated_at ? new Date(job.updated_at).toISOString() : null,
      })),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown crawler error.",
    };
  }
}
