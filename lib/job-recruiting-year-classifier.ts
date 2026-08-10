import type { JobProgramKey } from "./job-program-classifier";

export type RecruitingYearInput = {
  title: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  locationCountry?: string | null;
  publishedAt?: string | null;
  programKeys: JobProgramKey[];
};

export type RecruitingYearClassification = {
  years: number[];
  evidence: Record<string, string>;
};

const validYear = (value: string): number | null => {
  const year = Number(value);
  return Number.isSafeInteger(year) && year >= 2000 && year <= 2100 ? year : null;
};

const titleYears = (title: string): number[] => [...title.matchAll(/(?:^|[^0-9])(20\d{2})(?=$|[^0-9])/g)]
  .flatMap((match) => validYear(match[1]) ?? []);

const cycleYearPatterns = [
  /\b(?:spring|summer|fall|autumn|winter)\s+(20\d{2})\b/gi,
  /\b(20\d{2})\s+(?:intern(?:s|ships?)?|co(?:\s*-\s*|\s*)op|coop)\b/gi,
  /\b(?:intern(?:s|ships?)?|co(?:\s*-\s*|\s*)op|coop)(?:\s+(?:program|position|role|start(?:ing)?))?\s+(?:in\s+)?(20\d{2})\b/gi,
];

const bodyCycleYears = (body: string): number[] => cycleYearPatterns.flatMap((pattern) =>
  [...body.matchAll(pattern)].flatMap((match) => {
    const context = body.slice(Math.max(0, (match.index ?? 0) - 100), match.index ?? 0);
    if (/graduat(?:e|ion)[^.!?]{0,100}$/i.test(context)) return [];
    return validYear(match[1]) ?? [];
  }),
);

const usStateCodes = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);

const isUnitedStates = (input: RecruitingYearInput): boolean => {
  const country = input.locationCountry?.trim().toLocaleLowerCase();
  if (country && ["us", "usa", "united states", "united states of america"].includes(country)) return true;
  const location = input.location?.normalize("NFKC").trim() ?? "";
  if (/\b(?:united states(?: of america)?|u\.s\.a?\.)\b/i.test(location)) return true;
  const state = location.match(/(?:^|,\s*|\s)([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?(?:$|,)/)?.[1];
  return Boolean(state && usStateCodes.has(state));
};

export function classifyRecruitingYears(input: RecruitingYearInput): RecruitingYearClassification {
  const evidence: Record<string, string> = {};
  for (const year of titleYears(input.title)) evidence[year] = "title:explicit-year";

  const body = [input.summary, input.description].filter((value): value is string => typeof value === "string").join(" ");
  for (const year of bodyCycleYears(body)) evidence[year] ??= "body:explicit-program-cycle";

  if (Object.keys(evidence).length === 0 && input.programKeys.length > 0 && isUnitedStates(input) && input.publishedAt) {
    const published = new Date(input.publishedAt);
    if (!Number.isNaN(published.getTime())) {
      const publishedYear = published.getUTCFullYear();
      const publishedMonth = published.getUTCMonth() + 1;
      const recruitingYear = publishedMonth >= 7 ? publishedYear + 1 : publishedYear;
      evidence[recruitingYear] = publishedMonth >= 7
        ? "inferred:us-program-posted-h2"
        : "inferred:us-program-posted-h1";
    }
  }

  return {
    years: Object.keys(evidence).map(Number).sort((left, right) => left - right),
    evidence,
  };
}
