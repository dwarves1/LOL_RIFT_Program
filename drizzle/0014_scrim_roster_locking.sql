ALTER TABLE `riot_accounts` ADD `identity_status` text DEFAULT 'verified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `matches` ADD `result_locked_at` text;
--> statement-breakpoint
ALTER TABLE `matches` ADD `result_locked_by` text;
--> statement-breakpoint
PRAGMA optimize;
