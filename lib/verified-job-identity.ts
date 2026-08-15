export interface BarclaysJobIdentityRepair {
  jobId: string;
  officialUrl: string;
  requisitionId: string;
  applyUrl: string;
}

const safeUrl = (value: unknown): URL | null => {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
};

/**
 * Accepts only the exact first-party Barclays TalentBrew -> Barclays Workday
 * identity pair. This is intentionally narrow: it is a Codex-reviewed repair
 * path for optional detail fields, never a general URL mutation endpoint.
 */
export const normalizeBarclaysJobIdentityRepair = (
  value: Record<string, unknown>,
): BarclaysJobIdentityRepair | null => {
  const jobId = typeof value.jobId === "string" ? value.jobId.trim() : "";
  const requisitionId = typeof value.requisitionId === "string" ? value.requisitionId.trim().toLocaleUpperCase() : "";
  const officialUrl = safeUrl(value.officialUrl);
  const applyUrl = safeUrl(value.applyUrl);
  if (!jobId || jobId.length > 200 || !/^JR-\d{6,12}$/.test(requisitionId)
    || !officialUrl || !applyUrl) return null;
  if (officialUrl.hostname.toLocaleLowerCase() !== "search.jobs.barclays"
    || officialUrl.search || officialUrl.hash
    || !/^\/job\/(?:[^/?#]+\/)+13015\/\d+\/?$/i.test(officialUrl.pathname)) return null;
  if (applyUrl.hostname.toLocaleLowerCase() !== "barclays.wd3.myworkdayjobs.com"
    || applyUrl.search || applyUrl.hash
    || !/^\/External_Career_Site_Barclays\/job\/(?:[^/?#]+\/)+[^/?#]+\/apply\/?$/i.test(applyUrl.pathname)
    || !applyUrl.pathname.includes(`_${requisitionId}/apply`)) return null;
  return {
    jobId,
    officialUrl: officialUrl.href,
    requisitionId,
    applyUrl: applyUrl.href,
  };
};
