import { jobsFromBrowserAnchors, type BrowserAnchor } from "./browser-job-extractor.ts";
import { normalizeEmploymentType, workdayBulletFields } from "./employment-type.ts";

export type CrawlSource = {
  id: string;
  company: string;
  postingUrl: string;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "custom";
};

export type CrawledJob = {
  externalId: string | null;
  title: string;
  company: string;
  location: string | null;
  arrangement: "onsite" | "hybrid" | "remote" | "unknown";
  employmentType: string | null;
  summary: string | null;
  description?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  skills?: string[];
  department?: string | null;
  team?: string | null;
  businessUnit?: string | null;
  jobFamily?: string | null;
  jobFunction?: string | null;
  industry?: string | null;
  office?: string | null;
  secondaryLocations?: string[];
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  locationPostalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryInterval?: string | null;
  benefits?: string | null;
  educationRequirements?: string | null;
  experienceRequirements?: string | null;
  experienceLevel?: string | null;
  shiftSchedule?: string | null;
  travelRequirements?: string | null;
  securityClearance?: string | null;
  languages?: string[];
  requisitionId?: string | null;
  applyUrl?: string | null;
  sourcePostedText?: string | null;
  sourceUpdatedAt?: string | null;
  validThrough?: string | null;
  rawPayload?: Record<string, unknown> | null;
  officialUrl: string;
  publishedAt: string | null;
};

export type CrawledFacet = {
  key: string;
  label: string;
  values: Array<{ key: string; label: string; count: number | null }>;
};

export type SourceCrawlResult = {
  status: "succeeded" | "failed" | "blocked";
  responseStatus: number | null;
  completeListing: boolean;
  jobs: CrawledJob[];
  facets?: CrawledFacet[];
  error: string | null;
};

export type DiscoveredAts =
  | { kind: "greenhouse"; endpoint: string }
  | { kind: "workday"; endpoint: string }
  | { kind: "lever"; endpoint: string }
  | { kind: "ashby"; endpoint: string }
  | { kind: "smartrecruiters"; endpoint: string }
  | { kind: "jibe"; endpoint: string };

type GreenhouseJob = {
  id: number | string;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string | null };
  content?: string | null;
  first_published?: string | null;
  requisition_id?: string | null;
  departments?: Array<{ id?: number | string; name?: string | null }>;
  offices?: Array<{ id?: number | string; name?: string | null; location?: string | null }>;
  metadata?: Array<{ id?: number | string; name?: string | null; value?: unknown }>;
};

type WorkdayJob = {
  title?: string;
  externalPath?: string;
  locations?: string[];
  locationsText?: string;
  bulletFields?: string[];
  postedOn?: string;
};

type WorkdayFacet = {
  descriptor?: string;
  facetParameter?: string;
  values?: Array<{ descriptor?: string; id?: string; count?: number }>;
};

type LeverJob = {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; commitment?: string; department?: string; team?: string; allLocations?: string[] };
  descriptionPlain?: string;
  createdAt?: number;
  workplaceType?: string;
  lists?: Array<{ text?: string; content?: string }>;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
};

type AshbyJob = {
  id?: string;
  title?: string;
  jobUrl?: string;
  location?: string;
  workplaceType?: string;
  employmentType?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  isListed?: boolean;
  department?: string;
  team?: string;
  secondaryLocations?: Array<{ location?: string } | string>;
  applyUrl?: string;
  address?: { postalAddress?: { addressCountry?: string; addressRegion?: string; postalCode?: string; addressLocality?: string } };
};

type SmartRecruitersJob = {
  id?: string;
  name?: string;
  ref?: string;
  refNumber?: string;
  location?: { city?: string; region?: string; country?: string; postalCode?: string; latitude?: number; longitude?: number; remote?: boolean; hybrid?: boolean };
  typeOfEmployment?: { label?: string };
  department?: { label?: string };
  function?: { label?: string };
  industry?: { label?: string };
  experienceLevel?: { label?: string };
  language?: { code?: string; label?: string };
  releasedDate?: string;
};

type JibeJob = {
  data?: {
    slug?: string;
    req_id?: string;
    title?: string;
    language?: string;
    full_location?: string;
    employment_type?: string;
    description?: string;
    posted_date?: string;
    category?: string;
    responsibilities?: string;
    qualifications?: string;
    city?: string;
    state?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
    location_type?: string;
    languages?: string[];
  };
};

type JibeFilter = {
  categories?: { all?: Array<{ category?: string; numJobs?: number }> };
  facetList?: Record<string, Array<{ term?: string; count?: number }>>;
};

type EightfoldPosition = {
  id?: string | number;
  name?: string;
  location?: string;
  ats_job_id?: string;
  department?: string;
  work_location_option?: string | null;
  canonicalPositionUrl?: string;
  t_create?: number;
  business_unit?: string;
  type?: string;
  job_description?: string;
};

type AdpJob = {
  clientRequisitionID?: string;
  reqId?: string;
  publishedJobTitle?: string;
  jobTitle?: string;
  jobDescription?: string;
  jobQualifications?: string;
  postingDate?: string;
  workLevelCode?: string;
  requisitionLocations?: Array<{ address?: { cityName?: string; countrySubdivisionLevel1?: { longName?: string }; country?: { longName?: string } } }>;
};

type PhenomJob = {
  title?: string;
  jobId?: string;
  jobSeqNo?: string;
  location?: string;
  cityStateCountry?: string;
  type?: string;
  descriptionTeaser?: string;
  applyUrl?: string;
  postedDate?: string;
  reqId?: string;
  category?: string;
  multi_category?: string[];
  externalTeamName?: string;
  ml_skills?: string[];
  checkRemote?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: string | number;
  longitude?: string | number;
  industry?: string;
  multi_location?: string[];
};

type EmbeddedJobItem = {
  date?: string;
  title?: string;
  href?: string;
  location?: string;
  schedule?: string;
  description?: string;
};

type TeslaListing = {
  id?: string;
  t?: string;
  dp?: string;
  l?: string;
  y?: string | number;
};

type TeslaState = {
  lookup?: {
    locations?: Record<string, string>;
    departments?: Record<string, string>;
    types?: Record<string, string>;
  };
  geo?: Array<{ sites?: Array<{ id?: string; cities?: Record<string, string[]> }> }>;
  listings?: TeslaListing[];
};

type OracleJob = {
  Id?: string | number;
  Title?: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  WorkplaceType?: string;
  WorkplaceTypeCode?: string;
  JobSchedule?: string;
  ShortDescriptionStr?: string;
};

type McKinseyJob = {
  jobID?: string;
  title?: string;
  cities?: string[];
  countries?: string[];
  continents?: string[];
  interest?: string;
  interestCategory?: string;
  functions?: string[];
  whoYouWillWorkWith?: string;
  whatYouWillDo?: string;
  yourBackground?: string;
  jobSkillCode?: string[];
  linkedInIndustry?: string[];
  linkedInSeniorityLevel?: string[];
  postedToLinkedInDate?: string;
  jobApplyURL?: string;
  friendlyURL?: string;
};

const REQUEST_TIMEOUT_MS = 15_000;
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 429, 520, 521, 522, 523, 524]);
const BROWSER_REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

const isBlockedHttpStatus = (status: number | null): boolean => status != null && BLOCKED_HTTP_STATUSES.has(status);

const fetchWithTimeout = async (
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("15 second crawl timeout"), REQUEST_TIMEOUT_MS);
  const headers = init?.headers instanceof Headers
    ? new Headers(init.headers)
    : { ...BROWSER_REQUEST_HEADERS, ...(init?.headers ?? {}) };
  if (headers instanceof Headers) {
    for (const [name, value] of Object.entries(BROWSER_REQUEST_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
  }
  try {
    return await fetcher(input, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const plainText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
};

export const compactJibeContent = (value: string, compact: boolean): { summary: string; description?: string } => {
  if (compact) return { summary: value.slice(0, 100) };
  return { summary: value, description: value };
};

const decodeHtmlAttribute = (value: string): string => value
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

export const anchorsFromHtml = (html: string): BrowserAnchor[] => [...html.matchAll(
  /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
)].map((match) => ({
  href: decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? ""),
  text: plainText(match[4]) ?? "",
}));

const greenhouseBoard = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!url.hostname.endsWith("greenhouse.io")) return null;
  const queryBoard = url.searchParams.get("job_board");
  if (queryBoard && /^[a-z0-9-]+$/i.test(queryBoard)) return queryBoard;
  const board = url.pathname.split("/").filter(Boolean).at(0);
  if (board === "users" || board === "embed") return null;
  return board || null;
};

export function discoverAts(html: string, _pageUrl: string): DiscoveredAts | null {
  const greenhouse = html.match(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i);
  if (greenhouse) return { kind: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${greenhouse[1]}/jobs?content=true` };

  const workday = html.match(/https?:\/\/[^\s"'<>]+\.myworkdayjobs\.com\/[^\s"'<>?#]+/i);
  const workdayEndpoint = workday ? workdayFeed(workday[0]) : null;
  if (workdayEndpoint) return { kind: "workday", endpoint: workdayEndpoint };

  const lever = html.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9-]+)/i);
  if (lever) return { kind: "lever", endpoint: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };

  const ashby = html.match(/https?:\/\/jobs\.ashbyhq\.com\/([^\s"'<>/?#]+)/i);
  if (ashby) return { kind: "ashby", endpoint: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}` };

  const smartRecruiters = html.match(/https?:\/\/jobs\.smartrecruiters\.com\/([a-z0-9-]+)/i);
  if (smartRecruiters) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruiters[1]}/postings` };

  const smartRecruitersWidget = html.match(/["']company_code["']\s*:\s*["']([a-z0-9-]+)["']/i);
  if (smartRecruitersWidget) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruitersWidget[1]}/postings` };

  if (/app\.jibecdn\.com\/prod\/search\//i.test(html)) {
    const page = new URL(_pageUrl);
    return { kind: "jibe", endpoint: `${page.origin}/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false` };
  }

  return null;
}

async function crawlDiscoveredFeed(source: CrawlSource, discovered: DiscoveredAts, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  try {
    const response = await fetchWithTimeout(fetcher, discovered.endpoint);
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
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
          arrangement: /remote/i.test(`${job.workplaceType ?? ""} ${job.categories?.location ?? ""}`) ? "remote" : /hybrid/i.test(job.workplaceType ?? "") ? "hybrid" : /on.?site/i.test(job.workplaceType ?? "") ? "onsite" : "unknown",
          employmentType: job.categories?.commitment ?? null,
          summary: plainText(job.descriptionPlain),
          description: plainText(job.descriptionPlain),
          department: job.categories?.department ?? null,
          team: job.categories?.team ?? null,
          secondaryLocations: (job.categories?.allLocations ?? []).filter((location) => location !== job.categories?.location),
          qualifications: plainText(job.lists?.map((section) => `${section.text ?? ""} ${section.content ?? ""}`).join(" ")),
          salaryMin: job.salaryRange?.min ?? null,
          salaryMax: job.salaryRange?.max ?? null,
          salaryCurrency: job.salaryRange?.currency ?? null,
          salaryInterval: job.salaryRange?.interval ?? null,
          officialUrl: job.hostedUrl,
          publishedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
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
          description: plainText(job.content),
          ...(job.departments?.length ? { department: job.departments.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
          ...(job.offices?.length ? { office: job.offices.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
          ...(job.requisition_id ? { requisitionId: job.requisition_id } : {}),
          ...(job.first_published ? { sourceUpdatedAt: normalizedDate(job.updated_at) } : {}),
          ...((job.metadata?.length || job.departments?.length || job.offices?.length) ? { rawPayload: { metadata: job.metadata ?? [], departments: job.departments ?? [], offices: job.offices ?? [] } } : {}),
          officialUrl: job.absolute_url,
          publishedAt: normalizedDate(job.first_published ?? job.updated_at),
        })),
        error: null,
      };
    }

    if (discovered.kind === "ashby") {
      const payload = await response.json() as { jobs?: AshbyJob[] };
      return {
        status: "succeeded",
        responseStatus: response.status,
        completeListing: true,
        jobs: (payload.jobs ?? []).flatMap((job) => {
          if (job.isListed === false || !job.id || !job.title || !job.jobUrl) return [];
          return [{
            externalId: job.id,
            title: job.title,
            company: source.company,
            location: job.location ?? null,
            arrangement: /remote/i.test(`${job.workplaceType ?? ""} ${job.location ?? ""}`) ? "remote" as const : /hybrid/i.test(job.workplaceType ?? "") ? "hybrid" as const : "unknown" as const,
            employmentType: job.employmentType ?? null,
            summary: plainText(job.descriptionPlain ?? job.descriptionHtml),
            description: plainText(job.descriptionPlain ?? job.descriptionHtml),
            ...(job.department ? { department: job.department } : {}),
            ...(job.team ? { team: job.team } : {}),
            ...(job.secondaryLocations?.length ? { secondaryLocations: job.secondaryLocations.map((location) => typeof location === "string" ? location : location.location).filter((location): location is string => Boolean(location)) } : {}),
            ...(job.address?.postalAddress?.addressRegion ? { locationState: job.address.postalAddress.addressRegion } : {}),
            ...(job.address?.postalAddress?.addressCountry ? { locationCountry: job.address.postalAddress.addressCountry } : {}),
            ...(job.address?.postalAddress?.postalCode ? { locationPostalCode: job.address.postalAddress.postalCode } : {}),
            ...(job.applyUrl ? { applyUrl: job.applyUrl } : {}),
            officialUrl: job.jobUrl,
            publishedAt: normalizedDate(job.publishedAt),
          }];
        }),
        error: null,
      };
    }

    if (discovered.kind === "jibe") {
      const firstPayload = await response.json() as { totalCount?: number; jobs?: JibeJob[]; filter?: JibeFilter };
      const listing = new URL(source.postingUrl);
      const prefix = listing.pathname.split("/jobs")[0];
      const firstItems = firstPayload.jobs ?? [];
      const total = firstPayload.totalCount ?? firstItems.length;
      const compactContent = total > 10_000;
      const stringPool = new Map<string, string>();
      const intern = (value: string | null): string | null => {
        if (!value) return null;
        const existing = stringPool.get(value);
        if (existing) return existing;
        stringPool.set(value, value);
        return value;
      };
      const normalize = (items: JibeJob[]): CrawledJob[] => items.flatMap(({ data }) => {
        if (!data?.slug || !data.title) return [];
        const description = intern(plainText(data.description));
        const content = description ? compactJibeContent(description, compactContent) : { summary: null };
        return [{
          externalId: data.req_id ?? data.slug,
          title: data.title,
          company: source.company,
          location: data.full_location ?? null,
          arrangement: /\bremote\b/i.test(data.full_location ?? "") ? "remote" as const : "unknown" as const,
          employmentType: data.employment_type ?? null,
          ...content,
          ...(data.category ? { jobFamily: data.category } : {}),
          ...(!compactContent && data.responsibilities ? { responsibilities: intern(plainText(data.responsibilities)) ?? null } : {}),
          ...(!compactContent && data.qualifications ? { qualifications: intern(plainText(data.qualifications)) ?? null } : {}),
          ...(data.city ? { locationCity: data.city } : {}),
          ...(data.state ? { locationState: data.state } : {}),
          ...(data.country ? { locationCountry: data.country } : {}),
          ...(data.latitude != null ? { latitude: data.latitude } : {}),
          ...(data.longitude != null ? { longitude: data.longitude } : {}),
          ...(data.languages?.length ? { languages: data.languages } : {}),
          ...(data.req_id ? { requisitionId: data.req_id } : {}),
          officialUrl: `${listing.origin}${prefix}/jobs/${encodeURIComponent(data.slug)}${data.language ? `?lang=${encodeURIComponent(data.language)}` : ""}`,
          publishedAt: normalizedDate(data.posted_date),
        }];
      });
      const jobs = normalize(firstItems);
      const pageSize = Math.max(firstItems.length, 1);
      const boundedTotal = Math.min(total, 10_000);
      const pageNumbers = Array.from({ length: Math.max(0, Math.ceil(boundedTotal / pageSize) - 1) }, (_, index) => index + 2);
      for (let index = 0; index < pageNumbers.length; index += 8) {
        const pages = await Promise.all(pageNumbers.slice(index, index + 8).map(async (page) => {
          const pageUrl = new URL(discovered.endpoint);
          pageUrl.searchParams.set("page", String(page));
          const pageResponse = await fetchWithTimeout(fetcher, pageUrl);
          if (!pageResponse.ok) return { response: pageResponse, jobs: [] as JibeJob[] };
          const payload = await pageResponse.json() as { jobs?: JibeJob[] };
          return { response: pageResponse, jobs: payload.jobs ?? [] };
        }));
        const failure = pages.find((page) => !page.response.ok);
        if (failure) return {
          status: isBlockedHttpStatus(failure.response.status) ? "blocked" : "failed",
          responseStatus: failure.response.status,
          completeListing: false,
          jobs: [],
          error: `jibe returned HTTP ${failure.response.status}.`,
        };
        for (const page of pages) jobs.push(...normalize(page.jobs));
      }
      const facets: CrawledFacet[] = [
        ...(firstPayload.filter?.categories?.all?.length ? [{
          key: "category",
          label: "Category",
          values: firstPayload.filter.categories.all.flatMap((value) => value.category ? [{ key: value.category, label: value.category, count: value.numJobs ?? null }] : []),
        }] : []),
        ...Object.entries(firstPayload.filter?.facetList ?? {}).flatMap(([key, values]) => values.length ? [{
          key,
          label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
          values: values.flatMap((value) => value.term ? [{ key: value.term, label: value.term, count: value.count ?? null }] : []),
        }] : []),
      ];
      return {
        status: "succeeded",
        responseStatus: response.status,
        completeListing: total <= 10_000 && jobs.length >= total,
        jobs,
        ...(facets.length > 0 ? { facets } : {}),
        error: null,
      };
    }

    const firstPayload = await response.json() as { totalFound?: number; content?: SmartRecruitersJob[] };
    const content = [...(firstPayload.content ?? [])];
    const totalFound = firstPayload.totalFound ?? content.length;
    let offset = content.length;
    while (offset < totalFound) {
      const pageUrl = new URL(discovered.endpoint);
      pageUrl.searchParams.set("limit", "100");
      pageUrl.searchParams.set("offset", String(offset));
      const pageResponse = await fetchWithTimeout(fetcher, pageUrl);
      if (!pageResponse.ok) return {
        status: isBlockedHttpStatus(pageResponse.status) ? "blocked" : "failed",
        responseStatus: pageResponse.status,
        completeListing: false,
        jobs: [],
        error: `smartrecruiters returned HTTP ${pageResponse.status}.`,
      };
      const page = await pageResponse.json() as { content?: SmartRecruitersJob[] };
      const additions = page.content ?? [];
      if (additions.length === 0) break;
      content.push(...additions);
      offset += additions.length;
    }
    const companyCode = new URL(discovered.endpoint).pathname.match(/\/companies\/([^/]+)\/postings/)?.[1] ?? source.company;
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: content.length >= totalFound,
      jobs: content.flatMap((job) => job.id && job.name ? [{
        externalId: job.id,
        title: job.name,
        company: source.company,
        location: [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") || null,
        arrangement: job.location?.remote ? "remote" as const : job.location?.hybrid ? "hybrid" as const : "unknown" as const,
        employmentType: job.typeOfEmployment?.label ?? null,
        summary: null,
        ...(job.refNumber ? { requisitionId: job.refNumber } : {}),
        ...(job.department?.label ? { department: job.department.label } : {}),
        ...(job.function?.label ? { jobFunction: job.function.label } : {}),
        ...(job.industry?.label ? { industry: job.industry.label } : {}),
        ...(job.experienceLevel?.label ? { experienceLevel: job.experienceLevel.label } : {}),
        ...(job.location?.city ? { locationCity: job.location.city } : {}),
        ...(job.location?.region ? { locationState: job.location.region } : {}),
        ...(job.location?.country ? { locationCountry: job.location.country } : {}),
        ...(job.location?.postalCode ? { locationPostalCode: job.location.postalCode } : {}),
        ...(job.location?.latitude != null ? { latitude: job.location.latitude } : {}),
        ...(job.location?.longitude != null ? { longitude: job.location.longitude } : {}),
        ...(job.language?.label ? { languages: [job.language.label] } : {}),
        officialUrl: `https://jobs.smartrecruiters.com/${companyCode}/${job.id}`,
        publishedAt: normalizedDate(job.releasedDate),
      }] : []),
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

export const oracleCareerSite = (html: string, postingUrl: string): { apiOrigin: string; site: string } | null => {
  const page = new URL(postingUrl);
  const site = page.pathname.match(/\/sites\/(CX_[A-Z0-9]+)/i)?.[1]
    ?? html.match(/[?&]siteNumber=(CX_[A-Z0-9]+)/i)?.[1];
  const apiOrigin = html.match(/https:\/\/([a-z0-9.-]+\.fa\.[a-z0-9.-]*oraclecloud\.com)(?::443)?/i)?.[1];
  return site && apiOrigin ? { apiOrigin: `https://${apiOrigin}`, site } : null;
};

const oracleJobUrl = (sourceUrl: string, site: string, job: OracleJob): string => {
  const source = new URL(sourceUrl);
  const slug = (job.Title ?? "job").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${source.origin}/en/sites/${site}/job/${encodeURIComponent(slug)}/${job.Id}`;
};

async function crawlOracle(
  source: CrawlSource,
  oracle: { apiOrigin: string; site: string },
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> {
  try {
    const fetchPage = async (offset: number): Promise<{ responseStatus: number; total: number; page: OracleJob[] }> => {
      const endpoint = new URL("/hcmRestApi/resources/latest/recruitingCEJobRequisitions", oracle.apiOrigin);
      endpoint.searchParams.set("onlyData", "true");
      endpoint.searchParams.set("expand", "requisitionList.workLocation");
      endpoint.searchParams.set("finder", `findReqs;siteNumber=${oracle.site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`);
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: "application/json", referer: source.postingUrl },
      });
      if (!response.ok) throw new Error(`Oracle Recruiting returned HTTP ${response.status}.`);
      const payload = await response.json() as { items?: Array<{ TotalJobsCount?: number; requisitionList?: OracleJob[] }> };
      const container = payload.items?.[0];
      return { responseStatus: response.status, total: container?.TotalJobsCount ?? 0, page: container?.requisitionList ?? [] };
    };
    const normalizePage = (page: OracleJob[]): CrawledJob[] => page.flatMap((job) => {
        if (!job.Id || !job.Title) return [];
        const workplace = `${job.WorkplaceType ?? ""} ${job.WorkplaceTypeCode ?? ""}`.toLowerCase();
        return [{
          externalId: String(job.Id),
          title: job.Title,
          company: source.company,
          location: job.PrimaryLocation ?? null,
          arrangement: workplace.includes("remote") ? "remote" as const : workplace.includes("hybrid") ? "hybrid" as const : workplace.includes("site") ? "onsite" as const : "unknown" as const,
          employmentType: job.JobSchedule ?? null,
          summary: plainText(job.ShortDescriptionStr),
          description: plainText(job.ShortDescriptionStr),
          officialUrl: oracleJobUrl(source.postingUrl, oracle.site, job),
          publishedAt: normalizedDate(job.PostedDate),
        }];
      });

    const first = await fetchPage(0);
    const total = first.total || first.page.length;
    const jobs = normalizePage(first.page);
    const boundedTotal = Math.min(total, 10_000);
    const offsets = Array.from({ length: Math.max(0, Math.ceil(boundedTotal / 25) - 1) }, (_, index) => (index + 1) * 25);
    let successfulPages = 0;
    for (let index = 0; index < offsets.length; index += 8) {
      const pages = await Promise.all(offsets.slice(index, index + 8).map(async (offset) => {
        try {
          return await fetchPage(offset);
        } catch {
          return null;
        }
      }));
      successfulPages += pages.filter((page): page is NonNullable<typeof page> => page !== null).length;
      jobs.push(...pages.flatMap((page) => page ? normalizePage(page.page) : []));
    }
    return {
      status: "succeeded",
      responseStatus: first.responseStatus,
      completeListing: total <= 10_000 && successfulPages === offsets.length && jobs.length >= total,
      jobs: uniqueJobs(jobs),
      error: null,
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown Oracle crawler error." };
  }
}

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

const embeddedJsonObject = (html: string, marker: string): JsonLdValue | null => {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const objectStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        const value = JSON.parse(html.slice(objectStart, index + 1)) as unknown;
        return value && typeof value === "object" ? value as JsonLdValue : null;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const embeddedJsonArray = (html: string, marker: string): unknown[] | null => {
  const markerIndex = html.indexOf(marker);
  const arrayStart = markerIndex >= 0 ? html.indexOf("[", markerIndex + marker.length) : -1;
  if (arrayStart < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = arrayStart; index < html.length; index += 1) {
    const character = html[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) {
      try {
        const value = JSON.parse(html.slice(arrayStart, index + 1)) as unknown;
        return Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const embeddedJobItems = (html: string, source: CrawlSource): CrawledJob[] => (
  embeddedJsonArray(html, "JOB_ITEMS =") ?? []
).flatMap((value) => {
  if (!value || typeof value !== "object") return [];
  const job = value as EmbeddedJobItem;
  if (!job.title || !job.href) return [];
  return [{
    externalId: new URL(job.href, source.postingUrl).pathname.split("/").filter(Boolean).at(-1) ?? null,
    title: job.title,
    company: source.company,
    location: job.location ?? null,
    arrangement: /\bremote\b/i.test(job.location ?? "") ? "remote" as const : /\bhybrid\b/i.test(job.location ?? "") ? "hybrid" as const : "unknown" as const,
    employmentType: job.schedule ?? null,
    summary: plainText(job.description),
    officialUrl: new URL(job.href, source.postingUrl).href,
    publishedAt: normalizedDate(job.date),
  }];
});

type PhenomPage = SourceCrawlResult & { totalHits: number | null; pageHits: number | null };

const phenomJobs = (html: string, source: CrawlSource): PhenomPage | null => {
  const payload = embeddedJsonObject(html, "phApp.ddo = ");
  const eager = payload?.eagerLoadRefineSearch;
  if (!eager || typeof eager !== "object") return null;
  const data = (eager as JsonLdValue).data;
  if (!data || typeof data !== "object") return null;
  const jobs = (data as JsonLdValue).jobs;
  if (!Array.isArray(jobs)) return null;
  const totalHits = typeof (eager as JsonLdValue).totalHits === "number"
    ? (eager as JsonLdValue).totalHits as number
    : typeof (data as JsonLdValue).totalHits === "number" ? (data as JsonLdValue).totalHits as number : null;
  const pageHits = typeof (eager as JsonLdValue).hits === "number" ? (eager as JsonLdValue).hits as number : null;
  const aggregations = Array.isArray((data as JsonLdValue).aggregations) ? (data as JsonLdValue).aggregations as unknown[] : [];
  const facets: CrawledFacet[] = aggregations.flatMap((aggregation) => {
    if (!aggregation || typeof aggregation !== "object") return [];
    const record = aggregation as { field?: unknown; value?: unknown };
    if (typeof record.field !== "string" || !record.value || typeof record.value !== "object" || Array.isArray(record.value)) return [];
    return [{
      key: record.field,
      label: record.field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
      values: Object.entries(record.value as Record<string, unknown>).flatMap(([label, count]) => (
        typeof count === "number" ? [{ key: label, label, count }] : []
      )),
    }];
  });
  const normalizedJobs = jobs.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const job = value as PhenomJob;
    if (!job.title || !job.applyUrl) return [];
    const workplace = `${job.checkRemote ?? ""} ${job.location ?? ""}`.toLowerCase();
    const latitude = typeof job.latitude === "number" ? job.latitude : Number.parseFloat(job.latitude ?? "");
    const longitude = typeof job.longitude === "number" ? job.longitude : Number.parseFloat(job.longitude ?? "");
    return [{
      externalId: job.jobId ?? job.jobSeqNo ?? null,
      title: job.title,
      company: source.company,
      location: job.location ?? job.cityStateCountry ?? null,
      arrangement: workplace.includes("remote") ? "remote" as const : workplace.includes("hybrid") ? "hybrid" as const : workplace.includes("on-site") || workplace.includes("onsite") ? "onsite" as const : "unknown" as const,
      employmentType: job.type ?? null,
      summary: plainText(job.descriptionTeaser),
      description: plainText(job.descriptionTeaser),
      ...(job.ml_skills?.length ? { skills: job.ml_skills } : {}),
      ...(job.category || job.multi_category?.length ? { department: job.category ?? job.multi_category?.join("; ") ?? null } : {}),
      ...(job.externalTeamName ? { team: job.externalTeamName } : {}),
      ...(job.industry ? { industry: job.industry } : {}),
      ...(job.multi_location?.length ? { secondaryLocations: job.multi_location } : {}),
      ...(job.city ? { locationCity: job.city } : {}),
      ...(job.state ? { locationState: job.state } : {}),
      ...(job.country ? { locationCountry: job.country } : {}),
      ...(Number.isFinite(latitude) ? { latitude } : {}),
      ...(Number.isFinite(longitude) ? { longitude } : {}),
      ...(job.reqId || job.jobId ? { requisitionId: job.reqId ?? job.jobId } : {}),
      officialUrl: job.applyUrl,
      publishedAt: normalizedDate(job.postedDate),
    }];
  });
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: totalHits !== null && totalHits <= normalizedJobs.length,
    jobs: normalizedJobs,
    ...(facets.length > 0 ? { facets } : {}),
    error: null,
    totalHits,
    pageHits,
  };
};

const crawlPhenomPages = async (source: CrawlSource, first: PhenomPage, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  if (first.pageHits === null) return first;
  const pageSize = first.pageHits;
  if (!first.totalHits || pageSize <= 0 || first.totalHits <= pageSize) return first;
  const offsets = Array.from({ length: Math.ceil(Math.min(first.totalHits, 10_000) / pageSize) - 1 }, (_, index) => (index + 1) * pageSize);
  const fetchPage = async (from: number): Promise<PhenomPage | null> => {
    try {
      const url = new URL(source.postingUrl);
      url.searchParams.set("from", String(from));
      url.searchParams.set("s", "1");
      const response = await fetchWithTimeout(fetcher, url);
      if (!response.ok) return null;
      return phenomJobs(await response.text(), source);
    } catch {
      return null;
    }
  };
  const pages: Array<PhenomPage | null> = [];
  for (let index = 0; index < offsets.length; index += 10) {
    pages.push(...await Promise.all(offsets.slice(index, index + 10).map(fetchPage)));
  }
  const successfulPages = pages.filter((page): page is PhenomPage => page !== null);
  const jobs = [...new Map([first, ...successfulPages]
    .flatMap((page) => page.jobs).map((job) => [job.officialUrl, job])).values()];
  return {
    status: "succeeded",
    responseStatus: first.responseStatus,
    completeListing: successfulPages.length === pages.length
      && jobs.length >= first.totalHits,
    jobs,
    ...(first.facets?.length ? { facets: first.facets } : {}),
    error: null,
  };
};

export const extractJobsFromHtml = (html: string, source: CrawlSource): { jobs: CrawledJob[]; completeListing: boolean } => {
  const phenom = phenomJobs(html, source);
  if (phenom) return { jobs: phenom.jobs, completeListing: phenom.completeListing };
  const embedded = embeddedJobItems(html, source);
  if (embedded.length > 0) return { jobs: embedded, completeListing: true };
  const nodes = jsonLdScripts(html).flatMap(jobPostingNodes);
  return {
    jobs: nodes.map((node) => jsonLdJob(node, source)).filter((job): job is CrawledJob => job !== null),
    completeListing: false,
  };
};

const jobPostingNodes = (value: JsonLdValue): JsonLdValue[] => {
  const nodes = [value, ...(Array.isArray(value["@graph"]) ? value["@graph"] : [])]
    .filter((node): node is JsonLdValue => Boolean(node) && typeof node === "object");
  return nodes.filter((node) => {
    const type = node["@type"];
    return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  });
};

const uniqueJobs = (jobs: CrawledJob[]): CrawledJob[] => [
  ...new Map(jobs.map((job) => [job.officialUrl, job])).values(),
];

const dataAttribute = (html: string, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, "i"))?.[1] ?? null;
};

const crawlRadancyPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/tbcdn\.talentbrew\.com/i.test(html)) return null;
  const postPath = dataAttribute(html, "data-ajax-post-url");
  const totalPages = Number(dataAttribute(html, "data-total-pages"));
  const totalResults = Number(dataAttribute(html, "data-total-job-results") ?? dataAttribute(html, "data-total-results"));
  const recordsPerPage = Number(dataAttribute(html, "data-records-per-page"));
  if (!postPath || !Number.isFinite(totalPages) || totalPages < 1 || !Number.isFinite(totalResults)) return null;

  const jobs = jobsFromBrowserAnchors(anchorsFromHtml(html), source);
  const pageNumbers = Array.from({ length: Math.min(totalPages, 1_000) - 1 }, (_, index) => index + 2);
  let successfulPages = 0;
  for (let index = 0; index < pageNumbers.length; index += 10) {
    const pages = await Promise.all(pageNumbers.slice(index, index + 10).map(async (currentPage) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetchWithTimeout(fetcher, new URL(postPath, source.postingUrl), {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8", "x-requested-with": "XMLHttpRequest" },
            body: JSON.stringify({
            ActiveFacetID: Number(dataAttribute(html, "data-active-facet-id") ?? 0),
            CurrentPage: currentPage,
            RecordsPerPage: recordsPerPage,
            TotalPages: totalPages,
            TotalResults: totalResults,
            Distance: Number(dataAttribute(html, "data-distance") ?? 0),
            Keywords: dataAttribute(html, "data-keywords") ?? "",
            Location: dataAttribute(html, "data-location") ?? "",
            ShowRadius: dataAttribute(html, "data-show-radius") === "True",
            IsPagination: "True",
            FacetFilters: [],
            StaticFacets: [],
            SearchResultsModuleName: dataAttribute(html, "data-search-results-module-name") ?? "Search Results",
            SortCriteria: Number(dataAttribute(html, "data-sort-criteria") ?? 0),
            SortDirection: Number(dataAttribute(html, "data-sort-direction") ?? 0),
            SearchType: Number(dataAttribute(html, "data-search-type") ?? 0),
            RefinedKeywords: [],
            ResultsType: Number(dataAttribute(html, "data-results-type") ?? 0),
            }),
          });
          if (response.ok) {
            const payload = await response.json() as { results?: string };
            return typeof payload.results === "string" ? jobsFromBrowserAnchors(anchorsFromHtml(payload.results), source) : null;
          }
        } catch {
          // Retry transient page failures before keeping the listing incomplete.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      return null;
    }));
    successfulPages += pages.filter((page): page is CrawledJob[] => page !== null).length;
    jobs.push(...pages.flatMap((page) => page ?? []));
  }
  const normalized = uniqueJobs(jobs);
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: totalPages <= 1_000 && successfulPages === pageNumbers.length && normalized.length >= totalResults,
    jobs: normalized,
    error: null,
  };
};

const successFactorsRange = (html: string): { pageSize: number; total: number } | null => {
  const match = html.match(/class=["'][^"']*paginationLabel[^"']*["'][^>]*>[\s\S]*?Results\s*<b>\s*[\d,]+\s*(?:–|-|&ndash;)\s*([\d,]+)\s*<\/b>\s*of\s*<b>\s*([\d,]+)/i);
  if (!match) return null;
  const pageSize = Number(match[1].replaceAll(",", ""));
  const total = Number(match[2].replaceAll(",", ""));
  return Number.isFinite(pageSize) && pageSize > 0 && Number.isFinite(total) ? { pageSize, total } : null;
};

const crawlSuccessFactorsPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/\.sapsf\.com\//i.test(html)) return null;
  const range = successFactorsRange(html);
  if (!range) return null;
  const paginationHref = anchorsFromHtml(html).find(({ href }) => /[?&]startrow=\d+/i.test(href))?.href;
  const jobs = jobsFromBrowserAnchors(anchorsFromHtml(html), source);
  if (range.total <= range.pageSize) return { status: "succeeded", responseStatus: 200, completeListing: jobs.length >= range.total, jobs: uniqueJobs(jobs), error: null };
  if (!paginationHref) return null;

  const offsets = Array.from({ length: Math.ceil(range.total / range.pageSize) - 1 }, (_, index) => (index + 1) * range.pageSize);
  let successfulPages = 0;
  for (let index = 0; index < offsets.length; index += 10) {
    const pages = await Promise.all(offsets.slice(index, index + 10).map(async (offset) => {
      try {
        const url = new URL(paginationHref, source.postingUrl);
        url.searchParams.set("startrow", String(offset));
        const response = await fetchWithTimeout(fetcher, url);
        if (!response.ok) return null;
        return jobsFromBrowserAnchors(anchorsFromHtml(await response.text()), source);
      } catch {
        return null;
      }
    }));
    successfulPages += pages.filter((page): page is CrawledJob[] => page !== null).length;
    jobs.push(...pages.flatMap((page) => page ?? []));
  }
  const normalized = uniqueJobs(jobs);
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: successfulPages === offsets.length && normalized.length >= range.total,
    jobs: normalized,
    error: null,
  };
};

const crawlTalentHubPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!new URL(source.postingUrl).hostname.endsWith(".talenthub.jobs")) return null;
  const range = html.match(/Showing\s*<span[^>]*>\s*([\d,]+)\s*<\/span>\s*to\s*<span[^>]*>\s*([\d,]+)\s*<\/span>\s*of\s*<span[^>]*>\s*([\d,]+)\s*<\/span>\s*results/i);
  if (!range) return null;
  const first = Number(range[1].replaceAll(",", ""));
  const last = Number(range[2].replaceAll(",", ""));
  const total = Number(range[3].replaceAll(",", ""));
  const pageSize = last - first + 1;
  const paginationHref = anchorsFromHtml(html).find(({ href }) => /[?&]page=\d+/i.test(href))?.href;
  if (!Number.isFinite(pageSize) || pageSize < 1 || !Number.isFinite(total) || (total > pageSize && !paginationHref)) return null;

  const jobs = jobsFromBrowserAnchors(anchorsFromHtml(html), source);
  const pageNumbers = Array.from({ length: Math.max(0, Math.ceil(total / pageSize) - 1) }, (_, index) => index + 2);
  let successfulPages = 0;
  for (let index = 0; index < pageNumbers.length; index += 8) {
    const pages = await Promise.all(pageNumbers.slice(index, index + 8).map(async (pageNumber) => {
      try {
        const url = new URL(paginationHref!, source.postingUrl);
        url.searchParams.set("page", String(pageNumber));
        const response = await fetchWithTimeout(fetcher, url);
        if (!response.ok) return null;
        return jobsFromBrowserAnchors(anchorsFromHtml(await response.text()), source);
      } catch {
        return null;
      }
    }));
    successfulPages += pages.filter((page): page is CrawledJob[] => page !== null).length;
    jobs.push(...pages.flatMap((page) => page ?? []));
  }
  const normalized = uniqueJobs(jobs);
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: successfulPages === pageNumbers.length && normalized.length >= total,
    jobs: normalized,
    error: null,
  };
};

const crawlAvaturePages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/avature\.portal\.page["']?\s+content=["']SearchCareer/i.test(html)) return null;
  const text = plainText(html) ?? "";
  const range = text.match(/\b[\d,]+\s*-\s*([\d,]+)\s+of\s+([\d,]+)(\+)?\s+results\b/i);
  if (!range) return null;
  const pageSize = Number(range[1].replaceAll(",", ""));
  const total = Number(range[2].replaceAll(",", ""));
  const openEndedTotal = range[3] === "+";
  if (!Number.isFinite(pageSize) || pageSize < 1 || !Number.isFinite(total)) return null;

  const jobsOnPage = (pageHtml: string) => jobsFromBrowserAnchors(
    anchorsFromHtml(pageHtml).filter(({ href }) => /\/careers\/JobDetail\//i.test(href)),
    source,
  );
  const jobs = jobsOnPage(html);
  const paginationHref = anchorsFromHtml(html).find(({ href }) => /[?&]jobOffset=\d+/i.test(href))?.href;
  if (total <= pageSize) return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: jobs.length >= total,
    jobs: uniqueJobs(jobs),
    error: null,
  };
  if (!paginationHref) return null;

  const boundedTotal = openEndedTotal ? 10_000 : Math.min(total, 10_000);
  const offsets = Array.from({ length: Math.max(0, Math.ceil(boundedTotal / pageSize) - 1) }, (_, index) => (index + 1) * pageSize);
  let successfulPages = 0;
  let reachedEnd = false;
  let pageFailure = false;
  for (let index = 0; index < offsets.length; index += 10) {
    const pages = await Promise.all(offsets.slice(index, index + 10).map(async (offset) => {
      try {
        const url = new URL(paginationHref, source.postingUrl);
        url.searchParams.set("jobRecordsPerPage", String(pageSize));
        url.searchParams.set("jobOffset", String(offset));
        const response = await fetchWithTimeout(fetcher, url);
        if (!response.ok) return null;
        return jobsOnPage(await response.text());
      } catch {
        return null;
      }
    }));
    const firstShortPage = openEndedTotal ? pages.findIndex((page) => page !== null && page.length < pageSize) : -1;
    const acceptedPages = firstShortPage >= 0 ? pages.slice(0, firstShortPage + 1) : pages;
    if (acceptedPages.some((page) => page === null)) pageFailure = true;
    successfulPages += acceptedPages.filter((page): page is CrawledJob[] => page !== null).length;
    jobs.push(...acceptedPages.flatMap((page) => page ?? []));
    if (firstShortPage >= 0) {
      reachedEnd = true;
      break;
    }
  }
  const normalized = uniqueJobs(jobs);
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: openEndedTotal
      ? reachedEnd && !pageFailure
      : total <= 10_000 && successfulPages === offsets.length && normalized.length >= total,
    jobs: normalized,
    error: null,
  };
};

const asText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

const normalizedDate = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const crawlMcKinsey = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const sourceUrl = new URL(source.postingUrl);
  const query = sourceUrl.searchParams.get("query")?.trim() || source.company.replace(/^.*?—\s*/, "").trim();
  const jobs: McKinseyJob[] = [];
  const seen = new Set<string>();
  let responseStatus: number | null = null;
  let total = Number.POSITIVE_INFINITY;
  let start = 0;
  const pageSize = 100;

  try {
    while (jobs.length < Math.min(total, 10_000)) {
      const endpoint = new URL("https://gateway.mckinsey.com/apigw-x0cceuow60/v1/api/jobs/search");
      endpoint.searchParams.set("pageSize", String(pageSize));
      endpoint.searchParams.set("start", String(start));
      endpoint.searchParams.set("lang", "en");
      endpoint.searchParams.set("q", query);
      const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
      responseStatus = response.status;
      if (!response.ok) return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus,
        completeListing: false,
        jobs: [],
        error: `McKinsey jobs API returned HTTP ${response.status}.`,
      };
      const payload = await response.json() as { numFound?: number; docs?: McKinseyJob[] };
      const additions = payload.docs ?? [];
      total = Number.isFinite(payload.numFound) ? Number(payload.numFound) : jobs.length + additions.length;
      if (additions.length === 0) break;
      start += additions.length;
      let progressed = false;
      for (const job of additions) {
        const identity = job.jobID ?? job.friendlyURL;
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        jobs.push(job);
        progressed = true;
      }
      if (!progressed) break;
    }

    const normalized = jobs.flatMap((job): CrawledJob[] => {
      if (!job.jobID || !job.title) return [];
      const cities = job.cities?.filter(Boolean) ?? [];
      const countries = job.countries?.filter(Boolean) ?? [];
      const location = [cities.join("; "), countries.join("; ")].filter(Boolean).join(", ") || null;
      const responsibilities = plainText(job.whatYouWillDo);
      const qualifications = plainText(job.yourBackground);
      const description = [plainText(job.whoYouWillWorkWith), responsibilities].filter(Boolean).join(" ") || null;
      const friendlyUrl = job.friendlyURL
        ? new URL(`/careers/search-jobs/jobs/${job.friendlyURL.replace(/^\/+/, "")}`, "https://www.mckinsey.com").href
        : job.jobApplyURL;
      if (!friendlyUrl) return [];
      return [{
        externalId: job.jobID,
        title: job.title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(`${job.title} ${location ?? ""}`) ? "remote" : "unknown",
        employmentType: null,
        summary: responsibilities ?? description,
        description,
        responsibilities,
        qualifications,
        ...(job.jobSkillCode?.length ? { skills: job.jobSkillCode } : {}),
        department: job.interest ?? null,
        jobFamily: job.interestCategory ?? null,
        jobFunction: job.functions?.join("; ") || null,
        industry: job.linkedInIndustry?.join("; ") || null,
        secondaryLocations: cities.slice(1),
        locationCity: cities[0] ?? null,
        locationCountry: countries.join("; ") || null,
        experienceLevel: job.linkedInSeniorityLevel?.join("; ") || null,
        requisitionId: job.jobID,
        applyUrl: job.jobApplyURL ?? null,
        officialUrl: friendlyUrl,
        publishedAt: normalizedDate(job.postedToLinkedInDate),
      }];
    });

    return {
      status: "succeeded",
      responseStatus,
      completeListing: total <= 10_000 && normalized.length >= total,
      jobs: normalized,
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown McKinsey crawler error.",
    };
  }
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

const jobLocationAddress = (value: unknown): JsonLdValue | null => {
  if (!value || typeof value !== "object") return null;
  const address = (value as JsonLdValue).address;
  return address && typeof address === "object" ? address as JsonLdValue : null;
};

const textList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(asText).filter((item): item is string => Boolean(item));
  const text = asText(value);
  return text ? text.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean) : [];
};

const salaryFields = (value: unknown): Pick<CrawledJob, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryInterval"> => {
  if (!value || typeof value !== "object") return {};
  const salary = value as JsonLdValue;
  const amount = salary.value && typeof salary.value === "object" ? salary.value as JsonLdValue : salary;
  const min = typeof amount.minValue === "number" ? amount.minValue : typeof amount.value === "number" ? amount.value : null;
  const max = typeof amount.maxValue === "number" ? amount.maxValue : typeof amount.value === "number" ? amount.value : null;
  return {
    ...(min != null ? { salaryMin: min } : {}),
    ...(max != null ? { salaryMax: max } : {}),
    ...(asText(salary.currency) ? { salaryCurrency: asText(salary.currency) } : {}),
    ...(asText(amount.unitText) ? { salaryInterval: asText(amount.unitText) } : {}),
  };
};

const jsonLdJob = (value: JsonLdValue, source: CrawlSource): CrawledJob | null => {
  const title = asText(value.title);
  const officialUrl = asText(value.url);
  if (!title || !officialUrl) return null;
  const identifier = value.identifier;
  const externalId = typeof identifier === "object" && identifier
    ? asText((identifier as JsonLdValue).value) ?? asText((identifier as JsonLdValue)["@id"])
    : asText(identifier);
  const description = asText(value.description);
  const address = jobLocationAddress(value.jobLocation);
  const skills = textList(value.skills);

  return {
    externalId,
    title,
    company: source.company,
    location: jobLocation(value.jobLocation),
    arrangement: value.jobLocationType === "TELECOMMUTE" ? "remote" : "unknown",
    employmentType: normalizeEmploymentType(value.employmentType),
    summary: plainText(description),
    description: plainText(description),
    ...(asText(value.responsibilities) ? { responsibilities: plainText(asText(value.responsibilities)) } : {}),
    ...(asText(value.qualifications) ? { qualifications: plainText(asText(value.qualifications)) } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(asText(value.educationRequirements) ? { educationRequirements: plainText(asText(value.educationRequirements)) } : {}),
    ...(asText(value.experienceRequirements) ? { experienceRequirements: plainText(asText(value.experienceRequirements)) } : {}),
    ...(address && asText(address.addressLocality) ? { locationCity: asText(address.addressLocality) } : {}),
    ...(address && asText(address.addressRegion) ? { locationState: asText(address.addressRegion) } : {}),
    ...(address && asText(address.addressCountry) ? { locationCountry: asText(address.addressCountry) } : {}),
    ...(address && asText(address.postalCode) ? { locationPostalCode: asText(address.postalCode) } : {}),
    ...salaryFields(value.baseSalary),
    ...(normalizedDate(value.validThrough) ? { validThrough: normalizedDate(value.validThrough) } : {}),
    officialUrl,
    publishedAt: normalizedDate(value.datePosted),
  };
};

async function crawlJsonLd(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl);
    if (!response.ok) {
      return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: `Career site returned HTTP ${response.status}.`,
      };
    }
    const html = await response.text();
    const oracle = oracleCareerSite(html, source.postingUrl);
    if (oracle) return crawlOracle(source, oracle, fetcher);
    const radancy = await crawlRadancyPages(source, html, fetcher);
    if (radancy) return radancy;
    const successFactors = await crawlSuccessFactorsPages(source, html, fetcher);
    if (successFactors) return successFactors;
    const talentHub = await crawlTalentHubPages(source, html, fetcher);
    if (talentHub) return talentHub;
    const avature = await crawlAvaturePages(source, html, fetcher);
    if (avature) return avature;
    const phenom = phenomJobs(html, source);
    if (phenom) return crawlPhenomPages(source, phenom, fetcher);
    const discovered = discoverAts(html, source.postingUrl);
    if (discovered) {
      const discoveredResult = discovered.kind === "workday"
        ? await crawlWorkday(source, discovered.endpoint, fetcher, now)
        : await crawlDiscoveredFeed(source, discovered, fetcher);
      if (discoveredResult.status === "succeeded") return discoveredResult;
    }
    const extracted = extractJobsFromHtml(html, source);
    if (extracted.jobs.length > 0) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: extracted.completeListing,
      jobs: extracted.jobs,
      error: null,
    };
    const linked = jobsFromBrowserAnchors(anchorsFromHtml(html), source);
    if (linked.length > 0) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: false,
      jobs: linked,
      error: null,
    };
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
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

async function crawlEightfold(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const origin = new URL(source.postingUrl).origin;
  const positions: EightfoldPosition[] = [];
  let facets: CrawledFacet[] = [];
  let responseStatus: number | null = null;
  try {
    const fetchPage = async (start: number, requirePositions = false) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const endpoint = new URL("/api/apply/v2/jobs", origin);
        endpoint.searchParams.set("start", String(start));
        endpoint.searchParams.set("num", "10");
        endpoint.searchParams.set("sort_by", "relevance");
        const response = await fetchWithTimeout(fetcher, endpoint);
        responseStatus = response.status;
        if (!response.ok) throw new Error(`Eightfold returned HTTP ${response.status}.`);
        const payload = await response.json() as { count?: number; positions?: EightfoldPosition[]; facets?: Record<string, Record<string, number>> };
        if (start === 0 && payload.facets) {
          facets = Object.entries(payload.facets).map(([key, values]) => ({
            key,
            label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
            values: Object.entries(values).map(([label, count]) => ({ key: label, label, count })),
          }));
        }
        if (!requirePositions || (payload.positions?.length ?? 0) > 0 || attempt === 2) return payload;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
      return { positions: [] };
    };
    const first = await fetchPage(0);
    positions.push(...(first.positions ?? []));
    const total = first.count ?? positions.length;
    const pageSize = Math.max(positions.length, 1);
    const offsets = Array.from({ length: Math.max(0, Math.ceil((total - pageSize) / pageSize)) }, (_, index) => pageSize * (index + 1));
    for (let index = 0; index < offsets.length; index += 8) {
      const pages = await Promise.all(offsets.slice(index, index + 8).map((offset) => fetchPage(offset, true)));
      positions.push(...pages.flatMap((page) => page.positions ?? []));
    }
    const uniquePositions = [...new Map(positions.map((position) => [String(position.id), position])).values()];
    return {
      status: "succeeded",
      responseStatus,
      completeListing: uniquePositions.length >= total,
      jobs: uniquePositions.flatMap((position) => position.id != null && position.name ? [{
        externalId: position.ats_job_id ?? String(position.id),
        title: position.name,
        company: source.company,
        location: position.location ?? null,
        arrangement: /remote/i.test(`${position.location ?? ""} ${position.work_location_option ?? ""}`) ? "remote" as const : /hybrid/i.test(position.work_location_option ?? "") ? "hybrid" as const : "unknown" as const,
        employmentType: position.type ?? null,
        summary: position.department ?? null,
        ...(position.department ? { department: position.department } : {}),
        ...(position.business_unit ? { businessUnit: position.business_unit } : {}),
        ...(position.job_description ? { description: plainText(position.job_description) } : {}),
        requisitionId: position.ats_job_id ?? String(position.id),
        officialUrl: position.canonicalPositionUrl ?? `${origin}/careers/job/${position.id}`,
        publishedAt: position.t_create ? new Date(position.t_create * 1000).toISOString() : null,
      }] : []),
      ...(facets.length > 0 ? { facets } : {}),
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Eightfold crawler error.",
    };
  }
}

async function crawlAdpMyJobs(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  const slug = page.pathname.split("/").filter(Boolean)[0];
  if (!slug) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "ADP MyJobs career-site slug is missing." };
  let responseStatus: number | null = null;
  try {
    const siteResponse = await fetchWithTimeout(fetcher, `${page.origin}/public/staffing/v1/career-site/${slug}`, {
      headers: { accept: "application/json", origin: page.origin, referer: `${page.origin}/` },
    });
    responseStatus = siteResponse.status;
    if (!siteResponse.ok) throw new Error(`ADP career-site API returned HTTP ${siteResponse.status}.`);
    const site = await siteResponse.json() as { myJobsToken?: string };
    if (!site.myJobsToken) throw new Error("ADP career-site API did not return a public MyJobs token.");
    const requisitions: AdpJob[] = [];
    let total = Number.POSITIVE_INFINITY;
    while (requisitions.length < total) {
      const endpoint = new URL("https://my.adp.com/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters");
      endpoint.searchParams.set("$orderby", "postingDate desc");
      endpoint.searchParams.set("$select", "reqId,jobTitle,publishedJobTitle,type,jobDescription,jobQualifications,workLocations,workLevelCode,clientRequisitionID,postingDate,requisitionLocations");
      endpoint.searchParams.set("$top", "100");
      endpoint.searchParams.set("$skip", String(requisitions.length));
      endpoint.searchParams.set("tz", "America/Los_Angeles");
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US",
          myjobstoken: site.myJobsToken,
          origin: page.origin,
          referer: `${page.origin}/`,
          rolecode: "manager",
        },
      });
      responseStatus = response.status;
      if (!response.ok) throw new Error(`ADP requisitions API returned HTTP ${response.status}.`);
      const payload = await response.json() as { count?: number; jobRequisitions?: AdpJob[] };
      const additions = payload.jobRequisitions ?? [];
      total = payload.count ?? requisitions.length + additions.length;
      if (additions.length === 0) break;
      requisitions.push(...additions);
    }
    const uniqueRequisitions = [...new Map(requisitions.map((job) => [job.clientRequisitionID ?? job.reqId, job])).values()];
    return {
      status: "succeeded",
      responseStatus,
      completeListing: requisitions.length >= total,
      jobs: uniqueRequisitions.flatMap((job) => {
        const id = job.clientRequisitionID ?? job.reqId;
        const title = job.publishedJobTitle ?? job.jobTitle;
        if (!id || !title) return [];
        const location = job.requisitionLocations?.map(({ address }) => [address?.cityName, address?.countrySubdivisionLevel1?.longName, address?.country?.longName].filter(Boolean).join(", ")).filter(Boolean).join("; ") || null;
        const primaryAddress = job.requisitionLocations?.[0]?.address;
        return [{
          externalId: id,
          title,
          company: source.company,
          location,
          arrangement: /remote/i.test(location ?? "") ? "remote" as const : "unknown" as const,
          employmentType: job.workLevelCode ?? null,
          summary: plainText(job.jobDescription),
          description: plainText(job.jobDescription),
          qualifications: plainText(job.jobQualifications),
          requisitionId: id,
          ...(primaryAddress?.cityName ? { locationCity: primaryAddress.cityName } : {}),
          ...(primaryAddress?.countrySubdivisionLevel1?.longName ? { locationState: primaryAddress.countrySubdivisionLevel1.longName } : {}),
          ...(primaryAddress?.country?.longName ? { locationCountry: primaryAddress.country.longName } : {}),
          officialUrl: `${page.origin}/${slug}/cx/job-details?reqId=${encodeURIComponent(id)}`,
          publishedAt: normalizedDate(job.postingDate),
        }];
      }),
      error: null,
    };
  } catch (error) {
    return { status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed", responseStatus, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown ADP MyJobs crawler error." };
  }
}

async function crawlTesla(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const endpoint = "https://www.tesla.com/cua-api/apps/careers/state";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      headers: { accept: "application/json", referer: source.postingUrl },
    });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Tesla careers API returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as TeslaState;
    const usLocations = new Set(payload.geo?.flatMap((region) => region.sites ?? [])
      .filter((site) => site.id === "US")
      .flatMap((site) => Object.values(site.cities ?? {}).flat()) ?? []);
    const jobs = (payload.listings ?? []).flatMap((listing) => {
      if (!listing.id || !listing.t || !listing.l || !usLocations.has(listing.l)) return [];
      const slug = listing.t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const location = payload.lookup?.locations?.[listing.l] ?? null;
      return [{
        externalId: listing.id,
        title: listing.t,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(location ?? "") ? "remote" as const : "unknown" as const,
        employmentType: payload.lookup?.types?.[String(listing.y)] ?? null,
        summary: payload.lookup?.departments?.[listing.dp ?? ""] ?? null,
        department: payload.lookup?.departments?.[listing.dp ?? ""] ?? null,
        officialUrl: `https://www.tesla.com/careers/search/job/${slug}-${listing.id}`,
        publishedAt: null,
      }];
    });
    return { status: "succeeded", responseStatus: response.status, completeListing: true, jobs, error: null };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Tesla crawler error.",
    };
  }
}

const workdayPublishedAt = (value: string | undefined, now: Date): string | null => {
  if (!value) return null;
  if (/posted\s+today/i.test(value)) return now.toISOString();
  if (/posted\s+yesterday/i.test(value)) return new Date(now.getTime() - 86_400_000).toISOString();
  const days = value.match(/posted\s+(\d+)\s+days?\s+ago/i)?.[1];
  if (days) return new Date(now.getTime() - Number(days) * 86_400_000).toISOString();
  return normalizedDate(value);
};

async function crawlWorkday(source: CrawlSource, endpoint: string, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  try {
    const endpointUrl = new URL(endpoint);
    const site = endpointUrl.pathname.split("/").at(-2);
    const referer = site ? `${endpointUrl.origin}/${site}` : endpointUrl.origin;
    const jobs: CrawledJob[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let responseStatus = 200;
    let facets: CrawledFacet[] = [];

    while (offset < total && offset < 2_000) {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: endpointUrl.origin,
          referer,
        },
        // Workday's public CXS endpoint rejects page sizes above 20.
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }),
      });
      responseStatus = response.status;
      if (!response.ok) {
        return {
          status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
          responseStatus: response.status,
          completeListing: false,
          jobs: [],
          error: `Workday returned HTTP ${response.status}.`,
        };
      }

      const payload = await response.json() as { total?: number; jobPostings?: WorkdayJob[]; facets?: WorkdayFacet[] };
      const page = payload.jobPostings ?? [];
      if (offset === 0) {
        facets = (payload.facets ?? []).flatMap((facet) => facet.facetParameter && facet.descriptor ? [{
          key: facet.facetParameter,
          label: facet.descriptor,
          values: (facet.values ?? []).flatMap((value) => value.id && value.descriptor ? [{ key: value.id, label: value.descriptor, count: value.count ?? null }] : []),
        }] : []);
      }
      // Some Workday tenants report a window-relative `total` on subsequent
      // pages. The first page is the only reliable total for pagination.
      if (!Number.isFinite(total)) total = payload.total ?? page.length;
      jobs.push(...page.flatMap((job) => {
        // Workday tenants occasionally include non-job cards alongside postings.
        // Skip those records instead of failing an otherwise valid source crawl.
        if (!job.title || !job.externalPath) return [];
        const externalId = job.externalPath.split("_").at(-1) ?? null;
        const bulletFields = workdayBulletFields(job.bulletFields);
        return [{
          externalId,
          title: job.title,
          company: source.company,
          location: job.locationsText ?? job.locations?.join(", ") ?? null,
          arrangement: "unknown" as const,
          employmentType: bulletFields.employmentType,
          summary: job.bulletFields?.join(" · ") ?? null,
          department: bulletFields.department,
          sourcePostedText: job.postedOn ?? null,
          officialUrl: new URL(job.externalPath, endpointUrl.origin).href,
          publishedAt: workdayPublishedAt(job.postedOn, now),
        }];
      }));
      if (page.length === 0) break;
      offset += page.length;
    }

    return { status: "succeeded", responseStatus, completeListing: offset >= total, jobs, ...(facets.length > 0 ? { facets } : {}), error: null };
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
  if (source.id === "p5-1077-tesla" || source.company === "Tesla") return crawlTesla(source, fetcher);
  if (new URL(source.postingUrl).hostname.endsWith("mckinsey.com") && new URL(source.postingUrl).pathname.includes("/careers/search-jobs")) return crawlMcKinsey(source, fetcher);
  if (new URL(source.postingUrl).hostname.endsWith("eightfold.ai")) return crawlEightfold(source, fetcher);
  if (new URL(source.postingUrl).hostname === "myjobs.adp.com") return crawlAdpMyJobs(source, fetcher);
  const board = source.adapter === "greenhouse" ? greenhouseBoard(source.postingUrl) : null;
  const workday = source.adapter === "workday" ? workdayFeed(source.postingUrl) : null;
  if (workday) return crawlWorkday(source, workday, fetcher, now);
  if (source.adapter === "ashby") {
    const slug = new URL(source.postingUrl).pathname.split("/").filter(Boolean).at(0);
    if (slug) return crawlDiscoveredFeed(source, {
      kind: "ashby",
      endpoint: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    }, fetcher);
  }
  if (!board) {
    return crawlJsonLd(source, fetcher, now);
  }

  try {
    const response = await fetchWithTimeout(fetcher, `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
    if (!response.ok) {
      return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
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
        description: plainText(job.content),
        ...(job.departments?.length ? { department: job.departments.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
        ...(job.offices?.length ? { office: job.offices.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
        ...(job.requisition_id ? { requisitionId: job.requisition_id } : {}),
        ...(job.first_published ? { sourceUpdatedAt: normalizedDate(job.updated_at) } : {}),
        ...((job.metadata?.length || job.departments?.length || job.offices?.length) ? { rawPayload: { metadata: job.metadata ?? [], departments: job.departments ?? [], offices: job.offices ?? [] } } : {}),
        officialUrl: job.absolute_url,
        publishedAt: normalizedDate(job.first_published ?? job.updated_at),
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
