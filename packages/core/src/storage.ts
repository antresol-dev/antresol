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
export type StorageErrorCode = 'read_only' | 'unavailable' | 'failed'

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
  listInventories(): Promise<Inventory[]>
  loadInventory(id: Id): Promise<InventorySnapshot>
  /** Newest first (seq desc). */
  loadMovements(itemId: Id): Promise<Movement[]>
  apply(command: Command, actor: Actor): Promise<void>
}
