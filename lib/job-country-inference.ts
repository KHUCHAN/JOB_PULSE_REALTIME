import { classifyJobRegion } from "./job-region-classifier";

export type JobCountryInferenceInput = {
  location?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  secondaryLocations?: string[] | null;
  officialUrl?: string | null;
};

const normalize = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
  : "";

const containsPhrase = (value: string, phrase: string): boolean =>
  ` ${value} `.includes(` ${phrase} `);

const canonicalStructuredCountry = (value: unknown): string | null => {
  const raw = typeof value === "string" ? value.trim() : "";
  const country = normalize(raw);
  if (!country || ["remote", "global", "worldwide", "multiple", "various"].includes(country)) return null;
  if (["us", "u s", "usa", "u s a", "united states", "united states of america"].includes(country)) {
    return "United States";
  }
  if (["uk", "u k", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"].includes(country)) {
    return "United Kingdom";
  }
  if (country === "sg" || country === "singapore") return "Singapore";
  return raw;
};

const officialWorkdayLocation = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (!/\.myworkdayjobs\.com$/i.test(url.hostname)) return "";
    const segments = url.pathname.split("/").filter(Boolean);
    const jobIndex = segments.findIndex((segment) => segment.toLocaleLowerCase() === "job");
    return jobIndex >= 0 ? normalize(decodeURIComponent(segments[jobIndex + 1] ?? "")) : "";
  } catch {
    return "";
  }
};

/**
 * Conservatively recover the three countries used by the direct review scan
 * when an ATS omits its structured country field. Workday commonly emits a
 * generic "4 Locations" label while keeping the actual primary location in
 * the direct job path; preserving that evidence prevents Singapore/London
 * internships from disappearing from an exact country query.
 */
export function inferJobLocationCountry(input: JobCountryInferenceInput): string | null {
  const structured = canonicalStructuredCountry(input.locationCountry);
  if (structured) return structured;

  const locations = [input.location, ...(input.secondaryLocations ?? [])]
    .map(normalize)
    .filter(Boolean);
  if (locations.some((location) => containsPhrase(location, "singapore"))) return "Singapore";
  if (locations.some((location) => [
    "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland",
  ].some((country) => containsPhrase(location, country)))) return "United Kingdom";
  if (locations.some((location) => [
    "united states", "united states of america", "usa",
  ].some((country) => containsPhrase(location, country)))) return "United States";

  // Preserve a canonical country alongside the region classification when an
  // ATS supplies only a U.S. state. This keeps both `region=us` and exact
  // country filters consistent for feeds such as Phenom and Workday.
  if (classifyJobRegion({
    location: input.location,
    locationCity: input.locationCity,
    locationState: input.locationState,
    secondaryLocations: input.secondaryLocations,
  }) === "us") return "United States";

  const pathLocation = officialWorkdayLocation(input.officialUrl);
  if (pathLocation === "singapore") return "Singapore";
  // A bare London label plus the same first-party Workday location segment is
  // stronger than either signal alone and excludes London, ON style records.
  if (pathLocation === "london" && locations.some((location) => location === "london")) {
    return "United Kingdom";
  }
  return null;
}
