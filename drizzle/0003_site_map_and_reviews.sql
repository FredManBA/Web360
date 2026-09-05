CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer,
	`name` text NOT NULL,
	`preferred_contact_method` text NOT NULL,
	`contact_value` text NOT NULL,
	`message` text,
	`locale` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`consent_accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "contacts_preferred_contact_method_check" CHECK("contacts"."preferred_contact_method" IN ('email', 'whatsapp', 'phone', 'social', 'other')),
	CONSTRAINT "contacts_status_check" CHECK("contacts"."status" IN ('new', 'reviewed')),
	CONSTRAINT "contacts_locale_check" CHECK("contacts"."locale" IN ('es', 'en')),
	CONSTRAINT "contacts_name_not_blank_check" CHECK(length(trim("contacts"."name")) > 0),
	CONSTRAINT "contacts_contact_value_not_blank_check" CHECK(length(trim("contacts"."contact_value")) > 0)
);
--> statement-breakpoint
CREATE INDEX `contacts_status_created_at_idx` ON `contacts` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `contacts_property_idx` ON `contacts` (`property_id`);--> statement-breakpoint
CREATE TABLE `map_point_of_interest_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`point_of_interest_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`point_of_interest_id`) REFERENCES `map_points_of_interest`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "map_point_of_interest_translations_locale_check" CHECK("map_point_of_interest_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_point_of_interest_translations_poi_locale_unique` ON `map_point_of_interest_translations` (`point_of_interest_id`,`locale`);--> statement-breakpoint
CREATE TABLE `map_points_of_interest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`icon` text,
	`color` text,
	`is_visible` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "map_points_of_interest_category_not_blank_check" CHECK(length(trim("map_points_of_interest"."category")) > 0),
	CONSTRAINT "map_points_of_interest_latitude_check" CHECK("map_points_of_interest"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "map_points_of_interest_longitude_check" CHECK("map_points_of_interest"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE INDEX `map_points_of_interest_visible_sort_idx` ON `map_points_of_interest` (`is_visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `property_review_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_review_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_review_id`) REFERENCES `property_reviews`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_review_tokens_expiry_check" CHECK("property_review_tokens"."expires_at" > "property_review_tokens"."created_at"),
	CONSTRAINT "property_review_tokens_token_hash_not_blank_check" CHECK(length(trim("property_review_tokens"."token_hash")) > 0)
);
--> statement-breakpoint
CREATE INDEX `property_review_tokens_review_idx` ON `property_review_tokens` (`property_review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_review_tokens_token_hash_unique` ON `property_review_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `property_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer_email` text,
	`reviewer_comment` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_reviews_status_check" CHECK("property_reviews"."status" IN ('pending', 'approved', 'changes_requested', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `property_reviews_property_created_at_idx` ON `property_reviews` (`property_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `property_reviews_status_idx` ON `property_reviews` (`status`);--> statement-breakpoint
CREATE TABLE `site_locales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`locale` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "site_locales_locale_check" CHECK("site_locales"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_locales_one_default_idx` ON `site_locales` (`is_default`) WHERE "site_locales"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `site_locales_locale_unique` ON `site_locales` (`locale`);--> statement-breakpoint
CREATE TABLE `site_setting_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_settings_id` integer NOT NULL,
	`locale` text NOT NULL,
	`brand_tagline` text,
	`home_hero_title` text,
	`home_hero_subtitle` text,
	`global_seo_title` text,
	`global_seo_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`site_settings_id`) REFERENCES `site_settings`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "site_setting_translations_locale_check" CHECK("site_setting_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_setting_translations_settings_locale_unique` ON `site_setting_translations` (`site_settings_id`,`locale`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_name` text,
	`phone` text,
	`whatsapp` text,
	`email` text,
	`address` text,
	`reviewer_email` text,
	`notifications_email` text,
	`default_currency_code` text,
	`logo_object_key` text,
	`favicon_object_key` text,
	`default_social_image_object_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "site_settings_default_currency_code_check" CHECK("site_settings"."default_currency_code" IS NULL OR "site_settings"."default_currency_code" GLOB '[A-Z][A-Z][A-Z]')
);
--> statement-breakpoint
CREATE TABLE `site_social_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "site_social_links_platform_not_blank_check" CHECK(length(trim("site_social_links"."platform")) > 0),
	CONSTRAINT "site_social_links_url_not_blank_check" CHECK(length(trim("site_social_links"."url")) > 0)
);
