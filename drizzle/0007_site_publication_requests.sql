-- Publicacion global del sitio.
--
-- Tres cambios sobre `publication_requests`, y los tres obligan a recrear la
-- tabla porque SQLite no sabe quitar un NOT NULL ni anadir un CHECK:
--
--   1. `property_id` pasa a nullable. Solo lo usa `publish_site`, que no habla
--      de ninguna propiedad; el CHECK de alcance impide que un `publish` o un
--      `unpublish` se queden sin ella.
--   2. `action` admite `publish_site`.
--   3. El candado deja de ser por propiedad y pasa a ser global: cada build
--      genera el sitio ENTERO, asi que dos operaciones vivas cualesquiera
--      producen artefactos incompatibles. `active_lock` es una columna
--      generada que vale 1 mientras la fila esta viva y NULL cuando termina;
--      el UNIQUE sobre ella deja pasar una y bloquea la siguiente.
--
-- Las filas historicas se copian tal cual, con sus ids, timestamps, hashes de
-- token, referencias de trabajo, estados y errores. `active_lock` no se copia
-- porque no se puede: la calcula SQLite a partir de `status`.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publication_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`active_lock` integer GENERATED ALWAYS AS (CASE WHEN status IN ('pending', 'building') THEN 1 END) VIRTUAL,
	`callback_token_hash` text NOT NULL,
	`job_ref` text,
	`error_summary` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "publication_requests_action_check" CHECK("__new_publication_requests"."action" IN ('publish', 'unpublish', 'publish_site')),
	CONSTRAINT "publication_requests_scope_check" CHECK(("__new_publication_requests"."action" = 'publish_site' AND "__new_publication_requests"."property_id" IS NULL)
          OR ("__new_publication_requests"."action" <> 'publish_site' AND "__new_publication_requests"."property_id" IS NOT NULL)),
	CONSTRAINT "publication_requests_status_check" CHECK("__new_publication_requests"."status" IN ('pending', 'building', 'done', 'failed', 'abandoned')),
	CONSTRAINT "publication_requests_callback_token_hash_not_blank_check" CHECK(length(trim("__new_publication_requests"."callback_token_hash")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_publication_requests`("id", "property_id", "action", "status", "callback_token_hash", "job_ref", "error_summary", "requested_at", "started_at", "finished_at", "created_at", "updated_at") SELECT "id", "property_id", "action", "status", "callback_token_hash", "job_ref", "error_summary", "requested_at", "started_at", "finished_at", "created_at", "updated_at" FROM `publication_requests`;--> statement-breakpoint
DROP TABLE `publication_requests`;--> statement-breakpoint
ALTER TABLE `__new_publication_requests` RENAME TO `publication_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_single_active_idx` ON `publication_requests` (`active_lock`);--> statement-breakpoint
CREATE INDEX `publication_requests_property_created_at_idx` ON `publication_requests` (`property_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_requests_callback_token_hash_unique` ON `publication_requests` (`callback_token_hash`);