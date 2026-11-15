import type {
  Command,
  FileStore,
  Id,
  Intake,
  IntakeDraftContent,
  IntakeHeader,
  Inventory,
  InventorySnapshot,
  InventoryStorage,
  Movement,
  PhotoFile,
  RestoreMode,
  RestoreResult,
  SourceReceipt,
} from '@antresol/core'
import type { BackupFile } from './backup'
import type { PreparedImage } from './images'
import type { BackupInfo, DeviceDb, RestoreRun } from './device-db'
import type { IntakeDraftSync } from './intake-drafts'
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
/** How often syncIfDue checks healthy sources; 'never': not by time. A device setting. The steps grow roughly
 *  geometrically, so a slider over them reads as a logarithmic scale from 5 minutes to a week. */
export const CHECK_INTERVALS = ['5m', '10m', '15m', '30m', '1h', '2h', '3h', '6h', '12h', '1d', '2d', '3d', '1w', 'never'] as const
export type CheckInterval = (typeof CHECK_INTERVALS)[number]

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
  /** A write other than a stock movement is queued or running. Stock writes lock only their bucket (isBucketSaving). */
  saving: boolean
  /** Writes a source took this session, stock writes included, each counted once this device's write count for the
   *  backup reminder is stored: the reminder looks again when it moves. */
  writeCount: number
  readOnly: ReadOnlyReason | null
}

export interface WorkspaceDeps {
  db: DeviceDb
  drivers: Partial<Record<SourceKind, SourceDriver>>
  userAgent: string
  now?: () => Date
  /** Shrinks a photo before upload; defaults to the canvas-based prepareImage. */
  prepareImage?: (f: File) => Promise<PreparedImage>
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
   *  is about to write; otherwise nothing, nor while a write is queued or running (it wakes the source itself). A write
   *  waits for a warm-up on its way. Only network answers count; a write refused on the device is none. Never called
   *  by a timer. */
  warmUp(): Promise<void>
  /** startFromCache() then refresh(). */
  start(): Promise<void>
  /** Saves the shown copy on the device now if a write changed it since it was last saved (otherwise that happens
   *  within CACHE_PUT_DELAY_MS); resolves when it is saved. */
  flushCache(): Promise<void>
  /** Cached copy first, then live. Switching runs the before-write hooks first: a pending stepper delta goes to the
   *  inventory it was pressed in, checked against the copy shown then, and its rows go into that copy on the device (no
   *  load of it now or when it is opened again, if no other write came in between). */
  selectInventory(ref: InventoryRef): Promise<void>
  /** The copy of an inventory saved on this device (as selectInventory would show it), without the network or any
   *  change of the current inventory; null when there is none or it is from another app format. Not for the current
   *  inventory: its copy is `state.snapshot`. */
  cachedSnapshot(ref: InventoryRef): Promise<InventorySnapshot | null>
  /** Throws DomainError | StorageError; calls run one after another in call order. When the interval has passed, the
   *  target's source alone is checked first (never another source), so the command is validated against the copy
   *  that check loads. The rows the command touched go into the shown copy; only a wide command (restore,
   *  tag/attribute/unit delete, …) loads the inventory again. */
  apply(command: Command): Promise<void>
  /** Like apply, but for any inventory of a connected source; validated against that inventory's snapshot. */
  applyTo(ref: InventoryRef, command: Command): Promise<void>
  /** A stock write to this bucket is queued or running (reactive). Steppers lock on this, not on `state.saving`. */
  isBucketSaving(itemId: Id, variantId: Id | null): boolean
  /** `hook` runs synchronously before every write is queued, and before another inventory is selected, so a write it
   *  starts goes first (a stepper flushing its pending delta). Returns the unregister function. */
  onBeforeWrite(hook: () => void): () => void
  /** Journal of an item of the current inventory, newest first, after a check of its source when the interval has
   *  passed (as apply). Rejects without a network call while the source is unreachable. */
  loadMovements(itemId: Id): Promise<Movement[]>
  /** Receipts of the current inventory whose link holds this lot key, newest first (storage findReceiptsBySource).
   *  Rejects without a network call while the source is unreachable. */
  findReceiptsBySource(key: string): Promise<SourceReceipt[]>
  /** Read-only copy of every inventory of a connected source (archived included) with all movements. Rejects with
   *  `unavailable` when the source is offline or failing; never returns a partial backup. */
  exportSource(sourceId: string): Promise<BackupFile>
  /** Writes a parsed backup into a ready source (InventoryStorage.restore), in the write queue. A wide write: afterwards
   *  the source reloads as with reloadSource (also after a failure: some batches may have landed) and the first restored
   *  active inventory is shown. `fileSha256`: the file's fingerprint. The device keeps the file's run (restoreRun): one
   *  that did not finish into this source in this mode goes on (nothing is added twice; the same ids may go into what
   *  it left); otherwise a new run, so a finished one run again with new ids is a fresh copy. onProgress(rows written,
   *  rows in all). Resolves with what this run added. Rejects with `not_found`, `read_only`, `unavailable`, `not_empty`
   *  (the same ids into a source holding inventories, not going on with a run), or the restore's own failure. */
  restoreSource(
    sourceId: string,
    backup: BackupFile,
    mode: RestoreMode,
    fileSha256: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<RestoreResult>
  /** This device's last restore run of a backup file, by its fingerprint; null: none. */
  restoreRun(fileSha256: string): Promise<RestoreRun | null>
  /** This device's last backup of the source and its writes to it since (DeviceDb). */
  backupInfo(sourceId: string): Promise<BackupInfo>
  /** A backup of the source was saved or shared now. */
  noteBackup(sourceId: string): Promise<void>
  /** The chosen photo store (Uploadcare by default) for a Neon source with its keys, the device store for the demo source, otherwise null. */
  fileStoreFor(sourceId: string): FileStore | null
  /** Prepares, uploads and records each file in order (photo.add with newId, provider, fileId, url). Stops at the first failure
   *  and rejects with it; photos already added stay. onProgress(doneCount) after each file. */
  addPhotos(itemId: Id, files: File[], onProgress?: (done: number) => void): Promise<void>
  /** One photo per variant: uploads, then one photo.replace that names the variant's photo as shown now (null: none);
   *  only that one is replaced. */
  setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void>
  removePhoto(photoId: Id): Promise<void>
  /** photo.reorder with the chosen photo first. */
  makeCover(itemId: Id, photoId: Id): Promise<void>
  /** `id` is the form's stable id: a retried Save recreates nothing. */
  createInventory(input: { sourceId: string; name: string; currency: string; id?: Id }): Promise<InventoryRef>
  addSource(input: Omit<SourceConfig, 'id' | 'createdAt'>): Promise<SourceConfig>
  /** Of overlapping calls for one source the last one called wins; an earlier one, or one whose source was removed
   *  meanwhile, resolves without applying its outcome. Rejects with `not_found` for an unknown source, and for one a
   *  removal is under way for (saved then, the edit could bring it back). */
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
        | 'imgbbApiKey'
      >>,
  ): Promise<void>
  /** Its saved list goes before the source itself: a removal that fails midway leaves no list without its source, and
   *  can be run again. A write on its way keeps the connection until it is done. */
  removeSource(id: string): Promise<void>
  setDeviceName(name: string): Promise<void>

  /** Intakes of the current inventory, drafts and committed, the most recently changed first. Kept per intakes
   *  revision: listed again only when it moved (one light read otherwise). While the source is unreachable, the list
   *  last read this session, if any; otherwise rejects with `unavailable`. */
  listIntakes(): Promise<Intake[]>
  /** One database write of a whole draft into the current inventory (InventoryStorage.saveIntakeDraft); `rev` does not
   *  change. Not in the write queue. Rejects with `unavailable` without a network call while the source is
   *  unreachable. Drafts go through `intakeDrafts`, which calls this. */
  saveIntakeDraft(
    id: Id,
    header: IntakeHeader,
    content: IntakeDraftContent,
    baseDraftRev: string | null,
    force?: boolean,
  ): ReturnType<InventoryStorage['saveIntakeDraft']>
  /** Deletes the draft from the database, then its copy on this device. */
  deleteIntakeDraft(id: Id): Promise<void>
  /** The header of a committed intake, or of a draft. A draft kept on this device takes it as an edit and is sent with
   *  it (its next write would otherwise find the row changed by this one); any other goes straight to the database. */
  updateIntakeHeader(id: Id, header: IntakeHeader): Promise<void>
  /**
   * Commits a draft of the current inventory (spec 2026-11-13 intakes §7): its device copy is sent first; then a sync,
   * and the lines are resolved again against that fresh copy. Lines with problems: `{ ok: false, problems }`, nothing
   * sent. Otherwise one intake.commit at the source's revision, in the write queue, its rows put into the shown copy;
   * refused as made on a copy that is behind (`conflict`), it is resolved and sent once more. An intake committed already
   * (a retry whose first attempt landed) is `{ ok: true }` with nothing written. Afterwards the device copy is dropped
   * and the folders of its new items become recent ones. Rejects with `conflict` when the draft has edits from another
   * device this one has not seen (the device copy then shows them), `read_only` when the source cannot be reached
   * before anything is sent, and as apply otherwise (`unavailable`: the outcome is unknown; committing again is safe).
   */
  commitIntake(id: Id): Promise<{ ok: true } | { ok: false; problems: { lineId: Id; code: string }[] }>
  /** Prepares and uploads a photo to the current source's photo store, recording nothing (a draft line keeps it). */
  uploadPhoto(file: File): Promise<PhotoFile>
  /** Folders this device last put new items of an intake into, in the current inventory; newest first. */
  recentFolders(): Promise<Id[]>
  /** The drafts kept on this device and their trips to the database. */
  readonly intakeDrafts: IntakeDraftSync
}
