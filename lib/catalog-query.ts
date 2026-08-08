export interface CatalogQuery {
  limit: number;
  offset: number;
  query: string;
  talentOnly: boolean;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseCatalogQuery(url: URL): CatalogQuery {
  return {
    limit: boundedInteger(url.searchParams.get("limit"), 50, 1, 100),
    offset: boundedInteger(url.searchParams.get("offset"), 0, 0, 100_000),
    query: url.searchParams.get("q")?.trim() ?? "",
    talentOnly: url.searchParams.get("talent") === "true",
  };
}
