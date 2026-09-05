CREATE TABLE `property_feature_group_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_feature_group_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_feature_group_id`) REFERENCES `property_feature_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_feature_group_translations_locale_check" CHECK("property_feature_group_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE INDEX `property_feature_group_translations_group_idx` ON `property_feature_group_translations` (`property_feature_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_feature_group_translations_group_locale_unique` ON `property_feature_group_translations` (`property_feature_group_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_feature_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `property_feature_groups_property_sort_idx` ON `property_feature_groups` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `property_feature_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_feature_id` integer NOT NULL,
	`locale` text NOT NULL,
	`label` text,
	`value` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_feature_id`) REFERENCES `property_features`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_feature_translations_locale_check" CHECK("property_feature_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE INDEX `property_feature_translations_feature_idx` ON `property_feature_translations` (`property_feature_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_feature_translations_feature_locale_unique` ON `property_feature_translations` (`property_feature_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_features` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`property_feature_group_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`property_feature_group_id`) REFERENCES `property_feature_groups`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `property_features_property_sort_idx` ON `property_features` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `property_features_group_idx` ON `property_features` (`property_feature_group_id`);