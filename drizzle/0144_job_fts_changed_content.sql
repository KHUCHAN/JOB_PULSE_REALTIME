-- A crawl upsert names all search columns even when their values are unchanged.
-- UPDATE OF alone therefore re-tokenized every confirmed posting. Preserve
-- insert/delete behavior and update only when indexed content actually differs.
DROP TRIGGER IF EXISTS jobs_fts_update;
--> statement-breakpoint
CREATE TRIGGER jobs_fts_update AFTER UPDATE OF title, company, location, summary, description ON jobs
WHEN old.title IS NOT new.title
  OR old.company IS NOT new.company
  OR old.location IS NOT new.location
  OR old.summary IS NOT new.summary
  OR old.description IS NOT new.description
BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, location, summary, description)
  VALUES ('delete', old.rowid, old.title, old.company, old.location, old.summary, old.description);
  INSERT INTO jobs_fts(rowid, title, company, location, summary, description)
  VALUES (new.rowid, new.title, new.company, new.location, new.summary, new.description);
END;
