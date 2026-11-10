import type { Command, Id, Inventory, InventorySnapshot, Movement } from '@graymatter/core'
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
  /** Cached copy first, then live. */
  selectInventory(ref: InventoryRef): Promise<void>
  /** Throws DomainError | StorageError; calls run one after another in call order. */
  apply(command: Command): Promise<void>
  /** Like apply, but for any inventory of a connected source; validated against that inventory's snapshot. */
  applyTo(ref: InventoryRef, command: Command): Promise<void>
  /** Journal of an item of the current inventory, newest first. Rejects without a network call while the source is unreachable. */
  loadMovements(itemId: Id): Promise<Movement[]>
  createInventory(input: { sourceId: string; name: string; currency: string }): Promise<InventoryRef>
  addSource(input: Omit<SourceConfig, 'id' | 'createdAt'>): Promise<SourceConfig>
  /** Of overlapping calls for one source the last one called wins; an earlier one, or one whose source was removed
   *  meanwhile, resolves without applying its outcome. */
  updateSource(
    id: string,
    patch: Partial<Pick<SourceConfig, 'name' | 'connectionString' | 'uploadcarePublicKey'>>,
  ): Promise<void>
  removeSource(id: string): Promise<void>
  setDeviceName(name: string): Promise<void>
}
