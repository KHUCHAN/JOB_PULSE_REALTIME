import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("extracts the multi-directory recovery artifact at the paths consumed by both readers", () => {
  const workflow = readFileSync(".github/workflows/production-crawl.yml", "utf8");
  const upload = workflow.split("name: request-recovery-results")[1].split("if-no-files-found:")[0];
  const patterns = [...upload.matchAll(/^\s+(output\/\S+)$/gm)].map(m => m[1]);
  expect(patterns.length).toBeGreaterThan(1);
  // upload-artifact preserves paths relative to the least common ancestor
  // before the first wildcard; adding platform-discovery moved that ancestor.
  let root = path.dirname(patterns[0]);
  while (patterns.some(p => !p.startsWith(root + "/"))) root = path.dirname(root);
  const download = workflow.split("name: request-recovery-results")[2].match(/path: (\S+)/)![1];
  for (const file of ["results.json", "ripplematch.json", "alert-coverage.json"]) {
    const required = "output/request-recovery/" + file;
    expect(path.join(download, path.relative(root, required))).toBe(required);
  }
});
