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

const comparableSql = (sql: string) => sql.trimEnd();

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
