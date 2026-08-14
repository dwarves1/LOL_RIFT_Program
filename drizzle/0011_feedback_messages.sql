CREATE TABLE `feedback_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tournament_id` text,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`page_path` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`admin_note` text,
	`handled_by` text,
	`handled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_status_created` ON `feedback_messages` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_tournament_created` ON `feedback_messages` (`tournament_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_feedback_user_created` ON `feedback_messages` (`user_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
