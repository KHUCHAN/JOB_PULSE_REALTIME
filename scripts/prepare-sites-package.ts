import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("Pass a new output directory for the Sites package staging tree.");

const outputRoot = resolve(outputArgument);
await mkdir(outputRoot);
await cp(resolve(projectRoot, "dist"), resolve(outputRoot, "dist"), { recursive: true });
await cp(resolve(projectRoot, ".openai"), resolve(outputRoot, ".openai"), { recursive: true });
await cp(resolve(projectRoot, "drizzle"), resolve(outputRoot, "drizzle"), { recursive: true });

const drizzleDirectory = resolve(outputRoot, "drizzle");
const catalogMigrations = (await readdir(drizzleDirectory))
  .filter((name) => /^\d{4}_refresh_sources_.+\.sql$/.test(name));
for (const file of catalogMigrations) {
  await writeFile(
    resolve(drizzleDirectory, file),
    "-- Sites applies the versioned catalog through bounded runtime synchronization.\nSELECT 1;\n",
  );
}

process.stdout.write(`Prepared Sites staging tree with ${catalogMigrations.length} runtime-synced catalog migrations.\n`);
