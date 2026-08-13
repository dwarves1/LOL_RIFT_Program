CREATE TABLE `auth_identities` (
  `provider` text NOT NULL,
  `provider_subject` text NOT NULL,
  `user_id` text NOT NULL,
  `email` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`provider`,`provider_subject`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_identities_user_provider` ON `auth_identities` (`user_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `idx_auth_identities_user` ON `auth_identities` (`user_id`);
