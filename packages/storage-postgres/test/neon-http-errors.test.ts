import { neonConfig } from '@neondatabase/serverless'
import { afterEach, describe, expect, it } from 'vitest'
import { StorageError } from '@graymatter/core'
import { createNeonHttpExecutor } from '../src/executors/neon-http'
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
    for (const run of [() => exec.query(sql`select 1`), () => exec.batch([sql`select 1`])]) {
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
})
