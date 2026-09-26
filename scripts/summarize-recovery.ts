import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { failedRecoveryIds, type RecoveryHandoff } from "../lib/recovery-policy.ts";
import { browserRecoverySummary, type BrowserFallbackResult } from "./browser-fallback-crawl.ts";

export function summarizeRecovery(request: unknown, ripplematch: unknown, browser: unknown, audit: unknown) {
  // Missing/truncated evidence must fail, not silently become zero failures.
  const failed = new Set([...failedRecoveryIds(request), ...failedRecoveryIds(ripplematch)]);
  const evidence = browser as { completed?: boolean; results?: BrowserFallbackResult[] };
  const coverage = audit as { sources?: Array<{ id?: string; error?: string; collectionStatus?: string }> };
  if (evidence?.completed !== true || !Array.isArray(evidence.results)
    || evidence.results.some(r => !r?.source?.id || !Array.isArray(r.jobs)
      || !(r.error === null || typeof r.error === "string")
      || !(r.status === null || typeof r.status === "number")))
    throw Error("Browser recovery evidence is missing, incomplete, or malformed.");
  if (!Array.isArray(coverage?.sources) || !coverage.sources.length)
    throw Error("Critical DB coverage evidence is missing or malformed.");
  const summary = browserRecoverySummary(evidence.results);
  const browserFailed = new Set(summary.unresolved.map(r => r.sourceId));
  const recovered = new Set(evidence.results.filter(r => !browserFailed.has(r.source.id)).map(r => r.source.id));
  const recoveredAfterRequestFailure = [...failed].filter(id => recovered.has(id));
  for (const id of recovered) failed.delete(id);
  for (const id of browserFailed) failed.add(id);
  const auditErrors = coverage.sources.filter(r => r.error || (r.collectionStatus !== "succeeded" && !recovered.has(r.id ?? "")));
  const requestRows = [request, ripplematch].flatMap(r => (r as RecoveryHandoff).summaries);
  // The owner run fails only when the pipeline itself broke: missing evidence
  // (thrown above), recovered jobs whose write failed in transport or D1, or
  // a critical employer the raw DB audit still sees as uncollected. Long-tail
  // bot walls, parser misses, a server policy rejection (ingest_rejected) and
  // a missed failure-status write are reported, not fatal. Failing on them
  // kept every run red for weeks and hid the outages that did matter.
  const persistenceFailed = summary.unresolved.some(r => r.code === "ingest_error" && r.jobs > 0);
  return {
    status: persistenceFailed || auditErrors.length ? "partial_failure" : failed.size ? "degraded" : "succeeded",
    attemptedSources: new Set([...requestRows.map(r => r.sourceId), ...evidence.results.map(r => r.source.id)]).size,
    unresolvedSourceIds: [...failed].sort(), recoveredAfterRequestFailure,
    authoritativeEmpty: summary.authoritativeEmpty,
    browserFailures: summary.unresolved, auditErrors,
  };
}

async function main() {
  const paths = ["output/request-recovery/results.json", "output/request-recovery/ripplematch.json",
    "output/playwright/browser-fallback/results.json", "output/request-recovery/alert-coverage.json"];
  const [request, ripplematch, browser, audit] = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, "utf8"))));
  const report = summarizeRecovery(request, ripplematch, browser, audit);
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const safe = (value: string) => value.replace(/[|\r\n<>]/g, " ");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Recovery outcome (separate from the main drain)", "",
      `- Result: ${report.status}${report.status === "degraded" ? " (company-level misses are reported, not fatal)" : ""}`,
      `- Unresolved companies: ${report.unresolvedSourceIds.length}`,
      `- Request failures recovered by browser: ${report.recoveredAfterRequestFailure.length}`,
      `- Verified empty catalogs (not failures): ${report.authoritativeEmpty.length}`, "",
      "| Company | Failure | Evidence |", "|---|---|---|",
      ...report.browserFailures.map(r => `| ${safe(r.company)} | ${r.code} | ${safe(r.error ?? `HTTP ${r.responseStatus}`)} |`),
      "", "Request/DB audit failures are retained in the JSON report above.", "",
    ].join("\n"));
  }
  if (report.status === "degraded") {
    console.log(`::warning title=Unresolved companies::${report.unresolvedSourceIds.length} companies still unresolved after recovery: ${report.unresolvedSourceIds.join(", ")}`);
  }
  if (report.status === "partial_failure") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error); process.exitCode = 1; });
