-- One-time production cleanup requested for the exact ILPOOM#KR1 account.
UPDATE `teams` SET `representative_user_id` = NULL WHERE `representative_user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `teams` SET `logo_updated_by` = NULL WHERE `logo_updated_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `matches` SET `schedule_updated_by` = NULL WHERE `schedule_updated_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `matches` SET `cancelled_by` = NULL WHERE `cancelled_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `draft_sessions` SET `blue_user_id` = NULL WHERE `blue_user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `draft_sessions` SET `red_user_id` = NULL WHERE `red_user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `draft_sessions` WHERE `owner_user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `feedback_messages` SET `handled_by` = NULL WHERE `handled_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `match_result_images` SET `created_by` = 'deleted_user' WHERE `created_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `result_revisions` SET `created_by` = 'deleted_user' WHERE `created_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `bet_settlements` SET `started_by` = 'deleted_user' WHERE `started_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `tournament_backups` SET `created_by` = 'deleted_user' WHERE `created_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `qa_sandboxes` SET `created_by` = 'deleted_user' WHERE `created_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `tournaments` SET `created_by` = 'deleted_user' WHERE `created_by` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `player_match_stats` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670' OR LOWER(TRIM(`account_name_snapshot`)) IN ('ilpoom', 'ilpoom#kr1');
--> statement-breakpoint
DELETE FROM `players` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670' OR `riot_account_id` IN (SELECT `id` FROM `riot_accounts` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670');
--> statement-breakpoint
DELETE FROM `point_ledger` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `bets` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `tournament_entries` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `tournament_members` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `feedback_messages` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `audit_logs` WHERE `actor_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `auth_identities` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `riot_id_history` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `riot_accounts` WHERE `user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
UPDATE `users` SET `merged_into_user_id` = NULL WHERE `merged_into_user_id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
DELETE FROM `users` WHERE `id` = 'user_754852f6-7157-4ae7-9fc4-854a5dc0a670';
--> statement-breakpoint
PRAGMA optimize;
