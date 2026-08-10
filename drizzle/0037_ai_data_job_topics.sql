CREATE TABLE `job_topics` (
	`job_id` text NOT NULL,
	`topic_key` text NOT NULL,
	`score` integer NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`classified_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `topic_key`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_topics_topic_job_idx` ON `job_topics` (`topic_key`,`job_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `topic_classified_at` text;