INSERT INTO site_settings (id,business_name,default_currency_code) VALUES (1,'Costa Rica 360','USD') ON CONFLICT(id) DO NOTHING;
