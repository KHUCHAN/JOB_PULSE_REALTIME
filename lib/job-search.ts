export function ftsQuery(input: string): string {
  const tokens = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  // Short acronyms remain searchable, without expanding r* across the catalog.
  return [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"${token.length >= 3 ? "*" : ""}`).join(" AND ");
}

export function jobIdentifierQuery(input: string): string[] | undefined {
  const value = input.trim();
  // A recruiting year alone is text, not a requisition. Never interpret prose
  // or arbitrary URL fragments as identity predicates.
  if (!/^(?:\d{5,24}|[a-z]{1,12}[-_]?\d{3,24}(?:-\d{1,4})?)$/i.test(value)) return undefined;
  return [...new Set([value, value.replace(/[-_]/g, "")])];
}
