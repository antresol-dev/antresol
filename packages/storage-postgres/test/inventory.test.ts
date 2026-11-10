import { newId, StorageError } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { APP_SCHEMA_VERSION, ensureSchema } from '../src/migrator'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor, makeStorage, TEST_ACTOR } from './helpers'

describe('inventories', () => {
  it('creates and lists an inventory', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'Workshop', description: 'Tools', currency: 'USD' }, TEST_ACTOR)
    const [inv] = (await storage.listInventories()).inventories
    expect(inv).toMatchObject({
      id,
      name: 'Workshop',
      description: 'Tools',
      currency: 'USD',
      createdBy: 'Test · Vitest',
      updatedBy: 'Test · Vitest',
      archivedAt: null,
      archiveId: null,
    })
    expect(new Date(inv!.createdAt).toISOString()).toBe(inv!.createdAt)
  })

  it('clears the description with null and keeps untouched fields', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: 'd', currency: 'USD' }, TEST_ACTOR)
    await storage.apply({ type: 'inventory.update', id, description: null }, { device: 'Other' })
    const [inv] = (await storage.listInventories()).inventories
    expect(inv).toMatchObject({ name: 'A', description: null, updatedBy: 'Other', createdBy: 'Test · Vitest' })
  })

  it('lists inventories sorted by name', async () => {
    const storage = await makeStorage()
    for (const name of ['B', 'A']) {
      await storage.apply({ type: 'inventory.create', id: newId(), name, description: null, currency: 'EUR' }, TEST_ACTOR)
    }
    expect((await storage.listInventories()).inventories.map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('loads an empty snapshot', async () => {
    const storage = await makeStorage()
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    const snap = await storage.loadInventory(id)
    expect(snap.inventory.id).toBe(id)
    expect(snap).toMatchObject({
      folders: [], items: [], variants: [], tags: [], attributes: [], units: [],
      itemAttributes: [], variantAttributeValues: [], photos: [], stock: [],
    })
  })

  it('is read-only when the database schema is newer', async () => {
    const exec = await makeExecutor()
    await ensureSchema(exec)
    await exec.batch([sql`update gm_meta set value = ${String(APP_SCHEMA_VERSION + 1)} where key = 'schema_version'`])
    const { storage, status } = await openPostgresStorage(exec)
    expect(status.state).toBe('newer')
    expect(storage.readOnly).toBe(true)
    const err = await storage
      .apply({ type: 'inventory.create', id: newId(), name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect((err as StorageError).code).toBe('read_only')
    expect((await storage.listInventories()).inventories).toEqual([])
  })

  it('wraps driver errors in StorageError(failed) with cause', async () => {
    const storage = await makeStorage()
    const err = await storage
      .apply({ type: 'folder.create', id: newId(), inventoryId: newId(), parentId: null, name: 'x', description: null }, TEST_ACTOR)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageError)
    expect((err as StorageError).code).toBe('failed')
    expect((err as StorageError).cause).toBeDefined()
  })
})

describe('revision counter', () => {
  it('starts at 0, grows by one per apply and is not touched by reads', async () => {
    const storage = await makeStorage()
    expect((await storage.listInventories()).rev).toBe('0')
    const id = newId()
    await storage.apply({ type: 'inventory.create', id, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    expect((await storage.listInventories()).rev).toBe('1')
    await storage.apply({ type: 'inventory.update', id, name: 'B' }, TEST_ACTOR)
    expect((await storage.listInventories()).rev).toBe('2')
    await storage.loadInventory(id)
    await storage.loadAllMovements(id)
    await storage.listInventories()
    expect((await storage.listInventories()).rev).toBe('2')
  })
})
