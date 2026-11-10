import {
  DomainError,
  FileError,
  newId,
  normalizeCommand,
  StorageError,
  validateCommand,
  type Command,
  type FileStore,
  type Id,
  type Inventory,
  type InventorySnapshot,
  type Movement,
} from '@graymatter/core'
import { createUploadcareStore } from '@graymatter/files-uploadcare'
import { markRaw, reactive } from 'vue'
import { createDeviceFileStore } from './device-files'
import { prepareImage as defaultPrepareImage } from './images'
import { defaultDeviceName } from './device-name'
import { classifyFailure, redactSecret, type FailureReason, type SourceConnection } from './sources'
import type { InventoryRef, SourceConfig } from './types'
import type { InventoryEntry, SourceState, SourceStatus, Workspace, WorkspaceDeps, WorkspaceState } from './workspace-types'

export type {
  InventoryEntry,
  ReadOnlyReason,
  SourceState,
  SourceStatus,
  Workspace,
  WorkspaceDeps,
  WorkspaceState,
} from './workspace-types'

/** refreshIfStale retries a failing source that is not the current one at most this often. */
export const FAILED_RETRY_MS = 5 * 60_000

type Outcome =
  /** `fresh`: opened by this attempt rather than the source's open connection. */
  | { ok: true; conn: SourceConnection; inventories: Inventory[]; fresh: boolean }
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

/** Demo source: the device store. Neon with a public key: Uploadcare. Anything else: none. */
export function defaultFileStore(config: SourceConfig): FileStore | null {
  if (config.kind === 'dev-pglite') return createDeviceFileStore()
  const key = config.uploadcarePublicKey?.trim()
  if (config.kind === 'neon' && key) {
    return createUploadcareStore({ publicKey: key, cdnBase: config.uploadcareCdnBase ?? undefined })
  }
  return null
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
    refreshing: false,
    saving: false,
    readOnly: null,
  })

  /** Open connections; refreshes reuse them until one fails. */
  const conns = new Map<string, SourceConnection>()
  /** The connection string each connection was opened with: its errors are redacted with it, even after the source
   *  was edited or removed. */
  const openedWith = new WeakMap<SourceConnection, string>()
  const connectionStringOf = (conn: SourceConnection): string => openedWith.get(conn) ?? ''
  /** Last known inventories (active and archived) per source; also kept on the device and while the source is unreachable. */
  const listings = new Map<string, Inventory[]>()
  let queue: Promise<void> = Promise.resolve()
  let pendingWrites = 0
  let refreshing: Promise<void> | null = null
  let refreshEpoch = 0
  let refreshingEpoch = -1
  /** Number of the last started snapshot load, and of the last one written to state. */
  let loadSeq = 0
  let appliedSeq = 0
  /** When the last refresh started, in ms. */
  let lastAttemptAt: number | null = null
  /** Bumped whenever a source is added, edited or removed; stale connect outcomes are discarded. */
  const generations = new Map<string, number>()
  const generationOf = (id: string): number => generations.get(id) ?? 0
  const bumpGeneration = (id: string): void => {
    generations.set(id, generationOf(id) + 1)
    refreshEpoch++
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
      state.snapshot = null
      state.snapshotOrigin = null
      state.snapshotSavedAt = null
    }
    state.current = ref
    recompute()
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
      const inventories = await conn.storage.listInventories()
      return { ok: true, conn, inventories, fresh: true }
    } catch (error) {
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
        const [inspection, inventories] = await Promise.all([open.inspect(), open.storage.listInventories()])
        const opened = open.status.state === 'newer' ? 'newer' : 'current'
        if (inspection.state === opened) return { ok: true, conn: open, inventories, fresh: false }
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
      setSource(config, outcome.conn.status.state === 'newer' ? 'read_only' : 'ready', null, null)
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
    setSource(config, status, text, reason)
  }

  async function relist(sourceId: string): Promise<void> {
    const conn = conns.get(sourceId)
    if (!conn) return
    const generation = generationOf(sourceId)
    let inventories: Inventory[]
    try {
      inventories = await conn.storage.listInventories()
    } catch (error) {
      if (generationOf(sourceId) === generation) markFailure(sourceId, error, connectionStringOf(conn))
      return
    }
    // Edited or removed meanwhile: the list is no longer this connection's to set.
    if (generationOf(sourceId) !== generation) return
    const saving = storeListing(sourceId, inventories)
    rebuildInventories()
    await saving
  }

  async function loadCurrent(): Promise<void> {
    const ref = state.current
    const conn = ref && conns.get(ref.sourceId)
    if (!ref || !conn) return
    const token = ++loadSeq
    const generation = generationOf(ref.sourceId)
    // Another inventory selected, or the source edited or removed meanwhile: the result is nobody's.
    const gone = (): boolean => !sameRef(state.current, ref) || generationOf(ref.sourceId) !== generation
    let snapshot: InventorySnapshot
    try {
      snapshot = await conn.storage.loadInventory(ref.inventoryId)
    } catch (error) {
      // Only the most recently started load reports a failure.
      if (token !== loadSeq || gone()) return
      if (error instanceof StorageError && error.code === 'not_found') {
        await dropMissing(ref)
        return
      }
      markFailure(ref.sourceId, error, connectionStringOf(conn))
      return
    }
    // A load newer than the shown one replaces it, even while a later-started load still runs or has failed.
    if (token <= appliedSeq || gone()) return
    appliedSeq = token
    const savedAt = nowIso()
    state.snapshot = markRaw(snapshot)
    state.snapshotOrigin = 'live'
    state.snapshotSavedAt = savedAt
    await db.putSnapshot(ref, { snapshot, savedAt })
  }

  /** The current inventory vanished from its (reachable) source: forget it and move to the first remaining one. */
  async function dropMissing(ref: InventoryRef): Promise<void> {
    const generation = generationOf(ref.sourceId)
    await db.deleteSnapshot(ref)
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
        await loadCurrent()
        return
      }
      await db.deleteSnapshot(cur)
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
    const cached = await db.getSnapshot(ref)
    if (!sameRef(state.current, ref)) return
    // A live snapshot of this inventory that landed meanwhile is newer than the cached copy.
    if (state.snapshot?.inventory.id !== ref.inventoryId) {
      state.snapshot = cached ? markRaw(cached.snapshot) : null
      state.snapshotOrigin = cached ? 'cache' : null
      state.snapshotSavedAt = cached?.savedAt ?? null
    }
    if (isConnected(statusOf(ref.sourceId))) await loadCurrent()
  }

  async function startFromCache(): Promise<void> {
    const [settings, configs, stored] = await Promise.all([db.getSettings(), db.getSources(), db.getListings()])
    state.persistent = db.persistent
    state.deviceName = settings.deviceName ?? defaultDeviceName(deps.userAgent)
    state.sources = configs.map((config) => ({ config, status: 'connecting', error: null, reason: null }))
    // Lists of the last refresh: inventories can be switched before the first refresh and offline.
    for (const { id } of configs) {
      const list = stored[id]
      if (list && !listings.has(id)) listings.set(id, list)
    }
    rebuildInventories()
    state.current = settings.current
    recompute()
    const cached = settings.current ? await db.getSnapshot(settings.current) : null
    if (cached && sameRef(state.current, settings.current)) {
      state.snapshot = markRaw(cached.snapshot)
      state.snapshotOrigin = 'cache'
      state.snapshotSavedAt = cached.savedAt
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
        if (generation !== generationOf(config.id)) {
          // The source was edited or removed while connecting: this outcome is stale. A reused connection stays open.
          if (outcome.ok && outcome.fresh) await outcome.conn.close().catch(() => {})
          complete = false
          continue
        }
        if (!outcome.ok) complete = false
        await applyOutcome(config, outcome)
      }
      rebuildInventories()
      await resolveCurrent()
      // A failed load (or a source lost meanwhile) is not a refresh: the next trigger must retry.
      const cur = state.current
      if (complete && (!cur || isConnected(statusOf(cur.sourceId)))) state.lastRefreshAt = nowIso()
    } finally {
      state.refreshing = false
    }
  }

  function refresh(): Promise<void> {
    // A run that started before the latest source change cannot satisfy this call.
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

  /** Runs `job` after all earlier writes; a failed job does not block later ones. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    pendingWrites++
    state.saving = true
    const run = queue.then(job)
    queue = run.then(
      () => {},
      () => {},
    )
    return run.finally(() => {
      pendingWrites--
      state.saving = pendingWrites > 0
    })
  }

  function write(
    sourceId: string,
    command: Command,
    snapshotFor: (conn: SourceConnection) => Promise<InventorySnapshot | null>,
  ): Promise<void> {
    return enqueue(async () => {
      // First refresh still connecting: wait for it rather than failing with a misleading "can't reach".
      if (!conns.has(sourceId) && refreshing) await refreshing.catch(() => {})
      const status = statusOf(sourceId)
      if (status === 'unreachable' || status === 'read_only' || status === 'error') throw new StorageError('read_only')
      const conn = conns.get(sourceId)
      if (!conn) throw new StorageError('unavailable')
      const normalized = normalizeCommand(command)
      const snapshot = await guarded(sourceId, conn, () => snapshotFor(conn))
      const invalid = validateCommand(normalized, snapshot)
      if (invalid) throw invalid
      await guarded(sourceId, conn, () => conn.storage.apply(normalized, { device: state.deviceName }))
      if (isRelistCommand(command)) {
        await relist(sourceId)
        await resolveCurrent()
        if (command.type === 'deletePermanently') await db.deleteSnapshot({ sourceId, inventoryId: command.id })
      } else if (state.current?.sourceId === sourceId) {
        await loadCurrent()
      }
    })
  }

  async function applyTo(ref: InventoryRef, command: Command): Promise<void> {
    // Read when the job runs: earlier queued writes have reloaded the snapshot by then. Only this inventory's own
    // snapshot counts; until selectInventory shows it, the target is read from the source.
    await write(ref.sourceId, command, async (conn) => {
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
    if (deps.fileStores) return deps.fileStores(config)
    const key = `${config.kind}|${config.uploadcarePublicKey ?? ''}|${config.uploadcareCdnBase ?? ''}`
    const known = stores.get(sourceId)
    if (known?.key === key) return known.store
    const store = defaultFileStore(config)
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
    const { store } = photoTarget()
    let done = 0
    for (const file of files) {
      const stored = await uploadOne(store, file)
      await apply({ type: 'photo.add', id: newId(), itemId, variantId: null, ...stored })
      onProgress?.(++done)
    }
  }

  async function setVariantPhoto(itemId: Id, variantId: Id, file: File): Promise<void> {
    const { store } = photoTarget()
    // Upload first: a failed upload leaves the old photo in place.
    const stored = await uploadOne(store, file)
    const old = state.snapshot?.photos.find((p) => p.variantId === variantId)
    if (old) await apply({ type: 'photo.remove', id: old.id })
    await apply({ type: 'photo.add', id: newId(), itemId, variantId, ...stored })
  }

  async function removePhoto(photoId: Id): Promise<void> {
    await apply({ type: 'photo.remove', id: photoId })
  }

  async function makeCover(itemId: Id, photoId: Id): Promise<void> {
    const own = (state.snapshot?.photos ?? []).filter((p) => p.itemId === itemId).sort((a, b) => a.position - b.position)
    const orderedIds = [photoId, ...own.map((p) => p.id).filter((id) => id !== photoId)]
    await apply({ type: 'photo.reorder', itemId, orderedIds })
  }

  async function loadMovements(itemId: Id): Promise<Movement[]> {
    const cur = state.current
    const status = cur ? statusOf(cur.sourceId) : null
    const conn = cur && conns.get(cur.sourceId)
    if (!cur || !conn || status === 'unreachable' || status === 'error') throw new StorageError('unavailable')
    return guarded(cur.sourceId, conn, () => conn.storage.loadMovements(itemId))
  }

  /** Runs a storage call on `conn`: an `unavailable` failure marks the source, any failure is redacted with the
   *  connection string `conn` was opened with, even if the source was edited or removed since. */
  async function guarded<T>(sourceId: string, conn: SourceConnection, call: () => Promise<T>): Promise<T> {
    const connectionString = connectionStringOf(conn)
    try {
      return await call()
    } catch (error) {
      if (error instanceof StorageError && error.code === 'unavailable') markFailure(sourceId, error, connectionString)
      if (error instanceof DomainError) throw new DomainError(error.code, redactSecret(error.message, connectionString))
      throw sanitize(error, connectionString)
    }
  }

  return {
    state,
    startFromCache,
    refresh,
    async refreshIfStale(maxAgeMs) {
      const time = now().getTime()
      const failing = (s: SourceState): boolean => s.status === 'unreachable' || s.status === 'error'
      const cur = state.current
      // The current source failing: retry at once.
      if (cur && state.sources.some((s) => s.config.id === cur.sourceId && failing(s))) return refresh()
      if (state.sources.some(failing)) {
        // Another source keeps failing: retry it now and then; the last attempt loaded the current inventory.
        if (lastAttemptAt === null || time - lastAttemptAt >= Math.min(maxAgeMs, FAILED_RETRY_MS)) await refresh()
        return
      }
      const last = state.lastRefreshAt ? Date.parse(state.lastRefreshAt) : null
      if (last === null || time - last >= maxAgeMs) await refresh()
    },
    async start() {
      await startFromCache()
      await refresh()
    },
    selectInventory,
    apply,
    applyTo,
    loadMovements,
    fileStoreFor,
    addPhotos,
    setVariantPhoto,
    removePhoto,
    makeCover,
    async createInventory({ sourceId, name, currency }) {
      const id = newId()
      await write(sourceId, { type: 'inventory.create', id, name, description: null, currency }, async () => null)
      const ref = { sourceId, inventoryId: id }
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
  }
}
