CREATE TABLE `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`property_type_id` integer,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`commercial_status` text DEFAULT 'available' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`show_when_sold` integer DEFAULT false NOT NULL,
	`price_mode` text DEFAULT 'contact' NOT NULL,
	`price_amount_minor` integer,
	`currency_code` text,
	`area_square_meters` real,
	`province` text,
	`canton` text,
	`district` text,
	`locality` text,
	`private_latitude` real,
	`private_longitude` real,
	`public_latitude` real,
	`public_longitude` real,
	`location_precision` text DEFAULT 'approximate' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`property_type_id`) REFERENCES `property_types`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "properties_publication_status_check" CHECK("properties"."publication_status" IN ('draft', 'in_review', 'approved', 'published', 'archived')),
	CONSTRAINT "properties_commercial_status_check" CHECK("properties"."commercial_status" IN ('available', 'offer_received', 'reserved', 'sold')),
	CONSTRAINT "properties_price_mode_check" CHECK("properties"."price_mode" IN ('exact', 'negotiable', 'contact')),
	CONSTRAINT "properties_location_precision_check" CHECK("properties"."location_precision" IN ('exact', 'approximate')),
	CONSTRAINT "properties_code_not_blank_check" CHECK(length(trim("properties"."code")) > 0),
	CONSTRAINT "properties_currency_code_check" CHECK("properties"."currency_code" IS NULL OR "properties"."currency_code" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "properties_price_amount_minor_check" CHECK("properties"."price_amount_minor" IS NULL OR "properties"."price_amount_minor" >= 0),
	CONSTRAINT "properties_area_square_meters_check" CHECK("properties"."area_square_meters" IS NULL OR "properties"."area_square_meters" > 0),
	CONSTRAINT "properties_private_latitude_check" CHECK("properties"."private_latitude" IS NULL OR "properties"."private_latitude" BETWEEN -90 AND 90),
	CONSTRAINT "properties_private_longitude_check" CHECK("properties"."private_longitude" IS NULL OR "properties"."private_longitude" BETWEEN -180 AND 180),
	CONSTRAINT "properties_public_latitude_check" CHECK("properties"."public_latitude" IS NULL OR "properties"."public_latitude" BETWEEN -90 AND 90),
	CONSTRAINT "properties_public_longitude_check" CHECK("properties"."public_longitude" IS NULL OR "properties"."public_longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE INDEX `properties_type_idx` ON `properties` (`property_type_id`);--> statement-breakpoint
CREATE INDEX `properties_publication_status_published_at_idx` ON `properties` (`publication_status`,`published_at`);--> statement-breakpoint
CREATE INDEX `properties_commercial_status_idx` ON `properties` (`commercial_status`);--> statement-breakpoint
CREATE INDEX `properties_is_featured_idx` ON `properties` (`is_featured`);--> statement-breakpoint
CREATE UNIQUE INDEX `properties_code_unique` ON `properties` (`code`);--> statement-breakpoint
CREATE TABLE `property_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`locale` text NOT NULL,
	`slug` text,
	`title` text,
	`marketing_description` text,
	`technical_description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_translations_locale_check" CHECK("property_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE INDEX `property_translations_property_idx` ON `property_translations` (`property_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_translations_property_locale_unique` ON `property_translations` (`property_id`,`locale`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_translations_locale_slug_unique` ON `property_translations` (`locale`,`slug`);--> statement-breakpoint
CREATE TABLE `property_type_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_type_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_type_id`) REFERENCES `property_types`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_type_translations_locale_check" CHECK("property_type_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE INDEX `property_type_translations_type_idx` ON `property_type_translations` (`property_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_type_translations_type_locale_unique` ON `property_type_translations` (`property_type_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system_key` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_types_system_key_unique` ON `property_types` (`system_key`);