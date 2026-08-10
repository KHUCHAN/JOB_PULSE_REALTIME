import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export type AiDataTopicAuditRow = {
  id: string;
  company: string;
  title: string;
  officialUrl: string;
  score: number;
  evidence: string[];
};

export type AiDataTopicAuditReport = {
  openTotal: number;
  matchedOpen: number;
  coveragePercent: number;
  evidenceGroups: Array<{ evidence: string; count: number }>;
  knownTitleMisses: string[];
  sample: AiDataTopicAuditRow[];
};

const normalized = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

export function buildAiDataTopicAudit({
  openTotal,
  rows,
  knownTitles = [],
  sampleLimit = 100,
}: {
  openTotal: number;
  rows: AiDataTopicAuditRow[];
  knownTitles?: string[];
  sampleLimit?: number;
}): AiDataTopicAuditReport {
  const orderedRows = [...rows].sort((left, right) =>
    left.company.localeCompare(right.company)
    || left.title.localeCompare(right.title)
    || left.officialUrl.localeCompare(right.officialUrl)
    || left.id.localeCompare(right.id),
  );
  const evidenceCounts = new Map<string, number>();
  for (const row of rows) {
    for (const evidence of new Set(row.evidence)) {
      evidenceCounts.set(evidence, (evidenceCounts.get(evidence) ?? 0) + 1);
    }
  }
  const presentTitles = new Set(rows.map((row) => normalized(row.title)));
  const matchedOpen = rows.length;
  return {
    openTotal,
    matchedOpen,
    coveragePercent: openTotal > 0 ? Math.round((matchedOpen / openTotal) * 10_000) / 100 : 0,
    evidenceGroups: [...evidenceCounts].map(([evidence, count]) => ({ evidence, count }))
      .sort((left, right) => right.count - left.count || left.evidence.localeCompare(right.evidence)),
    knownTitleMisses: knownTitles.filter((title) => !presentTitles.has(normalized(title))).sort(),
    sample: orderedRows.slice(0, Math.max(0, Math.min(100, Math.trunc(sampleLimit)))),
  };
}

export function assertAiDataTopicAudit(report: AiDataTopicAuditReport): void {
  if (report.knownTitleMisses.length > 0) {
    throw new Error(`Known AI/data titles missing: ${report.knownTitleMisses.join(", ")}`);
  }
}

const parseEvidence = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

function main(): void {
  const databasePath = process.argv[2];
  if (!databasePath) {
    throw new Error("Usage: npm run jobs:topic:audit -- /absolute/path/to/job-pulse.sqlite");
  }
  const sqlite = new DatabaseSync(databasePath, { readOnly: true });
  const openTotal = Number((sqlite.prepare("SELECT count(*) AS count FROM jobs WHERE status = 'open'").get() as { count: number }).count);
  const rows = sqlite.prepare(`
    SELECT j.id, j.company, j.title, j.official_url AS officialUrl,
           jt.score, jt.evidence
    FROM job_topics jt JOIN jobs j ON j.id = jt.job_id
    WHERE jt.topic_key = 'ai-data' AND j.status = 'open'
    ORDER BY j.company COLLATE NOCASE, j.title COLLATE NOCASE, j.official_url, j.id
  `).all() as Array<Omit<AiDataTopicAuditRow, "evidence"> & { evidence: string }>;
  const knownTitles = process.env.JOB_PULSE_KNOWN_AI_DATA_TITLES
    ? JSON.parse(process.env.JOB_PULSE_KNOWN_AI_DATA_TITLES) as string[]
    : [];
  const report = buildAiDataTopicAudit({
    openTotal,
    rows: rows.map((row) => ({ ...row, evidence: parseEvidence(row.evidence) })),
    knownTitles,
  });
  assertAiDataTopicAudit(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  sqlite.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
