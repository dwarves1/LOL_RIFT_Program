ALTER TABLE `tournaments` ADD `competition_format` text DEFAULT 'league_then_bracket' NOT NULL;
ALTER TABLE `tournaments` ADD `advancing_team_count` integer;
ALTER TABLE `tournaments` ADD `league_best_of` integer DEFAULT 1 NOT NULL;
ALTER TABLE `tournaments` ADD `bracket_best_of` integer DEFAULT 3 NOT NULL;
ALTER TABLE `tournaments` ADD `semifinal_best_of` integer DEFAULT 5 NOT NULL;
ALTER TABLE `tournaments` ADD `final_best_of` integer DEFAULT 5 NOT NULL;
ALTER TABLE `tournaments` ADD `tiebreak_best_of` integer DEFAULT 1 NOT NULL;
ALTER TABLE `tournaments` ADD `access_code_hash` text;
ALTER TABLE `tournaments` ADD `access_code_hint` text;
ALTER TABLE `tournaments` ADD `access_code_updated_at` text;
ALTER TABLE `teams` ADD `representative_user_id` text;
ALTER TABLE `matches` ADD `match_type` text DEFAULT 'regular' NOT NULL;
ALTER TABLE `matches` ADD `best_of` integer DEFAULT 1 NOT NULL;
ALTER TABLE `matches` ADD `series_score_a` integer DEFAULT 0 NOT NULL;
ALTER TABLE `matches` ADD `series_score_b` integer DEFAULT 0 NOT NULL;
ALTER TABLE `match_result_images` ADD `set_no` integer DEFAULT 1 NOT NULL;
DROP INDEX IF EXISTS `idx_match_result_images_match`;
CREATE UNIQUE INDEX `idx_match_result_images_match_set` ON `match_result_images` (`match_id`,`set_no`);
ALTER TABLE `player_match_stats` ADD `set_no` integer DEFAULT 1 NOT NULL;
DROP INDEX IF EXISTS `idx_player_match_stats_row`;
CREATE UNIQUE INDEX `idx_player_match_stats_row` ON `player_match_stats` (`match_id`,`set_no`,`row_order`);

CREATE TABLE `match_team_stats_v2` (
  `match_id` text NOT NULL, `set_no` integer DEFAULT 1 NOT NULL, `side` integer NOT NULL,
  `team_id` text NOT NULL, `kills` integer NOT NULL, `deaths` integer NOT NULL,
  `assists` integer NOT NULL, `gold` integer NOT NULL, `won` integer NOT NULL,
  PRIMARY KEY(`match_id`,`set_no`,`side`)
);
INSERT INTO `match_team_stats_v2` SELECT `match_id`,1,`side`,`team_id`,`kills`,`deaths`,`assists`,`gold`,`won` FROM `match_team_stats`;
DROP TABLE `match_team_stats`;
ALTER TABLE `match_team_stats_v2` RENAME TO `match_team_stats`;
CREATE INDEX `idx_match_team_stats_team` ON `match_team_stats` (`team_id`,`match_id`);

CREATE TABLE `match_games` (
  `id` text PRIMARY KEY NOT NULL, `match_id` text NOT NULL, `set_no` integer NOT NULL,
  `blue_team_id` text, `red_team_id` text, `winner_team_id` text,
  `status` text DEFAULT 'scheduled' NOT NULL, `completed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `idx_match_games_match_set` ON `match_games` (`match_id`,`set_no`);
CREATE INDEX `idx_match_games_match` ON `match_games` (`match_id`,`set_no`);

CREATE TABLE `tournament_members` (
  `tournament_id` text NOT NULL, `user_id` text NOT NULL, `role` text DEFAULT 'viewer' NOT NULL,
  `team_id` text, `joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`tournament_id`,`user_id`)
);
CREATE INDEX `idx_tournament_members_user` ON `tournament_members` (`user_id`,`tournament_id`);
CREATE INDEX `idx_tournament_members_team` ON `tournament_members` (`team_id`);

CREATE TABLE `draft_sessions` (
  `id` text PRIMARY KEY NOT NULL, `context` text NOT NULL, `tournament_id` text, `match_id` text,
  `owner_user_id` text NOT NULL, `name` text, `mode` text NOT NULL, `best_of` integer NOT NULL,
  `timer_mode` text NOT NULL, `timer_seconds` integer, `undo_enabled` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'lobby' NOT NULL, `blue_team_id` text, `red_team_id` text,
  `blue_user_id` text, `red_user_id` text, `current_set` integer DEFAULT 1 NOT NULL,
  `current_step` integer DEFAULT 0 NOT NULL, `turn_expires_at` text, `version` integer DEFAULT 1 NOT NULL,
  `state_json` text DEFAULT '{}' NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `idx_draft_sessions_match` ON `draft_sessions` (`match_id`,`created_at`);
CREATE INDEX `idx_draft_sessions_owner` ON `draft_sessions` (`owner_user_id`,`context`,`updated_at`);

INSERT OR IGNORE INTO `tournament_members` (`tournament_id`,`user_id`,`role`) SELECT `id`,`created_by`,'owner' FROM `tournaments`;
INSERT OR IGNORE INTO `tournament_members` (`tournament_id`,`user_id`,`role`) SELECT `tournament_id`,`user_id`,'viewer' FROM `tournament_entries`;
INSERT OR IGNORE INTO `match_games` (`id`,`match_id`,`set_no`,`blue_team_id`,`red_team_id`,`winner_team_id`,`status`,`completed_at`)
  SELECT 'game_' || `id`,`id`,1,`team_a_id`,`team_b_id`,`winner_id`,CASE WHEN `status`='completed' THEN 'completed' ELSE 'scheduled' END,`completed_at` FROM `matches`;
UPDATE `tournaments` SET `competition_format` = CASE
  WHEN `preliminary_format`='none' AND `bracket_format`='winner_loser_split' THEN 'split_only'
  WHEN `preliminary_format`='none' THEN 'bracket_only'
  WHEN `bracket_format`='winner_loser_split' THEN 'league_then_split'
  ELSE 'league_then_bracket' END;
