ALTER TABLE `jobs` ADD `location_region` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `area_classified_at` text;--> statement-breakpoint
CREATE INDEX `jobs_status_location_region_seen_idx` ON `jobs` (`status`,`location_region`,`first_seen_at`);