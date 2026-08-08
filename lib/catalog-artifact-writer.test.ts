import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    seedJson: join(root, "db/seed/sources.json"),
    seedSql: join(root, "db/seed/sources.sql"),
    journal: join(root, "drizzle/meta/_journal.json"),
    snapshot: join(root, "drizzle/meta/0002_snapshot.json"),
    migration: join(root, "drizzle/0002_refresh_sources_test.sql"),
  };
  const { writeFile } = await import("node:fs/promises");
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
});
