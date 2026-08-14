/** SQL predicates shared by the internship-only resume/email paths. */
const normalizedEmploymentType = (alias: string): string =>
  `lower(replace(replace(replace(replace(coalesce(${alias}.employment_type, ''), '_', ''), '-', ''), ' ', ''), '/', ''))`;

export const jobHasCoopSql = (alias = "j"): string => `(
  ${normalizedEmploymentType(alias)} LIKE '%coop%'
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

