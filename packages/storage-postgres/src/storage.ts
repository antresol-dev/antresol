import { normalizeCommand, StorageError, type InventoryStorage, type SchemaStatus } from '@graymatter/core'
import { toStatements } from './commands'
import type { PgExecutor } from './executor'
import { ensureSchema } from './migrator'
import * as queries from './queries'

export async function openPostgresStorage(
  exec: PgExecutor,
): Promise<{ storage: InventoryStorage; status: SchemaStatus }> {
  const status = await ensureSchema(exec)
  const readOnly = status.state === 'newer'
  const storage: InventoryStorage = {
    readOnly,
    listInventories: () => queries.listInventories(exec),
    loadInventory: (id) => queries.loadInventory(exec, id),
    loadMovements: (itemId) => queries.loadMovements(exec, itemId),
    async apply(command, actor) {
      if (readOnly) throw new StorageError('read_only')
      try {
        // Idempotent: canonicalizes quantities etc. even if the caller skipped normalization.
        await exec.batch(toStatements(normalizeCommand(command), actor))
      } catch (cause) {
        if (cause instanceof StorageError) throw cause
        const error = new StorageError('failed', cause instanceof Error ? cause.message : undefined)
        error.cause = cause
        throw error
      }
    },
  }
  return { storage, status }
}
