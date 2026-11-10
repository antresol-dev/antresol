import type { SchemaStatus } from '@graymatter/core'
import type { PgExecutor } from './executor'
import { sql, type Statement } from './sql'

const files = import.meta.glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const migrations: Statement[][] = Object.keys(files)
  .sort()
  .map((path) =>
    (files[path] as string)
      .split('--> statement-breakpoint')
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .map((text) => ({ text, params: [] })),
  )

export const APP_SCHEMA_VERSION = migrations.length

/** Arbitrary GrayMatter-specific key for pg_advisory_xact_lock; serialises migrations across devices. */
export const MIGRATION_LOCK_KEY = 7164290317

/** Message and SQLSTATE of the error a migration batch raises when another device already moved the version. */
export const CONCURRENT_MIGRATION_MESSAGE = 'gm_concurrent_migration'
export const CONCURRENT_MIGRATION_SQLSTATE = 'GM001'

export function isConcurrentMigration(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const code = (e as { code?: unknown }).code
  return code === CONCURRENT_MIGRATION_SQLSTATE && e.message.includes(CONCURRENT_MIGRATION_MESSAGE)
}

/** Lock, then fail unless schema_version is still `expected`. Plain statements: fits one Neon HTTP transaction. */
function migrationPrologue(expected: number): Statement[] {
  return [
    { text: `select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`, params: [] },
    {
      text: `do $$ begin
  if coalesce((select value from gm_meta where key = 'schema_version'), '0')::int <> ${expected} then
    raise exception '${CONCURRENT_MIGRATION_MESSAGE}' using errcode = '${CONCURRENT_MIGRATION_SQLSTATE}';
  end if;
end $$`,
      params: [],
    },
  ]
}

async function readVersion(exec: PgExecutor): Promise<number> {
  const rows = await exec.query<{ value: string }>(sql`select value from gm_meta where key = 'schema_version'`)
  return rows[0] ? Number(rows[0].value) : 0
}

export async function ensureSchema(exec: PgExecutor): Promise<SchemaStatus> {
  await exec.batch([sql`create table if not exists gm_meta (key text primary key, value text not null)`])
  for (;;) {
    const dbVersion = await readVersion(exec)
    if (dbVersion > APP_SCHEMA_VERSION) return { state: 'newer', dbVersion, appVersion: APP_SCHEMA_VERSION }
    if (dbVersion === APP_SCHEMA_VERSION) {
      return { state: 'ready', dbVersion: APP_SCHEMA_VERSION, appVersion: APP_SCHEMA_VERSION }
    }
    const version = dbVersion + 1
    try {
      await exec.batch([
        ...migrationPrologue(dbVersion),
        ...(migrations[version - 1] as Statement[]),
        sql`insert into gm_meta (key, value) values ('schema_version', ${String(version)})
            on conflict (key) do update set value = excluded.value`,
      ])
    } catch (e) {
      // Another device migrated first: nothing was applied here; re-read the version and carry on.
      if (!isConcurrentMigration(e)) throw e
    }
  }
}
