-- R2: apply only to a disposable copy until an explicit production cutover.
-- D1 migrations run transactionally. All copies precede all drops; no R2 objects are touched.
CREATE TABLE r2_conversion_guard (
 bad_tour_media INTEGER CONSTRAINT r2_tour_requires_own_panorama CHECK(bad_tour_media = 0),
 bad_tour_links INTEGER CONSTRAINT r2_tour_links_require_same_property CHECK(bad_tour_links = 0),
 bad_feature_groups INTEGER CONSTRAINT r2_features_require_own_group CHECK(bad_feature_groups = 0),
 bad_settings INTEGER CONSTRAINT r2_single_site_settings CHECK(bad_settings = 0)
);
--> statement-breakpoint
INSERT INTO r2_conversion_guard VALUES (
 (SELECT count(*) FROM property_tour_nodes n LEFT JOIN property_media m ON m.id=n.property_media_id WHERE m.id IS NULL OR m.property_id<>n.property_id OR m.media_kind<>'panorama' OR m.source_provider<>'r2'),
 (SELECT count(*) FROM property_tour_links l LEFT JOIN property_tour_nodes a ON a.id=l.from_node_id LEFT JOIN property_tour_nodes b ON b.id=l.to_node_id WHERE a.id IS NULL OR b.id IS NULL OR a.property_id<>b.property_id),
 (SELECT count(*) FROM property_features f JOIN property_feature_groups g ON g.id=f.property_feature_group_id WHERE f.property_id<>g.property_id),
 (SELECT count(*) FROM site_settings WHERE id<>1)
);
--> statement-breakpoint
CREATE TABLE `contacts_r2` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer,
	`name` text NOT NULL,
	`preferred_contact_method` text NOT NULL,
	`contact_value` text NOT NULL,
	`message` text,
	`locale` text DEFAULT 'es' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`consent_accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties_r2`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contacts_status_check" CHECK("contacts_r2"."status" IN ('new','reviewed')),
	CONSTRAINT "contacts_locale_check" CHECK("contacts_r2"."locale" IN ('es','en'))
);
--> statement-breakpoint
CREATE TABLE `media_r2` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`kind` text NOT NULL,
	`object_key` text,
	`youtube_video_id` text,
	`mime_type` text,
	`file_size_bytes` integer,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`alt_es` text,
	`alt_en` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties_r2`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_source_check" CHECK(("media_r2"."kind" IN ('image','panorama') AND "media_r2"."object_key" IS NOT NULL AND length("media_r2"."object_key") > 0 AND "media_r2"."youtube_video_id" IS NULL) OR ("media_r2"."kind" = 'youtube' AND "media_r2"."youtube_video_id" IS NOT NULL AND length("media_r2"."youtube_video_id") = 11 AND "media_r2"."object_key" IS NULL)),
	CONSTRAINT "media_cover_check" CHECK("media_r2"."is_cover" = 0 OR "media_r2"."kind" = 'image')
);
--> statement-breakpoint
CREATE TABLE `properties_r2` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`commercial_status` text DEFAULT 'available' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`type` text DEFAULT 'lot' NOT NULL,
	`price_mode` text DEFAULT 'contact' NOT NULL,
	`price_amount_minor` integer,
	`currency_code` text,
	`area_square_meters` real,
	`province` text,
	`canton` text,
	`district` text,
	`locality` text,
	`map_latitude` real,
	`map_longitude` real,
	`location_precision` text DEFAULT 'approximate' NOT NULL,
	`slug_es` text,
	`title_es` text,
	`description_es` text,
	`details_es` text,
	`slug_en` text,
	`title_en` text,
	`description_en` text,
	`details_en` text,
	`features_json` text DEFAULT '[]' NOT NULL,
	`tour_json` text,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "properties_status_check" CHECK("properties_r2"."status" IN ('draft','published')),
	CONSTRAINT "properties_type_check" CHECK("properties_r2"."type" IN ('lot','house','farm','land','commercial','other')),
	CONSTRAINT "properties_commercial_check" CHECK("properties_r2"."commercial_status" IN ('available','offer_received','reserved','sold')),
	CONSTRAINT "properties_price_check" CHECK("properties_r2"."price_mode" IN ('exact','negotiable','contact')),
	CONSTRAINT "properties_precision_check" CHECK("properties_r2"."location_precision" IN ('exact','approximate')),
	CONSTRAINT "properties_code_check" CHECK(length(trim("properties_r2"."code")) > 0),
	CONSTRAINT "properties_amount_check" CHECK("properties_r2"."price_amount_minor" IS NULL OR "properties_r2"."price_amount_minor" >= 0),
	CONSTRAINT "properties_area_check" CHECK("properties_r2"."area_square_meters" IS NULL OR "properties_r2"."area_square_meters" > 0),
	CONSTRAINT "properties_latitude_check" CHECK("properties_r2"."map_latitude" IS NULL OR "properties_r2"."map_latitude" BETWEEN -90 AND 90),
	CONSTRAINT "properties_longitude_check" CHECK("properties_r2"."map_longitude" IS NULL OR "properties_r2"."map_longitude" BETWEEN -180 AND 180),
	CONSTRAINT "properties_features_check" CHECK(json_valid("properties_r2"."features_json") AND json_type("properties_r2"."features_json") = 'array'),
	CONSTRAINT "properties_tour_check" CHECK("properties_r2"."tour_json" IS NULL OR (json_valid("properties_r2"."tour_json") AND json_type("properties_r2"."tour_json") = 'object'))
);
--> statement-breakpoint
CREATE TABLE `site_settings_r2` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`business_name` text,
	`phone` text,
	`whatsapp` text,
	`email` text,
	`address` text,
	`notifications_email` text,
	`logo_object_key` text,
	`favicon_object_key` text,
	`social_image_object_key` text,
	`hero_object_key` text,
	`brand_tagline_es` text,
	`hero_title_es` text,
	`hero_subtitle_es` text,
	`seo_title_es` text,
	`seo_description_es` text,
	`brand_tagline_en` text,
	`hero_title_en` text,
	`hero_subtitle_en` text,
	`seo_title_en` text,
	`seo_description_en` text,
	`default_currency_code` text DEFAULT 'USD' NOT NULL,
	`social_links_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK("site_settings_r2"."id" = 1),
	CONSTRAINT "site_settings_social_check" CHECK(json_valid("site_settings_r2"."social_links_json") AND json_type("site_settings_r2"."social_links_json") = 'array')
);
--> statement-breakpoint
INSERT INTO properties_r2 (id,code,status,commercial_status,featured,type,price_mode,price_amount_minor,currency_code,area_square_meters,province,canton,district,locality,map_latitude,map_longitude,location_precision,slug_es,title_es,description_es,details_es,slug_en,title_en,description_en,details_en,features_json,tour_json,created_at,updated_at,published_at)
SELECT p.id,p.code,CASE WHEN p.publication_status='published' THEN 'published' ELSE 'draft' END,p.commercial_status,p.is_featured,
CASE WHEN t.system_key IN ('lot','house','farm','land','commercial','other') THEN t.system_key ELSE 'other' END,
p.price_mode,p.price_amount_minor,p.currency_code,p.area_square_meters,p.province,p.canton,p.district,p.locality,p.public_latitude,p.public_longitude,p.location_precision,
es.slug,es.title,es.marketing_description,es.technical_description,en.slug,en.title,en.marketing_description,en.technical_description,
(SELECT json_group_array(json(item)) FROM (
 SELECT json_object('label_es', CASE WHEN fe.label IS NULL THEN NULL WHEN ge.name IS NULL OR trim(ge.name)='' THEN fe.label ELSE ge.name || ': ' || fe.label END,
 'label_en',CASE WHEN fn.label IS NULL THEN NULL WHEN gn.name IS NULL OR trim(gn.name)='' THEN fn.label ELSE gn.name || ': ' || fn.label END,
 'value_es',fe.value,'value_en',fn.value) AS item
 FROM property_features f LEFT JOIN property_feature_groups g ON g.id=f.property_feature_group_id
 LEFT JOIN property_feature_translations fe ON fe.property_feature_id=f.id AND fe.locale='es'
 LEFT JOIN property_feature_translations fn ON fn.property_feature_id=f.id AND fn.locale='en'
 LEFT JOIN property_feature_group_translations ge ON ge.property_feature_group_id=g.id AND ge.locale='es'
 LEFT JOIN property_feature_group_translations gn ON gn.property_feature_group_id=g.id AND gn.locale='en'
 WHERE f.property_id=p.id ORDER BY COALESCE(g.sort_order,2147483647),g.id,f.sort_order,f.id
)),
CASE WHEN EXISTS(SELECT 1 FROM property_tour_nodes WHERE property_id=p.id) THEN json_object(
 'startMediaId',(SELECT property_media_id FROM property_tour_nodes WHERE property_id=p.id ORDER BY is_start DESC,sort_order,id LIMIT 1),
 'nodes',json((SELECT json_group_array(json(item)) FROM (
 SELECT json_object('mediaId',n.property_media_id,'name_es',ne.name,'name_en',nn.name,
 'initialView',CASE WHEN n.initial_yaw IS NULL AND n.initial_pitch IS NULL AND n.initial_fov IS NULL THEN NULL ELSE json_object('yaw',n.initial_yaw,'pitch',n.initial_pitch,'fov',n.initial_fov) END,
 'links',json((SELECT json_group_array(json(link)) FROM (
 SELECT json_object('toMediaId',dest.property_media_id,'yaw',l.yaw,'pitch',l.pitch) AS link
 FROM property_tour_links l JOIN property_tour_nodes dest ON dest.id=l.to_node_id
 WHERE l.from_node_id=n.id ORDER BY l.sort_order,l.id
 )))) AS item
 FROM property_tour_nodes n
 LEFT JOIN property_tour_node_translations ne ON ne.property_tour_node_id=n.id AND ne.locale='es'
 LEFT JOIN property_tour_node_translations nn ON nn.property_tour_node_id=n.id AND nn.locale='en'
 WHERE n.property_id=p.id ORDER BY n.sort_order,n.id
)))) ELSE NULL END,
p.created_at,p.updated_at,p.published_at
FROM properties p LEFT JOIN property_types t ON t.id=p.property_type_id
LEFT JOIN property_translations es ON es.property_id=p.id AND es.locale='es'
LEFT JOIN property_translations en ON en.property_id=p.id AND en.locale='en';
--> statement-breakpoint
INSERT INTO media_r2 (id,property_id,kind,object_key,youtube_video_id,mime_type,file_size_bytes,width,height,sort_order,is_cover,alt_es,alt_en,created_at,updated_at)
SELECT m.id,m.property_id,CASE WHEN m.source_provider='youtube' THEN 'youtube' ELSE m.media_kind END,m.object_key,m.youtube_video_id,m.mime_type,m.file_size_bytes,m.width,m.height,
row_number() OVER (PARTITION BY m.property_id ORDER BY COALESCE(g.sort_order,2147483647),g.id,m.sort_order,m.id)-1,
COALESCE(m.id=(SELECT c.id FROM property_media c WHERE c.property_id=m.property_id AND c.media_kind='image' AND c.source_provider='r2' ORDER BY c.is_catalog_cover DESC,c.is_hero DESC,c.sort_order,c.id LIMIT 1),0),
es.alt_text,en.alt_text,m.created_at,m.updated_at
FROM property_media m LEFT JOIN property_media_groups g ON g.id=m.property_media_group_id
LEFT JOIN property_media_translations es ON es.property_media_id=m.id AND es.locale='es'
LEFT JOIN property_media_translations en ON en.property_media_id=m.id AND en.locale='en'
WHERE (m.source_provider='r2' AND m.media_kind IN ('image','panorama')) OR (m.source_provider='youtube' AND m.media_kind='video');
--> statement-breakpoint
INSERT INTO site_settings_r2 (id,business_name,phone,whatsapp,email,address,notifications_email,default_currency_code,logo_object_key,favicon_object_key,social_image_object_key,hero_object_key,brand_tagline_es,hero_title_es,hero_subtitle_es,seo_title_es,seo_description_es,brand_tagline_en,hero_title_en,hero_subtitle_en,seo_title_en,seo_description_en,social_links_json,created_at,updated_at)
SELECT s.id,s.business_name,s.phone,s.whatsapp,s.email,s.address,s.notifications_email,COALESCE(s.default_currency_code,'USD'),s.logo_object_key,s.favicon_object_key,s.default_social_image_object_key,s.home_hero_object_key,
es.brand_tagline,es.home_hero_title,es.home_hero_subtitle,es.global_seo_title,es.global_seo_description,
en.brand_tagline,en.home_hero_title,en.home_hero_subtitle,en.global_seo_title,en.global_seo_description,
(SELECT json_group_array(json(item)) FROM (SELECT json_object('platform',platform,'url',url) AS item FROM site_social_links WHERE is_active=1 ORDER BY sort_order,id)),s.created_at,s.updated_at
FROM site_settings s LEFT JOIN site_setting_translations es ON es.site_settings_id=s.id AND es.locale='es' LEFT JOIN site_setting_translations en ON en.site_settings_id=s.id AND en.locale='en';
--> statement-breakpoint
INSERT INTO contacts_r2 SELECT * FROM contacts;
--> statement-breakpoint
DROP TABLE property_review_tokens;
--> statement-breakpoint
DROP TABLE property_reviews;
--> statement-breakpoint
DROP TABLE publication_requests;
--> statement-breakpoint
DROP TABLE property_tour_links;
--> statement-breakpoint
DROP TABLE property_tour_node_translations;
--> statement-breakpoint
DROP TABLE property_tour_nodes;
--> statement-breakpoint
DROP TABLE property_media_translations;
--> statement-breakpoint
DROP TABLE property_media;
--> statement-breakpoint
DROP TABLE property_media_group_translations;
--> statement-breakpoint
DROP TABLE property_media_groups;
--> statement-breakpoint
DROP TABLE property_feature_translations;
--> statement-breakpoint
DROP TABLE property_features;
--> statement-breakpoint
DROP TABLE property_feature_group_translations;
--> statement-breakpoint
DROP TABLE property_feature_groups;
--> statement-breakpoint
DROP TABLE property_translations;
--> statement-breakpoint
DROP TABLE contacts;
--> statement-breakpoint
DROP TABLE properties;
--> statement-breakpoint
DROP TABLE property_type_translations;
--> statement-breakpoint
DROP TABLE property_types;
--> statement-breakpoint
DROP TABLE map_point_of_interest_translations;
--> statement-breakpoint
DROP TABLE map_points_of_interest;
--> statement-breakpoint
DROP TABLE site_setting_translations;
--> statement-breakpoint
DROP TABLE site_social_links;
--> statement-breakpoint
DROP TABLE site_locales;
--> statement-breakpoint
DROP TABLE site_settings;
--> statement-breakpoint
ALTER TABLE properties_r2 RENAME TO properties;
--> statement-breakpoint
ALTER TABLE media_r2 RENAME TO media;
--> statement-breakpoint
ALTER TABLE contacts_r2 RENAME TO contacts;
--> statement-breakpoint
ALTER TABLE site_settings_r2 RENAME TO site_settings;
--> statement-breakpoint
CREATE INDEX `contacts_status_created_idx` ON `contacts` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `media_property_order_idx` ON `media` (`property_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_object_key_unique` ON `media` (`object_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_one_cover` ON `media` (`property_id`) WHERE "media"."is_cover" = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_code_unique` ON `properties` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_slug_es_unique` ON `properties` (`slug_es`);
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_slug_en_unique` ON `properties` (`slug_en`);
--> statement-breakpoint
CREATE INDEX `properties_status_idx` ON `properties` (`status`);
--> statement-breakpoint
DROP TABLE r2_conversion_guard;
--> statement-breakpoint
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING;
