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

export async function ensureSchema(exec: PgExecutor): Promise<SchemaStatus> {
  await exec.batch([sql`create table if not exists gm_meta (key text primary key, value text not null)`])
  const rows = await exec.query<{ value: string }>(sql`select value from gm_meta where key = 'schema_version'`)
  const dbVersion = rows[0] ? Number(rows[0].value) : 0

  if (dbVersion > APP_SCHEMA_VERSION) {
    return { state: 'newer', dbVersion, appVersion: APP_SCHEMA_VERSION }
  }
  for (let version = dbVersion + 1; version <= APP_SCHEMA_VERSION; version++) {
    await exec.batch([
      ...(migrations[version - 1] as Statement[]),
      sql`insert into gm_meta (key, value) values ('schema_version', ${String(version)})
          on conflict (key) do update set value = excluded.value`,
    ])
  }
  return { state: 'ready', dbVersion: APP_SCHEMA_VERSION, appVersion: APP_SCHEMA_VERSION }
}
