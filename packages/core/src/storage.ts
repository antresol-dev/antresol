import type { Command } from './commands'
import type { Id } from './ids'
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
  /** `gm_meta.min_app_schema`: the oldest app schema that may write. Without the row (a database from before soft
   *  migrations), the database's own version. */
  minAppSchema: number
}
export const STORAGE_ERROR_CODES = ['read_only', 'unavailable', 'not_found', 'incompatible', 'outdated', 'failed'] as const
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
  exportInventory(id: Id): Promise<{ snapshot: InventorySnapshot; movements: Movement[] }>
  /** Receipts of the inventory (archived items included) whose `sourceUrl` holds `key` as a whole part of the address,
   *  case-insensitively: a lot id ("1005001234567890") or an address without its scheme ("lcsc.com/product-detail/c7593.html").
   *  Newest first, at most 20. [] for an empty key. */
  findReceiptsBySource(inventoryId: Id, key: string): Promise<SourceReceipt[]>
  /** One atomic write: the command, the revision bump and the reads of what it touched. Opaque revisions, like
   *  `listInventories`' rev. */
  apply(command: Command, actor: Actor): Promise<ApplyResult>
}
