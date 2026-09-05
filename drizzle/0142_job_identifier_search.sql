CREATE INDEX `jobs_requisition_id_nocase_idx` ON `jobs` ("requisition_id" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `jobs_external_id_nocase_idx` ON `jobs` ("external_id" COLLATE NOCASE);