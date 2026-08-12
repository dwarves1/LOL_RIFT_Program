ALTER TABLE `tournaments` ADD `competition_kind` text DEFAULT 'tournament' NOT NULL;
ALTER TABLE `teams` ADD `match_id` text;
CREATE INDEX `idx_teams_match` ON `teams` (`match_id`);
ALTER TABLE `matches` ADD `betting_status` text DEFAULT 'scheduled' NOT NULL;
ALTER TABLE `matches` ADD `betting_opened_at` text;
ALTER TABLE `matches` ADD `betting_closed_at` text;
CREATE INDEX `idx_matches_betting_status` ON `matches` (`tournament_id`,`betting_status`);
