ALTER TABLE `matches` ADD `cancelled_at` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `cancelled_by` text;
--> statement-breakpoint
CREATE INDEX `idx_matches_tournament_status` ON `matches` (`tournament_id`,`status`);
--> statement-breakpoint
PRAGMA optimize;
