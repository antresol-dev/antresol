import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageError } from '@graymatter/core'
import { createNeonWsExecutor } from '../src/executors/neon-ws'
import { sql } from '../src/sql'

/** A scripted stand-in for the driver's Pool: every client query is recorded, and `failOn` makes matching ones fail. */
const pool = vi.hoisted(() => ({
  connectError: null as Error | null,
  failOn: new Map<string, Error>(),
  log: [] as string[],
  connects: 0,
  releases: 0,
  ended: 0,
}))

vi.mock('@neondatabase/serverless', () => {
  class FakePool {
    async query(): Promise<{ rows: unknown[] }> {
      return { rows: [] }
    }
    async connect() {
      pool.connects++
      if (pool.connectError) throw pool.connectError
      return {
        query: async (text: string) => {
          pool.log.push(text)
          const error = pool.failOn.get(text)
          if (error) throw error
          return { rows: [{ ok: true }] }
        },
        release: () => {
          pool.releases++
        },
      }
    }
    async end() {
      pool.ended++
    }
  }
  return { neonConfig: {}, Pool: FakePool }
})

const URL = 'postgresql://u:secret@ep-x.eu-central-1.aws.neon.tech/db_test'

beforeEach(() => {
  Object.assign(pool, { connectError: null, log: [], connects: 0, releases: 0, ended: 0 })
  pool.failOn.clear()
})

describe('neon ws executor errors', () => {
  it('maps a failed connect to unavailable, in batch and readBatch, taking and releasing no client', async () => {
    pool.connectError = new Error('connect ETIMEDOUT secret')
    const exec = createNeonWsExecutor(URL)
    for (const run of [() => exec.batch([sql`select 1`]), () => exec.readBatch([sql`select 1`])]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).code).toBe('unavailable')
      expect((error as StorageError).message).not.toContain('secret')
    }
    expect(pool.log).toEqual([])
    expect(pool.releases).toBe(0)
  })

  it('rolls back once, releases once and rethrows the SQL error when a statement fails after connecting', async () => {
    const failure = Object.assign(new Error('duplicate key'), { code: '23505' })
    pool.failOn.set('select 2', failure)
    const exec = createNeonWsExecutor(URL)
    await expect(exec.batch([sql`select 1`, sql`select 2`, sql`select 3`])).rejects.toBe(failure)
    expect(pool.log).toEqual(['BEGIN', 'select 1', 'select 2', 'ROLLBACK'])
    expect(pool.connects).toBe(1)
    expect(pool.releases).toBe(1)
  })

  it('keeps the original error when the rollback fails too, and still releases once', async () => {
    const failure = new Error('statement failed')
    pool.failOn.set('select 1', failure)
    pool.failOn.set('ROLLBACK', new Error('connection lost'))
    const exec = createNeonWsExecutor(URL)
    await expect(exec.batch([sql`select 1`])).rejects.toBe(failure)
    expect(pool.log).toEqual(['BEGIN', 'select 1', 'ROLLBACK'])
    expect(pool.releases).toBe(1)
  })

  it('does the same for readBatch, in a read-only repeatable-read transaction', async () => {
    const failure = new Error('statement failed')
    pool.failOn.set('select 1', failure)
    const exec = createNeonWsExecutor(URL)
    await expect(exec.readBatch([sql`select 1`])).rejects.toBe(failure)
    expect(pool.log).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'select 1', 'ROLLBACK'])
    expect(pool.releases).toBe(1)
  })

  it('does not roll back after a failed COMMIT twice and releases once', async () => {
    const failure = new Error('commit failed')
    pool.failOn.set('COMMIT', failure)
    const exec = createNeonWsExecutor(URL)
    await expect(exec.batch([sql`select 1`])).rejects.toBe(failure)
    expect(pool.log).toEqual(['BEGIN', 'select 1', 'COMMIT', 'ROLLBACK'])
    expect(pool.releases).toBe(1)
  })

  it('commits and releases on success, and close() ends the pool', async () => {
    const exec = createNeonWsExecutor(URL)
    await exec.batch([sql`select 1`])
    expect(pool.log).toEqual(['BEGIN', 'select 1', 'COMMIT'])
    expect(pool.releases).toBe(1)
    await exec.close()
    expect(pool.ended).toBe(1)
  })
})
