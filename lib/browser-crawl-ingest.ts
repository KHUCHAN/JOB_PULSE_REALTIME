import type { CrawledFacet, CrawledJob, CrawlSource } from "./crawler";
import { normalizeEmploymentType } from "./employment-type";

type BrowserJobRecord = {
  officialUrl?: unknown;
  title?: unknown;
  location?: unknown;
  publishedText?: unknown;
  businessUnit?: unknown;
  category?: unknown;
  companyId?: unknown;
  department?: unknown;
  jobRequisitionType?: unknown;
  employmentType?: unknown;
  postingType?: unknown;
  region?: unknown;
};

const textValue = (value: unknown, max = 500): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

const sourceOrigins: Record<string, string> = {
  "p4-0214-alvarez-marsal": "https://careers.alvarezandmarsal.com",
};

const dateFromCard = (value: string | null): string | null => {
  if (!value) return null;
  const timestamp = Date.parse(`${value} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const countedFacet = (key: string, label: string, values: Array<string | null>): CrawledFacet | null => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  if (counts.size === 0) return null;
  return {
    key,
    label,
    values: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([value, count]) => ({ key: value, label: value, count })),
  };
};

export function normalizeBrowserJobSnapshot(
  source: CrawlSource,
  input: unknown,
): { jobs: CrawledJob[]; facets: CrawledFacet[] } {
  const officialOrigin = sourceOrigins[source.id];
  if (!officialOrigin) throw new Error("This source does not support browser snapshot ingestion.");
  if (!Array.isArray(input) || input.length > 10_000) throw new Error("Browser snapshot must contain at most 10,000 jobs.");

  const jobs = new Map<string, CrawledJob>();
  const regions: Array<string | null> = [];
  const businessUnits: Array<string | null> = [];
  const employmentTypes: Array<string | null> = [];
  for (const raw of input as BrowserJobRecord[]) {
    const title = textValue(raw?.title);
    const officialUrlText = textValue(raw?.officialUrl, 2_000);
    if (!title || !officialUrlText) continue;
    let officialUrl: URL;
    try {
      officialUrl = new URL(officialUrlText);
    } catch {
      throw new Error("Browser job URL is invalid.");
    }
    if (officialUrl.origin !== officialOrigin || !/^\/jobs\/\d+/i.test(officialUrl.pathname)) {
      throw new Error("Browser job URL is outside the official careers origin.");
    }
    const externalId = officialUrl.pathname.match(/^\/jobs\/(\d+)/i)?.[1] ?? null;
    const location = textValue(raw.location);
    const region = textValue(raw.region);
    const businessUnit = textValue(raw.businessUnit);
    const department = textValue(raw.department) ?? businessUnit;
    const employmentType = normalizeEmploymentType(raw.employmentType)
      ?? (/\b(?:intern(?:ship)?|co[\s-]?op|trainee|industrial placement)\b/i.test(title) ? "Internship" : null);
    const jobRequisitionType = textValue(raw.jobRequisitionType);
    const category = textValue(raw.category);
    const postingType = textValue(raw.postingType);
    const summary = [employmentType, department, region, jobRequisitionType].filter(Boolean).join(" · ") || null;
    jobs.set(officialUrl.href, {
      externalId,
      title,
      company: source.company,
      location,
      arrangement: /\bremote\b/i.test(location ?? "") ? "remote" : "unknown",
      employmentType,
      summary,
      ...(department ? { department } : {}),
      ...(businessUnit ? { businessUnit } : {}),
      ...(region ? { jobFamily: region } : {}),
      rawPayload: {
        ...(category ? { category } : {}),
        ...(jobRequisitionType ? { jobRequisitionType } : {}),
        ...(postingType ? { postingType } : {}),
        ...(textValue(raw.companyId) ? { companyId: textValue(raw.companyId) } : {}),
      },
      officialUrl: officialUrl.href,
      publishedAt: dateFromCard(textValue(raw.publishedText)),
    });
    regions.push(region);
    businessUnits.push(businessUnit);
    employmentTypes.push(employmentType);
  }
  const facets = [
    countedFacet("employment_type", "Employment type", employmentTypes),
    countedFacet("region", "Region", regions),
    countedFacet("business_unit", "Business unit", businessUnits),
  ].filter((facet): facet is CrawledFacet => facet !== null);
  return { jobs: [...jobs.values()], facets };
}
