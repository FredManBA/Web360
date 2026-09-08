CREATE TABLE `publication_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`callback_token_hash` text NOT NULL,
	`job_ref` text,
	`error_summary` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "publication_requests_action_check" CHECK("publication_requests"."action" IN ('publish', 'unpublish')),
	CONSTRAINT "publication_requests_status_check" CHECK("publication_requests"."status" IN ('pending', 'building', 'done', 'failed')),
	CONSTRAINT "publication_requests_callback_token_hash_not_blank_check" CHECK(length(trim("publication_requests"."callback_token_hash")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_active_per_property_idx` ON `publication_requests` (`property_id`) WHERE status IN ('pending', 'building');--> statement-breakpoint
CREATE INDEX `publication_requests_property_created_at_idx` ON `publication_requests` (`property_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_callback_token_hash_unique` ON `publication_requests` (`callback_token_hash`);