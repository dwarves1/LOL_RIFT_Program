CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_tournament_created` ON `audit_logs` (`tournament_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`stake` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payout` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bets_user_match` ON `bets` (`user_id`,`match_id`);--> statement-breakpoint
CREATE INDEX `idx_bets_match_status` ON `bets` (`match_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_bets_tournament_user` ON `bets` (`tournament_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`phase` text NOT NULL,
	`match_no` text NOT NULL,
	`round_label` text NOT NULL,
	`team_a_id` text,
	`team_b_id` text,
	`source_a` text,
	`source_b` text,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`winner_id` text,
	`loser_id` text,
	`sort_order` integer NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_matches_tournament_phase_order` ON `matches` (`tournament_id`,`phase`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_matches_tournament_number` ON `matches` (`tournament_id`,`phase`,`match_no`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`nickname` text NOT NULL,
	`position` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_players_team` ON `players` (`team_id`);--> statement-breakpoint
CREATE TABLE `point_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tournament_id` text,
	`bet_id` text,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`description` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_user_created` ON `point_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`seed` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_teams_tournament` ON `teams` (`tournament_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_teams_tournament_name` ON `teams` (`tournament_id`,`name`);--> statement-breakpoint
CREATE TABLE `tournament_entries` (
	`tournament_id` text NOT NULL,
	`user_id` text NOT NULL,
	`starter_points_awarded` integer NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`tournament_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_entries_user` ON `tournament_entries` (`user_id`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'league' NOT NULL,
	`start_at` text NOT NULL,
	`matches_per_pair` integer DEFAULT 2 NOT NULL,
	`starter_points` integer DEFAULT 1000 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tournaments_status_start` ON `tournaments` (`status`,`start_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`points_balance` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);