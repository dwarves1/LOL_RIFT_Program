ALTER TABLE `users` ADD `account_status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `merged_into_user_id` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `claimed_at` text;
--> statement-breakpoint
CREATE INDEX `idx_users_account_status` ON `users` (`account_status`);
