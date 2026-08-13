const ATS_HOST = /(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|ashbyhq\.com|icims\.com|jobvite\.com|hirebridge\.com|taleo\.net|apply\.workable\.com|bamboohr\.com|pinpointhq\.com|ats\.rippling\.com|csod\.com|dayforcehcm\.com|successfactors\.(?:com|eu)|oraclecloud\.com|eightfold\.ai|avature\.net|(?:myjobs|workforcenow)\.adp\.com|recruiting\.paylocity\.com|recruiting\d*\.ultipro\.com)/i;
const JOB_TEXT = /\b(?:jobs?|careers?|opportunities|open (?:positions|roles)|join (?:our )?team|search roles?)\b/i;
const JOB_PATH = /\/(?:jobs?|careers?|opportunities|search-results|job-search|open-positions|join-us)(?:\/|$|[?#-])/i;
const USER_ONLY = /(?:job-?alerts?|talent-?community|introduceyourself|sign[_-]?in|\/login|\/connect(?:[/?#]|$)|\/apply(?:[/?#]|$))/i;
const JOB_DETAIL = /(?:\/(?:job|jobs)\/[^/?#]+(?:\/[^/?#]+)?(?:[?#]|$)|[?&](?:pid|jobid|jobseqno|gh_jid)=)/i;

export type BrowserLink = { href: string; text: string };

export const unwrapSearchResultUrl = (href: string): string => {
  try {
    const url = new URL(href);
    if (!/(?:^|\.)bing\.com$/i.test(url.hostname)) return href;
    const encoded = url.searchParams.get("u");
    if (!encoded?.startsWith("a1")) return href;
    const base64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : href;
  } catch {
    return href;
  }
};

const COMPANY_STOP_WORDS = new Set(["company", "corporation", "corp", "group", "holdings", "holding", "international", "services", "service", "technologies", "technology", "financial", "health", "healthcare", "bank", "systems", "system", "united", "america", "american"]);
const NON_LISTING_PATH = /(?:career-areas?|early-careers?|students?|university|\/blog(?:\/|$)|jobcart|job-seeker-resources|career-progression|working-at|talent-community|jointalentcommunity|\/bca(?:\/|$)|loans?)/i;
const THIRD_PARTY_AGGREGATOR = /(?:^|\.)(?:indeed\.com|glassdoor\.com|linkedin\.com|ziprecruiter\.com|gotocareer\.io|ev\.careers)$/i;

export const detectUrlAdapter = (url: string, resourceUrls: string[] = []): "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "custom" => {
  const value = [url, ...resourceUrls].join(" ").toLowerCase();
  if (value.includes("greenhouse.io")) return "greenhouse";
  if (value.includes("lever.co")) return "lever";
  if (value.includes("myworkdayjobs") || value.includes("myworkdaysite")) return "workday";
  if (value.includes("ashbyhq.com")) return "ashby";
  if (value.includes("icims.com")) return "icims";
  if (value.includes("phenompeople") || value.includes("/search-results")) return "phenom";
  return "custom";
};

export const isPublicAtsCatalogUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}`;
    if (!ATS_HOST.test(url.hostname) || USER_ONLY.test(path) || JOB_DETAIL.test(path)) return false;
    return url.protocol === "https:";
  } catch {
    return false;
  }
};

export const rankCareerLink = (link: BrowserLink, currentUrl: string): number => {
  let url: URL;
  try {
    url = new URL(link.href, currentUrl);
  } catch {
    return -100;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return -100;
  if (/linkedin\.com|indeed\.com|glassdoor\.com|facebook\.com|instagram\.com|twitter\.com|x\.com/i.test(url.hostname)) return -100;
  let score = 0;
  if (ATS_HOST.test(url.hostname)) score += 70;
  if (/\.jobs$/i.test(url.hostname)) score += 45;
  if (JOB_TEXT.test(link.text)) score += 35;
  if (JOB_PATH.test(`${url.pathname}${url.search}`)) score += 25;
  if (/^(?:jobs?|careers?)\./i.test(url.hostname)) score += 25;
  if (/\b(?:search|view|explore|see)\s+(?:all\s+)?(?:open\s+)?(?:jobs?|roles?|opportunities)\b/i.test(link.text)
    || /\/(?:search-jobs|job-search-results|viewalljobs|search)\/?(?:[?#]|$)/i.test(`${url.pathname}${url.search}`)) score += 30;
  if (/\b(?:sales|nursing|engineering|accounting|finance|college|internship)\s+(?:jobs?|careers?)\b/i.test(link.text)
    || /\/(?:sales|nursing|engineering|accounting|finance|college|internship)[-/](?:jobs?|careers?)(?:[/?#]|$)/i.test(url.pathname)) score -= 25;
  if (USER_ONLY.test(`${url.pathname}${url.search}`)) score -= 65;
  if (JOB_DETAIL.test(`${url.pathname}${url.search}`) && !/\/jobs?\/search(?:[/?#]|$)/i.test(url.pathname)) score -= 90;
  if (url.href === currentUrl) score -= 10;
  return score;
};

export const careerCandidates = (links: BrowserLink[], currentUrl: string): BrowserLink[] => {
  const unique = new Map<string, BrowserLink>();
  for (const link of links) {
    try {
      const url = new URL(link.href, currentUrl);
      url.hash = "";
      if (!unique.has(url.href)) unique.set(url.href, { href: url.href, text: link.text.trim() });
    } catch {
      // Ignore malformed browser links.
    }
  }
  return [...unique.values()]
    .map((link) => ({ link, score: rankCareerLink(link, currentUrl) }))
    .filter(({ score }) => score >= 35)
    .sort((a, b) => b.score - a.score)
    .map(({ link }) => link);
};

export const isSafeCareerRecommendation = (company: string, originalUrl: string, recommendedUrl: string): boolean => {
  let original: URL;
  let recommended: URL;
  try {
    original = new URL(originalUrl);
    recommended = new URL(recommendedUrl);
  } catch {
    return false;
  }
  if (THIRD_PARTY_AGGREGATOR.test(recommended.hostname)) return false;
  if (NON_LISTING_PATH.test(`${recommended.pathname}${recommended.search}`)) return false;
  if (JOB_DETAIL.test(`${recommended.pathname}${recommended.search}`) && !/\/jobs?\/search(?:[/?#]|$)/i.test(recommended.pathname)) return false;
  if (recommended.origin === original.origin) return JOB_PATH.test(`${recommended.pathname}${recommended.search}`) || /^(?:jobs?|careers?)\./i.test(recommended.hostname);

  const originalRoot = original.hostname.split(".").slice(-2).join(".");
  const recommendedRoot = recommended.hostname.split(".").slice(-2).join(".");
  if (originalRoot === recommendedRoot) {
    return JOB_PATH.test(`${recommended.pathname}${recommended.search}`) || /^(?:jobs?|careers?)\./i.test(recommended.hostname);
  }

  // UKG/UltiPro uses opaque tenant codes instead of company names in its
  // official public board URLs, so a company-token comparison cannot work.
  // Restrict this exception to the public JobBoard route on UKG's own host.
  if (/^recruiting\d*\.ultipro\.com$/i.test(recommended.hostname)
    && /\/JobBoard\//i.test(recommended.pathname)) return true;

  const tokens = company.split(/[^A-Za-z0-9]+/)
    .filter((token) => (token.length >= 4 || (token.length >= 3 && token === token.toUpperCase())) && !COMPANY_STOP_WORDS.has(token.toLowerCase()))
    .map((token) => token.toLowerCase());
  const destination = `${recommended.hostname}${recommended.pathname}`.toLowerCase();
  const companyMatch = tokens.some((token) => destination.includes(token));
  if (!companyMatch) return false;
  return ATS_HOST.test(recommended.hostname)
    || /\.jobs$/i.test(recommended.hostname)
    || /^(?:jobs?|careers?|talent)\./i.test(recommended.hostname)
    || /careers?/i.test(recommended.hostname)
    || JOB_PATH.test(`${recommended.pathname}${recommended.search}`);
};
