import { normalizeCommand, StorageError, type InventoryStorage, type SchemaStatus } from '@graymatter/core'
import { toStatements } from './commands'
import type { PgExecutor } from './executor'
import { inspectSchema } from './inspect'
import { ensureSchema, REV_BUMP } from './migrator'
import * as queries from './queries'

/** The revision is an opaque unique value, not a counter: a point-in-time restore cannot make a new state repeat a
 *  revision that a device cached. An upsert, so a missing row is recreated rather than leaving the bump a no-op. */
const bumpRev = REV_BUMP

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
    exportInventory: (id) => wrapFailure(() => queries.exportInventory(exec, id)),
    async apply(command, actor) {
      if (readOnly) throw new StorageError('read_only')
      // Idempotent: canonicalizes quantities etc. even if the caller skipped normalization.
      // The rev bump is the batch's last statement: atomic with the write, one Neon HTTP transaction. Replaying a
      // command whose inserts are `on conflict do nothing` still bumps: a needless reload elsewhere, never a missed one.
      await wrapFailure(() => exec.batch([...toStatements(normalizeCommand(command), actor), bumpRev]))
    },
  }
  return { storage, status }
}
