import { describe, expect, it } from 'vitest'
import { newId } from '@antresol/core'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor } from './helpers'

describe('read errors', () => {
  it('loadInventory of an unknown id is not_found', async () => {
    const { storage } = await openPostgresStorage(await makeExecutor())
    await expect(storage.loadInventory(newId())).rejects.toMatchObject({ name: 'StorageError', code: 'not_found' })
  })

  it('wraps unexpected read failures as failed, keeping the cause', async () => {
    const exec = await makeExecutor()
    let broken = false
    const wrapped = {
      ...exec,
      readBatch: (s: Parameters<typeof exec.readBatch>[0]) => {
        if (broken) throw new Error('boom')
        return exec.readBatch(s)
      },
    } as typeof exec
    const { storage } = await openPostgresStorage(wrapped)
    broken = true
    const error = await storage.listInventories().catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'StorageError', code: 'failed' })
    expect(((error as Error).cause as Error).message).toBe('boom')
  })
})
