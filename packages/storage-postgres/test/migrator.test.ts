import { StorageError } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { APP_SCHEMA_VERSION, MIGRATION_LOCK_KEY, SCHEMA_BASE, ensureSchema, isConcurrentMigration } from '../src/migrator'
import { sql } from '../src/sql'
import journal from '../migrations/meta/_journal.json'
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
    expect(APP_SCHEMA_VERSION).toBe(3)
    expect(await exec.query(sql`select 1 from gm_meta where key = 'rev'`)).toHaveLength(1)
  })

  it('rejects a pre-release database as outdated and leaves it as it was', async () => {
    const exec = await makeExecutor()
    await exec.batch([
      sql`create table gm_meta (key text primary key, value text not null)`,
      sql`insert into gm_meta (key, value) values ('schema_version', '2')`,
    ])
    const err = await ensureSchema(exec).catch((e) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect(err.code).toBe('outdated')
    expect(await exec.query(sql`select value from gm_meta where key = 'schema_version'`)).toEqual([{ value: '2' }])
    expect(await exec.query(sql`select 1 from information_schema.tables where table_name = 'items'`)).toEqual([])
  })

  it('two devices on an empty database both end ready', async () => {
    const exec = await makeExecutor()
    const results = await Promise.all([ensureSchema(exec), ensureSchema(exec)])
    expect(results.map((r) => r.state)).toEqual(['ready', 'ready'])
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
    const rejections: unknown[] = []
    const wrapped: PgExecutor = {
      ...exec,
      query: (s) => exec.query(s),
      batch: async (statements) => {
        batches.push(statements.map((s) => s.text))
        if (onBatch) await onBatch(batches.length)
        try {
          return await exec.batch(statements)
        } catch (e) {
          rejections.push(e)
          throw e
        }
      },
    }
    return { wrapped, batches, rejections }
  }

  it('creates gm_meta only after taking the lock', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const first = batches[0] as string[]
    expect(first[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`)
    expect(first[1]).toContain('create table if not exists gm_meta')
    for (const b of batches) {
      const touch = b.findIndex((t) => t.includes('gm_meta'))
      const lock = b.findIndex((t) => t.includes('pg_advisory_xact_lock'))
      expect(lock).toBeGreaterThanOrEqual(0)
      expect(lock).toBeLessThan(touch)
    }
  })

  it('fails clearly on a non-integer schema_version', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await exec.batch([sql`update gm_meta set value = 'abc' where key = 'schema_version'`])
    await expect(ensureSchema(exec)).rejects.toThrow('schema_version is not a non-negative integer')
  })

  it('isConcurrentMigration matches precisely', () => {
    const make = (message: string, code?: string) => Object.assign(new Error(message), { code })
    expect(isConcurrentMigration(make('gm_concurrent_migration', 'GM001'))).toBe(true)
    expect(isConcurrentMigration(make('gm_concurrent_migration', '23505'))).toBe(false)
    expect(isConcurrentMigration(make('something else', 'GM001'))).toBe(false)
    expect(isConcurrentMigration('gm_concurrent_migration')).toBe(false)
    expect(isConcurrentMigration(null)).toBe(false)
  })

  it('starts every migration batch with the advisory lock and a version guard', async () => {
    const { wrapped, batches } = recording(await makeExecutor())
    await ensureSchema(wrapped)
    const migrationBatches = batches.filter((b) => b.some((t) => t.includes('schema_version')))
    expect(migrationBatches).toHaveLength(APP_SCHEMA_VERSION - SCHEMA_BASE)
    for (const b of migrationBatches) {
      expect(b[0]).toBe(`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`)
      expect(b[1]).toContain('gm_concurrent_migration')
    }
  })

  it('loser of the race re-reads the version, applies nothing twice and does not throw', async () => {
    const exec = await makeExecutor()
    let raced = false
    // Right before the wrapped device's first migration batch, another device finishes the whole migration.
    const { wrapped, batches, rejections } = recording(exec, async (seen) => {
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
    expect(batches.filter((b) => b.some((t) => t.includes('gm_concurrent_migration')))).toHaveLength(1)
    expect(rejections).toHaveLength(1)
    expect(isConcurrentMigration(rejections[0])).toBe(true)
    expect((rejections[0] as { code?: string }).code).toBe('GM001')
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
    ).rejects.toThrow(/duplicate key/)
    expect(await exec.query(sql`select 1 from gm_meta where key = 'a'`)).toEqual([])
  })
})

describe('migration files', () => {
  it('match the drizzle journal one to one, in order', () => {
    const files = Object.keys(
      import.meta.glob('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
    )
      .map((p) => p.replace('../migrations/', '').replace('.sql', ''))
      .sort()
    expect(journal.entries.map((e) => e.tag)).toEqual(files)
    expect(journal.entries.map((e) => e.idx)).toEqual(files.map((_, i) => i))
    expect(APP_SCHEMA_VERSION).toBe(SCHEMA_BASE + files.length)
  })
})
