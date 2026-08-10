ALTER TABLE `tournament_entries` ADD `points_balance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `tournament_entries`
SET `points_balance` = COALESCE(
	(
		SELECT SUM(`amount`)
		FROM `point_ledger`
		WHERE `point_ledger`.`tournament_id` = `tournament_entries`.`tournament_id`
			AND `point_ledger`.`user_id` = `tournament_entries`.`user_id`
	),
	`starter_points_awarded`
);--> statement-breakpoint
CREATE INDEX `idx_entries_tournament_balance` ON `tournament_entries` (`tournament_id`,`points_balance`);--> statement-breakpoint
CREATE INDEX `idx_ledger_tournament_user_created` ON `point_ledger` (`tournament_id`,`user_id`,`created_at`);--> statement-breakpoint
DELETE FROM `point_ledger`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `bets`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `tournament_entries`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `audit_logs`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `players`
WHERE `team_id` IN (
	SELECT `teams`.`id` FROM `teams`
	INNER JOIN `tournaments` ON `tournaments`.`id` = `teams`.`tournament_id`
	WHERE `tournaments`.`created_by` = 'system'
		AND `tournaments`.`name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `matches`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `teams`
WHERE `tournament_id` IN (
	SELECT `id` FROM `tournaments`
	WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵'
);--> statement-breakpoint
DELETE FROM `tournaments`
WHERE `created_by` = 'system' AND `name` = '2026 서머 소환사의 컵';
