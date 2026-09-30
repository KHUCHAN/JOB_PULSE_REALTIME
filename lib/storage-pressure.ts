/** Infrastructure pressure, not an employer's 403/429 or parsing failure. */
export function isStoragePressure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /D1_ERROR|D1 DB|database is locked|SQLITE_BUSY|storage operation exceeded|too many subrequests/i.test(message);
}
