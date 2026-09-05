CREATE TABLE `property_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`property_media_group_id` integer,
	`media_kind` text NOT NULL,
	`source_provider` text NOT NULL,
	`object_key` text,
	`mime_type` text,
	`file_size_bytes` integer,
	`youtube_video_id` text,
	`width` integer,
	`height` integer,
	`duration_seconds` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_hero` integer DEFAULT false NOT NULL,
	`is_catalog_cover` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`property_media_group_id`) REFERENCES `property_media_groups`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "property_media_kind_check" CHECK("property_media"."media_kind" IN ('image', 'video', 'document', 'panorama')),
	CONSTRAINT "property_media_source_provider_check" CHECK("property_media"."source_provider" IN ('r2', 'youtube')),
	CONSTRAINT "property_media_source_consistency_check" CHECK((
        "property_media"."source_provider" = 'r2'
        AND "property_media"."object_key" IS NOT NULL
        AND "property_media"."youtube_video_id" IS NULL
      ) OR (
        "property_media"."source_provider" = 'youtube'
        AND "property_media"."media_kind" = 'video'
        AND "property_media"."youtube_video_id" IS NOT NULL
        AND "property_media"."object_key" IS NULL
      )),
	CONSTRAINT "property_media_hero_kind_check" CHECK("property_media"."is_hero" = 0 OR "property_media"."media_kind" IN ('image', 'video')),
	CONSTRAINT "property_media_catalog_cover_kind_check" CHECK("property_media"."is_catalog_cover" = 0 OR "property_media"."media_kind" = 'image'),
	CONSTRAINT "property_media_width_check" CHECK("property_media"."width" IS NULL OR "property_media"."width" > 0),
	CONSTRAINT "property_media_height_check" CHECK("property_media"."height" IS NULL OR "property_media"."height" > 0),
	CONSTRAINT "property_media_file_size_check" CHECK("property_media"."file_size_bytes" IS NULL OR "property_media"."file_size_bytes" > 0),
	CONSTRAINT "property_media_duration_check" CHECK("property_media"."duration_seconds" IS NULL OR "property_media"."duration_seconds" > 0)
);
--> statement-breakpoint
CREATE INDEX `property_media_property_sort_idx` ON `property_media` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `property_media_group_idx` ON `property_media` (`property_media_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_media_one_hero_per_property_idx` ON `property_media` (`property_id`) WHERE "property_media"."is_hero" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `property_media_one_catalog_cover_per_property_idx` ON `property_media` (`property_id`) WHERE "property_media"."is_catalog_cover" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `property_media_object_key_unique` ON `property_media` (`object_key`);--> statement-breakpoint
CREATE TABLE `property_media_group_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_media_group_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_media_group_id`) REFERENCES `property_media_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_media_group_translations_locale_check" CHECK("property_media_group_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_media_group_translations_group_locale_unique` ON `property_media_group_translations` (`property_media_group_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_media_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `property_media_groups_property_sort_idx` ON `property_media_groups` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `property_media_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_media_id` integer NOT NULL,
	`locale` text NOT NULL,
	`title` text,
	`alt_text` text,
	`caption` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_media_id`) REFERENCES `property_media`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_media_translations_locale_check" CHECK("property_media_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_media_translations_media_locale_unique` ON `property_media_translations` (`property_media_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_tour_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_node_id` integer NOT NULL,
	`to_node_id` integer NOT NULL,
	`yaw` real DEFAULT 0 NOT NULL,
	`pitch` real DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`from_node_id`) REFERENCES `property_tour_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`to_node_id`) REFERENCES `property_tour_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_tour_links_no_self_link_check" CHECK("property_tour_links"."from_node_id" <> "property_tour_links"."to_node_id")
);
--> statement-breakpoint
CREATE INDEX `property_tour_links_to_node_idx` ON `property_tour_links` (`to_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_tour_links_from_to_unique` ON `property_tour_links` (`from_node_id`,`to_node_id`);--> statement-breakpoint
CREATE TABLE `property_tour_node_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_tour_node_id` integer NOT NULL,
	`locale` text NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_tour_node_id`) REFERENCES `property_tour_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "property_tour_node_translations_locale_check" CHECK("property_tour_node_translations"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_tour_node_translations_node_locale_unique` ON `property_tour_node_translations` (`property_tour_node_id`,`locale`);--> statement-breakpoint
CREATE TABLE `property_tour_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`property_media_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_start` integer DEFAULT false NOT NULL,
	`initial_yaw` real,
	`initial_pitch` real,
	`initial_fov` real,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`property_media_id`) REFERENCES `property_media`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "property_tour_nodes_initial_fov_check" CHECK("property_tour_nodes"."initial_fov" IS NULL OR "property_tour_nodes"."initial_fov" > 0)
);
--> statement-breakpoint
CREATE INDEX `property_tour_nodes_property_sort_idx` ON `property_tour_nodes` (`property_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_tour_nodes_one_start_per_property_idx` ON `property_tour_nodes` (`property_id`) WHERE "property_tour_nodes"."is_start" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `property_tour_nodes_media_unique` ON `property_tour_nodes` (`property_media_id`);