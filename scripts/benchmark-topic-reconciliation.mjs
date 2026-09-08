// Synthetic local SQLite benchmark. Never reads or mutates production.
import { DatabaseSync } from "node:sqlite";
import { obsoleteTopicMembershipsSql } from "../lib/topic-reconciliation.ts";
const before = "\n          DELETE FROM job_topics\n          WHERE topic_key LIKE 'area:%' AND job_id IN (\n            SELECT jobs.id\n            FROM json_each(?1)\n            JOIN jobs ON jobs.source_id = json_extract(value, '$.sourceId')\n                     AND jobs.official_url = json_extract(value, '$.officialUrl')\n          )\n          AND (job_id, topic_key) NOT IN (\n            SELECT jobs.id, topic.value\n            FROM json_each(?1) incoming\n            JOIN jobs ON jobs.source_id = json_extract(incoming.value, '$.sourceId')\n                     AND jobs.official_url = json_extract(incoming.value, '$.officialUrl')\n            JOIN json_each(incoming.value, '$.topicKeys') topic\n          )\n        ";
for (const size of [250, 1250]) {
 const db = new DatabaseSync(":memory:");
 db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,source_id TEXT,official_url TEXT,UNIQUE(source_id,official_url)); CREATE TABLE job_topics(job_id TEXT,topic_key TEXT,PRIMARY KEY(job_id,topic_key)); CREATE INDEX topic_key_idx ON job_topics(topic_key);");
 const job = db.prepare("INSERT INTO jobs VALUES (?,?,?)");
 const topic = db.prepare("INSERT INTO job_topics VALUES (?,?)");
 for(let i=0;i<30000;i++){ job.run("j"+i,"s","u"+i); topic.run("j"+i,"area:keep"); }
 const input = JSON.stringify(Array.from({length:size},(_,i)=>({sourceId:"s",officialUrl:"u"+i,topicKeys:["area:keep"]})));
 for(const obsolete of [false,true]) {
  for(const [label,sql] of [["before",before],["after",obsoleteTopicMembershipsSql("area")]]) {
   if(obsolete)for(let i=0;i<size;i++)topic.run("j"+i,"area:obsolete");
   const start = performance.now();
   const changes = db.prepare(sql).run({"1":input}).changes;
   console.log(JSON.stringify({label,size,obsolete,ms:performance.now()-start,changes,plan:db.prepare("EXPLAIN QUERY PLAN "+sql).all({"1":input}).map(r=>r.detail)}));
  }
 }
 db.close();
}
