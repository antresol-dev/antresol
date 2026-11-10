import { afterEach, describe, expect, it } from 'vitest'
import { newId, type Inventory, type InventorySnapshot } from '@graymatter/core'
import { openDeviceDb } from '../app/lib/device-db'
import type { SourceConfig } from '../app/lib/types'

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
