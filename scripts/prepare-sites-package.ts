import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("Pass a new output directory for the Sites package staging tree.");

const outputRoot = resolve(outputArgument);
await mkdir(outputRoot);
await cp(resolve(projectRoot, "dist"), resolve(outputRoot, "dist"), { recursive: true });
await cp(resolve(projectRoot, ".openai"), resolve(outputRoot, ".openai"), { recursive: true });

const drizzleDirectory = resolve(outputRoot, "dist", ".openai", "drizzle");
const migrations = (await readdir(drizzleDirectory)).filter((name) => name.endsWith(".sql"));
for (const superseded of ["0140_job_retention_archive.sql", "0141_job_retention_index.sql", "0142_job_identifier_search.sql"]) {
  if (migrations.includes(superseded)) throw new Error(`Sites package contains superseded partial-rollout DDL: ${superseded}`);
}
for (const required of ["0143_retention_deployment_repair.sql", "0144_job_fts_changed_content.sql", "0145_crawl_snapshot_hash.sql"]) {
  if (!migrations.includes(required)) throw new Error(`Sites package is missing required migration: ${required}`);
}
const catalogMigrations = migrations.filter((name) =>
  name === "0001_seed_sources.sql" || /^\d{4}_refresh_sources_.+\.sql$/.test(name));
if (catalogMigrations.length > 0) {
  throw new Error(`Sites build unexpectedly contains catalog data migrations: ${catalogMigrations.join(", ")}`);
}

process.stdout.write(`Prepared Sites staging tree with ${migrations.length} bounded schema migrations.\n`);

// The generic helper overlays PROJECT_DIR/drizzle on the built migrations.
// Always give it this isolated staging tree, never the checkout with historical
// catalog DDL. Optional arguments provide a single safe packaging entry point.
const [helperPath, archivePath] = process.argv.slice(3);
if (helperPath || archivePath) {
  if (!helperPath || !archivePath) throw new Error("Pass both the Sites package helper and archive path.");
  execFileSync("bash", [resolve(helperPath), outputRoot, resolve(archivePath)], { stdio: "inherit" });
  const entries = execFileSync("tar", ["-tzf", resolve(archivePath)], { encoding: "utf8" }).split("\n");
  const archivedMigrations = entries.filter(name => /^dist\/\.openai\/drizzle\/[^/]+\.sql$/.test(name))
    .map(name => name.slice("dist/.openai/drizzle/".length)).sort();
  if (JSON.stringify(archivedMigrations) !== JSON.stringify([...migrations].sort())) {
    throw new Error("Packaged migration set differs from the validated build.");
  }
}
