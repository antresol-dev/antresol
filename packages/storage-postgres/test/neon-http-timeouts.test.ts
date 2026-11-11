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

const BODY = JSON.stringify({
  command: 'SELECT',
  rowCount: 1,
  rows: [['1']],
  fields: [{ name: 'n', dataTypeID: 25, tableID: 0, columnID: 0, dataTypeSize: -1, dataTypeModifier: -1, format: 'text' }],
})
const batchBody = JSON.stringify({ results: [JSON.parse(BODY)] })
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A response whose headers come at once and whose body arrives `bodyMs` later. */
const slowBody = (text: string, bodyMs: number) => (_url: unknown, init?: { signal?: AbortSignal }) => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Like a real fetch, an abort errors the body that is still downloading.
      let aborted = false
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        controller.error(init.signal?.reason)
      })
      await sleep(bodyMs)
      if (aborted) return
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  return Promise.resolve(new Response(stream, { status: 200 }))
}

/** Never answers, but honours the abort signal. */
const silent = (_url: unknown, init?: { signal?: AbortSignal }) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })

describe('neon http timeouts', () => {
  it('a write that has not started to answer after the first-byte limit is unavailable', async () => {
    neonConfig.fetchFunction = silent
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 40, totalMs: 5_000 })
    const started = Date.now()
    const error = await exec.batch([sql`select 1`]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('a write whose response has started is not cut off by the first-byte limit', async () => {
    neonConfig.fetchFunction = slowBody(batchBody, 150)
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 40, totalMs: 5_000 })
    await expect(exec.batch([sql`select 1`])).resolves.toHaveLength(1)
  })

  it('a read that started answering is not cut off while the body downloads, up to the total limit', async () => {
    neonConfig.fetchFunction = slowBody(batchBody, 150)
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 40, totalMs: 5_000 })
    await expect(exec.readBatch([sql`select 1`])).resolves.toHaveLength(1)
  })

  it('a read has no first-byte limit, only the total one', async () => {
    neonConfig.fetchFunction = silent
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 30, totalMs: 200 })
    const started = Date.now()
    const error = await exec.readBatch([sql`select 1`]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(Date.now() - started).toBeGreaterThanOrEqual(180)
  })

  it('a body slower than the total limit is unavailable', async () => {
    neonConfig.fetchFunction = slowBody(batchBody, 500)
    const exec = createNeonHttpExecutor(URL, { firstByteMs: 30, totalMs: 100 })
    const error = await exec.readBatch([sql`select 1`]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
  })

  it('reports the size of each response body', async () => {
    neonConfig.fetchFunction = async () => new Response(batchBody, { status: 200 })
    const sizes: number[] = []
    const exec = createNeonHttpExecutor(URL, { onTraffic: (b) => sizes.push(b) })
    await exec.readBatch([sql`select 1`])
    expect(sizes).toEqual([new TextEncoder().encode(batchBody).byteLength])
  })
})
