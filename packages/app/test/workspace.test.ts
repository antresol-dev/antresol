import { PGlite } from '@electric-sql/pglite'
import { newId, StorageError, type Command, type Id } from '@graymatter/core'
import { APP_SCHEMA_VERSION, createPgliteExecutor, type PgExecutor } from '@graymatter/storage-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'
import { createMemoryDeviceDb } from '../app/lib/device-db'
import { defaultDeviceName } from '../app/lib/device-name'
import { createNeonDriver, type SourceDriver } from '../app/lib/sources'
import type { InventoryRef, SourceConfig } from '../app/lib/types'
import { createWorkspace } from '../app/lib/workspace'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
const CS = (name: string): string => `postgresql://u:pw-${name}@h/${name}`

const config = (id: string, connectionString: string): SourceConfig => ({
  id,
  kind: 'neon',
  name: `Source ${id}`,
  connectionString,
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
})

function harness() {
  const pgs: PGlite[] = []
  const execs = new Map<string, PgExecutor>()
  const flags = {
    offline: false,
    listCalls: 0,
    clock: Date.parse('2026-11-10T10:00:00Z'),
    /** One-shot: the next connect waits for this promise. */
    connectGate: null as Promise<void> | null,
    /** One-shot: the next loadInventory reads its data, then waits for this promise. */
    loadGate: null as Promise<void> | null,
    loadBlocked: false,
    missing: new Set<string>(),
    applyError: null as Error | null,
    applyCalls: 0,
    /** loadInventory fails with this after listInventories succeeded. */
    loadError: null as Error | null,
    movementCalls: 0,
    movementError: null as Error | null,
  }

  const addDatabase = (connectionString: string): PGlite => {
    const pg = new PGlite()
    pgs.push(pg)
    const real = createPgliteExecutor(pg)
    const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
      if (flags.offline) throw new StorageError('unavailable')
      return fn(...args)
    }
    execs.set(connectionString, {
      query: guard(real.query.bind(real)) as PgExecutor['query'],
      batch: guard(real.batch.bind(real)),
      readBatch: guard(real.readBatch.bind(real)),
      close: async () => {},
    })
    return pg
  }

  const authFailing: PgExecutor = (() => {
    const fail = async (): Promise<never> => {
      throw Object.assign(new Error('password authentication failed'), { code: '28P01' })
    }
    return { query: fail, batch: fail, readBatch: fail, close: async () => {} }
  })()

  const inner = createNeonDriver((cs) => execs.get(cs) ?? authFailing)
  const driver: SourceDriver = {
    probe: inner.probe,
    async connect(cfg) {
      const gate = flags.connectGate
      flags.connectGate = null
      if (gate) await gate
      const conn = await inner.connect(cfg)
      const storage = Object.create(conn.storage) as typeof conn.storage
      storage.loadInventory = async (id) => {
        if (flags.loadError) throw flags.loadError
        if (flags.missing.has(id)) throw new StorageError('not_found')
        const result = await conn.storage.loadInventory(id)
        const loadGate = flags.loadGate
        if (loadGate) {
          flags.loadGate = null
          flags.loadBlocked = true
          await loadGate
        }
        return result
      }
      storage.apply = async (command, actor) => {
        flags.applyCalls++
        if (flags.applyError) throw flags.applyError
        return conn.storage.apply(command, actor)
      }
      storage.loadMovements = async (itemId) => {
        flags.movementCalls++
        if (flags.movementError) throw flags.movementError
        return conn.storage.loadMovements(itemId)
      }
      storage.listInventories = () => {
        flags.listCalls++
        return conn.storage.listInventories()
      }
      return { ...conn, storage }
    },
  }

  const db = createMemoryDeviceDb()
  const now = (): Date => new Date(flags.clock)
  const workspace = () => createWorkspace({ db, drivers: { neon: driver }, userAgent: UA, now })

  /** Creates a database for the connection string with one inventory, directly through storage. */
  const seed = async (connectionString: string, inventoryName: string): Promise<Id> => {
    if (!execs.has(connectionString)) addDatabase(connectionString)
    const conn = await inner.connect(config('seed', connectionString))
    const id = newId()
    await conn.storage.apply(
      { type: 'inventory.create', id, name: inventoryName, description: null, currency: 'USD' },
      { device: 'seed' },
    )
    return id
  }

  const direct = async (connectionString: string) => (await inner.connect(config('direct', connectionString))).storage

  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open!: () => void
    return { promise: new Promise<void>((r) => (open = r)), open }
  }

  return { gate, pgs, flags, db, workspace, seed, direct, addDatabase }
}

const folderCreate = (inventoryId: Id, name: string, id: Id = newId()): Command => ({
  type: 'folder.create',
  id,
  inventoryId,
  parentId: null,
  name,
  description: null,
})

let current: ReturnType<typeof harness>
const setup = () => (current = harness())
afterEach(async () => {
  await Promise.all(current?.pgs.map((p) => p.close().catch(() => {})) ?? [])
})

describe('workspace', () => {
  it('1. starts with no sources', async () => {
    const h = setup()
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.started).toBe(true)
    expect(ws.state.inventories).toEqual([])
    expect(ws.state.current).toBeNull()
    expect(ws.state.readOnly).toBeNull()
  })

  it('2. lists inventories of two sources sorted by name and selects the first', async () => {
    const h = setup()
    await h.seed(CS('one'), 'B-inv')
    const aId = await h.seed(CS('two'), 'A-inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A-inv', 'B-inv'])
    expect(ws.state.current).toEqual({ sourceId: 's2', inventoryId: aId })
    expect(ws.state.snapshotOrigin).toBe('live')
  })

  it('3. offline: shows the cached copy, becomes read-only and refuses writes', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.workspace().start()

    h.flags.offline = true
    const ws = h.workspace()
    await ws.startFromCache()
    expect(ws.state.snapshotOrigin).toBe('cache')
    expect(ws.state.snapshot?.inventory.id).toBe(id)
    await ws.refresh()
    expect(ws.state.readOnly).toBe('offline')
    expect(ws.state.snapshotOrigin).toBe('cache')
    expect(ws.state.snapshot?.inventory.id).toBe(id)
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })

    h.flags.offline = false
    const snap = await (await h.direct(CS('one'))).loadInventory(id)
    expect(snap.folders).toEqual([])
  })

  it('4. back online: refresh restores writes and live data', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.workspace().start()
    h.flags.offline = true
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.readOnly).toBe('offline')
    h.flags.offline = false
    await ws.refresh()
    expect(ws.state.readOnly).toBeNull()
    expect(ws.state.snapshotOrigin).toBe('live')
  })

  it('5. current inventory archived elsewhere: switches to the remaining one and drops its cache', async () => {
    const h = setup()
    const oldId = await h.seed(CS('one'), 'A-inv')
    const keepId = await h.seed(CS('two'), 'B-inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    const ws = h.workspace()
    await ws.start()
    const old: InventoryRef = { sourceId: 's1', inventoryId: oldId }
    expect(ws.state.current).toEqual(old)
    await (await h.direct(CS('one'))).apply(
      { type: 'archive', target: 'inventory', id: oldId, archiveId: newId() },
      { device: 'other' },
    )
    await ws.refresh()
    expect(ws.state.current).toEqual({ sourceId: 's2', inventoryId: keepId })
    expect(await h.db.getSnapshot(old)).toBeNull()
  })

  it('6. a newer schema makes the source read-only', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    await h.pgs[0]!.exec(`update gm_meta set value = '${APP_SCHEMA_VERSION + 1}' where key = 'schema_version'`)
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(ws.state.readOnly).toBe('schema_newer')
  })

  it('7. validates before writing and refreshes the cache after a write', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const ref = ws.state.current!
    const before = (await h.db.getSnapshot(ref))!.savedAt

    await expect(ws.apply(folderCreate(id, '  '))).rejects.toMatchObject({ code: 'name_required' })
    expect((await (await h.direct(CS('one'))).loadInventory(id)).folders).toEqual([])

    h.flags.clock += 5000
    await ws.apply(folderCreate(id, 'Shelf'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
    expect(ws.state.snapshotOrigin).toBe('live')
    const after = (await h.db.getSnapshot(ref))!
    expect(after.savedAt).not.toBe(before)
    expect(after.snapshot.folders).toHaveLength(1)
  })

  it('8a. keeps the snapshot non-reactive after cache start, refresh, apply and select', async () => {
    const h = setup()
    const aId = await h.seed(CS('one'), 'A-inv')
    const bId = await h.seed(CS('two'), 'B-inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    await h.workspace().start()

    const ws = h.workspace()
    await ws.startFromCache()
    expect(ws.state.snapshotOrigin).toBe('cache')
    expect(isReactive(ws.state.snapshot)).toBe(false)
    await ws.refresh()
    expect(ws.state.snapshotOrigin).toBe('live')
    expect(isReactive(ws.state.snapshot)).toBe(false)
    await ws.apply(folderCreate(ws.state.snapshot!.inventory.id, 'Shelf'))
    expect(ws.state.snapshot?.folders).toHaveLength(1)
    expect(isReactive(ws.state.snapshot)).toBe(false)
    const other = ws.state.inventories.find((e) => e.inventory.id !== ws.state.current!.inventoryId)!
    await ws.selectInventory(other.ref)
    expect([aId, bId]).toContain(ws.state.snapshot!.inventory.id)
    expect(ws.state.snapshot!.inventory.id).toBe(other.inventory.id)
    expect(isReactive(ws.state.snapshot)).toBe(false)
  })

  it('8. serializes concurrent writes', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const first = ws.apply(folderCreate(id, 'One'))
    const second = ws.apply(folderCreate(id, 'Two'))
    expect(ws.state.saving).toBe(true)
    await Promise.all([first, second])
    expect(ws.state.saving).toBe(false)
    expect(ws.state.snapshot?.folders.map((f) => f.name).sort()).toEqual(['One', 'Two'])
  })

  it('9. creates an inventory and selects it', async () => {
    const h = setup()
    const existing = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const ref = await ws.createInventory({ sourceId: 's1', name: 'Tools', currency: 'EUR' })
    expect(ref.inventoryId).not.toBe(existing)
    expect(ws.state.current).toEqual(ref)
    expect(ws.state.snapshot?.inventory.name).toBe('Tools')
    expect(ws.state.inventories).toHaveLength(2)
  })

  it('10. rejects a foreign database without saving the source', async () => {
    const h = setup()
    const pg = h.addDatabase(CS('foreign'))
    await pg.exec('create table accounts (id int)')
    const ws = h.workspace()
    await ws.start()
    await expect(
      ws.addSource({ kind: 'neon', name: 'X', connectionString: CS('foreign'), uploadcarePublicKey: null }),
    ).rejects.toMatchObject({ code: 'incompatible' })
    expect(await h.db.getSources()).toEqual([])
    expect(ws.state.sources).toEqual([])
  })

  it('11. a wrong connection string gives an error status and keeps current', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const ref = ws.state.current
    await expect(ws.updateSource('s1', { connectionString: CS('wrong') })).rejects.toBeInstanceOf(StorageError)
    expect(ws.state.sources[0]!.status).toBe('error')
    expect(ws.state.sources[0]!.error).not.toContain('pw-wrong')
    expect(ws.state.readOnly).toBe('source_error')
    expect(ws.state.current).toEqual(ref)
    await ws.updateSource('s1', { connectionString: CS('one') })
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.readOnly).toBeNull()
    expect(ws.state.sources[0]!.config.id).toBe('s1')
  })

  it('12. removing the current source moves to another one and clears its caches', async () => {
    const h = setup()
    const first = await h.seed(CS('one'), 'A-inv')
    const second = await h.seed(CS('two'), 'B-inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.current?.sourceId).toBe('s1')
    await ws.removeSource('s1')
    expect(ws.state.current).toEqual({ sourceId: 's2', inventoryId: second })
    expect(await h.db.getSnapshot({ sourceId: 's1', inventoryId: first })).toBeNull()
    expect((await h.db.getSources()).map((s) => s.id)).toEqual(['s2'])
    expect((await h.db.getSettings()).current).toEqual({ sourceId: 's2', inventoryId: second })
  })

  it('13. writes carry the device name', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.deviceName).toBe(defaultDeviceName(UA))
    await ws.apply(folderCreate(id, 'First'))
    await ws.setDeviceName('Bench PC')
    await ws.apply(folderCreate(id, 'Second'))
    const by = Object.fromEntries(ws.state.snapshot!.folders.map((f) => [f.name, f.createdBy]))
    expect(by).toEqual({ First: defaultDeviceName(UA), Second: 'Bench PC' })
    await ws.setDeviceName('  ')
    expect(ws.state.deviceName).toBe(defaultDeviceName(UA))
  })

  it('14. refreshIfStale skips fresh data and refreshes stale data', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.refresh()
    const calls = h.flags.listCalls
    await ws.refreshIfStale(60_000)
    expect(h.flags.listCalls).toBe(calls)
    h.flags.clock += 120_000
    await ws.refreshIfStale(60_000)
    expect(h.flags.listCalls).toBeGreaterThan(calls)
  })

  it('15. removing a source during a refresh does not resurrect it or its cache', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const gate = h.gate()
    h.flags.connectGate = gate.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
    await ws.removeSource('s1')
    gate.open()
    await refresh
    expect(ws.state.sources).toEqual([])
    expect(ws.state.inventories).toEqual([])
    expect(ws.state.current).toBeNull()
    expect(await h.db.getSnapshot({ sourceId: 's1', inventoryId: id })).toBeNull()
  })

  it('16. editing a source during a refresh keeps the new config and status', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const gate = h.gate()
    h.flags.connectGate = gate.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
    await ws.updateSource('s1', { name: 'Renamed' })
    gate.open()
    await refresh
    expect(ws.state.sources[0]!.config.name).toBe('Renamed')
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.inventories[0]!.sourceName).toBe('Renamed')
  })

  it('17. a slow refresh load does not replace a newer post-write snapshot', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const gate = h.gate()
    h.flags.loadGate = gate.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    await ws.apply(folderCreate(id, 'Fresh'))
    gate.open()
    await refresh
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Fresh'])
    expect((await h.db.getSnapshot(ws.state.current!))!.snapshot.folders).toHaveLength(1)
  })

  it('18. queued writes validate against the snapshot as of when they run', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const parent = newId()
    const first = ws.apply(folderCreate(id, 'Parent', parent))
    const second = ws.apply({ ...folderCreate(id, 'Child'), parentId: parent } as Command)
    await Promise.all([first, second])
    expect(ws.state.snapshot?.folders).toHaveLength(2)
  })

  it('19. a current inventory deleted elsewhere falls back without breaking the source', async () => {
    const h = setup()
    const a = await h.seed(CS('one'), 'A-inv')
    const b = await h.seed(CS('one'), 'B-inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const old = ws.state.current!
    expect(old.inventoryId).toBe(a)
    h.flags.missing.add(a)
    await ws.refresh()
    expect(ws.state.current).toEqual({ sourceId: 's1', inventoryId: b })
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.readOnly).toBeNull()
    expect(await h.db.getSnapshot(old)).toBeNull()
  })

  it('20. storage errors from apply are redacted', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    h.flags.applyError = new StorageError('failed', 'boom pw-one')
    await expect(ws.apply(folderCreate(id, 'X'))).rejects.toMatchObject({ code: 'failed', message: 'boom ***' })
  })

  it('21. mid-session loss: a failed write goes read-only, refuses without a storage call, refresh recovers', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.readOnly).toBeNull()
    h.flags.applyError = new StorageError('unavailable')
    await expect(ws.apply(folderCreate(id, 'A'))).rejects.toMatchObject({ code: 'unavailable' })
    expect(ws.state.readOnly).toBe('offline')
    h.flags.applyError = null
    const calls = h.flags.applyCalls
    await expect(ws.apply(folderCreate(id, 'B'))).rejects.toMatchObject({ code: 'read_only' })
    expect(h.flags.applyCalls).toBe(calls)
    await ws.refresh()
    expect(ws.state.readOnly).toBeNull()
    await ws.apply(folderCreate(id, 'C'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['C'])
  })

  it('22. refreshIfStale refreshes regardless of age while a source is unreachable or in error', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    h.flags.applyError = new StorageError('unavailable')
    await ws.apply(folderCreate(id, 'A')).catch(() => {})
    h.flags.applyError = null
    expect(ws.state.sources[0]!.status).toBe('unreachable')
    const lists = h.flags.listCalls
    await ws.refreshIfStale(15 * 60_000)
    expect(h.flags.listCalls).toBeGreaterThan(lists)
    expect(ws.state.readOnly).toBeNull()
  })

  it('23. a load failure after a successful list does not count as a refresh', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.startFromCache()
    h.flags.loadError = new StorageError('unavailable')
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('unreachable')
    expect(ws.state.lastRefreshAt).toBeNull()
    h.flags.loadError = null
    const lists = h.flags.listCalls
    await ws.refreshIfStale(15 * 60_000)
    expect(h.flags.listCalls).toBeGreaterThan(lists)
    expect(ws.state.lastRefreshAt).not.toBeNull()
  })

  it('24. a write issued while the first refresh is still connecting waits for it and succeeds', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.workspace().start()
    const ws = h.workspace()
    await ws.startFromCache()
    const gate = h.gate()
    h.flags.connectGate = gate.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
    const write = ws.apply(folderCreate(id, 'Early'))
    gate.open()
    await Promise.all([refresh, write])
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Early'])
  })

  it('25. a source failing with a login error records the classified reason', async () => {
    const h = setup()
    await h.db.putSource(config('s1', CS('nope')))
    const ws = h.workspace()
    await ws.start()
    const source = ws.state.sources[0]!
    expect(source.status).toBe('error')
    expect(source.reason).toBe('auth')
    expect(source.error).not.toContain('pw-nope')
  })

  it('26. an unreachable source records the unreachable reason', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    h.flags.offline = true
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.sources[0]!.reason).toBe('unreachable')
    h.flags.offline = false
    await ws.refresh()
    expect(ws.state.sources[0]!.reason).toBeNull()
  })

  /** Two inventories A and B in one source; B is archived. */
  const archivedSetup = async () => {
    const h = setup()
    const a = await h.seed(CS('one'), 'A')
    const b = await h.seed(CS('one'), 'B')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const refA = { sourceId: 's1', inventoryId: a }
    expect(ws.state.current).toEqual(refA)
    await ws.applyTo({ sourceId: 's1', inventoryId: b }, { type: 'archive', target: 'inventory', id: b, archiveId: newId() })
    return { h, ws, a, b, refA }
  }

  it('27. keeps archived inventories in their own list', async () => {
    const { ws } = await archivedSetup()
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A'])
    expect(ws.state.archivedInventories.map((e) => [e.inventory.name, e.sourceName])).toEqual([['B', 'Source s1']])
  })

  it('28. restores an archived inventory while another one is current', async () => {
    const { ws, refA } = await archivedSetup()
    const b = ws.state.archivedInventories[0]!
    await ws.applyTo(b.ref, { type: 'restore', archiveId: b.inventory.archiveId! })
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A', 'B'])
    expect(ws.state.archivedInventories).toEqual([])
    expect(ws.state.current).toEqual(refA)
  })

  it('29. permanently deletes an archived inventory and its cached copy', async () => {
    const { h, ws } = await archivedSetup()
    const b = ws.state.archivedInventories[0]!
    await h.db.putSnapshot(b.ref, { snapshot: (await (await h.direct(CS('one'))).loadInventory(b.inventory.id)), savedAt: 'x' })
    expect(await h.db.getSnapshot(b.ref)).not.toBeNull()
    await ws.applyTo(b.ref, { type: 'deletePermanently', target: 'inventory', id: b.inventory.id })
    expect(ws.state.archivedInventories).toEqual([])
    expect(await h.db.getSnapshot(b.ref)).toBeNull()
  })

  it('30. applyTo validates against the target inventory', async () => {
    const { ws } = await archivedSetup()
    const b = ws.state.archivedInventories[0]!
    await expect(ws.applyTo(b.ref, { type: 'restore', archiveId: newId() })).rejects.toMatchObject({ code: 'not_found' })
  })

  const itemWithStock = async (ws: ReturnType<ReturnType<typeof harness>['workspace']>, inventoryId: Id): Promise<Id> => {
    const itemId = newId()
    await ws.apply({
      type: 'item.create',
      id: itemId,
      inventoryId,
      folderId: null,
      name: 'Bolt',
      description: null,
      unitKey: 'pcs',
      tagIds: [],
      initialReceipt: null,
    })
    await ws.apply({ type: 'stock.receive', movementId: newId(), itemId, variantId: null, quantity: '37', totalPrice: null, sourceUrl: null, note: null })
    await ws.apply({ type: 'stock.use', movementId: newId(), itemId, variantId: null, quantity: '5', note: null })
    return itemId
  }

  it('31. loads the journal of the current inventory newest first', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const itemId = await itemWithStock(ws, id)
    expect((await ws.loadMovements(itemId)).map((m) => [m.kind, m.quantity])).toEqual([
      ['usage', '-5'],
      ['receipt', '37'],
    ])
  })

  it('32. the journal fails fast when the source is unreachable', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const itemId = await itemWithStock(ws, id)
    h.flags.offline = true
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('unreachable')
    h.flags.movementCalls = 0
    await expect(ws.loadMovements(itemId)).rejects.toMatchObject({ code: 'unavailable' })
    expect(h.flags.movementCalls).toBe(0)
  })

  it('33. a failing journal read is redacted and marks the source unreachable', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    const itemId = await itemWithStock(ws, id)
    h.flags.movementError = new StorageError('failed', 'boom pw-one')
    await expect(ws.loadMovements(itemId)).rejects.toMatchObject({ code: 'failed', message: 'boom ***' })
    h.flags.movementError = new StorageError('unavailable')
    await expect(ws.loadMovements(itemId)).rejects.toMatchObject({ code: 'unavailable' })
    expect(ws.state.sources[0]!.status).toBe('unreachable')
  })
})
