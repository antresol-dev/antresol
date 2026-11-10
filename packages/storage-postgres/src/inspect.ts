import type { SchemaInspection } from '@graymatter/core'
import type { PgExecutor } from './executor'
import { APP_SCHEMA_VERSION } from './migrator'
import { sql } from './sql'

/** Read-only look at what the database holds; never writes. */
export async function inspectSchema(exec: PgExecutor): Promise<SchemaInspection> {
  const [counts] = await exec.query<{ tables: number; meta: number }>(
    sql`select (select count(*) from information_schema.tables where table_schema = 'public')::int as tables,
               (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'gm_meta')::int as meta`,
  )
  if (!counts || counts.tables === 0) return { state: 'empty' }
  if (counts.meta === 0) return { state: 'foreign' }
  const rows = await exec.query<{ value: string }>(sql`select value from gm_meta where key = 'schema_version'`)
  const dbVersion = rows[0] ? Number(rows[0].value) : 0
  const state = dbVersion < APP_SCHEMA_VERSION ? 'older' : dbVersion === APP_SCHEMA_VERSION ? 'current' : 'newer'
  return { state, dbVersion, appVersion: APP_SCHEMA_VERSION }
}
