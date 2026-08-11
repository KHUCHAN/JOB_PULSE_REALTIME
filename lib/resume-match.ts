export interface ResumeMatchInput {
  id: string;
  title: string;
  company: string;
  locationRegion: "us" | "non_us" | "mixed" | "unknown";
  programKeys: readonly string[];
  summary: string | null;
  description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  skills: readonly string[];
  jobFamily: string | null;
  jobFunction: string | null;
  educationRequirements: string | null;
  experienceRequirements: string | null;
  securityClearance: string | null;
  recruitingYears: readonly number[];
  publishedAt: string | null;
  firstSeenAt: string;
}

export interface ResumeMatchEvidence {
  code: string;
  label: string;
  points: number;
}

export interface ResumeMatchDecision {
  eligible: boolean;
  score: number;
  evidence: ResumeMatchEvidence[];
  exclusion: string | null;
}

export const CHANYOUNG_RESUME_PROFILE = {
  id: "chanyoung-resume",
  keywordId: "resume-keyword-chanyoung",
  ruleVersion: "resume-v1",
  minScore: 60,
} as const;

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const contains = (value: string, expression: RegExp): boolean => expression.test(` ${value} `);

const PROGRAM_TITLE = /(?:^|\s)(?:interns?|internships?|co-?op|co\s+op)(?:\s|$)/;
const NON_ROLE_TITLE = /(?:^|\s)(?:recruiting|recruiter|talent acquisition|human resources|campus recruiter)(?:\s|$)/;
const HIGH_SCHOOL_ONLY = /(?:^|\s)(?:high school|secondary school)(?:\s|$)/;
const PHD_ONLY = /(?:^|\s)(?:ph\.?d\.?|doctoral)(?:\s|$)/;
const CITIZEN_ONLY = /(?:must|required to) (?:be )?(?:a )?(?:u\.?s\.?|united states) citizen|u\.?s\.? citizenship (?:is )?required/;
const ACTIVE_CLEARANCE = /active (?:secret|top secret|ts\/?sci|security) clearance|(?:secret|top secret|ts\/?sci) clearance required/;

const roleEvidence = (title: string): ResumeMatchEvidence | null => {
  const rules: Array<[RegExp, ResumeMatchEvidence]> = [
    [/(?:\bllm\b|large language model|natural language|\bnlp\b|retrieval augmented|\brag\b|knowledge graph|agentic|ai evaluation)/, { code: "role:llm-nlp", label: "LLM, NLP, RAG, or knowledge systems", points: 35 }],
    [/(?:machine learning|artificial intelligence|\bai\b|deep learning|applied ai)/, { code: "role:ai-ml", label: "AI or machine learning role", points: 35 }],
    [/(?:data engineer|analytics engineer|etl engineer|data platform)/, { code: "role:data-engineering", label: "Data engineering role", points: 35 }],
    [/(?:data scien|data analy|business intelligence|quantitative|\bbi\b)/, { code: "role:data-analytics", label: "Data science or analytics role", points: 32 }],
    [/(?:computer vision|image processing|\bocr\b)/, { code: "role:computer-vision", label: "Computer vision or OCR role", points: 35 }],
    [/(?:software (?:engineer|engineering|developer|development)|application developer|backend developer|frontend developer|full.?stack developer)/, { code: "role:software-engineering", label: "Direct software engineering role", points: 35 }],
    [/(?:fraud|anti money laundering|\baml\b|risk analy|regtech|data quality)/, { code: "role:data-analytics", label: "Risk or fraud analytics role", points: 30 }],
  ];

  return rules.find(([expression]) => expression.test(title))?.[1] ?? null;
};

const skillEvidence = (input: ResumeMatchInput): ResumeMatchEvidence[] => {
  const haystack = normalize([
    input.title,
    input.summary,
    input.description,
    input.responsibilities,
    input.qualifications,
    input.skills.join(" "),
    input.jobFamily,
    input.jobFunction,
  ].filter(Boolean).join(" "));
  const groups: Array<[RegExp, ResumeMatchEvidence]> = [
    [/(?:^|\s)(?:python|pyspark)(?:\s|$)/, { code: "skill:python", label: "Python or PySpark", points: 8 }],
    [/(?:^|\s)(?:sql|database|data warehouse)(?:\s|$)/, { code: "skill:sql", label: "SQL and data systems", points: 7 }],
    [/(?:machine learning|deep learning|scikit|pytorch|tensorflow)/, { code: "skill:ml", label: "Machine-learning stack", points: 7 }],
    [/(?:\bnlp\b|large language model|\bllm\b|\brag\b|neo4j|knowledge graph)/, { code: "skill:language-systems", label: "Language or knowledge systems", points: 7 }],
    [/(?:javascript|typescript|java|c\+\+|react|node\.js)/, { code: "skill:software", label: "Software development stack", points: 6 }],
    [/(?:tableau|business intelligence|analytics)/, { code: "skill:analytics", label: "Analytics tooling", points: 5 }],
  ];

  const matches = groups.filter(([expression]) => expression.test(haystack)).map(([, evidence]) => evidence);
  let remaining = 20;
  return matches.flatMap((evidence) => {
    if (remaining <= 0) return [];
    const points = Math.min(evidence.points, remaining);
    remaining -= points;
    return [{ ...evidence, points }];
  });
};

export const evaluateResumeMatch = (input: ResumeMatchInput): ResumeMatchDecision => {
  const title = normalize(input.title);
  const authorizationText = normalize([
    input.qualifications,
    input.educationRequirements,
    input.experienceRequirements,
    input.securityClearance,
  ].filter(Boolean).join(" "));

  const exclusion = input.locationRegion !== "us"
    ? "region:not-us"
    : !input.programKeys.some((key) => key === "internship" || key === "coop") || !PROGRAM_TITLE.test(title)
      ? "program:not-internship"
      : NON_ROLE_TITLE.test(title)
        ? "role:recruiting"
        : HIGH_SCHOOL_ONLY.test(title) || contains(normalize(input.educationRequirements ?? ""), HIGH_SCHOOL_ONLY)
          ? "education:high-school-only"
          : PHD_ONLY.test(title) || /ph\.?d\.? (?:students?|candidates?) (?:only|required)/.test(authorizationText)
            ? "education:phd-only"
            : CITIZEN_ONLY.test(authorizationText)
              ? "authorization:citizen-only"
              : ACTIVE_CLEARANCE.test(authorizationText)
                ? "authorization:active-clearance"
                : null;

  const role = roleEvidence(title);
  if (exclusion || !role) {
    return { eligible: false, score: 0, evidence: [], exclusion: exclusion ?? "role:not-supported" };
  }

  const evidence: ResumeMatchEvidence[] = [
    { code: "gate:us", label: "U.S. location", points: 10 },
    { code: "gate:internship", label: "Internship or co-op program", points: 25 },
    role,
    ...skillEvidence(input),
  ];
  if (/(?:fraud|anti money laundering|\baml\b|risk|regtech|data quality)/.test(title)) {
    evidence.push({ code: "domain:aml-risk", label: "AML, risk, fraud, or data-quality domain", points: 10 });
  }
  if (input.recruitingYears.includes(2027)) {
    evidence.push({ code: "year:2027", label: "2027 recruiting cycle", points: 10 });
  }

  const score = Math.min(100, evidence.reduce((sum, item) => sum + item.points, 0));
  return {
    eligible: score >= CHANYOUNG_RESUME_PROFILE.minScore,
    score,
    evidence,
    exclusion: score >= CHANYOUNG_RESUME_PROFILE.minScore ? null : "score:below-threshold",
  };
};
