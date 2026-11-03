// Handshake and LinkedIn rows mailed without entering the DB. They are shown apart from verified jobs.
export interface PlatformLead {
  platform: "Handshake" | "LinkedIn";
  company: string;
  title: string;
  location: string;
  firstSeen: string;
  url: string;
}

export const MAX_PLATFORM_LEADS = 20;

const PLATFORM_HOSTS: Record<PlatformLead["platform"], RegExp> = {
  Handshake: /^([a-z0-9-]+\.)?joinhandshake\.com$/,
  LinkedIn: /^([a-z0-9-]+\.)?linkedin\.com$/,
};

const text = (value: unknown, limit: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";

export const normalizePlatformLeads = (value: unknown): PlatformLead[] => {
  if (!Array.isArray(value)) return [];
  const leads: PlatformLead[] = [];
  for (const raw of value.slice(0, MAX_PLATFORM_LEADS)) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const platform = row.platform === "Handshake" || row.platform === "LinkedIn" ? row.platform : null;
    const company = text(row.company, 200);
    const title = text(row.title, 300);
    const firstSeen = text(row.firstSeen, 10);
    if (!platform || !company || !title || !/^\d{4}-\d{2}-\d{2}$/.test(firstSeen)) continue;
    let url: URL;
    try {
      url = new URL(text(row.url, 1000));
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !PLATFORM_HOSTS[platform].test(url.hostname)) continue;
    leads.push({ platform, company, title, location: text(row.location, 200), firstSeen, url: url.toString() });
  }
  return leads;
};
