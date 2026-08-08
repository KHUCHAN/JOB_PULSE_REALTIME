import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { publishCatalogArtifacts } from "./catalog-artifact-writer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "job-pulse-catalog-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "db/seed"), { recursive: true });
  await mkdir(join(root, "drizzle/meta"), { recursive: true });

  const paths = {
    migrationDir: join(root, "drizzle"),
    metaDir: join(root, "drizzle/meta"),
    seedJson: join(root, "db/seed/sources.json"),
    seedSql: join(root, "db/seed/sources.sql"),
    journal: join(root, "drizzle/meta/_journal.json"),
    snapshot: join(root, "drizzle/meta/0002_snapshot.json"),
    migration: join(root, "drizzle/0002_refresh_sources_test.sql"),
    lock: join(root, "db/seed/sources.sql.refresh.lock"),
  };
  await Promise.all([
    writeFile(paths.seedJson, "old-json"),
    writeFile(paths.seedSql, "old-sql"),
    writeFile(paths.journal, "old-journal"),
  ]);

  return paths;
};

describe("publishCatalogArtifacts", () => {
  it("rolls back a partial migration and succeeds when retried", async () => {
    const paths = await fixture();
    const input = {
      seedJson: { path: paths.seedJson, content: "new-json" },
      seedSql: { path: paths.seedSql, content: "new-sql" },
      journalGuard: { path: paths.journal, expectedContent: "old-journal" },
      reconciliation: { migrationDirectory: paths.migrationDir, metaDirectory: paths.metaDir, nextIndex: 2 },
      migration: {
        journal: { path: paths.journal, content: "new-journal" },
        snapshot: { path: paths.snapshot, content: "new-snapshot" },
        sql: { path: paths.migration, content: "new-migration" },
      },
    };

    await expect(publishCatalogArtifacts({
      ...input,
      afterStep: (step) => {
        if (step === "snapshot") throw new Error("simulated failure");
      },
    })).rejects.toThrow("simulated failure");

    await expect(readFile(paths.seedJson, "utf8")).resolves.toBe("old-json");
    await expect(readFile(paths.seedSql, "utf8")).resolves.toBe("old-sql");
    await expect(readFile(paths.journal, "utf8")).resolves.toBe("old-journal");
    await expect(readFile(paths.snapshot, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(paths.migration, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await publishCatalogArtifacts(input);

    await expect(readFile(paths.seedJson, "utf8")).resolves.toBe("new-json");
    await expect(readFile(paths.seedSql, "utf8")).resolves.toBe("new-sql");
    await expect(readFile(paths.journal, "utf8")).resolves.toBe("new-journal");
    await expect(readFile(paths.snapshot, "utf8")).resolves.toBe("new-snapshot");
    await expect(readFile(paths.migration, "utf8")).resolves.toBe("new-migration");
  });

  it("serializes concurrent refreshes and rejects a stale journal writer", async () => {
    const paths = await fixture();
    let releaseFirst!: () => void;
    let markSnapshotWritten!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const snapshotWritten = new Promise<void>((resolve) => { markSnapshotWritten = resolve; });
    const firstInput = {
      seedJson: { path: paths.seedJson, content: "winner-json" },
      seedSql: { path: paths.seedSql, content: "winner-sql" },
      journalGuard: { path: paths.journal, expectedContent: "old-journal" },
      reconciliation: { migrationDirectory: paths.migrationDir, metaDirectory: paths.metaDir, nextIndex: 2 },
      migration: {
        journal: { path: paths.journal, content: "winner-journal" },
        snapshot: { path: paths.snapshot, content: "winner-snapshot" },
        sql: { path: paths.migration, content: "winner-migration" },
      },
      afterStep: async (step: string) => {
        if (step !== "snapshot") return;
        markSnapshotWritten();
        await holdFirst;
      },
    };
    const staleInput = {
      seedJson: { path: paths.seedJson, content: "stale-json" },
      seedSql: { path: paths.seedSql, content: "stale-sql" },
      journalGuard: { path: paths.journal, expectedContent: "old-journal" },
      reconciliation: { migrationDirectory: paths.migrationDir, metaDirectory: paths.metaDir, nextIndex: 2 },
      migration: {
        journal: { path: paths.journal, content: "stale-journal" },
        snapshot: { path: paths.snapshot, content: "stale-snapshot" },
        sql: { path: paths.migration, content: "stale-migration" },
      },
    };

    const first = publishCatalogArtifacts(firstInput);
    await snapshotWritten;
    const stale = publishCatalogArtifacts(staleInput);
    await delay(30);
    releaseFirst();

    await first;
    await expect(stale).rejects.toThrow("Catalog journal changed while waiting for the refresh lock");
    await expect(readFile(paths.seedJson, "utf8")).resolves.toBe("winner-json");
    await expect(readFile(paths.seedSql, "utf8")).resolves.toBe("winner-sql");
    await expect(readFile(paths.journal, "utf8")).resolves.toBe("winner-journal");
    await expect(readFile(paths.snapshot, "utf8")).resolves.toBe("winner-snapshot");
    await expect(readFile(paths.migration, "utf8")).resolves.toBe("winner-migration");
  });

  it("recovers a dead process lock and removes only unjournaled next-index artifacts", async () => {
    const paths = await fixture();
    const orphanMigration = join(paths.migrationDir, "0002_refresh_sources_crashed.sql");
    await Promise.all([
      writeFile(paths.lock, JSON.stringify({ pid: 2_147_483_647, token: "dead-owner", createdAt: Date.now() - 60_000 })),
      writeFile(paths.snapshot, "orphan-snapshot"),
      writeFile(orphanMigration, "orphan-migration"),
    ]);

    await publishCatalogArtifacts({
      seedJson: { path: paths.seedJson, content: "recovered-json" },
      seedSql: { path: paths.seedSql, content: "recovered-sql" },
      journalGuard: { path: paths.journal, expectedContent: "old-journal" },
      reconciliation: { migrationDirectory: paths.migrationDir, metaDirectory: paths.metaDir, nextIndex: 2 },
      migration: {
        journal: { path: paths.journal, content: "recovered-journal" },
        snapshot: { path: paths.snapshot, content: "recovered-snapshot" },
        sql: { path: paths.migration, content: "recovered-migration" },
      },
    });

    await expect(readFile(paths.lock, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(orphanMigration, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(paths.snapshot, "utf8")).resolves.toBe("recovered-snapshot");
    await expect(readFile(paths.migration, "utf8")).resolves.toBe("recovered-migration");
    await expect(readFile(paths.journal, "utf8")).resolves.toBe("recovered-journal");
  });
});
