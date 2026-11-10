import { PGlite } from '@electric-sql/pglite'
import type { Actor, InventoryStorage } from '@graymatter/core'
import { afterEach } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { createPgliteExecutor } from '../src/executors/pglite'
import { openPostgresStorage } from '../src/storage'

export const TEST_ACTOR: Actor = { device: 'Test · Vitest' }

// Every database made here belongs to one test (they are all made inside tests): it is closed after that test, in each
// file that imports these helpers.
const open: PgExecutor[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((exec) => exec.close().catch(() => {})))
})

/** A fresh in-memory database, closed after the test. */
export async function makeExecutor(): Promise<PgExecutor> {
  const exec = createPgliteExecutor(new PGlite())
  open.push(exec)
  return exec
}

export async function makeStorage(): Promise<InventoryStorage> {
  const { storage } = await openPostgresStorage(await makeExecutor())
  return storage
}
