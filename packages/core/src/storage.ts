import type { Command } from './commands'
import type { Id } from './ids'
import type { Inventory, InventorySnapshot, Movement } from './model'

export interface Actor {
  device: string
}
export interface SchemaStatus {
  state: 'ready' | 'newer'
  dbVersion: number
  appVersion: number
}
export const STORAGE_ERROR_CODES = ['read_only', 'unavailable', 'not_found', 'incompatible', 'failed'] as const
export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number]

export type SchemaInspection =
  | { state: 'empty' }
  | { state: 'foreign' }
  | { state: 'current' | 'older' | 'newer'; dbVersion: number; appVersion: number }

export class StorageError extends Error {
  readonly code: StorageErrorCode
  constructor(code: StorageErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'StorageError'
    this.code = code
  }
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
  apply(command: Command, actor: Actor): Promise<void>
}
