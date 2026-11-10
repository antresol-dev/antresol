import { normalizeCommand, StorageError, type InventoryStorage, type SchemaStatus } from '@graymatter/core'
import { toStatements } from './commands'
import type { PgExecutor } from './executor'
import { inspectSchema } from './inspect'
import { ensureSchema } from './migrator'
import * as queries from './queries'

/** Lets StorageError through; wraps anything else as StorageError('failed') keeping the cause. */
async function wrapFailure<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof StorageError) throw cause
    const error = new StorageError('failed', cause instanceof Error ? cause.message : undefined)
    error.cause = cause
    throw error
  }
}

export async function openPostgresStorage(
  exec: PgExecutor,
): Promise<{ storage: InventoryStorage; status: SchemaStatus }> {
  if ((await inspectSchema(exec)).state === 'foreign') {
    throw new StorageError('incompatible', 'the database holds tables that do not belong to GrayMatter')
  }
  const status = await ensureSchema(exec)
  const readOnly = status.state === 'newer'
  const storage: InventoryStorage = {
    readOnly,
    listInventories: () => wrapFailure(() => queries.listInventories(exec)),
    loadInventory: (id) => wrapFailure(() => queries.loadInventory(exec, id)),
    loadMovements: (itemId) => wrapFailure(() => queries.loadMovements(exec, itemId)),
    loadAllMovements: (inventoryId) => wrapFailure(() => queries.loadAllMovements(exec, inventoryId)),
    async apply(command, actor) {
      if (readOnly) throw new StorageError('read_only')
      // Idempotent: canonicalizes quantities etc. even if the caller skipped normalization.
      await wrapFailure(() => exec.batch(toStatements(normalizeCommand(command), actor)))
    },
  }
  return { storage, status }
}
