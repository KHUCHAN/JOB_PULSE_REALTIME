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
CREATE INDEX `jobs_status_program_classified_id_idx` ON `jobs` (`status`,`program_classified_at`,`id`);--> statement-breakpoint
UPDATE jobs
SET employment_type = json_extract(employment_type, '$[0]')
WHERE json_valid(employment_type) AND json_type(employment_type) = 'array';--> statement-breakpoint
UPDATE jobs
SET employment_type = NULL
WHERE (
  upper(substr(trim(employment_type), 1, 1)) = 'R'
  AND substr(trim(employment_type), 2) <> ''
  AND substr(trim(employment_type), 2) NOT GLOB '*[^0-9]*'
) OR (
  upper(substr(trim(employment_type), 1, 2)) = 'JR'
  AND ltrim(substr(trim(employment_type), 3), '-_') <> ''
  AND ltrim(substr(trim(employment_type), 3), '-_') NOT GLOB '*[^0-9]*'
) OR (
  upper(substr(trim(employment_type), 1, 3)) = 'REQ'
  AND ltrim(substr(trim(employment_type), 4), '-_') <> ''
  AND ltrim(substr(trim(employment_type), 4), '-_') NOT GLOB '*[^0-9]*'
);--> statement-breakpoint
UPDATE jobs
SET employment_type = CASE
  WHEN lower(replace(replace(replace(replace(trim(employment_type), '_', ''), '-', ''), ' ', ''), '/', '')) LIKE '%fulltime%' THEN 'Full-time'
  WHEN lower(replace(replace(replace(replace(trim(employment_type), '_', ''), '-', ''), ' ', ''), '/', '')) LIKE '%parttime%' THEN 'Part-time'
  WHEN lower(replace(replace(replace(replace(trim(employment_type), '_', ''), '-', ''), ' ', ''), '/', '')) LIKE '%fixedterm%' THEN 'Fixed-term'
  ELSE CASE lower(replace(replace(replace(replace(trim(employment_type), '_', ''), '-', ''), ' ', ''), '/', ''))
  WHEN 'fulltime' THEN 'Full-time'
  WHEN 'fulltimeemployee' THEN 'Full-time'
  WHEN 'modifiedfulltime' THEN 'Full-time'
  WHEN 'parttime' THEN 'Part-time'
  WHEN 'temporary' THEN 'Temporary'
  WHEN 'temp' THEN 'Temporary'
  WHEN 'contractor' THEN 'Contractor'
  WHEN 'contract' THEN 'Contract'
  WHEN 'fixedtermcontract' THEN 'Contract'
  WHEN 'intern' THEN 'Internship'
  WHEN 'internship' THEN 'Internship'
  WHEN 'regular' THEN 'Regular'
  WHEN 'employeeregular' THEN 'Regular'
  WHEN 'employeeregularpermanent' THEN 'Regular'
  WHEN 'permanent' THEN 'Permanent'
  WHEN 'seasonal' THEN 'Seasonal'
  WHEN 'casual' THEN 'Casual'
  WHEN 'freelance' THEN 'Freelance'
  WHEN 'apprentice' THEN 'Apprenticeship'
  WHEN 'apprenticeship' THEN 'Apprenticeship'
  WHEN 'fixedterm' THEN 'Fixed-term'
  ELSE NULL
  END
END
WHERE employment_type IS NOT NULL;
