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
    const nodes = jsonLdScripts(await response.text()).flatMap(jobPostingNodes);
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
    const jobs: CrawledJob[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let responseStatus = 200;

    while (offset < total && offset < 2_000) {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100, offset, searchText: "" }),
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
      total = payload.total ?? page.length;
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
