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
/** How often syncIfDue checks healthy sources; 'never': not by time. A device setting. */
export type CheckInterval = '5m' | '15m' | '1h' | '6h' | '1d' | 'never'

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
  /** Last successful check: one that reached the current inventory's source and left the shown copy at its revision
   *  (other sources failing do not matter; without a current inventory, every source must answer), or an own write
   *  that proved the shown copy current. The check interval counts from it. */
  lastRefreshAt: string | null
  /** Device setting; DEFAULT_CHECK_INTERVAL until stored. */
  checkInterval: CheckInterval
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
  /** Looks for a new version of the app now (the service worker's `registration.update()`); never throws. Called when
   *  a source turns read-only because its schema needs a newer app. */
  checkForUpdate?: () => void
}

export interface Workspace {
  readonly state: Readonly<WorkspaceState>
  /** Device data (sources, inventory lists, the cached snapshot of `current`); no network. */
  startFromCache(): Promise<void>
  /** List inventories on each source's open connection (connecting if needed), load the current snapshot. */
  refresh(): Promise<void>
  /** "Sync": a refresh that starts after this call (one already running may have listed before it). A shown copy it
   *  left behind its source's revision gets one more check of that source. Resolves 'updated' when the shown copy was
   *  replaced by a full load meanwhile; rejects with `unavailable` when the current inventory's source is not
   *  connected after it, or the shown copy is still not at its revision. */
  sync(): Promise<'unchanged' | 'updated'>
  /** "Reload everything": no copy of the source is trusted any more (the shown one, those on the device), then as
   *  sync: the current inventory, if from this source, loads in full, the source's others when opened. Rejects with
   *  `not_found` for an unknown source, with `unavailable` when it is not connected after (or, as sync, the shown copy
   *  of it is still behind). */
  reloadSource(sourceId: string): Promise<void>
  /** On return to the app, a check of all sources if due: refreshes at once while the current source is failing;
   *  while another one is, at most once per FAILED_RETRY_MS; otherwise when the last successful check is older than
   *  `checkInterval` ('never': not by time). Writes and the journal check only their own source (see apply). */
  syncIfDue(): Promise<void>
  /** Kept on the device. */
  setCheckInterval(value: CheckInterval): Promise<void>
  /** When the current source has not answered for over 4 minutes, one light request (listInventories) before a form that
   *  is about to write; otherwise nothing. Never called by a timer. */
  warmUp(): Promise<void>
  /** startFromCache() then refresh(). */
  start(): Promise<void>
  /** Saves the shown copy on the device now if a write changed it since it was last saved (otherwise that happens
   *  within CACHE_PUT_DELAY_MS); resolves when it is saved. */
  flushCache(): Promise<void>
  /** Cached copy first, then live. */
  selectInventory(ref: InventoryRef): Promise<void>
  /** Throws DomainError | StorageError; calls run one after another in call order. When the interval has passed, the
   *  target's source alone is checked first (never another source), so the command is validated against the copy
   *  that check loads. The rows the command touched go into the shown copy; only a wide command (restore,
   *  tag/attribute/unit delete, …) loads the inventory again. */
  apply(command: Command): Promise<void>
  /** Like apply, but for any inventory of a connected source; validated against that inventory's snapshot. */
  applyTo(ref: InventoryRef, command: Command): Promise<void>
  /** Journal of an item of the current inventory, newest first, after a check of its source when the interval has
   *  passed (as apply). Rejects without a network call while the source is unreachable. */
  loadMovements(itemId: Id): Promise<Movement[]>
  /** Read-only copy of every inventory of a connected source (archived included) with all movements. Rejects with
   *  `unavailable` when the source is offline or failing; never returns a partial backup. */
  exportSource(sourceId: string): Promise<BackupFile>
  /** The chosen photo store (Uploadcare by default) for a Neon source with its keys, the device store for the demo source, otherwise null. */
  fileStoreFor(sourceId: string): FileStore | null
  /** Prepares, uploads and records each file in order (photo.add with newId, provider, fileId, url). Stops at the first failure
   *  and rejects with it; photos already added stay. onProgress(doneCount) after each file. */
  addPhotos(itemId: Id, files: File[], onProgress?: (done: number) => void): Promise<void>
  /** One photo per variant: removes the old one first. */
  setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void>
  removePhoto(photoId: Id): Promise<void>
  /** photo.reorder with the chosen photo first. */
  makeCover(itemId: Id, photoId: Id): Promise<void>
  /** `id` is the form's stable id: a retried Save recreates nothing. */
  createInventory(input: { sourceId: string; name: string; currency: string; id?: Id }): Promise<InventoryRef>
  addSource(input: Omit<SourceConfig, 'id' | 'createdAt'>): Promise<SourceConfig>
  /** Of overlapping calls for one source the last one called wins; an earlier one, or one whose source was removed
   *  meanwhile, resolves without applying its outcome. */
  updateSource(
    id: string,
    patch: Partial<Pick<
        SourceConfig,
        | 'name'
        | 'connectionString'
        | 'photoStore'
        | 'uploadcarePublicKey'
        | 'uploadcareCdnBase'
        | 'cloudinaryCloudName'
        | 'cloudinaryUploadPreset'
        | 'imgurClientId'
      >>,
  ): Promise<void>
  removeSource(id: string): Promise<void>
  setDeviceName(name: string): Promise<void>
}
