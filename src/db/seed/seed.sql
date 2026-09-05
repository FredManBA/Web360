-- CodeLoba - seed minimo.
--
-- Idempotente: puede ejecutarse tantas veces como haga falta sin duplicar
-- filas. Se apoya en los UNIQUE que ya existen en el esquema
-- (property_types.system_key, property_type_translations(type, locale) y
-- site_locales.locale), asi que ON CONFLICT DO NOTHING basta y no hacen falta
-- comprobaciones previas.
--
-- Solo instala datos que el codigo da por supuestos: los tipos de propiedad
-- predefinidos y los idiomas del sitio. No crea site_settings.
--
--   npm run db:seed:local

-- Tipos de propiedad predefinidos ------------------------------------------
INSERT INTO property_types (system_key) VALUES
  ('lot'),
  ('house'),
  ('farm'),
  ('land'),
  ('commercial'),
  ('other')
ON CONFLICT (system_key) DO NOTHING;

-- Nombres en espanol --------------------------------------------------------
INSERT INTO property_type_translations (property_type_id, locale, name)
SELECT id, 'es', CASE system_key
    WHEN 'lot' THEN 'Lote'
    WHEN 'house' THEN 'Casa'
    WHEN 'farm' THEN 'Finca'
    WHEN 'land' THEN 'Terreno'
    WHEN 'commercial' THEN 'Comercial'
    WHEN 'other' THEN 'Otro'
  END
FROM property_types
WHERE system_key IN ('lot', 'house', 'farm', 'land', 'commercial', 'other')
ON CONFLICT (property_type_id, locale) DO NOTHING;

-- Nombres en ingles ---------------------------------------------------------
INSERT INTO property_type_translations (property_type_id, locale, name)
SELECT id, 'en', CASE system_key
    WHEN 'lot' THEN 'Lot'
    WHEN 'house' THEN 'House'
    WHEN 'farm' THEN 'Farm'
    WHEN 'land' THEN 'Land'
    WHEN 'commercial' THEN 'Commercial'
    WHEN 'other' THEN 'Other'
  END
FROM property_types
WHERE system_key IN ('lot', 'house', 'farm', 'land', 'commercial', 'other')
ON CONFLICT (property_type_id, locale) DO NOTHING;

-- Idiomas del sitio ---------------------------------------------------------
-- Espanol activo y por defecto; ingles activo. El indice parcial del esquema
-- ya garantiza que solo haya un idioma por defecto.
INSERT INTO site_locales (locale, is_active, is_default, sort_order) VALUES
  ('es', 1, 1, 0),
  ('en', 1, 0, 1)
ON CONFLICT (locale) DO NOTHING;
