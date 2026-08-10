export type JobAreaKey = "ai-ml" | "data-analytics" | "software-engineering";

export type JobAreaInput = {
  title: string;
  summary?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  skills?: string[] | null;
  department?: string | null;
  team?: string | null;
  businessUnit?: string | null;
  jobFamily?: string | null;
  jobFunction?: string | null;
};

export type JobAreaClassification = {
  areaKey: JobAreaKey;
  score: number;
  evidence: string[];
};

type Signal = { label: string; pattern: RegExp };

const aiMlSignals: Signal[] = [
  { label: "artificial intelligence", pattern: /\bartificial intelligence\b/i },
  { label: "ai", pattern: /(^|[^a-z0-9])ai([^a-z0-9]|$)/i },
  { label: "machine learning", pattern: /\bmachine learning\b/i },
  { label: "ml", pattern: /(^|[^a-z0-9])ml([^a-z0-9]|$)/i },
  { label: "deep learning", pattern: /\bdeep learning\b/i },
  { label: "generative ai", pattern: /\b(?:generative ai|genai)\b/i },
  { label: "large language model", pattern: /\b(?:large language models?|llms?)\b/i },
  { label: "natural language processing", pattern: /\b(?:natural language processing|nlp)\b/i },
  { label: "computer vision", pattern: /\bcomputer vision\b/i },
  { label: "reinforcement learning", pattern: /\breinforcement learning\b/i },
  { label: "applied scientist", pattern: /\bapplied scientists?\b/i },
  { label: "research scientist", pattern: /\bresearch scientists?\b/i },
  { label: "pytorch", pattern: /\bpytorch\b/i },
  { label: "tensorflow", pattern: /\btensorflow\b/i },
  { label: "scikit-learn", pattern: /\bscikit[ -]?learn\b/i },
];

const dataAnalyticsSignals: Signal[] = [
  { label: "data science", pattern: /\bdata scien(?:ce|tist|tists)\b/i },
  { label: "data engineering", pattern: /\bdata engineer(?:ing|s)?\b/i },
  { label: "data analytics", pattern: /\bdata\s*(?:&(?:amp;)?|and)\s*analytics\b/i },
  { label: "data analysis", pattern: /\bdata (?:analysis|analyst|analysts|analytics)\b/i },
  { label: "analytics", pattern: /\banalytics?\b/i },
  { label: "quantitative", pattern: /\bquantitative\b/i },
  { label: "quant", pattern: /(^|[^a-z0-9])quant([^a-z0-9]|$)/i },
  { label: "informatics", pattern: /\binformatics\b/i },
  { label: "business intelligence", pattern: /\bbusiness intelligence\b/i },
  { label: "statistics", pattern: /\bstatistic(?:al|ian|ians|s)?\b/i },
  { label: "operations research", pattern: /\boperations research\b/i },
  { label: "decision science", pattern: /\bdecision scien(?:ce|tist|tists)\b/i },
];

const softwareEngineeringSignals: Signal[] = [
  { label: "software engineering", pattern: /\bsoftware engineer(?:ing|s)?\b/i },
  { label: "software developer", pattern: /\bsoftware developers?\b/i },
  { label: "software development", pattern: /\bsoftware development\b/i },
  { label: "application developer", pattern: /\bapplications? developers?\b/i },
  { label: "frontend", pattern: /\bfront[ -]?end (?:software )?(?:engineer|developer)s?\b/i },
  { label: "backend", pattern: /\bback[ -]?end (?:software )?(?:engineer|developer)s?\b/i },
  { label: "full stack", pattern: /\bfull[ -]?stack (?:software )?(?:engineer|developer)s?\b/i },
  { label: "mobile", pattern: /\bmobile (?:software )?(?:engineer|developer)s?\b/i },
  { label: "ios", pattern: /\bios (?:software )?(?:engineer|developer)s?\b/i },
  { label: "android", pattern: /\bandroid (?:software )?(?:engineer|developer)s?\b/i },
  { label: "firmware", pattern: /\bfirmware (?:engineer|developer)s?\b/i },
];

const signalsByArea: Record<JobAreaKey, Signal[]> = {
  "ai-ml": aiMlSignals,
  "data-analytics": dataAnalyticsSignals,
  "software-engineering": softwareEngineeringSignals,
};

const areaOrder: JobAreaKey[] = ["ai-ml", "data-analytics", "software-engineering"];

const normalize = (value: unknown): string => typeof value === "string"
  ? value.normalize("NFKC").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()
  : "";

const matchingLabels = (value: string, signals: Signal[]): string[] =>
  signals.filter((signal) => signal.pattern.test(value)).map((signal) => signal.label);

export function classifyJobAreas(input: JobAreaInput): JobAreaClassification[] {
  const structuralFields: Array<[string, unknown]> = [
    ["title", input.title],
    ["department", input.department],
    ["team", input.team],
    ["businessUnit", input.businessUnit],
    ["jobFamily", input.jobFamily],
    ["jobFunction", input.jobFunction],
  ];
  const bodyFields: Array<[string, unknown]> = [
    ["summary", input.summary],
    ["description", input.description],
    ["responsibilities", input.responsibilities],
    ["qualifications", input.qualifications],
  ];
  const structural = new Map<JobAreaKey, Set<string>>(areaOrder.map((key) => [key, new Set()]));
  const skill = new Map<JobAreaKey, Set<string>>(areaOrder.map((key) => [key, new Set()]));
  const body = new Map<JobAreaKey, Set<string>>(areaOrder.map((key) => [key, new Set()]));

  for (const [source, raw] of structuralFields) {
    const value = normalize(raw);
    if (!value) continue;
    for (const areaKey of areaOrder) {
      for (const label of matchingLabels(value, signalsByArea[areaKey])) {
        structural.get(areaKey)!.add(`${source}:${label}`);
      }
    }
  }

  for (const raw of input.skills ?? []) {
    const value = normalize(raw);
    if (!value) continue;
    for (const areaKey of areaOrder) {
      for (const label of matchingLabels(value, signalsByArea[areaKey])) {
        skill.get(areaKey)!.add(`skill:${label}`);
      }
    }
  }

  for (const [, raw] of bodyFields) {
    const value = normalize(raw);
    if (!value) continue;
    for (const areaKey of areaOrder) {
      for (const label of matchingLabels(value, signalsByArea[areaKey])) {
        body.get(areaKey)!.add(`body:${label}`);
      }
    }
  }

  const bodyAreaCount = areaOrder.filter((areaKey) => body.get(areaKey)!.size > 0).length;
  return areaOrder.flatMap((areaKey) => {
    const structuralEvidence = structural.get(areaKey)!;
    const skillEvidence = skill.get(areaKey)!;
    const bodyEvidence = body.get(areaKey)!;
    const bodyMatched = bodyEvidence.size >= 2 || (bodyEvidence.size >= 1 && bodyAreaCount >= 2);
    if (structuralEvidence.size === 0 && skillEvidence.size === 0 && !bodyMatched) return [];
    const evidence = [...structuralEvidence, ...skillEvidence, ...(bodyMatched ? bodyEvidence : [])].sort();
    return [{
      areaKey,
      score: structuralEvidence.size * 4 + skillEvidence.size * 4 + (bodyMatched ? bodyEvidence.size * 2 : 0),
      evidence,
    }];
  });
}
