export type JobUrlRepair = {
  id: string;
  currentUrl: string;
  officialUrl: string;
};

export type DeadJobUrl = Pick<JobUrlRepair, "id" | "currentUrl">;

export function normalizeDeadJobUrls(value: unknown): DeadJobUrl[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 200) : "";
    const currentUrlText = typeof row.currentUrl === "string" ? row.currentUrl.trim() : "";
    if (!id || !currentUrlText) return [];
    try {
      const currentUrl = new URL(currentUrlText);
      return currentUrl.protocol === "https:" ? [{ id, currentUrl: currentUrl.href }] : [];
    } catch {
      return [];
    }
  });
}

export function normalizeJobUrlRepairs(value: unknown): JobUrlRepair[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 200) : "";
    const currentUrlText = typeof row.currentUrl === "string" ? row.currentUrl.trim() : "";
    const officialUrlText = typeof row.officialUrl === "string" ? row.officialUrl.trim() : "";
    if (!id || !currentUrlText || !officialUrlText || currentUrlText === officialUrlText) return [];
    try {
      const currentUrl = new URL(currentUrlText);
      const officialUrl = new URL(officialUrlText);
      if (currentUrl.protocol !== "https:" || officialUrl.protocol !== "https:" || currentUrl.origin !== officialUrl.origin) return [];
      return [{ id, currentUrl: currentUrl.href, officialUrl: officialUrl.href }];
    } catch {
      return [];
    }
  });
}
