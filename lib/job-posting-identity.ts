export interface JobPostingIdentityInput {
  sourceId: string;
  requisitionId?: string | null;
  externalId?: string | null;
  officialUrl: string;
}

const normalizedIdentifier = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toLocaleLowerCase() ?? "";
  return normalized || null;
};

/**
 * Keep only URL differences that can identify a different posting. In
 * particular, a locale-prefixed Barclays URL and its trailing `/apply` route
 * are the same job, while query parameters are retained because some ATSes
 * carry the actual requisition identifier there.
 */
export const canonicalPostingUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase();
    if (url.hostname === "search.jobs.barclays") {
      url.pathname = url.pathname.replace(/^\/en(?=\/job\/)/i, "");
    }
    url.pathname = url.pathname.replace(/\/apply\/*$/i, "");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href.toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

export const jobPostingIdentityKeys = (input: JobPostingIdentityInput) => {
  const source = normalizedIdentifier(input.sourceId) ?? input.sourceId;
  const requisition = normalizedIdentifier(input.requisitionId);
  const external = normalizedIdentifier(input.externalId);
  return {
    requisitionIdentityKey: requisition ? `req:${source}:${requisition}` : null,
    externalIdentityKey: external ? `ext:${source}:${external}` : null,
    urlIdentityKey: `url:${canonicalPostingUrl(input.officialUrl)}`,
  };
};

export const postingIdentityOverlapSql = (leftAlias: string, rightAlias: string): string => `(
  (${leftAlias}.requisition_identity_key IS NOT NULL
    AND ${leftAlias}.requisition_identity_key = ${rightAlias}.requisition_identity_key)
  OR (${leftAlias}.external_identity_key IS NOT NULL
    AND ${leftAlias}.external_identity_key = ${rightAlias}.external_identity_key)
  OR (${leftAlias}.url_identity_key IS NOT NULL
    AND ${leftAlias}.url_identity_key = ${rightAlias}.url_identity_key)
)`;

export const postingIdentityHistoryMatchSql = (
  jobAlias: string,
  historyAlias: string,
): string => `${historyAlias}.identity_key IN (
  ${jobAlias}.requisition_identity_key,
  ${jobAlias}.external_identity_key,
  ${jobAlias}.url_identity_key
)`;
