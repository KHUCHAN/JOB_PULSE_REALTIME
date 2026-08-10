export type JobRegion = "us" | "non_us" | "mixed" | "unknown";

export type JobRegionInput = {
  location?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  secondaryLocations?: string[] | null;
};

type RegionEvidence = "us" | "non_us" | null;

const usCountryAliases = new Set([
  "us",
  "u s",
  "usa",
  "u s a",
  "united states",
  "united states of america",
]);

const unknownCountryValues = new Set(["", "remote", "global", "worldwide", "multiple", "various"]);

const usStateCodes = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);

const usStateNames = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma",
  "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee",
  "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
  "district of columbia",
];

const nonUsCountryNames = [
  "canada", "mexico", "united kingdom", "england", "scotland", "wales", "ireland", "france",
  "germany", "spain", "italy", "netherlands", "switzerland", "sweden", "norway", "denmark",
  "finland", "poland", "romania", "hungary", "czech republic", "czechia", "austria", "belgium",
  "portugal", "greece", "india", "china", "hong kong", "singapore", "japan", "south korea",
  "korea", "taiwan", "australia", "new zealand", "brazil", "argentina", "chile", "colombia",
  "peru", "israel", "united arab emirates", "saudi arabia", "south africa", "philippines",
  "malaysia", "indonesia", "thailand", "vietnam",
];

const normalize = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
  : "";

const containsPhrase = (value: string, phrase: string): boolean =>
  ` ${value} `.includes(` ${phrase} `);

const structuredCountry = (value: unknown): RegionEvidence => {
  const country = normalize(value);
  if (unknownCountryValues.has(country)) return null;
  if (usCountryAliases.has(country)) return "us";
  return "non_us";
};

const rawLocation = (value: unknown): RegionEvidence => {
  const original = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  const location = normalize(original);
  if (!location) return null;
  if (["remote", "location not specified", "multiple locations", "flexible any site"].includes(location)) return null;
  if (/^\d+ locations?$/.test(location)) return null;
  if ([...usCountryAliases].some((country) => containsPhrase(location, country))) return "us";
  if (nonUsCountryNames.some((country) => containsPhrase(location, country))) return "non_us";
  if (usStateNames.some((state) => containsPhrase(location, state))) return "us";
  const contextualCode = original.match(/,\s*([A-Z]{2})(?:\s*[,\-]|\s+\d{5}|$)/);
  if (contextualCode && usStateCodes.has(contextualCode[1])) return "us";
  return null;
};

export function classifyJobRegion(input: JobRegionInput): JobRegion {
  let hasUs = false;
  let hasNonUs = false;
  const add = (evidence: RegionEvidence) => {
    if (evidence === "us") hasUs = true;
    if (evidence === "non_us") hasNonUs = true;
  };

  add(structuredCountry(input.locationCountry));
  if (!input.locationCountry && input.locationCity && input.locationState) {
    const state = input.locationState.trim().toLocaleUpperCase();
    if (usStateCodes.has(state)) add("us");
  }
  add(rawLocation(input.location));
  for (const location of input.secondaryLocations ?? []) add(rawLocation(location));

  if (hasUs && hasNonUs) return "mixed";
  if (hasUs) return "us";
  if (hasNonUs) return "non_us";
  return "unknown";
}
