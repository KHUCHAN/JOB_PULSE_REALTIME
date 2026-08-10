export type JobProgramKey = "internship" | "coop";

export type JobProgramClassification = {
  keys: JobProgramKey[];
  evidence: Partial<Record<JobProgramKey, string>>;
};

const normalizedTitle = (title: string): string => title
  .normalize("NFKD")
  .replace(/\p{M}+/gu, "")
  .normalize("NFC")
  .replace(/[‐‑‒–—]/g, "-")
  .toLocaleLowerCase()
  .replace(/\s+/g, " ")
  .trim();

type ProgramRule = { label: string; pattern: RegExp };

const internshipRules: ProgramRule[] = [
  { label: "intern", pattern: /(?:^|[^\p{L}\p{N}])intern(?:s|ships?)?(?=$|[^\p{L}\p{N}])/u },
  { label: "externship", pattern: /(?:^|[^\p{L}\p{N}])extern(?:s|ships?)?(?=$|[^\p{L}\p{N}])/u },
  { label: "working student", pattern: /(?:^|[^\p{L}\p{N}])working student(?=$|[^\p{L}\p{N}])/u },
  { label: "student worker", pattern: /(?:^|[^\p{L}\p{N}])(?:student worker|student researcher)(?=$|[^\p{L}\p{N}])/u },
  { label: "placement", pattern: /(?:^|[^\p{L}\p{N}])(?:industrial placement|placement student|student placement|placement year|sandwich placement|year in industry|industrial attachment)(?=$|[^\p{L}\p{N}])/u },
  { label: "summer analyst", pattern: /(?:^|[^\p{L}\p{N}])summer (?:analyst|associate)(?=$|[^\p{L}\p{N}])/u },
  { label: "vacation program", pattern: /(?:^|[^\p{L}\p{N}])(?:vacation scheme|vacationer(?: program)?|summer clerk|vacation clerk)(?=$|[^\p{L}\p{N}])/u },
  { label: "cadetship", pattern: /(?:^|[^\p{L}\p{N}])cadetship(?=$|[^\p{L}\p{N}])/u },
  { label: "articleship", pattern: /(?:^|[^\p{L}\p{N}])articleship(?=$|[^\p{L}\p{N}])/u },
  { label: "werkstudent", pattern: /(?:^|[^\p{L}\p{N}])werkstudent(?:in)?(?=$|[^\p{L}\p{N}])/u },
  { label: "praktikum", pattern: /(?:^|[^\p{L}\p{N}])(?:praktik(?:um|ant(?:in)?)?|praktyk(?:ant|i))(?=$|[^\p{L}\p{N}])/u },
  { label: "stagiaire", pattern: /(?:^|[^\p{L}\p{N}])(?:stagiaire|alternan(?:t|ce)|cesure)(?=$|[^\p{L}\p{N}])/u },
  { label: "stage (FR/NL)", pattern: /^(?!(?:stage\s*[-:]?\s*)(?:manager|hand|crew|technician|tech|carpenter|operations|production|lighting|audio|director|supervisor|lead|setup|labor|rigging)(?:$|[^\p{L}\p{N}]))(?:stage\s*[-:]?\s*\p{L}|(?:afstudeer|meewerk)stage)/u },
  { label: "estagio", pattern: /(?:^|[^\p{L}\p{N}])estagi(?:o|ari[oa])(?=$|[^\p{L}\p{N}])/u },
  { label: "practicante", pattern: /(?:^|[^\p{L}\p{N}])(?:practicas|practicante|pasantia|pasante|becari[oa])(?=$|[^\p{L}\p{N}])/u },
  { label: "tirocinio", pattern: /(?:^|[^\p{L}\p{N}])(?:tirocinio|tirocinante|stagista)(?=$|[^\p{L}\p{N}])/u },
  { label: "staz", pattern: /(?:^|[^\p{L}\p{N}])staz(?:ysta|ystka|ista)?(?=$|[^\p{L}\p{N}])/u },
  { label: "harjoittelija", pattern: /(?:^|[^\p{L}\p{N}])(?:harjoittelu|harjoittelija)(?=$|[^\p{L}\p{N}])/u },
  { label: "stajyer", pattern: /(?:^|[^\p{L}\p{N}])stajyer(?=$|[^\p{L}\p{N}])/u },
  { label: "gyakornok", pattern: /(?:^|[^\p{L}\p{N}])gyakornok(?=$|[^\p{L}\p{N}])/u },
  { label: "стажер", pattern: /стажер/u },
  { label: "インターン", pattern: /インターン/u },
  { label: "인턴", pattern: /인턴/u },
  { label: "实习", pattern: /(?:实习|實習)/u },
];

const coopRules: ProgramRule[] = [
  { label: "co-op", pattern: /(?:^|[^\p{L}\p{N}])(?:co(?:\s*-\s*|\s+)op|coop)(?=$|[^\p{L}\p{N}])/u },
  { label: "cooperative education", pattern: /(?:^|[^\p{L}\p{N}])cooperative educat(?:ion|ional)(?=$|[^\p{L}\p{N}])/u },
];

const firstMatch = (title: string, rules: ProgramRule[]): ProgramRule | undefined =>
  rules.find((rule) => rule.pattern.test(title));

export function classifyJobPrograms(title: string): JobProgramClassification {
  const normalized = normalizedTitle(title);
  const internship = firstMatch(normalized, internshipRules);
  const coop = firstMatch(normalized, coopRules);
  const keys: JobProgramKey[] = [];
  const evidence: Partial<Record<JobProgramKey, string>> = {};
  if (internship) {
    keys.push("internship");
    evidence.internship = `title:${internship.label}`;
  }
  if (coop) {
    keys.push("coop");
    evidence.coop = `title:${coop.label}`;
  }
  return { keys, evidence };
}
