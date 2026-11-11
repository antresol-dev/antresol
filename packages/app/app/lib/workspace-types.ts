import type { Command, FileStore, Id, Inventory, InventorySnapshot, Movement } from '@graymatter/core'
import type { BackupFile } from './backup'
import type { DeviceDb } from './device-db'
import type { FailureReason, SourceDriver } from './sources'
import type { InventoryRef, SourceConfig, SourceKind } from './types'

export interface InventoryEntry {
  ref: InventoryRef
  inventory: Inventory
  sourceName: string
}
export type SourceStatus = 'connecting' | 'ready' | 'read_only' | 'unreachable' | 'error'
export interface SourceState {
  config: SourceConfig
  status: SourceStatus
  /** Already redacted; kept for debugging, never rendered. */
  error: string | null
  /** Classified failure shown to the user instead of `error`. */
  reason: FailureReason | null
}
export type ReadOnlyReason = 'offline' | 'schema_newer' | 'source_error'

export interface WorkspaceState {
  started: boolean
  persistent: boolean
  deviceName: string
  sources: SourceState[]
  /** Active only, sorted by name (localeCompare, numeric, base). */
  inventories: InventoryEntry[]
  /** Archived inventories of all sources, sorted like `inventories`. */
  archivedInventories: InventoryEntry[]
  current: InventoryRef | null
  /** Replaced whole, never mutated; stored with markRaw so views read plain data. */
  snapshot: InventorySnapshot | null
  snapshotOrigin: 'cache' | 'live' | null
  /** ISO time the shown data was loaded from the source. */
  snapshotSavedAt: string | null
  /** Last fully successful refresh. */
  lastRefreshAt: string | null
  refreshing: boolean
  saving: boolean
  readOnly: ReadOnlyReason | null
}

export interface WorkspaceDeps {
  db: DeviceDb
  drivers: Partial<Record<SourceKind, SourceDriver>>
  userAgent: string
  now?: () => Date
  /** Shrinks a photo before upload; defaults to the canvas-based prepareImage. */
  prepareImage?: (f: File) => Promise<Blob>
  /** The photo store of a source; defaults to Uploadcare (Neon with a key) or the device store (demo). */
  fileStores?: (config: SourceConfig) => FileStore | null
}

export interface Workspace {
  readonly state: Readonly<WorkspaceState>
  /** Device data (sources, inventory lists, the cached snapshot of `current`); no network. */
  startFromCache(): Promise<void>
  /** List inventories on each source's open connection (connecting if needed), load the current snapshot. */
  refresh(): Promise<void>
  /** Refreshes when the last refresh is older than `maxAgeMs` or the current source is failing; a failing source
   *  that is not current is retried at most once per FAILED_RETRY_MS. */
  refreshIfStale(maxAgeMs: number): Promise<void>
  /** startFromCache() then refresh(). */
  start(): Promise<void>
  /** Saves the shown copy on the device now if a write changed it since it was last saved (otherwise that happens
   *  within CACHE_PUT_DELAY_MS); resolves when it is saved. */
  flushCache(): Promise<void>
  /** Cached copy first, then live. */
  selectInventory(ref: InventoryRef): Promise<void>
  /** Throws DomainError | StorageError; calls run one after another in call order. The rows the command touched go
   *  into the shown copy; only a wide command (restore, tag/attribute/unit delete, …) loads the inventory again. */
  apply(command: Command): Promise<void>
  /** Like apply, but for any inventory of a connected source; validated against that inventory's snapshot. */
  applyTo(ref: InventoryRef, command: Command): Promise<void>
  /** Journal of an item of the current inventory, newest first. Rejects without a network call while the source is unreachable. */
  loadMovements(itemId: Id): Promise<Movement[]>
  /** Read-only copy of every inventory of a connected source (archived included) with all movements. Rejects with
   *  `unavailable` when the source is offline or failing; never returns a partial backup. */
  exportSource(sourceId: string): Promise<BackupFile>
  /** Uploadcare for a Neon source with a public key, the device store for the demo source, otherwise null. */
  fileStoreFor(sourceId: string): FileStore | null
  /** Prepares, uploads and records each file in order (photo.add with newId, provider, fileId, url). Stops at the first failure
   *  and rejects with it; photos already added stay. onProgress(doneCount) after each file. */
  addPhotos(itemId: Id, files: File[], onProgress?: (done: number) => void): Promise<void>
  /** One photo per variant: removes the old one first. */
  setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void>
  removePhoto(photoId: Id): Promise<void>
  /** photo.reorder with the chosen photo first. */
  makeCover(itemId: Id, photoId: Id): Promise<void>
  createInventory(input: { sourceId: string; name: string; currency: string }): Promise<InventoryRef>
  addSource(input: Omit<SourceConfig, 'id' | 'createdAt'>): Promise<SourceConfig>
  /** Of overlapping calls for one source the last one called wins; an earlier one, or one whose source was removed
   *  meanwhile, resolves without applying its outcome. */
  updateSource(
    id: string,
    patch: Partial<Pick<SourceConfig, 'name' | 'connectionString' | 'uploadcarePublicKey' | 'uploadcareCdnBase'>>,
  ): Promise<void>
  removeSource(id: string): Promise<void>
  setDeviceName(name: string): Promise<void>
}
