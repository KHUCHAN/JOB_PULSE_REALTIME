/** SQL predicates shared by the internship/co-op resume and email paths. */
const normalizedEmploymentType = (alias: string): string =>
  `lower(replace(replace(replace(replace(coalesce(${alias}.employment_type, ''), '_', ''), '-', ''), ' ', ''), '/', ''))`;

// A small, reviewed exception list protects the email/search gate when an ATS
// list feed omits the detail-page employment type. IBM's list API labels
// requisition 128639 as a generic internship, while its official detail page
// explicitly says "Co-Op (Fixed Term)". The crawler detail enrichment will
// persist the canonical value on the next IBM pass; this guard prevents the
// stale row from being presented as an internship in the meantime.
const verifiedCoopOfficialUrlPrefixes = [
  "https://careers.ibm.com/en_us/careers/jobdetail?jobid=128639",
  "https://careers.ibm.com/en_us/careers/jobdetail?jobid=128709",
  "https://careers.ibm.com/en_us/careers/jobdetail?jobid=128792",
] as const;

const verifiedCoopOfficialUrlSql = (alias: string): string => verifiedCoopOfficialUrlPrefixes
  .map((prefix) => `substr(lower(coalesce(${alias}.official_url, '')), 1, ${prefix.length}) = '${prefix}'`)
  .join(" OR ");

const normalizedTitleTokens = (alias: string): string => `lower(' ' ||
  replace(replace(replace(replace(replace(replace(replace(replace(replace(
    coalesce(${alias}.title, ''), '-', ' '), '‐', ' '), '‑', ' '), '–', ' '), '—', ' '),
    '/', ' '), '(', ' '), ')', ' '), ',', ' ')
  || ' ')`;

/** Clinical extern shifts are credential-track hospital jobs, not internships. */
export const jobHasClinicalExternSql = (alias = "j"): string => {
  const title = normalizedTitleTokens(alias);
  const externToken = ["extern", "externs", "externship", "externships"]
    .map((token) => `${title} LIKE '% ${token} %'`)
    .join(" OR ");
  const clinicalToken = [
    "nurse", "nursing", "radiology", "radiologic", "pharmacy", "pharmacist",
    "respiratory care", "respiratory therapy", "surgical tech", "surgical technologist",
    "patient care", "medical assistant", "sonography", "sonographer",
    "imaging technologist", "clinical laboratory", "laboratory technologist",
  ].map((token) => `${title} LIKE '% ${token} %'`).join(" OR ");
  return `((${externToken}) AND (${clinicalToken}))`;
};

export const jobHasCoopSql = (alias = "j"): string => `(
  ${normalizedEmploymentType(alias)} LIKE '%coop%'
  OR ${verifiedCoopOfficialUrlSql(alias)}
  OR EXISTS (
    SELECT 1 FROM job_topics co_op_topic
    WHERE co_op_topic.job_id = ${alias}.id AND co_op_topic.topic_key = 'program:coop'
  )
)`;

export const internshipOnlySql = (alias = "j"): string => `(
  EXISTS (
    SELECT 1 FROM job_topics internship_topic
    WHERE internship_topic.job_id = ${alias}.id AND internship_topic.topic_key = 'program:internship'
  )
  AND NOT ${jobHasCoopSql(alias)}
  AND NOT ${jobHasClinicalExternSql(alias)}
)`;

/**
 * Student work programs that should be sent to Codex for final review. Co-op
 * is intentionally included: the reviewer verifies region, recruiting year,
 * profile fit, and any stated work-term dates before approving email delivery.
 */
export const internshipOrCoopSql = (alias = "j"): string => `(
  EXISTS (
    SELECT 1 FROM job_topics student_program_topic
    WHERE student_program_topic.job_id = ${alias}.id
      AND student_program_topic.topic_key IN ('program:internship', 'program:coop')
  )
  AND NOT ${jobHasClinicalExternSql(alias)}
)`;
