import { describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { APP_SCHEMA_VERSION, MIGRATION_LOCK_KEY, ensureSchema } from '../src/migrator'
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

describe('ensureSchema concurrency', () => {
  function recording(exec: PgExecutor, onBatch?: (seen: number) => Promise<void>) {
    const batches: string[][] = []
    const wrapped: PgExecutor = {
      ...exec,
      query: (s) => exec.query(s),
      batch: async (statements) => {
        batches.push(statements.map((s) => s.text))
        if (onBatch) await onBatch(batches.length)
        return exec.batch(statements)
      },
    }
    return { wrapped, batches }
  }

  it('starts every migration batch with the advisory lock and a version guard', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('schema_version')))
    expect(migrationBatches).toHaveLength(APP_SCHEMA_VERSION)
    for (const b of migrationBatches) {
      expect(b[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`)
      expect(b[1]).toContain('gm_concurrent_migration')
    }
  })

  it('loser of the race re-reads the version, applies nothing twice and does not throw', async () => {
    const exec = await makeExecutor()
    let raced = false
    // Right before the wrapped device's first migration batch, another device finishes the whole migration.
    const { wrapped, batches } = recording(exec, async (seen) => {
      if (raced || seen < 2) return
      raced = true
      await ensureSchema(exec)
    })
    expect(await ensureSchema(wrapped)).toEqual({
      state: 'ready',
      dbVersion: APP_SCHEMA_VERSION,
      appVersion: APP_SCHEMA_VERSION,
    })
    expect(raced).toBe(true)
    // gm_meta create + exactly one rejected migration batch; nothing re-applied.
    expect(batches.filter((b) => b[0]?.startsWith('select pg_advisory_xact_lock'))).toHaveLength(1)
    expect(await exec.query(sql`select 1 from gm_meta where key = 'schema_version'`)).toHaveLength(1)
  })

  it('does not swallow other errors', async () => {
    const exec = await makeExecutor()
    const failing: PgExecutor = {
      ...exec,
      batch: async (s) => {
        if (s[0]?.text.startsWith('select pg_advisory_xact_lock')) throw new Error('boom')
        return exec.batch(s)
      },
    }
    await expect(ensureSchema(failing)).rejects.toThrow('boom')
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
