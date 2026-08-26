INSERT INTO `profile_recipients` (`profile_id`, `recipient`, `enabled`)
VALUES
	('chanyoung-resume', 'xinjiaz@usc.edu', 1),
	('chanyoung-resume', 'skazimi@usc.edu', 1)
ON CONFLICT (`profile_id`, `recipient`) DO UPDATE SET
	`enabled` = 1,
	`updated_at` = CURRENT_TIMESTAMP;
