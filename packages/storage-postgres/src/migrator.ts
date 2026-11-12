import { StorageError, type SchemaStatus } from '@antresol/core'
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

/** Versions 1..SCHEMA_BASE belong to pre-release builds whose schema is gone; they are rejected, not migrated.
 *  The version is not 1 so that an old build sees this one's databases as newer and leaves them alone. */
export const SCHEMA_BASE = 2

export const APP_SCHEMA_VERSION = SCHEMA_BASE + migrations.length

/** Arbitrary Antresol-specific key for pg_advisory_xact_lock; serialises migrations across devices. */
export const MIGRATION_LOCK_KEY = 7164290317

/** Message and SQLSTATE of the error a migration batch raises when another device already moved the version. */
export const CONCURRENT_MIGRATION_MESSAGE = 'antresol_concurrent_migration'
export const CONCURRENT_MIGRATION_SQLSTATE = 'AN001'

export function isConcurrentMigration(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const code = (e as { code?: unknown }).code
  return code === CONCURRENT_MIGRATION_SQLSTATE && e.message.includes(CONCURRENT_MIGRATION_MESSAGE)
}

/** First statement of every write, and of every migration after the advisory lock. Writes run READ COMMITTED, so
 *  without this lock another write could commit between reading the revision and bumping it, and that change would go
 *  unnoticed; with it, writes queue on the revision row and the value read is exactly the revision this write follows.
 *  A migration takes it before touching any table: a write then waits for the whole migration (or the migration for
 *  the write), instead of each holding what the other waits for (a deadlock Postgres would end by aborting one). No row
 *  (hand-edited database, or one the initial migration has not filled yet): nothing to lock. */
export const LOCK_REV: Statement = sql`select value from antresol_meta where key = 'rev' for update`

/** Message and SQLSTATE of the error a write batch raises when the database needs a newer app to write. */
export const NEWER_SCHEMA_MESSAGE = 'antresol_newer_schema'
export const NEWER_SCHEMA_SQLSTATE = 'AN003'

export function isNewerSchema(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (e as { code?: unknown }).code === NEWER_SCHEMA_SQLSTATE && e.message.includes(NEWER_SCHEMA_MESSAGE)
}

/**
 * Right after LOCK_REV in every write batch (Plan 9 spec G3): fails with AN003 when the oldest app schema that may write
 * (`min_app_schema`, or without that row the database's own version, as readSchemaMeta reads them) is above
 * `appVersion`. The status read when the storage opened goes stale once another device migrates; under the revision
 * lock a migration cannot slip in between this check and the write, since migrations take the same lock. A plain
 * statement: fits one Neon HTTP transaction.
 */
export function schemaGuard(appVersion: number): Statement {
  if (!Number.isInteger(appVersion) || appVersion < 0) throw new Error(`invalid app version ${appVersion}`)
  return {
    text: `do $$ begin
  if coalesce((select value from antresol_meta where key = 'min_app_schema'),
              (select value from antresol_meta where key = 'schema_version'))::int > ${appVersion} then
    raise exception '${NEWER_SCHEMA_MESSAGE}' using errcode = '${NEWER_SCHEMA_SQLSTATE}';
  end if;
end $$`,
    params: [],
  }
}

/** Gives `antresol_meta.rev` a new unique value (see storage.ts for why it is opaque); creates the row if it is missing.
 *  Returns the new value (`apply` reports it; a migration ignores it). */
export const REV_BUMP: Statement = {
  text: `insert into antresol_meta (key, value) values ('rev', gen_random_uuid()::text)
  on conflict (key) do update set value = excluded.value
  returning value`,
  params: [],
}

/** Lock (migrations, then the revision row as writes do), then fail unless schema_version is still `expected`. Plain
 *  statements: fits one Neon HTTP transaction. */
function migrationPrologue(expected: number): Statement[] {
  return [
    { text: `select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`, params: [] },
    LOCK_REV,
    {
      text: `do $$ begin
  if coalesce((select value from antresol_meta where key = 'schema_version'), '0')::int <> ${expected} then
    raise exception '${CONCURRENT_MIGRATION_MESSAGE}' using errcode = '${CONCURRENT_MIGRATION_SQLSTATE}';
  end if;
end $$`,
      params: [],
    },
  ]
}

function nonNegativeInteger(value: string, key: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`antresol_meta.${key} is not a non-negative integer`)
  return n
}

export interface SchemaMeta {
  /** 0 when the database has no schema yet. */
  dbVersion: number
  /** The oldest app schema that may write (`antresol_meta.min_app_schema`). Without the row (a database from before soft
   *  migrations) the database's own version: until then every schema needed an app at least as new. */
  minAppSchema: number
}

/** Both versions in one query; throws on a value that is not a non-negative integer (a hand-edited antresol_meta). */
export async function readSchemaMeta(exec: PgExecutor): Promise<SchemaMeta> {
  const rows = await exec.query<{ key: string; value: string }>(
    sql`select key, value from antresol_meta where key in ('schema_version', 'min_app_schema')`,
  )
  const raw = (key: string) => rows.find((r) => r.key === key)?.value
  const version = raw('schema_version')
  const dbVersion = version === undefined ? 0 : nonNegativeInteger(version, 'schema_version')
  const min = raw('min_app_schema')
  return { dbVersion, minAppSchema: min === undefined ? dbVersion : nonNegativeInteger(min, 'min_app_schema') }
}

/**
 * Creates or upgrades the schema to `appVersion`, one migration per batch, and reports whether this app may write.
 * Soft migrations: a database ahead of the app is still writable while its `min_app_schema` is at most `appVersion`;
 * additive migrations leave `min_app_schema` as it is, so older apps keep writing.
 * `appVersion`: tests stand in for an older build with it (its migrations are the first `appVersion - SCHEMA_BASE`).
 */
export async function ensureSchema(exec: PgExecutor, appVersion: number = APP_SCHEMA_VERSION): Promise<SchemaStatus> {
  if (!Number.isInteger(appVersion) || appVersion <= SCHEMA_BASE || appVersion > APP_SCHEMA_VERSION) {
    throw new Error(`no migrations for app version ${appVersion}`)
  }
  // Under the lock, so two devices on a brand-new database cannot race on the create (23505 / 42P07).
  await exec.batch([
    { text: `select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`, params: [] },
    sql`create table if not exists antresol_meta (key text primary key, value text not null)`,
  ])
  for (;;) {
    const { dbVersion, minAppSchema } = await readSchemaMeta(exec)
    if (dbVersion >= 1 && dbVersion <= SCHEMA_BASE) {
      throw new StorageError('outdated', 'the database was created by a pre-release Antresol; reset it')
    }
    if (dbVersion >= appVersion) {
      return { state: minAppSchema > appVersion ? 'newer' : 'ready', dbVersion, appVersion, minAppSchema }
    }
    const version = Math.max(dbVersion, SCHEMA_BASE) + 1
    try {
      await exec.batch([
        ...migrationPrologue(dbVersion),
        ...(migrations[version - SCHEMA_BASE - 1] as Statement[]),
        // A migration may change data without any write passing through `apply`: devices must reload.
        REV_BUMP,
        sql`insert into antresol_meta (key, value) values ('schema_version', ${String(version)})
            on conflict (key) do update set value = excluded.value`,
      ])
    } catch (e) {
      // Another device migrated first: nothing was applied here; re-read the version and carry on.
      if (!isConcurrentMigration(e)) throw e
    }
  }
}
