export interface VerifiedJobMetadataRepair {
  jobId: string;
  officialUrl: string;
  currentTitle: string;
  verifiedTitle: string;
  requisitionId: string | null;
  sourceUpdatedAt: string | null;
  publishedAt: string | null;
  season: "spring" | "summer" | "fall" | "winter" | null;
}

const text = (value: unknown, maximum: number): string => (
  typeof value === "string" ? value.trim().slice(0, maximum) : ""
);

const timestamp = (value: unknown): string | null => {
  const raw = text(value, 100);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
};

const officialUrl = (value: unknown): string | null => {
  try {
    const url = new URL(text(value, 2_000));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
};

export const normalizeVerifiedJobMetadataRepair = (value: unknown): VerifiedJobMetadataRepair | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const jobId = text(record.jobId, 200);
  const url = officialUrl(record.officialUrl);
  const currentTitle = text(record.currentTitle, 500);
  const verifiedTitle = text(record.verifiedTitle, 500);
  const requisitionId = text(record.requisitionId, 200) || null;
  const rawSeason = text(record.season, 20).toLocaleLowerCase();
  const season = ["spring", "summer", "fall", "winter"].includes(rawSeason)
    ? rawSeason as VerifiedJobMetadataRepair["season"]
    : null;
  if (!jobId || !url || !currentTitle || !verifiedTitle || currentTitle === verifiedTitle) return null;
  return {
    jobId,
    officialUrl: url,
    currentTitle,
    verifiedTitle,
    requisitionId,
    sourceUpdatedAt: timestamp(record.sourceUpdatedAt),
    publishedAt: timestamp(record.publishedAt),
    season,
  };
};
