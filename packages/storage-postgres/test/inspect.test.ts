import { describe, expect, it } from 'vitest'
import { inspectSchema } from '../src/inspect'
import { APP_SCHEMA_VERSION } from '../src/migrator'
import { openPostgresStorage } from '../src/storage'
import { sql } from '../src/sql'
import { makeExecutor } from './helpers'

describe('inspectSchema', () => {
  it('reports a new database as empty', async () => {
    expect(await inspectSchema(await makeExecutor())).toEqual({ state: 'empty' })
  })

  it('reports current, newer and older versions', async () => {
    const exec = await makeExecutor()
    await openPostgresStorage(exec)
    const v = APP_SCHEMA_VERSION
    expect(await inspectSchema(exec)).toEqual({ state: 'current', dbVersion: v, appVersion: v })
    await exec.batch([sql`update gm_meta set value = ${String(v + 1)}`])
    expect(await inspectSchema(exec)).toEqual({ state: 'newer', dbVersion: v + 1, appVersion: v })
    await exec.batch([sql`update gm_meta set value = '0'`])
    expect(await inspectSchema(exec)).toEqual({ state: 'older', dbVersion: 0, appVersion: v })
  })

  it('reports a database with foreign tables as foreign and refuses to open it without writing', async () => {
    const exec = await makeExecutor()
    await exec.batch([sql`create table customers (id int)`])
    expect(await inspectSchema(exec)).toEqual({ state: 'foreign' })
    await expect(openPostgresStorage(exec)).rejects.toMatchObject({ code: 'incompatible' })
    const rows = await exec.query<{ n: number }>(
      sql`select count(*)::int as n from information_schema.tables where table_name = 'gm_meta'`,
    )
    expect(rows[0]?.n).toBe(0)
  })
})
