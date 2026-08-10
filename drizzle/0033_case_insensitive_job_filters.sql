CREATE INDEX `jobs_status_company_nocase_idx` ON `jobs` (`status`,"company" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `jobs_status_employment_type_nocase_idx` ON `jobs` (`status`,"employment_type" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `jobs_location_country_state_city_nocase_idx` ON `jobs` ("location_country" COLLATE NOCASE,"location_state" COLLATE NOCASE,"location_city" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `jobs_experience_level_nocase_idx` ON `jobs` ("experience_level" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `jobs_salary_currency_min_max_nocase_idx` ON `jobs` ("salary_currency" COLLATE NOCASE,`salary_min`,`salary_max`);