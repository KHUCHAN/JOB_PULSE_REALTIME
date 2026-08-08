import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

type Artifact = {
  path: string;
  content: string;
};

export type CatalogArtifactStep = "snapshot" | "migration" | "journal" | "seed-json" | "seed-sql";

type PublishCatalogArtifactsInput = {
  seedJson: Artifact;
  seedSql: Artifact;
  migration?: {
    journal: Artifact;
    snapshot: Artifact;
    sql: Artifact;
  };
  afterStep?: (step: CatalogArtifactStep) => void | Promise<void>;
};

const readOptional = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const unlinkOptional = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const temporaryPath = (path: string): string => `${path}.catalog-${randomUUID()}.tmp`;

const replaceAtomically = async (artifact: Artifact): Promise<void> => {
  const stagedPath = temporaryPath(artifact.path);
  try {
    await writeFile(stagedPath, artifact.content, { flag: "wx" });
    await rename(stagedPath, artifact.path);
  } finally {
    await unlinkOptional(stagedPath);
  }
};

export async function publishCatalogArtifacts({
  seedJson,
  seedSql,
  migration,
  afterStep,
}: PublishCatalogArtifactsInput): Promise<void> {
  const replacements = [
    ...(migration ? [{ artifact: migration.journal, step: "journal" as const }] : []),
    { artifact: seedJson, step: "seed-json" as const },
    { artifact: seedSql, step: "seed-sql" as const },
  ];
  const originals = new Map<string, string | null>();
  const staged = new Map<string, string>();
  const created: string[] = [];

  for (const { artifact } of replacements) {
    originals.set(artifact.path, await readOptional(artifact.path));
  }

  try {
    for (const { artifact } of replacements) {
      const stagedPath = temporaryPath(artifact.path);
      await writeFile(stagedPath, artifact.content, { flag: "wx" });
      staged.set(artifact.path, stagedPath);
    }

    if (migration) {
      await writeFile(migration.snapshot.path, migration.snapshot.content, { flag: "wx" });
      created.push(migration.snapshot.path);
      await afterStep?.("snapshot");

      await writeFile(migration.sql.path, migration.sql.content, { flag: "wx" });
      created.push(migration.sql.path);
      await afterStep?.("migration");
    }

    for (const { artifact, step } of replacements) {
      await rename(staged.get(artifact.path)!, artifact.path);
      staged.delete(artifact.path);
      await afterStep?.(step);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];

    for (const path of created.reverse()) {
      try {
        await unlinkOptional(path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    for (const { artifact } of replacements.reverse()) {
      try {
        const original = originals.get(artifact.path);
        if (original === null) await unlinkOptional(artifact.path);
        else if (original !== undefined) await replaceAtomically({ path: artifact.path, content: original });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], "Catalog artifact publish failed and rollback was incomplete.");
    }
    throw error;
  } finally {
    await Promise.all([...staged.values()].map(unlinkOptional));
  }
}
