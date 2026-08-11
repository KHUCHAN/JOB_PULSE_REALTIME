import { jobsFromBrowserAnchors, type BrowserAnchor } from "./browser-job-extractor.ts";
import { normalizeEmploymentType, workdayBulletFields } from "./employment-type.ts";
import { classifyJobPrograms } from "./job-program-classifier.ts";

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

type WorkdayPayload = {
  total?: number;
  jobPostings?: WorkdayJob[];
  facets?: WorkdayFacet[];
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
  locations?: string[];
  standardizedLocations?: string[];
  ats_job_id?: string;
  atsJobId?: string;
  displayJobId?: string;
  department?: string;
  work_location_option?: string | null;
  workLocationOption?: string | null;
  canonicalPositionUrl?: string;
  positionUrl?: string;
  t_create?: number;
  creationTs?: number;
  postedTs?: number;
  business_unit?: string;
  businessUnit?: string;
  type?: string;
  job_description?: string;
  jobDescription?: string;
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

type WorkforceNowJob = {
  itemID?: string;
  requisitionTitle?: string;
  clientRequisitionID?: string;
  postDate?: string;
  requisitionDescription?: string;
  workLevelCode?: { shortName?: string };
  requisitionLocations?: Array<{
    nameCode?: { shortName?: string };
    address?: { cityName?: string; countrySubdivisionLevel1?: { codeValue?: string; longName?: string }; country?: { longName?: string }; countryCode?: string };
  }>;
  customFieldGroup?: { stringFields?: Array<{ stringValue?: string; nameCode?: { codeValue?: string } }> };
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

export type TeslaState = {
  lookup?: {
    locations?: Record<string, string>;
    departments?: Record<string, string>;
    types?: Record<string, string>;
  };
  geo?: Array<{ sites?: Array<{
    id?: string;
    cities?: Record<string, string[]>;
    states?: Array<{ id?: string; name?: string; cities?: Record<string, string[]> }>;
  }> }>;
  listings?: TeslaListing[];
};

type MetaCareerJob = {
  id?: string;
  title?: string;
  locations?: string[];
  teams?: string[];
  sub_teams?: string[];
};

type MetaCareerPayload = {
  data?: {
    job_search_with_featured_jobs_v2?: {
      all_jobs?: MetaCareerJob[];
    };
  };
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

type MediaTekJob = {
  id?: string;
  title?: string;
  summary?: string | null;
  description?: string | null;
  publishedDate?: string | null;
  properties?: {
    category?: { label?: string | null; code?: string | null } | null;
    workExperience?: { label?: string | null; code?: string | null } | null;
    location?: { label?: string | null; code?: string | null } | null;
    program?: { label?: string | null; code?: string | null } | null;
    jobEducationInfos?: Array<{ educationDegree?: string | null; educationMajor?: string | null }>;
  } | null;
};

type PaylocityJob = {
  JobId?: number | string;
  JobTitle?: string;
  LocationName?: string | null;
  PublishedDate?: string | null;
  Description?: string | null;
  HiringDepartment?: string | null;
  JobLocation?: {
    City?: string | null;
    State?: string | null;
    Zip?: string | null;
    Country?: string | null;
  } | null;
  IsRemote?: boolean;
};

type EpamJob = {
  uid?: string;
  unique_id?: string;
  name?: string;
  posting_type?: string;
  city?: Array<{ name?: string; state?: { name?: string }; country?: { id?: string; name?: string } }>;
  country?: Array<{ id?: string; name?: string }>;
  vacancy_type?: string;
  seniority?: string;
  skills?: string[];
  primary_skill?: string;
  request_id?: string;
  description?: string;
  category?: { responsibilities?: string[] | null; requirements?: string[] | null };
  seo?: { url?: string };
  created_at?: string;
  updated_at?: string;
  benefits?: Array<{ content?: string }>;
  job_specialization?: string[];
};

type EpamPayload = {
  props?: { pageProps?: { jobs?: {
    total?: number;
    jobs?: EpamJob[];
    facets?: Record<string, Array<{ key?: unknown; doc_count?: number }>>;
  } } };
};

type TalemetryLocation = {
  locality?: string | null;
  region_abbr?: string | null;
  region_full?: string | null;
  country?: string | null;
  postal_code?: string | null;
  name?: string | null;
};

type TalemetryEntry = {
  id?: string | number;
  talemetry_job_id?: string | number;
  permalink?: string;
  title?: string;
  location?: TalemetryLocation | null;
  employment_type?: string | null;
  date_posted?: string | null;
  posted_at?: string | null;
  updated_at?: string | null;
};

type TalemetryPayload = {
  current_page?: number;
  per_page?: number;
  total_entries?: number;
  entries?: TalemetryEntry[];
};

const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_ATTEMPTS = 2;
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 429, 520, 521, 522, 523, 524]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
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
  browserHeaders = true,
  requestOptions?: { attempts?: number; timeoutMs?: number },
): Promise<Response> => {
  const defaults: Record<string, string> = browserHeaders ? BROWSER_REQUEST_HEADERS : {};
  const headers = init?.headers instanceof Headers
    ? new Headers(init.headers)
    : { ...defaults, ...(init?.headers ?? {}) };
  if (headers instanceof Headers) {
    for (const [name, value] of Object.entries(defaults)) {
      if (!headers.has(name)) headers.set(name, value);
    }
  }

  let lastError: unknown;
  const attempts = requestOptions?.attempts ?? REQUEST_ATTEMPTS;
  const timeoutMs = requestOptions?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${timeoutMs / 1_000} second crawl timeout`)), timeoutMs);
    try {
      const response = await fetcher(input, { ...init, headers, signal: controller.signal });
      if (!RETRYABLE_HTTP_STATUSES.has(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1_000
        : 250;
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfterMs, 0), 750)));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
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

const smartRecruitersFeed = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!/^(?:jobs|careers)\.smartrecruiters\.com$/i.test(url.hostname)) return null;
  const company = url.pathname.split("/").filter(Boolean)[0];
  return company ? `https://api.smartrecruiters.com/v1/companies/${company}/postings` : null;
};

export function discoverAts(html: string, _pageUrl: string): DiscoveredAts | null {
  const greenhouse = html.match(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i);
  if (greenhouse) return { kind: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${greenhouse[1]}/jobs?content=true` };

  const workday = html.match(/https?:\/\/[^\s"'<>]+\.(?:myworkdayjobs|myworkdaysite)\.com\/[^\s"'<>?#]+/i);
  const workdayEndpoint = workday ? workdayFeed(workday[0]) : null;
  if (workdayEndpoint) return { kind: "workday", endpoint: workdayEndpoint };

  const lever = html.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9-]+)/i);
  if (lever) return { kind: "lever", endpoint: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };

  const ashby = html.match(/https?:\/\/jobs\.ashbyhq\.com\/([^\s"'<>/?#]+)/i);
  if (ashby) return { kind: "ashby", endpoint: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}` };

  const smartRecruiters = html.match(/https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9-]+)/i);
  if (smartRecruiters) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruiters[1]}/postings` };

  const smartRecruitersWidget = html.match(/["']company_code["']\s*:\s*["']([a-z0-9-]+)["']/i);
  if (smartRecruitersWidget) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruitersWidget[1]}/postings` };

  if (/(?:app\.jibecdn\.com\/prod\/search\/|cms\.jibecdn\.com\/prod\/)/i.test(html)) {
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
          officialUrl: new URL(
            `${prefix.replace(/\/$/, "")}/jobs/${encodeURIComponent(data.slug)}${data.language ? `?lang=${encodeURIComponent(data.language)}` : ""}`,
            listing.origin,
          ).href,
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
  const segments = url.pathname.split("/").filter(Boolean);
  const isWorkdayJobs = url.hostname.includes(".myworkdayjobs.com");
  const isWorkdaySite = url.hostname.endsWith(".myworkdaysite.com") && segments[0]?.toLocaleLowerCase() === "recruiting";
  if (!isWorkdayJobs && !isWorkdaySite) return null;
  const tenant = isWorkdaySite ? segments[1] : url.hostname.split(".")[0];
  const site = isWorkdaySite
    ? segments[2]
    : segments.find((segment) => !/^[a-z]{2}-[A-Z]{2}$/i.test(segment));
  if (!tenant || !site) return null;
  return `${url.origin}/wday/cxs/${tenant}/${site}/jobs`;
};

export const oracleCareerSite = (html: string, postingUrl: string): { apiOrigin: string; site: string } | null => {
  const page = new URL(postingUrl);
  const site = page.pathname.match(/\/sites\/(CX(?:_[A-Z0-9]+)?)(?:\/|$)/i)?.[1]
    ?? html.match(/[?&]siteNumber=(CX(?:_[A-Z0-9]+)?)(?:[&#"']|$)/i)?.[1];
  const apiOrigin = html.match(/https:\/\/([a-z0-9.-]+\.fa\.[a-z0-9.-]*oraclecloud\.com)(?::443)?/i)?.[1];
  return site && apiOrigin ? { apiOrigin: `https://${apiOrigin}`, site } : null;
};

const oracleJobUrl = (sourceUrl: string, site: string, job: OracleJob): string => {
  const source = new URL(sourceUrl);
  return `${source.origin}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site)}/job/${encodeURIComponent(String(job.Id))}`;
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

const paylocityJobs = (html: string, source: CrawlSource): CrawledJob[] | null => {
  if (new URL(source.postingUrl).hostname !== "recruiting.paylocity.com") return null;
  const pageData = embeddedJsonObject(html, "window.pageData = ");
  if (!pageData || !Array.isArray(pageData.Jobs)) return null;
  const origin = new URL(source.postingUrl).origin;
  return (pageData.Jobs as PaylocityJob[]).flatMap((job) => {
    if (job.JobId == null || !job.JobTitle) return [];
    const id = String(job.JobId);
    const description = plainText(job.Description);
    return [{
      externalId: id,
      title: job.JobTitle,
      company: source.company,
      location: job.LocationName ?? null,
      arrangement: job.IsRemote ? "remote" as const : "unknown" as const,
      employmentType: null,
      summary: description,
      description,
      ...(job.HiringDepartment ? { department: job.HiringDepartment } : {}),
      ...(job.JobLocation?.City ? { locationCity: job.JobLocation.City } : {}),
      ...(job.JobLocation?.State ? { locationState: job.JobLocation.State } : {}),
      ...(job.JobLocation?.Country ? { locationCountry: job.JobLocation.Country } : {}),
      ...(job.JobLocation?.Zip ? { locationPostalCode: job.JobLocation.Zip } : {}),
      requisitionId: id,
      applyUrl: new URL(`/Recruiting/Jobs/Apply/${encodeURIComponent(id)}`, origin).href,
      officialUrl: new URL(`/Recruiting/Jobs/Details/${encodeURIComponent(id)}`, origin).href,
      publishedAt: normalizedDate(job.PublishedDate),
    }];
  });
};

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
    if (typeof job.title !== "string" || !job.title.trim()
      || typeof job.applyUrl !== "string" || !job.applyUrl.trim()) return [];
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
  const paylocity = paylocityJobs(html, source);
  if (paylocity) return { jobs: paylocity, completeListing: true };
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

const READER_JOB_DETAIL = /(?:\/jobs\/\d{4,}(?:[-/]|$)|\/site\/careers\/jobs\/\d+|\/careers\/(?:jobdetail(?:[/?]|$)|details\/|position\/)|[?&](?:jobid|job_id|gh_jid|reqid|pid|opportunityid)=)/i;

const markdownJobAnchors = (markdown: string, source: CrawlSource): BrowserAnchor[] => {
  const sourceHost = new URL(source.postingUrl).hostname.replace(/^www\./, "");
  return [...markdown.matchAll(/\[([^\]]{2,240})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g)].flatMap((match) => {
    let url: URL;
    try {
      url = new URL(match[2], source.postingUrl);
    } catch {
      return [];
    }
    const targetHost = url.hostname.replace(/^www\./, "");
    if (!targetHost.endsWith(sourceHost) && !sourceHost.endsWith(targetHost)) return [];
    if (!READER_JOB_DETAIL.test(`${url.pathname}${url.search}`)) return [];
    const text = match[1].replaceAll(/[*_#`]/g, "").replace(/^!\[?/, "").replace(/\s+/g, " ").trim();
    return text.length >= 4 && text.length <= 180 ? [{ href: url.href, text }] : [];
  });
};

const markdownStaticJobs = (markdown: string, source: CrawlSource): CrawledJob[] => {
  if (new URL(source.postingUrl).hostname !== "ase.aseglobal.com") return [];
  return [...markdown.matchAll(/^#{2,4}\s+(?:!\[[^\]]*\]\([^)]*\)\s*)?(.+?)\s+#(\d+)\s*$/gm)].map((match) => ({
    externalId: match[2],
    title: match[1].replace(/\s+/g, " ").trim(),
    company: source.company,
    location: null,
    arrangement: "unknown" as const,
    employmentType: null,
    summary: null,
    officialUrl: `${new URL(source.postingUrl).origin}${new URL(source.postingUrl).pathname}#job-${match[2]}`,
    publishedAt: null,
  }));
};

const crawlReaderFallback = async (
  source: CrawlSource,
  fetcher: typeof fetch,
  now: Date,
): Promise<SourceCrawlResult | null> => {
  try {
    const endpoint = `https://r.jina.ai/${source.postingUrl}`;
    const baseHeaders = {
      accept: "text/plain",
      "x-retain-links": "all",
      "x-with-links-summary": "all",
    };
    const resultFromMarkdown = async (markdown: string): Promise<SourceCrawlResult | null> => {
      const discovered = discoverAts(markdown, source.postingUrl);
      if (discovered) {
        const result = discovered.kind === "workday"
          ? await crawlWorkday(source, discovered.endpoint, fetcher, now)
          : await crawlDiscoveredFeed(source, discovered, fetcher);
        if (result.status === "succeeded") return result;
      }
      const jobs = uniqueJobs([
        ...jobsFromBrowserAnchors(markdownJobAnchors(markdown, source), source),
        ...markdownStaticJobs(markdown, source),
      ]);
      return jobs.length > 0 ? {
        status: "succeeded",
        responseStatus: 200,
        completeListing: false,
        jobs,
        error: null,
      } : null;
    };
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: baseHeaders }, false);
    if (!response.ok) return null;
    let result = await resultFromMarkdown(await response.text());
    if (!result) {
      const freshResponse = await fetchWithTimeout(fetcher, endpoint, {
        headers: { ...baseHeaders, "x-no-cache": "true" },
      }, false, { attempts: 1, timeoutMs: 30_000 });
      if (!freshResponse.ok) return null;
      result = await resultFromMarkdown(await freshResponse.text());
    }
    return result;
  } catch {
    return null;
  }
};

const parseTalemetryPayload = (text: string): TalemetryPayload | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as TalemetryPayload;
    return Array.isArray(value.entries) && Number.isFinite(value.total_entries) ? value : null;
  } catch {
    return null;
  }
};

const crawlTalemetryJson = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const posting = new URL(source.postingUrl);
  if (!/\/search\/jobs\/?$/i.test(posting.pathname)) return null;
  const endpointFor = (page: number) => {
    const endpoint = new URL("/search/jobs.json", posting.origin);
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    return endpoint;
  };
  const fetchPage = async (page: number): Promise<TalemetryPayload | null> => {
    const endpoint = endpointFor(page);
    try {
      const direct = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, false, { attempts: 1, timeoutMs: 10_000 });
      if (direct.ok) {
        const parsed = parseTalemetryPayload(await direct.text());
        if (parsed) return parsed;
      }
    } catch {
      // The public JSON route is commonly protected by the same edge as the HTML page.
    }
    try {
      const reader = await fetchWithTimeout(fetcher, `https://r.jina.ai/${endpoint.href}`, {
        headers: { accept: "text/plain" },
      }, false, { attempts: 3, timeoutMs: 30_000 });
      return reader.ok ? parseTalemetryPayload(await reader.text()) : null;
    } catch {
      return null;
    }
  };

  const first = await fetchPage(1);
  if (!first) return null;
  const perPage = Math.max(1, first.per_page ?? first.entries?.length ?? 100);
  const totalEntries = Math.max(0, first.total_entries ?? first.entries?.length ?? 0);
  const totalPages = Math.ceil(totalEntries / perPage);
  const boundedPages = Math.min(totalPages, 100);
  const pages: Array<TalemetryPayload | null> = [first];
  for (let page = 2; page <= boundedPages; page += 4) {
    pages.push(...await Promise.all(Array.from(
      { length: Math.min(4, boundedPages - page + 1) },
      (_, index) => fetchPage(page + index),
    )));
  }
  const successful = pages.filter((page): page is TalemetryPayload => page !== null);
  const jobs = uniqueJobs(successful.flatMap((page) => page.entries ?? []).flatMap((job): CrawledJob[] => {
    const externalId = asText(job.talemetry_job_id) ?? asText(job.id);
    const title = asText(job.title);
    const permalink = asText(job.permalink);
    if (!externalId || !title || !permalink) return [];
    const location = job.location;
    const locationText = asText(location?.name)
      ?? [asText(location?.locality), asText(location?.region_abbr), asText(location?.country)].filter(Boolean).join(", ")
      ?? null;
    const officialUrl = new URL(`/jobs/${externalId}-${permalink}`, posting.origin).href;
    return [{
      externalId,
      title,
      company: source.company,
      location: locationText || null,
      arrangement: /\bremote\b/i.test(locationText ?? "") ? "remote" : "unknown",
      employmentType: normalizeEmploymentType(job.employment_type),
      summary: null,
      ...(asText(location?.locality) ? { locationCity: asText(location?.locality) } : {}),
      ...(asText(location?.region_abbr) ?? asText(location?.region_full) ? { locationState: asText(location?.region_abbr) ?? asText(location?.region_full) } : {}),
      ...(asText(location?.country) ? { locationCountry: asText(location?.country) } : {}),
      ...(asText(location?.postal_code) ? { locationPostalCode: asText(location?.postal_code) } : {}),
      officialUrl,
      publishedAt: normalizedDate(job.date_posted ?? job.posted_at ?? job.updated_at),
    }];
  }));
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: totalPages <= 100 && successful.length === totalPages && jobs.length >= totalEntries,
    jobs,
    error: null,
  };
};

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

const crawlMediaTek = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  type PagePayload = {
    jobs?: MediaTekJob[];
    pagination?: { current_page?: number; total_pages?: number; total_items?: number };
  };
  let responseStatus: number | null = null;

  const fetchPage = async (page: number): Promise<PagePayload | null> => {
    const endpoint = new URL("https://careers.mediatek.com/api/trpc/job.getJobs");
    endpoint.searchParams.set("batch", "1");
    endpoint.searchParams.set("input", JSON.stringify({
      "0": {
        json: {
          locales: "en_US",
          page,
          jobQueryInfo: {},
          filters: {},
          sortBy: "publishedDate",
          order: "DESC",
          limit: 100,
        },
      },
    }));
    const response = await fetchWithTimeout(fetcher, endpoint, {
      headers: { accept: "application/json", cookie: "NEXT_LOCALE=en" },
    });
    responseStatus = response.status;
    if (!response.ok) return null;
    const payload = await response.json() as Array<{ result?: { data?: { json?: PagePayload } } }>;
    return payload[0]?.result?.data?.json ?? null;
  };

  const normalizeJobs = (items: MediaTekJob[]): CrawledJob[] => items.flatMap((job) => {
    if (!job.id || !job.title) return [];
    const education = (job.properties?.jobEducationInfos ?? []).flatMap((item) => {
      const degree = asText(item.educationDegree);
      const major = asText(item.educationMajor);
      return degree || major ? [`${degree ?? ""}${degree && major ? ": " : ""}${major ?? ""}`] : [];
    });
    const description = plainText(job.description ?? job.summary);
    return [{
      externalId: job.id,
      title: job.title,
      company: source.company,
      location: asText(job.properties?.location?.code) ?? asText(job.properties?.location?.label),
      arrangement: "unknown" as const,
      employmentType: null,
      summary: description,
      description,
      ...(asText(job.properties?.category?.label) ? { department: asText(job.properties?.category?.label) } : {}),
      ...(education.length > 0 ? { educationRequirements: education.join("; ") } : {}),
      ...(asText(job.properties?.workExperience?.code) ? { experienceRequirements: asText(job.properties?.workExperience?.code) } : {}),
      ...(asText(job.properties?.program?.code) ? { jobFamily: asText(job.properties?.program?.code) } : {}),
      officialUrl: `https://careers.mediatek.com/en/jobs/${encodeURIComponent(job.id)}`,
      publishedAt: normalizedDate(job.publishedDate),
    }];
  });

  try {
    const first = await fetchPage(1);
    if (!first) return {
      status: responseStatus && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `MediaTek jobs API returned HTTP ${responseStatus ?? "unknown"}.`,
    };
    const totalPages = Math.min(Math.max(first.pagination?.total_pages ?? 1, 1), 100);
    const pages: Array<PagePayload | null> = [first];
    for (let start = 2; start <= totalPages; start += 6) {
      pages.push(...await Promise.all(Array.from(
        { length: Math.min(6, totalPages - start + 1) },
        (_, index) => fetchPage(start + index),
      )));
    }
    const jobs = uniqueJobs(pages.flatMap((page) => normalizeJobs(page?.jobs ?? [])));
    const totalItems = first.pagination?.total_items ?? jobs.length;
    return {
      status: "succeeded",
      responseStatus,
      completeListing: totalPages < 100 && pages.every(Boolean) && jobs.length >= totalItems,
      jobs,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown MediaTek crawler error.",
    };
  }
};

const epamPayloadFromHtml = (html: string): EpamPayload | null => {
  const json = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) return null;
  try {
    return JSON.parse(json) as EpamPayload;
  } catch {
    return null;
  }
};

const crawlEpam = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  let responseStatus: number | null = null;
  const fetchLandingPage = async (): Promise<EpamPayload | null> => {
    const endpoint = new URL(source.postingUrl);
    const response = await fetchWithTimeout(fetcher, endpoint);
    responseStatus = response.status;
    if (!response.ok) return null;
    return epamPayloadFromHtml(await response.text());
  };

  const normalizeJobs = (items: EpamJob[]): CrawledJob[] => items.flatMap((job) => {
    if (!job.uid || !job.name) return [];
    const locations = [...new Set((job.city ?? []).flatMap((city) => {
      const location = [city.name, city.state?.name, city.country?.name].filter(Boolean).join(", ");
      return location ? [location] : [];
    }))];
    if (locations.length === 0) locations.push(...(job.country ?? []).flatMap((country) => country.name ? [country.name] : []));
    const primaryCity = job.city?.[0];
    const mode = job.vacancy_type ?? "";
    const description = plainText(job.description);
    const responsibilities = plainText(job.category?.responsibilities?.join("\n"));
    const qualifications = plainText(job.category?.requirements?.join("\n"));
    const benefits = plainText((job.benefits ?? []).flatMap((benefit) => benefit.content ? [benefit.content] : []).join("\n"));
    const jobFamily = job.job_specialization?.filter(Boolean).join("; ") || null;
    return [{
      externalId: job.unique_id ?? job.uid,
      title: job.name,
      company: source.company,
      location: locations.join("; ") || null,
      arrangement: /remote/i.test(mode) ? "remote" as const : /hybrid/i.test(mode) ? "hybrid" as const : /office|on.?site/i.test(mode) ? "onsite" as const : "unknown" as const,
      employmentType: job.posting_type ?? null,
      summary: description,
      description,
      ...(responsibilities ? { responsibilities } : {}),
      ...(qualifications ? { qualifications } : {}),
      ...(job.skills?.length ? { skills: job.skills } : {}),
      ...(jobFamily ? { jobFamily } : {}),
      ...(job.primary_skill ? { department: job.primary_skill } : {}),
      ...(job.seniority ? { experienceLevel: job.seniority } : {}),
      ...(benefits ? { benefits } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
      ...(primaryCity?.name ? { locationCity: primaryCity.name } : {}),
      ...(primaryCity?.state?.name ? { locationState: primaryCity.state.name } : {}),
      ...((primaryCity?.country?.name ?? job.country?.[0]?.name) ? { locationCountry: primaryCity?.country?.name ?? job.country?.[0]?.name } : {}),
      requisitionId: job.request_id ?? job.uid,
      officialUrl: new URL(job.seo?.url ?? `/en/vacancy/${job.uid}`, source.postingUrl).href,
      ...(normalizedDate(job.updated_at) ? { sourceUpdatedAt: normalizedDate(job.updated_at) } : {}),
      publishedAt: normalizedDate(job.created_at),
    }];
  });

  try {
    const first = await fetchLandingPage();
    const firstJobs = first?.props?.pageProps?.jobs;
    if (!firstJobs) return {
      status: responseStatus && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `EPAM jobs page returned HTTP ${responseStatus ?? "unknown"} or no public job payload.`,
    };
    const total = Math.max(firstJobs.total ?? firstJobs.jobs?.length ?? 0, 0);
    const pageSize = Math.max(firstJobs.jobs?.length ?? 0, 1);
    const totalPages = Math.min(Math.max(Math.ceil(total / pageSize), 1), 250);
    const countryId = firstJobs.jobs?.flatMap((job) => job.country ?? []).map((country) => asText(country.id)).find(Boolean)
      ?? firstJobs.jobs?.flatMap((job) => job.city ?? []).map((city) => asText(city.country?.id)).find(Boolean);
    const fetchApiPage = async (pageNumber: number): Promise<EpamPayload | null> => {
      if (!countryId) return null;
      const endpoint = new URL("/api/jobs/v2/search/careers-i18n", new URL(source.postingUrl).origin);
      endpoint.searchParams.set("lang", "en");
      endpoint.searchParams.set("sortBy", "relevance;relocation=asc");
      endpoint.searchParams.set("size", String(pageSize));
      endpoint.searchParams.set("from", String((pageNumber - 1) * pageSize));
      endpoint.searchParams.set("facets", `country=${countryId}`);
      endpoint.searchParams.set("websiteLocale", "en-us");
      const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
      responseStatus = response.status;
      if (!response.ok) return null;
      const payload = await response.json() as { data?: EpamPayload["props"] extends { pageProps?: { jobs?: infer T } } ? T : never };
      return payload.data ? { props: { pageProps: { jobs: payload.data } } } : null;
    };
    const pages: Array<EpamPayload | null> = [first];
    for (let start = 2; start <= totalPages; start += 6) {
      pages.push(...await Promise.all(Array.from(
        { length: Math.min(6, totalPages - start + 1) },
        (_, index) => fetchApiPage(start + index),
      )));
    }
    const jobs = uniqueJobs(pages.flatMap((page) => normalizeJobs(page?.props?.pageProps?.jobs?.jobs ?? [])));
    const facets = Object.entries(firstJobs.facets ?? {}).flatMap(([key, values]) => {
      const normalized = values.flatMap((value) => {
        const valueKey = asText(value.key);
        return valueKey ? [{ key: valueKey, label: valueKey.split("#").at(-1) ?? valueKey, count: value.doc_count ?? null }] : [];
      });
      return normalized.length ? [{ key, label: key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()), values: normalized }] : [];
    });
    return {
      status: "succeeded",
      responseStatus,
      completeListing: totalPages < 250 && pages.every(Boolean) && jobs.length >= total,
      jobs,
      ...(facets.length ? { facets } : {}),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown EPAM crawler error.",
    };
  }
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
  const mainEntityOfPage = value.mainEntityOfPage;
  const officialUrl = asText(value.url)
    ?? (mainEntityOfPage && typeof mainEntityOfPage === "object"
      ? asText((mainEntityOfPage as JsonLdValue).url) ?? asText((mainEntityOfPage as JsonLdValue)["@id"])
      : asText(mainEntityOfPage));
  if (!title || !officialUrl) return null;
  let careerDetailId: string | null = null;
  try {
    careerDetailId = new URL(officialUrl).pathname.match(/\/careers\/details\/([^/]+)/i)?.[1] ?? null;
  } catch {
    // Keep otherwise valid structured data even when a publisher emits a relative URL.
  }
  const identifier = value.identifier;
  const externalId = typeof identifier === "object" && identifier
    ? asText((identifier as JsonLdValue).value) ?? asText((identifier as JsonLdValue)["@id"])
    : asText(identifier) ?? careerDetailId;
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

type CitadelSitemapEntry = { url: string; lastModified: string | null };

const citadelSitemapEntries = (xml: string): CitadelSitemapEntry[] => {
  const blocks = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)];
  const entries = blocks.flatMap((match) => {
    const location = match[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1];
    if (!location) return [];
    let url: URL;
    try {
      url = new URL(decodeHtmlAttribute(location.trim()));
    } catch {
      return [];
    }
    if (url.hostname !== "www.citadel.com" || !url.pathname.startsWith("/careers/details/")) return [];
    const lastModified = match[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null;
    return [{ url: url.href, lastModified }];
  });
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
};

const citadelTitleToken = (token: string): string => {
  const acronym = new Map([
    ["ai", "AI"], ["bs", "BS"], ["gqs", "GQS"], ["ml", "ML"], ["ms", "MS"], ["phd", "PhD"], ["us", "US"],
  ]).get(token.toLocaleLowerCase());
  return acronym ?? token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase();
};

const citadelJobFromSitemap = (source: CrawlSource, entry: CitadelSitemapEntry): CrawledJob => {
  const slug = new URL(entry.url).pathname.match(/\/careers\/details\/([^/]+)/i)?.[1] ?? entry.url;
  const tokens = slug.split("-").filter(Boolean);
  const regionToken = /^(?:us|asia|europe)$/i.test(tokens.at(-1) ?? "") ? tokens.pop()?.toLocaleLowerCase() : null;
  const titleTokens = tokens.map(citadelTitleToken);
  const yearIndex = titleTokens.findIndex((token) => /^20\d{2}$/.test(token));
  const title = `${yearIndex > 0
    ? `${titleTokens.slice(0, yearIndex).join(" ")} - ${titleTokens.slice(yearIndex).join(" ")}`
    : titleTokens.join(" ")}${regionToken ? ` (${regionToken.toLocaleUpperCase()})` : ""}`;
  const programs = classifyJobPrograms(title);
  const location = regionToken === "us" ? "United States" : regionToken ? citadelTitleToken(regionToken) : null;
  return {
    externalId: slug,
    title,
    company: source.company,
    location,
    arrangement: "unknown",
    employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
    summary: null,
    ...(regionToken === "us" ? { locationCountry: "US" } : {}),
    ...(entry.lastModified ? { sourceUpdatedAt: normalizedDate(entry.lastModified) } : {}),
    officialUrl: entry.url,
    publishedAt: null,
  };
};

const citadelDetailPriority = (entry: CitadelSitemapEntry): number => {
  const value = entry.url.toLocaleLowerCase();
  return (/(?:-|\/)2027(?:-|\/)/.test(value) ? 100 : 0)
    + (/(?:intern|co-?op)/.test(value) ? 50 : 0)
    + (/(?:data|software|machine-learning|quantitative)/.test(value) ? 25 : 0);
};

const citadelMarkdownText = (value: string): string => value
  .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
  .replace(/[*_#`]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const citadelJobFromMarkdown = (
  markdown: string,
  source: CrawlSource,
  entry: CitadelSitemapEntry,
): CrawledJob | null => {
  const sourceValue = markdown.match(/^URL Source:\s*(\S+)\s*$/mi)?.[1];
  if (!sourceValue) return null;
  try {
    const sourceUrl = new URL(sourceValue);
    const expectedUrl = new URL(entry.url);
    if (sourceUrl.hostname !== expectedUrl.hostname || sourceUrl.pathname !== expectedUrl.pathname) return null;
  } catch {
    return null;
  }
  const heading = markdown.match(/^#\s+(.+?)\s*$/m);
  const description = markdown.match(/^##\s+Job Description\s*$([\s\S]*?)(?=^##\s+)/m)?.[1];
  if (!heading || !description) return null;
  const title = citadelMarkdownText(heading[1]);
  const location = markdown.slice((heading.index ?? 0) + heading[0].length)
    .split(/\r?\n/).map((line) => citadelMarkdownText(line)).find(Boolean) ?? null;
  const normalizedDescription = citadelMarkdownText(description);
  if (!title || !normalizedDescription) return null;
  const slug = new URL(entry.url).pathname.match(/\/careers\/details\/([^/]+)/i)?.[1] ?? null;
  const programs = classifyJobPrograms(title);
  const isUs = /\(US\)\s*$/i.test(title);
  return {
    externalId: slug,
    title,
    company: source.company,
    location,
    arrangement: "unknown",
    employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
    summary: normalizedDescription,
    description: normalizedDescription,
    ...(location ? { locationCity: location } : {}),
    ...(isUs ? { locationCountry: "US" } : {}),
    officialUrl: entry.url,
    publishedAt: null,
  };
};

const crawlCitadel = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const sitemapUrl = "https://www.citadel.com/career-sitemap.xml";
  try {
    const sitemapResponse = await fetchWithTimeout(fetcher, sitemapUrl, {
      headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
    });
    if (!sitemapResponse.ok) return {
      status: isBlockedHttpStatus(sitemapResponse.status) ? "blocked" : "failed",
      responseStatus: sitemapResponse.status,
      completeListing: false,
      jobs: [],
      error: `Citadel career sitemap returned HTTP ${sitemapResponse.status}.`,
    };
    const entries = citadelSitemapEntries(await sitemapResponse.text());
    if (entries.length === 0) return {
      status: "failed",
      responseStatus: sitemapResponse.status,
      completeListing: false,
      jobs: [],
      error: "Citadel career sitemap contained no job detail URLs.",
    };

    const jobsByUrl = new Map(entries.map((entry) => [entry.url, citadelJobFromSitemap(source, entry)]));
    const fetchDetail = async (entry: CitadelSitemapEntry): Promise<void> => {
      try {
        const readerTarget = new URL(entry.url);
        readerTarget.protocol = "http:";
        const readerEndpoint = `https://r.jina.ai/${readerTarget.href}`;
        let job: CrawledJob | null = null;
        try {
          const response = await fetchWithTimeout(fetcher, readerEndpoint, {
            headers: {
              accept: "text/html",
              "x-return-format": "html",
            },
          }, false, { attempts: 2, timeoutMs: 30_000 });
          if (response.ok) {
            const extracted = extractJobsFromHtml(await response.text(), source).jobs;
            const expectedUrl = new URL(entry.url);
            job = extracted.find((candidate) => {
              try {
                const candidateUrl = new URL(candidate.officialUrl);
                return candidateUrl.hostname === expectedUrl.hostname && candidateUrl.pathname === expectedUrl.pathname;
              } catch {
                return false;
              }
            }) ?? null;
          }
        } catch {
          // HTML is optional; the text reader below can still provide the detail.
        }
        if (!job) {
          try {
            const markdownResponse = await fetchWithTimeout(fetcher, readerEndpoint, {
              headers: { accept: "text/plain" },
            }, false, { attempts: 1, timeoutMs: 30_000 });
            if (markdownResponse.ok) job = citadelJobFromMarkdown(await markdownResponse.text(), source, entry);
          } catch {
            // Keep the sitemap record when both optional detail paths fail.
          }
        }
        if (!job) return;
        const externalId = job.externalId
          ?? new URL(entry.url).pathname.match(/\/careers\/details\/([^/]+)/i)?.[1]
          ?? null;
        const fallback = jobsByUrl.get(entry.url)!;
        jobsByUrl.set(entry.url, {
          ...fallback,
          ...job,
          externalId: externalId ?? fallback.externalId,
          title: job.title || fallback.title,
          location: job.location ?? fallback.location,
          arrangement: job.arrangement === "unknown" ? fallback.arrangement : job.arrangement,
          employmentType: job.employmentType ?? fallback.employmentType,
          summary: job.summary ?? fallback.summary,
          locationCountry: job.locationCountry ?? fallback.locationCountry,
          publishedAt: job.publishedAt ?? fallback.publishedAt,
          officialUrl: entry.url,
          ...(entry.lastModified ? { sourceUpdatedAt: normalizedDate(entry.lastModified) } : {}),
        });
      } catch {
        // The authoritative sitemap record remains usable when optional enrichment fails.
      }
    };
    const detailEntries = [...entries]
      .sort((left, right) => citadelDetailPriority(right) - citadelDetailPriority(left) || left.url.localeCompare(right.url))
      .slice(0, 8);
    for (let index = 0; index < detailEntries.length; index += 2) {
      await Promise.all(detailEntries.slice(index, index + 2).map(fetchDetail));
    }
    const unique = uniqueJobs([...jobsByUrl.values()]);
    return {
      status: "succeeded",
      responseStatus: sitemapResponse.status,
      // A sitemap has no prior-generation count or atomic snapshot token. Persist
      // additions and updates, but never let a transient count drop close jobs.
      completeListing: false,
      jobs: unique,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Citadel crawler error.",
    };
  }
};

type KulaJob = {
  id?: string | number;
  title?: string;
  listed?: boolean;
  ats_job?: {
    workplace?: string | null;
    employment_type?: string | null;
    ats_department?: { name?: string | null } | null;
    offices?: Array<{
      location?: string | null;
      country?: string | null;
      state?: string | null;
      city?: string | null;
      workplace?: string | null;
    }>;
    compensation?: {
      base_salary?: {
        currency?: string | null;
        interval?: string | null;
        min_amount?: string | number | null;
        max_amount?: string | number | null;
      } | null;
    } | null;
  } | null;
};

const jsonArrayAt = (text: string, start: number): string | null => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth += 1;
    else if (character === "]" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
};

const kulaJobs = (html: string, source: CrawlSource): CrawledJob[] | null => {
  const page = new URL(source.postingUrl);
  if (!page.hostname.endsWith("kula.ai")) return null;
  const chunks: string[] = [];
  for (const match of html.matchAll(/<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const payload = JSON.parse(match[1]) as unknown[];
      if (typeof payload[1] === "string") chunks.push(payload[1]);
    } catch {
      // Ignore unrelated or malformed React Flight chunks.
    }
  }
  const flight = chunks.join("");
  const jobsKey = flight.indexOf('"jobs":[');
  if (jobsKey < 0) return null;
  const arrayStart = flight.indexOf("[", jobsKey);
  const serialized = jsonArrayAt(flight, arrayStart);
  if (!serialized) return null;
  let rawJobs: KulaJob[];
  try {
    rawJobs = JSON.parse(serialized) as KulaJob[];
  } catch {
    return null;
  }
  const accountName = page.pathname.split("/").filter(Boolean)[0];
  if (!accountName) return null;
  return rawJobs.flatMap((job): CrawledJob[] => {
    if (job.listed === false || job.id == null || !job.title) return [];
    const offices = job.ats_job?.offices ?? [];
    const primaryOffice = offices[0];
    const workplace = job.ats_job?.workplace ?? primaryOffice?.workplace ?? "";
    const salary = job.ats_job?.compensation?.base_salary;
    const salaryMin = salary?.min_amount == null ? null : Number(salary.min_amount);
    const salaryMax = salary?.max_amount == null ? null : Number(salary.max_amount);
    const detail = new URL(`/${encodeURIComponent(accountName)}/${encodeURIComponent(String(job.id))}/`, page.origin);
    const domain = page.searchParams.get("domain");
    if (domain) detail.searchParams.set("domain", domain);
    return [{
      externalId: String(job.id),
      title: job.title,
      company: source.company,
      location: primaryOffice?.location ?? null,
      arrangement: /remote/i.test(workplace) ? "remote" : /hybrid/i.test(workplace) ? "hybrid" : /office|on.?site/i.test(workplace) ? "onsite" : "unknown",
      employmentType: normalizeEmploymentType(job.ats_job?.employment_type),
      summary: null,
      ...(job.ats_job?.ats_department?.name ? { department: job.ats_job.ats_department.name } : {}),
      ...(offices.length > 1 ? { secondaryLocations: offices.slice(1).flatMap((office) => office.location ?? []) } : {}),
      ...(primaryOffice?.city ? { locationCity: primaryOffice.city } : {}),
      ...(primaryOffice?.state ? { locationState: primaryOffice.state } : {}),
      ...(primaryOffice?.country ? { locationCountry: primaryOffice.country } : {}),
      ...(Number.isFinite(salaryMin) ? { salaryMin } : {}),
      ...(Number.isFinite(salaryMax) ? { salaryMax } : {}),
      ...(salary?.currency ? { salaryCurrency: salary.currency } : {}),
      ...(salary?.interval ? { salaryInterval: salary.interval } : {}),
      officialUrl: detail.href,
      publishedAt: null,
    }];
  });
};

async function crawlJsonLd(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl);
    if (!response.ok) {
      if (isBlockedHttpStatus(response.status)) {
        const talemetry = await crawlTalemetryJson(source, fetcher);
        if (talemetry) return talemetry;
        const fallback = await crawlReaderFallback(source, fetcher, now);
        if (fallback) return fallback;
      }
      return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: `Career site returned HTTP ${response.status}.`,
      };
    }
    const html = await response.text();
    const kula = kulaJobs(html, source);
    if (kula) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: kula,
      error: null,
    };
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
    const fallback = await crawlReaderFallback(source, fetcher, now);
    if (fallback) return fallback;
    return {
      status: "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: "No supported public job feed or job listings were discovered.",
    };
  } catch (error) {
    const fallback = await crawlReaderFallback(source, fetcher, now);
    if (fallback) return fallback;
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
  const page = new URL(source.postingUrl);
  const origin = page.origin;
  const tenant = page.hostname.split(".")[0];
  const domain = page.searchParams.get("domain") ?? `${tenant}.com`;
  const positions: EightfoldPosition[] = [];
  let facets: CrawledFacet[] = [];
  let responseStatus: number | null = null;
  try {
    type Payload = { count?: number; positions?: EightfoldPosition[]; facets?: Record<string, unknown>; filterDef?: { facets?: Record<string, unknown> } };
    type ApiMode = "pcsx" | "legacy";
    let apiMode: ApiMode = "pcsx";

    const normalizedFacets = (value: Record<string, unknown> | undefined): CrawledFacet[] => Object.entries(value ?? {}).flatMap(([key, rawValues]) => {
      const values = Array.isArray(rawValues)
        ? rawValues.flatMap((entry) => Array.isArray(entry) && typeof entry[0] === "string"
          ? [{ key: entry[0], label: entry[0], count: typeof entry[1] === "number" ? entry[1] : null }]
          : [])
        : rawValues && typeof rawValues === "object"
          ? Object.entries(rawValues).flatMap(([label, count]) => typeof count === "number" ? [{ key: label, label, count }] : [])
          : [];
      return values.length > 0 ? [{
        key,
        label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()),
        values,
      }] : [];
    });

    const requestPage = async (start: number, mode: ApiMode): Promise<{ response: Response; payload: Payload }> => {
      const endpoint = new URL(mode === "pcsx" ? "/api/pcsx/search" : "/api/apply/v2/jobs", origin);
      endpoint.searchParams.set("start", String(start));
      if (mode === "pcsx") {
        endpoint.searchParams.set("domain", domain);
        endpoint.searchParams.set("query", "");
        endpoint.searchParams.set("location", "");
        // Keep the parameter order aligned with the browser client.
        endpoint.searchParams.delete("start");
        endpoint.searchParams.set("domain", domain);
        endpoint.searchParams.set("query", "");
        endpoint.searchParams.set("location", "");
        endpoint.searchParams.set("start", String(start));
      } else {
        endpoint.searchParams.set("num", "10");
        endpoint.searchParams.set("sort_by", "relevance");
      }
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: "application/json", referer: `${origin}/careers?domain=${encodeURIComponent(domain)}` },
      });
      responseStatus = response.status;
      if (!response.ok) return { response, payload: {} };
      const raw = await response.json() as Payload & { data?: Payload };
      return { response, payload: raw.data ?? raw };
    };

    const fetchPage = async (start: number, requirePositions = false): Promise<Payload> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let result = await requestPage(start, apiMode);
        if (start === 0 && apiMode === "pcsx" && [400, 403, 404].includes(result.response.status)) {
          apiMode = "legacy";
          result = await requestPage(start, apiMode);
        }
        if (!result.response.ok) throw new Error(`Eightfold returned HTTP ${result.response.status}.`);
        const payload = result.payload;
        if (start === 0) facets = normalizedFacets(payload.filterDef?.facets ?? payload.facets);
        if (!requirePositions || (payload.positions?.length ?? 0) > 0 || attempt === 2) return payload;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
      return { positions: [] };
    };
    const first = await fetchPage(0);
    positions.push(...(first.positions ?? []));
    const total = first.count ?? positions.length;
    const pageSize = apiMode === "pcsx" ? 10 : Math.max(positions.length, 1);
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
      jobs: uniquePositions.flatMap((position) => position.id != null && position.name ? (() => {
        const location = position.location ?? position.locations?.join("; ") ?? null;
        const workLocation = position.work_location_option ?? position.workLocationOption ?? "";
        const externalId = position.ats_job_id ?? position.atsJobId ?? position.displayJobId ?? String(position.id);
        const description = position.job_description ?? position.jobDescription;
        const publishedTimestamp = position.postedTs || position.creationTs || position.t_create;
        return [{
        externalId,
        title: position.name,
        company: source.company,
        location,
        arrangement: /remote/i.test(`${location ?? ""} ${workLocation}`) ? "remote" as const : /hybrid/i.test(workLocation) ? "hybrid" as const : /on.?site/i.test(workLocation) ? "onsite" as const : "unknown" as const,
        employmentType: position.type ?? null,
        summary: position.department ?? null,
        ...(position.department ? { department: position.department } : {}),
        ...((position.business_unit ?? position.businessUnit) ? { businessUnit: position.business_unit ?? position.businessUnit } : {}),
        ...(description ? { description: plainText(description) } : {}),
        requisitionId: externalId,
        officialUrl: position.canonicalPositionUrl ?? (position.positionUrl ? new URL(position.positionUrl, origin).href : `${origin}/careers/job/${position.id}`),
        publishedAt: publishedTimestamp ? new Date(publishedTimestamp * 1000).toISOString() : null,
      }];
      })() : []),
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

async function crawlAdpWorkforceNow(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  const cid = page.searchParams.get("cid");
  const ccId = page.searchParams.get("ccId");
  const locale = page.searchParams.get("lang") ?? "en_US";
  if (!cid || !ccId) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "ADP Workforce Now cid or ccId is missing." };
  const base = `${page.origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`;
  const headers = {
    accept: "application/json",
    "accept-language": locale,
    locale,
    "x-requested-with": "XMLHttpRequest",
    "content-type": "application/json",
    "x-forwarded-host": page.hostname,
    referer: source.postingUrl,
  };
  let responseStatus: number | null = null;

  const endpointFor = (suffix = ""): URL => {
    const endpoint = new URL(`${base}${suffix}`);
    endpoint.searchParams.set("cid", cid);
    endpoint.searchParams.set("ccId", ccId);
    endpoint.searchParams.set("lang", locale);
    endpoint.searchParams.set("locale", locale);
    return endpoint;
  };

  try {
    const jobs: WorkforceNowJob[] = [];
    let total = Number.POSITIVE_INFINITY;
    while (jobs.length < total && jobs.length < 5_000) {
      const endpoint = endpointFor();
      endpoint.searchParams.set("$skip", String(jobs.length));
      endpoint.searchParams.set("$top", "100");
      endpoint.searchParams.set("userQuery", "");
      const response = await fetchWithTimeout(fetcher, endpoint, { headers });
      responseStatus = response.status;
      if (!response.ok) return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus,
        completeListing: false,
        jobs: [],
        error: `ADP Workforce Now jobs API returned HTTP ${response.status}.`,
      };
      const payload = await response.json() as { jobRequisitions?: WorkforceNowJob[]; meta?: { totalNumber?: number } };
      const additions = payload.jobRequisitions ?? [];
      total = payload.meta?.totalNumber ?? jobs.length + additions.length;
      if (additions.length === 0) break;
      jobs.push(...additions);
    }

    const detailed = new Map<string, WorkforceNowJob>();
    for (let start = 0; start < jobs.length; start += 6) {
      const details = await Promise.all(jobs.slice(start, start + 6).map(async (job) => {
        if (!job.itemID) return job;
        try {
          const response = await fetchWithTimeout(fetcher, endpointFor(`/${encodeURIComponent(job.itemID)}`), { headers });
          responseStatus = response.status;
          if (!response.ok) return job;
          return { ...job, ...await response.json() as WorkforceNowJob };
        } catch {
          return job;
        }
      }));
      for (const job of details) if (job.itemID) detailed.set(job.itemID, job);
    }

    const normalized = uniqueJobs(jobs.flatMap((baseJob): CrawledJob[] => {
      const job = baseJob.itemID ? detailed.get(baseJob.itemID) ?? baseJob : baseJob;
      if (!job.requisitionTitle || !job.itemID) return [];
      const externalId = job.customFieldGroup?.stringFields?.find((field) => field.nameCode?.codeValue === "ExternalJobID")?.stringValue
        ?? job.clientRequisitionID
        ?? job.itemID;
      const locations = [...new Set((job.requisitionLocations ?? []).flatMap((location) => location.nameCode?.shortName ? [location.nameCode.shortName] : []))];
      const primaryAddress = job.requisitionLocations?.[0]?.address;
      const description = plainText(job.requisitionDescription);
      const officialUrl = new URL(source.postingUrl);
      officialUrl.searchParams.set("jobId", externalId);
      return [{
        externalId,
        title: job.requisitionTitle,
        company: source.company,
        location: locations.join("; ") || null,
        arrangement: /remote/i.test(locations.join(" ")) ? "remote" : "unknown",
        employmentType: job.workLevelCode?.shortName ?? null,
        summary: description,
        description,
        requisitionId: job.clientRequisitionID ?? externalId,
        ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
        ...(primaryAddress?.cityName ? { locationCity: primaryAddress.cityName } : {}),
        ...((primaryAddress?.countrySubdivisionLevel1?.longName ?? primaryAddress?.countrySubdivisionLevel1?.codeValue) ? { locationState: primaryAddress.countrySubdivisionLevel1?.longName ?? primaryAddress.countrySubdivisionLevel1?.codeValue } : {}),
        ...((primaryAddress?.country?.longName ?? primaryAddress?.countryCode) ? { locationCountry: primaryAddress.country?.longName ?? primaryAddress.countryCode } : {}),
        officialUrl: officialUrl.href,
        publishedAt: normalizedDate(job.postDate),
      }];
    }));
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length >= total && jobs.length < 5_000,
      jobs: normalized,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown ADP Workforce Now crawler error.",
    };
  }
}

const metaFacet = (key: string, label: string, jobs: MetaCareerJob[], select: (job: MetaCareerJob) => string[] | undefined): CrawledFacet | null => {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    for (const value of new Set((select(job) ?? []).map((item) => item.trim()).filter(Boolean))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  return {
    key,
    label,
    values: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ key: value, label: value, count })),
  };
};

async function crawlMetaCareers(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const fallbackOperationId = "27129360303422352";
  let responseStatus: number | null = null;
  try {
    // Meta's edge rejects a fabricated browser User-Agent from server runtimes, while
    // the public no-cookie document and GraphQL operation remain directly available.
    const pageResponse = await fetchWithTimeout(fetcher, source.postingUrl, undefined, false);
    responseStatus = pageResponse.status;
    if (!pageResponse.ok) return {
      status: isBlockedHttpStatus(pageResponse.status) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `Meta careers page returned HTTP ${pageResponse.status}.`,
    };
    const html = await pageResponse.text();
    const lsd = html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1];
    const scriptUrls = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+\.js(?:[^"']*)?)["']/gi)]
      .map((match) => new URL(match[1].replaceAll("&amp;", "&"), source.postingUrl).href))];

    let operationId: string | null = null;
    for (let start = 0; start < scriptUrls.length && !operationId; start += 6) {
      const scripts = await Promise.all(scriptUrls.slice(start, start + 6).map(async (url) => {
        try {
          const response = await fetchWithTimeout(fetcher, url, undefined, false, { attempts: 1, timeoutMs: 10_000 });
          return response.ok ? response.text() : "";
        } catch {
          return "";
        }
      }));
      operationId = scripts.flatMap((script) => script.match(/CareersJobSearchResultsV\d+DataQuery_candidate_portalRelayOperation[\s\S]{0,320}?exports="(\d+)"/)?.[1] ?? []).at(0) ?? null;
    }
    operationId ??= fallbackOperationId;
    if (!lsd) return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: "Meta careers public search token could not be discovered.",
    };

    const variables = {
      search_input: {
        q: null,
        divisions: [],
        offices: [],
        roles: [],
        leadership_levels: [],
        saved_jobs: [],
        saved_searches: [],
        sub_teams: [],
        teams: [],
        is_leadership: false,
        is_remote_only: false,
        sort_by_new: false,
        results_per_page: null,
      },
      viewasUserID: null,
      isLoggedIn: false,
    };
    const body = new URLSearchParams({
      lsd,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "CareersJobSearchResultsV2DataQuery",
      server_timestamps: "true",
      variables: JSON.stringify(variables),
      doc_id: operationId,
    });
    const response = await fetchWithTimeout(fetcher, "https://www.metacareers.com/graphql", {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        referer: source.postingUrl,
        "x-fb-friendly-name": "CareersJobSearchResultsV2DataQuery",
        "x-fb-lsd": lsd,
      },
      body,
    }, false, { attempts: 1, timeoutMs: 30_000 });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `Meta careers search returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as MetaCareerPayload;
    const rawJobs = payload.data?.job_search_with_featured_jobs_v2?.all_jobs;
    if (!Array.isArray(rawJobs)) return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: "Meta careers search returned an unexpected payload.",
    };
    const jobs = uniqueJobs(rawJobs.flatMap((job): CrawledJob[] => {
      if (!job.id || !job.title) return [];
      const locations = [...new Set((job.locations ?? []).map((value) => value.trim()).filter(Boolean))];
      const teams = [...new Set((job.teams ?? []).map((value) => value.trim()).filter(Boolean))];
      const subTeams = [...new Set((job.sub_teams ?? []).map((value) => value.trim()).filter(Boolean))];
      const programText = [job.title, ...teams, ...subTeams].join(" ");
      const employmentType = /\b(?:co[\s-]?op|cooperative education)\b/i.test(programText)
        ? "Co-op"
        : /\b(?:intern(?:ship)?|trainee|industrial placement)\b/i.test(programText) ? "Internship" : null;
      return [{
        externalId: job.id,
        title: job.title,
        company: source.company,
        location: locations[0] ?? null,
        arrangement: locations.some((location) => /\bremote\b/i.test(location)) ? "remote" : "unknown",
        employmentType,
        summary: [...teams, ...subTeams].join(" · ") || null,
        ...(teams.length > 0 ? { department: teams.join("; ") } : {}),
        ...(subTeams.length > 0 ? { team: subTeams.join("; ") } : {}),
        ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
        rawPayload: { teams, subTeams },
        officialUrl: `https://www.metacareers.com/jobs/${job.id}/`,
        publishedAt: null,
      }];
    }));
    const facets = [
      metaFacet("department", "Department", rawJobs, (job) => job.teams),
      metaFacet("team", "Team", rawJobs, (job) => job.sub_teams),
    ].filter((facet): facet is CrawledFacet => facet !== null);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length === rawJobs.filter((job) => job.id && job.title).length,
      jobs,
      ...(facets.length > 0 ? { facets } : {}),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Meta careers crawler error.",
    };
  }
}

export function jobsFromTeslaState(source: CrawlSource, payload: TeslaState): CrawledJob[] {
  const usLocations = new Set(payload.geo?.flatMap((region) => region.sites ?? [])
    .filter((site) => site.id === "US")
    .flatMap((site) => [
      ...Object.values(site.cities ?? {}).flat(),
      ...(site.states ?? []).flatMap((state) => Object.values(state.cities ?? {}).flat()),
    ]) ?? []);
  return uniqueJobs((payload.listings ?? []).flatMap((listing): CrawledJob[] => {
    if (!listing.id || !listing.t || !listing.l || !usLocations.has(listing.l)) return [];
    const slug = listing.t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const location = payload.lookup?.locations?.[listing.l] ?? null;
    const department = payload.lookup?.departments?.[listing.dp ?? ""] ?? null;
    return [{
      externalId: listing.id,
      title: listing.t,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: payload.lookup?.types?.[String(listing.y)] ?? null,
      summary: department,
      department,
      rawPayload: {
        ...(listing.dp ? { departmentId: listing.dp } : {}),
        ...(listing.y != null ? { employmentTypeId: String(listing.y) } : {}),
      },
      officialUrl: `https://www.tesla.com/careers/search/job/${slug}-${listing.id}`,
      publishedAt: null,
    }];
  }));
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
    const jobs = jobsFromTeslaState(source, payload);
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
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      origin: endpointUrl.origin,
      referer,
    };
    const fetchPage = async (offset: number, appliedFacets: Record<string, string[]> = {}): Promise<{ status: number; payload: WorkdayPayload }> => {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers,
        // Workday's public CXS endpoint rejects page sizes above 20.
        body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText: "" }),
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Workday returned HTTP ${response.status}.`), { responseStatus: response.status });
      }
      return { status: response.status, payload: await response.json() as WorkdayPayload };
    };

    const first = await fetchPage(0);
    const total = first.payload.total ?? first.payload.jobPostings?.length ?? 0;
    const pagePayloads = [first.payload];
    const offsets = Array.from(
      { length: Math.max(0, Math.ceil(Math.min(total, 2_000) / 20) - 1) },
      (_, index) => (index + 1) * 20,
    );
    for (let index = 0; index < offsets.length; index += 8) {
      const pages = await Promise.all(offsets.slice(index, index + 8).map((offset) => fetchPage(offset)));
      pagePayloads.push(...pages.map(({ payload }) => payload));
    }

    const rawJobs = pagePayloads.flatMap((payload) => payload.jobPostings ?? []);
    const facets: CrawledFacet[] = (first.payload.facets ?? []).flatMap((facet) => facet.facetParameter && facet.descriptor ? [{
      key: facet.facetParameter,
      label: facet.descriptor,
      values: (facet.values ?? []).flatMap((value) => value.id && value.descriptor ? [{ key: value.id, label: value.descriptor, count: value.count ?? null }] : []),
    }] : []);

    const sourceUrl = new URL(source.postingUrl);
    const workdaySitePrefix = sourceUrl.hostname.endsWith(".myworkdaysite.com")
      ? sourceUrl.pathname.replace(/\/$/, "")
      : `/${encodeURIComponent(site ?? "Careers")}`;
    let jobs = uniqueJobs(rawJobs.flatMap((job) => {
      // Workday tenants occasionally include non-job cards alongside postings.
      // Skip those records and keep the listing incomplete so stale jobs cannot close.
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
        officialUrl: new URL(`${workdaySitePrefix}${job.externalPath}`, endpointUrl.origin).href,
        publishedAt: workdayPublishedAt(job.postedOn, now),
      }];
    }));

    if (source.id === "p5-0947-intel" || source.company === "Intel") {
      const facetByParameter = new Map((first.payload.facets ?? [])
        .flatMap((facet) => facet.facetParameter ? [[facet.facetParameter, facet] as const] : []));
      const membership = new Map<string, string[]>();
      const addMembership = (path: string, value: string): void => {
        const values = membership.get(path) ?? [];
        if (!values.includes(value)) values.push(value);
        membership.set(path, values);
      };
      const fetchMembership = async (parameter: string, valueId: string, count: number): Promise<Set<string>> => {
        const paths = new Set<string>();
        const facetOffsets = Array.from({ length: Math.ceil(count / 20) }, (_, index) => index * 20);
        for (let index = 0; index < facetOffsets.length; index += 8) {
          const pages = await Promise.all(facetOffsets.slice(index, index + 8)
            .map((offset) => fetchPage(offset, { [parameter]: [valueId] })));
          for (const page of pages) {
            for (const job of page.payload.jobPostings ?? []) if (job.externalPath) paths.add(job.externalPath);
          }
        }
        return paths;
      };

      const workerFacet = facetByParameter.get("workerSubType");
      for (const value of workerFacet?.values ?? []) {
        if (!value.id || !value.count || !value.descriptor) continue;
        const canonical = /student|intern/i.test(value.descriptor)
          ? "Internship"
          : /contract|fixed[ -]?term/i.test(value.descriptor) ? "Fixed-term" : null;
        if (!canonical) continue;
        for (const path of await fetchMembership("workerSubType", value.id, value.count)) addMembership(path, canonical);
      }

      const timeFacet = facetByParameter.get("timeType");
      const timeValues = (timeFacet?.values ?? []).filter((value) => value.id && value.descriptor && (value.count ?? 0) > 0);
      const recognizedTimeValues = timeValues.filter((value) => /^(?:full|part)[ -]?time$/i.test(value.descriptor ?? ""));
      if (recognizedTimeValues.length === timeValues.length
        && recognizedTimeValues.reduce((sum, value) => sum + (value.count ?? 0), 0) === total) {
        const smallest = [...recognizedTimeValues].sort((a, b) =>
          (a.count ?? 0) - (b.count ?? 0)
          || (/^part/i.test(a.descriptor ?? "") ? -1 : 1))[0];
        if (smallest?.id && smallest.descriptor && smallest.count) {
          const selected = await fetchMembership("timeType", smallest.id, smallest.count);
          const selectedType = /^part/i.test(smallest.descriptor) ? "Part-time" : "Full-time";
          const complementType = selectedType === "Part-time" ? "Full-time" : "Part-time";
          for (const job of jobs) {
            const pathname = new URL(job.officialUrl).pathname;
            const path = pathname.slice(pathname.toLocaleLowerCase().indexOf("/job/"));
            addMembership(path, selected.has(path) ? selectedType : complementType);
          }
        }
      }

      jobs = jobs.map((job) => {
        const pathname = new URL(job.officialUrl).pathname;
        const values = membership.get(pathname.slice(pathname.toLocaleLowerCase().indexOf("/job/"))) ?? [];
        return {
          ...job,
          ...(values.length > 0 ? { employmentType: values.join("; ") } : {}),
          ...(/^spotlight job$/i.test(job.department ?? "") ? { department: null } : {}),
        };
      });
    }
    return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: total <= 2_000 && jobs.length === total,
      jobs,
      ...(facets.length > 0 ? { facets } : {}),
      error: null,
    };
  } catch (error) {
    const responseStatus = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : null;
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown crawler error.",
    };
  }
}

async function crawlSourceBase(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  const sourcePage = new URL(source.postingUrl);
  if (sourcePage.hostname === "www.citadel.com") return crawlCitadel(source, fetcher);
  if (source.id === "p5-1077-tesla" || source.company === "Tesla") return crawlTesla(source, fetcher);
  if (new URL(source.postingUrl).hostname === "www.metacareers.com") return crawlMetaCareers(source, fetcher);
  if (new URL(source.postingUrl).hostname === "careers.epam.com") return crawlEpam(source, fetcher);
  if (new URL(source.postingUrl).hostname.endsWith("mediatek.com")) return crawlMediaTek(source, fetcher);
  if (new URL(source.postingUrl).hostname.endsWith("mckinsey.com") && new URL(source.postingUrl).pathname.includes("/careers/search-jobs")) return crawlMcKinsey(source, fetcher);
  if (sourcePage.hostname.endsWith("eightfold.ai")
    || (sourcePage.pathname.replace(/\/$/, "") === "/careers" && sourcePage.searchParams.has("domain"))) {
    return crawlEightfold(source, fetcher);
  }
  if (new URL(source.postingUrl).hostname === "myjobs.adp.com") return crawlAdpMyJobs(source, fetcher);
  if (new URL(source.postingUrl).hostname === "workforcenow.adp.com") return crawlAdpWorkforceNow(source, fetcher);
  const smartRecruiters = smartRecruitersFeed(source.postingUrl);
  if (smartRecruiters) return crawlDiscoveredFeed(source, { kind: "smartrecruiters", endpoint: smartRecruiters }, fetcher);
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

type WorkdayDetailPayload = {
  jobPostingInfo?: {
    title?: unknown;
    jobReqId?: unknown;
    startDate?: unknown;
    timeType?: unknown;
    location?: unknown;
    additionalLocations?: unknown;
    jobDescription?: unknown;
  };
};

const workdayDetailCandidates = (jobUrl: string): string[] => {
  let url: URL;
  try {
    url = new URL(jobUrl);
  } catch {
    return [];
  }
  const tenantMatch = url.hostname.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!tenantMatch) return [];
  const segments = url.pathname.split("/").filter(Boolean);
  const jobIndex = segments.findIndex((segment) => segment.toLocaleLowerCase() === "job");
  if (jobIndex < 0 || jobIndex === segments.length - 1) return [];
  const explicitSite = jobIndex > 0 && !/^[a-z]{2}-[A-Z]{2}$/.test(segments[jobIndex - 1])
    ? segments[jobIndex - 1]
    : null;
  const sites = [...new Set([explicitSite, "External", "Careers"].filter((site): site is string => Boolean(site)))];
  const suffix = segments.slice(jobIndex + 1).map(encodeURIComponent).join("/");
  return sites.map((site) => new URL(
    `/wday/cxs/${encodeURIComponent(tenantMatch[1])}/${encodeURIComponent(site)}/job/${suffix}`,
    url.origin,
  ).href);
};

const combinedEmploymentType = (job: CrawledJob, timeType: unknown): string | null => {
  const values: string[] = [];
  const add = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !values.some((existing) => existing.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) values.push(trimmed);
  };
  const programs = classifyJobPrograms(job.title);
  if (programs.keys.length > 0 || normalizeEmploymentType(job.employmentType)?.split(" / ").includes("Internship")) add("Internship");
  add(asText(timeType));
  if (values.length === 0) add(job.employmentType);
  return values.join("; ") || null;
};

const enrichWorkdayProgramJobs = async (
  result: SourceCrawlResult,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  if (result.status !== "succeeded" || result.jobs.length === 0) return result;
  const enriched = [...result.jobs];
  const targets = result.jobs.flatMap((job, index) => {
    const indexedAsProgram = classifyJobPrograms(job.title).keys.length > 0
      || normalizeEmploymentType(job.employmentType)?.split(" / ").includes("Internship");
    const candidates = indexedAsProgram ? workdayDetailCandidates(job.officialUrl) : [];
    return candidates.length > 0 ? [{ index, candidates }] : [];
  }).slice(0, 200);

  const enrichOne = async ({ index, candidates }: { index: number; candidates: string[] }): Promise<void> => {
    for (const endpoint of candidates) {
      try {
        const response = await fetchWithTimeout(fetcher, endpoint, undefined, true, { attempts: 1, timeoutMs: 8_000 });
        if (!response.ok) continue;
        const payload = await response.json() as WorkdayDetailPayload;
        const info = payload.jobPostingInfo;
        if (!info || typeof info !== "object") continue;
        const job = enriched[index];
        const description = plainText(asText(info.jobDescription));
        const additionalLocations = Array.isArray(info.additionalLocations)
          ? info.additionalLocations.flatMap((value) => asText(value) ?? [])
          : [];
        enriched[index] = {
          ...job,
          employmentType: combinedEmploymentType(job, info.timeType),
          description: description ?? job.description ?? null,
          requisitionId: asText(info.jobReqId) ?? job.requisitionId ?? job.externalId,
          location: asText(info.location) ?? job.location,
          ...(additionalLocations.length > 0 ? { secondaryLocations: additionalLocations } : {}),
          publishedAt: normalizedDate(info.startDate) ?? job.publishedAt,
        };
        return;
      } catch {
        // Detail enrichment is optional; the verified listing remains usable.
      }
    }
  };
  for (let index = 0; index < targets.length; index += 8) {
    await Promise.all(targets.slice(index, index + 8).map(enrichOne));
  }
  return { ...result, jobs: enriched };
};

export async function crawlSource(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  return enrichWorkdayProgramJobs(await crawlSourceBase(source, fetcher, now), fetcher);
}
