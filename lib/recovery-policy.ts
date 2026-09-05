/** Fail fast for conditions that another immediate request cannot repair. */
export const deferRecovery = (message: string): boolean =>
  /upstream maintenance|HTML interstitial|HTTP (?:401|403|429)\b/i.test(message);

export const workdayMaintenance = (url: string, body: string): boolean =>
  /^https:\/\/(?:community|static\.community)\.workday\.com\/maintenance-page(?:[./?]|$)/i.test(url)
  || /^https:\/\/www\.myworkday\.com\/wday\/drs\/outage(?:[/?]|$)/i.test(url)
  || /<title[^>]*>\s*Workday is currently unavailable\.?\s*<\/title>/i.test(body);

export type RecoveryHandoff = { attempted: number; summaries: Array<{ sourceId: string; status: string }> };
export const failedRecoveryIds = (input: unknown): string[] => {
  const value = input as RecoveryHandoff;
  if (!value || !Array.isArray(value.summaries) || value.attempted !== value.summaries.length
    || value.summaries.some(row => !row || typeof row.sourceId !== "string"
      || !/^[a-z0-9-]+$/.test(row.sourceId) || !["succeeded", "failed"].includes(row.status))) {
    throw new Error("Invalid request recovery handoff; refusing to silently omit failed sources.");
  }
  return [...new Set(value.summaries.filter(row => row.status === "failed").map(row => row.sourceId))];
};
