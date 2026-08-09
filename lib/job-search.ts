export function ftsQuery(input: string): string {
  const tokens = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}
