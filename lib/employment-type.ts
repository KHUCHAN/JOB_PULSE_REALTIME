const canonicalTypes = new Map<string, string>([
  ["fulltime", "Full-time"], ["fulltimeemployee", "Full-time"], ["modifiedfulltime", "Full-time"],
  ["parttime", "Part-time"], ["temporary", "Temporary"], ["temp", "Temporary"],
  ["contractor", "Contractor"], ["contract", "Contract"], ["fixedtermcontract", "Contract"],
  ["coop", "Co-op"], ["coopfixedterm", "Co-op"], ["coopinternship", "Co-op"],
  ["cooperativeeducation", "Co-op"], ["cooperativeeducationstudent", "Co-op"],
  ["cooperativeworkterm", "Co-op"], ["workterm", "Co-op"],
  ["intern", "Internship"], ["internship", "Internship"], ["regular", "Regular"],
  ["employeeregular", "Regular"], ["employeeregularpermanent", "Regular"],
  ["permanent", "Permanent"], ["seasonal", "Seasonal"], ["casual", "Casual"],
  ["freelance", "Freelance"], ["apprentice", "Apprenticeship"], ["apprenticeship", "Apprenticeship"],
  ["fixedterm", "Fixed-term"],
]);

const typeToken = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const coopEmploymentPattern = /(?:^|[^a-z])co\s*-?\s*op(?:[^a-z]|$)|\bcooperative\s+(?:education|work\s+term|term)\b|\bwork\s+term(?:\s+student)?\b/i;

/**
 * Employment type is authoritative when an ATS explicitly says co-op. Some
 * boards also label the same posting as an "Internship" contract/position,
 * so co-op must win before generic internship normalization.
 */
export const isCoopEmploymentType = (value: unknown): boolean => rawValues(value)
  .some((item) => coopEmploymentPattern.test(item));

const canonicalType = (value: string): string | undefined => {
  const token = typeToken(value);
  const exact = canonicalTypes.get(token);
  if (exact) return exact;
  if (token.includes("fulltime")) return "Full-time";
  if (token.includes("parttime")) return "Part-time";
  if (/^intern(?:ship)?(?:position|program)?$/.test(token)) return "Internship";
  if (/^temp(?:orary)?(?:position|assignment)?$/.test(token)) return "Temporary";
  if (token.includes("fixedterm")) return "Fixed-term";
  return undefined;
};

const rawValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(rawValues);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      return rawValues(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return trimmed.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
};

export function normalizeEmploymentType(value: unknown): string | null {
  const values = rawValues(value);
  if (values.some((item) => coopEmploymentPattern.test(item))) return "Co-op";
  const canonical = values
    .map(canonicalType)
    .filter((item): item is string => Boolean(item));
  const unique = [...new Set(canonical)];
  return unique.length > 0 ? unique.join(" / ") : null;
}

export const inferEmploymentTypeFromPrograms = (programs: readonly string[]): string | null =>
  programs.includes("coop") ? "Co-op" : programs.includes("internship") ? "Internship" : null;

export const looksLikeRequisitionId = (value: string): boolean =>
  /^(?:R|JR|REQ|JOB|POSITION)[-_]?\d{3,}$/i.test(value.trim());

export function workdayBulletFields(fields: string[] | undefined): { employmentType: string | null; department: string | null } {
  const values = (fields ?? []).map((value) => value.trim()).filter(Boolean);
  const employmentType = values.map(normalizeEmploymentType).find((value): value is string => value !== null) ?? null;
  const department = values.find((value) => !looksLikeRequisitionId(value)
    && normalizeEmploymentType(value) === null
    && !/^(?:spotlight|featured) job$/i.test(value)) ?? null;
  return { employmentType, department };
}
