import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStore, get, keys, set } from 'idb-keyval'
import { newId, type Inventory, type InventorySnapshot } from '@graymatter/core'
import { createMemoryDeviceDb, openDeviceDb, type DeviceDb } from '../app/lib/device-db'
import type { InventoryRef, SourceConfig } from '../app/lib/types'

const source = (id: string): SourceConfig => ({
  id,
  kind: 'neon',
  name: `Source ${id}`,
  connectionString: 'postgresql://u:p@h/db',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
})
const inventory = (name: string): Inventory => ({
  id: newId(),
  name,
  description: null,
  currency: 'USD',
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  createdBy: 'test',
  updatedBy: 'test',
  archivedAt: null,
  archiveId: null,
})
const snap = (): { snapshot: InventorySnapshot; savedAt: string } => ({
  snapshot: { inventory: { id: newId() } } as unknown as InventorySnapshot,
  savedAt: '2026-11-10T00:00:00Z',
})

describe('device db (IndexedDB)', () => {
  it('stores and replaces sources by id', async () => {
    const db = await openDeviceDb()
    expect(db.persistent).toBe(true)
    const id = newId()
    await db.putSource(source(id))
    await db.putSource({ ...source(id), name: 'Renamed' })
    const found = (await db.getSources()).filter((s) => s.id === id)
    expect(found).toHaveLength(1)
    expect(found[0]!.name).toBe('Renamed')
  })

  it('deleteSource removes only that source snapshots', async () => {
    const db = await openDeviceDb()
    const a = newId()
    const b = newId()
    const inv = newId()
    await db.putSource(source(a))
    await db.putSource(source(b))
    await db.putSnapshot({ sourceId: a, inventoryId: inv }, snap())
    await db.putSnapshot({ sourceId: b, inventoryId: inv }, snap())
    await db.deleteSource(a)
    expect(await db.getSnapshot({ sourceId: a, inventoryId: inv })).toBeNull()
    expect(await db.getSnapshot({ sourceId: b, inventoryId: inv })).not.toBeNull()
    await db.deleteSnapshot({ sourceId: b, inventoryId: inv })
    expect(await db.getSnapshot({ sourceId: b, inventoryId: inv })).toBeNull()
  })

  it('stores, replaces and deletes inventory listings per source', async () => {
    const db = await openDeviceDb()
    const a = newId()
    const b = newId()
    const tools = inventory('Tools')
    await db.putListing(a, [inventory('Old')])
    await db.putListing(a, [tools])
    await db.putListing(b, [])
    const stored = await db.getListings()
    expect(stored[a]).toEqual([tools])
    expect(stored[b]).toEqual([])
    await db.deleteListing(a)
    const after = await db.getListings()
    expect(Object.hasOwn(after, a)).toBe(false)
    expect(after[b]).toEqual([])
  })

  it('putSettings merges into existing settings', async () => {
    const db = await openDeviceDb()
    const current = { sourceId: 's', inventoryId: 'i' }
    await db.putSettings({ current })
    await db.putSettings({ deviceName: 'X' })
    expect(await db.getSettings()).toEqual({ deviceName: 'X', current })
  })
})

describe.each<[string, () => Promise<DeviceDb>]>([
  ['memory', async () => createMemoryDeviceDb()],
  ['IndexedDB', openDeviceDb],
])('revisions of cached copies (%s)', (_kind, open) => {
  const refIn = (sourceId: string): InventoryRef => ({ sourceId, inventoryId: newId() })
  const at = (rev: string | null) => ({ ...snap(), rev })

  it('advanceSnapshotRevs moves the copies of the source saved at `from`, except the written inventory', async () => {
    const db = await open()
    const s = newId()
    const [written, kept, older, elsewhere] = [refIn(s), refIn(s), refIn(s), refIn(newId())]
    const keptCopy = at('r1')
    await db.putSnapshot(written, at('r1'))
    await db.putSnapshot(kept, keptCopy)
    await db.putSnapshot(older, at('r0'))
    await db.putSnapshot(elsewhere, at('r1'))
    await db.advanceSnapshotRevs(s, 'r1', 'r2', written.inventoryId)
    expect((await db.getSnapshot(written))!.rev).toBe('r1')
    expect(await db.getSnapshot(kept)).toEqual({ ...keptCopy, rev: 'r2' })
    expect((await db.getSnapshot(older))!.rev).toBe('r0')
    expect((await db.getSnapshot(elsewhere))!.rev).toBe('r1')
  })

  it('markSnapshotStale makes the revision unknown until the copy is saved again', async () => {
    const db = await open()
    const s = newId()
    const ref = refIn(s)
    const copy = at('r1')
    await db.putSnapshot(ref, copy)
    await db.markSnapshotStale(ref)
    expect(await db.getSnapshot(ref)).toEqual({ ...copy, rev: null })
    // An unknown revision is never `from`.
    await db.advanceSnapshotRevs(s, 'r1', 'r2', newId())
    expect((await db.getSnapshot(ref))!.rev).toBeNull()
    await db.putSnapshot(ref, at('r3'))
    expect((await db.getSnapshot(ref))!.rev).toBe('r3')
  })

  it('a stale mark never outlives its copy', async () => {
    const db = await open()
    const s = newId()
    const ref = refIn(s)
    await db.markSnapshotStale(ref)
    expect(await db.getSnapshot(ref)).toBeNull()
    await db.putSnapshot(ref, at('r1'))
    await db.markSnapshotStale(ref)
    await db.deleteSnapshot(ref)
    expect(await db.getSnapshot(ref)).toBeNull()
    await db.putSnapshot(ref, at('r2'))
    expect((await db.getSnapshot(ref))!.rev).toBe('r2')
    await db.markSnapshotStale(ref)
    await db.deleteSource(s)
    expect(await db.getSnapshot(ref)).toBeNull()
  })
})

describe('revisions of copies cached by an older app (IndexedDB)', () => {
  it('are read from the record, and moved without rewriting it', async () => {
    const db = await openDeviceDb()
    const store = createStore('graymatter', 'kv')
    const s = newId()
    const [atFrom, atOther] = [newId(), newId()]
    const legacy = (rev: string) => ({ ...snap(), rev })
    const fromCopy = legacy('r1')
    await set(`snapshot:${s}:${atFrom}`, fromCopy, store)
    await set(`snapshot:${s}:${atOther}`, legacy('r0'), store)
    expect((await db.getSnapshot({ sourceId: s, inventoryId: atFrom }))!.rev).toBe('r1')
    await db.advanceSnapshotRevs(s, 'r1', 'r2', newId())
    expect(await db.getSnapshot({ sourceId: s, inventoryId: atFrom })).toEqual({ ...fromCopy, rev: 'r2' })
    expect(await get(`snapshot:${s}:${atFrom}`, store)).toEqual(fromCopy)
    expect((await db.getSnapshot({ sourceId: s, inventoryId: atOther }))!.rev).toBe('r0')
    await db.deleteSource(s)
    expect((await keys(store)).map(String).filter((k) => k.includes(s))).toEqual([])
  })
})

describe('device db without IndexedDB', () => {
  const original = globalThis.indexedDB
  afterEach(() => {
    globalThis.indexedDB = original
  })

  it('falls back to memory', async () => {
    globalThis.indexedDB = undefined as unknown as IDBFactory
    const db = await openDeviceDb()
    expect(db.persistent).toBe(false)
    expect(await db.getSettings()).toEqual({ deviceName: null, current: null })
    await db.putSource(source('m'))
    expect((await db.getSources()).map((s) => s.id)).toEqual(['m'])
    await db.putSettings({ deviceName: 'Y' })
    expect((await db.getSettings()).deviceName).toBe('Y')
    await db.putSnapshot({ sourceId: 'm', inventoryId: 'i' }, snap())
    await db.deleteSource('m')
    expect(await db.getSnapshot({ sourceId: 'm', inventoryId: 'i' })).toBeNull()
    expect(await db.getListings()).toEqual({})
    const tools = inventory('Tools')
    await db.putListing('m', [tools])
    await db.putListing('n', [])
    expect(await db.getListings()).toEqual({ m: [tools], n: [] })
    await db.deleteListing('m')
    expect(await db.getListings()).toEqual({ n: [] })
  })
})

describe('device db when the probe write fails', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to memory', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    const db = await openDeviceDb()
    expect(db.persistent).toBe(false)
    await db.putSource(source('m'))
    expect((await db.getSources()).map((s) => s.id)).toEqual(['m'])
  })
})
