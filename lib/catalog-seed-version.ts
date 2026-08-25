import { createHash } from "node:crypto";

// Include runtime synchronization semantics in the deployed seed marker. A
// catalog row can stay byte-for-byte identical while the bounded Sites sync
// gains a required cleanup. Bump this value whenever that behavior changes.
export const CATALOG_RUNTIME_SYNC_VERSION = 3;

export function catalogSeedVersion(
  sources: readonly unknown[],
  talentTargets: readonly unknown[],
): string {
  const content = JSON.stringify({
    runtimeSyncVersion: CATALOG_RUNTIME_SYNC_VERSION,
    sources,
    talentTargets,
  });
  return `v2:sha256:${createHash("sha256").update(content).digest("hex")}`;
}
