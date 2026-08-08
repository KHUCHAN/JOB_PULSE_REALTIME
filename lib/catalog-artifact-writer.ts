import { randomUUID } from "node:crypto";
import { link, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type Artifact = {
  path: string;
  content: string;
};

export type CatalogArtifactStep = "snapshot" | "migration" | "journal" | "seed-json" | "seed-sql";

type PublishCatalogArtifactsInput = {
  seedJson: Artifact;
  seedSql: Artifact;
  journalGuard?: {
    path: string;
    expectedContent: string;
  };
  reconciliation?: {
    migrationDirectory: string;
    metaDirectory: string;
    nextIndex: number;
  };
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

type RefreshLockOwner = {
  pid: number;
  token: string;
  createdAt: number;
};

const parseLockOwner = (content: string | null): RefreshLockOwner | null => {
  if (!content) return null;
  try {
    const value = JSON.parse(content) as Partial<RefreshLockOwner>;
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.token !== "string" || typeof value.createdAt !== "number") return null;
    return value as RefreshLockOwner;
  } catch {
    return null;
  }
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EINVAL";
  }
};

const lockIsStale = async (path: string, content: string): Promise<boolean> => {
  const owner = parseLockOwner(content);
  if (owner) return !processIsAlive(owner.pid);
  try {
    return Date.now() - (await stat(path)).mtimeMs > 30_000;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
};

const finishClaimedRecovery = async (path: string, recoveryPath: string): Promise<boolean> => {
  const claimedContent = await readOptional(recoveryPath);
  if (claimedContent === null) return true;
  if (!await lockIsStale(recoveryPath, claimedContent)) {
    await unlinkOptional(recoveryPath);
    return false;
  }

  try {
    const [current, claimed] = await Promise.all([stat(path), stat(recoveryPath)]);
    if (current.dev === claimed.dev && current.ino === claimed.ino) await unlinkOptional(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await unlinkOptional(recoveryPath);
  return true;
};

const recoverStaleLock = async (path: string, recoveryPath: string): Promise<boolean> => {
  if (await readOptional(recoveryPath) !== null) {
    return finishClaimedRecovery(path, recoveryPath);
  }

  const observedContent = await readOptional(path);
  if (observedContent === null) return true;
  if (!await lockIsStale(path, observedContent)) return false;

  try {
    await link(path, recoveryPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return true;
    if (code === "EEXIST") return finishClaimedRecovery(path, recoveryPath);
    throw error;
  }

  if (await readOptional(recoveryPath) !== observedContent) {
    await unlinkOptional(recoveryPath);
    return false;
  }
  return finishClaimedRecovery(path, recoveryPath);
};

const acquireRefreshLock = async (path: string): Promise<() => Promise<void>> => {
  const deadline = Date.now() + 30_000;
  const recoveryPath = `${path}.recovering`;

  while (true) {
    if (await readOptional(recoveryPath) !== null) {
      await finishClaimedRecovery(path, recoveryPath);
      await delay(25);
      continue;
    }
    try {
      const handle = await open(path, "wx");
      const owner: RefreshLockOwner = { pid: process.pid, token: randomUUID(), createdAt: Date.now() };
      const ownerContent = JSON.stringify(owner);
      try {
        await handle.writeFile(ownerContent);
      } catch (error) {
        await handle.close();
        await unlinkOptional(path);
        throw error;
      }

      return async () => {
        await handle.close();
        if (await readOptional(path) === ownerContent) await unlinkOptional(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await recoverStaleLock(path, recoveryPath)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for catalog refresh lock: ${path}`);
      await delay(25);
    }
  }
};

const reconcileUnjournaledArtifacts = async ({
  migrationDirectory,
  metaDirectory,
  nextIndex,
}: NonNullable<PublishCatalogArtifactsInput["reconciliation"]>): Promise<void> => {
  const prefix = `${String(nextIndex).padStart(4, "0")}_refresh_sources_`;
  const orphanMigrations = (await readdir(migrationDirectory))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sql"));

  await Promise.all([
    ...orphanMigrations.map((name) => unlinkOptional(join(migrationDirectory, name))),
    unlinkOptional(join(metaDirectory, `${String(nextIndex).padStart(4, "0")}_snapshot.json`)),
  ]);
};

const replaceAtomically = async (artifact: Artifact): Promise<void> => {
  const stagedPath = temporaryPath(artifact.path);
  try {
    await writeFile(stagedPath, artifact.content, { flag: "wx" });
    await rename(stagedPath, artifact.path);
  } finally {
    await unlinkOptional(stagedPath);
  }
};

async function publishCatalogArtifactsUnlocked({
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
  const published = new Set<string>();

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
      published.add(artifact.path);
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

    for (const { artifact } of replacements.reverse().filter(({ artifact }) => published.has(artifact.path))) {
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

export async function publishCatalogArtifacts(input: PublishCatalogArtifactsInput): Promise<void> {
  const releaseLock = await acquireRefreshLock(`${input.seedSql.path}.refresh.lock`);
  try {
    if (input.journalGuard) {
      const currentJournal = await readOptional(input.journalGuard.path);
      if (currentJournal !== input.journalGuard.expectedContent) {
        throw new Error("Catalog journal changed while waiting for the refresh lock; rerun the refresh command.");
      }
    }
    if (input.reconciliation) await reconcileUnjournaledArtifacts(input.reconciliation);
    await publishCatalogArtifactsUnlocked(input);
  } finally {
    await releaseLock();
  }
}
