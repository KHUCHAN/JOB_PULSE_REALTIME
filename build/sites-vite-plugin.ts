import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { buildSitesMigrations } from "./sites-migrations";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export const sitesSchemaMigrationFiles = [
  "0000_cold_hellion.sql",
  "0026_abandoned_polaris.sql",
  "0028_omniscient_puma.sql",
  "0029_nice_korvac.sql",
  "0030_job_search_fts.sql",
  "0031_structured_job_filter_indexes.sql",
  "0032_job_search_performance.sql",
  "0033_case_insensitive_job_filters.sql",
  "0035_catalog_state.sql",
  "0037_ai_data_job_topics.sql",
  "0038_job_topic_backfill_index.sql",
  "0039_job_filter_options_cache.sql",
] as const;

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await buildSitesMigrations({
          sourceDirectory: drizzleSource,
          outputDirectory: resolve(outputDirectory, "drizzle"),
          schemaFiles: [...sitesSchemaMigrationFiles],
        });
      }
    },
  };
}
