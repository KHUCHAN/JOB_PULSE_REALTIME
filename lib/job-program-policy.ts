/** SQL predicates shared by the internship-only resume/email paths. */
const normalizedEmploymentType = (alias: string): string =>
  `lower(replace(replace(replace(replace(coalesce(${alias}.employment_type, ''), '_', ''), '-', ''), ' ', ''), '/', ''))`;

// A small, reviewed exception list protects the email/search gate when an ATS
// list feed omits the detail-page employment type. IBM's list API labels
// requisition 128639 as a generic internship, while its official detail page
// explicitly says "Co-Op (Fixed Term)". The crawler detail enrichment will
// persist the canonical value on the next IBM pass; this guard prevents the
// stale row from leaking into the internship-only paths in the meantime.
const verifiedCoopOfficialUrlPrefixes = [
  "https://careers.ibm.com/en_us/careers/jobdetail?jobid=128639",
] as const;

const verifiedCoopOfficialUrlSql = (alias: string): string => verifiedCoopOfficialUrlPrefixes
  .map((prefix) => `substr(lower(coalesce(${alias}.official_url, '')), 1, ${prefix.length}) = '${prefix}'`)
  .join(" OR ");

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
)`;
