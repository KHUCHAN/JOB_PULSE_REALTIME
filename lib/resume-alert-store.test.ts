import { describe, expect, it } from "vitest";
import { planResumeDigests } from "./resume-alert-store";
import { alertDatabaseWithMatches, createD1ForSqlite } from "./resume-alert-test-helper";

describe("resume digest reservation", () => {
  it("reserves one item per recipient and never duplicates a sent pair", async () => {
    const sqlite = alertDatabaseWithMatches(2);
    const db = createD1ForSqlite(sqlite);

    const first = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);
    const second = await planResumeDigests(db, "chanyoung-resume", "2026-08-10T12:00:00.000Z", 25);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) AS total FROM notification_items").get()).toEqual({ total: 4 });
  });
});
