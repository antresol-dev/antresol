import { PGlite } from '@electric-sql/pglite'
import { DomainError, FileError, newId, StorageError, variantLabel, type Command, type FileStore, type Id } from '@antresol/core'
import { APP_SCHEMA_VERSION, createPgliteExecutor, type PgExecutor } from '@antresol/storage-postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, isReactive } from 'vue'
import { createMemoryDeviceDb, type DeviceDb } from '../app/lib/device-db'
import { defaultDeviceName } from '../app/lib/device-name'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { errorMessageKey } from '../app/lib/errors'
import { createNeonDriver, type SourceDriver } from '../app/lib/sources'
import type { InventoryRef, SourceConfig } from '../app/lib/types'
import type { WorkspaceDeps } from '../app/lib/workspace-types'
import { createWorkspace, defaultFileStore, FAILED_RETRY_MS, SNAPSHOT_FORMAT } from '../app/lib/workspace'

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
    /** One-shot: the next listInventories reads, then runs this before answering. */
    afterList: null as (() => Promise<void>) | null,
    /** One-shot: the next inspect (a refresh's look at the schema) reads, then runs this before answering. */
    afterInspect: null as (() => Promise<void>) | null,
    /** listInventories calls by connection string. */
    listsBy: new Map<string, number>(),
    /** While set, every listInventories on this connection string waits for the promise first. */
    listHold: null as { connectionString: string; promise: Promise<void> } | null,
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
    /** Command types the source was asked to apply, in order. */
    applied: [] as string[],
    /** One-shot: the next apply writes, then runs this before answering; a throw loses the answer of a committed write. */
    afterApply: null as (() => Promise<void>) | null,
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
      let closed = false
      /** Like a pool after end(): a call that goes out on a closed connection fails. */
      const open = (): void => {
        if (closed) throw new StorageError('failed', 'connection closed')
      }
      const gated = async <T>(id: Id, read: () => Promise<T>): Promise<T> => {
        flags.loadCalls++
        const before = flags.beforeLoad
        flags.beforeLoad = null
        if (before) await before()
        open()
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
        open()
        if (flags.loadError) throw flags.loadError
        if (flags.missing.has(id)) throw new StorageError('not_found')
        return conn.storage.exportInventory(id)
      }
      storage.apply = async (command, actor) => {
        flags.applyCalls++
        flags.applied.push(command.type)
        const applyGate = flags.applyGate
        if (applyGate) {
          flags.applyGate = null
          flags.applyBlocked = true
          await applyGate
        }
        open()
        if (flags.applyError) throw flags.applyError
        const result = await conn.storage.apply(command, actor)
        const after = flags.afterApply
        flags.afterApply = null
        if (after) await after()
        return result
      }
      storage.loadMovements = async (itemId) => {
        flags.movementCalls++
        open()
        if (flags.movementError) throw flags.movementError
        return conn.storage.loadMovements(itemId)
      }
      storage.listInventories = async () => {
        flags.listCalls++
        flags.listsBy.set(cfg.connectionString, (flags.listsBy.get(cfg.connectionString) ?? 0) + 1)
        const hold = flags.listHold
        if (hold?.connectionString === cfg.connectionString) await hold.promise
        const listGate = flags.listGate
        if (listGate) {
          flags.listGate = null
          await listGate
        }
        open()
        const listError = flags.listError
        if (listError) {
          flags.listError = null
          throw listError
        }
        const listing = await conn.storage.listInventories()
        const after = flags.afterList
        flags.afterList = null
        if (after) await after()
        return listing
      }
      const close = async (): Promise<void> => {
        flags.closeCalls++
        closed = true
        await conn.close()
      }
      const inspect = async (): ReturnType<typeof conn.inspect> => {
        open()
        const inspection = await conn.inspect()
        const after = flags.afterInspect
        flags.afterInspect = null
        if (after) await after()
        return inspection
      }
      return { ...conn, storage, inspect, close }
    },
  }

  const db = createMemoryDeviceDb()
  const now = (): Date => new Date(flags.clock)
  /** Photos: the file name is the file id. */
  const fileStore: FileStore = {
    provider: 'fake',
    upload: async (_blob, name) => ({ provider: 'fake', fileId: name, url: `https://cdn.test/${name}` }),
  }
  const workspace = (extra: Partial<WorkspaceDeps> = {}) =>
    createWorkspace({ db, drivers: { neon: driver }, userAgent: UA, now, fileStores: () => fileStore, prepareImage: async (f) => f, ...extra })

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
  const holdDb = <K extends 'getSnapshot' | 'deleteSnapshot' | 'deleteSource' | 'deleteListing' | 'putSource'>(method: K) => {
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

  it('6. a schema that needs a newer app makes the source read-only and looks for an update', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const checkForUpdate = vi.fn()
    const ws = h.workspace({ checkForUpdate })
    await ws.start()
    const next = APP_SCHEMA_VERSION + 1
    await h.pgs[0]!.exec(`update antresol_meta set value = '${next}' where key in ('schema_version', 'min_app_schema')`)
    // The refresh reuses the open connection, yet checks the schema through it.
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('read_only')
    // The banner "Update to keep editing" shows for exactly this reason.
    expect(ws.state.readOnly).toBe('schema_newer')
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    const calls = h.flags.applyCalls
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
    expect(h.flags.applyCalls).toBe(calls)
    // Still read-only: no second look.
    await ws.refresh()
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    // A workspace started on the newer schema is read-only too, and looks once.
    const freshCheck = vi.fn()
    const fresh = h.workspace({ checkForUpdate: freshCheck })
    await fresh.start()
    expect(fresh.state.sources[0]!.status).toBe('read_only')
    expect(fresh.state.readOnly).toBe('schema_newer')
    expect(freshCheck).toHaveBeenCalledTimes(1)
    // Back to this app's version: the next refresh makes the source writable again.
    await h.pgs[0]!.exec(`update antresol_meta set value = '${APP_SCHEMA_VERSION}' where key in ('schema_version', 'min_app_schema')`)
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.readOnly).toBeNull()
    await ws.apply(folderCreate(id, 'Shelf'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
  })

  it('6b. a newer schema whose min_app_schema this app meets stays writable, no update check', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const checkForUpdate = vi.fn()
    const ws = h.workspace({ checkForUpdate })
    await ws.start()
    // Another device's app migrated the source to the next schema, an additive one: min_app_schema stays.
    await h.pgs[0]!.exec(`update antresol_meta set value = '${APP_SCHEMA_VERSION + 1}' where key = 'schema_version'`)
    const connects = h.flags.connectCalls
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(ws.state.readOnly).toBeNull()
    // The open connection stays: its schema is still one this app writes.
    expect(h.flags.connectCalls).toBe(connects)
    await ws.apply(folderCreate(id, 'Shelf'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
    const fresh = h.workspace({ checkForUpdate })
    await fresh.start()
    expect(fresh.state.sources[0]!.status).toBe('ready')
    expect(checkForUpdate).not.toHaveBeenCalled()
  })

  it('6c. a write the source refuses for a newer min_app_schema turns it read-only with the update banner, one look for an update', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const checkForUpdate = vi.fn()
    const ws = h.workspace({ checkForUpdate })
    await ws.start()
    // Another device's app migrated the source to a schema this app may not write, after this app connected. The write
    // batch checks it under the revision lock (AN003) and refuses with read_only.
    const next = APP_SCHEMA_VERSION + 1
    await h.pgs[0]!.exec(`update antresol_meta set value = '${next}' where key in ('schema_version', 'min_app_schema')`)
    h.flags.applyError = new StorageError('read_only')
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
    h.flags.applyError = null
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(ws.state.readOnly).toBe('schema_newer')
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    // The copy stays; the next write is refused on the device.
    expect(ws.state.snapshot?.inventory.id).toBe(id)
    const calls = h.flags.applyCalls
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
    expect(h.flags.applyCalls).toBe(calls)
    // The next refresh finds the same schema: still read-only, no second look.
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(ws.state.readOnly).toBe('schema_newer')
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
  })

  it('6d. a refresh that looked at the schema before a write was refused for it keeps the source read-only', async () => {
    const h = setup()
    const id = await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const checkForUpdate = vi.fn()
    const ws = h.workspace({ checkForUpdate })
    await ws.start()
    // The refresh reuses the connection and finds the schema still one this app writes; before it answers, another
    // device migrates past this app and a write is refused for it (AN003, the real guard of the write batch).
    h.flags.afterInspect = async () => {
      const next = APP_SCHEMA_VERSION + 1
      await h.pgs[0]!.exec(`update antresol_meta set value = '${next}' where key in ('schema_version', 'min_app_schema')`)
      await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
      expect(ws.state.readOnly).toBe('schema_newer')
    }
    await ws.refresh()
    expect(h.flags.afterInspect).toBeNull()
    // What the refresh saw is older than the refusal: the banner stays, the next write is refused on the device.
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(ws.state.readOnly).toBe('schema_newer')
    const calls = h.flags.applyCalls
    await expect(ws.apply(folderCreate(id, 'Nope'))).rejects.toMatchObject({ code: 'read_only' })
    expect(h.flags.applyCalls).toBe(calls)
    // A refresh started after the refusal finds the newer schema itself: still read-only, one look for an update in all.
    await ws.refresh()
    expect(ws.state.sources[0]!.status).toBe('read_only')
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
    expect((await (await h.direct(CS('one'))).loadInventory(id)).folders).toEqual([])
  })

  it('7. validates before writing and keeps the written copy on the device', async () => {
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
    await ws.flushCache()
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

  it('14. syncIfDue skips data checked within the interval and checks older data', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.setCheckInterval('5m')
    await ws.refresh()
    const calls = h.flags.listCalls
    h.flags.clock += 4 * 60_000
    await ws.syncIfDue()
    expect(h.flags.listCalls).toBe(calls)
    h.flags.clock += 60_000
    await ws.syncIfDue()
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

  it('17. a slow refresh load that read the source before a write does not drop the written rows', async () => {
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
    const loads = h.flags.loadCalls
    await ws.apply(folderCreate(id, 'Fresh'))
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Fresh'])
    gate.open()
    await refresh
    expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Fresh'])
    expect((await h.db.getSnapshot(ws.state.current!))!.snapshot.folders).toHaveLength(1)
    // The load read the revision right before the write and got its rows on top: the copy is current.
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads)
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

  it('22. syncIfDue checks regardless of age while the current source is unreachable', async () => {
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
    await ws.syncIfDue()
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
    await ws.syncIfDue()
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

  it('3a. a cached copy of a foreign format is not shown, even offline', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const first = h.workspace()
    await first.start()
    const ref = first.state.current!
    const cached = (await h.db.getSnapshot(ref))!
    expect(cached).not.toBeNull()
    for (const format of ['0:0', undefined]) {
      await h.db.putSnapshot(ref, { ...cached, format, rev: null })
      h.flags.offline = true
      const ws = h.workspace()
      await ws.startFromCache()
      expect(ws.state.snapshot).toBeNull()
      expect(ws.state.snapshotOrigin).toBeNull()
    }
    await h.db.putSnapshot(ref, { ...cached, rev: null })
    const ok = h.workspace()
    await ok.startFromCache()
    expect(ok.state.snapshotOrigin).toBe('cache')
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
      format: 'antresol-backup',
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
      // Whatever the interval: it covers healthy sources only.
      await ws.setCheckInterval('never')
      const connects = h.flags.connectCalls
      const lists = h.flags.listCalls

      h.flags.clock += FAILED_RETRY_MS - 1
      await ws.syncIfDue()
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects, lists])

      h.flags.clock += 1
      await ws.syncIfDue()
      // s2 tries a new connection, s1 lists on its open one.
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects + 1, lists + 1])
      await ws.syncIfDue()
      expect([h.flags.connectCalls, h.flags.listCalls]).toEqual([connects + 1, lists + 1])

      // The current source failing still refreshes at once.
      h.flags.applyError = new StorageError('unavailable')
      await ws.apply(folderCreate(ws.state.current!.inventoryId, 'X')).catch(() => {})
      h.flags.applyError = null
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      await ws.syncIfDue()
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

    it('keeps the reload after a wide write when a later-started load fails', async () => {
      const { h, ws, refs } = await started('Inv')
      const tagId = newId()
      await ws.apply({ type: 'tag.create', id: tagId, inventoryId: refs[0]!.inventoryId, name: 'Red' })
      const gate = h.gate()
      h.flags.loadGate = gate.promise
      // tag.delete returns no rows: the inventory is reloaded after it.
      const write = ws.apply({ type: 'tag.delete', id: tagId })
      // The reload after the write has read the inventory without the tag and waits.
      await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
      h.flags.loadError = new StorageError('unavailable')
      await ws.refresh()
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      h.flags.loadError = null
      gate.open()
      await write
      expect(ws.state.snapshot?.tags).toEqual([])
      expect((await h.db.getSnapshot(refs[0]!))!.snapshot.tags).toEqual([])
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

    it('an edit saved while the source is being removed does not bring it back', async () => {
      const { h, ws } = await started('Inv')
      const finishing = h.holdDb('deleteListing')
      const removal = ws.removeSource('s1')
      await vi.waitFor(() => expect(finishing.held).toBe(true))
      const update = ws.updateSource('s1', { name: 'Renamed' }).then(
        () => null,
        (e: unknown) => e,
      )
      finishing.open()
      await removal
      const refused = await update
      expect(await h.db.getSources()).toEqual([])
      expect(await h.db.getListings()).toEqual({})
      expect(ws.state.sources).toEqual([])
      expect(ws.state.inventories).toEqual([])
      // Being removed: nothing to edit.
      expect(refused).toMatchObject({ code: 'not_found' })
    })

    it('a failure of the connection an edit replaced does not mark the edited source', async () => {
      const { h, ws, refs } = await started('Inv')
      const gate = h.gate()
      h.flags.applyGate = gate.promise
      const write = ws.apply(folderCreate(refs[0]!.inventoryId, 'X'))
      await vi.waitFor(() => expect(h.flags.applyBlocked).toBe(true))
      // Edited while the write is on its way: the edit opens a new connection, which answers.
      await ws.updateSource('s1', { name: 'Renamed' })
      expect(ws.state.sources[0]!.status).toBe('ready')
      // The old connection's write is lost on the way.
      h.flags.applyError = new StorageError('unavailable')
      gate.open()
      await expect(write).rejects.toMatchObject({ code: 'unavailable' })
      expect(ws.state.sources.map((s) => [s.config.name, s.status])).toEqual([['Renamed', 'ready']])
      expect(ws.state.readOnly).toBeNull()
    })

    it('a write on its way keeps the connection a refresh lets go open until it is done', async () => {
      const { h, ws, refs } = await started('Inv')
      const gate = h.gate()
      h.flags.applyGate = gate.promise
      const write = ws.apply(folderCreate(refs[0]!.inventoryId, 'Shelf'))
      await vi.waitFor(() => expect(h.flags.applyBlocked).toBe(true))
      // The reused connection fails its check: the refresh opens another one and lets the old one go.
      const connects = h.flags.connectCalls
      h.flags.listError = new StorageError('unavailable')
      await ws.refresh()
      expect(h.flags.connectCalls).toBe(connects + 1)
      expect(ws.state.sources[0]!.status).toBe('ready')
      gate.open()
      await write
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Shelf'])
      // Closed once the write is done.
      await vi.waitFor(() => expect(h.flags.closeCalls).toBe(1))
    })

    it('of two overlapping removals, one that fails does not let an edit save the source back while the other runs', async () => {
      const { h, ws } = await started('Inv')
      const deleting = h.gate()
      const deleteSource = h.db.deleteSource
      let calls = 0
      h.db.deleteSource = async (id) => {
        // The first removal fails on the device; the second one is still deleting.
        if (++calls === 1) throw new Error('device storage failed')
        await deleting.promise
        return deleteSource(id)
      }
      const first = ws.removeSource('s1').then(
        () => null,
        (e: unknown) => e,
      )
      const second = ws.removeSource('s1')
      expect(await first).toMatchObject({ message: 'device storage failed' })
      await vi.waitFor(() => expect(calls).toBe(2))
      // An edit now: its save would land after the second removal deleted the source.
      const saving = h.holdDb('putSource')
      const update = ws.updateSource('s1', { name: 'Renamed' }).then(
        () => null,
        (e: unknown) => e,
      )
      deleting.open()
      await second
      saving.open()
      expect(await update).toMatchObject({ code: 'not_found' })
      expect(await h.db.getSources()).toEqual([])
      expect(await h.db.getListings()).toEqual({})
      expect(ws.state.sources).toEqual([])
    })

    it('a removal that fails midway leaves no saved list without its source; removing again cleans up', async () => {
      const { h, ws } = await started('Inv')
      const failOnce = (method: 'deleteSource' | 'deleteListing'): void => {
        const original = h.db[method]
        h.db[method] = async () => {
          h.db[method] = original
          throw new Error('device storage failed')
        }
      }
      for (const method of ['deleteSource', 'deleteListing'] as const) {
        failOnce(method)
        await expect(ws.removeSource('s1')).rejects.toThrow('device storage failed')
        const sources = (await h.db.getSources()).map((s) => s.id)
        expect(Object.keys(await h.db.getListings()).filter((id) => !sources.includes(id))).toEqual([])
      }
      await ws.removeSource('s1')
      expect(await h.db.getSources()).toEqual([])
      expect(await h.db.getListings()).toEqual({})
      expect(ws.state.sources).toEqual([])
    })
  })
})

describe('workspace writes patch the local copy', () => {
  /** Source s1 with one inventory per name, started; the first name sorts first and is current. */
  const started = async (...names: string[]) => {
    const h = setup()
    const refs: InventoryRef[] = []
    for (const name of names) refs.push({ sourceId: 's1', inventoryId: await h.seed(CS('one'), name) })
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.current).toEqual(refs[0])
    return { h, ws, refs, inv: refs[0]!.inventoryId }
  }
  const createItem = (inventoryId: Id, id: Id = newId(), name = 'Bolt'): Command => ({
    type: 'item.create', id, inventoryId, folderId: null, name, description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null,
  })
  const receive = (itemId: Id, quantity: string): Command => ({
    type: 'stock.receive', movementId: newId(), itemId, variantId: null, quantity, totalPrice: null, sourceUrl: null, note: null,
  })
  type Ws = ReturnType<ReturnType<typeof harness>['workspace']>
  const itemIds = (ws: Ws): Id[] => ws.state.snapshot!.items.map((i) => i.id).sort()
  const folderNames = (ws: Ws): string[] => ws.state.snapshot!.folders.map((f) => f.name).sort()
  /** The source's revision as the device cache stores it. */
  const cachedRevOfSource = async (h: ReturnType<typeof harness>): Promise<string> =>
    `${SNAPSHOT_FORMAT}:${APP_SCHEMA_VERSION}:${(await (await h.direct(CS('one'))).listInventories()).rev}`

  it('1. twenty stock receipts in a row load nothing', async () => {
    const { h, ws, inv } = await started('Inv')
    const itemId = newId()
    const loads = h.flags.loadCalls
    await ws.apply(createItem(inv, itemId))
    for (let n = 1; n <= 20; n++) await ws.apply(receive(itemId, String(n)))
    expect(h.flags.loadCalls).toBe(loads)
    const line = ws.state.snapshot!.stock.find((l) => l.itemId === itemId && l.variantId === null)
    expect(Number(line?.quantity)).toBe(210)
    const fresh = await (await h.direct(CS('one'))).loadInventory(inv)
    expect(fresh.stock.find((l) => l.itemId === itemId && l.variantId === null)).toEqual(line)
  })

  it('2. quick add with a photo loads nothing', async () => {
    const { h, ws, inv } = await started('Inv')
    const itemId = newId()
    const loads = h.flags.loadCalls
    await ws.apply(createItem(inv, itemId))
    await ws.addPhotos(itemId, [new File(['x'], 'shot.jpg', { type: 'image/jpeg' })])
    expect(h.flags.loadCalls).toBe(loads)
    expect(itemIds(ws)).toEqual([itemId])
    expect(ws.state.snapshot!.photos.map((p) => [p.itemId, p.fileId])).toEqual([[itemId, 'shot.jpg']])
  })

  it('3. a foreign write between two own writes keeps both own rows and marks the copy stale; the next refresh loads once', async () => {
    const { h, ws, inv } = await started('Inv')
    const mine = [newId(), newId()]
    const loads = h.flags.loadCalls
    await ws.apply(createItem(inv, mine[0], 'First'))
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    await ws.apply(createItem(inv, mine[1], 'Second'))
    expect(itemIds(ws)).toEqual([...mine].sort())
    // The other device's folder is not in the copy yet.
    expect(folderNames(ws)).toEqual([])
    expect(h.flags.loadCalls).toBe(loads)
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Theirs'])
    expect(itemIds(ws)).toEqual([...mine].sort())
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it("3b. after another device wrote, an own write does not vouch for B's cached copy", async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    await (await h.direct(CS('one'))).apply(folderCreate(b.inventoryId, 'Theirs'), { device: 'other' })
    await ws.apply(folderCreate(a.inventoryId, 'Mine'))
    const loads = h.flags.loadCalls
    await ws.selectInventory(b)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Theirs'])
  })

  it("4. an own write in inventory A keeps B's cached copy current", async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    const loads = h.flags.loadCalls
    await ws.apply(folderCreate(a.inventoryId, 'Shelf'))
    await ws.selectInventory(b)
    expect(h.flags.loadCalls).toBe(loads)
    expect(ws.state.snapshot?.inventory.id).toBe(b.inventoryId)
    expect(ws.state.snapshotOrigin).toBe('live')
    // A's written copy was kept on the device when B was opened: back on A, nothing loads either.
    await ws.selectInventory(a)
    expect(h.flags.loadCalls).toBe(loads)
    expect(folderNames(ws)).toEqual(['Shelf'])
  })

  it('4b. a stepper delta flushed by a switch is checked against the copy it was pressed in and kept with it: no load', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    const [one, two] = [newId(), newId()]
    await ws.apply(createItem(a.inventoryId, one, 'One'))
    await ws.apply(createItem(a.inventoryId, two, 'Two'))
    // Two steppers with a pending delta each, flushed by the switch (before-write hooks).
    const sent: Promise<void>[] = []
    let pending = true
    const stop = ws.onBeforeWrite(() => {
      if (!pending) return
      pending = false
      sent.push(ws.applyTo(a, receive(one, '3')), ws.applyTo(a, receive(two, '4')))
    })
    const gate = h.gate()
    h.flags.applyGate = gate.promise
    const loads = h.flags.loadCalls
    await ws.selectInventory(b)
    stop()
    expect(sent).toHaveLength(2)
    expect(ws.state.snapshot?.inventory.id).toBe(b.inventoryId)
    gate.open()
    await Promise.all(sent)
    expect(h.flags.loadCalls).toBe(loads)
    expect(h.flags.applied.slice(-2)).toEqual(['stock.receive', 'stock.receive'])
    // Both rows are in A's copy on the device, at the source's revision: opening A again loads nothing.
    expect((await h.db.getSnapshot(a))!.rev).toBe(await cachedRevOfSource(h))
    await ws.selectInventory(a)
    expect(h.flags.loadCalls).toBe(loads)
    const stock = (id: Id) => ws.state.snapshot!.stock.find((l) => l.itemId === id && l.variantId === null)?.quantity
    expect([stock(one), stock(two)]).toEqual(['3', '4'])
    await ws.sync()
    expect(h.flags.loadCalls).toBe(loads)
  })

  it('4c. a carried copy takes no rows it cannot be sure of: another device wrote first, so it is marked stale', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    const itemId = newId()
    await ws.apply(createItem(a.inventoryId, itemId))
    await (await h.direct(CS('one'))).apply(folderCreate(a.inventoryId, 'Theirs'), { device: 'other' })
    let sent: Promise<void> | null = null
    let pending = true
    const stop = ws.onBeforeWrite(() => {
      if (!pending) return
      pending = false
      sent = ws.applyTo(a, receive(itemId, '3'))
    })
    await ws.selectInventory(b)
    stop()
    await sent
    expect((await h.db.getSnapshot(a))!.rev).toBeNull()
    const loads = h.flags.loadCalls
    await ws.selectInventory(a)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Theirs'])
    expect(ws.state.snapshot!.stock.find((l) => l.itemId === itemId)?.quantity).toBe('3')
  })

  it('5. a write to a non-current inventory marks its cached copy stale', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    await ws.applyTo(b, folderCreate(b.inventoryId, 'Shelf'))
    expect((await h.db.getSnapshot(b))!.rev).toBeNull()
    const loads = h.flags.loadCalls
    await ws.selectInventory(b)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Shelf'])
  })

  it('6. a wide command reloads the current inventory once', async () => {
    const { h, ws, inv } = await started('Inv')
    const tagId = newId()
    await ws.apply({ type: 'tag.create', id: tagId, inventoryId: inv, name: 'Red' })
    expect(ws.state.snapshot!.tags.map((t) => t.name)).toEqual(['Red'])
    let loads = h.flags.loadCalls
    await ws.apply({ type: 'tag.delete', id: tagId })
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(ws.state.snapshot!.tags).toEqual([])
    // A wide command that also relists (restore) loads once too.
    const itemId = newId()
    const archiveId = newId()
    await ws.apply(createItem(inv, itemId))
    await ws.apply({ type: 'archive', target: 'item', id: itemId, archiveId })
    loads = h.flags.loadCalls
    await ws.apply({ type: 'restore', archiveId })
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(ws.state.snapshot!.items.find((i) => i.id === itemId)?.archivedAt).toBeNull()
    // The reloads were at the source's revision.
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it('6b. in sync, a write that changes the list of inventories relists and loads nothing', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    const loads = h.flags.loadCalls
    const lists = h.flags.listCalls
    await ws.apply({ type: 'inventory.update', id: a.inventoryId, name: 'A2' })
    expect(ws.state.snapshot!.inventory.name).toBe('A2')
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A2', 'B'])
    expect(h.flags.loadCalls).toBe(loads)
    await ws.applyTo(b, { type: 'archive', target: 'inventory', id: b.inventoryId, archiveId: newId() })
    expect(ws.state.archivedInventories.map((e) => e.inventory.name)).toEqual(['B'])
    expect(h.flags.listCalls).toBe(lists + 2)
    // B, not shown, is read once to validate the command; nothing is loaded after it.
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it('7. an unknown outcome marks the copy stale; retrying the same command leaves the item once', async () => {
    const { h, ws, inv } = await started('Inv')
    // Not written at all: the source did not change, yet the copy is no longer trusted.
    h.flags.applyError = new StorageError('unavailable')
    await expect(ws.apply(createItem(inv))).rejects.toMatchObject({ code: 'unavailable' })
    h.flags.applyError = null
    let loads = h.flags.loadCalls
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(itemIds(ws)).toEqual([])

    // Written, but the answer was lost.
    const command = createItem(inv)
    h.flags.afterApply = async () => {
      throw new StorageError('unavailable')
    }
    await expect(ws.apply(command)).rejects.toMatchObject({ code: 'unavailable' })
    expect(ws.state.readOnly).toBe('offline')
    expect(itemIds(ws)).toEqual([])
    loads = h.flags.loadCalls
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(itemIds(ws)).toEqual([(command as { id: Id }).id])
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)

    // The retry changes nothing in the source and replaces the item's rows in the copy.
    await ws.apply(command)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(itemIds(ws)).toEqual([(command as { id: Id }).id])
    expect((await (await h.direct(CS('one'))).loadInventory(inv)).items).toHaveLength(1)
  })

  it('8. a rejected write refreshes at once', async () => {
    const { h, ws, inv } = await started('Inv')
    for (const error of [new StorageError('failed', 'constraint'), new DomainError('not_found')]) {
      h.flags.applyError = error
      const lists = h.flags.listCalls
      const listing = h.gate()
      h.flags.listGate = listing.promise
      let settled = false
      const write = ws.apply(folderCreate(inv, 'X')).then(
        () => null,
        (e: unknown) => {
          settled = true
          return e
        },
      )
      // The refresh is listing: the write has not rejected yet.
      await vi.waitFor(() => expect(h.flags.listGate).toBeNull())
      expect(settled).toBe(false)
      listing.open()
      expect(await write).toMatchObject({ code: error.code })
      expect(h.flags.listCalls).toBe(lists + 1)
    }
    h.flags.applyError = null
  })

  it('8b. values another device made equal are refused as a conflict: the copy syncs before the error, nothing written', async () => {
    const { h, ws, inv } = await started('Inv')
    const [itemId, axis, a, b] = [newId(), newId(), newId(), newId()]
    await ws.apply(createItem(inv, itemId))
    await ws.apply({ type: 'attribute.create', id: axis, inventoryId: inv, name: 'Size', kind: 'text', options: [], unit: '', siPrefixes: false })
    await ws.apply({ type: 'item.setAttribute', itemId, attributeId: axis, value: 'S' })
    await ws.apply({ type: 'item.addAxis', itemId, attributeId: axis, firstVariantId: a })
    await ws.apply({ type: 'variant.createMany', itemId, variants: [{ id: b, values: [{ attributeId: axis, value: 'M' }] }] })
    expect(ws.state.snapshot!.variants.map((v) => v.id).sort()).toEqual([a, b].sort())
    const valueOf = (variantId: Id): string | null =>
      ws.state.snapshot!.variantAttributeValues.find((v) => v.variantId === variantId && v.attributeId === axis)?.value ?? null
    // Another device sets b to L; this copy still shows M.
    const other = await h.direct(CS('one'))
    await other.apply({ type: 'variant.setValues', itemId, rows: [{ variantId: b, values: [{ attributeId: axis, value: 'L' }] }] }, { device: 'other' })
    expect(valueOf(b)).toBe('M')
    const before = await other.loadInventory(inv)
    const lists = h.flags.listCalls
    // L is free on this copy, so the write goes out; the database refuses it whole.
    const error = await ws
      .apply({ type: 'variant.setValues', itemId, rows: [{ variantId: a, values: [{ attributeId: axis, value: 'L' }] }] })
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(error).toMatchObject({ name: 'StorageError', code: 'conflict' })
    expect(errorMessageKey(error)).toBe('errors.storage.conflict')
    // Synced before the error came back: the form that shows it already sees the other device's values.
    expect(h.flags.listCalls).toBe(lists + 1)
    expect(valueOf(b)).toBe('L')
    expect(valueOf(a)).toBe('S')
    expect(ws.state.sources[0]!.status).toBe('ready')
    expect(await other.loadInventory(inv)).toEqual(before)
  })

  it("9. a load that finished during a write is not overwritten by the write's older rows", async () => {
    const { h, ws, inv } = await started('Inv')
    const itemId = newId()
    await ws.apply(createItem(inv, itemId, 'Bolt'))
    const other = await h.direct(CS('one'))
    // After the write committed and before its answer arrives, another device renames the item and a refresh loads that.
    h.flags.afterApply = async () => {
      await other.apply({ type: 'item.update', id: itemId, name: 'Theirs' }, { device: 'other' })
      await ws.refresh()
    }
    await ws.apply({ type: 'item.update', id: itemId, name: 'Mine' })
    expect(ws.state.snapshot!.items.map((i) => i.name)).toEqual(['Theirs'])
    // Not proven current: the next refresh loads it again, once.
    const loads = h.flags.loadCalls
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it('9b. a load that finished during a write, read right before it, gets the write rows and stays current', async () => {
    const { h, ws, inv } = await started('Inv')
    await h.bumpRev(CS('one'))
    const gate = h.gate()
    h.flags.applyGate = gate.promise
    const write = ws.apply(folderCreate(inv, 'Shelf'))
    await vi.waitFor(() => expect(h.flags.applyBlocked).toBe(true))
    // The refresh loads the copy at the revision the write then starts from.
    const loads = h.flags.loadCalls
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    gate.open()
    await write
    expect(folderNames(ws)).toEqual(['Shelf'])
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it('9c. a load that read the source before another device wrote keeps the own rows shown after it and leaves the copy stale', async () => {
    const { h, ws, inv } = await started('Inv')
    const other = await h.direct(CS('one'))
    await other.apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    const gate = h.gate()
    h.flags.loadGate = gate.promise
    const refresh = ws.refresh()
    // The load has read 'Theirs' and waits; another device writes again, then this one.
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    await h.bumpRev(CS('one'))
    const mine = newId()
    await ws.apply(createItem(inv, mine))
    gate.open()
    await refresh
    expect(itemIds(ws)).toEqual([mine])
    const loads = h.flags.loadCalls
    await ws.refresh()
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(itemIds(ws)).toEqual([mine])
    expect(folderNames(ws)).toEqual(['Theirs'])
  })

  it('9d. a load started before switching away and back cannot drop rows written meanwhile', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    // Another device writes; B is loaded at the new revision, A's cached copy is behind it.
    await h.bumpRev(CS('one'))
    await ws.refresh()
    // L0: selecting A loads it (held before it reads). L1: a refresh loads A too (held after it read).
    const first = h.gate()
    h.flags.beforeLoad = () => first.promise
    const selecting = ws.selectInventory(a)
    await vi.waitFor(() => expect(h.flags.beforeLoad).toBeNull())
    const second = h.gate()
    h.flags.loadGate = second.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    first.open()
    await selecting
    // An own write in sync, then B and back to A: both cached copies are current, nothing loads.
    await ws.apply(folderCreate(a.inventoryId, 'Mine'))
    const loads = h.flags.loadCalls
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    expect(h.flags.loadCalls).toBe(loads)
    // L1, which read A before the write, lands now.
    second.open()
    await refresh
    expect(folderNames(ws)).toEqual(['Mine'])
    await ws.flushCache()
    expect((await h.db.getSnapshot(a))!.snapshot.folders.map((f) => f.name)).toEqual(['Mine'])
  })

  it("9e. a load that read the write's result keeps the write's rows for a later load that read before it", async () => {
    const { h, ws, inv } = await started('Inv')
    await h.bumpRev(CS('one'))
    // L0 (the refresh) waits before it reads; L1 (selecting the same inventory) reads at once and is held.
    const first = h.gate()
    h.flags.beforeLoad = () => first.promise
    const refresh = ws.refresh()
    await vi.waitFor(() => expect(h.flags.beforeLoad).toBeNull())
    const second = h.gate()
    h.flags.loadGate = second.promise
    const selecting = ws.selectInventory({ sourceId: 's1', inventoryId: inv })
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    // The write commits; L0 reads its result and is shown before the write answers: kept.
    h.flags.afterApply = async () => {
      first.open()
      await refresh
    }
    await ws.apply(folderCreate(inv, 'Shelf'))
    expect(folderNames(ws)).toEqual(['Shelf'])
    // L1, which read the source before the write, lands now: the write's rows go on top.
    second.open()
    await selecting
    expect(folderNames(ws)).toEqual(['Shelf'])
    const loads = h.flags.loadCalls
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.loadCalls).toBe(loads)
  })

  it('10. the cached copy and its revision are saved together', async () => {
    const { h, ws, inv } = await started('Inv')
    const ref = ws.state.current!
    await ws.apply(folderCreate(inv, 'Shelf'))
    // Closed before the copy was saved: the device never holds a revision newer than its rows.
    const early = (await h.db.getSnapshot(ref))!
    expect(early.snapshot.folders.length === 1 || early.rev !== (await cachedRevOfSource(h))).toBe(true)
    const reopened = h.workspace()
    await reopened.start()
    expect(folderNames(reopened)).toEqual(['Shelf'])

    await ws.apply(folderCreate(inv, 'Bin'))
    await ws.flushCache()
    const saved = (await h.db.getSnapshot(ref))!
    expect(saved.snapshot.folders.map((f) => f.name).sort()).toEqual(['Bin', 'Shelf'])
    expect(saved.rev).toBe(await cachedRevOfSource(h))
    const loads = h.flags.loadCalls
    const again = h.workspace()
    await again.start()
    expect(h.flags.loadCalls).toBe(loads)
    expect(folderNames(again)).toEqual(['Bin', 'Shelf'])
  })

  it('11. an in-sync write counts as a check, a stale one does not', async () => {
    const { h, ws, inv } = await started('Inv')
    h.flags.clock += 60_000
    await ws.apply(folderCreate(inv, 'One'))
    const checked = new Date(h.flags.clock).toISOString()
    expect(ws.state.lastRefreshAt).toBe(checked)
    await h.bumpRev(CS('one'))
    h.flags.clock += 60_000
    await ws.apply(folderCreate(inv, 'Two'))
    expect(ws.state.lastRefreshAt).toBe(checked)
  })

  it('12. a listing read before an own write and applied after it keeps the revision the write moved to: nothing loads', async () => {
    const { h, ws, inv } = await started('Inv')
    const loads = h.flags.loadCalls
    // The refresh's listing reads the source; the write lands before that listing is applied.
    h.flags.afterList = () => ws.apply(folderCreate(inv, 'Shelf'))
    await ws.refresh()
    expect(folderNames(ws)).toEqual(['Shelf'])
    expect(h.flags.loadCalls).toBe(loads)
    // The next write is still in sync: it counts as a check. Sync then finds nothing to load.
    h.flags.clock += 60_000
    await ws.apply(folderCreate(inv, 'Box'))
    expect(ws.state.lastRefreshAt).toBe(new Date(h.flags.clock).toISOString())
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.loadCalls).toBe(loads)
  })

  it('12b. a listing read before an own new inventory and applied after it does not drop that inventory', async () => {
    const { h, ws } = await started('Inv')
    let created: InventoryRef | null = null
    h.flags.afterList = async () => {
      created = await ws.createInventory({ sourceId: 's1', name: 'New', currency: 'USD' })
    }
    await ws.refresh()
    expect(created).not.toBeNull()
    expect(ws.state.current).toEqual(created)
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['Inv', 'New'])
    expect(Object.values(await h.db.getListings())[0]!.map((i) => i.name).sort()).toEqual(['Inv', 'New'])
  })

  it('12c. listings answering out of order never let an older one put back the list an own write changed', async () => {
    const { h, ws, inv } = await started('Inv')
    const itemId = newId()
    await ws.apply(createItem(inv, itemId))
    // Checks are due: the journal and the write each check the source first.
    h.flags.clock += 16 * 60_000
    let created: InventoryRef | null = null
    // L0, a refresh, reads the source (one inventory) and then waits.
    h.flags.afterList = async () => {
      // L1, the journal's check, starts and waits before reading.
      const l1 = h.gate()
      h.flags.listGate = l1.promise
      const journal = ws.loadMovements(itemId)
      await vi.waitFor(() => expect(h.flags.listGate).toBeNull())
      // An own new inventory lands; its relist (L2) stores the list with it.
      created = await ws.createInventory({ sourceId: 's1', name: 'New', currency: 'USD' })
      // L1 reads after that write and answers after L2: the same list, but a listing that started earlier.
      l1.open()
      await journal
      expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['Inv', 'New'])
    }
    // L0 answers last, at the revision before the write: it must not take the new inventory away.
    await ws.refresh()
    expect(created).not.toBeNull()
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['Inv', 'New'])
    expect(ws.state.current).toEqual(created)
    expect(Object.values(await h.db.getListings())[0]!.map((i) => i.name).sort()).toEqual(['Inv', 'New'])
  })

  describe('per-bucket lock', () => {
    it('a stock write locks only its bucket: other buckets and forms stay free, a form write waits for its own', async () => {
      const { h, ws, inv } = await started('Inv')
      const [a, b] = [newId(), newId()]
      await ws.apply(createItem(inv, a, 'A'))
      await ws.apply(createItem(inv, b, 'B'))
      const lockedA = computed(() => ws.isBucketSaving(a, null))
      expect(lockedA.value).toBe(false)

      const gate = h.gate()
      h.flags.applyGate = gate.promise
      const writing = ws.apply(receive(a, '3'))
      expect(lockedA.value).toBe(true)
      expect(ws.isBucketSaving(b, null)).toBe(false)
      expect(ws.isBucketSaving(a, newId())).toBe(false)
      expect(ws.state.saving).toBe(false)

      const form = ws.apply(folderCreate(inv, 'Box'))
      expect(ws.state.saving).toBe(true)
      expect(ws.isBucketSaving(b, null)).toBe(false)

      gate.open()
      await Promise.all([writing, form])
      expect(lockedA.value).toBe(false)
      expect(ws.state.saving).toBe(false)
    })

    it('a transfer locks both of its buckets; a failed write releases its bucket', async () => {
      const { h, ws, inv } = await started('Inv')
      const itemId = newId()
      await ws.apply(createItem(inv, itemId))
      await ws.apply(receive(itemId, '5'))
      const axis = newId()
      const variant = newId()
      await ws.apply({ type: 'attribute.create', id: axis, inventoryId: inv, name: 'Value', kind: 'text', options: [], unit: '', siPrefixes: false })
      await ws.apply({ type: 'item.addAxis', itemId, attributeId: axis, firstVariantId: variant })
      await ws.apply({ type: 'variant.createMany', itemId, variants: [{ id: variant, values: [{ attributeId: axis, value: '1k' }] }] })
      const gate = h.gate()
      h.flags.applyGate = gate.promise
      const moving = ws.apply({
        type: 'stock.transfer',
        transferId: newId(),
        outMovementId: newId(),
        inMovementId: newId(),
        itemId,
        fromVariantId: null,
        toVariantId: variant,
        quantity: '2',
      })
      expect(ws.isBucketSaving(itemId, null)).toBe(true)
      expect(ws.isBucketSaving(itemId, variant)).toBe(true)
      gate.open()
      await moving
      expect(ws.isBucketSaving(itemId, null)).toBe(false)
      expect(ws.isBucketSaving(itemId, variant)).toBe(false)

      h.flags.applyError = new StorageError('failed')
      const failing = ws.apply(receive(itemId, '1'))
      expect(ws.isBucketSaving(itemId, null)).toBe(true)
      await expect(failing).rejects.toThrow()
      expect(ws.isBucketSaving(itemId, null)).toBe(false)
    })

    it('before any write, the before-write hooks run; a write a hook makes goes first', async () => {
      const { h, ws, inv } = await started('Inv')
      const itemId = newId()
      await ws.apply(createItem(inv, itemId))
      let waiting = true
      let sent: Promise<void> | null = null
      const stop = ws.onBeforeWrite(() => {
        // Like a stepper flushing its pending delta: its own write calls the hooks again, and they must not loop.
        if (!waiting) return
        waiting = false
        sent = ws.apply(receive(itemId, '2'))
      })
      const failing = ws.onBeforeWrite(() => {
        throw new Error('a broken hook does not stop the write')
      })
      const before = h.flags.applied.length
      await ws.apply(folderCreate(inv, 'Box'))
      await sent
      expect(h.flags.applied.slice(before)).toEqual(['stock.receive', 'folder.create'])
      stop()
      failing()
      waiting = true
      await ws.apply(folderCreate(inv, 'Bin'))
      expect(h.flags.applied.slice(before)).toEqual(['stock.receive', 'folder.create', 'folder.create'])
    })
  })
})

describe('workspace sync and the check interval', () => {
  const MINUTE = 60_000
  /** Source s1 with one inventory per name, started; the first name sorts first and is current. */
  const started = async (...names: string[]) => {
    const h = setup()
    const refs: InventoryRef[] = []
    for (const name of names) refs.push({ sourceId: 's1', inventoryId: await h.seed(CS('one'), name) })
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.current).toEqual(refs[0])
    return { h, ws, refs, inv: refs[0]!.inventoryId }
  }
  type Ws = ReturnType<ReturnType<typeof harness>['workspace']>
  const folderNames = (ws: Ws): string[] => ws.state.snapshot!.folders.map((f) => f.name).sort()

  it('1. sync with an unchanged source lists once, loads nothing and returns unchanged', async () => {
    const { h, ws, inv } = await started('Inv')
    // Right after start, then after three own writes.
    for (const writes of [0, 3]) {
      for (let n = 0; n < writes; n++) await ws.apply(folderCreate(inv, `Shelf ${n}`))
      const lists = h.flags.listCalls
      const loads = h.flags.loadCalls
      expect(await ws.sync()).toBe('unchanged')
      expect(h.flags.listCalls).toBe(lists + 1)
      expect(h.flags.loadCalls).toBe(loads)
    }
    expect(folderNames(ws)).toEqual(['Shelf 0', 'Shelf 1', 'Shelf 2'])
  })

  it('2. sync after another device wrote loads once and returns updated', async () => {
    const { h, ws, inv } = await started('Inv')
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    const loads = h.flags.loadCalls
    expect(await ws.sync()).toBe('updated')
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Theirs'])
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.loadCalls).toBe(loads + 1)
  })

  it('3. sync lists every source', async () => {
    const h = setup()
    await h.seed(CS('one'), 'A')
    await h.seed(CS('two'), 'B')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    const ws = h.workspace()
    await ws.start()
    // An inventory created on another device shows after the next sync.
    await h.seed(CS('two'), 'C')
    const lists = h.flags.listCalls
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.listCalls).toBe(lists + 2)
    expect(ws.state.inventories.map((e) => e.inventory.name)).toEqual(['A', 'B', 'C'])
  })

  it('4. reloadSource loads the current inventory even when the revision matches; another cached inventory of the source loads when opened', async () => {
    const { h, ws, refs } = await started('A', 'B')
    const [a, b] = refs as [InventoryRef, InventoryRef]
    await ws.selectInventory(b)
    await ws.selectInventory(a)
    // Both device copies are at the source's revision but wrong.
    for (const ref of [a, b]) {
      const cached = (await h.db.getSnapshot(ref))!
      await h.db.putSnapshot(ref, { ...cached, snapshot: { ...cached.snapshot, inventory: { ...cached.snapshot.inventory, name: 'Wrong' } } })
    }
    const reopened = h.workspace()
    await reopened.start()
    const loads = h.flags.loadCalls
    expect(reopened.state.snapshot!.inventory.name).toBe('Wrong')
    expect(await reopened.sync()).toBe('unchanged')

    await reopened.reloadSource('s1')
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(reopened.state.snapshot!.inventory.name).toBe('A')
    await reopened.selectInventory(b)
    expect(h.flags.loadCalls).toBe(loads + 2)
    expect(reopened.state.snapshot!.inventory.name).toBe('B')
    // Both reloaded copies are current again.
    await reopened.selectInventory(a)
    expect(h.flags.loadCalls).toBe(loads + 2)
    expect(reopened.state.snapshot!.inventory.name).toBe('A')
  })

  it('5. syncIfDue within the interval does nothing; after it, it checks once', async () => {
    const { h, ws } = await started('Inv')
    expect(ws.state.checkInterval).toBe('15m')
    const minutes = { '5m': 5, '15m': 15, '1h': 60, '6h': 360, '1d': 1440 } as const
    for (const [interval, n] of Object.entries(minutes)) {
      await ws.setCheckInterval(interval as keyof typeof minutes)
      // Any successful check starts the interval again.
      await ws.sync()
      const lists = h.flags.listCalls
      h.flags.clock += n * MINUTE - 1
      await ws.syncIfDue()
      expect(h.flags.listCalls).toBe(lists)
      h.flags.clock += 1
      await ws.syncIfDue()
      expect(h.flags.listCalls).toBe(lists + 1)
      await ws.syncIfDue()
      expect(h.flags.listCalls).toBe(lists + 1)
    }
  })

  it('6. with never, syncIfDue leaves a healthy source alone; sync still checks', async () => {
    const { h, ws, inv } = await started('Inv')
    await ws.setCheckInterval('never')
    h.flags.clock += 7 * 1440 * MINUTE
    const lists = h.flags.listCalls
    await ws.syncIfDue()
    await ws.apply(folderCreate(inv, 'Shelf'))
    expect(h.flags.listCalls).toBe(lists)
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.listCalls).toBe(lists + 1)
  })

  it('7. a failing current source is retried at once whatever the interval', async () => {
    const { h, ws, inv } = await started('Inv')
    for (const interval of ['never', '1d'] as const) {
      await ws.setCheckInterval(interval)
      h.flags.applyError = new StorageError('unavailable')
      await expect(ws.apply(folderCreate(inv, 'X'))).rejects.toMatchObject({ code: 'unavailable' })
      h.flags.applyError = null
      expect(ws.state.sources[0]!.status).toBe('unreachable')
      const lists = h.flags.listCalls
      await ws.syncIfDue()
      expect(h.flags.listCalls).toBe(lists + 1)
      expect(ws.state.sources[0]!.status).toBe('ready')
    }
  })

  it('8. a write after the interval checks first', async () => {
    const { h, ws, inv } = await started('Inv')
    // Another device adds a shelf; the own write puts a bin on it, which the copy before the check does not have.
    const shelf = newId()
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Shelf', shelf), { device: 'other' })
    h.flags.clock += 15 * MINUTE
    const lists = h.flags.listCalls
    const loads = h.flags.loadCalls
    const applies = h.flags.applyCalls
    const gate = h.gate()
    h.flags.applyGate = gate.promise
    const write = ws.apply({ ...folderCreate(inv, 'Bin'), parentId: shelf } as Command)
    await vi.waitFor(() => expect(h.flags.applyBlocked).toBe(true))
    expect(h.flags.listCalls).toBe(lists + 1)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(h.flags.applyCalls).toBe(applies + 1)
    gate.open()
    await write
    expect(folderNames(ws)).toEqual(['Bin', 'Shelf'])
    // The next write is within the interval: it only writes.
    await ws.apply(folderCreate(inv, 'Box'))
    expect([h.flags.listCalls, h.flags.applyCalls]).toEqual([lists + 1, applies + 2])
  })

  it('9. the interval is kept on the device', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    expect(ws.state.checkInterval).toBe('15m')
    await ws.start()
    expect(ws.state.checkInterval).toBe('15m')
    await ws.setCheckInterval('1h')
    expect(ws.state.checkInterval).toBe('1h')
    const again = h.workspace()
    await again.startFromCache()
    expect(again.state.checkInterval).toBe('1h')
  })

  it('10. a refresh that leaves the shown copy stale does not count as a check', async () => {
    const { h, ws, inv } = await started('Inv')
    const checked = ws.state.lastRefreshAt
    h.flags.clock += MINUTE
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    const gate = h.gate()
    h.flags.loadGate = gate.promise
    const refresh = ws.refresh()
    // The load has read 'Theirs' and waits; another device writes again, then this one: the load cannot be placed
    // against the own rows.
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    await h.bumpRev(CS('one'))
    await ws.apply(folderCreate(inv, 'Mine'))
    gate.open()
    await refresh
    expect(ws.state.lastRefreshAt).toBe(checked)
    // So the check comes due on time and loads the copy.
    h.flags.clock += 14 * MINUTE
    const loads = h.flags.loadCalls
    await ws.syncIfDue()
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Mine', 'Theirs'])
    expect(ws.state.lastRefreshAt).toBe(new Date(h.flags.clock).toISOString())
  })

  it('11. sync and reloadSource reject with unavailable when the source cannot be reached', async () => {
    const { h, ws } = await started('Inv')
    await expect(ws.reloadSource('nope')).rejects.toMatchObject({ code: 'not_found' })
    h.flags.offline = true
    await expect(ws.sync()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(ws.reloadSource('s1')).rejects.toMatchObject({ code: 'unavailable' })
    expect(ws.state.sources[0]!.status).toBe('unreachable')
    h.flags.offline = false
    await expect(ws.reloadSource('s1')).resolves.toBeUndefined()
    expect(ws.state.sources[0]!.status).toBe('ready')
  })

  it('12. sync does not ride on a refresh that listed before it was called', async () => {
    const { h, ws, inv } = await started('Inv')
    const gate = h.gate()
    let listed = false
    h.flags.afterList = async () => {
      listed = true
      await gate.promise
    }
    const running = ws.refresh()
    await vi.waitFor(() => expect(listed).toBe(true))
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    const synced = ws.sync()
    gate.open()
    expect(await synced).toBe('updated')
    await running
    expect(folderNames(ws)).toEqual(['Theirs'])
  })

  it('13. the journal is read after a due check', async () => {
    const { h, ws, inv } = await started('Inv')
    const itemId = newId()
    await ws.apply({
      type: 'item.create', id: itemId, inventoryId: inv, folderId: null, name: 'Bolt', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null,
    })
    h.flags.clock += 15 * MINUTE
    const lists = h.flags.listCalls
    const listing = h.gate()
    h.flags.listGate = listing.promise
    const journal = ws.loadMovements(itemId)
    await vi.waitFor(() => expect(h.flags.listGate).toBeNull())
    expect(h.flags.movementCalls).toBe(0)
    listing.open()
    await journal
    expect([h.flags.listCalls, h.flags.movementCalls]).toEqual([lists + 1, 1])
    // Within the interval: the journal only.
    await ws.loadMovements(itemId)
    expect([h.flags.listCalls, h.flags.movementCalls]).toEqual([lists + 1, 2])
  })
  /** s1 with inventory A (current), s2 with inventory B, both started. */
  const twoSources = async () => {
    const h = setup()
    const a = await h.seed(CS('one'), 'A')
    const b = await h.seed(CS('two'), 'B')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('two')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.current).toEqual({ sourceId: 's1', inventoryId: a })
    return { h, ws, a, b }
  }
  const listsOf = (h: ReturnType<typeof harness>, name: string): number => h.flags.listsBy.get(CS(name)) ?? 0

  it('14. a due write checks its own source alone: the changed copy loads once, another source is never waited for or retried', async () => {
    const { h, ws, a } = await twoSources()
    const shelf = newId()
    await (await h.direct(CS('one'))).apply(folderCreate(a, 'Shelf', shelf), { device: 'other' })
    h.flags.clock += 15 * MINUTE
    // s2 hangs on every listing; an automatic check of all sources is stuck on it.
    const hold = h.gate()
    h.flags.listHold = { connectionString: CS('two'), promise: hold.promise }
    const auto = ws.syncIfDue()
    await vi.waitFor(() => expect(listsOf(h, 'two')).toBe(2))
    const [one, loads] = [listsOf(h, 'one'), h.flags.loadCalls]
    let written = false
    const write = ws.apply({ ...folderCreate(a, 'Bin'), parentId: shelf } as Command).then(() => {
      written = true
    })
    await vi.waitFor(() => expect(written).toBe(true))
    expect(folderNames(ws)).toEqual(['Bin', 'Shelf'])
    // Listed s1 once more (the automatic check listed it too), loaded once, and left s2 alone.
    expect(listsOf(h, 'one')).toBe(one + 1)
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(listsOf(h, 'two')).toBe(2)
    hold.open()
    h.flags.listHold = null
    await Promise.all([auto, write])
  })

  it('15. a failing current source is not retried by a write to another source', async () => {
    const { h, ws, a, b } = await twoSources()
    h.flags.applyError = new StorageError('unavailable')
    await expect(ws.apply(folderCreate(a, 'X'))).rejects.toMatchObject({ code: 'unavailable' })
    h.flags.applyError = null
    expect(ws.state.sources.map((s) => s.status)).toEqual(['unreachable', 'ready'])
    h.flags.clock += 15 * MINUTE
    const [one, two, connects] = [listsOf(h, 'one'), listsOf(h, 'two'), h.flags.connectCalls]
    await ws.applyTo({ sourceId: 's2', inventoryId: b }, folderCreate(b, 'Shelf'))
    expect([listsOf(h, 'one'), listsOf(h, 'two'), h.flags.connectCalls]).toEqual([one, two + 1, connects])
    expect(ws.state.sources.map((s) => s.status)).toEqual(['unreachable', 'ready'])
    expect((await (await h.direct(CS('two'))).loadInventory(b)).folders.map((f) => f.name)).toEqual(['Shelf'])
  })

  it('16. while another source fails, a check of the current one still counts', async () => {
    const h = setup()
    await h.seed(CS('one'), 'Inv')
    await h.db.putSource(config('s1', CS('one')))
    await h.db.putSource(config('s2', CS('nope')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.sources.map((s) => s.status)).toEqual(['ready', 'error'])
    h.flags.clock += MINUTE
    expect(await ws.sync()).toBe('unchanged')
    expect(ws.state.lastRefreshAt).toBe(new Date(h.flags.clock).toISOString())
  })

  it('15b. a rejected write checks only its own source, fresh: a hung source neither delays it nor the next write', async () => {
    const { h, ws, a } = await twoSources()
    const hold = h.gate()
    h.flags.listHold = { connectionString: CS('two'), promise: hold.promise }
    const [one, two] = [listsOf(h, 'one'), listsOf(h, 'two')]
    h.flags.applyError = new StorageError('failed', 'constraint')
    await expect(ws.apply(folderCreate(a, 'X'))).rejects.toMatchObject({ code: 'failed' })
    h.flags.applyError = null
    expect([listsOf(h, 'one'), listsOf(h, 'two')]).toEqual([one + 1, two])
    await ws.apply(folderCreate(a, 'Y'))
    expect(listsOf(h, 'two')).toBe(two)
    expect(folderNames(ws)).toEqual(['Y'])
    hold.open()
    h.flags.listHold = null
  })

  it('16b. sync without a current inventory: unavailable when a source failed, unchanged when all are healthy', async () => {
    const h = setup()
    h.addDatabase(CS('one'))
    await h.db.putSource(config('s1', CS('one')))
    const ws = h.workspace()
    await ws.start()
    expect(ws.state.current).toBeNull()
    expect(await ws.sync()).toBe('unchanged')
    h.flags.offline = true
    await expect(ws.sync()).rejects.toMatchObject({ code: 'unavailable' })
    h.flags.offline = false
    expect(await ws.sync()).toBe('unchanged')
  })

  it('17. sync never ends unchanged with a copy it left behind: one more check loads it', async () => {
    const { h, ws, inv } = await started('Inv')
    await (await h.direct(CS('one'))).apply(folderCreate(inv, 'Theirs'), { device: 'other' })
    const gate = h.gate()
    h.flags.loadGate = gate.promise
    const synced = ws.sync()
    // The sync's load has read 'Theirs' and waits; another device writes again, then this one: the load cannot be
    // placed against the own rows.
    await vi.waitFor(() => expect(h.flags.loadBlocked).toBe(true))
    await h.bumpRev(CS('one'))
    await ws.apply(folderCreate(inv, 'Mine'))
    const loads = h.flags.loadCalls
    gate.open()
    expect(await synced).toBe('updated')
    expect(h.flags.loadCalls).toBe(loads + 1)
    expect(folderNames(ws)).toEqual(['Mine', 'Theirs'])
    // It is current now: the next sync loads nothing.
    expect(await ws.sync()).toBe('unchanged')
    expect(h.flags.loadCalls).toBe(loads + 1)
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

  it('setVariantPhoto replaces the old photo with one photo.replace', async () => {
    const { ws, uploads, commands } = await photoHarness()
    const snap = ws.state.snapshot!
    const resistorId = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!.id
    const variant = snap.variants.find((v) => v.itemId === resistorId && variantLabel(snap, v) === '10 kΩ')!
    await ws.setVariantPhoto(variant.itemId, variant.id, file('one'))
    const first = ws.state.snapshot!.photos.find((p) => p.variantId === variant.id)!
    await ws.setVariantPhoto(variant.itemId, variant.id, file('two'))
    const now = ws.state.snapshot!.photos.filter((p) => p.variantId === variant.id)
    expect(now).toHaveLength(1)
    expect(now[0]!.id).not.toBe(first.id)
    expect(now[0]!.fileId).toBe('f-2')
    expect(uploads).toEqual(['one.jpg', 'two.jpg'])
    const photoCommands = commands.filter((c) => c.type.startsWith('photo.')).map((c) => c.type)
    expect(photoCommands).toEqual(['photo.replace', 'photo.replace'])
    // Each names the photo the variant had when it was chosen: none, then the first one.
    const [one, two] = commands.filter((c) => c.type === 'photo.replace')
    expect(one).toMatchObject({ itemId: variant.itemId, variantId: variant.id, fileId: 'f-1', replaces: null })
    expect(two).toMatchObject({ itemId: variant.itemId, variantId: variant.id, fileId: 'f-2', replaces: first.id })
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

  it('defaultFileStore picks the chosen photo store when its keys are set', () => {
    const base = config('n4', CS('w'))
    expect(defaultFileStore({ ...base, photoStore: 'cloudinary', cloudinaryCloudName: 'c', cloudinaryUploadPreset: 'p' })?.provider).toBe('cloudinary')
    expect(defaultFileStore({ ...base, photoStore: 'cloudinary', cloudinaryCloudName: 'c' })).toBeNull()
    expect(defaultFileStore({ ...base, photoStore: 'imgur', imgurClientId: 'id' })?.provider).toBe('imgur')
    expect(defaultFileStore({ ...base, photoStore: 'imgur', uploadcarePublicKey: 'pub' })).toBeNull()
    expect(defaultFileStore({ ...base, uploadcarePublicKey: 'pub' })?.provider).toBe('uploadcare')
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

    it('an own write loads nothing, and a later change by another device is not skipped', async () => {
      const h = setup()
      const { id, ws } = await start(h)
      const loads = h.flags.loadCalls
      await ws.apply(folderCreate(id, 'Mine'))
      expect(ws.state.snapshot?.folders.map((f) => f.name)).toEqual(['Mine'])
      await ws.refresh()
      expect(h.flags.loadCalls).toBe(loads)
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
