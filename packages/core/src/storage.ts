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
  listInventories(): Promise<Inventory[]>
  loadInventory(id: Id): Promise<InventorySnapshot>
  /** Newest first (seq desc). */
  loadMovements(itemId: Id): Promise<Movement[]>
  apply(command: Command, actor: Actor): Promise<void>
}
