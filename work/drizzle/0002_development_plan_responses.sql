CREATE TABLE `development_plan_responses` (
  `reportee_user_id` text PRIMARY KEY NOT NULL,
  `reviewer_user_id` text NOT NULL,
  `action_items_json` text DEFAULT '[]' NOT NULL,
  `discussion_notes` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`reportee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
