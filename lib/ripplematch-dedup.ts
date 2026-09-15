export type IdentityRow = { officialUrl: string; title: string; location?: string | null; requisitionId?: string | null };
const normalize = (s: string) => s.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const locationKeys = (s: string) => s.split(/[;|]/).map(v => normalize(v).replace(/\b(united states of america|united states|usa|us)\b/g, "").trim()).filter(Boolean);
/** Conservative cross-board identity reconciliation. No fuzzy title-only merges. */
export function sameRipplematchIdentity(incoming: IdentityRow, stored: IdentityRow): boolean {
  if (incoming.officialUrl === stored.officialUrl) return true;
  if (incoming.requisitionId && stored.requisitionId && normalize(incoming.requisitionId) === normalize(stored.requisitionId)) return true;
  if (normalize(incoming.title) !== normalize(stored.title)) return false;
  const left = locationKeys(incoming.location ?? ""), right = locationKeys(stored.location ?? "");
  return left.length > 0 && right.length > 0 && left.some(l => right.includes(l));
}
