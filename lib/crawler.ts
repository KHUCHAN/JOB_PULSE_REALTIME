import { jobsFromBrowserAnchors, type BrowserAnchor } from "./browser-job-extractor.ts";
import { normalizeEmploymentType, workdayBulletFields } from "./employment-type.ts";
import { classifyJobPrograms } from "./job-program-classifier.ts";
import { classifyJobRegion } from "./job-region-classifier.ts";
import { careerCandidates, detectUrlAdapter, isPublicAtsCatalogUrl, isSafeCareerRecommendation } from "./url-remediation.ts";

export type CrawlSource = {
  id: string;
  company: string;
  postingUrl: string;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "dayforce" | "smartrecruiters" | "custom";
  crawlPageCursor?: number;
  crawlCycleStartedAt?: string | null;
  crawlPreviousCycleStartedAt?: string | null;
  discoveryDepth?: number;
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
  pagination?: { nextPage: number; cycleComplete: boolean; totalPages: number };
  resolvedListingUrl?: string;
  error: string | null;
};

export type DiscoveredAts =
  | { kind: "greenhouse"; endpoint: string }
  | { kind: "workday"; endpoint: string }
  | { kind: "lever"; endpoint: string }
  | { kind: "ashby"; endpoint: string }
  | { kind: "smartrecruiters"; endpoint: string }
  | { kind: "workable"; endpoint: string }
  | { kind: "bamboohr"; endpoint: string }
  | { kind: "pinpoint"; endpoint: string }
  | { kind: "hirebridge"; endpoint: string }
  | { kind: "taleo"; endpoint: string }
  | { kind: "jibe"; endpoint: string };

type VerifiedSourceFeed = {
  discovered?: DiscoveredAts;
  listingUrl: string;
  adapter: CrawlSource["adapter"];
};

// These verified multinational catalogs are large enough that retaining the
// clearly non-US portion adds substantial write and review cost. Keep this
// source-level rather than result-size based: paged adapters may return small
// checkpoint segments, and changing scope between segments would make stale
// closure nondeterministic. Unknown and mixed/global roles remain visible so
// an incomplete location never causes a potentially relevant US role to drop.
const US_SCOPED_LARGE_CATALOGS = new Set([
  "audit-row-369", // Hertz
  "audit-row-378", // JLL
  "legacy-row-128", // Wabtec
  "legacy-row-837", // Mondelez
  "legacy-row-878", // Vertiv
  "p1-0003-ey",
  "p1-0007-kroll",
  "p2-0029-capital-one",
  "p2-0032-citi",
  "p2-0041-jpmorgan-chase",
  "p2-0048-metlife",
  "p2-0050-morgan-stanley",
  "p2-0064-unitedhealth-group",
  "p4-0208-accenture",
  "p4-0225-barclays-us",
  "p4-0245-cisco",
  "p4-0285-google",
  "p4-0289-hcltech",
  "p4-0292-hsbc-usa",
  "p4-0313-nbcuniversal",
  "p4-0319-nvidia",
  "p4-0325-oracle",
  "p4-0333-publicis-sapient",
  "p4-0387-wipro",
  "p4-0394-amazon",
  "p4-0411-ciphertrace", // Mastercard catalog
  "p4-0423-dynatrace",
  "p4-0428-exl-service",
  "p4-0436-genpact",
  "p4-0521-zscaler",
  "p5-0523-abb-us",
  "p5-0524-abbott-laboratories",
  "p5-0527-accenture-federal-services",
  "p5-0538-amazon-2",
  "p5-0543-amgen",
  "p5-0545-anduril-industries",
  "p5-0550-asml",
  "p5-0559-boeing",
  "p5-0565-canva",
  "p5-0586-eaton",
  "p5-0589-electronic-arts",
  "p5-0619-honeywell",
  "p5-0624-ibm",
  "p5-0634-iqvia",
  "p5-0639-johnson-johnson",
  "p5-0643-kla-corporation",
  "p5-0648-labcorp-drug-development",
  "p5-0662-mckesson",
  "p5-0665-medtronic",
  "p5-0693-optumrx",
  "p5-0694-oracle-health",
  "p5-0699-pepsico",
  "p5-0712-raytheon",
  "p5-0724-schneider-electric-us",
  "p5-0736-spacex",
  "p5-0741-stryker",
  "p5-0750-thales-us",
  "p5-0752-tiktok",
  "p5-0793-amd",
  "p5-0796-analog-devices",
  "p5-0798-applied-materials",
  "p5-0803-arista-networks",
  "p5-0860-coherent",
  "p5-0932-hilton",
  "p5-0935-hologic",
  "p5-0940-infineon",
  "p5-0960-lam-research",
  "p5-0972-marriott-international",
  "p5-0984-micron-technology",
  "p5-1041-rippling",
  "p5-1109-western-digital",
]);

// These source pages render their ATS client-side (or challenge generic
// server requests), so the public feed cannot be rediscovered reliably on
// every pass. Keep the verified, first-party board identity here and promote
// the canonical listing URL after the first successful sync.
const VERIFIED_SOURCE_FEEDS: Record<string, VerifiedSourceFeed> = {
  "audit-row-345": {
    discovered: { kind: "jibe", endpoint: "https://careers.dollargeneral.com/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false" },
    listingUrl: "https://careers.dollargeneral.com/jobs?page=1",
    adapter: "custom",
  },
  "audit-row-370": { listingUrl: "https://careers.hfsinclair.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "audit-row-373": { listingUrl: "https://careers.irco.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "audit-row-406": { listingUrl: "https://jobs.nucor.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "audit-row-430": { listingUrl: "https://www.tractorsupply.careers/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "legacy-row-821": {
    listingUrl: "https://www.group1careers.com/results",
    adapter: "custom",
  },
  "p2-0050-morgan-stanley": {
    listingUrl: "https://morganstanley.eightfold.ai/careers?domain=morganstanley.com",
    adapter: "custom",
  },
  "p2-0064-unitedhealth-group": {
    listingUrl: "https://careers.unitedhealthgroup.com/search-jobs",
    adapter: "custom",
  },
  "p4-0209-aci-worldwide": {
    listingUrl: "https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
    adapter: "custom",
  },
  "p4-0289-hcltech": {
    listingUrl: "https://careers.hcltech.com/search/?locale=en_US",
    adapter: "custom",
  },
  "legacy-row-103": { listingUrl: "https://careers.jetblue.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "legacy-row-110": { listingUrl: "https://jobs.nscorp.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "legacy-row-114": { listingUrl: "https://jobs.pseg.com/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "p5-0642-kia-motors-america": { listingUrl: "https://careers-americas.kia.com/kus/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "p5-1001-oak-ridge-national-lab": { listingUrl: "https://jobs.ornl.gov/search/?q=&locationsearch=&sortColumn=referencedate&sortDirection=desc", adapter: "custom" },
  "p5-0564-canon-medical-systems": { listingUrl: "https://cmsu.csod.com/ux/ats/careersite/1/home?c=cmsu", adapter: "custom" },
  "p5-0860-coherent": { listingUrl: "https://hcwp.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", adapter: "custom" },
  "p5-0589-electronic-arts": { listingUrl: "https://jobs.ea.com/en_US/careers/SearchJobs", adapter: "custom" },
  "p2-0048-metlife": { listingUrl: "https://www.metlifecareers.com/en_US/ml/SearchJobs", adapter: "custom" },
  "legacy-row-823": { listingUrl: "https://fa-exty-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1", adapter: "custom" },
  "legacy-row-826": { listingUrl: "https://jobs.dayforcehcm.com/en-US/ibgllc/CANDIDATEPORTAL", adapter: "dayforce" },
  "p4-0470-oliver-wyman": { listingUrl: "https://mmc.phenompeople.com/global/en/oliver-wyman-early-careers-search", adapter: "phenom" },
  "p5-0869-costco": {
    discovered: { kind: "jibe", endpoint: "https://careers.costco.com/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false" },
    listingUrl: "https://careers.costco.com/jobs",
    adapter: "custom",
  },
  "p5-0760-veeva-systems": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/veeva?mode=json" },
    listingUrl: "https://careers.veeva.com/job-search-results/",
    adapter: "custom",
  },
  "p1-0011-trm-labs": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/trm-labs" },
    listingUrl: "https://jobs.ashbyhq.com/trm-labs",
    adapter: "ashby",
  },
  "p5-1082-trinetx": { listingUrl: "https://jobs.dayforcehcm.com/en-US/trinetx1/CANDIDATEPORTAL", adapter: "dayforce" },
  "p4-0207-8am": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/affinipay1/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/affinipay1",
    adapter: "greenhouse",
  },
  "audit-row-1560": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/affinipay1/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/affinipay1",
    adapter: "greenhouse",
  },
  "p4-0391-abnormal-security": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/abnormalsecurity/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/abnormalsecurity",
    adapter: "greenhouse",
  },
  "legacy-row-778": { listingUrl: "https://aecom.jobs/jobs/", adapter: "custom" },
  "legacy-row-65": {
    discovered: { kind: "workday", endpoint: "https://aes.wd1.myworkdayjobs.com/wday/cxs/aes/AES_US/jobs" },
    listingUrl: "https://aes.wd1.myworkdayjobs.com/AES_US",
    adapter: "workday",
  },
  "p5-0784-aetion": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/datavant2/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/datavant2",
    adapter: "greenhouse",
  },
  "p2-0070-affirm": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/affirm/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/affirm",
    adapter: "greenhouse",
  },
  "p4-0213-alixpartners": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/alixpartners/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/alixpartners",
    adapter: "greenhouse",
  },
  "p2-0072-alloy": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/alloy/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/alloy",
    adapter: "greenhouse",
  },
  "p2-0127-lincoln-financial": {
    listingUrl: "https://jobs.lincolnfinancial.com/go/All-Lincoln-Financial-Jobs/8874000/",
    adapter: "custom",
  },
  "audit-row-319": {
    discovered: { kind: "workday", endpoint: "https://bakerhughes.wd5.myworkdayjobs.com/wday/cxs/bakerhughes/BakerHughes/jobs" },
    listingUrl: "https://bakerhughes.wd5.myworkdayjobs.com/BakerHughes",
    adapter: "workday",
  },
  "p4-0402-bill-com": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/billcom/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/billcom",
    adapter: "greenhouse",
  },
  "p5-0841-carbon-health": { listingUrl: "https://ats.rippling.com/embed/carbon-health/jobs", adapter: "custom" },
  "p4-0243-checkout-com": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/checkout.com" },
    listingUrl: "https://jobs.ashbyhq.com/checkout.com",
    adapter: "ashby",
  },
  "p4-0248-cloudflare": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/cloudflare",
    adapter: "greenhouse",
  },
  "p4-0413-coupa": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/coupa?mode=json" },
    listingUrl: "https://jobs.lever.co/coupa",
    adapter: "lever",
  },
  "p2-0094-crypto-com": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/crypto?mode=json" },
    listingUrl: "https://jobs.lever.co/crypto",
    adapter: "lever",
  },
  "audit-row-338": { listingUrl: "https://cummins.jobs/jobs", adapter: "custom" },
  "p4-0255-current": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/current/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/current",
    adapter: "greenhouse",
  },
  "p5-0877-datavant": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/datavant2/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/datavant2",
    adapter: "greenhouse",
  },
  "p4-0421-docker": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/docker" },
    listingUrl: "https://jobs.ashbyhq.com/docker",
    adapter: "ashby",
  },
  "p4-0264-elliptic": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/elliptic" },
    listingUrl: "https://jobs.ashbyhq.com/elliptic",
    adapter: "ashby",
  },
  "p5-0889-elastic": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/elastic/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/elastic",
    adapter: "greenhouse",
  },
  "p5-0893-epic-games": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/epicgames/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/epicgames",
    adapter: "greenhouse",
  },
  "audit-row-356": { listingUrl: "https://app.eightfold.ai/careers?domain=elcompanies.com", adapter: "custom" },
  "legacy-row-847": {
    discovered: { kind: "workday", endpoint: "https://pbfenergy.wd1.myworkdayjobs.com/wday/cxs/pbfenergy/PBF/jobs" },
    listingUrl: "https://pbfenergy.wd1.myworkdayjobs.com/PBF",
    adapter: "workday",
  },
  "p4-0510-vanta": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/vanta" },
    listingUrl: "https://jobs.ashbyhq.com/vanta",
    adapter: "ashby",
  },
  "p4-0513-verint": {
    listingUrl: "https://fa-epcb-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX",
    adapter: "custom",
  },
  "legacy-row-878": {
    listingUrl: "https://egup.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs",
    adapter: "custom",
  },
  "legacy-row-881": {
    listingUrl: "https://careers.vulcanmaterials.com/hcmUI/CandidateExperience/en/sites/careers/jobs",
    adapter: "custom",
  },
  "p5-1094-vanderbilt-health": {
    discovered: { kind: "workday", endpoint: "https://vumc.wd1.myworkdayjobs.com/wday/cxs/vumc/vumccareers/jobs" },
    listingUrl: "https://vumc.wd1.myworkdayjobs.com/vumccareers",
    adapter: "workday",
  },
  "p5-1096-vantor": {
    discovered: { kind: "workday", endpoint: "https://maxar.wd1.myworkdayjobs.com/wday/cxs/maxar/Vantor/jobs" },
    listingUrl: "https://maxar.wd1.myworkdayjobs.com/Vantor",
    adapter: "workday",
  },
  "p5-0692-openai": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/openai" },
    listingUrl: "https://jobs.ashbyhq.com/openai",
    adapter: "ashby",
  },
  "p5-1029-psi-cro": {
    discovered: { kind: "smartrecruiters", endpoint: "https://api.smartrecruiters.com/v1/companies/PSICRO/postings" },
    listingUrl: "https://careers.smartrecruiters.com/PSICRO",
    adapter: "smartrecruiters",
  },
  "p2-0146-oportun": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/oportun/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/oportun",
    adapter: "greenhouse",
  },
  "p4-0318-nuvei": {
    discovered: { kind: "workable", endpoint: "https://apply.workable.com/nuvei/" },
    listingUrl: "https://apply.workable.com/nuvei/",
    adapter: "custom",
  },
  "p4-0342-sardine": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/sardine" },
    listingUrl: "https://jobs.ashbyhq.com/sardine",
    adapter: "ashby",
  },
  "p4-0430-fastly": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/fastly/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/fastly",
    adapter: "greenhouse",
  },
  "p4-0492-scale-ai": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/scaleai",
    adapter: "greenhouse",
  },
  "p5-0615-harvey-ai": {
    discovered: { kind: "ashby", endpoint: "https://api.ashbyhq.com/posting-api/job-board/harvey" },
    listingUrl: "https://jobs.ashbyhq.com/harvey",
    adapter: "ashby",
  },
  "p5-0657-machina-labs": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/MachinaLabs?mode=json" },
    listingUrl: "https://jobs.lever.co/MachinaLabs",
    adapter: "lever",
  },
  "p5-0739-stardog": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/stardog?mode=json" },
    listingUrl: "https://jobs.lever.co/stardog",
    adapter: "lever",
  },
  "p5-0944-instacart": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/instacart",
    adapter: "greenhouse",
  },
  "p5-1011-oscar-health": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/oscar",
    adapter: "greenhouse",
  },
  "p5-1022-planet-labs": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/planetlabs/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/planetlabs",
    adapter: "greenhouse",
  },
  "p5-1116-zoox": {
    discovered: { kind: "lever", endpoint: "https://api.lever.co/v0/postings/zoox?mode=json" },
    listingUrl: "https://jobs.lever.co/zoox",
    adapter: "lever",
  },
  "p4-0498-snyk": {
    discovered: { kind: "workday", endpoint: "https://snyk.wd103.myworkdayjobs.com/wday/cxs/snyk/External/jobs" },
    listingUrl: "https://snyk.wd103.myworkdayjobs.com/External",
    adapter: "workday",
  },
  "p4-0313-nbcuniversal": {
    discovered: { kind: "smartrecruiters", endpoint: "https://api.smartrecruiters.com/v1/companies/NBCUniversal3/postings" },
    listingUrl: "https://careers.smartrecruiters.com/NBCUniversal3",
    adapter: "smartrecruiters",
  },
  "p4-0322-offerup": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/offerup/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/offerup",
    adapter: "greenhouse",
  },
  "legacy-row-128": {
    discovered: { kind: "smartrecruiters", endpoint: "https://api.smartrecruiters.com/v1/companies/Wabtec/postings" },
    listingUrl: "https://careers.smartrecruiters.com/Wabtec",
    adapter: "smartrecruiters",
  },
  "p4-0337-riot-games": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/riotgames/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/riotgames",
    adapter: "greenhouse",
  },
  "p4-0491-samsara": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/samsara",
    adapter: "greenhouse",
  },
  "p5-0606-glean": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/gleanwork/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/gleanwork",
    adapter: "greenhouse",
  },
  "p5-0681-naughty-dog": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/naughtydog/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/naughtydog",
    adapter: "greenhouse",
  },
  "p5-0838-c3-ai": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/c3iot/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/c3iot",
    adapter: "greenhouse",
  },
  "p5-0903-figure-ai": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/figureai/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/figureai",
    adapter: "greenhouse",
  },
  "p5-0998-nuro": {
    discovered: { kind: "greenhouse", endpoint: "https://boards-api.greenhouse.io/v1/boards/nuro/jobs?content=true" },
    listingUrl: "https://job-boards.greenhouse.io/nuro",
    adapter: "greenhouse",
  },
};

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

type MCloudLocation = {
  addtnl_city?: string | null;
  addtnl_state?: string | null;
  addtnl_country?: string | null;
};

type MCloudJob = {
  id?: number | string;
  ref?: string | null;
  title?: string | null;
  description?: string | null;
  primary_category?: string | null;
  primary_city?: string | null;
  primary_state?: string | null;
  primary_country?: string | null;
  addtnl_locations?: MCloudLocation[];
  department?: string | null;
  employment_type?: string | null;
  level?: string | null;
  compliment?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  url?: string | null;
  seo_url?: string | null;
};

type MCloudPayload = {
  totalHits?: number;
  searchResults?: Array<{ job?: MCloudJob }>;
};

type MCloudConfig = {
  apiUrl: string;
  organization: string;
  filters: Array<{ key: string; value: string }>;
};

type JobsynJob = {
  guid?: string;
  title_exact?: string;
  title_slug?: string;
  location_exact?: string;
  date_added?: string;
  date_new?: string;
  date_updated?: string;
  description?: string;
  job_type?: string;
  job_category?: string;
  job_function?: string;
  reqid?: string;
  city_exact?: string;
  state_short?: string;
  state_short_exact?: string;
  country_exact?: string;
};

type JobsynPayload = {
  jobs?: JobsynJob[];
  pagination?: {
    page?: number;
    page_size?: number;
    total?: number;
    total_pages?: number;
    has_more_pages?: boolean;
  };
};

type CardinalTracking = {
  ReferenceNumberJson?: string;
  TitleJson?: string;
  PostedDateJson?: string;
  TypeNameJson?: string;
  LocationNamesJson?: string[];
  AddressesDataJson?: string[];
  ZipCodesJson?: string[];
  CityNamesJson?: string[];
  StateNamesJson?: string[];
  CityStatesDataAbbrevJson?: string[];
  CountryNamesJson?: string[];
  ActivateCategoryNamesJson?: string[];
  AtsCategoryNamesJson?: string[];
  ActivateFamilyNamesJson?: string[];
  AtsFamilyNamesJson?: string[];
};

type CardinalRecord = {
  ID?: string;
  ReferenceNumber?: string;
  Title?: string;
  LocationName?: string;
  ZipCode?: string;
  CityName?: string;
  StateName?: string;
  CityStateDataAbbrev?: string;
  CountryName?: string;
  PostedDate?: string;
  PostedDateRaw?: string;
  DepartmentName?: string;
  TypeName?: string;
  IsRemote?: boolean;
  TrackingObject?: CardinalTracking;
};

type CardinalPayload = {
  Result?: string;
  Records?: CardinalRecord[];
  TotalRecordCount?: number;
};

type DowSearchResult = {
  title?: string;
  clickUri?: string;
  printableUri?: string;
  excerpt?: string;
  raw?: Record<string, unknown>;
};

type DowSearchPayload = {
  totalCount?: number;
  results?: DowSearchResult[];
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
  uuid?: string;
  jobAdId?: string;
  ref?: string;
  refNumber?: string;
  company?: { identifier?: string; name?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    postalCode?: string;
    latitude?: number | string;
    longitude?: number | string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  typeOfEmployment?: { label?: string };
  department?: { label?: string };
  function?: { label?: string };
  industry?: { label?: string };
  experienceLevel?: { label?: string };
  language?: { code?: string; label?: string };
  customField?: Array<{ fieldLabel?: string; valueLabel?: string }>;
  visibility?: string;
  releasedDate?: string;
};

type SmartRecruitersPayload = {
  offset?: number;
  limit?: number;
  totalFound?: number;
  content?: SmartRecruitersJob[];
};

type SmartRecruitersDetailPayload = SmartRecruitersJob & {
  active?: boolean;
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
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
  actionUrl?: string;
  jobUrl?: string;
  workplaceType?: string;
  postedDate?: string;
  reqId?: string;
  category?: string;
  multi_category?: string[];
  externalTeamName?: string;
  businessUnit?: string;
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
const SOURCE_REQUEST_BUDGET = 50;
// Sites Worker requests are canceled at roughly 55 seconds. Leave enough
// headroom for D1 persistence and run finalization after the upstream crawl;
// checkpointed adapters resume the remaining pages on the next pass.
const SOURCE_DEADLINE_MS = 32_000;
const WORKDAY_DETAIL_BATCH_SIZE = 8;
const BLOCKED_HTTP_STATUSES = new Set([401, 403, 429, 520, 521, 522, 523, 524]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const BROWSER_REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
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

export const crawlBudgetedFetcher = (
  fetcher: typeof fetch,
  options: { maxRequests?: number; deadlineMs?: number } = {},
): typeof fetch => {
  const maxRequests = options.maxRequests ?? SOURCE_REQUEST_BUDGET;
  const deadlineMs = options.deadlineMs ?? SOURCE_DEADLINE_MS;
  const deadline = Date.now() + deadlineMs;
  let requests = 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests += 1;
    if (requests > maxRequests) throw new Error(`${maxRequests} request source crawl budget exhausted`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${deadlineMs / 1_000} second source crawl deadline exceeded`);

    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) forwardAbort();
    else upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`${deadlineMs / 1_000} second source crawl deadline exceeded`)),
      remaining,
    );
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", forwardAbort);
    }
  };
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

const greenhouseJobs = (values: GreenhouseJob[], source: CrawlSource): CrawledJob[] => values.map((job) => {
  const location = job.location?.name ?? null;
  const metadataText = (job.metadata ?? []).flatMap(({ value }) => typeof value === "string"
    ? [value]
    : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  const arrangementText = [job.title, location, ...metadataText].filter(Boolean).join(" ");
  const arrangement = /\bremote\b/i.test(arrangementText)
    ? "remote"
    : /\bhybrid\b/i.test(arrangementText)
      ? "hybrid"
      : /\b(?:onsite|on-site|in office)\b/i.test(arrangementText)
        ? "onsite"
        : "unknown";
  const normalizedLocation = location?.replace(/^\s*(?:remote|hybrid|onsite|on-site)\s*@\s*/i, "").trim() ?? null;
  const locationParts = normalizedLocation?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const locationRegion = classifyJobRegion({ location });
  const programs = classifyJobPrograms(job.title).keys;
  return {
    externalId: String(job.id),
    title: job.title,
    company: source.company,
    location,
    arrangement,
    employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
    summary: plainText(job.content),
    description: plainText(job.content),
    ...(job.departments?.length ? { department: job.departments.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
    ...(job.offices?.length ? { office: job.offices.map(({ name }) => name).filter(Boolean).join("; ") || null } : {}),
    ...(locationParts.length >= 2 ? { locationCity: locationParts[0] } : {}),
    ...(locationParts.length >= 2 && /^[A-Z]{2}$/.test(locationParts[1]) ? { locationState: locationParts[1] } : {}),
    ...(locationRegion === "us" ? { locationCountry: "United States" } : {}),
    ...(job.requisition_id ? { requisitionId: job.requisition_id } : {}),
    ...(job.first_published ? { sourceUpdatedAt: normalizedDate(job.updated_at) } : {}),
    ...((job.metadata?.length || job.departments?.length || job.offices?.length) ? { rawPayload: { metadata: job.metadata ?? [], departments: job.departments ?? [], offices: job.offices ?? [] } } : {}),
    officialUrl: job.absolute_url,
    publishedAt: normalizedDate(job.first_published ?? job.updated_at),
  };
});

const greenhouseBoard = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!url.hostname.endsWith("greenhouse.io")) return null;
  const queryBoard = url.searchParams.get("job_board");
  if (queryBoard && /^[a-z0-9-]+$/i.test(queryBoard)) return queryBoard;
  const path = url.pathname.split("/").filter(Boolean);
  const board = url.hostname === "boards-api.greenhouse.io" && path[0] === "v1" && path[1] === "boards"
    ? path[2]
    : path.at(0);
  if (board === "users" || board === "embed") return null;
  return board || null;
};

const smartRecruitersFeed = (postingUrl: string): string | null => {
  const url = new URL(postingUrl);
  if (!/^(?:jobs|careers)\.smartrecruiters\.com$/i.test(url.hostname)) return null;
  const company = url.pathname.split("/").filter(Boolean)[0];
  return company ? `https://api.smartrecruiters.com/v1/companies/${company}/postings` : null;
};

const icimsText = (value: string | null | undefined): string | null => {
  const text = plainText(value);
  if (!text) return null;
  const decoded = decodeHtmlAttribute(text)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
  return decoded || null;
};

type IcimsPage = {
  status: number;
  page: number;
  totalPages: number;
  finalUrl: string;
  rawCount: number;
  jobs: CrawledJob[];
};

const icimsSearchUrl = (postingUrl: string, page: number): URL => {
  const url = new URL(postingUrl);
  if (url.pathname === "/") {
    url.pathname = "/jobs/search";
  } else if (/\/jobs(?:\/(?:intro|search))?\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/jobs(?:\/(?:intro|search))?\/?$/i, "/jobs/search");
  }
  url.searchParams.set("ss", "1");
  url.searchParams.set("in_iframe", "1");
  url.searchParams.set("pr", String(Math.max(0, page - 1)));
  url.searchParams.delete("mobile");
  url.searchParams.delete("needsRedirect");
  url.searchParams.delete("schemaId");
  url.searchParams.delete("o");
  url.hash = "";
  return url;
};

const icimsCanonicalListingUrl = (value: string): string => {
  const url = new URL(value);
  url.searchParams.delete("in_iframe");
  url.searchParams.delete("pr");
  url.searchParams.delete("mobile");
  url.searchParams.delete("needsRedirect");
  url.searchParams.delete("schemaId");
  url.searchParams.delete("o");
  url.searchParams.set("ss", "1");
  url.hash = "";
  return url.href;
};

const icimsCatalogUrl = (html: string): string | null => {
  const searchable = html.replaceAll("\\/", "/").replaceAll("&amp;", "&");
  for (const match of searchable.matchAll(/https?:\/\/[a-z0-9-]+\.icims\.com[^\s"'<>\\]*/gi)) {
    try {
      const url = new URL(decodeHtmlAttribute(match[0]));
      if (!/^\/(?:jobs(?:\/(?:search|intro))?)?\/?$/i.test(url.pathname)) continue;
      url.hash = "";
      return url.href;
    } catch {
      // Keep looking for a public catalog rather than an account/login URL.
    }
  }
  return null;
};

const gustoCatalogUrl = (html: string): string | null => {
  const searchable = html.replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const match = searchable.match(/https:\/\/jobs\.gusto\.com\/boards\/[a-z0-9-]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return url.hostname === "jobs.gusto.com" && /^\/boards\/[a-z0-9-]+\/?$/i.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const icimsLocationParts = (location: string | null): {
  locationCity?: string;
  locationState?: string;
  locationCountry?: string;
} => {
  const match = location?.match(/^([A-Z]{2})-([A-Z]{2})-(.+)$/);
  if (!match) return {};
  return {
    locationCountry: match[1],
    locationState: match[2],
    locationCity: match[3],
  };
};

const icimsJobsFromHtml = (html: string, source: CrawlSource): { rawCount: number; jobs: CrawledJob[] } => {
  const cards = [...html.matchAll(
    /<li\b[^>]*class=["'][^"']*\biCIMS_JobCardItem\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
  )].map((match) => match[0]);
  const jobs = cards.flatMap((card): CrawledJob[] => {
    const anchor = card.match(/<a\b[^>]*href=["']([^"']*\/jobs\/(\d+)\/[^"']+\/job(?:\?[^"']*)?)["'][^>]*>/i);
    const title = icimsText(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    if (!anchor || !title) return [];
    let official: URL;
    try {
      official = new URL(decodeHtmlAttribute(anchor[1]), source.postingUrl);
    } catch {
      return [];
    }
    if (official.protocol !== "https:" || !official.hostname.endsWith(".icims.com")) return [];
    official.searchParams.delete("in_iframe");
    official.searchParams.delete("mobile");
    official.searchParams.delete("needsRedirect");
    official.hash = "";

    const location = icimsText(card.match(
      /<span\b[^>]*class=["'][^"']*field-label[^"']*["'][^>]*>\s*Job Locations?\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i,
    )?.[1]) ?? icimsText(card.match(
      /<div\b[^>]*class=["'][^"']*\bheader\s+left\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1]);
    const description = icimsText(card.match(
      /<div\b[^>]*class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1]);
    const fields = new Map<string, string>();
    for (const field of card.matchAll(
      /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
    )) {
      const key = icimsText(field[1])?.toLocaleLowerCase();
      const value = icimsText(field[2]);
      if (key && value) fields.set(key, value);
    }
    const employmentType = normalizeEmploymentType(fields.get("type"))
      ?? (classifyJobPrograms(title).keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null);
    const publishedText = fields.get("posted date") ?? fields.get("date posted") ?? null;
    return [{
      externalId: anchor[2],
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : /\bhybrid\b/i.test(location ?? "") ? "hybrid" : "unknown",
      employmentType,
      summary: description,
      ...(description ? { description } : {}),
      ...(fields.get("category") ? { department: fields.get("category") } : {}),
      ...icimsLocationParts(location),
      requisitionId: fields.get("id") ?? anchor[2],
      ...(publishedText ? { sourcePostedText: publishedText } : {}),
      officialUrl: official.href,
      publishedAt: normalizedDate(publishedText),
    }];
  });
  return { rawCount: cards.length, jobs };
};

const crawlIcims = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const fetchPage = async (page: number, baseUrl = source.postingUrl): Promise<IcimsPage | null> => {
    try {
      const requestedUrl = icimsSearchUrl(baseUrl, page);
      const response = await fetchWithTimeout(fetcher, requestedUrl, {
        headers: { accept: "text/html,application/xhtml+xml" },
      }, true, { attempts: 1, timeoutMs: 12_000 });
      if (!response.ok) return null;
      const html = await response.text();
      const pageMatch = html.match(/\bPage\s+(\d+)\s+of\s+(\d+)\b/i);
      const parsedPage = Number(pageMatch?.[1]);
      const totalPages = Number(pageMatch?.[2]);
      if (!Number.isInteger(parsedPage) || parsedPage !== page || !Number.isInteger(totalPages) || totalPages < page) return null;
      const parsed = icimsJobsFromHtml(html, source);
      if (parsed.rawCount === 0 || parsed.jobs.length !== parsed.rawCount) return null;
      return { status: response.status, page, totalPages, finalUrl: response.url || requestedUrl.href, ...parsed };
    } catch {
      return null;
    }
  };

  const index = await fetchPage(1);
  if (!index) return {
    status: "failed",
    responseStatus: null,
    completeListing: false,
    jobs: [],
    error: "iCIMS did not return a usable first catalog page.",
  };
  const totalPages = index.totalPages;
  const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  const startPage = requestedStart <= totalPages ? requestedStart : 1;
  // One request is reserved for page one and one for an end-of-cycle stability
  // check. This still covers the largest current iCIMS source (43 pages) in a
  // single invocation while remaining below the 50-request source ceiling.
  const maxWindowPages = 44;
  const endPage = Math.min(totalPages, startPage + maxWindowPages - 1);
  const baseUrl = index.finalUrl;
  const pages = new Map<number, IcimsPage>([[1, index]]);
  const pageNumbers = Array.from(
    { length: Math.max(0, endPage - Math.max(2, startPage) + 1) },
    (_, offset) => Math.max(2, startPage) + offset,
  );
  if (startPage > 1) pageNumbers.unshift(startPage);
  const uniquePageNumbers = [...new Set(pageNumbers)];
  for (let offset = 0; offset < uniquePageNumbers.length; offset += 8) {
    const batch = uniquePageNumbers.slice(offset, offset + 8);
    const results = await Promise.all(batch.map((page) => fetchPage(page, baseUrl)));
    results.forEach((result, indexInBatch) => {
      if (result) pages.set(batch[indexInBatch], result);
    });
  }

  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();
  let firstFailedPage: number | null = null;
  for (let page = startPage; page <= endPage; page += 1) {
    const result = pages.get(page);
    const validCount = result
      && result.totalPages === totalPages
      && result.jobs.length === result.rawCount
      && result.rawCount > 0
      && (page === totalPages ? result.rawCount <= index.rawCount : result.rawCount === index.rawCount);
    const identities = result?.jobs.map((job) => job.externalId ?? job.officialUrl) ?? [];
    if (!validCount || identities.some((identity) => seen.has(identity))) {
      firstFailedPage = page;
      break;
    }
    identities.forEach((identity) => seen.add(identity));
    jobs.push(...result!.jobs);
  }

  let cycleComplete = firstFailedPage === null && endPage === totalPages;
  if (cycleComplete) {
    const verification = await fetchPage(1, baseUrl);
    const initialIds = index.jobs.map((job) => job.externalId ?? job.officialUrl);
    const verificationIds = verification?.jobs.map((job) => job.externalId ?? job.officialUrl) ?? [];
    if (!verification || verification.totalPages !== totalPages
      || verificationIds.length !== initialIds.length
      || initialIds.some((identity, position) => verificationIds[position] !== identity)) {
      cycleComplete = false;
      firstFailedPage = startPage;
    }
  }

  if (jobs.length === 0) return {
    status: "failed",
    responseStatus: index.status,
    completeListing: false,
    jobs: [],
    error: "iCIMS returned an incomplete or unstable catalog page.",
  };
  const canonicalListingUrl = icimsCanonicalListingUrl(index.finalUrl);
  const completeListing = startPage === 1 && cycleComplete;
  return {
    status: "succeeded",
    responseStatus: index.status,
    completeListing,
    jobs: uniqueJobs(jobs),
    ...(totalPages > 1 || source.crawlPageCursor != null ? {
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
        cycleComplete,
        totalPages,
      },
    } : {}),
    resolvedListingUrl: canonicalListingUrl,
    error: null,
  };
};

export function discoverAts(html: string, _pageUrl: string): DiscoveredAts | null {
  // ATS links are frequently embedded in JSON or script attributes as
  // `https:\/\/...`. Normalize only URL escaping before running the strict
  // provider patterns; this does not broaden the trusted host allow-list.
  const searchable = html.replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const greenhouse = searchable.match(/https?:\/\/boards\.greenhouse\.io\/embed\/job_board\/js\?[^\s"'<>]*\bfor=([a-z0-9-]+)/i)
    ?? searchable.match(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i)
    ?? searchable.match(/https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/i);
  if (greenhouse) return { kind: "greenhouse", endpoint: `https://boards-api.greenhouse.io/v1/boards/${greenhouse[1]}/jobs?content=true` };

  const workday = searchable.match(/https?:\/\/[^\s"'<>]+\.(?:myworkdayjobs|myworkdaysite)\.com\/[^\s"'<>?#\\)]+/i);
  const workdayEndpoint = workday ? workdayFeed(workday[0]) : null;
  if (workdayEndpoint) return { kind: "workday", endpoint: workdayEndpoint };

  const lever = searchable.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9-]+)/i);
  if (lever) return { kind: "lever", endpoint: `https://api.lever.co/v0/postings/${lever[1]}?mode=json` };

  const ashby = searchable.match(/https?:\/\/jobs\.ashbyhq\.com\/([^\s"'<>/?#]+)/i);
  if (ashby) return { kind: "ashby", endpoint: `https://api.ashbyhq.com/posting-api/job-board/${ashby[1]}` };

  const smartRecruiters = searchable.match(/https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9-]+)/i);
  if (smartRecruiters) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruiters[1]}/postings` };

  const smartRecruitersWidget = searchable.match(/["']company_code["']\s*:\s*["']([a-z0-9-]+)["']/i);
  if (smartRecruitersWidget) return { kind: "smartrecruiters", endpoint: `https://api.smartrecruiters.com/v1/companies/${smartRecruitersWidget[1]}/postings` };

  const workableWidget = searchable.match(/https?:\/\/apply\.workable\.com\/api\/v1\/widget\/accounts\/([a-z0-9-]+)/i);
  const workableBoard = searchable.match(/https?:\/\/apply\.workable\.com\/(?!api\/|j\/)([a-z0-9-]+)(?:[/?#"'<>]|$)/i);
  const workableAccount = workableWidget?.[1] ?? workableBoard?.[1];
  if (workableAccount) return { kind: "workable", endpoint: `https://apply.workable.com/${workableAccount}/` };

  const bamboo = searchable.match(/https?:\/\/([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs\/embed2\.php|jobs2\.php|js\/(?:embed\.js|jobs2\.php))/i);
  if (bamboo) return { kind: "bamboohr", endpoint: `https://${bamboo[1]}.bamboohr.com/careers` };

  const pinpoint = searchable.match(/https?:\/\/([a-z0-9-]+)\.pinpointhq\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:postings)?/i);
  if (pinpoint) return { kind: "pinpoint", endpoint: `https://${pinpoint[1]}.pinpointhq.com/` };

  const hirebridge = searchable.match(/https?:\/\/recruit\.hirebridge\.com\/v3\/(?:CareerCenter\/v2\/)?[^\s"'<>]*[?&]cid=(\d+)/i);
  if (hirebridge) return { kind: "hirebridge", endpoint: `https://recruit.hirebridge.com/v3/CareerCenter/v2/?cid=${hirebridge[1]}` };

  const taleo = searchable.match(/https?:\/\/[^\s"'<>]+\.taleo\.net\/[^\s"'<>]*\/ats\/careers\/v2\/(?:jobSearch|searchResults)[^\s"'<>]*/i);
  if (taleo) return { kind: "taleo", endpoint: decodeHtmlAttribute(taleo[0]) };

  if (/(?:app\.jibecdn\.com\/prod\/search\/|cms\.jibecdn\.com\/prod\/)/i.test(searchable)) {
    const page = new URL(_pageUrl);
    return { kind: "jibe", endpoint: `${page.origin}/api/jobs?page=1&limit=100&sortBy=relevance&descending=false&internal=false` };
  }

  return null;
}

const phenomSearchResultsUrl = (html: string, pageUrl: string): string | null => {
  if (!/(?:phenompeople\.com|phApp\.|ph-page|phenom-track)/i.test(html)) return null;
  const page = new URL(pageUrl);
  if (/\/search-results\/?$/i.test(page.pathname)) return null;
  if (/(?:^|\/)en\/?$/i.test(page.pathname)) {
    page.pathname = `${page.pathname.replace(/\/$/, "")}/search-results`;
    page.search = "";
    page.hash = "";
    return page.href;
  }
  if (/\/jointalentcommunity\/?$/i.test(page.pathname)) {
    page.pathname = page.pathname.replace(/\/jointalentcommunity\/?$/i, "/search-results");
    page.search = "";
    page.hash = "";
    return page.href;
  }
  const linkedSearch = anchorsFromHtml(html).flatMap(({ href }) => {
    try {
      const url = new URL(href, page);
      return url.origin === page.origin && /\/search-results\/?$/i.test(url.pathname) ? [url] : [];
    } catch {
      return [];
    }
  }).at(0);
  if (linkedSearch) {
    linkedSearch.search = "";
    linkedSearch.hash = "";
    return linkedSearch.href;
  }
  page.pathname = `${page.pathname.replace(/\/$/, "")}/search-results`;
  page.search = "";
  page.hash = "";
  return page.href;
};

const smartRecruitersEndpointIdentity = (value: string): { companyCode: string; endpoint: string } | null => {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/v1\/companies\/([^/]+)\/postings\/?$/i);
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "api.smartrecruiters.com" || !match) return null;
    const companyCode = decodeURIComponent(match[1]);
    if (!/^[a-z0-9_-]+$/i.test(companyCode)) return null;
    return {
      companyCode,
      endpoint: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyCode)}/postings`,
    };
  } catch {
    return null;
  }
};

const smartRecruitersJobUrl = (companyCode: string, job: SmartRecruitersJob): string => {
  const titleSlug = (job.name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const identity = `${job.id}${titleSlug ? `-${titleSlug}` : ""}`;
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(companyCode)}/${encodeURIComponent(identity)}`;
};

const smartRecruitersNumber = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const smartRecruitersCustomValue = (job: SmartRecruitersJob, pattern: RegExp): string | null =>
  job.customField?.find(({ fieldLabel, valueLabel }) => pattern.test(fieldLabel ?? "") && Boolean(valueLabel?.trim()))?.valueLabel?.trim() ?? null;

const normalizeSmartRecruitersJob = (source: CrawlSource, companyCode: string, job: SmartRecruitersJob): CrawledJob => {
  const title = job.name!.trim();
  const programKeys = classifyJobPrograms(title).keys;
  const reportedEmployment = job.typeOfEmployment?.label?.trim() || null;
  const employmentType = programKeys.includes("coop")
    ? "Co-op"
    : programKeys.includes("internship")
      ? "Internship"
      : normalizeEmploymentType(reportedEmployment) ?? reportedEmployment;
  const locationCountry = job.location?.country
    ?? smartRecruitersCustomValue(job, /^(?:country\/region|work location country)$/i);
  const locationCity = job.location?.city
    ?? smartRecruitersCustomValue(job, /^work location city$/i);
  const locationState = job.location?.region
    ?? smartRecruitersCustomValue(job, /^work location state$/i);
  const locationPostalCode = job.location?.postalCode
    ?? smartRecruitersCustomValue(job, /^(?:work location )?(?:zip|postal) code$/i);
  const location = job.location?.fullLocation?.trim()
    || [locationCity, locationState, locationCountry].filter(Boolean).join(", ")
    || null;
  const latitude = smartRecruitersNumber(job.location?.latitude);
  const longitude = smartRecruitersNumber(job.location?.longitude);
  const businessUnit = smartRecruitersCustomValue(job, /^(?:business unit|business group|business segment)$/i);
  const team = smartRecruitersCustomValue(job, /^(?:team|sub business|brands?)$/i);
  const office = smartRecruitersCustomValue(job, /^work location name$/i);
  return {
    externalId: job.id!,
    title,
    company: source.company,
    location,
    arrangement: job.location?.remote === true
      ? "remote"
      : job.location?.hybrid === true
        ? "hybrid"
        : job.location?.remote === false && job.location?.hybrid === false
          ? "onsite"
          : "unknown",
    employmentType,
    summary: null,
    ...(job.refNumber ? { requisitionId: job.refNumber } : {}),
    ...(job.department?.label ? { department: job.department.label } : {}),
    ...(job.function?.label ? { jobFunction: job.function.label } : {}),
    ...(job.industry?.label ? { industry: job.industry.label } : {}),
    ...(job.experienceLevel?.label ? { experienceLevel: job.experienceLevel.label } : {}),
    ...(businessUnit ? { businessUnit } : {}),
    ...(team ? { team } : {}),
    ...(office ? { office } : {}),
    ...(locationCity ? { locationCity } : {}),
    ...(locationState ? { locationState } : {}),
    ...(locationCountry ? { locationCountry } : {}),
    ...(locationPostalCode ? { locationPostalCode } : {}),
    ...(latitude != null ? { latitude } : {}),
    ...(longitude != null ? { longitude } : {}),
    ...(job.language?.label ? { languages: [job.language.label] } : {}),
    officialUrl: smartRecruitersJobUrl(companyCode, job),
    publishedAt: normalizedDate(job.releasedDate),
  };
};

async function crawlSmartRecruiters(
  source: CrawlSource,
  endpointValue: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> {
  const identity = smartRecruitersEndpointIdentity(endpointValue);
  if (!identity) return {
    status: "failed",
    responseStatus: null,
    completeListing: false,
    jobs: [],
    error: "SmartRecruiters endpoint identity was invalid.",
  };

  const pageSize = 100;
  // Leave source-wide request headroom for one structural retry plus the
  // bounded internship detail enrichment that follows the listing crawl.
  const maxPagesPerPass = 19;
  let responseStatus: number | null = null;
  const fetchPage = async (page: number): Promise<{ total: number; jobs: SmartRecruitersJob[]; identities: string[] }> => {
    const offset = (page - 1) * pageSize;
    const url = new URL(identity.endpoint);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetchWithTimeout(fetcher, url, {
      headers: { accept: "application/json" },
    }, false, { attempts: 1, timeoutMs: 12_000 });
    responseStatus = response.status;
    if (!response.ok) {
      throw Object.assign(new Error(`SmartRecruiters returned HTTP ${response.status}.`), { responseStatus: response.status });
    }
    const payload = await response.json() as SmartRecruitersPayload;
    const total = payload.totalFound;
    const jobs = payload.content;
    const expected = Number.isInteger(total) && total! >= 0
      ? Math.min(pageSize, Math.max(0, total! - offset))
      : -1;
    if (payload.offset !== offset || payload.limit !== pageSize || !Array.isArray(jobs)
      || jobs.length !== expected) {
      throw Object.assign(new Error("SmartRecruiters returned an incomplete or malformed catalog page."), { responseStatus: response.status });
    }
    const usable = jobs.every((job) => {
      if (typeof job.id !== "string" || !job.id.trim() || typeof job.name !== "string" || !job.name.trim()) return false;
      if (job.visibility && job.visibility.toLocaleUpperCase() !== "PUBLIC") return false;
      if (job.company?.identifier && job.company.identifier.toLocaleLowerCase() !== identity.companyCode.toLocaleLowerCase()) return false;
      if (!job.ref) return true;
      try {
        const reference = new URL(job.ref);
        return reference.origin === "https://api.smartrecruiters.com"
          && reference.pathname.toLocaleLowerCase() === `/v1/companies/${identity.companyCode}/postings/${job.id}`.toLocaleLowerCase();
      } catch {
        return false;
      }
    });
    const identities = jobs.map((job) => job.id!);
    if (!usable || new Set(identities).size !== identities.length) {
      throw Object.assign(new Error("SmartRecruiters returned duplicate or unusable job identities."), { responseStatus: response.status });
    }
    return { total: total!, jobs, identities };
  };

  try {
    const first = await fetchPage(1);
    if (first.total === 0) {
      const confirmation = await fetchPage(1);
      if (confirmation.total !== 0 || confirmation.jobs.length !== 0) {
        throw new Error("SmartRecruiters empty catalog was not stable across confirmation requests.");
      }
      return {
        status: "succeeded",
        responseStatus,
        completeListing: true,
        jobs: [],
        pagination: { nextPage: 1, cycleComplete: true, totalPages: 1 },
        resolvedListingUrl: `https://careers.smartrecruiters.com/${encodeURIComponent(identity.companyCode)}`,
        error: null,
      };
    }

    const totalPages = Math.ceil(first.total / pageSize);
    const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
    const startPage = requestedStart <= totalPages ? requestedStart : 1;
    const endPage = Math.min(totalPages, startPage + maxPagesPerPass - 1);
    const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
    type Page = { total: number; jobs: SmartRecruitersJob[]; identities: string[] };
    const loadPages = async (concurrent: boolean): Promise<Page[]> => {
      const pages: Page[] = [];
      for (let index = 0; index < pageNumbers.length; index += concurrent ? 4 : 1) {
        const batch = pageNumbers.slice(index, index + (concurrent ? 4 : 1));
        const results = await Promise.all(batch.map((page) => page === 1 ? Promise.resolve(first) : fetchPage(page)));
        pages.push(...results);
      }
      return pages;
    };
    const stablePages = async (pages: Page[]): Promise<boolean> => {
      if (pages.some((page) => page.total !== first.total)) return false;
      const identities = pages.flatMap((page) => page.identities);
      if (new Set(identities).size !== identities.length) return false;
      const firstConfirmation = await fetchPage(1);
      return firstConfirmation.total === first.total
        && firstConfirmation.identities.length === first.identities.length
        && firstConfirmation.identities.every((jobId, index) => jobId === first.identities[index]);
    };

    let pages = await loadPages(true);
    if (!await stablePages(pages)) {
      pages = await loadPages(false);
      if (!await stablePages(pages)) {
        throw new Error("SmartRecruiters catalog changed or repeated job identities during pagination.");
      }
    }
    const rawJobs = pages.flatMap((page) => page.jobs);
    const jobs = rawJobs.map((job) => normalizeSmartRecruitersJob(source, identity.companyCode, job));
    const cycleComplete = endPage === totalPages;
    const completeListing = startPage === 1 && cycleComplete && jobs.length === first.total;
    return {
      status: "succeeded",
      responseStatus,
      completeListing,
      jobs,
      pagination: {
        nextPage: cycleComplete ? 1 : endPage + 1,
        cycleComplete,
        totalPages,
      },
      resolvedListingUrl: `https://careers.smartrecruiters.com/${encodeURIComponent(identity.companyCode)}`,
      error: null,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: Number.isFinite(status) ? status : null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown SmartRecruiters crawler error.",
    };
  }
}

async function crawlDiscoveredFeed(source: CrawlSource, discovered: DiscoveredAts, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  if (discovered.kind === "smartrecruiters") {
    return crawlSmartRecruiters(source, discovered.endpoint, fetcher);
  }
  if (discovered.kind === "workable") {
    return crawlWorkable({ ...source, postingUrl: discovered.endpoint, adapter: "custom" }, fetcher);
  }
  if (discovered.kind === "bamboohr") {
    return crawlBambooHr({ ...source, postingUrl: discovered.endpoint, adapter: "custom" }, fetcher);
  }
  if (discovered.kind === "pinpoint") {
    return crawlPinpoint({ ...source, postingUrl: discovered.endpoint, adapter: "custom" }, fetcher);
  }
  if (discovered.kind === "hirebridge") {
    return crawlHirebridge({ ...source, postingUrl: discovered.endpoint, adapter: "custom" }, fetcher);
  }
  if (discovered.kind === "taleo") {
    return (await crawlTaleoV2({ ...source, postingUrl: discovered.endpoint, adapter: "custom" }, fetcher))
      ?? { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Unsupported Taleo catalog." };
  }
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
        jobs: greenhouseJobs(payload.jobs ?? [], source),
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
      if (!Number.isInteger(total) || total < 0 || (total > 0 && firstItems.length === 0)) {
        throw new Error("Jibe returned an unusable catalog page.");
      }
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
      const pageSize = Math.max(firstItems.length, 1);
      const boundedTotal = Math.min(total, 10_000);
      const totalPages = Math.max(1, Math.ceil(boundedTotal / pageSize));
      const requestedStartPage = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
      const startPage = requestedStartPage <= totalPages ? requestedStartPage : 1;
      // Jibe pages can carry multi-megabyte descriptions. Keep both network
      // transfer and D1 upserts safely inside the Sites request deadline; the
      // persisted cursor resumes the next overlapping window next cycle.
      const maxPagesPerPass = 15;
      const endPage = Math.min(totalPages, startPage + maxPagesPerPass - 1);
      const expectedPageLength = (page: number): number => boundedTotal === 0
        ? 0
        : Math.min(pageSize, Math.max(0, boundedTotal - (page - 1) * pageSize));
      const fetchPage = async (page: number): Promise<JibeJob[] | null> => {
        try {
          const pageUrl = new URL(discovered.endpoint);
          pageUrl.searchParams.set("page", String(page));
          const pageResponse = await fetchWithTimeout(fetcher, pageUrl);
          if (!pageResponse.ok) return null;
          const payload = await pageResponse.json() as { totalCount?: number; jobs?: JibeJob[] };
          const items = payload.jobs;
          const stableCatalog = total > 10_000
            ? Number.isInteger(payload.totalCount) && Number(payload.totalCount) >= boundedTotal
            : payload.totalCount === total;
          return stableCatalog && Array.isArray(items) && items.length === expectedPageLength(page)
            ? items
            : null;
        } catch {
          return null;
        }
      };

      const startItems = startPage === 1 ? firstItems : await fetchPage(startPage);
      if (!startItems || startItems.length !== expectedPageLength(startPage)) {
        throw new Error("Jibe returned an incomplete or malformed catalog page.");
      }
      const jobs = normalize(startItems);
      if (jobs.length !== startItems.length) throw new Error("Jibe returned unusable job identities.");
      const pageNumbers = Array.from({ length: Math.max(0, endPage - startPage) }, (_, index) => startPage + index + 1);
      let firstFailedPage: number | null = null;
      let lastSuccessfulPage = startPage;
      for (let index = 0; index < pageNumbers.length && firstFailedPage === null; index += 8) {
        const batchNumbers = pageNumbers.slice(index, index + 8);
        const pages = await Promise.all(batchNumbers.map(fetchPage));
        const failedIndex = pages.findIndex((page) => page === null);
        const usableCount = failedIndex === -1 ? pages.length : failedIndex;
        for (let pageIndex = 0; pageIndex < usableCount; pageIndex += 1) {
          const page = pages[pageIndex] ?? [];
          const normalized = normalize(page);
          if (normalized.length !== page.length) {
            firstFailedPage = batchNumbers[pageIndex];
            break;
          }
          jobs.push(...normalized);
          lastSuccessfulPage += 1;
        }
        if (firstFailedPage === null && failedIndex !== -1) firstFailedPage = batchNumbers[failedIndex];
      }
      const unique = uniqueJobs(jobs);
      if (unique.length !== jobs.length && total <= 10_000) {
        throw new Error("Jibe repeated job identities across catalog pages.");
      }
      const boundedCycleComplete = firstFailedPage === null && lastSuccessfulPage === totalPages;
      const cycleComplete = boundedCycleComplete && total <= 10_000;
      const completeListing = startPage === 1 && cycleComplete && totalPages <= maxPagesPerPass && unique.length === total;
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
        completeListing,
        jobs: unique,
        ...(facets.length > 0 ? { facets } : {}),
        ...(!completeListing && totalPages > 1 ? {
          pagination: {
            nextPage: firstFailedPage ?? (boundedCycleComplete ? 1 : Math.max(startPage + 1, lastSuccessfulPage)),
            cycleComplete,
            totalPages,
          },
        } : {}),
        error: null,
      };
    }

    throw new Error(`Unsupported discovered feed kind: ${discovered.kind}`);
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
  const pathSite = page.pathname.match(/\/sites\/([a-z0-9_-]+)(?:\/|$)/i)?.[1] ?? null;
  const embeddedSite = html.match(/[?&]siteNumber=([a-z0-9_-]+)(?:[&#"']|$)/i)?.[1] ?? null;
  const candidateExperiencePath = /\/hcmUI\/CandidateExperience\//i.test(page.pathname);
  const site = pathSite && (/^CX(?:_|$)/i.test(pathSite) || candidateExperiencePath)
    ? pathSite
    : embeddedSite;
  const oracleHost = html.match(/https:\/\/([a-z0-9.-]+\.fa\.[a-z0-9.-]*oraclecloud\.com)(?::443)?/i)?.[1];
  const apiOrigin = oracleHost ? `https://${oracleHost}` : candidateExperiencePath ? page.origin : null;
  return site && apiOrigin ? { apiOrigin, site } : null;
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
    const pageSize = 25;
    // One request is spent discovering Oracle from the public listing page.
    // Keep the remaining API work inside the source-wide 50-request budget.
    // Some Oracle tenants advertise a count that includes hidden requisitions.
    // Bound page requests plus stable-short-page confirmations so the listing
    // discovery request and API work remain within the source-wide ceiling.
    const maxPagesPerPass = 48;
    const maxApiRequests = 49;
    let apiRequests = 0;
    const fetchPage = async (pageNumber: number): Promise<{ responseStatus: number; total: number; page: OracleJob[] }> => {
      if (apiRequests >= maxApiRequests) {
        throw new Error("Oracle Recruiting request budget was exhausted.");
      }
      apiRequests += 1;
      const offset = (pageNumber - 1) * pageSize;
      const endpoint = new URL("/hcmRestApi/resources/latest/recruitingCEJobRequisitions", oracle.apiOrigin);
      endpoint.searchParams.set("onlyData", "true");
      endpoint.searchParams.set("expand", "requisitionList.workLocation");
      endpoint.searchParams.set("finder", `findReqs;siteNumber=${oracle.site},limit=${pageSize},offset=${offset},sortBy=POSTING_DATES_DESC`);
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: "application/json", referer: source.postingUrl },
      });
      if (!response.ok) throw new Error(`Oracle Recruiting returned HTTP ${response.status}.`);
      const payload = await response.json() as { items?: Array<{ TotalJobsCount?: number; requisitionList?: OracleJob[] }> };
      const container = payload.items?.[0];
      const total = container?.TotalJobsCount;
      const page = container?.requisitionList;
      if (!Number.isInteger(total) || total! < 0 || !Array.isArray(page)) {
        throw new Error("Oracle Recruiting returned an unusable catalog page.");
      }
      return { responseStatus: response.status, total: total!, page };
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

    const validatePage = async (
      pageNumber: number,
      result: Awaited<ReturnType<typeof fetchPage>>,
      advertisedTotal: number,
    ): Promise<{ jobs: CrawledJob[] } | null> => {
      const expected = advertisedTotal === 0
        ? 0
        : Math.min(pageSize, Math.max(0, advertisedTotal - (pageNumber - 1) * pageSize));
      const normalized = normalizePage(result.page);
      if (normalized.length !== result.page.length) return null;
      if (result.page.length === expected) return { jobs: normalized };
      if (result.page.length > expected || apiRequests >= maxApiRequests) return null;

      // Oracle's advertised total can include hidden requisitions, so a stable
      // short page may occur anywhere in the catalog rather than only at the
      // end. Confirm the exact identities before advancing the checkpoint;
      // this keeps transient truncation from authorizing stale-job closure.
      const retry = await fetchPage(pageNumber);
      const identities = result.page.map((job) => String(job.Id ?? ""));
      const retryIdentities = retry.page.map((job) => String(job.Id ?? ""));
      if (retry.total !== advertisedTotal || identities.some((id) => !id)
        || identities.length !== retryIdentities.length
        || identities.some((id, index) => id !== retryIdentities[index])) return null;
      const retriedJobs = normalizePage(retry.page);
      return retriedJobs.length === retry.page.length
        ? { jobs: retriedJobs }
        : null;
    };

    let startPage = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
    let first = await fetchPage(startPage);
    let total = first.total;
    let totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (startPage > totalPages) {
      startPage = 1;
      first = await fetchPage(startPage);
      total = first.total;
      totalPages = Math.max(1, Math.ceil(total / pageSize));
    }
    const firstPage = await validatePage(startPage, first, total);
    if (!firstPage) {
      throw new Error("Oracle Recruiting returned an incomplete or unusable catalog page.");
    }
    const jobs = [...firstPage.jobs];
    let firstFailedPage: number | null = null;
    let lastSuccessfulPage = startPage;
    while (lastSuccessfulPage < totalPages && firstFailedPage === null) {
      // Reserve one confirmation request for every page in the batch. When a
      // page is full the reservation is released to a later batch, preserving
      // the previous 48-page fast path while keeping worst-case source work at
      // one discovery request plus at most 49 Oracle API requests.
      const remainingRequests = maxApiRequests - apiRequests;
      const batchSize = Math.min(
        8,
        totalPages - lastSuccessfulPage,
        Math.floor(remainingRequests / 2),
      );
      if (batchSize < 1) break;
      const batchNumbers = Array.from({ length: batchSize }, (_, index) => lastSuccessfulPage + index + 1);
      const pages = await Promise.all(batchNumbers.map(async (pageNumber) => {
        try {
          const result = await fetchPage(pageNumber);
          if (result.total !== total) return null;
          return validatePage(pageNumber, result, total);
        } catch {
          return null;
        }
      }));
      const failedIndex = pages.findIndex((page) => page === null);
      const usableCount = failedIndex === -1 ? pages.length : failedIndex;
      for (const page of pages.slice(0, usableCount)) {
        if (!page) continue;
        jobs.push(...page.jobs);
      }
      lastSuccessfulPage += usableCount;
      if (failedIndex !== -1) firstFailedPage = batchNumbers[failedIndex];
    }
    const unique = uniqueJobs(jobs);
    if (unique.length !== jobs.length) throw new Error("Oracle Recruiting repeated job identities across catalog pages.");
    const cycleComplete = firstFailedPage === null && lastSuccessfulPage === totalPages;
    // A hidden-requisition count mismatch is safe for checkpoint progress but
    // not for single-pass stale closure. Only an exact advertised catalog is
    // complete immediately; stable short catalogs close unseen rows after the
    // existing two-cycle checkpoint guard.
    const completeListing = startPage === 1 && cycleComplete && totalPages <= maxPagesPerPass
      && unique.length === total;
    return {
      status: "succeeded",
      responseStatus: first.responseStatus,
      completeListing,
      jobs: unique,
      ...(!completeListing ? {
        pagination: {
          nextPage: cycleComplete ? 1 : firstFailedPage ?? lastSuccessfulPage + 1,
          cycleComplete,
          totalPages,
        },
      } : {}),
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

const claimPageIdentities = (
  values: Array<string | null | undefined>,
  expected: number,
  seen: Set<string>,
): boolean => {
  if (values.length < expected || values.some((value) => !value)) return false;
  const unique = new Set(values as string[]);
  if (unique.size !== values.length || [...unique].some((value) => seen.has(value))) return false;
  for (const value of unique) seen.add(value);
  return true;
};

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
    if (typeof job.title !== "string" || !job.title.trim()) return [];
    const externalId = job.jobId ?? job.reqId ?? job.jobSeqNo ?? null;
    const listing = new URL(source.postingUrl);
    const localeRoot = listing.pathname.replace(/\/(?:search-results|jobs?)(?:\/.*)?$/i, "").replace(/\/$/, "");
    const titleSlug = job.title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // Prefer an explicit first-party detail/apply URL from the payload.  A
    // generated Phenom detail path is only a fallback: several tenants expose
    // the real Workday requisition in `applyUrl`, and using the guessed path
    // both loses the canonical posting URL and prevents optional Workday
    // detail enrichment from running.
    const officialUrl = asText(job.jobUrl)
      ?? asText(job.applyUrl)
      ?? asText(job.actionUrl)
      ?? (externalId ? `${listing.origin}${localeRoot}/job/${encodeURIComponent(externalId)}/${titleSlug}` : null);
    if (!officialUrl) return [];
    const workplace = `${job.checkRemote ?? ""} ${job.workplaceType ?? ""} ${job.location ?? ""}`.toLowerCase();
    const latitude = typeof job.latitude === "number" ? job.latitude : Number.parseFloat(job.latitude ?? "");
    const longitude = typeof job.longitude === "number" ? job.longitude : Number.parseFloat(job.longitude ?? "");
    return [{
      externalId,
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
      ...(job.businessUnit ? { businessUnit: job.businessUnit } : {}),
      ...(job.industry ? { industry: job.industry } : {}),
      ...(job.multi_location?.length ? { secondaryLocations: job.multi_location } : {}),
      ...(job.city ? { locationCity: job.city } : {}),
      ...(job.state ? { locationState: job.state } : {}),
      ...(job.country ? { locationCountry: job.country } : {}),
      ...(Number.isFinite(latitude) ? { latitude } : {}),
      ...(Number.isFinite(longitude) ? { longitude } : {}),
      ...(job.reqId || job.jobId ? { requisitionId: job.reqId ?? job.jobId } : {}),
      ...(asText(job.applyUrl) || asText(job.actionUrl) ? { applyUrl: asText(job.applyUrl) ?? asText(job.actionUrl) } : {}),
      officialUrl,
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
  const totalPages = Math.ceil(Math.min(first.totalHits, 10_000) / pageSize);
  const isCheckpointed = totalPages > 40;
  const startPage = isCheckpointed ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages) : 1;
  const endPage = isCheckpointed ? Math.min(startPage + (startPage === 1 ? 19 : 18), totalPages) : totalPages;
  const pagesToFetch = Array.from(
    { length: Math.max(0, endPage - Math.max(startPage, 2) + 1) },
    (_, index) => Math.max(startPage, 2) + index,
  );
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
  for (let index = 0; index < pagesToFetch.length; index += 10) {
    pages.push(...await Promise.all(pagesToFetch.slice(index, index + 10).map((page) => fetchPage((page - 1) * pageSize))));
  }
  const successfulPages = pages.filter((page): page is PhenomPage => page !== null);
  const jobs = [...new Map([first, ...successfulPages]
    .flatMap((page) => page.jobs).map((job) => [job.officialUrl, job])).values()];
  const firstExpected = Math.min(pageSize, first.totalHits);
  const seenIdentities = new Set<string>();
  let firstFailedPage: number | null = claimPageIdentities(
    first.jobs.map((job) => job.externalId ?? job.officialUrl), firstExpected, seenIdentities,
  ) ? null : 1;
  for (let index = 0; index < pages.length && firstFailedPage === null; index += 1) {
    const page = pages[index];
    const pageNumber = pagesToFetch[index];
    const expected = Math.min(pageSize, Math.max(0, first.totalHits - (pageNumber - 1) * pageSize));
    if (!page || !claimPageIdentities(
      page.jobs.map((job) => job.externalId ?? job.officialUrl), expected, seenIdentities,
    )) {
      firstFailedPage = pageNumber;
      break;
    }
  }
  if (isCheckpointed) return {
    status: "succeeded",
    responseStatus: first.responseStatus,
    completeListing: false,
    jobs,
    ...(first.facets?.length ? { facets: first.facets } : {}),
    pagination: {
      nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
      cycleComplete: firstFailedPage === null && endPage === totalPages,
      totalPages,
    },
    error: null,
  };
  return {
    status: "succeeded",
    responseStatus: first.responseStatus,
    completeListing: firstFailedPage === null && successfulPages.length === pages.length
      && jobs.length >= first.totalHits,
    jobs,
    ...(first.facets?.length ? { facets: first.facets } : {}),
    error: null,
  };
};

const phenomWidgetPage = (payload: unknown, source: CrawlSource): PhenomPage | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const refineSearch = (payload as { refineSearch?: unknown }).refineSearch;
  if (!refineSearch || typeof refineSearch !== "object" || Array.isArray(refineSearch)) return null;
  return phenomJobs(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: refineSearch })};</script>`, source);
};

const phenomWidgetLocale = (postingUrl: string): { country: string; lang: string; listingUrl: string } => {
  const listing = new URL(postingUrl);
  const segments = listing.pathname.split("/").filter(Boolean);
  const country = segments[0]?.toLocaleLowerCase() || "global";
  const language = segments.find((segment) => /^[a-z]{2}(?:-[A-Z]{2})?$/i.test(segment))?.split("-")[0].toLocaleLowerCase() || "en";
  listing.pathname = `/${country}/search-results`;
  listing.search = "";
  listing.hash = "";
  return { country, lang: `${language}_${country}`, listingUrl: listing.href };
};

/**
 * Phenom's public `/widgets` endpoint is independent of the branded HTML
 * edge. Some tenants (notably RTX) challenge the listing page while their
 * first-party catalog endpoint remains available to ordinary server fetches.
 */
const crawlPhenomWidgets = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const { country, lang, listingUrl } = phenomWidgetLocale(source.postingUrl);
  const endpoint = new URL("/widgets", source.postingUrl).href;
  const requestedPageSize = 500;
  let responseStatus: number | null = null;
  const fetchPage = async (offset: number): Promise<PhenomPage | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          referer: listingUrl,
        },
        body: JSON.stringify({
          lang,
          deviceType: "desktop",
          country,
          pageName: "search-results",
          ddoKey: "refineSearch",
          sortBy: "",
          subsearch: "",
          from: offset,
          jobs: true,
          counts: true,
          all_fields: ["category", "country", "state", "city"],
          size: requestedPageSize,
          clearAll: false,
          jdsource: "facets",
          isSliderEnable: false,
          keywords: "",
          global: true,
          selected_fields: {},
          // A string `sortBy` is ignored by RTX and produces overlapping,
          // relevance-ranked offsets. Phenom's structured sort provides a
          // monotonic posted-date order; overlapping windows below absorb
          // ties at page boundaries.
          sort: { order: "desc", field: "postedDate" },
          locationData: {},
        }),
      }, false, { attempts: 1, timeoutMs: 12_000 });
      responseStatus = response.status;
      if (!response.ok) return null;
      return phenomWidgetPage(await response.json(), source);
    } catch {
      return null;
    }
  };

  const index = await fetchPage(0);
  if (!index || index.totalHits === null || index.pageHits === null || index.totalHits <= 0) return {
    status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
    responseStatus,
    completeListing: false,
    jobs: [],
    error: "Phenom widgets did not return a usable catalog page.",
  };
  const boundedTotal = Math.min(index.totalHits, 10_000);
  const pageSize = index.pageHits;
  const step = Math.max(1, Math.floor(pageSize * 0.8));
  const lastOffset = Math.max(0, Math.ceil(Math.max(0, boundedTotal - pageSize) / step) * step);
  const offsets = Array.from({ length: Math.floor(lastOffset / step) }, (_, index) => (index + 1) * step);
  // Leave request-budget headroom for the challenged HTML attempt, a stable
  // first-window verification, and optional internship detail enrichment.
  if (offsets.length > 35) return {
    status: "succeeded",
    responseStatus,
    completeListing: false,
    jobs: uniqueJobs(index.jobs),
    ...(index.facets?.length ? { facets: index.facets } : {}),
    resolvedListingUrl: listingUrl,
    error: "Phenom widget catalog exceeds the bounded overlap window.",
  };
  const pages = new Map<number, PhenomPage>([[0, index]]);
  for (let batchStart = 0; batchStart < offsets.length; batchStart += 4) {
    const batch = offsets.slice(batchStart, batchStart + 4);
    const results = await Promise.all(batch.map(fetchPage));
    results.forEach((result, indexInBatch) => {
      if (result) pages.set(batch[indexInBatch], result);
    });
  }

  const jobs: CrawledJob[] = [];
  let invalidOffset: number | null = null;
  for (const offset of [0, ...offsets]) {
    const result = pages.get(offset);
    const expected = Math.min(pageSize, Math.max(0, boundedTotal - offset));
    const identities = result?.jobs.map((job) => job.externalId ?? job.officialUrl) ?? [];
    const valid = result
      && result.totalHits === index.totalHits
      && result.pageHits === expected
      && result.jobs.length === expected
      && identities.every(Boolean)
      && new Set(identities).size === expected;
    if (!valid) {
      invalidOffset = offset;
      break;
    }
    jobs.push(...result!.jobs);
  }

  const unique = uniqueJobs(jobs);
  let completeListing = invalidOffset === null
    && index.totalHits <= 10_000
    && unique.length === index.totalHits;
  if (completeListing) {
    const verification = await fetchPage(0);
    const initialIds = index.jobs.map((job) => job.externalId ?? job.officialUrl);
    const verificationIds = verification?.jobs.map((job) => job.externalId ?? job.officialUrl) ?? [];
    if (!verification || verification.totalHits !== index.totalHits
      || verificationIds.length !== initialIds.length
      || initialIds.some((identity, position) => verificationIds[position] !== identity)) {
      completeListing = false;
    }
  }
  if (unique.length === 0) return {
    status: "failed",
    responseStatus,
    completeListing: false,
    jobs: [],
    error: "Phenom widgets returned an incomplete or unstable catalog page.",
  };
  return {
    status: "succeeded",
    responseStatus,
    completeListing,
    jobs: unique,
    ...(index.facets?.length ? { facets: index.facets } : {}),
    resolvedListingUrl: listingUrl,
    error: completeListing ? null : `Phenom widgets returned an incomplete or unstable catalog window${invalidOffset === null ? "" : ` at offset ${invalidOffset}`}.`,
  };
};

export const extractJobsFromHtml = (html: string, source: CrawlSource): { jobs: CrawledJob[]; completeListing: boolean } => {
  const phenom = phenomJobs(html, source);
  if (phenom) return { jobs: phenom.jobs, completeListing: phenom.completeListing };
  const paylocity = paylocityJobs(html, source);
  if (paylocity !== null) return { jobs: paylocity, completeListing: true };
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

const hrmDirectJobs = (html: string, source: CrawlSource): SourceCrawlResult | null => {
  if (!/hrmdirect\.com$/i.test(new URL(source.postingUrl).hostname) || !/data-req-id=/i.test(html)) return null;
  const rows = [...html.matchAll(/<tr\b[^>]*data-req-id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length === 0) return null;
  const cell = (row: string, className: string): string | null => {
    const match = row.match(new RegExp(`<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"));
    const value = plainText(match?.[1]);
    return value ? decodeHtmlAttribute(value) : null;
  };
  const jobs = uniqueJobs(rows.flatMap((row): CrawledJob[] => {
    const externalId = row[1]?.trim();
    const body = row[2] ?? "";
    const title = cell(body, "posTitle");
    if (!externalId || !title) return [];
    const reqLocation = body.match(/[?&]req_loc=([^&#"']+)/i)?.[1] ?? null;
    const detailUrl = new URL("job-opening.php", source.postingUrl);
    detailUrl.searchParams.set("req", externalId);
    if (reqLocation) detailUrl.searchParams.set("req_loc", decodeHtmlAttribute(reqLocation));
    detailUrl.hash = "job";
    const city = cell(body, "cities");
    const state = cell(body, "state");
    const department = cell(body, "departments");
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location: [city, state].filter(Boolean).join(", ") || null,
      arrangement: /\bremote\b/i.test([title, city, state].filter(Boolean).join(" ")) ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: null,
      department,
      locationCity: city,
      locationState: state,
      requisitionId: externalId,
      officialUrl: detailUrl.href,
      publishedAt: null,
    }];
  }));
  return {
    status: jobs.length > 0 ? "succeeded" : "failed",
    responseStatus: 200,
    completeListing: jobs.length > 0 && jobs.length === rows.length,
    jobs,
    error: jobs.length > 0 ? null : "HRMDirect listing contained no usable jobs.",
  };
};

const infosysJobs = (html: string, source: CrawlSource): { jobs: CrawledJob[]; total: number } | null => {
  if (new URL(source.postingUrl).hostname !== "digitalcareers.infosys.com") return null;
  const total = Number(html.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+matching jobs/i)?.[1]?.replaceAll(",", ""));
  const cards = [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/company-job\/description\/reqid\/([^"'/?#]+))[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  if (!Number.isInteger(total) || total <= 0 || cards.length === 0) return null;
  const jobs = uniqueJobs(cards.flatMap((card): CrawledJob[] => {
    const externalId = card[2]?.trim();
    const body = card[3] ?? "";
    const title = decodeHtmlAttribute(body.match(/\bdata-title=["']([^"']+)["']/i)?.[1] ?? "")
      .replaceAll("&nbsp;", " ").replace(/\s+/g, " ").trim();
    if (!externalId || !title) return [];
    const locationBlock = body.split(/\bjs-job-reqid\b/i)[0] ?? body;
    const locationValues = [...locationBlock.matchAll(/<div\b[^>]*class=["'][^"']*\blocation-inline\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map((match) => decodeHtmlAttribute(plainText(match[1]) ?? "").replaceAll("&nbsp;", " ").trim())
      .filter((value) => value && value !== "," && value !== "-" && !/^USA$/i.test(value));
    const location = locationValues.join(", ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim() || null;
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: null,
      locationCountry: "United States",
      requisitionId: externalId,
      officialUrl: new URL(card[1], source.postingUrl).href,
      publishedAt: null,
    }];
  }));
  return { jobs, total };
};

const crawlInfosys = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  try {
    const listingUrl = new URL(source.postingUrl);
    const fetchPage = async (page: number): Promise<{ status: number; parsed: { jobs: CrawledJob[]; total: number } }> => {
      const url = new URL(listingUrl);
      url.searchParams.set("location", "USA");
      url.searchParams.set("per_page", "25");
      if (page > 1) url.searchParams.set("page", String(page));
      else url.searchParams.delete("page");
      const response = await fetchWithTimeout(fetcher, url, {}, true, { attempts: 1, timeoutMs: 15_000 });
      if (!response.ok) throw Object.assign(new Error(`Infosys careers returned HTTP ${response.status}.`), { responseStatus: response.status });
      const parsed = infosysJobs(await response.text(), source);
      if (!parsed) throw Object.assign(new Error("Infosys careers returned no usable listing cards."), { responseStatus: response.status });
      return { status: response.status, parsed };
    };
    const first = await fetchPage(1);
    const total = first.parsed.total;
    const totalPages = Math.ceil(total / 25);
    const startPage = Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages);
    const endPage = Math.min(startPage + (startPage === 1 ? 19 : 18), totalPages);
    const pages = startPage === 1
      ? Array.from({ length: Math.max(0, endPage - 1) }, (_, index) => index + 2)
      : Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
    const payloads = [first.parsed];
    for (let index = 0; index < pages.length; index += 6) {
      const batch = await Promise.all(pages.slice(index, index + 6).map(fetchPage));
      payloads.push(...batch.map((page) => page.parsed));
    }
    let exact = payloads.every((payload, index) => {
      const page = index === 0 ? 1 : pages[index - 1];
      const expected = Math.min(25, total - (page - 1) * 25);
      return payload.total === total
        && payload.jobs.length === expected
        && payload.jobs.every((job) => Boolean(job.externalId))
        && new Set(payload.jobs.map((job) => job.externalId)).size === payload.jobs.length;
    });
    const jobs = uniqueJobs(payloads.flatMap((payload) => payload.jobs));
    exact = exact && jobs.length === payloads.reduce((sum, payload) => sum + payload.jobs.length, 0);
    const cycleComplete = exact && endPage === totalPages;
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: first.status,
      completeListing: exact && startPage === 1 && cycleComplete,
      jobs,
      ...(totalPages > 20 ? {
        pagination: {
          nextPage: cycleComplete ? 1 : endPage,
          cycleComplete,
          totalPages,
        },
      } : {}),
      error: jobs.length > 0 ? null : "Infosys careers contained no usable jobs.",
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
      error: error instanceof Error ? error.message : "Unknown Infosys crawler error.",
    };
  }
};

type HubSpotJob = {
  id?: number | string;
  title?: string;
  department?: { name?: string | null } | null;
  office?: { location?: string | null } | null;
  location?: { name?: string | null } | null;
};

const HUBSPOT_JOBS_QUERY = `query Jobs($departmentIds: [Int], $officeIds: [Int], $languages: [String], $roleTypes: [String], $searchQuery: String) {
  jobs(departmentIds: $departmentIds, officeIds: $officeIds, languages: $languages, roleTypes: $roleTypes, searchQuery: $searchQuery) {
    id title department { name } office { location } location { name }
  }
}`;

const crawlHubSpot = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  try {
    const response = await fetchWithTimeout(fetcher, "https://wtcfns.hubspot.com/careers/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        operationName: "Jobs",
        query: HUBSPOT_JOBS_QUERY,
        variables: { departmentIds: [], officeIds: [], languages: [], roleTypes: [], searchQuery: "" },
      }),
    }, false, { attempts: 2, timeoutMs: 15_000 });
    if (!response.ok) {
      return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: `HubSpot careers GraphQL returned HTTP ${response.status}.`,
      };
    }
    const payload = await response.json() as { data?: { jobs?: HubSpotJob[] }; errors?: unknown[] };
    const raw = payload.data?.jobs;
    if (!Array.isArray(raw) || raw.length === 0 || (payload.errors?.length ?? 0) > 0) {
      throw Object.assign(new Error("HubSpot careers GraphQL returned no authoritative job catalog."), { responseStatus: response.status });
    }
    const jobs = raw.flatMap((job): CrawledJob[] => {
      const id = job.id == null ? "" : String(job.id).trim();
      const title = job.title?.replace(/\s+/g, " ").trim() ?? "";
      if (!id || !title) return [];
      const location = job.location?.name?.trim() || job.office?.location?.trim() || null;
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId: id,
        title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        department: job.department?.name?.trim() || null,
        office: job.office?.location?.trim() || null,
        locationCountry: /\b(?:USA|United States)\b/i.test(location ?? "") ? "United States" : null,
        requisitionId: id,
        officialUrl: `https://www.hubspot.com/careers/jobs/${encodeURIComponent(id)}`,
        publishedAt: null,
      }];
    });
    const exact = jobs.length === raw.length && new Set(jobs.map((job) => job.externalId)).size === raw.length;
    if (!exact) throw Object.assign(new Error("HubSpot careers GraphQL contained malformed or duplicate job identities."), { responseStatus: response.status });
    return { status: "succeeded", responseStatus: response.status, completeListing: true, jobs, error: null };
  } catch (error) {
    const responseStatus = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : null;
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown HubSpot crawler error.",
    };
  }
};

type BrassRingQuestion = { QuestionName?: string; Value?: string | null };
type BrassRingJob = { Questions?: BrassRingQuestion[] };
type BrassRingPayload = {
  Jobs?: { Job?: BrassRingJob[] } | null;
  JobsCount?: number;
};
type BrassRingIdentity = { partnerId: string; siteId: string };

const brassRingBoardIdentity = (value: string): BrassRingIdentity | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "sjobs.brassring.com"
      || url.username || url.password || url.port
      || !/^\/tgnewui\/search\/home\/home\/?$/i.test(url.pathname)) return null;
    const parameters = new Map([...url.searchParams].map(([key, parameterValue]) => [key.toLocaleLowerCase(), parameterValue]));
    const partnerId = parameters.get("partnerid") ?? "";
    const siteId = parameters.get("siteid") ?? "";
    if (!/^\d{3,10}$/.test(partnerId) || !/^\d{3,10}$/.test(siteId)) return null;
    return { partnerId, siteId };
  } catch {
    return null;
  }
};

const responseCookies = (response: Response): string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) return cookies;
  const combined = response.headers.get("set-cookie");
  return combined ? combined.split(/,(?=[^;,]+=)/) : [];
};

const mergeCookies = (jar: Map<string, string>, response: Response): void => {
  for (const cookie of responseCookies(response)) {
    const pair = cookie.split(";", 1)[0]?.trim();
    const name = pair?.split("=", 1)[0]?.trim();
    if (pair && name) jar.set(name, pair);
  }
};

type SelectMindsPage = {
  currentPage: number;
  jobs: CrawledJob[];
  jobSearchId: string;
  total: number;
  totalPages: number;
};

const ENERGY_TRANSFER_SELECTMINDS_ORIGIN = "https://energytransfer.referrals.selectminds.com";
const ENERGY_TRANSFER_SELECTMINDS_LISTING = `${ENERGY_TRANSFER_SELECTMINDS_ORIGIN}/ETP/jobs/search`;

const selectMindsJobIdentity = (value: string): { id: string; url: string } | null => {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/ETP\/jobs\/([^/]+)-(\d+)\/?$/i);
    if (url.origin !== ENERGY_TRANSFER_SELECTMINDS_ORIGIN || url.username || url.password || url.port
      || url.search || url.hash || !match || !/^(?:[a-z0-9.-]|%[0-9a-f]{2})+$/i.test(match[1])) return null;
    url.pathname = url.pathname.replace(/\/$/, "");
    return { id: match[2], url: url.href };
  } catch {
    return null;
  }
};

const selectMindsElementNumber = (html: string, id: string): number | null => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = html.match(new RegExp(`<[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>\\s*([\\d,.]+)`, "i"))?.[1];
  if (!value) return null;
  const number = Number(value.replaceAll(",", ""));
  return Number.isInteger(number) && number >= 0 ? number : null;
};

const selectMindsJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] | null => {
  const starts = [...html.matchAll(
    /<div\b[^>]*\bid\s*=\s*["']job_list_(\d+)["'][^>]*\bclass\s*=\s*["'][^"']*\bjob_list_row\b[^"']*["'][^>]*>/gi,
  )];
  const jobs = starts.flatMap((match, index): CrawledJob[] => {
    const externalId = match[1];
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const anchor = anchorsFromHtml(block).flatMap(({ href, text }) => {
      try {
        const candidate = new URL(href, ENERGY_TRANSFER_SELECTMINDS_ORIGIN);
        const identity = selectMindsJobIdentity(candidate.href);
        const title = icimsText(text);
        return identity?.id === externalId && title ? [{ identity, title }] : [];
      } catch {
        return [];
      }
    })[0];
    if (!anchor) return [];
    const location = icimsText(block.match(
      /<span\b[^>]*class=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1]);
    const department = icimsText(block.match(
      /<span\b[^>]*class=["'][^"']*\bcategory\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1]);
    const summary = icimsText(block.match(
      /<p\b[^>]*class=["'][^"']*\bjlr_description\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )?.[1]);
    const locationParts = location?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
    const locationCountry = locationParts.length >= 2 ? locationParts.at(-1) ?? null : null;
    const locationState = locationParts.length >= 3 ? locationParts.at(-2) ?? null : null;
    const locationCity = locationParts.length >= 3 ? locationParts.slice(0, -2).join(", ") || null : null;
    const programs = classifyJobPrograms(anchor.title).keys;
    const arrangementText = [anchor.title, location, summary].filter(Boolean).join(" ");
    return [{
      externalId,
      title: anchor.title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(arrangementText)
        ? "remote"
        : /\bhybrid\b/i.test(arrangementText) ? "hybrid" : "unknown",
      employmentType: programs.includes("coop")
        ? "Co-op"
        : programs.includes("internship") ? "Internship" : null,
      summary,
      ...(department ? { department } : {}),
      ...(locationCity ? { locationCity } : {}),
      ...(locationState ? { locationState } : {}),
      ...(locationCountry ? { locationCountry } : {}),
      officialUrl: anchor.identity.url,
      publishedAt: null,
    }];
  });
  return jobs.length === starts.length ? jobs : null;
};

const selectMindsPageFromHtml = (html: string, source: CrawlSource): SelectMindsPage | null => {
  const jobSearchId = html.match(
    /<div\b(?=[^>]*class=["'][^"']*\bjResultsContent\b[^"']*["'])(?=[^>]*data-jsid=["'](\d+)["'])[^>]*>/i,
  )?.[1];
  const totalText = html.match(
    /<span\b[^>]*class=["'][^"']*\btotal_results\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>/i,
  )?.[1];
  const total = totalText ? Number(totalText.replaceAll(",", "")) : Number.NaN;
  const totalPages = selectMindsElementNumber(html, "jPaginateNumPages");
  const currentPage = selectMindsElementNumber(html, "jPaginateCurrPage");
  const jobs = selectMindsJobsFromHtml(html, source);
  if (!jobSearchId || !Number.isInteger(total) || total <= 0 || totalPages == null || totalPages < 1
    || currentPage == null || currentPage < 1 || !jobs) return null;
  const identities = jobs.map((job) => job.externalId);
  if (identities.some((identity) => !identity) || new Set(identities).size !== identities.length) return null;
  return { currentPage, jobs, jobSearchId, total, totalPages };
};

const selectMindsCookieHeader = (jar: Map<string, string>): string => [...jar.values()].join("; ");

const crawlEnergyTransferSelectMinds = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  let responseStatus: number | null = null;
  try {
    const jar = new Map<string, string>();
    const redirect = await fetchWithTimeout(fetcher, ENERGY_TRANSFER_SELECTMINDS_LISTING, {
      redirect: "manual",
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = redirect.status;
    if (![302, 303, 307, 308].includes(redirect.status)) {
      throw Object.assign(new Error(`Energy Transfer SelectMinds bootstrap returned HTTP ${redirect.status}.`), { responseStatus: redirect.status });
    }
    mergeCookies(jar, redirect);
    if (!jar.has("JSESSIONID") || !jar.has("ORA_OTSS_SESSION_ID")) {
      throw new Error("Energy Transfer SelectMinds bootstrap omitted its required session cookies.");
    }
    const location = redirect.headers.get("location");
    const sessionUrl = location ? new URL(location, ENERGY_TRANSFER_SELECTMINDS_LISTING) : null;
    const sessionId = sessionUrl?.pathname.match(/^\/ETP\/jobs\/search\/(\d+)$/)?.[1];
    if (!sessionUrl || sessionUrl.origin !== ENERGY_TRANSFER_SELECTMINDS_ORIGIN || sessionUrl.search || sessionUrl.hash || !sessionId) {
      throw new Error("Energy Transfer SelectMinds returned an invalid session listing URL.");
    }

    const listing = await fetchWithTimeout(fetcher, sessionUrl, {
      redirect: "manual",
      headers: { cookie: selectMindsCookieHeader(jar) },
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = listing.status;
    mergeCookies(jar, listing);
    if (!listing.ok) {
      throw Object.assign(new Error(`Energy Transfer SelectMinds listing returned HTTP ${listing.status}.`), { responseStatus: listing.status });
    }
    const html = await listing.text();
    const token = html.match(
      /<input\b(?=[^>]*\bid\s*=\s*["']tsstoken["'])(?=[^>]*\bvalue\s*=\s*["']([^"']{20,256})["'])[^>]*>/i,
    )?.[1];
    const first = selectMindsPageFromHtml(html, source);
    if (!token || !first || first.jobSearchId !== sessionId || first.currentPage !== 1) {
      throw new Error("Energy Transfer SelectMinds listing omitted a valid token, identity, or first page.");
    }
    const pageSize = first.jobs.length;
    if (pageSize < 1 || first.totalPages !== Math.ceil(first.total / pageSize)
      || pageSize !== Math.min(pageSize, first.total)) {
      throw new Error("Energy Transfer SelectMinds advertised inconsistent catalog totals.");
    }

    const maximumPages = 40;
    const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
    const startPage = requestedStart > first.totalPages ? 1 : requestedStart;
    const endPage = Math.min(first.totalPages, startPage + maximumPages - 1);
    const pages = new Map<number, SelectMindsPage>([[1, first]]);
    const pageNumbers = Array.from(
      { length: Math.max(0, endPage - startPage + 1) },
      (_, index) => startPage + index,
    ).filter((page) => page !== 1);

    const fetchPage = async (pageNumber: number): Promise<SelectMindsPage | null> => {
      try {
        const endpoint = new URL("/ajax/content/job_results", ENERGY_TRANSFER_SELECTMINDS_ORIGIN);
        endpoint.searchParams.set("JobSearch.id", first.jobSearchId);
        endpoint.searchParams.set("page_index", String(pageNumber));
        endpoint.searchParams.set("site-name", "ETP");
        endpoint.searchParams.set("include_site", "true");
        endpoint.searchParams.set("uid", String(Date.now() + pageNumber));
        const response = await fetchWithTimeout(fetcher, endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            cookie: selectMindsCookieHeader(jar),
            referer: sessionUrl.href,
            "tss-token": token,
            "x-requested-with": "XMLHttpRequest",
          },
        }, true, { attempts: 1, timeoutMs: 10_000 });
        responseStatus = response.status;
        if (!response.ok) return null;
        const payload = await response.json() as { Status?: unknown; Result?: unknown };
        if (payload.Status !== "OK" || typeof payload.Result !== "string") return null;
        const page = selectMindsPageFromHtml(payload.Result, source);
        const expected = Math.min(pageSize, Math.max(0, first.total - (pageNumber - 1) * pageSize));
        return page?.jobSearchId === first.jobSearchId && page.currentPage === pageNumber
          && page.total === first.total && page.totalPages === first.totalPages
          && page.jobs.length === expected ? page : null;
      } catch {
        return null;
      }
    };

    for (let index = 0; index < pageNumbers.length; index += 4) {
      const numbers = pageNumbers.slice(index, index + 4);
      const fetched = await Promise.all(numbers.map(fetchPage));
      fetched.forEach((page, pageIndex) => {
        if (page) pages.set(numbers[pageIndex], page);
      });
    }

    const jobs: CrawledJob[] = startPage > 1 ? [...first.jobs] : [];
    const seen = new Set(jobs.map((job) => job.externalId!));
    let firstFailedPage: number | null = null;
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = pages.get(pageNumber);
      const expected = Math.min(pageSize, Math.max(0, first.total - (pageNumber - 1) * pageSize));
      const identities = page?.jobs.map((job) => job.externalId ?? "") ?? [];
      if (!page || page.jobs.length !== expected || identities.some((identity) => !identity || seen.has(identity))) {
        firstFailedPage ??= pageNumber;
        continue;
      }
      identities.forEach((identity) => seen.add(identity));
      jobs.push(...page.jobs);
    }
    const normalized = uniqueJobs(jobs);
    const cycleComplete = firstFailedPage === null && endPage === first.totalPages;
    return {
      status: "succeeded",
      responseStatus: responseStatus ?? 200,
      completeListing: startPage === 1 && cycleComplete && normalized.length === first.total,
      jobs: normalized,
      ...(first.totalPages > maximumPages || source.crawlPageCursor != null || firstFailedPage != null ? {
        pagination: {
          nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
          cycleComplete,
          totalPages: first.totalPages,
        },
      } : {}),
      resolvedListingUrl: ENERGY_TRANSFER_SELECTMINDS_LISTING,
      error: firstFailedPage == null ? null : `Energy Transfer SelectMinds page ${firstFailedPage} was unavailable or inconsistent.`,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Energy Transfer SelectMinds crawler error.",
    };
  }
};

type DynatraceCoveoResult = {
  title?: unknown;
  uri?: unknown;
  raw?: {
    job_id?: unknown;
    team?: unknown;
    office_locations?: unknown;
    country?: unknown;
    seniority?: unknown;
    technologies?: unknown;
    flex_option?: unknown;
    capability?: unknown;
    employment_type?: unknown;
    region?: unknown;
  } | null;
};

type DynatraceCoveoPayload = {
  totalCount?: unknown;
  results?: unknown;
};

const dynatraceTextArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
  : [];

const crawlDynatraceCoveo = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://www.dynatrace.com/careers/jobs/?country=United%20States";
  const endpoint = "https://www.dynatrace.com/api/coveo/search/";
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        q: null,
        numberOfResults: 1_000,
        wildcards: true,
        fieldsToInclude: [
          "team", "office_locations", "country", "seniority", "technologies", "flex_option",
          "capability", "employment_type", "is_karriere_at", "job_id", "region",
        ],
        facets: [{
          field: "country",
          numberOfValues: 1_000,
          currentValues: [{ state: "selected", value: "United States" }],
        }],
      }),
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = response.status;
    if (!response.ok) {
      throw Object.assign(new Error(`Dynatrace Coveo search returned HTTP ${response.status}.`), { responseStatus: response.status });
    }
    const payload = await response.json() as DynatraceCoveoPayload;
    const total = Number(payload.totalCount);
    const results = Array.isArray(payload.results) ? payload.results as DynatraceCoveoResult[] : null;
    if (!Number.isSafeInteger(total) || total < 0 || !results || results.length > 1_000) {
      throw new Error("Dynatrace Coveo search returned invalid catalog metadata.");
    }
    const jobs = results.flatMap((result): CrawledJob[] => {
      const externalId = asText(result.raw?.job_id);
      const title = asText(result.title);
      const uri = asText(result.uri);
      if (!externalId || !title || !uri) return [];
      let officialUrl: URL;
      try {
        officialUrl = new URL(uri);
      } catch {
        return [];
      }
      if (officialUrl.origin !== "https://www.dynatrace.com" || officialUrl.username || officialUrl.password
        || officialUrl.port || officialUrl.search || officialUrl.hash
        || !/^\/careers\/jobs\/\d+\/$/.test(officialUrl.pathname)) return [];
      const offices = dynatraceTextArray(result.raw?.office_locations);
      const countries = dynatraceTextArray(result.raw?.country);
      if (countries.length !== 1 || countries[0] !== "United States") return [];
      const teams = dynatraceTextArray(result.raw?.team);
      const seniority = dynatraceTextArray(result.raw?.seniority);
      const technologies = dynatraceTextArray(result.raw?.technologies);
      const flexOptions = dynatraceTextArray(result.raw?.flex_option);
      const capabilities = dynatraceTextArray(result.raw?.capability);
      const employmentTypes = dynatraceTextArray(result.raw?.employment_type);
      const regions = dynatraceTextArray(result.raw?.region);
      const country = countries.length === 1 ? countries[0] : null;
      const location = [...offices, ...countries].filter((value, index, values) => values.indexOf(value) === index).join(", ") || null;
      const arrangementText = flexOptions.join(" ");
      const programs = classifyJobPrograms(title).keys;
      const employmentType = programs.includes("coop")
        ? "Co-op"
        : programs.includes("internship") ? "Internship" : employmentTypes.join(" / ") || null;
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(arrangementText)
          ? "remote"
          : /\bhybrid\b/i.test(arrangementText)
            ? "hybrid"
            : /\boffice(?: based)?\b/i.test(arrangementText) ? "onsite" : "unknown",
        employmentType,
        summary: null,
        ...(teams.length ? { department: teams.join("; ") } : {}),
        ...(capabilities.length ? { businessUnit: capabilities.join("; ") } : {}),
        ...(technologies.length ? { skills: technologies } : {}),
        ...(seniority.length ? { experienceLevel: seniority.join("; ") } : {}),
        ...(offices.length && !/^remote$/i.test(offices[0]) ? { locationCity: offices[0] } : {}),
        ...(country ? { locationCountry: country } : {}),
        ...(offices.length > 1 ? { secondaryLocations: offices.slice(1).map((office) => country ? `${office}, ${country}` : office) } : {}),
        requisitionId: externalId,
        rawPayload: { flexOptions, regions },
        officialUrl: officialUrl.href,
        publishedAt: null,
      }];
    });
    const externalIds = jobs.map((job) => job.externalId);
    const officialUrls = jobs.map((job) => job.officialUrl);
    if (jobs.length !== results.length || new Set(externalIds).size !== externalIds.length
      || new Set(officialUrls).size !== officialUrls.length) {
      throw new Error("Dynatrace Coveo search returned duplicate or unusable job identities.");
    }
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: results.length === total,
      jobs,
      resolvedListingUrl: listingUrl,
      error: results.length === total ? null : `Dynatrace Coveo search returned ${results.length} of ${total} jobs.`,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Dynatrace Coveo crawler error.",
    };
  }
};

type LegacySuccessFactorsIdentity = {
  companyCode: string;
  listingUrl: string;
  origin: string;
};

const legacySuccessFactorsIdentity = (value: string): LegacySuccessFactorsIdentity | null => {
  try {
    const url = new URL(value);
    const companyCode = url.searchParams.get("company") ?? url.searchParams.get("career_company") ?? "";
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !/^career\d+\.successfactors\.(?:com|eu)$/i.test(url.hostname)
      || url.pathname !== "/career" || !/^[a-z0-9_-]{2,80}$/i.test(companyCode)) return null;
    const listing = new URL("/career", url.origin);
    listing.searchParams.set("company", companyCode);
    return { companyCode, listingUrl: listing.href, origin: url.origin };
  } catch {
    return null;
  }
};

const dwrStringValue = (body: string, reference: string, property: string): string | null => {
  const match = body.match(new RegExp(`\\b${reference}\\.${property}="((?:\\\\.|[^"\\\\])*)";`));
  if (!match) return null;
  try {
    return decodeHtmlAttribute(JSON.parse(`"${match[1]}"`) as string);
  } catch {
    return null;
  }
};

const dwrNumberValue = (body: string, reference: string, property: string): number | null => {
  const value = body.match(new RegExp(`\\b${reference}\\.${property}=(-?\\d+);`))?.[1];
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const dwrReferenceValue = (body: string, reference: string, property: string): string | null =>
  body.match(new RegExp(`\\b${reference}\\.${property}=(s\\d+);`))?.[1] ?? null;

const dwrArrayReferences = (body: string, reference: string): Array<{ index: number; reference: string }> =>
  [...body.matchAll(new RegExp(`\\b${reference}\\[(\\d+)\\]=(s\\d+);`, "g"))]
    .map((match) => ({ index: Number(match[1]), reference: match[2] }))
    .sort((left, right) => left.index - right.index);

const parseLegacySuccessFactorsDwr = (
  body: string,
  source: CrawlSource,
  identity: LegacySuccessFactorsIdentity,
  expectedPage: number,
  expectedPageSize: number,
  defaultLocation?: string,
): { jobs: CrawledJob[]; total: number; valid: boolean } => {
  if (!/dwr\.engine\._remoteHandleCallback\('\d+','0',/.test(body)) return { jobs: [], total: 0, valid: false };
  const postingsReference = body.match(/\b(?:s\d+)\.postings=(s\d+);/)?.[1];
  const paginationReference = body.match(/\b(s\d+)\.currentPage=-?\d+;/)?.[1];
  if (!postingsReference || !paginationReference) return { jobs: [], total: 0, valid: false };
  const currentPage = dwrNumberValue(body, paginationReference, "currentPage");
  const pageSize = dwrNumberValue(body, paginationReference, "pageSize");
  const startRow = dwrNumberValue(body, paginationReference, "startRow");
  const endRow = dwrNumberValue(body, paginationReference, "endRow");
  const total = dwrNumberValue(body, paginationReference, "totalCount");
  if (currentPage !== expectedPage || pageSize !== expectedPageSize || total == null || total < 0) {
    return { jobs: [], total: total ?? 0, valid: false };
  }
  const expectedStart = total === 0 ? 0 : ((expectedPage - 1) * expectedPageSize) + 1;
  const expectedEnd = Math.min(expectedPage * expectedPageSize, total);
  const expectedCount = Math.max(0, expectedEnd - expectedStart + 1);
  if ((total === 0 ? startRow !== 0 && startRow !== 1 : startRow !== expectedStart) || endRow !== expectedEnd) {
    return { jobs: [], total, valid: false };
  }
  const jobReferences = dwrArrayReferences(body, postingsReference);
  if (jobReferences.length !== expectedCount
    || jobReferences.some((entry, index) => entry.index !== index)) return { jobs: [], total, valid: false };
  const jobs = jobReferences.flatMap(({ reference }): CrawledJob[] => {
    const id = dwrNumberValue(body, reference, "id");
    const title = dwrStringValue(body, reference, "title")?.trim() ?? "";
    const postingDate = dwrStringValue(body, reference, "postingDate");
    const publishedAt = normalizedDate(postingDate);
    if (id == null || id <= 0 || !title || !publishedAt) return [];
    const fields = new Map<string, string>();
    const valuesReference = dwrReferenceValue(body, reference, "otherValues");
    for (const group of valuesReference ? dwrArrayReferences(body, valuesReference) : []) {
      const leaves = dwrArrayReferences(body, group.reference);
      for (const leaf of leaves.length > 0 ? leaves : [group]) {
        const fieldId = dwrStringValue(body, leaf.reference, "fieldId");
        const value = dwrStringValue(body, leaf.reference, "shortVal");
        if (fieldId && value) fields.set(fieldId.toLocaleLowerCase(), value);
      }
    }
    const externalId = String(id);
    const detail = new URL("/career", identity.origin);
    detail.searchParams.set("career_ns", "job_listing");
    detail.searchParams.set("company", identity.companyCode);
    detail.searchParams.set("navBarLevel", "JOB_SEARCH");
    detail.searchParams.set("rcm_site_locale", "en_US");
    detail.searchParams.set("career_job_req_id", externalId);
    detail.searchParams.set("selected_lang", "en_US");
    const employmentType = fields.get("filter3") ?? null;
    const department = fields.get("filter2") ?? null;
    return [{
      externalId,
      title,
      company: source.company,
      location: defaultLocation ?? null,
      arrangement: /\bremote\b/i.test(`${title} ${defaultLocation ?? ""}`) ? "remote" : "unknown",
      employmentType,
      summary: [department, employmentType].filter(Boolean).join(" · ") || null,
      department,
      ...(defaultLocation === "United States" ? { locationCountry: "United States" } : {}),
      requisitionId: externalId,
      sourcePostedText: postingDate,
      officialUrl: detail.href,
      publishedAt,
    }];
  });
  return {
    jobs,
    total,
    valid: jobs.length === expectedCount
      && new Set(jobs.map((job) => job.externalId)).size === expectedCount
      && new Set(jobs.map((job) => job.officialUrl)).size === expectedCount,
  };
};

const legacySuccessFactorsDwrBody = (
  page: string,
  method: "getInitialJobSearchData" | "search",
  total = 0,
  currentPage = 1,
): string => {
  const common = [
    "callCount=1",
    `page=${page}`,
    "httpSessionId=",
    "scriptSessionId=0123456789ABCDEF0123456789ABCDEF000",
    "c0-scriptName=careerJobSearchControllerProxy",
    `c0-methodName=${method}`,
    "c0-id=0",
  ];
  if (method === "getInitialJobSearchData") {
    return [...common,
      "c0-e1=string:",
      "c0-e2=string:",
      "c0-e3=string:",
      "c0-e4=string:America%2FLos_Angeles",
      "c0-param0=Object_Object:{filterOnly:reference:c0-e1, jobAlertId:reference:c0-e2, returnToList:reference:c0-e3, browserTimeZone:reference:c0-e4}",
      "batchId=0",
      "",
    ].join("\n");
  }
  const previousStart = currentPage === 1 ? 1 : ((currentPage - 2) * 50) + 1;
  const previousEnd = currentPage === 1 ? Math.min(10, total) : Math.min((currentPage - 1) * 50, total);
  return [...common,
    `c0-e2=number:${currentPage}`,
    `c0-e3=number:${previousEnd}`,
    "c0-e4=boolean:false",
    "c0-e5=string:50",
    `c0-e6=number:${previousStart}`,
    `c0-e7=number:${total}`,
    "c0-e1=Object_Object:{currentPage:reference:c0-e2, endRow:reference:c0-e3, increaseCandSummaryPagination:reference:c0-e4, pageSize:reference:c0-e5, startRow:reference:c0-e6, totalCount:reference:c0-e7}",
    "c0-e8=string:JOB_POSTING_DATE",
    "c0-e9=string:DESC",
    "c0-param0=Object_Object:{pagination:reference:c0-e1, sortByColumn:reference:c0-e8, sortOrder:reference:c0-e9}",
    "batchId=1",
    "",
  ].join("\n");
};

const crawlLegacySuccessFactors = async (
  source: CrawlSource,
  boardUrl: string,
  fetcher: typeof fetch,
  defaultLocation?: string,
): Promise<SourceCrawlResult> => {
  const identity = legacySuccessFactorsIdentity(boardUrl);
  if (!identity) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Legacy SuccessFactors board identity was invalid." };
  let responseStatus: number | null = null;
  try {
    const cookies = new Map<string, string>();
    const landing = await fetchWithTimeout(fetcher, identity.listingUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = landing.status;
    if (!landing.ok) throw Object.assign(new Error(`Legacy SuccessFactors landing returned HTTP ${landing.status}.`), { responseStatus: landing.status });
    mergeCookies(cookies, landing);
    const landingHtml = await landing.text();
    const landingToken = landingHtml.match(/\bvar ajaxSecKey="([^"]{20,512})"/)?.[1];
    if (!landingToken || cookies.size === 0) throw new Error("Legacy SuccessFactors did not establish a usable session.");
    let decodedToken: string;
    try {
      decodedToken = decodeURIComponent(landingToken);
    } catch {
      throw new Error("Legacy SuccessFactors returned an invalid session token.");
    }
    const searchPage = new URL(identity.listingUrl);
    searchPage.searchParams.set("career_ns", "job_listing_summary");
    searchPage.searchParams.set("navBarLevel", "JOB_SEARCH");
    searchPage.searchParams.set("_s.crb", decodedToken);
    const listing = await fetchWithTimeout(fetcher, searchPage, {
      headers: { cookie: [...cookies.values()].join("; "), referer: identity.listingUrl },
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = listing.status;
    if (!listing.ok) throw Object.assign(new Error(`Legacy SuccessFactors search page returned HTTP ${listing.status}.`), { responseStatus: listing.status });
    mergeCookies(cookies, listing);
    const listingHtml = await listing.text();
    const ajaxToken = listingHtml.match(/\bvar ajaxSecKey="([^"]{20,512})"/)?.[1] ?? landingToken;
    const page = `${searchPage.pathname}${searchPage.search}`;
    const endpoint = new URL("/xi/ajax/remoting/call/plaincall/careerJobSearchControllerProxy.getInitialJobSearchData.dwr", identity.origin);
    const headers = () => ({
      accept: "text/javascript, */*;q=0.1",
      "content-type": "text/plain",
      cookie: [...cookies.values()].join("; "),
      referer: searchPage.href,
      viewid: "/ui/rcmcareer/pages/careersite/career.jsp.xhtml",
      "x-ajax-token": ajaxToken,
      "x-csrf-token": ajaxToken,
      "x-sap-page-info": `companyId=${identity.companyCode}`,
      "x-subaction": "0",
    });
    const initialResponse = await fetchWithTimeout(fetcher, endpoint, {
      method: "POST",
      headers: headers(),
      body: legacySuccessFactorsDwrBody(page, "getInitialJobSearchData"),
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = initialResponse.status;
    if (!initialResponse.ok) throw Object.assign(new Error(`Legacy SuccessFactors bootstrap returned HTTP ${initialResponse.status}.`), { responseStatus: initialResponse.status });
    mergeCookies(cookies, initialResponse);
    const initialBody = await initialResponse.text();
    const initialTotalMatch = initialBody.match(/\b(s\d+)\.currentPage=1;/)?.[1];
    const total = initialTotalMatch ? dwrNumberValue(initialBody, initialTotalMatch, "totalCount") : null;
    const initial = total == null ? null : parseLegacySuccessFactorsDwr(initialBody, source, identity, 1, 10, defaultLocation);
    if (total == null || total <= 0 || !initial?.valid || initial.total !== total) {
      throw new Error("Legacy SuccessFactors bootstrap contained no authoritative jobs.");
    }
    const totalPages = Math.ceil(total / 50);
    const currentPage = Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages);
    endpoint.pathname = "/xi/ajax/remoting/call/plaincall/careerJobSearchControllerProxy.search.dwr";
    const searchResponse = await fetchWithTimeout(fetcher, endpoint, {
      method: "POST",
      headers: headers(),
      body: legacySuccessFactorsDwrBody(page, "search", total, currentPage),
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = searchResponse.status;
    if (!searchResponse.ok) throw Object.assign(new Error(`Legacy SuccessFactors search returned HTTP ${searchResponse.status}.`), { responseStatus: searchResponse.status });
    const parsed = parseLegacySuccessFactorsDwr(await searchResponse.text(), source, identity, currentPage, 50, defaultLocation);
    if (!parsed.valid || parsed.total !== total || parsed.jobs.length !== Math.min(50, total - ((currentPage - 1) * 50))) {
      throw new Error(`Legacy SuccessFactors search returned a malformed or changing catalog page (${parsed.jobs.length}/${parsed.total}; expected ${Math.min(50, total - ((currentPage - 1) * 50))}/${total}).`);
    }
    return {
      status: "succeeded",
      responseStatus,
      completeListing: totalPages === 1 && parsed.jobs.length === total,
      jobs: parsed.jobs,
      resolvedListingUrl: identity.listingUrl,
      ...(totalPages > 1 ? { pagination: {
        nextPage: currentPage >= totalPages ? 1 : currentPage + 1,
        cycleComplete: currentPage >= totalPages,
        totalPages,
      } } : {}),
      error: null,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: Number.isFinite(status) ? status : null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown legacy SuccessFactors crawler error.",
    };
  }
};

const brassRingValue = (fields: Map<string, string>, key: string): string | null =>
  fields.get(key)?.replace(/\s+/g, " ").trim() || null;

const brassRingJobs = (
  payload: BrassRingPayload,
  source: CrawlSource,
  identity: BrassRingIdentity,
): CrawledJob[] => {
  const raw = payload.Jobs?.Job;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((job): CrawledJob[] => {
    const fields = new Map((job.Questions ?? []).flatMap((question) => {
      const key = question.QuestionName?.trim().toLowerCase();
      return key ? [[key, question.Value?.trim() ?? ""] as const] : [];
    }));
    const id = brassRingValue(fields, "reqid") ?? "";
    const title = brassRingValue(fields, "jobtitle") ?? "";
    if (!id || !title) return [];
    const payloadPartnerId = brassRingValue(fields, "clientid");
    const payloadSiteId = brassRingValue(fields, "siteid");
    if ((payloadPartnerId && payloadPartnerId !== identity.partnerId)
      || (payloadSiteId && payloadSiteId !== identity.siteId)) return [];
    const cityField = brassRingValue(fields, "formtext8");
    const stateField = brassRingValue(fields, "formtext9");
    const stateMatch = stateField?.match(/^([A-Z]{2})(?:\s*-\s*(.+))?$/);
    const stateCode = stateMatch?.[1] ?? null;
    const configuredLocation = brassRingValue(fields, "formtext5");
    const location = configuredLocation
      ?? ([cityField, stateCode ?? stateField].filter(Boolean).join(", ") || null);
    const configuredLocationMatch = configuredLocation?.match(/^(.+?),\s*.+?\(([A-Z]{2})\)$/);
    const simpleConfiguredLocation = configuredLocation?.match(/^(.+?),\s*([^,]+)$/);
    const locationCity = cityField
      ?? configuredLocationMatch?.[1]?.trim()
      ?? simpleConfiguredLocation?.[1]?.trim()
      ?? null;
    const locationState = stateCode
      ?? configuredLocationMatch?.[2]
      ?? simpleConfiguredLocation?.[2]?.trim()
      ?? null;
    const locationRegion = classifyJobRegion({ location, locationCity, locationState });
    const description = plainText(fields.get("jobdescription")) ?? null;
    const programs = classifyJobPrograms(title).keys;
    const detailUrl = new URL("/TGnewUI/Search/home/HomeWithPreLoad", "https://sjobs.brassring.com");
    detailUrl.searchParams.set("partnerid", identity.partnerId);
    detailUrl.searchParams.set("siteid", identity.siteId);
    detailUrl.searchParams.set("PageType", "JobDetails");
    detailUrl.searchParams.set("jobid", id);
    const latitude = Number.parseFloat(brassRingValue(fields, "latitude") ?? "");
    const longitude = Number.parseFloat(brassRingValue(fields, "longitude") ?? "");
    return [{
      externalId: id,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(`${title} ${location ?? ""}`) ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: description?.slice(0, 1_200) ?? null,
      description,
      department: brassRingValue(fields, "department"),
      businessUnit: brassRingValue(fields, "formtext6"),
      ...(locationCity ? { locationCity } : {}),
      ...(locationState ? { locationState } : {}),
      ...(locationRegion === "us" ? { locationCountry: "United States" } : {}),
      ...(Number.isFinite(latitude) && latitude !== 0 ? { latitude } : {}),
      ...(Number.isFinite(longitude) && longitude !== 0 ? { longitude } : {}),
      requisitionId: id,
      sourcePostedText: fields.get("lastupdated") || null,
      officialUrl: detailUrl.href,
      publishedAt: normalizedDate(fields.get("lastupdated")),
    }];
  });
};

const crawlBrassRing = async (
  source: CrawlSource,
  identity: BrassRingIdentity,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  let responseStatus: number | null = null;
  try {
    const listingUrl = new URL(source.postingUrl);
    const initial = await fetchWithTimeout(fetcher, listingUrl, {}, true, { attempts: 1, timeoutMs: 15_000 });
    responseStatus = initial.status;
    if (!initial.ok) throw Object.assign(new Error(`BrassRing careers returned HTTP ${initial.status}.`), { responseStatus: initial.status });
    const cookies = new Map<string, string>();
    mergeCookies(cookies, initial);
    const html = await initial.text();
    const token = decodeHtmlAttribute(html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i)?.[1] ?? "");
    const encryptedSessionValue = decodeHtmlAttribute(html.match(/id=["']CookieValue["'][^>]*value=["']([^"']+)/i)?.[1] ?? "");
    if (!token || !encryptedSessionValue || cookies.size === 0) throw new Error("BrassRing careers did not establish a crawl session.");
    const requestHeaders = () => ({
      "content-type": "application/json;charset=UTF-8",
      accept: "application/json, text/plain, */*",
      RFT: token,
      cookie: [...cookies.values()].join("; "),
      referer: listingUrl.href,
    });
    const firstResponse = await fetchWithTimeout(fetcher, new URL("/TgNewUI/Search/Ajax/CBMatchedJobs", listingUrl.origin), {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        PartnerId: identity.partnerId,
        SiteId: identity.siteId,
        ListKeyword: [],
        Location: "",
        UserGivenKeyWords: "",
        KeywordCustomSolrFields: "JobTitle,FORMTEXT4,FORMTEXT6,FORMTEXT7",
        LocationCustomSolrFields: "FORMTEXT5,FORMTEXT6",
        FacetFilterFields: null,
        TurnOffHttps: false,
        encryptedsessionvalue: encryptedSessionValue,
      }),
    }, true, { attempts: 1, timeoutMs: 15_000 });
    responseStatus = firstResponse.status;
    if (!firstResponse.ok) throw Object.assign(new Error(`BrassRing job API returned HTTP ${firstResponse.status}.`), { responseStatus: firstResponse.status });
    mergeCookies(cookies, firstResponse);
    const bootstrap = await firstResponse.json() as BrassRingPayload;
    const total = Number(bootstrap.JobsCount);
    const bootstrapJobs = brassRingJobs(bootstrap, source, identity);
    if (!Number.isInteger(total) || total <= 0 || bootstrapJobs.length !== Math.min(50, total)) {
      throw new Error("BrassRing job API returned no authoritative first page.");
    }
    const totalPages = Math.ceil(total / 50);
    const startPage = Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages);
    // CBMatchedJobs establishes the session but may use a different default sort.
    // Fetch every admitted page through one stable sort endpoint so identities do
    // not overlap merely because the bootstrap and page windows were ordered differently.
    const endPage = Math.min(startPage + 17, totalPages);
    const pages = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
    const payloads: Array<{ page: number; payload: BrassRingPayload; jobs: CrawledJob[] }> = [];
    for (const page of pages) {
      const response = await fetchWithTimeout(fetcher, new URL("/TgNewUI/Search/Ajax/ProcessSortAndShowMoreJobs", listingUrl.origin), {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({
          partnerId: Number(identity.partnerId),
          siteId: Number(identity.siteId),
          keyword: "",
          location: "",
          keywordCustomSolrFields: "JobTitle,FORMTEXT4,FORMTEXT6,FORMTEXT7",
          locationCustomSolrFields: "FORMTEXT5,FORMTEXT6",
          linkId: "",
          Latitude: 0,
          Longitude: 0,
          sortby: 1,
          facetfilterfields: { Facet: [] },
          powersearchoptions: { PowerSearchOption: [] },
          SortType: "JobTitle",
          pageNumber: page,
          encryptedSessionValue,
        }),
      }, true, { attempts: 1, timeoutMs: 15_000 });
      responseStatus = response.status;
      if (!response.ok) throw Object.assign(new Error(`BrassRing page ${page} returned HTTP ${response.status}.`), { responseStatus: response.status });
      mergeCookies(cookies, response);
      const payload = await response.json() as BrassRingPayload;
      payloads.push({ page, payload, jobs: brassRingJobs(payload, source, identity) });
    }
    const exact = payloads.every(({ page, payload, jobs }) => {
      const expected = Math.min(50, total - (page - 1) * 50);
      return payload.JobsCount === total && jobs.length === expected && new Set(jobs.map((job) => job.externalId)).size === jobs.length;
    });
    const jobs = uniqueJobs(payloads.flatMap((payload) => payload.jobs));
    const expectedUnique = payloads.reduce((sum, payload) => sum + payload.jobs.length, 0);
    const stable = exact && jobs.length === expectedUnique;
    const cycleComplete = stable && endPage === totalPages;
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus,
      completeListing: stable && startPage === 1 && cycleComplete,
      jobs,
      pagination: { nextPage: cycleComplete ? 1 : stable ? endPage : startPage, cycleComplete, totalPages },
      error: jobs.length > 0 ? null : "BrassRing careers contained no usable jobs.",
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: status != null && isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown BrassRing crawler error.",
    };
  }
};

const READER_JOB_DETAIL = /(?:\/jobs\/(?:r-)?\d{1,}(?:[-/]|$)|\/postings\/[^/?#]+-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/?(?:[?#]|$)|\/site\/careers\/jobs\/\d+|\/careers\/(?:job\/\d+|find-your-job\/[^/?#]+-j\d+|jobdetail(?:[/?]|$)|details\/|position\/)|\/[^/?#]+\/[^/?#]+\/[a-f0-9]{24,}\/job\/?(?:[?#]|$)|\/(?:default|[a-z]{2}(?:_[a-z]{2})?|[^/?#]+)\/job\/[^/?#]+\/\d+(?:-[^/?#]+)?(?:[/?#]|$)|[?&](?:jobid|job_id|gh_jid|reqid|pid|opportunityid)=)/i;

const markdownAnchors = (markdown: string, baseUrl: string): BrowserAnchor[] => [...markdown.matchAll(
  /\[([^\]]{2,240})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
)].flatMap((match) => {
  try {
    const url = new URL(match[2], baseUrl);
    const text = match[1].replaceAll(/[*_#`]/g, "").replace(/^!\[?/, "").replace(/\s+/g, " ").trim();
    return text.length >= 2 && text.length <= 180 ? [{ href: url.href, text }] : [];
  } catch {
    return [];
  }
});

const markdownJobAnchors = (markdown: string, source: CrawlSource): BrowserAnchor[] => {
  const sourceHost = new URL(source.postingUrl).hostname.replace(/^www\./, "");
  return markdownAnchors(markdown, source.postingUrl).flatMap(({ href, text }) => {
    const url = new URL(href);
    const targetHost = url.hostname.replace(/^www\./, "");
    if (!targetHost.endsWith(sourceHost) && !sourceHost.endsWith(targetHost)) return [];
    if (!READER_JOB_DETAIL.test(`${url.pathname}${url.search}`)) return [];
    return text.length >= 4 && text.length <= 180 ? [{ href: url.href, text }] : [];
  });
};

const markdownLocationForHref = (markdown: string, href: string): string | null => {
  const marker = `](${href}`;
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex < 0) return null;
  const linkEnd = markdown.indexOf(")", markerIndex + marker.length);
  if (linkEnd < 0) return null;
  const afterLink = markdown.slice(linkEnd + 1, linkEnd + 1_200);
  const inline = afterLink.match(/^\s+([^[]*?)(?:Ref\s*#|\s+\[Apply\b)/i)?.[1]
    ?.replace(/\s+/g, " ").trim().replace(/[.]$/, "");
  if (inline && inline.length >= 2 && !/^save saved$/i.test(inline)) return inline;
  for (const match of afterLink.matchAll(/(?:^|\n)\s*\*\s+([^\n]+)/g)) {
    const value = match[1].replace(/\[.*?\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    if (!value || /^(?:save saved|apply|share|job category|career area|technology|operations)$/i.test(value)) continue;
    return value;
  }
  return null;
};

const markdownJobs = (markdown: string, source: CrawlSource): CrawledJob[] => {
  const anchors = markdownJobAnchors(markdown, source);
  const sourceUrl = new URL(source.postingUrl);
  const avatureOrigin = isAvatureListing(source) ? sourceUrl.hostname.toLowerCase() : null;
  return jobsFromBrowserAnchors(anchors, source)
    // Reader mirrors expose navigation and recommendation links alongside
    // roles. An Avature listing is authoritative only for same-origin
    // /JobDetail/ URLs; reject foreign ATS links and portal controls before
    // they can be persisted as jobs under the company name.
    .filter((job) => {
      if (!avatureOrigin) return true;
      try {
        const official = new URL(job.officialUrl);
        return official.hostname.toLowerCase() === avatureOrigin
          && /\/careers\/JobDetail\//i.test(official.pathname);
      } catch {
        return false;
      }
    })
    .map((job) => {
    const location = markdownLocationForHref(markdown, job.officialUrl)
      ?? markdownLocationForHref(markdown, job.officialUrl.replace(/^https:/i, "http:"));
    const official = new URL(job.officialUrl);
    // Reader mirrors sometimes preserve the origin page's HTTP links even
    // when the official board is HTTPS. Keep one canonical URL so a recovery
    // pass updates the existing row instead of creating an HTTP duplicate.
    if (official.hostname.toLowerCase() === sourceUrl.hostname.toLowerCase() && sourceUrl.protocol === "https:") {
      official.protocol = "https:";
    }
    const normalized = { ...job, officialUrl: official.href };
    return location ? { ...normalized, location } : normalized;
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

const isAvatureListing = (source: CrawlSource): boolean => {
  try {
    const url = new URL(source.postingUrl);
    return url.hostname.toLocaleLowerCase().endsWith(".avature.net")
      && /\/careers\/searchjobs\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
};

const crawlAvatureReaderPages = async (
  source: CrawlSource,
  initialMarkdown: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!isAvatureListing(source)) return null;
  const canonical = new URL(source.postingUrl);
  canonical.hash = "";
  canonical.searchParams.set("jobOffset", "0");
  const sourceUrl = new URL(source.postingUrl);
  sourceUrl.hash = "";
  const baseHeaders = { accept: "text/plain" };
  const fetchPage = async (offset: number): Promise<{ markdown: string; jobs: CrawledJob[] } | null> => {
    try {
      const target = new URL(canonical);
      target.searchParams.set("jobOffset", String(offset));
      const useInitial = offset === 0 && (
        sourceUrl.href === target.href
        || (sourceUrl.pathname === target.pathname && !sourceUrl.searchParams.has("jobOffset"))
      );
      const markdown = useInitial
        ? initialMarkdown
        : await (async () => {
          const response = await fetchWithTimeout(
            fetcher,
            `https://r.jina.ai/${target.href}`,
            { headers: baseHeaders },
            false,
            { attempts: 1, timeoutMs: 12_000 },
          );
          if (!response.ok) return null;
          return response.text();
        })();
      if (!markdown) return null;
      const jobs = markdownJobs(markdown, { ...source, postingUrl: target.href });
      return jobs.length > 0 ? { markdown, jobs } : null;
    } catch {
      return null;
    }
  };

  const first = await fetchPage(0);
  if (!first) return null;
  const range = first.markdown.match(/\b(\d+)\s*-\s*(\d+)\s+of\s+(\d+)(?:\+)?\s+results\b/i);
  const firstNumber = Number(range?.[1] ?? 1);
  const lastNumber = Number(range?.[2] ?? first.jobs.length);
  const total = Number(range?.[3] ?? first.jobs.length);
  const pageSize = Math.max(1, lastNumber - firstNumber + 1);
  if (!Number.isFinite(total) || total < 1) return null;
  const boundedTotal = Math.min(total, 10_000);
  const totalPages = Math.max(1, Math.ceil(boundedTotal / pageSize));
  const requestedStartPage = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  const startPage = requestedStartPage <= totalPages ? requestedStartPage : 1;
  const maxPagesPerPass = 5;
  const endPage = Math.min(totalPages, startPage + maxPagesPerPass - 1);
  const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  const pages = new Map<number, { markdown: string; jobs: CrawledJob[] } | null>();
  if (startPage === 1) pages.set(1, first);
  for (let index = startPage === 1 ? 1 : 0; index < pageNumbers.length; index += 5) {
    const batch = pageNumbers.slice(index, index + 5);
    const fetched = await Promise.all(batch.map((page) => fetchPage((page - 1) * pageSize)));
    batch.forEach((page, offset) => pages.set(page, fetched[offset] ?? null));
  }
  let firstFailedPage: number | null = null;
  const successfulPages: Array<{ markdown: string; jobs: CrawledJob[] }> = [];
  for (const page of pageNumbers) {
    const value = pages.get(page) ?? null;
    if (!value) {
      firstFailedPage = page;
      break;
    }
    successfulPages.push(value);
  }
  const jobs = uniqueJobs(successfulPages.flatMap((page) => page.jobs));
  const cycleComplete = firstFailedPage === null && endPage === totalPages;
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: startPage === 1 && cycleComplete && jobs.length >= boundedTotal,
    jobs,
    resolvedListingUrl: canonical.href,
    ...(totalPages > 1 ? {
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
        cycleComplete,
        totalPages,
      },
    } : {}),
    error: null,
  };
};

const readerMarkdown = async (
  postingUrl: string,
  fetcher: typeof fetch,
  options: {
    querylessFallback?: boolean;
    richLinks?: boolean;
    nestedProxyFallback?: boolean;
    maxConcurrent?: number;
    timeoutMs?: number;
  } = {},
): Promise<string | null> => {
  const target = new URL(postingUrl);
  const targets = [target];
  if (options.querylessFallback && target.searchParams.has("jobOffset")) {
    const queryless = new URL(target);
    queryless.searchParams.delete("jobOffset");
    targets.push(queryless);
  }
  // Delta's Avature edge intermittently returns a 202/empty body for the
  // normal SearchJobs query route from a Worker, while the equivalent
  // keyword path remains readable. Keep both routes in the bounded reader
  // fan-out so a transient WAF decision does not turn into a source failure.
  if (options.querylessFallback
    && target.searchParams.has("search")
    && /\/SearchJobs\/?$/i.test(target.pathname)) {
    const keywordPath = new URL(target);
    keywordPath.pathname = keywordPath.pathname.replace(/SearchJobs\/?$/i, "SearchJobs/intern");
    keywordPath.searchParams.delete("search");
    targets.push(keywordPath);
    if (target.searchParams.has("jobOffset")) {
      const keywordPathQueryless = new URL(keywordPath);
      keywordPathQueryless.searchParams.delete("jobOffset");
      targets.push(keywordPathQueryless);
    }
  }
  const endpoints = [...new Set(targets.flatMap((value) => {
    const http = new URL(value);
    http.protocol = "http:";
    const direct = [`https://r.jina.ai/${value.href}`, `https://r.jina.ai/${http.href}`];
    if (!options.nestedProxyFallback) return direct;
    // Some WAFs reject requests made by Cloudflare Worker egress IPs while
    // accepting the same URL from the reader's own network. A single nested
    // reader hop keeps the request bounded and moves the origin fetch onto
    // that network without requiring browser credentials or a bypass.
    return [...direct, ...direct.map((endpoint) => `https://r.jina.ai/http://${endpoint.slice("https://".length)}`)];
  }))];
  const readEndpoint = async (endpoint: string): Promise<string | null> => {
    try {
      const response = await fetchWithTimeout(
        fetcher,
        endpoint,
        { headers: options.richLinks === false
          ? { accept: "text/plain", "user-agent": "Mozilla/5.0 (compatible; JobPulseCrawler/1.0)" }
          : {
            accept: "text/plain",
            "user-agent": "Mozilla/5.0 (compatible; JobPulseCrawler/1.0)",
            "x-retain-links": "all",
            "x-with-links-summary": "all",
          } },
        false,
        // Avature's WAF can make the reader take longer from a Worker than
        // from a desktop request. The caller can cap concurrency so a
        // fallback pass does not trip the reader's rate limiter.
        { attempts: 1, timeoutMs: options.timeoutMs ?? 20_000 },
      );
      if (!response.ok) return null;
      const text = await response.text();
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  };
  const maxConcurrent = Math.max(1, Math.min(endpoints.length, Math.trunc(options.maxConcurrent ?? endpoints.length)));
  for (let index = 0; index < endpoints.length; index += maxConcurrent) {
    const batch = await Promise.allSettled(endpoints.slice(index, index + maxConcurrent).map(readEndpoint));
    const result = batch.find((value): value is PromiseFulfilledResult<string> =>
      value.status === "fulfilled" && typeof value.value === "string" && value.value.length > 0,
    );
    if (result) return result.value;
  }
  return null;
};

const crawlDeltaAvature = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const listing = new URL(source.postingUrl);
  // Delta exposes a keyword route that puts the internship/co-op inventory
  // first. Keep this additive and paged: it recovers the target inventory
  // quickly without claiming the filtered route is the complete company
  // catalog (which would make unrelated roles eligible for closure).
  listing.searchParams.set("search", "intern");
  listing.searchParams.set("jobOffset", "0");
  const markdown = await readerMarkdown(listing.href, fetcher, {
    querylessFallback: true,
    richLinks: false,
    nestedProxyFallback: true,
    maxConcurrent: 2,
    timeoutMs: 12_000,
  });
  if (!markdown) return {
    status: "failed", responseStatus: null, completeListing: false, jobs: [],
    error: "Delta Avature reader listing was unavailable.",
  };
  const result = await crawlAvatureReaderPages({ ...source, postingUrl: listing.href }, markdown, fetcher);
  return result ?? {
    status: "failed", responseStatus: 200, completeListing: false, jobs: [],
    error: "Delta Avature reader listing contained no usable jobs.",
  };
};

const crawlWellsFargo = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const listing = new URL(source.postingUrl);
  // Wells' public search endpoint supports a keyword query even when its
  // server-rendered landing page is protected by Cloudflare. Restricting this
  // recovery feed to internship keeps it additive: it cannot close the rest of
  // the 1,800+ job catalog while still recovering the user's target inventory.
  listing.searchParams.set("search", "internship");
  const firstMarkdown = await readerMarkdown(listing.href, fetcher);
  if (!firstMarkdown) return {
    status: "failed", responseStatus: null, completeListing: false, jobs: [],
    error: "Wells Fargo reader listing was unavailable.",
  };
  const jobs = markdownJobs(firstMarkdown, { ...source, postingUrl: listing.href });
  if (jobs.length === 0) return {
    status: "failed", responseStatus: 200, completeListing: false, jobs: [],
    error: "Wells Fargo reader listing contained no internship jobs.",
  };
  return {
    status: "succeeded",
    responseStatus: 200,
    // This is a keyword slice, not the complete Wells Fargo catalog.
    completeListing: false,
    jobs: uniqueJobs(jobs),
    resolvedListingUrl: listing.href,
    error: null,
  };
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
      const icimsListing = icimsCatalogUrl(markdown);
      if (icimsListing) {
        const icims = await crawlIcims({
          ...source,
          postingUrl: icimsListing,
          adapter: "icims",
          discoveryDepth: 1,
        }, fetcher);
        if (icims.status === "succeeded") return {
          ...icims,
          resolvedListingUrl: icims.resolvedListingUrl ?? icimsListing,
        };
      }
      const discovered = discoverAts(markdown, source.postingUrl);
      if (discovered) {
        const result = discovered.kind === "workday"
          ? await crawlWorkday(source, discovered.endpoint, fetcher, now)
          : await crawlDiscoveredFeed(source, discovered, fetcher);
        if (result.status === "succeeded") return result;
      }
      const avature = await crawlAvatureReaderPages(source, markdown, fetcher);
      if (avature) return avature;
      const jobs = uniqueJobs([
        ...markdownJobs(markdown, source),
        ...markdownStaticJobs(markdown, source),
      ]);
      if (jobs.length > 0) return {
        status: "succeeded",
        responseStatus: 200,
        completeListing: false,
        jobs,
        error: null,
      };
      if ((source.discoveryDepth ?? 0) === 0) {
        const current = new URL(source.postingUrl);
        current.hash = "";
        const candidates = careerCandidates(markdownAnchors(markdown, source.postingUrl), source.postingUrl)
          .filter(({ href }) => isPublicAtsCatalogUrl(href) || (
            isSafeCareerRecommendation(source.company, source.postingUrl, href)
            && preservesTenantScope(source.postingUrl, href)
            && companyScopeMatches(source.company, source.postingUrl, href)
          ))
          .filter(({ href }) => {
            try {
              const candidate = new URL(href, source.postingUrl);
              candidate.hash = "";
              return candidate.href !== current.href;
            } catch {
              return false;
            }
          })
          .slice(0, 3);
        for (const candidate of candidates) {
          const candidateUrl = new URL(candidate.href, source.postingUrl);
          candidateUrl.hash = "";
          const candidateSource = {
            ...source,
            postingUrl: candidateUrl.href,
            adapter: detectUrlAdapter(candidateUrl.href),
            discoveryDepth: 1,
          };
          const candidateResult = await crawlSourceBase(candidateSource, fetcher, now);
          const renderedCandidate = candidateResult.status === "succeeded" && candidateResult.jobs.length > 0
            ? candidateResult
            : await crawlReaderFallback(candidateSource, fetcher, now);
          if (renderedCandidate?.status === "succeeded" && renderedCandidate.jobs.length > 0) return {
            ...renderedCandidate,
            completeListing: false,
            resolvedListingUrl: candidateUrl.href,
          };
        }
      }
      return null;
    };
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: baseHeaders }, false, { attempts: 1, timeoutMs: 12_000 });
    if (!response.ok) return null;
    let result = await resultFromMarkdown(await response.text());
    if (!result) {
      const freshResponse = await fetchWithTimeout(fetcher, endpoint, {
        headers: { ...baseHeaders, "x-no-cache": "true" },
      }, false, { attempts: 1, timeoutMs: 12_000 });
      if (!freshResponse.ok) return null;
      result = await resultFromMarkdown(await freshResponse.text());
    }
    return result;
  } catch {
    return null;
  }
};

const crawlNorthwesternMutual = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const pageUrl = new URL(source.postingUrl);
  pageUrl.search = "";
  pageUrl.hash = "";
  const fetchPage = async (page: number): Promise<{ markdown: string; jobs: CrawledJob[] } | null> => {
    const target = new URL(pageUrl);
    if (page > 1) target.searchParams.set("page", String(page));
    try {
      const response = await fetchWithTimeout(fetcher, `https://r.jina.ai/${target.href}`, {
        headers: { accept: "text/plain", "x-retain-links": "all" },
      }, false, { attempts: 2, timeoutMs: 30_000 });
      if (!response.ok) return null;
      const markdown = await response.text();
      const anchors = markdownAnchors(markdown, target.href).filter(({ href }) => {
        try {
          const url = new URL(href);
          return url.origin === pageUrl.origin && /\/corporate-careers\/jr-\d+\/[^/?#]+\/?$/i.test(url.pathname);
        } catch {
          return false;
        }
      });
      return { markdown, jobs: jobsFromBrowserAnchors(anchors, { ...source, postingUrl: target.href }) };
    } catch {
      return null;
    }
  };

  const first = await fetchPage(1);
  if (!first || first.jobs.length === 0) return null;
  const range = first.markdown.match(/Displaying\s+\*{0,2}\d+\*{0,2}\s+to\s+\*{0,2}([\d,]+)\*{0,2}\s+of\s+\*{0,2}([\d,]+)\*{0,2}\s+matching jobs/i);
  const pageSize = Number((range?.[1] ?? String(first.jobs.length)).replaceAll(",", ""));
  const total = Number((range?.[2] ?? String(first.jobs.length)).replaceAll(",", ""));
  const totalPages = Math.min(Math.max(1, Math.ceil(total / Math.max(pageSize, 1))), 100);
  const pages: Array<{ markdown: string; jobs: CrawledJob[] } | null> = [first];
  for (let page = 2; page <= totalPages; page += 4) {
    pages.push(...await Promise.all(Array.from(
      { length: Math.min(4, totalPages - page + 1) },
      (_, index) => fetchPage(page + index),
    )));
  }
  const jobs = uniqueJobs(pages.flatMap((page) => page?.jobs ?? []));
  return {
    status: "succeeded",
    responseStatus: 200,
    // The reader is a recovery surface, not an authoritative closure signal.
    completeListing: false,
    jobs,
    error: null,
  };
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
  const route = posting.pathname.match(/\/(search\/jobs|jobs\/search)\/?$/i)?.[1];
  if (!route) return null;
  const endpointFor = (page: number) => {
    const endpoint = new URL(`/${route}.json`, posting.origin);
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    return endpoint;
  };
  let directUnavailable = false;
  const fetchPage = async (page: number, allowReaderRetry = false): Promise<TalemetryPayload | null> => {
    const endpoint = endpointFor(page);
    if (!directUnavailable) {
      try {
        const direct = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, false, { attempts: 1, timeoutMs: 10_000 });
        if (direct.ok) {
          const parsed = parseTalemetryPayload(await direct.text());
          if (parsed) return parsed;
        }
        directUnavailable = true;
      } catch {
        directUnavailable = true;
      }
    }
    try {
      const reader = await fetchWithTimeout(fetcher, `https://r.jina.ai/${endpoint.href}`, {
        headers: { accept: "text/plain" },
      }, false, { attempts: allowReaderRetry ? 2 : 1, timeoutMs: 12_000 });
      return reader.ok ? parseTalemetryPayload(await reader.text()) : null;
    } catch {
      return null;
    }
  };

  const first = await fetchPage(1, true);
  if (!first) return null;
  const perPage = Math.max(1, first.per_page ?? first.entries?.length ?? 100);
  const totalEntries = Math.max(0, first.total_entries ?? first.entries?.length ?? 0);
  if (totalEntries <= 0) return null;
  const totalPages = Math.ceil(totalEntries / perPage);
  const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  const startPage = requestedStart <= totalPages ? requestedStart : 1;
  // The outer careers request, one direct capability probe and a possible
  // first-page reader retry leave room for 46 reader pages without crossing
  // the 50-request source ceiling. A resumed window also retries its first
  // target page so one cold/slow reader response cannot strand the cursor;
  // reserve both attempts and carry at most 44 target pages in that case.
  const maxTargetPages = startPage === 1 ? 46 : 44;
  const endPage = Math.min(totalPages, startPage + maxTargetPages - 1);
  const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
  const pages = new Map<number, TalemetryPayload | null>();
  if (startPage === 1) pages.set(1, first);
  else {
    const resumedFirst = await fetchPage(startPage, true);
    pages.set(startPage, resumedFirst);
    if (!resumedFirst) {
      return {
        status: "failed",
        responseStatus: 200,
        completeListing: false,
        jobs: [],
        pagination: { nextPage: startPage, cycleComplete: false, totalPages },
        error: "Talemetry returned no consecutive usable catalog pages.",
      };
    }
  }
  const pagesToFetch = pageNumbers.filter((page) => page !== 1 && page !== startPage);
  for (let index = 0; index < pagesToFetch.length; index += 4) {
    const batch = pagesToFetch.slice(index, index + 4);
    const fetched = await Promise.all(batch.map((page) => fetchPage(page)));
    batch.forEach((page, offset) => pages.set(page, fetched[offset] ?? null));
  }
  const jobsFromEntries = (entries: TalemetryEntry[]): CrawledJob[] => entries.flatMap((job): CrawledJob[] => {
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
  });
  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();
  let firstFailedPage: number | null = null;
  for (const pageNumber of pageNumbers) {
    const page = pages.get(pageNumber) ?? null;
    const entries = page?.entries ?? [];
    const expected = Math.min(perPage, totalEntries - (pageNumber - 1) * perPage);
    const normalized = jobsFromEntries(entries);
    const identities = normalized.map((job) => job.externalId ?? job.officialUrl);
    const valid = page
      && page.total_entries === totalEntries
      && (page.per_page ?? perPage) === perPage
      && entries.length === expected
      && normalized.length === expected
      && new Set(identities).size === expected
      && identities.every((identity) => !seen.has(identity));
    if (!valid) {
      firstFailedPage = pageNumber;
      break;
    }
    identities.forEach((identity) => seen.add(identity));
    jobs.push(...normalized);
  }
  const unique = uniqueJobs(jobs);
  const stable = firstFailedPage === null && unique.length === jobs.length;
  const cycleComplete = stable && endPage === totalPages;
  return {
    status: unique.length > 0 ? "succeeded" : "failed",
    responseStatus: 200,
    completeListing: startPage === 1 && cycleComplete,
    jobs: unique,
    ...(totalPages > 1 || source.crawlPageCursor != null ? {
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
        cycleComplete,
        totalPages,
      },
    } : {}),
    error: unique.length > 0 ? null : "Talemetry returned no consecutive usable catalog pages.",
  };
};

const dataAttribute = (html: string, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, "i"))?.[1] ?? null;
};

const embeddedRipplingJobs = (html: string, source: CrawlSource): { jobs: CrawledJob[]; completeListing: boolean } | null => {
  const linkedIds = [...html.matchAll(/href=["']https:\/\/ats\.rippling\.com\/[^"']+\/jobs\/([a-f\d-]{36})["']/gi)]
    .map((match) => match[1].toLocaleLowerCase());
  if (linkedIds.length === 0) return null;
  const rows = [...html.matchAll(
    /<span\b[^>]*class=["'][^"']*open-jobs_date[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["'][^"']*open-jobs_title[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["'][^"']*open-jobs_place[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]{0,2000}?href=["'](https:\/\/ats\.rippling\.com\/[^"']+\/jobs\/([a-f\d-]{36}))["']/gi,
  )];
  if (rows.length === 0) return null;
  const byId = new Map<string, CrawledJob>();
  for (const row of rows) {
    const externalId = row[5].toLocaleLowerCase();
    const title = plainText(row[2]);
    const location = plainText(row[3]);
    if (!title) continue;
    const existing = byId.get(externalId);
    if (existing) {
      if (location && location !== existing.location && !existing.secondaryLocations?.includes(location)) {
        existing.secondaryLocations = [...(existing.secondaryLocations ?? []), location];
      }
      continue;
    }
    const department = plainText(row[1]);
    byId.set(externalId, {
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: classifyJobPrograms(title).keys.length > 0 ? "Internship" : null,
      summary: null,
      ...(department ? { department } : {}),
      requisitionId: externalId,
      officialUrl: decodeHtmlAttribute(row[4]),
      publishedAt: null,
    });
  }
  const jobs = [...byId.values()];
  return jobs.length > 0 ? {
    jobs,
    completeListing: rows.length === linkedIds.length
      && new Set(rows.map((row) => row[5].toLocaleLowerCase())).size === jobs.length
      && linkedIds.every((id) => byId.has(id)),
  } : null;
};

type RipplingAlgoliaLocation = {
  country?: unknown;
  countryCode?: unknown;
  name?: unknown;
  workplaceType?: unknown;
};

type RipplingAlgoliaHit = {
  departmentName?: unknown;
  isRemote?: unknown;
  jobId?: unknown;
  locations?: unknown;
  name?: unknown;
  objectID?: unknown;
  url?: unknown;
};

type RipplingAlgoliaPayload = {
  hits?: unknown;
  hitsPerPage?: unknown;
  nbHits?: unknown;
  nbPages?: unknown;
  page?: unknown;
};

const RIPPLING_ALGOLIA_APPLICATION_ID = "6FNAX3TBEF";
// Algolia search-only keys are intentionally embedded in Rippling's public
// careers JavaScript. This key cannot mutate the index and is safe for a
// first-party read-only catalog request.
const RIPPLING_ALGOLIA_SEARCH_KEY = "416caa4690f002ff6fe4a2097623640b";
const RIPPLING_ALGOLIA_INDEX = "careers_en-US_production";
const RIPPLING_LISTING_URL = "https://www.rippling.com/careers/open-roles";

const crawlRippling = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = `https://${RIPPLING_ALGOLIA_APPLICATION_ID}-dsn.algolia.net/1/indexes/${encodeURIComponent(RIPPLING_ALGOLIA_INDEX)}/query`;
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-algolia-api-key": RIPPLING_ALGOLIA_SEARCH_KEY,
        "x-algolia-application-id": RIPPLING_ALGOLIA_APPLICATION_ID,
      },
      body: JSON.stringify({ query: "", hitsPerPage: 1_000, page: 0 }),
    }, false, { attempts: 1, timeoutMs: 12_000 });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Rippling careers search returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as RipplingAlgoliaPayload;
    const hits = Array.isArray(payload.hits) ? payload.hits as RipplingAlgoliaHit[] : null;
    const exactCatalog = hits
      && payload.page === 0
      && payload.hitsPerPage === 1_000
      && Number.isSafeInteger(payload.nbHits)
      && Number(payload.nbHits) > 0
      && payload.nbPages === 1
      && hits.length === Number(payload.nbHits);
    if (!exactCatalog) return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: "Rippling careers search did not return one exact, complete catalog page.",
    };

    const objectIds = new Set<string>();
    const byJobId = new Map<string, {
      department: string | null;
      isRemote: boolean;
      locations: Map<string, RipplingAlgoliaLocation>;
      officialUrl: string;
      title: string;
    }>();
    for (const hit of hits) {
      const externalId = asText(hit.jobId)?.toLocaleLowerCase() ?? null;
      const objectId = asText(hit.objectID);
      const title = asText(hit.name);
      const officialUrl = asText(hit.url);
      const locations = Array.isArray(hit.locations) ? hit.locations as RipplingAlgoliaLocation[] : null;
      if (!externalId || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(externalId)
        || !objectId || objectIds.has(objectId) || !title || !officialUrl || !locations?.length
        || locations.some((location) => !asText(location.name) || !asText(location.countryCode))) {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "Rippling careers search returned a duplicate or malformed listing identity.",
        };
      }
      objectIds.add(objectId);
      let url: URL;
      try {
        url = new URL(officialUrl);
      } catch {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "Rippling careers search returned an invalid official job URL.",
        };
      }
      if (url.protocol !== "https:" || url.hostname !== "ats.rippling.com" || url.port
        || url.username || url.password || url.search || url.hash
        || url.pathname !== `/rippling/jobs/${externalId}`) {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "Rippling careers search returned a job URL outside the exact official ATS identity.",
        };
      }
      const department = asText(hit.departmentName);
      const existing = byJobId.get(externalId);
      if (existing && (existing.title !== title || existing.department !== department || existing.officialUrl !== url.href)) {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "Rippling careers search returned conflicting rows for one job identity.",
        };
      }
      const record = existing ?? {
        department,
        isRemote: hit.isRemote === true,
        locations: new Map<string, RipplingAlgoliaLocation>(),
        officialUrl: url.href,
        title,
      };
      record.isRemote ||= hit.isRemote === true;
      for (const location of locations) {
        if (asText(location.countryCode)?.toLocaleUpperCase() !== "US") continue;
        const name = asText(location.name)!;
        record.locations.set(name, location);
      }
      byJobId.set(externalId, record);
    }

    const jobs = [...byJobId.entries()].flatMap(([externalId, record]): CrawledJob[] => {
      const locations = [...record.locations.entries()];
      if (locations.length === 0) return [];
      const workplaceTypes = locations.map(([, location]) => asText(location.workplaceType)?.toLocaleUpperCase());
      const arrangement: CrawledJob["arrangement"] = record.isRemote || workplaceTypes.every((value) => value === "REMOTE")
        ? "remote"
        : workplaceTypes.some((value) => value === "HYBRID")
          ? "hybrid"
          : workplaceTypes.some((value) => value === "ON_SITE" || value === "ONSITE")
            ? "onsite"
            : "unknown";
      const programs = classifyJobPrograms(record.title).keys;
      return [{
        externalId,
        title: record.title,
        company: source.company,
        location: locations[0][0],
        arrangement,
        employmentType: programs.includes("coop") ? "Co-op" : programs.includes("internship") ? "Internship" : null,
        summary: null,
        ...(record.department ? { department: record.department } : {}),
        ...(locations.length > 1 ? { secondaryLocations: locations.slice(1).map(([name]) => name) } : {}),
        locationCountry: "US",
        requisitionId: externalId,
        officialUrl: record.officialUrl,
        publishedAt: null,
      }];
    });
    return {
      status: "succeeded",
      responseStatus,
      completeListing: true,
      jobs,
      resolvedListingUrl: RIPPLING_LISTING_URL,
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Rippling crawler error.",
    };
  }
};

type HiBobJobAd = {
  benefits?: unknown;
  country?: unknown;
  department?: unknown;
  description?: unknown;
  employmentType?: unknown;
  id?: unknown;
  payTransparencyMaxSalary?: unknown;
  payTransparencyMinSalary?: unknown;
  payTransparencySalaryCurrency?: unknown;
  payTransparencySalaryPayPeriod?: unknown;
  publishedAt?: unknown;
  requirements?: unknown;
  responsibilities?: unknown;
  site?: unknown;
  title?: unknown;
  workspaceType?: unknown;
};

const crawlHiBobCareers = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listing = new URL(source.postingUrl);
  const tenant = listing.hostname.match(/^([a-z0-9-]+)\.careers\.hibob\.com$/i)?.[1];
  if (!tenant) return {
    status: "failed", responseStatus: null, completeListing: false, jobs: [],
    error: "HiBob career site tenant could not be resolved from the official hostname.",
  };
  const headers = { accept: "application/json", companyidentifier: tenant, referer: listing.href };
  let responseStatus: number | null = null;
  try {
    const [siteResponse, jobsResponse] = await Promise.all([
      fetchWithTimeout(fetcher, new URL("/api/career-site", listing.origin), { headers }, false, { attempts: 1, timeoutMs: 10_000 }),
      fetchWithTimeout(fetcher, new URL("/api/job-ad", listing.origin), { headers }, false, { attempts: 1, timeoutMs: 10_000 }),
    ]);
    responseStatus = jobsResponse.status;
    if (!siteResponse.ok || !jobsResponse.ok) {
      const status = !jobsResponse.ok ? jobsResponse.status : siteResponse.status;
      return {
        status: isBlockedHttpStatus(status) ? "blocked" : "failed",
        responseStatus: status,
        completeListing: false,
        jobs: [],
        error: `HiBob public career API returned HTTP ${status}.`,
      };
    }
    const site = await siteResponse.json() as { companyName?: unknown; isBobCareerSite?: unknown; isPublished?: unknown };
    const payload = await jobsResponse.json() as { jobAdDetails?: unknown };
    const raw = Array.isArray(payload.jobAdDetails) ? payload.jobAdDetails as HiBobJobAd[] : null;
    if (site.isBobCareerSite !== true || site.isPublished !== true || !asText(site.companyName) || !raw?.length) return {
      status: "failed", responseStatus, completeListing: false, jobs: [],
      error: "HiBob public career API returned an unpublished or malformed catalog.",
    };
    const ids = new Set<string>();
    const jobs: CrawledJob[] = [];
    for (const job of raw) {
      const externalId = asText(job.id)?.toLocaleLowerCase() ?? null;
      const title = asText(job.title);
      if (!externalId || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(externalId)
        || ids.has(externalId) || !title) {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "HiBob public career API returned a duplicate or malformed job identity.",
        };
      }
      ids.add(externalId);
      const description = icimsText(asText(job.description));
      const requirements = icimsText(asText(job.requirements));
      const responsibilities = icimsText(asText(job.responsibilities));
      const benefits = icimsText(asText(job.benefits));
      const workspaceType = asText(job.workspaceType);
      const arrangement: CrawledJob["arrangement"] = /remote/i.test(workspaceType ?? "")
        ? "remote"
        : /hybrid/i.test(workspaceType ?? "")
          ? "hybrid"
          : /on[ -]?site/i.test(workspaceType ?? "")
            ? "onsite"
            : "unknown";
      const programs = classifyJobPrograms(title).keys;
      const reportedEmploymentType = normalizeEmploymentType(job.employmentType) ?? asText(job.employmentType);
      const employmentType = programs.includes("coop")
        ? "Co-op"
        : programs.includes("internship")
          ? "Internship"
          : reportedEmploymentType;
      const minSalary = typeof job.payTransparencyMinSalary === "number" ? job.payTransparencyMinSalary : null;
      const maxSalary = typeof job.payTransparencyMaxSalary === "number" ? job.payTransparencyMaxSalary : null;
      jobs.push({
        externalId,
        title,
        company: source.company,
        location: asText(job.site),
        arrangement,
        employmentType,
        summary: description?.slice(0, 500) ?? null,
        ...(description ? { description } : {}),
        ...(responsibilities ? { responsibilities } : {}),
        ...(requirements ? { qualifications: requirements } : {}),
        ...(asText(job.department) ? { department: asText(job.department) } : {}),
        ...(asText(job.site) ? { office: asText(job.site) } : {}),
        ...(asText(job.country) ? { locationCountry: asText(job.country) } : {}),
        ...(minSalary != null ? { salaryMin: minSalary } : {}),
        ...(maxSalary != null ? { salaryMax: maxSalary } : {}),
        ...(asText(job.payTransparencySalaryCurrency) ? { salaryCurrency: asText(job.payTransparencySalaryCurrency) } : {}),
        ...(asText(job.payTransparencySalaryPayPeriod) ? { salaryInterval: asText(job.payTransparencySalaryPayPeriod) } : {}),
        ...(benefits ? { benefits } : {}),
        requisitionId: externalId,
        officialUrl: `${listing.origin}/jobs/${externalId}`,
        publishedAt: normalizedDate(job.publishedAt),
      });
    }
    return {
      status: "succeeded",
      responseStatus,
      completeListing: true,
      jobs,
      resolvedListingUrl: `${listing.origin}/jobs`,
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown HiBob careers crawler error.",
    };
  }
};

const selectOptionMap = (html: string, selectId: string): Map<string, string> => {
  const select = html.match(new RegExp(`<select\\b[^>]*id=["']${selectId}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"))?.[1] ?? "";
  return new Map([...select.matchAll(/<option\b[^>]*value=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => [match[1], icimsText(match[2]) ?? ""])
    .filter((entry): entry is [string, string] => Boolean(entry[1])));
};

const crawlJfrog = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl, undefined, true, { attempts: 1, timeoutMs: 12_000 });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `JFrog official positions page returned HTTP ${response.status}.`,
    };
    const html = await response.text();
    const offices = selectOptionMap(html, "location");
    const departments = selectOptionMap(html, "department");
    const cards = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bgreen-job-square\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
    if (cards.length === 0) return {
      status: "failed", responseStatus, completeListing: false, jobs: [],
      error: "JFrog official positions page contained no job cards.",
    };
    const ids = new Set<string>();
    const jobs: CrawledJob[] = [];
    for (const card of cards) {
      const attribute = (name: string): string | null => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return card[1].match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, "i"))?.[1] ?? null;
      };
      const externalId = attribute("data-greenhouse-id");
      const href = attribute("href");
      const titles = [...card[2].matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)]
        .map((match) => icimsText(match[1]))
        .filter((title): title is string => Boolean(title));
      const uniqueTitles = [...new Set(titles)];
      if (!externalId || !/^\d+$/.test(externalId) || ids.has(externalId) || !href || uniqueTitles.length !== 1) return {
        status: "failed", responseStatus, completeListing: false, jobs: [],
        error: "JFrog official positions page returned a duplicate or malformed job card.",
      };
      let officialUrl: URL;
      try {
        officialUrl = new URL(decodeHtmlAttribute(href));
      } catch {
        return {
          status: "failed", responseStatus, completeListing: false, jobs: [],
          error: "JFrog official positions page returned an invalid job URL.",
        };
      }
      if (officialUrl.origin !== "https://join.jfrog.com" || officialUrl.search || officialUrl.hash
        || !new RegExp(`^/job/${externalId}-[a-z0-9-]+/?$`, "i").test(officialUrl.pathname)) return {
        status: "failed", responseStatus, completeListing: false, jobs: [],
        error: "JFrog official positions page returned a URL outside the exact first-party job identity.",
      };
      const officeIds = (attribute("data-offices") ?? "").split(",").filter((id) => id && id !== "0");
      const departmentIds = (attribute("data-departments") ?? "").split(",").filter((id) => id && id !== "0");
      if (officeIds.some((id) => !offices.has(id)) || departmentIds.some((id) => !departments.has(id))) return {
        status: "failed", responseStatus, completeListing: false, jobs: [],
        error: "JFrog official positions page referenced an unknown location or department.",
      };
      ids.add(externalId);
      const locations = officeIds.map((id) => offices.get(id)!).filter(Boolean);
      const title = uniqueTitles[0];
      const programs = classifyJobPrograms(title).keys;
      jobs.push({
        externalId,
        title,
        company: source.company,
        location: locations[0] ?? null,
        arrangement: locations.some((location) => /\bremote\b/i.test(location)) ? "remote" : locations.length > 0 ? "onsite" : "unknown",
        employmentType: programs.includes("coop") ? "Co-op" : programs.includes("internship") ? "Internship" : null,
        summary: null,
        ...(departmentIds[0] ? { department: departments.get(departmentIds[0]) } : {}),
        ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
        ...(locations.length > 0 && locations.every((location) => /,\s*US$/i.test(location)) ? { locationCountry: "US" } : {}),
        requisitionId: externalId,
        officialUrl: officialUrl.href,
        publishedAt: null,
      });
    }
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length === cards.length,
      jobs,
      resolvedListingUrl: source.postingUrl,
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown JFrog crawler error.",
    };
  }
};

const embeddedWorkableCards = (html: string, source: CrawlSource): CrawledJob[] | null => {
  if (!/\bjob-info-wrapper\b/i.test(html) || !/https:\/\/apply\.workable\.com\/j\/[a-f\d]{10}/i.test(html)) return null;
  const field = (block: string, className: string): string | null => icimsText(
    block.match(new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1],
  );
  const jobs = [...html.matchAll(
    /<div\b[^>]*role=["']listitem["'][^>]*class=["'][^"']*\bw-dyn-item\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*role=["']listitem["'][^>]*class=["'][^"']*\bw-dyn-item\b|<div\b[^>]*id=["']no-results["']|$)/gi,
  )].flatMap((match): CrawledJob[] => {
    const block = match[1];
    const link = block.match(/<a\b[^>]*href=["'](https:\/\/apply\.workable\.com\/j\/([a-f\d]{10})\/?)["'][^>]*>/i);
    const title = field(block, "job-title");
    if (!link || !title) return [];
    const officialUrl = decodeHtmlAttribute(link[1]);
    const externalId = link[2].toLocaleUpperCase();
    const location = field(block, "job-location");
    const workplace = field(block, "workplace-type");
    const workType = field(block, "job-work-type");
    const department = field(block, "job-dept");
    const programs = classifyJobPrograms(`${title} ${workType ?? ""}`);
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /remote/i.test(workplace ?? "") ? "remote" : /hybrid/i.test(workplace ?? "") ? "hybrid" : /on.?site/i.test(workplace ?? "") ? "onsite" : "unknown",
      employmentType: programs.keys.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(workType) ?? workType,
      summary: null,
      ...(department ? { department } : {}),
      ...(location && /(?:United States|\bUS\b)/i.test(location) ? { locationCountry: "US" } : {}),
      requisitionId: externalId,
      officialUrl,
      publishedAt: null,
    }];
  });
  const unique = uniqueJobs(jobs);
  return unique.length > 0 ? unique : null;
};

type CornerstoneContext = {
  corp?: unknown;
  cultureID?: unknown;
  cultureName?: unknown;
  token?: unknown;
  endpoints?: { cloud?: unknown };
};

type CornerstoneRequisition = {
  requisitionId?: unknown;
  postingEffectiveDate?: unknown;
  postingExpirationDate?: unknown;
  displayJobTitle?: unknown;
  externalDescription?: unknown;
  employmentType?: unknown;
  jobCategory?: unknown;
  locations?: Array<{ city?: unknown; state?: unknown; country?: unknown }>;
};

type CornerstonePayload = {
  status?: unknown;
  data?: { totalCount?: unknown; requisitions?: CornerstoneRequisition[] };
};

const cornerstoneContext = (html: string): CornerstoneContext | null => {
  const raw = html.match(/csod\.context\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/i)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CornerstoneContext;
  } catch {
    return null;
  }
};

const crawlCornerstone = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const page = new URL(source.postingUrl);
  const siteId = page.pathname.match(/\/careersite\/(\d+)\//i)?.[1];
  const context = cornerstoneContext(html);
  const token = asText(context?.token);
  const corp = asText(context?.corp) ?? page.searchParams.get("c");
  const cloud = asText(context?.endpoints?.cloud);
  const cultureId = Number(context?.cultureID ?? 1);
  const cultureName = asText(context?.cultureName) ?? "en-US";
  if (!siteId || !token || !corp || !cloud || !Number.isInteger(cultureId)) return null;
  let endpoint: URL;
  try {
    endpoint = new URL("rec-job-search/external/jobs", cloud.endsWith("/") ? cloud : `${cloud}/`);
  } catch {
    return null;
  }
  const pageSize = 200;
  const maximumPages = 49;
  const fetchPage = async (pageNumber: number): Promise<CornerstonePayload | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "csod-accept-language": cultureName,
          referer: page.origin,
        },
        body: JSON.stringify({
          careerSiteId: Number(siteId),
          careerSitePageId: Number(siteId),
          pageNumber,
          pageSize,
          cultureId,
          searchText: "",
          cultureName,
          states: [],
          countryCodes: [],
          cities: [],
          placeID: "",
          radius: null,
          postingsWithinDays: null,
          customFieldCheckboxKeys: [],
          customFieldDropdowns: [],
          customFieldRadios: [],
        }),
      }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as CornerstonePayload;
      return payload.status === "Success" && Array.isArray(payload.data?.requisitions) ? payload : null;
    } catch {
      return null;
    }
  };
  const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  const first = await fetchPage(requestedStart);
  if (!first) return null;
  const total = Number(first.data?.totalCount);
  if (!Number.isInteger(total) || total < 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startPage = Math.min(requestedStart, totalPages);
  const endPage = Math.min(startPage + maximumPages - 1, totalPages);
  const pages = new Map<number, CornerstonePayload>([[startPage, first]]);
  const remaining = Array.from({ length: endPage - startPage }, (_, index) => startPage + index + 1);
  for (let index = 0; index < remaining.length; index += 8) {
    const results = await Promise.all(remaining.slice(index, index + 8).map(async (pageNumber) => ({ pageNumber, payload: await fetchPage(pageNumber) })));
    for (const { pageNumber, payload } of results) if (payload) pages.set(pageNumber, payload);
  }
  let firstFailedPage: number | null = null;
  const raw: CornerstoneRequisition[] = [];
  const seen = new Set<string>();
  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    const payload = pages.get(pageNumber);
    const rows = payload?.data?.requisitions ?? [];
    const expected = Math.min(pageSize, Math.max(0, total - (pageNumber - 1) * pageSize));
    const ids = rows.map((job) => job.requisitionId == null ? "" : String(job.requisitionId).trim());
    if (!payload || Number(payload.data?.totalCount) !== total || rows.length !== expected
      || ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.some((id) => seen.has(id))) {
      firstFailedPage ??= pageNumber;
      continue;
    }
    ids.forEach((id) => seen.add(id));
    raw.push(...rows);
  }
  const jobs = uniqueJobs(raw.flatMap((job): CrawledJob[] => {
    const externalId = job.requisitionId == null ? null : String(job.requisitionId).trim() || null;
    const title = asText(job.displayJobTitle);
    if (!externalId || !title) return [];
    const locations = job.locations ?? [];
    const locationText = (location: NonNullable<CornerstoneRequisition["locations"]>[number]) =>
      [asText(location.city), asText(location.state), asText(location.country)].filter(Boolean).join(", ") || null;
    const primary = locations[0];
    const description = plainText(asText(job.externalDescription));
    const officialUrl = new URL(`/ux/ats/careersite/${encodeURIComponent(siteId)}/home/requisition/${encodeURIComponent(externalId)}`, page.origin);
    officialUrl.searchParams.set("c", corp);
    return [{
      externalId,
      title,
      company: source.company,
      location: primary ? locationText(primary) : null,
      arrangement: /\bremote\b/i.test(locations.map((location) => locationText(location)).join(" ")) ? "remote" : "unknown",
      employmentType: classifyJobPrograms(title).keys.length > 0 ? "Internship" : normalizeEmploymentType(asText(job.employmentType)),
      summary: description,
      description,
      ...(asText(job.jobCategory) ? { department: asText(job.jobCategory) } : {}),
      ...(asText(primary?.city) ? { locationCity: asText(primary?.city) } : {}),
      ...(asText(primary?.state) ? { locationState: asText(primary?.state) } : {}),
      ...(asText(primary?.country) ? { locationCountry: asText(primary?.country) } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1).map(locationText).filter((value): value is string => Boolean(value)) } : {}),
      requisitionId: externalId,
      ...(normalizedUsDate(asText(job.postingExpirationDate)) ? { validThrough: normalizedUsDate(asText(job.postingExpirationDate)) } : {}),
      officialUrl: officialUrl.href,
      publishedAt: normalizedUsDate(asText(job.postingEffectiveDate)),
    }];
  }));
  const cycleComplete = firstFailedPage === null && endPage === totalPages;
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: startPage === 1 && cycleComplete && totalPages <= maximumPages && raw.length === total && jobs.length === total,
    jobs,
    ...(totalPages > maximumPages ? {
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? Math.max(startPage + 1, endPage),
        cycleComplete,
        totalPages,
      },
    } : {}),
    resolvedListingUrl: page.href,
    error: null,
  };
};

const radancyJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => {
  const listItemBlocks = [
    ...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi),
    // Some TalentBrew themes (including Barclays) render result cards as
    // sibling divs instead of list items. Stop at the next card rather than
    // the first nested closing div so location/date metadata stays attached.
    ...html.matchAll(/<div\b[^>]*class=["'][^"']*\blist-item\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\blist-item\b|<\/section>|$)/gi),
  ];
  const structured = listItemBlocks.flatMap((match): CrawledJob[] => {
    const block = match[0];
    const anchor = anchorsFromHtml(block).find(({ href, text }) =>
      /\/job\/(?:[^/?#]+\/)+\d+\/\d+\/?(?:[?#]|$)/i.test(href) && Boolean(text.trim()));
    const title = icimsText(block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]) ?? icimsText(anchor?.text);
    if (!anchor || !title) return [];
    const official = new URL(anchor.href, source.postingUrl);
    if (official.origin !== new URL(source.postingUrl).origin) return [];
    const externalId = block.match(/\bdata-job-id=["']([^"']+)["']/i)?.[1]
      ?? official.pathname.split("/").filter(Boolean).at(-1)
      ?? null;
    const requisitionId = icimsText(block.match(/<span\b[^>]*class=["'][^"']*\bjob-id\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const location = icimsText(block.match(
      /<(?:span|div|p)\b[^>]*class=["'][^"']*\b(?:search-results__job-location|job-location)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i,
    )?.[1]);
    const posted = icimsText(block.match(
      /<(?:span|div|p)\b[^>]*class=["'][^"']*\b(?:search-results__job-date-posted|job-date-posted|job-date)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i,
    )?.[1]);
    const locationParts = location?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const locationState = locationParts.length > 1 && /^[A-Z]{2}$/.test(locationParts.at(-1)!)
      ? locationParts.at(-1)!
      : null;
    const region = classifyJobRegion({ location, locationCity: locationParts[0], locationState });
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: null,
      ...(requisitionId ? { requisitionId } : {}),
      ...(locationParts.length > 1 ? { locationCity: locationParts[0] } : {}),
      ...(locationState ? { locationState } : {}),
      ...(region === "us" ? { locationCountry: "US" } : {}),
      ...(posted ? { sourcePostedText: posted } : {}),
      officialUrl: official.href,
      publishedAt: normalizedUsDate(posted),
    }];
  });
  if (structured.length === 0) return jobsFromBrowserAnchors(anchorsFromHtml(html), source);
  const richness = (job: CrawledJob): number => [
    job.location,
    job.locationCity,
    job.locationState,
    job.locationCountry,
    job.requisitionId,
    job.sourcePostedText,
    job.publishedAt,
  ].filter(Boolean).length;
  const preferred = new Map<string, CrawledJob>();
  for (const job of structured) {
    const previous = preferred.get(job.officialUrl);
    if (!previous || richness(job) > richness(previous)) preferred.set(job.officialUrl, job);
  }
  return [...preferred.values()];
};

const talentBrewSearchResultsUrl = (html: string, pageUrl: string): string | null => {
  // A generic TalentBrew asset is embedded by some non-Radancy career sites
  // (including marketing/video widgets). Only derive a catalog URL when the
  // landing page exposes the first-party job-search analytics/site identity.
  if (!/(?:jobs-search-analytics\.prod\.use1\.radancy\.net|\bdata-company-site-id\s*=)/i.test(html)) return null;
  try {
    const current = new URL(pageUrl);
    if (/\/search-jobs\/?$/i.test(current.pathname)) return null;
    const linked = anchorsFromHtml(html).flatMap(({ href }): URL[] => {
      try {
        const candidate = new URL(href, current);
        return candidate.origin === current.origin && /\/search-jobs\/?$/i.test(candidate.pathname)
          ? [candidate]
          : [];
      } catch {
        return [];
      }
    })[0];
    if (linked) {
      linked.search = "";
      linked.hash = "";
      return linked.href;
    }
    const locale = current.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1];
    const derived = new URL(locale ? `/${locale}/search-jobs` : "/search-jobs", current.origin);
    return derived.href;
  } catch {
    return null;
  }
};

const talentBrewResultsModuleName = (html: string): string => {
  const names = [...html.matchAll(/\bdata-search-results-module-name=["']([^"']+)["']/gi)]
    .map((match) => decodeHtmlAttribute(match[1]).trim())
    .filter(Boolean);
  return names.find((name) => /^search results$/i.test(name))
    ?? names.find((name) => !/\bheading\b/i.test(name))
    ?? "Search Results";
};

const crawlRadancyPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/tbcdn\.talentbrew\.com/i.test(html)) return null;
  const postPath = dataAttribute(html, "data-ajax-post-url");
  const advertisedTotalPages = Number(dataAttribute(html, "data-total-pages"));
  const totalResults = Number(dataAttribute(html, "data-total-job-results") ?? dataAttribute(html, "data-total-results"));
  const advertisedPageSize = Number(dataAttribute(html, "data-records-per-page"));
  if (!postPath || !Number.isInteger(advertisedTotalPages) || advertisedTotalPages < 1
    || !Number.isInteger(totalResults) || totalResults < 0
    || !Number.isInteger(advertisedPageSize) || advertisedPageSize < 1
    || advertisedTotalPages !== Math.max(1, Math.ceil(totalResults / advertisedPageSize))) return null;

  // UnitedHealth's public Radancy endpoint accepts a larger page size than
  // the 15-row browser UI. Use it to reduce 368 network pages to 56, but keep
  // every invocation bounded so upstream latency and D1 sync stay below the
  // Worker/request deadline. Other tenants retain their advertised page size.
  const pageSize = source.id === "p2-0064-unitedhealth-group"
    ? Math.max(advertisedPageSize, 100)
    : advertisedPageSize;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const maximumPages = 18;
  const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  const startPage = Math.min(requestedStart, totalPages);
  const endPage = Math.min(startPage + maximumPages - 1, totalPages);
  const canUseInitialPage = startPage === 1 && pageSize === advertisedPageSize;
  const searchResultsModuleName = talentBrewResultsModuleName(html);
  const pagesByNumber = new Map<number, CrawledJob[]>();
  const initialPageJobs = radancyJobsFromHtml(html, source);
  const initialPageIdentities = initialPageJobs.map((job) => job.externalId ?? job.officialUrl);
  const expectedInitialPageJobs = Math.min(advertisedPageSize, totalResults);
  const initialPageIsExact = initialPageJobs.length === expectedInitialPageJobs
    && initialPageIdentities.length === new Set(initialPageIdentities).size;
  if (canUseInitialPage) pagesByNumber.set(1, initialPageJobs);
  const firstFetchedPage = canUseInitialPage ? 2 : startPage;
  const pageNumbers = Array.from(
    { length: Math.max(0, endPage - firstFetchedPage + 1) },
    (_, index) => firstFetchedPage + index,
  );
  // TalentBrew throttles larger bursts with 429s. Three concurrent page
  // requests stays fast while avoiding the partial 12/18-page responses seen
  // with nine-way fan-out in production.
  for (let index = 0; index < pageNumbers.length; index += 3) {
    const pages = await Promise.all(pageNumbers.slice(index, index + 3).map(async (currentPage) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetchWithTimeout(fetcher, new URL(postPath, source.postingUrl), {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8", "x-requested-with": "XMLHttpRequest" },
            body: JSON.stringify({
              ActiveFacetID: Number(dataAttribute(html, "data-active-facet-id") ?? 0),
              CurrentPage: currentPage,
              RecordsPerPage: pageSize,
              TotalPages: totalPages,
              TotalResults: totalResults,
              Distance: Number(dataAttribute(html, "data-distance") ?? 0),
              Keywords: dataAttribute(html, "data-keywords") ?? "",
              Location: dataAttribute(html, "data-location") ?? "",
              ShowRadius: dataAttribute(html, "data-show-radius") === "True",
              IsPagination: "True",
              FacetFilters: [],
              StaticFacets: [],
              SearchResultsModuleName: searchResultsModuleName,
              SortCriteria: Number(dataAttribute(html, "data-sort-criteria") ?? 0),
              SortDirection: Number(dataAttribute(html, "data-sort-direction") ?? 0),
              SearchType: Number(dataAttribute(html, "data-search-type") ?? 0),
              RefinedKeywords: [],
              ResultsType: Number(dataAttribute(html, "data-results-type") ?? 0),
            }),
          });
          if (response.ok) {
            const payload = await response.json() as { results?: string };
            return typeof payload.results === "string" ? radancyJobsFromHtml(payload.results, source) : null;
          }
        } catch {
          // Retry transient page failures before keeping the listing incomplete.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      return null;
    }));
    pages.forEach((page, pageIndex) => {
      if (page) pagesByNumber.set(pageNumbers[index + pageIndex], page);
    });
  }
  // TalentBrew always returns its newest first page with the catalog shell.
  // Keep that free freshness window while continuing a later checkpoint so a
  // new page-one role is visible during the current two-hour pass instead of
  // waiting for the multi-pass cursor to wrap. The page is admitted only when
  // its advertised cardinality and identities are exact, and it never makes a
  // checkpoint segment eligible for authoritative closure.
  const jobs: CrawledJob[] = startPage > 1 && initialPageIsExact ? [...initialPageJobs] : [];
  const seen = new Set<string>();
  let firstFailedPage: number | null = null;
  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    const pageJobs = pagesByNumber.get(pageNumber);
    const expected = Math.min(pageSize, Math.max(0, totalResults - (pageNumber - 1) * pageSize));
    const identities = pageJobs?.map((job) => job.externalId ?? job.officialUrl) ?? [];
    if (!pageJobs || pageJobs.length !== expected || new Set(identities).size !== identities.length
      || identities.some((identity) => seen.has(identity))) {
      firstFailedPage ??= pageNumber;
      continue;
    }
    identities.forEach((identity) => seen.add(identity));
    jobs.push(...pageJobs);
  }
  const normalized = uniqueJobs(jobs);
  const cycleComplete = firstFailedPage === null && endPage === totalPages;
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: startPage === 1 && cycleComplete && normalized.length === totalResults,
    jobs: normalized,
    ...(totalPages > maximumPages || source.crawlPageCursor != null ? {
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
        cycleComplete,
        totalPages,
      },
    } : {}),
    error: null,
  };
};

type UkgLocation = {
  LocalizedName?: string | null;
  Address?: {
    City?: string | null;
    PostalCode?: string | null;
    State?: { Code?: string | null; Name?: string | null } | null;
    Country?: { Code?: string | null; Name?: string | null } | null;
  } | null;
};

type UkgOpportunity = {
  Id?: string | null;
  Title?: string | null;
  RequisitionNumber?: string | null;
  FullTime?: boolean | null;
  JobCategoryName?: string | null;
  Locations?: UkgLocation[] | null;
  PostedDate?: string | null;
  BriefDescription?: string | null;
  JobLocationType?: string | null;
};

type UkgSearchPayload = {
  opportunities?: UkgOpportunity[];
  totalCount?: number;
};

const ukgBoardConfig = (html: string, pageUrl: string): {
  loadUrl: string;
  detailUrl: string;
  pageSize: number;
} | null => {
  if (!/OpportunitiesViewModel|LoadSearchResults/i.test(html)) return null;
  const loadPath = html.match(/\bloadUrl\s*:\s*["']([^"']*LoadSearchResults[^"']*)["']/i)?.[1];
  const detailPath = html.match(/\bopportunityLinkUrl\s*:\s*["']([^"']*OpportunityDetail[^"']*)["']/i)?.[1];
  const pageSize = Number(html.match(/\bpageSize\s*:\s*(\d{1,3})/i)?.[1] ?? 50);
  if (!loadPath || !detailPath || !Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) return null;
  try {
    return {
      loadUrl: new URL(decodeHtmlAttribute(loadPath), pageUrl).href,
      detailUrl: new URL(decodeHtmlAttribute(detailPath), pageUrl).href,
      pageSize,
    };
  } catch {
    return null;
  }
};

const ukgLocationText = (location: UkgLocation | undefined): string | null => {
  if (!location) return null;
  const address = location.Address;
  const formatted = [
    asText(address?.City),
    asText(address?.State?.Code) ?? asText(address?.State?.Name),
    asText(address?.Country?.Code) ?? asText(address?.Country?.Name),
  ].filter(Boolean).join(", ");
  return formatted || asText(location.LocalizedName);
};

const crawlUkgPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const config = ukgBoardConfig(html, source.postingUrl);
  if (!config) return null;
  const fetchPage = async (skip: number): Promise<{ payload: UkgSearchPayload; rawValid: boolean } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, config.loadUrl, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "x-requested-with": "XMLHttpRequest" },
        body: JSON.stringify({
          opportunitySearch: {
            QueryString: "",
            Filters: [],
            Top: config.pageSize,
            Skip: skip,
            OrderBy: [{ Value: "postedDateDesc", PropertyName: "PostedDate", Ascending: false }],
          },
        }),
      }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as UkgSearchPayload;
      if (!Number.isFinite(payload.totalCount) || !Array.isArray(payload.opportunities)) return null;
      return {
        payload,
        rawValid: payload.opportunities.every((job) => Boolean(asText(job.Id) && asText(job.Title))),
      };
    } catch {
      return null;
    }
  };

  const first = await fetchPage(0);
  if (!first) return null;
  const total = Math.max(0, Math.trunc(first.payload.totalCount ?? 0));
  const totalPages = Math.max(1, Math.ceil(total / config.pageSize));
  const boundedPages = Math.min(totalPages, 48);
  const pages: Array<{ payload: UkgSearchPayload; rawValid: boolean } | null> = [first];
  for (let page = 1; page < boundedPages; page += 4) {
    pages.push(...await Promise.all(Array.from(
      { length: Math.min(4, boundedPages - page) },
      (_, index) => fetchPage((page + index) * config.pageSize),
    )));
  }
  const successful = pages.filter((page): page is { payload: UkgSearchPayload; rawValid: boolean } => page !== null);
  const raw = successful.flatMap((page) => page.payload.opportunities ?? []);
  const jobs = uniqueJobs(raw.flatMap((job): CrawledJob[] => {
    const externalId = asText(job.Id);
    const title = asText(job.Title);
    if (!externalId || !title) return [];
    const locations = job.Locations ?? [];
    const primary = locations[0];
    const officialUrl = new URL(config.detailUrl);
    officialUrl.searchParams.set("opportunityId", externalId);
    const arrangementText = asText(job.JobLocationType) ?? "";
    const summary = plainText(job.BriefDescription);
    return [{
      externalId,
      title,
      company: source.company,
      location: ukgLocationText(primary),
      arrangement: /hybrid/i.test(arrangementText) ? "hybrid" : /remote/i.test(arrangementText) ? "remote" : /on.?site/i.test(arrangementText) ? "onsite" : "unknown",
      employmentType: job.FullTime === true ? "Full-time" : job.FullTime === false ? "Part-time" : null,
      summary,
      ...(summary ? { description: summary } : {}),
      ...(asText(job.JobCategoryName) ? { department: asText(job.JobCategoryName) } : {}),
      ...(asText(job.RequisitionNumber) ? { requisitionId: asText(job.RequisitionNumber) } : {}),
      ...(asText(primary?.Address?.City) ? { locationCity: asText(primary?.Address?.City) } : {}),
      ...(asText(primary?.Address?.State?.Code) ?? asText(primary?.Address?.State?.Name) ? { locationState: asText(primary?.Address?.State?.Code) ?? asText(primary?.Address?.State?.Name) } : {}),
      ...(asText(primary?.Address?.Country?.Code) ?? asText(primary?.Address?.Country?.Name) ? { locationCountry: asText(primary?.Address?.Country?.Code) ?? asText(primary?.Address?.Country?.Name) } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1).map((location) => ukgLocationText(location)).filter((value): value is string => Boolean(value)) } : {}),
      officialUrl: officialUrl.href,
      publishedAt: normalizedDate(job.PostedDate),
    }];
  }));
  const rawIds = raw.map((job) => asText(job.Id)).filter((id): id is string => Boolean(id));
  const exactCatalog = successful.length === totalPages
    && successful.every((page) => page.rawValid && page.payload.totalCount === total)
    && new Set(rawIds).size === total
    && jobs.length === total;
  return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: totalPages <= 48 && exactCatalog,
    jobs,
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

const successFactorsListingUrl = (html: string, pageUrl: string): string | null => {
  if (!/(?:successfactors|\.sapsf\.(?:com|eu)\/)/i.test(html)) return null;
  const current = new URL(pageUrl);
  if (/\/search\/?$/i.test(current.pathname)) return null;
  const sameOrigin = anchorsFromHtml(html).flatMap(({ href }) => {
    try {
      const url = new URL(href, current);
      return url.origin === current.origin ? [url] : [];
    } catch {
      return [];
    }
  });
  const searchLink = sameOrigin.find((url) => /\/search(?:\/|$)/i.test(url.pathname));
  const goLink = sameOrigin.find((url) => /\/go\/[^/]+\/\d+\/?$/i.test(url.pathname));
  const target = new URL(current);
  if (searchLink) {
    target.pathname = `${searchLink.pathname.replace(/\/search(?:\/.*)?$/i, "/search/").replace(/\/{2,}/g, "/")}`;
  } else if (goLink) {
    target.pathname = `${goLink.pathname.replace(/\/go\/.*$/i, "")}/search/`.replace(/\/{2,}/g, "/");
  } else {
    const segments = current.pathname.split("/").filter(Boolean);
    target.pathname = segments.length === 1 ? `/${segments[0]}/search/` : "/search/";
  }
  target.search = "";
  target.searchParams.set("q", "");
  target.searchParams.set("locationsearch", "");
  target.searchParams.set("sortColumn", "referencedate");
  target.searchParams.set("sortDirection", "desc");
  target.hash = "";
  return target.href;
};

type SuccessFactorsUnifiedJob = {
  id?: unknown;
  unifiedStandardTitle?: unknown;
  unifiedUrlTitle?: unknown;
  urlTitle?: unknown;
  custprimecity?: unknown;
  custCountryRegion?: unknown;
  unifiedStandardStart?: unknown;
  jobFunction?: unknown;
  department?: unknown;
};

type SuccessFactorsUnifiedPayload = {
  jobSearchResult?: Array<{ response?: SuccessFactorsUnifiedJob }>;
  totalJobs?: unknown;
};

const successFactorsUnifiedJob = (
  source: CrawlSource,
  origin: string,
  locale: string,
  value: SuccessFactorsUnifiedJob,
): CrawledJob | null => {
  const externalId = value.id == null ? null : String(value.id).trim() || null;
  const title = plainText(asText(value.unifiedStandardTitle) ?? asText(value.urlTitle));
  if (!externalId || !title) return null;
  const city = asText(value.custprimecity);
  const countries = Array.isArray(value.custCountryRegion)
    ? value.custCountryRegion.flatMap((country) => asText(country) ?? [])
    : asText(value.custCountryRegion) ? [asText(value.custCountryRegion)!] : [];
  const location = [city, ...countries].filter(Boolean).join(", ") || null;
  const rawSlug = asText(value.unifiedUrlTitle) ?? asText(value.urlTitle) ?? title;
  const slug = decodeHtmlAttribute(rawSlug).replace(/[^A-Za-z0-9._~-]+/g, "-").replace(/^-|-$/g, "");
  const programs = classifyJobPrograms(title);
  return {
    externalId,
    title: decodeHtmlAttribute(title),
    company: source.company,
    location,
    arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
    employmentType: programs.keys.length > 0 ? "Internship" : null,
    summary: null,
    ...(asText(value.department) ?? asText(value.jobFunction) ? { department: asText(value.department) ?? asText(value.jobFunction) } : {}),
    ...(city ? { locationCity: city } : {}),
    ...(countries[0] ? { locationCountry: countries[0] } : {}),
    requisitionId: externalId,
    ...(asText(value.unifiedStandardStart) ? { sourcePostedText: asText(value.unifiedStandardStart) } : {}),
    officialUrl: new URL(`/job/${encodeURIComponent(slug)}/${encodeURIComponent(externalId)}-${encodeURIComponent(locale)}`, origin).href,
    publishedAt: null,
  };
};

const crawlSuccessFactorsUnified = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/SearchResultsUnify|rmk-jobs-search/i.test(html)) return null;
  const page = new URL(source.postingUrl);
  const locale = page.searchParams.get("locale") || "en_US";
  const endpoint = new URL("/services/recruiting/v1/jobs", page.origin);
  const maximumPages = 40;
  const fetchPage = async (pageNumber: number, sessionCookie?: string): Promise<{ payload: SuccessFactorsUnifiedPayload; jobs: CrawledJob[]; valid: boolean; sessionCookie?: string } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          referer: page.href,
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
        },
        body: JSON.stringify({
          locale,
          pageNumber: pageNumber - 1,
          // SAP's relevance order is not stable across requests and repeats
          // records between pages. Date order is deterministic enough for a
          // checkpointed catalog and is paired with a one-page overlap below.
          sortBy: "date",
          keywords: "",
          location: "",
          facetFilters: {},
          brand: "",
          skills: [],
          categoryId: 0,
          alertId: "",
          rcmCandidateId: "",
        }),
      }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as SuccessFactorsUnifiedPayload;
      const raw = payload.jobSearchResult;
      if (!Array.isArray(raw)) return null;
      const jobs = raw.flatMap(({ response: job }) => job ? successFactorsUnifiedJob(source, page.origin, locale, job) ?? [] : []);
      const responseCookie = response.headers.get("set-cookie")?.match(/^\s*([^;,]+=[^;,]+)/)?.[1];
      return { payload, jobs, valid: jobs.length === raw.length, ...(responseCookie ? { sessionCookie: responseCookie } : {}) };
    } catch {
      return null;
    }
  };

  const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
  // Bootstrap page 1 on every invocation. Besides giving us an invariant page
  // size, its JSESSIONID keeps the public API's ordering stable across all
  // subsequent page requests in this checkpoint segment.
  const first = await fetchPage(1);
  if (!first) return null;
  const total = Number(first.payload.totalJobs);
  if (!Number.isInteger(total) || total < 0) return null;
  if (total === 0) return {
    status: "succeeded",
    responseStatus: 200,
    completeListing: first.valid && first.jobs.length === 0,
    jobs: [],
    error: null,
  };
  const pageSize = first.payload.jobSearchResult?.length ?? 0;
  if (pageSize < 1 || !first.valid) return null;
  const totalPages = Math.ceil(total / pageSize);
  const startPage = Math.min(requestedStart, totalPages);
  const endPage = Math.min(startPage + maximumPages - 1, totalPages);
  const pages = new Map<number, typeof first>([[1, first]]);
  const remaining = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index)
    .filter((pageNumber) => pageNumber !== 1);
  for (let index = 0; index < remaining.length; index += 8) {
    const batch = remaining.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (pageNumber) => ({
      pageNumber,
      result: await fetchPage(pageNumber, first.sessionCookie),
    })));
    for (const { pageNumber, result } of results) if (result) pages.set(pageNumber, result);
  }
  let firstFailedPage: number | null = null;
  const jobs: CrawledJob[] = startPage === 1 ? [] : [...first.jobs];
  const seenIds = new Set(jobs.map((job) => job.externalId ?? job.officialUrl));
  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    const result = pages.get(pageNumber);
    const expected = Math.min(pageSize, total - (pageNumber - 1) * pageSize);
    const ids = result?.jobs.map((job) => job.externalId ?? job.officialUrl) ?? [];
    const uniqueProgress = ids.length === new Set(ids).size
      && (pageNumber === 1 || ids.some((id) => !seenIds.has(id)));
    if (!result || !result.valid || Number(result.payload.totalJobs) !== total || result.jobs.length !== expected || !uniqueProgress) {
      firstFailedPage ??= pageNumber;
      continue;
    }
    jobs.push(...result.jobs);
    ids.forEach((id) => seenIds.add(id));
  }
  const unique = uniqueJobs(jobs);
  const cycleComplete = firstFailedPage === null && endPage === totalPages;
  return {
    status: "succeeded",
    responseStatus: 200,
    // Paged closure uses two complete checkpoint cycles in CrawlStore. Do not
    // let a changing public catalog close unseen jobs in this request itself.
    completeListing: false,
    jobs: unique,
    pagination: {
      nextPage: cycleComplete ? 1 : firstFailedPage ?? Math.max(startPage + 1, endPage),
      cycleComplete,
      totalPages,
    },
    resolvedListingUrl: new URL(`/search/?locale=${encodeURIComponent(locale)}`, page.origin).href,
    error: null,
  };
};

const successFactorsJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bdata-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length === 0) return jobsFromBrowserAnchors(anchorsFromHtml(html), source);
  return uniqueJobs(rows.flatMap((match): CrawledJob[] => {
    const body = match[1] ?? "";
    const anchor = anchorsFromHtml(body).find(({ href, text }) => text && /\/job\/[^?#]+\/\d+\/?(?:[?#]|$)/i.test(href));
    if (!anchor) return [];
    let officialUrl: URL;
    try {
      officialUrl = new URL(anchor.href, source.postingUrl);
    } catch {
      return [];
    }
    if (officialUrl.origin !== new URL(source.postingUrl).origin) return [];
    const externalId = officialUrl.pathname.split("/").filter(Boolean).at(-1) ?? null;
    if (!externalId || !/^\d+$/.test(externalId)) return [];
    const field = (className: string): string | null => {
      const value = plainText(body.match(new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:span|div|td)>`, "i"))?.[1]);
      return value ? decodeHtmlAttribute(value) : null;
    };
    const title = decodeHtmlAttribute(anchor.text).replace(/\s+/g, " ").trim();
    const location = field("jobLocation");
    const department = field("jobDepartment") ?? field("jobFacility");
    const shiftSchedule = field("jobShifttype");
    const locationParts = location?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const usLocation = /^(?:US|USA|United States)$/i.test(locationParts.at(-1) ?? "");
    const programs = classifyJobPrograms(title).keys;
    const arrangement = /\bremote\b/i.test(`${location ?? ""} ${shiftSchedule ?? ""}`)
      ? "remote"
      : /\bhybrid\b/i.test(shiftSchedule ?? "")
        ? "hybrid"
        : /\b(?:onsite|on-site|in office)\b/i.test(shiftSchedule ?? "")
          ? "onsite"
          : "unknown";
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement,
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: [department, shiftSchedule].filter(Boolean).join(" · ") || null,
      department,
      ...(shiftSchedule ? { shiftSchedule } : {}),
      ...(locationParts.length >= 2 ? { locationCity: locationParts[0] } : {}),
      ...(usLocation && locationParts.length >= 3 ? { locationState: locationParts.at(-2) } : {}),
      ...(usLocation ? { locationCountry: "United States" } : {}),
      requisitionId: externalId,
      officialUrl: officialUrl.href,
      publishedAt: null,
    }];
  }));
};

const crawlSuccessFactorsPages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/(?:successfactors|\.sapsf\.(?:com|eu)\/)/i.test(html)) return null;
  const range = successFactorsRange(html);
  if (!range) return null;
  const paginationHref = anchorsFromHtml(html).find(({ href }) => /[?&]startrow=\d+/i.test(href))?.href;
  const jobs = successFactorsJobsFromHtml(html, source);
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
        return successFactorsJobsFromHtml(await response.text(), source);
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

const avatureJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => {
  const sourceOrigin = new URL(source.postingUrl).origin;
  const jobFromAnchor = (href: string, titleText: string, block = ""): CrawledJob[] => {
    let officialUrl: URL;
    try {
      officialUrl = new URL(href, source.postingUrl);
      if (officialUrl.origin !== sourceOrigin || !/\/JobDetail\//i.test(officialUrl.pathname)) return [];
    } catch {
      return [];
    }
    const externalId = officialUrl.pathname.split("/").filter(Boolean).at(-1) ?? null;
    const title = icimsText(titleText);
    if (!externalId || !title || /^(?:apply|more information|learn more|view details?)$/i.test(title)) return [];
    const field = (className: string): string | null => icimsText(block.match(new RegExp(
      `<span\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i",
    ))?.[1]);
    const location = field("list-item-location");
    const requisitionId = field("list-item-(?:ref|id)")?.replace(/^(?:job|role)\s+id\s*:?\s*/i, "") ?? externalId;
    const posted = field("list-item-posted");
    const workerType = field("list-item-workerType");
    const department = field("list-item-department");
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(workerType),
      summary: null,
      ...(department ? { department } : {}),
      requisitionId,
      ...(posted ? { sourcePostedText: posted } : {}),
      officialUrl: officialUrl.href,
      publishedAt: normalizedDate(posted),
    }];
  };

  const cards = [...html.matchAll(
    /<article\b[^>]*class=["'][^"']*\barticle--result\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi,
  )].flatMap((match): CrawledJob[] => {
    const block = match[0];
    const titleBlock = block.match(/<h3\b[^>]*class=["'][^"']*\barticle__header__text__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const anchor = titleBlock ? anchorsFromHtml(titleBlock).find(({ href }) => /\/JobDetail\//i.test(href)) : null;
    return anchor ? jobFromAnchor(anchor.href, anchor.text, block) : [];
  });
  if (cards.length > 0) return uniqueJobs(cards);

  // Older tenants and tests expose a flat anchor list. Keep that compatible,
  // but ignore duplicate call-to-action anchors so the button label can never
  // overwrite the actual job title for the same official URL.
  return uniqueJobs(anchorsFromHtml(html).flatMap(({ href, text }) => jobFromAnchor(href, text)));
};

const crawlAvaturePages = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/avature\.portal\.page["']?\s+content=["']Search(?:Career|Jobs)/i.test(html)) return null;
  const text = plainText(html) ?? "";
  const range = text.match(/\b[\d,]+\s*-\s*([\d,]+)\s+of\s+([\d,]+)(\+)?\s+results\b/i);
  if (!range) return null;
  const pageSize = Number(range[1].replaceAll(",", ""));
  const total = Number(range[2].replaceAll(",", ""));
  const openEndedTotal = range[3] === "+";
  if (!Number.isFinite(pageSize) || pageSize < 1 || !Number.isFinite(total)) return null;

  const jobsOnPage = (pageHtml: string) => avatureJobsFromHtml(pageHtml, source);
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

  const totalPages = Math.ceil(total / pageSize);
  const maximumPages = 40;
  if (!openEndedTotal && (totalPages > maximumPages || source.crawlPageCursor != null)) {
    const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
    const startPage = requestedStart <= totalPages ? requestedStart : 1;
    const endPage = Math.min(totalPages, startPage + maximumPages - 1);
    const pages = new Map<number, CrawledJob[]>([[1, jobs]]);
    const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index)
      .filter((pageNumber) => pageNumber !== 1);
    for (let index = 0; index < pageNumbers.length; index += 8) {
      const batch = pageNumbers.slice(index, index + 8);
      const fetched = await Promise.all(batch.map(async (pageNumber) => {
        try {
          const url = new URL(paginationHref, source.postingUrl);
          url.searchParams.set("jobRecordsPerPage", String(pageSize));
          url.searchParams.set("jobOffset", String((pageNumber - 1) * pageSize));
          const response = await fetchWithTimeout(fetcher, url, undefined, true, { attempts: 1, timeoutMs: 10_000 });
          if (!response.ok) return null;
          const pageHtml = await response.text();
          const pageRange = (plainText(pageHtml) ?? "").match(/\b[\d,]+\s*-\s*[\d,]+\s+of\s+([\d,]+)\s+results\b/i);
          if (Number(pageRange?.[1]?.replaceAll(",", "")) !== total) return null;
          return jobsOnPage(pageHtml);
        } catch {
          return null;
        }
      }));
      batch.forEach((pageNumber, offset) => {
        const pageJobs = fetched[offset];
        if (pageJobs) pages.set(pageNumber, pageJobs);
      });
    }
    let firstFailedPage: number | null = null;
    const segmentJobs: CrawledJob[] = startPage === 1 ? [] : [...jobs];
    const seen = new Set(segmentJobs.map((job) => job.externalId ?? job.officialUrl));
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const pageJobs = pages.get(pageNumber);
      const expected = Math.min(pageSize, total - (pageNumber - 1) * pageSize);
      const ids = pageJobs?.map((job) => job.externalId ?? job.officialUrl) ?? [];
      const progresses = ids.length === new Set(ids).size
        && (pageNumber === 1 || ids.some((id) => !seen.has(id)));
      if (!pageJobs || pageJobs.length !== expected || !progresses) {
        firstFailedPage ??= pageNumber;
        continue;
      }
      segmentJobs.push(...pageJobs);
      ids.forEach((id) => seen.add(id));
    }
    const cycleComplete = firstFailedPage === null && endPage === totalPages;
    return {
      status: "succeeded",
      responseStatus: 200,
      // Large Avature catalogs close only after CrawlStore observes two full
      // checkpoint cycles; a single segment is never authoritative.
      completeListing: false,
      jobs: uniqueJobs(segmentJobs),
      pagination: {
        nextPage: cycleComplete ? 1 : firstFailedPage ?? endPage + 1,
        cycleComplete,
        totalPages,
      },
      error: null,
    };
  }

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
  const dateOnly = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date.toISOString()
      : null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const hologicTotal = (html: string): number | null => {
  const value = html.match(/<h2[^>]*>\s*([\d,]+)\s+Jobs?\s+found\s*<\/h2>/i)?.[1];
  if (!value) return null;
  const total = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
};

const hologicJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => [...html.matchAll(
  /<div\b[^>]*class=["'][^"']*\bresult-list-box\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bresult-list-box\b|<div><ul\b[^>]*class=["'][^"']*\bpagination\b|<\/div>\s*<\/div>\s*<script|$)/gi,
)].flatMap((match): CrawledJob[] => {
  const block = match[1];
  const detail = block.match(/<a\b[^>]*class=["'][^"']*\blnkJobDetails\b[^"']*["'][^>]*href=["']([^"']+)["']/i);
  const title = icimsText(block.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1]);
  if (!detail || !title) return [];
  let officialUrl: URL;
  try {
    officialUrl = new URL(decodeHtmlAttribute(detail[1]), source.postingUrl);
  } catch {
    return [];
  }
  const identity = officialUrl.pathname.match(/\/search\/(\d+)\//i)?.[1];
  if (!identity || officialUrl.origin !== "https://careers.hologic.com") return [];
  const locationBlock = block.match(/<div\b[^>]*class=["'][^"']*\bbasicinfo\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const locations = [...locationBlock.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((entry) => icimsText(entry[1]))
    .filter((value): value is string => Boolean(value));
  const location = locations.join("; ") || null;
  const summary = icimsText(block
    .replace(/<h4\b[^>]*>[\s\S]*?<\/h4>/i, " ")
    .replace(/<div\b[^>]*class=["'][^"']*\bbasicinfo\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i, " ")
    .replace(/<a\b[^>]*class=["'][^"']*\blnkJobDetails\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i, " "));
  const programs = classifyJobPrograms(title);
  return [{
    externalId: identity,
    title,
    company: source.company,
    location,
    arrangement: /remote/i.test(location ?? "") ? "remote" : "unknown",
    employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
    summary,
    ...(location && /United States/i.test(location) ? { locationCountry: "US" } : {}),
    officialUrl: officialUrl.href,
    publishedAt: null,
  }];
});

const crawlHologic = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://careers.hologic.com/en/search";
  try {
    const first = await fetchWithTimeout(fetcher, listingUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    if (!first.ok) return {
      status: isBlockedHttpStatus(first.status) ? "blocked" : "failed",
      responseStatus: first.status,
      completeListing: false,
      jobs: [],
      error: `Hologic careers returned HTTP ${first.status}.`,
    };
    const firstHtml = await first.text();
    const total = hologicTotal(firstHtml);
    if (total === null) return {
      status: "failed",
      responseStatus: first.status,
      completeListing: false,
      jobs: [],
      error: "Hologic careers did not expose an authoritative result count.",
    };
    const jobs = hologicJobsFromHtml(firstHtml, { ...source, postingUrl: listingUrl });
    if (total === 0) return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: jobs.length === 0,
      jobs: [],
      resolvedListingUrl: listingUrl.replace(/\/$/, ""),
      error: null,
    };
    const pageSize = jobs.length;
    if (pageSize < 1) return {
      status: "failed",
      responseStatus: first.status,
      completeListing: false,
      jobs: [],
      error: "Hologic careers returned a nonempty count without usable jobs.",
    };
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages > 30) return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: false,
      jobs: uniqueJobs(jobs),
      resolvedListingUrl: listingUrl,
      error: null,
    };
    let exactPages = true;
    for (let page = 2; page <= totalPages; page += 6) {
      const pages = await Promise.all(Array.from(
        { length: Math.min(6, totalPages - page + 1) },
        (_, index) => page + index,
      ).map(async (pageNumber) => {
        try {
          const pageUrl = new URL(listingUrl);
          pageUrl.searchParams.set("page", String(pageNumber));
          const response = await fetchWithTimeout(fetcher, pageUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
          if (!response.ok) return null;
          const html = await response.text();
          if (hologicTotal(html) !== total) return null;
          const pageJobs = hologicJobsFromHtml(html, { ...source, postingUrl: listingUrl });
          const expected = pageNumber === totalPages ? total - pageSize * (totalPages - 1) : pageSize;
          return pageJobs.length === expected ? pageJobs : null;
        } catch {
          return null;
        }
      }));
      if (pages.some((pageJobs) => pageJobs === null)) exactPages = false;
      jobs.push(...pages.flatMap((pageJobs) => pageJobs ?? []));
    }
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: exactPages && jobs.length === total && unique.length === total,
      jobs: unique,
      resolvedListingUrl: listingUrl,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Hologic crawler error.",
    };
  }
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

const primaryJobLocation = (value: unknown): JsonLdValue | null => {
  const candidate = Array.isArray(value) ? value.find((item) => item && typeof item === "object") : value;
  return candidate && typeof candidate === "object" ? candidate as JsonLdValue : null;
};

const jobLocation = (value: unknown): string | null => {
  const location = primaryJobLocation(value);
  if (!location) return null;
  const address = location.address;
  if (!address || typeof address !== "object") return null;
  const normalizedAddress = address as JsonLdValue;
  return [asText(normalizedAddress.addressLocality), asText(normalizedAddress.addressRegion), asText(normalizedAddress.addressCountry)]
    .filter(Boolean)
    .join(", ") || null;
};

const jobLocationAddress = (value: unknown): JsonLdValue | null => {
  const location = primaryJobLocation(value);
  if (!location) return null;
  const address = location.address;
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
    ...(externalId ? { requisitionId: externalId } : {}),
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

const crawlOktaCareers = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl);
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Okta careers returned HTTP ${response.status}.`,
    };
    const html = await response.text();
    const jobs = [...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\bviews-row\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']*\/company\/careers\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<div\b[^>]*class=["'][^"']*\bviews-field-field-job-location\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\bfield-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/div>[\s\S]*?<\/div>/gi,
    )].flatMap((match): CrawledJob[] => {
      const title = decodeHtmlAttribute(plainText(match[2]) ?? "");
      if (!title) return [];
      const officialUrl = new URL(decodeHtmlAttribute(match[1]), source.postingUrl).href;
      const location = decodeHtmlAttribute(plainText(match[3]) ?? "") || null;
      const externalId = new URL(officialUrl).pathname.match(/-(\d+)\/?$/)?.[1] ?? null;
      const programs = classifyJobPrograms(title);
      const usLocation = location != null && /(?:\bUS\b|United States|\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b)/i.test(location);
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        officialUrl,
        publishedAt: null,
        ...(usLocation ? { locationCountry: "US" } : {}),
      }];
    });
    if (jobs.length === 0) return {
      status: "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: "Okta careers contained no server-rendered job rows.",
    };
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: uniqueJobs(jobs),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Okta crawler error.",
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

type DeelJobPosting = {
  id?: string;
  title?: string;
  richtextDescription?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  job?: {
    jobEmploymentTypes?: Array<{ employmentType?: { name?: string | null } | null }>;
    jobLocations?: Array<{ location?: { name?: string | null } | null }>;
    currentCompensation?: {
      currencyIsoCode?: string | null;
      minAmount?: number | null;
      maxAmount?: number | null;
    } | null;
    jobTeams?: Array<{ team?: { name?: string | null } | null }>;
    jobDepartments?: Array<{ department?: { name?: string | null } | null }>;
  } | null;
  jobPostingPublications?: Array<{
    currentState?: { stateSlug?: string | null; createdAt?: string | null } | null;
  }>;
};

const deelJobs = (html: string, source: CrawlSource): { jobs: CrawledJob[]; completeListing: boolean } | null => {
  const page = new URL(source.postingUrl);
  if (page.hostname !== "jobs.deel.com") return null;
  const chunks: string[] = [];
  for (const match of html.matchAll(/<script[^>]*>\s*self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g)) {
    try {
      const payload = JSON.parse(match[1]) as unknown[];
      if (typeof payload[1] === "string") chunks.push(payload[1]);
    } catch {
      // Ignore unrelated or malformed React Flight chunks.
    }
  }
  const flight = chunks.join("");
  const postingsKey = flight.indexOf('"jobPostings":[');
  if (postingsKey < 0) return null;
  const serialized = jsonArrayAt(flight, flight.indexOf("[", postingsKey));
  if (!serialized) return null;
  let rawJobs: DeelJobPosting[];
  try {
    rawJobs = JSON.parse(serialized) as DeelJobPosting[];
  } catch {
    return null;
  }
  if (rawJobs.length === 0 || rawJobs.some((job) => !job.id || !job.title)) return null;
  const segments = page.pathname.split("/").filter(Boolean);
  const slug = segments[0] === "job-boards" ? segments[1] : segments[0];
  if (!slug) return null;
  const listedIds = new Set([...html.matchAll(/https:\/\/jobs\.deel\.com\/[^"'<>\\]+\/job-details\/([0-9a-f-]+)\/overview/gi)]
    .map((match) => match[1].toLowerCase()));
  const jobs = rawJobs.flatMap((job): CrawledJob[] => {
    const publication = job.jobPostingPublications?.find(({ currentState }) => /^published/i.test(currentState?.stateSlug ?? ""));
    if (!job.id || !job.title || (job.jobPostingPublications?.length && !publication)) return [];
    const locations = (job.job?.jobLocations ?? []).flatMap(({ location }) => location?.name ?? []);
    const employmentTypes = (job.job?.jobEmploymentTypes ?? []).flatMap(({ employmentType }) => employmentType?.name ?? []);
    const departments = (job.job?.jobDepartments ?? []).flatMap(({ department }) => department?.name ?? []);
    const teams = (job.job?.jobTeams ?? []).flatMap(({ team }) => team?.name ?? []);
    const compensation = job.job?.currentCompensation;
    const description = job.richtextDescription && !/^\$[a-z0-9]+$/i.test(job.richtextDescription)
      ? plainText(job.richtextDescription)
      : null;
    return [{
      externalId: job.id,
      title: job.title,
      company: source.company,
      location: locations.join("; ") || null,
      arrangement: /\bremote\b/i.test(locations.join(" ")) ? "remote" : "unknown",
      employmentType: employmentTypes.join("; ") || null,
      summary: description,
      ...(description ? { description } : {}),
      ...(departments.length ? { department: departments.join("; ") } : {}),
      ...(teams.length ? { team: teams.join("; ") } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
      ...(compensation?.minAmount != null ? { salaryMin: compensation.minAmount } : {}),
      ...(compensation?.maxAmount != null ? { salaryMax: compensation.maxAmount } : {}),
      ...(compensation?.currencyIsoCode ? { salaryCurrency: compensation.currencyIsoCode } : {}),
      officialUrl: `https://jobs.deel.com/${encodeURIComponent(slug)}/job-details/${encodeURIComponent(job.id)}/overview`,
      publishedAt: normalizedDate(publication?.currentState?.createdAt ?? job.createdAt),
      sourceUpdatedAt: normalizedDate(job.updatedAt),
    }];
  });
  const rawIds = new Set(rawJobs.map(({ id }) => id!.toLowerCase()));
  return {
    jobs: uniqueJobs(jobs),
    completeListing: jobs.length === rawJobs.length
      && listedIds.size === rawIds.size
      && [...rawIds].every((id) => listedIds.has(id)),
  };
};

const preservesTenantScope = (originalUrl: string, candidateUrl: string): boolean => {
  try {
    const original = new URL(originalUrl);
    const candidate = new URL(candidateUrl, original);
    if (original.hostname === "www.ycombinator.com" || original.hostname === "ycombinator.com") {
      const company = original.pathname.match(/^\/companies\/([^/]+)/i)?.[1];
      const candidateCompany = candidate.pathname.match(/^\/companies\/([^/]+)/i)?.[1];
      if (company) return candidateCompany?.toLowerCase() === company.toLowerCase();
    }
    return true;
  } catch {
    return false;
  }
};

const companyScopeMatches = (company: string, originalUrl: string, candidateUrl: string): boolean => {
  const withoutParent = company.split("(")[0].trim();
  const target = (withoutParent.includes("—") ? withoutParent.split("—").at(-1)! : withoutParent.split(" / ")[0]).trim();
  const words = target.match(/[A-Za-z0-9]+/g) ?? [];
  const generic = new Set(["company", "corp", "corporation", "group", "holdings", "holding", "international", "services", "service", "technologies", "technology", "financial", "health", "healthcare", "systems", "system", "united", "america", "american"]);
  const tokens = words.map((word) => word.toLowerCase()).filter((word) => word.length >= 3 && !generic.has(word));
  if (words.length > 1) {
    const acronym = words.map((word) => /^[A-Z]{2,3}$/.test(word) ? word.toLowerCase() : word[0].toLowerCase()).join("");
    if (acronym.length >= 3) tokens.push(acronym);
  }
  if (tokens.length === 0) return true;
  try {
    const scope = `${new URL(originalUrl).hostname}${new URL(originalUrl).pathname} ${new URL(candidateUrl, originalUrl).hostname}${new URL(candidateUrl, originalUrl).pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return tokens.some((token) => scope.includes(token));
  } catch {
    return false;
  }
};

const jobsynSlug = (value: string): string => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const crawlJobsyn = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const listing = new URL(source.postingUrl);
  const endpoint = "https://prod-search-api.jobsyn.org/api/v1/solr/search";
  const requestedStart = Math.max(1, source.crawlPageCursor ?? 1);
  const maxPagesPerPass = 20;
  let responseStatus: number | null = null;

  const fetchPage = async (page: number): Promise<{ payload: JobsynPayload; jobs: CrawledJob[] }> => {
    const url = new URL(endpoint);
    url.searchParams.set("page", String(page));
    const response = await fetchWithTimeout(fetcher, url, {
      headers: {
        accept: "application/json",
        "x-origin": listing.hostname,
        origin: listing.origin,
        referer: listing.href,
      },
    }, false, { attempts: 1, timeoutMs: 12_000 });
    responseStatus = response.status;
    if (!response.ok) throw Object.assign(new Error(`Jobsyn returned HTTP ${response.status}.`), { responseStatus: response.status });
    const payload = await response.json() as JobsynPayload;
    const pagination = payload.pagination;
    if (!Array.isArray(payload.jobs)
      || !Number.isInteger(pagination?.page)
      || pagination?.page !== page
      || !Number.isInteger(pagination.page_size)
      || pagination.page_size! < 1
      || !Number.isInteger(pagination.total)
      || pagination.total! < 1
      || !Number.isInteger(pagination.total_pages)
      || pagination.total_pages! !== Math.ceil(pagination.total! / pagination.page_size!)) {
      throw new Error("Jobsyn returned an unusable job catalog.");
    }
    const jobs = payload.jobs.flatMap((job): CrawledJob[] => {
      if (!job.guid || !job.title_exact || !job.title_slug || !job.location_exact) return [];
      const description = plainText(job.description);
      const locationSlug = jobsynSlug(job.location_exact);
      const officialUrl = new URL(`/${locationSlug}/${job.title_slug}/${job.guid}/job/`, listing.origin).href;
      const programs = classifyJobPrograms(job.title_exact).keys;
      const employmentType = programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(job.job_type) ?? job.job_type ?? null;
      const arrangement = /remote/i.test(`${job.job_type ?? ""} ${job.location_exact}`)
        ? "remote" as const
        : /hybrid/i.test(job.job_type ?? "")
          ? "hybrid" as const
          : /on.?site/i.test(job.job_type ?? "")
            ? "onsite" as const
            : "unknown" as const;
      return [{
        externalId: job.guid,
        title: job.title_exact,
        company: source.company,
        location: job.location_exact,
        arrangement,
        employmentType,
        summary: description?.slice(0, 500) ?? null,
        description,
        ...(job.job_category ? { jobFamily: job.job_category } : {}),
        ...(job.job_function ? { jobFunction: job.job_function } : {}),
        ...(job.reqid ? { requisitionId: job.reqid } : {}),
        ...(job.city_exact ? { locationCity: job.city_exact } : {}),
        ...(job.state_short_exact || job.state_short ? { locationState: job.state_short_exact ?? job.state_short } : {}),
        ...(job.country_exact ? { locationCountry: job.country_exact } : {}),
        ...(job.date_updated ? { sourceUpdatedAt: normalizedDate(job.date_updated) } : {}),
        officialUrl,
        publishedAt: normalizedDate(job.date_new ?? job.date_added),
      }];
    });
    const expectedJobs = Math.min(pagination.page_size!, pagination.total! - (page - 1) * pagination.page_size!);
    if (jobs.length !== payload.jobs.length || jobs.length !== expectedJobs) {
      throw new Error("Jobsyn returned an incomplete or malformed job page.");
    }
    return { payload, jobs };
  };

  try {
    const catalog = await fetchPage(1);
    const totalPages = Math.max(1, catalog.payload.pagination?.total_pages ?? 1);
    const startPage = requestedStart > totalPages ? 1 : requestedStart;
    const first = startPage === 1 ? catalog : await fetchPage(startPage);
    const endPage = Math.min(totalPages, startPage + maxPagesPerPass - 1);
    const expectedTotal = first.payload.pagination!.total!;
    const expectedPageSize = first.payload.pagination!.page_size!;
    const pages = new Map<number, CrawledJob[]>([[startPage, first.jobs]]);
    let failedPage: number | null = null;
    for (let page = startPage + 1; page <= endPage && failedPage === null; page += 4) {
      const pageNumbers = Array.from({ length: Math.min(4, endPage - page + 1) }, (_, index) => page + index);
      const settled = await Promise.all(pageNumbers.map(async (pageNumber) => {
        try {
          return { pageNumber, result: await fetchPage(pageNumber) };
        } catch {
          return { pageNumber, result: null };
        }
      }));
      for (const item of settled) {
        if (!item.result) {
          failedPage = failedPage == null ? item.pageNumber : Math.min(failedPage, item.pageNumber);
          continue;
        }
        if (item.result.payload.pagination?.total !== expectedTotal
          || item.result.payload.pagination?.page_size !== expectedPageSize
          || item.result.payload.pagination?.total_pages !== totalPages) {
          failedPage = failedPage == null ? item.pageNumber : Math.min(failedPage, item.pageNumber);
          continue;
        }
        pages.set(item.pageNumber, item.result.jobs);
      }
    }
    const lastCompletePage = failedPage == null ? endPage : failedPage - 1;
    const pageJobs = [...pages.entries()]
      .filter(([page]) => page <= lastCompletePage)
      .sort(([left], [right]) => left - right)
      .flatMap(([, jobs]) => jobs);
    const jobs = uniqueJobs(pageJobs);
    if (jobs.length === 0 || jobs.length !== pageJobs.length) {
      throw new Error("Jobsyn returned duplicate or unusable job identities.");
    }
    const cycleComplete = failedPage === null && endPage === totalPages;
    return {
      status: "succeeded",
      responseStatus: responseStatus ?? 200,
      completeListing: false,
      jobs,
      pagination: {
        // Repeat the boundary page on the next pass. New or removed jobs can
        // shift a date-sorted catalog between checkpointed invocations.
        nextPage: failedPage ?? (cycleComplete ? 1 : endPage),
        cycleComplete,
        totalPages,
      },
      resolvedListingUrl: listing.href,
      error: null,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Jobsyn crawler error.",
    };
  }
};

const dowTextList = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("|||") : [];
  return values.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
};

const dowDate = (value: unknown): string | null => {
  const date = typeof value === "number" ? new Date(value) : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

const safeDowJobUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowedOrigin = url.origin === "https://dow.wd1.myworkdayjobs.com"
      || url.origin === "https://corporate.dow.com";
    if (!allowedOrigin || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
};

const crawlDow = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const tokenEndpoint = "https://corporate.dow.com/.dow.search.token.servlet.json?type=CorporateDowComJobFinder";
  const pageSize = 100;
  const maxResults = 1_000;
  let responseStatus: number | null = null;
  try {
    const tokenResponse = await fetchWithTimeout(fetcher, tokenEndpoint, {
      headers: { accept: "application/json" },
    }, false, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = tokenResponse.status;
    if (!tokenResponse.ok) throw Object.assign(new Error(`Dow search token returned HTTP ${tokenResponse.status}.`), { responseStatus: tokenResponse.status });
    const tokenPayload = await tokenResponse.json() as { org?: unknown; token?: unknown };
    const organizationId = typeof tokenPayload.org === "string" && /^[a-z0-9-]+$/i.test(tokenPayload.org)
      ? tokenPayload.org
      : null;
    const token = typeof tokenPayload.token === "string" && tokenPayload.token.length >= 20 && tokenPayload.token.length <= 8_192
      ? tokenPayload.token
      : null;
    if (!organizationId || !token) throw new Error("Dow search token response was unusable.");
    const endpoint = `https://${organizationId}.org.coveo.com/rest/search/v2`;

    const fetchPage = async (firstResult: number): Promise<{ total: number; results: DowSearchResult[] }> => {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId,
          searchHub: "CorporateDowComJobFinder",
          aq: '@commoncontenttype=="Job"',
          numberOfResults: pageSize,
          firstResult,
        }),
      }, false, { attempts: 1, timeoutMs: 12_000 });
      responseStatus = response.status;
      if (!response.ok) throw Object.assign(new Error(`Dow job search returned HTTP ${response.status}.`), { responseStatus: response.status });
      const payload = await response.json() as DowSearchPayload;
      const total = Number(payload.totalCount);
      if (!Number.isInteger(total) || total <= 0 || !Array.isArray(payload.results)) {
        throw new Error("Dow job search returned an unusable catalog.");
      }
      return { total, results: payload.results };
    };

    const first = await fetchPage(0);
    const boundedTotal = Math.min(first.total, maxResults);
    const offsets = Array.from({ length: Math.ceil(boundedTotal / pageSize) }, (_, index) => index * pageSize);
    const pages = new Map<number, DowSearchResult[]>([[0, first.results]]);
    for (let index = 1; index < offsets.length; index += 4) {
      const batch = offsets.slice(index, index + 4);
      const results = await Promise.all(batch.map(async (offset) => ({ offset, page: await fetchPage(offset) })));
      for (const { offset, page } of results) {
        if (page.total !== first.total) throw new Error("Dow job count changed during pagination.");
        pages.set(offset, page.results);
      }
    }
    const rawResults = offsets.flatMap((offset) => pages.get(offset) ?? []);
    const jobs = rawResults.flatMap((result): CrawledJob[] => {
      const raw = result.raw ?? {};
      const externalId = asText(raw.dow_jobreqid) ?? asText(raw.dow_jobid);
      const title = asText(raw.dow_jobtitle) ?? asText(result.title);
      const officialUrl = safeDowJobUrl(raw.dow_joburl ?? result.printableUri ?? result.clickUri);
      const applyUrl = safeDowJobUrl(raw.dow_jobapplyurl);
      if (!externalId || !title || !officialUrl) return [];
      const siteNames = dowTextList(raw.dow_jobsitenames);
      const cityPaths = dowTextList(raw.dow_jobcities);
      const location = siteNames.join("; ") || cityPaths.map((path) => path.split("//").at(-1)).filter(Boolean).join("; ") || null;
      const primaryPath = cityPaths[0]?.split("//").map((part) => part.trim()).filter(Boolean) ?? [];
      const countryPaths = dowTextList(raw.dow_jobcountries);
      const country = countryPaths[0]?.split("//").at(-1) ?? (primaryPath.length >= 2 ? primaryPath[1] : null);
      const arrangementText = asText(raw.dow_remotetype) ?? "";
      const programs = classifyJobPrograms(title).keys;
      const employmentType = programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(asText(raw.dow_jobreqtimetype) ?? asText(raw.dow_jobreqtype))
          ?? asText(raw.dow_jobreqtimetype)
          ?? asText(raw.dow_jobreqtype);
      const description = plainText(asText(raw.dow_jobdescription));
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote/i.test(arrangementText) ? "remote" : /hybrid/i.test(arrangementText) ? "hybrid" : /on.?site/i.test(arrangementText) ? "onsite" : "unknown",
        employmentType,
        summary: plainText(result.excerpt) ?? description,
        description,
        ...(asText(raw.dow_jobreqfunction) ? { jobFunction: asText(raw.dow_jobreqfunction) } : {}),
        ...(primaryPath.at(-1) ? { locationCity: primaryPath.at(-1) } : {}),
        ...(primaryPath.length >= 3 ? { locationState: primaryPath.at(-2) } : {}),
        ...(country ? { locationCountry: country } : {}),
        requisitionId: externalId,
        ...(applyUrl ? { applyUrl } : {}),
        ...(dowDate(raw.dow_jobenddate) ? { validThrough: dowDate(raw.dow_jobenddate) } : {}),
        ...(dowDate(raw.sysindexeddate) ? { sourceUpdatedAt: dowDate(raw.sysindexeddate) } : {}),
        rawPayload: raw,
        officialUrl,
        publishedAt: dowDate(raw.dow_jobstartdate ?? raw.date),
      }];
    });
    const unique = uniqueJobs(jobs);
    const exact = first.total <= maxResults
      && rawResults.length === first.total
      && jobs.length === rawResults.length
      && unique.length === first.total;
    return {
      status: "succeeded",
      responseStatus,
      completeListing: exact,
      jobs: unique,
      resolvedListingUrl: "https://corporate.dow.com/en-us/careers/jobs.html",
      error: null,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Dow crawler error.",
    };
  }
};

async function crawlJsonLd(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  const discoveryDepth = source.discoveryDepth ?? 0;
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl);
    if (!response.ok) {
      if (isBlockedHttpStatus(response.status)) {
        if (source.adapter === "phenom") {
          const widgets = await crawlPhenomWidgets(source, fetcher);
          if (widgets.status === "succeeded") return widgets;
        }
        const talemetry = await crawlTalemetryJson(source, fetcher);
        if (talemetry) return talemetry;
        const fallback = discoveryDepth === 0 ? await crawlReaderFallback(source, fetcher, now) : null;
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
    const finalPage = new URL(response.url || source.postingUrl);
    if (finalPage.hostname === "apply.workable.com") {
      const workable = await crawlWorkable({
        ...source,
        postingUrl: finalPage.href,
        adapter: "custom",
      }, fetcher);
      return workable.status === "succeeded"
        ? { ...workable, resolvedListingUrl: finalPage.href }
        : workable;
    }
    if (finalPage.hostname.endsWith(".bamboohr.com")) {
      const bamboo = await crawlBambooHr({
        ...source,
        postingUrl: finalPage.href,
        adapter: "custom",
      }, fetcher);
      return bamboo.status === "succeeded"
        ? { ...bamboo, resolvedListingUrl: new URL("/careers", finalPage.origin).href }
        : bamboo;
    }
    if (finalPage.href !== source.postingUrl && isPublicAtsCatalogUrl(finalPage.href)) {
      await response.body?.cancel().catch(() => undefined);
      const redirected = await crawlSourceBase({
        ...source,
        postingUrl: finalPage.href,
        adapter: detectUrlAdapter(finalPage.href),
        discoveryDepth: 1,
      }, fetcher, now);
      return redirected.status === "succeeded"
        ? { ...redirected, resolvedListingUrl: finalPage.href }
        : redirected;
    }
    if (finalPage.href !== source.postingUrl && discoveryDepth === 0) {
      if (finalPage.origin === new URL(source.postingUrl).origin) {
        // Locale and trailing-path redirects are still the same careers page.
        // Continue with the response already in hand and preserve the one
        // discovery hop for its actual all-jobs link.
        source = { ...source, postingUrl: finalPage.href };
      } else {
        await response.body?.cancel().catch(() => undefined);
        const redirected = await crawlSourceBase({
          ...source,
          postingUrl: finalPage.href,
          adapter: detectUrlAdapter(finalPage.href),
          discoveryDepth: 1,
        }, fetcher, now);
        return redirected.status === "succeeded"
          ? { ...redirected, resolvedListingUrl: redirected.resolvedListingUrl ?? finalPage.href }
          : redirected;
      }
    }
    const html = await response.text();
    const decodedApplicationState = html
      .replaceAll("&#34;", '"')
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&");
    if (source.id === "p4-0293-hummingbird" && /\bFuture openings\b/i.test(plainText(html) ?? "")) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: [],
      resolvedListingUrl: source.postingUrl,
      error: null,
    };
    const hrmDirect = hrmDirectJobs(html, source);
    if (hrmDirect) return hrmDirect;
    const mCloudConfig = mCloudConfigFromHtml(html);
    if (mCloudConfig) {
      const mCloud = await crawlMCloudCatalog(source, mCloudConfig, fetcher);
      if (mCloud.status === "succeeded") return mCloud;
    }
    const activate = await crawlActivateJobSearch(source, html, fetcher);
    if (activate) return activate;
    const cornerstone = await crawlCornerstone(source, html, fetcher);
    if (cornerstone) return cornerstone;
    const eightfoldDomain = /(?:id=["']pcsx["']|eightfold\.ai|\/api\/pcsx\/search)/i.test(decodedApplicationState)
      ? decodedApplicationState.match(/["']domain["']\s*:\s*["']([^"']+)["']/i)?.[1]
      : null;
    if (eightfoldDomain && /^[a-z0-9.-]+$/i.test(eightfoldDomain)) {
      const eightfoldUrl = new URL("/careers", finalPage.origin);
      eightfoldUrl.searchParams.set("domain", eightfoldDomain);
      const eightfold = await crawlEightfold({ ...source, postingUrl: eightfoldUrl.href, adapter: "custom" }, fetcher);
      if (eightfold.status === "succeeded") return { ...eightfold, resolvedListingUrl: eightfoldUrl.href };
    }
    if (/prod-search-api\.jobsyn\.org|source\s*:\s*["']solr["']/i.test(html)) {
      return crawlJobsyn(source, fetcher);
    }
    const deel = deelJobs(html, source);
    if (deel) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: deel.completeListing,
      jobs: deel.jobs,
      error: null,
    };
    const kula = kulaJobs(html, source);
    if (kula) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: true,
      jobs: kula,
      error: null,
    };
    const rippling = embeddedRipplingJobs(html, source);
    if (rippling) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: rippling.completeListing,
      jobs: rippling.jobs,
      error: null,
    };
    const workableCards = embeddedWorkableCards(html, source);
    if (workableCards) return {
      status: "succeeded",
      responseStatus: response.status,
      // An employer page with embedded detail links is a trustworthy source
      // of additions, but it has no atomic listing count for safe closure.
      completeListing: false,
      jobs: workableCards,
      error: null,
    };
    const ukg = await crawlUkgPages(source, html, fetcher);
    if (ukg) return ukg;
    const oracle = oracleCareerSite(html, source.postingUrl);
    if (oracle) return crawlOracle(source, oracle, fetcher);
    const radancy = await crawlRadancyPages(source, html, fetcher);
    if (radancy) return radancy;
    if (discoveryDepth <= 1) {
      const radancyListingUrl = talentBrewSearchResultsUrl(html, source.postingUrl);
      if (radancyListingUrl) {
        const listingResult = await crawlSourceBase({
          ...source,
          postingUrl: radancyListingUrl,
          adapter: "custom",
          discoveryDepth: 1,
        }, fetcher, now);
        if (listingResult.status === "succeeded" && listingResult.jobs.length > 0) return {
          ...listingResult,
          resolvedListingUrl: radancyListingUrl,
        };
      }
    }
    const successFactorsUnified = await crawlSuccessFactorsUnified(source, html, fetcher);
    if (successFactorsUnified) return successFactorsUnified;
    const successFactors = await crawlSuccessFactorsPages(source, html, fetcher);
    if (successFactors) return successFactors;
    if (discoveryDepth <= 1) {
      const successFactorsListing = successFactorsListingUrl(html, source.postingUrl);
      if (successFactorsListing) {
        const listingResult = await crawlSourceBase({
          ...source,
          postingUrl: successFactorsListing,
          adapter: "custom",
          discoveryDepth: 1,
        }, fetcher, now);
        if (listingResult.status === "succeeded") return {
          ...listingResult,
          resolvedListingUrl: successFactorsListing,
        };
      }
    }
    const talentHub = await crawlTalentHubPages(source, html, fetcher);
    if (talentHub) return talentHub;
    const avature = await crawlAvaturePages(source, html, fetcher);
    if (avature) return avature;
    const phenom = phenomJobs(html, source);
    if (phenom) return crawlPhenomPages(source, phenom, fetcher);
    if (discoveryDepth <= 1) {
      const phenomListingUrl = phenomSearchResultsUrl(html, source.postingUrl);
      if (phenomListingUrl) {
        const phenomResult = await crawlSourceBase({
          ...source,
          postingUrl: phenomListingUrl,
          adapter: "phenom",
          discoveryDepth: 1,
        }, fetcher, now);
        if (phenomResult.status === "succeeded" && phenomResult.jobs.length > 0) return {
          ...phenomResult,
          completeListing: false,
          resolvedListingUrl: phenomListingUrl,
        };
      }
    }
    const icimsListing = icimsCatalogUrl(html);
    if (icimsListing) {
      const icims = await crawlIcims({
        ...source,
        postingUrl: icimsListing,
        adapter: "icims",
        discoveryDepth: 1,
      }, fetcher);
      if (icims.status === "succeeded") return {
        ...icims,
        resolvedListingUrl: icims.resolvedListingUrl ?? icimsListing,
      };
    }
    const gustoListing = gustoCatalogUrl(html);
    if (gustoListing) {
      const gusto = await crawlReaderFallback({
        ...source,
        postingUrl: gustoListing,
        adapter: "custom",
        discoveryDepth: 1,
      }, fetcher, now);
      if (gusto?.status === "succeeded" && gusto.jobs.length > 0) return {
        ...gusto,
        completeListing: false,
        resolvedListingUrl: gustoListing,
      };
    }
    const discovered = discoverAts(html, source.postingUrl);
    if (discovered) {
      const discoveredResult = discovered.kind === "workday"
        ? await crawlWorkday(source, discovered.endpoint, fetcher, now)
        : await crawlDiscoveredFeed(source, discovered, fetcher);
      if (discoveredResult.status === "succeeded") return discoveredResult;
    }
    const extracted = extractJobsFromHtml(html, source);
    if (extracted.jobs.length > 0 || extracted.completeListing) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: extracted.completeListing,
      jobs: extracted.jobs,
      error: null,
    };
    const anchors = anchorsFromHtml(html);
    const linked = jobsFromBrowserAnchors(anchors, source);
    if (discoveryDepth === 0) {
      const current = new URL(source.postingUrl);
      current.hash = "";
      const candidates = careerCandidates(anchors, source.postingUrl)
        .filter(({ href }) => isPublicAtsCatalogUrl(href) || (
          isSafeCareerRecommendation(source.company, source.postingUrl, href)
          && preservesTenantScope(source.postingUrl, href)
          && companyScopeMatches(source.company, source.postingUrl, href)
        ))
        .filter(({ href }) => {
          try {
            const candidate = new URL(href, source.postingUrl);
            candidate.hash = "";
            return candidate.href !== current.href;
          } catch {
            return false;
          }
        })
        .slice(0, 3);
      for (const candidate of candidates) {
        const candidateUrl = new URL(candidate.href, source.postingUrl);
        candidateUrl.hash = "";
        const candidateResult = await crawlSourceBase({
          ...source,
          postingUrl: candidateUrl.href,
          adapter: detectUrlAdapter(candidateUrl.href),
          discoveryDepth: 1,
        }, fetcher, now);
        const renderedCandidate = candidateResult.status === "succeeded" && candidateResult.jobs.length > 0
          ? candidateResult
          : await crawlReaderFallback({
              ...source,
              postingUrl: candidateUrl.href,
              adapter: detectUrlAdapter(candidateUrl.href),
              discoveryDepth: 1,
            }, fetcher, now);
        if (renderedCandidate?.status === "succeeded" && renderedCandidate.jobs.length > 0) {
          // A link discovered from a careers landing page can still be a
          // departmental or otherwise partial listing. Persist its jobs, but
          // never let that one-hop discovery close jobs that were not present.
          // Once the URL is vetted and promoted into the source catalog, its
          // native adapter may authoritatively complete the listing.
          return {
            ...renderedCandidate,
            completeListing: false,
            resolvedListingUrl: candidateUrl.href,
          };
        }
      }
    }
    if (linked.length > 0) return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: false,
      jobs: linked,
      error: null,
    };
    const fallback = discoveryDepth === 0 ? await crawlReaderFallback(source, fetcher, now) : null;
    if (fallback) return fallback;
    return {
      status: "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: "No supported public job feed or job listings were discovered.",
    };
  } catch (error) {
    const fallback = discoveryDepth === 0 ? await crawlReaderFallback(source, fetcher, now) : null;
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

type AtlassianListing = {
  id?: number | string;
  title?: string;
  locations?: string[];
  category?: string;
  overview?: string;
  responsibilities?: string;
  qualifications?: string;
  applyUrl?: string;
  portalJobPost?: { portalUrl?: string; updatedDate?: string };
};

const atlassianDate = (value: string | undefined): string | null => {
  if (!value) return null;
  const timestamp = Date.parse(`${value} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : normalizedDate(value);
};

const crawlAtlassian = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://www.atlassian.com/endpoint/careers/listings";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Atlassian listings endpoint returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as AtlassianListing[];
    if (!Array.isArray(payload)) throw new Error("Atlassian listings endpoint returned a non-array payload.");
    const jobs = payload.flatMap((job): CrawledJob[] => {
      const id = job.id == null ? null : String(job.id);
      const officialUrl = job.portalJobPost?.portalUrl;
      if (!id || !job.title || !officialUrl) return [];
      const location = job.locations?.filter(Boolean).join("; ") || null;
      const description = plainText(job.overview);
      const responsibilities = plainText(job.responsibilities);
      const qualifications = plainText(job.qualifications);
      const updatedAt = atlassianDate(job.portalJobPost?.updatedDate);
      return [{
        externalId: id,
        title: job.title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: classifyJobPrograms(job.title).keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: description,
        description,
        ...(responsibilities ? { responsibilities } : {}),
        ...(qualifications ? { qualifications } : {}),
        ...(job.category ? { department: job.category } : {}),
        ...(job.applyUrl ? { applyUrl: job.applyUrl } : {}),
        ...(updatedAt ? { sourceUpdatedAt: updatedAt } : {}),
        officialUrl,
        publishedAt: updatedAt,
      }];
    });
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: jobs.length === payload.length,
      jobs,
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Atlassian crawler error.",
    };
  }
};

type AmazonJob = {
  id?: string;
  id_icims?: string;
  title?: string;
  job_path?: string;
  location?: string;
  normalized_location?: string;
  city?: string;
  state?: string;
  country_code?: string;
  job_schedule_type?: string;
  job_category?: string;
  job_family?: string;
  business_category?: string;
  description?: string;
  description_short?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  url_next_step?: string;
  posted_date?: string;
  is_intern?: boolean | null;
};

type AmazonSearchPayload = { hits?: number; jobs?: AmazonJob[] };

type TikTokLocation = {
  code?: string;
  en_name?: string;
  i18n_name?: string;
  parent?: TikTokLocation | null;
};

type TikTokJob = {
  id?: string;
  code?: string;
  title?: string;
  description?: string;
  requirement?: string;
  recruit_type?: { en_name?: string; i18n_name?: string } | null;
  job_category?: { en_name?: string; i18n_name?: string } | null;
  city_info?: TikTokLocation | null;
  job_subject?: { en_name?: string; i18n_name?: string } | null;
  department_info?: { en_name?: string; i18n_name?: string } | null;
  tag_list?: Array<{ en_name?: string; i18n_name?: string }> | null;
  job_post_info?: {
    min_salary?: number | null;
    max_salary?: number | null;
    currency?: string | null;
    required_degree?: string | null;
    experience?: string | null;
  } | null;
};

type TikTokSearchPayload = {
  code?: number;
  data?: { count?: number; job_post_list?: TikTokJob[]; job_list?: TikTokJob[]; jobs?: TikTokJob[] };
};

type DatabricksJob = {
  id?: string;
  gh_Id?: string | number;
  internal_job_id?: string | number;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string } | null;
  offices?: Array<{ name?: string }>;
  departments?: Array<{ name?: string }>;
  metadata?: unknown[];
};

type IbmJob = {
  _id?: string;
  _source?: {
    title?: string;
    url?: string;
    description?: string;
    field_keyword_08?: string;
    field_keyword_17?: string;
    field_keyword_18?: string;
    field_keyword_19?: string;
  };
};

const crawlDatabricks = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://www.databricks.com/careers-assets/page-data/company/careers/open-positions/page-data.json";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, false);
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Databricks career catalog returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as {
      result?: { pageContext?: { data?: { allGreenhouseJob?: { nodes?: DatabricksJob[] } } } };
    };
    const nodes = payload.result?.pageContext?.data?.allGreenhouseJob?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("Databricks career catalog did not contain Greenhouse jobs.");
    const jobs = nodes.flatMap((job): CrawledJob[] => {
      const externalId = job.gh_Id != null ? String(job.gh_Id) : job.id?.replace(/^Greenhouse__Job__/, "") ?? null;
      if (!externalId || !job.title || !job.absolute_url) return [];
      const description = plainText(decodeHtmlAttribute(job.content ?? ""));
      const location = job.location?.name ?? null;
      const departments = (job.departments ?? []).map(({ name }) => name).filter((name): name is string => Boolean(name));
      const offices = (job.offices ?? []).map(({ name }) => name).filter((name): name is string => Boolean(name));
      const programs = classifyJobPrograms(job.title).keys;
      const updatedAt = normalizedDate(job.updated_at);
      return [{
        externalId,
        title: job.title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : /\bhybrid\b/i.test(location ?? "") ? "hybrid" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: description,
        description,
        ...(departments.length ? { department: departments.join("; ") } : {}),
        ...(offices.length ? { office: offices.join("; ") } : {}),
        requisitionId: externalId,
        ...(updatedAt ? { sourceUpdatedAt: updatedAt } : {}),
        ...(job.metadata?.length ? { rawPayload: { metadata: job.metadata } } : {}),
        officialUrl: job.absolute_url,
        publishedAt: updatedAt,
      }];
    });
    if (jobs.length !== nodes.length) throw new Error("Databricks career catalog contained malformed job records.");
    return { status: "succeeded", responseStatus: response.status, completeListing: true, jobs: uniqueJobs(jobs), error: null };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Databricks crawler error.",
    };
  }
};

const ibmSearchBody = (source: CrawlSource, from: number): Record<string, unknown> => {
  const isWatsonx = /watsonx/i.test(source.company);
  const query = isWatsonx ? {
    bool: { must: [{ simple_query_string: {
      query: "watsonx",
      fields: ["keywords^1", "body^1", "url^2", "description^2", "h1s_content^2", "title^3", "field_text_01"],
    } }] },
  } : { bool: { must: [] } };
  return {
    appId: "careers",
    scopes: ["careers2"],
    query,
    size: 30,
    from,
    ...(from > 0 ? { p: Math.floor(from / 30) + 1 } : {}),
    sort: [{ _score: "desc" }, { pageviews: "desc" }],
    lang: "zz",
    localeSelector: {},
    sm: { query: isWatsonx ? "watsonx" : "", lang: "zz" },
    ...(/consulting/i.test(source.company) ? { post_filter: { term: { field_keyword_08: "Consulting" } } } : {}),
    _source: [
      "_id", "title", "url", "description", "language", "entitled",
      "field_keyword_17", "field_keyword_08", "field_keyword_18", "field_keyword_19",
    ],
  };
};

const crawlIbm = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://www-api.ibm.com/search/api/v2";
  let responseStatus: number | null = null;
  const fetchPage = async (from: number): Promise<{ total: number; hits: IbmJob[] } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", referer: "https://www.ibm.com/" },
        body: JSON.stringify(ibmSearchBody(source, from)),
      }, false, { attempts: 1, timeoutMs: 20_000 });
      responseStatus = response.status;
      if (!response.ok) return null;
      const payload = await response.json() as { hits?: { total?: { value?: number } | number; hits?: IbmJob[] } };
      const total = typeof payload.hits?.total === "number" ? payload.hits.total : payload.hits?.total?.value;
      if (!Number.isFinite(total)) return null;
      return { total: Number(total), hits: payload.hits?.hits ?? [] };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0);
  if (!first) return {
    status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
    responseStatus,
    completeListing: false,
    jobs: [],
    error: "IBM careers search API did not return a usable first page.",
  };
  const pageSize = 30;
  const totalPages = Math.ceil(Math.min(first.total, 10_000) / pageSize);
  const isCheckpointed = totalPages > 40;
  const startPage = isCheckpointed ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages) : 1;
  const endPage = isCheckpointed ? Math.min(startPage + (startPage === 1 ? 19 : 18), totalPages) : totalPages;
  const pagesToFetch = Array.from(
    { length: Math.max(0, endPage - Math.max(startPage, 2) + 1) },
    (_, index) => Math.max(startPage, 2) + index,
  );
  const offsets = pagesToFetch.map((page) => (page - 1) * pageSize);
  const pages: Array<{ total: number; hits: IbmJob[] } | null> = [];
  for (let index = 0; index < offsets.length; index += 6) {
    pages.push(...await Promise.all(offsets.slice(index, index + 6).map(fetchPage)));
  }
  const firstExpected = Math.min(pageSize, first.total);
  const usableIbmIds = (hits: IbmJob[]): string[] => hits.flatMap((hit) => (
    hit._id && hit._source?.title && hit._source.url ? [hit._id] : []
  ));
  const seenIdentities = new Set<string>();
  let firstFailedPage: number | null = claimPageIdentities(
    usableIbmIds(first.hits), firstExpected, seenIdentities,
  ) ? null : 1;
  for (let index = 0; index < pages.length && firstFailedPage === null; index += 1) {
    const page = pages[index];
    const pageNumber = pagesToFetch[index];
    const expected = Math.min(pageSize, Math.max(0, first.total - (pageNumber - 1) * pageSize));
    if (!page || !claimPageIdentities(usableIbmIds(page.hits), expected, seenIdentities)) {
      firstFailedPage = pageNumber;
      break;
    }
  }
  const raw = [first, ...pages.filter((page): page is NonNullable<typeof page> => page !== null)].flatMap((page) => page.hits);
  // IBM's search index exposes a generic "Intern" title but omits the
  // authoritative Employment type shown on the rendered detail page. Read a
  // bounded set of 2027 student detail pages through the same reader fallback
  // used by other JS-rendered career sites so Co-Op (Fixed Term) cannot be
  // mislabeled as a summer internship.
  const detailEmploymentTypes = new Map<string, string>();
  const detailCandidates = raw.filter((hit) => hit._id && hit._source?.url
    && /\b2027\b/i.test(hit._source.title ?? "")
    && /\b(?:intern(?:ship)?|co[\s-]?op|coop)\b/i.test(hit._source.title ?? "")).slice(0, 24);
  for (let index = 0; index < detailCandidates.length; index += 4) {
    const details = await Promise.all(detailCandidates.slice(index, index + 4).map(async (hit) => {
      try {
        const markdown = await readerMarkdown(hit._source!.url!, fetcher, {
          maxConcurrent: 2,
          richLinks: false,
          timeoutMs: 10_000,
        });
        const value = markdown?.match(/\bEmployment type\s*\n+\s*([^\n]+)/i)?.[1]?.trim();
        const employmentType = normalizeEmploymentType(value);
        return hit._id && employmentType ? [hit._id, employmentType] as const : null;
      } catch {
        return null;
      }
    }));
    for (const detail of details) if (detail) detailEmploymentTypes.set(detail[0], detail[1]);
  }
  const jobs = raw.flatMap((hit): CrawledJob[] => {
    const value = hit._source;
    if (!hit._id || !value?.title || !value.url) return [];
    const parsed = new URL(value.url, "https://careers.ibm.com");
    const jobId = parsed.searchParams.get("jobId");
    const location = value.field_keyword_19 ?? null;
    const arrangementText = value.field_keyword_17 ?? "";
    const programs = classifyJobPrograms(value.title).keys;
    const employmentType = detailEmploymentTypes.get(hit._id)
      ?? (programs.includes("coop") ? "Co-op" : programs.includes("internship") ? "Internship" : null);
    return [{
      externalId: hit._id,
      title: value.title,
      company: source.company,
      location,
      arrangement: /remote/i.test(arrangementText) ? "remote" : /hybrid/i.test(arrangementText) ? "hybrid" : /on.?site/i.test(arrangementText) ? "onsite" : "unknown",
      employmentType,
      summary: plainText(value.description),
      description: plainText(value.description),
      ...(value.field_keyword_08 ? { department: value.field_keyword_08 } : {}),
      ...(value.field_keyword_18 ? { experienceLevel: value.field_keyword_18 } : {}),
      ...(jobId ? { requisitionId: jobId } : {}),
      officialUrl: jobId
        ? `https://careers.ibm.com/en_US/careers/JobDetail?jobId=${encodeURIComponent(jobId)}`
        : parsed.href,
      publishedAt: null,
    }];
  });
  const unique = uniqueJobs(jobs);
  if (isCheckpointed) return {
    status: "succeeded",
    responseStatus,
    completeListing: false,
    jobs: unique,
    pagination: {
      nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
      cycleComplete: firstFailedPage === null && endPage === totalPages,
      totalPages,
    },
    error: null,
  };
  return {
    status: "succeeded",
    responseStatus,
    completeListing: first.total <= 10_000 && firstFailedPage === null && pages.every((page) => page !== null) && unique.length >= first.total,
    jobs: unique,
    error: null,
  };
};

const tikTokLocation = (city: TikTokLocation | null | undefined): {
  label: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
} => {
  const values: string[] = [];
  let current = city;
  while (current) {
    const value = current.en_name ?? current.i18n_name;
    if (value && !values.includes(value)) values.push(value);
    current = current.parent;
  }
  return {
    label: values.join(", ") || null,
    city: values[0] ?? null,
    state: values.length >= 3 ? values[1] : null,
    country: values.at(-1) ?? null,
  };
};

const tikTokJob = (source: CrawlSource, value: TikTokJob): CrawledJob | null => {
  if (!value.id || !value.title) return null;
  const location = tikTokLocation(value.city_info);
  const recruitmentType = value.recruit_type?.en_name ?? value.recruit_type?.i18n_name ?? null;
  const program = classifyJobPrograms(`${value.title} ${recruitmentType ?? ""}`).keys;
  const isIntern = program.some((key) => key === "internship" || key === "coop");
  const description = plainText(value.description);
  const qualifications = plainText(value.requirement);
  const department = value.job_category?.en_name ?? value.job_category?.i18n_name ?? null;
  const team = value.department_info?.en_name ?? value.department_info?.i18n_name
    ?? value.job_subject?.en_name ?? value.job_subject?.i18n_name ?? null;
  const skills = (value.tag_list ?? [])
    .map((tag) => tag.en_name ?? tag.i18n_name)
    .filter((tag): tag is string => Boolean(tag));
  return {
    externalId: value.id,
    title: value.title,
    company: source.company,
    location: location.label,
    arrangement: /\bremote\b/i.test(location.label ?? "") ? "remote" : "unknown",
    employmentType: isIntern ? "Internship" : recruitmentType,
    summary: description,
    description,
    ...(qualifications ? { qualifications } : {}),
    ...(skills.length ? { skills } : {}),
    ...(department ? { department } : {}),
    ...(team ? { team } : {}),
    ...(location.city ? { locationCity: location.city } : {}),
    ...(location.state ? { locationState: location.state } : {}),
    ...(location.country ? { locationCountry: location.country } : {}),
    ...(value.job_post_info?.min_salary != null ? { salaryMin: value.job_post_info.min_salary } : {}),
    ...(value.job_post_info?.max_salary != null ? { salaryMax: value.job_post_info.max_salary } : {}),
    ...(value.job_post_info?.currency ? { salaryCurrency: value.job_post_info.currency } : {}),
    ...(value.job_post_info?.required_degree ? { educationRequirements: value.job_post_info.required_degree } : {}),
    ...(value.job_post_info?.experience ? { experienceRequirements: value.job_post_info.experience } : {}),
    requisitionId: value.code ?? value.id,
    applyUrl: `https://careers.tiktok.com/resume/${encodeURIComponent(value.id)}/apply`,
    officialUrl: `https://lifeattiktok.com/search/${encodeURIComponent(value.id)}`,
    publishedAt: null,
  };
};

const crawlTikTok = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const pageSize = 100;
  const endpoint = "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts";
  const fetchPage = async (offset: number): Promise<{ status: number; total: number; jobs: CrawledJob[] } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-language": "en-US",
          "content-type": "application/json",
          origin: "https://lifeattiktok.com",
          "website-path": "tiktok",
        },
        body: JSON.stringify({
          job_category_id_list: [], recruitment_id_list: [], subject_id_list: [],
          location_code_list: [], tag_id_list: [], keyword: "", limit: pageSize, offset,
        }),
      }, false, { attempts: 1, timeoutMs: 20_000 });
      if (!response.ok) return null;
      const payload = await response.json() as TikTokSearchPayload;
      if (payload.code !== 0 || !payload.data) return null;
      const rawJobs = payload.data.job_post_list ?? payload.data.job_list ?? payload.data.jobs ?? [];
      return {
        status: response.status,
        total: Math.max(0, Number(payload.data.count ?? rawJobs.length)),
        jobs: rawJobs.flatMap((job) => tikTokJob(source, job) ?? []),
      };
    } catch {
      return null;
    }
  };

  const first = await fetchPage(0);
  if (!first) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "TikTok public jobs API did not return a usable first page." };
  const totalPages = Math.ceil(Math.min(first.total, 10_000) / pageSize);
  const isCheckpointed = totalPages > 4;
  const startPage = isCheckpointed ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages) : 1;
  const endPage = isCheckpointed ? Math.min(startPage + (startPage === 1 ? 3 : 2), totalPages) : totalPages;
  const jobsByUrl = new Map(first.jobs.map((job) => [job.officialUrl, job]));
  const seenIdentities = new Set<string>();
  let firstFailedPage: number | null = claimPageIdentities(
    first.jobs.map((job) => job.externalId ?? job.officialUrl),
    Math.min(pageSize, first.total),
    seenIdentities,
  ) ? null : 1;
  for (let page = Math.max(startPage, 2); page <= endPage; page += 1) {
    const result = await fetchPage((page - 1) * pageSize);
    const expected = Math.min(pageSize, Math.max(0, first.total - (page - 1) * pageSize));
    if (!result || !claimPageIdentities(
      result.jobs.map((job) => job.externalId ?? job.officialUrl), expected, seenIdentities,
    )) {
      firstFailedPage ??= page;
      continue;
    }
    for (const job of result.jobs) jobsByUrl.set(job.officialUrl, job);
  }
  const jobs = [...jobsByUrl.values()];
  if (isCheckpointed) return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: false,
    jobs,
    pagination: {
      nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
      cycleComplete: firstFailedPage === null && endPage === totalPages,
      totalPages,
    },
    error: null,
  };
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: first.total <= 10_000 && firstFailedPage === null && jobs.length >= first.total,
    jobs,
    error: null,
  };
};

const amazonPostedDate = (value: string | undefined): string | null => {
  if (!value) return null;
  const timestamp = Date.parse(`${value} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : normalizedDate(value);
};

const amazonQuery = (source: CrawlSource): string => {
  const value = `${source.company} ${new URL(source.postingUrl).pathname}`.toLocaleLowerCase();
  if (value.includes("machine-learning")) return "machine learning";
  if (value.includes("one-medical")) return "One Medical";
  if (value.includes("mgm")) return "MGM Studios";
  if (value.includes("robotics")) return "Amazon Robotics";
  if (source.company.includes("AWS")) return "AWS";
  return "";
};

const amazonJob = (source: CrawlSource, value: AmazonJob): CrawledJob | null => {
  const externalId = value.id_icims ?? value.id ?? null;
  if (!externalId || !value.title || !value.job_path) return null;
  const description = plainText(value.description);
  const summary = plainText(value.description_short) ?? description;
  const qualifications = [plainText(value.basic_qualifications), plainText(value.preferred_qualifications)].filter(Boolean).join(" ") || null;
  const program = value.is_intern || classifyJobPrograms(value.title).keys.some((key) => key === "internship" || key === "coop");
  return {
    externalId,
    title: value.title,
    company: source.company,
    location: value.normalized_location ?? value.location ?? null,
    arrangement: /\bremote\b/i.test(`${value.normalized_location ?? ""} ${value.location ?? ""}`) ? "remote" : "unknown",
    employmentType: program ? "Internship" : normalizeEmploymentType(value.job_schedule_type),
    summary,
    description,
    ...(qualifications ? { qualifications } : {}),
    ...(value.job_category ? { department: value.job_category } : {}),
    ...(value.business_category ? { businessUnit: value.business_category } : {}),
    ...(value.job_family ? { jobFamily: value.job_family } : {}),
    ...(value.city ? { locationCity: value.city } : {}),
    ...(value.state ? { locationState: value.state } : {}),
    ...(value.country_code ? { locationCountry: value.country_code } : {}),
    requisitionId: externalId,
    ...(value.url_next_step ? { applyUrl: value.url_next_step } : {}),
    officialUrl: new URL(value.job_path, "https://www.amazon.jobs").href,
    publishedAt: amazonPostedDate(value.posted_date),
  };
};

const crawlAmazonJobs = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const pageSize = 100;
  const query = amazonQuery(source);
  const endpointFor = (offset: number) => {
    const endpoint = new URL("/en/search.json", "https://www.amazon.jobs");
    endpoint.searchParams.set("offset", String(offset));
    endpoint.searchParams.set("result_limit", String(pageSize));
    endpoint.searchParams.set("sort", "recent");
    endpoint.searchParams.set("base_query", query);
    return endpoint;
  };
  const fetchPage = async (offset: number): Promise<{ status: number; total: number; jobs: CrawledJob[] } | null> => {
    try {
      const response = await fetchWithTimeout(
        fetcher,
        endpointFor(offset),
        { headers: { accept: "application/json" } },
        true,
        source.id === "p4-0394-amazon" ? { attempts: 1 } : undefined,
      );
      if (!response.ok) return null;
      const payload = await response.json() as AmazonSearchPayload;
      return {
        status: response.status,
        total: Math.max(0, Number(payload.hits ?? payload.jobs?.length ?? 0)),
        jobs: (payload.jobs ?? []).flatMap((job) => amazonJob(source, job) ?? []),
      };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0);
  if (!first) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Amazon search endpoint did not return a usable first page." };
  const total = first.total;
  const boundedTotal = Math.min(total, 10_000);
  const totalPages = Math.ceil(boundedTotal / pageSize);
  const isCheckpointedCatalog = source.id === "p4-0394-amazon" && totalPages > 4;
  const startPage = isCheckpointedCatalog
    ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages)
    : 1;
  const endPage = isCheckpointedCatalog
    ? Math.min(startPage + (startPage === 1 ? 3 : 2), totalPages)
    : totalPages;
  const jobsByUrl = new Map(first.jobs.map((job) => [job.officialUrl, job]));
  const seenIdentities = new Set<string>();
  let firstFailedPage: number | null = claimPageIdentities(
    first.jobs.map((job) => job.externalId ?? job.officialUrl),
    Math.min(pageSize, total),
    seenIdentities,
  ) ? null : 1;
  for (let page = Math.max(startPage, 2); page <= endPage; page += 1) {
    const result = await fetchPage((page - 1) * pageSize);
    const expected = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
    if (!result || !claimPageIdentities(
      result.jobs.map((job) => job.externalId ?? job.officialUrl), expected, seenIdentities,
    )) {
      firstFailedPage ??= page;
      continue;
    }
    for (const job of result.jobs) jobsByUrl.set(job.officialUrl, job);
  }
  const jobs = [...jobsByUrl.values()];
  if (isCheckpointedCatalog) {
    return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: false,
      jobs,
      pagination: {
        nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
        cycleComplete: firstFailedPage === null && endPage === totalPages,
        totalPages,
      },
      error: null,
    };
  }
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: total < 10_000 && firstFailedPage === null && jobs.length >= total,
    jobs,
    error: null,
  };
};

const serviceNowJobs = (markdown: string, source: CrawlSource): CrawledJob[] => jobsFromBrowserAnchors(
  markdownJobAnchors(markdown, source),
  source,
);

const careerSlugTitle = (slug: string): string => slug.split("-").filter(Boolean).map((token) => {
  const acronym = new Map([
    ["ai", "AI"], ["cs", "CS"], ["fde", "FDE"], ["it", "IT"], ["ml", "ML"], ["qa", "QA"], ["sr", "Sr"], ["ui", "UI"], ["us", "US"], ["ux", "UX"],
  ]).get(token.toLocaleLowerCase());
  return acronym ?? token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase();
}).join(" ");

const careerSlugLocation = (slug: string): string => slug.split("-").filter(Boolean).map((token) => (
  token.length === 2 || /^(?:usa|uk|uae|aus|nz)$/i.test(token)
    ? token.toLocaleUpperCase()
    : token.charAt(0).toLocaleUpperCase() + token.slice(1).toLocaleLowerCase()
)).join(" ");

const sitemapJobEntries = (xml: string, expectedHost: string): Array<{ url: string; lastModified: string | null }> => (
  [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((match) => {
    const rawUrl = match[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1];
    if (!rawUrl) return [];
    let url: URL;
    try {
      url = new URL(decodeHtmlAttribute(rawUrl.trim()));
    } catch {
      return [];
    }
    if (url.hostname !== expectedHost || !/^\/(?:[a-z]{2}\/)?jobs\/[^/]+\/[^/]+\/?$/i.test(url.pathname)) return [];
    const lastModified = match[1].match(/<lastmod(?:ified)?>\s*([\s\S]*?)\s*<\/lastmod(?:ified)?>/i)?.[1]?.trim() ?? null;
    return [{ url: url.href, lastModified }];
  })
);

const crawlJobSitemap = async (
  source: CrawlSource,
  endpoint: string,
  expectedHost: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/xml,text/xml;q=0.9" } });
    if (!response.ok) return null;
    const entries = sitemapJobEntries(await response.text(), expectedHost);
    if (entries.length === 0) return null;
    const jobs = entries.flatMap((entry): CrawledJob[] => {
      const segments = new URL(entry.url).pathname.split("/").filter(Boolean);
      const jobsIndex = segments.findIndex((segment) => segment.toLocaleLowerCase() === "jobs");
      const externalId = segments[jobsIndex + 1];
      const title = careerSlugTitle(segments[jobsIndex + 2] ?? "");
      if (!externalId || !title) return [];
      const programs = classifyJobPrograms(title);
      return [{
        externalId,
        title,
        company: source.company,
        location: null,
        arrangement: "unknown",
        employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId: externalId,
        ...(entry.lastModified ? { sourceUpdatedAt: normalizedDate(entry.lastModified) } : {}),
        officialUrl: entry.url,
        publishedAt: normalizedDate(entry.lastModified),
      }];
    });
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: jobs.length === entries.length,
      jobs,
      error: null,
    };
  } catch {
    return null;
  }
};

const crawlGraybarSitemap = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const endpoints = [
    "https://graybar.jobs/sitemaps/jobs_1.xml",
    // The branded site's own RSS metadata identifies this first-party
    // publication host. It serves the same canonical graybar.jobs URLs and
    // avoids edge rules that can reject Cloudflare Worker egress.
    "https://production--graybar-jobs.microsites.devpc.us/sitemaps/jobs_1.xml",
    "https://r.jina.ai/https://graybar.jobs/sitemaps/jobs_1.xml",
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: endpoint.includes("r.jina.ai") ? "text/plain" : "application/xml,text/xml;q=0.9" },
      }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) continue;
      const body = await response.text();
      const recordByUrl = new Map<string, string | null>();
      for (const match of body.matchAll(/https:\/\/graybar\.jobs\/[^/\s<>)\]]+\/[^/\s<>)\]]+\/[a-f0-9]{32}\/job\//gi)) {
        const rawUrl = match[0];
        if (recordByUrl.has(rawUrl)) continue;
        const following = body.slice((match.index ?? 0) + rawUrl.length, (match.index ?? 0) + rawUrl.length + 600);
        recordByUrl.set(rawUrl, following.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null);
      }
      const jobs = uniqueJobs([...recordByUrl].flatMap(([rawUrl, lastModified]): CrawledJob[] => {
      let officialUrl: URL;
      try {
          officialUrl = new URL(decodeHtmlAttribute(rawUrl.trim()));
      } catch {
        return [];
      }
      if (officialUrl.origin !== "https://graybar.jobs" || officialUrl.search || officialUrl.hash) return [];
      const match = officialUrl.pathname.match(/^\/([^/]+)\/([^/]+)\/([a-f0-9]{32})\/job\/$/i);
      if (!match) return [];
      const title = careerSlugTitle(match[2]);
      const location = careerSlugLocation(match[1]).replace(/\s+([A-Z]{2})$/, ", $1");
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId: match[3],
        title,
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(`${title} ${location}`) ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        locationCity: location.replace(/,\s*[A-Z]{2}$/, ""),
        locationState: location.match(/,\s*([A-Z]{2})$/)?.[1] ?? null,
        locationCountry: "United States",
        requisitionId: match[3],
        officialUrl: officialUrl.href,
        sourceUpdatedAt: normalizedDate(lastModified),
        publishedAt: normalizedDate(lastModified),
      }];
      }));
      if (jobs.length === 0 || jobs.length !== recordByUrl.size) continue;
      return {
        status: "succeeded",
        responseStatus: response.status,
        // Jobsyn currently caps this sitemap at 500 entries while its live API
        // can advertise a slightly larger catalog. It is an ingestion fallback,
        // never an authoritative signal for closing previously seen jobs.
        completeListing: false,
        jobs,
        resolvedListingUrl: "https://graybar.jobs/jobs/",
        error: null,
      };
    } catch {
      continue;
    }
  }
  return null;
};

const crawlGraybar = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const canonical = { ...source, postingUrl: "https://graybar.jobs/jobs/", adapter: "custom" as const };
  const direct = await crawlJobsyn(canonical, fetcher);
  if (direct.status === "succeeded") return direct;
  return await crawlGraybarSitemap(canonical, fetcher) ?? direct;
};

const htmlBlocksStartingAt = (html: string, pattern: RegExp): string[] => {
  const starts = [...html.matchAll(pattern)].map((match) => match.index ?? 0);
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
};

const normalizedUsDate = (value: string | null): string | null => {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))).toISOString() : normalizedDate(value);
};

const crawlEogJobs = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://careers.eogresources.com/Process_jobsearch.asp";
  try {
    const response = await fetchWithTimeout(fetcher, listingUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `EOG job search returned HTTP ${response.status}.` };
    const html = await response.text();
    const blocks = htmlBlocksStartingAt(html, /<div\b[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*>/gi);
    const jobs = uniqueJobs(blocks.flatMap((block): CrawledJob[] => {
      const anchor = anchorsFromHtml(block).find(({ href, text }) => /jobdetails\.asp\?[^#]*\bjo_num=\d+/i.test(href) && !/^job details$/i.test(text));
      if (!anchor?.text) return [];
      const officialUrl = new URL(anchor.href, listingUrl);
      const externalId = officialUrl.searchParams.get("jo_num");
      if (!externalId) return [];
      const fields = [...block.matchAll(/<div\b[^>]*class=["'][^"']*\bthinrow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
        .map((match) => plainText(decodeHtmlAttribute(match[1]).replace(/&nbsp;|&#160;/gi, " "))).filter((value): value is string => Boolean(value));
      const location = fields.find((value) => !/^posted\b/i.test(value)) ?? null;
      const posted = fields.find((value) => /^posted\b/i.test(value))?.replace(/^posted\s*/i, "") ?? null;
      const programs = classifyJobPrograms(anchor.text).keys;
      return [{
        externalId,
        title: decodeHtmlAttribute(anchor.text),
        company: source.company,
        location,
        arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        locationCity: location?.replace(/,\s*[A-Z]{2}$/, "") ?? null,
        locationState: location?.match(/,\s*([A-Z]{2})$/)?.[1] ?? null,
        locationCountry: "United States",
        requisitionId: externalId,
        officialUrl: officialUrl.href,
        publishedAt: normalizedUsDate(posted),
      }];
    }));
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: jobs.length > 0 && jobs.length === blocks.length,
      jobs,
      resolvedListingUrl: listingUrl,
      error: jobs.length > 0 ? null : "EOG job search contained no usable jobs.",
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown EOG crawler error." };
  }
};

const crawlAmeripriseJobs = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://careers.ameriprise.com/search-jobs/";
  try {
    const response = await fetchWithTimeout(fetcher, "https://careers.ameriprise.com/sitemap.xml", {
      headers: { accept: "application/xml,text/xml;q=0.9" },
    }, true, { attempts: 1, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Ameriprise sitemap returned HTTP ${response.status}.` };
    const xml = await response.text();
    const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((entry) => {
      const rawUrl = entry[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1];
      if (!rawUrl) return [];
      let url: URL;
      try {
        url = new URL(decodeHtmlAttribute(rawUrl.trim()));
      } catch {
        return [];
      }
      const match = url.pathname.match(/^\/search-jobs\/([^/]+)\/([^/]+)\/$/i);
      if (url.origin !== "https://careers.ameriprise.com" || !match || url.search || url.hash) return [];
      const lastModified = entry[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1]?.trim() ?? null;
      return [{ url, externalId: match[1], title: careerSlugTitle(match[2]), lastModified }];
    });
    const jobs = uniqueJobs(entries.map((entry): CrawledJob => {
      const programs = classifyJobPrograms(entry.title).keys;
      return {
        externalId: entry.externalId,
        title: entry.title,
        company: source.company,
        location: null,
        arrangement: "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId: entry.externalId,
        officialUrl: entry.url.href,
        sourceUpdatedAt: normalizedDate(entry.lastModified),
        publishedAt: normalizedDate(entry.lastModified),
      };
    }));
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: jobs.length > 0 && jobs.length === entries.length,
      jobs,
      resolvedListingUrl: listingUrl,
      error: jobs.length > 0 ? null : "Ameriprise sitemap contained no usable jobs.",
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown Ameriprise crawler error." };
  }
};

const cardinalSlug = (value: string): string => value.toLocaleLowerCase()
  .replace(/ /g, "-")
  .replace(/[^a-z0-9_\u3400-\u9fbf\s-]/g, "");

const crawlCardinalHealth = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://jobs.cardinalhealth.com/search-jobs";
  const pageSize = 1_000;
  const fetchPage = async (offset: number): Promise<{ status: number; payload: CardinalPayload } | null> => {
    try {
      const endpoint = new URL("https://jobs.cardinalhealth.com/Search/SearchResults");
      endpoint.searchParams.set("jtStartIndex", String(offset));
      endpoint.searchParams.set("jtPageSize", String(pageSize));
      const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json", referer: listingUrl } }, true, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const raw = await response.json() as CardinalPayload | string;
      const payload = typeof raw === "string" ? JSON.parse(raw) as CardinalPayload : raw;
      if (payload.Result !== "OK" || !Array.isArray(payload.Records) || !Number.isInteger(payload.TotalRecordCount)) return null;
      return { status: response.status, payload };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0);
  if (!first || !first.payload.TotalRecordCount || first.payload.Records!.length !== Math.min(pageSize, first.payload.TotalRecordCount)) {
    return { status: "failed", responseStatus: first?.status ?? null, completeListing: false, jobs: [], error: "Cardinal Health job API did not return a usable first page." };
  }
  const total = first.payload.TotalRecordCount;
  const offsets = Array.from({ length: Math.ceil(total / pageSize) - 1 }, (_, index) => (index + 1) * pageSize);
  const remaining = await Promise.all(offsets.map(fetchPage));
  const pages = [first, ...remaining];
  const records = pages.flatMap((page) => page?.payload.Records ?? []);
  const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
    const tracking = record.TrackingObject;
    const title = tracking?.TitleJson?.trim();
    const externalId = tracking?.ReferenceNumberJson?.trim() ?? record.ID?.trim();
    if (!record.ID || !externalId || !title) return [];
    const locations = tracking?.CityStatesDataAbbrevJson?.filter(Boolean) ?? [];
    const countries = tracking?.CountryNamesJson?.filter(Boolean) ?? [];
    const categories = [...new Set([...(tracking?.ActivateCategoryNamesJson ?? []), ...(tracking?.AtsCategoryNamesJson ?? [])].filter(Boolean))];
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location: locations.join("; ") || null,
      arrangement: record.IsRemote ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(tracking?.TypeNameJson),
      summary: null,
      ...(categories.length ? { department: categories.join("; "), jobFunction: categories.join("; ") } : {}),
      ...(tracking?.LocationNamesJson?.length ? { office: tracking.LocationNamesJson.join("; ") } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
      locationCity: tracking?.CityNamesJson?.[0] ?? null,
      locationState: tracking?.StateNamesJson?.[0] ?? null,
      locationCountry: countries[0] ?? null,
      locationPostalCode: tracking?.ZipCodesJson?.[0] ?? null,
      requisitionId: tracking?.ReferenceNumberJson ?? externalId,
      officialUrl: new URL(`/search/jobdetails/${cardinalSlug(title)}/${record.ID}`, "https://jobs.cardinalhealth.com").href,
      publishedAt: normalizedDate(record.PostedDateRaw ?? tracking?.PostedDateJson),
    }];
  }));
  const everyPageUsable = pages.every((page, index) => page
    && page.payload.TotalRecordCount === total
    && page.payload.Records!.length === Math.min(pageSize, total - index * pageSize));
  return {
    status: jobs.length > 0 ? "succeeded" : "failed",
    responseStatus: first.status,
    completeListing: jobs.length > 0 && everyPageUsable && jobs.length === records.length && records.length === total,
    jobs,
    resolvedListingUrl: listingUrl,
    error: jobs.length > 0 ? null : "Cardinal Health job API contained no usable jobs.",
  };
};

const crawlActivateJobSearch = async (
  source: CrawlSource,
  html: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  if (!/(?:ReusableComponents\/JobSearchResultsTable|SearchResultsManager|\/Search\/SearchResults)/i.test(html)) return null;
  const listingUrl = new URL(source.postingUrl);
  const endpoint = new URL("/Search/SearchResults", listingUrl.origin);
  endpoint.searchParams.set("jtStartIndex", "0");
  endpoint.searchParams.set("jtPageSize", "10000");
  endpoint.searchParams.set("jtSorting", "");
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      headers: { accept: "application/json", referer: listingUrl.href },
    }, true, { attempts: 1, timeoutMs: 15_000 });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Activate job API returned HTTP ${response.status}.`,
    };
    const raw = await response.json() as CardinalPayload | string;
    const payload = typeof raw === "string" ? JSON.parse(raw) as CardinalPayload : raw;
    const total = payload.TotalRecordCount;
    const records = payload.Records;
    if (payload.Result !== "OK" || !Number.isInteger(total) || (total ?? -1) <= 0 || !Array.isArray(records)) {
      return {
        status: "failed",
        responseStatus: response.status,
        completeListing: false,
        jobs: [],
        error: "Activate job API did not return a nonempty usable catalog.",
      };
    }
    const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
      const tracking = record.TrackingObject;
      const id = record.ID?.trim();
      const title = plainText(tracking?.TitleJson ?? record.Title);
      if (!id || !title) return [];
      const locations = tracking?.CityStatesDataAbbrevJson?.filter(Boolean)
        ?? [plainText(record.CityStateDataAbbrev ?? record.LocationName)].filter((value): value is string => Boolean(value));
      const countries = tracking?.CountryNamesJson?.filter(Boolean)
        ?? [plainText(record.CountryName)].filter((value): value is string => Boolean(value));
      const categories = [...new Set([
        ...(tracking?.ActivateCategoryNamesJson ?? []),
        ...(tracking?.AtsCategoryNamesJson ?? []),
      ].map((value) => plainText(value)).filter((value): value is string => Boolean(value)))];
      const families = [...new Set([
        ...(tracking?.ActivateFamilyNamesJson ?? []),
        ...(tracking?.AtsFamilyNamesJson ?? []),
      ].map((value) => plainText(value)).filter((value): value is string => Boolean(value)))];
      const requisitionId = plainText(tracking?.ReferenceNumberJson ?? record.ReferenceNumber) ?? id;
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId: id,
        title,
        company: source.company,
        location: locations.join("; ") || null,
        arrangement: record.IsRemote ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop")
          ? "Internship"
          : normalizeEmploymentType(tracking?.TypeNameJson ?? record.TypeName),
        summary: null,
        ...(categories.length ? { department: plainText(record.DepartmentName) ?? categories.join("; "), jobFunction: categories.join("; ") } : {}),
        ...(families.length ? { jobFamily: families.join("; ") } : {}),
        ...(tracking?.LocationNamesJson?.length ? { office: tracking.LocationNamesJson.join("; ") } : {}),
        ...(locations.length > 1 ? { secondaryLocations: locations.slice(1) } : {}),
        locationCity: tracking?.CityNamesJson?.[0] ?? plainText(record.CityName),
        locationState: tracking?.StateNamesJson?.[0] ?? plainText(record.StateName),
        locationCountry: countries[0] ?? null,
        locationPostalCode: tracking?.ZipCodesJson?.[0] ?? plainText(record.ZipCode),
        requisitionId,
        officialUrl: new URL(`/search/jobdetails/${cardinalSlug(title)}/${id}`, listingUrl.origin).href,
        sourcePostedText: plainText(record.PostedDate ?? record.PostedDateRaw ?? tracking?.PostedDateJson),
        publishedAt: normalizedDate(record.PostedDateRaw ?? tracking?.PostedDateJson ?? record.PostedDate),
      }];
    }));
    const rawIds = records.map((record) => record.ID?.trim()).filter((value): value is string => Boolean(value));
    const exact = total! <= 10_000
      && records.length === total
      && rawIds.length === records.length
      && new Set(rawIds).size === records.length
      && jobs.length === records.length;
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: jobs.length > 0 && exact,
      jobs,
      resolvedListingUrl: listingUrl.href,
      error: jobs.length > 0 ? null : "Activate job API contained no usable jobs.",
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Activate crawler error.",
    };
  }
};

const mCloudConfigFromHtml = (html: string): MCloudConfig | null => {
  const searchable = html.replaceAll("\\/", "/").replaceAll("&quot;", '"').replaceAll("&#34;", '"');
  const apiMatch = searchable.match(
    /(?:set_api\(\s*|["']api["']\s*:\s*)["']\s*(https:\/\/jobsapi-google\.m-cloud\.io\/api\/?)\s*["']/i,
  );
  const organization = searchable.match(
    /(?:\borg_id\b|["']org["'])\s*:\s*["'](companies\/[a-z0-9-]+)["']/i,
  )?.[1];
  if (!apiMatch || !organization) return null;
  let apiUrl: URL;
  try {
    apiUrl = new URL(apiMatch[1]);
  } catch {
    return null;
  }
  if (apiUrl.origin !== "https://jobsapi-google.m-cloud.io" || !/^\/api\/?$/i.test(apiUrl.pathname)) return null;
  apiUrl.pathname = "/api/";
  apiUrl.search = "";
  apiUrl.hash = "";

  const filterBody = searchable.match(/["']?filters["']?\s*:\s*\[([\s\S]{0,2000}?)\]/i)?.[1] ?? "";
  const filters = [...filterBody.matchAll(/["']([A-Za-z0-9_.-]+):([^"']+)["']/g)]
    .map((match) => ({ key: match[1], value: match[2].trim() }))
    .filter(({ value }) => value.length > 0);
  return { apiUrl: apiUrl.href, organization, filters };
};

const crawlMCloudCatalog = async (
  source: CrawlSource,
  config: MCloudConfig,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const listingUrl = new URL(source.postingUrl);
  const pageSize = 100;
  // The landing-page request plus 48 API pages and one stability check keeps
  // the complete source invocation at the hard 50-request ceiling.
  const maxPages = 48;
  const customAttributeFilter = config.filters
    .map(({ key, value }) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(" AND ");
  const fetchPage = async (offset: number): Promise<{ status: number; payload: MCloudPayload } | null> => {
    try {
      const endpoint = new URL("job/search", config.apiUrl);
      endpoint.searchParams.set("pageSize", String(pageSize));
      endpoint.searchParams.set("offset", String(offset));
      endpoint.searchParams.set("companyName", config.organization);
      if (customAttributeFilter) endpoint.searchParams.set("customAttributeFilter", customAttributeFilter);
      endpoint.searchParams.set("orderBy", "posting_publish_time desc");
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: "application/json", referer: listingUrl.href },
      }, true, { attempts: 1, timeoutMs: 8_000 });
      if (!response.ok) return null;
      const payload = await response.json() as MCloudPayload;
      if (!Number.isInteger(payload.totalHits) || !Array.isArray(payload.searchResults)) return null;
      return { status: response.status, payload };
    } catch {
      return null;
    }
  };

  const first = await fetchPage(0);
  const total = first?.payload.totalHits ?? 0;
  if (!first || total <= 0) return {
    status: "failed",
    responseStatus: first?.status ?? null,
    completeListing: false,
    jobs: [],
    error: "M-Cloud did not return a nonempty usable first catalog page.",
  };
  const totalPages = Math.ceil(total / pageSize);
  const fetchedPages = Math.min(totalPages, maxPages);
  const offsets = Array.from({ length: fetchedPages - 1 }, (_, index) => (index + 1) * pageSize);
  const pages: Array<{ status: number; payload: MCloudPayload } | null> = [first];
  for (let index = 0; index < offsets.length; index += 8) {
    pages.push(...await Promise.all(offsets.slice(index, index + 8).map(fetchPage)));
  }

  const rawJobs = pages.flatMap((page) => page?.payload.searchResults?.flatMap((result) => result.job ? [result.job] : []) ?? []);
  const expectedHost = listingUrl.hostname.replace(/^www\./i, "");
  const jobs = uniqueJobs(rawJobs.flatMap((job): CrawledJob[] => {
    const externalId = job.id == null ? null : String(job.id);
    const title = asText(job.title);
    const rawOfficialUrl = asText(job.url);
    if (!externalId || !title || !rawOfficialUrl) return [];
    let officialUrl: URL;
    try {
      officialUrl = new URL(rawOfficialUrl, listingUrl);
      if (officialUrl.hostname.replace(/^www\./i, "") !== expectedHost) return [];
      officialUrl.protocol = "https:";
      officialUrl.hash = "";
    } catch {
      return [];
    }
    const primaryLocation = [job.primary_city, job.primary_state, job.primary_country].filter(Boolean).join(", ") || null;
    const secondaryLocations = (job.addtnl_locations ?? []).map((location) =>
      [location.addtnl_city, location.addtnl_state, location.addtnl_country].filter(Boolean).join(", "))
      .filter(Boolean);
    const description = plainText(job.description);
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location: primaryLocation,
      arrangement: /work from home|remote/i.test(job.compliment ?? "")
        ? "remote"
        : /hybrid/i.test(job.compliment ?? "") ? "hybrid" : /office|on.?site/i.test(job.compliment ?? "") ? "onsite" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(job.employment_type),
      summary: description,
      description,
      department: asText(job.department),
      jobFamily: asText(job.primary_category),
      experienceLevel: asText(job.level),
      secondaryLocations,
      locationCity: asText(job.primary_city),
      locationState: asText(job.primary_state),
      locationCountry: asText(job.primary_country),
      requisitionId: asText(job.ref) ?? externalId,
      applyUrl: asText(job.seo_url),
      officialUrl: officialUrl.href,
      publishedAt: normalizedDate(job.open_date),
      validThrough: normalizedDate(job.close_date),
    }];
  }));
  const rawIds = rawJobs.map((job) => job.id == null ? null : String(job.id)).filter((id): id is string => Boolean(id));
  const everyPageUsable = pages.every((page, index) => page
    && page.payload.totalHits === total
    && page.payload.searchResults?.length === Math.min(pageSize, total - index * pageSize)
    && page.payload.searchResults.every(({ job }) => Boolean(job?.id != null && asText(job.title) && asText(job.url))));
  let completeListing = totalPages <= maxPages
    && everyPageUsable
    && rawJobs.length === total
    && rawIds.length === total
    && new Set(rawIds).size === total
    && jobs.length === total;
  if (completeListing) {
    const verification = await fetchPage(0);
    const initialIds = first.payload.searchResults!.map(({ job }) => job?.id == null ? null : String(job.id));
    const verificationIds = verification?.payload.searchResults?.map(({ job }) => job?.id == null ? null : String(job.id)) ?? [];
    if (!verification || verification.payload.totalHits !== total
      || verificationIds.length !== initialIds.length
      || initialIds.some((identity, index) => identity !== verificationIds[index])) completeListing = false;
  }
  return {
    status: jobs.length > 0 ? "succeeded" : "failed",
    responseStatus: first.status,
    completeListing,
    jobs,
    resolvedListingUrl: listingUrl.href,
    error: jobs.length > 0 ? null : "M-Cloud catalog contained no usable jobs.",
  };
};

const crawlVanguard = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://www.vanguardjobs.com/job-search-results/";
  const pageSize = 10;
  const maxPages = 50;
  const fetchPage = async (offset: number): Promise<{ status: number; payload: MCloudPayload } | null> => {
    try {
      const endpoint = new URL("https://jobsapi-google.m-cloud.io/api/job/search");
      endpoint.searchParams.set("pageSize", String(pageSize));
      endpoint.searchParams.set("offset", String(offset));
      endpoint.searchParams.set("companyName", "companies/fbd5ce04-22d1-4aae-90dc-0282e45ee06f");
      endpoint.searchParams.set("customAttributeFilter", 'is_internal="External"');
      endpoint.searchParams.set("orderBy", "posting_publish_time desc");
      const response = await fetchWithTimeout(fetcher, endpoint, {
        headers: { accept: "application/json", referer: listingUrl },
      }, true, { attempts: 1, timeoutMs: 8_000 });
      if (!response.ok) return null;
      const payload = await response.json() as MCloudPayload;
      if (!Number.isInteger(payload.totalHits) || !Array.isArray(payload.searchResults)) return null;
      return { status: response.status, payload };
    } catch {
      return null;
    }
  };

  const first = await fetchPage(0);
  const total = first?.payload.totalHits ?? 0;
  if (!first || total <= 0) return {
    status: "failed",
    responseStatus: first?.status ?? null,
    completeListing: false,
    jobs: [],
    error: "Vanguard's official jobs API did not return a usable first page.",
  };

  const totalPages = Math.ceil(total / pageSize);
  const fetchedPages = Math.min(totalPages, maxPages);
  const offsets = Array.from({ length: fetchedPages - 1 }, (_, index) => (index + 1) * pageSize);
  const pages: Array<{ status: number; payload: MCloudPayload } | null> = [first];
  for (let index = 0; index < offsets.length; index += 8) {
    pages.push(...await Promise.all(offsets.slice(index, index + 8).map(fetchPage)));
  }

  const rawJobs = pages.flatMap((page) => page?.payload.searchResults?.flatMap((result) => result.job ? [result.job] : []) ?? []);
  const jobs = uniqueJobs(rawJobs.flatMap((job): CrawledJob[] => {
    const externalId = job.id == null ? null : String(job.id);
    const title = asText(job.title);
    const rawOfficialUrl = asText(job.url);
    if (!externalId || !title || !rawOfficialUrl) return [];
    let officialUrl: URL;
    try {
      officialUrl = new URL(rawOfficialUrl, listingUrl);
      if (officialUrl.hostname !== "www.vanguardjobs.com") return [];
      officialUrl.protocol = "https:";
    } catch {
      return [];
    }
    const primaryLocation = [job.primary_city, job.primary_state, job.primary_country].filter(Boolean).join(", ") || null;
    const secondaryLocations = (job.addtnl_locations ?? []).map((location) =>
      [location.addtnl_city, location.addtnl_state, location.addtnl_country].filter(Boolean).join(", "))
      .filter(Boolean);
    const description = plainText(job.description);
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location: primaryLocation,
      arrangement: /work from home|remote/i.test(job.compliment ?? "")
        ? "remote"
        : /hybrid/i.test(job.compliment ?? "") ? "hybrid" : /office|on.?site/i.test(job.compliment ?? "") ? "onsite" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop")
        ? "Internship"
        : normalizeEmploymentType(job.employment_type),
      summary: description,
      description,
      department: asText(job.department),
      jobFamily: asText(job.primary_category),
      experienceLevel: asText(job.level),
      secondaryLocations,
      locationCity: asText(job.primary_city),
      locationState: asText(job.primary_state),
      locationCountry: asText(job.primary_country),
      requisitionId: asText(job.ref) ?? externalId,
      applyUrl: asText(job.seo_url),
      officialUrl: officialUrl.href,
      publishedAt: normalizedDate(job.open_date),
      validThrough: normalizedDate(job.close_date),
    }];
  }));
  const everyPageUsable = pages.every((page, index) => page
    && page.payload.totalHits === total
    && page.payload.searchResults?.length === Math.min(pageSize, total - index * pageSize)
    && page.payload.searchResults.every(({ job }) => Boolean(job?.id != null && asText(job.title) && asText(job.url))));
  return {
    status: jobs.length > 0 ? "succeeded" : "failed",
    responseStatus: first.status,
    completeListing: totalPages <= maxPages && everyPageUsable && rawJobs.length === total && jobs.length === total,
    jobs,
    resolvedListingUrl: listingUrl,
    error: jobs.length > 0 ? null : "Vanguard's official jobs API contained no usable jobs.",
  };
};

const crawlNewsCorpSitemap = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const endpoint = "https://careers.newscorp.com/sitemaps/jobs_1.xml";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      headers: { accept: "application/xml,text/xml;q=0.9" },
    }, false, { attempts: 1, timeoutMs: 12_000 });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `News Corp job sitemap returned HTTP ${response.status}.`,
    };
    const entries = [...(await response.text()).matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((match) => {
      const rawUrl = match[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1];
      if (!rawUrl) return [];
      let url: URL;
      try {
        url = new URL(decodeHtmlAttribute(rawUrl.trim()));
      } catch {
        return [];
      }
      const segments = url.pathname.split("/").filter(Boolean);
      if (url.origin !== "https://careers.newscorp.com"
        || segments.length !== 4
        || segments[3].toLocaleLowerCase() !== "job"
        || !/^[a-f0-9]{32}$/i.test(segments[2])) return [];
      const lastModified = match[1].match(/<lastmod(?:ified)?>\s*([\s\S]*?)\s*<\/lastmod(?:ified)?>/i)?.[1]?.trim() ?? null;
      return [{ url: url.href, location: careerSlugLocation(segments[0]), title: careerSlugTitle(segments[1]), externalId: segments[2], lastModified }];
    });
    const jobs = entries.map((entry): CrawledJob => {
      const programs = classifyJobPrograms(entry.title);
      return {
        externalId: entry.externalId,
        title: entry.title,
        company: source.company,
        location: entry.location,
        arrangement: /virtual|remote/i.test(entry.location) ? "remote" : "unknown",
        employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId: entry.externalId,
        ...(entry.lastModified ? { sourceUpdatedAt: normalizedDate(entry.lastModified) } : {}),
        officialUrl: entry.url,
        publishedAt: normalizedDate(entry.lastModified),
      };
    });
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: jobs.length > 0 && jobs.length === entries.length
        && new Set(jobs.map((job) => job.externalId)).size === jobs.length,
      jobs,
      resolvedListingUrl: "https://careers.newscorp.com/jobs/",
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown News Corp sitemap error.",
    };
  }
};

const crawlOlympusSuccessFactors = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const listingUrl = "https://careers.olympusamerica.com/search/?q=&sortColumn=referencedate&sortDirection=desc";
  const fetchPage = async (startRow: number): Promise<{ status: number; html: string } | null> => {
    try {
      const url = new URL(listingUrl);
      if (startRow > 0) url.searchParams.set("startrow", String(startRow));
      const response = await fetchWithTimeout(fetcher, url, undefined, true, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      return { status: response.status, html: await response.text() };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0);
  if (!first) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Olympus job search did not return a usable first page." };
  const range = successFactorsRange(first.html);
  if (!range || range.total < 1) return { status: "failed", responseStatus: first.status, completeListing: false, jobs: [], error: "Olympus job search did not advertise a usable result count." };
  const offsets = Array.from({ length: Math.max(0, Math.ceil(range.total / range.pageSize) - 1) }, (_, index) => (index + 1) * range.pageSize);
  const pages = await Promise.all(offsets.map(fetchPage));
  const pageHtml = [first.html, ...pages.flatMap((page) => page ? [page.html] : [])];
  const jobs = uniqueJobs(pageHtml.flatMap((html) => [...html.matchAll(/<tr\b[^>]*class=["'][^"']*data-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .flatMap((row): CrawledJob[] => {
      const anchor = anchorsFromHtml(row[1]).find(({ href }) => /\/job\/[^?#]+\/\d+\/?(?:[?#]|$)/i.test(href));
      if (!anchor?.text) return [];
      const officialUrl = new URL(anchor.href, listingUrl);
      const externalId = officialUrl.pathname.split("/").filter(Boolean).at(-1) ?? null;
      const location = plainText(row[1].match(/class=["'][^"']*jobLocation[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) ?? null;
      const requisitionId = plainText(row[1].match(/class=["'][^"']*jobFacility[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) ?? externalId;
      const title = anchor.text;
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote|virtual/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId,
        officialUrl: officialUrl.href,
        publishedAt: null,
      }];
    })));
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: pages.every((page) => page !== null) && jobs.length === range.total,
    jobs,
    resolvedListingUrl: listingUrl,
    error: null,
  };
};

const jobviteRowBlocks = (html: string): string[] => [
  ...[...html.matchAll(/<li\b[^>]*class=["'][^"']*\brow\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]),
  ...[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]),
];

const crawlJobviteBoard = async (
  source: CrawlSource,
  listingUrl: string,
  tenant: string,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  try {
    const response = await fetchWithTimeout(fetcher, listingUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `${source.company} Jobvite board returned HTTP ${response.status}.` };
    const html = await response.text();
    const detailPath = new RegExp(`^/${tenant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/job/[a-z0-9_-]+/?$`, "i");
    const detailAnchors = anchorsFromHtml(html).filter(({ href }) => {
      try {
        const url = new URL(href, listingUrl);
        return /^(?:www\.)?jobs\.jobvite\.com$/i.test(url.hostname) && detailPath.test(url.pathname);
      } catch {
        return false;
      }
    });
    const blocks = jobviteRowBlocks(html).filter((block) => anchorsFromHtml(block).some(({ href }) => {
      try {
        return detailPath.test(new URL(href, listingUrl).pathname);
      } catch {
        return false;
      }
    }));
    const jobs = uniqueJobs(blocks.flatMap((block): CrawledJob[] => {
      const anchor = anchorsFromHtml(block).find(({ href }) => {
        try {
          return detailPath.test(new URL(href, listingUrl).pathname);
        } catch {
          return false;
        }
      });
      if (!anchor?.text) return [];
      const officialUrl = new URL(anchor.href, listingUrl);
      const externalId = officialUrl.pathname.split("/").filter(Boolean).at(-1) ?? null;
      const title = decodeHtmlAttribute(plainText(block.match(/class=["'][^"']*jv-job-list-name[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|td)>/i)?.[1]) ?? anchor.text);
      const locationText = plainText(block.match(/class=["'][^"']*jv-job-list-location[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|td)>/i)?.[1]);
      const location = locationText ? decodeHtmlAttribute(locationText) : null;
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId: externalId,
        officialUrl: officialUrl.href,
        publishedAt: null,
      }];
    }));
    const explicitlyEmpty = /\b(?:there are currently no open jobs|no current (?:job )?openings)\b/i.test(plainText(html) ?? "");
    const hasNextPage = anchorsFromHtml(html).some(({ href, text }) => /(?:[?&](?:p|page)=\d+|\/page\/\d+)/i.test(href) && /next|\d+/i.test(text));
    return {
      status: jobs.length > 0 || explicitlyEmpty ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: explicitlyEmpty || (jobs.length > 0
        && jobs.length === blocks.length
        && jobs.length === detailAnchors.length
        && !hasNextPage),
      jobs,
      resolvedListingUrl: listingUrl.replace(/\/$/, ""),
      error: jobs.length > 0 || explicitlyEmpty ? null : `${source.company} Jobvite board contained no usable jobs.`,
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : `Unknown ${source.company} Jobvite error.` };
  }
};

type AceJobsPayload = {
  postings?: { jobs?: string };
  showing?: string;
};

const aceJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => uniqueJobs(
  [...html.matchAll(/<div\b[^>]*class=["'][^"']*search--item[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*search--item|$)/gi)]
    .flatMap((match): CrawledJob[] => {
      const anchor = anchorsFromHtml(match[1]).find(({ href }) => /\/posting\/[^?#]+\/[a-z0-9-]{6,}/i.test(href));
      if (!anchor?.text) return [];
      const officialUrl = new URL(anchor.href, "https://careers.acehardware.com");
      const externalId = officialUrl.pathname.split("/").filter(Boolean).at(-1) ?? null;
      const fields = [...match[1].matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((field) => [plainText(field[1]) ?? "", plainText(field[2]) ?? ""] as const);
      const location = fields.find(([label]) => /^location$/i.test(label))?.[1] ?? null;
      const category = fields.find(([label]) => /^category$/i.test(label))?.[1] ?? null;
      const programs = classifyJobPrograms(anchor.text).keys;
      return [{
        externalId,
        title: anchor.text,
        company: source.company,
        location,
        arrangement: /remote/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: category,
        ...(category ? { department: category } : {}),
        requisitionId: externalId,
        officialUrl: officialUrl.href,
        publishedAt: null,
      }];
    }),
);

const crawlAceJobs = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const pageSize = 100;
  const endpointFor = (page: number): string => {
    const endpoint = new URL("https://careers.acehardware.com/wp-content/themes/acecareers/theme/get-jobs.php");
    for (const [key, value] of Object.entries({ ajax: "1", radius: "", lat: "", lng: "", keyword: "", state: "", city: "", location: "", category: "", career_area: "", country: "", spage: String(page) })) endpoint.searchParams.set(key, value);
    return endpoint.href;
  };
  const fetchPage = async (page: number): Promise<{ status: number; total: number; jobs: CrawledJob[] } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpointFor(page), { headers: { accept: "application/json" } }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as AceJobsPayload;
      const total = Number(payload.showing?.match(/\bof\s+([\d,]+)\s+Results\b/i)?.[1]?.replaceAll(",", ""));
      if (!Number.isFinite(total) || total < 1 || typeof payload.postings?.jobs !== "string") return null;
      return { status: response.status, total, jobs: aceJobsFromHtml(payload.postings.jobs, source) };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(1);
  if (!first || first.jobs.length !== Math.min(pageSize, first.total)) return { status: "failed", responseStatus: first?.status ?? null, completeListing: false, jobs: [], error: "Ace Hardware job API did not return a usable first page." };
  const totalPages = Math.ceil(first.total / pageSize);
  const startPage = Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages);
  const endPage = Math.min(startPage + (startPage === 1 ? 7 : 6), totalPages);
  const pageNumbers = Array.from({ length: Math.max(0, endPage - Math.max(startPage, 2) + 1) }, (_, index) => Math.max(startPage, 2) + index);
  const pages: Array<{ status: number; total: number; jobs: CrawledJob[] } | null> = [];
  for (let index = 0; index < pageNumbers.length; index += 5) pages.push(...await Promise.all(pageNumbers.slice(index, index + 5).map(fetchPage)));
  const seen = new Set(first.jobs.map((job) => job.externalId ?? job.officialUrl));
  let firstFailedPage: number | null = null;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = pageNumbers[index];
    const expected = Math.min(pageSize, first.total - (pageNumber - 1) * pageSize);
    if (!page || page.total !== first.total || !claimPageIdentities(page.jobs.map((job) => job.externalId ?? job.officialUrl), expected, seen)) {
      firstFailedPage = pageNumber;
      break;
    }
  }
  const jobs = uniqueJobs([first.jobs, ...pages.flatMap((page) => page?.jobs ?? [])].flat());
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: false,
    jobs,
    pagination: {
      nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
      cycleComplete: firstFailedPage === null && endPage === totalPages,
      totalPages,
    },
    resolvedListingUrl: "https://careers.acehardware.com/job-search/",
    error: null,
  };
};

const crawlAstronicsRss = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://client.hrservicesinc.com/downloads/rss/portals/2110.xml";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/rss+xml,application/xml,text/xml" } }, false, { attempts: 1, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Astronics RSS returned HTTP ${response.status}.` };
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    const jobs = uniqueJobs(items.flatMap((match): CrawledJob[] => {
      const rawTitle = plainText(match[1].match(/<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i)?.[1]);
      const rawUrl = match[1].match(/<link>\s*([\s\S]*?)\s*<\/link>/i)?.[1];
      if (!rawTitle || !rawUrl) return [];
      const officialUrl = new URL(decodeHtmlAttribute(rawUrl.trim()));
      if (officialUrl.origin !== "https://www.appone.com" || officialUrl.pathname !== "/MainInfoReq.asp") return [];
      const externalId = officialUrl.searchParams.get("R_ID");
      if (!externalId) return [];
      const locationMatch = rawTitle.match(/\s+\(([A-Z]{2}),\s*([^)]+)\)\s*$/);
      const title = locationMatch ? rawTitle.slice(0, locationMatch.index).trim() : rawTitle;
      const location = locationMatch ? `${locationMatch[2]}, ${locationMatch[1]}` : null;
      const description = plainText(match[1].match(/<description>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/description>/i)?.[1]);
      const published = plainText(match[1].match(/<pubDate>\s*([\s\S]*?)\s*<\/pubDate>/i)?.[1]);
      const programs = classifyJobPrograms(title).keys;
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote/i.test(location ?? "") ? "remote" : "unknown",
        employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: description?.slice(0, 500) ?? null,
        ...(description ? { description } : {}),
        requisitionId: externalId,
        officialUrl: officialUrl.href,
        publishedAt: normalizedDate(published),
      }];
    }));
    return {
      status: jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: jobs.length > 0 && jobs.length === items.length,
      jobs,
      resolvedListingUrl: "https://www.astronics.com/us-jobs",
      error: jobs.length > 0 ? null : "Astronics RSS contained no usable jobs.",
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown Astronics RSS error." };
  }
};

type GraphicPackagingJob = {
  requisitionId?: string;
  title?: string;
  department?: string;
  location?: string;
  employmentType?: string;
  datePosted?: string;
  applyUrl?: string;
  description?: string;
};

const crawlGraphicPackaging = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const pageSize = 100;
  const fetchPage = async (page: number): Promise<{ status: number; total: number; jobs: GraphicPackagingJob[] } | null> => {
    try {
      const endpoint = new URL("https://careers.graphicpkg.com/api/mcp/jobs");
      endpoint.searchParams.set("tool", "search_jobs");
      endpoint.searchParams.set("page", String(page));
      endpoint.searchParams.set("pageSize", String(pageSize));
      const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, false, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as { totalCount?: number; results?: GraphicPackagingJob[] };
      if (!Number.isFinite(payload.totalCount) || !Array.isArray(payload.results)) return null;
      return { status: response.status, total: payload.totalCount!, jobs: payload.results };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(1);
  if (!first || first.total < 1) return { status: "failed", responseStatus: first?.status ?? null, completeListing: false, jobs: [], error: "Graphic Packaging API did not return a usable first page." };
  const totalPages = Math.ceil(first.total / pageSize);
  const pages = await Promise.all(Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => fetchPage(index + 2)));
  const raw = [first.jobs, ...pages.flatMap((page) => page ? [page.jobs] : [])].flat();
  const jobs = uniqueJobs(raw.flatMap((job): CrawledJob[] => {
    if (!job.requisitionId || !job.title || !job.applyUrl) return [];
    const description = plainText(job.description);
    const programs = classifyJobPrograms(job.title).keys;
    return [{
      externalId: job.requisitionId,
      title: job.title,
      company: source.company,
      location: job.location ?? null,
      arrangement: /remote/i.test(job.location ?? "") ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : normalizeEmploymentType(job.employmentType) ?? job.employmentType ?? null,
      summary: description?.slice(0, 500) ?? null,
      ...(description ? { description } : {}),
      ...(job.department ? { department: job.department } : {}),
      requisitionId: job.requisitionId,
      officialUrl: job.applyUrl,
      publishedAt: normalizedDate(job.datePosted),
    }];
  }));
  const exactPages = pages.every((page, index) => page !== null
    && page.total === first.total
    && page.jobs.length === Math.min(pageSize, first.total - (index + 1) * pageSize));
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: exactPages && jobs.length === first.total,
    jobs,
    resolvedListingUrl: "https://careers.graphicpkg.com/search-jobs",
    error: null,
  };
};

type AsmlSearchJob = {
  id?: string;
  job_id?: string;
  name?: string;
  description?: string | null;
  job_location?: string | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_type?: string | null;
  job_teams?: string[] | null;
  job_technical_fields?: string[] | null;
  job_degrees?: string[] | null;
  job_educational_backgrounds?: string[] | null;
  job_experience_levels?: string[] | null;
  job_date_posted?: string | null;
  url?: string;
};

type AsmlSearchWidget = {
  total_item?: number;
  limit?: number;
  offset?: number;
  content?: AsmlSearchJob[];
  facet?: Array<{ name?: string; label?: string; value?: Array<{ text?: string; count?: number }> }>;
  errors?: unknown[];
};

type WorkableLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
};

type WorkableJob = {
  id?: number | string;
  shortcode?: string;
  title?: string;
  remote?: boolean;
  location?: WorkableLocation | null;
  locations?: WorkableLocation[];
  published?: string | null;
  type?: string | null;
  department?: string[];
  workplace?: string | null;
};

async function crawlWorkable(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  const account = page.pathname.split("/").filter(Boolean)[0];
  if (!account) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Workable account is missing." };
  const endpoint = new URL(`/api/v3/accounts/${encodeURIComponent(account)}/jobs`, page.origin);
  const maximumPages = 100;
  let responseStatus: number | null = null;
  let total = 0;
  let nextPage: string | null = null;
  const raw: WorkableJob[] = [];
  let successfulPages = 0;
  try {
    do {
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(nextPage ? { token: nextPage } : {}),
      });
      responseStatus = response.status;
      if (!response.ok) return {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus,
        completeListing: false,
        jobs: [],
        error: `Workable returned HTTP ${response.status}.`,
      };
      const payload = await response.json() as { total?: number; results?: WorkableJob[]; nextPage?: string | null };
      if (!Array.isArray(payload.results) || !Number.isFinite(payload.total)) throw new Error("Workable returned an unusable jobs payload.");
      if (successfulPages === 0) total = Number(payload.total);
      if (Number(payload.total) !== total) throw new Error("Workable job count changed during pagination.");
      raw.push(...payload.results);
      nextPage = asText(payload.nextPage);
      successfulPages += 1;
    } while (nextPage && successfulPages < maximumPages);
    const jobs = raw.flatMap((job): CrawledJob[] => {
      const externalId = job.id == null ? null : String(job.id);
      const title = asText(job.title);
      const shortcode = asText(job.shortcode);
      if (!externalId || !title || !shortcode) return [];
      const location = job.location ?? job.locations?.[0] ?? null;
      const locationText = location ? [location.city, location.region, location.country].filter(Boolean).join(", ") || null : null;
      const workplace = job.workplace ?? (job.remote ? "remote" : "");
      const programs = classifyJobPrograms(title);
      const employmentType = programs.keys.some((key) => key === "internship" || key === "coop") || /intern|trainee/i.test(job.type ?? "")
        ? "Internship"
        : /full/i.test(job.type ?? "") ? "Full-time"
          : /part/i.test(job.type ?? "") ? "Part-time"
            : normalizeEmploymentType(job.type);
      return [{
        externalId,
        title,
        company: source.company,
        location: locationText,
        arrangement: /remote/i.test(workplace) ? "remote" : /hybrid/i.test(workplace) ? "hybrid" : /on.?site/i.test(workplace) ? "onsite" : "unknown",
        employmentType,
        summary: null,
        ...(job.department?.length ? { department: job.department.join("; ") } : {}),
        ...(job.locations && job.locations.length > 1 ? { secondaryLocations: job.locations.slice(1).map((value) => [value.city, value.region, value.country].filter(Boolean).join(", ")).filter(Boolean) } : {}),
        ...(asText(location?.city) ? { locationCity: asText(location?.city) } : {}),
        ...(asText(location?.region) ? { locationState: asText(location?.region) } : {}),
        ...(asText(location?.country) ? { locationCountry: asText(location?.country) } : {}),
        requisitionId: externalId,
        officialUrl: new URL(`/${encodeURIComponent(account)}/j/${encodeURIComponent(shortcode)}/`, page.origin).href,
        publishedAt: normalizedDate(job.published),
      }];
    });
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: !nextPage && successfulPages < maximumPages && raw.length === total && jobs.length === raw.length && unique.length === total,
      jobs: unique,
      error: null,
    };
  } catch (error) {
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Workable crawler error.",
    };
  }
}

type BambooHrJob = {
  id?: unknown;
  jobOpeningName?: unknown;
  departmentLabel?: unknown;
  employmentStatusLabel?: unknown;
  employmentType?: unknown;
  isRemote?: unknown;
  location?: { city?: unknown; state?: unknown } | null;
  atsLocation?: { city?: unknown; state?: unknown; province?: unknown; country?: unknown } | null;
};

async function crawlBambooHr(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  if (!page.hostname.endsWith(".bamboohr.com")) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "BambooHR tenant is missing." };
  }
  const listingUrl = new URL("/careers", page.origin).href;
  const endpoint = new URL("/careers/list", page.origin).href;
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `BambooHR returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as { meta?: { totalCount?: unknown }; result?: BambooHrJob[] };
    const total = Number(payload.meta?.totalCount);
    if (!Number.isInteger(total) || total < 0 || !Array.isArray(payload.result) || payload.result.length !== total) {
      throw new Error("BambooHR returned an unusable jobs payload.");
    }
    const jobs = payload.result.flatMap((job): CrawledJob[] => {
      const externalId = job.id == null ? null : String(job.id).trim();
      const title = asText(job.jobOpeningName);
      if (!externalId || !title) return [];
      const location = job.atsLocation && Object.values(job.atsLocation).some(asText)
        ? job.atsLocation
        : job.location;
      const city = asText(location?.city);
      const state = asText(location && "state" in location ? location.state : null)
        ?? asText(location && "province" in location ? location.province : null);
      const country = asText(location && "country" in location ? location.country : null);
      const locationText = [city, state, country].filter(Boolean).join(", ") || null;
      const employment = asText(job.employmentType) ?? asText(job.employmentStatusLabel);
      const programs = classifyJobPrograms(title);
      return [{
        externalId,
        title,
        company: source.company,
        location: locationText,
        arrangement: job.isRemote === true || /remote/i.test(locationText ?? "") ? "remote" : "unknown",
        employmentType: programs.keys.some((key) => key === "internship" || key === "coop")
          ? "Internship"
          : normalizeEmploymentType(employment),
        summary: null,
        ...(asText(job.departmentLabel) ? { department: asText(job.departmentLabel) } : {}),
        ...(city ? { locationCity: city } : {}),
        ...(state ? { locationState: state } : {}),
        ...(country ? { locationCountry: country } : {}),
        requisitionId: externalId,
        officialUrl: new URL(`/careers/${encodeURIComponent(externalId)}`, page.origin).href,
        publishedAt: null,
      }];
    });
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length === total && unique.length === total,
      jobs: unique,
      resolvedListingUrl: listingUrl,
      error: null,
    };
  } catch (error) {
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown BambooHR crawler error.",
    };
  }
}

type PinpointJob = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  description?: unknown;
  key_responsibilities?: unknown;
  skills_knowledge_expertise?: unknown;
  benefits?: unknown;
  employment_type_text?: unknown;
  employment_type?: unknown;
  workplace_type_text?: unknown;
  workplace_type?: unknown;
  deadline_at?: unknown;
  compensation_currency?: unknown;
  compensation_frequency?: unknown;
  compensation_minimum?: unknown;
  compensation_maximum?: unknown;
  location?: { city?: unknown; province?: unknown; postal_code?: unknown; name?: unknown } | null;
  job?: { id?: unknown; requisition_id?: unknown; department?: { name?: unknown } | null; division?: { name?: unknown } | null } | null;
};

async function crawlPinpoint(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  if (!page.hostname.endsWith(".pinpointhq.com")) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Pinpoint tenant is missing." };
  }
  const endpoint = new URL("/postings.json", page.origin).href;
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `Pinpoint returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as { data?: PinpointJob[] };
    if (!Array.isArray(payload.data)) throw new Error("Pinpoint returned an unusable jobs payload.");
    const jobs = payload.data.flatMap((job): CrawledJob[] => {
      const externalId = asText(job.job?.requisition_id) ?? asText(job.job?.id) ?? asText(job.id);
      const title = asText(job.title);
      const officialUrl = asText(job.url);
      if (!externalId || !title || !officialUrl) return [];
      const city = asText(job.location?.city);
      const region = asText(job.location?.province);
      const location = asText(job.location?.name) ?? ([city, region].filter(Boolean).join(", ") || null);
      const workplace = asText(job.workplace_type_text) ?? asText(job.workplace_type) ?? "";
      const description = plainText(asText(job.description));
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: /remote/i.test(workplace) ? "remote" : /hybrid/i.test(workplace) ? "hybrid" : /on.?site|office/i.test(workplace) ? "onsite" : "unknown",
        employmentType: classifyJobPrograms(title).keys.length > 0
          ? "Internship"
          : normalizeEmploymentType(asText(job.employment_type_text) ?? asText(job.employment_type)),
        summary: description,
        description,
        responsibilities: plainText(asText(job.key_responsibilities)),
        qualifications: plainText(asText(job.skills_knowledge_expertise)),
        benefits: plainText(asText(job.benefits)),
        ...(asText(job.job?.department?.name) ? { department: asText(job.job?.department?.name) } : {}),
        ...(asText(job.job?.division?.name) ? { businessUnit: asText(job.job?.division?.name) } : {}),
        ...(city ? { locationCity: city } : {}),
        ...(region ? { locationState: region } : {}),
        ...(asText(job.location?.postal_code) ? { locationPostalCode: asText(job.location?.postal_code) } : {}),
        ...(Number.isFinite(Number(job.compensation_minimum)) ? { salaryMin: Number(job.compensation_minimum) } : {}),
        ...(Number.isFinite(Number(job.compensation_maximum)) ? { salaryMax: Number(job.compensation_maximum) } : {}),
        ...(asText(job.compensation_currency) ? { salaryCurrency: asText(job.compensation_currency) } : {}),
        ...(asText(job.compensation_frequency) ? { salaryInterval: asText(job.compensation_frequency) } : {}),
        ...(normalizedDate(job.deadline_at) ? { validThrough: normalizedDate(job.deadline_at) } : {}),
        requisitionId: externalId,
        officialUrl,
        publishedAt: null,
      }];
    });
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length === payload.data.length && unique.length === payload.data.length,
      jobs: unique,
      resolvedListingUrl: page.origin + "/",
      error: null,
    };
  } catch (error) {
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Pinpoint crawler error.",
    };
  }
}

type HirebridgeJob = {
  joblistid?: unknown;
  jobtitle?: unknown;
  joblocname?: unknown;
  jobloccity?: unknown;
  joblocstatename?: unknown;
  jobloccountryname?: unknown;
  jobcatname?: unknown;
  jobdeptname?: unknown;
  jobfunctionname?: unknown;
  jobtypename?: unknown;
  jobindeedremotetypename?: unknown;
  jobdivisionname?: unknown;
  description?: unknown;
  skills?: unknown;
  benefits?: unknown;
  url?: unknown;
  applyurl?: unknown;
  publicdate?: unknown;
  modifydate?: unknown;
};

async function crawlHirebridge(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  const cid = page.searchParams.get("cid");
  if (!cid || !/^\d+$/.test(cid)) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Hirebridge company id is missing." };
  }
  const endpoint = new URL("https://hbapi.hirebridge.com/careercenter/v2/GetJobListings");
  endpoint.searchParams.set("cid", cid);
  endpoint.searchParams.set("language", "en-US");
  let responseStatus: number | null = null;
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
    responseStatus = response.status;
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `Hirebridge returned HTTP ${response.status}.`,
    };
    const outer = await response.json() as unknown;
    const raw = typeof outer === "string" ? JSON.parse(outer) as unknown : outer;
    if (!Array.isArray(raw)) throw new Error("Hirebridge returned an unusable jobs payload.");
    const jobs = (raw as HirebridgeJob[]).flatMap((job): CrawledJob[] => {
      const externalId = job.joblistid == null ? null : String(job.joblistid).trim() || null;
      const title = asText(job.jobtitle);
      const officialUrl = asText(job.url);
      if (!externalId || !title || !officialUrl) return [];
      const city = asText(job.jobloccity);
      const state = asText(job.joblocstatename);
      const country = asText(job.jobloccountryname);
      const description = plainText(asText(job.description));
      const remote = asText(job.jobindeedremotetypename) ?? asText(job.joblocname) ?? "";
      let applyUrl = asText(job.applyurl);
      if (applyUrl?.startsWith("http://")) applyUrl = `https://${applyUrl.slice("http://".length)}`;
      return [{
        externalId,
        title,
        company: source.company,
        location: asText(job.joblocname) ?? ([city, state, country].filter(Boolean).join(", ") || null),
        arrangement: /remote/i.test(remote) ? "remote" : /hybrid/i.test(remote) ? "hybrid" : "unknown",
        employmentType: classifyJobPrograms(title).keys.length > 0 ? "Internship" : normalizeEmploymentType(asText(job.jobtypename)),
        summary: description,
        description,
        ...(asText(job.skills) ? { skills: [asText(job.skills)!] } : {}),
        ...(asText(job.jobdeptname) ?? asText(job.jobcatname) ? { department: asText(job.jobdeptname) ?? asText(job.jobcatname) } : {}),
        ...(asText(job.jobdivisionname) ? { businessUnit: asText(job.jobdivisionname) } : {}),
        ...(asText(job.jobfunctionname) ? { jobFunction: asText(job.jobfunctionname) } : {}),
        ...(plainText(asText(job.benefits)) ? { benefits: plainText(asText(job.benefits)) } : {}),
        ...(city ? { locationCity: city } : {}),
        ...(state ? { locationState: state } : {}),
        ...(country ? { locationCountry: country } : {}),
        requisitionId: externalId,
        ...(applyUrl ? { applyUrl } : {}),
        officialUrl,
        publishedAt: normalizedDate(job.publicdate),
        sourceUpdatedAt: normalizedDate(job.modifydate),
      }];
    });
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: jobs.length === raw.length && unique.length === raw.length,
      jobs: unique,
      resolvedListingUrl: `https://recruit.hirebridge.com/v3/CareerCenter/v2/?cid=${cid}`,
      error: null,
    };
  } catch (error) {
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Hirebridge crawler error.",
    };
  }
}

const taleoV2Config = (value: string): { endpoint: URL; org: string; cws: string } | null => {
  try {
    const page = new URL(value);
    const org = page.searchParams.get("org");
    const cws = page.searchParams.get("cws");
    const prefix = page.pathname.match(/^(.*\/ats\/careers\/v2\/)(?:jobSearch|searchResults)/i)?.[1];
    if (!org || !cws || !prefix || !page.hostname.endsWith(".taleo.net")) return null;
    return { endpoint: new URL(`${prefix}searchResults`, page.origin), org, cws };
  } catch {
    return null;
  }
};

const taleoV2Jobs = (html: string, source: CrawlSource): CrawledJob[] => [...html.matchAll(
  /<h4\b[^>]*class=["'][^"']*oracletaleocwsv2-head-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']*viewRequisition[^"']*\brid=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a><\/h4>\s*<div\b[^>]*tabindex=["']0["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*tabindex=["']0["'][^>]*>([\s\S]*?)<\/div>/gi,
)].map((match) => {
  const title = plainText(match[3])!;
  const department = plainText(match[4]);
  const location = plainText(match[5]);
  const url = new URL(decodeHtmlAttribute(match[1]), source.postingUrl);
  const programs = classifyJobPrograms(title);
  return {
    externalId: match[2],
    title,
    company: source.company,
    location,
    arrangement: /remote/i.test(location ?? "") ? "remote" as const : "unknown" as const,
    employmentType: programs.keys.length > 0 ? "Internship" : null,
    summary: null,
    ...(department ? { department } : {}),
    requisitionId: match[2],
    officialUrl: url.href,
    publishedAt: null,
  };
});

async function crawlTaleoV2(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult | null> {
  const config = taleoV2Config(source.postingUrl);
  if (!config) return null;
  const jobs: CrawledJob[] = [];
  const seenPages = new Set<string>();
  let responseStatus: number | null = null;
  let complete = false;
  try {
    for (let page = 0; page < 50; page += 1) {
      const endpoint = new URL(config.endpoint);
      endpoint.searchParams.set("org", config.org);
      endpoint.searchParams.set("cws", config.cws);
      endpoint.searchParams.set("rowFrom", String(page * 10));
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }, true, { attempts: 1, timeoutMs: 10_000 });
      responseStatus = response.status;
      if (!response.ok) return jobs.length > 0 ? {
        status: "succeeded",
        responseStatus,
        completeListing: false,
        jobs: uniqueJobs(jobs),
        error: null,
      } : {
        status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
        responseStatus,
        completeListing: false,
        jobs: [],
        error: `Taleo returned HTTP ${response.status}.`,
      };
      const html = await response.text();
      const pageJobs = taleoV2Jobs(html, source);
      const identity = pageJobs.map((job) => job.externalId).join(",");
      if (!identity || seenPages.has(identity)) break;
      seenPages.add(identity);
      jobs.push(...pageJobs);
      const hasNext = /class=["'][^"']*jscroll-next[^"']*["']/i.test(html);
      if (!hasNext) {
        complete = true;
        break;
      }
    }
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus,
      completeListing: complete && unique.length === jobs.length,
      jobs: unique,
      resolvedListingUrl: source.postingUrl,
      error: null,
    };
  } catch (error) {
    if (jobs.length > 0) return {
      status: "succeeded",
      responseStatus,
      completeListing: false,
      jobs: uniqueJobs(jobs),
      error: null,
    };
    return {
      status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: uniqueJobs(jobs),
      error: error instanceof Error ? error.message : "Unknown Taleo crawler error.",
    };
  }
}

const crawlAsmlSearch = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  const endpoint = "https://discover-euc1.sitecorecloud.io/discover/v2/126200477";
  const pageSize = 100;
  const maximumJobs = 10_000;
  const fetchPage = async (offset: number, includeFacets: boolean): Promise<{ status: number; widget: AsmlSearchWidget } | null> => {
    try {
      const body = {
        context: {
          page: { uri: "https://www.asml.com/en/careers/find-your-job" },
          locale: { country: "us", language: "en" },
        },
        widget: { items: [{
          entity: "content",
          rfk_id: "asml_job_search",
          search: {
            limit: pageSize,
            offset,
            ...(includeFacets ? { facet: { all: true } } : {}),
            content: {},
          },
        }] },
      };
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "01-967712c8-5a349c1760436ea6dccfd7bb02bfbe4dc2ccc36c",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }, false, { attempts: 2, timeoutMs: 30_000 });
      if (!response.ok) return null;
      const payload = await response.json() as { widgets?: AsmlSearchWidget[] };
      const widget = payload.widgets?.find((value) => Array.isArray(value.content));
      return widget ? { status: response.status, widget } : null;
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0, true);
  if (!first) return null;
  const total = Math.max(0, Number(first.widget.total_item ?? first.widget.content?.length ?? 0));
  if (total === 0 || total > maximumJobs) return null;
  const offsets = Array.from({ length: Math.max(0, Math.ceil(total / pageSize) - 1) }, (_, index) => (index + 1) * pageSize);
  const pages: Array<typeof first | null> = [first];
  for (let index = 0; index < offsets.length; index += 6) {
    pages.push(...await Promise.all(offsets.slice(index, index + 6).map((offset) => fetchPage(offset, false))));
  }
  const raw = pages.flatMap((page) => page?.widget.content ?? []);
  const asmlDate = (value: string | null | undefined): string | null => normalizedDate(
    value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/i.test(value) ? `${value}Z` : value,
  );
  const jobs = raw.flatMap((job): CrawledJob[] => {
    const externalId = asText(job.job_id) ?? asText(job.id);
    const title = asText(job.name);
    if (!externalId || !title || !job.url) return [];
    let officialUrl: URL;
    try {
      officialUrl = new URL(job.url);
    } catch {
      return [];
    }
    if (officialUrl.origin !== "https://www.asml.com" || !/^\/en\/careers\/find-your-job\//i.test(officialUrl.pathname)) return [];
    const description = plainText(job.description);
    const programs = classifyJobPrograms(title);
    const employmentType = programs.keys.some((key) => key === "internship" || key === "coop") || /intern/i.test(job.job_type ?? "")
      ? "Internship"
      : /\bfix(?:ed)?\b|regular|full.?time/i.test(job.job_type ?? "") ? "Full-time"
        : normalizeEmploymentType(job.job_type);
    const technicalFields = job.job_technical_fields?.filter(Boolean) ?? [];
    const teams = job.job_teams?.filter(Boolean) ?? [];
    const degrees = job.job_degrees?.filter(Boolean) ?? [];
    const education = job.job_educational_backgrounds?.filter(Boolean) ?? [];
    const experience = job.job_experience_levels?.filter(Boolean) ?? [];
    return [{
      externalId,
      title,
      company: source.company,
      location: asText(job.job_location),
      arrangement: /\bremote\b/i.test(`${job.job_location ?? ""} ${description ?? ""}`) ? "remote" : "unknown",
      employmentType,
      summary: description,
      ...(description ? { description } : {}),
      ...(technicalFields.length ? { skills: technicalFields, jobFunction: technicalFields.join("; ") } : {}),
      ...(teams.length ? { department: teams.join("; ") } : {}),
      ...(degrees.length || education.length ? { educationRequirements: [...degrees, ...education].join("; ") } : {}),
      ...(experience.length ? { experienceLevel: experience.join("; ") } : {}),
      ...(asText(job.job_city) ? { locationCity: asText(job.job_city) } : {}),
      ...(asText(job.job_state) ? { locationState: asText(job.job_state) } : {}),
      ...(asText(job.job_country) ? { locationCountry: asText(job.job_country) } : {}),
      requisitionId: externalId,
      officialUrl: officialUrl.href,
      publishedAt: asmlDate(job.job_date_posted),
      sourceUpdatedAt: asmlDate(job.job_date_posted),
    }];
  });
  const unique = uniqueJobs(jobs);
  const facets = (first.widget.facet ?? []).flatMap((facet): CrawledFacet[] => {
    if (!facet.name) return [];
    const values = (facet.value ?? []).flatMap((value) => value.text
      ? [{ key: value.text, label: value.text, count: Number.isFinite(value.count) ? value.count! : null }]
      : []);
    return values.length ? [{ key: facet.name, label: facet.label ?? facet.name, values }] : [];
  });
  const exact = pages.every(Boolean)
    && pages.every((page) => Number(page?.widget.total_item) === total)
    && raw.length === total
    && jobs.length === raw.length
    && unique.length === total;
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: exact,
    jobs: unique,
    ...(facets.length ? { facets } : {}),
    error: null,
  };
};

const crawlAsmlSitemap = async (
  source: CrawlSource,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult | null> => {
  try {
    const endpoint = "https://www.asml.com/api/job-posting-sitemap";
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/xml,text/xml;q=0.9" } });
    if (!response.ok) return null;
    const xml = await response.text();
    const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((match) => {
      const rawUrl = match[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1];
      if (!rawUrl) return [];
      let url: URL;
      try {
        url = new URL(decodeHtmlAttribute(rawUrl.trim()));
      } catch {
        return [];
      }
      if (url.origin !== "https://www.asml.com") return [];
      const detail = url.pathname.match(/^\/en\/careers\/find-your-job\/(.+)-(j\d+)\/?$/i);
      if (!detail) return [];
      const lastModified = match[1].match(/<lastmod(?:ified)?>\s*([\s\S]*?)\s*<\/lastmod(?:ified)?>/i)?.[1]?.trim() ?? null;
      return [{ url: url.href, slug: detail[1], externalId: detail[2].toUpperCase(), lastModified }];
    });
    if (entries.length === 0) return null;
    const jobs = entries.map((entry): CrawledJob => {
      const title = careerSlugTitle(entry.slug);
      const programs = classifyJobPrograms(title);
      return {
        externalId: entry.externalId,
        title,
        company: source.company,
        location: null,
        arrangement: "unknown",
        employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
        summary: null,
        requisitionId: entry.externalId,
        ...(entry.lastModified ? { sourceUpdatedAt: normalizedDate(entry.lastModified) } : {}),
        officialUrl: entry.url,
        publishedAt: normalizedDate(entry.lastModified),
      };
    });
    const exact = jobs.length === entries.length
      && new Set(jobs.map((job) => job.externalId)).size === entries.length
      && new Set(jobs.map((job) => job.officialUrl)).size === entries.length;
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: exact,
      jobs,
      error: null,
    };
  } catch {
    return null;
  }
};

const crawlServiceNow = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingSource = { ...source, postingUrl: "https://careers.servicenow.com/jobs/" };
  let responseStatus: number | null = null;
  try {
    const sitemap = await crawlJobSitemap(source, "https://careers.servicenow.com/sitemap.xml", "careers.servicenow.com", fetcher);
    if (sitemap) return sitemap;
    const direct = await fetchWithTimeout(fetcher, listingSource.postingUrl, undefined, false, { attempts: 1, timeoutMs: 15_000 });
    responseStatus = direct.status;
    const firstReaderUrl = `https://r.jina.ai/${listingSource.postingUrl}`;
    const firstResponse = await fetchWithTimeout(fetcher, firstReaderUrl, { headers: { accept: "text/plain", "x-retain-links": "all" } }, false);
    if (!firstResponse.ok) throw new Error(`ServiceNow reader returned HTTP ${firstResponse.status}.`);
    const firstMarkdown = await firstResponse.text();
    const pageNumbers = [...firstMarkdown.matchAll(/\]\(https:\/\/careers\.servicenow\.com\/jobs\/\?page=(\d+)(?:#results)?\)/gi)]
      .map((match) => Number(match[1])).filter(Number.isFinite);
    const maxPage = Math.max(1, ...pageNumbers);
    const boundedPage = Math.min(maxPage, 200);
    const pages: Array<string | null> = [];
    for (let page = 2; page <= boundedPage; page += 8) {
      pages.push(...await Promise.all(Array.from({ length: Math.min(8, boundedPage - page + 1) }, async (_, index) => {
        const pageNumber = page + index;
        try {
          const url = `https://r.jina.ai/https://careers.servicenow.com/jobs/?page=${pageNumber}`;
          const response = await fetchWithTimeout(fetcher, url, { headers: { accept: "text/plain", "x-retain-links": "all" } }, false);
          return response.ok ? response.text() : null;
        } catch {
          return null;
        }
      })));
    }
    const jobs = uniqueJobs([firstMarkdown, ...pages.filter((page): page is string => page !== null)].flatMap((page) => serviceNowJobs(page, listingSource)));
    return {
      status: "succeeded",
      responseStatus,
      completeListing: maxPage <= 200 && pages.every((page) => page !== null) && jobs.length > 0,
      jobs,
      error: null,
    };
  } catch (error) {
    return {
      status: isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown ServiceNow crawler error.",
    };
  }
};

const decodeEmbeddedString = (value: string): string => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replaceAll('\\"', '"').replaceAll("\\n", " ");
  }
};

type BlockJob = {
  id: number | string;
  requisitionId?: string | null;
  title?: string | null;
  bu?: string | null;
  employeeType?: string | null;
  jobFunction?: string | null;
  isRemote?: boolean | null;
  location?: string | null;
  publicationDate?: string | null;
};

const normalizedBlockJob = (source: CrawlSource, job: BlockJob): CrawledJob | null => {
  const externalId = String(job.id);
  const title = job.title?.trim();
  if (!externalId || !title) return null;
  const programs = classifyJobPrograms(title);
  return {
    externalId,
    title,
    company: source.company,
    location: job.location ?? null,
    arrangement: job.isRemote ? "remote" : "unknown",
    employmentType: programs.keys.some((key) => key === "internship" || key === "coop")
      ? "Internship"
      : job.employeeType ?? null,
    summary: null,
    ...(job.jobFunction ? { department: job.jobFunction } : {}),
    ...(job.bu ? { businessUnit: job.bu } : {}),
    ...(job.requisitionId ? { requisitionId: job.requisitionId } : {}),
    officialUrl: `https://block.xyz/careers/jobs/${externalId}`,
    publishedAt: normalizedDate(job.publicationDate),
  };
};

const crawlBlockCareers = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  try {
    const response = await fetchWithTimeout(fetcher, source.postingUrl, { headers: { accept: "text/html" } });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Block careers returned HTTP ${response.status}.`,
    };
    const html = await response.text();
    const start = html.indexOf("currentPage:[");
    const endMatch = start >= 0 ? html.slice(start).match(/\],total:(\d+)/) : null;
    if (start < 0 || !endMatch || endMatch.index == null) throw new Error("Block embedded job catalog was not found.");
    const catalog = html.slice(start, start + endMatch.index + 1);
    const total = Number(endMatch[1]);
    const pattern = /\{id:(\d+),internalId:\d+,requisitionId:"((?:\\.|[^"\\])*)",title:"((?:\\.|[^"\\])*)",bu:"((?:\\.|[^"\\])*)",employeeType:"((?:\\.|[^"\\])*)",jobFunction:"((?:\\.|[^"\\])*)",isRemote:(true|false),location:"((?:\\.|[^"\\])*)",publicationDate:(null|"((?:\\.|[^"\\])*)")\}/g;
    const jobs = [...catalog.matchAll(pattern)].flatMap((match) => normalizedBlockJob(source, {
      id: match[1],
      requisitionId: decodeEmbeddedString(match[2]),
      title: decodeEmbeddedString(match[3]),
      bu: decodeEmbeddedString(match[4]),
      employeeType: decodeEmbeddedString(match[5]),
      jobFunction: decodeEmbeddedString(match[6]),
      isRemote: match[7] === "true",
      location: decodeEmbeddedString(match[8]),
      publicationDate: match[9] === "null" ? null : decodeEmbeddedString(match[10] ?? ""),
    }) ?? []);
    const pageCount = Math.ceil(total / 50);
    let successfulPages = 1;
    for (let page = 2; page <= pageCount; page += 6) {
      const responses = await Promise.all(Array.from({ length: Math.min(6, pageCount - page + 1) }, async (_, index) => {
        const endpoint = new URL("/api/careers/jobs", "https://block.xyz");
        endpoint.searchParams.set("page", String(page + index));
        endpoint.searchParams.set("pageLimit", "50");
        try {
          const pageResponse = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } });
          if (!pageResponse.ok) return null;
          return await pageResponse.json() as { currentPage?: BlockJob[]; total?: number };
        } catch {
          return null;
        }
      }));
      successfulPages += responses.filter(Boolean).length;
      jobs.push(...responses.flatMap((payload) => payload?.currentPage?.flatMap((job) => normalizedBlockJob(source, job) ?? []) ?? []));
    }
    const unique = uniqueJobs(jobs);
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: successfulPages === pageCount && unique.length === total,
      jobs: unique,
      error: null,
    };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Unknown Block crawler error." };
  }
};

const googleJobsFromHtml = (html: string, source: CrawlSource): CrawledJob[] => {
  const jobs: CrawledJob[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const label = tag.match(/\baria-label=["']([^"']+)["']/i)?.[1];
    if (!href || !label || !/\bjobs\/results\/\d+-/i.test(href)) continue;
    const official = new URL(
      decodeHtmlAttribute(href),
      "https://www.google.com/about/careers/applications/",
    );
    official.searchParams.delete("page");
    const officialUrl = official.href;
    const externalId = new URL(officialUrl).pathname.match(/\/jobs\/results\/(\d+)-/i)?.[1];
    const title = decodeHtmlAttribute(label).replace(/^Learn more about\s+/i, "").trim();
    if (!externalId || !title) continue;
    const programs = classifyJobPrograms(title);
    jobs.push({
      externalId,
      title,
      company: source.company,
      location: null,
      arrangement: "unknown",
      employmentType: programs.keys.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: null,
      requisitionId: externalId,
      officialUrl,
      publishedAt: null,
    });
  }
  return uniqueJobs(jobs);
};

const googleJobsFromResponse = async (
  response: Response,
  source: CrawlSource,
  readTotal: boolean,
): Promise<{ jobs: CrawledJob[]; total: number | null }> => {
  if (!response.body) {
    const html = await response.text();
    const totalText = readTotal
      ? html.match(/<span\b[^>]*class=["'][^"']*\bSWhIm\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>\s*jobs matched/i)?.[1]
      : null;
    return {
      jobs: googleJobsFromHtml(html, source),
      total: totalText ? Number(totalText.replaceAll(",", "")) : null,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const jobs: CrawledJob[] = [];
  let buffer = "";
  let metadataTail = "";
  let total: number | null = null;
  const consume = (text: string): void => {
    if (!text) return;
    if (readTotal && total === null) {
      const metadata = metadataTail + text;
      const totalText = metadata.match(/<span\b[^>]*class=["'][^"']*\bSWhIm\b[^"']*["'][^>]*>\s*([\d,]+)\s*<\/span>\s*jobs matched/i)?.[1];
      if (totalText) total = Number(totalText.replaceAll(",", ""));
      metadataTail = metadata.slice(-2_048);
    }

    buffer += text;
    const anchorPattern = /<a\b[^>]*>/gi;
    let lastCompleteEnd = 0;
    for (const match of buffer.matchAll(anchorPattern)) {
      jobs.push(...googleJobsFromHtml(match[0], source));
      lastCompleteEnd = (match.index ?? 0) + match[0].length;
    }
    if (lastCompleteEnd > 0) buffer = buffer.slice(lastCompleteEnd);
    if (buffer.length > 8_192) {
      const partialAnchor = buffer.toLowerCase().lastIndexOf("<a");
      buffer = partialAnchor >= 0 ? buffer.slice(partialAnchor) : buffer.slice(-4_096);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());
  if (buffer) jobs.push(...googleJobsFromHtml(buffer, source));
  return { jobs: uniqueJobs(jobs), total };
};

const crawlGoogleCareers = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpointFor = (page: number) => {
    const endpoint = new URL("https://www.google.com/about/careers/applications/jobs/results/");
    const sourceEndpoint = new URL(source.postingUrl);
    const company = sourceEndpoint.searchParams.get("company");
    if (company) endpoint.searchParams.set("company", company);
    if (page > 1) endpoint.searchParams.set("page", String(page));
    return endpoint;
  };
  const fetchPage = async (page: number): Promise<{ status: number; jobs: CrawledJob[]; total: number | null } | null> => {
    try {
      const response = await fetchWithTimeout(
        fetcher,
        endpointFor(page),
        { headers: { accept: "text/html" } },
        true,
        source.id === "p4-0285-google" ? { attempts: 1 } : undefined,
      );
      if (!response.ok) return null;
      const pageData = await googleJobsFromResponse(response, source, page === 1);
      return {
        status: response.status,
        jobs: pageData.jobs,
        total: pageData.total,
      };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(1);
  if (!first) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Google Careers results did not return a usable first page." };
  const total = first.total ?? first.jobs.length;
  const pageSize = Math.max(first.jobs.length, 1);
  const totalPages = Math.ceil(total / pageSize);
  const boundedPages = Math.min(totalPages, 500);
  const jobsByUrl = new Map(first.jobs.map((job) => [job.officialUrl, job]));
  let successfulPages = 1;
  const pageConcurrency = 1;
  const isCheckpointedCatalog = source.id === "p4-0285-google" && totalPages > 20;
  const startPage = isCheckpointedCatalog
    ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), boundedPages)
    : 1;
  const endPage = isCheckpointedCatalog
    ? Math.min(startPage + (startPage === 1 ? 19 : 18), boundedPages)
    : boundedPages;
  const firstRequestedPage = Math.max(startPage, 2);
  successfulPages = startPage === 1 ? 1 : 0;
  let firstFailedPage: number | null = null;
  for (let page = firstRequestedPage; page <= endPage; page += pageConcurrency) {
    const pages = await Promise.all(
      Array.from(
        { length: Math.min(pageConcurrency, endPage - page + 1) },
        (_, index) => fetchPage(page + index),
      ),
    );
    for (const [index, result] of pages.entries()) {
      const requestedPage = page + index;
      const expected = Math.min(pageSize, Math.max(0, total - (requestedPage - 1) * pageSize));
      if (!result || result.jobs.length < expected) {
        firstFailedPage ??= requestedPage;
        continue;
      }
      successfulPages += 1;
      for (const job of result.jobs) jobsByUrl.set(job.officialUrl, job);
    }
  }
  const jobs = [...jobsByUrl.values()];
  if (isCheckpointedCatalog) {
    return {
      status: "succeeded",
      responseStatus: first.status,
      completeListing: false,
      jobs,
      pagination: {
        nextPage: firstFailedPage ?? (endPage === boundedPages ? 1 : endPage),
        cycleComplete: firstFailedPage === null && endPage === boundedPages,
        totalPages,
      },
      error: null,
    };
  }
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: totalPages <= 500 && successfulPages === boundedPages && jobs.length >= total,
    jobs,
    error: null,
  };
};

type WalmartSearchJob = {
  id?: string;
  text?: string;
  metadata?: {
    jobId?: string;
    title?: string;
    jobPostingTitle?: string;
    primaryLocationCity?: string;
    primaryLocationState?: string;
    primaryLocationCountry?: string;
    postalCode?: string;
    latitudeDgr?: number;
    longitudeDgr?: number;
    jobPostingStartDate?: number;
    employmentTypes?: string[];
    timeType?: string;
    categories?: string[];
    areas?: string[];
    brand?: string;
    jobFamilyId?: string[];
    minPay?: number;
    maxPay?: number;
    currencyCode?: string;
    payFrequency?: string;
    positionWorkerType?: string;
  };
};

type WalmartSearchPayload = {
  totalJobs?: number;
  jobSearchSucceeded?: boolean;
  jobErrorMessage?: string | null;
  jobs?: WalmartSearchJob[];
};

const walmartJob = (source: CrawlSource, value: WalmartSearchJob): CrawledJob | null => {
  const metadata = value.metadata ?? {};
  const externalId = metadata.jobId ?? value.id?.replace(/-External$/i, "") ?? null;
  const title = metadata.jobPostingTitle ?? metadata.title ?? null;
  if (!externalId || !title) return null;
  const location = [metadata.primaryLocationCity, metadata.primaryLocationState, metadata.primaryLocationCountry]
    .filter(Boolean).join(", ") || null;
  const programs = classifyJobPrograms(title);
  const sourceTypes = metadata.employmentTypes?.filter(Boolean) ?? [];
  const employmentType = programs.keys.some((key) => key === "internship" || key === "coop")
    ? "Internship"
    : normalizeEmploymentType(sourceTypes.join("; ") || metadata.timeType);
  const description = plainText(value.text?.replace(/^Job Posting (?:Title|Description):\s*/i, ""));
  const publishedAt = metadata.jobPostingStartDate && Number.isFinite(metadata.jobPostingStartDate)
    ? new Date(metadata.jobPostingStartDate).toISOString()
    : null;
  return {
    externalId,
    title,
    company: source.company,
    location,
    arrangement: /\bremote\b/i.test(`${location ?? ""} ${value.text ?? ""}`) ? "remote" : "unknown",
    employmentType,
    summary: description,
    description,
    ...(metadata.categories?.length ? { department: metadata.categories.join("; ") } : {}),
    ...(metadata.brand ? { businessUnit: metadata.brand } : {}),
    ...(metadata.jobFamilyId?.length ? { jobFamily: metadata.jobFamilyId.join("; ") } : {}),
    ...(metadata.areas?.length ? { jobFunction: metadata.areas.join("; ") } : {}),
    ...(metadata.primaryLocationCity ? { locationCity: metadata.primaryLocationCity } : {}),
    ...(metadata.primaryLocationState ? { locationState: metadata.primaryLocationState } : {}),
    ...(metadata.primaryLocationCountry ? { locationCountry: metadata.primaryLocationCountry } : {}),
    ...(metadata.postalCode ? { locationPostalCode: metadata.postalCode } : {}),
    ...(Number.isFinite(metadata.latitudeDgr) ? { latitude: metadata.latitudeDgr } : {}),
    ...(Number.isFinite(metadata.longitudeDgr) ? { longitude: metadata.longitudeDgr } : {}),
    ...(Number.isFinite(metadata.minPay) ? { salaryMin: metadata.minPay } : {}),
    ...(Number.isFinite(metadata.maxPay) ? { salaryMax: metadata.maxPay } : {}),
    ...(metadata.currencyCode ? { salaryCurrency: metadata.currencyCode } : {}),
    ...(metadata.payFrequency ? { salaryInterval: metadata.payFrequency } : {}),
    ...(metadata.positionWorkerType ? { experienceLevel: metadata.positionWorkerType } : {}),
    requisitionId: externalId,
    officialUrl: `https://careers.walmart.com/us/en/jobs/${encodeURIComponent(externalId)}`,
    publishedAt,
  };
};

const crawlWalmart = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const pageSize = 1_000;
  const maximumJobs = 10_000;
  const endpointFor = (page: number) => {
    const endpoint = new URL("/api/ai/search-ai/api/v1/combined/hybrid-search", "https://careers.walmart.com");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("size", String(pageSize));
    endpoint.searchParams.set("locale", "en_US");
    return endpoint;
  };
  const fetchPage = async (
    page: number,
    query = "*",
    basicSearch = true,
  ): Promise<{ status: number; payload: WalmartSearchPayload } | null> => {
    try {
      const response = await fetchWithTimeout(fetcher, endpointFor(page), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ query, basicSearch, filter: "", locale: "en_US" }),
      }, false, { attempts: 2, timeoutMs: 30_000 });
      if (!response.ok) return null;
      const payload = await response.json() as WalmartSearchPayload;
      return payload.jobSearchSucceeded === false ? null : { status: response.status, payload };
    } catch {
      return null;
    }
  };
  const first = await fetchPage(0);
  if (!first) return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: "Walmart search endpoint did not return a usable first page." };
  const total = Math.max(0, Number(first.payload.totalJobs ?? first.payload.jobs?.length ?? 0));
  const boundedTotal = Math.min(total, maximumJobs);
  const pageCount = Math.max(1, Math.ceil(boundedTotal / pageSize));
  const jobs = (first.payload.jobs ?? []).flatMap((job) => walmartJob(source, job) ?? []);
  let successfulPages = 1;
  // Keep page responses out of memory; normalized records are substantially smaller than the API payload.
  for (let page = 1; page < pageCount; page += 1) {
    const result = await fetchPage(page);
    if (!result) continue;
    successfulPages += 1;
    jobs.push(...(result.payload.jobs ?? []).flatMap((job) => walmartJob(source, job) ?? []));
  }
  // The all-jobs result is relevance-ranked and may bury student programs beyond the safe
  // Worker cap. Add focused official searches so internship/coop postings are not omitted.
  const programPages = await Promise.all(["intern", "co-op", "coop", "co op"]
    .map((query) => fetchPage(0, query, false)));
  for (const result of programPages) {
    if (!result) continue;
    jobs.push(...(result.payload.jobs ?? []).flatMap((job) => walmartJob(source, job) ?? []));
  }
  const unique = uniqueJobs(jobs);
  return {
    status: "succeeded",
    responseStatus: first.status,
    completeListing: total <= maximumJobs && successfulPages === pageCount && unique.length >= total,
    jobs: unique,
    error: null,
  };
};

async function crawlEightfold(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const page = new URL(source.postingUrl);
  const origin = page.origin;
  const tenant = page.hostname.split(".")[0];
  const domain = page.searchParams.get("domain") ?? `${tenant}.com`;
  const positions: EightfoldPosition[] = [];
  let facets: CrawledFacet[] = [];
  let responseStatus: number | null = null;
  let sessionCookie: string | null = null;
  try {
    type Payload = { count?: number; positions?: EightfoldPosition[]; facets?: Record<string, unknown>; filterDef?: { facets?: Record<string, unknown> } };
    type ApiMode = "pcsx" | "legacy";
    let apiMode: ApiMode = "pcsx";

    const bootstrapSession = async (): Promise<void> => {
      const careers = new URL("/careers", origin);
      careers.searchParams.set("domain", domain);
      const response = await fetchWithTimeout(fetcher, careers, {
        headers: { accept: "text/html" },
      }, false, { attempts: 1, timeoutMs: 15_000 });
      const setCookie = response.headers.get("set-cookie") ?? "";
      const cookies = ["_vs", "_vscid"].flatMap((name) => {
        const value = setCookie.match(new RegExp(`(?:^|[,;]\\s*)${name}=([^;,\\s]+)`, "i"))?.[1];
        return value ? [`${name}=${value}`] : [];
      });
      sessionCookie = cookies.join("; ") || null;
    };

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
      const request = () => fetchWithTimeout(fetcher, endpoint, {
        headers: {
          accept: "application/json",
          referer: `${origin}/careers?domain=${encodeURIComponent(domain)}`,
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
        },
      }, false, { attempts: 1, timeoutMs: 15_000 });
      let response = await request();
      if (mode === "pcsx" && response.status === 429 && !sessionCookie) {
        await bootstrapSession();
        if (sessionCookie) response = await request();
      }
      responseStatus = response.status;
      if (!response.ok) return { response, payload: {} };
      const raw = await response.json() as Payload & { data?: Payload };
      return { response, payload: raw.data ?? raw };
    };

    const fetchPage = async (start: number, requirePositions = false, maxAttempts = 3): Promise<Payload> => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let result = await requestPage(start, apiMode);
        if (start === 0 && apiMode === "pcsx" && [400, 403, 404].includes(result.response.status)) {
          apiMode = "legacy";
          result = await requestPage(start, apiMode);
        }
        if (!result.response.ok) throw new Error(`Eightfold returned HTTP ${result.response.status}.`);
        const payload = result.payload;
        if (start === 0) facets = normalizedFacets(payload.filterDef?.facets ?? payload.facets);
        if (!requirePositions || (payload.positions?.length ?? 0) > 0 || attempt === maxAttempts - 1) return payload;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
      return { positions: [] };
    };
    const first = await fetchPage(0);
    positions.push(...(first.positions ?? []));
    const total = first.count ?? positions.length;
    const pageSize = apiMode === "pcsx" ? 10 : Math.max(positions.length, 1);
    const totalPages = Math.ceil(Math.min(total, 10_000) / pageSize);
    const isCheckpointed = totalPages > 40;
    const startPage = isCheckpointed ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages) : 1;
    const endPage = isCheckpointed ? Math.min(startPage + (startPage === 1 ? 19 : 18), totalPages) : totalPages;
    const pagesToFetch = Array.from(
      { length: Math.max(0, endPage - Math.max(startPage, 2) + 1) },
      (_, index) => Math.max(startPage, 2) + index,
    );
    const pages: Array<Payload | null> = [];
    for (let index = 0; index < pagesToFetch.length; index += 8) {
      pages.push(...await Promise.all(pagesToFetch.slice(index, index + 8).map(async (page) => {
        try {
          return await fetchPage((page - 1) * pageSize, true, isCheckpointed ? 1 : 3);
        } catch {
          return null;
        }
      })));
    }
    positions.push(...pages.flatMap((page) => page?.positions ?? []));
    const uniquePositions = [...new Map(positions.map((position) => [String(position.id), position])).values()];
    const firstExpected = Math.min(pageSize, total);
    const firstPositions = first.positions ?? [];
    const usablePositionIds = (values: EightfoldPosition[]): string[] => values.flatMap((position) => (
      position.id != null && position.name ? [String(position.id)] : []
    ));
    const seenIdentities = new Set<string>();
    let firstFailedPage: number | null = claimPageIdentities(
      usablePositionIds(firstPositions), firstExpected, seenIdentities,
    ) ? null : 1;
    for (let index = 0; index < pages.length && firstFailedPage === null; index += 1) {
      const page = pages[index];
      const pageNumber = pagesToFetch[index];
      const expected = Math.min(pageSize, Math.max(0, total - (pageNumber - 1) * pageSize));
      const pagePositions = page?.positions ?? [];
      if (!page || !claimPageIdentities(usablePositionIds(pagePositions), expected, seenIdentities)) {
        firstFailedPage = pageNumber;
        break;
      }
    }
    const normalizedJobs = uniquePositions.flatMap((position) => position.id != null && position.name ? (() => {
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
    })() : []);
    if (isCheckpointed) return {
      status: "succeeded",
      responseStatus,
      completeListing: false,
      jobs: normalizedJobs,
      ...(facets.length > 0 ? { facets } : {}),
      pagination: {
        nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
        cycleComplete: firstFailedPage === null && endPage === totalPages,
        totalPages,
      },
      error: null,
    };
    return {
      status: "succeeded",
      responseStatus,
      completeListing: firstFailedPage === null && pages.every((page) => page !== null) && uniquePositions.length >= total,
      jobs: normalizedJobs,
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

const metaSitemapEntries = (text: string, allowPlainUrls = false): Array<{ id: string; url: string }> => [
  ...[...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1]),
  ...(allowPlainUrls
    ? [...text.matchAll(/https:\/\/www\.metacareers\.com\/profile\/job_details\/\d+\//gi)].map((match) => match[0])
    : []),
].flatMap((candidate) => {
    try {
      const url = new URL(decodeHtmlAttribute(candidate));
      const id = url.pathname.match(/^\/profile\/job_details\/(\d+)\/$/i)?.[1];
      return url.origin === "https://www.metacareers.com"
        && !url.username && !url.password && !url.search && !url.hash && id
        ? [{ id, url: url.href }]
        : [];
    } catch {
      return [];
    }
  });

const metaStructuredJob = (html: string, entry: { id: string; url: string }, source: CrawlSource): CrawledJob | null => {
  const node = jsonLdScripts(html).flatMap(jobPostingNodes).at(0);
  if (!node) return null;
  const identifier = node.identifier;
  const claimedId = identifier && typeof identifier === "object"
    ? asText((identifier as JsonLdValue).value) ?? asText((identifier as JsonLdValue)["@id"])
    : asText(identifier);
  if (claimedId && claimedId !== entry.id) return null;
  const mainEntity = node.mainEntityOfPage;
  const claimedUrl = asText(node.url)
    ?? (mainEntity && typeof mainEntity === "object"
      ? asText((mainEntity as JsonLdValue).url) ?? asText((mainEntity as JsonLdValue)["@id"])
      : asText(mainEntity));
  if (claimedUrl) {
    try {
      if (new URL(claimedUrl, entry.url).href !== entry.url) return null;
    } catch {
      return null;
    }
  }
  const locations = Array.isArray(node.jobLocation) ? node.jobLocation : node.jobLocation ? [node.jobLocation] : [];
  const job = jsonLdJob({
    ...node,
    url: entry.url,
    identifier: { value: entry.id },
    ...(locations[0] ? { jobLocation: locations[0] } : {}),
  }, source);
  if (!job) return null;
  const secondaryLocations = locations.slice(1).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    return asText((value as JsonLdValue).name) ?? jobLocation(value) ?? [];
  });
  return {
    ...job,
    externalId: entry.id,
    officialUrl: entry.url,
    ...(secondaryLocations.length > 0 ? { secondaryLocations } : {}),
  };
};

async function crawlMetaSitemapFallback(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const readerCursorBase = 1_000_000;
  const directSitemapUrls = [
    "https://www.metacareers.com/jobs/sitemap.xml",
    "https://www.metacareers.com/jobsearch/sitemap.xml",
  ];
  const readerSitemapUrls = [
    "https://r.jina.ai/https://www.metacareers.com/jobs/sitemap.xml",
    "https://r.jina.ai/http://www.metacareers.com/jobs/sitemap.xml",
  ];
  try {
    let responseStatus: number | null = null;
    let entries: Array<{ id: string; url: string }> = [];
    let authoritativeSitemap = false;
    const sortedUnique = (values: Array<{ id: string; url: string }>) => [...new Map(values.map((entry) => [entry.id, entry])).values()]
      .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
    const fetchSitemapText = async (url: string, reader: boolean): Promise<string | null> => {
      try {
        const response = await fetchWithTimeout(fetcher, url, {
          headers: { accept: reader ? "text/plain" : "application/xml,text/xml;q=0.9,*/*;q=0.7" },
        }, false, { attempts: 1, timeoutMs: 20_000 });
        responseStatus = response.status;
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    };
    for (const sitemapUrl of directSitemapUrls) {
      const text = await fetchSitemapText(sitemapUrl, false);
      if (!text || !/<urlset\b/i.test(text) || !/<\/urlset>\s*$/i.test(text)) continue;
      entries = sortedUnique(metaSitemapEntries(text));
      if (entries.length > 0) {
        authoritativeSitemap = true;
        break;
      }
    }
    if (entries.length === 0) {
      const readerCopies: Array<Array<{ id: string; url: string }>> = [];
      for (const sitemapUrl of readerSitemapUrls) {
        const text = await fetchSitemapText(sitemapUrl, true);
        readerCopies.push(text ? sortedUnique(metaSitemapEntries(text, true)) : []);
      }
      if (readerCopies.length === 2 && readerCopies.every((copy) => copy.length > 0)) {
        const signatures = readerCopies.map((copy) => JSON.stringify(copy.map((entry) => [entry.id, entry.url])));
        if (signatures[0] === signatures[1]) entries = readerCopies[0];
      }
    }
    if (entries.length === 0) return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: "Meta careers sitemap returned no official job URLs.",
    };

    const pageSize = 40;
    const pageStride = pageSize - 1;
    const totalPages = entries.length <= pageSize ? 1 : 1 + Math.ceil((entries.length - pageSize) / pageStride);
    const persistedCursor = source.crawlPageCursor ?? 1;
    const requestedPage = authoritativeSitemap
      ? persistedCursor > readerCursorBase ? 1 : persistedCursor
      : persistedCursor > readerCursorBase ? persistedCursor - readerCursorBase : 1;
    const page = Math.min(Math.max(requestedPage, 1), totalPages);
    const pageStart = (page - 1) * pageStride;
    const pageEntries = entries.slice(pageStart, pageStart + pageSize);
    const jobs: CrawledJob[] = [];
    let failedDetail = false;
    for (let index = 0; index < pageEntries.length; index += 10) {
      const details = await Promise.all(pageEntries.slice(index, index + 10).map(async (entry) => {
        try {
          const response = await fetchWithTimeout(fetcher, entry.url, {
            headers: { accept: "text/html,application/xhtml+xml" },
          }, false, { attempts: 1, timeoutMs: 20_000 });
          if (!response.ok) return null;
          if (response.url && response.url !== entry.url) return null;
          return metaStructuredJob(await response.text(), entry, source);
        } catch {
          return null;
        }
      }));
      if (details.some((job) => job === null)) failedDetail = true;
      jobs.push(...details.filter((job): job is CrawledJob => job !== null));
    }
    if (failedDetail || jobs.length !== pageEntries.length) return {
      status: "failed",
      responseStatus,
      completeListing: false,
      jobs: [],
      error: `Meta careers sitemap detail segment ${page} was incomplete.`,
    };
    return {
      status: "succeeded",
      responseStatus,
      completeListing: false,
      jobs,
      pagination: {
        nextPage: authoritativeSitemap
          ? page === totalPages ? 1 : page + 1
          : readerCursorBase + (page === totalPages ? 1 : page + 1),
        cycleComplete: authoritativeSitemap && page === totalPages,
        totalPages,
      },
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Meta sitemap crawler error.",
    };
  }
}

async function crawlMetaCareers(source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> {
  const fallbackOperationId = "27129360303422352";
  let responseStatus: number | null = null;
  try {
    // Meta's edge rejects a fabricated browser User-Agent from server runtimes, while
    // the public no-cookie document and GraphQL operation remain directly available.
    const pageResponse = await fetchWithTimeout(fetcher, source.postingUrl, undefined, false);
    responseStatus = pageResponse.status;
    if (!pageResponse.ok) return crawlMetaSitemapFallback(source, fetcher);
    const sessionCookie = [...(pageResponse.headers.get("set-cookie") ?? "")
      .matchAll(/(?:^|,\s*)([!#$%&'*+\-.^_`|~0-9A-Za-z]+)=([^;,\s]+)/g)]
      .map((match) => `${match[1]}=${match[2]}`)
      .join("; ");
    const html = await pageResponse.text();
    const lsd = html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1];
    if (!lsd) return crawlMetaSitemapFallback(source, fetcher);

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
    const requestOperation = async (endpoint: string, browserMetadata: boolean): Promise<{ response: Response; payload: MetaCareerPayload | null }> => {
      const body = new URLSearchParams({
        lsd,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "CareersJobSearchResultsV2DataQuery",
        server_timestamps: "true",
        variables: JSON.stringify(variables),
        doc_id: fallbackOperationId,
      });
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://www.metacareers.com",
          referer: source.postingUrl,
          "x-fb-friendly-name": "CareersJobSearchResultsV2DataQuery",
          "x-fb-lsd": lsd,
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
          ...(browserMetadata ? {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "accept-language": "en-US,en;q=0.9",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          } : {}),
        },
        body,
      }, false, { attempts: 1, timeoutMs: 30_000 });
      responseStatus = response.status;
      if (!response.ok) return { response, payload: null };
      const text = await response.text();
      try {
        return { response, payload: JSON.parse(text) as MetaCareerPayload };
      } catch {
        return { response, payload: null };
      }
    };
    const isUsableCatalog = (value: MetaCareerJob[] | undefined): value is MetaCareerJob[] => (
      Array.isArray(value) && value.length > 0 && value.every((job) => Boolean(job.id && job.title))
    );
    let search: { response: Response; payload: MetaCareerPayload | null } | null = null;
    let rawJobs: MetaCareerJob[] | undefined;
    const graphFailures: string[] = [];
    const graphEndpoints = ["https://www.metacareers.com/api/graphql/", "https://www.metacareers.com/graphql/"];
    const graphAttempts = [
      ...graphEndpoints.map((endpoint) => ({ endpoint, browserMetadata: false })),
      ...graphEndpoints.map((endpoint) => ({ endpoint, browserMetadata: true })),
    ];
    for (const { endpoint, browserMetadata } of graphAttempts) {
      const label = `${new URL(endpoint).pathname}${browserMetadata ? " browser" : " minimal"}`;
      try {
        search = await requestOperation(endpoint, browserMetadata);
        rawJobs = search.payload?.data?.job_search_with_featured_jobs_v2?.all_jobs;
        if (search.response.ok && isUsableCatalog(rawJobs)) break;
        graphFailures.push(`${label}: ${search.response.ok ? "non-JSON or invalid catalog" : `HTTP ${search.response.status}`}`);
      } catch {
        graphFailures.push(`${label}: request failed`);
        continue;
      }
    }
    if (!search?.response.ok || !isUsableCatalog(rawJobs)) {
      const fallback = await crawlMetaSitemapFallback(source, fetcher);
      return fallback.status === "succeeded" ? fallback : {
        ...fallback,
        error: `Meta GraphQL endpoints failed (${graphFailures.join("; ")}); ${fallback.error ?? "Meta sitemap fallback failed."}`,
      };
    }
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
        officialUrl: `https://www.metacareers.com/profile/job_details/${job.id}/`,
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
      completeListing: rawJobs.length > 0 && jobs.length === rawJobs.length,
      jobs,
      ...(facets.length > 0 ? { facets } : {}),
      error: null,
    };
  } catch (error) {
    const fallback = await crawlMetaSitemapFallback(source, fetcher);
    return fallback.status === "succeeded" ? fallback : {
      ...fallback,
      error: error instanceof Error ? `${error.message}; ${fallback.error ?? "Meta sitemap fallback failed."}` : fallback.error,
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
    const isCisco = source.id === "p4-0245-cisco";
    let activeEndpoint = endpoint;
    const endpointUrl = new URL(endpoint);
    const sourceUrl = new URL(source.postingUrl);
    const site = endpointUrl.pathname.split("/").at(-2);
    const referer = site ? `${endpointUrl.origin}/${site}` : endpointUrl.origin;
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      origin: endpointUrl.origin,
      referer,
    };
    const searchText = source.id === "p5-0532-aetna"
      ? "Aetna"
      : sourceUrl.searchParams.get("q")?.trim() ?? "";
    const fetchPage = async (offset: number, appliedFacets: Record<string, string[]> = {}): Promise<{ status: number; payload: WorkdayPayload }> => {
      let response = await fetchWithTimeout(fetcher, activeEndpoint, {
        method: "POST",
        headers,
        // Workday's public CXS endpoint rejects page sizes above 20.
        body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText }),
      // A later scheduled crawl is the retry boundary. Retrying a slow tenant
      // inside the same source lease can otherwise hold a two-source batch for
      // 30+ seconds without adding coverage.
      }, true, { attempts: 1, timeoutMs: source.id === "p5-1096-vantor" ? 22_000 : 12_000 });
      // A small set of Workday vanity hosts replace the tenant underscore in
      // the public CXS path with a hyphen (for example sallie-mae ->
      // sallie_mae). The board HTML advertises the underscored tenant, but a
      // landing-page discovery only sees the vanity hostname. Retry this
      // deterministic spelling once when Workday rejects the first request.
      if (offset === 0 && response.status === 422) {
        const candidate = new URL(activeEndpoint);
        const segments = candidate.pathname.split("/").filter(Boolean);
        if (segments[0] === "wday" && segments[1] === "cxs" && segments[2]?.includes("-")) {
          await response.body?.cancel().catch(() => undefined);
          segments[2] = segments[2].replaceAll("-", "_");
          candidate.pathname = `/${segments.join("/")}`;
          const retry = await fetchWithTimeout(fetcher, candidate, {
            method: "POST",
            headers,
            body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText }),
          }, true, { attempts: 1, timeoutMs: source.id === "p5-1096-vantor" ? 22_000 : 12_000 });
          if (retry.ok) activeEndpoint = candidate.href;
          response = retry;
        }
      }
      if (!response.ok) {
        throw Object.assign(new Error(`Workday returned HTTP ${response.status}.`), { responseStatus: response.status });
      }
      return { status: response.status, payload: await response.json() as WorkdayPayload };
    };

    const first = await fetchPage(0);
    const total = first.payload.total ?? first.payload.jobPostings?.length ?? 0;
    const usableFirstJobs = (first.payload.jobPostings ?? [])
      .filter((job) => Boolean(job.title && job.externalPath));
    if (isCisco && (total <= 0 || usableFirstJobs.length === 0)) return {
      status: "failed",
      responseStatus: first.status,
      completeListing: false,
      jobs: [],
      error: "Cisco's official Workday catalog returned no usable jobs.",
    };
    const totalPages = Math.max(1, Math.ceil(Math.min(total, 2_000) / 20));
    const isIntel = source.id === "p5-0947-intel" || source.company === "Intel";
    const isCheckpointed = isCisco || (totalPages > 20 && !isIntel);
    const startPage = isCheckpointed ? Math.min(Math.max(source.crawlPageCursor ?? 1, 1), totalPages) : 1;
    const endPage = isCheckpointed ? Math.min(startPage + (startPage === 1 ? 19 : 18), totalPages) : totalPages;
    const pageNumbers = Array.from(
      { length: Math.max(0, endPage - Math.max(startPage, 2) + 1) },
      (_, index) => Math.max(startPage, 2) + index,
    );
    const pagePayloads = [first.payload];
    const offsets = pageNumbers.map((page) => (page - 1) * 20);
    for (let index = 0; index < offsets.length; index += 8) {
      const pages = await Promise.all(offsets.slice(index, index + 8).map((offset) => fetchPage(offset)));
      pagePayloads.push(...pages.map(({ payload }) => payload));
    }

    const rawJobs = pagePayloads.flatMap((payload) => payload.jobPostings ?? []);
    const seenPageIdentities = new Set<string>();
    let firstFailedPage: number | null = claimPageIdentities(
      usableFirstJobs.map((job) => job.externalPath),
      Math.min(20, total),
      seenPageIdentities,
    ) ? null : 1;
    for (let index = 1; index < pagePayloads.length && firstFailedPage === null; index += 1) {
      const pageNumber = pageNumbers[index - 1];
      const expected = Math.min(20, Math.max(0, total - (pageNumber - 1) * 20));
      if (!claimPageIdentities(
        (pagePayloads[index].jobPostings ?? [])
          .filter((job) => Boolean(job.title && job.externalPath))
          .map((job) => job.externalPath),
        expected,
        seenPageIdentities,
      )) firstFailedPage = pageNumber;
    }
    const facets: CrawledFacet[] = (first.payload.facets ?? []).flatMap((facet) => facet.facetParameter && facet.descriptor ? [{
      key: facet.facetParameter,
      label: facet.descriptor,
      values: (facet.values ?? []).flatMap((value) => value.id && value.descriptor ? [{ key: value.id, label: value.descriptor, count: value.count ?? null }] : []),
    }] : []);

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

    if (isIntel) {
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
      completeListing: !isCheckpointed && firstFailedPage === null && total <= 2_000 && jobs.length === total,
      jobs,
      ...(facets.length > 0 ? { facets } : {}),
      ...(isCheckpointed ? {
        pagination: {
          nextPage: firstFailedPage ?? (endPage === totalPages ? 1 : endPage),
          cycleComplete: firstFailedPage === null && endPage === totalPages && total <= 2_000,
          totalPages,
        },
      } : {}),
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

const crawlHoulihanLokey = async (
  source: CrawlSource,
  fetcher: typeof fetch,
  now: Date,
): Promise<SourceCrawlResult> => {
  const boards = [
    "https://hl.wd1.myworkdayjobs.com/Campus",
    "https://hl.wd1.myworkdayjobs.com/Lateral",
    "https://hl.wd1.myworkdayjobs.com/Corporate",
  ];
  const results = await Promise.all(boards.map(async (postingUrl) => {
    const endpoint = workdayFeed(postingUrl);
    if (!endpoint) return {
      status: "failed" as const,
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: "Houlihan Lokey Workday endpoint was invalid.",
    };
    return crawlWorkday({ ...source, postingUrl, adapter: "workday" }, endpoint, fetcher, now);
  }));
  const jobs = uniqueJobs(results.flatMap((result) => result.jobs));
  if (jobs.length > 0) return {
    status: "succeeded",
    responseStatus: results.find((result) => result.status === "succeeded")?.responseStatus ?? 200,
    completeListing: results.every((result) => result.status === "succeeded" && result.completeListing),
    jobs,
    error: null,
  };
  return {
    status: results.some((result) => result.status === "blocked") ? "blocked" : "failed",
    responseStatus: results.find((result) => result.responseStatus != null)?.responseStatus ?? null,
    completeListing: false,
    jobs: [],
    error: "Houlihan Lokey's three official Workday catalogs returned no usable jobs.",
  };
};

const crawlWhatnot = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://jobs.whatnot.com/api/jobs";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, true, { attempts: 2, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Whatnot jobs API returned HTTP ${response.status}.` };
    const payload = await response.json() as { results?: Array<Record<string, unknown>> };
    const records = Array.isArray(payload.results) ? payload.results.filter((record) => record.isListed !== false && record.status !== "Archived") : [];
    const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
      const id = asText(record.id);
      const title = asText(record.title);
      const officialUrl = asText(record.externalLink) ?? asText(record.applyLink);
      if (!id || !title || !officialUrl) return [];
      return [{
        externalId: id, title, company: source.company, location: asText(record.locationExternalName) ?? asText(record.locationName),
        arrangement: /remote/i.test(asText(record.workplaceType) ?? "") ? "remote" : /hybrid/i.test(asText(record.workplaceType) ?? "") ? "hybrid" : "onsite",
        employmentType: normalizeEmploymentType(record.employmentType), summary: asText(record.compensationTierSummary),
        department: asText(record.departmentName), team: asText(record.teamName),
        secondaryLocations: Array.isArray(record.secondaryLocationNames) ? record.secondaryLocationNames.flatMap((value) => asText(value) ?? []) : [],
        applyUrl: asText(record.applyLink), officialUrl, publishedAt: normalizedDate(record.publishedDate), sourceUpdatedAt: normalizedDate(record.updatedAt),
      }];
    }));
    return { status: jobs.length ? "succeeded" : "failed", responseStatus: response.status, completeListing: jobs.length > 0 && jobs.length === records.length, jobs, resolvedListingUrl: "https://jobs.whatnot.com/", error: jobs.length ? null : "Whatnot jobs API contained no usable jobs." };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Whatnot jobs API failed." };
  }
};

const crawlAurora = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://aurora.tech/api/jobs-index";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, true, { attempts: 2, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Aurora jobs API returned HTTP ${response.status}.` };
    const payload = await response.json() as { jobs?: Array<Record<string, unknown>> };
    const records = Array.isArray(payload.jobs) ? payload.jobs : [];
    const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
      const id = asText(record.id);
      const title = asText(record.title);
      const officialUrl = asText(record.applyLink);
      if (!id || !title || !officialUrl) return [];
      const locations = Array.isArray(record.locations) ? record.locations.flatMap((value) => asText(value) ?? []) : [];
      const description = asText(record.searchText)?.slice(0, 50_000) ?? null;
      return [{
        externalId: id, title, company: source.company, location: locations[0] ?? null,
        arrangement: record.isRemote === true ? "remote" : "onsite", employmentType: normalizeEmploymentType(record.employmentType),
        summary: description, description, department: asText(record.category), secondaryLocations: locations.slice(1),
        officialUrl, publishedAt: normalizedDate(record.publishedDate), sourceUpdatedAt: normalizedDate(record.updatedAt),
      }];
    }));
    return { status: jobs.length ? "succeeded" : "failed", responseStatus: response.status, completeListing: jobs.length > 0 && jobs.length === records.length, jobs, resolvedListingUrl: "https://aurora.tech/careers", error: jobs.length ? null : "Aurora jobs API contained no usable jobs." };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Aurora jobs API failed." };
  }
};

const crawlJaneStreet = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const endpoint = "https://www.janestreet.com/jobs/main.json";
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json" } }, true, { attempts: 2, timeoutMs: 10_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Jane Street jobs API returned HTTP ${response.status}.` };
    const records = await response.json() as Array<Record<string, unknown>>;
    const jobs = uniqueJobs((Array.isArray(records) ? records : []).flatMap((record): CrawledJob[] => {
      const id = record.id == null ? null : String(record.id);
      const title = asText(record.position)?.replaceAll("ꓟ", "M").replaceAll("ꓡ", "L").replaceAll("ꓣ", "R");
      if (!id || !title) return [];
      const description = plainText(asText(record.overview)?.slice(0, 100_000));
      const salaryMin = Number(record.min_salary);
      const salaryMax = Number(record.max_salary);
      return [{
        externalId: id, title, company: source.company, location: asText(record.city), arrangement: "unknown",
        employmentType: normalizeEmploymentType(record.availability), summary: description, description,
        department: asText(record.category), team: asText(record.team),
        salaryMin: Number.isFinite(salaryMin) ? salaryMin : null,
        salaryMax: Number.isFinite(salaryMax) ? salaryMax : null,
        salaryCurrency: Number.isFinite(salaryMin) || Number.isFinite(salaryMax) ? "USD" : null,
        officialUrl: `https://www.janestreet.com/join-jane-street/position/${encodeURIComponent(id)}/`, publishedAt: null,
      }];
    }));
    return { status: jobs.length ? "succeeded" : "failed", responseStatus: response.status, completeListing: jobs.length > 0 && jobs.length === records.length, jobs, resolvedListingUrl: "https://www.janestreet.com/join-jane-street/open-roles/", error: jobs.length ? null : "Jane Street jobs API contained no usable jobs." };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Jane Street jobs API failed." };
  }
};

const crawlGuardantHealth = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://guardanthealth.com/careers/jobs/";
  try {
    const page = await fetchWithTimeout(fetcher, listingUrl, undefined, true, { attempts: 2, timeoutMs: 10_000 });
    const html = page.ok ? await page.text() : "";
    const nonce = html.match(/var\s+workdayApi\s*=\s*\{[^}]*"nonce":"([^"]+)"/i)?.[1];
    if (!nonce) return { status: page.status === 403 ? "blocked" : "failed", responseStatus: page.status, completeListing: false, jobs: [], error: "Guardant Health careers page did not expose its jobs API nonce." };
    const response = await fetchWithTimeout(fetcher, "https://guardanthealth.com/wp-admin/admin-ajax.php", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", referer: listingUrl },
      body: new URLSearchParams({ action: "get_workday_data", nonce }).toString(),
    }, true, { attempts: 2, timeoutMs: 12_000 });
    if (!response.ok) return { status: isBlockedHttpStatus(response.status) ? "blocked" : "failed", responseStatus: response.status, completeListing: false, jobs: [], error: `Guardant Health jobs API returned HTTP ${response.status}.` };
    const payload = await response.json() as { success?: unknown; data?: { data?: Array<Record<string, unknown>> } };
    const records = payload.success === true && Array.isArray(payload.data?.data) ? payload.data.data : [];
    const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
      const id = asText(record.id);
      const title = asText(record.title);
      const officialUrl = asText(record.url);
      if (!id || !title || !officialUrl) return [];
      const primary = record.primaryLocation as Record<string, unknown> | undefined;
      const timeType = record.timeType as Record<string, unknown> | undefined;
      const company = record.company as Record<string, unknown> | undefined;
      const categories = Array.isArray(record.categories) ? record.categories as Array<Record<string, unknown>> : [];
      const description = plainText(asText(record.jobDescription)?.slice(0, 100_000));
      return [{
        externalId: id, title, company: source.company, location: asText(primary?.descriptor), arrangement: /remote/i.test(asText(primary?.descriptor) ?? "") ? "remote" : "onsite",
        employmentType: normalizeEmploymentType(timeType?.descriptor), summary: description, description,
        department: categories.map((value) => asText(value.descriptor)).filter(Boolean).join("; ") || null,
        businessUnit: asText(company?.descriptor), officialUrl, publishedAt: normalizedDate(record.startDate),
      }];
    }));
    return { status: jobs.length ? "succeeded" : "failed", responseStatus: response.status, completeListing: jobs.length > 0 && jobs.length === records.length, jobs, resolvedListingUrl: listingUrl, error: jobs.length ? null : "Guardant Health jobs API contained no usable jobs." };
  } catch (error) {
    return { status: "failed", responseStatus: null, completeListing: false, jobs: [], error: error instanceof Error ? error.message : "Guardant Health jobs API failed." };
  }
};

type TaboolaEmbeddedJob = {
  id?: string | number;
  title?: string;
  office_text?: string | null;
  office_textual?: string | null;
  country?: string | null;
  teams_text?: string | null;
  greenhouse_job_id?: string | number | null;
  body?: string | null;
  link?: string | null;
};

const taboolaJobsFromHtml = (html: string, source: CrawlSource, listingUrl: string): {
  jobs: CrawledJob[];
  rawCount: number;
} | null => {
  const embedded = embeddedJsonArray(html, "var jobs =");
  if (!embedded) return null;
  const raw = embedded.filter((value): value is TaboolaEmbeddedJob => Boolean(value) && typeof value === "object");
  const listing = new URL(listingUrl);
  const jobs = uniqueJobs(raw.flatMap((record): CrawledJob[] => {
    const externalIdValue = record.greenhouse_job_id ?? record.id;
    const externalId = externalIdValue == null ? "" : String(externalIdValue).trim();
    const title = plainText(record.title) ?? "";
    const linked = asText(record.link);
    if (!externalId || !title || !linked) return [];
    let official: URL;
    try {
      official = new URL(linked, listing);
    } catch {
      return [];
    }
    if (official.origin !== listing.origin || !/^\/careers\/job\//i.test(official.pathname)) return [];
    official.hash = "";
    const description = plainText(record.body);
    const location = asText(record.office_textual) ?? asText(record.office_text) ?? asText(record.country);
    const programs = classifyJobPrograms(title).keys;
    return [{
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType: programs.some((key) => key === "internship" || key === "coop") ? "Internship" : null,
      summary: description,
      ...(description ? { description } : {}),
      ...(asText(record.teams_text) ? { department: asText(record.teams_text) } : {}),
      ...(asText(record.country) ? { locationCountry: asText(record.country) } : {}),
      requisitionId: externalId,
      officialUrl: official.href,
      publishedAt: null,
    }];
  }));
  return { jobs, rawCount: raw.length };
};

const crawlTaboola = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://www.taboola.com/careers/jobs/";
  try {
    const response = await fetchWithTimeout(fetcher, listingUrl, {
      headers: { accept: "text/html,application/xhtml+xml" },
    }, true, { attempts: 2, timeoutMs: 12_000 });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `Taboola careers returned HTTP ${response.status}.`,
    };
    const parsed = taboolaJobsFromHtml(await response.text(), source, listingUrl);
    if (!parsed || parsed.rawCount === 0 || parsed.jobs.length === 0) return {
      status: "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: "Taboola careers did not expose a usable embedded catalog.",
    };
    const exact = parsed.jobs.length === parsed.rawCount;
    return {
      status: "succeeded",
      responseStatus: response.status,
      completeListing: exact,
      jobs: parsed.jobs,
      resolvedListingUrl: listingUrl,
      error: exact ? null : "Taboola embedded catalog contained unusable job identities.",
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Taboola careers failed.",
    };
  }
};

type OccPositionLocation = {
  LocationName?: unknown;
  CityName?: unknown;
  CountrySubDivisionCode?: unknown;
  CountryCode?: unknown;
  PostalCode?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
};

type OccPositionDescriptor = {
  PositionID?: unknown;
  PositionTitle?: unknown;
  PositionURI?: unknown;
  ApplyURI?: unknown;
  PositionSchedule?: unknown;
  PositionOfferingType?: unknown;
  PositionRemuneration?: unknown;
  PositionLocation?: unknown;
  PositionStartDate?: unknown;
  PositionEndDate?: unknown;
  QualificationSummary?: unknown;
  UserArea?: unknown;
};

type OccPositionRecord = {
  MatchedObjectId?: unknown;
  MatchedObjectDescriptor?: OccPositionDescriptor;
};

const activeThrough = (value: unknown, now: Date): boolean => {
  const date = normalizedDate(value);
  return !date || new Date(date).getTime() + 24 * 60 * 60 * 1_000 > now.getTime();
};

const canonicalUsaJobsUrl = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "www.usajobs.gov"
      || !/^\/job\//i.test(url.pathname)) return null;
    url.port = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
};

const usaJobsRecordsToJobs = (
  records: OccPositionRecord[],
  source: CrawlSource,
  usaJobsOnly = true,
): CrawledJob[] => uniqueJobs(
  records.flatMap((record): CrawledJob[] => {
    const descriptor = record.MatchedObjectDescriptor;
    const externalId = asText(record.MatchedObjectId) ?? asText(descriptor?.PositionID);
    const title = asText(descriptor?.PositionTitle);
    const officialUrl = canonicalUsaJobsUrl(descriptor?.PositionURI)
      ?? (usaJobsOnly ? null : asText(descriptor?.PositionURI));
    if (!descriptor || !externalId || !title || !officialUrl) return [];
    const locations = Array.isArray(descriptor.PositionLocation)
      ? descriptor.PositionLocation as OccPositionLocation[]
      : [];
    const primary = locations[0];
    const locationText = (location: OccPositionLocation): string | null => {
      const fallback = [asText(location.CityName), asText(location.CountrySubDivisionCode), asText(location.CountryCode)]
        .filter(Boolean)
        .join(", ");
      return asText(location.LocationName) ?? (fallback || null);
    };
    const schedules = Array.isArray(descriptor.PositionSchedule)
      ? (descriptor.PositionSchedule as Array<Record<string, unknown>>).map((value) => asText(value.Name)).filter(Boolean)
      : [];
    const remuneration = Array.isArray(descriptor.PositionRemuneration)
      ? descriptor.PositionRemuneration[0] as Record<string, unknown> | undefined
      : undefined;
    const details = descriptor.UserArea && typeof descriptor.UserArea === "object"
      ? (descriptor.UserArea as { Details?: Record<string, unknown> }).Details
      : undefined;
    const description = plainText([
      asText(descriptor.QualificationSummary),
      asText(details?.JobSummary),
      asText(details?.MajorDuties),
      asText(details?.Education),
      asText(details?.Requirements),
    ].filter(Boolean).join(" "));
    const salaryMin = Number(remuneration?.MinimumRange);
    const salaryMax = Number(remuneration?.MaximumRange);
    const latitude = Number(primary?.Latitude);
    const longitude = Number(primary?.Longitude);
    const applyUrl = Array.isArray(descriptor.ApplyURI)
      ? descriptor.ApplyURI.map(asText).find((value): value is string => Boolean(value)) ?? null
      : null;
    return [{
      externalId,
      title,
      company: source.company,
      location: primary ? locationText(primary) : null,
      arrangement: /\bremote|anywhere\b/i.test(locations.map((location) => locationText(location)).join(" ")) ? "remote" : "unknown",
      employmentType: normalizeEmploymentType(schedules.join(" / ") || asText(descriptor.PositionOfferingType)),
      summary: description,
      ...(description ? { description } : {}),
      ...(locations.length > 1 ? { secondaryLocations: locations.slice(1).map(locationText).filter((value): value is string => Boolean(value)) } : {}),
      ...(asText(primary?.CityName) ? { locationCity: asText(primary?.CityName) } : {}),
      ...(asText(primary?.CountrySubDivisionCode) ? { locationState: asText(primary?.CountrySubDivisionCode) } : {}),
      ...(asText(primary?.CountryCode) ? { locationCountry: asText(primary?.CountryCode) } : {}),
      ...(asText(primary?.PostalCode) ? { locationPostalCode: asText(primary?.PostalCode) } : {}),
      ...(Number.isFinite(latitude) ? { latitude } : {}),
      ...(Number.isFinite(longitude) ? { longitude } : {}),
      ...(Number.isFinite(salaryMin) ? { salaryMin } : {}),
      ...(Number.isFinite(salaryMax) ? { salaryMax } : {}),
      ...(Number.isFinite(salaryMin) || Number.isFinite(salaryMax) ? { salaryCurrency: "USD" } : {}),
      ...(asText(remuneration?.RateIntervalCode) ? { salaryInterval: asText(remuneration?.RateIntervalCode) } : {}),
      requisitionId: asText(descriptor.PositionID) ?? externalId,
      ...(applyUrl ? { applyUrl } : {}),
      ...(normalizedDate(descriptor.PositionEndDate) ? { validThrough: normalizedDate(descriptor.PositionEndDate) } : {}),
      officialUrl,
      publishedAt: normalizedDate(descriptor.PositionStartDate),
    }];
  }),
);

const usaJobsAuthorizationKey = async (fetcher: typeof fetch): Promise<{
  key: string | null;
  responseStatus: number | null;
}> => {
  try {
    const response = await fetchWithTimeout(fetcher, "https://www.occ.gov/scripts/careers-openings.js", {
      headers: { accept: "application/javascript,text/javascript" },
    }, true, { attempts: 2, timeoutMs: 10_000 });
    if (!response.ok) return { key: null, responseStatus: response.status };
    const script = await response.text();
    return {
      key: script.match(/["']Authorization-Key["']\s*:\s*["']([^"']+)["']/i)?.[1] ?? null,
      responseStatus: response.status,
    };
  } catch {
    return { key: null, responseStatus: null };
  }
};

const crawlUsaJobs = async (source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> => {
  const page = new URL(source.postingUrl);
  const organization = page.searchParams.get("a")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{2,12}$/.test(organization)) return {
    status: "failed",
    responseStatus: null,
    completeListing: false,
    jobs: [],
    error: "USAJOBS source did not identify a supported organization code.",
  };
  const authorization = await usaJobsAuthorizationKey(fetcher);
  if (!authorization.key) return {
    status: authorization.responseStatus != null && isBlockedHttpStatus(authorization.responseStatus) ? "blocked" : "failed",
    responseStatus: authorization.responseStatus,
    completeListing: false,
    jobs: [],
    error: "USAJOBS public API authorization key was unavailable.",
  };
  const endpoint = new URL("https://data.usajobs.gov/api/search");
  endpoint.searchParams.set("Organization", organization);
  endpoint.searchParams.set("ResultsPerPage", "500");
  try {
    const response = await fetchWithTimeout(fetcher, endpoint, {
      headers: {
        accept: "application/json",
        "authorization-key": authorization.key,
        "user-agent": "Job Pulse Realtime (kimchany@usc.edu)",
      },
    }, true, { attempts: 2, timeoutMs: 12_000 });
    if (!response.ok) return {
      status: isBlockedHttpStatus(response.status) ? "blocked" : "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: `USAJOBS API returned HTTP ${response.status}.`,
    };
    const payload = await response.json() as {
      SearchResult?: {
        SearchResultCount?: unknown;
        SearchResultCountAll?: unknown;
        SearchResultItems?: OccPositionRecord[];
      };
    };
    const items = payload.SearchResult?.SearchResultItems;
    const pageCount = Number(payload.SearchResult?.SearchResultCount ?? items?.length);
    const totalCount = Number(payload.SearchResult?.SearchResultCountAll ?? pageCount);
    if (!Array.isArray(items) || !Number.isInteger(pageCount) || pageCount !== items.length
      || !Number.isInteger(totalCount) || totalCount !== items.length || totalCount > 500) return {
      status: "failed",
      responseStatus: response.status,
      completeListing: false,
      jobs: [],
      error: "USAJOBS API returned an incomplete or malformed catalog.",
    };
    const records = items.filter((record) => activeThrough(record.MatchedObjectDescriptor?.PositionEndDate, now));
    const jobs = usaJobsRecordsToJobs(records, source);
    const identities = records.map((record) => canonicalUsaJobsUrl(record.MatchedObjectDescriptor?.PositionURI));
    const exact = identities.every((identity): identity is string => Boolean(identity))
      && jobs.length === records.length
      && jobs.length === new Set(identities).size;
    return {
      status: exact || jobs.length > 0 ? "succeeded" : "failed",
      responseStatus: response.status,
      completeListing: exact,
      jobs,
      resolvedListingUrl: source.postingUrl,
      error: exact ? null : "USAJOBS API returned unusable job identities.",
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "USAJOBS API failed.",
    };
  }
};

const crawlOcc = async (source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> => {
  const listingUrl = "https://www.occ.gov/about/careers/index-careers.html";
  const staticUrl = "https://www.occ.gov/includes/occjobs.json";
  const scriptUrl = "https://www.occ.gov/scripts/careers-openings.js";
  const usaJobsUrl = "https://data.usajobs.gov/api/search?Organization=TRAJ&WhoMayApply=All&customwhomayapply=15509&ResultsPerPage=500";

  let staticStatus: number | null = null;
  let scriptStatus: number | null = null;
  let usaJobsStatus: number | null = null;
  let staticValid = false;
  let usaJobsValid = false;
  let staticRecords: OccPositionRecord[] = [];
  let usaJobsRecords: OccPositionRecord[] = [];
  const [staticResult, scriptResult] = await Promise.allSettled([
    fetchWithTimeout(fetcher, staticUrl, { headers: { accept: "application/json" } }, true, { attempts: 2, timeoutMs: 10_000 }),
    fetchWithTimeout(fetcher, scriptUrl, { headers: { accept: "application/javascript,text/javascript" } }, true, { attempts: 2, timeoutMs: 10_000 }),
  ]);
  if (staticResult.status === "fulfilled") {
    const staticResponse = staticResult.value;
    staticStatus = staticResponse.status;
    if (staticResponse.ok) {
      try {
        const payload = await staticResponse.json() as Array<Record<string, unknown>>;
        if (Array.isArray(payload)) {
          staticValid = true;
          staticRecords = payload
            .filter((record) => activeThrough(record.EndDate, now))
            .map((record): OccPositionRecord => ({
              MatchedObjectId: record.ObjectID,
              MatchedObjectDescriptor: {
                PositionID: record.PositionID,
                PositionTitle: record.PositionTitle,
                PositionURI: record.Url,
                ApplyURI: [record.Url],
                PositionSchedule: [{ Name: record.PositionSchedule }],
                PositionRemuneration: [{ MinimumRange: record.SalaryMin, MaximumRange: record.SalaryMax, RateIntervalCode: record.SalaryBasis }],
                PositionLocation: [{
                  LocationName: record.PositionLocationName,
                  CountrySubDivisionCode: record.PositionState,
                  Latitude: record.Latitude,
                  Longitude: record.Longitude,
                }],
                PositionStartDate: record.StartDate,
                PositionEndDate: record.EndDate,
              },
            }));
        }
      } catch {
        staticValid = false;
      }
    }
  }

  if (scriptResult.status === "fulfilled") {
    const scriptResponse = scriptResult.value;
    scriptStatus = scriptResponse.status;
    if (scriptResponse.ok) {
      let authorizationKey: string | undefined;
      try {
        const script = await scriptResponse.text();
        authorizationKey = script.match(/["']Authorization-Key["']\s*:\s*["']([^"']+)["']/i)?.[1];
      } catch {
        authorizationKey = undefined;
      }
      if (authorizationKey) try {
        const response = await fetchWithTimeout(fetcher, usaJobsUrl, {
          headers: {
            accept: "application/json",
            "authorization-key": authorizationKey,
            "user-agent": "Job Pulse Realtime (kimchany@usc.edu)",
          },
        }, true, { attempts: 2, timeoutMs: 12_000 });
        usaJobsStatus = response.status;
        if (response.ok) {
          const payload = await response.json() as {
            SearchResult?: {
              SearchResultCount?: unknown;
              SearchResultCountAll?: unknown;
              SearchResultItems?: OccPositionRecord[];
            };
          };
          const items = payload.SearchResult?.SearchResultItems;
          const pageCount = Number(payload.SearchResult?.SearchResultCount ?? items?.length);
          const totalCount = Number(payload.SearchResult?.SearchResultCountAll ?? pageCount);
          if (Array.isArray(items) && Number.isInteger(pageCount) && pageCount === items.length
            && Number.isInteger(totalCount) && totalCount === items.length && totalCount <= 500) {
            usaJobsValid = true;
            usaJobsRecords = items.filter((record) => activeThrough(record.MatchedObjectDescriptor?.PositionEndDate, now));
          }
        }
      } catch {
        usaJobsValid = false;
      }
    }
  }

  const records = [...staticRecords, ...usaJobsRecords];
  const jobs = usaJobsRecordsToJobs(records, source, false);
  const rawIdentities = records.map((record) => asText(record.MatchedObjectDescriptor?.PositionURI));
  const exact = staticValid && usaJobsValid
    && rawIdentities.every((identity): identity is string => Boolean(identity))
    && jobs.length === new Set(rawIdentities).size;
  if (jobs.length > 0 || exact) return {
    status: "succeeded",
    responseStatus: usaJobsStatus ?? staticStatus ?? scriptStatus,
    completeListing: exact,
    jobs,
    resolvedListingUrl: listingUrl,
    error: exact ? null : "One OCC catalog component was unavailable; retained usable jobs without closing older rows.",
  };
  const responseStatus = usaJobsStatus ?? scriptStatus ?? staticStatus;
  return {
    status: responseStatus != null && isBlockedHttpStatus(responseStatus) ? "blocked" : "failed",
    responseStatus,
    completeListing: false,
    jobs: [],
    error: "OCC's official careers feeds returned no usable current jobs.",
  };
};

const crawlCapgemini = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://www.capgemini.com/us-en/careers/?country_code=us-en";
  const pageSize = 100;
  const fetchPage = async (page: number) => {
    try {
      const endpoint = new URL("https://cg-jobstream-api.azurewebsites.net/api/job-search");
      endpoint.searchParams.set("page", String(page)); endpoint.searchParams.set("size", String(pageSize)); endpoint.searchParams.set("country_code", "us-en");
      const response = await fetchWithTimeout(fetcher, endpoint, { headers: { accept: "application/json", referer: listingUrl } }, true, { attempts: 1, timeoutMs: 10_000 });
      if (!response.ok) return null;
      const payload = await response.json() as { total?: unknown; data?: Array<Record<string, unknown>> };
      return Number.isInteger(payload.total) && Array.isArray(payload.data) ? { status: response.status, total: payload.total as number, records: payload.data } : null;
    } catch { return null; }
  };
  const first = await fetchPage(1);
  if (!first || first.total <= 0) return { status: "failed", responseStatus: first?.status ?? null, completeListing: false, jobs: [], error: "Capgemini jobs API did not return a usable first page." };
  const totalPages = Math.ceil(first.total / pageSize);
  const pages: Array<Awaited<ReturnType<typeof fetchPage>>> = [first];
  for (let page = 2; page <= totalPages; page += 6) pages.push(...await Promise.all(Array.from({ length: Math.min(6, totalPages - page + 1) }, (_, index) => fetchPage(page + index))));
  const records = pages.flatMap((page) => page?.records ?? []);
  const jobs = uniqueJobs(records.flatMap((record): CrawledJob[] => {
    const id = asText(record.id); const title = asText(record.title); const officialUrl = asText(record.apply_job_url);
    if (!id || !title || !officialUrl) return [];
    const description = plainText(asText(record.description)?.slice(0, 100_000));
    return [{ externalId: id, title, company: source.company, location: asText(record.location), arrangement: /remote/i.test(asText(record.location) ?? "") ? "remote" : "unknown", employmentType: normalizeEmploymentType(record.contract_type), summary: description, description, department: asText(record.department) ?? asText(record.sbu), experienceLevel: asText(record.experience_level), requisitionId: asText(record.ref) ?? id, officialUrl, publishedAt: normalizedDate(record.updated_at) }];
  }));
  const exact = pages.length === totalPages && pages.every((page) => page?.total === first.total) && records.length === first.total && jobs.length === records.length;
  return { status: jobs.length ? "succeeded" : "failed", responseStatus: first.status, completeListing: exact, jobs, resolvedListingUrl: listingUrl, error: jobs.length ? null : "Capgemini jobs API contained no usable jobs." };
};

/**
 * Rain's official careers page currently links to an Ashby tenant that Ashby
 * has deactivated.  A deactivated, still-official board is an authoritative
 * zero-job state, not a crawler failure.  Keep checking the official landing
 * page so a future replacement or reactivated board is discovered normally.
 */
const crawlRainAi = async (source: CrawlSource, fetcher: typeof fetch): Promise<SourceCrawlResult> => {
  const listingUrl = "https://rain.ai/careers";
  try {
    const landing = await fetchWithTimeout(fetcher, listingUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    if (!landing.ok) return {
      status: isBlockedHttpStatus(landing.status) ? "blocked" : "failed",
      responseStatus: landing.status,
      completeListing: false,
      jobs: [],
      error: `Rain AI careers returned HTTP ${landing.status}.`,
    };
    const html = await landing.text();
    const boardUrl = anchorsFromHtml(html).flatMap(({ href }) => {
      try {
        const url = new URL(href, listingUrl);
        return url.hostname === "jobs.ashbyhq.com" ? [url] : [];
      } catch {
        return [];
      }
    }).at(0);
    const slug = boardUrl?.pathname.split("/").filter(Boolean).at(0);
    if (!boardUrl || !slug) return {
      status: "failed",
      responseStatus: landing.status,
      completeListing: false,
      jobs: [],
      error: "Rain AI careers did not expose an official ATS board.",
    };

    const feed = await crawlDiscoveredFeed(source, {
      kind: "ashby",
      endpoint: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
    }, fetcher);
    if (feed.status === "succeeded") return { ...feed, resolvedListingUrl: listingUrl };
    if (feed.responseStatus !== 404) return feed;

    const board = await fetchWithTimeout(fetcher, boardUrl, undefined, true, { attempts: 1, timeoutMs: 10_000 });
    if (!board.ok) return feed;
    const state = embeddedJsonObject(await board.text(), "window.__appData = ");
    if (state && state.organization === null && state.jobBoard === null) return {
      status: "succeeded",
      responseStatus: board.status,
      completeListing: true,
      jobs: [],
      resolvedListingUrl: listingUrl,
      error: null,
    };
    return feed;
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Rain AI crawler error.",
    };
  }
};

type DayforceLocation = {
  formattedAddress?: unknown;
  isoCountryCode?: unknown;
  stateCode?: unknown;
  cityName?: unknown;
  coordinates?: unknown;
};

type DayforcePosting = {
  jobPostingId?: unknown;
  jobReqId?: unknown;
  jobTitle?: unknown;
  jobDescription?: unknown;
  hasVirtualLocation?: unknown;
  postingStartTimestampUTC?: unknown;
  postingExpiryTimestampUTC?: unknown;
  postingLocations?: unknown;
};

type DayforceSearchPayload = {
  count?: unknown;
  maxCount?: unknown;
  offset?: unknown;
  jobPostings?: unknown;
};

const dayforceScalarText = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asText(value);
};

const dayforceBoardIdentity = (value: string): {
  clientNamespace: string;
  jobBoardCode: string;
  cultureCode: string;
} | null => {
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith(".dayforcehcm.com")
      && url.hostname.toLowerCase() !== "dayforcehcm.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const localePattern = /^[a-z]{2}-[a-z]{2}$/i;
    const normalizeLocale = (value: string): string => {
      const [language, region] = value.split("-");
      return `${language.toLowerCase()}-${region.toUpperCase()}`;
    };
    let clientNamespace: string | undefined;
    let jobBoardCode: string | undefined;
    let cultureCode = "en-US";
    if (url.hostname.toLowerCase() === "jobs.dayforcehcm.com") {
      if (localePattern.test(segments[0] ?? "")) cultureCode = normalizeLocale(segments.shift()!);
      [clientNamespace, jobBoardCode] = segments;
    } else if (segments[0]?.toLowerCase() === "candidateportal") {
      segments.shift();
      if (localePattern.test(segments[0] ?? "")) cultureCode = normalizeLocale(segments.shift()!);
      clientNamespace = segments[0];
      jobBoardCode = "CANDIDATEPORTAL";
    }
    const safeSegment = /^[a-z0-9_-]{1,100}$/i;
    if (!clientNamespace || !jobBoardCode
      || !safeSegment.test(clientNamespace) || !safeSegment.test(jobBoardCode)) return null;
    return { clientNamespace, jobBoardCode, cultureCode };
  } catch {
    return null;
  }
};

const dayforceCoordinates = (value: unknown): { latitude?: number; longitude?: number } => {
  const match = asText(value)?.match(/lat\s*:\s*(-?\d+(?:\.\d+)?)\s*;\s*lng\s*:\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return {};
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {};
};

const crawlDayforce = async (
  source: CrawlSource,
  identity: NonNullable<ReturnType<typeof dayforceBoardIdentity>>,
  fetcher: typeof fetch,
): Promise<SourceCrawlResult> => {
  const origin = "https://jobs.dayforcehcm.com";
  const pageSize = 25;
  const maximumPagesPerPass = 20;
  let responseStatus: number | null = null;
  try {
    const csrfResponse = await fetchWithTimeout(fetcher, `${origin}/api/auth/csrf`, {
      headers: { accept: "application/json" },
    }, true, { attempts: 1, timeoutMs: 10_000 });
    responseStatus = csrfResponse.status;
    if (!csrfResponse.ok) throw Object.assign(
      new Error(`Dayforce CSRF endpoint returned HTTP ${csrfResponse.status}.`),
      { responseStatus: csrfResponse.status },
    );
    const csrfPayload = await csrfResponse.json() as { csrfToken?: unknown };
    const csrfToken = asText(csrfPayload.csrfToken);
    const setCookies = typeof csrfResponse.headers.getSetCookie === "function"
      ? csrfResponse.headers.getSetCookie().join(", ")
      : csrfResponse.headers.get("set-cookie") ?? "";
    const csrfCookie = setCookies.match(/(?:^|,\s*)(__Host-next-auth\.csrf-token=[^;,\s]+)/i)?.[1] ?? null;
    if (!csrfToken || csrfToken.length > 512 || !csrfCookie) {
      throw new Error("Dayforce CSRF response was unusable.");
    }

    const endpoint = `${origin}/api/geo/${encodeURIComponent(identity.clientNamespace)}/jobposting/search`;
    const referer = `${origin}/${encodeURIComponent(identity.cultureCode)}/${encodeURIComponent(identity.clientNamespace)}/${encodeURIComponent(identity.jobBoardCode)}`;
    const fetchPage = async (page: number): Promise<{
      status: number;
      total: number;
      offset: number;
      postings: DayforcePosting[];
      valid: boolean;
    }> => {
      const offset = (page - 1) * pageSize;
      const response = await fetchWithTimeout(fetcher, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: csrfCookie,
          origin,
          referer,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          clientNamespace: identity.clientNamespace,
          jobBoardCode: identity.jobBoardCode,
          cultureCode: identity.cultureCode,
          paginationStart: offset,
        }),
      }, true, { attempts: 1, timeoutMs: 12_000 });
      responseStatus = response.status;
      if (!response.ok) throw Object.assign(
        new Error(`Dayforce job search returned HTTP ${response.status}.`),
        { responseStatus: response.status },
      );
      const payload = await response.json() as DayforceSearchPayload;
      const total = Number(payload.maxCount);
      const returnedOffset = Number(payload.offset);
      const count = Number(payload.count);
      const postings = Array.isArray(payload.jobPostings) ? payload.jobPostings as DayforcePosting[] : [];
      const expectedCount = Number.isInteger(total) && total >= 0
        ? Math.min(pageSize, Math.max(0, total - offset))
        : -1;
      const valid = Number.isInteger(total) && total >= 0
        && returnedOffset === offset
        && count === postings.length
        && postings.length === expectedCount
        && postings.every((posting) => Boolean(dayforceScalarText(posting.jobPostingId) && asText(posting.jobTitle)));
      return { status: response.status, total, offset: returnedOffset, postings, valid };
    };

    const catalog = await fetchPage(1);
    if (!catalog.valid) throw new Error("Dayforce returned an unusable first catalog page.");
    if (catalog.total === 0) {
      const confirmation = await fetchPage(1);
      if (!confirmation.valid || confirmation.total !== 0 || confirmation.postings.length !== 0) {
        throw new Error("Dayforce returned an unstable empty catalog.");
      }
    }
    const totalPages = Math.max(1, Math.ceil(catalog.total / pageSize));
    const requestedStart = Math.max(1, Math.trunc(source.crawlPageCursor ?? 1));
    const startPage = requestedStart > totalPages ? 1 : requestedStart;
    const first = startPage === 1 ? catalog : await fetchPage(startPage);
    if (!first.valid || first.total !== catalog.total) {
      throw new Error("Dayforce returned an unstable checkpoint page.");
    }
    const endPage = Math.min(totalPages, startPage + maximumPagesPerPass - 1);
    const pages = new Map<number, DayforcePosting[]>([[startPage, first.postings]]);
    let firstFailedPage: number | null = null;
    for (let page = startPage + 1; page <= endPage && firstFailedPage === null; page += 4) {
      const pageNumbers = Array.from({ length: Math.min(4, endPage - page + 1) }, (_, index) => page + index);
      const settled = await Promise.all(pageNumbers.map(async (pageNumber) => {
        try {
          return { pageNumber, result: await fetchPage(pageNumber) };
        } catch {
          return { pageNumber, result: null };
        }
      }));
      for (const { pageNumber, result } of settled) {
        if (!result?.valid || result.total !== catalog.total) {
          firstFailedPage = firstFailedPage == null ? pageNumber : Math.min(firstFailedPage, pageNumber);
          continue;
        }
        pages.set(pageNumber, result.postings);
      }
    }
    const lastCompletePage = firstFailedPage == null ? endPage : firstFailedPage - 1;
    const flattenPages = (catalogPages: Map<number, DayforcePosting[]>): DayforcePosting[] => [...catalogPages.entries()]
      .filter(([page]) => page <= lastCompletePage)
      .sort(([left], [right]) => left - right)
      .flatMap(([, postings]) => postings);
    const hasStableIdentities = (postings: DayforcePosting[]): boolean => {
      const identities = postings.map((posting) => dayforceScalarText(posting.jobPostingId));
      return identities.every((identity): identity is string => Boolean(identity))
        && new Set(identities).size === identities.length;
    };
    let raw = flattenPages(pages);
    if (!hasStableIdentities(raw)) {
      // Some Dayforce tenants occasionally repeat an offset page while several
      // pages are requested concurrently. Retry the bounded segment once in
      // order, then still fail closed if the catalog remains inconsistent.
      const retriedPages = new Map<number, DayforcePosting[]>();
      for (let page = startPage; page <= lastCompletePage; page += 1) {
        const retried = await fetchPage(page);
        if (!retried.valid || retried.total !== catalog.total) {
          throw new Error("Dayforce returned duplicate or unusable job identities.");
        }
        retriedPages.set(page, retried.postings);
      }
      raw = flattenPages(retriedPages);
      if (!hasStableIdentities(raw)) {
        throw new Error("Dayforce returned duplicate or unusable job identities.");
      }
    }
    const canonicalListingUrl = referer;
    const jobs = uniqueJobs(raw.flatMap((posting): CrawledJob[] => {
      const externalId = dayforceScalarText(posting.jobPostingId);
      const title = asText(posting.jobTitle);
      if (!externalId || !title) return [];
      const locations = Array.isArray(posting.postingLocations)
        ? posting.postingLocations as DayforceLocation[]
        : [];
      const primary = locations[0];
      const addresses = locations.map((location) => asText(location.formattedAddress)).filter((value): value is string => Boolean(value));
      const virtual = posting.hasVirtualLocation === true;
      const location = [...(virtual ? ["Virtual"] : []), ...addresses].join(" • ") || null;
      const description = icimsText(asText(posting.jobDescription));
      const coordinates = dayforceCoordinates(primary?.coordinates);
      return [{
        externalId,
        title,
        company: source.company,
        location,
        arrangement: virtual ? "remote" : "unknown",
        employmentType: null,
        summary: description?.slice(0, 500) ?? null,
        ...(description ? { description } : {}),
        ...(addresses.length > 1 ? { secondaryLocations: addresses.slice(1) } : {}),
        ...(asText(primary?.cityName) ? { locationCity: asText(primary?.cityName) } : {}),
        ...(asText(primary?.stateCode) ? { locationState: asText(primary?.stateCode) } : {}),
        ...(asText(primary?.isoCountryCode) ? { locationCountry: asText(primary?.isoCountryCode) } : {}),
        ...coordinates,
        ...(dayforceScalarText(posting.jobReqId) ? { requisitionId: dayforceScalarText(posting.jobReqId) } : {}),
        ...(normalizedDate(posting.postingExpiryTimestampUTC) ? { validThrough: normalizedDate(posting.postingExpiryTimestampUTC) } : {}),
        officialUrl: `${canonicalListingUrl}/jobs/${encodeURIComponent(externalId)}`,
        publishedAt: normalizedDate(posting.postingStartTimestampUTC),
      }];
    }));
    if (jobs.length !== raw.length) throw new Error("Dayforce returned duplicate or unusable job identities.");
    const cycleComplete = firstFailedPage === null && endPage === totalPages;
    return {
      status: "succeeded",
      responseStatus: responseStatus ?? catalog.status,
      completeListing: startPage === 1 && cycleComplete && jobs.length === catalog.total,
      jobs,
      ...(totalPages > 1 || source.crawlPageCursor != null ? {
        pagination: {
          nextPage: cycleComplete ? 1 : firstFailedPage ?? Math.max(startPage + 1, endPage),
          cycleComplete,
          totalPages,
        },
      } : {}),
      resolvedListingUrl: canonicalListingUrl,
      error: firstFailedPage == null ? null : `Dayforce catalog page ${firstFailedPage} was unavailable.`,
    };
  } catch (error) {
    const status = typeof error === "object" && error && "responseStatus" in error
      ? Number((error as { responseStatus: unknown }).responseStatus)
      : responseStatus;
    return {
      status: isBlockedHttpStatus(status) ? "blocked" : "failed",
      responseStatus: status,
      completeListing: false,
      jobs: [],
      error: error instanceof Error ? error.message : "Unknown Dayforce crawler error.",
    };
  }
};

async function crawlSourceBase(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  if ((source.discoveryDepth ?? 0) === 0 && source.id === "legacy-row-806") {
    return crawlEnergyTransferSelectMinds(source, fetcher);
  }
  if ((source.discoveryDepth ?? 0) === 0 && source.id === "p4-0423-dynatrace") {
    return crawlDynatraceCoveo(source, fetcher);
  }
  // Apply an ID-pinned feed only at the root. Redirect/candidate recursion
  // keeps the same source ID, so reapplying it at discovery depth 1 would
  // loop back to the root feed until the request/deadline budget is spent.
  const verifiedFeed = (source.discoveryDepth ?? 0) === 0 ? VERIFIED_SOURCE_FEEDS[source.id] : undefined;
  if (verifiedFeed) {
    const verifiedDayforceIdentity = dayforceBoardIdentity(verifiedFeed.listingUrl);
    const result = verifiedFeed.discovered
      ? verifiedFeed.discovered.kind === "workday"
        ? await crawlWorkday(source, verifiedFeed.discovered.endpoint, fetcher, now)
        : await crawlDiscoveredFeed(source, verifiedFeed.discovered, fetcher)
      : verifiedDayforceIdentity
        ? await crawlDayforce({ ...source, postingUrl: verifiedFeed.listingUrl }, verifiedDayforceIdentity, fetcher)
      : new URL(verifiedFeed.listingUrl).hostname.endsWith("eightfold.ai")
        ? await crawlEightfold({ ...source, postingUrl: verifiedFeed.listingUrl, adapter: verifiedFeed.adapter }, fetcher)
        : await crawlJsonLd({
            ...source,
            postingUrl: verifiedFeed.listingUrl,
            adapter: verifiedFeed.adapter,
            discoveryDepth: 1,
          }, fetcher, now);
    return result.status === "succeeded"
      ? {
          ...result,
          resolvedListingUrl: verifiedDayforceIdentity
            ? result.resolvedListingUrl ?? verifiedFeed.listingUrl
            : verifiedFeed.listingUrl,
        }
      : result;
  }
  const originalPage = new URL(source.postingUrl);
  if (source.adapter === "phenom" && /\/jointalentcommunity\/?$/i.test(originalPage.pathname)) {
    originalPage.pathname = originalPage.pathname.replace(/\/jointalentcommunity\/?$/i, "/search-results");
    originalPage.search = "";
    source = { ...source, postingUrl: originalPage.href };
  } else if (source.adapter === "phenom" && /\/en\/?$/i.test(originalPage.pathname)) {
    originalPage.pathname = `${originalPage.pathname.replace(/\/$/, "")}/search-results`;
    originalPage.search = "";
    source = { ...source, postingUrl: originalPage.href };
  }
  const sourcePage = new URL(source.postingUrl);
  // These official boards currently need the reader fallback when their edge
  // blocks Worker egress. Keep them at discovery depth zero so that fallback
  // remains available, while still bypassing obsolete corporate landing URLs.
  if (source.id === "p5-0560-booking-holdings") {
    const listingUrl = "https://careers.priceline.com/?s=&post_type=job";
    const result = await crawlJsonLd({ ...source, postingUrl: listingUrl, adapter: "custom", discoveryDepth: 0 }, fetcher, now);
    return result.status === "succeeded" ? { ...result, resolvedListingUrl: listingUrl } : result;
  }
  if (source.id === "p5-0857-closedloop") {
    const listingUrl = "https://jobs.gusto.com/boards/closedloop-6c781f0b-0e21-4a98-9ba5-4b9dd44265e8";
    const result = await crawlJsonLd({ ...source, postingUrl: listingUrl, adapter: "custom", discoveryDepth: 0 }, fetcher, now);
    return result.status === "succeeded" ? { ...result, resolvedListingUrl: listingUrl } : result;
  }
  if (source.id === "p5-0935-hologic") return crawlHologic(source, fetcher);
  if (source.id === "p4-0457-match-group") {
    const listingUrl = "https://join.matchgroupcareers.com/careers?domain=gotinder.com";
    const result = await crawlEightfold({ ...source, postingUrl: listingUrl, adapter: "custom" }, fetcher);
    return result.status === "succeeded" ? { ...result, resolvedListingUrl: listingUrl } : result;
  }
  if (/^(?:www\.)?jobs\.jobvite\.com$/i.test(sourcePage.hostname)) {
    const segments = sourcePage.pathname.split("/").filter(Boolean);
    const tenant = segments[0]?.toLocaleLowerCase() === "careers" ? segments[1] : segments[0];
    if (tenant && /^[a-z0-9_-]+$/i.test(tenant)) {
      return crawlJobviteBoard(source, `https://jobs.jobvite.com/${tenant}/`, tenant, fetcher);
    }
  }
  if (source.id === "audit-row-342") return crawlDeltaAvature(source, fetcher);
  if (source.id === "p2-0067-wells-fargo") return crawlWellsFargo(source, fetcher);
  if (source.id === "p5-1041-rippling") return crawlRippling(source, fetcher);
  if (source.id === "p4-0450-jfrog") return crawlJfrog(source, fetcher);
  if (/^[a-z0-9-]+\.careers\.hibob\.com$/i.test(sourcePage.hostname)) return crawlHiBobCareers(source, fetcher);
  if (source.id === "p4-0386-whatnot") return crawlWhatnot(source, fetcher);
  if (source.id === "p5-0812-aurora-innovation") return crawlAurora(source, fetcher);
  if (source.id === "p5-0950-jane-street") return crawlJaneStreet(source, fetcher);
  if (source.id === "p5-0921-guardant-health") return crawlGuardantHealth(source, fetcher);
  if (source.id === "p2-0143-occ") return crawlOcc(source, fetcher, now);
  if (source.id === "p4-0361-taboola"
    || (sourcePage.hostname.endsWith("taboola.com") && sourcePage.pathname.startsWith("/careers"))) {
    return crawlTaboola(source, fetcher);
  }
  if (sourcePage.hostname.endsWith("usajobs.gov") && sourcePage.searchParams.has("a")) {
    return crawlUsaJobs(source, fetcher, now);
  }
  if (source.id === "p4-0234-capgemini") return crawlCapgemini(source, fetcher);
  if (source.id === "p4-0479-rain-ai" || sourcePage.hostname === "rain.ai") return crawlRainAi(source, fetcher);
  if (source.id === "audit-row-364") return crawlGraybar(source, fetcher);
  if (source.id === "audit-row-354" || sourcePage.hostname === "careers.eogresources.com") return crawlEogJobs(source, fetcher);
  if (source.id === "p2-0076-ameriprise-financial" || sourcePage.hostname === "careers.ameriprise.com") return crawlAmeripriseJobs(source, fetcher);
  if (source.id === "p5-0566-cardinal-health" || sourcePage.hostname === "jobs.cardinalhealth.com") return crawlCardinalHealth(source, fetcher);
  if (source.id === "p5-1095-vanguard" || sourcePage.hostname === "www.vanguardjobs.com") return crawlVanguard(source, fetcher);
  if (source.id === "p5-1005-olympus-medical-systems") return crawlOlympusSuccessFactors(source, fetcher);
  if (source.id === "p5-0544-amkor-technology") {
    return crawlLegacySuccessFactors(source, "https://career8.successfactors.com/career?company=amkor", fetcher, "United States");
  }
  if (source.id === "p5-1023-power-integrations") return crawlJobviteBoard(source, "https://jobs.jobvite.com/power-integrations/", "power-integrations", fetcher);
  if (source.id === "p2-0068-abrigo") return crawlJobviteBoard(source, "https://jobs.jobvite.com/bankerstoolbox", "bankerstoolbox", fetcher);
  if (source.id === "p4-0455-logrhythm") return crawlJobviteBoard(source, "https://jobs.jobvite.com/exabeam/", "exabeam", fetcher);
  if (source.id === "legacy-row-777") return crawlAceJobs(source, fetcher);
  if (source.id === "p5-0808-astronics") return crawlAstronicsRss(source, fetcher);
  if (source.id === "legacy-row-820") return crawlGraphicPackaging(source, fetcher);
  if (source.id === "legacy-row-803"
    || (sourcePage.hostname === "corporate.dow.com" && sourcePage.pathname.includes("/careers/jobs"))) {
    return crawlDow(source, fetcher);
  }
  if (sourcePage.hostname === "apply.workable.com") return crawlWorkable(source, fetcher);
  const dayforceIdentity = dayforceBoardIdentity(source.postingUrl);
  if (dayforceIdentity) return crawlDayforce(source, dayforceIdentity, fetcher);
  if (sourcePage.hostname.endsWith(".bamboohr.com")) return crawlBambooHr(source, fetcher);
  if (sourcePage.hostname.endsWith(".pinpointhq.com")) return crawlPinpoint(source, fetcher);
  if (sourcePage.hostname === "recruit.hirebridge.com") return crawlHirebridge(source, fetcher);
  if (sourcePage.hostname.endsWith(".taleo.net")) {
    const taleo = await crawlTaleoV2(source, fetcher);
    if (taleo) return taleo;
  }
  if (sourcePage.hostname === "www.asml.com" && sourcePage.pathname.includes("/careers")) {
    const search = await crawlAsmlSearch(source, fetcher);
    if (search) return search;
    const sitemap = await crawlAsmlSitemap(source, fetcher);
    if (sitemap) return sitemap;
  }
  if (sourcePage.hostname === "www.atlassian.com" && sourcePage.pathname.includes("/company/careers")) return crawlAtlassian(source, fetcher);
  if (sourcePage.hostname === "www.okta.com" && sourcePage.pathname.includes("/company/careers/job-listing")) return crawlOktaCareers(source, fetcher);
  if (sourcePage.hostname === "www.amazon.jobs" || sourcePage.hostname === "amazon.jobs") return crawlAmazonJobs(source, fetcher);
  if (source.id === "p5-0752-tiktok" || sourcePage.hostname === "lifeattiktok.com") return crawlTikTok(source, fetcher);
  if (source.id === "p4-0291-houlihan-lokey") return crawlHoulihanLokey(source, fetcher, now);
  if (source.id === "p4-0296-infosys-consulting" || sourcePage.hostname === "digitalcareers.infosys.com") return crawlInfosys(source, fetcher);
  if (source.id === "p4-0443-hubspot") return crawlHubSpot(source, fetcher);
  const brassRingIdentity = brassRingBoardIdentity(source.postingUrl);
  if (brassRingIdentity) return crawlBrassRing(source, brassRingIdentity, fetcher);
  if (source.id === "p4-0245-cisco") {
    return crawlWorkday(source, "https://cisco.wd5.myworkdayjobs.com/wday/cxs/cisco/Cisco_Careers/jobs", fetcher, now);
  }
  if (source.id === "p4-0256-databricks") return crawlDatabricks(source, fetcher);
  if (["p5-0624-ibm", "p4-0295-ibm-consulting", "p4-0446-ibm-watsonx"].includes(source.id)) return crawlIbm(source, fetcher);
  if (sourcePage.hostname === "careers.servicenow.com") return crawlServiceNow(source, fetcher);
  if (sourcePage.hostname === "block.xyz" && sourcePage.pathname === "/careers/jobs") return crawlBlockCareers(source, fetcher);
  if (source.id === "p4-0285-google" || source.id === "p5-0610-google-deepmind") return crawlGoogleCareers(source, fetcher);
  if (sourcePage.hostname === "careers.walmart.com") return crawlWalmart(source, fetcher);
  if (sourcePage.hostname === "careers.pypl.com") return crawlEightfold({
    ...source,
    postingUrl: "https://paypal.eightfold.ai/careers?domain=paypal.com",
  }, fetcher);
  if (sourcePage.hostname === "mycareer.verizon.com") {
    const sitemap = await crawlJobSitemap(source, "https://mycareer.verizon.com/en/jobs/sitemap.xml", "mycareer.verizon.com", fetcher);
    if (sitemap) return sitemap;
  }
  if (sourcePage.hostname === "careers.newscorp.com") return crawlNewsCorpSitemap(source, fetcher);
  if (sourcePage.hostname === "careers.nutanix.com") {
    const sitemap = await crawlJobSitemap(source, "https://careers.nutanix.com/sitemap.xml", "careers.nutanix.com", fetcher);
    if (sitemap) return sitemap;
  }
  if (sourcePage.hostname === "careers.northwesternmutual.com"
    && /\/corporate-careers\/?$/i.test(sourcePage.pathname)) {
    const result = await crawlNorthwesternMutual(source, fetcher);
    if (result) return result;
  }
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
  if (sourcePage.hostname.endsWith(".icims.com")) return crawlIcims(source, fetcher);
  if (sourcePage.hostname === "jobs.lever.co") {
    const slug = sourcePage.pathname.split("/").filter(Boolean).at(0);
    if (slug) return crawlDiscoveredFeed(source, {
      kind: "lever",
      endpoint: `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    }, fetcher);
  }
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
      jobs: greenhouseJobs(payload.jobs ?? [], source),
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
  const detailSegments = segments.slice(jobIndex + 1);
  if (detailSegments.at(-1)?.toLocaleLowerCase() === "apply") detailSegments.pop();
  if (detailSegments.length === 0) return [];
  const suffix = detailSegments.map(encodeURIComponent).join("/");
  const tenants = [...new Set([tenantMatch[1], tenantMatch[1].replaceAll("-", "_")])];
  return tenants.flatMap((tenant) => sites.map((site) => new URL(
    `/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/job/${suffix}`,
    url.origin,
  ).href));
};

const smartRecruitersDetailEndpoint = (job: CrawledJob): { companyCode: string; endpoint: string } | null => {
  try {
    const url = new URL(job.officialUrl);
    const companyCode = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    const externalId = job.externalId?.trim() ?? "";
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "jobs.smartrecruiters.com"
      || !/^[a-z0-9_-]+$/i.test(companyCode) || !/^[a-z0-9-]+$/i.test(externalId)) return null;
    return {
      companyCode,
      endpoint: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyCode)}/postings/${encodeURIComponent(externalId)}`,
    };
  } catch {
    return null;
  }
};

const verifiedSmartRecruitersApplyUrl = (value: string | undefined, companyCode: string, externalId: string): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return url.protocol === "https:" && url.hostname.toLocaleLowerCase() === "jobs.smartrecruiters.com"
      && path[0]?.toLocaleLowerCase() === companyCode.toLocaleLowerCase()
      && path[1]?.toLocaleLowerCase().startsWith(externalId.toLocaleLowerCase())
      ? url.href
      : null;
  } catch {
    return null;
  }
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

const jobIdentityText = (value: string | null | undefined): string => (value ?? "")
  .normalize("NFKD")
  .replace(/\p{M}+/gu, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const mergeProgramJobDetail = (
  job: CrawledJob,
  detail: Partial<CrawledJob>,
  applyUrl?: string | null,
): CrawledJob => ({
  ...job,
  location: detail.location ?? job.location,
  arrangement: detail.arrangement && detail.arrangement !== "unknown" ? detail.arrangement : job.arrangement,
  employmentType: combinedEmploymentType(job, detail.employmentType),
  summary: detail.summary ?? job.summary,
  description: detail.description ?? job.description ?? null,
  responsibilities: detail.responsibilities ?? job.responsibilities ?? null,
  qualifications: detail.qualifications ?? job.qualifications ?? null,
  skills: detail.skills?.length ? detail.skills : job.skills,
  department: detail.department ?? job.department,
  team: detail.team ?? job.team,
  businessUnit: detail.businessUnit ?? job.businessUnit,
  jobFamily: detail.jobFamily ?? job.jobFamily,
  jobFunction: detail.jobFunction ?? job.jobFunction,
  industry: detail.industry ?? job.industry,
  office: detail.office ?? job.office,
  secondaryLocations: detail.secondaryLocations?.length ? detail.secondaryLocations : job.secondaryLocations,
  locationCity: detail.locationCity ?? job.locationCity,
  locationState: detail.locationState ?? job.locationState,
  locationCountry: detail.locationCountry ?? job.locationCountry,
  locationPostalCode: detail.locationPostalCode ?? job.locationPostalCode,
  latitude: detail.latitude ?? job.latitude,
  longitude: detail.longitude ?? job.longitude,
  salaryMin: detail.salaryMin ?? job.salaryMin,
  salaryMax: detail.salaryMax ?? job.salaryMax,
  salaryCurrency: detail.salaryCurrency ?? job.salaryCurrency,
  salaryInterval: detail.salaryInterval ?? job.salaryInterval,
  benefits: detail.benefits ?? job.benefits,
  educationRequirements: detail.educationRequirements ?? job.educationRequirements,
  experienceRequirements: detail.experienceRequirements ?? job.experienceRequirements,
  experienceLevel: detail.experienceLevel ?? job.experienceLevel,
  shiftSchedule: detail.shiftSchedule ?? job.shiftSchedule,
  travelRequirements: detail.travelRequirements ?? job.travelRequirements,
  securityClearance: detail.securityClearance ?? job.securityClearance,
  languages: detail.languages?.length ? detail.languages : job.languages,
  requisitionId: detail.requisitionId ?? detail.externalId ?? job.requisitionId ?? job.externalId,
  applyUrl: applyUrl ?? detail.applyUrl ?? job.applyUrl,
  sourcePostedText: detail.sourcePostedText ?? job.sourcePostedText,
  sourceUpdatedAt: detail.sourceUpdatedAt ?? job.sourceUpdatedAt,
  validThrough: detail.validThrough ?? job.validThrough,
  publishedAt: detail.publishedAt ?? job.publishedAt,
  // The listing URL is the stable deduplication key. Detail enrichment may
  // resolve an ATS apply URL, but must never replace the canonical job URL.
  officialUrl: job.officialUrl,
});

const matchingJsonLdDetail = (html: string, source: CrawlSource, job: CrawledJob): CrawledJob | null => {
  const details = jsonLdScripts(html).flatMap(jobPostingNodes)
    .map((node) => jsonLdJob(node, source))
    .filter((detail): detail is CrawledJob => detail !== null);
  const externalIdentity = job.requisitionId ?? job.externalId;
  return details.find((detail) => Boolean(
    externalIdentity && (detail.requisitionId === externalIdentity || detail.externalId === externalIdentity),
  )) ?? details.find((detail) => jobIdentityText(detail.title) === jobIdentityText(job.title)) ?? null;
};

const officialApplyUrl = (html: string, pageUrl: string): string | null => anchorsFromHtml(html)
  .flatMap(({ href, text }) => {
    try {
      const url = new URL(href, pageUrl);
      if (!/^https:$/.test(url.protocol)) return [];
      const isWorkdayApply = /\.myworkdayjobs\.com$/i.test(url.hostname) && /\/apply\/?$/i.test(url.pathname);
      const isExplicitApply = url.origin === new URL(pageUrl).origin
        && /\bapply(?: now| externally)?\b/i.test(text)
        && /\b(?:job|career|apply)\b/i.test(url.href);
      return isWorkdayApply || isExplicitApply ? [url.href] : [];
    } catch {
      return [];
    }
  })
  .at(0) ?? null;

// Only hosts verified to publish trustworthy JobPosting JSON-LD belong here.
// Keeping this explicit avoids spending one detail request on every internship
// returned by already-rich ATS feeds.
const VERIFIED_JSON_LD_DETAIL_HOSTS = new Set([
  "jobs.citi.com",
  "search.jobs.barclays",
]);

const supportsJsonLdDetailEnrichment = (jobUrl: string): boolean => {
  try {
    return VERIFIED_JSON_LD_DETAIL_HOSTS.has(new URL(jobUrl).hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
};

const enrichProgramJobDetails = async (
  result: SourceCrawlResult,
  source: CrawlSource,
  fetcher: typeof fetch,
  now: Date,
): Promise<SourceCrawlResult> => {
  if (result.status !== "succeeded" || result.jobs.length === 0) return result;
  const enriched = [...result.jobs];
  const targets = result.jobs.flatMap((job, index) => {
    const indexedAsProgram = classifyJobPrograms(job.title).keys.length > 0
      || normalizeEmploymentType(job.employmentType)?.split(" / ").includes("Internship");
    const hasLocation = Boolean(job.location && !/^(?:location not specified|multiple locations)$/i.test(job.location.trim()));
    const needsDetail = !hasLocation
      || !job.description || job.description.trim().length < 100
      || !(job.requisitionId ?? job.externalId)
      || !job.publishedAt;
    if (!indexedAsProgram || !needsDetail) return [];
    const candidates = workdayDetailCandidates(job.officialUrl);
    return [{ index, candidates }];
  });
  const enrichmentStart = targets.length === 0
    ? 0
    : (Math.floor(now.getTime() / (2 * 60 * 60 * 1_000)) * WORKDAY_DETAIL_BATCH_SIZE) % targets.length;
  const selectedTargets = targets.length <= WORKDAY_DETAIL_BATCH_SIZE
    ? targets
    : Array.from(
        { length: WORKDAY_DETAIL_BATCH_SIZE },
        (_, offset) => targets[(enrichmentStart + offset) % targets.length],
      );

  const enrichOne = async ({ index, candidates }: { index: number; candidates: string[] }): Promise<void> => {
    const job = enriched[index];
    const selectMindsIdentity = selectMindsJobIdentity(job.officialUrl);
    if (selectMindsIdentity) {
      try {
        const response = await fetchWithTimeout(fetcher, selectMindsIdentity.url, undefined, true, { attempts: 1, timeoutMs: 4_000 });
        if (response.ok && (!response.url || response.url === selectMindsIdentity.url)) {
          const html = await response.text();
          const detailId = html.match(/class=["'][^"']*\bjUserRefreshJobId\b[^"']*["'][^>]*\bvalue=["'](\d+)["']/i)?.[1]
            ?? html.match(/\bvalue=["'](\d+)["'][^>]*class=["'][^"']*\bjUserRefreshJobId\b/i)?.[1];
          const title = icimsText(html.match(/<h1\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
          if (detailId === selectMindsIdentity.id && title && jobIdentityText(title) === jobIdentityText(job.title)) {
            const descriptionStart = html.search(/<div\b[^>]*class=["'][^"']*\bjob_description\b[^"']*["'][^>]*>/i);
            const qualificationsStart = descriptionStart >= 0
              ? html.slice(descriptionStart).search(/<div\b[^>]*class=["'][^"']*\bjob_qualifications\b[^"']*["'][^>]*>/i)
              : -1;
            const absoluteQualificationsStart = qualificationsStart >= 0 ? descriptionStart + qualificationsStart : -1;
            const technicalEnd = html.indexOf("<!-- TEC-", Math.max(descriptionStart, absoluteQualificationsStart));
            const description = descriptionStart >= 0
              ? icimsText(html.slice(descriptionStart, absoluteQualificationsStart >= 0 ? absoluteQualificationsStart : technicalEnd >= 0 ? technicalEnd : html.length))
              : null;
            const qualifications = absoluteQualificationsStart >= 0
              ? icimsText(html.slice(absoluteQualificationsStart, technicalEnd >= 0 ? technicalEnd : html.length))
              : null;
            const requisitionId = icimsText(html.match(
              /<dd\b[^>]*class=["'][^"']*\bjob_external_id\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bfield_value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
            )?.[1]);
            const postedText = icimsText(html.match(
              /<dd\b[^>]*class=["'][^"']*\bjob_post_date\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bfield_value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
            )?.[1]);
            const relative = postedText?.match(/^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i);
            const unitMs = relative ? ({ minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 } as const)[relative[2].toLocaleLowerCase() as "minute" | "hour" | "day" | "week"] : null;
            const publishedAt = relative && unitMs
              ? new Date(now.getTime() - Number(relative[1]) * unitMs).toISOString()
              : postedText && /^yesterday$/i.test(postedText)
                ? new Date(now.getTime() - 86_400_000).toISOString()
                : postedText && /^today$/i.test(postedText) ? now.toISOString() : normalizedDate(postedText);
            enriched[index] = mergeProgramJobDetail(job, {
              title,
              summary: description ?? job.summary,
              description,
              responsibilities: description,
              qualifications,
              requisitionId,
              sourcePostedText: postedText,
              publishedAt,
            });
            return;
          }
        }
      } catch {
        // Detail enrichment is optional; the verified listing remains usable.
      }
    }
    const smartRecruitersDetail = smartRecruitersDetailEndpoint(job);
    if (smartRecruitersDetail) {
      try {
        const response = await fetchWithTimeout(fetcher, smartRecruitersDetail.endpoint, {
          headers: { accept: "application/json" },
        }, false, { attempts: 1, timeoutMs: 4_000 });
        if (response.ok) {
          const payload = await response.json() as SmartRecruitersDetailPayload;
          const validIdentity = payload.active !== false
            && payload.id === job.externalId
            && typeof payload.name === "string"
            && jobIdentityText(payload.name) === jobIdentityText(job.title)
            && (!payload.company?.identifier
              || payload.company.identifier.toLocaleLowerCase() === smartRecruitersDetail.companyCode.toLocaleLowerCase());
          if (validIdentity) {
            const base = normalizeSmartRecruitersJob(source, smartRecruitersDetail.companyCode, payload);
            const sections = payload.jobAd?.sections ?? {};
            const jobDescription = icimsText(sections.jobDescription?.text);
            const qualifications = icimsText(sections.qualifications?.text);
            const additionalInformation = icimsText(sections.additionalInformation?.text);
            const description = [jobDescription, additionalInformation].filter(Boolean).join("\n\n") || null;
            enriched[index] = mergeProgramJobDetail(job, {
              ...base,
              summary: jobDescription,
              description,
              responsibilities: jobDescription,
              qualifications,
            }, verifiedSmartRecruitersApplyUrl(payload.applyUrl, smartRecruitersDetail.companyCode, job.externalId!));
            return;
          }
        }
      } catch {
        // Detail enrichment is optional; the verified listing remains usable.
      }
    }
    for (const endpoint of candidates) {
      try {
        const response = await fetchWithTimeout(fetcher, endpoint, undefined, true, { attempts: 1, timeoutMs: 4_000 });
        if (!response.ok) continue;
        const payload = await response.json() as WorkdayDetailPayload;
        const info = payload.jobPostingInfo;
        if (!info || typeof info !== "object") continue;
        const description = plainText(asText(info.jobDescription));
        const additionalLocations = Array.isArray(info.additionalLocations)
          ? info.additionalLocations.flatMap((value) => asText(value) ?? [])
          : [];
        enriched[index] = mergeProgramJobDetail(job, {
          employmentType: asText(info.timeType),
          description,
          requisitionId: asText(info.jobReqId),
          location: asText(info.location),
          ...(additionalLocations.length > 0 ? { secondaryLocations: additionalLocations } : {}),
          publishedAt: normalizedDate(info.startDate),
        });
        return;
      } catch {
        // Detail enrichment is optional; the verified listing remains usable.
      }
    }
    if (!supportsJsonLdDetailEnrichment(job.officialUrl)) return;
    try {
      const response = await fetchWithTimeout(fetcher, job.officialUrl, undefined, true, { attempts: 1, timeoutMs: 4_000 });
      if (!response.ok) return;
      const html = await response.text();
      const detail = matchingJsonLdDetail(html, source, job);
      if (!detail) return;
      enriched[index] = mergeProgramJobDetail(job, detail, officialApplyUrl(html, response.url || job.officialUrl));
    } catch {
      // A detail page is optional and must never make its verified listing fail.
    }
  };
  await Promise.all(selectedTargets.map(enrichOne));
  return { ...result, jobs: enriched };
};

const applyLargeCatalogRegionScope = (result: SourceCrawlResult, source: CrawlSource): SourceCrawlResult => {
  if (result.status !== "succeeded" || !US_SCOPED_LARGE_CATALOGS.has(source.id)) return result;
  const jobs = result.jobs.filter((job) => classifyJobRegion({
    location: job.location,
    locationCity: job.locationCity,
    locationState: job.locationState,
    locationCountry: job.locationCountry,
    secondaryLocations: job.secondaryLocations,
    sourceCompany: source.company,
    sourcePostingUrl: result.resolvedListingUrl ?? source.postingUrl,
  }) !== "non_us");
  // Native facet counts describe the unscoped global catalog. Dropping them
  // lets complete crawls derive accurate US-scoped facets, while incomplete
  // checkpoint segments leave the last authoritative facet snapshot intact.
  return { ...result, jobs, facets: undefined };
};

export async function crawlSource(source: CrawlSource, fetcher: typeof fetch, now: Date): Promise<SourceCrawlResult> {
  const budgetedFetcher = crawlBudgetedFetcher(fetcher);
  const scoped = applyLargeCatalogRegionScope(await crawlSourceBase(source, budgetedFetcher, now), source);
  const enriched = await enrichProgramJobDetails(scoped, source, budgetedFetcher, now);
  return applyLargeCatalogRegionScope(enriched, source);
}
