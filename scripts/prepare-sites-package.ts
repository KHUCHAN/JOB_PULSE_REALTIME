import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("Pass a new output directory for the Sites package staging tree.");

const outputRoot = resolve(outputArgument);
await mkdir(outputRoot);
await cp(resolve(projectRoot, "dist"), resolve(outputRoot, "dist"), { recursive: true });
await cp(resolve(projectRoot, ".openai"), resolve(outputRoot, ".openai"), { recursive: true });

const drizzleDirectory = resolve(outputRoot, "dist", ".openai", "drizzle");
const migrations = (await readdir(drizzleDirectory)).filter((name) => name.endsWith(".sql"));
for (const required of ["0143_retention_deployment_repair.sql", "0144_job_fts_changed_content.sql"]) {
  if (!migrations.includes(required)) throw new Error(`Sites package is missing required migration: ${required}`);
}
const catalogMigrations = migrations.filter((name) =>
  name === "0001_seed_sources.sql" || /^\d{4}_refresh_sources_.+\.sql$/.test(name));
if (catalogMigrations.length > 0) {
  throw new Error(`Sites build unexpectedly contains catalog data migrations: ${catalogMigrations.join(", ")}`);
}

process.stdout.write(`Prepared Sites staging tree with ${migrations.length} bounded schema migrations.\n`);
