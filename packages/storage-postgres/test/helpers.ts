import { PGlite } from '@electric-sql/pglite'
import type { Actor, InventoryStorage } from '@graymatter/core'
import type { PgExecutor } from '../src/executor'
import { createPgliteExecutor } from '../src/executors/pglite'
import { openPostgresStorage } from '../src/storage'

export const TEST_ACTOR: Actor = { device: 'Test · Vitest' }

export async function makeExecutor(): Promise<PgExecutor> {
  return createPgliteExecutor(new PGlite())
}

export async function makeStorage(): Promise<InventoryStorage> {
  const { storage } = await openPostgresStorage(await makeExecutor())
  return storage
}
