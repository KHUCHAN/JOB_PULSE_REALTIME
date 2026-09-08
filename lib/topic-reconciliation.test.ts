import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { obsoleteTopicMembershipsSql } from "./topic-reconciliation";

describe("snapshot-local topic reconciliation", () => {
  for (const namespace of ["area", "program", "year"] as const) {
    it(`${namespace}: removes obsolete memberships, not retained/manual/other-source rows`, () => {
      const db = new DatabaseSync(":memory:");
      try {
        db.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY, source_id TEXT, official_url TEXT,
          UNIQUE(source_id, official_url));
          CREATE TABLE job_topics(job_id TEXT, topic_key TEXT, PRIMARY KEY(job_id, topic_key));
          INSERT INTO jobs VALUES ('a','source','url-a'),('b','source','url-b'),('c','other','url-a');`);
        const insert = db.prepare("INSERT INTO job_topics VALUES (?,?)");
        for (const id of ["a", "b", "c"]) {
          for (const key of [`${namespace}:keep`, `${namespace}:obsolete`, "manual:keep", "ai-data"]) insert.run(id, key);
        }
        const input = JSON.stringify([
          { sourceId: "source", officialUrl: "url-a", topicKeys: [`${namespace}:keep`] },
          { sourceId: "source", officialUrl: "url-b", topicKeys: [] },
          { sourceId: "missing", officialUrl: "url-a", topicKeys: [] },
        ]);
        const statement = db.prepare(obsoleteTopicMembershipsSql(namespace));
        expect(statement.run({ "1": input }).changes).toBe(3);
        expect(statement.run({ "1": input }).changes).toBe(0);
        expect(db.prepare("SELECT topic_key FROM job_topics WHERE job_id='a' ORDER BY topic_key").all().map(r => r.topic_key))
          .toEqual(["ai-data", `${namespace}:keep`, "manual:keep"].sort());
        expect(db.prepare("SELECT count(*) AS n FROM job_topics WHERE job_id='c'").get()!.n).toBe(4);
      } finally { db.close(); }
    });
  }
});
