import {
  DomainError,
  newId,
  normalizeCommand,
  StorageError,
  validateCommand,
  type Command,
  type Id,
  type Inventory,
  type InventorySnapshot,
  type Movement,
} from '@graymatter/core'
import { markRaw, reactive } from 'vue'
import type { DeviceDb } from './device-db'
import { defaultDeviceName } from './device-name'
import { classifyFailure, redactSecret, type FailureReason, type SourceConnection, type SourceDriver } from './sources'
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
  /** Device data and the cached snapshot of `current`; no network. */
  startFromCache(): Promise<void>
  /** Connect sources, list inventories, load the current snapshot. */
  refresh(): Promise<void>
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
  updateSource(
    id: string,
    patch: Partial<Pick<SourceConfig, 'name' | 'connectionString' | 'uploadcarePublicKey'>>,
  ): Promise<void>
  removeSource(id: string): Promise<void>
  setDeviceName(name: string): Promise<void>
}

type Outcome =
  | { ok: true; conn: SourceConnection; inventories: Inventory[] }
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

  const conns = new Map<string, SourceConnection>()
  /** Last known inventories (active and archived) per source; kept while the source is unreachable. */
  const listings = new Map<string, Inventory[]>()
  let queue: Promise<void> = Promise.resolve()
  let pendingWrites = 0
  let refreshing: Promise<void> | null = null
  let refreshEpoch = 0
  let refreshingEpoch = -1
  let loadSeq = 0
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
    state.current = ref
    if (!ref) {
      state.snapshot = null
      state.snapshotOrigin = null
      state.snapshotSavedAt = null
    }
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

  async function attempt(config: SourceConfig): Promise<Outcome> {
    const driver = deps.drivers[config.kind]
    if (!driver) return { ok: false, error: new StorageError('failed', 'unsupported_source') }
    let conn: SourceConnection | undefined
    try {
      conn = await driver.connect(config)
      const inventories = await conn.storage.listInventories()
      return { ok: true, conn, inventories }
    } catch (error) {
      await conn?.close().catch(() => {})
      return { ok: false, error }
    }
  }

  function failureStatus(
    error: unknown,
    config: SourceConfig,
  ): { status: SourceStatus; error: string | null; reason: FailureReason } {
    const reason = classifyFailure(error)
    if (error instanceof StorageError && error.code === 'unavailable') return { status: 'unreachable', error: null, reason }
    return { status: 'error', error: redactSecret(errorMessage(error), config.connectionString), reason }
  }

  async function applyOutcome(config: SourceConfig, outcome: Outcome): Promise<void> {
    if (outcome.ok) {
      const old = conns.get(config.id)
      conns.set(config.id, outcome.conn)
      if (old && old !== outcome.conn) await old.close().catch(() => {})
      listings.set(config.id, outcome.inventories)
      setSource(config, outcome.conn.status.state === 'newer' ? 'read_only' : 'ready', null, null)
    } else {
      await dropConnection(config.id)
      const { status, error, reason } = failureStatus(outcome.error, config)
      setSource(config, status, error, reason)
    }
  }

  function markFailure(sourceId: string, error: unknown): void {
    const config = state.sources.find((s) => s.config.id === sourceId)?.config
    if (!config) return
    const { status, error: text, reason } = failureStatus(error, config)
    setSource(config, status, text, reason)
  }

  async function relist(sourceId: string): Promise<void> {
    const conn = conns.get(sourceId)
    if (!conn) return
    try {
      listings.set(sourceId, await conn.storage.listInventories())
      rebuildInventories()
    } catch (error) {
      markFailure(sourceId, error)
    }
  }

  async function loadCurrent(): Promise<void> {
    const ref = state.current
    const conn = ref && conns.get(ref.sourceId)
    if (!ref || !conn) return
    // Only the most recently started load may write state and cache.
    const token = ++loadSeq
    let snapshot: InventorySnapshot
    try {
      snapshot = await conn.storage.loadInventory(ref.inventoryId)
    } catch (error) {
      if (token !== loadSeq || !sameRef(state.current, ref)) return
      if (error instanceof StorageError && error.code === 'not_found') {
        await dropMissing(ref)
        return
      }
      markFailure(ref.sourceId, error)
      return
    }
    if (token !== loadSeq || !sameRef(state.current, ref)) return
    const savedAt = nowIso()
    state.snapshot = markRaw(snapshot)
    state.snapshotOrigin = 'live'
    state.snapshotSavedAt = savedAt
    await db.putSnapshot(ref, { snapshot, savedAt })
  }

  /** The current inventory vanished from its (reachable) source: forget it and move to the first remaining one. */
  async function dropMissing(ref: InventoryRef): Promise<void> {
    await db.deleteSnapshot(ref)
    listings.set(ref.sourceId, (listings.get(ref.sourceId) ?? []).filter((i) => i.id !== ref.inventoryId))
    rebuildInventories()
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
    state.snapshot = cached ? markRaw(cached.snapshot) : null
    state.snapshotOrigin = cached ? 'cache' : null
    state.snapshotSavedAt = cached?.savedAt ?? null
    if (isConnected(statusOf(ref.sourceId))) await loadCurrent()
  }

  async function startFromCache(): Promise<void> {
    const [settings, configs] = await Promise.all([db.getSettings(), db.getSources()])
    state.persistent = db.persistent
    state.deviceName = settings.deviceName ?? defaultDeviceName(deps.userAgent)
    state.sources = configs.map((config) => ({ config, status: 'connecting', error: null, reason: null }))
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
    const startGenerations = new Map(generations)
    try {
      const configs = await db.getSources()
      const previous = new Map(state.sources.map((s) => [s.config.id, s]))
      for (const id of [...conns.keys()]) if (!configs.some((c) => c.id === id)) await dropConnection(id)
      for (const id of [...listings.keys()]) if (!configs.some((c) => c.id === id)) listings.delete(id)
      state.sources = configs.map((config) => ({
        config,
        status: previous.get(config.id)?.status ?? 'connecting',
        error: previous.get(config.id)?.error ?? null,
        reason: previous.get(config.id)?.reason ?? null,
      }))
      recompute()
      const outcomes = await Promise.all(
        configs.map(async (config) => ({ config, generation: startGenerations.get(config.id) ?? 0, outcome: await attempt(config) })),
      )
      let complete = true
      for (const { config, generation, outcome } of outcomes) {
        if (generation !== generationOf(config.id)) {
          // The source was edited or removed while connecting: this outcome is stale.
          if (outcome.ok) await outcome.conn.close().catch(() => {})
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
      const snapshot = await guarded(sourceId, () => snapshotFor(conn))
      const invalid = validateCommand(normalized, snapshot)
      if (invalid) throw invalid
      await guarded(sourceId, () => conn.storage.apply(normalized, { device: state.deviceName }))
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
    // Read when the job runs: earlier queued writes have reloaded the snapshot by then.
    await write(ref.sourceId, command, async (conn) =>
      sameRef(state.current, ref) ? state.snapshot : conn.storage.loadInventory(ref.inventoryId),
    )
  }

  async function apply(command: Command): Promise<void> {
    const cur = state.current
    if (!cur) throw new StorageError('not_found')
    await applyTo({ sourceId: cur.sourceId, inventoryId: cur.inventoryId }, command)
  }

  async function loadMovements(itemId: Id): Promise<Movement[]> {
    const cur = state.current
    const status = cur ? statusOf(cur.sourceId) : null
    const conn = cur && conns.get(cur.sourceId)
    if (!cur || !conn || status === 'unreachable' || status === 'error') throw new StorageError('unavailable')
    return guarded(cur.sourceId, () => conn.storage.loadMovements(itemId))
  }

  /** Runs a storage call: an `unavailable` failure marks the source, any failure is redacted. */
  async function guarded<T>(sourceId: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (error instanceof StorageError && error.code === 'unavailable') markFailure(sourceId, error)
      throw redactError(error, sourceId)
    }
  }

  function redactError(error: unknown, sourceId: string): Error {
    const cs = state.sources.find((s) => s.config.id === sourceId)?.config.connectionString ?? ''
    if (error instanceof DomainError) return new DomainError(error.code, redactSecret(error.message, cs))
    return sanitize(error, cs)
  }

  return {
    state,
    startFromCache,
    refresh,
    async refreshIfStale(maxAgeMs) {
      const last = state.lastRefreshAt ? Date.parse(state.lastRefreshAt) : null
      const failing = state.sources.some((s) => s.status === 'unreachable' || s.status === 'error')
      if (failing || last === null || now().getTime() - last >= maxAgeMs) await refresh()
    },
    async start() {
      await startFromCache()
      await refresh()
    },
    selectInventory,
    apply,
    applyTo,
    loadMovements,
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
      await db.putSource(config)
      setSource(config, 'connecting', null, null)
      const outcome = await attempt(config)
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
