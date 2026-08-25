export interface AuditSourceRecord {
  masterRow: number;
  Company: string;
  "Ledger ID": string | null;
  postingUrl: string | null;
  talentPoolUrl: string | null;
  channel: string;
  resumeUpload: string;
  jobAlerts: string;
  verification: string;
  confidence: string;
  recommendedAction: string;
  evidenceUrl: string;
  evidenceNote: string;
  checkedAt: string;
  adapter?: NormalizedSourceRecord["adapter"];
}

export interface NormalizedSourceRecord {
  id: string;
  masterRow: number;
  company: string;
  postingUrl: string | null;
  talentUrl: string | null;
  channel: string;
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "dayforce" | "smartrecruiters" | "custom";
  verification: string;
  confidence: string;
  resumeUpload: "available" | "job_only" | "unknown";
  jobAlerts: "available" | "unknown";
  checkedAt: string;
  enabled: boolean;
}

function normalizedUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  return url.href;
}

function detectAdapter(...urls: Array<string | null>): NormalizedSourceRecord["adapter"] {
  for (const rawUrl of urls) {
    if (!rawUrl) continue;
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLocaleLowerCase();
    const href = url.href.toLocaleLowerCase();
    if (hostname.endsWith("greenhouse.io") || url.searchParams.has("gh_jid")) return "greenhouse";
    if (hostname === "jobs.lever.co" || hostname.endsWith(".lever.co")) return "lever";
    if (hostname.includes("myworkdayjobs") || hostname.includes("myworkdaysite") || hostname.startsWith("workday")) return "workday";
    if (hostname.endsWith("ashbyhq.com")) return "ashby";
    if (hostname.includes("icims")) return "icims";
    if (hostname.includes("phenom") || href.includes("jointalentcommunity")) return "phenom";
    if (hostname === "dayforcehcm.com" || hostname.endsWith(".dayforcehcm.com")) return "dayforce";
    if (hostname === "smartrecruiters.com" || hostname.endsWith(".smartrecruiters.com")) return "smartrecruiters";
  }
  return "custom";
}

export function normalizeAuditRecord(record: AuditSourceRecord): NormalizedSourceRecord {
  const postingUrl = normalizedUrl(record.postingUrl);
  const talentUrl = normalizedUrl(record.talentPoolUrl);
  const detectedAdapter = detectAdapter(postingUrl);
  const resumeUpload = record.resumeUpload === "가능"
    ? "available"
    : record.resumeUpload === "지원 시 가능"
      ? "job_only"
      : "unknown";

  return {
    id: (record["Ledger ID"] ?? `audit-row-${record.masterRow}`).toLowerCase(),
    masterRow: record.masterRow,
    company: record.Company.trim(),
    postingUrl,
    talentUrl,
    channel: record.channel,
    adapter: detectedAdapter === "dayforce" || detectedAdapter === "smartrecruiters"
      ? detectedAdapter
      : record.adapter === "custom" && detectedAdapter !== "custom"
        ? detectedAdapter
        : record.adapter ?? detectedAdapter,
    verification: record.verification.toLowerCase(),
    confidence: record.confidence.toLowerCase(),
    resumeUpload,
    jobAlerts: record.jobAlerts === "가능" ? "available" : "unknown",
    checkedAt: record.checkedAt,
    // A source without a posting endpoint cannot be crawled even if it keeps
    // a separate Talent Community URL for reference. Mark it inactive so the
    // health view does not misclassify an acquired or retired board as healthy.
    enabled: Boolean(postingUrl) && !["NO_ACTIVE_CAREERS", "UNRESOLVED"].includes(record.verification),
  };
}
