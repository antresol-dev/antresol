import type { SchemaInspection } from '@graymatter/core'
import type { PgExecutor } from './executor'
import { APP_SCHEMA_VERSION } from './migrator'
import { sql } from './sql'

/** Schemas that belong to Postgres or the hosting platform, not to a user's data. */
const IGNORED_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'neon_auth',
  'pgrst',
  'auth',
  'extensions',
  'graphql',
  'graphql_public',
  'realtime',
  'storage',
  'vault',
]

const IGNORED_SQL = IGNORED_SCHEMAS.map((n) => `'${n}'`).join(', ')

/** Read-only look at what the database holds; never writes. */
export async function inspectSchema(exec: PgExecutor): Promise<SchemaInspection> {
  // IGNORED_SQL is a constant list of identifiers, not input.
  const [counts] = await exec.query<{ tables: number; meta: number }>({
    text: `select (select count(*) from information_schema.tables
                    where table_schema not in (${IGNORED_SQL}) and table_schema !~ '^pg_(toast_)?temp_')::int as tables,
                   (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'gm_meta')::int as meta`,
    params: [],
  })
  if (!counts || counts.tables === 0) return { state: 'empty' }
  if (counts.meta === 0) return { state: 'foreign' }
  const rows = await exec.query<{ value: string }>(sql`select value from gm_meta where key = 'schema_version'`)
  const dbVersion = rows[0] ? Number(rows[0].value) : 0
  const state = dbVersion < APP_SCHEMA_VERSION ? 'older' : dbVersion === APP_SCHEMA_VERSION ? 'current' : 'newer'
  return { state, dbVersion, appVersion: APP_SCHEMA_VERSION }
}
