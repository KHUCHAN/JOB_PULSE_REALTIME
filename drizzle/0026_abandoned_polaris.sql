CREATE TABLE `source_facets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`facet_key` text NOT NULL,
	`facet_label` text NOT NULL,
	`value_key` text NOT NULL,
	`value_label` text NOT NULL,
	`job_count` integer,
	`observed_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_facets_source_key_value_unique` ON `source_facets` (`source_id`,`facet_key`,`value_key`);--> statement-breakpoint
CREATE INDEX `source_facets_source_key_idx` ON `source_facets` (`source_id`,`facet_key`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `description` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `responsibilities` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `qualifications` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `skills` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `department` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `team` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `business_unit` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `job_family` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `job_function` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `office` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `secondary_locations` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_city` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_state` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_country` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `location_postal_code` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `salary_min` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `salary_max` real;--> statement-breakpoint
ALTER TABLE `jobs` ADD `salary_currency` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `salary_interval` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `benefits` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `education_requirements` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `experience_requirements` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `experience_level` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `shift_schedule` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `travel_requirements` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `security_clearance` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `languages` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `requisition_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `apply_url` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_posted_text` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_updated_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `valid_through` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `raw_payload` text;