export type JobRegion = "us" | "non_us" | "mixed" | "unknown";

export type JobRegionInput = {
  location?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  secondaryLocations?: string[] | null;
  /**
   * Optional source metadata used only as a last-resort hint when the feed
   * omits location data (for example, a US-only career portal rendered as a
   * generic "Location not specified" card). Explicit job-level country/state
   * evidence always wins over this hint.
   */
  sourceCompany?: string | null;
  sourcePostingUrl?: string | null;
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

// `DE` is both Delaware's postal code and Germany's ISO country code. Several
// global feeds emit German cities as `Marktoberdorf, DE`, which previously
// entered the U.S. scan as Delaware. A bare `, DE` is U.S. evidence only for
// a known Delaware locality (or when a U.S. ZIP/country supplies independent
// evidence); otherwise treat it as the country code.
const delawareLocalities = new Set([
  "bear", "bethany beach", "camden", "cheswold", "claymont", "dover",
  "georgetown", "harrington", "hockessin", "laurel", "lewes", "middletown",
  "milford", "millsboro", "milton", "new castle", "newark", "ocean view",
  "rehoboth beach", "seaford", "selbyville", "smyrna", "wilmington",
]);

const canadianProvinceCodes = new Set(
  "AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" "),
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
  "malaysia", "indonesia", "thailand", "vietnam", "india", "karnataka", "bengaluru", "bangalore",
  "ontario", "quebec", "alberta", "british columbia", "manitoba", "new brunswick",
  "newfoundland and labrador", "nova scotia", "prince edward island", "saskatchewan",
  "northwest territories", "nunavut", "yukon",
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
  const contextualCode = original.match(/,\s*([A-Z]{2})(?:\s*[,-]|\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d|\s+\d{5}|$)/);
  if (contextualCode?.[1] === "DE" && !/,\s*DE\s+\d{5}\b/.test(original)) {
    const locality = normalize(original.slice(0, contextualCode.index));
    return delawareLocalities.has(locality) ? "us" : "non_us";
  }
  if (contextualCode && usStateCodes.has(contextualCode[1])) return "us";
  if (contextualCode && canadianProvinceCodes.has(contextualCode[1])) return "non_us";
  return null;
};

const isGenericLocation = (value: unknown): boolean => {
  const location = normalize(value);
  return !location
    || ["remote", "location not specified", "multiple locations", "flexible any site"].includes(location)
    || /^\d+ locations?$/.test(location);
};

const sourceRegionHint = (company: unknown, postingUrl: unknown): RegionEvidence => {
  const host = typeof postingUrl === "string" ? (() => {
    try { return new URL(postingUrl).hostname.replace(/^www\./i, "").toLocaleLowerCase(); } catch { return ""; }
  })() : "";
  const path = typeof postingUrl === "string" ? (() => {
    try { return new URL(postingUrl).pathname.toLocaleLowerCase(); } catch { return ""; }
  })() : "";
  // These are explicitly US career portals. Keep this list narrow: a source
  // hint must never override a structured non-US location and must not turn a
  // multinational company's generic landing page into a US-only feed.
  if (host === "wellsfargojobs.com") return "us";
  if (host === "delta.avature.net" && /\/en_us\//i.test(path)) return "us";
  // Company is intentionally only used to make the intent auditable in
  // diagnostics; URL matching above is the authoritative guard.
  void company;
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
  if (!input.locationCountry && input.locationState) {
    const stateCode = input.locationState.trim().toLocaleUpperCase();
    const stateName = normalize(input.locationState);
    // Structured ATS subdivision fields are stronger evidence than a bare
    // raw-location token. Accept both postal codes and full state names even
    // when the feed omits city/country, so St. Louis, MO and O Fallon,
    // Missouri cannot fall out of the U.S. review scan.
    if (usStateCodes.has(stateCode) || usStateNames.includes(stateName)) add("us");
  }
  add(rawLocation(input.location));
  for (const location of input.secondaryLocations ?? []) add(rawLocation(location));

  if (hasUs && hasNonUs) return "mixed";
  if (hasUs) return "us";
  if (hasNonUs) return "non_us";
  // A source-level US hint is safe only when the feed omitted location data.
  // Do not turn an unrecognized but explicit location (for example Bengaluru,
  // India) into a US posting merely because the employer has a US portal.
  const explicitRawLocation = [input.location, ...(input.secondaryLocations ?? [])]
    .some((value) => !isGenericLocation(value));
  const explicitStructuredLocation = Boolean(
    (input.locationCity && input.locationCity.trim())
      || (input.locationState && input.locationState.trim())
      || (input.locationCountry && !unknownCountryValues.has(normalize(input.locationCountry))),
  );
  if (!explicitRawLocation && !explicitStructuredLocation) {
    add(sourceRegionHint(input.sourceCompany, input.sourcePostingUrl));
  }
  if (hasUs) return "us";
  return "unknown";
}
