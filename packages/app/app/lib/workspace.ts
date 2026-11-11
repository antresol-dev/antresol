import {
  DomainError,
  FileError,
  newId,
  normalizeCommand,
  patchSnapshot,
  StorageError,
  validateCommand,
  type ApplyResult,
  type Command,
  type FileStore,
  type Id,
  type Inventory,
  type InventorySnapshot,
  type Movement,
  type RestoreMode,
  type SnapshotPatch,
  type SourceReceipt,
} from '@graymatter/core'
import { createCloudinaryStore } from '@graymatter/files-cloudinary'
import { createImgurStore } from '@graymatter/files-imgur'
import { createUploadcareStore } from '@graymatter/files-uploadcare'
import { APP_SCHEMA_VERSION } from '@graymatter/storage-postgres'
import { markRaw, reactive } from 'vue'
import { buildBackup, type BackupFile } from './backup'
import { logError, secretsOf, setSecretSource } from './diagnostics'
import { createDeviceFileStore, releaseDeviceUrls } from './device-files'
import { prepareImage as defaultPrepareImage } from './images'
import type { CachedSnapshot } from './device-db'
import { defaultDeviceName } from './device-name'
import { classifyFailure, redactSecret, type FailureReason, type SourceConnection } from './sources'
import type { InventoryRef, SourceConfig } from './types'
import type {
  CheckInterval,
  InventoryEntry,
  SourceState,
  SourceStatus,
  Workspace,
  WorkspaceDeps,
  WorkspaceState,
} from './workspace-types'

export type {
  CheckInterval,
  InventoryEntry,
  ReadOnlyReason,
  SourceState,
  SourceStatus,
  Workspace,
  WorkspaceDeps,
  WorkspaceState,
} from './workspace-types'

/** Bumped when the shape of a cached snapshot changes. With the schema version it prefixes the revision stored in the
 *  cache: a snapshot cached by an older app (other shape, or before a data migration) never matches the source's
 *  revision, so it is reloaded once instead of being kept. */
export const SNAPSHOT_FORMAT = 2
const FORMAT_MARK = `${SNAPSHOT_FORMAT}:${APP_SCHEMA_VERSION}`
const REV_PREFIX = `${FORMAT_MARK}:`
/** A copy saved by another app format or schema version is never shown, not even offline: its shape may differ. */
const shownCopy = (cached: CachedSnapshot | null | undefined): CachedSnapshot | null =>
  cached?.format === FORMAT_MARK ? cached : null
const cachedRev = (rev: string): string => REV_PREFIX + rev
const cacheRev = (rev: string | null): string | null => (rev === null ? null : cachedRev(rev))
const uncacheRev = (stored: string | null | undefined): string | null =>
  stored?.startsWith(REV_PREFIX) ? stored.slice(REV_PREFIX.length) : null

/** syncIfDue retries a failing source that is not the current one at most this often, whatever the interval. */
export const FAILED_RETRY_MS = 5 * 60_000

export const DEFAULT_CHECK_INTERVAL: CheckInterval = '15m'
/** How long a successful check holds before syncIfDue checks again. */
export const CHECK_INTERVAL_MS: Record<Exclude<CheckInterval, 'never'>, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 360 * 60_000,
  '1d': 1440 * 60_000,
}
const isCheckInterval = (value: unknown): value is CheckInterval =>
  value === 'never' || (typeof value === 'string' && Object.hasOwn(CHECK_INTERVAL_MS, value))

/** A copy changed by writes is saved on the device at most this often, and at once by flushCache. */
export const CACHE_PUT_DELAY_MS = 2_000

/** The rows of an own write put into the shown copy while a full load of it was running. `after`: the last load
 *  token issued then; loads up to it started before the rows were applied and may have read the source before the write. */
interface OwnRows {
  after: number
  prevRev: string | null
  rev: string
  patch: SnapshotPatch
}

/**
 * A load (`snapshot` at `rev`) plus the own rows it may miss, oldest first. They go on top from the write that starts
 * at the load's revision, or from the one after the write that ends there. Null when the load's revision is neither:
 * it cannot be ordered against them. The resulting revision is exact while each write starts where the previous one
 * ended; a write by another device in between leaves it unknown (null).
 */
function catchUp(
  snapshot: InventorySnapshot,
  rev: string,
  missed: OwnRows[],
): { snapshot: InventorySnapshot; rev: string | null } | null {
  if (missed.length === 0) return { snapshot, rev }
  let from = missed.findIndex((w) => w.prevRev === rev)
  if (from < 0) {
    const ended = missed.findLastIndex((w) => w.rev === rev)
    if (ended < 0) return null
    from = ended + 1
  }
  let label: string | null = rev
  for (const w of missed.slice(from)) {
    snapshot = patchSnapshot(snapshot, w.patch)
    label = label !== null && label === w.prevRev ? w.rev : null
  }
  return { snapshot, rev: label }
}

type Outcome =
  /** `fresh`: opened by this attempt rather than the source's open connection. */
  | { ok: true; conn: SourceConnection; inventories: Inventory[]; rev: string; fresh: boolean }
  | { ok: false; error: unknown }

const sameRef = (a: InventoryRef | null, b: InventoryRef | null): boolean =>
  !!a && !!b && a.sourceId === b.sourceId && a.inventoryId === b.inventoryId

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** A StorageError whose text is free of the connection string's password. */
function sanitize(error: unknown, connectionString: string): StorageError {
  const code = error instanceof StorageError ? error.code : 'failed'
  return new StorageError(code, redactSecret(errorMessage(error), connectionString))
}

function isRelistCommand(c: Command): boolean {
  return c.type.startsWith('inventory.') || c.type === 'restore' ||
    (c.type === 'archive' && c.target === 'inventory') ||
    (c.type === 'deletePermanently' && c.target === 'inventory')
}

/** One stock bucket of an item: the stock kept under a variant, or without one (variantId null). */
export const bucketKey = (itemId: Id, variantId: Id | null): string => `${itemId}:${variantId ?? ''}`

/** The stock buckets a command writes to; empty for every other command. */
function bucketsOf(c: Command): string[] {
  switch (c.type) {
    case 'stock.receive':
    case 'stock.use':
    case 'stock.return':
    case 'stock.set':
      return [bucketKey(c.itemId, c.variantId)]
    case 'stock.transfer':
      return [bucketKey(c.itemId, c.fromVariantId), bucketKey(c.itemId, c.toVariantId)]
    default:
      return []
  }
}

/** Demo source: the device store. Neon: the chosen photo store (Uploadcare by default) when its keys are set. Anything else: none. */
export function defaultFileStore(config: SourceConfig, fetchImpl?: typeof fetch): FileStore | null {
  if (config.kind === 'dev-pglite') return createDeviceFileStore()
  if (config.kind !== 'neon') return null
  const opts = fetchImpl ? { fetch: fetchImpl } : {}
  if (config.photoStore === 'cloudinary') {
    const cloudName = config.cloudinaryCloudName?.trim()
    const uploadPreset = config.cloudinaryUploadPreset?.trim()
    return cloudName && uploadPreset ? createCloudinaryStore({ cloudName, uploadPreset, ...opts }) : null
  }
  if (config.photoStore === 'imgur') {
    const clientId = config.imgurClientId?.trim()
    return clientId ? createImgurStore({ clientId, ...opts }) : null
  }
  const key = config.uploadcarePublicKey?.trim()
  return key ? createUploadcareStore({ publicKey: key, cdnBase: config.uploadcareCdnBase ?? undefined, ...opts }) : null
}

export function createWorkspace(deps: WorkspaceDeps): Workspace {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const nowIso = (): string => now().toISOString()

  const state = reactive<WorkspaceState>({
    started: false,
    persistent: db.persistent,
    deviceName: defaultDeviceName(deps.userAgent),
    sources: [],
    inventories: [],
    archivedInventories: [],
    current: null,
    snapshot: null,
    snapshotOrigin: null,
    snapshotSavedAt: null,
    lastRefreshAt: null,
    checkInterval: DEFAULT_CHECK_INTERVAL,
    refreshing: false,
    saving: false,
    readOnly: null,
  })

  // The error log never holds the secrets of the sources' settings.
  setSecretSource(() => state.sources.flatMap((s) => secretsOf(s.config)))

  /** When each source last answered a request, in ms: the warm-up (see warmUp) looks at it. */
  const answeredAt = new Map<string, number>()
  const noteAnswer = (sourceId: string): void => {
    answeredAt.set(sourceId, now().getTime())
  }

  /** Open connections; refreshes reuse them until one fails. */
  const conns = new Map<string, SourceConnection>()
  /** The connection string each connection was opened with: its errors are redacted with it, even after the source
   *  was edited or removed. */
  const openedWith = new WeakMap<SourceConnection, string>()
  const connectionStringOf = (conn: SourceConnection): string => openedWith.get(conn) ?? ''
  /** Last known inventories (active and archived) per source; also kept on the device and while the source is unreachable. */
  const listings = new Map<string, Inventory[]>()
  /** Revision of each source as last read by listInventories, or moved on by an own write that started from it (see
   *  loadCurrent for how it is used). */
  const sourceRevs = new Map<string, string>()
  /** The revision the shown `state.snapshot` is known to be at least as new as; null when unknown (stale). */
  let shownRev: string | null = null
  let queue: Promise<void> = Promise.resolve()
  let pendingWrites = 0
  /** Queued or running writes per stock bucket (bucketKey); reactive, read by isBucketSaving. */
  const savingBuckets = reactive(new Map<string, number>())
  const beforeWrite = new Set<() => void>()
  let refreshing: Promise<void> | null = null
  let refreshEpoch = 0
  let refreshingEpoch = -1
  /** Number of the last started snapshot load, and of the last one written to state. */
  let loadSeq = 0
  let appliedSeq = 0
  /** Bumped whenever another inventory (or none) becomes current. A load started before is never shown, even when its
   *  inventory is selected again: the own rows it might miss are only remembered for the selection they were put in. */
  let selection = 0
  /** Full loads still running, and the own rows put into the shown copy meanwhile (see catchUp). */
  let loadsRunning = 0
  let ownRows: OwnRows[] = []
  /** The shown copy has rows a write put into it that are not saved on the device yet. */
  let unsaved: { ref: InventoryRef; generation: number } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let lastSave: Promise<void> = Promise.resolve()
  /** When the last refresh started, in ms. */
  let lastAttemptAt: number | null = null
  /** Bumped whenever a source is added, edited or removed; stale connect outcomes are discarded. */
  const generations = new Map<string, number>()
  const generationOf = (id: string): number => generations.get(id) ?? 0
  const bumpGeneration = (id: string): void => {
    generations.set(id, generationOf(id) + 1)
    refreshEpoch++
    // The source may now be another database: revisions read from, or cached under, the old one prove nothing.
    sourceRevs.delete(id)
    if (state.current?.sourceId === id) {
      shownRev = null
      ownRows = []
    }
  }

  const statusOf = (sourceId: string): SourceStatus | null =>
    state.sources.find((s) => s.config.id === sourceId)?.status ?? null

  function recompute(): void {
    const status = state.current ? statusOf(state.current.sourceId) : null
    state.readOnly =
      status === 'unreachable' ? 'offline' : status === 'read_only' ? 'schema_newer' : status === 'error' ? 'source_error' : null
  }

  function setSource(
    config: SourceConfig,
    status: SourceStatus,
    error: string | null,
    reason: FailureReason | null,
  ): void {
    const entry: SourceState = { config, status, error, reason }
    const index = state.sources.findIndex((s) => s.config.id === config.id)
    if (index >= 0) state.sources[index] = entry
    else state.sources.push(entry)
    recompute()
  }

  function setCurrent(ref: InventoryRef | null): void {
    // Another inventory's snapshot is never shown, nor validates a write, under the new current.
    if (!sameRef(state.current, ref)) {
      // Written rows of the copy shown so far go to the device first: opening it again then loads nothing.
      void saveShown()
      selection++
      state.snapshot = null
      state.snapshotOrigin = null
      state.snapshotSavedAt = null
      shownRev = null
      ownRows = []
    }
    state.current = ref
    recompute()
  }

  /** Saves the shown copy with its revision if a write changed it since it was last saved. Not after its source was
   *  edited or removed. */
  function saveShown(): Promise<void> {
    clearTimeout(saveTimer)
    saveTimer = undefined
    const pending = unsaved
    unsaved = null
    const snapshot = state.snapshot
    if (
      pending &&
      sameRef(state.current, pending.ref) &&
      snapshot?.inventory.id === pending.ref.inventoryId &&
      generationOf(pending.ref.sourceId) === pending.generation
    ) {
      const value = { snapshot, savedAt: state.snapshotSavedAt ?? nowIso(), rev: cacheRev(shownRev), format: FORMAT_MARK }
      // A copy that could not be saved keeps its older rows and revision on the device: it is loaded again.
      lastSave = db.putSnapshot(pending.ref, value).catch(() => {})
    }
    return lastSave
  }

  /** The shown copy of `ref` got rows from a write: saved within CACHE_PUT_DELAY_MS. */
  function markUnsaved(ref: InventoryRef): void {
    unsaved = { ref: { sourceId: ref.sourceId, inventoryId: ref.inventoryId }, generation: generationOf(ref.sourceId) }
    saveTimer ??= setTimeout(() => void saveShown(), CACHE_PUT_DELAY_MS)
  }

  /** Deletes the device copy of an inventory that is gone; its unsaved rows are never saved after this. */
  async function dropCopy(ref: InventoryRef): Promise<void> {
    if (unsaved && sameRef(unsaved.ref, ref)) unsaved = null
    await db.deleteSnapshot(ref)
  }

  function rebuildInventories(): void {
    const active: InventoryEntry[] = []
    const archived: InventoryEntry[] = []
    for (const { config } of state.sources) {
      for (const inventory of listings.get(config.id) ?? []) {
        const entry = { ref: { sourceId: config.id, inventoryId: inventory.id }, inventory, sourceName: config.name }
        ;(inventory.archivedAt === null ? active : archived).push(entry)
      }
    }
    const byName = (a: InventoryEntry, b: InventoryEntry): number =>
      a.inventory.name.localeCompare(b.inventory.name, undefined, { numeric: true, sensitivity: 'base' }) ||
      (a.inventory.id < b.inventory.id ? -1 : a.inventory.id > b.inventory.id ? 1 : 0)
    state.inventories = active.sort(byName)
    state.archivedInventories = archived.sort(byName)
  }

  async function dropConnection(sourceId: string): Promise<void> {
    const old = conns.get(sourceId)
    conns.delete(sourceId)
    sourceRevs.delete(sourceId)
    await old?.close().catch(() => {})
  }

  /** Sets a source's inventories and keeps them on the device; only while the source's generation is still current. */
  function storeListing(sourceId: string, inventories: Inventory[]): Promise<void> {
    listings.set(sourceId, inventories)
    return db.putListing(sourceId, inventories)
  }

  async function attempt(config: SourceConfig): Promise<Outcome> {
    const driver = deps.drivers[config.kind]
    if (!driver) return { ok: false, error: new StorageError('failed', 'unsupported_source') }
    let conn: SourceConnection | undefined
    try {
      conn = await driver.connect(config)
      openedWith.set(conn, config.connectionString)
      const { inventories, rev } = await conn.storage.listInventories()
      noteAnswer(config.id)
      return { ok: true, conn, inventories, rev, fresh: true }
    } catch (error) {
      logError('connect', error)
      await conn?.close().catch(() => {})
      return { ok: false, error }
    }
  }

  /** Lists on the source's open connection while the schema is still the one it opened on (checked through it);
   *  otherwise, or if that fails, the connection is closed and opened again, once, which re-evaluates the schema. */
  async function reconnect(config: SourceConfig): Promise<Outcome> {
    const open = conns.get(config.id)
    if (open && connectionStringOf(open) === config.connectionString) {
      try {
        const [inspection, listing] = await Promise.all([open.inspect(), open.storage.listInventories()])
        const opened = open.status.state === 'newer' ? 'newer' : 'current'
        if (inspection.state === opened) return { ok: true, conn: open, ...listing, fresh: false }
      } catch {
        // Opened again below.
      }
      if (conns.get(config.id) === open) conns.delete(config.id)
      await open.close().catch(() => {})
    }
    return attempt(config)
  }

  function failureStatus(
    error: unknown,
    connectionString: string,
  ): { status: SourceStatus; error: string | null; reason: FailureReason } {
    const reason = classifyFailure(error)
    if (error instanceof StorageError && error.code === 'unavailable') return { status: 'unreachable', error: null, reason }
    return { status: 'error', error: redactSecret(errorMessage(error), connectionString), reason }
  }

  /** Only while the source's generation is the one the outcome was attempted under. */
  async function applyOutcome(config: SourceConfig, outcome: Outcome): Promise<void> {
    // State first, the awaits last: nothing can change the source in between.
    if (outcome.ok) {
      const old = conns.get(config.id)
      conns.set(config.id, outcome.conn)
      sourceRevs.set(config.id, outcome.rev)
      // Read-only only when the schema needs a newer app to write (min_app_schema above this app's version): a newer
      // schema that keeps older apps writing is `ready` (soft migrations). Turning read-only, a new version of the app
      // may be out already: look for it now rather than at the next periodic check ("Update to keep editing").
      const status: SourceStatus = outcome.conn.status.state === 'newer' ? 'read_only' : 'ready'
      const wasReadOnly = statusOf(config.id) === 'read_only'
      setSource(config, status, null, null)
      if (status === 'read_only' && !wasReadOnly) deps.checkForUpdate?.()
      const saving = storeListing(config.id, outcome.inventories)
      if (old && old !== outcome.conn) await old.close().catch(() => {})
      await saving
    } else {
      const { status, error, reason } = failureStatus(outcome.error, config.connectionString)
      setSource(config, status, error, reason)
      await dropConnection(config.id)
    }
  }

  /** `connectionString`: the one the failing call's connection was opened with. */
  function markFailure(sourceId: string, error: unknown, connectionString: string): void {
    const config = state.sources.find((s) => s.config.id === sourceId)?.config
    if (!config) return
    const { status, error: text, reason } = failureStatus(error, connectionString)
    logError('source', error)
    setSource(config, status, text, reason)
  }

  async function relist(sourceId: string): Promise<void> {
    const conn = conns.get(sourceId)
    if (!conn) return
    const generation = generationOf(sourceId)
    let inventories: Inventory[]
    let rev: string
    try {
      ;({ inventories, rev } = await conn.storage.listInventories())
    } catch (error) {
      if (generationOf(sourceId) === generation) markFailure(sourceId, error, connectionStringOf(conn))
      return
    }
    // Edited or removed meanwhile: the list is no longer this connection's to set.
    if (generationOf(sourceId) !== generation) return
    sourceRevs.set(sourceId, rev)
    noteAnswer(sourceId)
    const saving = storeListing(sourceId, inventories)
    rebuildInventories()
    await saving
  }

  /**
   * Loads the current inventory's snapshot and shows and caches it.
   *
   * `skipIfUnchanged`: do nothing but mark the shown copy live (its saved time stays as persisted) when it is already at the source's revision. Only the
   * refresh paths ask for this; the load after a wide write never does (it must reload).
   *
   * Ordering argument: the revision stored with a snapshot is the one `loadInventoryWithRev` read in the same
   * transaction as the snapshot, so it is exactly the revision the data is at. A write by another device that lands
   * between the listing and the load is therefore recorded as seen (it is in the snapshot), and the next refresh does
   * not load again. The skip check compares the source's known revision (`sourceRevs`, from the last listInventories)
   * with `shownRev`: a different one means the source changed since this copy was read.
   *
   * Own writes put their rows into the shown copy without a load. A load that started before such rows were put in may
   * have read the source before that write: it gets them on top (catchUp), or, when its revision cannot be ordered
   * against them, the shown copy stays and is marked stale.
   */
  async function loadCurrent(skipIfUnchanged = false): Promise<void> {
    const ref = state.current
    const conn = ref && conns.get(ref.sourceId)
    if (!ref || !conn) return
    const knownRev = sourceRevs.get(ref.sourceId) ?? null
    if (skipIfUnchanged && knownRev !== null && shownRev === knownRev && state.snapshot?.inventory.id === ref.inventoryId) {
      state.snapshotOrigin = 'live'
      return
    }
    const token = ++loadSeq
    const generation = generationOf(ref.sourceId)
    const selected = selection
    // Another inventory selected (even if this one was selected again since), or the source edited or removed
    // meanwhile: the result is nobody's.
    const gone = (): boolean =>
      selection !== selected || !sameRef(state.current, ref) || generationOf(ref.sourceId) !== generation
    loadsRunning++
    const loaded = await conn.storage.loadInventoryWithRev(ref.inventoryId).then(
      (value) => ({ ok: true as const, ...value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    // Own rows put into the shown copy after this load started.
    const missed = ownRows.filter((w) => w.after >= token)
    if (--loadsRunning === 0) ownRows = []
    if (!loaded.ok) {
      // Only the most recently started load reports a failure.
      if (token !== loadSeq || gone()) return
      if (loaded.error instanceof StorageError && loaded.error.code === 'not_found') {
        await dropMissing(ref)
        return
      }
      markFailure(ref.sourceId, loaded.error, connectionStringOf(conn))
      return
    }
    // A load newer than the shown one replaces it, even while a later-started load still runs or has failed.
    if (token <= appliedSeq || gone()) return
    const caught = catchUp(loaded.snapshot, loaded.rev, missed)
    if (!caught) {
      // It may be older than own rows already shown: they stay, and the copy is not proven current.
      shownRev = null
      return
    }
    const { snapshot, rev } = caught
    appliedSeq = token
    // Saved below, with these rows.
    if (unsaved && sameRef(unsaved.ref, ref)) unsaved = null
    const savedAt = nowIso()
    state.snapshot = markRaw(snapshot)
    state.snapshotOrigin = 'live'
    state.snapshotSavedAt = savedAt
    shownRev = rev
    await db.putSnapshot(ref, { snapshot, savedAt, rev: cacheRev(rev), format: FORMAT_MARK })
  }

  /** The current inventory vanished from its (reachable) source: forget it and move to the first remaining one. */
  async function dropMissing(ref: InventoryRef): Promise<void> {
    const generation = generationOf(ref.sourceId)
    await dropCopy(ref)
    if (generationOf(ref.sourceId) === generation) {
      const saving = storeListing(ref.sourceId, (listings.get(ref.sourceId) ?? []).filter((i) => i.id !== ref.inventoryId))
      rebuildInventories()
      await saving
    }
    // The user picked another inventory meanwhile: keep it.
    if (!sameRef(state.current, ref)) return
    const first = state.inventories[0]
    if (first) {
      await selectInventory(first.ref)
    } else {
      setCurrent(null)
      await db.putSettings({ current: null })
    }
  }

  const isConnected = (status: SourceStatus | null): boolean => status === 'ready' || status === 'read_only'

  /** Keeps `current` valid after sources or inventories changed and loads its live snapshot. */
  async function resolveCurrent(): Promise<void> {
    const cur = state.current
    if (cur) {
      const status = statusOf(cur.sourceId)
      // A source that did not answer keeps its inventory and cached copy.
      if (status !== null && !isConnected(status)) return
      if (state.inventories.some((e) => sameRef(e.ref, cur))) {
        await loadCurrent(true)
        return
      }
      await dropCopy(cur)
    }
    const first = state.inventories[0]
    if (first) {
      await selectInventory(first.ref)
    } else if (cur) {
      setCurrent(null)
      await db.putSettings({ current: null })
    }
  }

  async function selectInventory(ref: InventoryRef): Promise<void> {
    setCurrent(ref)
    // A plain copy: refs taken from reactive state are proxies, which IndexedDB cannot clone.
    await db.putSettings({ current: { sourceId: ref.sourceId, inventoryId: ref.inventoryId } })
    const cached = shownCopy(await db.getSnapshot(ref))
    if (!sameRef(state.current, ref)) return
    // A live snapshot of this inventory that landed meanwhile is newer than the cached copy.
    if (state.snapshot?.inventory.id !== ref.inventoryId) {
      state.snapshot = cached ? markRaw(cached.snapshot) : null
      state.snapshotOrigin = cached ? 'cache' : null
      state.snapshotSavedAt = cached?.savedAt ?? null
      shownRev = uncacheRev(cached?.rev)
    }
    if (isConnected(statusOf(ref.sourceId))) await loadCurrent(true)
  }

  async function startFromCache(): Promise<void> {
    const [settings, configs, stored] = await Promise.all([db.getSettings(), db.getSources(), db.getListings()])
    state.persistent = db.persistent
    state.deviceName = settings.deviceName ?? defaultDeviceName(deps.userAgent)
    // A value this app does not know (stored by a newer one) counts as unset.
    state.checkInterval = isCheckInterval(settings.checkInterval) ? settings.checkInterval : DEFAULT_CHECK_INTERVAL
    state.sources = configs.map((config) => ({ config, status: 'connecting', error: null, reason: null }))
    // Lists of the last refresh: inventories can be switched before the first refresh and offline.
    for (const { id } of configs) {
      const list = stored[id]
      if (list && !listings.has(id)) listings.set(id, list)
    }
    rebuildInventories()
    state.current = settings.current
    recompute()
    const cached = settings.current ? shownCopy(await db.getSnapshot(settings.current)) : null
    if (cached && sameRef(state.current, settings.current)) {
      state.snapshot = markRaw(cached.snapshot)
      state.snapshotOrigin = 'cache'
      state.snapshotSavedAt = cached.savedAt
      shownRev = uncacheRev(cached.rev)
    }
    state.started = true
  }

  async function doRefresh(): Promise<void> {
    state.refreshing = true
    lastAttemptAt = now().getTime()
    const startGenerations = new Map(generations)
    try {
      const configs = await db.getSources()
      const previous = new Map(state.sources.map((s) => [s.config.id, s]))
      for (const id of [...conns.keys()]) if (!configs.some((c) => c.id === id)) await dropConnection(id)
      for (const id of [...listings.keys()]) {
        if (configs.some((c) => c.id === id)) continue
        listings.delete(id)
        await db.deleteListing(id)
      }
      state.sources = configs.map((config) => ({
        config,
        status: previous.get(config.id)?.status ?? 'connecting',
        error: previous.get(config.id)?.error ?? null,
        reason: previous.get(config.id)?.reason ?? null,
      }))
      recompute()
      const outcomes = await Promise.all(
        configs.map(async (config) => ({ config, generation: startGenerations.get(config.id) ?? 0, outcome: await reconnect(config) })),
      )
      let complete = true
      for (const { config, generation, outcome } of outcomes) {
        if (!(await settle(config, generation, outcome))) complete = false
      }
      rebuildInventories()
      await resolveCurrent()
      noteCheck(complete)
    } finally {
      state.refreshing = false
    }
  }

  /** Applies a source's reconnect outcome unless the source was edited or removed since `generation`. True when the
   *  source answered and that was applied. */
  async function settle(config: SourceConfig, generation: number, outcome: Outcome): Promise<boolean> {
    if (generation !== generationOf(config.id)) {
      // The source was edited or removed while connecting: this outcome is stale. A reused connection stays open.
      if (outcome.ok && outcome.fresh) await outcome.conn.close().catch(() => {})
      return false
    }
    await applyOutcome(config, outcome)
    return outcome.ok
  }

  /**
   * A check of one source: lists it (reconnecting if needed) and, when it holds the current inventory, brings the
   * shown copy to the listed revision as refresh does (a full load only when it is not there). Never waits for, or
   * retries, another source.
   */
  async function checkSource(sourceId: string): Promise<void> {
    const config = state.sources.find((s) => s.config.id === sourceId)?.config
    if (!config) return
    const generation = generationOf(sourceId)
    await settle(config, generation, await reconnect(config))
    rebuildInventories()
    if (state.current?.sourceId !== sourceId) return
    await resolveCurrent()
    noteCheck(false)
  }

  /** The shown copy is at the revision last known for its source. */
  const shownIsCurrent = (sourceId: string): boolean => shownRev !== null && shownRev === sourceRevs.get(sourceId)

  /**
   * A check counts (the interval starts again) when the current inventory's source answered and the shown copy is at
   * its revision; other sources failing do not matter (syncIfDue retries them on their own). Not one that leaves the
   * shown copy behind (a load that could not be placed against own rows): the interval must not hold off the load
   * it still needs. Without a current inventory: when every source answered (`allAnswered`).
   */
  function noteCheck(allAnswered: boolean): void {
    const cur = state.current
    if (cur ? isConnected(statusOf(cur.sourceId)) && shownIsCurrent(cur.sourceId) : allAnswered) {
      state.lastRefreshAt = nowIso()
    }
  }

  function refresh(): Promise<void> {
    // A run that started before the latest source change (or explicit check) cannot satisfy this call.
    if (refreshing && refreshingEpoch === refreshEpoch) return refreshing
    const previous = refreshing
    const run: Promise<void> = (async () => {
      await previous?.catch(() => {})
      await doRefresh()
    })().finally(() => {
      if (refreshing === run) refreshing = null
    })
    refreshing = run
    refreshingEpoch = refreshEpoch
    return run
  }

  /** A refresh that starts after this call: a run already going may have listed the sources before it. */
  function freshRefresh(): Promise<void> {
    refreshEpoch++
    return refresh()
  }

  const requireConnected = (sourceId: string): void => {
    if (!isConnected(statusOf(sourceId))) throw new StorageError('unavailable')
  }

  /** After a check the user asked for: the shown copy is at its source's revision, or `unavailable`. A copy the check
   *  left behind (its load could not be placed against own rows, or an own write made the revision unknown) gets one
   *  more check of its source alone, which lists it and loads the copy in full. */
  async function requireShownCurrent(): Promise<void> {
    let cur = state.current
    if (!cur) {
      // Nothing shown to vouch for: "up to date" needs every configured source to have answered.
      if (state.sources.some((s) => !isConnected(s.status))) throw new StorageError('unavailable')
      return
    }
    requireConnected(cur.sourceId)
    if (shownIsCurrent(cur.sourceId)) return
    await checkSource(cur.sourceId)
    cur = state.current
    if (cur && !(isConnected(statusOf(cur.sourceId)) && shownIsCurrent(cur.sourceId))) {
      throw new StorageError('unavailable')
    }
  }

  async function sync(): Promise<'unchanged' | 'updated'> {
    const applied = appliedSeq
    await freshRefresh()
    await requireShownCurrent()
    return appliedSeq !== applied ? 'updated' : 'unchanged'
  }

  async function reloadSource(sourceId: string): Promise<void> {
    if (!state.sources.some((s) => s.config.id === sourceId)) throw new StorageError('not_found')
    // Not trusted at any revision: the shown copy loads in full in the refresh below, the device copies when opened.
    // An own write in between cannot vouch for them again (it only moves copies at the revision it started from).
    if (state.current?.sourceId === sourceId) shownRev = null
    const ids = (listings.get(sourceId) ?? []).map((inventory) => inventory.id)
    await Promise.all(ids.map((inventoryId) => db.markSnapshotStale({ sourceId, inventoryId })))
    await freshRefresh()
    requireConnected(sourceId)
    if (state.current?.sourceId === sourceId) await requireShownCurrent()
  }

  async function syncIfDue(): Promise<void> {
    const time = now().getTime()
    const failing = (s: SourceState): boolean => s.status === 'unreachable' || s.status === 'error'
    const cur = state.current
    // The current source failing: retry at once.
    if (cur && state.sources.some((s) => s.config.id === cur.sourceId && failing(s))) return refresh()
    if (state.sources.some(failing)) {
      // Another source keeps failing: retry it now and then; the last attempt checked the current inventory too.
      if (lastAttemptAt === null || time - lastAttemptAt >= FAILED_RETRY_MS) await refresh()
      return
    }
    if (checkDue(time)) await refresh()
  }

  /** The device's interval has passed since the last successful check. */
  function checkDue(time: number): boolean {
    if (state.checkInterval === 'never') return false
    const last = state.lastRefreshAt ? Date.parse(state.lastRefreshAt) : null
    return last === null || time - last >= CHECK_INTERVAL_MS[state.checkInterval]
  }

  /** The gate before a write to, or the journal of, `sourceId`: a check of that source alone (checkSource) when it is
   *  healthy and the interval has passed. Other sources are never waited for or retried here: start, `online`, the
   *  return to the app, sync and reloadSource cover all of them. A failing source is refused by the caller without
   *  a network call. */
  async function checkIfDue(sourceId: string): Promise<void> {
    if (isConnected(statusOf(sourceId)) && checkDue(now().getTime())) await checkSource(sourceId)
  }

  /** Runs `job` after all earlier writes; a failed job does not block later ones. A write to stock buckets marks only
   *  those buckets as saving (spec 4.12): the rest of the app is not locked by it; any other write sets `saving`. */
  function enqueue<T>(job: () => Promise<T>, buckets: string[] = []): Promise<T> {
    if (buckets.length > 0) for (const key of buckets) savingBuckets.set(key, (savingBuckets.get(key) ?? 0) + 1)
    else {
      pendingWrites++
      state.saving = true
    }
    const run = queue.then(job)
    queue = run.then(
      () => {},
      () => {},
    )
    return run.finally(() => {
      if (buckets.length > 0) {
        for (const key of buckets) {
          const left = (savingBuckets.get(key) ?? 1) - 1
          if (left > 0) savingBuckets.set(key, left)
          else savingBuckets.delete(key)
        }
      } else {
        pendingWrites--
        state.saving = pendingWrites > 0
      }
    })
  }

  /** Called before any write is queued, so what they write goes first (a stepper's pending delta, spec 4.12). */
  function runBeforeWrite(): void {
    for (const hook of [...beforeWrite]) {
      try {
        hook()
      } catch {
        // A hook never stops the write it runs before.
      }
    }
  }

  /**
   * One write to `target` (the inventory the command goes to), in call order with the others. The source answers with
   * its revision before and after the write and the rows the command touched; they go into the shown copy instead of a
   * load. See settleWrite for the rules.
   */
  function write(
    target: InventoryRef,
    command: Command,
    snapshotFor: (conn: SourceConnection) => Promise<InventorySnapshot | null>,
  ): Promise<void> {
    const { sourceId } = target
    runBeforeWrite()
    return enqueue(async () => {
      // First refresh still connecting: wait for it rather than failing with a misleading "can't reach".
      if (!conns.has(sourceId) && refreshing) await refreshing.catch(() => {})
      // A check of the target's source that is due goes first: a copy it loads is the one the command is validated
      // against. No deadlock: a check never waits for the queue. A failing source is refused below without one.
      await checkIfDue(sourceId).catch(() => {})
      const status = statusOf(sourceId)
      if (status === 'unreachable' || status === 'read_only' || status === 'error') throw new StorageError('read_only')
      const conn = conns.get(sourceId)
      if (!conn) throw new StorageError('unavailable')
      const normalized = normalizeCommand(command)
      const snapshot = await guarded(sourceId, conn, () => snapshotFor(conn))
      const invalid = validateCommand(normalized, snapshot)
      if (invalid) throw invalid
      const generation = generationOf(sourceId)
      const seq = appliedSeq
      let result: ApplyResult
      try {
        result = await guarded(sourceId, conn, () => conn.storage.apply(normalized, { device: state.deviceName }))
      } catch (error) {
        await writeFailed(sourceId, error)
        throw error
      }
      // For the backup reminder; a lost count only delays it.
      void db.countWrite(sourceId).catch(() => {})
      let reload: boolean
      if (generationOf(sourceId) === generation) {
        const settled = settleWrite(target, result, seq)
        reload = settled.reload
        // The device copies' revisions; a failure leaves an older revision there, which only costs a load.
        if (settled.markStale) await db.markSnapshotStale(target).catch(() => {})
        if (settled.advance) {
          const [from, to] = settled.advance
          await db.advanceSnapshotRevs(sourceId, from, to, target.inventoryId).catch(() => {})
        }
      } else {
        // Edited or removed while the write was on its way: the answer belongs to the old connection.
        if (state.current?.sourceId === sourceId) shownRev = null
        reload = sameRef(state.current, target)
      }
      // 7. The list of inventories changed: read it again. A shown copy left to reload (stale) loads there, once.
      if (isRelistCommand(command)) {
        await relist(sourceId)
        await resolveCurrent()
        if (command.type === 'deletePermanently') await dropCopy({ sourceId, inventoryId: command.id })
      } else if (reload) {
        await loadCurrent()
      }
    }, bucketsOf(command))
  }

  /**
   * Rules for a write the source took, applied to state in one go (no await in between).
   *
   * - 1. In sync: the revision before the write is the one known for the source, so no other write landed since it.
   * - 2. The target is shown and no load replaced it during the write: the rows go on top.
   * - 3. A load replaced it during the write. Exactly at this write's result: kept. Read right before this write: the
   *   rows go on top. Otherwise it may be newer than the rows: kept, and marked stale.
   * - 4. No rows (a wide command, or the target gone): marked stale and reloaded.
   * - 5. The target is not shown: its device copy is marked stale.
   * - 6. In sync: the source's known revision and the shown copy's (if it was at the revision before) move to the one
   *   after, and so do the device copies of other inventories saved at the one before; the write counts as a check
   *   when it proves the shown copy current. Not in sync: the shown copy of this source is marked stale and the
   *   source's revision is unknown again, so no cached copy of it is trusted before the next listing.
   */
  function settleWrite(
    target: InventoryRef,
    { prevRev, rev, patch }: ApplyResult,
    seq: number,
  ): { reload: boolean; markStale: boolean; advance: [string, string] | null } {
    const { sourceId } = target
    const inSync = prevRev !== null && prevRev === sourceRevs.get(sourceId)
    const snapshot = state.snapshot
    const shown = sameRef(state.current, target) && snapshot?.inventory.id === target.inventoryId ? snapshot : null
    let reload = false
    if (shown) {
      const loaded = appliedSeq !== seq
      if (loaded && shownRev === rev) {
        // 3. The load read exactly this write's result.
      } else if (!patch || patch.inventoryId !== target.inventoryId) {
        // 4.
        shownRev = null
        reload = true
      } else if (!loaded || shownRev === prevRev) {
        // 2, or 3 with a load read right before this write.
        state.snapshot = markRaw(patchSnapshot(shown, patch))
        if (loadsRunning > 0) ownRows.push({ after: loadSeq, prevRev, rev, patch })
        markUnsaved(target)
      } else {
        // 3. The load may be newer than these rows.
        shownRev = null
      }
    }
    // 5.
    const markStale = !shown
    // 6.
    const ofSource = state.current?.sourceId === sourceId
    if (!inSync) {
      sourceRevs.delete(sourceId)
      if (ofSource) shownRev = null
      return { reload, markStale, advance: null }
    }
    sourceRevs.set(sourceId, rev)
    if (ofSource && shownRev === prevRev) shownRev = rev
    if (ofSource && shownRev === rev) {
      const at = nowIso()
      state.lastRefreshAt = at
      state.snapshotSavedAt = at
    }
    return { reload, markStale, advance: [cachedRev(prevRev), cachedRev(rev)] }
  }

  /** 8. Unknown outcome (`unavailable`): the write may have landed, so no revision known for the source holds. 9. The
   *  source refused the write the shown copy allowed: the copy disagrees with it, so it is refreshed before the error
   *  is thrown. */
  async function writeFailed(sourceId: string, error: unknown): Promise<void> {
    if (error instanceof StorageError && error.code === 'unavailable') {
      sourceRevs.delete(sourceId)
      if (state.current?.sourceId === sourceId) shownRev = null
    } else if ((error instanceof StorageError && error.code === 'failed') || error instanceof DomainError) {
      // Only the source that refused, and a listing that starts now: a run going may have listed before the refusal.
      await checkSource(sourceId).catch(() => {})
    }
  }

  async function applyTo(ref: InventoryRef, command: Command): Promise<void> {
    // Read when the job runs: earlier queued writes have put their rows into the snapshot by then. Only this
    // inventory's own snapshot counts; until selectInventory shows it, the target is read from the source.
    await write(ref, command, async (conn) => {
      const shown = state.snapshot
      return sameRef(state.current, ref) && shown?.inventory.id === ref.inventoryId
        ? shown
        : conn.storage.loadInventory(ref.inventoryId)
    })
  }

  async function apply(command: Command): Promise<void> {
    const cur = state.current
    if (!cur) throw new StorageError('not_found')
    await applyTo({ sourceId: cur.sourceId, inventoryId: cur.inventoryId }, command)
  }

  const prepare = deps.prepareImage ?? defaultPrepareImage
  const stores = new Map<string, { key: string; store: FileStore | null }>()

  function fileStoreFor(sourceId: string): FileStore | null {
    const config = state.sources.find((s) => s.config.id === sourceId)?.config
    if (!config) return null
    if (deps.fileStores) {
      try {
        return deps.fileStores(config)
      } catch {
        return null
      }
    }
    const key = [
      config.kind,
      config.photoStore ?? '',
      config.uploadcarePublicKey ?? '',
      config.uploadcareCdnBase ?? '',
      config.cloudinaryCloudName ?? '',
      config.cloudinaryUploadPreset ?? '',
      config.imgurClientId ?? '',
    ].join('|')
    const known = stores.get(sourceId)
    if (known?.key === key) return known.store
    let store: FileStore | null
    try {
      store = defaultFileStore(config)
    } catch {
      store = null
    }
    stores.set(sourceId, { key, store })
    return store
  }

  /** Checks that must pass before anything is uploaded. */
  function photoTarget(): { cur: InventoryRef; store: FileStore } {
    if (state.readOnly) throw new StorageError('read_only')
    const cur = state.current
    if (!cur || !state.snapshot) throw new StorageError('not_found')
    const store = fileStoreFor(cur.sourceId)
    if (!store) throw new FileError('no_store')
    return { cur, store }
  }

  /** Upload errors are FileErrors and never touch the source's status. */
  async function uploadOne(store: FileStore, file: File): Promise<{ provider: string; fileId: string; url: string }> {
    const blob = await prepare(file)
    return store.upload(blob, file.name)
  }

  async function addPhotos(itemId: Id, files: File[], onProgress?: (done: number) => void): Promise<void> {
    // The target is fixed before the first upload: switching inventory meanwhile must not redirect the writes.
    const { cur, store } = photoTarget()
    let done = 0
    for (const file of files) {
      const stored = await uploadOne(store, file)
      await applyTo(cur, { type: 'photo.add', id: newId(), itemId, variantId: null, ...stored })
      onProgress?.(++done)
    }
  }

  /** Two writes, because core allows one photo per variant and a storage apply takes one command: a failure between
   *  them leaves the variant without a photo. A failed add rejects with its own error and is not retried. */
  async function setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void> {
    const { cur, store } = photoTarget()
    // Upload first: a failed upload leaves the old photo in place.
    const stored = await uploadOne(store, file)
    // Looked up only now, after the upload and the writes queued before this one, in the freshest snapshot of the target.
    await queueIdle()
    const snapshot = await snapshotOf(cur)
    const old = snapshot?.photos.find((p) => p.variantId === variantId)
    if (old) await applyTo(cur, { type: 'photo.remove', id: old.id })
    await applyTo(cur, { type: 'photo.add', id: newId(), itemId, variantId, ...stored })
  }

  /** Resolves when the writes queued so far are done (their rows in the snapshot included). */
  const queueIdle = (): Promise<void> => queue

  /** The shown snapshot when it is the target's, otherwise the target read from its source. */
  async function snapshotOf(ref: InventoryRef): Promise<InventorySnapshot | null> {
    const shown = state.snapshot
    if (sameRef(state.current, ref) && shown?.inventory.id === ref.inventoryId) return shown
    const conn = conns.get(ref.sourceId)
    if (!conn) return null
    return guarded(ref.sourceId, conn, () => conn.storage.loadInventory(ref.inventoryId))
  }

  async function removePhoto(photoId: Id): Promise<void> {
    await apply({ type: 'photo.remove', id: photoId })
  }

  async function makeCover(itemId: Id, photoId: Id): Promise<void> {
    const own = (state.snapshot?.photos ?? []).filter((p) => p.itemId === itemId).sort((a, b) => a.position - b.position)
    const orderedIds = [photoId, ...own.map((p) => p.id).filter((id) => id !== photoId)]
    await apply({ type: 'photo.reorder', itemId, orderedIds })
  }

  /** The current inventory's source and connection; `unavailable` while it has none or is failing. */
  function journalSource(): { sourceId: string; conn: SourceConnection } {
    const cur = state.current
    const status = cur ? statusOf(cur.sourceId) : null
    const conn = cur && conns.get(cur.sourceId)
    if (!cur || !conn || status === 'unreachable' || status === 'error') throw new StorageError('unavailable')
    return { sourceId: cur.sourceId, conn }
  }

  async function loadMovements(itemId: Id): Promise<Movement[]> {
    // Fails fast first: a failing source is not retried for the journal.
    await checkIfDue(journalSource().sourceId).catch(() => {})
    const { sourceId, conn } = journalSource()
    return guarded(sourceId, conn, () => conn.storage.loadMovements(itemId))
  }

  /** Earlier receipts of a shop lot in the current inventory (spec 4.10); rejects like loadMovements while offline. */
  async function findReceiptsBySource(key: string): Promise<SourceReceipt[]> {
    const { sourceId, conn } = journalSource()
    const inventoryId = state.current!.inventoryId
    return guarded(sourceId, conn, () => conn.storage.findReceiptsBySource(inventoryId, key))
  }

  async function exportSource(sourceId: string): Promise<BackupFile> {
    const entry = state.sources.find((s) => s.config.id === sourceId)
    const conn = conns.get(sourceId)
    if (!entry) throw new StorageError('not_found')
    if (!conn || entry.status === 'unreachable' || entry.status === 'error' || entry.status === 'connecting') {
      throw new StorageError('unavailable')
    }
    // Everything is read before anything is returned: a failure midway leaves no partial file.
    return guarded(sourceId, conn, async () => {
      const inventories = []
      for (const { id } of (await conn.storage.listInventories()).inventories) {
        try {
          // One read transaction per inventory: the snapshot and its movements agree.
          inventories.push(await conn.storage.exportInventory(id))
        } catch (e) {
          // Removed since the list was read: not part of the backup.
          if (e instanceof StorageError && e.code === 'not_found') continue
          throw e
        }
      }
      return buildBackup({
        exportedAt: nowIso(),
        app: { schemaVersion: APP_SCHEMA_VERSION },
        source: { name: entry.config.name, kind: entry.config.kind },
        inventories,
      })
    })
  }

  /**
   * A wide write: the backup's rows go into the source in batches (InventoryStorage.restore), after the writes queued
   * before it and before those queued after. Then, as "Reload everything", no copy of the source is trusted (a run that
   * failed midway may have written some batches too), and the first restored active inventory is shown.
   */
  async function restoreSource(
    sourceId: string,
    backup: BackupFile,
    mode: RestoreMode,
    fileSha256: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ inventoryIds: Id[] }> {
    if (!state.sources.some((s) => s.config.id === sourceId)) throw new StorageError('not_found')
    const runId = await db.restoreRunId(fileSha256)
    let started = false
    let result: { inventoryIds: Id[] }
    try {
      result = await enqueue(async () => {
        const status = statusOf(sourceId)
        if (status === 'read_only') throw new StorageError('read_only')
        const conn = conns.get(sourceId)
        if (status !== 'ready' || !conn) throw new StorageError('unavailable')
        started = true
        return guarded(sourceId, conn, () => conn.storage.restore(backup, mode, runId, onProgress))
      })
    } catch (error) {
      if (started) await reloadSource(sourceId).catch(() => {})
      throw error
    }
    await reloadSource(sourceId).catch(() => {})
    const first = state.inventories.find((e) => e.ref.sourceId === sourceId && result.inventoryIds.includes(e.inventory.id))
    if (first) await selectInventory(first.ref)
    return result
  }

  /** Runs a storage call on `conn`: an `unavailable` failure marks the source, any failure is redacted with the
   *  connection string `conn` was opened with, even if the source was edited or removed since. */
  async function guarded<T>(sourceId: string, conn: SourceConnection, call: () => Promise<T>): Promise<T> {
    const connectionString = connectionStringOf(conn)
    try {
      const result = await call()
      noteAnswer(sourceId)
      return result
    } catch (error) {
      if (error instanceof StorageError && error.code === 'unavailable') markFailure(sourceId, error, connectionString)
      else logError('storage', error)
      if (error instanceof DomainError) throw new DomainError(error.code, redactSecret(error.message, connectionString))
      throw sanitize(error, connectionString)
    }
  }

  /** Neon's compute sleeps after minutes of quiet: the first request after that is slow. Before a form that is about to
   *  write, one light request wakes it, only when the source has been silent for longer than this. */
  const WARM_AFTER_MS = 4 * 60_000
  let warming: Promise<void> | null = null
  function warmUp(): Promise<void> {
    const sourceId = state.current?.sourceId
    if (!sourceId || !isConnected(statusOf(sourceId))) return Promise.resolve()
    const last = answeredAt.get(sourceId)
    if (last !== undefined && now().getTime() - last <= WARM_AFTER_MS) return Promise.resolve()
    return (warming ??= relist(sourceId).catch(() => {}).finally(() => {
      warming = null
    }))
  }

  return {
    state,
    warmUp,
    startFromCache,
    refresh,
    sync,
    reloadSource,
    syncIfDue,
    async start() {
      await startFromCache()
      await refresh()
    },
    flushCache: saveShown,
    selectInventory,
    apply,
    applyTo,
    isBucketSaving: (itemId, variantId) => savingBuckets.has(bucketKey(itemId, variantId)),
    onBeforeWrite(hook) {
      beforeWrite.add(hook)
      return () => {
        beforeWrite.delete(hook)
      }
    },
    loadMovements,
    findReceiptsBySource,
    exportSource,
    restoreSource,
    backupInfo: (sourceId) => db.getBackupInfo(sourceId),
    noteBackup: (sourceId) => db.noteBackup(sourceId, nowIso()),
    fileStoreFor,
    addPhotos,
    setVariantPhoto,
    removePhoto,
    makeCover,
    async createInventory({ sourceId, name, currency, id: given }) {
      const id = given ?? newId()
      const ref = { sourceId, inventoryId: id }
      await write(ref, { type: 'inventory.create', id, name, description: null, currency }, async () => null)
      await selectInventory(ref)
      return ref
    },
    async addSource(input) {
      const config: SourceConfig = { ...input, id: newId(), createdAt: nowIso() }
      const outcome = await attempt(config)
      if (!outcome.ok) throw sanitize(outcome.error, config.connectionString)
      await db.putSource(config)
      bumpGeneration(config.id)
      await applyOutcome(config, outcome)
      rebuildInventories()
      await resolveCurrent()
      return config
    },
    async updateSource(id, patch) {
      const old = state.sources.find((s) => s.config.id === id)?.config
      if (!old) throw new StorageError('not_found')
      const config: SourceConfig = { ...old, ...patch }
      bumpGeneration(id)
      // Shown at once, so an overlapping update builds on this one.
      setSource(config, 'connecting', null, null)
      await db.putSource(config)
      // A refresh that read the device before this save must not apply the old config.
      bumpGeneration(id)
      const generation = generationOf(id)
      const outcome = await attempt(config)
      if (generationOf(id) !== generation) {
        // Removed or edited again meanwhile: the later call decides.
        if (outcome.ok) await outcome.conn.close().catch(() => {})
        return
      }
      await applyOutcome(config, outcome)
      rebuildInventories()
      await resolveCurrent()
      if (!outcome.ok) throw sanitize(outcome.error, config.connectionString)
    },
    async removeSource(id) {
      bumpGeneration(id)
      await dropConnection(id)
      listings.delete(id)
      await db.deleteSource(id)
      await db.deleteListing(id)
      // Object URLs of device photos (the demo source) are no longer needed.
      releaseDeviceUrls()
      // A refresh that read the device before this removal was saved must not bring the source back.
      bumpGeneration(id)
      state.sources = state.sources.filter((s) => s.config.id !== id)
      rebuildInventories()
      if (state.current?.sourceId === id) {
        setCurrent(null)
        await db.putSettings({ current: null })
        await resolveCurrent()
      }
    },
    async setDeviceName(name) {
      const trimmed = name.trim()
      await db.putSettings({ deviceName: trimmed || null })
      state.deviceName = trimmed || defaultDeviceName(deps.userAgent)
    },
    async setCheckInterval(value) {
      await db.putSettings({ checkInterval: value })
      state.checkInterval = value
    },
  }
}
