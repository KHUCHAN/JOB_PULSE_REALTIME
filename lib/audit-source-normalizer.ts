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
  adapter: "greenhouse" | "lever" | "workday" | "ashby" | "icims" | "phenom" | "custom";
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
  const value = urls.filter(Boolean).join(" ").toLowerCase();
  if (value.includes("greenhouse") || value.includes("gh_jid")) return "greenhouse";
  if (value.includes("lever.co")) return "lever";
  if (value.includes("myworkdayjobs") || value.includes("workday")) return "workday";
  if (value.includes("ashbyhq.com")) return "ashby";
  if (value.includes("icims")) return "icims";
  if (value.includes("phenom") || value.includes("jointalentcommunity")) return "phenom";
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
    adapter: record.adapter === "custom" && detectedAdapter !== "custom"
      ? detectedAdapter
      : record.adapter ?? detectedAdapter,
    verification: record.verification.toLowerCase(),
    confidence: record.confidence.toLowerCase(),
    resumeUpload,
    jobAlerts: record.jobAlerts === "가능" ? "available" : "unknown",
    checkedAt: record.checkedAt,
    enabled: !["NO_ACTIVE_CAREERS", "UNRESOLVED"].includes(record.verification),
  };
}
