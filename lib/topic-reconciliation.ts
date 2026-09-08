/** Visit only this snapshot's jobs and compare each job's own small key set.
 * A composite NOT IN against the whole snapshot can scan all expected pairs
 * for each obsolete membership (quadratic work on a large catalog).
 */
export const obsoleteTopicMembershipsSql = (namespace: "area" | "program" | "year") => `
  DELETE FROM job_topics
  WHERE (job_id, topic_key) IN (
    SELECT jobs.id, existing.topic_key
    FROM json_each(?1) incoming
    JOIN jobs ON jobs.source_id = json_extract(incoming.value, '$.sourceId')
             AND jobs.official_url = json_extract(incoming.value, '$.officialUrl')
    JOIN job_topics existing ON existing.job_id = jobs.id
    WHERE existing.topic_key LIKE '${namespace}:%'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(incoming.value, '$.topicKeys') wanted
        WHERE wanted.value = existing.topic_key
      )
  )
`;
