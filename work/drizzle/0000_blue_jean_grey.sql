CREATE TABLE `assessment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`assessment_id` text NOT NULL,
	`item_key` text NOT NULL,
	`standard_id` text NOT NULL,
	`owner_confidence_score` real,
	`owner_justification` text,
	`owner_saved_at` integer,
	`reviewer_user_id` text,
	`officer_confidence_score` real,
	`officer_justification` text,
	`officer_saved_at` integer,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessment_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_item_key_uq` ON `assessment_items` (`assessment_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `assessment_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`ai_result_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_workflow_uq` ON `assessment_records` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `coaching_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_role` text NOT NULL,
	`message_type` text DEFAULT 'chat' NOT NULL,
	`content` text NOT NULL,
	`generated` integer DEFAULT false NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`person_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`grade` text NOT NULL,
	`track` text NOT NULL,
	`section` text NOT NULL,
	`reporting_officer` text,
	`years_in_grade` real,
	`source_row` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reporting_lines` (
	`reportee_person_id` integer PRIMARY KEY NOT NULL,
	`supervisor_person_id` integer NOT NULL,
	FOREIGN KEY (`reportee_person_id`) REFERENCES `profiles`(`person_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supervisor_person_id`) REFERENCES `profiles`(`person_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `saved_content` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`context` text NOT NULL,
	`content_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`context` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` integer NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`role` text NOT NULL,
	`team_view` integer DEFAULT false NOT NULL,
	`division_view` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `profiles`(`person_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_person_uq` ON `users` (`person_id`);