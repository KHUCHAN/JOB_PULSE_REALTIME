import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SitesMigrationOptions {
  sourceDirectory: string;
  outputDirectory: string;
  schemaFiles: string[];
  catalogFile: string;
  maxBytes?: number;
}

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

export async function buildSitesMigrations(options: SitesMigrationOptions): Promise<void> {
  const maxBytes = options.maxBytes ?? 500_000;
  await rm(options.outputDirectory, { recursive: true, force: true });
  await mkdir(options.outputDirectory, { recursive: true });

  for (const file of options.schemaFiles) {
    const source = join(options.sourceDirectory, file);
    const sql = await readFile(source, "utf8");
    if (byteLength(sql) > maxBytes) throw new Error(`Sites schema migration exceeds ${maxBytes} bytes: ${file}`);
    await cp(source, join(options.outputDirectory, file));
  }

  const catalog = await readFile(join(options.sourceDirectory, options.catalogFile), "utf8");
  const statements = catalog
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "BEGIN;" && line !== "COMMIT;");
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const statement of statements) {
    const candidate = `BEGIN;\n${[...current, statement].join("\n")}\nCOMMIT;\n`;
    if (byteLength(candidate) <= maxBytes) {
      current.push(statement);
      continue;
    }
    if (current.length === 0) throw new Error(`Single catalog statement exceeds ${maxBytes} bytes.`);
    chunks.push(current);
    current = [statement];
  }
  if (current.length) chunks.push(current);

  for (const [index, chunk] of chunks.entries()) {
    const file = `${String(100 + index).padStart(4, "0")}_sites_catalog_${String(index + 1).padStart(3, "0")}.sql`;
    const sql = `BEGIN;\n${chunk.join("\n")}\nCOMMIT;\n`;
    if (byteLength(sql) > maxBytes) throw new Error(`Generated Sites migration exceeds ${maxBytes} bytes: ${file}`);
    await writeFile(join(options.outputDirectory, file), sql);
  }

  const written = await readdir(options.outputDirectory);
  if (written.length !== options.schemaFiles.length + chunks.length) {
    throw new Error("Sites migration package is incomplete.");
  }
}
