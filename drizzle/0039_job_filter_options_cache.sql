CREATE TABLE `job_filter_options_cache` (
	`filter_key` text NOT NULL,
	`normalized_value` text NOT NULL,
	`value_label` text NOT NULL,
	`job_count` integer NOT NULL,
	`refreshed_at` text NOT NULL,
	PRIMARY KEY(`filter_key`, `normalized_value`)
);
