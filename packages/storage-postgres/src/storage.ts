import { normalizeCommand, StorageError, type InventoryStorage, type SchemaStatus } from '@graymatter/core'
import { toStatements } from './commands'
import { affectedReads } from './commands/reads'
import type { PgExecutor } from './executor'
import { inspectSchema } from './inspect'
import { ensureSchema, LOCK_REV, REV_BUMP } from './migrator'
import * as queries from './queries'
import { restoreBackup } from './restore'

/** The revision is an opaque unique value, not a counter: a point-in-time restore cannot make a new state repeat a
 *  revision that a device cached. An upsert, so a missing row is recreated rather than leaving the bump a no-op; it
 *  returns the new value. */
const bumpRev = REV_BUMP

const valueOf = (result: Record<string, unknown>[] | undefined): unknown => result?.[0]?.value

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

/** `appVersion`: see ensureSchema (tests stand in for an older build with it). */
export async function openPostgresStorage(
  exec: PgExecutor,
  options: { appVersion?: number } = {},
): Promise<{ storage: InventoryStorage; status: SchemaStatus }> {
  if ((await inspectSchema(exec)).state === 'foreign') {
    throw new StorageError('incompatible', 'the database holds tables that do not belong to GrayMatter')
  }
  const status = await ensureSchema(exec, options.appVersion)
  const readOnly = status.state === 'newer'
  const storage: InventoryStorage = {
    readOnly,
    listInventories: () => wrapFailure(() => queries.listInventories(exec)),
    loadInventory: (id) => wrapFailure(() => queries.loadInventory(exec, id)),
    loadInventoryWithRev: (id) => wrapFailure(() => queries.loadInventoryWithRev(exec, id)),
    loadMovements: (itemId) => wrapFailure(() => queries.loadMovements(exec, itemId)),
    loadAllMovements: (inventoryId) => wrapFailure(() => queries.loadAllMovements(exec, inventoryId)),
    exportInventory: (id) => wrapFailure(() => queries.exportInventory(exec, id)),
    async restore(backup, mode, runId, options) {
      if (readOnly) throw new StorageError('read_only')
      return wrapFailure(() => restoreBackup(exec, backup, mode, runId, options))
    },
    findReceiptsBySource: (inventoryId, key) => wrapFailure(() => queries.findReceiptsBySource(exec, inventoryId, key)),
    async apply(command, actor) {
      if (readOnly) throw new StorageError('read_only')
      return wrapFailure(async () => {
        // Idempotent: canonicalizes quantities etc. even if the caller skipped normalization.
        const normalized = normalizeCommand(command)
        const reads = affectedReads(normalized)
        const before = reads?.before ?? []
        const write = toStatements(normalized, actor)
        // One atomic batch, one Neon HTTP transaction: lock and read the revision, remember ids the command is about to
        // delete, the command, the bump, then the reads of what it touched. Replaying a command whose inserts are
        // `on conflict do nothing` still bumps and reads: a needless reload elsewhere, never a missed one.
        const result = await exec.batch([LOCK_REV, ...before, ...write, bumpRev, ...(reads?.statements ?? [])])
        const bumpAt = 1 + before.length + write.length
        const prevRev = valueOf(result[0])
        const rev = valueOf(result[bumpAt])
        if (typeof rev !== 'string') throw new Error('the revision bump returned no value')
        return {
          prevRev: typeof prevRev === 'string' ? prevRev : null,
          rev,
          patch: reads ? reads.toPatch(result.slice(bumpAt + 1)) : null,
        }
      })
    },
  }
  return { storage, status }
}
