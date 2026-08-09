import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSitesMigrations } from "./sites-migrations";

describe("Sites migration packaging", () => {
  it("keeps schema migrations and splits only the final catalog into bounded files", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-pulse-sites-"));
    const source = join(root, "source");
    const output = join(root, "output");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
    await writeFile(join(source, "0000_schema.sql"), "CREATE TABLE sources(id TEXT PRIMARY KEY);\n");
    await writeFile(join(source, "0026_rich.sql"), "ALTER TABLE sources ADD COLUMN company TEXT;\n");
    await writeFile(join(source, "0027_catalog.sql"), [
      "BEGIN;",
      "INSERT INTO sources VALUES ('a', '" + "x".repeat(40) + "');",
      "INSERT INTO sources VALUES ('b', '" + "y".repeat(40) + "');",
      "INSERT INTO sources VALUES ('c', '" + "z".repeat(40) + "');",
      "COMMIT;",
    ].join("\n"));

    await buildSitesMigrations({
      sourceDirectory: source,
      outputDirectory: output,
      schemaFiles: ["0000_schema.sql", "0026_rich.sql"],
      catalogFile: "0027_catalog.sql",
      maxBytes: 130,
    });

    const files = await readdir(output);
    expect(files.slice(0, 2)).toEqual(["0000_schema.sql", "0026_rich.sql"]);
    expect(files.some((file) => file.includes("catalog"))).toBe(true);
    for (const file of files) {
      const sql = await readFile(join(output, file), "utf8");
      expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(130);
    }
    expect((await Promise.all(files.map((file) => readFile(join(output, file), "utf8")))).join("\n"))
      .toContain("INSERT INTO sources VALUES ('c'");
  });
});
