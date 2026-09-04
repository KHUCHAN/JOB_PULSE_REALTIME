// Independent official-site audit filters; never approve/reject job matches.
export type AuditFacet = { facetParameter?: string; descriptor?: string; id?: string; values?: AuditFacet[] };
const states = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const usLocation = new RegExp(`^(?:US|USA)(?:[ ,\\-]|$)|\\bUnited States\\b|,\\s*(?:${states})(?:\\s+-.*)?$`, "i");
export function auditWorkdayFacets(facets: AuditFacet[]): Record<string, string[]> | null {
  const flat: AuditFacet[] = [];
  const walk = (items: AuditFacet[]) => { for (const item of items) { flat.push(item); walk(item.values ?? []); } };
  walk(facets);
  let country: Record<string, string[]> | null = null;
  for (const facet of flat) {
    if (!facet.facetParameter || !/country|location/i.test(facet.facetParameter)) continue;
    const us = facet.values?.find(v => /^United States(?: of America)?$/i.test(v.descriptor ?? ""));
    if (us?.id) { country = { [facet.facetParameter]: [us.id] }; break; }
  }
  if (!country) {
    const locations = flat.find(f => f.facetParameter === "locations");
    const ids = locations?.values?.filter(v => v.id && usLocation.test(v.descriptor ?? "")).map(v => v.id!);
    if (ids?.length) country = { locations: [...new Set(ids)] };
  }
  if (!country) return null;
  // Some Workday searches match "internal" as well as "intern". Use an
  // advertised student subtype when present, never invent a facet ID.
  const subtype = flat.find(f => f.facetParameter === "workerSubType");
  const internIds = subtype?.values?.filter(v => v.id && /\bintern(?:ship)?\b|\bco[ -]?op\b/i.test(v.descriptor ?? "")).map(v => v.id!);
  if (internIds?.length) country.workerSubType = internIds;
  return country;
}
