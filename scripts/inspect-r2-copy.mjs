/** Read-only report on an explicitly supplied SQLite copy. Never connects to D1 or R2. */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
const file = process.argv[2];
if (!file) throw new Error('Uso: node scripts/inspect-r2-copy.mjs RUTA_A_COPIA.sqlite');
const db = new DatabaseSync(resolve(file), { readOnly: true });
try {
  const final =
    db.prepare("SELECT count(*) n FROM pragma_table_info('properties') WHERE name='status'").get()
      .n === 1;
  if (final) console.log(JSON.stringify({ schema: 'R2', alreadyMigrated: true }));
  else
    console.log(
      JSON.stringify(
        {
          schema: 'legacy',
          excludedMedia: db
            .prepare(
              "SELECT media_kind kind,count(*) total FROM property_media WHERE source_provider='r2' AND media_kind IN ('document','video') GROUP BY media_kind",
            )
            .all(),
          inactiveSocialLinks: db
            .prepare('SELECT count(*) total FROM site_social_links WHERE is_active=0')
            .get().total,
          objectsDeleted: 0,
        },
        null,
        2,
      ),
    );
} finally {
  db.close();
}
