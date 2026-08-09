CREATE INDEX `jobs_status_company_idx` ON `jobs` (`status`,`company`);--> statement-breakpoint
CREATE INDEX `jobs_status_arrangement_idx` ON `jobs` (`status`,`arrangement`);--> statement-breakpoint
CREATE INDEX `jobs_status_employment_type_idx` ON `jobs` (`status`,`employment_type`);--> statement-breakpoint
CREATE INDEX `jobs_status_published_at_idx` ON `jobs` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `jobs_location_country_state_city_idx` ON `jobs` (`location_country`,`location_state`,`location_city`);--> statement-breakpoint
CREATE INDEX `jobs_experience_level_idx` ON `jobs` (`experience_level`);--> statement-breakpoint
CREATE INDEX `jobs_salary_currency_min_max_idx` ON `jobs` (`salary_currency`,`salary_min`,`salary_max`);