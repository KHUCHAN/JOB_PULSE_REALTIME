import type { CrawledJob, CrawlSource } from "./crawler";

export type BrowserAnchor = { href: string; text: string };

const JOB_DETAIL = /(?:\/(?:jobs?|positions?|openings?|vacanc(?:y|ies))\/[^/?#]{3,}|\/job\.html\?[^#]*\bid=|\/job-detail\?[^#]*\bjob=|\/job-opening\.php\?[^#]*\breq=|\/career-application\/?\?[^#]*\bjobtitle=|\/careers\/(?:jobdetail|details)\/|\/careers\/[^?#]*(?:\d{4,}|[a-z]{1,4}-\d{3,})|\/corporate-careers\/jr-\d+\/[^/?#]+|\/search\/jobdetail\/[^/?#]+|\/careersmarketplace\/(?:pipeline|job)detail\/|\/company-job\/description\/reqid\/[^/?#]+|\/job\/detail\/[^/?#]+|\/[^/?#]+\/[^/?#]+\/[a-f0-9]{24,}\/job\/?(?:[?#]|$)|[?&](?:jobid|job_id|gh_jid|reqid|requisitionid|pid|opportunityid|joborderid|selectedposition)=)/i;
const LISTING_ONLY = /(?:search-jobs?|search-results|viewalljobs|job-opportunities|join(?:talent|[-_/]our[-_/]team)|talent-community|jobcart|jobs?\/(?:search|login)|positions?\/{1,2}filter)(?:[/?#]|$)/i;
const CAREER_CONTENT_ONLY = /\/careers?\/(?:open-positions|view-jobs(?:\.html)?|jobs|culture|benefits)\/?(?:[?#].*)?$/i;
const GENERIC_TEXT = /^(?:apply|apply now|form|here\.?|learn more(?: about this position)?\s*[>›»]?|read more|view .+|see .+|explore .+|join .+|details|search .+ jobs?|careers?|career website|jobs?|benefits|student programs|open (?:positions?|roles)|skip to (?:main )?(?:jobs search results|content)\.?|click here|(?:first|previous|next|last) page of results(?: first| last)?|page \d+ of \d+(?:\s*,\s*current page)?|your privacy choices|privacy notice|manage cookie preferences|notify me of new jobs|create (?:an? )?(?:job )?alert|share your information|get in touch!?|join (?:our )?talent (?:community|network)|candidate (?:pool|profile)|internal careers site|returning applicant login|i am an employee|sign in|log in|view profile|stay connected|terms of use|total rewards|events?(?: \d+)?|sitemap|job search tool|chinese \((?:simplified|traditional)\)|french|german|italian|japanese|portuguese|spanish|next|previous)$/i;
const EXTERNAL_BOARDS = /(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|ashbyhq\.com|icims\.com|jobvite\.com|hirebridge\.com|taleo\.net|selectminds\.com|apply\.workable\.com|bamboohr\.com|pinpointhq\.com|ats\.rippling\.com|dayforcehcm\.com|successfactors\.(?:com|eu)|oraclecloud\.com|eightfold\.ai|avature\.net|(?:myjobs|workforcenow)\.adp\.com|recruiting\.paylocity\.com|recruiting\d*\.ultipro\.com)/i;
const ROLE_TITLE = /\b(?:accountant|administrator|analyst|architect|associate|consultant|coordinator|counsel|developer|director|engineer|executive|intern|lead|manager|officer|principal|recruiter|representative|researcher|scientist|specialist|supervisor|technician)\b/i;

const isOracleCandidateJob = (url: URL): boolean => (
  /oraclecloud\.com$/i.test(url.hostname)
  && /\/hcmUI\/CandidateExperience\/(?:[^/]+\/)sites\/[^/]+\/job\/[^/?#]+\/?$/i.test(url.pathname)
);

const isUnsafeAtsNavigation = (url: URL): boolean => (
  /oraclecloud\.com$/i.test(url.hostname)
  && (
    /\/hcmUI\/CandidateExperience\/sitemaps(?:\/|$)/i.test(url.pathname)
    || /\/hcmUI\/CandidateExperience\/(?:[^/]+\/)sites\/[^/]+\/(?:events|join-talent-community)(?:\/|$)/i.test(url.pathname)
    || (/\/fscmUI\/faces\/deeplink$/i.test(url.pathname) && /ICE_JOB_SEARCH_RESP/i.test(url.search))
  )
);

const isExternalBoardDetail = (url: URL): boolean => {
  if (isUnsafeAtsNavigation(url)) return false;
  if (/^(?:www\.)?jobs\.jobvite\.com$/i.test(url.hostname)) {
    return /^\/[^/?#]+\/job\/[^/?#]+\/?$/i.test(url.pathname);
  }
  if (/lever\.co$/i.test(url.hostname) || /ashbyhq\.com$/i.test(url.hostname)) {
    return /^\/[^/?#]+\/[^/?#]+\/?$/i.test(url.pathname);
  }
  if (/smartrecruiters\.com$/i.test(url.hostname)) {
    return /^\/[^/?#]+\/\d+(?:[-/][^/?#]+)?\/?$/i.test(url.pathname);
  }
  if (isOracleCandidateJob(url)) return true;
  return EXTERNAL_BOARDS.test(url.hostname) && (JOB_DETAIL.test(`${url.pathname}${url.search}`) || externalIdFromJobUrl(url) !== null);
};

const titleFromJobUrl = (url: URL): string | null => {
  const queryTitle = url.searchParams.get("jobtitle")?.replace(/\s+/g, " ").trim() ?? null;
  if (queryTitle && queryTitle.length >= 4 && queryTitle.length <= 180 && !GENERIC_TEXT.test(queryTitle)) {
    return queryTitle;
  }
  const ignored = /^(?:job|jobs|career|careers|company|talent|opening|openings|position|positions|role|roles|search|login|userhome|all-jobs|open-roles|current-openings|explore|join|programs?|benefits|culture|teams?|early-career)$/i;
  const segment = url.pathname.split("/").filter(Boolean).reverse().find((value) => {
    const decoded = decodeURIComponent(value);
    return !ignored.test(decoded) && !/\.(?:html?|php|aspx)$/i.test(decoded) && !/^\d+$/.test(decoded) && /[a-z]/i.test(decoded);
  });
  if (!segment) return null;
  const title = decodeURIComponent(segment).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (title.length < 4 || GENERIC_TEXT.test(title)) return null;
  return title.replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const externalIdFromJobUrl = (url: URL): string | null => {
  const query = new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]));
  const queryId = query.get("jobid")
    ?? query.get("job_id")
    ?? query.get("gh_jid")
    ?? query.get("opportunityid")
    ?? query.get("reqid")
    ?? query.get("requisitionid")
    ?? query.get("pid")
    ?? query.get("joborderid")
    ?? query.get("selectedposition")
    ?? (/\/job-detail$/i.test(url.pathname) ? url.searchParams.get("job") : null)
    ?? (/\/job-opening\.php$/i.test(url.pathname) ? url.searchParams.get("req") : null)
    ?? (/\/job\.html$/i.test(url.pathname) ? url.searchParams.get("id") : null);
  if (queryId) return queryId;
  const nestedPathId = url.pathname.match(/\/(?:reqid|(?:pipeline|job)detail\/[^/]+)\/([^/?#]+)\/?$/i)?.[1];
  if (nestedPathId) return nestedPathId;
  const jobviteId = /^(?:www\.)?jobs\.jobvite\.com$/i.test(url.hostname)
    ? url.pathname.match(/^\/[^/?#]+\/job\/([^/?#]+)\/?$/i)?.[1]
    : null;
  if (jobviteId) return jobviteId;
  const workdayId = decodeURIComponent(url.pathname).match(/_((?:[A-Z]{1,8}-?)?\d{3,})\/?$/i)?.[1];
  if (workdayId && /myworkday(?:jobs|site)\.com$/i.test(url.hostname)) return workdayId;
  const oracleId = isOracleCandidateJob(url) ? url.pathname.match(/\/job\/([^/?#]+)\/?$/i)?.[1] : null;
  if (oracleId) return oracleId;
  const pathId = url.pathname.match(/\/(?:jobs?|positions?|openings?)\/([^/?#]+)\/?$/i)?.[1];
  return pathId && /^(?:\d{3,}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(pathId)
    ? pathId
    : null;
};

export const jobsFromBrowserAnchors = (anchors: BrowserAnchor[], source: CrawlSource): CrawledJob[] => {
  const unique = new Map<string, CrawledJob>();
  const sourceUrl = new URL(source.postingUrl);
  for (const anchor of anchors) {
    if (/%(?:22|27|7b|7d)|[\\{}]/i.test(anchor.href)) continue;
    const rawAnchorTitle = anchor.text.replaceAll("&nbsp;", " ").replace(/\s+/g, " ").trim();
    const infosysTitle = /\/company-job\/description\/reqid\//i.test(anchor.href)
      ? rawAnchorTitle.match(/^(.+)\s+[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\s+-\s+USA\s+\d+BR\b/i)?.[1]
      : null;
    const anchorTitle = infosysTitle?.trim() || rawAnchorTitle;
    if (anchorTitle.length < 4 || anchorTitle.length > 180) continue;
    let url: URL;
    try {
      url = new URL(anchor.href, source.postingUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (isUnsafeAtsNavigation(url)) continue;
    if (/\.(?:pdf|docx?|xlsx?|pptx?|zip)(?:$|[?#])/i.test(`${url.pathname}${url.search}`)) continue;
    if (/\/careers-blog(?:\/|$)/i.test(url.pathname)) continue;
    const path = `${url.pathname}${url.search}`;
    const sourceHost = sourceUrl.hostname.replace(/^www\./, "");
    const targetHost = url.hostname.replace(/^www\./, "");
    const externalBoard = EXTERNAL_BOARDS.test(targetHost);
    const externalDetail = isExternalBoardDetail(url);
    if (LISTING_ONLY.test(path) || CAREER_CONTENT_ONLY.test(path)) continue;
    const derivedTitle = GENERIC_TEXT.test(anchorTitle) ? titleFromJobUrl(url) : null;
    const structuredCardTitle = /^\d{1,3}\s+/.test(anchorTitle) ? titleFromJobUrl(url) : null;
    const title = derivedTitle ?? structuredCardTitle ?? anchorTitle;
    const samePath = url.origin === sourceUrl.origin
      && url.pathname.replace(/\/$/, "") === sourceUrl.pathname.replace(/\/$/, "");
    const samePage = samePath && url.search === sourceUrl.search;
    const externalId = externalIdFromJobUrl(url);
    const hashDetail = samePage && Boolean(url.hash) && ROLE_TITLE.test(title);
    const sourcePath = sourceUrl.pathname.replace(/\/$/, "");
    const childCareerPath = url.pathname.startsWith(`${sourcePath}/`)
      && url.pathname.slice(sourcePath.length + 1).replace(/\/$/, "").split("/").length === 1;
    const roleTitledDetail = url.origin === sourceUrl.origin && ROLE_TITLE.test(title) && (
      childCareerPath
      || /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?company\/careers\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/?$/i.test(url.pathname)
    );
    if (samePath && url.search !== sourceUrl.search && !externalId) continue;
    if (samePage && !hashDetail && !externalId) continue;
    if (GENERIC_TEXT.test(anchorTitle) && samePage) continue;
    const derivedDetail = Boolean(derivedTitle)
      && ROLE_TITLE.test(derivedTitle!)
      && (JOB_DETAIL.test(path) || /\/careers?\//i.test(url.pathname));
    if (GENERIC_TEXT.test(anchorTitle) && !derivedDetail) continue;
    if (GENERIC_TEXT.test(title) || (!JOB_DETAIL.test(path) && !externalDetail && !derivedDetail && !roleTitledDetail && !hashDetail)) continue;
    if (!targetHost.endsWith(sourceHost) && !sourceHost.endsWith(targetHost) && !externalBoard) continue;
    if (!hashDetail) url.hash = "";
    unique.set(url.href, {
      externalId: externalId ?? (hashDetail ? url.hash.slice(1) || null : null),
      title,
      company: source.company,
      location: null,
      arrangement: /\bremote\b/i.test(title) ? "remote" : "unknown",
      employmentType: null,
      summary: null,
      officialUrl: url.href,
      publishedAt: null,
    });
  }
  return [...unique.values()];
};
