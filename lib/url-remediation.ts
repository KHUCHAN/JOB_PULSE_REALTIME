const ATS_HOST = /(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|ashbyhq\.com|icims\.com|jobvite\.com|phenompeople\.com)/i;
const JOB_TEXT = /\b(?:jobs?|careers?|opportunities|open (?:positions|roles)|join (?:our )?team|search roles?)\b/i;
const JOB_PATH = /\/(?:jobs?|careers?|opportunities|search-results|job-search|open-positions)(?:\/|$|[?#-])/i;
const USER_ONLY = /(?:job-?alerts?|talent-?community|introduceyourself|sign[_-]?in|\/login|\/apply(?:[/?#]|$))/i;
const JOB_DETAIL = /(?:\/(?:job|jobs)\/[^/?#]+(?:\/[^/?#]+)?(?:[?#]|$)|[?&](?:pid|jobid|jobseqno|gh_jid)=)/i;

export type BrowserLink = { href: string; text: string };

const COMPANY_STOP_WORDS = new Set(["company", "corporation", "corp", "group", "holdings", "holding", "international", "services", "service", "technologies", "technology", "financial", "health", "healthcare", "bank", "systems", "system", "united", "america", "american"]);
const NON_LISTING_PATH = /(?:career-areas?|early-careers?|students?|university|\/blog(?:\/|$)|jobcart|job-seeker-resources|career-progression|working-at|talent-community|jointalentcommunity|\/bca(?:\/|$)|loans?)/i;

export const detectUrlAdapter = (url: string, resourceUrls: string[] = []): "greenhouse" | "lever" | "workday" | "icims" | "phenom" | "custom" => {
  const value = [url, ...resourceUrls].join(" ").toLowerCase();
  if (value.includes("greenhouse.io")) return "greenhouse";
  if (value.includes("lever.co")) return "lever";
  if (value.includes("myworkdayjobs") || value.includes("myworkdaysite")) return "workday";
  if (value.includes("icims.com")) return "icims";
  if (value.includes("phenompeople") || value.includes("/search-results")) return "phenom";
  return "custom";
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
  if (JOB_TEXT.test(link.text)) score += 35;
  if (JOB_PATH.test(`${url.pathname}${url.search}`)) score += 25;
  if (/^(?:jobs?|careers?)\./i.test(url.hostname)) score += 25;
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
  if (NON_LISTING_PATH.test(`${recommended.pathname}${recommended.search}`)) return false;
  if (JOB_DETAIL.test(`${recommended.pathname}${recommended.search}`) && !/\/jobs?\/search(?:[/?#]|$)/i.test(recommended.pathname)) return false;
  if (recommended.origin === original.origin) return JOB_PATH.test(`${recommended.pathname}${recommended.search}`) || /^(?:jobs?|careers?)\./i.test(recommended.hostname);

  const tokens = company.split(/[^A-Za-z0-9]+/)
    .filter((token) => (token.length >= 4 || (token.length >= 3 && token === token.toUpperCase())) && !COMPANY_STOP_WORDS.has(token.toLowerCase()))
    .map((token) => token.toLowerCase());
  const destination = `${recommended.hostname}${recommended.pathname}`.toLowerCase();
  const companyMatch = tokens.some((token) => destination.includes(token));
  if (!companyMatch) return false;
  return ATS_HOST.test(recommended.hostname)
    || /^(?:jobs?|careers?|talent)\./i.test(recommended.hostname)
    || JOB_PATH.test(`${recommended.pathname}${recommended.search}`);
};
