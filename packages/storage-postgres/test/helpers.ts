import { PGlite } from '@electric-sql/pglite'
import type { Actor } from '@graymatter/core'
import type { PgExecutor } from '../src/executor'
import { createPgliteExecutor } from '../src/executors/pglite'

export const TEST_ACTOR: Actor = { device: 'Test · Vitest' }

export async function makeExecutor(): Promise<PgExecutor> {
  return createPgliteExecutor(new PGlite())
}
