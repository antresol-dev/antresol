import { neonConfig } from '@neondatabase/serverless'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageError } from '@antresol/core'
import { createNeonHttpExecutor, HTTP_FIRST_BYTE_MS, HTTP_TOTAL_MS } from '../src/executors/neon-http'
import { sql } from '../src/sql'

const URL = 'postgresql://u:secret@ep-x.eu-central-1.aws.neon.tech/db_test'
const original = neonConfig.fetchFunction

afterEach(() => {
  neonConfig.fetchFunction = original
})

describe('neon http executor errors', () => {
  it('maps network failures to unavailable without leaking the password', async () => {
    neonConfig.fetchFunction = async () => {
      throw new TypeError('Failed to fetch')
    }
    const exec = createNeonHttpExecutor(URL)
    for (const run of [
      () => exec.query(sql`select 1`),
      () => exec.batch([sql`select 1`]),
      () => exec.readBatch([sql`select 1`]),
    ]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).code).toBe('unavailable')
      expect((error as StorageError).message).not.toContain('secret')
    }
  })

  it('passes SQL errors through untouched', async () => {
    neonConfig.fetchFunction = async () =>
      new Response(JSON.stringify({ message: 'syntax error', code: '42601' }), { status: 400 })
    const error = await createNeonHttpExecutor(URL)
      .query(sql`select 1`)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(StorageError)
  })

  it('times out a request that never answers, as unavailable', async () => {
    neonConfig.fetchFunction = (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 50, totalMs: 50 })
    for (const run of [
      () => exec.query(sql`select 1`),
      () => exec.batch([sql`select 1`]),
      () => exec.readBatch([sql`select 1`]),
    ]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).code).toBe('unavailable')
    }
  })

  it('maps an HTTP 5xx to unavailable', async () => {
    neonConfig.fetchFunction = async () => new Response('upstream down', { status: 503 })
    const exec = createNeonHttpExecutor(URL)
    for (const run of [
      () => exec.query(sql`select 1`),
      () => exec.batch([sql`select 1`]),
      () => exec.readBatch([sql`select 1`]),
    ]) {
      const error = await run().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).code).toBe('unavailable')
    }
  })

  it('exports the default timeouts', () => {
    expect(HTTP_FIRST_BYTE_MS).toBe(15_000)
    expect(HTTP_TOTAL_MS).toBe(90_000)
  })
})
