import type { CrawledJob, CrawlSource } from "./crawler";

export type BrowserAnchor = { href: string; text: string };

const JOB_DETAIL = /(?:\/(?:jobs?|positions?|careers)\/[^/?#]{3,}|[?&](?:jobid|job_id|gh_jid|reqid|pid)=)/i;
const LISTING_ONLY = /(?:search-jobs?|search-results|viewalljobs|job-opportunities|join(?:talent|[-_/]our[-_/]team)|talent-community|jobcart)(?:[/?#]|$)/i;
const GENERIC_TEXT = /^(?:apply|apply now|learn more|read more|view job|view details|details|search jobs?|careers?|open positions?|next|previous)$/i;
const EXTERNAL_BOARDS = /(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|icims\.com|jobvite\.com|phenompeople\.com|selectminds\.com)/i;

export const jobsFromBrowserAnchors = (anchors: BrowserAnchor[], source: CrawlSource): CrawledJob[] => {
  const unique = new Map<string, CrawledJob>();
  for (const anchor of anchors) {
    const title = anchor.text.replace(/\s+/g, " ").trim();
    if (title.length < 4 || title.length > 180 || GENERIC_TEXT.test(title)) continue;
    let url: URL;
    try {
      url = new URL(anchor.href, source.postingUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const path = `${url.pathname}${url.search}`;
    const sourceHost = new URL(source.postingUrl).hostname.replace(/^www\./, "");
    const targetHost = url.hostname.replace(/^www\./, "");
    const externalBoard = EXTERNAL_BOARDS.test(targetHost);
    const externalDetail = externalBoard && url.pathname.split("/").filter(Boolean).length >= 2;
    if (LISTING_ONLY.test(path) || (!JOB_DETAIL.test(path) && !externalDetail)) continue;
    if (!targetHost.endsWith(sourceHost) && !sourceHost.endsWith(targetHost) && !externalBoard) continue;
    url.hash = "";
    unique.set(url.href, {
      externalId: url.searchParams.get("jobid") ?? url.searchParams.get("job_id") ?? url.searchParams.get("gh_jid"),
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
