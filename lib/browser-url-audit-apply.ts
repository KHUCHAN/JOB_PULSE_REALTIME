import type { AuditSourceRecord, NormalizedSourceRecord } from "./audit-source-normalizer.ts";
import { isSafeCareerRecommendation } from "./url-remediation.ts";

export type BrowserUrlAuditResult = {
  id: string;
  originalUrl: string;
  recommendedUrl: string | null;
  adapter: NormalizedSourceRecord["adapter"];
};

export type OfficialUrlOverrides = {
  overrides: Record<string, { url: string | null; adapter: NormalizedSourceRecord["adapter"]; verification?: string }>;
  rejectedRecommendations: string[];
};

export function buildRemediatedCatalog(
  sources: NormalizedSourceRecord[],
  auditResults: BrowserUrlAuditResult[],
  official: OfficialUrlOverrides,
): { records: AuditSourceRecord[]; applied: number } {
  const byId = new Map(auditResults.map((result) => [result.id, result]));
  const rejectedRecommendations = new Set(official.rejectedRecommendations);
  let applied = 0;
  const records = sources.map((source): AuditSourceRecord => {
    const result = byId.get(source.id);
    const override = official.overrides[source.id];
    const safeBrowserUrl = result?.recommendedUrl && source.postingUrl
      && result.recommendedUrl !== source.postingUrl
      && !rejectedRecommendations.has(result.recommendedUrl)
      && isSafeCareerRecommendation(source.company, source.postingUrl, result.recommendedUrl)
      ? result.recommendedUrl
      : null;
    const hasOverride = Boolean(override);
    const safeUrl = hasOverride ? override.url : safeBrowserUrl;
    if (hasOverride || safeUrl) applied += 1;
    const postingUrl = hasOverride ? override.url : (safeUrl ?? source.postingUrl);
    return {
      masterRow: source.masterRow,
      Company: source.company,
      "Ledger ID": source.id,
      postingUrl,
      talentPoolUrl: source.talentUrl,
      channel: source.channel,
      resumeUpload: source.resumeUpload === "available" ? "가능" : source.resumeUpload === "job_only" ? "지원 시 가능" : "unknown",
      jobAlerts: source.jobAlerts === "available" ? "가능" : "unknown",
      verification: override?.verification ?? source.verification.toUpperCase(),
      confidence: source.confidence.toUpperCase(),
      recommendedAction: "",
      evidenceUrl: postingUrl ?? "",
      evidenceNote: hasOverride
        ? `${postingUrl ? "Official-search-verified careers URL" : "No active company or public careers endpoint found"}; previous URL: ${source.postingUrl}`
        : safeUrl ? `Browser-verified careers URL; previous URL: ${source.postingUrl}` : "Preserved catalog source.",
      checkedAt: source.checkedAt,
      adapter: hasOverride ? override.adapter : safeUrl ? result!.adapter : source.adapter,
    };
  });
  return { records, applied };
}
