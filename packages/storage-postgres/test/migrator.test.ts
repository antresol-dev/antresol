import { describe, expect, it } from 'vitest'
import { APP_SCHEMA_VERSION, ensureSchema } from '../src/migrator'
import { sql } from '../src/sql'
import { makeExecutor } from './helpers'

describe('ensureSchema', () => {
  it('migrates an empty database', async () => {
    const exec = await makeExecutor()
    expect(await ensureSchema(exec)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
    })
    const rows = await exec.query<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const names = rows.map((r) => r.table_name)
    expect(names).toContain('items')
    expect(names).toContain('movements')
  })

  it('is idempotent', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    expect(await ensureSchema(exec)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
    })
  })

  it('reports newer when the database is ahead', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await exec.batch([
      sql`update gm_meta set value = ${String(APP_SCHEMA_VERSION + 1)} where key = 'schema_version'`,
    ])
    expect(await ensureSchema(exec)).toEqual({
      state: 'newer',
      dbVersion: APP_SCHEMA_VERSION + 1,
      appVersion: APP_SCHEMA_VERSION,
    })
  })
})

describe('PgExecutor.batch', () => {
  it('is atomic', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await expect(
      exec.batch([
        sql`insert into gm_meta (key, value) values ('a', '1')`,
        sql`insert into gm_meta (key, value) values ('a', '2')`,
      ]),
    ).rejects.toThrow()
    expect(await exec.query(sql`select 1 from gm_meta where key = 'a'`)).toEqual([])
  })
})
