export type AiDataJobInput = {
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

export type JobTopicClassification = {
  topicKey: "ai-data";
  matched: boolean;
  score: number;
  evidence: string[];
};

type Signal = { key: string; pattern: RegExp };

const domainSignals: Signal[] = [
  { key: "artificial intelligence", pattern: /\bartificial intelligence\b/i },
  { key: "machine learning", pattern: /\bmachine learning\b/i },
  { key: "deep learning", pattern: /\bdeep learning\b/i },
  { key: "generative ai", pattern: /\b(?:generative ai|genai)\b/i },
  { key: "large language model", pattern: /\b(?:large language models?|llms?)\b/i },
  { key: "natural language processing", pattern: /\b(?:natural language processing|nlp)\b/i },
  { key: "computer vision", pattern: /\bcomputer vision\b/i },
  { key: "reinforcement learning", pattern: /\breinforcement learning\b/i },
  { key: "recommendation systems", pattern: /\brecommend(?:ation|er) systems?\b/i },
  { key: "data science", pattern: /\bdata scien(?:ce|tist|tists)\b/i },
  { key: "decision scientist", pattern: /\bdecision scientists?\b/i },
  { key: "applied scientist", pattern: /\bapplied scientists?\b/i },
  { key: "research scientist", pattern: /\bresearch scientists?\b/i },
  { key: "data engineering", pattern: /\bdata engineer(?:ing|s)?\b/i },
  { key: "analytics engineering", pattern: /\banalytics? engineer(?:ing|s)?\b/i },
  { key: "data analysis", pattern: /\bdata (?:analysis|analyst|analysts|analytics)\b/i },
  { key: "business intelligence", pattern: /\bbusiness intelligence\b/i },
  { key: "ml engineering", pattern: /\bml engineer(?:ing|s)?\b/i },
  { key: "mlops", pattern: /\bmlops\b/i },
  { key: "model infrastructure", pattern: /\bmodel infrastructure\b/i },
  { key: "ai platform", pattern: /\bai platform\b/i },
  { key: "data platform", pattern: /\bdata platform\b/i },
];

const supportingSignals: Signal[] = [
  { key: "ai", pattern: /(^|[^a-z0-9])ai([^a-z0-9]|$)/i },
  { key: "ml", pattern: /(^|[^a-z0-9])ml([^a-z0-9]|$)/i },
  { key: "bi", pattern: /(^|[^a-z0-9])bi([^a-z0-9]|$)/i },
  { key: "predictive models", pattern: /\bpredictive model(?:ing|s)?\b/i },
  { key: "feature engineering", pattern: /\bfeature engineering\b/i },
  { key: "model training", pattern: /\b(?:model training|training models?)\b/i },
  { key: "statistical modeling", pattern: /\bstatistical model(?:ing|s)?\b/i },
  { key: "data pipeline", pattern: /\bdata pipelines?\b/i },
];

const skillSignals: Signal[] = [
  ...domainSignals,
  { key: "pytorch", pattern: /\bpytorch\b/i },
  { key: "tensorflow", pattern: /\btensorflow\b/i },
  { key: "scikit-learn", pattern: /\bscikit[ -]?learn\b/i },
  { key: "hugging face", pattern: /\bhugging ?face\b/i },
  ...supportingSignals.slice(0, 3),
];

const normalized = (value: string | null | undefined): string =>
  value?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";

export function classifyAiDataJob(input: AiDataJobInput): JobTopicClassification {
  const evidence = new Set<string>();
  let score = 0;
  const addMatches = (source: string, value: string, signals: Signal[], weight: number) => {
    for (const signal of signals) {
      if (!signal.pattern.test(value)) continue;
      const key = `${source}:${signal.key}`;
      if (evidence.has(key)) continue;
      evidence.add(key);
      score += weight;
    }
  };

  const structuralFields: Array<[string, string | null | undefined]> = [
    ["title", input.title],
    ["department", input.department],
    ["team", input.team],
    ["businessUnit", input.businessUnit],
    ["jobFamily", input.jobFamily],
    ["jobFunction", input.jobFunction],
  ];
  for (const [source, raw] of structuralFields) {
    const value = normalized(raw);
    if (!value) continue;
    addMatches(source, value, domainSignals, 4);
    addMatches(source, value, supportingSignals.slice(0, 3), 4);
  }

  for (const skill of input.skills ?? []) {
    const value = normalized(skill);
    if (value) addMatches("skill", value, skillSignals, 4);
  }

  const bodyFields: Array<[string, string | null | undefined]> = [
    ["summary", input.summary],
    ["description", input.description],
    ["responsibilities", input.responsibilities],
    ["qualifications", input.qualifications],
  ];
  for (const [source, raw] of bodyFields) {
    const value = normalized(raw);
    if (!value) continue;
    addMatches(source, value, domainSignals, 4);
    addMatches(source, value, supportingSignals, 2);
  }

  const orderedEvidence = [...evidence].sort();
  return {
    topicKey: "ai-data",
    matched: score >= 4,
    score,
    evidence: orderedEvidence,
  };
}
