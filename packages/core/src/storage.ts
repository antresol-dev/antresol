import type { Command } from './commands'
import type { Id } from './ids'
import type { Intake, IntakeDraftContent, IntakeHeader } from './intakes'
import type { Inventory, InventorySnapshot, Movement } from './model'
import type { SnapshotPatch } from './patch'
import type { Quantity } from './quantity'

export interface Actor {
  device: string
}
/** `newer` (read-only) only when the database needs a newer app to write: `minAppSchema > appVersion`. A database
 *  ahead of the app by additive migrations alone is `ready`. */
export interface SchemaStatus {
  state: 'ready' | 'newer'
  dbVersion: number
  appVersion: number
  /** `antresol_meta.min_app_schema`: the oldest app schema that may write. Without the row (a database from before soft
   *  migrations), the database's own version. */
  minAppSchema: number
}
/** `not_empty`: a restore with the same ids into a source that already holds inventories (InventoryStorage.restore).
 *  `conflict`: the database refused a write that a copy behind it allowed (another device changed what the command
 *  relies on); nothing was written. Like `failed`, the copy disagrees with the source and is synced; unlike it, an
 *  expected outcome the user is told about as such. */
export const STORAGE_ERROR_CODES = [
  'read_only',
  'unavailable',
  'not_found',
  'incompatible',
  'outdated',
  'failed',
  'not_empty',
  'conflict',
] as const
export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number]

/** What a database holds, read without writing. `older` is upgraded on open; `outdated` (made by a pre-release build)
 *  cannot be: opening it fails with StorageError('outdated') until it is reset. `current`: this app writes it as it is,
 *  at its own version or a newer one whose min_app_schema the app meets; `newer`: this app may only read it. */
export type SchemaInspection =
  | { state: 'empty' }
  | { state: 'foreign' }
  | { state: 'current' | 'older' | 'outdated' | 'newer'; dbVersion: number; appVersion: number }

export interface ApplyResult {
  /** Revision before this write, read under a lock on the revision row: no other write committed in between.
   *  Null when the row was missing. */
  prevRev: string | null
  /** Revision after this write. */
  rev: string
  /** What the command touched, read in the same transaction after the write. Null means
   *  reload: a wide command, or the command's target no longer exists (a write to a vanished item, a replayed delete). */
  patch: SnapshotPatch | null
}

/** One inventory as a backup holds it: the snapshot and every movement, oldest first (seq asc). */
export interface InventoryExport {
  snapshot: InventorySnapshot
  movements: Movement[]
}

/** `same-ids`: restored rows keep their ids; `new-ids`: they get deterministic new ones (see InventoryStorage.restore). */
export type RestoreMode = 'same-ids' | 'new-ids'

export interface RestoreOptions {
  /** After each batch: rows written so far (counting rows an earlier run already wrote), rows in all. */
  onProgress?: (done: number, total: number) => void
  /** Same ids only: this goes on with a run of the same backup into this source that stopped midway, so the source may
   *  hold what that run wrote. Without it, a same-ids restore into a source that holds any inventory is refused. */
  resumeSameIds?: boolean
}

export interface RestoreResult {
  /** The inventories' ids in the source, in the backup's order. */
  inventoryIds: Id[]
  /** What this run wrote: rows already there (from an earlier run of the same restore) are not counted. `inventories`:
   *  inventory rows among `rows`. */
  added: { inventories: number; rows: number }
}

export class StorageError extends Error {
  readonly code: StorageErrorCode
  constructor(code: StorageErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'StorageError'
    this.code = code
  }
}

/** A receipt found by its link (findReceiptsBySource). */
export interface SourceReceipt {
  at: string
  itemId: Id
  variantId: Id | null
  quantity: Quantity
}

/** The outcome of InventoryStorage.saveIntakeDraft. */
export type SaveIntakeDraftResult =
  | { saved: true; draftRev: string; intakesRev: string }
  /** The draft changed in the database since `baseDraftRev` (another device saved it): `current` is what it holds. */
  | { saved: false; reason: 'changed'; current: Intake }
  /** The intake is committed: a draft is never written over it. */
  | { saved: false; reason: 'committed' }

export interface InventoryStorage {
  readonly readOnly: boolean
  /** `rev`: the source's revision counter, read in the same snapshot as the list. It changes with every `apply`, so an
   *  unchanged `rev` means nothing in the source changed. Opaque: compare for equality only, never for order. */
  listInventories(): Promise<{ inventories: Inventory[]; rev: string }>
  loadInventory(id: Id): Promise<InventorySnapshot>
  /** `loadInventory` plus the source revision read in the same read-only snapshot transaction, so `rev` is exactly the
   *  revision the snapshot is at (never older, never newer). Opaque, like `listInventories`' rev. */
  loadInventoryWithRev(id: Id): Promise<{ snapshot: InventorySnapshot; rev: string }>
  /** Newest first (seq desc). */
  loadMovements(itemId: Id): Promise<Movement[]>
  /** Every movement of the inventory, all items (archived included), newest last (seq asc). */
  loadAllMovements(inventoryId: Id): Promise<Movement[]>
  /** The snapshot and every movement (seq asc) read in ONE read-only snapshot transaction: a consistent backup.
   *  Rejects with `not_found` when the inventory does not exist. */
  exportInventory(id: Id): Promise<InventoryExport>
  /**
   * Writes a backup's inventories into the source, parents first, in atomic batches of about RESTORE_BATCH_ROWS rows,
   * each one bumping the revision (a wide write: devices reload). Inserts only: a row whose primary key is already
   * there is skipped, so a run stopped midway is run again with the same arguments and adds only what is missing; any
   * other collision (a unique index) fails the batch.
   * - `same-ids`: the rows keep their ids. Only into a source without inventories (after a loss), checked under the
   *   revision lock in the first batch (`not_empty` otherwise, nothing written), unless `resumeSameIds`.
   * - `new-ids`: every id, and every reference to one, becomes UUID v5 of the old id in the namespace `runId`; the same
   *   file with the same `runId` gives the same new ids, so running it again adds nothing twice.
   * Checks the backup before writing anything (`failed` otherwise): every reference resolves inside it, and every value
   * fits the schema (see backupProblems in storage-postgres).
   */
  restore(backup: { inventories: InventoryExport[] }, mode: RestoreMode, runId: Id, options?: RestoreOptions): Promise<RestoreResult>
  /** Receipts of the inventory (archived items included) whose `sourceUrl` holds `key` as a whole part of the address,
   *  case-insensitively: a lot id ("1005001234567890") or an address without its scheme ("lcsc.com/product-detail/c7593.html").
   *  Newest first, at most 20. [] for an empty key. */
  findReceiptsBySource(inventoryId: Id, key: string): Promise<SourceReceipt[]>
  /** One atomic write: the command, the revision bump and the reads of what it touched. Opaque revisions, like
   *  `listInventories`' rev. */
  apply(command: Command, actor: Actor): Promise<ApplyResult>
  /** The inventory's intakes, drafts and committed, the most recently changed first, and the intakes revision read in
   *  the same snapshot. The intakes revision changes with every write of an intake (drafts, headers, intake.commit) and
   *  only with those; `rev` does not change for drafts or headers. Opaque, like `listInventories`' rev. */
  listIntakes(inventoryId: Id): Promise<{ intakes: Intake[]; intakesRev: string }>
  intakesRev(): Promise<string>
  /** Writes the draft whole, without changing `rev`, unless the intake is committed (`committed`) or its `draftRev` is
   *  no longer `baseDraftRev` (`changed`, nothing written); `force` writes over a changed draft. `baseDraftRev` null: a
   *  draft new on this device. A draft deleted on another device is written again (the last write wins). */
  saveIntakeDraft(
    draft: { id: Id; inventoryId: Id; header: IntakeHeader; content: IntakeDraftContent },
    baseDraftRev: string | null,
    actor: Actor,
    options?: { force?: boolean },
  ): Promise<SaveIntakeDraftResult>
  /** Deletes a draft; a committed intake is never deleted (nothing happens). */
  deleteIntakeDraft(id: Id): Promise<{ intakesRev: string }>
  /** The header of a draft or of a committed intake; `rev` does not change. `draftRev`: the row's new one, the base for
   *  this device's next saveIntakeDraft. Rejects with `not_found` when there is no such intake. */
  updateIntakeHeader(id: Id, header: IntakeHeader, actor: Actor): Promise<{ intakesRev: string; draftRev: string }>
}
