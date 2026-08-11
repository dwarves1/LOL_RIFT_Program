CREATE TABLE `riot_accounts` (
  `id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `game_name` text NOT NULL,
  `tagline` text NOT NULL, `game_name_normalized` text NOT NULL, `tagline_normalized` text NOT NULL,
  `is_primary` integer DEFAULT 0 NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `idx_riot_accounts_user` ON `riot_accounts` (`user_id`,`is_primary`);
CREATE UNIQUE INDEX `idx_riot_accounts_identity` ON `riot_accounts` (`game_name_normalized`,`tagline_normalized`);
ALTER TABLE `tournaments` ADD `roster_mode` text DEFAULT 'legacy_free_text' NOT NULL;
ALTER TABLE `players` ADD `riot_account_id` text;
ALTER TABLE `players` ADD `team_role` text DEFAULT 'member' NOT NULL;
CREATE INDEX `idx_players_riot_account` ON `players` (`riot_account_id`);
ALTER TABLE `matches` ADD `schedule_updated_by` text;
ALTER TABLE `matches` ADD `schedule_updated_at` text;
INSERT OR IGNORE INTO `riot_accounts` (`id`,`user_id`,`game_name`,`tagline`,`game_name_normalized`,`tagline_normalized`,`is_primary`,`created_at`,`updated_at`)
SELECT 'riot_' || `id`,`id`,`riot_game_name`,`riot_tagline`,`riot_game_name_normalized`,`riot_tagline_normalized`,1,COALESCE(`profile_completed_at`,CURRENT_TIMESTAMP),COALESCE(`profile_updated_at`,CURRENT_TIMESTAMP)
FROM `users` WHERE `riot_game_name` IS NOT NULL AND `riot_tagline` IS NOT NULL;
