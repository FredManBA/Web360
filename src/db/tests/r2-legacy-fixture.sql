INSERT INTO properties (id,code,property_type_id,publication_status,commercial_status,is_featured,price_mode,price_amount_minor,currency_code,area_square_meters,province,canton,district,locality,public_latitude,public_longitude,private_latitude,private_longitude,published_at)
VALUES (7,'CR360-012',(SELECT id FROM property_types WHERE system_key='lot'),'published','sold',1,'exact',1234500,'USD',1250,'Guanacaste','Nicoya','Nosara','Guiones',9.9,-84.1,9.87654321,-84.98765432,1700000000);
INSERT INTO property_translations (property_id,locale,slug,title,marketing_description,technical_description) VALUES
(7,'es','lote-migrado','Lote migrado','Descripción conservada','Detalles conservados'),
(7,'en','migrated-lot','Migrated lot','Preserved description','Preserved details');
INSERT INTO property_feature_groups (id,property_id,sort_order) VALUES (10,7,0);
INSERT INTO property_feature_group_translations (property_feature_group_id,locale,name) VALUES (10,'es','Servicios'),(10,'en','Utilities');
INSERT INTO property_features (id,property_id,property_feature_group_id,sort_order) VALUES (11,7,10,1);
INSERT INTO property_feature_translations (property_feature_id,locale,label,value) VALUES (11,'es','Agua','Sí'),(11,'en','Water','Yes');
INSERT INTO property_media (id,property_id,media_kind,source_provider,object_key,is_catalog_cover,is_hero,sort_order,mime_type) VALUES
(10,7,'image','r2','fixture/image.png',1,1,2,'image/png'),
(12,7,'panorama','r2','fixture/panorama-a.jpg',0,0,3,'image/jpeg'),
(13,7,'panorama','r2','fixture/panorama-b.jpg',0,0,4,'image/jpeg');
INSERT INTO property_media (id,property_id,media_kind,source_provider,youtube_video_id,sort_order) VALUES (14,7,'video','youtube','abcdefghijk',5);
INSERT INTO property_media_translations (property_media_id,locale,alt_text) VALUES (10,'es','Vista del lote'),(10,'en','Lot view');
INSERT INTO property_tour_nodes (id,property_id,property_media_id,sort_order,is_start,initial_yaw,initial_pitch,initial_fov) VALUES
(100,7,12,0,0,0.5,-0.1,70),(101,7,13,1,1,1.4,0.2,80);
INSERT INTO property_tour_node_translations (property_tour_node_id,locale,name) VALUES (100,'es','Entrada'),(100,'en','Entrance'),(101,'es','Mirador'),(101,'en','Lookout');
INSERT INTO property_tour_links (id,from_node_id,to_node_id,yaw,pitch,sort_order) VALUES (20,100,101,1.4,-0.1,0),(21,101,100,-1.2,0.2,0);
INSERT INTO site_settings (id,business_name,notifications_email,logo_object_key,favicon_object_key,default_social_image_object_key,home_hero_object_key) VALUES (1,'Fixture R2','internal@example.test','fixture/logo.png','fixture/favicon.png','fixture/social.png','fixture/hero.png');
INSERT INTO site_setting_translations (site_settings_id,locale,home_hero_title,brand_tagline) VALUES (1,'es','Portada migrada','Lema ES'),(1,'en','Migrated home','Tagline EN');
INSERT INTO site_social_links (platform,url,sort_order,is_active) VALUES ('Instagram','https://instagram.com/example',0,1);
INSERT INTO contacts (id,property_id,name,preferred_contact_method,contact_value,message,locale,status,consent_accepted_at) VALUES (8,7,'Ana','email','ana@example.test','Consulta conservada','es','new',1700000001);
