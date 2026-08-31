export type DrizzleJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type DrizzleJournal = {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
};

type PlanSeedMigrationInput = {
  journal: DrizzleJournal;
  catalogSqlHistory: string[];
  nextSql: string;
  now: Date;
};

export type SeedMigrationPlan = {
  fileName: string;
  journal: DrizzleJournal;
  snapshotIndex: number;
  previousSnapshotIndex: number;
};

type DrizzleSnapshot = {
  id: string;
  prevId: string;
  [key: string]: unknown;
};

const catalogVersion = (sql: string): string | null =>
  /^-- catalog-version: (\S+)$/m.exec(sql)?.[1] ?? null;

const comparableSql = (sql: string): string => catalogVersion(sql) ?? sql.trimEnd();

export function versionedCatalogSql(sql: string, version: string): string {
  return `-- catalog-version: ${version}\n${sql}`;
}

export function catalogDeltaSql(previousSql: string, nextSql: string, version: string): string {
  const previousInsertStatements = previousSql.split("\n").filter((line) => line.startsWith("INSERT INTO "));
  const nextInsertStatements = nextSql.split("\n").filter((line) => line.startsWith("INSERT INTO "));
  const previousStatements = new Set(previousInsertStatements);
  const changedStatements = nextInsertStatements
    .filter((line) => line.startsWith("INSERT INTO ") && !previousStatements.has(line));
  const talentTargetId = (statement: string): string | null =>
    /^INSERT INTO talent_targets \([^)]*\) VALUES \('([^']+)'/.exec(statement)?.[1] ?? null;
  const nextTalentTargetIds = new Set(nextInsertStatements.map(talentTargetId).filter((id): id is string => Boolean(id)));
  const removedTalentTargetIds = previousInsertStatements
    .map(talentTargetId)
    .filter((id): id is string => id !== null && !nextTalentTargetIds.has(id));
  const retireRemovedTalentTargets = removedTalentTargetIds.length === 0 ? [] : [
    `DELETE FROM talent_targets WHERE id IN (${removedTalentTargetIds.map((id) => `'${id.replaceAll("'", "''")}'`).join(", ")});`,
  ];
  const retireDisabledSourceData = changedStatements.length === 0 ? [] : [
    "UPDATE jobs SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE status = 'open' AND source_id IN (SELECT id FROM sources WHERE enabled = 0);",
    "UPDATE job_matches SET is_active = 0 WHERE is_active = 1 AND job_id IN (SELECT jobs.id FROM jobs JOIN sources ON sources.id = jobs.source_id WHERE sources.enabled = 0);",
  ];
  return `${versionedCatalogSql([...changedStatements, ...retireRemovedTalentTargets, ...retireDisabledSourceData].join("\n"), version).trimEnd()}\n`;
}

export function planSeedMigration({
  journal,
  catalogSqlHistory,
  nextSql,
  now,
}: PlanSeedMigrationInput): SeedMigrationPlan | null {
  if (catalogSqlHistory.length > 0 && comparableSql(catalogSqlHistory.at(-1)!) === comparableSql(nextSql)) {
    return null;
  }

  const previousEntry = journal.entries.at(-1);
  const nextIndex = Math.max(-1, ...journal.entries.map((entry) => entry.idx)) + 1;
  const previousSnapshotIndex = Math.max(
    -1,
    ...journal.entries.flatMap((entry) => {
      const match = /^(\d{4})_/.exec(entry.tag);
      return match ? [Number(match[1])] : [];
    }),
  );
  const snapshotIndex = previousSnapshotIndex + 1;
  const prefix = String(snapshotIndex).padStart(4, "0");
  const timestamp = now.toISOString().replaceAll(/[-:T]/g, "").replace(/\.\d{3}Z$/, "");
  const tag = `${prefix}_refresh_sources_${timestamp}`;
  const nextEntry: DrizzleJournalEntry = {
    idx: nextIndex,
    version: previousEntry?.version ?? "6",
    when: now.getTime(),
    tag,
    breakpoints: true,
  };

  return {
    fileName: `${tag}.sql`,
    journal: {
      ...journal,
      entries: [...journal.entries, nextEntry],
    },
    snapshotIndex,
    previousSnapshotIndex,
  };
}

export function advanceSeedSnapshot<T extends DrizzleSnapshot>(snapshot: T, id: string): T {
  return {
    ...snapshot,
    id,
    prevId: snapshot.id,
  };
}
