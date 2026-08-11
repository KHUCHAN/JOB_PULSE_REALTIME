const SQL_ALIAS = /^[a-z][a-z0-9_]*$/i;

export const canonicalOpenJobNotExists = (alias: string): string => {
  if (!SQL_ALIAS.test(alias)) throw new Error("Canonical job SQL alias is invalid.");
  return `NOT EXISTS (
    SELECT 1 FROM jobs newer
    WHERE newer.status = 'open'
      AND newer.official_url = ${alias}.official_url
      AND (
        newer.first_seen_at > ${alias}.first_seen_at
        OR (newer.first_seen_at = ${alias}.first_seen_at AND newer.company < ${alias}.company)
        OR (newer.first_seen_at = ${alias}.first_seen_at AND newer.company = ${alias}.company AND newer.id < ${alias}.id)
      )
  )`;
};
