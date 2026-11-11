import { PGlite } from '@electric-sql/pglite'
import { FileError, newId, StorageError, type Command, type FileStore, type Id } from '@graymatter/core'
import { APP_SCHEMA_VERSION, createPgliteExecutor, type PgExecutor } from '@graymatter/storage-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'
import { createMemoryDeviceDb, type DeviceDb } from '../app/lib/device-db'
import { defaultDeviceName } from '../app/lib/device-name'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { createNeonDriver, type SourceDriver } from '../app/lib/sources'
import type { InventoryRef, SourceConfig } from '../app/lib/types'
import { createWorkspace, defaultFileStore, FAILED_RETRY_MS } from '../app/lib/workspace'

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
    loadCalls: 0,
    connectCalls: 0,
    closeCalls: 0,
    /** One-shot: the next listInventories fails with this. */
    listError: null as Error | null,
    /** One-shot: the next listInventories waits for this promise first. */
    listGate: null as Promise<void> | null,
    /** One-shot: the next apply waits for this promise before writing. */
    applyGate: null as Promise<void> | null,
    applyBlocked: false,
    clock: Date.parse('2026-11-10T10:00:00Z'),
    /** One-shot: the next connect waits for this promise. */
    connectGate: null as Promise<void> | null,
    /** One-shot: the next loadInventory reads its data, then waits for this promise. */
    loadGate: null as Promise<void> | null,
    loadBlocked: false,
    /** One-shot: the next full load (either method) runs this first, before it reads anything. */
    beforeLoad: null as (() => Promise<void>) | null,
    missing: new Set<string>(),
    exportCalls: 0,
    applyError: null as Error | null,
    applyCalls: 0,
    /** loadInventory fails with this after listInventories succeeded. */
    loadError: null as Error | null,
    loadErrorFor: null as { id: Id; error: Error } | null,
    movementCalls: 0,
    movementError: null as Error | null,
  }

  const directConns: { close(): Promise<void> }[] = []

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

  // Like a server that echoes the login it refused: the password must not survive into the state.
  const authFailing = (connectionString: string): PgExecutor => {
    const password = new URL(connectionString).password
    const fail = async (): Promise<never> => {
      throw Object.assign(new Error(`password authentication failed (${password})`), { code: '28P01' })
    }
    return { query: fail, batch: fail, readBatch: fail, close: async () => {} }
  }

  const inner = createNeonDriver((cs) => execs.get(cs) ?? authFailing(cs))
  const driver: SourceDriver = {
    probe: inner.probe,
    async connect(cfg) {
      flags.connectCalls++
      const gate = flags.connectGate
      flags.connectGate = null
      if (gate) await gate
      const conn = await inner.connect(cfg)
      const storage = Object.create(conn.storage) as typeof conn.storage
      const gated = async <T>(id: Id, read: () => Promise<T>): Promise<T> => {
        flags.loadCalls++
        const before = flags.beforeLoad
        flags.beforeLoad = null
        if (before) await before()
        if (flags.loadError) throw flags.loadError
        if (flags.loadErrorFor?.id === id) throw flags.loadErrorFor.error
        if (flags.missing.has(id)) throw new StorageError('not_found')
        const result = await read()
        const loadGate = flags.loadGate
        if (loadGate) {
          flags.loadGate = null
          flags.loadBlocked = true
          await loadGate
        }
        return result
      }
      storage.loadInventory = (id) => gated(id, () => conn.storage.loadInventory(id))
      storage.loadInventoryWithRev = (id) => gated(id, () => conn.storage.loadInventoryWithRev(id))
      storage.exportInventory = async (id) => {
        flags.exportCalls++
        if (flags.loadError) throw flags.loadError
        if (flags.missing.has(id)) throw new StorageError('not_found')
        return conn.storage.exportInventory(id)
      }
      storage.apply = async (command, actor) => {
        flags.applyCalls++
        const applyGate = flags.applyGate
        if (applyGate) {
          flags.applyGate = null
          flags.applyBlocked = true
          await applyGate
        }
        if (flags.applyError) throw flags.applyError
        return conn.storage.apply(command, actor)
      }
      storage.loadMovements = async (itemId) => {
        flags.movementCalls++
        if (flags.movementError) throw flags.movementError
        return conn.storage.loadMovements(itemId)
      }
      storage.listInventories = async () => {
        flags.listCalls++
        const listGate = flags.listGate
        if (listGate) {
          flags.listGate = null
          await listGate
        }
        const listError = flags.listError
        if (listError) {
          flags.listError = null
          throw listError
        }
        return conn.storage.listInventories()
      }
      const close = async (): Promise<void> => {
        flags.closeCalls++
        await conn.close()
      }
      return { ...conn, storage, close }
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
    await conn.close()
    return id
  }

  const direct = async (connectionString: string) => {
    const conn = await inner.connect(config('direct', connectionString))
    directConns.push(conn)
    return conn.storage
  }

  /** Another device changes the source (the command touches no row, but every apply bumps the revision), so the next
   *  refresh sees a new revision and reloads the snapshot. */
  const bumpRev = async (connectionString: string): Promise<void> => {
    await (await direct(connectionString)).apply({ type: 'inventory.update', id: newId(), name: 'x' }, { device: 'other' })
  }

  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open!: () => void
    return { promise: new Promise<void>((r) => (open = r)), open }
  }

  /** One-shot: the next call of the device db method waits until `open()`; `held` turns true when it does. */
  const holdDb = <K extends 'getSnapshot' | 'deleteSnapshot' | 'deleteSource' | 'putSource'>(method: K) => {
    const { promise, open } = gate()
    const original = db[method] as (...args: unknown[]) => Promise<unknown>
    const hold = { held: false, open }
    db[method] = (async (...args: unknown[]) => {
      db[method] = original as DeviceDb[K]
      hold.held = true
      await promise
      return original(...args)
    }) as DeviceDb[K]
    return hold
  }

  return { gate, holdDb, bumpRev, pgs, directConns, flags, db, workspace, seed, direct, addDatabase }
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
  await Promise.all(current?.directConns.map((c) => c.close().catch(() => {})) ?? [])
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
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    await h.pgs[0]!.exec(`update gm_meta set value = '${APP_SCHEMA_VERSION + 1}' where key = 'schema_version'`)
    // The refresh reuses the open connection, yet checks the schema through it.
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(ws.state.readOnly).toBe('schema_newer')
    const calls = h.flags.applyCalls
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
    expect(h.flags.applyCalls).toBe(calls)
    // A workspace started on the newer schema is read-only too.
    const fresh = h.workspace()
    await fresh.start()
    expect(fresh.state.sources[0]!.status).toBe('read_only')
    expect(fresh.state.readOnly).toBe('schema_newer')
    // Back to this app's version: the next refresh makes the source writable again.
    await h.pgs[0]!.exec(`update gm_meta set value = '${APP_SCHEMA_VERSION}' where key = 'schema_version'`)
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.readOnly).toBeNull()
    await ws.apply(folderCreate(id, 'Shelf'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
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
    expect(ws.state.sources[0]!.error).toContain('password authentication failed')
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
    await h.workspace().start()
    // A new workspace: its first refresh opens the connection.
    const ws = h.workspace()
    await ws.startFromCache()
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
    await h.workspace().start()
    // A new workspace: its first refresh opens the connection.
    const ws = h.workspace()
    await ws.startFromCache()
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
    await h.bumpRev(CS('one'))
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
    await h.bumpRev(CS('one'))
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
    expect(source.error).toContain('password authentication failed')
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

  it('exports every inventory, archived included, with all movements, and nothing secret', async () => {
    const h = setup()
    const a = await h.seed(CS('one'), 'Active')
    const b = await h.seed(CS('one'), 'Old')
    await h.db.putSource({ ...config('s1', CS('one')), uploadcarePublicKey: 'pk_secret_key' })
    const ws = h.workspace()
    await ws.start()
    const itemA = await itemWithStock(ws, a)
    const refB = { sourceId: 's1', inventoryId: b }
    const oldItem = newId()
    await ws.applyTo(refB, {
      type: 'item.create', id: oldItem, inventoryId: b, folderId: null, name: 'Old bolt', description: null,
      unitKey: 'pcs', tagIds: [], initialReceipt: null,
    })
    await ws.applyTo(refB, { type: 'stock.receive', movementId: newId(), itemId: oldItem, variantId: null, quantity: '8', totalPrice: null, sourceUrl: null, note: null })
    await ws.applyTo(refB, { type: 'archive', target: 'item', id: oldItem, archiveId: newId() })
    await ws.applyTo(refB, { type: 'archive', target: 'inventory', id: b, archiveId: newId() })
    const backup = await ws.exportSource('s1')
    expect(backup).toMatchObject({
      format: 'graymatter-backup',
      version: 1,
      app: { schemaVersion: APP_SCHEMA_VERSION },
      source: { name: 'Source s1', kind: 'neon' },
    })
    expect(backup.inventories.map((i) => i.snapshot.inventory.name).sort()).toEqual(['Active', 'Old'])
    const archived = backup.inventories.find((i) => i.snapshot.inventory.id === b)!
    expect(archived.snapshot.inventory.archivedAt).not.toBeNull()
    expect(archived.snapshot.items.map((i) => [i.id, i.archivedAt !== null])).toEqual([[oldItem, true]])
    expect(archived.movements.map((m) => [m.itemId, m.quantity])).toEqual([[oldItem, '8']])
    const active = backup.inventories.find((i) => i.snapshot.inventory.id === a)!
    expect(active.movements.map((m) => [m.itemId, m.kind, m.quantity])).toEqual([
      [itemA, 'receipt', '37'],
      [itemA, 'usage', '-5'],
    ])
    const text = JSON.stringify(backup)
    for (const forbidden of ['connectionString', 'postgresql://', 'pw-one', 'uploadcarePublicKey', 'pk_secret_key']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('export reads each inventory with one exportInventory call and skips one that disappears midway', async () => {
    const h = setup()
    const a = await h.seed(CS('one'), 'Keep')
    const b = await h.seed(CS('one'), 'Gone')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    h.flags.missing.add(b)
    const loadsBefore = h.flags.loadCalls
    const backup = await ws.exportSource('s1')
    expect(backup.inventories.map((i) => i.snapshot.inventory.id)).toEqual([a])
    expect(h.flags.exportCalls).toBe(2)
    expect(h.flags.loadCalls).toBe(loadsBefore)
  })

  it('export fails with unavailable when the source is offline, and when a read fails midway', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    await itemWithStock(ws, id)
    await expect(ws.exportSource('nope')).rejects.toMatchObject({ code: 'not_found' })
    h.flags.loadError = new StorageError('unavailable')
    await expect(ws.exportSource('s1')).rejects.toMatchObject({ code: 'unavailable' })
    h.flags.loadError = null
    h.flags.offline = true
    await ws.refresh()
    await expect(ws.exportSource('s1')).rejects.toMatchObject({ code: 'unavailable' })
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

  it('34. applyTo redacts and marks a failing read of the target inventory', async () => {
    const { h, ws, b } = await archivedSetup()
    const target = ws.state.archivedInventories[0]!
    const restore: Command = { type: 'restore', archiveId: target.inventory.archiveId! }
    h.flags.loadErrorFor = { id: b, error: new StorageError('failed', 'boom pw-one') }
    const failed = await ws.applyTo(target.ref, restore).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(failed).toMatchObject({ code: 'failed', message: 'boom ***' })
    expect((failed as { cause?: unknown }).cause).toBeUndefined()
    expect(ws.state.sources[0]!.status).toBe('ready')
    h.flags.loadErrorFor = { id: b, error: new StorageError('unavailable') }
    await expect(ws.applyTo(target.ref, restore)).rejects.toMatchObject({ code: 'unavailable' })
    expect(ws.state.sources[0]!.status).toBe('unreachable')
    expect(ws.state.readOnly).toBe('offline')
  })

  describe('refreshes and races', () => {
    /** Source s1 with one inventory per name, started; the first name sorts first and is current. */
    const started = async (...names: string[]) => {
      const h = setup()
      const refs: InventoryRef[] = []
      for (const name of names) refs.push({ sourceId: 's1', inventoryId: await h.seed(CS('one'), name) })
      await h.db.putSource(config('s1', CS('one')))
      const ws = h.workspace()
      await ws.start()
      expect(ws.state.current).toEqual(refs[0])
      return { h, ws, refs }
    }

    it('reuses the connection between refreshes', async () => {
      const h = setup()
      await h.seed(CS('one'), 'Inv')
      await h.db.putSource(config('s1', CS('one')))
      const ws = h.workspace()
      await ws.refresh()
      await ws.refresh()
      expect(h.flags.connectCalls).toBe(1)
      expect(h.flags.listCalls).toBe(2)
      expect(ws.state.sources[0]!.status).toBe('ready')

      // The list fails on the reused connection: it is closed and opened again, once.
      h.flags.listError = new StorageError('unavailable')
      await ws.refresh()
      expect(h.flags.closeCalls).toBe(1)
      expect(h.flags.connectCalls).toBe(2)
      expect(ws.state.sources[0]!.status).toBe('ready')
      expect(ws.state.readOnly).toBeNull()

      // Still failing after reopening: one new connection per refresh, and the source is unreachable.
      h.flags.offline = true
      await ws.refresh()
      expect(h.flags.connectCalls).toBe(3)
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      await ws.refresh()
      expect(h.flags.connectCalls).toBe(4)
    })

    it('a failing non-current source does not force a refresh more than once per FAILED_RETRY_MS', async () => {
      const h = setup()
      await h.seed(CS('one'), 'Inv')
      await h.db.putSource(config('s1', CS('one')))
      await h.db.putSource(config('s2', CS('nope')))
      const ws = h.workspace()
      await ws.start()
      expect(ws.state.current?.sourceId).toBe('s1')
      expect(ws.state.sources.map((s) => s.status)).toEqual(['ready', 'error'])
      const stale = 15 * 60_000
      const connects = h.flags.connectCalls
      const lists = h.flags.listCalls

      h.flags.clock += FAILED_RETRY_MS - 1
      await ws.refreshIfStale(stale)
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects, lists])

      h.flags.clock += 1
      await ws.refreshIfStale(stale)
      // s2 tries a new connection, s1 lists on its open one.
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects + 1, lists + 1])
      await ws.refreshIfStale(stale)
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects + 1, lists + 1])

      // The current source failing still refreshes at once.
      h.flags.applyError = new StorageError('unavailable')
      await ws.apply(folderCreate(ws.state.current!.inventoryId, 'X')).catch(() => {})
      h.flags.applyError = null
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      await ws.refreshIfStale(stale)
      expect(h.flags.listCalls).toBe(lists + 2)
      expect(ws.state.sources[0]!.status).toBe('ready')
    })

    it('starts offline with the inventory list from the device', async () => {
      const { h, ws, refs } = await started('A', 'B')
      const b = refs[1]!
      await ws.applyTo(b, { type: 'archive', target: 'inventory', id: b.inventoryId, archiveId: newId() })
      const stored = await h.db.getListings()
      expect(Object.keys(stored)).toEqual(['s1'])
      expect(stored.s1!.map((i) => [i.name, i.archivedAt === null])).toEqual([
        ['A', true],
        ['B', false],
      ])

      h.flags.offline = true
      const connects = h.flags.connectCalls
      const offline = h.workspace()
      await offline.startFromCache()
      // Ready before any network call.
      expect(h.flags.connectCalls).toBe(connects)
      expect(offline.state.inventories.map((e) => e.inventory.name)).toEqual(['A'])
      expect(offline.state.archivedInventories.map((e) => e.inventory.name)).toEqual(['B'])
      expect(offline.state.inventories).toEqual(ws.state.inventories)
      expect(offline.state.archivedInventories).toEqual(ws.state.archivedInventories)
      await offline.refresh()
      expect(offline.state.sources[0]!.status).toBe('unreachable')
      expect(offline.state.inventories).toEqual(ws.state.inventories)
      expect(offline.state.archivedInventories).toEqual(ws.state.archivedInventories)

      await offline.removeSource('s1')
      expect(await h.db.getListings()).toEqual({})
      expect(offline.state.inventories).toEqual([])
      expect(offline.state.archivedInventories).toEqual([])
    })

    it('keeps a post-write reload when a later-started load fails', async () => {
      const { h, ws, refs } = await started('Inv')
      const gate = h.gate()
      h.flags.loadGate = gate.promise
      const write = ws.apply(folderCreate(refs[0]!.inventoryId, 'Fresh'))
      // The reload after the write has read the new folder and waits.
      await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
      h.flags.loadError = new StorageError('unavailable')
      await ws.refresh()
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      h.flags.loadError = null
      gate.open()
      await write
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Fresh'])
      expect((await h.db.getSnapshot(refs[0]!))!.snapshot.folders.map((f) => f.name)).toEqual(['Fresh'])
    })

    it('a write during selectInventory validates against the new inventory', async () => {
      const { h, ws, refs } = await started('A', 'B')
      const b = refs[1]!
      expect(ws.state.snapshot?.inventory.id).toBe(refs[0]!.inventoryId)
      const reading = h.holdDb('getSnapshot')
      const select = ws.selectInventory(b)
      // The previous inventory's snapshot is gone at once, never shown under the new current.
      expect(ws.state.current).toEqual(b)
      expect(ws.state.snapshot).toBeNull()
      expect(ws.state.snapshotOrigin).toBeNull()
      expect(ws.state.snapshotSavedAt).toBeNull()
      await vi.waitFor(() => expect(reading.held).toBe(true))
      await ws.applyTo(b, folderCreate(b.inventoryId, 'Shelf'))
      reading.open()
      await select
      expect(ws.state.current).toEqual(b)
      expect(ws.state.snapshot?.inventory.id).toBe(b.inventoryId)
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
    })

    it('a failing fallback load in apply is redacted and marks the source', async () => {
      const { h, ws, refs } = await started('A', 'B')
      const b = refs[1]!
      const reading = h.holdDb('getSnapshot')
      const select = ws.selectInventory(b)
      await vi.waitFor(() => expect(reading.held).toBe(true))
      // No snapshot of B is shown yet: the write reads B from the source.
      h.flags.loadErrorFor = { id: b.inventoryId, error: new StorageError('failed', 'boom pw-one') }
      const failed = await ws.apply(folderCreate(b.inventoryId, 'X')).then(
        () => null,
        (e: unknown) => e as Error,
      )
      expect(failed).toBeInstanceOf(StorageError)
      expect(failed).toMatchObject({ code: 'failed', message: 'boom ***' })
      expect((failed as { cause?: unknown }).cause).toBeUndefined()
      expect(ws.state.sources[0]!.status).toBe('ready')
      h.flags.loadErrorFor = { id: b.inventoryId, error: new StorageError('unavailable') }
      await expect(ws.apply(folderCreate(b.inventoryId, 'X'))).rejects.toMatchObject({ code: 'unavailable' })
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      expect(ws.state.readOnly).toBe('offline')
      expect(h.flags.applyCalls).toBe(0)
      h.flags.loadErrorFor = null
      reading.open()
      await select
    })

    it('errors are redacted with the config the write started with', async () => {
      const { h, ws, refs } = await started('Inv')
      const gate = h.gate()
      h.flags.applyGate = gate.promise
      h.flags.applyError = new StorageError('failed', 'boom pw-one')
      const write = ws.apply(folderCreate(refs[0]!.inventoryId, 'X')).then(
        () => null,
        (e: unknown) => e as Error,
      )
      await vi.waitFor(() => expect(h.flags.applyBlocked).toBe(true))
      await ws.removeSource('s1')
      gate.open()
      expect(await write).toMatchObject({ code: 'failed', message: 'boom ***' })
      expect(ws.state.sources).toEqual([])
    })

    it('errors of a connection are redacted with the config it was opened with', async () => {
      const { h, ws, refs } = await started('Inv')
      // The source is edited to another connection string; the old connection still serves writes meanwhile.
      const gate = h.gate()
      h.flags.connectGate = gate.promise
      const update = ws.updateSource('s1', { connectionString: CS('two') }).catch(() => {})
      await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
      expect(ws.state.sources[0]!.config.connectionString).toBe(CS('two'))
      h.flags.applyError = new StorageError('failed', 'boom pw-one')
      await expect(ws.apply(folderCreate(refs[0]!.inventoryId, 'X'))).rejects.toMatchObject({
        code: 'failed',
        message: 'boom ***',
      })
      gate.open()
      await update
    })

    it('a refresh in the same tick as removeSource does not bring the source back', async () => {
      const { h, ws } = await started('Inv')
      const deleting = h.holdDb('deleteSource')
      const connecting = h.gate()
      h.flags.connectGate = connecting.promise
      // The refresh reads the sources from the device before the removal is saved there.
      const removal = ws.removeSource('s1')
      const refresh = ws.refresh()
      await vi.waitFor(() => {
        expect(deleting.held).toBe(true)
        expect(h.flags.connectGate).toBeNull()
      })
      deleting.open()
      await removal
      connecting.open()
      await refresh
      expect(ws.state.sources).toEqual([])
      expect(ws.state.inventories).toEqual([])
      expect(ws.state.current).toBeNull()
      expect(await h.db.getSources()).toEqual([])
      expect(await h.db.getListings()).toEqual({})
    })

    it('a refresh in the same tick as updateSource does not bring the old config back', async () => {
      const { h, ws } = await started('Inv')
      const saving = h.holdDb('putSource')
      const listing = h.gate()
      h.flags.listGate = listing.promise
      // The refresh reads the old config from the device before the edit is saved there.
      const update = ws.updateSource('s1', { name: 'Renamed' })
      const refresh = ws.refresh()
      await vi.waitFor(() => {
        expect(saving.held).toBe(true)
        expect(h.flags.listGate).toBeNull()
      })
      saving.open()
      await update
      listing.open()
      await refresh
      expect(ws.state.sources.map((s) => [s.config.name, s.status])).toEqual([['Renamed', 'ready']])
      expect(ws.state.inventories.map((e) => e.sourceName)).toEqual(['Renamed'])
    })

    it('dropMissing keeps an inventory the user selected meanwhile', async () => {
      const { h, ws, refs } = await started('A', 'B', 'C')
      const [a, b, c] = refs as [InventoryRef, InventoryRef, InventoryRef]
      h.flags.missing.add(a.inventoryId)
      await h.bumpRev(CS('one'))
      const deleting = h.holdDb('deleteSnapshot')
      const refresh = ws.refresh()
      // A is gone from the source; its cached copy is being deleted.
      await vi.waitFor(() => expect(deleting.held).toBe(true))
      await ws.selectInventory(c)
      deleting.open()
      await refresh
      expect(ws.state.current).toEqual(c)
      expect(ws.state.snapshot?.inventory.id).toBe(c.inventoryId)
      expect(ws.state.inventories.map((e) => e.ref)).toEqual([b, c])
      expect((await h.db.getSettings()).current).toEqual(c)
      expect(await h.db.getSnapshot(a)).toBeNull()
    })

    it('removing a source during updateSource keeps it removed', async () => {
      const { h, ws } = await started('Inv')
      const gate = h.gate()
      h.flags.connectGate = gate.promise
      const update = ws.updateSource('s1', { name: 'Renamed' })
      await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
      await ws.removeSource('s1')
      gate.open()
      await update
      expect(ws.state.sources).toEqual([])
      expect(ws.state.inventories).toEqual([])
      expect(ws.state.current).toBeNull()
      expect(await h.db.getSources()).toEqual([])
      expect(await h.db.getListings()).toEqual({})
    })

    it('of two overlapping updateSource calls the last one called wins', async () => {
      const { h, ws } = await started('Inv')
      const gate = h.gate()
      h.flags.connectGate = gate.promise
      const first = ws.updateSource('s1', { name: 'First' })
      await vi.waitFor(() => expect(h.flags.connectGate).toBeNull())
      await ws.updateSource('s1', { name: 'Second' })
      gate.open()
      await first
      expect(ws.state.sources.map((s) => [s.config.name, s.status])).toEqual([['Second', 'ready']])
      expect(ws.state.inventories.map((e) => e.sourceName)).toEqual(['Second'])
      expect((await h.db.getSources()).map((s) => s.name)).toEqual(['Second'])
    })

    it('no cached snapshot outlives its source removed mid-load', async () => {
      const { h, ws, refs } = await started('Inv')
      const gate = h.gate()
      h.flags.loadGate = gate.promise
      await h.bumpRev(CS('one'))
      const refresh = ws.refresh()
      await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
      // The load finishes right after the removal deleted the cached copies, before current is cleared.
      const deleteSource = h.db.deleteSource
      h.db.deleteSource = async (id) => {
        await deleteSource(id)
        gate.open()
        await refresh
      }
      await ws.removeSource('s1')
      expect(await h.db.getSnapshot(refs[0]!)).toBeNull()
      expect(ws.state.snapshot).toBeNull()
      expect(ws.state.current).toBeNull()
    })
  })
})

describe('workspace photos', () => {
  const demoConfig: SourceConfig = {
    id: 'demo',
    kind: 'dev-pglite',
    name: 'Demo',
    connectionString: '',
    uploadcarePublicKey: null,
    createdAt: '2026-11-10T00:00:00Z',
  }
  // A fresh in-memory demo database per test.
  const drivers: ReturnType<typeof createDemoDriver>[] = []
  const freshDriver = (): ReturnType<typeof createDemoDriver> => {
    const d = createDemoDriver({ memory: true, extras: false })
    drivers.push(d)
    return d
  }
  afterEach(async () => {
    await Promise.all(drivers.splice(0).map((d) => d.close()))
  })

  const file = (name: string): File => new File([name], `${name}.jpg`, { type: 'image/jpeg' })

  async function photoHarness() {
    const db = createMemoryDeviceDb()
    await db.putSource(demoConfig)
    const uploads: string[] = []
    const prepared: string[] = []
    const control = { failOn: null as number | null, count: 0, hold: null as Promise<void> | null }
    const store: FileStore = {
      provider: 'fake',
      async upload(_blob, name) {
        control.count++
        uploads.push(name)
        const hold = control.hold
        control.hold = null
        if (hold) await hold
        if (control.failOn === control.count) throw new FileError('unavailable')
        return { provider: 'fake', fileId: `f-${control.count}`, url: `https://cdn.test/${control.count}` }
      },
    }
    const inner = freshDriver()
    const commands: Command[] = []
    const storages: { loadInventory: (id: Id) => Promise<unknown> }[] = []
    const spied: SourceDriver = {
      probe: inner.probe,
      async connect(cfg) {
        const conn = await inner.connect(cfg)
        const storage = Object.create(conn.storage) as typeof conn.storage
        storage.apply = async (command, actor) => {
          commands.push(command)
          return conn.storage.apply(command, actor)
        }
        storages.push(storage)
        return { ...conn, storage }
      },
    }
    const ws = createWorkspace({
      db,
      drivers: { 'dev-pglite': spied },
      userAgent: UA,
      prepareImage: async (f) => {
        prepared.push(f.name)
        return f
      },
      fileStores: () => store,
    })
    await ws.start()
    const snap = ws.state.snapshot!
    const item = snap.items.find((i) => i.name === 'TL072')!
    return { db, ws, uploads, prepared, control, item, commands, storages }
  }

  const photosOf = (ws: ReturnType<typeof createWorkspace>, itemId: Id) =>
    ws.state.snapshot!.photos.filter((p) => p.itemId === itemId).sort((a, b) => a.position - b.position)

  it('adds two files in order and reports progress', async () => {
    const { ws, item, prepared } = await photoHarness()
    const progress: number[] = []
    await ws.addPhotos(item.id, [file('a'), file('b')], (n) => progress.push(n))
    expect(progress).toEqual([1, 2])
    expect(prepared).toEqual(['a.jpg', 'b.jpg'])
    const photos = photosOf(ws, item.id)
    expect(photos.map((p) => p.fileId)).toEqual(['f-1', 'f-2'])
    expect(photos.map((p) => p.provider)).toEqual(['fake', 'fake'])
    expect(photos.map((p) => p.position)).toEqual([0, 1])
  })

  it('stops at the first failed upload and keeps earlier photos', async () => {
    const { ws, item, control } = await photoHarness()
    control.failOn = 2
    await expect(ws.addPhotos(item.id, [file('a'), file('b'), file('c')])).rejects.toMatchObject({
      name: 'FileError',
      code: 'unavailable',
    })
    expect(photosOf(ws, item.id)).toHaveLength(1)
    expect(control.count).toBe(2)
    expect(ws.state.sources[0]!.status).toBe('ready')
  })

  it('uploads nothing while read-only', async () => {
    const { ws, item, uploads, prepared } = await photoHarness()
    ws.state.sources[0]!.status = 'read_only'
    ws.state.readOnly = 'source_error'
    await expect(ws.addPhotos(item.id, [file('a')])).rejects.toMatchObject({ code: 'read_only' })
    expect(uploads).toEqual([])
    expect(prepared).toEqual([])
  })

  it('refuses without a store before uploading', async () => {
    const db = createMemoryDeviceDb()
    await db.putSource(demoConfig)
    const ws = createWorkspace({ db, drivers: { 'dev-pglite': freshDriver() }, userAgent: UA, fileStores: () => null })
    await ws.start()
    const item = ws.state.snapshot!.items[0]!
    await expect(ws.addPhotos(item.id, [file('a')])).rejects.toMatchObject({ name: 'FileError', code: 'no_store' })
  })

  it('refuses without a current snapshot', async () => {
    const db = createMemoryDeviceDb()
    const ws = createWorkspace({ db, drivers: {}, userAgent: UA })
    await ws.start()
    await expect(ws.addPhotos(newId(), [file('a')])).rejects.toMatchObject({ code: 'not_found' })
  })

  it('setVariantPhoto removes the old photo, then adds the new one', async () => {
    const { ws, uploads, commands } = await photoHarness()
    const snap = ws.state.snapshot!
    const variant = snap.variants.find((v) => v.name === '10k')!
    await ws.setVariantPhoto(variant.itemId, variant.id, file('one'))
    const first = ws.state.snapshot!.photos.find((p) => p.variantId === variant.id)!
    await ws.setVariantPhoto(variant.itemId, variant.id, file('two'))
    const now = ws.state.snapshot!.photos.filter((p) => p.variantId === variant.id)
    expect(now).toHaveLength(1)
    expect(now[0]!.id).not.toBe(first.id)
    expect(now[0]!.fileId).toBe('f-2')
    expect(uploads).toEqual(['one.jpg', 'two.jpg'])
    const photoCommands = commands.filter((c) => c.type.startsWith('photo.')).map((c) => c.type)
    expect(photoCommands).toEqual(['photo.add', 'photo.remove', 'photo.add'])
    const removeAt = commands.findIndex((c) => c.type === 'photo.remove')
    expect(commands[removeAt]).toMatchObject({ id: first.id })
    expect(commands[removeAt + 1]).toMatchObject({ type: 'photo.add', variantId: variant.id })
  })

  it('removePhoto removes one photo', async () => {
    const { ws, item } = await photoHarness()
    await ws.addPhotos(item.id, [file('a'), file('b')])
    const [a, b] = photosOf(ws, item.id)
    await ws.removePhoto(a!.id)
    expect(photosOf(ws, item.id).map((p) => p.id)).toEqual([b!.id])
  })

  it('makeCover puts the chosen photo first', async () => {
    const { ws, item, commands } = await photoHarness()
    await ws.addPhotos(item.id, [file('a'), file('b'), file('c')])
    const [a, b, c] = photosOf(ws, item.id)
    await ws.makeCover(item.id, c!.id)
    const reorder = commands.find((cmd) => cmd.type === 'photo.reorder')
    expect(reorder).toMatchObject({ itemId: item.id, orderedIds: [c!.id, a!.id, b!.id] })
    expect(photosOf(ws, item.id).map((p) => p.id)).toEqual([c!.id, a!.id, b!.id])
    expect(b).toBeDefined()
  })

  it('writes to the inventory the upload started on, even if another one is selected meanwhile', async () => {
    const { ws, item, control, commands, storages } = await photoHarness()
    const original = ws.state.current!
    const other = ws.state.inventories.find((e) => e.ref.inventoryId !== original.inventoryId)!
    const g = Promise.withResolvers<undefined>()
    control.hold = g.promise
    const pending = ws.addPhotos(item.id, [file('a')])
    await vi.waitFor(() => expect(control.count).toBe(1))
    await ws.selectInventory(other.ref)
    g.resolve(undefined)
    await pending
    const adds = commands.filter((c) => c.type === 'photo.add')
    expect(adds).toHaveLength(1)
    const target = (await storages[0]!.loadInventory(original.inventoryId)) as { photos: { itemId: Id }[] }
    expect(target.photos.filter((p) => p.itemId === item.id)).toHaveLength(1)
    const elsewhere = (await storages[0]!.loadInventory(other.ref.inventoryId)) as { photos: unknown[] }
    expect(elsewhere.photos).toHaveLength(0)
  })

  it('fileStoreFor never throws; Neon with key and cdn base uploads to that base', async () => {
    const throwing = createWorkspace({
      db: createMemoryDeviceDb(),
      drivers: {},
      userAgent: UA,
      fileStores: () => {
        throw new Error('boom')
      },
    })
    expect(throwing.fileStoreFor('x')).toBeNull()
    const seen: string[] = []
    const fakeFetch = (async (url: string) => {
      seen.push(url)
      return new Response(JSON.stringify({ file: 'uuid-1' }), { status: 200 })
    }) as unknown as typeof fetch
    const store = defaultFileStore(
      { ...config('n3', CS('z')), uploadcarePublicKey: 'pub', uploadcareCdnBase: 'https://abc.ucarecd.net' },
      fakeFetch,
    )!
    expect(store.provider).toBe('uploadcare')
    const stored = await store.upload(new Blob(['x']), 'x.jpg')
    expect(stored.url).toBe('https://abc.ucarecd.net/uuid-1/')
    expect(seen).toHaveLength(1)
  })

  it('fileStoreFor: demo is the device store, Neon without a key is null', async () => {
    const db = createMemoryDeviceDb()
    await db.putSource(demoConfig)
    await db.putSource(config('n1', CS('x')))
    await db.putSource({ ...config('n2', CS('y')), uploadcarePublicKey: 'pub' })
    const ws = createWorkspace({ db, drivers: { 'dev-pglite': freshDriver() }, userAgent: UA })
    await ws.startFromCache()
    expect(ws.fileStoreFor('demo')?.provider).toBe('device')
    expect(ws.fileStoreFor('n1')).toBeNull()
    expect(ws.fileStoreFor('n2')).not.toBeNull()
    expect(ws.fileStoreFor('missing')).toBeNull()
  })

  describe('revision counter', () => {
    const start = async (h: ReturnType<typeof harness>) => {
      const id = await h.seed(CS('one'), 'Inv')
      await h.db.putSource(config('s1', CS('one')))
      const ws = h.workspace()
      await ws.start()
      return { id, ws }
    }

    it('refresh with an unchanged rev does not load the inventory again', async () => {
      const h = setup()
      const { ws } = await start(h)
      const loads = h.flags.loadCalls
      await ws.refresh()
      expect(h.flags.loadCalls).toBe(loads)
      expect(ws.state.snapshotOrigin).toBe('live')
      expect(ws.state.snapshot).not.toBeNull()
    })

    it('a foreign write between the list and the load is not loaded twice', async () => {
      const h = setup()
      await h.seed(CS('one'), 'Inv')
      await h.db.putSource(config('s1', CS('one')))
      const ws = h.workspace()
      h.flags.beforeLoad = () => h.bumpRev(CS('one'))
      await ws.start()
      const loads = h.flags.loadCalls
      expect(loads).toBeGreaterThan(0)
      await ws.refresh()
      expect(h.flags.loadCalls).toBe(loads)
    })

    it('refresh with a changed rev loads again', async () => {
      const h = setup()
      const { id, ws } = await start(h)
      const loads = h.flags.loadCalls
      await (await h.direct(CS('one'))).apply(folderCreate(id, 'By another device'), { device: 'other' })
      await ws.refresh()
      expect(h.flags.loadCalls).toBe(loads + 1)
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['By another device'])
    })

    it('a fresh start with a cached copy at the current rev skips the load and goes live', async () => {
      const h = setup()
      await start(h)
      const loads = h.flags.loadCalls
      const again = h.workspace()
      await again.startFromCache()
      expect(again.state.snapshotOrigin).toBe('cache')
      await again.refresh()
      expect(h.flags.loadCalls).toBe(loads)
      expect(again.state.snapshotOrigin).toBe('live')
    })

    it('a cached copy stored by another app format is reloaded even at the current rev', async () => {
      const h = setup()
      const { ws } = await start(h)
      const ref = ws.state.current!
      const cached = (await h.db.getSnapshot(ref))!
      expect(cached.rev).toMatch(/^\d+:\d+:/)
      await h.db.putSnapshot(ref, { ...cached, rev: `0:0:${cached.rev!.split(':').slice(2).join(':')}` })
      const loads = h.flags.loadCalls
      const again = h.workspace()
      await again.startFromCache()
      await again.refresh()
      expect(h.flags.loadCalls).toBe(loads + 1)
    })

    it('a cached copy at an older rev is reloaded', async () => {
      const h = setup()
      const { id } = await start(h)
      await (await h.direct(CS('one'))).apply(folderCreate(id, 'Later'), { device: 'other' })
      const again = h.workspace()
      await again.startFromCache()
      await again.refresh()
      expect(again.state.snapshot?.folders.map((f) => f.name)).toEqual(['Later'])
    })

    it('an own write reloads, and a later change by another device is not skipped', async () => {
      const h = setup()
      const { id, ws } = await start(h)
      await ws.apply(folderCreate(id, 'Mine'))
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Mine'])
      await ws.refresh()
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Mine'])
      await (await h.direct(CS('one'))).apply(folderCreate(id, 'Theirs'), { device: 'other' })
      await ws.refresh()
      expect(ws.state.snapshot?.folders.map((f) => f.name).sort()).toEqual(['Mine', 'Theirs'])
    })

    it('a change landing between the listing and the load is picked up by the next refresh', async () => {
      const h = setup()
      const { id, ws } = await start(h)
      const other = await h.direct(CS('one'))
      await other.apply(folderCreate(id, 'First'), { device: 'other' })
      const gate = h.gate()
      h.flags.loadGate = gate.promise
      const refreshing = ws.refresh()
      // The load has read its data (it waits after reading); a write lands after the listing was taken.
      while (!h.flags.loadBlocked) await new Promise((r) => setTimeout(r, 1))
      await other.apply(folderCreate(id, 'Second'), { device: 'other' })
      gate.open()
      await refreshing
      await ws.refresh()
      expect(ws.state.snapshot?.folders.map((f) => f.name).sort()).toEqual(['First', 'Second'])
    })
  })
})
