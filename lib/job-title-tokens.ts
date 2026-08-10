const titleSeparators = [
  "-", "_", "/", "\\", ",", ".", ":", ";", "(", ")", "[", "]", "{", "}",
  "–", "—", "|", "+", "&",
] as const;

/** Produces a lowercase, space-padded title expression suitable for whole-token LIKE checks. */
export const titleTokensSql = (column: string): string => {
  const normalized = titleSeparators.reduce(
    (expression, separator) => `replace(${expression}, '${separator.replaceAll("'", "''")}', ' ')`,
    `coalesce(${column}, '')`,
  );
  return `(' ' || lower(trim(${normalized})) || ' ')`;
};
