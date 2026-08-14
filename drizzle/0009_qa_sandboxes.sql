CREATE TABLE `qa_sandboxes` (
  `tournament_id` text PRIMARY KEY NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_qa_sandboxes_created` ON `qa_sandboxes` (`created_at`);
