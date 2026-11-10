import {
  newId,
  normalizeCommand,
  StorageError,
  validateCommand,
  type Command,
  type Inventory,
  type InventorySnapshot,
} from '@graymatter/core'
import { reactive } from 'vue'
import type { DeviceDb } from './device-db'
import { defaultDeviceName } from './device-name'
import { redactSecret, type SourceConnection, type SourceDriver } from './sources'
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
  /** Already redacted. */
  error: string | null
}
export type ReadOnlyReason = 'offline' | 'schema_newer' | 'source_error'

export interface WorkspaceState {
  started: boolean
  persistent: boolean
  deviceName: string
  sources: SourceState[]
  /** Active only, sorted by name (localeCompare, numeric, base). */
  inventories: InventoryEntry[]
  current: InventoryRef | null
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
  return c.type.startsWith('inventory.') || c.type === 'restore' || (c.type === 'archive' && c.target === 'inventory')
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
  /** Last known active inventories per source; kept while the source is unreachable. */
  const listings = new Map<string, Inventory[]>()
  let queue: Promise<void> = Promise.resolve()
  let pendingWrites = 0
  let refreshing: Promise<void> | null = null

  const statusOf = (sourceId: string): SourceStatus | null =>
    state.sources.find((s) => s.config.id === sourceId)?.status ?? null

  function recompute(): void {
    const status = state.current ? statusOf(state.current.sourceId) : null
    state.readOnly =
      status === 'unreachable' ? 'offline' : status === 'read_only' ? 'schema_newer' : status === 'error' ? 'source_error' : null
  }

  function setSource(config: SourceConfig, status: SourceStatus, error: string | null): void {
    const entry: SourceState = { config, status, error }
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
    const entries: InventoryEntry[] = []
    for (const { config } of state.sources) {
      for (const inventory of listings.get(config.id) ?? []) {
        entries.push({ ref: { sourceId: config.id, inventoryId: inventory.id }, inventory, sourceName: config.name })
      }
    }
    entries.sort(
      (a, b) =>
        a.inventory.name.localeCompare(b.inventory.name, undefined, { numeric: true, sensitivity: 'base' }) ||
        (a.inventory.id < b.inventory.id ? -1 : a.inventory.id > b.inventory.id ? 1 : 0),
    )
    state.inventories = entries
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
      const all = await conn.storage.listInventories()
      return { ok: true, conn, inventories: all.filter((i) => i.archivedAt === null) }
    } catch (error) {
      await conn?.close().catch(() => {})
      return { ok: false, error }
    }
  }

  function failureStatus(error: unknown, config: SourceConfig): { status: SourceStatus; error: string | null } {
    if (error instanceof StorageError && error.code === 'unavailable') return { status: 'unreachable', error: null }
    return { status: 'error', error: redactSecret(errorMessage(error), config.connectionString) }
  }

  async function applyOutcome(config: SourceConfig, outcome: Outcome): Promise<void> {
    if (outcome.ok) {
      const old = conns.get(config.id)
      conns.set(config.id, outcome.conn)
      if (old && old !== outcome.conn) await old.close().catch(() => {})
      listings.set(config.id, outcome.inventories)
      setSource(config, outcome.conn.status.state === 'newer' ? 'read_only' : 'ready', null)
    } else {
      await dropConnection(config.id)
      const { status, error } = failureStatus(outcome.error, config)
      setSource(config, status, error)
    }
  }

  function markFailure(sourceId: string, error: unknown): void {
    const config = state.sources.find((s) => s.config.id === sourceId)?.config
    if (!config) return
    const { status, error: text } = failureStatus(error, config)
    setSource(config, status, text)
  }

  async function relist(sourceId: string): Promise<void> {
    const conn = conns.get(sourceId)
    if (!conn) return
    try {
      const all = await conn.storage.listInventories()
      listings.set(sourceId, all.filter((i) => i.archivedAt === null))
      rebuildInventories()
    } catch (error) {
      markFailure(sourceId, error)
    }
  }

  async function loadCurrent(): Promise<void> {
    const ref = state.current
    const conn = ref && conns.get(ref.sourceId)
    if (!ref || !conn) return
    let snapshot: InventorySnapshot
    try {
      snapshot = await conn.storage.loadInventory(ref.inventoryId)
    } catch (error) {
      markFailure(ref.sourceId, error)
      return
    }
    if (!sameRef(state.current, ref)) return
    const savedAt = nowIso()
    state.snapshot = snapshot
    state.snapshotOrigin = 'live'
    state.snapshotSavedAt = savedAt
    await db.putSnapshot(ref, { snapshot, savedAt })
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
    await db.putSettings({ current: ref })
    const cached = await db.getSnapshot(ref)
    if (!sameRef(state.current, ref)) return
    state.snapshot = cached?.snapshot ?? null
    state.snapshotOrigin = cached ? 'cache' : null
    state.snapshotSavedAt = cached?.savedAt ?? null
    if (isConnected(statusOf(ref.sourceId))) await loadCurrent()
  }

  async function startFromCache(): Promise<void> {
    const [settings, configs] = await Promise.all([db.getSettings(), db.getSources()])
    state.persistent = db.persistent
    state.deviceName = settings.deviceName ?? defaultDeviceName(deps.userAgent)
    state.sources = configs.map((config) => ({ config, status: 'connecting', error: null }))
    state.current = settings.current
    recompute()
    const cached = settings.current ? await db.getSnapshot(settings.current) : null
    if (cached && sameRef(state.current, settings.current)) {
      state.snapshot = cached.snapshot
      state.snapshotOrigin = 'cache'
      state.snapshotSavedAt = cached.savedAt
    }
    state.started = true
  }

  async function doRefresh(): Promise<void> {
    state.refreshing = true
    try {
      const configs = await db.getSources()
      const previous = new Map(state.sources.map((s) => [s.config.id, s]))
      for (const id of [...conns.keys()]) if (!configs.some((c) => c.id === id)) await dropConnection(id)
      for (const id of [...listings.keys()]) if (!configs.some((c) => c.id === id)) listings.delete(id)
      state.sources = configs.map((config) => ({
        config,
        status: previous.get(config.id)?.status ?? 'connecting',
        error: previous.get(config.id)?.error ?? null,
      }))
      recompute()
      const outcomes = await Promise.all(configs.map(async (config) => ({ config, outcome: await attempt(config) })))
      for (const { config, outcome } of outcomes) await applyOutcome(config, outcome)
      rebuildInventories()
      await resolveCurrent()
      if (outcomes.every((o) => o.outcome.ok)) state.lastRefreshAt = nowIso()
    } finally {
      state.refreshing = false
    }
  }

  function refresh(): Promise<void> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null
    })
    return refreshing
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

  function write(sourceId: string, command: Command, snapshot: InventorySnapshot | null): Promise<void> {
    return enqueue(async () => {
      const status = statusOf(sourceId)
      if (status === 'unreachable' || status === 'read_only' || status === 'error') throw new StorageError('read_only')
      const conn = conns.get(sourceId)
      if (!conn) throw new StorageError('unavailable')
      const normalized = normalizeCommand(command)
      const invalid = validateCommand(normalized, snapshot)
      if (invalid) throw invalid
      try {
        await conn.storage.apply(normalized, { device: state.deviceName })
      } catch (error) {
        if (error instanceof StorageError && error.code === 'unavailable') markFailure(sourceId, error)
        throw error
      }
      if (isRelistCommand(command)) {
        await relist(sourceId)
        await resolveCurrent()
      } else if (state.current?.sourceId === sourceId) {
        await loadCurrent()
      }
    })
  }

  async function apply(command: Command): Promise<void> {
    const cur = state.current
    if (!cur) throw new StorageError('not_found')
    await write(cur.sourceId, command, state.snapshot)
  }

  return {
    state,
    startFromCache,
    refresh,
    async refreshIfStale(maxAgeMs) {
      const last = state.lastRefreshAt ? Date.parse(state.lastRefreshAt) : null
      if (last === null || now().getTime() - last >= maxAgeMs) await refresh()
    },
    async start() {
      await startFromCache()
      await refresh()
    },
    selectInventory,
    apply,
    async createInventory({ sourceId, name, currency }) {
      const id = newId()
      await write(sourceId, { type: 'inventory.create', id, name, description: null, currency }, null)
      const ref = { sourceId, inventoryId: id }
      await selectInventory(ref)
      return ref
    },
    async addSource(input) {
      const config: SourceConfig = { ...input, id: newId(), createdAt: nowIso() }
      const outcome = await attempt(config)
      if (!outcome.ok) throw sanitize(outcome.error, config.connectionString)
      await db.putSource(config)
      await applyOutcome(config, outcome)
      rebuildInventories()
      await resolveCurrent()
      return config
    },
    async updateSource(id, patch) {
      const old = state.sources.find((s) => s.config.id === id)?.config
      if (!old) throw new StorageError('not_found')
      const config: SourceConfig = { ...old, ...patch }
      await db.putSource(config)
      setSource(config, 'connecting', null)
      const outcome = await attempt(config)
      await applyOutcome(config, outcome)
      rebuildInventories()
      await resolveCurrent()
      if (!outcome.ok) throw sanitize(outcome.error, config.connectionString)
    },
    async removeSource(id) {
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
