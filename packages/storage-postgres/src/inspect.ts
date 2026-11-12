import type { SchemaInspection } from '@antresol/core'
import type { PgExecutor } from './executor'
import { APP_SCHEMA_VERSION, readSchemaMeta, SCHEMA_BASE } from './migrator'

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
  // IGNORED_SQL is a constant list of identifiers, not input. Only ordinary and partitioned tables count, and
  // not the ones an extension owns (pg_depend deptype 'e'), so a fresh platform database stays empty.
  const [counts] = await exec.query<{ tables: number; meta: number }>({
    text: `select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where c.relkind in ('r', 'p')
                      and n.nspname not in (${IGNORED_SQL}) and n.nspname !~ '^pg_(toast_)?temp_'
                      and not exists (select 1 from pg_depend d
                                       where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'))::int as tables,
                   (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'antresol_meta')::int as meta`,
    params: [],
  })
  if (!counts || counts.tables === 0) return { state: 'empty' }
  if (counts.meta === 0) return { state: 'foreign' }
  const { dbVersion, minAppSchema } = await readSchemaMeta(exec)
  // 1..SCHEMA_BASE: a pre-release build's schema, which ensureSchema refuses (`outdated`) rather than upgrades. At or
  // above this app's version it is `current` while this app may write it (soft migrations), as ensureSchema decides.
  const state =
    dbVersion >= 1 && dbVersion <= SCHEMA_BASE
      ? 'outdated'
      : dbVersion < APP_SCHEMA_VERSION
        ? 'older'
        : minAppSchema > APP_SCHEMA_VERSION
          ? 'newer'
          : 'current'
  return { state, dbVersion, appVersion: APP_SCHEMA_VERSION }
}
