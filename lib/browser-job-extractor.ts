import type { CrawledJob, CrawlSource } from "./crawler";

export type BrowserAnchor = { href: string; text: string };

const JOB_DETAIL = /(?:\/(?:jobs?|positions?|openings?|vacanc(?:y|ies))\/[^/?#]{3,}|\/careers\/(?:jobdetail|details)\/|\/careers\/[^?#]*(?:\d{4,}|[a-z]{1,4}-\d{3,})|[?&](?:jobid|job_id|gh_jid|reqid|pid|opportunityid)=)/i;
const LISTING_ONLY = /(?:search-jobs?|search-results|viewalljobs|job-opportunities|join(?:talent|[-_/]our[-_/]team)|talent-community|jobcart|jobs?\/(?:search|login)|positions?\/{1,2}filter)(?:[/?#]|$)/i;
const CAREER_CONTENT_ONLY = /\/careers?\/(?:open-positions|view-jobs(?:\.html)?|jobs|culture|benefits)\/?(?:[?#].*)?$/i;
const GENERIC_TEXT = /^(?:apply|apply now|form|here\.?|learn more(?: about this position)?|read more|view .+|see .+|explore .+|join .+|details|search .+ jobs?|careers?|career website|jobs?|benefits|student programs|open (?:positions?|roles)|skip to (?:main )?(?:jobs search results|content)|click here|(?:first|previous|next|last) page of results(?: first| last)?|page \d+ of \d+(?:\s*,\s*current page)?|your privacy choices|manage cookie preferences|notify me of new jobs|internal careers site|returning applicant login|stay connected|terms of use|total rewards|events|job search tool|chinese \((?:simplified|traditional)\)|french|german|italian|japanese|portuguese|spanish|next|previous)$/i;
const EXTERNAL_BOARDS = /(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|jobvite\.com|selectminds\.com)/i;
const ROLE_TITLE = /\b(?:accountant|administrator|analyst|architect|associate|consultant|coordinator|counsel|developer|director|engineer|executive|intern|lead|manager|officer|principal|recruiter|representative|researcher|scientist|specialist|supervisor|technician)\b/i;

const titleFromJobUrl = (url: URL): string | null => {
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

export const jobsFromBrowserAnchors = (anchors: BrowserAnchor[], source: CrawlSource): CrawledJob[] => {
  const unique = new Map<string, CrawledJob>();
  const sourceUrl = new URL(source.postingUrl);
  for (const anchor of anchors) {
    if (/%(?:22|27|7b|7d)|[\\{}]/i.test(anchor.href)) continue;
    const anchorTitle = anchor.text.replace(/\s+/g, " ").trim();
    if (anchorTitle.length < 4 || anchorTitle.length > 180) continue;
    let url: URL;
    try {
      url = new URL(anchor.href, source.postingUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const path = `${url.pathname}${url.search}`;
    const sourceHost = sourceUrl.hostname.replace(/^www\./, "");
    const targetHost = url.hostname.replace(/^www\./, "");
    const externalBoard = EXTERNAL_BOARDS.test(targetHost);
    const externalDetail = externalBoard && url.pathname.split("/").filter(Boolean).length >= 2;
    if (LISTING_ONLY.test(path) || CAREER_CONTENT_ONLY.test(path)) continue;
    const derivedTitle = GENERIC_TEXT.test(anchorTitle) ? titleFromJobUrl(url) : null;
    const title = derivedTitle ?? anchorTitle;
    const samePage = url.origin === sourceUrl.origin
      && url.pathname.replace(/\/$/, "") === sourceUrl.pathname.replace(/\/$/, "")
      && url.search === sourceUrl.search;
    if (GENERIC_TEXT.test(anchorTitle) && samePage) continue;
    const derivedDetail = Boolean(derivedTitle)
      && ROLE_TITLE.test(derivedTitle!)
      && (JOB_DETAIL.test(path) || /\/careers?\//i.test(url.pathname));
    if (GENERIC_TEXT.test(anchorTitle) && !derivedDetail) continue;
    if (GENERIC_TEXT.test(title) || (!JOB_DETAIL.test(path) && !externalDetail && !derivedDetail)) continue;
    if (!targetHost.endsWith(sourceHost) && !sourceHost.endsWith(targetHost) && !externalBoard) continue;
    url.hash = "";
    unique.set(url.href, {
      externalId: url.searchParams.get("jobid") ?? url.searchParams.get("job_id") ?? url.searchParams.get("gh_jid") ?? url.searchParams.get("opportunityId"),
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
