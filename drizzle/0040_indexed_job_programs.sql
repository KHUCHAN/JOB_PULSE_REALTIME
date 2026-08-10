CREATE TABLE `job_programs` (
	`job_id` text NOT NULL,
	`program_key` text NOT NULL,
	`evidence` text NOT NULL,
	`classified_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `program_key`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_programs_program_job_idx` ON `job_programs` (`program_key`,`job_id`);--> statement-breakpoint
CREATE INDEX `job_programs_job_program_idx` ON `job_programs` (`job_id`,`program_key`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `program_classified_at` text;--> statement-breakpoint
CREATE INDEX `jobs_status_program_classified_id_idx` ON `jobs` (`status`,`program_classified_at`,`id`);
