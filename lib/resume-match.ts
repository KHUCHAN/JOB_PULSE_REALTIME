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
  ruleVersion: "resume-v2",
  minScore: 60,
} as const;

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const NON_ROLE_TITLE = /(?:^|\s)(?:recruiting|recruiter|talent acquisition|human resources|campus recruiter)(?:\s|$)/;
const NON_TECHNICAL_TITLE = /(?:^|\s)(?:marketing|sales|accounting|clinical|communications?|human resources|operations)(?:\s|$)/;
const HIGH_SCHOOL = /(?:^|\s)(?:high school|secondary school)(?:\s|$)/;
const PHD_ONLY = /(?:^|\s)(?:ph\.?d\.?|doctoral)(?:\s|$)/;
const CITIZEN_ONLY = /(?:must|required to) (?:be )?(?:a )?(?:u\.?s\.?|united states) citizen|u\.?s\.? citizenship (?:is )?required/;
const ACTIVE_CLEARANCE = /active (?:secret|top secret|ts\/?sci|security) clearance|(?:secret|top secret|ts\/?sci) clearance required/;
const MASTER_OR_GRADUATE = /(?:master(?: s)?|graduate students?|graduate degree)/;
const HIGHER_EDUCATION = /(?:bachelor(?: s)?|college|university|undergraduate|graduate|master(?: s)?|ph\.?d\.?|doctoral)/;
const RELEVANT_DEGREE = /(?:bachelor(?: s)?|college|university|undergraduate|computer science|data science|engineering|information technology)/;
const NON_PHD_ELIGIBLE_DEGREE = /(?:bachelor(?: s)?|college|university|undergraduate|master(?: s)?|graduate students?|graduate degree)/;

const roleEvidence = (value: string): ResumeMatchEvidence | null => {
  const rules: Array<[RegExp, ResumeMatchEvidence]> = [
    [/(?:applied scientist|research scientist)/, { code: "role:applied-science", label: "Applied or research scientist role", points: 35 }],
    [/(?:forward deployed engineer|forward-deployed engineer|\bfde\b)/, { code: "role:fde", label: "Forward deployed engineering role", points: 35 }],
    [/(?:\bllm\b|large language model|natural language|\bnlp\b|retrieval augmented|\brag\b|knowledge graph|agentic|ai evaluation|\bembeddings?\b|semantic search|vector database|\bfaiss\b|prompt engineering)/, { code: "role:llm-nlp", label: "LLM, NLP, RAG, embedding, or knowledge systems", points: 35 }],
    [/(?:machine learning|artificial intelligence|\bai\b|deep learning|applied ai)/, { code: "role:ai-ml", label: "AI or machine learning role", points: 35 }],
    [/(?:data engineer|analytics engineer|etl engineer|data platform)/, { code: "role:data-engineering", label: "Data engineering role", points: 35 }],
    [/(?:data scien|data analy|business analy|decision analy|business intelligence|quantitative|\bbi\b)/, { code: "role:data-analytics", label: "Data science, business analysis, or analytics role", points: 35 }],
    [/(?:computer vision|image processing|\bocr\b)/, { code: "role:computer-vision", label: "Computer vision or OCR role", points: 35 }],
    [/(?:software (?:engineer|engineering|developer|development)|application developer|backend developer|frontend developer|full.?stack developer)/, { code: "role:software-engineering", label: "Direct software engineering role", points: 35 }],
    [/(?:fraud|anti money laundering|\baml\b|risk analy|regtech|data quality)/, { code: "role:data-analytics", label: "Risk or fraud analytics role", points: 30 }],
  ];

  return rules.find(([expression]) => expression.test(value))?.[1] ?? null;
};

const skillEvidence = (input: ResumeMatchInput): ResumeMatchEvidence[] => {
  const haystack = normalize([
    input.summary,
    input.description,
    input.responsibilities,
    input.qualifications,
    input.skills.join(" "),
    input.jobFamily,
    input.jobFunction,
  ].filter(Boolean).join(" "));
  const groups: Array<[RegExp, ResumeMatchEvidence]> = [
    [/(?:^|\s)(?:python|pyspark|pandas)(?:\s|$)/, { code: "skill:python", label: "Python, PySpark, or Pandas", points: 10 }],
    [/(?:^|\s)(?:sql|postgresql|database|data warehouse|etl|spark|hadoop|mongodb)(?:\s|$)/, { code: "skill:sql", label: "SQL and data systems", points: 10 }],
    [/(?:machine learning|deep learning|scikit|pytorch|tensorflow)/, { code: "skill:ml", label: "Machine-learning stack", points: 7 }],
    [/(?:\bnlp\b|large language model|\bllm\b|\brag\b|neo4j|knowledge graph|model evaluation|\bembeddings?\b|semantic search|vector database|\bfaiss\b|prompt engineering)/, { code: "skill:language-systems", label: "Language, embedding, or knowledge systems", points: 10 }],
    [/(?:javascript|typescript|java|c\+\+|react|node\.js)/, { code: "skill:software", label: "Software development stack", points: 25 }],
    [/(?:docker|kubernetes|container|\bk8s\b|\bgit\b)/, { code: "skill:platform", label: "Container and delivery tooling", points: 10 }],
    [/(?:tableau|business intelligence|analytics)/, { code: "skill:analytics", label: "Analytics tooling", points: 5 }],
    [/(?:opencv|computer vision|image processing|\bocr\b|multimodal)/, { code: "skill:vision", label: "Computer vision or OCR stack", points: 8 }],
  ];

  const matches = groups.filter(([expression]) => expression.test(haystack)).map(([, evidence]) => evidence);
  let remaining = 30;
  return matches.flatMap((evidence) => {
    if (remaining <= 0) return [];
    const points = Math.min(evidence.points, remaining);
    remaining -= points;
    return [{ ...evidence, points }];
  });
};

const domainEvidence = (haystack: string): ResumeMatchEvidence | null => {
  if (/(?:anti money laundering|\baml\b|\bkyc\b|fraud|financial crime|regtech|compliance analy|risk analy|data quality)/.test(haystack)) {
    return { code: "domain:aml-risk", label: "AML, risk, fraud, or data-quality domain", points: 15 };
  }
  if (/(?:supply chain|graph analy|information extraction|document intelligence)/.test(haystack)) {
    return { code: "domain:applied-data", label: "Applied data and information systems domain", points: 12 };
  }
  return null;
};

const educationEvidence = (input: ResumeMatchInput): ResumeMatchEvidence | null => {
  const value = normalize([
    input.educationRequirements,
    input.qualifications,
    input.description?.slice(0, 12_000),
  ].filter(Boolean).join(" "));
  if (MASTER_OR_GRADUATE.test(value)) {
    return { code: "education:masters-eligible", label: "Master's or graduate students eligible", points: 10 };
  }
  if (RELEVANT_DEGREE.test(value)) {
    return { code: "education:relevant-degree", label: "Relevant technical degree", points: 8 };
  }
  return null;
};

const highSchoolOnly = (title: string, educationText: string): boolean => {
  if (HIGH_SCHOOL.test(title) && /(?:students?|interns?|program)/.test(title)) return true;
  if (!HIGH_SCHOOL.test(educationText)) return false;
  const higherEducation = HIGHER_EDUCATION.test(educationText);
  return !higherEducation || /(?:only|exclusively) (?:for )?(?:high school|secondary school)/.test(educationText);
};

const phdOnly = (title: string, educationText: string): boolean => {
  const explicitlyPhdOnly = /(?:ph\.?d\.?|doctoral) (?:students?|candidates?) (?:only|required)/.test(educationText)
    || /(?:only|exclusively) (?:for )?(?:ph\.?d\.?|doctoral)/.test(educationText);
  if (explicitlyPhdOnly) return true;
  if (!PHD_ONLY.test(title)) return false;
  return !NON_PHD_ELIGIBLE_DEGREE.test(educationText);
};

export const evaluateResumeMatch = (input: ResumeMatchInput): ResumeMatchDecision => {
  const title = normalize(input.title);
  const roleHaystack = normalize([
    input.title,
    input.jobFamily,
    input.jobFunction,
    input.summary?.slice(0, 4_000),
    input.description?.slice(0, 12_000),
    input.responsibilities?.slice(0, 8_000),
    input.qualifications?.slice(0, 8_000),
  ].filter(Boolean).join(" "));
  const authorizationText = normalize([
    input.qualifications,
    input.educationRequirements,
    input.experienceRequirements,
    input.securityClearance,
  ].filter(Boolean).join(" "));

  const exclusion = input.locationRegion !== "us"
    ? "region:not-us"
    : !input.programKeys.some((key) => key === "internship" || key === "coop")
      ? "program:not-internship"
      : NON_ROLE_TITLE.test(title)
        ? "role:recruiting"
        : highSchoolOnly(title, authorizationText)
          ? "education:high-school-only"
          : phdOnly(title, authorizationText)
            ? "education:phd-only"
            : CITIZEN_ONLY.test(authorizationText)
              ? "authorization:citizen-only"
              : ACTIVE_CLEARANCE.test(authorizationText)
                ? "authorization:active-clearance"
                : null;

  const titleRole = roleEvidence(title);
  const role = titleRole ?? (NON_TECHNICAL_TITLE.test(title) ? null : roleEvidence(roleHaystack));
  if (exclusion || !role) {
    return { eligible: false, score: 0, evidence: [], exclusion: exclusion ?? "role:not-supported" };
  }

  const evidence: ResumeMatchEvidence[] = [role, ...skillEvidence(input)];
  const domain = domainEvidence(roleHaystack);
  if (domain) evidence.push(domain);
  const education = educationEvidence(input);
  if (education) evidence.push(education);
  if (input.recruitingYears.includes(2027)) {
    evidence.push({ code: "year:2027", label: "2027 recruiting cycle", points: 5 });
  }
  if (input.publishedAt) evidence.push({ code: "freshness:published", label: "ATS posting date available", points: 5 });

  const score = Math.min(100, evidence.reduce((sum, item) => sum + item.points, 0));
  return {
    eligible: score >= CHANYOUNG_RESUME_PROFILE.minScore,
    score,
    evidence,
    exclusion: score >= CHANYOUNG_RESUME_PROFILE.minScore ? null : "score:below-threshold",
  };
};
