PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publication_requests` (
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
	CONSTRAINT "publication_requests_action_check" CHECK("__new_publication_requests"."action" IN ('publish', 'unpublish')),
	CONSTRAINT "publication_requests_status_check" CHECK("__new_publication_requests"."status" IN ('pending', 'building', 'done', 'failed', 'abandoned')),
	CONSTRAINT "publication_requests_callback_token_hash_not_blank_check" CHECK(length(trim("__new_publication_requests"."callback_token_hash")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_publication_requests`("id", "property_id", "action", "status", "callback_token_hash", "job_ref", "error_summary", "requested_at", "started_at", "finished_at", "created_at", "updated_at") SELECT "id", "property_id", "action", "status", "callback_token_hash", "job_ref", "error_summary", "requested_at", "started_at", "finished_at", "created_at", "updated_at" FROM `publication_requests`;--> statement-breakpoint
DROP TABLE `publication_requests`;--> statement-breakpoint
ALTER TABLE `__new_publication_requests` RENAME TO `publication_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_active_per_property_idx` ON `publication_requests` (`property_id`) WHERE status IN ('pending', 'building');--> statement-breakpoint
CREATE INDEX `publication_requests_property_created_at_idx` ON `publication_requests` (`property_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_callback_token_hash_unique` ON `publication_requests` (`callback_token_hash`);