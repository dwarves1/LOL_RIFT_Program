ALTER TABLE `users` ADD `auth_display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `real_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `riot_game_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `riot_tagline` text;--> statement-breakpoint
ALTER TABLE `users` ADD `riot_game_name_normalized` text;--> statement-breakpoint
ALTER TABLE `users` ADD `riot_tagline_normalized` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_completed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_updated_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_riot_id` ON `users` (`riot_game_name_normalized`,`riot_tagline_normalized`);--> statement-breakpoint
CREATE TABLE `riot_id_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_name` text NOT NULL,
	`tagline` text NOT NULL,
	`game_name_normalized` text NOT NULL,
	`tagline_normalized` text NOT NULL,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_riot_history_user` ON `riot_id_history` (`user_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `idx_riot_history_lookup` ON `riot_id_history` (`game_name_normalized`,`tagline_normalized`);--> statement-breakpoint
ALTER TABLE `tournaments` ADD `preliminary_format` text DEFAULT 'round_robin' NOT NULL;--> statement-breakpoint
ALTER TABLE `tournaments` ADD `bracket_format` text DEFAULT 'single_elimination' NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `user_id` text;--> statement-breakpoint
CREATE INDEX `idx_players_user` ON `players` (`user_id`);--> statement-breakpoint
CREATE TABLE `match_result_images` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_seconds` integer,
	`extraction_json` text,
	`created_by` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_result_images_match` ON `match_result_images` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_match_result_images_key` ON `match_result_images` (`object_key`);--> statement-breakpoint
CREATE TABLE `match_team_stats` (
	`match_id` text NOT NULL,
	`side` integer NOT NULL,
	`team_id` text NOT NULL,
	`kills` integer NOT NULL,
	`deaths` integer NOT NULL,
	`assists` integer NOT NULL,
	`gold` integer NOT NULL,
	`won` integer NOT NULL,
	PRIMARY KEY(`match_id`, `side`)
);--> statement-breakpoint
CREATE INDEX `idx_match_team_stats_team` ON `match_team_stats` (`team_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `player_match_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text,
	`side` integer NOT NULL,
	`row_order` integer NOT NULL,
	`account_name_snapshot` text NOT NULL,
	`champion_name` text NOT NULL,
	`champion_level` integer NOT NULL,
	`lane` text NOT NULL,
	`kills` integer NOT NULL,
	`deaths` integer NOT NULL,
	`assists` integer NOT NULL,
	`damage` integer NOT NULL,
	`gold` integer NOT NULL,
	`gold_per_minute` integer NOT NULL,
	`won` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_player_match_stats_row` ON `player_match_stats` (`match_id`,`row_order`);--> statement-breakpoint
CREATE INDEX `idx_player_match_stats_user` ON `player_match_stats` (`user_id`,`match_id`);--> statement-breakpoint
CREATE INDEX `idx_player_match_stats_team` ON `player_match_stats` (`team_id`,`match_id`);
