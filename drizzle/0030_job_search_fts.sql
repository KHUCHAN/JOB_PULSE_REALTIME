CREATE VIRTUAL TABLE jobs_fts USING fts5(
  title,
  company,
  location,
  summary,
  description,
  content='jobs',
  content_rowid='rowid'
);
--> statement-breakpoint
INSERT INTO jobs_fts(jobs_fts) VALUES('rebuild');
--> statement-breakpoint
CREATE TRIGGER jobs_fts_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(rowid, title, company, location, summary, description)
  VALUES (new.rowid, new.title, new.company, new.location, new.summary, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER jobs_fts_delete AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, location, summary, description)
  VALUES ('delete', old.rowid, old.title, old.company, old.location, old.summary, old.description);
END;
--> statement-breakpoint
CREATE TRIGGER jobs_fts_update AFTER UPDATE OF title, company, location, summary, description ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, title, company, location, summary, description)
  VALUES ('delete', old.rowid, old.title, old.company, old.location, old.summary, old.description);
  INSERT INTO jobs_fts(rowid, title, company, location, summary, description)
  VALUES (new.rowid, new.title, new.company, new.location, new.summary, new.description);
END;
